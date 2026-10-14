# back-end-vnchat

Backend chat realtime (Node.js · Express 5 · MongoDB · Socket.IO · Cloudinary). Bản này bổ sung các tính năng
theo mô hình **chat-platform**: hội thoại 1-1 / nhóm, tính năng tin nhắn đầy đủ, bình chọn, nhắc việc, chặn,
biệt danh, presence, **chat hỗ trợ khách hàng do nhân viên xử lý** (không dùng AI), quản trị (role, khoá tài khoản,
policy phân quyền, webhook, audit, API key đối tác).

API cũ (`/api/auth/*`, `/api/messages/*`) vẫn hoạt động — xem [Tương thích](#tương-thích-với-bản-cũ).

---

## 1. Chạy

```bash
cp .env.example .env        # điền MONGODB_URI, JWT_SECRET, Cloudinary
npm install
npm run dev                 # nodemon src/index.js
```

Mỗi lần khởi động server tự đồng bộ index và nâng dữ liệu bản cũ (idempotent; chạy tay: `npm run migrate`).

Tạo admin đầu tiên (đăng ký tài khoản trước):

```bash
npm run set-roles -- admin@example.com admin,agent,member
```

Role: `admin` (quản trị + hỗ trợ + chat), `agent` (nhân viên hỗ trợ + chat), `member` (chat, mặc định).

### Test

Test tích hợp chạy trên Mongo thật (mặc định `mongodb://127.0.0.1:27018`, đổi bằng `MONGODB_TEST_URI`):

```bash
docker run -d --name vnchat-test-mongo --tmpfs /data/db -p 127.0.0.1:27018:27017 mongo:7
npm test
```

---

## 2. Xác thực

- `POST /api/auth/signup`, `POST /api/auth/login` → set cookie `jwt` **và** trả `token` trong body.
- Mọi API nhận cookie `jwt` (web) hoặc `Authorization: Bearer <token>` (mobile).
- Mỗi lần đăng nhập là một **session**; JWT mang `sid` nên thu hồi có hiệu lực ngay:
  `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/logout`, `POST /api/auth/logout-all`.
- Khoá tài khoản (`PUT /api/admin/users/:id/status {status:"inactive"}`) thu hồi mọi session, ngắt socket, chặn đăng nhập.
- Khách không tài khoản (widget hỗ trợ): `POST /api/widget/sessions {name?, email?, visitorToken?}` → `token` +
  `visitorToken` (lưu lại để lần sau nối đúng danh tính). Khách chỉ dùng được chat hỗ trợ.

---

## 3. API

Lỗi: `{ "message": "...", "code": "CHAT-403-003", "fields"?: [...] }` (bảng mã ở §8).
Danh sách phân trang: `{ items, nextCursor, hasMore }` — gửi lại `?cursor=<nextCursor>` (tin nhắn: `?before=` / `?after=`).

### Hội thoại — `/api/conversations`

| Method | Path | Ghi chú |
| :--- | :--- | :--- |
| GET | `/?kind&archived&pinned&cursor&limit` | inbox, mới nhất trước; `archived=true` / `pinned=true` |
| POST | `/direct` `{userId}` | 201 tạo mới / 200 đã có |
| POST | `/group` `{title, memberIds[], avatarUrl?, avatar?(data URI), historyVisibility?}` | người tạo là `owner` |
| GET / PATCH | `/:id` | PATCH `{title?, avatarUrl?, avatar?, historyVisibility?: all\|since_join}` (owner/admin nhóm) |
| GET / POST | `/:id/members` | POST `{memberIds[]}` (owner/admin) |
| PATCH / DELETE | `/:id/members/:userId` | PATCH `{role: owner\|admin\|member}` (chỉ owner) |
| POST | `/:id/leave` | owner cuối không rời được khi nhóm còn người |
| POST | `/:id/read` `{seq?}` | đánh dấu đã đọc → `read.updated` |
| POST | `/:id/mute` `{minutes}` | 0 = bỏ, -1 = vô thời hạn |
| POST | `/:id/archive` `{archived}` · `/:id/pin` `{pinned}` | riêng từng người; tin mới tự bỏ lưu trữ |
| POST | `/:id/typing` `{typing}` | (hoặc socket event `typing`) |

### Tin nhắn

| Method | Path | Ghi chú |
| :--- | :--- | :--- |
| GET | `/api/conversations/:id/messages?before&after&limit` | trang trả về cũ → mới |
| POST | `/api/conversations/:id/messages` | `{text?, clientMsgId?, replyTo?, mentions[]?, attachments[]?, type?: "sticker", sticker?}`; trùng `clientMsgId` → 200 tin cũ |
| GET / PATCH / DELETE | `/api/conversations/:id/messages/:messageId` | sửa: chỉ người gửi; xoá: người gửi hoặc owner/admin nhóm (xoá mềm) |
| POST / DELETE | `.../:messageId/reactions` `{emoji}` · `.../reactions/:emoji` | nhiều emoji / người |
| POST / DELETE | `.../:messageId/pin` | `GET /api/conversations/:id/pins` |
| POST / DELETE | `.../:messageId/hide` | ẩn phía mình |
| POST | `.../:messageId/forward` `{conversationIds[]}` | kết quả từng đích |
| GET | `/api/conversations/:id/media?kind=image\|video\|audio\|file\|link` | thư viện media |
| GET | `/api/messages/search?q&conversationId&senderId&type&from&to` | không phân biệt dấu |
| GET | `/api/stickers` | catalogue (admin sửa trong settings) |
| POST | `/api/files/signature` `{conversationId?}` | chữ ký upload thẳng lên Cloudinary |

Đính kèm: `attachments[]` nhận `{data: "data:<mime>;base64,..."}` (server upload, giới hạn bởi `JSON_BODY_LIMIT`)
hoặc file đã upload thẳng bằng chữ ký `{url, publicId, name, size, mime}` (phải nằm trong thư mục `vnchat/u_<userId>`).
Tin bắt đầu bằng `/<lệnh>` khớp `commandRules` đang bật → `type:"command"` (+ webhook `chat.command.detected`).

### Bình chọn, nhắc việc, mạng xã hội

| Method | Path | Ghi chú |
| :--- | :--- | :--- |
| POST | `/api/conversations/:id/polls` | `{question, options[2..10], multiple?, anonymous?, closesAt?}` → `{poll, message}` |
| GET | `/api/polls/:id` | `options[].count`, `voters` (trừ ẩn danh), `myOptionIds` |
| PUT / DELETE | `/api/polls/:id/votes` `{optionIds[]}` | thay toàn bộ phiếu / rút phiếu |
| POST | `/api/polls/:id/close` | người tạo hoặc owner/admin nhóm; hết `closesAt` tự đóng |
| CRUD | `/api/reminders` | `{note, remindAt (ISO có offset), timezone, conversationId?, messageId?}` → `reminder.fired` đúng giờ |
| POST / DELETE / GET | `/api/blocks/:userId` · `/api/blocks` | chặn hai chiều mọi tương tác 1-1 |
| PUT / DELETE | `/api/users/:id/nickname` `{nickname}` · GET `/api/nicknames` | biệt danh riêng |
| POST / DELETE / GET | `/api/presence/heartbeat` `{deviceId}` · `/api/presence` · `/api/presence?ids=` | socket đang kết nối cũng tính là online |
| GET | `/api/users?q` · `/api/users/:id` | tìm người dùng (tên không dấu, đầu email) |
| GET / PATCH | `/api/me` · GET `/api/me/bootstrap` | bootstrap: quyền, branding, limits, unreadTotal, nicknames, serverTime |
| GET | `/api/sync?since=<ISO>` | bù dữ liệu sau khi mất kết nối |

### Chat hỗ trợ (nhân viên xử lý) — `/api/support`

```
khách mở ─► waiting_agent ──assign──► agent ──close──► closed ──reopen──► agent | waiting_agent
                        ◄──release──        ──transfer──► agent khác
```

| Ai | Method | Path | Ghi chú |
| :--- | :--- | :--- | :--- |
| khách | POST | `/conversations` `{meta?, text?}` | mỗi khách tối đa 1 hội thoại mở (gọi lại trả hội thoại đang mở) |
| khách | GET | `/conversations/mine` | |
| khách / agent | POST | `/conversations/:id/close` | |
| khách | POST | `/conversations/:id/rate` `{rating 1..5, note?}` | |
| agent | GET | `/queue?status=open\|waiting_agent\|agent\|closed\|all&mine&tag` | |
| agent | GET | `/stats` · `/agents` | số ticket theo trạng thái, điểm đánh giá TB; danh sách nhân viên + online |
| agent | POST | `/conversations/:id/assign` `{agentId?}` | nhận ticket (ai nhanh hơn thắng, người sau 409); gán cho người khác: chỉ admin |
| agent | POST | `/conversations/:id/transfer` `{agentId}` | người đang phụ trách hoặc admin |
| agent | POST | `/conversations/:id/release` | trả về hàng đợi |
| agent | POST | `/conversations/:id/reopen` · PUT `/conversations/:id/tags` `{tags[]}` | |

Khách và agent nhắn tin bằng API tin nhắn bình thường. Agent đọc được mọi ticket; muốn trả lời phải nhận
(assign) trước. Socket: agent nhận `support.updated` / `support.message` trên console; emit
`support:watch {conversationId}` để theo dõi realtime một ticket chưa nhận.

### Quản trị — `/api/admin` (theo policy)

| Path | Quyền |
| :--- | :--- |
| `GET /users`, `PUT /users/:id/roles`, `PUT /users/:id/status` | `admin:principals` |
| `GET/POST /webhooks`, `PUT/DELETE /webhooks/:id`, `GET /webhooks/:id/deliveries`, `POST /webhooks/deliveries/:id/redeliver` | `admin:webhooks` |
| `GET/PUT /settings` (`branding`, `commandRules`, `stickerPacks`, `widget{enabled, welcomeMessage}`) | `admin:settings` |
| `GET /audit?actorId&action` | `admin:audit` |
| `GET/POST /api-keys`, `DELETE /api-keys/:id` | `admin:api_keys` |
| `GET/PUT /policies` | `admin:policies` |

Policy kiểu Casbin `{sub: role, obj, act}`; mặc định:

```
admin  admin:*  *      agent  support  *      member  chat  *
admin  support  *      agent  chat     *
admin  chat     *
```

`PUT /policies` thay toàn bộ (ví dụ thêm `{sub:"member", obj:"admin:audit", act:"read"}`); bộ rule làm admin mất
quyền sửa policy bị từ chối (`CHAT-400-009`).

### API đối tác — `/api/open/v1` (header `X-Api-Key: ck_...`)

Key tạo ở `POST /api/admin/api-keys {name, scopes[]}` (key chỉ hiện một lần). Chỉ chạm được hội thoại hỗ trợ.

| Method | Path | Scope |
| :--- | :--- | :--- |
| GET | `/conversations/:id` | `conversations:read` |
| GET | `/conversations/:id/messages?before&after&limit` | `messages:read` |
| POST | `/conversations/:id/messages` `{text, clientMsgId?}` | `messages:write` — đăng dưới tên bot của key |
| POST | `/support/conversations/:id/close` | `support:write` |

---

## 4. Realtime (Socket.IO)

```js
import { io } from "socket.io-client";
// web: cookie jwt đi kèm khi bật withCredentials; mobile: truyền token
const socket = io(API_URL, { withCredentials: true, auth: { token } });
socket.on("ready", () => {/* đã vào đủ room */});
socket.on("message.new", (m) => {});
socket.emit("typing", { conversationId, typing: true });
```

| Event | Khi |
| :--- | :--- |
| `message.new` / `message.updated` / `message.deleted` | tin mới / sửa / xoá |
| `reaction.updated`, `message.pinned`, `message.unpinned`, `message.hidden` (chỉ mình) | |
| `typing`, `read.updated` | |
| `conversation.new`, `conversation.updated`, `conversation.member.added`, `conversation.member.removed` | |
| `poll.updated`, `poll.closed` | chỉ số đếm, không lộ ai bầu gì |
| `reminder.created` / `updated` / `cancelled` / `fired` | |
| `user.online`, `user.offline` | tới các contact |
| `block.updated`, `nickname.updated`, `session.revoked` | |
| `support.updated`, `support.message` | hội thoại hỗ trợ / console agent |
| `newMessage`, `getOnlineUsers` | sự kiện của bản cũ (vẫn phát) |

Khi mất kết nối lâu: gọi `GET /api/sync?since=<serverTime lần trước>`.

---

## 5. Webhook

Event: `message.created`, `chat.command.detected`, `conversation.created`, `support.started`, `support.assigned`,
`support.transferred`, `support.released`, `support.closed`, `support.reopened`, `support.rated`, `user.registered`
(hoặc `*`).

```http
POST <url>
X-Chat-Event: message.created
X-Chat-Delivery: <id>                    // = id trong body, dùng để chống trùng
X-Auth-Timestamp: 1760000000
X-Auth-Body-Signature: hex(HMAC-SHA256(secret, timestamp + "\n" + hex(sha256(body))))

{ "id": "...", "event": "message.created", "at": "2026-10-14T08:00:00Z", "data": { ... } }
```

```js
const ok = (req, secret) => {
  const ts = req.get("X-Auth-Timestamp");
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 30) return false;
  const hash = crypto.createHash("sha256").update(req.rawBody).digest("hex");
  const expected = crypto.createHmac("sha256", secret).update(`${ts}\n${hash}`).digest("hex");
  const got = String(req.get("X-Auth-Body-Signature") ?? "");
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
};
```

Không phải 2xx → thử lại với backoff tăng dần (tối đa `WEBHOOK_MAX_ATTEMPTS`, mặc định 8) rồi `failed`; gửi lại bằng
`redeliver`. Địa chỉ link-local/metadata luôn bị chặn, loopback chỉ cho phép ngoài production.

---

## 6. Tương thích với bản cũ

Giữ nguyên: `POST /api/auth/signup|login|logout`, `PUT /api/auth/update-profile`, `GET /api/auth/check`,
`GET /api/messages/users`, `GET /api/messages/:id`, `POST /api/messages/send/:id`, socket event `newMessage`,
`getOnlineUsers`. Tin nhắn 1-1 cũ được gom vào hội thoại direct khi khởi động.

Thay đổi cần lưu ý ở frontend:

1. **Socket phải xác thực**: `io(URL, { withCredentials: true })` (cookie) hoặc `auth: { token }`.
   `query.userId` không còn được tin (trước đây ai cũng mạo danh được để nhận tin của người khác).
2. Token đăng nhập trước bản này không còn hợp lệ (thiếu session) → người dùng đăng nhập lại một lần.
3. `POST /api/auth/login` trả 200 (trước là 201); sai email hoặc sai mật khẩu cùng một thông báo.

## 7. Giới hạn hiện tại

- Presence, rate limit, throttle typing nằm trong bộ nhớ: chạy **một instance**. Scale ngang cần Redis
  (Socket.IO Redis adapter + chuyển các state này sang Redis).
- Chưa có push notification (FCM) và upload resumable cho tệp rất lớn (dùng upload thẳng Cloudinary).

## 8. Mã lỗi chính

| Code | HTTP | Ý nghĩa |
| :--- | :--- | :--- |
| CHAT-400-000 | 400 | dữ liệu không hợp lệ (`fields[]`) |
| CHAT-400-001…011, 014, 015 | 400 | direct với chính mình, nhóm quá lớn, tin quá dài/rỗng, cursor sai, MIME, không phải support, policy sai, phiếu sai, sticker, timezone, sai thông tin đăng nhập |
| CHAT-401-000/001/002/005 | 401 | thiếu credential / token sai / session bị thu hồi / API key sai |
| CHAT-403-000…009 | 403 | không quyền, widget tắt, tài khoản khoá, không phải thành viên, chỉ owner/admin, chỉ người gửi, chỉ agent, thiếu scope, bị chặn, trước mốc lịch sử |
| CHAT-404-000…009 | 404 | không tìm thấy (người dùng, hội thoại, tin, webhook, API key, poll, nhắc việc) |
| CHAT-409-000…011 | 409 | xung đột, đã là thành viên, owner cuối, hội thoại đã đóng, tin đã xoá, đã có agent, poll đã đóng, quá số ghim/reaction, đã chặn |
| CHAT-413-001 | 413 | tệp quá lớn |
| CHAT-429-000 | 429 | quá giới hạn tần suất |
| CHAT-503-001 | 503 | chưa cấu hình Cloudinary |
