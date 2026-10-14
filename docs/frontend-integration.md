# Tích hợp frontend / mobile

## 1. Đăng nhập

```js
const res = await fetch(`${API}/api/auth/login`, {
  method: "POST",
  credentials: "include",                 // nhận cookie jwt nếu cùng site
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, device: "web-chrome" }),
});
const { token, roles } = await res.json();
```

- **Cùng site** (frontend proxy `/api` và `/socket.io` về backend, hoặc cùng domain): dùng cookie, `credentials: "include"`.
- **Khác domain** (vd. frontend trên Vercel, API trên `*.onrender.com`): gửi `Authorization: Bearer <token>`; lưu token
  ở bộ nhớ/secure storage. Cookie chỉ đi được khi backend đặt `COOKIE_SAMESITE=none` và trình duyệt cho phép cookie bên thứ ba.
- `CLIENT_URL` của backend phải chứa origin frontend (CORS cho HTTP và Socket.IO).
- API trả `401` (`CHAT-401-001/002`) hoặc socket nhận `session.revoked` → xoá token, về màn đăng nhập.

## 2. Khởi động app

1. `GET /api/me/bootstrap` → `me`, `permissions.admin/agent`, `branding`, `limits`, `commandRules`, `unreadTotal`,
   `nicknames` (map userId → biệt danh, phủ lên tên hiển thị), `blockedUserIds`, `serverTime` (lưu làm mốc sync).
2. `GET /api/conversations?limit=30` → inbox; `?pinned=true` cho danh sách ghim; `?archived=true` cho lưu trữ.
3. Kết nối socket ([realtime.md](realtime.md)) và chờ `ready`.

## 3. Hội thoại và tin nhắn

- Mở chat 1-1: `POST /api/conversations/direct {userId}` (200 nếu đã có). Nhóm: `POST /api/conversations/group`.
- Tải tin: `GET /api/conversations/:id/messages?limit=50` → `items` cũ → mới; cuộn lên: `?before=<nextCursor>`.
- Gửi: tạo `clientMsgId` (uuid) trước, hiển thị tin tạm; `POST .../messages {text, clientMsgId, replyTo?, mentions?}`.
  Mất mạng thì gửi lại cùng `clientMsgId` (server trả 200 tin cũ, không nhân đôi). Khi nhận `message.new` có
  `clientMsgId` trùng thì thay tin tạm.
- Đánh dấu đã đọc khi tin hiển thị: `POST .../read {seq}`; nghe `read.updated` để vẽ "đã xem".
- Đang nhập: emit `typing {conversationId, typing: true}` khi gõ (server tự throttle), `false` khi dừng; tắt chỉ báo khi tới `expiresAt`.
- Reaction: dùng `reactions[].userIds` để tính `mine` (field `mine` trong event là của người thao tác).
- Tin system (`type: "system"`): hiển thị theo `metadata.kind` (vd. `member.added` → `metadata.memberIds`).
- Tin xoá: `deletedAt != null`, `text` rỗng → hiển thị "Tin nhắn đã bị xoá".
- Unread của từng hội thoại: `unreadCount`; tổng: `unreadTotal` trong bootstrap (bỏ hội thoại mute/lưu trữ).

## 4. Upload file

Nhỏ (≤ `JSON_BODY_LIMIT`): gửi kèm tin `attachments: [{data: "data:image/png;base64,...", name}]`.

Lớn (khuyến nghị): upload thẳng lên Cloudinary rồi gửi tham chiếu:

```js
const sig = await api.post("/api/files/signature", { conversationId });
const form = new FormData();
Object.entries({ file, api_key: sig.apiKey, timestamp: sig.timestamp, folder: sig.folder, signature: sig.signature })
  .forEach(([k, v]) => form.append(k, v));
const up = await fetch(sig.uploadUrl, { method: "POST", body: form }).then((r) => r.json());
await api.post(`/api/conversations/${conversationId}/messages`, {
  clientMsgId,
  attachments: [{ url: up.secure_url, publicId: up.public_id, name: file.name, size: up.bytes, mime: file.type }],
});
```

MIME phải nằm trong `limits.allowedMime`, dung lượng ≤ `limits.maxFileBytes` (bootstrap).

## 5. Chat hỗ trợ trong widget

```js
// lần đầu: không có visitorToken; lần sau gửi lại để giữ lịch sử
const s = await post("/api/widget/sessions", { name, email, visitorToken: localStorage.vnchatVisitor });
localStorage.vnchatVisitor = s.visitorToken;
const conv = await post("/api/support/conversations", { meta: { page: location.pathname } }, s.token);
const socket = io(API, { auth: { token: s.token } });
```

Hiển thị `s.welcomeMessage`; nghe `support.updated` để đổi trạng thái ("đang chờ nhân viên" → "đã có nhân viên").
Console nhân viên: [support.md §3](support.md#3-phía-nhân-viên-quyền-supportwrite--role-agent-hoặc-admin).

## 6. Client bản cũ cần đổi gì

1. `io(URL, { query: { userId } })` → `io(URL, { withCredentials: true })` hoặc `{ auth: { token } }`.
2. Login trả 200 (trước là 201).
3. Người dùng đăng nhập lại một lần sau khi nâng cấp server.
