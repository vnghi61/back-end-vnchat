---
description: Thêm sự kiện realtime (Socket.IO)
---

# Workflow: Add Realtime Event

## Bước 1 – Chọn tên, room, payload

- Tên: `<resource>.<past-tense>` (`message.pinned`, `poll.closed`). Không đổi tên event đang có (client cũ).
- Room ([docs/realtime.md §2](../../docs/realtime.md#2-room)):
  - mọi thành viên hội thoại → `realtime.toConversation(convId, ...)`;
  - riêng một người (mọi thiết bị) → `realtime.toUser(userId, ...)`;
  - nhiều người → `realtime.toUsers(ids, ...)`; thành viên + người ngoài room (vừa thêm/xoá) → `realtime.toConversationAndUsers(...)`;
  - console hỗ trợ → `realtime.toAgents(...)`.
- Payload: dùng serializer (`toMessage`, `toConversation(conv, null)` cho payload chung) hoặc object nhỏ có `conversationId`.
  Không đưa dữ liệu riêng của người khác (prefs, ai bầu gì trong poll ẩn danh) vào event phát cho cả hội thoại.

## Bước 2 – Phát

Chỉ qua `src/services/realtime.service.js` (không import `io`). Phát **sau** khi ghi Mongo thành công. Thay đổi mà
client cần bù khi mất kết nối → gọi `touchSync(conversationId)` để `/api/sync` thấy.

Thay đổi thành viên phải cập nhật room: `realtime.joinConversation(userIds, convId)` / `leaveConversation(...)`.

## Bước 3 – Client gửi lên (nếu có)

Đăng ký trong `src/lib/socket.js` (`socket.on("<event>", async (payload, ack) => ...)`), dùng lại service như REST, luôn
trả `ack({ok:false, code, message})` khi lỗi, không ném lỗi ra ngoài handler.

## Bước 4 – Tài liệu và test

1. Thêm dòng vào bảng `docs/realtime.md` §4 (event, room, data).
2. Test: `connect(ctx, token)` → thao tác → `waitFor(socket, "<event>", predicate)`; kiểm tra người **không** được nhận thì không nhận (`socket.events`).
