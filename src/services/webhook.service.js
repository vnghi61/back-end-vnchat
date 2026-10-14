// Webhook: đẩy sự kiện sang hệ thống ngoài bằng HTTP POST có chữ ký HMAC, retry với backoff.
// Delivery lưu trong Mongo (bền qua restart); worker trong process lấy delivery đến hạn bằng
// compare-and-set `lockedUntil` nên chạy song song không gửi trùng.

import crypto from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import mongoose from "mongoose";
import { config, isProduction } from "../config.js";
import { Webhook, WebhookDelivery } from "../models/admin.model.js";

export const WEBHOOK_EVENTS = [
  "message.created",
  "chat.command.detected",
  "conversation.created",
  "support.started",
  "support.assigned",
  "support.transferred",
  "support.released",
  "support.closed",
  "support.reopened",
  "support.rated",
  "user.registered",
];

// ---------- chính sách địa chỉ đích (chống SSRF) ----------

const always = new net.BlockList();
always.addSubnet("169.254.0.0", 16); // link-local / cloud metadata
always.addSubnet("0.0.0.0", 8);
always.addSubnet("224.0.0.0", 4); // multicast
always.addSubnet("240.0.0.0", 4);
always.addSubnet("fe80::", 10, "ipv6");
always.addSubnet("ff00::", 8, "ipv6");
always.addAddress("::", "ipv6");

const loopback = new net.BlockList();
loopback.addSubnet("127.0.0.0", 8);
loopback.addAddress("::1", "ipv6");

const privateNets = new net.BlockList();
privateNets.addSubnet("10.0.0.0", 8);
privateNets.addSubnet("172.16.0.0", 12);
privateNets.addSubnet("192.168.0.0", 16);
privateNets.addSubnet("100.64.0.0", 10);
privateNets.addSubnet("fc00::", 7, "ipv6");

export function isAddressAllowed(address) {
  let ip = String(address);
  if (ip.toLowerCase().startsWith("::ffff:") && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  const family = net.isIPv4(ip) ? "ipv4" : net.isIPv6(ip) ? "ipv6" : null;
  if (!family) return false;
  if (always.check(ip, family)) return false;
  if (loopback.check(ip, family)) return !isProduction();
  if (privateNets.check(ip, family)) return config.webhook.allowPrivateNetworks;
  return true;
}

// Kiểm tra lúc tạo/sửa subscription: http(s), có host, IP literal phải qua chính sách.
export function validateWebhookUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "url must be a valid http(s) URL";
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return "url must be a valid http(s) URL";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isAddressAllowed(host)) return "webhook destination address is not allowed";
  return null;
}

class BlockedDestinationError extends Error {}

// lookup kiểm tra từng địa chỉ sau khi resolve DNS → hostname không thể trỏ vào mạng nội bộ bị cấm.
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const allowed = addresses.filter((a) => isAddressAllowed(a.address));
    if (!allowed.length) {
      return callback(new BlockedDestinationError("webhook destination address is not allowed"));
    }
    if (options?.all) return callback(null, allowed);
    return callback(null, allowed[0].address, allowed[0].family);
  });
}

// ---------- chữ ký ----------

// X-Auth-Body-Signature = hex(HMAC-SHA256(secret, timestamp + "\n" + hex(sha256(body))))
export function signBody(secret, timestamp, body) {
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  return crypto.createHmac("sha256", secret).update(`${timestamp}\n${bodyHash}`).digest("hex");
}

function post(urlString, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && !isAddressAllowed(host)) {
      return reject(new BlockedDestinationError("webhook destination address is not allowed"));
    }
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers },
        lookup: guardedLookup,
        timeout: config.webhook.timeoutMs,
      },
      (res) => {
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 4096) res.destroy();
        });
        res.on("end", () => resolve(res.statusCode));
        res.on("close", () => resolve(res.statusCode));
        res.on("error", () => resolve(res.statusCode));
      }
    );
    req.on("timeout", () => req.destroy(new Error("webhook request timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

// ---------- dispatch ----------

const SUB_CACHE_MS = 30_000;
let subCache = new Map(); // event -> { expires, subs }

export function invalidateWebhookCache() {
  subCache = new Map();
}

async function subscriptionsFor(event) {
  const hit = subCache.get(event);
  if (hit && hit.expires > Date.now()) return hit.subs;
  const subs = await Webhook.find({ enabled: true, events: { $in: ["*", event] } }).select("_id").lean();
  subCache.set(event, { subs, expires: Date.now() + SUB_CACHE_MS });
  return subs;
}

// Tạo delivery cho mọi subscription khớp rồi đánh thức worker. Không bao giờ ném lỗi.
export async function dispatch(event, data) {
  try {
    const subs = await subscriptionsFor(event);
    if (!subs.length) return;
    const at = new Date();
    const docs = subs.map((s) => {
      const _id = new mongoose.Types.ObjectId();
      return {
        _id,
        subscriptionId: s._id,
        event,
        payload: JSON.stringify({ id: String(_id), event, at: at.toISOString(), data }),
        status: "pending",
        nextAttemptAt: at,
        expiresAt: new Date(at.getTime() + config.webhook.retentionDays * 24 * 60 * 60 * 1000),
      };
    });
    await WebhookDelivery.insertMany(docs);
    kickWebhookWorker();
  } catch (error) {
    console.log("Error dispatching webhook", event, error.message);
  }
}

export const backoffMs = (attempts) => {
  const base = Math.min(5000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60 * 1000);
  return base + Math.floor(Math.random() * 1000);
};

async function deliverOne(delivery) {
  const sub = await Webhook.findById(delivery.subscriptionId).lean();
  if (!sub || !sub.enabled) {
    await WebhookDelivery.updateOne(
      { _id: delivery._id },
      { $set: { status: "failed", lastError: "subscription disabled or deleted", lockedUntil: null } }
    );
    return;
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = {
    "X-Chat-Event": delivery.event,
    "X-Chat-Delivery": String(delivery._id),
    "X-Auth-Timestamp": timestamp,
    "X-Auth-Body-Signature": signBody(sub.secret, timestamp, delivery.payload),
    "User-Agent": "vnchat-webhook/1.0",
  };
  const attempts = delivery.attempts + 1;
  try {
    const status = await post(sub.url, delivery.payload, headers);
    if (status >= 200 && status < 300) {
      await WebhookDelivery.updateOne(
        { _id: delivery._id },
        { $set: { status: "delivered", deliveredAt: new Date(), lastStatusCode: status, lockedUntil: null }, $inc: { attempts: 1 } }
      );
      return;
    }
    await recordFailure(delivery, attempts, `unexpected status ${status}`, status);
  } catch (error) {
    if (error instanceof BlockedDestinationError) {
      await WebhookDelivery.updateOne(
        { _id: delivery._id },
        { $set: { status: "failed", lastError: error.message, lockedUntil: null }, $inc: { attempts: 1 } }
      );
      return;
    }
    await recordFailure(delivery, attempts, error.message, undefined);
  }
}

async function recordFailure(delivery, attempts, message, statusCode) {
  const final = attempts >= config.webhook.maxAttempts;
  await WebhookDelivery.updateOne(
    { _id: delivery._id },
    {
      $set: {
        status: final ? "failed" : "pending",
        lastError: String(message).slice(0, 500),
        lastStatusCode: statusCode,
        nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        lockedUntil: null,
      },
      $inc: { attempts: 1 },
    }
  );
}

let running = false;
let again = false;

// Xử lý mọi delivery đến hạn. Gọi lại khi đang chạy → chạy thêm một vòng sau vòng hiện tại.
export async function processDueDeliveries(maxBatch = 100) {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      for (let i = 0; i < maxBatch; i++) {
        const now = new Date();
        const delivery = await WebhookDelivery.findOneAndUpdate(
          {
            status: "pending",
            nextAttemptAt: { $lte: now },
            $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
          },
          { $set: { lockedUntil: new Date(now.getTime() + config.webhook.timeoutMs + 30_000) } },
          { sort: { nextAttemptAt: 1 }, new: true }
        ).lean();
        if (!delivery) break;
        await deliverOne(delivery);
      }
    } while (again);
  } catch (error) {
    console.log("Error processing webhook deliveries", error.message);
  } finally {
    running = false;
  }
}

export function kickWebhookWorker() {
  setImmediate(() => {
    processDueDeliveries().catch(() => {});
  });
}

export async function redeliver(deliveryId) {
  const res = await WebhookDelivery.updateOne(
    { _id: deliveryId },
    { $set: { status: "pending", nextAttemptAt: new Date(), lockedUntil: null } }
  );
  if (res.matchedCount) kickWebhookWorker();
  return res.matchedCount > 0;
}
