import { config } from "../config.js";
import Poll from "../models/poll.model.js";
import { Errors } from "../lib/errors.js";
import { parse, sameId, toObjectId, z } from "../lib/validate.js";
import { getMember, isOwnerOrAdmin, loadForMember, loadForRead, touchSync } from "../services/conversation.service.js";
import { sendMessage } from "../services/message.service.js";
import { closePoll, pollEventData, pollResponse } from "../services/poll.service.js";
import { realtime } from "../services/realtime.service.js";

const createSchema = z.object({
  question: z.string().trim().min(1).max(500),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(config.limits.pollMaxOptions),
  multiple: z.boolean().optional(),
  anonymous: z.boolean().optional(),
  closesAt: z.string().datetime({ offset: true }).optional(),
  clientMsgId: z.string().trim().min(1).max(100).optional(),
});

// POST /api/conversations/:id/polls → { poll, message }
export const createPoll = async (req, res) => {
  const body = parse(createSchema, req.body);
  const closesAt = body.closesAt ? new Date(body.closesAt) : undefined;
  if (closesAt && closesAt <= new Date()) {
    throw Errors.validation("closesAt must be in the future", [{ field: "closesAt", message: "must be in the future" }]);
  }
  const { conv } = await loadForMember(req.params.id, req.user);
  const options = body.options.map((text, i) => ({ id: `o${i + 1}`, text }));

  // Poll ghi trước (messageId rỗng) để client nhận message.new là GET /polls/:id được ngay.
  const poll = await Poll.create({
    conversationId: conv._id,
    createdBy: req.user._id,
    question: body.question,
    options,
    multiple: !!body.multiple,
    anonymous: !!body.anonymous,
    closesAt,
    counts: Object.fromEntries(options.map((o) => [o.id, 0])),
  });

  let result;
  try {
    result = await sendMessage({
      conv,
      sender: req.user,
      input: { type: "poll", text: body.question, pollId: poll._id, clientMsgId: body.clientMsgId },
    });
  } catch (error) {
    await Poll.deleteOne({ _id: poll._id });
    throw error;
  }

  if (!result.created) {
    // cùng clientMsgId → trả lại bình chọn đã tạo trước đó
    await Poll.deleteOne({ _id: poll._id });
    const original = await Poll.findById(result.message.pollId);
    return res.status(200).json({ poll: await pollResponse(original, req.user._id), message: result.payload });
  }
  const saved = await Poll.findByIdAndUpdate(poll._id, { $set: { messageId: result.message._id } }, { new: true });
  res.status(201).json({ poll: await pollResponse(saved, req.user._id), message: result.payload });
};

async function loadPoll(req, { member = false } = {}) {
  const poll = await Poll.findById(toObjectId(req.params.id, Errors.pollNotFound));
  if (!poll) throw Errors.pollNotFound();
  const access = member
    ? await loadForMember(poll.conversationId, req.user)
    : await loadForRead(poll.conversationId, req.user);
  return { poll, ...access };
}

export const getPoll = async (req, res) => {
  const { poll } = await loadPoll(req);
  res.status(200).json(await pollResponse(poll, req.user._id));
};

// Thay toàn bộ phiếu của người gọi ([] = rút phiếu). Cập nhật có điều kiện theo rev, thử lại khi xung đột.
async function setVotes(req, optionIds) {
  const { poll, conv } = await loadPoll(req, { member: true });
  if (conv.kind === "support" && conv.support?.status === "closed") throw Errors.conversationClosed();
  const wanted = [...new Set(optionIds)];
  const known = new Set(poll.options.map((o) => o.id));
  const unknown = wanted.find((id) => !known.has(id));
  if (unknown) throw Errors.badVote(`unknown option ${unknown}`);
  if (!poll.multiple && wanted.length > 1) throw Errors.badVote("this poll allows a single choice");

  const me = req.user._id;
  for (let attempt = 0; attempt < 10; attempt++) {
    const p = await Poll.findById(poll._id).lean();
    if (p.status !== "open" || (p.closesAt && p.closesAt <= new Date())) throw Errors.pollClosed();
    const mine = p.votes.filter((v) => sameId(v.userId, me)).map((v) => v.optionId);
    if (mine.length === wanted.length && mine.every((id) => wanted.includes(id))) return { poll: p, changed: false };

    const now = new Date();
    const votes = [
      ...p.votes.filter((v) => !sameId(v.userId, me)),
      ...wanted.map((optionId) => ({ userId: me, optionId, at: now })),
    ];
    const counts = Object.fromEntries(p.options.map((o) => [o.id, votes.filter((v) => v.optionId === o.id).length]));
    const votersCount = new Set(votes.map((v) => String(v.userId))).size;
    const result = await Poll.updateOne(
      { _id: p._id, rev: p.rev, status: "open" },
      { $set: { votes, counts, votersCount }, $inc: { rev: 1 } }
    );
    if (result.modifiedCount) {
      const fresh = await Poll.findById(p._id);
      await touchSync(fresh.conversationId);
      realtime.toConversation(fresh.conversationId, "poll.updated", pollEventData(fresh));
      return { poll: fresh, changed: true };
    }
  }
  throw Errors.conflict("too many concurrent votes, try again");
}

export const putVotes = async (req, res) => {
  const { optionIds } = parse(z.object({ optionIds: z.array(z.string()).max(50) }), req.body);
  const { poll } = await setVotes(req, optionIds);
  res.status(200).json(await pollResponse(poll, req.user._id));
};

export const retractVotes = async (req, res) => {
  await setVotes(req, []);
  res.status(204).end();
};

export const closePollHandler = async (req, res) => {
  const { poll, conv } = await loadPoll(req, { member: true });
  const member = getMember(conv, req.user._id);
  if (!sameId(poll.createdBy, req.user._id) && !isOwnerOrAdmin(member)) throw Errors.ownerAdminOnly();
  const closed = (await closePoll(poll._id, req.user._id)) ?? (await Poll.findById(poll._id));
  res.status(200).json(await pollResponse(closed, req.user._id));
};
