// Tiện ích nội dung tin nhắn: độ dài theo ký tự Unicode, trích link, lệnh slash, preview inbox.

export const charLength = (s) => [...String(s ?? "")].length;

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

export function extractLinks(text) {
  const found = String(text ?? "").match(URL_RE) ?? [];
  const cleaned = found.map((u) => u.replace(/[),.;!?]+$/, ""));
  return [...new Set(cleaned)].slice(0, 20);
}

export function mediaKindFromMime(mime = "") {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

export function computeMediaKinds(attachments = [], links = []) {
  const kinds = new Set(attachments.map((a) => a.kind || mediaKindFromMime(a.mime)));
  if (links.length) kinds.add("link");
  return [...kinds];
}

// "/task @A làm báo cáo" → { name: "task", args: "@A làm báo cáo" } nếu rule đang bật.
export function parseCommand(text, rules = []) {
  const m = /^\/([a-z][a-z0-9_-]{0,31})(?:\s+([\s\S]*))?$/i.exec(String(text ?? "").trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  const rule = rules.find((r) => r.enabled && r.name?.toLowerCase() === name);
  if (!rule) return null;
  return { name, args: (m[2] ?? "").trim() };
}

export function messagePreview(message) {
  if (message.deletedAt) return "Tin nhắn đã bị xoá";
  switch (message.type) {
    case "sticker":
      return `[Sticker] ${message.sticker?.emoji ?? ""}`.trim();
    case "poll":
      return `[Bình chọn] ${message.text}`;
    case "system":
      return message.text;
    default:
      break;
  }
  if (message.text) return [...message.text].slice(0, 120).join("");
  const first = message.attachments?.[0];
  if (first) return first.kind === "image" ? "[Hình ảnh]" : `[Tệp] ${first.name ?? ""}`.trim();
  if (message.image) return "[Hình ảnh]";
  return "";
}
