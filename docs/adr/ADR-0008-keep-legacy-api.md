# ADR-0008: Giữ API và event của bản cũ

- Trạng thái: Accepted · 2026-10-14

## Quyết định

Giữ `/api/auth/*`, `/api/messages/users|:id|send/:id`, event `newMessage`, `getOnlineUsers` và các field cũ (`profileImg`,
`receiverId`, `image`). Tin nhắn 1-1 cũ được gom vào hội thoại direct lúc boot. API mới nằm cạnh, không thay thế.

## Hệ quả

Hai thay đổi bắt buộc với client cũ (xác thực socket, đăng nhập lại) được ghi ở `docs/frontend-integration.md` §6.
