// Phân quyền hệ thống kiểu Casbin: rule { sub: role, obj, act }, khớp
//   r.sub ∈ roles(user) && keyMatch(r.obj, p.obj) && (p.act == "*" || r.act == p.act)
// `admin:*` khớp mọi `admin:<x>`. Policy lưu trong settings và sửa được qua /api/admin/policies.

import { Errors } from "./errors.js";
import { getSettings } from "../services/settings.service.js";

export const KNOWN_OBJECTS = [
  "chat",
  "support",
  "admin:*",
  "admin:principals",
  "admin:webhooks",
  "admin:settings",
  "admin:audit",
  "admin:api_keys",
  "admin:policies",
];

const keyMatch = (reqObj, policyObj) =>
  policyObj.endsWith("*") ? reqObj.startsWith(policyObj.slice(0, -1)) : reqObj === policyObj;

export const rolesOf = (user) => (user?.roles?.length ? user.roles : ["member"]);

export function matches(rules, roles, obj, act) {
  return rules.some(
    (r) => roles.includes(r.sub) && keyMatch(obj, r.obj) && (r.act === "*" || r.act === act)
  );
}

export async function can(user, obj, act) {
  if (!user || user.kind !== "user" || user.status === "inactive") return false;
  const { policies } = await getSettings();
  return matches(policies, rolesOf(user), obj, act);
}

export const isAgent = (user) => can(user, "support", "write");

// Kiểm tra bộ rule trước khi lưu: role hợp lệ, object biết trước, không trùng,
// và admin vẫn giữ quyền sửa policy (tránh tự khoá).
export function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0 || rules.length > 200) {
    throw Errors.badPolicy("rules must contain 1..200 entries");
  }
  const seen = new Set();
  const clean = rules.map((r, i) => {
    const sub = String(r?.sub ?? "").trim();
    const obj = String(r?.obj ?? "").trim();
    const act = String(r?.act ?? "").trim();
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(sub)) throw Errors.badPolicy(`rules[${i}].sub`);
    if (!KNOWN_OBJECTS.includes(obj)) throw Errors.badPolicy(`rules[${i}].obj`);
    if (!["read", "write", "*"].includes(act)) throw Errors.badPolicy(`rules[${i}].act`);
    const key = `${sub}|${obj}|${act}`;
    if (seen.has(key)) throw Errors.badPolicy(`rules[${i}] duplicated`);
    seen.add(key);
    return { sub, obj, act };
  });
  if (!matches(clean, ["admin"], "admin:policies", "write")) {
    throw Errors.badPolicy("admin must keep write access to admin:policies");
  }
  return clean;
}
