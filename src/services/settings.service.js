import { config } from "../config.js";
import { Settings } from "../models/admin.model.js";

// Policy mặc định (giống deploy/casbin/policy.csv của chat-platform).
export const DEFAULT_POLICIES = [
  { sub: "admin", obj: "admin:*", act: "*" },
  { sub: "admin", obj: "support", act: "*" },
  { sub: "admin", obj: "chat", act: "*" },
  { sub: "agent", obj: "support", act: "*" },
  { sub: "agent", obj: "chat", act: "*" },
  { sub: "member", obj: "chat", act: "*" },
];

const defaults = () => ({
  branding: { appName: "VNChat", logoUrl: "", primaryColor: "" },
  commandRules: [
    { name: "task", description: "Giao việc cho người được tag", enabled: true },
    { name: "kpi", description: "Ghi nhận KPI cho người được tag", enabled: false },
  ],
  stickerPacks: [
    {
      id: "basic",
      name: "Cơ bản",
      stickers: [
        { id: "hi", name: "Chào", emoji: "👋", url: "" },
        { id: "love", name: "Yêu", emoji: "❤️", url: "" },
        { id: "haha", name: "Haha", emoji: "😂", url: "" },
        { id: "ok", name: "OK", emoji: "👌", url: "" },
      ],
    },
  ],
  widget: {
    enabled: config.widgetEnabledDefault,
    welcomeMessage: "Xin chào! Nhân viên hỗ trợ sẽ phản hồi bạn trong ít phút.",
  },
  policies: DEFAULT_POLICIES,
});

const CACHE_MS = 30_000;
let cache = null;

// Settings luôn đủ field: field chưa lưu lấy giá trị mặc định.
export async function getSettings() {
  if (cache && cache.expires > Date.now()) return cache.value;
  const doc = await Settings.findById("global").lean();
  const base = defaults();
  const value = {
    branding: { ...base.branding, ...(doc?.branding ?? {}) },
    commandRules: doc?.commandRules ?? base.commandRules,
    stickerPacks: doc?.stickerPacks ?? base.stickerPacks,
    widget: { ...base.widget, ...(doc?.widget ?? {}) },
    policies: doc?.policies?.length ? doc.policies : base.policies,
    updatedAt: doc?.updatedAt ?? null,
  };
  cache = { value, expires: Date.now() + CACHE_MS };
  return value;
}

export async function updateSettings(patch) {
  const $set = {};
  for (const key of ["branding", "commandRules", "stickerPacks", "widget", "policies"]) {
    if (patch[key] !== undefined) $set[key] = patch[key];
  }
  await Settings.updateOne({ _id: "global" }, { $set }, { upsert: true });
  cache = null;
  return getSettings();
}

export function invalidateSettings() {
  cache = null;
}

export async function findSticker(packId, stickerId) {
  const { stickerPacks } = await getSettings();
  const pack = stickerPacks.find((p) => p.id === packId);
  return pack?.stickers?.find((s) => s.id === stickerId) ?? null;
}
