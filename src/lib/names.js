// Chuẩn hoá tên để tìm kiếm không phân biệt hoa thường / dấu tiếng Việt: "Nguyễn Đức" → "nguyen duc".
export const normalizeName = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
