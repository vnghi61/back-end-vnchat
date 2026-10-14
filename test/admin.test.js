import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { makeRole, setup, signup, sleep } from "./helpers.js";

let ctx;
let admin, member, other;
let receiver;
const received = [];
let respondWith = 204;

before(async () => {
  ctx = await setup("admin");
  admin = await signup(ctx.app, "Admin");
  member = await signup(ctx.app, "Member");
  other = await signup(ctx.app, "Other");
  await makeRole(admin.user._id, ["admin", "agent", "member"]);

  receiver = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.statusCode = respondWith;
      res.end();
    });
  });
  await new Promise((r) => receiver.listen(0, "127.0.0.1", r));
});
after(async () => {
  await new Promise((r) => receiver.close(r));
  await ctx.teardown();
});

async function waitForDelivery(predicate, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const hit = received.find(predicate);
    if (hit) return hit;
    await sleep(25);
  }
  throw new Error("webhook not received");
}

describe("admin: users, roles, policies", () => {
  it("members cannot reach admin routes", async () => {
    const res = await member.api.get("/api/admin/users");
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "CHAT-403-000");
  });

  it("admin lists users with emails and roles", async () => {
    const res = await admin.api.get("/api/admin/users?q=mem");
    assert.equal(res.status, 200);
    const m = res.body.items.find((u) => String(u._id) === String(member.user._id));
    assert.equal(m.email, member.email);
    assert.deepEqual(m.roles, ["member"]);
  });

  it("granting the agent role opens the support queue", async () => {
    assert.equal((await member.api.get("/api/support/queue")).status, 403);
    const res = await admin.api.put(`/api/admin/users/${member.user._id}/roles`, { roles: ["agent", "member"] });
    assert.deepEqual(res.body.roles, ["agent", "member"]);
    assert.equal((await member.api.get("/api/support/queue")).status, 200);
  });

  it("the last admin cannot drop the admin role or lock themselves", async () => {
    const drop = await admin.api.put(`/api/admin/users/${admin.user._id}/roles`, { roles: ["member"] });
    assert.equal(drop.body.code, "CHAT-409-000");
    const lock = await admin.api.put(`/api/admin/users/${admin.user._id}/status`, { status: "inactive" });
    assert.equal(lock.body.code, "CHAT-400-000");
  });

  it("policies are editable but admin cannot lock itself out", async () => {
    const current = await admin.api.get("/api/admin/policies");
    assert.ok(current.body.rules.length >= 6);
    assert.ok(current.body.objects.includes("admin:audit"));

    const lockout = await admin.api.put("/api/admin/policies", { rules: [{ sub: "member", obj: "chat", act: "*" }] });
    assert.equal(lockout.body.code, "CHAT-400-009");
    const unknown = await admin.api.put("/api/admin/policies", { rules: [...current.body.rules, { sub: "member", obj: "admin:nope", act: "read" }] });
    assert.equal(unknown.body.code, "CHAT-400-009");

    assert.equal((await other.api.get("/api/admin/audit")).status, 403);
    const extended = await admin.api.put("/api/admin/policies", {
      rules: [...current.body.rules, { sub: "member", obj: "admin:audit", act: "read" }],
    });
    assert.equal(extended.status, 200);
    assert.equal((await other.api.get("/api/admin/audit")).status, 200);
    assert.equal((await other.api.get("/api/admin/webhooks")).status, 403, "admin:audit does not grant other admin objects");
    await admin.api.put("/api/admin/policies", { rules: current.body.rules }).expect(200);
    assert.equal((await other.api.get("/api/admin/audit")).status, 403);
  });

  it("settings: branding, sticker catalogue validation, command rules", async () => {
    const dup = await admin.api.put("/api/admin/settings", {
      stickerPacks: [{ id: "p", name: "P", stickers: [{ id: "a" }, { id: "a" }] }],
    });
    assert.equal(dup.body.code, "CHAT-400-000");

    const ok = await admin.api.put("/api/admin/settings", {
      branding: { appName: "VNChat Pro" },
      stickerPacks: [{ id: "cat", name: "Mèo", stickers: [{ id: "meo", name: "Meo", emoji: "🐱" }] }],
      commandRules: [{ name: "kpi", description: "KPI", enabled: true }],
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.branding.appName, "VNChat Pro");
    assert.equal(ok.body.policies, undefined);
    const packs = await other.api.get("/api/stickers");
    assert.equal(packs.body[0].id, "cat");
    const boot = await other.api.get("/api/me/bootstrap");
    assert.equal(boot.body.branding.appName, "VNChat Pro");
    assert.deepEqual(boot.body.commandRules.map((r) => r.name), ["kpi"]);
  });

  it("audit log records admin actions", async () => {
    const res = await admin.api.get("/api/admin/audit?limit=100");
    const actions = res.body.items.map((a) => a.action);
    assert.ok(actions.includes("user.roles.updated"));
    assert.ok(actions.includes("policy.updated"));
    assert.ok(actions.includes("settings.updated"));
    const byActor = await admin.api.get(`/api/admin/audit?actorId=${admin.user._id}&action=policy.updated`);
    assert.ok(byActor.body.items.length >= 2);
  });
});

describe("webhooks", () => {
  let hook;
  let secret;

  it("rejects bad or blocked URLs", async () => {
    const ftp = await admin.api.post("/api/admin/webhooks", { name: "x", url: "ftp://example.com", events: ["*"] });
    assert.equal(ftp.body.code, "CHAT-400-000");
    const metadata = await admin.api.post("/api/admin/webhooks", { name: "x", url: "http://169.254.169.254/latest", events: ["*"] });
    assert.equal(metadata.body.code, "CHAT-400-000");
    const badEvent = await admin.api.post("/api/admin/webhooks", { name: "x", url: "https://example.com", events: ["nope"] });
    assert.equal(badEvent.body.code, "CHAT-400-000");
  });

  it("delivers signed events", async () => {
    const res = await admin.api.post("/api/admin/webhooks", {
      name: "ERP",
      url: `http://127.0.0.1:${receiver.address().port}/hooks/chat`,
      events: ["message.created", "chat.command.detected", "conversation.created"],
    });
    assert.equal(res.status, 201);
    hook = res.body.webhook;
    secret = res.body.secret;
    assert.equal(secret.length, 64);
    const list = await admin.api.get("/api/admin/webhooks");
    assert.equal(JSON.stringify(list.body).includes(secret), false, "secret is only returned once");

    const conv = await other.api.post("/api/conversations/direct", { userId: String(admin.user._id) });
    await other.api.post(`/api/conversations/${conv.body._id}/messages`, { text: "/kpi đạt 120%" }).expect(201);

    const cmd = await waitForDelivery((d) => d.headers["x-chat-event"] === "chat.command.detected");
    const msg = await waitForDelivery((d) => d.headers["x-chat-event"] === "message.created");
    const envelope = JSON.parse(msg.body);
    assert.equal(envelope.id, msg.headers["x-chat-delivery"]);
    assert.equal(envelope.data.message.text, "/kpi đạt 120%");
    assert.equal(envelope.data.conversationKind, "direct");
    assert.equal(JSON.parse(cmd.body).data.message.command.name, "kpi");

    const ts = msg.headers["x-auth-timestamp"];
    const bodyHash = crypto.createHash("sha256").update(msg.body).digest("hex");
    const expected = crypto.createHmac("sha256", secret).update(`${ts}\n${bodyHash}`).digest("hex");
    assert.equal(msg.headers["x-auth-body-signature"], expected);

    await sleep(50);
    const deliveries = await admin.api.get(`/api/admin/webhooks/${hook._id}/deliveries`);
    assert.ok(deliveries.body.every((d) => d.status === "delivered"));
    assert.equal(deliveries.body[0].payload, undefined);
  });

  it("retries failures with backoff, marks failed after max attempts, redeliver works", async () => {
    const { WebhookDelivery } = await import("../src/models/admin.model.js");
    const { processDueDeliveries } = await import("../src/services/webhook.service.js");
    respondWith = 500;
    received.length = 0;
    const g = await other.api.post("/api/conversations/group", { title: "Webhook group", memberIds: [String(member.user._id)] });
    assert.equal(g.status, 201);
    await waitForDelivery((d) => d.headers["x-chat-event"] === "conversation.created");
    await sleep(50);

    let delivery = await WebhookDelivery.findOne({ event: "conversation.created" }).lean();
    assert.equal(delivery.status, "pending");
    assert.equal(delivery.attempts, 1);
    assert.equal(delivery.lastStatusCode, 500);
    assert.ok(delivery.nextAttemptAt > new Date(), "next attempt is scheduled in the future");

    for (let i = 0; i < 2; i++) {
      await WebhookDelivery.updateOne({ _id: delivery._id }, { $set: { nextAttemptAt: new Date() } });
      await processDueDeliveries();
    }
    delivery = await WebhookDelivery.findById(delivery._id).lean();
    assert.equal(delivery.attempts, 3);
    assert.equal(delivery.status, "failed");

    respondWith = 204;
    await admin.api.post(`/api/admin/webhooks/deliveries/${delivery._id}/redeliver`).expect(204);
    await sleep(100);
    delivery = await WebhookDelivery.findById(delivery._id).lean();
    assert.equal(delivery.status, "delivered");
  });

  it("disabled subscriptions receive nothing", async () => {
    await admin.api
      .put(`/api/admin/webhooks/${hook._id}`, { name: "ERP", url: hook.url, events: hook.events, enabled: false })
      .expect(200);
    received.length = 0;
    const conv = await other.api.post("/api/conversations/direct", { userId: String(admin.user._id) });
    await other.api.post(`/api/conversations/${conv.body._id}/messages`, { text: "im lặng" }).expect(201);
    await sleep(150);
    assert.equal(received.length, 0);
    await admin.api.del(`/api/admin/webhooks/${hook._id}`).expect(204);
    assert.equal((await admin.api.get(`/api/admin/webhooks/${hook._id}/deliveries`)).body.code, "CHAT-404-006");
  });
});
