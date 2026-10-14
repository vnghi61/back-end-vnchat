# Chat hỗ trợ (nhân viên xử lý, không có AI)

Code: `controller/support.controller.js`, `services/support.service.js`. Hội thoại `kind: "support"`.

## 1. Vòng đời

```text
khách mở ─► waiting_agent ──assign──► agent ──close──► closed ──reopen──► agent (còn assignee) | waiting_agent
                         ◄──release──        ──transfer──► agent (người khác)
```

Mọi chuyển trạng thái là compare-and-set trên `support.status` / `support.assigneeId` → hai nhân viên bấm "nhận" cùng
lúc thì một người được, người kia nhận `CHAT-409-006`.

## 2. Phía khách

- Khách là tài khoản đăng ký hoặc khách widget (`POST /api/widget/sessions`, xem [auth.md §2](auth.md#2-khách-widget-kind-visitor)).
- `POST /api/support/conversations {meta?, text?}`: mỗi khách tối đa **một** hội thoại đang mở (unique index
  `supportOpenFor`) – gọi lại trả hội thoại đang mở (200). Tạo mới (201) kèm tin hệ thống `support.started`
  (`metadata.welcomeMessage` = settings `widget.welcomeMessage`) và phát `support.updated` tới `agents`.
- Khách nhắn tin bằng API tin nhắn thường; mọi tin mới phát `support.message` tới console nhân viên.
- `POST /api/support/conversations/:id/close` (khách hoặc nhân viên), `POST .../rate {rating 1..5, note?}` (chỉ khách),
  `GET /api/support/conversations/mine`.
- Sau khi đóng khách không gửi thêm được (`CHAT-409-003`); mở yêu cầu mới sẽ tạo hội thoại mới.

## 3. Phía nhân viên (quyền `support:write` – role agent hoặc admin)

| Route | Ghi chú |
| :--- | :--- |
| `GET /api/support/queue?status=open\|waiting_agent\|agent\|closed\|all&mine&tag&cursor` | mới cập nhật trước |
| `GET /api/support/stats` | số ticket theo trạng thái, `mineOpen`, `averageRating`, `rated` |
| `GET /api/support/agents` | nhân viên + online (để chuyển ticket) |
| `POST .../assign {agentId?}` | nhận ticket `waiting_agent`; gán cho người khác: chỉ admin; người được gán phải có quyền support |
| `POST .../transfer {agentId}` | người đang phụ trách hoặc admin |
| `POST .../release` | trả về hàng đợi (người phụ trách hoặc admin) |
| `POST .../reopen` | mở lại ticket đã đóng; khách đang có ticket mở khác → `CHAT-409-000` |
| `PUT .../tags {tags[]}` | ≤ `SUPPORT_TAGS_MAX`, lưu chữ thường |

- Nhân viên **đọc** được mọi ticket (kể cả chưa nhận); muốn **trả lời** phải nhận trước (trở thành thành viên role `agent`).
- Chuyển/trả ticket: nhân viên cũ bị gỡ khỏi thành viên (nhận `conversation.member.removed`), nhân viên mới nhận `conversation.new`.
- Console realtime: phòng `agents` nhận `support.updated` (kèm `conversation`) và `support.message`; mở xem một ticket
  chưa nhận thì emit `support:watch {conversationId}` để nhận `message.new`/`typing` của ticket đó.

## 4. Tích hợp

- Webhook: `support.started`, `support.assigned`, `support.transferred`, `support.released`, `support.closed`,
  `support.reopened`, `support.rated` ([webhooks.md](webhooks.md)).
- Đối tác qua API key: đọc ticket, đọc/đăng tin (dưới tên bot của key), đóng ticket ([auth.md §5](auth.md#5-api-key-đối-tác-apiopenv1)).
- Audit: `support.assigned`, `support.transferred`.
- Tắt chat hỗ trợ: `PUT /api/admin/settings {widget: {enabled: false}}` → `CHAT-403-001`.
