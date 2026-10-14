# back-end-vnchat

[![ci](https://github.com/vnghi61/back-end-vnchat/actions/workflows/ci.yml/badge.svg)](https://github.com/vnghi61/back-end-vnchat/actions/workflows/ci.yml)

Backend chat realtime – Node.js · Express 5 · MongoDB · Socket.IO · Cloudinary. Tính năng theo mô hình **chat-platform**,
deploy theo cách của **fluentra** (Docker → Render).

| Nhóm | Tính năng |
| :--- | :--- |
| Chat | 1-1 và nhóm (owner/admin/member), reply, mention, sửa, xoá, reaction, ghim, ẩn phía mình, chuyển tiếp, sticker, lệnh `/task`, đính kèm, media, tìm kiếm không dấu, đã đọc/chưa đọc, mute/pin/archive, đang nhập, online |
| Tiện ích | Bình chọn, nhắc việc, chặn, biệt danh riêng, đồng bộ sau khi mất mạng |
| Hỗ trợ khách hàng | Khách widget hoặc người dùng mở yêu cầu → hàng đợi → **nhân viên** nhận / chuyển / trả / đóng / mở lại, tag, đánh giá, thống kê (không dùng AI) |
| Quản trị | Role admin/agent/member + policy sửa được, khoá tài khoản, settings (branding, sticker, lệnh, widget), audit, webhook có chữ ký, API key cho đối tác |

## Chạy

```bash
npm install
cp .env.example .env                        # MONGODB_URI, JWT_SECRET, Cloudinary
docker compose up -d mongo                  # nếu chưa có MongoDB
npm run dev                                 # http://localhost:5001
npm run set-roles -- you@example.com admin,agent,member   # sau khi đăng ký: cấp quyền quản trị
```

Hoặc chạy đúng image production: `npm run docker:up` (API + MongoDB, chờ healthcheck), `npm run docker:down`.

## Tài liệu API và test

- **API doc**: `http://localhost:5001/api-docs` (Scalar, gọi thử được với Bearer token) – nguồn `api/openapi.yaml`.
- **Test tích hợp**: `npm test` (81 test, cần MongoDB – xem [docs/testing.md](docs/testing.md)).
- **API test (Bruno)**: `npm run test:api` – 93 request trong `api-tests/bruno` (mở được bằng Bruno app); CI chạy trên image Docker.

## Deploy (Render)

`render.yaml` là Blueprint: Render Dashboard → **New → Blueprint** → chọn repo, điền `MONGODB_URI` (MongoDB Atlas),
`CLIENT_URL`, Cloudinary. Push/merge vào `master` → GitHub Actions xanh → Render tự deploy. Hướng dẫn đầy đủ:
[docs/deployment.md](docs/deployment.md).

## Tài liệu

| | |
| :--- | :--- |
| [AGENT.md](AGENT.md) · [MODULE_INDEX.md](MODULE_INDEX.md) | Điểm vào cho AI agent / bản đồ tính năng → file |
| [docs/architecture.md](docs/architecture.md) | Thành phần, luồng gửi tin, realtime, việc nền |
| [docs/data-model.md](docs/data-model.md) | Collection, field, index |
| [docs/auth.md](docs/auth.md) | Session/JWT, khách widget, policy, quyền trong hội thoại, API key |
| [docs/api.md](docs/api.md) | Quy ước, phân trang, mã lỗi |
| [docs/realtime.md](docs/realtime.md) | Socket.IO: room, event, reconnect |
| [docs/support.md](docs/support.md) | Chat hỗ trợ do nhân viên xử lý |
| [docs/webhooks.md](docs/webhooks.md) | Event, chữ ký, retry |
| [docs/frontend-integration.md](docs/frontend-integration.md) | Hướng dẫn cho frontend/mobile |
| [docs/deployment.md](docs/deployment.md) · [docs/env-reference.md](docs/env-reference.md) | Docker, Render, CI · biến môi trường |
| [docs/testing.md](docs/testing.md) | Test tích hợp, test spec, Bruno |
| [DECISIONS.md](DECISIONS.md) | Quyết định kiến trúc (ADR) |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [CHANGELOG.md](CHANGELOG.md) | Quy trình đóng góp · lịch sử thay đổi |
| `.agents/workflows/` | Quy trình từng bước: thêm endpoint, model, event, job, fix bug, deploy... |

## Tương thích với bản cũ

Giữ nguyên `/api/auth/*`, `/api/messages/users|:id|send/:id`, event `newMessage`, `getOnlineUsers`; tin nhắn cũ tự gom vào
hội thoại khi khởi động. Client cũ cần: socket gửi token/cookie (`withCredentials` hoặc `auth.token`), đăng nhập lại một
lần, login trả 200. Chi tiết: [docs/frontend-integration.md](docs/frontend-integration.md) §6.

## Giới hạn

Một instance (presence, rate limit, typing nằm trong bộ nhớ – [ADR-0003](docs/adr/ADR-0003-single-process-jobs.md)).
Chưa có push notification (FCM).
