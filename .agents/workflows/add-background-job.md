---
description: Thêm việc nền chạy định kỳ trong process
---

# Workflow: Add Background Job

Việc nền chạy trong `src/services/jobs.service.js` mỗi `SWEEP_INTERVAL_MS`, tuần tự, trong cùng process API
([ADR-0003](../../docs/adr/ADR-0003-single-process-jobs.md)).

1. Viết hàm trong service của tính năng, trả số bản ghi đã xử lý:
   ```js
   export async function expireThings(batch = 100) {
     const due = await Thing.find({ status: "open", expiresAt: { $lte: new Date() } }).limit(batch).lean();
     for (const t of due) {
       const won = await Thing.findOneAndUpdate({ _id: t._id, status: "open" }, { $set: { status: "expired" } }, { new: true });
       if (won) realtime.toUser(won.ownerId, "thing.expired", { thing: won });   // chỉ bên thắng CAS mới phát
     }
     return due.length;
   }
   ```
2. **Compare-and-set** mọi chuyển trạng thái → chạy chồng hay restart giữa chừng không phát trùng.
3. Đăng ký trong `runSweepOnce()` bằng `safe("<name>", fn)` (lỗi một job không chặn job khác).
4. Có index cho truy vấn quét (`status + thời điểm`).
5. Render free ngủ khi không có request → job phải xử lý được bản ghi quá hạn lâu khi thức dậy (không giả định chạy đúng giờ).
6. Test: gọi thẳng hàm (không chờ timer), sau khi chỉnh mốc thời gian trong DB; gọi lần hai phải trả 0.
7. Ghi vào bảng `docs/architecture.md` §5.
