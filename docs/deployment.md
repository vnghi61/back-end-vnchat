# Triển khai

Hai cách dùng chung một `Dockerfile`: **Docker Compose** (máy dev / VM) và **Render** (`render.yaml`, cách fluentra đang
chạy production free-tier). CI (`.github/workflows/ci.yml`) build đúng image đó và chạy API test trên nó trước khi Render deploy.

## 1. Image (`Dockerfile`)

| | |
| :--- | :--- |
| Base | `node:22.23.2-alpine3.24`, pin theo digest (build lặp lại được) |
| Stage | `deps` (`npm ci --omit=dev`) → `runtime` (chỉ `node_modules`, `src/`, `api/`, `package.json`) |
| User | `node` (không phải root) |
| Cổng | `PORT` (mặc định 5001; Render tự đặt) |
| Healthcheck | `GET /health` (không chạm Mongo) |
| Tắt | SIGTERM → đóng socket + HTTP + Mongo, exit 0 trong ≤ 10 giây |
| Build arg | `APP_VERSION` → hiện ở `GET /health` (`version`); trên Render dùng `RENDER_GIT_COMMIT` |

```bash
docker build --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t back-end-vnchat .
```

## 2. Docker Compose (local / VM)

```bash
cp .env.example .env          # Cloudinary, JWT_SECRET...
npm run docker:up             # = docker compose up -d --build --wait  → http://localhost:5001, /api-docs
npm run docker:down
docker compose up -d mongo    # chỉ MongoDB cho `npm run dev` (MONGODB_URI=mongodb://127.0.0.1:27017/vnchat)
```

Compose chạy `api` với `NODE_ENV=production` (cookie Secure → qua http thì dùng Bearer token) và `mongo:7` có volume
`mongo-data`. Tạo admin: `docker compose exec api node src/scripts/set-roles.js <email> admin,agent,member`.

## 3. Render

### Chuẩn bị

| Thành phần | Dịch vụ | Ghi chú |
| :--- | :--- | :--- |
| API + Socket.IO + việc nền | Render web service (Docker, free) | `render.yaml` |
| MongoDB | **MongoDB Atlas M0 (free)** | Render không có Mongo managed. Network Access: cho phép `0.0.0.0/0` (Render free không có IP tĩnh) – bắt buộc mật khẩu mạnh |
| File | Cloudinary free | lấy cloud name, API key, API secret |

### Lần đầu

1. Merge nhánh có `render.yaml` vào `master` (Render đọc Blueprint từ nhánh này).
2. Atlas: tạo cluster M0 (region gần `singapore`), user DB, lấy connection string
   `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/vnchat?retryWrites=true&w=majority`.
3. Render Dashboard → **New → Blueprint** → chọn repo `vnghi61/back-end-vnchat` → Render đọc `render.yaml`, hỏi các biến
   `sync: false`: `MONGODB_URI`, `CLIENT_URL` (origin frontend, cách nhau dấu phẩy), `CLOUDINAR_CLOUD_NAME`,
   `CLOUDINAR_API_KEY`, `CLOUDINAR_SECRECT_KEY`. `JWT_SECRET`, `VISITOR_SECRET` được Render tự sinh.
4. Deploy xong: mở `https://<service>.onrender.com/health` và `/api-docs`.
5. Đăng ký tài khoản quản trị qua API/frontend, rồi gán role. Render free không có shell → chạy từ máy:
   ```bash
   MONGODB_URI='<atlas-uri>' npm run set-roles -- you@example.com admin,agent,member
   ```
6. (Tuỳ chọn) chạy bộ API test vào production: environment `render` trong Bruno (điền `adminEmail`/`adminPassword` dạng secret).

### Mỗi lần deploy

Push/merge vào `master` → GitHub Actions chạy `ci` → **pass** thì Render tự build lại (`autoDeployTrigger: checksPass`).
Migration (index + nâng dữ liệu) tự chạy khi boot, idempotent, nên không cần bước pre-deploy.

### Biến môi trường trên Render

| Key | Giá trị |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | URI Atlas |
| `JWT_SECRET`, `VISITOR_SECRET` | tự sinh (generateValue) |
| `CLIENT_URL` | origin frontend |
| `COOKIE_SAMESITE` | `none` (frontend khác domain); dùng `strict` nếu frontend proxy `/api` cùng site |
| `TRUST_PROXY` | `10.0.0.0/8` – proxy nội bộ Render, để rate limit theo IP thật (giống `HTTP_TRUSTED_PROXIES` của fluentra) |
| `CLOUDINAR_*`, `CLOUDINARY_FOLDER` | Cloudinary |
| `API_DOCS_ENABLED` | `true` (đặt `false` nếu không muốn công khai `/api-docs`) |

Danh sách đầy đủ: [env-reference.md](env-reference.md).

### Frontend

- Frontend khác domain: gọi API bằng Bearer token, socket `io("https://<service>.onrender.com", { auth: { token } })`.
- Nếu frontend có rewrite (vd. `vercel.json` proxy `/api/*` như fluentra) thì cookie giữ được same-site, nhưng WebSocket
  thường không qua được rewrite → kết nối socket thẳng tới domain Render bằng token.

### Giới hạn gói free

- Render ngủ sau 15 phút không có request; request đầu mất ~1 phút. Lúc ngủ: không có realtime, nhắc việc/poll quá hạn được xử lý khi thức dậy, webhook pending gửi bù.
- 512 MB RAM, 0.1 CPU; mỗi lần hash mật khẩu tốn CPU → nhiều người đăng nhập cùng lúc sẽ chậm.
- **Một instance**: không bật autoscale/nhiều instance (presence, rate limit trong bộ nhớ).
- Atlas M0: 512 MB dữ liệu.

## 4. CI (`.github/workflows/ci.yml`)

| Job | Làm gì |
| :--- | :--- |
| `test` | MongoDB service → `npm ci` → `npm test` (test tích hợp + test spec OpenAPI) |
| `docker` | build image → chạy container → seed admin → chạy Bruno (`@usebruno/cli@4.1.0 run --env ci`) → `docker stop` phải exit 0 |

Action pin theo commit SHA. Render chỉ deploy khi cả hai job pass.

## 5. Rollback

Render Dashboard → service → **Events** → chọn deploy trước → **Rollback**. Dữ liệu: migration chỉ thêm field/index và
gom dữ liệu cũ, không xoá field, nên bản trước vẫn đọc được.
