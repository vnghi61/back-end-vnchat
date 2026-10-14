import Reminder from "../models/reminder.model.js";
import { realtime } from "./realtime.service.js";

export function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ISO 8601 theo múi giờ IANA, vd. 2026-10-10T09:00:00+07:00
export function toLocalISO(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMin = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function reminderResponse(r) {
  return {
    _id: r._id,
    note: r.note,
    remindAt: r.remindAt,
    remindAtLocal: toLocalISO(r.remindAt, r.timezone),
    timezone: r.timezone,
    status: r.status,
    conversationId: r.conversationId ?? null,
    messageId: r.messageId ?? null,
    firedAt: r.firedAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// Bắn nhắc việc đến hạn: CAS scheduled→fired (kèm version) nên mỗi nhắc việc phát đúng một lần.
export async function fireDueReminders(batch = 100) {
  const now = new Date();
  const due = await Reminder.find({ status: "scheduled", remindAt: { $lte: now } })
    .sort({ remindAt: 1 })
    .limit(batch)
    .lean();
  let fired = 0;
  for (const r of due) {
    const updated = await Reminder.findOneAndUpdate(
      { _id: r._id, status: "scheduled", version: r.version },
      { $set: { status: "fired", firedAt: new Date() } },
      { new: true }
    );
    if (updated) {
      fired++;
      realtime.toUser(updated.ownerId, "reminder.fired", { reminder: reminderResponse(updated) });
    }
  }
  return fired;
}
