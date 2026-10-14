# Contributing

## 1. Thiết lập máy

```bash
npm install
cp .env.example .env                 # MONGODB_URI, JWT_SECRET, Cloudinary
docker compose up -d mongo           # hoặc MongoDB của bạn
npm run dev                          # http://localhost:5001, tài liệu http://localhost:5001/api-docs
npm run set-roles -- you@example.com admin,agent,member   # sau khi đăng ký
```

Chạy toàn bộ bằng Docker (giống production): `npm run docker:up`.

## 2. Trước khi commit

```bash
npm run test:db                      # MongoDB test (tmpfs, cổng 27018) – một lần
npm test                             # test tích hợp + test spec OpenAPI
npm run test:api                     # nếu đổi API: Bruno vào server đang chạy (env local)
```

Checklist (cũng có trong PR template):

- [ ] `npm test` xanh
- [ ] Đổi route → `api/openapi.yaml` + request Bruno
- [ ] Mã lỗi / env / event mới → `src/lib/errors.js` / `.env.example` + `render.yaml` / `docs/realtime.md`
- [ ] `docs/` liên quan và `CHANGELOG.md` (mục Unreleased)
- [ ] Không log hay trả password, token, secret

## 3. Quy ước code

- ESM, `async/await`, 2 dấu cách, dấu ngoặc kép; giữ phong cách file đang sửa (file cũ dùng 4 dấu cách).
- Comment tiếng Việt, ngắn, giải thích **vì sao** (không lặp lại code).
- Phân lớp và quy tắc bắt buộc: [AGENT.md](AGENT.md) §3–§4. Quy trình theo loại tác vụ: `.agents/workflows/`.
- Tên file: `<thing>.controller.js`, `<thing>.service.js`, `<thing>.model.js`, `<thing>.route.js`.
- JSON camelCase, path kebab-case, id ObjectId.

## 4. Git

- Nhánh: `feature/<tên>`, `fix/<tên>`, `chore/<tên>` từ `master`; không push thẳng `master`.
- Commit theo [Conventional Commits](https://www.conventionalcommits.org): `feat(support): ...`, `fix(message): ...`,
  `docs: ...`, `ci: ...`, `chore(deps): ...`. Thân commit giải thích vì sao.
- PR vào `master`: CI (`test` + `docker`) phải xanh; Render deploy sau khi merge.
- Thay đổi phá client cũ: ghi rõ trong PR, `CHANGELOG.md` (Breaking) và `docs/frontend-integration.md` §6.
