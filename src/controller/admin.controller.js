import crypto from "node:crypto";
import { ApiKey, AuditLog, Webhook, WebhookDelivery } from "../models/admin.model.js";
import User from "../models/user.model.js";
import { Errors } from "../lib/errors.js";
import { afterTimeIdDesc, encodeTimeId, parseLimit } from "../lib/cursor.js";
import { normalizeName } from "../lib/names.js";
import { can, KNOWN_OBJECTS, validateRules } from "../lib/permissions.js";
import { userProfile } from "../lib/serializers.js";
import { escapeRegex } from "../lib/utlist.js";
import { httpUrl, parse, sameId, toObjectId, z } from "../lib/validate.js";
import { hashApiKey } from "../middleware/apikey.middleware.js";
import { audit } from "../services/audit.service.js";
import { realtime } from "../services/realtime.service.js";
import { revokeAllSessions } from "../services/session.service.js";
import { getSettings, updateSettings } from "../services/settings.service.js";
import {
  invalidateWebhookCache,
  redeliver,
  validateWebhookUrl,
  WEBHOOK_EVENTS,
} from "../services/webhook.service.js";

// ======================= người dùng =======================

export const listUsers = async (req, res) => {
  const limit = parseLimit(req.query.limit, 50, 200);
  const filter = {};
  if (req.query.kind) filter.kind = req.query.kind;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.role) filter.roles = req.query.role;
  const q = String(req.query.q ?? "").trim();
  if (q) {
    filter.$or = [
      { nameSearch: { $regex: `(^|\\s)${escapeRegex(normalizeName(q))}` } },
      { email: { $regex: `^${escapeRegex(q.toLowerCase())}` } },
      { contactEmail: { $regex: `^${escapeRegex(q.toLowerCase())}` } },
    ];
  }
  if (req.query.cursor) filter._id = { $gt: toObjectId(req.query.cursor, Errors.badCursor) };
  const users = await User.find(filter).sort({ _id: 1 }).limit(limit + 1).lean();
  const hasMore = users.length > limit;
  const page = users.slice(0, limit);
  res.status(200).json({
    items: page.map((u) => userProfile(u, { includeEmail: true, includeAdmin: true })),
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    hasMore,
  });
};

async function loadManagedUser(id) {
  const user = await User.findById(toObjectId(id, Errors.userNotFound));
  if (!user) throw Errors.userNotFound();
  if (user.kind !== "user") throw Errors.validation("only registered users have roles");
  return user;
}

async function assertAnotherAdmin(userId) {
  const others = await User.countDocuments({ _id: { $ne: userId }, kind: "user", status: "active", roles: "admin" });
  if (!others) throw Errors.conflict("at least one active admin must remain");
}

export const updateUserRoles = async (req, res) => {
  const { roles } = parse(z.object({ roles: z.array(z.enum(["admin", "agent", "member"])).min(1).max(3) }), req.body);
  const user = await loadManagedUser(req.params.id);
  const next = [...new Set(roles)];
  if (user.roles.includes("admin") && !next.includes("admin")) await assertAnotherAdmin(user._id);

  const previous = user.roles;
  user.roles = next;
  await user.save();
  realtime.setAgent(user._id, await can(user, "support", "write"));
  await audit(req, "user.roles.updated", { targetType: "user", targetId: user._id, metadata: { previous, roles: next } });
  res.status(200).json(userProfile(user, { includeEmail: true, includeAdmin: true }));
};

// inactive → thu hồi mọi session, ngắt socket, chặn đăng nhập.
export const updateUserStatus = async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["active", "inactive"]) }), req.body);
  const user = await User.findById(toObjectId(req.params.id, Errors.userNotFound));
  if (!user) throw Errors.userNotFound();
  if (sameId(user._id, req.user._id) && status === "inactive") throw Errors.validation("you cannot lock your own account");
  if (status === "inactive" && user.roles.includes("admin")) await assertAnotherAdmin(user._id);

  user.status = status;
  await user.save();
  if (status === "inactive") await revokeAllSessions(user._id, "disabled");
  await audit(req, "user.status.updated", { targetType: "user", targetId: user._id, metadata: { status } });
  res.status(200).json(userProfile(user, { includeEmail: true, includeAdmin: true }));
};

// ======================= webhook =======================

const webhookResponse = (w) => ({
  _id: w._id,
  name: w.name,
  url: w.url,
  events: w.events,
  enabled: w.enabled,
  createdBy: w.createdBy,
  createdAt: w.createdAt,
  updatedAt: w.updatedAt,
});

const webhookSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().max(2000),
  events: z.array(z.enum(["*", ...WEBHOOK_EVENTS])).min(1),
  secret: z.string().min(16).max(200).optional(),
  enabled: z.boolean().optional(),
});

function checkUrl(url) {
  const problem = validateWebhookUrl(url);
  if (problem) throw Errors.validation(problem, [{ field: "url", message: problem }]);
}

export const listWebhooks = async (req, res) => {
  const hooks = await Webhook.find().sort({ createdAt: -1 }).lean();
  res.status(200).json({ items: hooks.map(webhookResponse), events: WEBHOOK_EVENTS });
};

export const createWebhook = async (req, res) => {
  const body = parse(webhookSchema, req.body);
  checkUrl(body.url);
  const secret = body.secret ?? crypto.randomBytes(32).toString("hex");
  const hook = await Webhook.create({
    name: body.name,
    url: body.url,
    events: [...new Set(body.events)],
    secret,
    enabled: body.enabled ?? true,
    createdBy: req.user._id,
  });
  invalidateWebhookCache();
  await audit(req, "webhook.created", { targetType: "webhook", targetId: hook._id, metadata: { url: hook.url } });
  // secret chỉ trả về đúng lần này
  res.status(201).json({ webhook: webhookResponse(hook), secret });
};

export const updateWebhook = async (req, res) => {
  const body = parse(webhookSchema, req.body);
  checkUrl(body.url);
  const $set = { name: body.name, url: body.url, events: [...new Set(body.events)] };
  if (body.secret) $set.secret = body.secret;
  if (body.enabled !== undefined) $set.enabled = body.enabled;
  const hook = await Webhook.findByIdAndUpdate(toObjectId(req.params.id, Errors.webhookNotFound), { $set }, { new: true });
  if (!hook) throw Errors.webhookNotFound();
  invalidateWebhookCache();
  await audit(req, "webhook.updated", { targetType: "webhook", targetId: hook._id });
  res.status(200).json(webhookResponse(hook));
};

export const deleteWebhook = async (req, res) => {
  const hook = await Webhook.findByIdAndDelete(toObjectId(req.params.id, Errors.webhookNotFound));
  if (!hook) throw Errors.webhookNotFound();
  invalidateWebhookCache();
  await audit(req, "webhook.deleted", { targetType: "webhook", targetId: hook._id });
  res.status(204).end();
};

export const listDeliveries = async (req, res) => {
  const hookId = toObjectId(req.params.id, Errors.webhookNotFound);
  if (!(await Webhook.exists({ _id: hookId }))) throw Errors.webhookNotFound();
  const deliveries = await WebhookDelivery.find({ subscriptionId: hookId })
    .sort({ createdAt: -1 })
    .limit(100)
    .select("-payload")
    .lean();
  res.status(200).json(deliveries);
};

export const redeliverHandler = async (req, res) => {
  const id = toObjectId(req.params.deliveryId, Errors.notFound);
  if (!(await redeliver(id))) throw Errors.notFound("delivery");
  await audit(req, "webhook.redelivered", { targetType: "webhook_delivery", targetId: id });
  res.status(204).end();
};

// ======================= settings =======================

const stickerSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().max(100).default(""),
  emoji: z.string().max(16).default(""),
  url: httpUrl.or(z.literal("")).default(""),
});

const settingsSchema = z.object({
  branding: z
    .object({
      appName: z.string().max(100).optional(),
      logoUrl: httpUrl.or(z.literal("")).optional(),
      primaryColor: z.string().max(32).optional(),
    })
    .optional(),
  commandRules: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
        description: z.string().max(200).default(""),
        enabled: z.boolean().default(true),
      })
    )
    .max(50)
    .optional(),
  stickerPacks: z
    .array(z.object({ id: z.string().trim().min(1).max(64), name: z.string().trim().max(100), stickers: z.array(stickerSchema).max(200) }))
    .max(50)
    .optional(),
  widget: z.object({ enabled: z.boolean().optional(), welcomeMessage: z.string().max(1000).optional() }).optional(),
});

export const getSettingsHandler = async (req, res) => {
  const { policies, ...settings } = await getSettings();
  res.status(200).json(settings);
};

export const updateSettingsHandler = async (req, res) => {
  const body = parse(settingsSchema, req.body);
  if (body.stickerPacks) {
    const packIds = new Set();
    body.stickerPacks.forEach((p, i) => {
      if (packIds.has(p.id)) throw Errors.validation("duplicated sticker pack id", [{ field: `stickerPacks.${i}.id`, message: "duplicated" }]);
      packIds.add(p.id);
      const stickerIds = new Set();
      p.stickers.forEach((s, j) => {
        if (stickerIds.has(s.id)) {
          throw Errors.validation("duplicated sticker id", [{ field: `stickerPacks.${i}.stickers.${j}.id`, message: "duplicated" }]);
        }
        stickerIds.add(s.id);
      });
    });
  }
  if (body.commandRules) {
    const names = body.commandRules.map((r) => r.name);
    if (new Set(names).size !== names.length) throw Errors.validation("duplicated command name");
  }
  const current = await getSettings();
  const patch = { ...body };
  if (body.branding) patch.branding = { ...current.branding, ...body.branding };
  if (body.widget) patch.widget = { ...current.widget, ...body.widget };
  const { policies, ...updated } = await updateSettings(patch);
  await audit(req, "settings.updated", { metadata: { keys: Object.keys(body) } });
  res.status(200).json(updated);
};

// ======================= audit =======================

export const listAudit = async (req, res) => {
  const limit = parseLimit(req.query.limit, 50, 200);
  const filter = {};
  if (req.query.actorId) filter.actorId = toObjectId(req.query.actorId, Errors.badCursor);
  if (req.query.action) filter.action = String(req.query.action);
  if (req.query.cursor) Object.assign(filter, afterTimeIdDesc("createdAt", req.query.cursor));
  const logs = await AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
  const hasMore = logs.length > limit;
  const page = logs.slice(0, limit);
  const last = page[page.length - 1];
  res.status(200).json({ items: page, nextCursor: hasMore ? encodeTimeId(last.createdAt, last._id) : null, hasMore });
};

// ======================= API key đối tác =======================

export const API_KEY_SCOPES = ["conversations:read", "messages:read", "messages:write", "support:write"];

const apiKeyResponse = (k) => ({
  _id: k._id,
  name: k.name,
  prefix: k.prefix,
  scopes: k.scopes,
  status: k.status,
  expiresAt: k.expiresAt ?? null,
  lastUsedAt: k.lastUsedAt ?? null,
  botUserId: k.botUserId ?? null,
  createdBy: k.createdBy,
  createdAt: k.createdAt,
  revokedAt: k.revokedAt ?? null,
});

export const listApiKeys = async (req, res) => {
  const keys = await ApiKey.find().sort({ createdAt: -1 }).lean();
  res.status(200).json({ items: keys.map(apiKeyResponse), scopes: API_KEY_SCOPES });
};

export const createApiKey = async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(100),
      scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
      expiresAt: z.string().datetime({ offset: true }).optional(),
    }),
    req.body
  );
  const raw = `ck_${crypto.randomBytes(24).toString("hex")}`;
  const bot = await User.create({ kind: "bot", name: body.name, roles: [] });
  const key = await ApiKey.create({
    name: body.name,
    prefix: raw.slice(0, 12),
    hash: hashApiKey(raw),
    scopes: [...new Set(body.scopes)],
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    botUserId: bot._id,
    createdBy: req.user._id,
  });
  await User.updateOne({ _id: bot._id }, { $set: { apiKeyId: key._id } });
  await audit(req, "api_key.created", { targetType: "api_key", targetId: key._id, metadata: { scopes: key.scopes } });
  // raw key chỉ trả về đúng lần này
  res.status(201).json({ apiKey: apiKeyResponse(key), key: raw });
};

export const revokeApiKey = async (req, res) => {
  const key = await ApiKey.findOneAndUpdate(
    { _id: toObjectId(req.params.id, Errors.apiKeyNotFound), status: "active" },
    { $set: { status: "revoked", revokedAt: new Date() } },
    { new: true }
  );
  if (!key) {
    if (!(await ApiKey.exists({ _id: req.params.id }))) throw Errors.apiKeyNotFound();
    return res.status(204).end();
  }
  await audit(req, "api_key.revoked", { targetType: "api_key", targetId: key._id });
  res.status(204).end();
};

// ======================= policy =======================

export const getPolicies = async (req, res) => {
  const { policies } = await getSettings();
  res.status(200).json({ rules: policies, objects: KNOWN_OBJECTS, actions: ["read", "write", "*"] });
};

export const updatePolicies = async (req, res) => {
  const rules = validateRules(req.body?.rules);
  await updateSettings({ policies: rules });
  await audit(req, "policy.updated", { metadata: { count: rules.length } });
  res.status(200).json({ rules, objects: KNOWN_OBJECTS, actions: ["read", "write", "*"] });
};
