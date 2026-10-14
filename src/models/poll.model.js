import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;

// Bình chọn gắn với đúng một tin `type=poll`. Phiếu nằm trong document; mọi lần đổi phiếu
// cập nhật có điều kiện theo `rev` (optimistic concurrency) nên counts luôn khớp votes.
const pollSchema = new mongoose.Schema(
  {
    conversationId: { type: ObjectId, ref: "Conversation", required: true },
    messageId: { type: ObjectId, ref: "Message" },
    createdBy: { type: ObjectId, ref: "User", required: true },
    question: { type: String, required: true },
    options: [new mongoose.Schema({ id: String, text: String }, { _id: false })],
    multiple: { type: Boolean, default: false },
    anonymous: { type: Boolean, default: false },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    closesAt: { type: Date },
    closedAt: { type: Date },
    closedBy: { type: ObjectId },
    votes: {
      type: [new mongoose.Schema({ userId: ObjectId, optionId: String, at: Date }, { _id: false })],
      default: [],
    },
    counts: { type: Map, of: Number, default: {} },
    votersCount: { type: Number, default: 0 },
    rev: { type: Number, default: 0 },
  },
  { timestamps: true }
);

pollSchema.index({ messageId: 1 }, { unique: true, partialFilterExpression: { messageId: { $type: "objectId" } } });
pollSchema.index({ conversationId: 1, createdAt: -1 });
pollSchema.index({ status: 1, closesAt: 1 });

export default mongoose.model("Poll", pollSchema);
