# Data model (MongoDB)

Mọi `_id` là ObjectId. Thời gian UTC. Index khai báo trong schema (`src/models/*`) và được tạo/cập nhật mỗi lần boot bằng
`syncIndexes()` (index không còn trong schema sẽ bị xoá). Không có file migration: nâng dữ liệu cũ viết trong
`services/migration.service.js` (idempotent).

## users (`user.model.js`)

| Field | Ghi chú |
| :--- | :--- |
| `kind` | `user` (đăng ký) · `visitor` (khách widget) · `bot` (danh tính API key) |
| `email` | chỉ `user`; lowercase; unique có điều kiện (`partialFilterExpression: email là string`) |
| `password` | bcrypt; chỉ `user` |
| `name`, `nameSearch` | `nameSearch` = tên bỏ dấu + chữ thường (`lib/names.js`), dùng cho tìm kiếm; hook `validate` giữ đồng bộ |
| `profileImage` | URL |
| `roles` | `admin` / `agent` / `member`, mặc định `["member"]` |
| `status` | `active` / `inactive` (inactive: thu hồi session, chặn đăng nhập) |
| `contactEmail` | email khách widget tự khai |
| `apiKeyId` | bot → API key sở hữu |
| `lastSeenAt` | cập nhật khi online/offline |

Index: `email` (unique partial), `kind+status+_id`.

## sessions (`session.model.js`)

`userId`, `userAgent`, `ip`, `device`, `lastUsedAt` (cập nhật ≤ 1 lần/phút), `expiresAt` (SESSION_TTL_DAYS), `revokedAt`.
JWT mang `sid` → thu hồi có hiệu lực ngay. TTL index xoá session 1 ngày sau `expiresAt`.

## conversations (`conversation.model.js`)

| Field | Ghi chú |
| :--- | :--- |
| `kind` | `direct` · `group` · `support` |
| `title`, `avatarUrl` | direct: client hiển thị tên người kia (serializer điền) |
| `directKey` | `"<idA>:<idB>"` đã sắp xếp; unique partial → mỗi cặp một hội thoại |
| `historyVisibility` | group: `all` / `since_join` |
| `members[]` | `userId`, `role` (`owner/admin/member/agent/bot`), `joinedAt`, `lastReadSeq`, `historyFromSeq`, `mutedUntil` (vô thời hạn = `9999-12-31`), `archivedAt`, `pinnedAt` |
| `memberIds` | bản sao `members[].userId` cho index multikey |
| `lastSeq` | tăng nguyên tử khi gửi tin |
| `lastMessage` | `{id, seq, senderId, type, preview, deleted, at}` |
| `support` | `{status: waiting_agent/agent/closed, assigneeId, tags[], meta, assignedAt, closedAt, closedBy, rating, ratingNote}` |
| `supportOpenFor` | userId khách khi hội thoại support đang mở; unique partial → mỗi khách tối đa 1 hội thoại mở; `$unset` khi đóng |
| `createdBy` | support: chính là khách |
| `syncAt` | mốc cho `GET /api/sync`: đổi ở mọi thay đổi client cần đồng bộ |

Index: `memberIds+updatedAt+_id` (inbox), `memberIds+syncAt`, `directKey` (unique), `supportOpenFor` (unique),
`kind+support.status+updatedAt`, `kind+support.assigneeId+updatedAt`.

Thêm thành viên dùng một update pipeline: guard "chưa là thành viên" + giới hạn số người, `lastReadSeq = lastSeq` và
`historyFromSeq = lastSeq + 1` (nếu `since_join`) tính ngay trong lệnh.

## messages (`message.model.js`)

| Field | Ghi chú |
| :--- | :--- |
| `conversationId`, `seq` | seq duy nhất trong hội thoại (unique) |
| `senderId` | system message: người thao tác |
| `receiverId` | chỉ ở tin nhắn bản cũ |
| `type` | `text` · `file` · `system` · `command` · `sticker` · `poll` |
| `text` | system: tên sự kiện |
| `image` | ảnh đầu tiên (cho client cũ) |
| `attachments[]` | `{url, publicId, name, size, mime, kind, width, height}` |
| `replyTo`, `mentions[]`, `command{name,args,mentions}` | |
| `reactions[]` | `{emoji, userIds[]}`; tối đa REACTION_MAX_EMOJI_PER_MESSAGE emoji khác nhau |
| `sticker` | `{packId, stickerId, emoji, url}` (snapshot) |
| `pollId`, `forwardedFrom{messageId, conversationId, senderId}` | |
| `links[]`, `mediaKinds[]` | trích lúc gửi/sửa; phục vụ `/media` |
| `clientMsgId` | idempotency theo (hội thoại, người gửi) – unique partial |
| `editedAt`, `deletedAt`, `deletedBy` | xoá mềm: text rỗng, bỏ attachments/reactions/pin |
| `pinnedAt`, `pinnedBy` | ghim chung cả hội thoại (tối đa PINNED_MESSAGES_MAX) |
| `hiddenFor[]` | ẩn phía từng người; mọi truy vấn đọc lọc `hiddenFor != me` |

Index: `conversationId+seq` (unique), `conversationId+senderId+clientMsgId` (unique partial), `conversationId+updatedAt`
(sync), `conversationId+mediaKinds+seq`, `conversationId+pinnedAt` (partial), `conversationId+createdAt`,
`text` (text index, `default_language: none` – không phân biệt dấu), `senderId+receiverId` (dữ liệu cũ).

## polls (`poll.model.js`)

`conversationId`, `messageId` (unique), `createdBy`, `question`, `options[{id: o1..oN, text}]`, `multiple`, `anonymous`,
`status`, `closesAt`, `closedAt`, `closedBy`, `votes[{userId, optionId, at}]`, `counts{optionId: n}`, `votersCount`, `rev`.
Đổi phiếu = cập nhật có điều kiện `{_id, rev, status: open}` rồi `rev+1`; xung đột → đọc lại, thử tối đa 10 lần.

## reminders (`reminder.model.js`)

`ownerId`, `conversationId?`, `messageId?`, `note`, `remindAt` (UTC), `timezone` (IANA, để hiển thị `remindAtLocal`),
`status` (`scheduled/fired/cancelled`), `version` (+1 khi đổi giờ hoặc huỷ), `firedAt`. Index `ownerId+status+remindAt`, `status+remindAt`.

## blocks, nicknames (`social.model.js`)

- `blocks`: `blockerId`, `blockedId` (unique cặp), index `blockedId` để kiểm tra chiều ngược.
- `nicknames`: `ownerId`, `targetId` (unique cặp), `nickname` (1–64 ký tự).

## settings, auditlogs, webhooks, webhookdeliveries, apikeys (`admin.model.js`)

- `settings`: một document `_id: "global"`: `branding`, `commandRules[]`, `stickerPacks[]`, `widget{enabled, welcomeMessage}`, `policies[{sub,obj,act}]`. Field chưa lưu lấy mặc định (`services/settings.service.js`), cache 30 giây.
- `auditlogs`: `actorId`, `actorKind`, `action`, `targetType`, `targetId`, `metadata`, `ip`, `createdAt`. Không TTL.
- `webhooks`: `name`, `url`, `events[]` (tên hoặc `*`), `secret`, `enabled`, `createdBy`.
- `webhookdeliveries`: `subscriptionId`, `event`, `payload` (JSON đã ký, gửi đúng các byte này), `status` (`pending/delivered/failed`), `attempts`, `nextAttemptAt`, `lockedUntil`, `lastError`, `lastStatusCode`, `deliveredAt`, `expiresAt` (TTL 14 ngày).
- `apikeys`: `name`, `prefix` (12 ký tự đầu), `hash` (sha256, unique), `scopes[]`, `status`, `expiresAt`, `lastUsedAt`, `botUserId`, `createdBy`, `revokedAt`. Raw key không lưu.
