import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import request from "supertest";
import { client, setup } from "./helpers.js";

// Dữ liệu từ bản cũ: user không có kind/roles, index email unique toàn phần, tin nhắn chỉ có senderId/receiverId.
let ctx;
let a, b;

before(async () => {
  ctx = await setup("migration");
  const db = mongoose.connection.db;
  await db.collection("users").dropIndexes();
  await db.collection("users").createIndex({ email: 1 }, { unique: true, name: "email_1" });
  const password = await bcrypt.hash("secret123", 10);
  const now = Date.now();
  const users = await db.collection("users").insertMany([
    { name: "Ông Già", email: "old1@test.vn", password, profileImage: "", createdAt: new Date(now - 10_000) },
    { name: "Bà Cụ", email: "old2@test.vn", password, profileImage: "", createdAt: new Date(now - 10_000) },
  ]);
  a = users.insertedIds[0];
  b = users.insertedIds[1];
  await db.collection("messages").insertMany([
    { senderId: a, receiverId: b, text: "tin cũ 1", createdAt: new Date(now - 3000), updatedAt: new Date(now - 3000) },
    { senderId: b, receiverId: a, text: "tin cũ 2", createdAt: new Date(now - 2000), updatedAt: new Date(now - 2000) },
    { senderId: a, receiverId: b, image: "https://res.cloudinary.com/testcloud/image/upload/v1/old.png", createdAt: new Date(now - 1000), updatedAt: new Date(now - 1000) },
  ]);

  const { runMigrations } = await import("../src/services/migration.service.js");
  await runMigrations();
  await runMigrations(); // idempotent
});
after(async () => {
  await ctx.teardown();
});

describe("legacy data migration", () => {
  it("old messages become a direct conversation with ordered seq, marked as read", async () => {
    const login = await request(ctx.app).post("/api/auth/login").send({ email: "old1@test.vn", password: "secret123" });
    assert.equal(login.status, 200);
    const api = client(ctx.app, login.body.token);

    const legacy = await api.get(`/api/messages/${b}`);
    assert.deepEqual(legacy.body.map((m) => m.seq), [1, 2, 3]);
    assert.equal(legacy.body[0].text, "tin cũ 1");
    assert.equal(legacy.body[2].attachments[0].kind, "image");

    const inbox = await api.get("/api/conversations");
    assert.equal(inbox.body.items.length, 1);
    const conv = inbox.body.items[0];
    assert.equal(conv.kind, "direct");
    assert.equal(conv.lastSeq, 3);
    assert.equal(conv.unreadCount, 0);
    assert.equal(conv.lastMessage.preview, "[Hình ảnh]");

    const sent = await api.post(`/api/messages/send/${b}`, { text: "tin mới" });
    assert.equal(sent.body.seq, 4);
    const media = await api.get(`/api/conversations/${conv._id}/media?kind=image`);
    assert.equal(media.body.items.length, 1);
  });

  it("old users get default kind/roles and accent-free search", async () => {
    const login = await request(ctx.app).post("/api/auth/login").send({ email: "old2@test.vn", password: "secret123" });
    assert.deepEqual(login.body.roles, ["member"]);
    const found = await client(ctx.app, login.body.token).get("/api/users?q=ong");
    assert.ok(found.body.items.some((u) => u.name === "Ông Già"));
  });

  it("the old full unique email index is replaced so several guests can exist", async () => {
    const r1 = await request(ctx.app).post("/api/widget/sessions").send({});
    const r2 = await request(ctx.app).post("/api/widget/sessions").send({});
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
  });
});
