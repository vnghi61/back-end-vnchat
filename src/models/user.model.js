import mongoose from "mongoose";
import { normalizeName } from "../lib/names.js";

// kind:
//  - user    : tài khoản đăng ký (signup/login)
//  - visitor : khách vãng lai mở chat hỗ trợ qua widget (không mật khẩu)
//  - bot     : danh tính của API key đối tác khi đăng tin qua /api/open/v1
const userSchema = new mongoose.Schema(
    {
        kind: {
            type: String,
            enum: ["user", "visitor", "bot"],
            default: "user",
        },
        email: {
            type: String,
            trim: true,
            lowercase: true,
            required: function () {
                return this.kind === "user";
            },
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        // tên đã bỏ dấu + chữ thường để tìm kiếm (đồng bộ với name qua hook validate)
        nameSearch: { type: String, default: "" },
        password: {
            type: String,
            minlength: 6,
            required: function () {
                return this.kind === "user";
            },
        },
        profileImage: {
            type: String,
            default: "",
        },
        roles: {
            type: [{ type: String, enum: ["admin", "agent", "member"] }],
            default: ["member"],
        },
        status: {
            type: String,
            enum: ["active", "inactive"],
            default: "active",
        },
        // visitor: liên hệ khách tự khai (không unique, không dùng để đăng nhập)
        contactEmail: { type: String, trim: true },
        // bot: API key sở hữu danh tính này
        apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: "ApiKey" },
        lastSeenAt: { type: Date },
    },
    {
        timestamps: true,
    }
);

// Email chỉ unique giữa các tài khoản có email (visitor/bot không có email).
userSchema.index(
    { email: 1 },
    { unique: true, partialFilterExpression: { email: { $type: "string" } } }
);
userSchema.index({ kind: 1, status: 1, _id: 1 });

userSchema.pre("validate", function () {
    if (this.isModified("name") || !this.nameSearch) this.nameSearch = normalizeName(this.name);
});

const User = mongoose.model("User", userSchema);

export default User;
