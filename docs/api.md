# API

## 1. Nguồn chính thức

- **`api/openapi.yaml`** (OpenAPI 3.1) là hợp đồng API. `test/openapi.test.js` fail khi route trong `src/routes/*` và spec lệch nhau
  (thiếu, thừa, `$ref` hỏng, path param chưa khai báo).
- Xem và gọi thử: **`GET /api-docs`** (Scalar, nút "Test request" dùng Bearer token), file thô `GET /api-docs/openapi.yaml`.
  Tắt ở môi trường không muốn công khai bằng `API_DOCS_ENABLED=false`.
- Ví dụ chạy được end-to-end: collection Bruno `api-tests/bruno/` ([testing.md](testing.md)).

## 2. Bề mặt

| Prefix | Ai gọi | Xác thực |
| :--- | :--- | :--- |
| `/api/auth/*`, `/api/widget/sessions` | mọi client | public (signup/login/widget) hoặc session |
| `/api/me`, `/api/sync`, `/api/users`, `/api/conversations/*`, `/api/messages/*`, `/api/polls/*`, `/api/reminders/*`, `/api/blocks`, `/api/nicknames`, `/api/presence`, `/api/stickers`, `/api/files/signature` | web, mobile | cookie `jwt` hoặc `Authorization: Bearer <jwt>` |
| `/api/support/*` | khách (session) và nhân viên (`support:write`) | session |
| `/api/admin/*` | quản trị (policy `admin:*`) | session |
| `/api/open/v1/*` | đối tác | `X-Api-Key: ck_...` |
| `/health`, `/health/ready`, `/api-docs` | probe, người đọc | không |

## 3. Quy ước

- JSON camelCase; id là chuỗi ObjectId 24 hex; thời gian ISO 8601 UTC.
- Danh sách phân trang: `{ items, nextCursor, hasMore }`. Gửi lại `?cursor=<nextCursor>`.
  - Tin nhắn: `?before=<cursor>` (lùi, mặc định trang mới nhất), `?after=<cursor>` (tiến); cursor = base64url(seq); trang luôn trả **cũ → mới**.
  - Inbox, hàng đợi, audit, ghim, tìm kiếm: cursor = base64url(`<ms>|<id>`), mới nhất trước.
  - Người dùng, chặn, biệt danh: cursor = `_id` cuối trang.
  - `limit` có trần riêng từng route (50/100/200).
- `204` không có body. Body tối đa `JSON_BODY_LIMIT` (mặc định 10mb) → `CHAT-413-000`.
- Idempotency gửi tin: `clientMsgId` (lần đầu 201, gửi lại 200 trả tin cũ).

## 4. Lỗi

```json
{ "message": "Not a member of this conversation", "code": "CHAT-403-003",
  "fields": [{ "field": "title", "message": "Required" }] }
```

`fields` chỉ có ở `CHAT-400-000`. Client xử lý theo `code`, không theo `message`.

| Code | HTTP | Ý nghĩa |
| :--- | :--- | :--- |
| CHAT-400-000 | 400 | Dữ liệu không hợp lệ (`fields[]`), JSON hỏng |
| CHAT-400-001 | 400 | Direct với chính mình |
| CHAT-400-002 | 400 | Nhóm vượt `GROUP_MAX_MEMBERS` |
| CHAT-400-003 | 400 | Hội thoại này không đổi thành viên/tên được (direct, support) |
| CHAT-400-004 | 400 | Tin quá `MESSAGE_MAX_CHARS` |
| CHAT-400-005 | 400 | Tin rỗng |
| CHAT-400-006 | 400 | Cursor / `since` sai |
| CHAT-400-007 | 400 | MIME không cho phép |
| CHAT-400-008 | 400 | Không phải hội thoại support |
| CHAT-400-009 | 400 | Policy không hợp lệ |
| CHAT-400-010 | 400 | Phiếu bình chọn không hợp lệ |
| CHAT-400-011 | 400 | Sticker không có trong catalogue |
| CHAT-400-014 | 400 | Timezone không phải tên IANA |
| CHAT-400-015 | 400 | Sai thông tin đăng nhập |
| CHAT-401-000 | 401 | Thiếu credential |
| CHAT-401-001 | 401 | Token sai / hết hạn |
| CHAT-401-002 | 401 | Session đã bị thu hồi |
| CHAT-401-005 | 401 | API key sai / thu hồi / hết hạn |
| CHAT-403-000 | 403 | Không có quyền (policy, kind) – message có `obj:act` |
| CHAT-403-001 | 403 | Widget hỗ trợ đang tắt |
| CHAT-403-002 | 403 | Tài khoản bị khoá |
| CHAT-403-003 | 403 | Không phải thành viên |
| CHAT-403-004 | 403 | Chỉ owner/admin nhóm (hoặc người tạo poll) |
| CHAT-403-005 | 403 | Chỉ người gửi |
| CHAT-403-006 | 403 | Chỉ nhân viên hỗ trợ |
| CHAT-403-007 | 403 | API key thiếu scope |
| CHAT-403-008 | 403 | Bị chặn |
| CHAT-403-009 | 403 | Tin trước mốc lịch sử được xem |
| CHAT-404-000 | 404 | Không tìm thấy (route, session, delivery...) |
| CHAT-404-001 | 404 | Người dùng |
| CHAT-404-002 | 404 | Hội thoại |
| CHAT-404-003 | 404 | Tin nhắn (cả `replyTo`, tin đã ẩn) |
| CHAT-404-006 | 404 | Webhook |
| CHAT-404-007 | 404 | API key |
| CHAT-404-008 | 404 | Bình chọn |
| CHAT-404-009 | 404 | Nhắc việc (cả của người khác) |
| CHAT-409-000 | 409 | Xung đột chung (quá số ghim hội thoại, nhắc việc, reopen khi khách đang có hội thoại mở...) |
| CHAT-409-001 | 409 | Đã là thành viên |
| CHAT-409-002 | 409 | Owner cuối không rời/bị xoá/bị hạ quyền |
| CHAT-409-003 | 409 | Hội thoại support đã đóng |
| CHAT-409-004 | 409 | Tin đã xoá |
| CHAT-409-006 | 409 | Yêu cầu hỗ trợ đã có nhân viên nhận |
| CHAT-409-007 | 409 | Bình chọn đã đóng |
| CHAT-409-009 | 409 | Hội thoại đã ghim đủ `PINNED_MESSAGES_MAX` tin |
| CHAT-409-010 | 409 | Tin đã đủ `REACTION_MAX_EMOJI_PER_MESSAGE` emoji |
| CHAT-409-011 | 409 | Đã chặn người này |
| CHAT-413-000 | 413 | Body quá lớn |
| CHAT-413-001 | 413 | File quá `FILE_MAX_SIZE_BYTES` |
| CHAT-429-000 | 429 | Quá giới hạn tần suất (có header `Retry-After`) |
| CHAT-500-000 | 500 | Lỗi chưa phân loại (xem log server) |
| CHAT-503-001 | 503 | Chưa cấu hình Cloudinary |

Thêm mã mới: `src/lib/errors.js` + bảng này + spec nếu route trả mã đó.

## 5. API cũ (giữ tương thích)

`POST /api/auth/signup|login|logout`, `PUT /api/auth/update-profile`, `GET /api/auth/check`, `GET /api/messages/users`,
`GET /api/messages/:id`, `POST /api/messages/send/:id`, socket event `newMessage`, `getOnlineUsers`. Response giữ field cũ
(`profileImg`, `receiverId`, mảng tin nhắn không phân trang).
