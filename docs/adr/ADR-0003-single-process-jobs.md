# ADR-0003: Việc nền chạy trong process, một instance, không Redis

- Trạng thái: Accepted · 2026-10-14

## Bối cảnh

chat-platform dùng asynq (Redis) + worker riêng. Gói free của Render không có background worker và một web service thứ
hai sẽ ngủ riêng (fluentra gom API + worker vào một service vì lý do này).

## Quyết định

Nhắc việc, đóng poll, dọn presence/typing, gửi webhook chạy bằng `setInterval` trong cùng process
(`services/jobs.service.js`). Trạng thái bền (delivery webhook, reminder, poll) nằm trong Mongo và chuyển bằng
compare-and-set nên chạy lại/chạy chồng không phát trùng. Presence, rate limit, throttle typing nằm trong bộ nhớ.

## Hệ quả

- Bắt buộc **một instance**. Render ngủ → job dừng, xử lý bù khi thức dậy.
- Muốn nhiều instance: chuyển presence/rate limit sang Redis, Socket.IO Redis adapter, khoá job (ADR mới).
