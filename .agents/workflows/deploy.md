---
description: Deploy bằng Docker / Render
---

# Workflow: Deploy

Chi tiết: [docs/deployment.md](../../docs/deployment.md).

## Render (production)

1. Đảm bảo `npm test` xanh local; push nhánh, mở PR vào `master`.
2. CI `ci` (job `test` + `docker`) phải xanh – Render dùng `autoDeployTrigger: checksPass`, commit đỏ không được deploy.
3. Merge → Render build `Dockerfile` → health check `/health` → chuyển traffic. Theo dõi Dashboard → Events/Logs.
4. Xác minh: `GET /health` (`version` = commit), `GET /health/ready`, mở `/api-docs`; tuỳ chọn chạy Bruno env `render`.
5. Lỗi → Dashboard → Rollback về deploy trước.

## Thay đổi cần chú ý trước khi deploy

| Thay đổi | Việc cần làm |
| :--- | :--- |
| Biến môi trường mới | thêm vào `src/config.js`, `.env.example`, `render.yaml` (`sync: false` nếu là secret – Render chỉ hỏi khi tạo Blueprint, nên **thêm tay trong Dashboard** cho service đã tồn tại), `docs/env-reference.md` |
| Index mới trên collection lớn | tạo trước trên Atlas rồi mới deploy |
| Nâng dữ liệu (`migration.service.js`) | idempotent, không xoá field (rollback phải còn chạy) |
| Đổi Dockerfile / base image | pin tag + digest; build thử `docker build .` và `npm run docker:up` |
| Thay đổi phá client cũ | ghi `CHANGELOG.md` mục Breaking + `docs/frontend-integration.md` §6 |

## Docker trên VM

```bash
git pull && docker compose up -d --build --wait
docker compose logs -f api
```
