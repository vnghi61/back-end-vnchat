// Chuyển document Mongo → JSON trả cho client (REST, socket, webhook dùng chung một hình dạng).

import { MUTED_FOREVER } from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { sameId } from "./validate.js";

const USER_FIELDS = "name profileImage kind roles status email contactEmail lastSeenAt createdAt";

export const userBrief = (u) =>
  u ? { _id: u._id, name: u.name, profileImage: u.profileImage ?? "", kind: u.kind ?? "user" } : null;

export const userProfile = (u, { includeEmail = false, includeAdmin = false } = {}) => {
  if (!u) return null;
  const out = {
    ...userBrief(u),
    lastSeenAt: u.lastSeenAt ?? null,
    createdAt: u.createdAt,
  };
  if (includeEmail) out.email = u.email ?? u.contactEmail ?? undefined;
  if (includeAdmin) {
    out.roles = u.roles?.length ? u.roles : ["member"];
    out.status = u.status ?? "active";
  }
  return out;
};

export async function loadUsers(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select(USER_FIELDS).lean();
  return new Map(users.map((u) => [String(u._id), u]));
}

// ---------- messages ----------

function baseMessage(m, viewerId) {
  const reactions = (m.reactions ?? [])
    .filter((r) => r.userIds?.length)
    .map((r) => ({
      emoji: r.emoji,
      userIds: r.userIds,
      count: r.userIds.length,
      mine: r.userIds.some((id) => sameId(id, viewerId)),
    }));
  return {
    _id: m._id,
    conversationId: m.conversationId ?? null,
    seq: m.seq ?? null,
    senderId: m.senderId,
    receiverId: m.receiverId ?? undefined,
    type: m.type ?? "text",
    text: m.text ?? "",
    image: m.image ?? undefined,
    attachments: m.attachments ?? [],
    replyTo: m.replyTo ?? null,
    mentions: m.mentions ?? [],
    command: m.command ?? undefined,
    reactions,
    sticker: m.sticker ?? undefined,
    pollId: m.pollId ?? undefined,
    forwardedFrom: m.forwardedFrom ?? undefined,
    links: m.links ?? [],
    metadata: m.metadata ?? undefined,
    clientMsgId: m.clientMsgId ?? undefined,
    editedAt: m.editedAt ?? null,
    deletedAt: m.deletedAt ?? null,
    deletedBy: m.deletedBy ?? undefined,
    pinnedAt: m.pinnedAt ?? null,
    pinnedBy: m.pinnedBy ?? undefined,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

// Gắn `sender` (tên, avatar) và `replyPreview` cho cả trang trong 2 truy vấn.
export async function toMessages(messages, viewerId, { users } = {}) {
  const list = messages.map((m) => (m?.toObject ? m.toObject() : m));
  const replyIds = [...new Set(list.map((m) => m.replyTo).filter(Boolean).map(String))];
  const replies = replyIds.length
    ? await Message.find({ _id: { $in: replyIds } }).select("senderId text type deletedAt attachments sticker image").lean()
    : [];
  const replyMap = new Map(replies.map((r) => [String(r._id), r]));
  const userMap =
    users ?? (await loadUsers([...list.map((m) => m.senderId), ...replies.map((r) => r.senderId)]));

  return list.map((m) => {
    const out = baseMessage(m, viewerId);
    out.sender = userBrief(userMap.get(String(m.senderId)));
    if (m.replyTo) {
      const r = replyMap.get(String(m.replyTo));
      out.replyPreview = r
        ? {
            _id: r._id,
            senderId: r.senderId,
            senderName: userMap.get(String(r.senderId))?.name ?? "",
            type: r.type ?? "text",
            text: r.deletedAt ? "" : [...(r.text ?? "")].slice(0, 200).join(""),
            hasAttachments: !r.deletedAt && !!(r.attachments?.length || r.image),
            deleted: !!r.deletedAt,
          }
        : null;
    }
    return out;
  });
}

export async function toMessage(message, viewerId) {
  const [out] = await toMessages([message], viewerId);
  return out;
}

// ---------- conversations ----------

function memberPrefs(member) {
  if (!member) return { muted: false, pinned: false, archived: false };
  const now = new Date();
  const muted = !!member.mutedUntil && member.mutedUntil > now;
  return {
    muted,
    mutedUntil: muted ? member.mutedUntil : null,
    mutedForever: muted && member.mutedUntil.getTime() >= MUTED_FOREVER.getTime(),
    pinned: !!member.pinnedAt,
    pinnedAt: member.pinnedAt ?? null,
    archived: !!member.archivedAt,
  };
}

export const conversationPrefs = (conversationId, member) => ({ conversationId, ...memberPrefs(member) });

export function unreadOf(conv, member) {
  if (!member) return 0;
  const floor = Math.max(member.lastReadSeq ?? 0, (member.historyFromSeq || 1) - 1);
  return Math.max(0, (conv.lastSeq ?? 0) - floor);
}

export async function toConversations(convs, viewerId, { users } = {}) {
  const list = convs.map((c) => (c?.toObject ? c.toObject() : c));
  const userMap =
    users ??
    (await loadUsers(
      list.flatMap((c) => [
        ...(c.members ?? []).map((m) => m.userId),
        c.support?.assigneeId,
        c.createdBy,
      ])
    ));

  return list.map((c) => {
    const me = (c.members ?? []).find((m) => sameId(m.userId, viewerId));
    const out = {
      _id: c._id,
      kind: c.kind,
      title: c.title ?? "",
      avatarUrl: c.avatarUrl ?? "",
      historyVisibility: c.kind === "group" ? c.historyVisibility ?? "all" : undefined,
      members: (c.members ?? []).map((m) => ({
        user: userBrief(userMap.get(String(m.userId))) ?? { _id: m.userId },
        role: m.role,
        joinedAt: m.joinedAt,
        lastReadSeq: m.lastReadSeq ?? 0,
      })),
      memberCount: c.members?.length ?? 0,
      lastSeq: c.lastSeq ?? 0,
      lastMessage: c.lastMessage ?? null,
      unreadCount: unreadOf(c, me),
      myRole: me?.role ?? null,
      historyFromSeq: me?.historyFromSeq ?? 0,
      ...memberPrefs(me),
      createdBy: c.createdBy ?? null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };

    if (c.kind === "direct") {
      const peer = (c.members ?? []).find((m) => !sameId(m.userId, viewerId)) ?? (c.members ?? [])[0];
      const peerUser = peer ? userMap.get(String(peer.userId)) : null;
      out.peer = userBrief(peerUser);
      if (!out.title) out.title = peerUser?.name ?? "";
      if (!out.avatarUrl) out.avatarUrl = peerUser?.profileImage ?? "";
    }

    if (c.kind === "support" && c.support) {
      const customer = userMap.get(String(c.createdBy));
      out.support = {
        status: c.support.status,
        assignee: userBrief(userMap.get(String(c.support.assigneeId))),
        assigneeId: c.support.assigneeId ?? null,
        customer: customer ? { ...userBrief(customer), contactEmail: customer.contactEmail ?? customer.email } : null,
        tags: c.support.tags ?? [],
        meta: c.support.meta ?? {},
        assignedAt: c.support.assignedAt ?? null,
        closedAt: c.support.closedAt ?? null,
        rating: c.support.rating ?? null,
        ratingNote: c.support.ratingNote ?? null,
      };
      if (!out.title) out.title = customer?.name ? `Hỗ trợ: ${customer.name}` : "Hỗ trợ";
    }
    return out;
  });
}

export async function toConversation(conv, viewerId) {
  const [out] = await toConversations([conv], viewerId);
  return out;
}
