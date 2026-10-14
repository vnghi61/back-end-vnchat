// Chạy migration thủ công (server cũng tự chạy mỗi lần khởi động): npm run migrate
import "dotenv/config";
import mongoose from "mongoose";
import { runMigrations } from "../services/migration.service.js";

await mongoose.connect(process.env.MONGODB_URI);
await runMigrations();
console.log("Migrations done");
await mongoose.disconnect();
