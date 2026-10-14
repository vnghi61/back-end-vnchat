# Webhooks

Code: `services/webhook.service.js`, quản lý ở `/api/admin/webhooks` (quyền `admin:webhooks`).

## 1. Subscription

```http
POST /api/admin/webhooks
{ "name": "CRM", "url": "https://crm.example.com/hooks/vnchat",
  "events": ["message.created", "support.closed"], "secret": "tuỳ chọn ≥16 ký tự", "enabled": true }
→ 201 { "webhook": {...}, "secret": "<hex 64 ký tự nếu tự sinh>" }      // secret chỉ trả lần này
```

`events`: tên chính xác hoặc `"*"`. `PUT /api/admin/webhooks/:id` thay name/url/events/enabled (secret chỉ đổi khi gửi),
`DELETE` xoá, `GET /:id/deliveries` 100 lần gửi gần nhất, `POST /deliveries/:deliveryId/redeliver` gửi lại.
Danh sách subscription theo event cache 30 giây (xoá cache khi tạo/sửa/xoá).

## 2. Event

| Event | Khi | `data` |
| :--- | :--- | :--- |
| `message.created` | mọi tin không phải system | `{message, conversationKind}` |
| `chat.command.detected` | tin `/<lệnh đang bật>` (phát trước `message.created`) | `{message, conversationKind}` (`message.command`) |
| `conversation.created` | tạo nhóm | `{conversation}` |
| `support.started` | khách mở yêu cầu mới | `{conversation}` |
| `support.assigned` | nhân viên nhận | `{conversationId, agentId}` |
| `support.transferred` | chuyển nhân viên | `{conversationId, fromAgentId, toAgentId}` |
| `support.released` | trả về hàng đợi | `{conversationId, agentId}` |
| `support.closed` | đóng | `{conversationId, by}` |
| `support.reopened` | mở lại | `{conversationId, by, status}` |
| `support.rated` | khách đánh giá | `{conversationId, rating, note}` |
| `user.registered` | đăng ký tài khoản | `{user: {_id, name, email}}` |

## 3. Request

```http
POST <url>
Content-Type: application/json
User-Agent: vnchat-webhook/1.0
X-Chat-Event: message.created
X-Chat-Delivery: <deliveryId>                  // = id trong body; dùng để chống trùng
X-Auth-Timestamp: 1760000000                   // unix giây
X-Auth-Body-Signature: <hex>

{ "id": "<deliveryId>", "event": "message.created", "at": "2026-10-14T08:00:00.000Z", "data": { ... } }
```

`X-Auth-Body-Signature = hex(HMAC-SHA256(secret, timestamp + "\n" + hex(sha256(body))))` – cùng công thức
`X-Auth-Body-Signature` của chat-platform. Verify (Node/Express, giữ raw body):

```js
app.post("/hooks/vnchat", express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }), (req, res) => {
  const ts = req.get("X-Auth-Timestamp");
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return res.sendStatus(401);
  const hash = crypto.createHash("sha256").update(req.rawBody).digest("hex");
  const expected = crypto.createHmac("sha256", process.env.VNCHAT_WEBHOOK_SECRET).update(`${ts}\n${hash}`).digest("hex");
  const got = String(req.get("X-Auth-Body-Signature") ?? "");
  if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) return res.sendStatus(401);
  if (req.body.id !== req.get("X-Chat-Delivery")) return res.sendStatus(400);
  // chống trùng theo req.body.id rồi xử lý bất đồng bộ
  res.sendStatus(204);
});
```

Lưu ý: retry dùng lại đúng payload đã ký lúc tạo nhưng **timestamp mới** → đừng đặt cửa sổ timestamp quá chặt nếu xử lý chậm; chống trùng bằng `id`.

## 4. Gửi và retry

- `dispatch(event, data)` tạo một `webhookdeliveries` (`pending`) cho mỗi subscription khớp rồi đánh thức worker; không bao giờ làm hỏng request gốc.
- Worker lấy delivery đến hạn bằng compare-and-set `lockedUntil` (an toàn khi chạy chồng), POST với timeout `WEBHOOK_TIMEOUT_MS`, đọc tối đa 4 KB response, không theo redirect.
- 2xx → `delivered`. Lỗi khác → `attempts+1`, `lastStatusCode`, `lastError`, hẹn lại sau `5s × 2^(attempts−1)` (tối đa 6 giờ, + jitter); đủ `WEBHOOK_MAX_ATTEMPTS` (mặc định 8) → `failed`.
- Subscription bị tắt/xoá giữa chừng → `failed` (`subscription disabled or deleted`).
- Redeliver: đặt lại `pending` (giữ `attempts`) và gửi ngay; áp dụng cả cho `delivered`/`failed` → receiver phải chống trùng.
- Delivery tự xoá sau 14 ngày (TTL).

## 5. Chống SSRF

- Lúc tạo/sửa: URL phải `http(s)` có host; IP literal phải qua chính sách dưới.
- Lúc kết nối: kiểm tra **mọi địa chỉ sau khi resolve DNS** (custom `lookup`), nên hostname không trỏ ngầm vào mạng nội bộ được:
  - luôn chặn: link-local/metadata `169.254.0.0/16`, `0.0.0.0/8`, multicast, `fe80::/10`, `ff00::/8`, `::`;
  - loopback `127.0.0.0/8`, `::1`: chỉ cho phép khi `NODE_ENV != production`;
  - mạng riêng (`10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `fc00::/7`): cho phép trừ khi `WEBHOOK_ALLOW_PRIVATE_NETWORKS=false`.
- Đích bị chặn → `failed` ngay, không retry.
