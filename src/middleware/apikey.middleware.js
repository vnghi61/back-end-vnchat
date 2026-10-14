import crypto from "node:crypto";
import { Errors } from "../lib/errors.js";
import { ApiKey } from "../models/admin.model.js";
import User from "../models/user.model.js";

export const hashApiKey = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

// `X-Api-Key: ck_...` hoặc `Authorization: Bearer ck_...`; mỗi route đòi một scope.
export const requireApiKey = (scope) => async (req, res, next) => {
  const header = req.get("authorization") ?? "";
  const raw = req.get("x-api-key") || (header.startsWith("Bearer ck_") ? header.slice(7) : "");
  if (!/^ck_[a-f0-9]{48}$/.test(raw)) throw Errors.invalidApiKey();

  const key = await ApiKey.findOne({ hash: hashApiKey(raw) });
  if (!key || key.status !== "active" || (key.expiresAt && key.expiresAt < new Date())) {
    throw Errors.invalidApiKey();
  }
  if (!key.scopes.includes(scope)) throw Errors.apiKeyScope(scope);

  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    ApiKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  }
  req.apiKey = key;
  req.botUser = key.botUserId ? await User.findById(key.botUserId).select("-password") : null;
  next();
};
