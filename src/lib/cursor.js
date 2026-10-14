import mongoose from "mongoose";
import { Errors } from "./errors.js";

const enc = (s) => Buffer.from(String(s), "utf8").toString("base64url");
const dec = (s) => Buffer.from(String(s), "base64url").toString("utf8");

// Cursor theo seq tin nhắn: base64url("<seq>").
export const encodeSeq = (seq) => enc(seq);
export const decodeSeq = (cursor) => {
  const n = Number.parseInt(dec(cursor), 10);
  if (!Number.isSafeInteger(n) || n < 0) throw Errors.badCursor();
  return n;
};

// Cursor theo (thời gian, _id): base64url("<ms>|<id>") – inbox, hàng đợi, audit, search.
export const encodeTimeId = (date, id) => enc(`${new Date(date).getTime()}|${id}`);
export const decodeTimeId = (cursor) => {
  const [ms, id] = dec(cursor).split("|");
  const t = Number.parseInt(ms, 10);
  if (!Number.isSafeInteger(t) || !mongoose.isValidObjectId(id)) throw Errors.badCursor();
  return { date: new Date(t), id: new mongoose.Types.ObjectId(id) };
};

// Điều kiện "sau cursor" cho thứ tự giảm dần (field desc, _id desc).
export const afterTimeIdDesc = (field, cursor) => {
  const { date, id } = decodeTimeId(cursor);
  return { $or: [{ [field]: { $lt: date } }, { [field]: date, _id: { $lt: id } }] };
};

export const afterTimeIdAsc = (field, cursor) => {
  const { date, id } = decodeTimeId(cursor);
  return { $or: [{ [field]: { $gt: date } }, { [field]: date, _id: { $gt: id } }] };
};

export const parseLimit = (value, def, max) => {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
};
