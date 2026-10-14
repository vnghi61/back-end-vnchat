---
description: Quy trình debug và fix bug
---

# Workflow: Fix Bug

> Bốn pha: reproduce → khoanh vùng → nguyên nhân gốc → sửa + test hồi quy. Không sửa theo triệu chứng.

## Bước 1 – Thu thập

- `code` trong response lỗi (`CHAT-xxx-yyy`) và HTTP status; với 500, log server có dòng `Unhandled error <method> <url>` kèm stack.
- Render: Dashboard → Logs. Docker: `docker compose logs api`. `/health` trả `version` để biết đang chạy commit nào.
- Realtime: client có nhận `ready` không? `connect_error` → `err.data.code`.

## Bước 2 – Khoanh vùng theo mã

| Dấu hiệu | Nơi xem |
| :--- | :--- |
| 400-000 `fields` | zod schema trong controller |
| 401-xxx | `services/session.service.js`, `middleware/auth.middleware.js`, cookie `COOKIE_SAMESITE`/CORS `CLIENT_URL` |
| 403-000 (`obj:act`) | policy (`lib/permissions.js`, `GET /api/admin/policies`), route `authorize(...)` |
| 403-003..009 | quyền trong hội thoại: `services/conversation.service.js` (`loadForRead/loadForMember`), controller |
| 404-xxx | id sai/không thuộc hội thoại, tin bị ẩn (`hiddenFor`) |
| 409-xxx | trạng thái: support đóng, CAS thua, giới hạn ghim/reaction |
| Sai dữ liệu tin/unread | `services/message.service.js` (`allocateSeq`, `afterInsert`), `lib/serializers.js#unreadOf` |
| Thiếu realtime | room (`lib/socket.js` join lúc kết nối, `joinConversation` khi thêm thành viên), tên event |
| Webhook không tới | `GET /api/admin/webhooks/:id/deliveries` (`lastError`, `lastStatusCode`), SSRF policy |
| Chậm khi boot | `syncIndexes` trên collection lớn ([add-model-or-index.md](add-model-or-index.md)) |

## Bước 3 – Tái hiện bằng test

Viết test tích hợp fail trước (cùng file với tính năng), dùng `setup()`/`signup()`/`connect()` ([testing.md](testing.md)).
Race condition: `Promise.all([...])` hai request song song.

## Bước 4 – Sửa

- Sửa nguyên nhân gốc ở đúng lớp (route quyền hệ thống, service nghiệp vụ, serializer hình dạng JSON).
- Ghi đồng thời → điều kiện trong filter của `findOneAndUpdate`/`updateOne`, không đọc-rồi-ghi.
- Không nuốt lỗi bằng `try/catch` rỗng; lỗi nghiệp vụ → `Errors.*`.

## Bước 5 – Xác minh

`npm test` xanh; nếu chạm API, chạy thêm Bruno (`npm run test:api`). Ghi `CHANGELOG.md` mục Fixed.
