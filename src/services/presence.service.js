// Presence trong bộ nhớ process: online khi còn ít nhất một socket kết nối hoặc một thiết bị
// gửi heartbeat chưa quá PRESENCE_TTL. Chạy một instance; scale nhiều instance cần chuyển sang Redis.

import { config } from "../config.js";
import Conversation from "../models/conversation.model.js";
import User from "../models/user.model.js";
import { Block } from "../models/social.model.js";
import { realtime } from "./realtime.service.js";

const state = new Map(); // userId -> { sockets:Set, devices:Map<deviceId, expiresAtMs>, kind, online }

const entry = (userId, kind) => {
  let e = state.get(userId);
  if (!e) {
    e = { sockets: new Set(), devices: new Map(), kind: kind ?? "user", online: false };
    state.set(userId, e);
  }
  if (kind) e.kind = kind;
  return e;
};

const alive = (e, now = Date.now()) => e.sockets.size > 0 || [...e.devices.values()].some((exp) => exp > now);

export const isOnline = (userId) => {
  const e = state.get(String(userId));
  return !!e && alive(e);
};

// Danh sách cho sự kiện cũ `getOnlineUsers` (chỉ tài khoản đăng ký).
export const onlineUserIds = () =>
  [...state.entries()].filter(([, e]) => e.kind === "user" && alive(e)).map(([id]) => id);

// Contact = thành viên các hội thoại chung, bỏ cặp đã chặn nhau.
async function contactsOf(userId) {
  const ids = await Conversation.distinct("memberIds", { memberIds: userId });
  const others = ids.map(String).filter((id) => id !== userId);
  if (!others.length) return [];
  const blocks = await Block.find({
    $or: [{ blockerId: userId }, { blockedId: userId }],
  }).lean();
  const blocked = new Set(blocks.map((b) => String(String(b.blockerId) === userId ? b.blockedId : b.blockerId)));
  return others.filter((id) => !blocked.has(id)).slice(0, 500);
}

async function announce(userId, online) {
  try {
    const at = new Date();
    await User.updateOne({ _id: userId }, { $set: { lastSeenAt: at } });
    const contacts = await contactsOf(userId);
    realtime.toUsers(contacts, online ? "user.online" : "user.offline", { userId, at });
    realtime.toMembers("getOnlineUsers", onlineUserIds());
  } catch (error) {
    console.log("Error announcing presence", error.message);
  }
}

function refresh(userId, e) {
  const now = alive(e);
  if (now && !e.online) {
    e.online = true;
    announce(userId, true);
  } else if (!now && e.online) {
    e.online = false;
    state.delete(userId);
    announce(userId, false);
  } else if (!now) {
    state.delete(userId);
  }
}

export function socketConnected(userId, socketId, kind) {
  const e = entry(String(userId), kind);
  e.sockets.add(socketId);
  refresh(String(userId), e);
}

export function socketDisconnected(userId, socketId) {
  const e = state.get(String(userId));
  if (!e) return;
  e.sockets.delete(socketId);
  refresh(String(userId), e);
}

export function heartbeat(userId, deviceId, kind) {
  const e = entry(String(userId), kind);
  e.devices.set(String(deviceId), Date.now() + config.presenceTtlMs);
  refresh(String(userId), e);
}

export function removeDevice(userId, deviceId) {
  const e = state.get(String(userId));
  if (!e) return;
  e.devices.delete(String(deviceId));
  refresh(String(userId), e);
}

// Sweeper: dọn heartbeat hết hạn và phát user.offline.
export function sweepPresence() {
  const now = Date.now();
  for (const [userId, e] of state) {
    for (const [deviceId, exp] of e.devices) if (exp <= now) e.devices.delete(deviceId);
    refresh(userId, e);
  }
}

export async function presenceSnapshot(userIds) {
  const users = await User.find({ _id: { $in: userIds } }).select("lastSeenAt").lean();
  return users.map((u) => ({
    userId: String(u._id),
    online: isOnline(u._id),
    lastSeenAt: u.lastSeenAt ?? null,
  }));
}

export function resetPresence() {
  state.clear();
}
