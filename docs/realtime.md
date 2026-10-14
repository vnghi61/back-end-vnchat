# Realtime (Socket.IO)

Socket.IO chạy cùng cổng HTTP với API (`src/lib/socket.js`). Server chỉ phát qua `src/services/realtime.service.js`.

## 1. Kết nối

```js
import { io } from "socket.io-client";
// mobile / frontend khác domain: truyền token
const socket = io(API_URL, { auth: { token } });
// web cùng site: cookie jwt đi kèm
const socket = io(API_URL, { withCredentials: true });

socket.on("connect_error", (err) => {/* err.data?.code: CHAT-401-xxx → đăng nhập lại */});
socket.on("ready", ({ userId }) => {/* đã vào đủ room – bắt đầu nghe */});
```

Handshake phải có JWT hợp lệ (session còn hiệu lực, tài khoản active). `query.userId` của bản cũ **không** còn được dùng.

## 2. Room

| Room | Ai ở trong | Dùng cho |
| :--- | :--- | :--- |
| `user:<id>` | mọi socket của người đó | dữ liệu riêng (prefs, nhắc việc, chặn, biệt danh), `conversation.new` |
| `conv:<id>` | thành viên đang online; agent đã `support:watch` | sự kiện của hội thoại |
| `session:<id>` | socket của một session | ngắt khi session bị thu hồi |
| `agents` | người có quyền `support:write` | hàng đợi hỗ trợ |
| `members` | tài khoản đăng ký (không gồm khách) | `getOnlineUsers` (bản cũ) |

Thêm/xoá thành viên → server tự cho mọi socket của người đó vào/ra `conv:<id>`. Đổi role admin/agent → vào/ra `agents`.

## 3. Client gửi lên

| Event | Payload | Ack |
| :--- | :--- | :--- |
| `typing` | `{conversationId, typing: boolean}` | `{ok}` hoặc `{ok:false, code, message}` |
| `support:watch` | `{conversationId}` – agent xem realtime ticket chưa nhận | `{ok}` |
| `support:unwatch` | `{conversationId}` | `{ok}` |

## 4. Server phát

| Event | Room | Data |
| :--- | :--- | :--- |
| `ready` | socket vừa kết nối | `{userId}` |
| `message.new` | `conv:` | Message (giống REST) |
| `message.updated` | `conv:` | Message (có `editedAt`) |
| `message.deleted` | `conv:` | `{conversationId, messageId, seq, deletedBy}` |
| `reaction.updated` | `conv:` | Message (`reactions[].mine` tính cho người thao tác – client tự tính lại theo `userIds`) |
| `message.pinned` / `message.unpinned` | `conv:` | `{conversationId, messageId, by, pinnedAt?}` |
| `message.hidden` | `user:<me>` | `{conversationId, messageId, hidden}` |
| `typing` | `conv:` | `{conversationId, user: {_id, name, profileImage, kind}, typing, expiresAt}` – `typing:true` lặp trong `TYPING_THROTTLE_MS` bị bỏ |
| `read.updated` | `conv:` | `{conversationId, userId, seq}` |
| `conversation.new` | `user:<từng thành viên>` | Conversation (tính riêng cho người nhận) |
| `conversation.updated` | `conv:` | Conversation – đổi tên/avatar/historyVisibility |
| `conversation.updated` | `conv:` + `user:<người bị đổi>` | `{conversationId, memberId, role}` – đổi role |
| `conversation.updated` | `user:<me>` | `{conversationId, muted, mutedUntil, mutedForever, pinned, pinnedAt, archived}` – tuỳ chọn riêng |
| `conversation.member.added` | `conv:` + `user:<người mới>` | `{conversationId, memberIds, conversation}` |
| `conversation.member.removed` | `conv:` + `user:<người bị xoá/rời>` | `{conversationId, memberId}` |
| `poll.updated` | `conv:` | `{pollId, conversationId, messageId, counts, votersCount, status}` – không lộ ai bầu gì |
| `poll.closed` | `conv:` | như trên + `closedAt`, `closedBy` (`null` khi tự đóng) |
| `reminder.created` / `updated` / `cancelled` / `fired` | `user:<owner>` | `{reminder}` |
| `user.online` / `user.offline` | `user:<contact>` | `{userId, at}` – contact = thành viên hội thoại chung, trừ cặp đã chặn |
| `block.updated` | `user:<me>` | `{userId, blocked}` |
| `nickname.updated` | `user:<me>` | `{userId, nickname}` (`""` = xoá) |
| `session.revoked` | `user:<id>` | `{reason: "disabled" \| "logout_all"}` rồi server ngắt kết nối |
| `support.updated` | `conv:` | `{conversationId, status, assigneeId, tags?, rating?}` |
| `support.updated` | `agents` | như trên + `conversation` (Conversation) |
| `support.message` | `agents` | `{conversationId, status, assigneeId, message}` – mọi tin mới trong hội thoại support |
| `newMessage` (bản cũ) | `user:<người nhận>` | Message + `receiverId` – chỉ hội thoại direct |
| `getOnlineUsers` (bản cũ) | `members` | `[userId]` online |

Tin hệ thống đi qua `message.new` với `type: "system"`, `text = kind`, `metadata = {kind, ...}`. Các kind:
`group.created`, `group.renamed`, `group.avatar_changed`, `group.history_visibility`, `member.added`, `member.removed`,
`member.left`, `member.role_changed`, `support.started`, `support.assigned`, `support.transferred`, `support.released`,
`support.closed`, `support.reopened`.

## 5. Presence

Online khi còn ít nhất một socket kết nối **hoặc** một thiết bị gửi `POST /api/presence/heartbeat {deviceId}` chưa quá
`PRESENCE_TTL_MS` (client không giữ socket thì heartbeat mỗi ~TTL/2). `DELETE /api/presence` gỡ thiết bị.
Snapshot: `GET /api/presence?ids=a,b` → `[{userId, online, lastSeenAt}]`. State nằm trong bộ nhớ (một instance).

## 6. Mất kết nối

Socket.IO tự kết nối lại nhưng **không phát lại** event bị lỡ. Khi `connect` lại (hoặc app quay từ nền):

1. `GET /api/sync?since=<mốc lần trước>` → `{conversations, messages, until, hasMore}`; lưu `until` làm mốc mới.
2. `hasMore` → gọi tiếp, hoặc tải từng hội thoại `GET /api/conversations/:id/messages?after=<cursor>`.
3. Presence lấy lại bằng `GET /api/presence?ids=`.

Lần mở app đầu tiên: `GET /api/me/bootstrap` (lưu `serverTime` làm `since`) rồi `GET /api/conversations`.
