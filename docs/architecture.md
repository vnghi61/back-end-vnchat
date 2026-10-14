# Kiến trúc

## 1. Thành phần

```text
  Web / Mobile / Widget                    Hệ thống đối tác (CRM, ERP)
        │  HTTPS + WebSocket                      │  X-Api-Key / nhận webhook
        ▼                                         ▼
┌───────────────────────────── một process Node ─────────────────────────────┐
│ Express 5: /api/*, /api/open/v1/*, /api-docs, /health                      │
│   routes → middleware → controller → services → models (Mongoose)          │
│ Socket.IO (cùng cổng HTTP): room user:/conv:/session:/agents/members       │
│ Việc nền (setInterval, SWEEP_INTERVAL_MS): nhắc việc, đóng poll,           │
│   dọn presence/typing, gửi webhook                                         │
└──────────────┬───────────────────────────────┬─────────────────────────────┘
               ▼                               ▼
        MongoDB 7 (Atlas)              Cloudinary (file, avatar)
```

- Không có Redis, queue, hay process worker riêng: mọi thứ chạy chung một process ([ADR-0003](adr/ADR-0003-single-process-jobs.md)).
- State tạm trong bộ nhớ: presence, rate limit, throttle typing → **một instance**. Delivery webhook, nhắc việc, poll lưu trong Mongo nên restart không mất.

## 2. Boot (`src/index.js`)

1. `connectDB()` (MONGODB_URI).
2. `runMigrations()` (`services/migration.service.js`): `syncIndexes()` mọi model (song song) → gán `kind/roles/status/nameSearch` cho user cũ → gom tin nhắn 1-1 cũ (`senderId/receiverId`, chưa có `conversationId`) thành hội thoại direct, đánh `seq` theo thời gian. Idempotent.
3. `startBackgroundJobs()`.
4. `server.listen(PORT)`.
5. SIGTERM/SIGINT → dừng job → `io.close()` (đóng cả HTTP server) → `mongoose.disconnect()` → exit 0 (tối đa 10 giây).

## 3. Luồng gửi tin (`services/message.service.js`)

Mọi đường gửi đi qua `createMessage` + `publishMessage`: REST mới, `/api/messages/send/:id`, forward, poll, API đối tác.

```text
createMessage
  1. kiểm tra độ dài (MESSAGE_MAX_CHARS, đếm theo ký tự Unicode)
  2. clientMsgId đã có → trả tin cũ (created=false → HTTP 200)
  3. phải là thành viên; support đã đóng → 409-003; direct bị chặn → 403-008
  4. replyTo phải thuộc hội thoại, không ẩn với người gửi, không trước mốc lịch sử
  5. mentions lọc còn thành viên; attachments: data URI → upload Cloudinary, hoặc ref đã upload (phải nằm trong vnchat/u_<senderId>/)
  6. sticker phải có trong catalogue; text bắt đầu bằng /<lệnh đang bật> → type=command
  7. allocateSeq: findOneAndUpdate { memberIds: sender, support.status != closed } $inc lastSeq  ← guard nguyên tử
  8. insert message (trùng clientMsgId do race → trả tin cũ)
  9. afterInsert: lastMessage (chỉ khi seq mới hơn), bỏ archive cho mọi thành viên, người gửi lastReadSeq = seq
publishMessage
  - message.new → conv:<id>
  - newMessage (client cũ) → user:<người kia> nếu direct
  - support.message → agents nếu support
  - webhook chat.command.detected (nếu lệnh) rồi message.created (trừ tin system)
```

Tin hệ thống (`postSystemMessage`): `type=system`, `text = kind` (`group.created`, `member.added`, `support.assigned`...), `metadata = {kind, ...}`; bỏ qua guard thành viên/đóng.

Unread = `lastSeq − max(lastReadSeq, historyFromSeq − 1)` của thành viên.

## 4. Realtime

`lib/socket.js` xác thực handshake bằng JWT (`auth.token`, `Authorization: Bearer`, hoặc cookie `jwt`), rồi cho socket vào:
`user:<id>`, `session:<sessionId>`, `conv:<id>` của mọi hội thoại đang tham gia, `agents` (nếu có quyền `support:write`),
`members` (tài khoản đăng ký). Thêm/xoá thành viên → `realtime.joinConversation/leaveConversation` cho mọi socket của người đó.
Catalog event: [realtime.md](realtime.md).

## 5. Việc nền (`services/jobs.service.js`)

Mỗi `SWEEP_INTERVAL_MS` (10 giây), tuần tự, lỗi một job không chặn job khác:

| Job | Làm gì |
| :--- | :--- |
| reminders | `scheduled` có `remindAt ≤ now` → CAS sang `fired` (kèm `version`) → `reminder.fired` (đúng một lần) |
| polls | `open` có `closesAt ≤ now` → `closed` → `poll.closed` (`closedBy: null`) |
| presence | xoá heartbeat quá `PRESENCE_TTL_MS` → `user.offline` |
| typing | dọn bộ đếm throttle |
| webhooks | gửi delivery `pending` đến hạn (ngoài ra `dispatch` đánh thức worker ngay) |

Render free ngủ sau 15 phút không có request: job dừng theo; khi thức dậy, nhắc việc/poll quá hạn được xử lý ở lượt quét đầu.

## 6. Phân lớp

Xem [AGENT.md §3](../AGENT.md#3-luồng-phụ-thuộc). Tóm tắt: route gắn quyền hệ thống; controller parse input; service giữ
nghiệp vụ dùng chung; `lib/serializers` là hình dạng JSON duy nhất (REST = socket = webhook).
