// Gán role cho tài khoản (tạo admin đầu tiên):
//   npm run set-roles -- admin@example.com admin,agent,member
import "dotenv/config";
import mongoose from "mongoose";
import User from "../models/user.model.js";

const [email, rolesArg] = process.argv.slice(2);
const allowed = ["admin", "agent", "member"];
const roles = String(rolesArg ?? "")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);

if (!email || !roles.length || roles.some((r) => !allowed.includes(r))) {
  console.log("Usage: npm run set-roles -- <email> <admin,agent,member>");
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
const user = await User.findOneAndUpdate(
  { email: email.trim().toLowerCase(), kind: { $in: ["user", null] } },
  { $set: { roles: [...new Set(roles)], kind: "user" } },
  { new: true }
);
if (!user) {
  console.log(`No registered user with email ${email}`);
  process.exitCode = 1;
} else {
  console.log(`${user.email} → roles: ${user.roles.join(", ")}`);
}
await mongoose.disconnect();
