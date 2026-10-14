---
description: Thêm webhook event cho hệ thống ngoài
---

# Workflow: Add Webhook Event

1. Thêm tên vào `WEBHOOK_EVENTS` (`src/services/webhook.service.js`) – admin chỉ đăng ký được event có trong danh sách.
2. Thêm vào enum `WebhookBody.events` trong `api/openapi.yaml`.
3. Gọi `dispatch("<event>", data)` **sau** khi ghi Mongo thành công. `dispatch` không ném lỗi và không chặn request
   (chỉ ghi delivery + đánh thức worker). Không cần `await` trừ khi thứ tự giữa hai event quan trọng (vd. `chat.command.detected` trước `message.created`).
4. `data` ổn định, không lộ secret/password; dùng serializer cho message/conversation.
5. Tài liệu: bảng event trong `docs/webhooks.md` §2 (và `docs/support.md` §4 nếu là support).
6. Test (`test/admin.test.js` có receiver HTTP local): tạo subscription với event mới → thao tác → `waitForDelivery(...)` → kiểm tra header `X-Chat-Event` và chữ ký.
