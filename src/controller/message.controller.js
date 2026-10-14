
import { config } from "../config.js";
import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import Poll from "../models/poll.model.js";
import { AppError, Errors } from "../lib/errors.js";
import { afterTimeIdDesc, decodeSeq, encodeSeq, encodeTimeId, parseLimit } from "../lib/cursor.js";
import { toMessage, toMessages } from "../lib/serializers.js";
import { charLength, computeMediaKinds, extractLinks, parseCommand } from "../lib/text.js";
import { objectId, parse, sameId, toObjectId, z } from "../lib/validate.js";
import {
  findOrCreateDirect,
  historyFloor,
  isOwnerOrAdmin,
  loadForMember,
  loadForRead,
  touchSync,
} from "../services/conversation.service.js";
import { refreshLastMessage, sendMessage as sendMessageCore } from "../services/message.service.js";
import { realtime } from "../services/realtime.service.js";
import { getSettings } from "../services/settings.service.js";
import { setTyping } from "../services/typing.service.js";

// ======================= API cũ (giữ tương thích client hiện tại) =======================

export const getUsersForSidebar = async (req, res) => {
  const loggedInUserId = req.user._id;
  const filteredUsers = await User.find({
    _id: { $ne: loggedInUserId },
    kind: "user",
    status: { $ne: "inactive" },
  }).select("-password -nameSearch");

  res.status(200).json(filteredUsers);
};

// GET /api/messages/:id – toàn bộ tin nhắn 1-1 với người dùng :id (cũ → mới).
export const getMessages = async (req, res) => {
  const myId = req.user._id;
  const userToChatId = toObjectId(req.params.id, Errors.userNotFound);
  const [a, b] = [String(myId), String(userToChatId)].sort();
  const conv = await Conversation.findOne({ directKey: `${a}:${b}` });
  if (!conv) return res.status(200).json([]);

  const messages = await Message.find({ conversationId: conv._id, hiddenFor: { $ne: myId } }).sort({ seq: 1 });
  const items = await toMessages(messages, myId);
  res.status(200).json(
    items.map((m) => ({ ...m, receiverId: sameId(m.senderId, myId) ? userToChatId : myId }))
  );
};

// POST /api/messages/send/:id { text, image } – gửi tin 1-1 (tự tạo hội thoại direct).
export const sendMessage = async (req, res) => {
  const { text, image, clientMsgId } = req.body ?? {};
  if ((text != null && typeof text !== "string") || (image != null && typeof image !== "string")) {
    throw Errors.validation("text and image must be strings");
  }
  const receiverId = toObjectId(req.params.id, Errors.userNotFound);
  const { conv, created } = await findOrCreateDirect(req.user._id, receiverId);
  if (created) {
    realtime.joinConversation(conv.memberIds, conv._id);
  }
  const { payload } = await sendMessageCore({
    conv,
    sender: req.user,
    input: { text: text ?? "", image, clientMsgId: typeof clientMsgId === "string" ? clientMsgId : undefined },
  });
  res.status(201).json({ ...payload, receiverId });
};

// ======================= Tin nhắn trong hội thoại =======================

async function loadMessage(req, { member: requireMember = false } = {}) {
  const { conv, member } = requireMember
    ? await loadForMember(req.params.id, req.user)
    : await loadForRead(req.params.id, req.user);
  const message = await Message.findOne({
    _id: toObjectId(req.params.messageId, Errors.messageNotFound),
    conversationId: conv._id,
  });
  if (!message || message.hiddenFor?.some((id) => sameId(id, req.user._id))) throw Errors.messageNotFound();
  if (member && message.seq < historyFloor(member)) throw Errors.beforeHistory();
  return { conv, member, message };
}

// GET /api/conversations/:id/messages?before&after&limit – trang trả về theo thứ tự cũ → mới.
export const listMessages = async (req, res) => {
  const { conv, member } = await loadForRead(req.params.id, req.user);
  const limit = parseLimit(req.query.limit, 50, 200);
  const filter = { conversationId: conv._id, hiddenFor: { $ne: req.user._id } };
  let ascending = false;
  if (req.query.after) {
    filter.seq = { $gt: decodeSeq(req.query.after) };
    ascending = true;
  } else if (req.query.before) {
    filter.seq = { $lt: decodeSeq(req.query.before) };
  }
  const floor = historyFloor(member);
  if (floor) filter.seq = { ...(filter.seq ?? {}), $gte: floor };

  const docs = await Message.find(filter).sort({ seq: ascending ? 1 : -1 }).limit(limit + 1);
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  const nextCursor = hasMore ? encodeSeq(page[page.length - 1].seq) : null;
  if (!ascending) page.reverse();
  res.status(200).json({ items: await toMessages(page, req.user._id), nextCursor, hasMore });
};

const attachmentSchema = z.object({
  data: z.string().startsWith("data:").optional(),
  url: z.string().url().optional(),
  publicId: z.string().max(500).optional(),
  name: z.string().max(255).optional(),
  size: z.number().int().min(0).optional(),
  mime: z.string().max(200).optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
}).refine((a) => a.data || a.url, "attachment needs data or url");

const sendSchema = z.object({
  type: z.enum(["text", "sticker"]).optional(),
  text: z.string().optional(),
  clientMsgId: z.string().trim().min(1).max(100).optional(),
  replyTo: objectId.optional(),
  mentions: z.array(objectId).max(100).optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
  image: z.string().optional(),
  sticker: z.object({ packId: z.string(), stickerId: z.string() }).optional(),
});

export const sendToConversation = async (req, res) => {
  const body = parse(sendSchema, req.body);
  const { conv } = await loadForMember(req.params.id, req.user);
  const { payload, created } = await sendMessageCore({ conv, sender: req.user, input: body });
  res.status(created ? 201 : 200).json(payload);
};

export const getMessage = async (req, res) => {
  const { message } = await loadMessage(req);
  res.status(200).json(await toMessage(message, req.user._id));
};

export const editMessage = async (req, res) => {
  const { text } = parse(z.object({ text: z.string() }), req.body);
  const { conv, message } = await loadMessage(req, { member: true });
  if (!sameId(message.senderId, req.user._id)) throw Errors.senderOnly();
  if (message.deletedAt) throw Errors.messageDeleted();
  if (!["text", "command", "file"].includes(message.type)) throw Errors.validation("this message type cannot be edited");
  if (conv.kind === "support" && conv.support?.status === "closed") throw Errors.conversationClosed();
  if (charLength(text) > config.limits.maxMessageChars) throw Errors.messageTooLong();
  if (!text.trim() && !message.attachments?.length && !message.image) throw Errors.messageEmpty();

  const links = extractLinks(text);
  const mediaKinds = computeMediaKinds(message.attachments ?? [], links);
  const $set = { text, editedAt: new Date() };
  const $unset = {};
  if (links.length) $set.links = links;
  else $unset.links = "";
  if (mediaKinds.length) $set.mediaKinds = mediaKinds;
  else $unset.mediaKinds = "";
  if (message.type !== "file") {
    const { commandRules } = await getSettings();
    const parsed = parseCommand(text, commandRules);
    $set.type = parsed ? "command" : "text";
    if (parsed) $set.command = { ...parsed, mentions: message.mentions ?? [] };
    else $unset.command = "";
  }

  const updated = await Message.findByIdAndUpdate(message._id, { $set, $unset }, { new: true });
  await touchSync(conv._id);
  await refreshLastMessage(conv, updated);
  const payload = await toMessage(updated, req.user._id);
  realtime.toConversation(conv._id, "message.updated", payload);
  res.status(200).json(payload);
};

export const deleteMessage = async (req, res) => {
  const { conv, member, message } = await loadMessage(req, { member: true });
  const isSender = sameId(message.senderId, req.user._id);
  if (!isSender && !(conv.kind === "group" && isOwnerOrAdmin(member))) throw Errors.senderOnly();
  if (message.deletedAt) throw Errors.messageDeleted();
  if (message.type === "system") throw Errors.validation("system messages cannot be deleted");

  const now = new Date();
  const updated = await Message.findByIdAndUpdate(
    message._id,
    {
      $set: { text: "", deletedAt: now, deletedBy: req.user._id },
      $unset: {
        attachments: "",
        image: "",
        command: "",
        reactions: "",
        pinnedAt: "",
        pinnedBy: "",
        links: "",
        mediaKinds: "",
        sticker: "",
        mentions: "",
      },
    },
    { new: true }
  );
  if (message.pollId) {
    await Poll.updateOne({ _id: message.pollId, status: "open" }, { $set: { status: "closed", closedAt: now, closedBy: req.user._id } });
  }
  await touchSync(conv._id);
  await refreshLastMessage(conv, updated);
  realtime.toConversation(conv._id, "message.deleted", {
    conversationId: conv._id,
    messageId: message._id,
    seq: message.seq,
    deletedBy: req.user._id,
  });
  res.status(204).end();
};

// ---------- reaction ----------

const emojiSchema = z
  .string()
  .min(1)
  .max(32)
  .refine((e) => !/[\s\p{Cc}]/u.test(e), "emoji must not contain whitespace or control characters");

export const addReaction = async (req, res) => {
  const { emoji } = parse(z.object({ emoji: emojiSchema }), req.body);
  const { conv, message } = await loadMessage(req, { member: true });
  if (message.deletedAt) throw Errors.messageDeleted();
  const me = req.user._id;

  let changed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await Message.updateOne(
      { _id: message._id, deletedAt: null, "reactions.emoji": emoji },
      { $addToSet: { "reactions.$.userIds": me } }
    );
    if (existing.matchedCount) {
      changed = existing.modifiedCount > 0;
      break;
    }
    const added = await Message.updateOne(
      {
        _id: message._id,
        deletedAt: null,
        "reactions.emoji": { $ne: emoji },
        $expr: { $lt: [{ $size: { $ifNull: ["$reactions", []] } }, config.limits.reactionMaxEmoji] },
      },
      { $push: { reactions: { emoji, userIds: [me] } } }
    );
    if (added.modifiedCount) {
      changed = true;
      break;
    }
    const fresh = await Message.findById(message._id).lean();
    if (fresh.deletedAt) throw Errors.messageDeleted();
    if (!fresh.reactions?.some((r) => r.emoji === emoji) && (fresh.reactions?.length ?? 0) >= config.limits.reactionMaxEmoji) {
      throw Errors.reactionsFull();
    }
  }

  const updated = await Message.findById(message._id);
  const payload = await toMessage(updated, me);
  if (changed) {
    await touchSync(conv._id);
    realtime.toConversation(conv._id, "reaction.updated", payload);
  }
  res.status(200).json(payload);
};

export const removeReaction = async (req, res) => {
  const emoji = String(req.params.emoji ?? "");
  const { conv, message } = await loadMessage(req, { member: true });
  const me = req.user._id;
  const result = await Message.updateOne(
    { _id: message._id, "reactions.emoji": emoji },
    { $pull: { "reactions.$.userIds": me } }
  );
  if (result.modifiedCount) {
    await Message.updateOne({ _id: message._id }, { $pull: { reactions: { userIds: { $size: 0 } } } });
  }
  const updated = await Message.findById(message._id);
  const payload = await toMessage(updated, me);
  if (result.modifiedCount) {
    await touchSync(conv._id);
    realtime.toConversation(conv._id, "reaction.updated", payload);
  }
  res.status(200).json(payload);
};

export const typing = async (req, res) => {
  const { typing: isTyping } = parse(z.object({ typing: z.boolean() }), req.body);
  await setTyping(req.user, req.params.id, isTyping);
  res.status(204).end();
};

// ---------- ghim ----------

export const pinMessage = async (req, res) => {
  const { conv, message } = await loadMessage(req, { member: true });
  if (message.deletedAt) throw Errors.messageDeleted();
  if (message.pinnedAt) return res.status(200).json(await toMessage(message, req.user._id));
  const count = await Message.countDocuments({ conversationId: conv._id, pinnedAt: { $type: "date" } });
  if (count >= config.limits.pinnedMessagesMax) throw Errors.pinsFull();

  const pinnedAt = new Date();
  const updated = await Message.findOneAndUpdate(
    { _id: message._id, deletedAt: null },
    { $set: { pinnedAt, pinnedBy: req.user._id } },
    { new: true }
  );
  if (!updated) throw Errors.messageDeleted();
  await touchSync(conv._id);
  realtime.toConversation(conv._id, "message.pinned", {
    conversationId: conv._id,
    messageId: message._id,
    by: req.user._id,
    pinnedAt,
  });
  res.status(200).json(await toMessage(updated, req.user._id));
};

export const unpinMessage = async (req, res) => {
  const { conv, member, message } = await loadMessage(req, { member: true });
  if (!message.pinnedAt) return res.status(204).end();
  if (conv.kind !== "direct" && !isOwnerOrAdmin(member) && !sameId(message.pinnedBy, req.user._id)) {
    throw Errors.ownerAdminOnly("only the owner/admin or the person who pinned can unpin");
  }
  await Message.updateOne({ _id: message._id }, { $unset: { pinnedAt: "", pinnedBy: "" } });
  await touchSync(conv._id);
  realtime.toConversation(conv._id, "message.unpinned", {
    conversationId: conv._id,
    messageId: message._id,
    by: req.user._id,
  });
  res.status(204).end();
};

export const listPins = async (req, res) => {
  const { conv, member } = await loadForRead(req.params.id, req.user);
  const limit = parseLimit(req.query.limit, 50, 100);
  const filter = {
    conversationId: conv._id,
    pinnedAt: { $type: "date" },
    hiddenFor: { $ne: req.user._id },
  };
  const floor = historyFloor(member);
  if (floor) filter.seq = { $gte: floor };
  if (req.query.cursor) Object.assign(filter, afterTimeIdDesc("pinnedAt", req.query.cursor));
  const docs = await Message.find(filter).sort({ pinnedAt: -1, _id: -1 }).limit(limit + 1);
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  res.status(200).json({
    items: await toMessages(page, req.user._id),
    nextCursor: hasMore ? encodeTimeId(last.pinnedAt, last._id) : null,
    hasMore,
  });
};

// ---------- ẩn phía mình ----------

async function setHidden(req, res, hidden) {
  const { conv, message } = await loadMessage(req, { member: true }).catch(async (error) => {
    // bỏ ẩn: tin đang ẩn thì loadMessage báo 404 → đọc trực tiếp
    if (hidden || error.code !== "CHAT-404-003") throw error;
    const { conv: c } = await loadForMember(req.params.id, req.user);
    const m = await Message.findOne({ _id: toObjectId(req.params.messageId, Errors.messageNotFound), conversationId: c._id });
    if (!m) throw error;
    return { conv: c, message: m };
  });
  const update = hidden ? { $addToSet: { hiddenFor: req.user._id } } : { $pull: { hiddenFor: req.user._id } };
  const result = await Message.updateOne({ _id: message._id }, update, { timestamps: false });
  if (result.modifiedCount) {
    realtime.toUser(req.user._id, "message.hidden", { conversationId: conv._id, messageId: message._id, hidden });
  }
  res.status(204).end();
}

export const hideMessage = (req, res) => setHidden(req, res, true);
export const unhideMessage = (req, res) => setHidden(req, res, false);

// ---------- chuyển tiếp ----------

export const forwardMessage = async (req, res) => {
  const body = parse(
    z.object({ conversationIds: z.array(objectId).min(1).max(config.limits.forwardMaxTargets) }),
    req.body
  );
  const { conv, message } = await loadMessage(req);
  if (message.deletedAt) throw Errors.messageDeleted();
  if (!["text", "command", "file", "sticker"].includes(message.type)) {
    throw Errors.validation("only text, file and sticker messages can be forwarded");
  }
  let attachments = message.attachments?.map((a) => (a.toObject ? a.toObject() : a)) ?? [];
  if (!attachments.length && message.image) attachments = [{ url: message.image, kind: "image", mime: "image/*" }];

  const results = [];
  for (const target of [...new Set(body.conversationIds)]) {
    try {
      const { conv: targetConv } = await loadForMember(target, req.user);
      const { payload } = await sendMessageCore({
        conv: targetConv,
        sender: req.user,
        input: {
          type: message.type === "sticker" ? "sticker" : "text",
          text: message.text,
          forwardedFrom: { messageId: message._id, conversationId: conv._id, senderId: message.senderId },
        },
        trusted: { attachments, sticker: message.sticker, image: message.image },
      });
      results.push({ conversationId: target, message: payload });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      results.push({ conversationId: target, error: { code: error.code, message: error.message } });
    }
  }
  if (results.every((r) => r.error)) {
    const first = results[0].error;
    throw new AppError(Number(first.code.split("-")[1]) || 400, first.code, first.message);
  }
  res.status(201).json({ results });
};

// GET /api/conversations/:id/media?kind=image|video|audio|file|link
export const listMedia = async (req, res) => {
  const { conv, member } = await loadForRead(req.params.id, req.user);
  const limit = parseLimit(req.query.limit, 50, 200);
  const kind = req.query.kind;
  if (kind && !["image", "video", "audio", "file", "link"].includes(kind)) throw Errors.validation("kind is invalid");
  const filter = {
    conversationId: conv._id,
    deletedAt: null,
    hiddenFor: { $ne: req.user._id },
    mediaKinds: kind ? kind : { $exists: true, $ne: [] },
  };
  const floor = historyFloor(member);
  if (req.query.cursor || floor) {
    filter.seq = {};
    if (req.query.cursor) filter.seq.$lt = decodeSeq(req.query.cursor);
    if (floor) filter.seq.$gte = floor;
  }
  const docs = await Message.find(filter).sort({ seq: -1 }).limit(limit + 1);
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  res.status(200).json({
    items: await toMessages(page, req.user._id),
    nextCursor: hasMore ? encodeSeq(page[page.length - 1].seq) : null,
    hasMore,
  });
};

// GET /api/messages/search?q&conversationId&senderId&type&from&to&cursor&limit
export const searchMessages = async (req, res) => {
  const me = req.user._id;
  const q = String(req.query.q ?? "").trim();
  const limit = parseLimit(req.query.limit, 30, 100);
  const filter = { deletedAt: null, type: { $ne: "system" }, hiddenFor: { $ne: me } };

  if (req.query.conversationId) {
    const { conv, member } = await loadForRead(req.query.conversationId, req.user);
    filter.conversationId = conv._id;
    if (historyFloor(member)) filter.seq = { $gte: historyFloor(member) };
  } else {
    if (!q) throw Errors.validation("q is required when conversationId is not set", [{ field: "q", message: "required" }]);
    const convs = await Conversation.find({ memberIds: me }).sort({ updatedAt: -1 }).limit(500).select("members").lean();
    const plain = [];
    const floored = [];
    for (const c of convs) {
      const floor = c.members.find((m) => sameId(m.userId, me))?.historyFromSeq || 0;
      if (floor) floored.push({ conversationId: c._id, seq: { $gte: floor } });
      else plain.push(c._id);
    }
    filter.$or = [{ conversationId: { $in: plain } }, ...floored];
  }

  if (q) filter.$text = { $search: q };
  if (req.query.senderId) filter.senderId = toObjectId(req.query.senderId, Errors.badCursor);
  if (req.query.type) filter.type = req.query.type;
  const createdAt = {};
  if (req.query.from) createdAt.$gte = new Date(req.query.from);
  if (req.query.to) createdAt.$lte = new Date(req.query.to);
  if (Object.values(createdAt).some((d) => Number.isNaN(d.getTime()))) throw Errors.validation("from/to must be ISO dates");
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;
  if (req.query.cursor) {
    const after = afterTimeIdDesc("createdAt", req.query.cursor);
    filter.$and = [...(filter.$and ?? []), after];
  }

  const docs = await Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  res.status(200).json({
    items: await toMessages(page, me),
    nextCursor: hasMore ? encodeTimeId(last.createdAt, last._id) : null,
    hasMore,
  });
};

export const listStickers = async (req, res) => {
  const { stickerPacks } = await getSettings();
  res.status(200).json(stickerPacks);
};
