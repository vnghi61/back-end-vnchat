---
doc_type: decision_index
project: back-end-vnchat
last_verified: 2026-10-14
---

# DECISIONS.md — Chỉ mục ADR

Các bản ghi nằm ở [`docs/adr/`](docs/adr/).

> **AI agent: đọc ADR liên quan trước khi đề xuất cách khác.** Quyết định đã ghi là đã được cân nhắc; muốn đổi thì viết
> ADR mới thay thế (supersede), không lặng lẽ làm khác.

| ADR | Tiêu đề | Trạng thái | Ngày |
| :--- | :--- | :--- | :--- |
| [0001](docs/adr/ADR-0001-mongodb-mongoose.md) | MongoDB + Mongoose, thành viên nhúng trong hội thoại | Accepted | 2026-10-14 |
| [0002](docs/adr/ADR-0002-socketio-rooms.md) | Socket.IO trong process thay cho Centrifugo | Accepted | 2026-10-14 |
| [0003](docs/adr/ADR-0003-single-process-jobs.md) | Việc nền trong process, một instance, không Redis | Accepted | 2026-10-14 |
| [0004](docs/adr/ADR-0004-jwt-server-sessions.md) | JWT mang session id, session lưu trong Mongo | Accepted | 2026-10-14 |
| [0005](docs/adr/ADR-0005-human-support.md) | Chat hỗ trợ do nhân viên xử lý, không AI | Accepted | 2026-10-14 |
| [0006](docs/adr/ADR-0006-openapi-spec-first.md) | OpenAPI là hợp đồng, test chặn lệch | Accepted | 2026-10-14 |
| [0007](docs/adr/ADR-0007-docker-render.md) | Docker image, deploy Render free + MongoDB Atlas | Accepted | 2026-10-14 |
| [0008](docs/adr/ADR-0008-keep-legacy-api.md) | Giữ API và event của bản cũ | Accepted | 2026-10-14 |

## Viết ADR mới

1. Copy cấu trúc một ADR có sẵn: tiêu đề `ADR-NNNN: <quyết định>`, Trạng thái, Bối cảnh, Quyết định, Hệ quả.
2. Số tiếp theo, tên file `docs/adr/ADR-NNNN-<slug>.md`.
3. Thay thế ADR cũ: ghi `Superseded by ADR-NNNN` ở ADR cũ, `Supersedes ADR-MMMM` ở ADR mới.
4. Thêm dòng vào bảng trên trong cùng commit với thay đổi code.
