import { Server } from "socket.io";
import { config } from "../config.js";
import Conversation from "../models/conversation.model.js";
import { Errors } from "./errors.js";
import { isAgent } from "./permissions.js";
import { getMember, loadConversation } from "../services/conversation.service.js";
import * as presence from "../services/presence.service.js";
import { setIo } from "../services/realtime.service.js";
import { authenticateToken } from "../services/session.service.js";
import { setTyping } from "../services/typing.service.js";

const parseCookies = (header = "") =>
  Object.fromEntries(
    header
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return i < 0 ? [p, ""] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
      })
  );

// Xác thực bằng JWT (cookie `jwt`, `auth.token` hoặc header Bearer) – không tin `query.userId` như bản cũ.
export function initSocket(server) {
  const io = new Server(server, {
    cors: { origin: config.corsOrigins, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const header = socket.handshake.headers.authorization ?? "";
      const token =
        socket.handshake.auth?.token ||
        (header.startsWith("Bearer ") ? header.slice(7) : null) ||
        parseCookies(socket.handshake.headers.cookie).jwt;
      const { user, session } = await authenticateToken(token);
      socket.data.user = user;
      socket.data.sessionId = String(session._id);
      next();
    } catch (error) {
      const err = new Error(error.message || "Unauthorized");
      err.data = { code: error.code ?? "CHAT-401-000" };
      next(err);
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user;
    const userId = String(user._id);
    socket.join([`user:${userId}`, `session:${socket.data.sessionId}`]);
    if (user.kind === "user") socket.join("members");
    presence.socketConnected(userId, socket.id, user.kind);

    socket.on("typing", async (payload, ack) => {
      try {
        await setTyping(user, payload?.conversationId, !!payload?.typing);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, code: error.code, message: error.message });
      }
    });

    // Agent mở xem ticket chưa nhận → nhận realtime của ticket đó.
    socket.on("support:watch", async (payload, ack) => {
      try {
        const conv = await loadConversation(payload?.conversationId);
        if (conv.kind !== "support" || !(await isAgent(user))) throw Errors.forbidden();
        socket.join(`conv:${conv._id}`);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, code: error.code, message: error.message });
      }
    });

    socket.on("support:unwatch", async (payload, ack) => {
      try {
        const conv = await loadConversation(payload?.conversationId);
        if (!getMember(conv, userId)) socket.leave(`conv:${conv._id}`);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, code: error.code, message: error.message });
      }
    });

    socket.on("disconnect", () => {
      presence.socketDisconnected(userId, socket.id);
    });

    try {
      const conversationIds = await Conversation.distinct("_id", { memberIds: user._id });
      socket.join(conversationIds.map((id) => `conv:${id}`));
      if (await isAgent(user)) socket.join("agents");
    } catch (error) {
      console.log("Error joining socket rooms", error.message);
    }
    // client cũ nghe getOnlineUsers; `ready` báo đã vào đủ room
    if (user.kind === "user") socket.emit("getOnlineUsers", presence.onlineUserIds());
    socket.emit("ready", { userId });
  });

  setIo(io);
  return io;
}
