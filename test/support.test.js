import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { clearEvents, client, connect, makeRole, setup, signup, waitFor } from "./helpers.js";

let ctx;
let admin, agent1, agent2, member;
let sAdmin, sAgent1, sAgent2;
let visitor, sVisitor;

before(async () => {
  ctx = await setup("support");
  admin = await signup(ctx.app, "Admin");
  agent1 = await signup(ctx.app, "Agent One");
  agent2 = await signup(ctx.app, "Agent Two");
  member = await signup(ctx.app, "Member");
  await makeRole(admin.user._id, ["admin", "agent", "member"]);
  await makeRole(agent1.user._id, ["agent", "member"]);
  await makeRole(agent2.user._id, ["agent", "member"]);
  sAdmin = await connect(ctx, admin.token);
  sAgent1 = await connect(ctx, agent1.token);
  sAgent2 = await connect(ctx, agent2.token);
});
after(async () => {
  await ctx.teardown();
});

describe("support with human agents", () => {
  let conv;

  it("widget session creates a visitor that can be resumed with visitorToken", async () => {
    const res = await request(ctx.app).post("/api/widget/sessions").send({ name: "Khách Lan", email: "lan@khach.vn" });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.kind, "visitor");
    assert.match(res.body.visitorToken, /^v1\./);
    visitor = { ...res.body, api: client(ctx.app, res.body.token) };

    const resumed = await request(ctx.app).post("/api/widget/sessions").send({ visitorToken: res.body.visitorToken });
    assert.equal(String(resumed.body.user._id), String(res.body.user._id));
    const forged = await request(ctx.app).post("/api/widget/sessions").send({ visitorToken: `v1.${res.body.user._id}.${"0".repeat(32)}` });
    assert.notEqual(String(forged.body.user._id), String(res.body.user._id));
    sVisitor = await connect(ctx, visitor.token);
  });

  it("visitors cannot use internal chat features", async () => {
    assert.equal((await visitor.api.get("/api/users")).status, 403);
    assert.equal((await visitor.api.get("/api/messages/users")).status, 403);
    assert.ok(!sVisitor.events.some((e) => e.event === "getOnlineUsers"), "guests do not get the online list");
    assert.equal((await visitor.api.post("/api/conversations/direct", { userId: String(member.user._id) })).status, 403);
    assert.equal((await visitor.api.get("/api/support/queue")).status, 403);
  });

  it("starting support puts the conversation in the waiting queue (one open per customer)", async () => {
    clearEvents(sAgent1);
    const res = await visitor.api.post("/api/support/conversations", { meta: { page: "/pricing" }, text: "Cho mình hỏi giá" });
    assert.equal(res.status, 201);
    conv = res.body;
    assert.equal(conv.kind, "support");
    assert.equal(conv.support.status, "waiting_agent");
    assert.equal(conv.support.customer.name, "Khách Lan");
    assert.equal(conv.support.meta.page, "/pricing");

    const again = await visitor.api.post("/api/support/conversations", {});
    assert.equal(again.status, 200);
    assert.equal(String(again.body._id), String(conv._id));

    await waitFor(sAgent1, "support.updated", (d) => String(d.conversationId) === String(conv._id) && d.status === "waiting_agent");
    const msg = await waitFor(sAgent1, "support.message", (d) => d.message.text === "Cho mình hỏi giá");
    assert.equal(msg.status, "waiting_agent");

    const history = await visitor.api.get(`/api/conversations/${conv._id}/messages`);
    assert.equal(history.body.items[0].text, "support.started");
    assert.ok(history.body.items[0].metadata.welcomeMessage);
  });

  it("agents see the queue and can read (not write) unassigned tickets", async () => {
    const queue = await agent1.api.get("/api/support/queue?status=waiting_agent");
    assert.equal(queue.status, 200);
    assert.ok(queue.body.items.some((c) => String(c._id) === String(conv._id)));
    assert.equal((await member.api.get("/api/support/queue")).body.code, "CHAT-403-006");

    const read = await agent1.api.get(`/api/conversations/${conv._id}/messages`);
    assert.equal(read.status, 200);
    const write = await agent1.api.post(`/api/conversations/${conv._id}/messages`, { text: "chưa nhận" });
    assert.equal(write.body.code, "CHAT-403-003");
    assert.equal((await member.api.get(`/api/conversations/${conv._id}`)).body.code, "CHAT-403-003");
  });

  it("an agent can watch an unassigned ticket in realtime", async () => {
    const ack = await new Promise((resolve) => sAgent2.emit("support:watch", { conversationId: String(conv._id) }, resolve));
    assert.equal(ack.ok, true);
    clearEvents(sAgent2);
    await visitor.api.post(`/api/conversations/${conv._id}/messages`, { text: "có ai không?" }).expect(201);
    await waitFor(sAgent2, "message.new", (m) => m.text === "có ai không?");
    const denied = await new Promise((resolve) => sVisitor.emit("support:watch", { conversationId: String(conv._id) }, resolve));
    assert.equal(denied.ok, false);
  });

  it("assign is first-come-first-served", async () => {
    clearEvents(sVisitor, sAgent1);
    const [a, b] = await Promise.all([
      agent1.api.post(`/api/support/conversations/${conv._id}/assign`, {}),
      agent2.api.post(`/api/support/conversations/${conv._id}/assign`, {}),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const winner = a.status === 200 ? agent1 : agent2;
    const loser = a.status === 200 ? b : a;
    assert.equal(loser.body.code, "CHAT-409-006");

    // chuẩn hoá: agent1 phụ trách cho các bước sau
    if (winner === agent2) {
      await agent2.api.post(`/api/support/conversations/${conv._id}/transfer`, { agentId: String(agent1.user._id) }).expect(200);
    }
    const state = await visitor.api.get(`/api/conversations/${conv._id}`);
    assert.equal(state.body.support.status, "agent");
    assert.equal(String(state.body.support.assigneeId), String(agent1.user._id));
    await waitFor(sVisitor, "support.updated", (d) => d.status === "agent");
  });

  it("assigned agent chats with the customer", async () => {
    clearEvents(sVisitor);
    const res = await agent1.api.post(`/api/conversations/${conv._id}/messages`, { text: "Chào chị, em hỗ trợ ạ" });
    assert.equal(res.status, 201);
    await waitFor(sVisitor, "message.new", (m) => m.text === "Chào chị, em hỗ trợ ạ");
    await agent1.api.post(`/api/conversations/${conv._id}/typing`, { typing: true }).expect(204);
    await waitFor(sVisitor, "typing", (d) => String(d.user._id) === String(agent1.user._id));
    const mine = await agent1.api.get("/api/support/queue?mine=true");
    assert.ok(mine.body.items.some((c) => String(c._id) === String(conv._id)));
  });

  it("transfer: only the assignee or an admin, target must be an agent", async () => {
    assert.equal((await agent2.api.post(`/api/support/conversations/${conv._id}/transfer`, { agentId: String(agent2.user._id) })).status, 403);
    const notAgent = await agent1.api.post(`/api/support/conversations/${conv._id}/transfer`, { agentId: String(member.user._id) });
    assert.equal(notAgent.body.code, "CHAT-400-000");

    clearEvents(sAgent2, sAgent1);
    const ok = await agent1.api.post(`/api/support/conversations/${conv._id}/transfer`, { agentId: String(agent2.user._id) });
    assert.equal(ok.status, 200);
    assert.equal(String(ok.body.support.assigneeId), String(agent2.user._id));
    await waitFor(sAgent2, "conversation.new", (c) => String(c._id) === String(conv._id));
    await waitFor(sAgent1, "conversation.member.removed", (d) => String(d.conversationId) === String(conv._id));
    assert.equal((await agent1.api.post(`/api/conversations/${conv._id}/messages`, { text: "?" })).body.code, "CHAT-403-003");

    const agents = await agent1.api.get("/api/support/agents");
    assert.ok(agents.body.some((a) => String(a._id) === String(agent2.user._id) && a.online));
  });

  it("release returns the ticket to the queue; only admins assign to someone else", async () => {
    const released = await agent2.api.post(`/api/support/conversations/${conv._id}/release`);
    assert.equal(released.body.support.status, "waiting_agent");
    const denied = await agent2.api.post(`/api/support/conversations/${conv._id}/assign`, { agentId: String(agent1.user._id) });
    assert.equal(denied.status, 403);
    const byAdmin = await admin.api.post(`/api/support/conversations/${conv._id}/assign`, { agentId: String(agent1.user._id) });
    assert.equal(byAdmin.status, 200);
    assert.equal(String(byAdmin.body.support.assigneeId), String(agent1.user._id));
  });

  it("tags, close by customer, rating and stats", async () => {
    await agent1.api.put(`/api/support/conversations/${conv._id}/tags`, { tags: ["Billing", "vip"] }).expect(204);
    const tagged = await agent1.api.get("/api/support/queue?tag=billing");
    assert.ok(tagged.body.items.some((c) => String(c._id) === String(conv._id)));

    clearEvents(sAgent1);
    await visitor.api.post(`/api/support/conversations/${conv._id}/close`).expect(204);
    await waitFor(sAgent1, "support.updated", (d) => d.status === "closed");
    assert.equal((await visitor.api.post(`/api/conversations/${conv._id}/messages`, { text: "còn đó không" })).body.code, "CHAT-409-003");

    assert.equal((await agent1.api.post(`/api/support/conversations/${conv._id}/rate`, { rating: 5 })).body.code, "CHAT-403-003");
    await visitor.api.post(`/api/support/conversations/${conv._id}/rate`, { rating: 4, note: "Nhanh" }).expect(204);
    const stats = await admin.api.get("/api/support/stats");
    assert.equal(stats.body.closed, 1);
    assert.equal(stats.body.averageRating, 4);
  });

  it("a closed ticket lets the customer open a new one; reopen respects one-open-per-customer", async () => {
    const fresh = await visitor.api.post("/api/support/conversations", {});
    assert.equal(fresh.status, 201);
    assert.notEqual(String(fresh.body._id), String(conv._id));

    const conflict = await agent1.api.post(`/api/support/conversations/${conv._id}/reopen`);
    assert.equal(conflict.body.code, "CHAT-409-000");

    await agent1.api.post(`/api/support/conversations/${fresh.body._id}/close`).expect(204);
    const reopened = await agent1.api.post(`/api/support/conversations/${conv._id}/reopen`);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.support.status, "agent", "keeps the previous assignee");
    const mine = await visitor.api.get("/api/support/conversations/mine");
    assert.equal(mine.body.length, 2);
  });

  it("registered users can ask for support too", async () => {
    const res = await member.api.post("/api/support/conversations", { text: "Tài khoản bị lỗi" });
    assert.equal(res.status, 201);
    assert.equal(res.body.support.customer.name, "Member");
  });

  it("admin can disable the widget", async () => {
    await admin.api.put("/api/admin/settings", { widget: { enabled: false } }).expect(200);
    const res = await request(ctx.app).post("/api/widget/sessions").send({});
    assert.equal(res.body.code, "CHAT-403-001");
    await admin.api.put("/api/admin/settings", { widget: { enabled: true } }).expect(200);
  });

  describe("partner API (/api/open/v1)", () => {
    let key;
    let readOnlyKey;

    it("API keys are shown once and stored hashed", async () => {
      const res = await admin.api.post("/api/admin/api-keys", { name: "CRM", scopes: ["conversations:read", "messages:read", "messages:write", "support:write"] });
      assert.equal(res.status, 201);
      assert.match(res.body.key, /^ck_[a-f0-9]{48}$/);
      key = res.body.key;
      const list = await admin.api.get("/api/admin/api-keys");
      assert.equal(list.body.items[0].prefix, key.slice(0, 12));
      assert.equal(JSON.stringify(list.body).includes(key), false);
      readOnlyKey = (await admin.api.post("/api/admin/api-keys", { name: "RO", scopes: ["conversations:read"] })).body;
    });

    it("reads support conversations and posts as the key's bot", async () => {
      const got = await request(ctx.app).get(`/api/open/v1/conversations/${conv._id}`).set("X-Api-Key", key);
      assert.equal(got.status, 200);
      assert.equal(got.body.kind, "support");

      clearEvents(sVisitor);
      const posted = await request(ctx.app)
        .post(`/api/open/v1/conversations/${conv._id}/messages`)
        .set("Authorization", `Bearer ${key}`)
        .send({ text: "Đơn hàng #123 đã giao" });
      assert.equal(posted.status, 201);
      assert.equal(posted.body.sender.kind, "bot");
      assert.equal(posted.body.sender.name, "CRM");
      await waitFor(sVisitor, "message.new", (m) => m.text === "Đơn hàng #123 đã giao");

      const msgs = await request(ctx.app).get(`/api/open/v1/conversations/${conv._id}/messages?limit=2`).set("X-Api-Key", key);
      assert.equal(msgs.body.items.length, 2);
      assert.equal(msgs.body.items[1].text, "Đơn hàng #123 đã giao");
    });

    it("cannot touch internal conversations; scopes and revocation are enforced", async () => {
      const group = await member.api.post("/api/conversations/group", { title: "Nội bộ", memberIds: [String(agent1.user._id)] });
      const hidden = await request(ctx.app).get(`/api/open/v1/conversations/${group.body._id}`).set("X-Api-Key", key);
      assert.equal(hidden.body.code, "CHAT-404-002");

      const scoped = await request(ctx.app)
        .post(`/api/open/v1/conversations/${conv._id}/messages`)
        .set("X-Api-Key", readOnlyKey.key)
        .send({ text: "x" });
      assert.equal(scoped.body.code, "CHAT-403-007");

      await admin.api.del(`/api/admin/api-keys/${readOnlyKey.apiKey._id}`).expect(204);
      const revoked = await request(ctx.app).get(`/api/open/v1/conversations/${conv._id}`).set("X-Api-Key", readOnlyKey.key);
      assert.equal(revoked.body.code, "CHAT-401-005");
      assert.equal((await request(ctx.app).get(`/api/open/v1/conversations/${conv._id}`).set("X-Api-Key", "ck_bad")).status, 401);
    });

    it("closes a ticket", async () => {
      await request(ctx.app).post(`/api/open/v1/support/conversations/${conv._id}/close`).set("X-Api-Key", key).expect(204);
      const state = await admin.api.get(`/api/conversations/${conv._id}`);
      assert.equal(state.body.support.status, "closed");
    });
  });
});
