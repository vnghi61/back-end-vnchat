// Truy cập hội thoại: kiểm tra thành viên / quyền xem, chặn người dùng, tạo direct.

import Conversation from "../models/conversation.model.js";
import { Block } from "../models/social.model.js";
import User from "../models/user.model.js";
import { Errors } from "../lib/errors.js";
import { isAgent } from "../lib/permissions.js";
import { sameId, toObjectId } from "../lib/validate.js";

export const getMember = (conv, userId) => conv.members.find((m) => sameId(m.userId, userId));

export const isOwnerOrAdmin = (member) => member?.role === "owner" || member?.role === "admin";

export async function loadConversation(id) {
  const conv = await Conversation.findById(toObjectId(id, Errors.conversationNotFound));
  if (!conv) throw Errors.conversationNotFound();
  return conv;
}

// Đọc: thành viên, hoặc agent/admin với hội thoại support (kể cả chưa được gán).
export async function loadForRead(id, user) {
  const conv = await loadConversation(id);
  const member = getMember(conv, user._id);
  if (member) return { conv, member };
  if (conv.kind === "support" && (await isAgent(user))) return { conv, member: null };
  throw Errors.notMember();
}

export async function loadForMember(id, user) {
  const conv = await loadConversation(id);
  const member = getMember(conv, user._id);
  if (!member) throw Errors.notMember();
  return { conv, member };
}

export const historyFloor = (member) => member?.historyFromSeq || 0;

export async function isBlockedEither(a, b) {
  return !!(await Block.exists({
    $or: [
      { blockerId: a, blockedId: b },
      { blockerId: b, blockedId: a },
    ],
  }));
}

export async function assertNotBlocked(a, b) {
  if (await isBlockedEither(a, b)) throw Errors.blocked();
}

export const directPeerId = (conv, userId) => conv.memberIds.find((id) => !sameId(id, userId));

// Direct giữa hai người là duy nhất (directKey unique). Trả { conv, created }.
export async function findOrCreateDirect(meId, otherId) {
  if (sameId(meId, otherId)) throw Errors.directSelf();
  const other = await User.findById(otherId).select("kind status").lean();
  if (!other || other.kind !== "user") throw Errors.userNotFound();
  if (other.status === "inactive") throw Errors.userNotFound("account is inactive");

  const [a, b] = [String(meId), String(otherId)].sort();
  const directKey = `${a}:${b}`;
  const existing = await Conversation.findOne({ directKey });
  if (existing) return { conv: existing, created: false };

  await assertNotBlocked(meId, otherId);
  const now = new Date();
  try {
    const conv = await Conversation.create({
      kind: "direct",
      directKey,
      members: [
        { userId: meId, role: "member", joinedAt: now },
        { userId: otherId, role: "member", joinedAt: now },
      ],
      memberIds: [meId, otherId],
      createdBy: meId,
    });
    return { conv, created: true };
  } catch (error) {
    if (error?.code === 11000) {
      const conv = await Conversation.findOne({ directKey });
      if (conv) return { conv, created: false };
    }
    throw error;
  }
}

export async function touchSync(conversationId) {
  await Conversation.updateOne({ _id: conversationId }, { $set: { syncAt: new Date() } });
}
