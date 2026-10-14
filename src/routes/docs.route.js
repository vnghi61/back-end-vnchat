import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Tài liệu API: Scalar (/api-docs) đọc api/openapi.yaml. Tắt bằng API_DOCS_ENABLED=false.
const specPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../api/openapi.yaml");
const SCALAR = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.71.0";

const router = express.Router();

router.get("/openapi.yaml", (req, res) => {
  res.type("application/yaml").send(fs.readFileSync(specPath, "utf8"));
});

router.get("/", (req, res) => {
  const specUrl = `${req.baseUrl}/openapi.yaml`;
  res.type("html").send(`<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VNChat API</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="${SCALAR}"></script>
    <script>
      Scalar.createApiReference("#app", { url: ${JSON.stringify(specUrl)}, persistAuth: true });
    </script>
  </body>
</html>`);
});

export default router;
