import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;

const attachmentSchema = new mongoose.Schema(
    {
        url: { type: String, required: true },
        publicId: { type: String },
        name: { type: String },
        size: { type: Number },
        mime: { type: String },
        // image | video | audio | file
        kind: { type: String },
        width: { type: Number },
        height: { type: Number },
    },
    { _id: false }
);

const messageSchema = new mongoose.Schema(
    {
        conversationId: { type: ObjectId, ref: "Conversation" },
        // duy nhất trong hội thoại, tăng dần
        seq: { type: Number },
        senderId: {
            type: ObjectId,
            ref: "User",
            required: true,
        },
        // chỉ còn ở tin nhắn cũ (trước khi có conversation) – migration gắn conversationId
        receiverId: {
            type: ObjectId,
            ref: "User",
        },
        // text | file | system | command | sticker | poll
        type: { type: String, default: "text" },
        text: {
            type: String,
            default: "",
        },
        // ảnh đầu tiên của tin – giữ cho client cũ đọc field `image`
        image: {
            type: String,
        },
        attachments: { type: [attachmentSchema], default: undefined },
        replyTo: { type: ObjectId, ref: "Message" },
        mentions: { type: [ObjectId], default: undefined },
        command: {
            type: new mongoose.Schema({ name: String, args: String, mentions: [ObjectId] }, { _id: false }),
            default: undefined,
        },
        reactions: {
            type: [new mongoose.Schema({ emoji: String, userIds: [ObjectId] }, { _id: false })],
            default: undefined,
        },
        sticker: {
            type: new mongoose.Schema({ packId: String, stickerId: String, emoji: String, url: String }, { _id: false }),
            default: undefined,
        },
        pollId: { type: ObjectId, ref: "Poll" },
        forwardedFrom: {
            type: new mongoose.Schema({ messageId: ObjectId, conversationId: ObjectId, senderId: ObjectId }, { _id: false }),
            default: undefined,
        },
        links: { type: [String], default: undefined },
        // image | video | audio | file | link – phục vụ GET /conversations/:id/media
        mediaKinds: { type: [String], default: undefined },
        metadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
        clientMsgId: { type: String },
        editedAt: { type: Date },
        deletedAt: { type: Date },
        deletedBy: { type: ObjectId },
        pinnedAt: { type: Date },
        pinnedBy: { type: ObjectId },
        // ẩn phía người đó (không ảnh hưởng người khác)
        hiddenFor: { type: [ObjectId], default: undefined },
    },
    {
        timestamps: true,
    }
);

messageSchema.index(
    { conversationId: 1, seq: -1 },
    { unique: true, partialFilterExpression: { conversationId: { $type: "objectId" } } }
);
messageSchema.index(
    { conversationId: 1, senderId: 1, clientMsgId: 1 },
    { unique: true, partialFilterExpression: { clientMsgId: { $type: "string" } } }
);
messageSchema.index({ conversationId: 1, updatedAt: 1 });
messageSchema.index({ conversationId: 1, mediaKinds: 1, seq: -1 });
messageSchema.index(
    { conversationId: 1, pinnedAt: -1 },
    { partialFilterExpression: { pinnedAt: { $type: "date" } } }
);
messageSchema.index({ conversationId: 1, createdAt: -1 });
// text index v3 không phân biệt dấu → tìm "xin chao" khớp "xin chào"
messageSchema.index({ text: "text" }, { default_language: "none" });
messageSchema.index({ senderId: 1, receiverId: 1 });

const Message = mongoose.model("Message", messageSchema);

export default Message;
