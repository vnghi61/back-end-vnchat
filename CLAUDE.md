# CLAUDE.md

**→ Đọc [AGENT.md](AGENT.md). Đó là nguồn sự thật duy nhất cho mọi AI assistant.**

File này tồn tại vì Claude Code tự tìm nó. Không chép nội dung AGENT.md vào đây.

## Ghi chú riêng cho Claude

| Tình huống | Cách làm |
| :--- | :--- |
| Tìm kiếm rộng, chỉ đọc | Subagent dùng để *tìm*; việc *viết* làm ở luồng chính để giữ quy tắc trong ngữ cảnh |
| Sửa file | Ưu tiên `Edit` thay vì viết lại cả file |
| Cần Mongo để test | `npm run test:db` rồi `npm test` |
| Chờ server/container | Dùng `docker compose up --wait` hoặc `curl --retry`, không vòng lặp `sleep` |
| Trước khi kết thúc | `npm test` xanh, cập nhật `api/openapi.yaml` + Bruno nếu đổi API, cập nhật `docs/` + `CHANGELOG.md` |

## Ba quy tắc hay bị phá nhất

1. Viết route trước khi sửa `api/openapi.yaml` → `test/openapi.test.js` sẽ fail.
2. Trả lỗi bằng `res.status(4xx).json(...)` tự chế thay vì `throw Errors.xxx()` → mất mã `CHAT-xxx`.
3. Emit Socket.IO trực tiếp hoặc thêm state trong bộ nhớ mà quên rằng hệ thống chỉ chạy một instance.
