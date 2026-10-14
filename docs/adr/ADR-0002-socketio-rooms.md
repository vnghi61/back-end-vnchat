# ADR-0002: Socket.IO trong process thay cho Centrifugo

- Trạng thái: Accepted · 2026-10-14

## Bối cảnh

chat-platform dùng Centrifugo (endpoint riêng, subscribe proxy, history). Bản gốc đã có Socket.IO; deploy mục tiêu là
một Render web service free.

## Quyết định

Socket.IO chạy cùng cổng HTTP. Room `user:`, `conv:`, `session:`, `agents`, `members`; server tự join/leave khi thay đổi
thành viên. Xác thực handshake bằng JWT (bỏ `query.userId` của bản cũ vì cho phép mạo danh).

## Hệ quả

- Không có history/replay: client bù bằng `GET /api/sync` khi kết nối lại.
- Một instance; scale ngang cần Redis adapter (ADR mới).
