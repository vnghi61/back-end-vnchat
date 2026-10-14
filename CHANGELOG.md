# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), phiên bản theo [SemVer](https://semver.org).

## [Unreleased]

### Added – tính năng chat (theo chat-platform)

- Hội thoại 1-1/nhóm với role owner/admin/member, đổi tên/avatar, thêm/xoá thành viên, rời nhóm, `historyVisibility`.
- Tin nhắn: seq theo hội thoại, `clientMsgId`, reply, mention, sửa, xoá mềm, reaction, ghim, ẩn phía mình, chuyển tiếp,
  sticker, lệnh `/`, link/media, tìm kiếm không dấu, phân trang cursor; đính kèm qua data URI hoặc upload thẳng Cloudinary.
- Đã đọc/chưa đọc, mute/pin/archive, typing, presence, bình chọn, nhắc việc, chặn, biệt danh, bootstrap, `/api/sync`.
- Chat hỗ trợ do nhân viên xử lý: khách widget, hàng đợi, nhận/chuyển/trả, đóng/mở lại, tag, đánh giá, thống kê.
- Quản trị: policy kiểu Casbin, role, khoá tài khoản, settings, audit, webhook (HMAC, retry, chống SSRF), API key + `/api/open/v1`.
- Session lưu Mongo: danh sách, thu hồi, logout-all.

### Added – tài liệu, test, deploy

- Tài liệu API: `api/openapi.yaml` (OpenAPI 3.1, 82 path) và trang Scalar `GET /api-docs`.
- Test: 78 test tích hợp (HTTP + Socket.IO + Mongo thật) và `test/openapi.test.js` chặn spec lệch route.
- API test end-to-end: collection Bruno `api-tests/bruno` (93 request, env `local`/`render`/`ci`), `npm run test:api`.
- Docker: `Dockerfile` (multi-stage, non-root, base pin digest, HEALTHCHECK), `.dockerignore`, `docker-compose.yml` (api + mongo), `npm run docker:up|down`.
- Render: `render.yaml` (Blueprint Docker, free, singapore, `/health`, `autoDeployTrigger: checksPass`).
- CI GitHub Actions `.github/workflows/ci.yml`: test tích hợp; build image + chạy Bruno trên container + kiểm tra tắt êm.
- Tài liệu cho người và AI agent: `AGENT.md`, `CLAUDE.md`, `AGENTS.md`, `MODULE_INDEX.md`, `DECISIONS.md` + `docs/adr/`,
  `CONTRIBUTING.md`, `docs/*.md`, `.agents/workflows/*.md`, PR template.
- Env: `COOKIE_SAMESITE`, `API_DOCS_ENABLED`, `FRONTEND_DIST`, `APP_VERSION`; `/health` trả `version`.

### Changed

- Tắt êm khi nhận SIGTERM/SIGINT (đóng socket, HTTP, Mongo) – cần cho Docker/Render.
- `TRUST_PROXY` hiểu số hop, boolean và CIDR.
- Chỉ phục vụ frontend build khi thư mục `FRONTEND_DIST` có `index.html` (trước đây lỗi 500 nếu thiếu); wildcard route theo cú pháp Express 5.

### Security

- Socket.IO xác thực bằng JWT thay vì tin `query.userId` (trước đây ai cũng mạo danh được để nhận tin của người khác).
- Đăng nhập không còn lộ email đã đăng ký; URL avatar chỉ nhận http(s)/data URI ảnh; khách widget không xem được danh sách người dùng.
- `npm audit fix` cho dependency production (0 lỗ hổng).

### Breaking

- Client socket phải gửi token (`auth.token`) hoặc cookie (`withCredentials`).
- Token cấp trước bản này không còn hợp lệ (đăng nhập lại một lần).
- `POST /api/auth/login` trả 200 thay vì 201.

## [1.0.0]

- Bản gốc: đăng ký/đăng nhập, tin nhắn 1-1, ảnh Cloudinary, Socket.IO danh sách online.
