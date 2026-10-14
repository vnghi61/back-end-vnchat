// Việc nền trong process: bắn nhắc việc, đóng bình chọn quá hạn, dọn presence/typing, gửi webhook.

import { config } from "../config.js";
import { closeExpiredPolls } from "./poll.service.js";
import { sweepPresence } from "./presence.service.js";
import { fireDueReminders } from "./reminder.service.js";
import { sweepTyping } from "./typing.service.js";
import { processDueDeliveries } from "./webhook.service.js";

const safe = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    console.log(`Background job ${name} failed`, error.message);
  }
};

export async function runSweepOnce() {
  await safe("reminders", fireDueReminders);
  await safe("polls", closeExpiredPolls);
  await safe("presence", async () => sweepPresence());
  await safe("typing", async () => sweepTyping());
  await safe("webhooks", processDueDeliveries);
}

let timer = null;

export function startBackgroundJobs() {
  if (timer) return;
  let busy = false;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    await runSweepOnce();
    busy = false;
  }, config.sweepIntervalMs);
  timer.unref();
}

export function stopBackgroundJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}
