import mongoose from "mongoose";
import { z } from "zod";
import { Errors } from "./errors.js";

export { z };

export const objectId = z
  .string()
  .refine((v) => mongoose.isValidObjectId(v) && /^[a-f0-9]{24}$/i.test(v), "invalid id");

// URL ảnh/link hiển thị cho người khác: chỉ http(s) (chặn javascript:, data: ...).
export const httpUrl = z
  .string()
  .max(2000)
  .refine((v) => /^https?:\/\/[^\s]+$/i.test(v), "must be an http(s) URL");

const IMAGE_DATA_URI = /^data:image\/[a-z0-9.+-]+;base64,/i;

export const imageDataUri = z.string().max(15_000_000).regex(IMAGE_DATA_URI, "must be an image data URI");

// Ảnh đại diện: URL http(s) hoặc data URI ảnh (server upload lên Cloudinary).
export const imageInput = z
  .string()
  .max(15_000_000)
  .refine((v) => /^https?:\/\/[^\s]+$/i.test(v) || IMAGE_DATA_URI.test(v), "must be an http(s) URL or an image data URI");

// Parse theo schema zod; lỗi → CHAT-400-000 kèm danh sách field.
export const parse = (schema, data) => {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields = result.error.issues.map((i) => ({
    field: i.path.join(".") || "(body)",
    message: i.message,
  }));
  throw Errors.validation("Invalid data", fields);
};

export const toObjectId = (id, notFound = Errors.notFound) => {
  if (!mongoose.isValidObjectId(id) || !/^[a-f0-9]{24}$/i.test(String(id))) throw notFound();
  return new mongoose.Types.ObjectId(String(id));
};

export const sameId = (a, b) => a != null && b != null && String(a) === String(b);
