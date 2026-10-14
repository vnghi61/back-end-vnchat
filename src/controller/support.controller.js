import Conversation from "../models/conversation.model.js";
import User from "../models/user.model.js";
import { Errors } from "../lib/errors.js";
import { afterTimeIdDesc, encodeTimeId, parseLimit } from "../lib/cursor.js";
import { isAgent, rolesOf } from "../lib/permissions.js";
import { toConversation, toConversations, userBrief } from "../lib/serializers.js";
import { objectId, parse, sameId, toObjectId, z } from "../lib/validate.js";
import { audit } from "../services/audit.service.js";
import { postSystemMessage, sendMessage } from "../services/message.service.js";
import { isOnline } from "../services/presence.service.js";
import { realtime } from "../services/realtime.service.js";
import { getSettings } from "../services/settings.service.js";
import {
  addAgentMember,
  closeSupport,
  emitSupportUpdate,
  isCustomerOf,
  loadSupport,
  removeAgentMember,
  reopenSupport,
} from "../services/support.service.js";
import { dispatch } from "../services/webhook.service.js";
import { config } from "../config.js";

// ======================= phía khách =======================

const startSchema = z.object({
  meta: z
    .record(z.string().max(500))
    .refine((m) => Object.keys(m).length <= 20, "meta allows at most 20 keys")
    .optional(),
  text: z.string().max(8000).optional(),
});

// POST /api/support/conversations – mỗi khách tối đa một hội thoại mở; gọi lại trả hội thoại đang mở.
export const startSupport = async (req, res) => {
  const { widget } = await getSettings();
  if (!widget.enabled) throw Errors.widgetDisabled();
  const body = parse(startSchema, req.body);
  const me = req.user;

  let conv = await Conversation.findOne({ supportOpenFor: me._id });
  let created = false;
  if (!conv) {
    try {
      conv = await Conversation.create({
        kind: "support",
        members: [{ userId: me._id, role: "member" }],
        memberIds: [me._id],
        createdBy: me._id,
        supportOpenFor: me._id,
        support: { status: "waiting_agent", tags: [], meta: body.meta },
      });
      created = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      conv = await Conversation.findOne({ supportOpenFor: me._id });
      if (!conv) throw Errors.conflict("support conversation is being created");
    }
  }

  if (created) {
    realtime.joinConversation([me._id], conv._id);
    await postSystemMessage(conv, me._id, "support.started", { welcomeMessage: widget.welcomeMessage });
    const fresh = await Conversation.findById(conv._id);
    const payload = await toConversation(fresh, me._id);
    realtime.toUser(me._id, "conversation.new", payload);
    realtime.toAgents("support.updated", {
      conversationId: conv._id,
      status: "waiting_agent",
      assigneeId: null,
      conversation: await toConversation(fresh, null),
    });
    dispatch("support.started", { conversation: payload });
  }
  if (body.text?.trim()) {
    await sendMessage({ conv: await Conversation.findById(conv._id), sender: me, input: { text: body.text } });
  }
  res.status(created ? 201 : 200).json(await toConversation(await Conversation.findById(conv._id), me._id));
};

// Hội thoại hỗ trợ của chính mình (đang mở và đã đóng), mới nhất trước.
export const mySupportConversations = async (req, res) => {
  const convs = await Conversation.find({ kind: "support", createdBy: req.user._id }).sort({ updatedAt: -1 }).limit(50);
  res.status(200).json(await toConversations(convs, req.user._id));
};

export const rateSupport = async (req, res) => {
  const body = parse(z.object({ rating: z.number().int().min(1).max(5), note: z.string().max(1000).optional() }), req.body);
  const conv = await loadSupport(req.params.id);
  if (!isCustomerOf(conv, req.user._id)) throw Errors.notMember("only the customer can rate");
  await Conversation.updateOne(
    { _id: conv._id },
    { $set: { "support.rating": body.rating, "support.ratingNote": body.note ?? "", syncAt: new Date() } }
  );
  await emitSupportUpdate(conv._id, { rating: body.rating });
  dispatch("support.rated", { conversationId: conv._id, rating: body.rating, note: body.note ?? "" });
  res.status(204).end();
};

// Khách hoặc agent đóng hội thoại.
export const closeSupportHandler = async (req, res) => {
  const conv = await loadSupport(req.params.id);
  if (!isCustomerOf(conv, req.user._id) && !(await isAgent(req.user))) throw Errors.notMember();
  await closeSupport(conv, req.user._id);
  res.status(204).end();
};

// ======================= phía nhân viên hỗ trợ =======================

// GET /api/support/queue?status=open|waiting_agent|agent|closed|all&mine&tag&cursor&limit
export const supportQueue = async (req, res) => {
  const limit = parseLimit(req.query.limit, 30, 100);
  const status = req.query.status ?? "open";
  const filter = { kind: "support" };
  if (status === "open") filter["support.status"] = { $in: ["waiting_agent", "agent"] };
  else if (["waiting_agent", "agent", "closed"].includes(status)) filter["support.status"] = status;
  else if (status !== "all") throw Errors.validation("status is invalid");
  if (req.query.mine === "true") filter["support.assigneeId"] = req.user._id;
  if (req.query.tag) filter["support.tags"] = String(req.query.tag);
  if (req.query.cursor) Object.assign(filter, afterTimeIdDesc("updatedAt", req.query.cursor));

  const convs = await Conversation.find(filter).sort({ updatedAt: -1, _id: -1 }).limit(limit + 1);
  const hasMore = convs.length > limit;
  const page = convs.slice(0, limit);
  const last = page[page.length - 1];
  res.status(200).json({
    items: await toConversations(page, req.user._id),
    nextCursor: hasMore ? encodeTimeId(last.updatedAt, last._id) : null,
    hasMore,
  });
};

export const supportStats = async (req, res) => {
  const rows = await Conversation.aggregate([
    { $match: { kind: "support" } },
    {
      $group: {
        _id: "$support.status",
        count: { $sum: 1 },
        mine: { $sum: { $cond: [{ $eq: ["$support.assigneeId", req.user._id] }, 1, 0] } },
        ratingSum: { $sum: { $ifNull: ["$support.rating", 0] } },
        rated: { $sum: { $cond: [{ $isNumber: "$support.rating" }, 1, 0] } },
      },
    },
  ]);
  const byStatus = { waiting_agent: 0, agent: 0, closed: 0 };
  let mine = 0;
  let ratingSum = 0;
  let rated = 0;
  for (const r of rows) {
    if (r._id in byStatus) byStatus[r._id] = r.count;
    if (r._id !== "closed") mine += r.mine;
    ratingSum += r.ratingSum;
    rated += r.rated;
  }
  res.status(200).json({ ...byStatus, mineOpen: mine, averageRating: rated ? +(ratingSum / rated).toFixed(2) : null, rated });
};

// Danh sách nhân viên hỗ trợ (để chuyển ticket).
export const listAgents = async (req, res) => {
  const users = await User.find({ kind: "user", status: { $ne: "inactive" }, roles: { $in: ["agent", "admin"] } })
    .sort({ name: 1 })
    .limit(500)
    .lean();
  const agents = [];
  for (const u of users) if (await isAgent(u)) agents.push({ ...userBrief(u), online: isOnline(u._id) });
  res.status(200).json(agents);
};

async function loadAgentUser(agentId, currentUser) {
  if (sameId(agentId, currentUser._id)) return currentUser;
  const agent = await User.findById(agentId);
  if (!agent || !(await isAgent(agent))) throw Errors.validation("target user is not an active support agent");
  return agent;
}

const isAdmin = (user) => rolesOf(user).includes("admin");

// POST /api/support/conversations/:id/assign { agentId? } – nhận ticket (admin gán được cho người khác).
export const assignSupport = async (req, res) => {
  const body = parse(z.object({ agentId: objectId.optional() }), req.body);
  const conv = await loadSupport(req.params.id);
  const agentId = body.agentId ? toObjectId(body.agentId, Errors.userNotFound) : req.user._id;
  if (!sameId(agentId, req.user._id) && !isAdmin(req.user)) throw Errors.forbidden("only admins can assign to someone else");
  await loadAgentUser(agentId, req.user);
  if (conv.support.status === "closed") throw Errors.conversationClosed();
  if (conv.support.status === "agent") throw Errors.alreadyAssigned();

  const now = new Date();
  const updated = await Conversation.findOneAndUpdate(
    { _id: conv._id, "support.status": "waiting_agent" },
    { $set: { "support.status": "agent", "support.assigneeId": agentId, "support.assignedAt": now, syncAt: now } },
    { new: true }
  );
  if (!updated) {
    const fresh = await loadSupport(conv._id);
    if (fresh.support.status === "closed") throw Errors.conversationClosed();
    throw Errors.alreadyAssigned();
  }
  await addAgentMember(updated, agentId);
  await postSystemMessage(updated, req.user._id, "support.assigned", { agentId });
  const fresh = await emitSupportUpdate(conv._id);
  realtime.toUser(agentId, "conversation.new", await toConversation(fresh, agentId));
  dispatch("support.assigned", { conversationId: conv._id, agentId });
  await audit(req, "support.assigned", { targetType: "conversation", targetId: conv._id, metadata: { agentId } });
  res.status(200).json(await toConversation(fresh, req.user._id));
};

// Chuyển ticket đang xử lý sang nhân viên khác (người đang phụ trách hoặc admin).
export const transferSupport = async (req, res) => {
  const body = parse(z.object({ agentId: objectId }), req.body);
  const conv = await loadSupport(req.params.id);
  if (conv.support.status !== "agent") throw Errors.conflict("only conversations being handled can be transferred");
  const current = conv.support.assigneeId;
  if (!sameId(current, req.user._id) && !isAdmin(req.user)) throw Errors.forbidden("only the assignee or an admin can transfer");
  const targetId = toObjectId(body.agentId, Errors.userNotFound);
  await loadAgentUser(targetId, req.user);
  if (sameId(targetId, current)) return res.status(200).json(await toConversation(conv, req.user._id));

  const updated = await Conversation.findOneAndUpdate(
    { _id: conv._id, "support.status": "agent", "support.assigneeId": current },
    { $set: { "support.assigneeId": targetId, "support.assignedAt": new Date(), syncAt: new Date() } },
    { new: true }
  );
  if (!updated) throw Errors.conflict("conversation changed, reload and try again");
  await removeAgentMember(conv, current);
  await addAgentMember(updated, targetId);
  await postSystemMessage(updated, req.user._id, "support.transferred", { fromAgentId: current, toAgentId: targetId });
  const fresh = await emitSupportUpdate(conv._id);
  realtime.toUser(targetId, "conversation.new", await toConversation(fresh, targetId));
  dispatch("support.transferred", { conversationId: conv._id, fromAgentId: current, toAgentId: targetId });
  await audit(req, "support.transferred", {
    targetType: "conversation",
    targetId: conv._id,
    metadata: { fromAgentId: current, toAgentId: targetId },
  });
  res.status(200).json(await toConversation(fresh, req.user._id));
};

// Trả ticket về hàng đợi.
export const releaseSupport = async (req, res) => {
  const conv = await loadSupport(req.params.id);
  if (conv.support.status !== "agent") throw Errors.conflict("conversation is not assigned");
  const current = conv.support.assigneeId;
  if (!sameId(current, req.user._id) && !isAdmin(req.user)) throw Errors.forbidden("only the assignee or an admin can release");
  const updated = await Conversation.findOneAndUpdate(
    { _id: conv._id, "support.status": "agent", "support.assigneeId": current },
    { $set: { "support.status": "waiting_agent", "support.assigneeId": null, syncAt: new Date() } },
    { new: true }
  );
  if (!updated) throw Errors.conflict("conversation changed, reload and try again");
  await removeAgentMember(conv, current);
  await postSystemMessage(updated, req.user._id, "support.released", { agentId: current });
  const fresh = await emitSupportUpdate(conv._id);
  dispatch("support.released", { conversationId: conv._id, agentId: current });
  res.status(200).json(await toConversation(fresh, req.user._id));
};

export const reopenSupportHandler = async (req, res) => {
  const conv = await loadSupport(req.params.id);
  const updated = await reopenSupport(conv, req.user._id);
  res.status(200).json(await toConversation(updated, req.user._id));
};

export const setSupportTags = async (req, res) => {
  const { tags } = parse(
    z.object({ tags: z.array(z.string().trim().min(1).max(32)).max(config.limits.supportTagsMax) }),
    req.body
  );
  const conv = await loadSupport(req.params.id);
  const unique = [...new Set(tags.map((t) => t.toLowerCase()))];
  await Conversation.updateOne({ _id: conv._id }, { $set: { "support.tags": unique, syncAt: new Date() } });
  await emitSupportUpdate(conv._id, { tags: unique });
  res.status(204).end();
};
