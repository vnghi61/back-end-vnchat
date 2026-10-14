// Gửi tin nhắn: luồng chung cho REST mới, API cũ (/api/messages/send/:id), chuyển tiếp,
// bình chọn, tin hệ thống và API đối tác.

import cloudinary from "../lib/cloudinar.js";
import { config } from "../config.js";
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import { Errors } from "../lib/errors.js";
import { toMessage } from "../lib/serializers.js";
import {
  charLength,
  computeMediaKinds,
  extractLinks,
  mediaKindFromMime,
  messagePreview,
  parseCommand,
} from "../lib/text.js";
import { sameId } from "../lib/validate.js";
import { directPeerId, getMember, historyFloor, isBlockedEither } from "./conversation.service.js";
import { realtime } from "./realtime.service.js";
import { findSticker, getSettings } from "./settings.service.js";
import { dispatch } from "./webhook.service.js";

// ---------- file đính kèm (Cloudinary) ----------

export const cloudinaryConfigured = () =>
  !!(process.env.CLOUDINAR_CLOUD_NAME && process.env.CLOUDINAR_API_KEY && process.env.CLOUDINAR_SECRECT_KEY);

export const userFolder = (userId) => `${config.cloudinaryFolder}/u_${userId}`;

const DATA_URI_RE = /^data:([^;,]+)?((?:;[^;,]+)*?)(;base64)?,/i;

// Upload data URI (base64) lên Cloudinary → attachment.
export async function uploadDataUri(dataUri, userId, { name } = {}) {
  if (!cloudinaryConfigured()) throw Errors.storageUnavailable();
  const m = DATA_URI_RE.exec(dataUri);
  if (!m) throw Errors.validation("attachment data must be a data URI");
  const mime = (m[1] || "application/octet-stream").toLowerCase();
  if (!config.limits.allowedMime.includes(mime)) throw Errors.mimeNotAllowed(mime);
  const approxBytes = Math.floor(((dataUri.length - m[0].length) * 3) / 4);
  if (approxBytes > config.limits.maxFileBytes) throw Errors.fileTooLarge();

  const res = await cloudinary.uploader.upload(dataUri, { folder: userFolder(userId), resource_type: "auto" });
  return {
    url: res.secure_url,
    publicId: res.public_id,
    name: name || res.original_filename || undefined,
    size: res.bytes,
    mime,
    kind: mediaKindFromMime(mime),
    width: res.width,
    height: res.height,
  };
}

// Field `image` của API cũ: data URI hoặc URL ảnh (Cloudinary tự tải về) như trước.
async function uploadLegacyImage(image, userId) {
  if (String(image).startsWith("data:")) return uploadDataUri(image, userId);
  if (!cloudinaryConfigured()) throw Errors.storageUnavailable();
  const res = await cloudinary.uploader.upload(image, { folder: userFolder(userId) });
  return { url: res.secure_url, publicId: res.public_id, size: res.bytes, mime: `image/${res.format}`, kind: "image", width: res.width, height: res.height };
}

// File client đã upload thẳng lên Cloudinary bằng chữ ký của POST /api/files/signature:
// chỉ nhận file nằm trong thư mục riêng của người gửi trên cloud của hệ thống.
function validateAttachmentRef(a, userId) {
  const cloud = process.env.CLOUDINAR_CLOUD_NAME;
  if (!cloud) throw Errors.storageUnavailable();
  let url;
  try {
    url = new URL(a.url);
  } catch {
    throw Errors.validation("attachment url is invalid");
  }
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || !url.pathname.startsWith(`/${cloud}/`)) {
    throw Errors.validation("attachment must be uploaded to this app's Cloudinary account");
  }
  if (!a.publicId || !String(a.publicId).startsWith(`${userFolder(userId)}/`)) {
    throw Errors.validation("attachment publicId is outside your upload folder");
  }
  const mime = String(a.mime ?? "").toLowerCase();
  if (!config.limits.allowedMime.includes(mime)) throw Errors.mimeNotAllowed(mime || "unknown");
  if (a.size != null && a.size > config.limits.maxFileBytes) throw Errors.fileTooLarge();
  return {
    url: url.toString(),
    publicId: a.publicId,
    name: a.name ? String(a.name).replace(/[/\\"]/g, "_").slice(0, 255) : undefined,
    size: a.size,
    mime,
    kind: mediaKindFromMime(mime),
    width: a.width,
    height: a.height,
  };
}

// ---------- seq ----------

// Cấp seq nguyên tử; guard: người gửi còn là thành viên, hội thoại support chưa đóng.
async function allocateSeq(conv, senderId, { system = false } = {}) {
  const filter = { _id: conv._id };
  if (!system) {
    filter.memberIds = senderId;
    if (conv.kind === "support") filter["support.status"] = { $ne: "closed" };
  }
  const now = new Date();
  const updated = await Conversation.findOneAndUpdate(
    filter,
    { $inc: { lastSeq: 1 }, $set: { syncAt: now, updatedAt: now } },
    { new: true, projection: { lastSeq: 1 }, timestamps: false }
  ).lean();
  if (!updated) {
    const fresh = await Conversation.findById(conv._id).select("kind support").lean();
    if (!fresh) throw Errors.conversationNotFound();
    if (fresh.kind === "support" && fresh.support?.status === "closed") throw Errors.conversationClosed();
    throw Errors.notMember();
  }
  conv.lastSeq = updated.lastSeq;
  return updated.lastSeq;
}

// Sau khi ghi tin: cập nhật lastMessage (chỉ khi seq mới hơn), bỏ archive cho mọi thành viên,
// người gửi coi như đã đọc tới tin của mình.
async function afterInsert(conv, message) {
  const lastMessage = {
    id: message._id,
    seq: message.seq,
    senderId: message.senderId,
    type: message.type,
    preview: messagePreview(message),
    deleted: false,
    at: message.createdAt,
  };
  await Conversation.updateOne(
    { _id: conv._id, $or: [{ "lastMessage.seq": { $lt: message.seq } }, { lastMessage: null }] },
    { $set: { lastMessage } },
    { timestamps: false }
  );
  const update = { $set: { "members.$[].archivedAt": null } };
  const options = { timestamps: false };
  if (getMember(conv, message.senderId)) {
    update.$max = { "members.$[s].lastReadSeq": message.seq };
    options.arrayFilters = [{ "s.userId": message.senderId }];
  }
  await Conversation.updateOne({ _id: conv._id }, update, options);
  conv.lastMessage = lastMessage;
}

// Khi sửa/xoá đúng tin đang là lastMessage → dựng lại preview.
export async function refreshLastMessage(conv, message) {
  if (!conv.lastMessage || !sameId(conv.lastMessage.id, message._id)) return;
  await Conversation.updateOne(
    { _id: conv._id, "lastMessage.id": message._id },
    { $set: { "lastMessage.preview": messagePreview(message), "lastMessage.deleted": !!message.deletedAt } },
    { timestamps: false }
  );
}

// ---------- gửi ----------

// input: { text, clientMsgId, replyTo, mentions[], attachments[], image, type, sticker, pollId, forwardedFrom, metadata }
// trusted: nội dung đã kiểm tra từ trước (chuyển tiếp): { attachments, sticker, image }
export async function createMessage({ conv, sender, input, trusted = {} }) {
  const text = String(input.text ?? "");
  if (charLength(text) > config.limits.maxMessageChars) throw Errors.messageTooLong();

  if (input.clientMsgId) {
    const existing = await Message.findOne({ conversationId: conv._id, senderId: sender._id, clientMsgId: input.clientMsgId });
    if (existing) return { message: existing, created: false };
  }

  const member = getMember(conv, sender._id);
  if (!member) throw Errors.notMember();
  if (conv.kind === "support" && conv.support?.status === "closed") throw Errors.conversationClosed();
  if (conv.kind === "direct") {
    const peer = directPeerId(conv, sender._id);
    if (peer && (await isBlockedEither(sender._id, peer))) throw Errors.blocked();
  }

  let replyTo;
  if (input.replyTo) {
    const target = await Message.findOne({
      _id: input.replyTo,
      conversationId: conv._id,
      hiddenFor: { $ne: sender._id },
    })
      .select("seq")
      .lean();
    if (!target || target.seq < historyFloor(member)) throw Errors.messageNotFound("replyTo");
    replyTo = target._id;
  }

  const memberIds = new Set(conv.memberIds.map(String));
  const mentions = [...new Set((input.mentions ?? []).map(String))].filter(
    (id) => memberIds.has(id) && id !== String(sender._id)
  );

  let type = input.type ?? "text";
  let attachments;
  if (trusted.attachments) {
    attachments = trusted.attachments;
  } else {
    attachments = [];
    if (input.image) attachments.push(await uploadLegacyImage(input.image, sender._id));
    for (const a of input.attachments ?? []) {
      attachments.push(a.data ? await uploadDataUri(a.data, sender._id, a) : validateAttachmentRef(a, sender._id));
    }
  }

  let sticker;
  if (type === "sticker") {
    if (trusted.sticker) {
      sticker = trusted.sticker;
    } else {
      const found = await findSticker(input.sticker?.packId, input.sticker?.stickerId);
      if (!found) throw Errors.badSticker();
      sticker = { packId: input.sticker.packId, stickerId: input.sticker.stickerId, emoji: found.emoji, url: found.url };
    }
  }

  let command;
  if (type === "text" && sender.kind !== "bot" && !input.forwardedFrom && text.startsWith("/")) {
    const { commandRules } = await getSettings();
    const parsed = parseCommand(text, commandRules);
    if (parsed) {
      type = "command";
      command = { ...parsed, mentions };
    }
  }
  if (type === "text" && attachments.length) type = "file";

  const hasContent = text.trim().length > 0 || attachments.length > 0 || !!sticker || type === "poll";
  if (!hasContent) throw Errors.messageEmpty();

  const links = extractLinks(text);
  const mediaKinds = computeMediaKinds(attachments, links);

  const seq = await allocateSeq(conv, sender._id);
  let message;
  try {
    message = await Message.create({
      conversationId: conv._id,
      seq,
      senderId: sender._id,
      type,
      text,
      image: trusted.image ?? attachments.find((a) => a.kind === "image")?.url,
      attachments: attachments.length ? attachments : undefined,
      replyTo,
      mentions: mentions.length ? mentions : undefined,
      command,
      sticker,
      pollId: input.pollId,
      forwardedFrom: input.forwardedFrom,
      links: links.length ? links : undefined,
      mediaKinds: mediaKinds.length ? mediaKinds : undefined,
      metadata: input.metadata,
      clientMsgId: input.clientMsgId || undefined,
    });
  } catch (error) {
    if (error?.code === 11000 && input.clientMsgId) {
      const existing = await Message.findOne({ conversationId: conv._id, senderId: sender._id, clientMsgId: input.clientMsgId });
      if (existing) return { message: existing, created: false };
    }
    throw error;
  }
  await afterInsert(conv, message);
  return { message, created: true };
}

// Phát message.new (+ newMessage cho client cũ, cập nhật hàng đợi support) và webhook.
export async function publishMessage(conv, message, { webhook = true } = {}) {
  const payload = await toMessage(message, message.senderId);
  realtime.toConversation(conv._id, "message.new", payload);

  if (conv.kind === "direct") {
    const peer = directPeerId(conv, message.senderId);
    if (peer) realtime.toUser(peer, "newMessage", { ...payload, receiverId: peer });
  }
  if (conv.kind === "support") {
    realtime.toAgents("support.message", {
      conversationId: conv._id,
      status: conv.support?.status,
      assigneeId: conv.support?.assigneeId ?? null,
      message: payload,
    });
  }
  if (webhook && message.type !== "system") {
    if (message.type === "command") {
      await dispatch("chat.command.detected", { message: payload, conversationKind: conv.kind });
    }
    await dispatch("message.created", { message: payload, conversationKind: conv.kind });
  }
  return payload;
}

export async function sendMessage({ conv, sender, input, trusted }) {
  const { message, created } = await createMessage({ conv, sender, input, trusted });
  const payload = created ? await publishMessage(conv, message) : await toMessage(message, sender._id);
  return { message, payload, created };
}

// Tin hệ thống (group.created, member.added, support.assigned...): text = kind, metadata = {kind, ...}.
export async function postSystemMessage(conv, actorId, kind, metadata = {}) {
  const seq = await allocateSeq(conv, actorId, { system: true });
  const message = await Message.create({
    conversationId: conv._id,
    seq,
    senderId: actorId,
    type: "system",
    text: kind,
    metadata: { kind, ...metadata },
  });
  await afterInsert(conv, message);
  await publishMessage(conv, message, { webhook: false });
  return message;
}
