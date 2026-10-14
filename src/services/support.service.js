// Chat hỗ trợ do nhân viên xử lý (không có AI):
//   waiting_agent ──assign──► agent ──close──► closed ──reopen──► agent | waiting_agent
//                  ◄─release──     ──transfer──► agent (người khác)
// Mọi chuyển trạng thái là compare-and-set trên `support.status` / `support.assigneeId`.

import Conversation from "../models/conversation.model.js";
import { Errors } from "../lib/errors.js";
import { toConversation } from "../lib/serializers.js";
import { sameId } from "../lib/validate.js";
import { getMember, loadConversation } from "./conversation.service.js";
import { postSystemMessage } from "./message.service.js";
import { realtime } from "./realtime.service.js";
import { dispatch } from "./webhook.service.js";

export async function loadSupport(id) {
  const conv = await loadConversation(id);
  if (conv.kind !== "support") throw Errors.notSupport();
  return conv;
}

export async function addAgentMember(conv, agentId) {
  await Conversation.updateOne(
    { _id: conv._id, memberIds: { $ne: agentId } },
    {
      $push: { members: { userId: agentId, role: "agent", joinedAt: new Date(), lastReadSeq: conv.lastSeq ?? 0 } },
      $addToSet: { memberIds: agentId },
    }
  );
  realtime.joinConversation([agentId], conv._id);
}

export async function removeAgentMember(conv, agentId) {
  const member = getMember(conv, agentId);
  if (!member || member.role !== "agent") return;
  await Conversation.updateOne(
    { _id: conv._id },
    { $pull: { members: { userId: agentId, role: "agent" }, memberIds: agentId } }
  );
  realtime.toUser(agentId, "conversation.member.removed", { conversationId: conv._id, memberId: agentId });
  realtime.leaveConversation([agentId], conv._id);
}

// support.updated: tới phòng hội thoại (khách + agent) và console agent.
export async function emitSupportUpdate(conversationId, extra = {}) {
  const fresh = await Conversation.findById(conversationId);
  const data = {
    conversationId,
    status: fresh.support.status,
    assigneeId: fresh.support.assigneeId ?? null,
    ...extra,
  };
  realtime.toConversation(conversationId, "support.updated", data);
  realtime.toAgents("support.updated", { ...data, conversation: await toConversation(fresh, null) });
  return fresh;
}

export async function closeSupport(conv, actorId) {
  if (conv.support.status === "closed") return conv;
  const now = new Date();
  const updated = await Conversation.findOneAndUpdate(
    { _id: conv._id, "support.status": { $ne: "closed" } },
    {
      $set: { "support.status": "closed", "support.closedAt": now, "support.closedBy": actorId, syncAt: now },
      $unset: { supportOpenFor: "" },
    },
    { new: true }
  );
  if (!updated) return loadSupport(conv._id);
  await postSystemMessage(updated, actorId, "support.closed", { by: actorId });
  await emitSupportUpdate(conv._id);
  dispatch("support.closed", { conversationId: conv._id, by: actorId });
  return updated;
}

export async function reopenSupport(conv, actorId) {
  if (conv.support.status !== "closed") return conv;
  const status = conv.support.assigneeId ? "agent" : "waiting_agent";
  let updated;
  try {
    updated = await Conversation.findOneAndUpdate(
      { _id: conv._id, "support.status": "closed" },
      {
        $set: { "support.status": status, supportOpenFor: conv.createdBy, syncAt: new Date() },
        $unset: { "support.closedAt": "", "support.closedBy": "" },
      },
      { new: true }
    );
  } catch (error) {
    if (error?.code === 11000) throw Errors.conflict("customer already has another open support conversation");
    throw error;
  }
  if (!updated) return loadSupport(conv._id);
  await postSystemMessage(updated, actorId, "support.reopened", { by: actorId, status });
  await emitSupportUpdate(conv._id);
  dispatch("support.reopened", { conversationId: conv._id, by: actorId, status });
  return updated;
}

export const isCustomerOf = (conv, userId) => sameId(conv.createdBy, userId);
