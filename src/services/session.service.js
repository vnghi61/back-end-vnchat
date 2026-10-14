import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { Errors } from "../lib/errors.js";
import { generateToken } from "../lib/utlist.js";
import Session from "../models/session.model.js";
import User from "../models/user.model.js";
import { realtime } from "./realtime.service.js";

// Tạo session + JWT (cookie `jwt` khi có res). Trả token để client mobile/socket dùng Bearer.
export async function createSession(user, req, res, device = "") {
  const session = await Session.create({
    userId: user._id,
    userAgent: String(req?.get?.("user-agent") ?? "").slice(0, 300),
    ip: req?.ip ?? "",
    device: String(device ?? "").slice(0, 100),
    expiresAt: new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000),
  });
  const token = generateToken(user._id, res, session._id);
  return { session, token };
}

export function extractToken(req) {
  const header = req.get?.("authorization") ?? req.headers?.authorization ?? "";
  if (header.startsWith("Bearer ") && !header.startsWith("Bearer ck_")) return header.slice(7).trim();
  return req.cookies?.jwt || null;
}

// Xác thực JWT → session còn hiệu lực → user active. Dùng chung cho HTTP và Socket.IO.
export async function authenticateToken(token) {
  if (!token) throw Errors.noCredential();
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw Errors.invalidToken();
  }
  if (!decoded?.userId || !decoded?.sid) throw Errors.invalidToken();

  const session = await Session.findById(decoded.sid);
  if (!session || String(session.userId) !== String(decoded.userId)) throw Errors.invalidToken();
  if (session.revokedAt) throw Errors.sessionRevoked();
  if (session.expiresAt < new Date()) throw Errors.invalidToken();

  const user = await User.findById(decoded.userId).select("-password");
  if (!user) throw Errors.invalidToken();
  if (user.status === "inactive") throw Errors.accountLocked();

  // cập nhật lastUsedAt tối đa 1 lần/phút
  if (Date.now() - session.lastUsedAt.getTime() > 60_000) {
    Session.updateOne({ _id: session._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { user, session };
}

export async function revokeSession(sessionId, userId) {
  const res = await Session.updateOne(
    { _id: sessionId, userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  realtime.disconnectSession(sessionId);
  return res.modifiedCount > 0;
}

// Thu hồi mọi session của user (logout-all, khoá tài khoản) và ngắt socket.
export async function revokeAllSessions(userId, reason = "logout_all") {
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  realtime.toUser(userId, "session.revoked", { reason });
  realtime.disconnectUser(userId);
}
