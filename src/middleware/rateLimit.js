import { Errors } from "../lib/errors.js";

// Giới hạn cửa sổ cố định trong bộ nhớ (một instance). key(req) → chuỗi định danh.
export const rateLimit = ({ limit, windowMs = 60_000, key }) => {
  const hits = new Map();
  let lastPrune = Date.now();
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastPrune > windowMs) {
      for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
      lastPrune = now;
    }
    const id = key(req);
    let entry = hits.get(id);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(id, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.set("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      throw Errors.rateLimited();
    }
    next();
  };
};
