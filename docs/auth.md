# Xác thực và phân quyền

## 1. Tài khoản và session

- `POST /api/auth/signup` / `login` tạo một document `sessions` và ký JWT `{userId, sid}` (hết hạn sau `SESSION_TTL_DAYS`).
  Token được set vào cookie `jwt` (httpOnly, `SameSite=COOKIE_SAMESITE`, Secure ở production hoặc khi `none`) **và** trả trong body (`token`).
- Mọi request: `middleware/auth.middleware.js#protectRoute` → `services/session.service.js#authenticateToken`:
  JWT hợp lệ → session tồn tại, chưa `revokedAt`, chưa hết hạn → user tồn tại, `status != inactive`.
- Ưu tiên `Authorization: Bearer <jwt>` trước cookie. Bearer bắt đầu bằng `ck_` là API key, không phải JWT.
- Thu hồi: `POST /api/auth/logout` (session hiện tại), `DELETE /api/auth/sessions/:id`, `POST /api/auth/logout-all`
  (ghi audit `session.logout_all`), admin khoá tài khoản. Thu hồi xong server ngắt socket của session/người đó;
  khoá tài khoản còn phát `session.revoked {reason: "disabled"}` trước khi ngắt.
- Đăng nhập sai email hay sai mật khẩu đều trả `CHAT-400-015` (không lộ email đã đăng ký). Giới hạn `RATE_LIMIT_LOGIN_PER_MINUTE` theo IP (đặt `TRUST_PROXY` khi chạy sau proxy).
- Token cấp trước khi có session (bản cũ) không còn hợp lệ → client đăng nhập lại.

## 2. Khách widget (kind `visitor`)

`POST /api/widget/sessions {name?, email?, visitorToken?}` (public, `RATE_LIMIT_WIDGET_SESSIONS_PER_MINUTE` theo IP,
tắt bằng settings `widget.enabled`):

- Không có/không hợp lệ `visitorToken` → tạo user `kind: visitor` (`name` mặc định `Khách #XXXX`, `contactEmail`).
- `visitorToken = v1.<userId>.<HMAC-SHA256(VISITOR_SECRET, "visitor:<id>")[0:32]>` – client lưu lại để lần sau nối đúng danh tính.
- Khách chỉ dùng được: `/api/me`, hội thoại/tin nhắn của chính họ, `/api/support/conversations*`, presence. Mọi route
  "staff" (`requireUser`) trả 403.

## 3. Quyền hệ thống – policy kiểu Casbin (`src/lib/permissions.js`)

Rule `{sub: role, obj, act}`; khớp khi `sub ∈ roles(user)`, `keyMatch(obj)` (`admin:*` khớp mọi `admin:<x>`) và
`act == "*"` hoặc đúng `read`/`write`. Chỉ áp cho `kind: user` đang active. Policy lưu trong `settings.policies`, sửa
qua `PUT /api/admin/policies` (thay toàn bộ, ghi audit `policy.updated`).

Mặc định:

| sub | obj | act |
| :--- | :--- | :--- |
| admin | `admin:*` | * |
| admin | `support` | * |
| admin | `chat` | * |
| agent | `support` | * |
| agent | `chat` | * |
| member | `chat` | * |

| Object | Route |
| :--- | :--- |
| `chat` | tạo direct/group, sửa nhóm, thêm/xoá/đổi role thành viên (`write`); tìm người dùng (`read`) |
| `support` | `/api/support/queue`, `stats`, `agents`, `assign`, `transfer`, `release`, `reopen`, `tags` |
| `admin:principals` | `/api/admin/users*` |
| `admin:webhooks` | `/api/admin/webhooks*` |
| `admin:settings` | `/api/admin/settings` |
| `admin:audit` | `/api/admin/audit` |
| `admin:api_keys` | `/api/admin/api-keys*` |
| `admin:policies` | `/api/admin/policies` |

`validateRules` từ chối: role sai định dạng, object lạ, action lạ, rule trùng, và bộ rule làm `admin` mất quyền
`write` trên `admin:policies` (`CHAT-400-009`). Gán role: `PUT /api/admin/users/:id/roles` (không cho bỏ admin cuối) hoặc
`npm run set-roles -- <email> admin,agent,member`.

## 4. Quyền trong hội thoại

| Hành động | Ai |
| :--- | :--- |
| Đọc hội thoại / tin / thành viên / poll | thành viên; **hoặc** agent/admin với hội thoại support (kể cả chưa nhận) |
| Gửi, reaction, ghim, ẩn, read, mute/pin/archive | thành viên (support chưa đóng) |
| Sửa tin | chỉ người gửi |
| Xoá tin | người gửi, hoặc owner/admin nhóm |
| Bỏ ghim | direct: ai cũng được; nhóm/support: owner/admin hoặc người đã ghim |
| Đổi tên/avatar/historyVisibility, thêm/xoá thành viên | owner/admin nhóm (xoá owner: chỉ owner) |
| Đổi role thành viên | chỉ owner; không hạ/xoá/rời owner cuối (`CHAT-409-002`) |
| Đóng poll | người tạo hoặc owner/admin nhóm |
| Trước mốc lịch sử (`since_join`) | đọc trực tiếp → `CHAT-403-009`, danh sách tự lọc |
| Bị chặn (bất kỳ chiều) | không mở direct, không gửi/typing trong direct, không thêm vào nhóm (`CHAT-403-008`) |

## 5. API key đối tác (`/api/open/v1`)

- Admin tạo: `POST /api/admin/api-keys {name, scopes[], expiresAt?}` → `key` dạng `ck_<48 hex>` trả **một lần**;
  lưu `sha256(key)` và `prefix`. Mỗi key có một user `kind: bot` (tên = tên key) để đăng tin.
- Gửi `X-Api-Key: ck_...` hoặc `Authorization: Bearer ck_...`. Sai/thu hồi/hết hạn → `CHAT-401-005`; thiếu scope → `CHAT-403-007`.
- Scope: `conversations:read`, `messages:read`, `messages:write`, `support:write`. Chỉ chạm hội thoại **support**
  (hội thoại khác trả `CHAT-404-002` như không tồn tại).
