# ADR-0001: MongoDB + Mongoose, thành viên nhúng trong hội thoại

- Trạng thái: Accepted · 2026-10-14

## Bối cảnh

Bản gốc đã dùng MongoDB/Mongoose. chat-platform cũng dùng Mongo với `members[]` nhúng và `seq` theo hội thoại.

## Quyết định

- Giữ MongoDB 7 + Mongoose 8, ObjectId làm `_id` (tương thích dữ liệu cũ).
- `conversations.members[]` nhúng (role, lastReadSeq, mute/pin/archive riêng) + `memberIds` để index multikey: đọc một
  document là đủ quyền và tuỳ chọn của mọi thành viên.
- `seq` tăng nguyên tử bằng `findOneAndUpdate($inc lastSeq)` có guard thành viên/đóng trong filter.
- Không dùng transaction (chạy được trên standalone/Atlas M0): mọi ghi đồng thời dùng compare-and-set hoặc update pipeline;
  poll dùng optimistic concurrency (`rev`).

## Hệ quả

- Nhóm tối đa `GROUP_MAX_MEMBERS` (500) để document không quá lớn.
- Index tạo bằng `syncIndexes()` lúc boot; không có file migration (nâng dữ liệu trong `migration.service.js`).
