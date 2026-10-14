# ADR-0007: Docker image, deploy Render free + MongoDB Atlas

- Trạng thái: Accepted · 2026-10-14

## Bối cảnh

fluentra chạy production trên gói free (Render web service, health check `/health`, push `main` là deploy). Render không có MongoDB managed.

## Quyết định

- Một `Dockerfile` (multi-stage, non-root, base pin digest, HEALTHCHECK, SIGTERM tắt êm) dùng cho Compose, CI và Render.
- `render.yaml` (Blueprint): `runtime: docker`, `plan: free`, `region: singapore`, `healthCheckPath: /health`,
  `autoDeployTrigger: checksPass` (chỉ deploy commit qua CI). Secret `sync: false`; `JWT_SECRET`/`VISITOR_SECRET` `generateValue`.
- MongoDB Atlas M0; file trên Cloudinary.
- Migration chạy lúc boot (Render free không có pre-deploy/shell).

## Hệ quả

Ngủ sau 15 phút, cold start ~1 phút; một instance. CI phải xanh mới deploy.
