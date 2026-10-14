# Testing

Ba lớp, đều chạy trong CI:

| Lớp | Ở đâu | Chạy | Kiểm tra |
| :--- | :--- | :--- | :--- |
| Tích hợp | `test/*.test.js` | `npm test` | HTTP thật (supertest) + Socket.IO thật + MongoDB thật, từng tính năng và quyền |
| Hợp đồng API | `test/openapi.test.js` | `npm test` | `api/openapi.yaml` khớp 100% route trong `API_ROUTERS` |
| API end-to-end | `api-tests/bruno/` | `npm run test:api` / CI trên image Docker | 93 request theo luồng người dùng thật |

## 1. Test tích hợp

```bash
npm run test:db        # MongoDB 7 trên tmpfs, cổng 127.0.0.1:27018
npm test
npm run test:db:stop
```

`test:db` chạy `docker run -d --name vnchat-test-mongo --tmpfs /data/db -p 127.0.0.1:27018:27017 mongo:7`. Dùng tmpfs vì
Docker Desktop trên Windows tạo collection/index rất chậm khi ghi đĩa (2–3 giây mỗi lệnh). Gõ tay lệnh này trong Git Bash
thì thêm `MSYS_NO_PATHCONV=1` phía trước, nếu không `/data/db` bị đổi thành đường dẫn Windows.

- `test/helpers.js#setup(name)`: đặt env test, tạo database `vnchat_test_<name>_<timestamp>`, chạy migration, khởi
  động HTTP + Socket.IO trên cổng ngẫu nhiên, **giả lập Cloudinary** (`uploader.upload` trả URL giả). `teardown()` xoá database.
- `signup(app, name)` → `{user, token, email, api}`; `api.get/post/put/patch/del` tự gắn Bearer.
- `makeRole(userId, roles)` gán role trực tiếp; `connect(ctx, token)` mở socket và chờ `ready`;
  `waitFor(socket, event, predicate)` chờ event (kể cả đã đến trước).
- Việc nền gọi trực tiếp thay vì chờ timer: `fireDueReminders()`, `closeExpiredPolls()`, `processDueDeliveries()`.
- Chạy một file: `node --test test/chat.test.js`. Các file chạy tuần tự (`--test-concurrency=1`), mỗi file một database.

| File | Phạm vi |
| :--- | :--- |
| `auth.test.js` | signup/login, cookie, session, logout-all, khoá tài khoản, socket auth, avatar, tìm kiếm không dấu |
| `chat.test.js` | API cũ, hội thoại, nhóm/role/since_join, read/unread, mute/pin/archive, mọi tính năng tin nhắn, typing, chặn, biệt danh, presence, poll, nhắc việc, sync |
| `support.test.js` | widget, hàng đợi, nhận (race), chuyển, trả, đóng/mở, tag, đánh giá, thống kê, API đối tác |
| `admin.test.js` | role, khoá, policy, settings, audit, webhook (chữ ký, retry, failed, redeliver, SSRF) |
| `migration.test.js` | dữ liệu bản cũ → hội thoại direct, index email cũ |
| `openapi.test.js` | spec khớp route |

## 2. Bruno (API test)

Collection `.bru` mở được bằng Bruno app (Open Collection → `api-tests/bruno`). Thứ tự folder: health → auth →
conversations → messages → polls → reminders → social → support → admin/open API → logout. Biến (token, id) được
script `post-response` lưu cho request sau; mỗi request có `tests` kiểm tra status/mã lỗi.

Environment:

| Env | baseUrl | Admin |
| :--- | :--- | :--- |
| `local` | `http://localhost:5001` | `adminEmail` + `adminPassword` (secret, nhập trong Bruno) |
| `render` | `https://back-end-vnchat.onrender.com` | như trên |
| `ci` | `http://127.0.0.1:5001` | `admin@ci.test` / `ci-admin-secret` (CI tự tạo) |

Folder `08-support`, `09-admin` cần một tài khoản có role admin+agent:

```bash
npm run set-roles -- admin@example.com admin,agent,member
npm run test:api          # = cd api-tests/bruno && npx @usebruno/cli@4.1.0 run --env local
```

Mỗi lần chạy tạo user mới (email theo timestamp) nên chạy lặp được trên cùng database.

## 3. Thêm test cho tính năng mới

1. Test tích hợp trong file theo phạm vi ở bảng trên (hoặc file mới `test/<feature>.test.js` dùng `setup()` riêng).
2. Kiểm tra cả đường lỗi: quyền (403 + `code`), validation (400), trạng thái (409).
3. Có realtime → `connect()` + `waitFor()` kiểm tra event và payload.
4. Đổi route → cập nhật `api/openapi.yaml` (test spec sẽ nhắc) và thêm request Bruno tương ứng.
