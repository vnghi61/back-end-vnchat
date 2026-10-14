---
doc_type: agent_entrypoint
project: back-end-vnchat
last_verified: 2026-10-14
audience: [claude, codex, cursor, gemini, copilot, human]
---

# AGENT.md — Điểm vào duy nhất cho AI assistant

> **Đọc file này trước tiên.** `CLAUDE.md`, `AGENTS.md` đều trỏ về đây. Sau đó đọc
> [MODULE_INDEX.md](MODULE_INDEX.md) để tìm đúng file, rồi workflow trong `.agents/workflows/` theo loại tác vụ.

## 1. Đây là gì?

Backend chat realtime một process: chat nội bộ (1-1, nhóm), tính năng tin nhắn đầy đủ, bình chọn, nhắc việc,
chat hỗ trợ khách hàng **do nhân viên xử lý (không có AI)**, quản trị (role/policy, webhook, audit, API key đối tác).
Tính năng mô phỏng project `chat-platform` (Go) nhưng viết lại trên Node.

| | |
| :--- | :--- |
| Runtime | Node.js ≥ 20 (image: `node:22` alpine), ES modules |
| HTTP | Express 5 (async handler ném lỗi → `errorHandler`) |
| DB | MongoDB 7 qua Mongoose 8 (không cần replica set, không dùng transaction) |
| Realtime | Socket.IO 4 (room `user:`, `conv:`, `session:`, `agents`, `members`) |
| File | Cloudinary (upload base64 qua API hoặc upload thẳng bằng chữ ký) |
| Validation | zod (`src/lib/validate.js`) |
| Test | `node:test` + supertest + socket.io-client trên Mongo thật; Bruno cho API test |
| Deploy | Docker → Render (`render.yaml`), CI GitHub Actions |
| Roles hệ thống | `admin`, `agent`, `member` (+ kind `visitor`, `bot`) |

**Không** có multi-tenant, không có Redis, không có AI. Mọi state tạm (presence, rate limit, typing) nằm trong bộ nhớ →
chạy **đúng 1 instance**.

## 2. Bản đồ 60 giây

```text
back-end-vnchat/
├── AGENT.md / MODULE_INDEX.md   ← bạn đang ở đây / bản đồ tính năng → file
├── api/openapi.yaml             ← HỢP ĐỒNG API (Scalar ở /api-docs); test chặn lệch route
├── api-tests/bruno/             ← API test end-to-end (93 request), chạy trong CI trên image Docker
├── src/
│   ├── index.js                 ← boot: Mongo → migration → jobs → listen; SIGTERM tắt êm
│   ├── app.js                   ← Express app + bảng API_ROUTERS (mount duy nhất)
│   ├── config.js                ← mọi biến môi trường
│   ├── routes/                  ← khai báo route + middleware (auth, authorize, rate limit)
│   ├── controller/              ← parse input (zod), gọi service/model, trả JSON
│   ├── services/                ← nghiệp vụ dùng chung: gửi tin, hỗ trợ, webhook, presence, jobs...
│   ├── models/                  ← schema Mongoose + index
│   ├── middleware/              ← auth, apikey, rate limit, error handler
│   ├── lib/                     ← errors, permissions, serializers, cursor, socket, text...
│   └── scripts/                 ← set-roles, migrate
├── test/                        ← test tích hợp (mỗi file một database)
├── docs/                        ← tài liệu kỹ thuật theo chủ đề (§6)
├── .agents/workflows/           ← quy trình từng bước theo loại tác vụ
├── Dockerfile, docker-compose.yml, render.yaml, .github/workflows/ci.yml
```

## 3. Luồng phụ thuộc

```text
routes → middleware (protectRoute / requireUser / authorize / rateLimit)
       → controller ──► services ──► models (Mongoose) ──► MongoDB
                  │          ├──► realtime.service (Socket.IO)
                  │          ├──► webhook.service.dispatch (delivery bền trong Mongo)
                  │          └──► audit.service
                  └──► lib/serializers (document → JSON trả client/socket/webhook)
```

- **routes**: chỉ khai báo path + middleware. Quyền hệ thống (`authorize("admin:webhooks","write")`) gắn ở đây, không trong controller.
- **controller**: `parse(schema, req.body)` → nghiệp vụ → `res.status(...).json(...)`. Lỗi: `throw Errors.xxx()`, không tự build JSON lỗi.
- **services**: logic dùng chung nhiều controller (gửi tin, quyền hội thoại, support state machine, webhook, presence).
  Mọi đường gửi tin (REST, API cũ, forward, poll, API đối tác, tin hệ thống) đi qua `services/message.service.js`.
- **lib/serializers**: hình dạng JSON duy nhất cho message/conversation – REST, socket và webhook dùng chung.
- **models**: schema + index. Index mới tự tạo khi boot (`syncIndexes`) – không có file migration riêng; nâng dữ liệu cũ viết trong `services/migration.service.js` (idempotent).

## 4. Quy tắc bắt buộc

1. **Spec trước**: thêm/sửa/xoá route → sửa `api/openapi.yaml` cùng lúc. `test/openapi.test.js` fail nếu lệch.
2. **Lỗi có mã**: dùng `Errors.*` trong `src/lib/errors.js` (mã `CHAT-xxx-yyy`). Mã mới → thêm vào errors.js + bảng ở `docs/api.md`.
3. **Không tin input**: mọi body/query qua zod (`parse`); id qua `toObjectId`; URL hiển thị cho người khác qua `httpUrl`/`imageInput`.
4. **Quyền 2 lớp**: hệ thống (policy Casbin-style, `src/lib/permissions.js`) ở route; trong hội thoại (owner/admin/member/agent) ở service/controller qua `loadForRead` / `loadForMember`.
5. **Realtime chỉ qua `realtime.service`**; tên event mới → thêm vào `docs/realtime.md`. Không emit thẳng `io`.
6. **Không bao giờ log hay trả** `password`, token, secret webhook, raw API key (chỉ trả một lần lúc tạo).
7. **Giữ API cũ** (`/api/auth/*`, `/api/messages/*`, event `newMessage`/`getOnlineUsers`) – client hiện tại đang dùng.
8. **Một instance**: đừng thêm state trong bộ nhớ mà cần chia sẻ giữa nhiều process; nếu cần scale → ghi ADR mới (Redis).
9. Không bịa endpoint/env/event: nếu không có trong `api/openapi.yaml`, `src/config.js`/`.env.example`, `docs/realtime.md` thì chưa tồn tại.

## 5. Quy trình theo loại tác vụ

| Tác vụ | Workflow |
| :--- | :--- |
| Thêm API endpoint | [.agents/workflows/add-api-endpoint.md](.agents/workflows/add-api-endpoint.md) |
| Thêm model / field / index, nâng dữ liệu cũ | [.agents/workflows/add-model-or-index.md](.agents/workflows/add-model-or-index.md) |
| Thêm realtime event | [.agents/workflows/add-realtime-event.md](.agents/workflows/add-realtime-event.md) |
| Thêm webhook event | [.agents/workflows/add-webhook-event.md](.agents/workflows/add-webhook-event.md) |
| Thêm việc nền (sweeper) | [.agents/workflows/add-background-job.md](.agents/workflows/add-background-job.md) |
| Fix bug | [.agents/workflows/fix-bug.md](.agents/workflows/fix-bug.md) |
| Viết test / verify | [.agents/workflows/testing.md](.agents/workflows/testing.md) |
| Giữ tài liệu API + Bruno khớp code | [.agents/workflows/api-docs.md](.agents/workflows/api-docs.md) |
| Deploy (Docker / Render) | [.agents/workflows/deploy.md](.agents/workflows/deploy.md) |
| Phát hành phiên bản | [.agents/workflows/release.md](.agents/workflows/release.md) |

**Definition of done**: `npm test` xanh (cần Mongo, xem `docs/testing.md`) · spec + Bruno cập nhật nếu đổi API ·
`docs/` + `CHANGELOG.md` cập nhật trong cùng commit · không còn `console.log` debug.

## 6. Tài liệu

| File | Nội dung |
| :--- | :--- |
| [docs/architecture.md](docs/architecture.md) | Thành phần, luồng gửi tin, realtime, việc nền, boot |
| [docs/data-model.md](docs/data-model.md) | Collection, field, index |
| [docs/auth.md](docs/auth.md) | Session/JWT, khách widget, API key, policy, quyền trong hội thoại |
| [docs/api.md](docs/api.md) | Quy ước API, phân trang, bảng mã lỗi, tài liệu Scalar |
| [docs/realtime.md](docs/realtime.md) | Socket.IO: kết nối, room, danh mục event, reconnect |
| [docs/support.md](docs/support.md) | Chat hỗ trợ do nhân viên xử lý |
| [docs/webhooks.md](docs/webhooks.md) | Event, chữ ký, retry, chống SSRF |
| [docs/frontend-integration.md](docs/frontend-integration.md) | Hướng dẫn tích hợp cho frontend/mobile |
| [docs/deployment.md](docs/deployment.md) | Docker, Render, MongoDB Atlas, CI |
| [docs/env-reference.md](docs/env-reference.md) | Mọi biến môi trường |
| [docs/testing.md](docs/testing.md) | Test tích hợp, test spec, Bruno |
| [DECISIONS.md](DECISIONS.md) | Chỉ mục ADR (`docs/adr/`) – đọc trước khi đề xuất cách khác |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Thiết lập máy, commit, PR |
| [CHANGELOG.md](CHANGELOG.md) | Lịch sử thay đổi |
