---
description: Quy trình thêm API endpoint mới end-to-end
---

# Workflow: Add API Endpoint

> Đọc [AGENT.md](../../AGENT.md) §3–§4 trước. Endpoint chạm auth/session/API key → đọc thêm [docs/auth.md](../../docs/auth.md).

## Bước 1 – Xác định endpoint

- **Path**: kebab-case, resource số nhiều, dưới prefix có sẵn (`/api/conversations/:id/...`). Router mới → thêm vào
  `API_ROUTERS` trong `src/app.js` (bảng mount duy nhất).
- **Ai được gọi** (middleware gắn ở route, không ở controller):
  - public: không middleware (chỉ signup/login/widget);
  - mọi người đăng nhập (cả khách widget): `protectRoute`;
  - chỉ tài khoản đăng ký: `protectRoute, requireUser`;
  - theo policy: thêm `authorize("<obj>", "read"|"write")` – object mới → thêm vào `KNOWN_OBJECTS` (`src/lib/permissions.js`) và `docs/auth.md` §3;
  - đối tác: `requireApiKey("<scope>")`;
  - gửi tin: thêm `messageLimiter`.
- **Quyền trong hội thoại**: dùng `loadForRead` (đọc, cho phép agent với support) hoặc `loadForMember` (ghi).

## Bước 2 – Spec trước

Thêm operation vào `api/openapi.yaml` (tag, summary, params bằng `$ref` `#/components/parameters/id`, body, response,
các mã lỗi). Chạy `node --test test/openapi.test.js` – nó sẽ fail cho tới khi route tồn tại.

## Bước 3 – Controller

```js
const schema = z.object({ title: z.string().trim().min(1).max(100) });

export const renameThing = async (req, res) => {
  const body = parse(schema, req.body);                    // 400 CHAT-400-000 + fields
  const { conv, member } = await loadForMember(req.params.id, req.user);
  if (!isOwnerOrAdmin(member)) throw Errors.ownerAdminOnly();
  // ... cập nhật bằng model / service
  await touchSync(conv._id);                               // nếu client cần /sync thấy thay đổi
  realtime.toConversation(conv._id, "conversation.updated", payload);
  res.status(200).json(payload);
};
```

- Input: luôn `parse(zodSchema, ...)`; id: `toObjectId(id, Errors.xxxNotFound)`; URL hiển thị: `httpUrl` / `imageInput`.
- Lỗi: `throw Errors.*` (thêm mã mới ở `src/lib/errors.js` + `docs/api.md` §4). Express 5 tự chuyển lỗi async vào `errorHandler`.
- JSON: dùng `toMessage(s)` / `toConversation(s)` / `userBrief` từ `src/lib/serializers.js`, không trả document thô.
- Danh sách: `{items, nextCursor, hasMore}`, lấy `limit + 1` để biết `hasMore`, cursor từ `src/lib/cursor.js`.
- Logic dùng ở nhiều nơi → đưa vào `src/services/`.

## Bước 4 – Route

```js
router.patch("/:id/thing", protectRoute, requireUser, renameThing);
```

Đặt route cụ thể trước route có param cùng tiền tố (vd. `/search` trước `/:id`).

## Bước 5 – Side effect

- Realtime → [add-realtime-event.md](add-realtime-event.md). Webhook → [add-webhook-event.md](add-webhook-event.md).
- Thao tác quản trị → `audit(req, "<resource>.<action>", { targetType, targetId, metadata })`.

## Bước 6 – Test và tài liệu

1. Test tích hợp (thành công + 403/400/409) – [testing.md](testing.md).
2. Request Bruno trong folder phù hợp của `api-tests/bruno/` (kèm `tests`).
3. `npm test` xanh. Cập nhật `MODULE_INDEX.md` nếu thêm file, `docs/` liên quan, `CHANGELOG.md` (Unreleased).
