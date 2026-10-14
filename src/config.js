// Mọi cấu hình đọc từ biến môi trường (.env được nạp bởi `import "dotenv/config"` ở src/index.js).

const int = (name, def) => {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : def;
};

const bool = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
};

const list = (name, def) => {
  const v = process.env[name];
  if (!v) return def;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
};

export const config = {
  env: process.env.NODE_ENV || "development",
  version: process.env.APP_VERSION || process.env.RENDER_GIT_COMMIT?.slice(0, 7) || "dev",
  port: int("PORT", 5001),
  corsOrigins: list("CLIENT_URL", ["http://localhost:5174"]),
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || "10mb",
  apiDocsEnabled: bool("API_DOCS_ENABLED", true),
  // thư mục build frontend khi muốn phục vụ chung process (production)
  frontendDist: process.env.FRONTEND_DIST || "../frontend/dist",

  jwtSecret: process.env.JWT_SECRET,
  sessionTtlDays: int("SESSION_TTL_DAYS", 7),
  // strict (mặc định) | lax | none – frontend khác domain với API mà vẫn dùng cookie thì đặt none (luôn kèm Secure)
  cookieSameSite: ["strict", "lax", "none"].includes((process.env.COOKIE_SAMESITE ?? "").toLowerCase())
    ? process.env.COOKIE_SAMESITE.toLowerCase()
    : "strict",
  visitorSecret: process.env.VISITOR_SECRET || process.env.JWT_SECRET,

  cloudinaryFolder: process.env.CLOUDINARY_FOLDER || "vnchat",

  limits: {
    maxMessageChars: int("MESSAGE_MAX_CHARS", 8000),
    maxGroupMembers: int("GROUP_MAX_MEMBERS", 500),
    reactionMaxEmoji: int("REACTION_MAX_EMOJI_PER_MESSAGE", 20),
    pinnedMessagesMax: int("PINNED_MESSAGES_MAX", 50),
    pinnedConversationsMax: int("PINNED_CONVERSATIONS_MAX", 50),
    forwardMaxTargets: int("FORWARD_MAX_TARGETS", 10),
    pollMaxOptions: int("POLL_MAX_OPTIONS", 10),
    remindersMaxPerUser: int("REMINDERS_MAX_PER_USER", 200),
    maxFileBytes: int("FILE_MAX_SIZE_BYTES", 25 * 1024 * 1024),
    allowedMime: list("FILE_ALLOWED_MIME", [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
      "audio/mpeg",
      "audio/mp4",
      "audio/aac",
      "video/mp4",
      "application/zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]),
    supportTagsMax: int("SUPPORT_TAGS_MAX", 20),
  },

  rateLimit: {
    messagesPerMinute: int("RATE_LIMIT_MESSAGES_PER_MINUTE", 60),
    loginPerMinute: int("RATE_LIMIT_LOGIN_PER_MINUTE", 20),
    widgetSessionsPerMinute: int("RATE_LIMIT_WIDGET_SESSIONS_PER_MINUTE", 30),
  },

  typingThrottleMs: int("TYPING_THROTTLE_MS", 3000),
  presenceTtlMs: int("PRESENCE_TTL_MS", 60000),

  widgetEnabledDefault: bool("WIDGET_ENABLED", true),

  webhook: {
    timeoutMs: int("WEBHOOK_TIMEOUT_MS", 10000),
    maxAttempts: int("WEBHOOK_MAX_ATTEMPTS", 8),
    allowPrivateNetworks: bool("WEBHOOK_ALLOW_PRIVATE_NETWORKS", true),
    retentionDays: 14,
  },

  sweepIntervalMs: int("SWEEP_INTERVAL_MS", 10000),
};

export const isProduction = () => config.env === "production";
