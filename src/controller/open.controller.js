// /api/open/v1 – đối tác gọi bằng API key. Chỉ chạm được hội thoại hỗ trợ (hội thoại khác → 404).

import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import { Errors } from "../lib/errors.js";
import { decodeSeq, encodeSeq, parseLimit } from "../lib/cursor.js";
import { toConversation, toMessages } from "../lib/serializers.js";
import { parse, z } from "../lib/validate.js";
import { loadConversation } from "../services/conversation.service.js";
import { sendMessage } from "../services/message.service.js";
import { realtime } from "../services/realtime.service.js";
import { closeSupport } from "../services/support.service.js";

async function loadSupportForKey(id) {
  const conv = await loadConversation(id);
  if (conv.kind !== "support") throw Errors.conversationNotFound();
  return conv;
}

export const openGetConversation = async (req, res) => {
  const conv = await loadSupportForKey(req.params.id);
  res.status(200).json(await toConversation(conv, null));
};

export const openListMessages = async (req, res) => {
  const conv = await loadSupportForKey(req.params.id);
  const limit = parseLimit(req.query.limit, 50, 200);
  const filter = { conversationId: conv._id };
  let ascending = false;
  if (req.query.after) {
    filter.seq = { $gt: decodeSeq(req.query.after) };
    ascending = true;
  } else if (req.query.before) {
    filter.seq = { $lt: decodeSeq(req.query.before) };
  }
  const docs = await Message.find(filter).sort({ seq: ascending ? 1 : -1 }).limit(limit + 1);
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  const nextCursor = hasMore ? encodeSeq(page[page.length - 1].seq) : null;
  if (!ascending) page.reverse();
  res.status(200).json({ items: await toMessages(page, null), nextCursor, hasMore });
};

// Đăng tin dưới danh tính bot của key (tự vào hội thoại với role `bot`).
export const openPostMessage = async (req, res) => {
  const body = parse(
    z.object({ text: z.string().min(1), clientMsgId: z.string().trim().min(1).max(100).optional() }),
    req.body
  );
  if (!req.botUser) throw Errors.invalidApiKey();
  const conv = await loadSupportForKey(req.params.id);
  if (!conv.memberIds.some((id) => String(id) === String(req.botUser._id))) {
    await Conversation.updateOne(
      { _id: conv._id, memberIds: { $ne: req.botUser._id } },
      {
        $push: { members: { userId: req.botUser._id, role: "bot", joinedAt: new Date(), lastReadSeq: conv.lastSeq } },
        $addToSet: { memberIds: req.botUser._id },
      }
    );
    realtime.joinConversation([req.botUser._id], conv._id);
  }
  const fresh = await loadSupportForKey(conv._id);
  const { payload, created } = await sendMessage({
    conv: fresh,
    sender: req.botUser,
    input: { text: body.text, clientMsgId: body.clientMsgId },
  });
  res.status(created ? 201 : 200).json(payload);
};

export const openCloseSupport = async (req, res) => {
  if (!req.botUser) throw Errors.invalidApiKey();
  const conv = await loadSupportForKey(req.params.id);
  await closeSupport(conv, req.botUser._id);
  res.status(204).end();
};
