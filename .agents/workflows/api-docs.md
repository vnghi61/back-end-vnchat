---
description: Giữ tài liệu API (OpenAPI/Scalar) và bộ Bruno khớp code
---

# Workflow: API Docs

## Nguồn

| Thứ | File | Ai kiểm tra |
| :--- | :--- | :--- |
| Hợp đồng API | `api/openapi.yaml` (OpenAPI 3.1) | `test/openapi.test.js`: mọi route có trong spec, spec không có route ma, `$ref` resolve được, path param được khai báo |
| Trang tài liệu | `GET /api-docs` (Scalar `@scalar/api-reference@1.71.0` từ jsDelivr, đọc `/api-docs/openapi.yaml`) | thủ công |
| Ví dụ chạy được | `api-tests/bruno/**/*.bru` | CI job `docker` |
| Quy ước, mã lỗi, realtime | `docs/api.md`, `docs/realtime.md`, `docs/webhooks.md` | review |

## Khi đổi API

1. Sửa `api/openapi.yaml` **cùng commit** với route: path dùng `{param}` (test tự đổi `:param`), param bằng `$ref` có sẵn
   (`id`, `userId`, `messageId`, `cursor`, `limit`), response dùng `components/responses` (`Error`, `MessageOk`, `ConversationOk`, `Paged*`).
2. Schema JSON trả về phải khớp `src/lib/serializers.js`.
3. Mã lỗi mới → `docs/api.md` §4.
4. Thêm/sửa request Bruno: file `NN-<ten>.bru` trong folder đúng, `seq` tăng dần, `auth:bearer { token: {{aliceToken}} }`,
   lưu biến bằng `bru.setVar(...)` trong `script:post-response`, kiểm tra bằng block `tests`. Request phụ thuộc biến của folder trước → giữ thứ tự folder.
5. Kiểm tra: `node --test test/openapi.test.js`, mở `http://localhost:5001/api-docs`, `npm run test:api`.

## Đổi phiên bản Scalar

Sửa hằng `SCALAR` trong `src/routes/docs.route.js`; chỉ dùng phiên bản cụ thể đã phát hành ≥ 2 tuần (không dùng `latest`).
