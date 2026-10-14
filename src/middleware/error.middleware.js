import { AppError } from "../lib/errors.js";

export const notFoundHandler = (req, res) => {
  res.status(404).json({ message: "Route not found", code: "CHAT-404-000" });
};

// Express 5 chuyển lỗi của handler async vào đây.
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ message: err.message, code: err.code, ...err.extra });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large", code: "CHAT-413-000" });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Malformed JSON body", code: "CHAT-400-000" });
  }
  if (err?.name === "CastError") {
    return res.status(404).json({ message: "Not found", code: "CHAT-404-000" });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ message: "Conflict", code: "CHAT-409-000" });
  }
  console.log("Unhandled error", req.method, req.originalUrl, err);
  return res.status(500).json({ message: "Internal Server Error", code: "CHAT-500-000" });
};
