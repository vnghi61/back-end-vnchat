# ADR-0005: Chat hỗ trợ do nhân viên xử lý, không có AI

- Trạng thái: Accepted · 2026-10-14

## Bối cảnh

chat-platform: khách → AI trả lời trước → handoff sang nhân viên. Yêu cầu cho VNChat: phần tư vấn do nhân viên support xử lý thay vì AI.

## Quyết định

Bỏ pha `ai` và handoff: hội thoại support bắt đầu ở `waiting_agent`. Thêm thao tác cho nhân viên mà chat-platform không cần:
`transfer` (chuyển người) và `release` (trả về hàng đợi). Mỗi khách tối đa một hội thoại mở (unique `supportOpenFor`).
Khách là tài khoản đăng ký hoặc khách widget (`kind: visitor`, `visitorToken` ký HMAC).

## Hệ quả

Không có AI run/feedback. Muốn thêm bot tự động: dùng API đối tác (`/api/open/v1`, đăng tin dưới tên bot) hoặc webhook `support.started`.
