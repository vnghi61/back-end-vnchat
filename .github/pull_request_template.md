# Pull request

## Mô tả

Thay đổi gì và vì sao.

## Loại thay đổi

- [ ] feat
- [ ] fix
- [ ] docs / ci / chore
- [ ] **Breaking** (phá client hoặc API cũ) – đã ghi trong `CHANGELOG.md` và `docs/frontend-integration.md` §6

## Definition of Done

- [ ] `npm test` xanh (test tích hợp + test spec)
- [ ] Đổi route → `api/openapi.yaml` + request Bruno trong `api-tests/bruno`
- [ ] Mã lỗi / env / realtime event / webhook event mới đã ghi vào `src/lib/errors.js` · `.env.example` + `render.yaml` · `docs/realtime.md` · `docs/webhooks.md`
- [ ] `docs/` liên quan, `MODULE_INDEX.md` (nếu thêm file), `CHANGELOG.md` (Unreleased)
- [ ] Không log hay trả password, token, secret, raw API key
- [ ] Biến môi trường mới đã thêm tay trên Render Dashboard (Blueprint không cập nhật biến `sync: false`)
