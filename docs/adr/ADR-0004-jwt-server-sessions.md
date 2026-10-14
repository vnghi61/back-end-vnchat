# ADR-0004: JWT mang session id, session lưu trong Mongo

- Trạng thái: Accepted · 2026-10-14

## Bối cảnh

Bản gốc dùng JWT 7 ngày không thu hồi được; logout chỉ xoá cookie. Cần logout-all, danh sách thiết bị, khoá tài khoản có hiệu lực ngay.

## Quyết định

Mỗi lần đăng nhập tạo document `sessions`; JWT chứa `{userId, sid}`. Mỗi request kiểm tra session còn hiệu lực
(một lần đọc theo `_id`). Token trả cả trong cookie httpOnly và body (Bearer cho mobile/khác domain). `COOKIE_SAMESITE` cấu hình được.

## Hệ quả

- Token của bản cũ (không có `sid`) bị từ chối → người dùng đăng nhập lại một lần.
- Thêm một truy vấn Mongo mỗi request (có cache `lastUsedAt` ≤ 1 lần/phút).
