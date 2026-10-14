# ADR-0006: OpenAPI là hợp đồng, test chặn lệch

- Trạng thái: Accepted · 2026-10-14

## Bối cảnh

fluentra viết spec trước handler (ADR-0005 của fluentra); chat-platform có CI chặn tài liệu lệch code.

## Quyết định

`api/openapi.yaml` là nguồn chính thức, hiển thị bằng Scalar ở `/api-docs`. `test/openapi.test.js` so spec với bảng
`API_ROUTERS` (route thật) – thiếu/thừa route, `$ref` hỏng, path param chưa khai báo đều fail. Bộ Bruno
(`api-tests/bruno`) là ví dụ chạy được, CI chạy trên image Docker.

## Hệ quả

Đổi route phải sửa spec cùng commit. Schema body/response chưa được kiểm tra tự động (chỉ path + method) – review thủ công.
