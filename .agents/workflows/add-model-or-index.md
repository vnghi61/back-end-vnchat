---
description: Thêm collection / field / index Mongo và nâng dữ liệu cũ
---

# Workflow: Add Model, Field or Index

## Bước 1 – Schema

- Collection mới: `src/models/<name>.model.js` (hoặc gom vào file cùng nhóm như `admin.model.js`, `social.model.js`).
- Field mới: thêm vào schema với `default` hợp lý để document cũ vẫn đọc được. **Không** đổi kiểu hay xoá field đang có dữ liệu – thêm field mới và chuyển dần.
- Field chỉ có ở vài document: `default: undefined` (không ghi field rỗng) hoặc `null` nếu cần query `{field: null}`.
- Trạng thái chuyển đổi (status, version, rev) → cập nhật bằng compare-and-set (`findOneAndUpdate({_id, status: "x"}, ...)`), không đọc-rồi-ghi.

## Bước 2 – Index

- Khai báo bằng `schema.index(...)` cạnh schema. Unique trên field tuỳ chọn → `partialFilterExpression: { field: { $type: "string" } }` (không dùng `sparse` cho unique kết hợp).
- Mỗi query mới trên collection lớn phải có index khớp (filter + sort). Text search: chỉ một text index / collection (`messages.text` đã dùng).
- Boot chạy `syncIndexes()` cho **mọi model**: index mới tự tạo, index **không còn trong schema bị xoá**, index đổi option được tạo lại. Collection lớn trên production: tạo index thủ công trước (Atlas UI) rồi mới deploy để tránh build chặn lúc boot.
- Model mới phải được import ở `src/services/migration.service.js` (dòng `import "../models/..."`) nếu không file nào khác import nó lúc boot.

## Bước 3 – Nâng dữ liệu cũ

Viết trong `src/services/migration.service.js`, gọi từ `runMigrations()`:

- **Idempotent** (chạy mỗi lần boot): lọc theo dấu hiệu "chưa nâng" (`{newField: {$exists: false}}`).
- Dùng `bulkWrite` theo lô, `timestamps: false` để không đổi `updatedAt`.
- Không xoá dữ liệu; bản trước phải còn đọc được (rollback trên Render).

## Bước 4 – Serializer, docs, test

1. Field trả ra client → `src/lib/serializers.js` + schema trong `api/openapi.yaml`.
2. `docs/data-model.md` (field + index).
3. Test: hành vi mới trong test tích hợp; nâng dữ liệu → `test/migration.test.js` (chèn document dạng cũ bằng `mongoose.connection.db.collection(...)` rồi chạy `runMigrations()` hai lần).
