import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;

// Tuỳ chọn riêng của từng thành viên nằm ngay trong members[] (đọc hội thoại là có đủ).
const memberSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["owner", "admin", "member", "agent", "bot"], default: "member" },
    joinedAt: { type: Date, default: Date.now },
    lastReadSeq: { type: Number, default: 0 },
    // seq đầu tiên được đọc (nhóm `since_join`); 0 = toàn bộ lịch sử
    historyFromSeq: { type: Number, default: 0 },
    mutedUntil: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    pinnedAt: { type: Date, default: null },
  },
  { _id: false }
);

const supportSchema = new mongoose.Schema(
  {
    // waiting_agent: chờ nhân viên nhận; agent: đang được nhân viên xử lý; closed: đã đóng
    status: { type: String, enum: ["waiting_agent", "agent", "closed"], default: "waiting_agent" },
    assigneeId: { type: ObjectId, ref: "User", default: null },
    tags: { type: [String], default: [] },
    meta: { type: mongoose.Schema.Types.Mixed, default: undefined },
    assignedAt: { type: Date },
    closedAt: { type: Date },
    closedBy: { type: ObjectId, ref: "User" },
    rating: { type: Number, min: 1, max: 5 },
    ratingNote: { type: String },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["direct", "group", "support"], required: true },
    title: { type: String, default: "" },
    avatarUrl: { type: String, default: "" },
    // "<idA>:<idB>" đã sắp xếp – chỉ direct
    directKey: { type: String },
    historyVisibility: { type: String, enum: ["all", "since_join"], default: "all" },
    members: { type: [memberSchema], default: [] },
    // bản sao members[].userId để index multikey
    memberIds: { type: [ObjectId], default: [] },
    lastSeq: { type: Number, default: 0 },
    lastMessage: {
      type: new mongoose.Schema(
        {
          id: ObjectId,
          seq: Number,
          senderId: ObjectId,
          type: String,
          preview: String,
          deleted: Boolean,
          at: Date,
        },
        { _id: false }
      ),
      default: null,
    },
    support: { type: supportSchema, default: undefined },
    // khách đang có hội thoại hỗ trợ mở → mỗi khách tối đa một hội thoại mở (unique partial)
    supportOpenFor: { type: ObjectId },
    createdBy: { type: ObjectId, ref: "User" },
    // mốc cho GET /sync: đổi ở mọi thay đổi client cần đồng bộ
    syncAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

conversationSchema.index({ memberIds: 1, updatedAt: -1, _id: -1 });
conversationSchema.index({ memberIds: 1, syncAt: 1 });
conversationSchema.index({ directKey: 1 }, { unique: true, partialFilterExpression: { directKey: { $type: "string" } } });
conversationSchema.index(
  { supportOpenFor: 1 },
  { unique: true, partialFilterExpression: { supportOpenFor: { $type: "objectId" } } }
);
conversationSchema.index({ kind: 1, "support.status": 1, updatedAt: -1, _id: -1 });
conversationSchema.index({ kind: 1, "support.assigneeId": 1, updatedAt: -1, _id: -1 });

export const MUTED_FOREVER = new Date("9999-12-31T00:00:00Z");

export default mongoose.model("Conversation", conversationSchema);
