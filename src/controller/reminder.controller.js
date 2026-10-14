import { config } from "../config.js";
import Message from "../models/message.model.js";
import Reminder from "../models/reminder.model.js";
import { Errors } from "../lib/errors.js";
import { afterTimeIdAsc, encodeTimeId, parseLimit } from "../lib/cursor.js";
import { objectId, parse, toObjectId, z } from "../lib/validate.js";
import { loadForMember } from "../services/conversation.service.js";
import { realtime } from "../services/realtime.service.js";
import { isValidTimezone, reminderResponse } from "../services/reminder.service.js";

const MIN_LEAD_MS = 30_000;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

function checkRemindAt(value) {
  const at = new Date(value);
  const now = Date.now();
  if (at.getTime() < now + MIN_LEAD_MS || at.getTime() > now + MAX_AHEAD_MS) {
    throw Errors.validation("remindAt must be between 30 seconds and 1 year from now", [
      { field: "remindAt", message: "out of range" },
    ]);
  }
  return at;
}

const createSchema = z.object({
  note: z.string().trim().min(1).max(1000),
  remindAt: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).max(64).default("UTC"),
  conversationId: objectId.optional(),
  messageId: objectId.optional(),
});

export const createReminder = async (req, res) => {
  const body = parse(createSchema, req.body);
  if (!isValidTimezone(body.timezone)) throw Errors.badTimezone(body.timezone);
  const remindAt = checkRemindAt(body.remindAt);
  if (body.messageId && !body.conversationId) {
    throw Errors.validation("messageId requires conversationId", [{ field: "messageId", message: "requires conversationId" }]);
  }

  let conversationId;
  let messageId;
  if (body.conversationId) {
    const { conv } = await loadForMember(body.conversationId, req.user);
    conversationId = conv._id;
    if (body.messageId) {
      const message = await Message.exists({ _id: toObjectId(body.messageId), conversationId: conv._id });
      if (!message) throw Errors.messageNotFound();
      messageId = message._id;
    }
  }

  const scheduled = await Reminder.countDocuments({ ownerId: req.user._id, status: "scheduled" });
  if (scheduled >= config.limits.remindersMaxPerUser) throw Errors.conflict("too many scheduled reminders");

  const reminder = await Reminder.create({
    ownerId: req.user._id,
    note: body.note,
    remindAt,
    timezone: body.timezone,
    conversationId,
    messageId,
  });
  const payload = reminderResponse(reminder);
  realtime.toUser(req.user._id, "reminder.created", { reminder: payload });
  res.status(201).json(payload);
};

export const listReminders = async (req, res) => {
  const status = req.query.status ?? "scheduled";
  if (!["scheduled", "fired", "cancelled"].includes(status)) throw Errors.validation("status is invalid");
  const limit = parseLimit(req.query.limit, 50, 100);
  const filter = { ownerId: req.user._id, status };
  if (req.query.cursor) Object.assign(filter, afterTimeIdAsc("remindAt", req.query.cursor));
  const docs = await Reminder.find(filter).sort({ remindAt: 1, _id: 1 }).limit(limit + 1);
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  res.status(200).json({
    items: page.map(reminderResponse),
    nextCursor: hasMore ? encodeTimeId(last.remindAt, last._id) : null,
    hasMore,
  });
};

async function loadOwn(req) {
  const reminder = await Reminder.findOne({
    _id: toObjectId(req.params.id, Errors.reminderNotFound),
    ownerId: req.user._id,
  });
  if (!reminder) throw Errors.reminderNotFound();
  return reminder;
}

export const getReminder = async (req, res) => {
  res.status(200).json(reminderResponse(await loadOwn(req)));
};

const updateSchema = z.object({
  note: z.string().trim().min(1).max(1000).optional(),
  remindAt: z.string().datetime({ offset: true }).optional(),
  timezone: z.string().min(1).max(64).optional(),
});

export const updateReminder = async (req, res) => {
  const body = parse(updateSchema, req.body);
  const reminder = await loadOwn(req);
  if (reminder.status !== "scheduled") throw Errors.conflict("only scheduled reminders can be changed");
  if (body.timezone && !isValidTimezone(body.timezone)) throw Errors.badTimezone(body.timezone);

  const $set = {};
  if (body.note) $set.note = body.note;
  if (body.remindAt) $set.remindAt = checkRemindAt(body.remindAt);
  if (body.timezone) $set.timezone = body.timezone;
  const reschedule = body.remindAt || body.timezone;
  const updated = await Reminder.findOneAndUpdate(
    { _id: reminder._id, status: "scheduled" },
    { $set, ...(reschedule ? { $inc: { version: 1 } } : {}) },
    { new: true }
  );
  if (!updated) throw Errors.conflict("only scheduled reminders can be changed");
  const payload = reminderResponse(updated);
  realtime.toUser(req.user._id, "reminder.updated", { reminder: payload });
  res.status(200).json(payload);
};

export const cancelReminder = async (req, res) => {
  const reminder = await loadOwn(req);
  const updated = await Reminder.findOneAndUpdate(
    { _id: reminder._id, status: "scheduled" },
    { $set: { status: "cancelled" }, $inc: { version: 1 } },
    { new: true }
  );
  if (!updated) throw Errors.conflict("reminder is already fired or cancelled");
  realtime.toUser(req.user._id, "reminder.cancelled", { reminder: reminderResponse(updated) });
  res.status(204).end();
};
