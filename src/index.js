import "dotenv/config";
import http from "http";
import mongoose from "mongoose";

import { config } from "./config.js";
import { createApp } from "./app.js";
import { connectDB } from "./lib/db.js";
import { initSocket } from "./lib/socket.js";
import { startBackgroundJobs, stopBackgroundJobs } from "./services/jobs.service.js";
import { runMigrations } from "./services/migration.service.js";

if (!process.env.JWT_SECRET) {
  console.log("JWT_SECRET is required");
  process.exit(1);
}

const app = createApp();
const server = http.createServer(app);
const io = initSocket(server);

const start = async () => {
  await connectDB();
  await runMigrations();
  startBackgroundJobs();
  server.listen(config.port, () => {
    console.log(`server is running on PORT:${config.port} (version ${config.version})`);
  });
};

// Docker/Render gửi SIGTERM khi deploy bản mới: ngừng nhận kết nối, đóng socket, ngắt Mongo.
// Node chạy làm PID 1 trong container sẽ bỏ qua tín hiệu nếu không có handler.
let stopping = false;
const shutdown = (signal) => {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down`);
  setTimeout(() => process.exit(1), 10_000).unref();
  stopBackgroundJobs();
  io.close(async () => {
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  });
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((error) => {
  console.log("Failed to start server", error);
  process.exit(1);
});
