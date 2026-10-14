# AGENTS.md

**→ Đọc [AGENT.md](AGENT.md). Đó là nguồn sự thật duy nhất cho mọi AI assistant.**

File này dành cho các tool tìm `AGENTS.md` (Codex, Cursor...). Không chép nội dung vào đây.

## Tối thiểu phải biết trước khi sửa

1. Node 20+ ESM · Express 5 · Mongoose 8 · Socket.IO 4 · Cloudinary. Một process, một instance.
2. Đọc `AGENT.md` → `MODULE_INDEX.md` → đúng file trong `src/`. Không quét toàn repo.
3. Route mới: `src/routes/*` + `api/openapi.yaml` + test; `test/openapi.test.js` chặn lệch.
4. Lỗi qua `src/lib/errors.js` (`CHAT-xxx-yyy`); input qua zod (`src/lib/validate.js`); JSON qua `src/lib/serializers.js`.
5. Gửi tin luôn qua `src/services/message.service.js`; realtime qua `src/services/realtime.service.js`.
6. Xong việc: `npm test` (cần MongoDB, xem `docs/testing.md`), cập nhật `docs/` và `CHANGELOG.md`.
