---
doc_type: module_index
project: back-end-vnchat
last_verified: 2026-10-14
---

# MODULE_INDEX.md — Bản đồ source

> AI assistant: đây là lần đọc thứ hai, sau [AGENT.md](AGENT.md). Tìm tính năng ở §1 rồi mở đúng các file đó.

## 1. "Tôi cần sửa X – mở file nào?"

| Cần sửa… | Route | Controller | Service / lib | Model | Test | Docs |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Đăng ký, đăng nhập, session, logout-all | `routes/auth.route.js` | `controller/auth.controller.js` | `services/session.service.js`, `lib/utlist.js` | `user`, `session` | `test/auth.test.js` | `docs/auth.md` |
| Khách widget (visitor) | `routes/support.route.js` (`widgetRouter`) | `auth.controller.js#widgetSession` | `session.service.js` | `user` (kind visitor) | `test/support.test.js` | `docs/support.md` |
| Hồ sơ, bootstrap, `/sync`, tìm người dùng | `routes/user.route.js` | `controller/user.controller.js` | `lib/serializers.js`, `lib/names.js` | `user`, `conversation` | `test/auth.test.js`, `test/chat.test.js` | `docs/frontend-integration.md` |
| Hội thoại 1-1 / nhóm, thành viên, role, mute/pin/archive, read | `routes/conversation.route.js` | `controller/conversation.controller.js` | `services/conversation.service.js` | `conversation` | `test/chat.test.js` | `docs/data-model.md` |
| Gửi / sửa / xoá tin, reply, mention, reaction, ghim, ẩn, forward, media, search, sticker, lệnh `/` | `routes/conversation.route.js`, `routes/message.route.js` | `controller/message.controller.js` | `services/message.service.js`, `lib/text.js` | `message` | `test/chat.test.js` | `docs/architecture.md` §3 |
| API cũ `/api/messages/*` | `routes/message.route.js` | `message.controller.js` (đầu file) | `message.service.js` | `message` | `test/chat.test.js`, `test/migration.test.js` | `README.md` §Tương thích |
| Upload file (chữ ký Cloudinary, data URI) | `routes/user.route.js` | `controller/file.controller.js` | `message.service.js#uploadDataUri` | – | `test/chat.test.js` | `docs/frontend-integration.md` |
| Bình chọn | `conversation.route.js`, `routes/poll.route.js` | `controller/poll.controller.js` | `services/poll.service.js` | `poll` | `test/chat.test.js` | `docs/realtime.md` |
| Nhắc việc | `routes/reminder.route.js` | `controller/reminder.controller.js` | `services/reminder.service.js` | `reminder` | `test/chat.test.js` | `docs/realtime.md` |
| Chặn, biệt danh, presence | `routes/user.route.js` | `controller/social.controller.js` | `services/presence.service.js` | `social` (Block, Nickname) | `test/chat.test.js` | `docs/realtime.md` |
| Đang nhập | `conversation.route.js` + socket `typing` | `message.controller.js#typing` | `services/typing.service.js` | – | `test/chat.test.js` | `docs/realtime.md` |
| Chat hỗ trợ (hàng đợi, nhận, chuyển, trả, đóng/mở, tag, đánh giá) | `routes/support.route.js` | `controller/support.controller.js` | `services/support.service.js` | `conversation` (kind support) | `test/support.test.js` | `docs/support.md` |
| Role, khoá tài khoản, settings, sticker, audit, policy | `routes/admin.route.js` | `controller/admin.controller.js` | `lib/permissions.js`, `services/settings.service.js`, `services/audit.service.js` | `admin` (Settings, AuditLog) | `test/admin.test.js` | `docs/auth.md` |
| Webhook | `admin.route.js` | `admin.controller.js` | `services/webhook.service.js` | `admin` (Webhook, WebhookDelivery) | `test/admin.test.js` | `docs/webhooks.md` |
| API key + `/api/open/v1` | `admin.route.js`, `routes/open.route.js` | `admin.controller.js`, `controller/open.controller.js` | `middleware/apikey.middleware.js` | `admin` (ApiKey), `user` (kind bot) | `test/support.test.js` | `docs/auth.md` §5 |
| Socket.IO: xác thực, room, event client gửi | – | – | `lib/socket.js`, `services/realtime.service.js` | – | mọi test có `connect()` | `docs/realtime.md` |
| Việc nền (nhắc việc, đóng poll, presence, webhook) | – | – | `services/jobs.service.js` | – | `test/chat.test.js`, `test/admin.test.js` | `docs/architecture.md` §5 |
| Index, nâng dữ liệu bản cũ | – | – | `services/migration.service.js`, `scripts/migrate.js` | mọi model | `test/migration.test.js` | `docs/data-model.md` |
| Tài liệu API `/api-docs` | `routes/docs.route.js` | – | `api/openapi.yaml` | – | `test/openapi.test.js` | `docs/api.md` |
| Cấu hình, giới hạn, env | – | – | `config.js` | – | – | `docs/env-reference.md` |
| Lỗi, mã lỗi | – | – | `lib/errors.js`, `middleware/error.middleware.js` | – | – | `docs/api.md` §4 |

## 2. Thư mục `src/`

| Thư mục | Vai trò | Ghi chú |
| :--- | :--- | :--- |
| `routes/` | Path + middleware | `app.js#API_ROUTERS` là bảng mount duy nhất (test spec đọc bảng này) |
| `controller/` | Input → nghiệp vụ → JSON | Không tự build JSON lỗi |
| `services/` | Nghiệp vụ dùng chung | `message.service` là hot path gửi tin |
| `models/` | Mongoose schema + index | `admin.model.js` gom Settings, AuditLog, Webhook, WebhookDelivery, ApiKey |
| `middleware/` | `protectRoute`, `requireUser`, `authorize`, `requireApiKey`, `rateLimit`, `errorHandler` | `limiters.js` giữ instance rate limit dùng chung |
| `lib/` | Tiện ích không chạm HTTP | `serializers` (JSON), `permissions` (policy), `cursor`, `validate`, `text`, `socket` |
| `scripts/` | CLI vận hành | `set-roles`, `migrate` |

## 3. Collection MongoDB

`users`, `sessions`, `conversations`, `messages`, `polls`, `reminders`, `blocks`, `nicknames`, `settings`,
`auditlogs`, `webhooks`, `webhookdeliveries`, `apikeys` – chi tiết ở [docs/data-model.md](docs/data-model.md).
