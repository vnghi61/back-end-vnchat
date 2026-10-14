import mongoose from "mongoose";

// Một lần đăng nhập = một session; JWT mang `sid` để thu hồi được (logout, logout-all, khoá tài khoản).
const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
    device: { type: String, default: "" },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
  },
  { timestamps: true }
);

sessionSchema.index({ userId: 1, createdAt: -1 });
// Session hết hạn tự xoá sau 1 ngày.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export default mongoose.model("Session", sessionSchema);
