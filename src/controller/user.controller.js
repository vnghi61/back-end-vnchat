import { config } from "../config.js";
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import { Block, Nickname } from "../models/social.model.js";
import User from "../models/user.model.js";
import { Errors } from "../lib/errors.js";
import { normalizeName } from "../lib/names.js";
import { can } from "../lib/permissions.js";
import { parseLimit } from "../lib/cursor.js";
import { toConversations, toMessages, unreadOf, userProfile } from "../lib/serializers.js";
import { escapeRegex } from "../lib/utlist.js";
import { imageInput, parse, sameId, toObjectId, z } from "../lib/validate.js";
import { cloudinaryConfigured, uploadDataUri } from "../services/message.service.js";
import { isOnline } from "../services/presence.service.js";
import { getSettings } from "../services/settings.service.js";

export const getMe = async (req, res) => {
  res.status(200).json(userProfile(req.user, { includeEmail: true, includeAdmin: true }));
};

const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  // data URI (upload Cloudinary), URL ảnh, hoặc "" để xoá
  profileImage: imageInput.or(z.literal("")).optional(),
});

export const updateMe = async (req, res) => {
  const body = parse(updateMeSchema, req.body);
  const $set = {};
  if (body.name) Object.assign($set, { name: body.name, nameSearch: normalizeName(body.name) });
  if (body.profileImage !== undefined) {
    $set.profileImage = body.profileImage.startsWith("data:")
      ? (await uploadDataUri(body.profileImage, req.user._id)).url
      : body.profileImage;
  }
  const user = await User.findByIdAndUpdate(req.user._id, { $set }, { new: true });
  res.status(200).json(userProfile(user, { includeEmail: true, includeAdmin: true }));
};

// Dữ liệu khởi động của client (không gồm danh sách hội thoại: lấy bằng GET /api/conversations).
export const bootstrap = async (req, res) => {
  const me = req.user;
  const settings = await getSettings();
  const now = new Date();

  const convs = await Conversation.find({ memberIds: me._id }).select("lastSeq members").lean();
  let unreadTotal = 0;
  for (const c of convs) {
    const member = c.members.find((m) => sameId(m.userId, me._id));
    if (!member || member.archivedAt || (member.mutedUntil && member.mutedUntil > now)) continue;
    unreadTotal += unreadOf(c, member);
  }

  const [nicknames, blocks, isAdmin, isAgentRole] = await Promise.all([
    Nickname.find({ ownerId: me._id }).limit(2000).lean(),
    Block.find({ blockerId: me._id }).select("blockedId").lean(),
    can(me, "admin:principals", "read"),
    can(me, "support", "write"),
  ]);

  res.status(200).json({
    me: userProfile(me, { includeEmail: true, includeAdmin: true }),
    permissions: { admin: isAdmin, agent: isAgentRole },
    branding: settings.branding,
    features: {
      realtime: true,
      uploads: cloudinaryConfigured(),
      support: settings.widget.enabled,
    },
    limits: {
      maxMessageChars: config.limits.maxMessageChars,
      maxGroupMembers: config.limits.maxGroupMembers,
      maxFileBytes: config.limits.maxFileBytes,
      allowedMime: config.limits.allowedMime,
      pollMaxOptions: config.limits.pollMaxOptions,
      forwardMaxTargets: config.limits.forwardMaxTargets,
    },
    commandRules: settings.commandRules.filter((r) => r.enabled),
    unreadTotal,
    nicknames: Object.fromEntries(nicknames.map((n) => [String(n.targetId), n.nickname])),
    blockedUserIds: blocks.map((b) => b.blockedId),
    serverTime: now,
  });
};

// Bù dữ liệu sau khi mất kết nối: hội thoại và tin nhắn thay đổi sau `since`.
export const sync = async (req, res) => {
  const me = req.user._id;
  const since = new Date(String(req.query.since ?? ""));
  if (Number.isNaN(since.getTime())) throw Errors.badCursor("since must be an ISO date");
  const limit = parseLimit(req.query.limit, 200, 500);
  const until = new Date();

  const convs = await Conversation.find({ memberIds: me, syncAt: { $gt: since, $lte: until } })
    .sort({ syncAt: 1 })
    .limit(limit + 1);
  const hasMoreConvs = convs.length > limit;
  const page = convs.slice(0, limit);

  const floors = new Map(
    page.map((c) => [String(c._id), c.members.find((m) => sameId(m.userId, me))?.historyFromSeq || 0])
  );
  const messages = page.length
    ? await Message.find({
        conversationId: { $in: page.map((c) => c._id) },
        updatedAt: { $gt: since, $lte: until },
        hiddenFor: { $ne: me },
      })
        .sort({ updatedAt: 1 })
        .limit(limit + 1)
    : [];
  const hasMoreMessages = messages.length > limit;
  const visible = messages.slice(0, limit).filter((m) => m.seq >= floors.get(String(m.conversationId)));

  res.status(200).json({
    conversations: await toConversations(page, me),
    messages: await toMessages(visible, me),
    until,
    hasMore: hasMoreConvs || hasMoreMessages,
  });
};

// Tìm người dùng (tài khoản đăng ký, đang active). q khớp đầu một từ trong tên (không dấu) hoặc đầu email.
export const searchUsers = async (req, res) => {
  const limit = parseLimit(req.query.limit, 50, 200);
  const filter = { kind: "user", status: { $ne: "inactive" } };
  const q = String(req.query.q ?? "").trim();
  if (q) {
    const nq = escapeRegex(normalizeName(q));
    filter.$or = [
      { nameSearch: { $regex: `(^|\\s)${nq}` } },
      { email: { $regex: `^${escapeRegex(q.toLowerCase())}` } },
    ];
  }
  if (req.query.cursor) filter._id = { $gt: toObjectId(req.query.cursor, Errors.badCursor) };
  if (req.query.excludeMe !== "false") filter._id = { ...(filter._id ?? {}), $ne: req.user._id };

  const users = await User.find(filter).sort({ _id: 1 }).limit(limit + 1).lean();
  const hasMore = users.length > limit;
  const items = users.slice(0, limit);
  const includeEmail = await can(req.user, "admin:principals", "read");
  res.status(200).json({
    items: items.map((u) => ({ ...userProfile(u, { includeEmail }), online: isOnline(u._id) })),
    nextCursor: hasMore ? String(items[items.length - 1]._id) : null,
    hasMore,
  });
};

export const getUser = async (req, res) => {
  const user = await User.findById(toObjectId(req.params.id, Errors.userNotFound)).lean();
  if (!user) throw Errors.userNotFound();
  const includeEmail = await can(req.user, "admin:principals", "read");
  res.status(200).json({ ...userProfile(user, { includeEmail }), online: isOnline(user._id) });
};
