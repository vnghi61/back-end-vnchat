import mongoose from "mongoose";

const { ObjectId, Mixed } = mongoose.Schema.Types;

// Cấu hình toàn hệ thống: một document `_id = "global"`.
const settingsSchema = new mongoose.Schema(
  {
    _id: { type: String },
    branding: { type: Mixed },
    commandRules: { type: Mixed },
    stickerPacks: { type: Mixed },
    widget: { type: Mixed },
    // policy phân quyền kiểu Casbin: [{ sub, obj, act }]
    policies: { type: Mixed },
  },
  { timestamps: true, minimize: false }
);

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: ObjectId, ref: "User" },
    actorKind: { type: String },
    action: { type: String, required: true },
    targetType: { type: String },
    targetId: { type: String },
    metadata: { type: Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
auditLogSchema.index({ createdAt: -1, _id: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

const webhookSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    // tên event chính xác hoặc "*"
    events: { type: [String], default: [] },
    secret: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    createdBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true }
);
webhookSchema.index({ enabled: 1, events: 1 });

const webhookDeliverySchema = new mongoose.Schema(
  {
    subscriptionId: { type: ObjectId, ref: "Webhook", required: true },
    event: { type: String, required: true },
    // envelope JSON đã serialize – gửi đúng các byte này để chữ ký khớp
    payload: { type: String, required: true },
    status: { type: String, enum: ["pending", "delivered", "failed"], default: "pending" },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String },
    lastStatusCode: { type: Number },
    deliveredAt: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);
webhookDeliverySchema.index({ subscriptionId: 1, createdAt: -1 });
webhookDeliverySchema.index({ status: 1, nextAttemptAt: 1 });
webhookDeliverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const apiKeySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    // 12 ký tự đầu của raw key để nhận diện trong UI/log
    prefix: { type: String, required: true },
    // sha256(raw) hex – raw key không lưu
    hash: { type: String, required: true },
    scopes: { type: [String], default: [] },
    status: { type: String, enum: ["active", "revoked"], default: "active" },
    expiresAt: { type: Date },
    lastUsedAt: { type: Date },
    // danh tính bot khi key đăng tin
    botUserId: { type: ObjectId, ref: "User" },
    createdBy: { type: ObjectId, ref: "User" },
    revokedAt: { type: Date },
  },
  { timestamps: true }
);
apiKeySchema.index({ hash: 1 }, { unique: true });
apiKeySchema.index({ status: 1, createdAt: -1 });

export const Settings = mongoose.model("Settings", settingsSchema);
export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
export const Webhook = mongoose.model("Webhook", webhookSchema);
export const WebhookDelivery = mongoose.model("WebhookDelivery", webhookDeliverySchema);
export const ApiKey = mongoose.model("ApiKey", apiKeySchema);
