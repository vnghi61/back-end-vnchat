import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;

// Chặn: một bản ghi bất kỳ chiều nào chặn mọi tương tác giữa cặp người dùng.
const blockSchema = new mongoose.Schema(
  {
    blockerId: { type: ObjectId, ref: "User", required: true },
    blockedId: { type: ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
blockSchema.index({ blockedId: 1 });

// Biệt danh riêng: chỉ người đặt thấy; client phủ lên tên hiển thị.
const nicknameSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: "User", required: true },
    targetId: { type: ObjectId, ref: "User", required: true },
    nickname: { type: String, required: true },
  },
  { timestamps: true }
);
nicknameSchema.index({ ownerId: 1, targetId: 1 }, { unique: true });

export const Block = mongoose.model("Block", blockSchema);
export const Nickname = mongoose.model("Nickname", nicknameSchema);
