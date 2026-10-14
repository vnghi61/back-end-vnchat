---
description: Viết test và xác minh thay đổi
---

# Workflow: Testing

Chi tiết hạ tầng: [docs/testing.md](../../docs/testing.md).

1. Bật MongoDB test: `npm run test:db` (dừng: `npm run test:db:stop`).
2. Viết test trong file theo phạm vi (bảng ở docs/testing.md §1). Mẫu:
   ```js
   it("only the owner can rename", async () => {
     const res = await bob.api.patch(`/api/conversations/${group._id}`, { title: "x" });
     assert.equal(res.status, 403);
     assert.equal(res.body.code, "CHAT-403-004");
   });
   ```
3. Bao phủ: đường thành công, quyền (403 + `code`), validation (400), trạng thái/race (409, `Promise.all`), realtime (`waitFor`), không rò dữ liệu (người ngoài không nhận event / không đọc được).
4. Không gọi dịch vụ thật: Cloudinary đã giả lập trong `setup()`; webhook dùng receiver `http.createServer` trên 127.0.0.1.
5. Việc nền: gọi thẳng hàm job sau khi chỉnh thời gian trong DB.
6. Chạy: `node --test test/<file>.test.js` khi viết, `npm test` trước khi commit.
7. Đổi API: cập nhật `api/openapi.yaml` + request Bruno; chạy `npm run test:api` với server local (`npm run dev` hoặc `npm run docker:up`).
8. Không commit test bị `skip`/`only`.
