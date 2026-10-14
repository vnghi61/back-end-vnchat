# Biến môi trường

Đọc ở `src/config.js` (trừ ghi chú khác). `.env` được nạp bởi `import "dotenv/config"` khi chạy local; biến đã export luôn thắng.

## Bắt buộc

| Biến | Ghi chú |
| :--- | :--- |
| `MONGODB_URI` | `mongodb://...` hoặc `mongodb+srv://...` (đọc ở `lib/db.js`) |
| `JWT_SECRET` | ký JWT; thiếu thì process thoát. Production: chuỗi ngẫu nhiên dài |

## Server

| Biến | Mặc định | Ghi chú |
| :--- | :--- | :--- |
| `NODE_ENV` | `development` | `production`: cookie Secure, loopback bị chặn ở webhook, phục vụ frontend build nếu có |
| `PORT` | `5001` | Render tự đặt |
| `CLIENT_URL` | `http://localhost:5174` | origin được CORS (HTTP + Socket.IO), cách nhau dấu phẩy |
| `JSON_BODY_LIMIT` | `10mb` | giới hạn body (ảnh base64 nằm trong body) |
| `TRUST_PROXY` | – | số hop (`1`), `true`, hoặc CIDR (`10.0.0.0/8`) – đọc ở `app.js` |
| `API_DOCS_ENABLED` | `true` | bật `/api-docs` |
| `FRONTEND_DIST` | `../frontend/dist` | production: phục vụ SPA nếu thư mục có `index.html` |
| `APP_VERSION` | `RENDER_GIT_COMMIT` (7 ký tự) hoặc `dev` | hiện ở `/health` |

## Xác thực

| Biến | Mặc định | Ghi chú |
| :--- | :--- | :--- |
| `SESSION_TTL_DAYS` | `7` | hạn JWT/session/cookie |
| `COOKIE_SAMESITE` | `strict` | `strict` / `lax` / `none` (`none` luôn kèm Secure) |
| `VISITOR_SECRET` | = `JWT_SECRET` | ký `visitorToken` của khách widget |
| `WIDGET_ENABLED` | `true` | mặc định của settings `widget.enabled` (admin đổi được lúc chạy) |

## Cloudinary

| Biến | Ghi chú |
| :--- | :--- |
| `CLOUDINAR_CLOUD_NAME`, `CLOUDINAR_API_KEY`, `CLOUDINAR_SECRECT_KEY` | tên biến giữ nguyên chính tả của bản cũ (`lib/cloudinar.js`); thiếu → upload trả `CHAT-503-001` |
| `CLOUDINARY_FOLDER` | `vnchat` – file của người dùng nằm ở `<folder>/u_<userId>/` |

## Giới hạn

| Biến | Mặc định |
| :--- | :--- |
| `MESSAGE_MAX_CHARS` | 8000 (ký tự Unicode) |
| `GROUP_MAX_MEMBERS` | 500 |
| `REACTION_MAX_EMOJI_PER_MESSAGE` | 20 |
| `PINNED_MESSAGES_MAX` | 50 / hội thoại |
| `PINNED_CONVERSATIONS_MAX` | 50 / người |
| `FORWARD_MAX_TARGETS` | 10 |
| `POLL_MAX_OPTIONS` | 10 |
| `REMINDERS_MAX_PER_USER` | 200 (đang `scheduled`) |
| `SUPPORT_TAGS_MAX` | 20 |
| `FILE_MAX_SIZE_BYTES` | 26214400 (25 MiB) |
| `FILE_ALLOWED_MIME` | jpeg, png, gif, webp, pdf, txt, mp3, m4a, aac, mp4, zip, docx, xlsx |

## Tần suất, realtime, việc nền

| Biến | Mặc định | Ghi chú |
| :--- | :--- | :--- |
| `RATE_LIMIT_MESSAGES_PER_MINUTE` | 60 | theo người, gồm gửi tin / forward / tạo poll |
| `RATE_LIMIT_LOGIN_PER_MINUTE` | 20 | signup + login theo IP |
| `RATE_LIMIT_WIDGET_SESSIONS_PER_MINUTE` | 30 | theo IP |
| `TYPING_THROTTLE_MS` | 3000 | |
| `PRESENCE_TTL_MS` | 60000 | hạn heartbeat |
| `SWEEP_INTERVAL_MS` | 10000 | chu kỳ việc nền |
| `WEBHOOK_TIMEOUT_MS` | 10000 | |
| `WEBHOOK_MAX_ATTEMPTS` | 8 | |
| `WEBHOOK_ALLOW_PRIVATE_NETWORKS` | `true` | cho phép đích mạng riêng (10/8, 192.168/16...) |

## Chỉ dùng khi test

| Biến | Ghi chú |
| :--- | :--- |
| `MONGODB_TEST_URI` | gốc URI Mongo cho `npm test` (mặc định `mongodb://127.0.0.1:27018`); mỗi file test tạo database riêng |
