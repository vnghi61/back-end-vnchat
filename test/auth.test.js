import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { client, connect, makeRole, setup, signup, waitFor } from "./helpers.js";

let ctx;
before(async () => {
  ctx = await setup("auth");
});
after(async () => {
  await ctx.teardown();
});

describe("auth & sessions", () => {
  it("signup sets the jwt cookie, returns a bearer token and rejects duplicates", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/signup")
      .send({ name: "Nguyễn Văn A", email: "A@Test.vn", password: "secret123" });
    assert.equal(res.status, 201);
    assert.ok(res.body.token);
    assert.equal(res.body.email, "a@test.vn");
    assert.deepEqual(res.body.roles, ["member"]);
    assert.match(res.headers["set-cookie"][0], /^jwt=/);

    const dup = await request(ctx.app).post("/api/auth/signup").send({ name: "X", email: "a@test.vn", password: "secret123" });
    assert.equal(dup.status, 400);
    assert.equal(dup.body.message, "Email already exits");

    const short = await request(ctx.app).post("/api/auth/signup").send({ name: "X", email: "x@test.vn", password: "123" });
    assert.equal(short.status, 400);
  });

  it("login does not reveal whether the email exists", async () => {
    const { email } = await signup(ctx.app, "Login User");
    const wrongPass = await request(ctx.app).post("/api/auth/login").send({ email, password: "nope123" });
    const noUser = await request(ctx.app).post("/api/auth/login").send({ email: "ghost@test.vn", password: "nope123" });
    assert.equal(wrongPass.status, 400);
    assert.equal(noUser.status, 400);
    assert.equal(wrongPass.body.message, noUser.body.message);

    const ok = await request(ctx.app).post("/api/auth/login").send({ email, password: "secret123" });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);
  });

  it("cookie auth works for the legacy /check endpoint", async () => {
    const agent = request.agent(ctx.app);
    const { email } = await signup(ctx.app, "Cookie User");
    await agent.post("/api/auth/login").send({ email, password: "secret123" }).expect(200);
    const check = await agent.get("/api/auth/check");
    assert.equal(check.status, 200);
    assert.equal(check.body.email, email);
    assert.equal(check.body.password, undefined);
  });

  it("lists sessions, revokes one, and logout-all kills every token", async () => {
    const { email, token, api } = await signup(ctx.app, "Multi Device");
    const second = await request(ctx.app).post("/api/auth/login").send({ email, password: "secret123", device: "phone" });
    const api2 = client(ctx.app, second.body.token);

    const list = await api.get("/api/auth/sessions");
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 2);
    const other = list.body.find((s) => !s.current);
    assert.equal(other.device, "phone");

    await api.del(`/api/auth/sessions/${other._id}`).expect(204);
    const revoked = await api2.get("/api/me");
    assert.equal(revoked.status, 401);
    assert.equal(revoked.body.code, "CHAT-401-002");

    await api.post("/api/auth/logout-all").expect(200);
    const after = await client(ctx.app, token).get("/api/me");
    assert.equal(after.status, 401);
  });

  it("logout revokes the session behind the token", async () => {
    const { api } = await signup(ctx.app, "Logout User");
    await api.post("/api/auth/logout").expect(200);
    assert.equal((await api.get("/api/me")).status, 401);
  });

  it("rejects missing and forged tokens", async () => {
    assert.equal((await request(ctx.app).get("/api/me")).body.code, "CHAT-401-000");
    const forged = await client(ctx.app, "abc.def.ghi").get("/api/me");
    assert.equal(forged.status, 401);
    assert.equal(forged.body.code, "CHAT-401-001");
  });

  it("locking an account revokes sessions, disconnects sockets and blocks login", async () => {
    const admin = await signup(ctx.app, "Admin");
    await makeRole(admin.user._id, ["admin", "agent", "member"]);
    const target = await signup(ctx.app, "Target");
    const socket = await connect(ctx, target.token);

    const locked = await admin.api.put(`/api/admin/users/${target.user._id}/status`, { status: "inactive" });
    assert.equal(locked.status, 200);
    assert.equal(locked.body.status, "inactive");
    await waitFor(socket, "session.revoked", (d) => d.reason === "disabled");
    assert.equal((await target.api.get("/api/me")).status, 401);

    const login = await request(ctx.app).post("/api/auth/login").send({ email: target.email, password: "secret123" });
    assert.equal(login.status, 403);
    assert.equal(login.body.code, "CHAT-403-002");
  });

  it("socket connections require a valid token (query userId is not trusted)", async () => {
    const { user } = await signup(ctx.app, "Socket User");
    const { io } = await import("socket.io-client");
    const err = await new Promise((resolve) => {
      const s = io(ctx.url, { query: { userId: String(user._id) }, transports: ["websocket"], forceNew: true });
      ctx.sockets.push(s);
      s.once("connect_error", resolve);
      s.once("connect", () => resolve(null));
    });
    assert.ok(err, "connection without token must fail");
  });

  it("socket accepts the jwt cookie (web clients with withCredentials)", async () => {
    const { token, user } = await signup(ctx.app, "Cookie Socket");
    const { io } = await import("socket.io-client");
    const s = io(ctx.url, { transports: ["websocket"], forceNew: true, extraHeaders: { cookie: `jwt=${token}` } });
    ctx.sockets.push(s);
    const ready = await new Promise((resolve, reject) => {
      s.once("ready", resolve);
      s.once("connect_error", reject);
    });
    assert.equal(ready.userId, String(user._id));
  });

  it("rejects non-http avatar URLs", async () => {
    const { api } = await signup(ctx.app, "Xss");
    const res = await api.patch("/api/me", { profileImage: "javascript:alert(1)" });
    assert.equal(res.body.code, "CHAT-400-000");
    const group = await api.post("/api/conversations/group", {
      title: "g",
      avatarUrl: "javascript:alert(1)",
      memberIds: [String((await signup(ctx.app, "Peer")).user._id)],
    });
    assert.equal(group.body.code, "CHAT-400-000");
  });

  it("PATCH /me updates name (searchable without accents) and avatar upload", async () => {
    const { api } = await signup(ctx.app, "Old Name");
    const res = await api.patch("/api/me", { name: "Trần Thị Bích", profileImage: "data:image/png;base64,iVBORw0KGgo=" });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "Trần Thị Bích");
    assert.match(res.body.profileImage, /^https:\/\/res\.cloudinary\.com\/testcloud\//);

    const searcher = await signup(ctx.app, "Searcher");
    const found = await searcher.api.get("/api/users?q=bich");
    assert.equal(found.status, 200);
    assert.ok(found.body.items.some((u) => u.name === "Trần Thị Bích"));
    assert.equal(found.body.items[0].email, undefined, "email is only visible to admins");
  });

  it("bootstrap returns permissions, limits and unread total", async () => {
    const { api } = await signup(ctx.app, "Boot");
    const res = await api.get("/api/me/bootstrap");
    assert.equal(res.status, 200);
    assert.equal(res.body.permissions.admin, false);
    assert.equal(res.body.unreadTotal, 0);
    assert.ok(res.body.limits.maxMessageChars > 0);
    assert.ok(Array.isArray(res.body.commandRules));
  });
});
