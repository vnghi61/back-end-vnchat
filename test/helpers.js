// Hạ tầng test tích hợp: Mongo thật (MONGODB_TEST_URI, mặc định mongodb://127.0.0.1:27018),
// HTTP thật (supertest) và Socket.IO thật (socket.io-client). Mỗi file test dùng database riêng.

import http from "node:http";
import mongoose from "mongoose";
import request from "supertest";
import { io as ioClient } from "socket.io-client";

export async function setup(name) {
  const base = process.env.MONGODB_TEST_URI || "mongodb://127.0.0.1:27018";
  process.env.MONGODB_URI = `${base}/vnchat_test_${name}_${Date.now()}`;
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.NODE_ENV = "test";
  process.env.CLOUDINAR_CLOUD_NAME = "testcloud";
  process.env.CLOUDINAR_API_KEY = "test-key";
  process.env.CLOUDINAR_SECRECT_KEY = "test-secret";
  process.env.RATE_LIMIT_MESSAGES_PER_MINUTE = "100000";
  process.env.RATE_LIMIT_LOGIN_PER_MINUTE = "100000";
  process.env.RATE_LIMIT_WIDGET_SESSIONS_PER_MINUTE = "100000";
  process.env.TYPING_THROTTLE_MS = "200";
  process.env.WEBHOOK_MAX_ATTEMPTS = "3";

  const { createApp } = await import("../src/app.js");
  const { initSocket } = await import("../src/lib/socket.js");
  const { runMigrations } = await import("../src/services/migration.service.js");
  const cloudinary = (await import("../src/lib/cloudinar.js")).default;

  // Không gọi Cloudinary thật: upload trả về URL giả trong thư mục được yêu cầu.
  let uploads = 0;
  cloudinary.uploader.upload = async (data, opts = {}) => {
    uploads += 1;
    const folder = opts.folder ?? "vnchat";
    return {
      secure_url: `https://res.cloudinary.com/testcloud/image/upload/v1/${folder}/file${uploads}.png`,
      public_id: `${folder}/file${uploads}`,
      bytes: 1234,
      width: 64,
      height: 64,
      format: "png",
      original_filename: `file${uploads}`,
    };
  };

  await mongoose.connect(process.env.MONGODB_URI);
  await runMigrations();
  const app = createApp();
  const server = http.createServer(app);
  const io = initSocket(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];

  return {
    app,
    url,
    sockets,
    async teardown() {
      for (const s of sockets) s.disconnect();
      io.close();
      await new Promise((resolve) => server.close(resolve));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    },
  };
}

let counter = 0;

export const client = (app, token) => {
  const withAuth = (req) => (token ? req.set("Authorization", `Bearer ${token}`) : req);
  return {
    get: (path) => withAuth(request(app).get(path)),
    post: (path, body) => withAuth(request(app).post(path)).send(body ?? {}),
    put: (path, body) => withAuth(request(app).put(path)).send(body ?? {}),
    patch: (path, body) => withAuth(request(app).patch(path)).send(body ?? {}),
    del: (path, body) => withAuth(request(app).delete(path)).send(body ?? {}),
  };
};

export async function signup(app, name = "User") {
  counter += 1;
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}.${Date.now()}.${counter}@test.vn`;
  const res = await request(app).post("/api/auth/signup").send({ name, email, password: "secret123" });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { user: res.body, token: res.body.token, email, api: client(app, res.body.token) };
}

export async function makeRole(userId, roles) {
  const User = (await import("../src/models/user.model.js")).default;
  await User.updateOne({ _id: userId }, { $set: { roles } });
}

// Kết nối socket bằng JWT; resolve khi server báo đã vào đủ room (`ready`).
export function connect(ctx, token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(ctx.url, { auth: { token }, transports: ["websocket"], forceNew: true });
    ctx.sockets.push(socket);
    socket.events = [];
    socket.onAny((event, data) => socket.events.push({ event, data }));
    socket.once("ready", () => resolve(socket));
    socket.once("connect_error", (err) => reject(err));
  });
}

// Chờ một event (đã nhận hoặc sắp nhận) thoả điều kiện.
export function waitFor(socket, event, predicate = () => true, timeout = 3000) {
  const hit = socket.events.find((e) => e.event === event && predicate(e.data));
  if (hit) return Promise.resolve(hit.data);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.offAny(handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeout);
    const handler = (name, data) => {
      if (name === event && predicate(data)) {
        clearTimeout(timer);
        socket.offAny(handler);
        resolve(data);
      }
    };
    socket.onAny(handler);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const clearEvents = (...sockets) => sockets.forEach((s) => (s.events = []));
