import { Block, Nickname } from "../models/social.model.js";
import User from "../models/user.model.js";
import { Errors } from "../lib/errors.js";
import { parseLimit } from "../lib/cursor.js";
import { loadUsers, userBrief } from "../lib/serializers.js";
import { parse, sameId, toObjectId, z } from "../lib/validate.js";
import { heartbeat, presenceSnapshot, removeDevice } from "../services/presence.service.js";
import { realtime } from "../services/realtime.service.js";

async function loadTarget(id) {
  const targetId = toObjectId(id, Errors.userNotFound);
  const user = await User.findById(targetId).select("name profileImage kind").lean();
  if (!user) throw Errors.userNotFound();
  return user;
}

// ---------- chặn ----------

export const blockUser = async (req, res) => {
  const target = await loadTarget(req.params.userId);
  if (sameId(target._id, req.user._id)) throw Errors.validation("you cannot block yourself");
  try {
    const block = await Block.create({ blockerId: req.user._id, blockedId: target._id });
    realtime.toUser(req.user._id, "block.updated", { userId: target._id, blocked: true });
    res.status(201).json({ user: userBrief(target), blockedAt: block.createdAt });
  } catch (error) {
    if (error?.code === 11000) throw Errors.alreadyBlocked();
    throw error;
  }
};

export const unblockUser = async (req, res) => {
  const targetId = toObjectId(req.params.userId, Errors.userNotFound);
  const result = await Block.deleteOne({ blockerId: req.user._id, blockedId: targetId });
  if (!result.deletedCount) throw Errors.notFound("user is not blocked");
  realtime.toUser(req.user._id, "block.updated", { userId: targetId, blocked: false });
  res.status(204).end();
};

export const listBlocks = async (req, res) => {
  const limit = parseLimit(req.query.limit, 50, 200);
  const filter = { blockerId: req.user._id };
  if (req.query.cursor) filter._id = { $gt: toObjectId(req.query.cursor, Errors.badCursor) };
  const blocks = await Block.find(filter).sort({ _id: 1 }).limit(limit + 1).lean();
  const hasMore = blocks.length > limit;
  const page = blocks.slice(0, limit);
  const users = await loadUsers(page.map((b) => b.blockedId));
  res.status(200).json({
    items: page.map((b) => ({ user: userBrief(users.get(String(b.blockedId))) ?? { _id: b.blockedId }, blockedAt: b.createdAt })),
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    hasMore,
  });
};

// ---------- biệt danh riêng ----------

export const setNickname = async (req, res) => {
  const { nickname } = parse(z.object({ nickname: z.string().trim().min(1).max(64) }), req.body);
  const target = await loadTarget(req.params.id);
  if (sameId(target._id, req.user._id)) throw Errors.validation("you cannot set a nickname for yourself");
  const doc = await Nickname.findOneAndUpdate(
    { ownerId: req.user._id, targetId: target._id },
    { $set: { nickname } },
    { upsert: true, new: true }
  );
  realtime.toUser(req.user._id, "nickname.updated", { userId: target._id, nickname });
  res.status(200).json({ user: userBrief(target), nickname: doc.nickname, updatedAt: doc.updatedAt });
};

export const deleteNickname = async (req, res) => {
  const targetId = toObjectId(req.params.id, Errors.userNotFound);
  const result = await Nickname.deleteOne({ ownerId: req.user._id, targetId });
  if (result.deletedCount) realtime.toUser(req.user._id, "nickname.updated", { userId: targetId, nickname: "" });
  res.status(204).end();
};

export const listNicknames = async (req, res) => {
  const limit = parseLimit(req.query.limit, 100, 500);
  const filter = { ownerId: req.user._id };
  if (req.query.cursor) filter._id = { $gt: toObjectId(req.query.cursor, Errors.badCursor) };
  const docs = await Nickname.find(filter).sort({ _id: 1 }).limit(limit + 1).lean();
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  res.status(200).json({
    items: page.map((n) => ({ userId: n.targetId, nickname: n.nickname, updatedAt: n.updatedAt })),
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    hasMore,
  });
};

// ---------- presence ----------

const deviceSchema = z.object({ deviceId: z.string().trim().min(1).max(100) });

export const presenceHeartbeat = async (req, res) => {
  const { deviceId } = parse(deviceSchema, req.body);
  heartbeat(req.user._id, deviceId, req.user.kind);
  res.status(204).end();
};

export const presenceOffline = async (req, res) => {
  const { deviceId } = parse(deviceSchema, req.body);
  removeDevice(req.user._id, deviceId);
  res.status(204).end();
};

export const getPresence = async (req, res) => {
  const ids = String(req.query.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length || ids.length > 200) throw Errors.validation("ids must contain 1..200 user ids");
  const valid = ids.filter((id) => /^[a-f0-9]{24}$/i.test(id));
  res.status(200).json(await presenceSnapshot(valid));
};
