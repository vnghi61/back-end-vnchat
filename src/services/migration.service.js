// Chạy mỗi lần khởi động (idempotent): đồng bộ index theo schema và nâng dữ liệu từ bản cũ
// (tin nhắn 1-1 senderId/receiverId chưa có hội thoại).

import mongoose from "mongoose";
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { normalizeName } from "../lib/names.js";
import { messagePreview } from "../lib/text.js";
import "../models/admin.model.js";
import "../models/poll.model.js";
import "../models/reminder.model.js";
import "../models/session.model.js";
import "../models/social.model.js";

// Mỗi model một collection riêng → đồng bộ song song.
export async function ensureIndexes() {
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
}

async function migrateUsers() {
  await User.updateMany({ kind: { $exists: false } }, { $set: { kind: "user" } });
  await User.updateMany({ status: { $exists: false } }, { $set: { status: "active" } });
  await User.updateMany({ roles: { $exists: false } }, { $set: { roles: ["member"] } });
  const missing = await User.find({ $or: [{ nameSearch: { $exists: false } }, { nameSearch: "" }] }).select("name").lean();
  if (missing.length) {
    await User.bulkWrite(
      missing.map((u) => ({
        updateOne: { filter: { _id: u._id }, update: { $set: { nameSearch: normalizeName(u.name) } }, timestamps: false },
      }))
    );
  }
}

// Gom tin nhắn cũ theo cặp người dùng → hội thoại direct, đánh seq theo thời gian gửi.
async function migrateLegacyMessages() {
  const pairs = await Message.aggregate([
    { $match: { conversationId: { $exists: false }, receiverId: { $type: "objectId" } } },
    {
      $group: {
        _id: {
          a: { $cond: [{ $lt: ["$senderId", "$receiverId"] }, "$senderId", "$receiverId"] },
          b: { $cond: [{ $lt: ["$senderId", "$receiverId"] }, "$receiverId", "$senderId"] },
        },
      },
    },
  ]);

  let migrated = 0;
  for (const { _id: pair } of pairs) {
    const { a, b } = pair;
    if (String(a) === String(b)) continue;
    const directKey = [String(a), String(b)].sort().join(":");
    const msgs = await Message.find({
      conversationId: { $exists: false },
      $or: [
        { senderId: a, receiverId: b },
        { senderId: b, receiverId: a },
      ],
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    if (!msgs.length) continue;

    let conv = await Conversation.findOne({ directKey });
    if (!conv) {
      conv = await Conversation.create({
        kind: "direct",
        directKey,
        members: [
          { userId: a, role: "member", joinedAt: msgs[0].createdAt },
          { userId: b, role: "member", joinedAt: msgs[0].createdAt },
        ],
        memberIds: [a, b],
        createdBy: msgs[0].senderId,
      });
    }

    let seq = conv.lastSeq ?? 0;
    const ops = msgs.map((m) => {
      seq += 1;
      const $set = { conversationId: conv._id, seq, type: m.type ?? (m.image ? "file" : "text") };
      if (m.image && !m.attachments?.length) {
        $set.attachments = [{ url: m.image, kind: "image", mime: "image/*" }];
        $set.mediaKinds = ["image"];
      }
      return { updateOne: { filter: { _id: m._id }, update: { $set }, timestamps: false } };
    });
    await Message.bulkWrite(ops);

    const last = { ...msgs[msgs.length - 1], type: msgs[msgs.length - 1].image ? "file" : "text" };
    await Conversation.updateOne(
      { _id: conv._id },
      {
        $set: {
          lastSeq: seq,
          lastMessage: {
            id: last._id,
            seq,
            senderId: last.senderId,
            type: last.type,
            preview: messagePreview(last),
            deleted: false,
            at: last.createdAt,
          },
          // lịch sử cũ coi như đã đọc
          "members.$[].lastReadSeq": seq,
          updatedAt: last.createdAt,
          syncAt: new Date(),
        },
      },
      { timestamps: false }
    );
    migrated += msgs.length;
  }
  return migrated;
}

export async function runMigrations() {
  await ensureIndexes();
  await migrateUsers();
  const migrated = await migrateLegacyMessages();
  if (migrated) console.log(`Migrated ${migrated} legacy messages into direct conversations`);
}
