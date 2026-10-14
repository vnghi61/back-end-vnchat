import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;

// Nhắc việc riêng của owner. Mọi chuyển trạng thái là compare-and-set từ `scheduled`.
const reminderSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: "User", required: true },
    conversationId: { type: ObjectId, ref: "Conversation" },
    messageId: { type: ObjectId, ref: "Message" },
    note: { type: String, required: true },
    remindAt: { type: Date, required: true },
    timezone: { type: String, default: "UTC" },
    status: { type: String, enum: ["scheduled", "fired", "cancelled"], default: "scheduled" },
    version: { type: Number, default: 1 },
    firedAt: { type: Date },
  },
  { timestamps: true }
);

reminderSchema.index({ ownerId: 1, status: 1, remindAt: 1, _id: 1 });
reminderSchema.index({ status: 1, remindAt: 1 });

export default mongoose.model("Reminder", reminderSchema);
