import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { clearEvents, connect, setup, signup, sleep, waitFor } from "./helpers.js";

let ctx;
let alice, bob, carol, dave;
let sa, sb, sc;

before(async () => {
  ctx = await setup("chat");
  alice = await signup(ctx.app, "Alice");
  bob = await signup(ctx.app, "Bob");
  carol = await signup(ctx.app, "Carol");
  dave = await signup(ctx.app, "Dave");
  sa = await connect(ctx, alice.token);
  sb = await connect(ctx, bob.token);
  sc = await connect(ctx, carol.token);
});
after(async () => {
  await ctx.teardown();
});

describe("legacy 1-1 API stays compatible", () => {
  it("POST /api/messages/send/:id creates the direct conversation and notifies the receiver", async () => {
    const res = await alice.api.post(`/api/messages/send/${bob.user._id}`, { text: "chào Bob" });
    assert.equal(res.status, 201);
    assert.equal(res.body.text, "chào Bob");
    assert.equal(String(res.body.receiverId), String(bob.user._id));
    assert.equal(res.body.seq, 1);

    const legacy = await waitFor(sb, "newMessage", (m) => m.text === "chào Bob");
    assert.equal(String(legacy.senderId), String(alice.user._id));
    await waitFor(sb, "message.new", (m) => m.text === "chào Bob");

    const list = await bob.api.get(`/api/messages/${alice.user._id}`);
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(String(list.body[0].receiverId), String(bob.user._id));

    const sidebar = await bob.api.get("/api/messages/users");
    assert.ok(sidebar.body.some((u) => String(u._id) === String(alice.user._id)));
    assert.ok(sidebar.body.every((u) => u.password === undefined));
  });

  it("legacy image field is uploaded and exposed as image + attachment", async () => {
    const res = await alice.api.post(`/api/messages/send/${bob.user._id}`, { image: "data:image/png;base64,iVBORw0KGgo=" });
    assert.equal(res.status, 201);
    assert.match(res.body.image, /^https:\/\/res\.cloudinary\.com\/testcloud\//);
    assert.equal(res.body.attachments[0].kind, "image");
    assert.equal(res.body.type, "file");
  });
});

describe("conversations", () => {
  let direct;
  let group;

  it("direct: 200 when it already exists, 400 with yourself", async () => {
    const again = await alice.api.post("/api/conversations/direct", { userId: String(bob.user._id) });
    assert.equal(again.status, 200);
    assert.equal(again.body.kind, "direct");
    assert.equal(again.body.title, "Bob");
    direct = again.body;
    const self = await alice.api.post("/api/conversations/direct", { userId: String(alice.user._id) });
    assert.equal(self.body.code, "CHAT-400-001");
  });

  it("group: creator is owner, members get conversation.new + system message", async () => {
    clearEvents(sb, sc);
    const res = await alice.api.post("/api/conversations/group", {
      title: "Dự án A",
      memberIds: [String(bob.user._id), String(carol.user._id)],
    });
    assert.equal(res.status, 201);
    group = res.body;
    assert.equal(group.myRole, "owner");
    assert.equal(group.memberCount, 3);
    await waitFor(sb, "conversation.new", (c) => String(c._id) === String(group._id));
    const sys = await waitFor(sc, "message.new", (m) => String(m.conversationId) === String(group._id));
    assert.equal(sys.type, "system");
    assert.equal(sys.text, "group.created");
  });

  it("rename by member → 403, by owner → conversation.updated", async () => {
    const denied = await bob.api.patch(`/api/conversations/${group._id}`, { title: "Hack" });
    assert.equal(denied.body.code, "CHAT-403-004");
    clearEvents(sb);
    const ok = await alice.api.patch(`/api/conversations/${group._id}`, { title: "Dự án B", historyVisibility: "since_join" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.title, "Dự án B");
    assert.equal(ok.body.historyVisibility, "since_join");
    await waitFor(sb, "conversation.updated", (c) => c.title === "Dự án B");
  });

  it("since_join: a member added later cannot read earlier history", async () => {
    await alice.api.post(`/api/conversations/${group._id}/messages`, { text: "bí mật trước khi Dave vào" }).expect(201);
    const add = await alice.api.post(`/api/conversations/${group._id}/members`, { memberIds: [String(dave.user._id)] });
    assert.equal(add.status, 200);
    assert.equal(add.body.memberCount, 4);
    const dup = await alice.api.post(`/api/conversations/${group._id}/members`, { memberIds: [String(dave.user._id)] });
    assert.equal(dup.body.code, "CHAT-409-001");

    await bob.api.post(`/api/conversations/${group._id}/messages`, { text: "chào Dave" }).expect(201);
    const daveView = await dave.api.get(`/api/conversations/${group._id}/messages`);
    const texts = daveView.body.items.map((m) => m.text);
    assert.ok(texts.includes("chào Dave"));
    assert.ok(!texts.includes("bí mật trước khi Dave vào"));
    const conv = await dave.api.get(`/api/conversations/${group._id}`);
    // unread = system "member.added" + "chào Dave"; lịch sử trước khi vào không tính
    assert.equal(conv.body.unreadCount, 2);
  });

  it("roles: owner promotes, last owner cannot leave, removed member loses access", async () => {
    await alice.api.patch(`/api/conversations/${group._id}/members/${bob.user._id}`, { role: "admin" }).expect(204);
    const notOwner = await bob.api.patch(`/api/conversations/${group._id}/members/${carol.user._id}`, { role: "admin" });
    assert.equal(notOwner.body.code, "CHAT-403-004");

    const leave = await alice.api.post(`/api/conversations/${group._id}/leave`);
    assert.equal(leave.body.code, "CHAT-409-002");

    clearEvents(sc);
    await bob.api.del(`/api/conversations/${group._id}/members/${carol.user._id}`).expect(204);
    await waitFor(sc, "conversation.member.removed", (d) => String(d.conversationId) === String(group._id));
    const gone = await carol.api.get(`/api/conversations/${group._id}/messages`);
    assert.equal(gone.body.code, "CHAT-403-003");

    await dave.api.post(`/api/conversations/${group._id}/leave`).expect(204);
    const list = await dave.api.get("/api/conversations");
    assert.ok(!list.body.items.some((c) => String(c._id) === String(group._id)));
  });

  it("read receipts and unread counts", async () => {
    await alice.api.post(`/api/conversations/${direct._id}/messages`, { text: "một" }).expect(201);
    await alice.api.post(`/api/conversations/${direct._id}/messages`, { text: "hai" }).expect(201);
    const before = await bob.api.get(`/api/conversations/${direct._id}`);
    assert.ok(before.body.unreadCount >= 2);
    clearEvents(sa);
    await bob.api.post(`/api/conversations/${direct._id}/read`, {}).expect(204);
    const read = await waitFor(sa, "read.updated", (d) => String(d.userId) === String(bob.user._id));
    assert.equal(read.seq, before.body.lastSeq);
    const afterRead = await bob.api.get(`/api/conversations/${direct._id}`);
    assert.equal(afterRead.body.unreadCount, 0);
  });

  it("mute / pin / archive are per-user and a new message unarchives", async () => {
    const mute = await bob.api.post(`/api/conversations/${direct._id}/mute`, { minutes: -1 });
    assert.equal(mute.body.mutedForever, true);
    const pin = await bob.api.post(`/api/conversations/${direct._id}/pin`, { pinned: true });
    assert.equal(pin.body.pinned, true);
    const pinned = await bob.api.get("/api/conversations?pinned=true");
    assert.equal(pinned.body.items.length, 1);

    await bob.api.post(`/api/conversations/${direct._id}/archive`, { archived: true }).expect(200);
    let inbox = await bob.api.get("/api/conversations");
    assert.ok(!inbox.body.items.some((c) => String(c._id) === String(direct._id)));
    const archived = await bob.api.get("/api/conversations?archived=true");
    assert.ok(archived.body.items.some((c) => String(c._id) === String(direct._id)));

    await alice.api.post(`/api/conversations/${direct._id}/messages`, { text: "dậy đi" }).expect(201);
    inbox = await bob.api.get("/api/conversations");
    const conv = inbox.body.items.find((c) => String(c._id) === String(direct._id));
    assert.ok(conv, "new message unarchives");
    assert.equal(conv.muted, true);
    const aliceView = await alice.api.get(`/api/conversations/${direct._id}`);
    assert.equal(aliceView.body.muted, false);
  });

  it("inbox pagination with cursor", async () => {
    for (let i = 0; i < 3; i++) {
      const g = await carol.api.post("/api/conversations/group", { title: `G${i}`, memberIds: [String(dave.user._id)] });
      assert.equal(g.status, 201);
    }
    const page1 = await dave.api.get("/api/conversations?limit=2");
    assert.equal(page1.body.items.length, 2);
    assert.equal(page1.body.hasMore, true);
    const page2 = await dave.api.get(`/api/conversations?limit=2&cursor=${page1.body.nextCursor}`);
    assert.ok(page2.body.items.length >= 1);
    const ids = new Set([...page1.body.items, ...page2.body.items].map((c) => String(c._id)));
    assert.equal(ids.size, page1.body.items.length + page2.body.items.length);
  });

  describe("messages", () => {
    let m1;

    it("clientMsgId makes sending idempotent", async () => {
      const first = await alice.api.post(`/api/conversations/${direct._id}/messages`, { text: "idem", clientMsgId: "c-1" });
      const second = await alice.api.post(`/api/conversations/${direct._id}/messages`, { text: "idem", clientMsgId: "c-1" });
      assert.equal(first.status, 201);
      assert.equal(second.status, 200);
      assert.equal(String(first.body._id), String(second.body._id));
      m1 = first.body;
    });

    it("validates content: empty, too long, non-member", async () => {
      assert.equal((await alice.api.post(`/api/conversations/${direct._id}/messages`, { text: "   " })).body.code, "CHAT-400-005");
      const long = "x".repeat(8001);
      assert.equal((await alice.api.post(`/api/conversations/${direct._id}/messages`, { text: long })).body.code, "CHAT-400-004");
      assert.equal((await carol.api.post(`/api/conversations/${direct._id}/messages`, { text: "hi" })).body.code, "CHAT-403-003");
    });

    it("reply carries a preview; mentions outside the conversation are dropped", async () => {
      const res = await bob.api.post(`/api/conversations/${direct._id}/messages`, {
        text: "trả lời nè",
        replyTo: String(m1._id),
        mentions: [String(alice.user._id), String(carol.user._id)],
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.replyPreview.text, "idem");
      assert.equal(res.body.replyPreview.senderName, "Alice");
      assert.deepEqual(res.body.mentions.map(String), [String(alice.user._id)]);
    });

    it("edit: only the sender; emits message.updated", async () => {
      const denied = await bob.api.patch(`/api/conversations/${direct._id}/messages/${m1._id}`, { text: "hack" });
      assert.equal(denied.body.code, "CHAT-403-005");
      clearEvents(sb);
      const ok = await alice.api.patch(`/api/conversations/${direct._id}/messages/${m1._id}`, { text: "đã sửa https://example.com" });
      assert.equal(ok.status, 200);
      assert.ok(ok.body.editedAt);
      assert.deepEqual(ok.body.links, ["https://example.com"]);
      await waitFor(sb, "message.updated", (m) => String(m._id) === String(m1._id));
    });

    it("reactions: add, list mine, remove", async () => {
      clearEvents(sa);
      const r1 = await bob.api.post(`/api/conversations/${direct._id}/messages/${m1._id}/reactions`, { emoji: "👍" });
      assert.equal(r1.status, 200);
      assert.equal(r1.body.reactions[0].count, 1);
      assert.equal(r1.body.reactions[0].mine, true);
      await alice.api.post(`/api/conversations/${direct._id}/messages/${m1._id}/reactions`, { emoji: "👍" }).expect(200);
      await alice.api.post(`/api/conversations/${direct._id}/messages/${m1._id}/reactions`, { emoji: "❤️" }).expect(200);
      await waitFor(sa, "reaction.updated", (m) => m.reactions.some((r) => r.emoji === "❤️"));
      const removed = await bob.api.del(`/api/conversations/${direct._id}/messages/${m1._id}/reactions/${encodeURIComponent("👍")}`);
      const thumbs = removed.body.reactions.find((r) => r.emoji === "👍");
      assert.equal(thumbs.count, 1);
      assert.equal(thumbs.mine, false);
      const bad = await bob.api.post(`/api/conversations/${direct._id}/messages/${m1._id}/reactions`, { emoji: "a b" });
      assert.equal(bad.body.code, "CHAT-400-000");
    });

    it("pin / list pins / unpin", async () => {
      clearEvents(sb);
      const pin = await alice.api.post(`/api/conversations/${direct._id}/messages/${m1._id}/pin`);
      assert.ok(pin.body.pinnedAt);
      await waitFor(sb, "message.pinned", (d) => String(d.messageId) === String(m1._id));
      const pins = await bob.api.get(`/api/conversations/${direct._id}/pins`);
      assert.equal(pins.body.items.length, 1);
      await bob.api.del(`/api/conversations/${direct._id}/messages/${m1._id}/pin`).expect(204);
      assert.equal((await bob.api.get(`/api/conversations/${direct._id}/pins`)).body.items.length, 0);
    });

    it("hide only for me", async () => {
      clearEvents(sb);
      await bob.api.post(`/api/conversations/${direct._id}/messages/${m1._id}/hide`).expect(204);
      await waitFor(sb, "message.hidden", (d) => d.hidden === true);
      assert.equal((await bob.api.get(`/api/conversations/${direct._id}/messages/${m1._id}`)).status, 404);
      assert.equal((await alice.api.get(`/api/conversations/${direct._id}/messages/${m1._id}`)).status, 200);
      await bob.api.del(`/api/conversations/${direct._id}/messages/${m1._id}/hide`).expect(204);
      assert.equal((await bob.api.get(`/api/conversations/${direct._id}/messages/${m1._id}`)).status, 200);
    });

    it("forward to several conversations, failures reported per target", async () => {
      const g = await alice.api.post("/api/conversations/group", { title: "Fwd", memberIds: [String(carol.user._id)] });
      const res = await alice.api.post(`/api/conversations/${direct._id}/messages/${m1._id}/forward`, {
        conversationIds: [String(g.body._id), "0123456789abcdef01234567"],
      });
      assert.equal(res.status, 201);
      const ok = res.body.results.find((r) => r.message);
      assert.equal(String(ok.message.forwardedFrom.messageId), String(m1._id));
      assert.equal(ok.message.text, "đã sửa https://example.com");
      assert.equal(res.body.results.find((r) => r.error).error.code, "CHAT-404-002");
    });

    it("delete: tombstone, sender only in direct, owner can delete in group", async () => {
      const victim = await bob.api.post(`/api/conversations/${direct._id}/messages`, { text: "sẽ bị xoá" });
      assert.equal((await alice.api.del(`/api/conversations/${direct._id}/messages/${victim.body._id}`)).body.code, "CHAT-403-005");
      clearEvents(sa);
      await bob.api.del(`/api/conversations/${direct._id}/messages/${victim.body._id}`).expect(204);
      await waitFor(sa, "message.deleted", (d) => String(d.messageId) === String(victim.body._id));
      const tomb = await alice.api.get(`/api/conversations/${direct._id}/messages/${victim.body._id}`);
      assert.ok(tomb.body.deletedAt);
      assert.equal(tomb.body.text, "");
      const conv = await alice.api.get(`/api/conversations/${direct._id}`);
      assert.equal(conv.body.lastMessage.deleted, true);
      assert.equal((await bob.api.del(`/api/conversations/${direct._id}/messages/${victim.body._id}`)).body.code, "CHAT-409-004");

      const g = await alice.api.post("/api/conversations/group", { title: "Mod", memberIds: [String(carol.user._id)] });
      const msg = await carol.api.post(`/api/conversations/${g.body._id}/messages`, { text: "spam" });
      await alice.api.del(`/api/conversations/${g.body._id}/messages/${msg.body._id}`).expect(204);
    });

    it("attachments: data URI upload, direct-upload refs must be in the sender's folder", async () => {
      const up = await alice.api.post(`/api/conversations/${direct._id}/messages`, {
        text: "ảnh nè",
        attachments: [{ data: "data:image/png;base64,iVBORw0KGgo=", name: "a.png" }],
      });
      assert.equal(up.status, 201);
      assert.equal(up.body.attachments[0].kind, "image");

      const folder = `vnchat/u_${alice.user._id}`;
      const ref = await alice.api.post(`/api/conversations/${direct._id}/messages`, {
        attachments: [{
          url: `https://res.cloudinary.com/testcloud/raw/upload/v1/${folder}/report.pdf`,
          publicId: `${folder}/report.pdf`,
          name: "report.pdf",
          size: 2048,
          mime: "application/pdf",
        }],
      });
      assert.equal(ref.status, 201);
      assert.equal(ref.body.type, "file");

      const foreign = await bob.api.post(`/api/conversations/${direct._id}/messages`, {
        attachments: [{ url: `https://res.cloudinary.com/testcloud/raw/upload/v1/${folder}/report.pdf`, publicId: `${folder}/report.pdf`, mime: "application/pdf" }],
      });
      assert.equal(foreign.body.code, "CHAT-400-000");
      const exe = await alice.api.post(`/api/conversations/${direct._id}/messages`, {
        attachments: [{ data: "data:application/x-msdownload;base64,TVo=" }],
      });
      assert.equal(exe.body.code, "CHAT-400-007");

      const sig = await alice.api.post("/api/files/signature", { conversationId: String(direct._id) });
      assert.equal(sig.status, 200);
      assert.equal(sig.body.folder, folder);
      assert.ok(sig.body.signature);
    });

    it("media gallery filters by kind", async () => {
      const images = await bob.api.get(`/api/conversations/${direct._id}/media?kind=image`);
      assert.ok(images.body.items.length >= 2);
      assert.ok(images.body.items.every((m) => m.attachments.some((a) => a.kind === "image")));
      const links = await bob.api.get(`/api/conversations/${direct._id}/media?kind=link`);
      assert.ok(links.body.items.some((m) => m.links.includes("https://example.com")));
    });

    it("stickers come from the catalogue", async () => {
      const packs = await alice.api.get("/api/stickers");
      assert.equal(packs.body[0].id, "basic");
      const ok = await alice.api.post(`/api/conversations/${direct._id}/messages`, { type: "sticker", sticker: { packId: "basic", stickerId: "hi" } });
      assert.equal(ok.status, 201);
      assert.equal(ok.body.sticker.emoji, "👋");
      const bad = await alice.api.post(`/api/conversations/${direct._id}/messages`, { type: "sticker", sticker: { packId: "basic", stickerId: "nope" } });
      assert.equal(bad.body.code, "CHAT-400-011");
    });

    it("slash commands become type=command", async () => {
      const res = await alice.api.post(`/api/conversations/${direct._id}/messages`, {
        text: "/task làm báo cáo",
        mentions: [String(bob.user._id)],
      });
      assert.equal(res.body.type, "command");
      assert.equal(res.body.command.name, "task");
      assert.equal(res.body.command.args, "làm báo cáo");
      const unknown = await alice.api.post(`/api/conversations/${direct._id}/messages`, { text: "/kpi abc" });
      assert.equal(unknown.body.type, "text", "disabled rule stays plain text");
    });

    it("message pagination with before/after cursors", async () => {
      const page = await alice.api.get(`/api/conversations/${direct._id}/messages?limit=3`);
      assert.equal(page.body.items.length, 3);
      assert.equal(page.body.hasMore, true);
      const seqs = page.body.items.map((m) => m.seq);
      assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), "page is ordered old → new");
      const older = await alice.api.get(`/api/conversations/${direct._id}/messages?limit=3&before=${page.body.nextCursor}`);
      assert.ok(older.body.items.every((m) => m.seq < seqs[0]));
      const cursor = Buffer.from(String(seqs[0] - 1)).toString("base64url");
      const newer = await alice.api.get(`/api/conversations/${direct._id}/messages?limit=100&after=${cursor}`);
      assert.equal(newer.body.items[0].seq, seqs[0]);
    });

    it("search is accent-insensitive and respects hidden messages", async () => {
      await alice.api.post(`/api/conversations/${direct._id}/messages`, { text: "Họp giao ban lúc chín giờ" }).expect(201);
      const res = await bob.api.get("/api/messages/search?q=giao%20ban");
      assert.equal(res.status, 200);
      assert.ok(res.body.items.some((m) => m.text === "Họp giao ban lúc chín giờ"));
      const plain = await bob.api.get("/api/messages/search?q=hop");
      assert.ok(plain.body.items.some((m) => m.text.startsWith("Họp")));
      const scoped = await bob.api.get(`/api/messages/search?conversationId=${direct._id}&senderId=${alice.user._id}&type=command`);
      assert.ok(scoped.body.items.every((m) => m.type === "command"));
      assert.equal((await bob.api.get("/api/messages/search")).body.code, "CHAT-400-000");
      assert.equal((await carol.api.get(`/api/messages/search?conversationId=${direct._id}`)).body.code, "CHAT-403-003");
    });
  });

  describe("typing", () => {
    it("REST and socket typing reach the other member; repeats are throttled", async () => {
      clearEvents(sb);
      await alice.api.post(`/api/conversations/${direct._id}/typing`, { typing: true }).expect(204);
      await alice.api.post(`/api/conversations/${direct._id}/typing`, { typing: true }).expect(204);
      await waitFor(sb, "typing", (d) => d.typing === true);
      await sleep(100);
      assert.equal(sb.events.filter((e) => e.event === "typing").length, 1);
      const ack = await new Promise((resolve) => sa.emit("typing", { conversationId: String(direct._id), typing: false }, resolve));
      assert.equal(ack.ok, true);
      await waitFor(sb, "typing", (d) => d.typing === false);
    });
  });

  describe("block & nickname & presence", () => {
    it("block prevents direct messages in both directions", async () => {
      clearEvents(sb);
      const block = await bob.api.post(`/api/blocks/${alice.user._id}`);
      assert.equal(block.status, 201);
      await waitFor(sb, "block.updated", (d) => d.blocked === true);
      assert.equal((await bob.api.post(`/api/blocks/${alice.user._id}`)).body.code, "CHAT-409-011");
      assert.equal((await alice.api.post(`/api/conversations/${direct._id}/messages`, { text: "?" })).body.code, "CHAT-403-008");
      assert.equal((await bob.api.post(`/api/conversations/${direct._id}/messages`, { text: "?" })).body.code, "CHAT-403-008");
      const blocks = await bob.api.get("/api/blocks");
      assert.equal(blocks.body.items.length, 1);
      await bob.api.del(`/api/blocks/${alice.user._id}`).expect(204);
      assert.equal((await alice.api.post(`/api/conversations/${direct._id}/messages`, { text: "hết chặn" })).status, 201);
    });

    it("nicknames are private to the owner", async () => {
      const res = await bob.api.put(`/api/users/${alice.user._id}/nickname`, { nickname: "Sếp" });
      assert.equal(res.status, 200);
      const boot = await bob.api.get("/api/me/bootstrap");
      assert.equal(boot.body.nicknames[String(alice.user._id)], "Sếp");
      const carolBoot = await carol.api.get("/api/me/bootstrap");
      assert.equal(carolBoot.body.nicknames[String(alice.user._id)], undefined);
      await bob.api.del(`/api/users/${alice.user._id}/nickname`).expect(204);
      assert.equal((await bob.api.get("/api/nicknames")).body.items.length, 0);
    });

    it("presence: connected sockets are online, heartbeat devices too", async () => {
      const res = await alice.api.get(`/api/presence?ids=${bob.user._id},${dave.user._id}`);
      const byId = Object.fromEntries(res.body.map((p) => [p.userId, p.online]));
      assert.equal(byId[String(bob.user._id)], true);
      assert.equal(byId[String(dave.user._id)], false);

      clearEvents(sc);
      await dave.api.post("/api/presence/heartbeat", { deviceId: "web-1" }).expect(204);
      await waitFor(sc, "user.online", (d) => d.userId === String(dave.user._id));
      const again = await alice.api.get(`/api/presence?ids=${dave.user._id}`);
      assert.equal(again.body[0].online, true);
      await dave.api.del("/api/presence", { deviceId: "web-1" }).expect(204);
      await waitFor(sc, "user.offline", (d) => d.userId === String(dave.user._id));
    });
  });

  describe("polls", () => {
    let poll;

    it("create posts a poll message", async () => {
      clearEvents(sb);
      const res = await alice.api.post(`/api/conversations/${direct._id}/polls`, {
        question: "Ăn gì?",
        options: ["Phở", "Bún", "Cơm"],
      });
      assert.equal(res.status, 201);
      poll = res.body.poll;
      assert.equal(res.body.message.type, "poll");
      assert.deepEqual(poll.options.map((o) => o.id), ["o1", "o2", "o3"]);
      await waitFor(sb, "message.new", (m) => m.type === "poll" && String(m.pollId) === String(poll._id));
      const tooMany = await alice.api.post(`/api/conversations/${direct._id}/polls`, { question: "x", options: ["a"] });
      assert.equal(tooMany.body.code, "CHAT-400-000");
    });

    it("vote, change vote, single-choice validation, counts stay consistent", async () => {
      const v1 = await bob.api.put(`/api/polls/${poll._id}/votes`, { optionIds: ["o1"] });
      assert.equal(v1.status, 200);
      assert.deepEqual(v1.body.myOptionIds, ["o1"]);
      assert.equal((await bob.api.put(`/api/polls/${poll._id}/votes`, { optionIds: ["o1", "o2"] })).body.code, "CHAT-400-010");
      assert.equal((await bob.api.put(`/api/polls/${poll._id}/votes`, { optionIds: ["o9"] })).body.code, "CHAT-400-010");

      clearEvents(sa);
      await bob.api.put(`/api/polls/${poll._id}/votes`, { optionIds: ["o2"] }).expect(200);
      const ev = await waitFor(sa, "poll.updated", (d) => d.counts.o2 === 1);
      assert.equal(ev.counts.o1, 0);
      assert.equal(ev.voters, undefined, "event never says who voted");

      await Promise.all([
        alice.api.put(`/api/polls/${poll._id}/votes`, { optionIds: ["o3"] }),
        bob.api.put(`/api/polls/${poll._id}/votes`, { optionIds: ["o3"] }),
      ]);
      const state = await alice.api.get(`/api/polls/${poll._id}`);
      assert.equal(state.body.options.find((o) => o.id === "o3").count, 2);
      assert.equal(state.body.votersCount, 2);
      assert.equal(state.body.options.find((o) => o.id === "o3").voters.length, 2);
    });

    it("only the creator closes; voting after close fails", async () => {
      assert.equal((await bob.api.post(`/api/polls/${poll._id}/close`)).body.code, "CHAT-403-004");
      clearEvents(sb);
      const closed = await alice.api.post(`/api/polls/${poll._id}/close`);
      assert.equal(closed.body.status, "closed");
      await waitFor(sb, "poll.closed", (d) => String(d.pollId) === String(poll._id));
      assert.equal((await bob.api.put(`/api/polls/${poll._id}/votes`, { optionIds: ["o1"] })).body.code, "CHAT-409-007");
    });

    it("anonymous polls hide voters; expired polls are closed by the sweeper", async () => {
      const closesAt = new Date(Date.now() + 60_000).toISOString();
      const res = await alice.api.post(`/api/conversations/${direct._id}/polls`, {
        question: "Ẩn danh?",
        options: ["Có", "Không"],
        anonymous: true,
        multiple: true,
        closesAt,
      });
      const id = res.body.poll._id;
      const v = await bob.api.put(`/api/polls/${id}/votes`, { optionIds: ["o1", "o2"] });
      assert.equal(v.body.options[0].voters, undefined);
      assert.equal(v.body.options[0].count, 1);

      const Poll = (await import("../src/models/poll.model.js")).default;
      await Poll.updateOne({ _id: id }, { $set: { closesAt: new Date(Date.now() - 1000) } });
      clearEvents(sa);
      const { closeExpiredPolls } = await import("../src/services/poll.service.js");
      assert.equal(await closeExpiredPolls(), 1);
      const ev = await waitFor(sa, "poll.closed", (d) => String(d.pollId) === String(id));
      assert.equal(ev.closedBy, null);
    });
  });

  describe("reminders", () => {
    it("validates input, fires exactly once and notifies the owner", async () => {
      const past = await alice.api.post("/api/reminders", { note: "x", remindAt: new Date().toISOString() });
      assert.equal(past.body.code, "CHAT-400-000");
      const badTz = await alice.api.post("/api/reminders", {
        note: "x",
        remindAt: new Date(Date.now() + 3600_000).toISOString(),
        timezone: "Mars/Olympus",
      });
      assert.equal(badTz.body.code, "CHAT-400-014");

      const res = await alice.api.post("/api/reminders", {
        note: "Gọi lại nhà cung cấp",
        remindAt: "2099-01-01T09:00:00+07:00",
        timezone: "Asia/Ho_Chi_Minh",
        conversationId: String(direct._id),
      });
      assert.equal(res.body.code, "CHAT-400-000", "more than a year ahead is rejected");

      const at = new Date(Date.now() + 3600_000);
      const created = await alice.api.post("/api/reminders", {
        note: "Gọi lại nhà cung cấp",
        remindAt: at.toISOString(),
        timezone: "Asia/Ho_Chi_Minh",
        conversationId: String(direct._id),
      });
      assert.equal(created.status, 201);
      assert.match(created.body.remindAtLocal, /\+07:00$/);
      assert.equal((await bob.api.get(`/api/reminders/${created.body._id}`)).body.code, "CHAT-404-009");

      const patched = await alice.api.patch(`/api/reminders/${created.body._id}`, { note: "Gọi lúc 9h" });
      assert.equal(patched.body.note, "Gọi lúc 9h");
      const list = await alice.api.get("/api/reminders");
      assert.equal(list.body.items.length, 1);

      const Reminder = (await import("../src/models/reminder.model.js")).default;
      await Reminder.updateOne({ _id: created.body._id }, { $set: { remindAt: new Date(Date.now() - 1000) } });
      clearEvents(sa);
      const { fireDueReminders } = await import("../src/services/reminder.service.js");
      assert.equal(await fireDueReminders(), 1);
      assert.equal(await fireDueReminders(), 0, "fires only once");
      const ev = await waitFor(sa, "reminder.fired", (d) => String(d.reminder._id) === String(created.body._id));
      assert.equal(ev.reminder.status, "fired");
      assert.equal((await alice.api.del(`/api/reminders/${created.body._id}`)).body.code, "CHAT-409-000");
    });
  });

  describe("sync after reconnect", () => {
    it("returns conversations and messages changed since a timestamp", async () => {
      const since = new Date().toISOString();
      await sleep(5);
      await alice.api.post(`/api/conversations/${direct._id}/messages`, { text: "trong lúc mất mạng" }).expect(201);
      const res = await bob.api.get(`/api/sync?since=${encodeURIComponent(since)}`);
      assert.equal(res.status, 200);
      assert.ok(res.body.conversations.some((c) => String(c._id) === String(direct._id)));
      assert.ok(res.body.messages.some((m) => m.text === "trong lúc mất mạng"));
      assert.ok(res.body.until);
      assert.equal((await bob.api.get("/api/sync?since=abc")).body.code, "CHAT-400-006");
    });
  });
});
