import Poll from "../models/poll.model.js";
import { loadUsers, userBrief } from "../lib/serializers.js";
import { sameId } from "../lib/validate.js";
import { touchSync } from "./conversation.service.js";
import { realtime } from "./realtime.service.js";

const countOf = (counts, id) => (counts instanceof Map ? counts.get(id) : counts?.[id]) ?? 0;

export async function pollResponse(poll, viewerId) {
  const p = poll?.toObject ? poll.toObject({ flattenMaps: true }) : poll;
  const votes = p.votes ?? [];
  const users = p.anonymous ? new Map() : await loadUsers(votes.map((v) => v.userId));
  return {
    _id: p._id,
    conversationId: p.conversationId,
    messageId: p.messageId ?? null,
    question: p.question,
    options: p.options.map((o) => ({
      id: o.id,
      text: o.text,
      count: countOf(p.counts, o.id),
      voters: p.anonymous
        ? undefined
        : votes
            .filter((v) => v.optionId === o.id)
            .slice(0, 50)
            .map((v) => userBrief(users.get(String(v.userId))) ?? { _id: v.userId }),
    })),
    multiple: p.multiple,
    anonymous: p.anonymous,
    status: p.status,
    closesAt: p.closesAt ?? null,
    closedAt: p.closedAt ?? null,
    closedBy: p.closedBy ?? null,
    votersCount: p.votersCount ?? 0,
    myOptionIds: votes.filter((v) => sameId(v.userId, viewerId)).map((v) => v.optionId),
    createdBy: p.createdBy,
    createdAt: p.createdAt,
  };
}

// Payload realtime chỉ có số đếm – không lộ ai bầu gì.
export function pollEventData(poll) {
  const p = poll?.toObject ? poll.toObject({ flattenMaps: true }) : poll;
  const counts = Object.fromEntries(p.options.map((o) => [o.id, countOf(p.counts, o.id)]));
  const data = {
    pollId: p._id,
    conversationId: p.conversationId,
    messageId: p.messageId,
    counts,
    votersCount: p.votersCount ?? 0,
    status: p.status,
  };
  if (p.status === "closed") Object.assign(data, { closedAt: p.closedAt, closedBy: p.closedBy ?? null });
  return data;
}

// Đóng nguyên tử (chỉ lần đầu phát poll.closed). Trả poll sau cập nhật hoặc null nếu đã đóng.
export async function closePoll(pollId, closedBy = null) {
  const now = new Date();
  const closed = await Poll.findOneAndUpdate(
    { _id: pollId, status: "open" },
    { $set: { status: "closed", closedAt: now, closedBy: closedBy ?? undefined }, $inc: { rev: 1 } },
    { new: true }
  );
  if (closed) {
    await touchSync(closed.conversationId);
    realtime.toConversation(closed.conversationId, "poll.closed", pollEventData(closed));
  }
  return closed;
}

export async function closeExpiredPolls(batch = 100) {
  const due = await Poll.find({ status: "open", closesAt: { $lte: new Date() } }).select("_id").limit(batch).lean();
  for (const p of due) await closePoll(p._id, null);
  return due.length;
}
