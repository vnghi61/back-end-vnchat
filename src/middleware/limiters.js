import { config } from "../config.js";
import { rateLimit } from "./rateLimit.js";

// Gửi tin (mọi đường: REST mới, API cũ, chuyển tiếp, bình chọn) dùng chung một hạn mức / người.
export const messageLimiter = rateLimit({
  limit: config.rateLimit.messagesPerMinute,
  key: (req) => `msg:${req.user._id}`,
});

export const widgetLimiter = rateLimit({
  limit: config.rateLimit.widgetSessionsPerMinute,
  key: (req) => `widget:${req.ip}`,
});
