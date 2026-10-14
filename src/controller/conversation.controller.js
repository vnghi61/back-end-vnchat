import { config } from "../config.js";
import Conversation, { MUTED_FOREVER } from "../models/conversation.model.js";
import User from "../models/user.model.js";
import { Errors } from "../lib/errors.js";
import { afterTimeIdDesc, encodeTimeId, parseLimit } from "../lib/cursor.js";
import { conversationPrefs, loadUsers, toConversation, toConversations, userBrief } from "../lib/serializers.js";
import { httpUrl, imageDataUri, objectId, parse, sameId, toObjectId, z } from "../lib/validate.js";
import {
  assertNotBlocked,
  findOrCreateDirect,
  getMember,
  isOwnerOrAdmin,
  loadConversation,
  loadForMember,
  loadForRead,
} from "../services/conversation.service.js";
import { postSystemMessage, uploadDataUri } from "../services/message.service.js";
import { isOnline } from "../services/presence.service.js";
import { realtime } from "../services/realtime.service.js";
import { dispatch } from "../services/webhook.service.js";

const ROLE_ORDER = { owner: 0, admin: 1, agent: 2, member: 3, bot: 4 };

async function emitNewConversation(conv) {
  const fresh = await Conversation.findById(conv._id);
  const users = await loadUsers(fresh.memberIds);
  realtime.joinConversation(fresh.memberIds, fresh._id);
  for (const id of fresh.memberIds) {
    const [payload] = await toConversations([fresh], id, { users });
    realtime.toUser(id, "conversation.new", payload);
  }
  return fresh;
}

async function emitConversationUpdated(conversationId) {
  const fresh = await Conversation.findById(conversationId);
  realtime.toConversation(conversationId, "conversation.updated", await toConversation(fresh, null));
  return fresh;
}

// GET /api/conversations?kind&archived&pinned&cursor&limit
export const listConversations = async (req, res) => {
  const me = req.user._id;
  const limit = parseLimit(req.query.limit, 30, 100);
  const filter = { memberIds: me };
  if (req.query.kind) {
    if (!["direct", "group", "support"].includes(req.query.kind)) throw Errors.validation("kind is invalid");
    filter.kind = req.query.kind;
  }

  if (req.query.pinned === "true") {
    filter.members = { $elemMatch: { userId: me, pinnedAt: { $ne: null } } };
    const convs = await Conversation.find(filter).limit(config.limits.pinnedConversationsMax);
    const items = await toConversations(convs, me);
    items.sort((a, b) => new Date(b.pinnedAt) - new Date(a.pinnedAt));
    return res.status(200).json({ items, nextCursor: null, hasMore: false });
  }

  const archived = req.query.archived === "true";
  filter.members = { $elemMatch: { userId: me, archivedAt: archived ? { $ne: null } : null } };
  if (req.query.cursor) Object.assign(filter, afterTimeIdDesc("updatedAt", req.query.cursor));

  const convs = await Conversation.find(filter).sort({ updatedAt: -1, _id: -1 }).limit(limit + 1);
  const hasMore = convs.length > limit;
  const page = convs.slice(0, limit);
  const last = page[page.length - 1];
  res.status(200).json({
    items: await toConversations(page, me),
    nextCursor: hasMore ? encodeTimeId(last.updatedAt, last._id) : null,
    hasMore,
  });
};

export const getConversation = async (req, res) => {
  const { conv } = await loadForRead(req.params.id, req.user);
  res.status(200).json(await toConversation(conv, req.user._id));
};

export const listMembers = async (req, res) => {
  const { conv } = await loadForRead(req.params.id, req.user);
  const users = await loadUsers(conv.memberIds);
  const items = [...conv.members]
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.joinedAt - b.joinedAt)
    .map((m) => ({
      user: userBrief(users.get(String(m.userId))) ?? { _id: m.userId },
      role: m.role,
      joinedAt: m.joinedAt,
      lastReadSeq: m.lastReadSeq ?? 0,
      online: isOnline(m.userId),
    }));
  res.status(200).json(items);
};

// POST /api/conversations/direct { userId } – 201 tạo mới / 200 đã có
export const createDirect = async (req, res) => {
  const body = parse(z.object({ userId: objectId }), req.body);
  const { conv, created } = await findOrCreateDirect(req.user._id, toObjectId(body.userId));
  if (created) await emitNewConversation(conv);
  res.status(created ? 201 : 200).json(await toConversation(conv, req.user._id));
};

const groupSchema = z.object({
  title: z.string().trim().min(1).max(100),
  avatarUrl: httpUrl.optional(),
  avatar: imageDataUri.optional(),
  memberIds: z.array(objectId).min(1).max(1000),
  historyVisibility: z.enum(["all", "since_join"]).optional(),
});

async function loadAddableUsers(actorId, ids) {
  const users = await User.find({ _id: { $in: ids } }).select("kind status").lean();
  if (users.length !== ids.length || users.some((u) => u.kind !== "user" || u.status === "inactive")) {
    throw Errors.userNotFound("one or more members do not exist");
  }
  for (const id of ids) await assertNotBlocked(actorId, id);
}

export const createGroup = async (req, res) => {
  const body = parse(groupSchema, req.body);
  const me = req.user._id;
  const ids = [...new Set(body.memberIds)].filter((id) => !sameId(id, me)).map((id) => toObjectId(id));
  if (ids.length + 1 > config.limits.maxGroupMembers) throw Errors.groupTooLarge();
  await loadAddableUsers(me, ids);

  const avatarUrl = body.avatar ? (await uploadDataUri(body.avatar, me)).url : body.avatarUrl ?? "";
  const now = new Date();
  const conv = await Conversation.create({
    kind: "group",
    title: body.title,
    avatarUrl,
    historyVisibility: body.historyVisibility ?? "all",
    members: [
      { userId: me, role: "owner", joinedAt: now },
      ...ids.map((id) => ({ userId: id, role: "member", joinedAt: now })),
    ],
    memberIds: [me, ...ids],
    createdBy: me,
  });

  await emitNewConversation(conv);
  await postSystemMessage(conv, me, "group.created", { title: body.title });
  const payload = await toConversation(await Conversation.findById(conv._id), me);
  dispatch("conversation.created", { conversation: payload });
  res.status(201).json(payload);
};

const updateSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  avatarUrl: httpUrl.or(z.literal("")).optional(),
  avatar: imageDataUri.optional(),
  historyVisibility: z.enum(["all", "since_join"]).optional(),
});

export const updateConversation = async (req, res) => {
  const body = parse(updateSchema, req.body);
  const { conv, member } = await loadForMember(req.params.id, req.user);
  if (conv.kind !== "group") throw Errors.directImmutable();
  if (!isOwnerOrAdmin(member)) throw Errors.ownerAdminOnly();

  const $set = {};
  const events = [];
  if (body.title !== undefined && body.title !== conv.title) {
    $set.title = body.title;
    events.push(["group.renamed", { title: body.title }]);
  }
  const avatarUrl = body.avatar ? (await uploadDataUri(body.avatar, req.user._id)).url : body.avatarUrl;
  if (avatarUrl !== undefined && avatarUrl !== conv.avatarUrl) {
    $set.avatarUrl = avatarUrl;
    events.push(["group.avatar_changed", { avatarUrl }]);
  }
  if (body.historyVisibility && body.historyVisibility !== conv.historyVisibility) {
    $set.historyVisibility = body.historyVisibility;
    events.push(["group.history_visibility", { historyVisibility: body.historyVisibility }]);
  }
  if (events.length) {
    $set.syncAt = new Date();
    await Conversation.updateOne({ _id: conv._id }, { $set });
    for (const [kind, meta] of events) await postSystemMessage(conv, req.user._id, kind, meta);
  }
  const fresh = await emitConversationUpdated(conv._id);
  res.status(200).json(await toConversation(fresh, req.user._id));
};

export const addMembers = async (req, res) => {
  const body = parse(z.object({ memberIds: z.array(objectId).min(1).max(500) }), req.body);
  const { conv, member } = await loadForMember(req.params.id, req.user);
  if (conv.kind !== "group") throw Errors.directImmutable();
  if (!isOwnerOrAdmin(member)) throw Errors.ownerAdminOnly();

  const ids = [...new Set(body.memberIds)].map((id) => toObjectId(id));
  if (ids.some((id) => conv.memberIds.some((m) => sameId(m, id)))) throw Errors.alreadyMember();
  await loadAddableUsers(req.user._id, ids);

  // Một lệnh nguyên tử: guard chưa là thành viên + giới hạn số người; lastReadSeq/historyFromSeq
  // lấy từ lastSeq ngay trong lệnh nên tin gửi đồng thời không lọt.
  const now = new Date();
  const result = await Conversation.collection.updateOne(
    {
      _id: conv._id,
      memberIds: { $nin: ids },
      $expr: { $lte: [{ $add: [{ $size: "$memberIds" }, ids.length] }, config.limits.maxGroupMembers] },
    },
    [
      {
        $set: {
          members: {
            $concatArrays: [
              "$members",
              ids.map((id) => ({
                userId: id,
                role: "member",
                joinedAt: now,
                lastReadSeq: "$lastSeq",
                historyFromSeq: { $cond: [{ $eq: ["$historyVisibility", "since_join"] }, { $add: ["$lastSeq", 1] }, 0] },
                mutedUntil: null,
                archivedAt: null,
                pinnedAt: null,
              })),
            ],
          },
          memberIds: { $concatArrays: ["$memberIds", ids] },
          syncAt: "$$NOW",
          updatedAt: "$$NOW",
        },
      },
    ]
  );
  if (!result.matchedCount) {
    const fresh = await loadConversation(conv._id);
    if (ids.some((id) => fresh.memberIds.some((m) => sameId(m, id)))) throw Errors.alreadyMember();
    throw Errors.groupTooLarge();
  }

  const fresh = await Conversation.findById(conv._id);
  realtime.joinConversation(ids, conv._id);
  const payload = await toConversation(fresh, null);
  realtime.toConversationAndUsers(conv._id, ids, "conversation.member.added", {
    conversationId: conv._id,
    memberIds: ids,
    conversation: payload,
  });
  await postSystemMessage(fresh, req.user._id, "member.added", { memberIds: ids });
  res.status(200).json(await toConversation(await Conversation.findById(conv._id), req.user._id));
};

async function removeMemberFrom(conv, userId) {
  await Conversation.updateOne(
    { _id: conv._id },
    { $pull: { members: { userId }, memberIds: userId }, $set: { syncAt: new Date() } }
  );
  realtime.toConversationAndUsers(conv._id, [userId], "conversation.member.removed", {
    conversationId: conv._id,
    memberId: userId,
  });
  realtime.leaveConversation([userId], conv._id);
}

const ownersCount = (conv) => conv.members.filter((m) => m.role === "owner").length;

export const removeMember = async (req, res) => {
  const { conv, member } = await loadForMember(req.params.id, req.user);
  if (conv.kind !== "group") throw Errors.directImmutable();
  if (!isOwnerOrAdmin(member)) throw Errors.ownerAdminOnly();
  const targetId = toObjectId(req.params.userId, Errors.userNotFound);
  const target = getMember(conv, targetId);
  if (!target) throw Errors.notMember("target is not a member");
  if (target.role === "owner") {
    if (member.role !== "owner") throw Errors.ownerAdminOnly("only an owner can remove an owner");
    if (ownersCount(conv) <= 1) throw Errors.lastOwner();
  }
  await removeMemberFrom(conv, targetId);
  await postSystemMessage(conv, req.user._id, "member.removed", { memberId: targetId });
  res.status(204).end();
};

export const updateMemberRole = async (req, res) => {
  const body = parse(z.object({ role: z.enum(["owner", "admin", "member"]) }), req.body);
  const { conv, member } = await loadForMember(req.params.id, req.user);
  if (conv.kind !== "group") throw Errors.directImmutable();
  if (member.role !== "owner") throw Errors.ownerAdminOnly("only an owner can change roles");
  const targetId = toObjectId(req.params.userId, Errors.userNotFound);
  const target = getMember(conv, targetId);
  if (!target) throw Errors.notMember("target is not a member");
  if (target.role === body.role) return res.status(204).end();
  if (target.role === "owner" && ownersCount(conv) <= 1) throw Errors.lastOwner();

  await Conversation.updateOne(
    { _id: conv._id },
    { $set: { "members.$[t].role": body.role, syncAt: new Date() } },
    { arrayFilters: [{ "t.userId": targetId }] }
  );
  const data = { conversationId: conv._id, memberId: targetId, role: body.role };
  realtime.toConversationAndUsers(conv._id, [targetId], "conversation.updated", data);
  await postSystemMessage(conv, req.user._id, "member.role_changed", {
    memberId: targetId,
    role: body.role,
    previousRole: target.role,
  });
  res.status(204).end();
};

export const leaveConversation = async (req, res) => {
  const { conv, member } = await loadForMember(req.params.id, req.user);
  if (conv.kind !== "group") throw Errors.directImmutable();
  if (member.role === "owner" && ownersCount(conv) <= 1 && conv.members.length > 1) throw Errors.lastOwner();
  await removeMemberFrom(conv, req.user._id);
  if (conv.members.length > 1) await postSystemMessage(conv, req.user._id, "member.left", { memberId: req.user._id });
  res.status(204).end();
};

// POST /api/conversations/:id/read { seq? } – mặc định đọc tới tin cuối.
export const markRead = async (req, res) => {
  const body = parse(z.object({ seq: z.number().int().min(0).optional() }), req.body);
  const { conv, member } = await loadForRead(req.params.id, req.user);
  if (!member) return res.status(204).end();
  const seq = Math.min(body.seq ?? conv.lastSeq, conv.lastSeq);
  if (seq > (member.lastReadSeq ?? 0)) {
    const result = await Conversation.updateOne(
      { _id: conv._id },
      { $max: { "members.$[me].lastReadSeq": seq } },
      { arrayFilters: [{ "me.userId": req.user._id }], timestamps: false }
    );
    if (result.modifiedCount) {
      realtime.toConversation(conv._id, "read.updated", { conversationId: conv._id, userId: req.user._id, seq });
    }
  }
  res.status(204).end();
};

async function updatePrefs(req, res, $set) {
  const { conv } = await loadForMember(req.params.id, req.user);
  await Conversation.updateOne(
    { _id: conv._id },
    { $set: { ...$set, syncAt: new Date() } },
    { arrayFilters: [{ "me.userId": req.user._id }], timestamps: false }
  );
  const fresh = await Conversation.findById(conv._id);
  const prefs = conversationPrefs(conv._id, getMember(fresh, req.user._id));
  realtime.toUser(req.user._id, "conversation.updated", prefs);
  res.status(200).json(prefs);
}

// { minutes }: 0 = bỏ tắt thông báo, -1 hoặc > 10 năm = vô thời hạn.
export const muteConversation = async (req, res) => {
  const { minutes } = parse(z.object({ minutes: z.number().int().min(-1) }), req.body);
  let mutedUntil = null;
  if (minutes === -1 || minutes > 10 * 365 * 24 * 60) mutedUntil = MUTED_FOREVER;
  else if (minutes > 0) mutedUntil = new Date(Date.now() + minutes * 60_000);
  await updatePrefs(req, res, { "members.$[me].mutedUntil": mutedUntil });
};

export const archiveConversation = async (req, res) => {
  const { archived } = parse(z.object({ archived: z.boolean() }), req.body);
  await updatePrefs(req, res, { "members.$[me].archivedAt": archived ? new Date() : null });
};

export const pinConversation = async (req, res) => {
  const { pinned } = parse(z.object({ pinned: z.boolean() }), req.body);
  if (pinned) {
    const count = await Conversation.countDocuments({
      members: { $elemMatch: { userId: req.user._id, pinnedAt: { $ne: null } } },
      _id: { $ne: toObjectId(req.params.id, Errors.conversationNotFound) },
    });
    if (count >= config.limits.pinnedConversationsMax) throw Errors.conflict("pinned conversation limit reached");
  }
  const { conv } = await loadForMember(req.params.id, req.user);
  const current = getMember(conv, req.user._id);
  const pinnedAt = pinned ? current.pinnedAt ?? new Date() : null;
  await updatePrefs(req, res, { "members.$[me].pinnedAt": pinnedAt });
};
