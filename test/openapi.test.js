// api/openapi.yaml phải khớp 100% route thật (giống CI "docs lệch code" của chat-platform):
// thêm/sửa/xoá route mà quên spec → test fail.

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import YAML from "yaml";

const METHODS = ["get", "post", "put", "patch", "delete"];
let spec;
let routes;

before(async () => {
  process.env.JWT_SECRET ??= "test";
  const { API_ROUTERS } = await import("../src/app.js");
  spec = YAML.parse(fs.readFileSync(new URL("../api/openapi.yaml", import.meta.url), "utf8"));
  routes = new Set();
  for (const [prefix, router] of API_ROUTERS) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const path = (prefix + (layer.route.path === "/" ? "" : layer.route.path)).replace(/:(\w+)/g, "{$1}");
      for (const [method, on] of Object.entries(layer.route.methods)) {
        if (on && METHODS.includes(method)) routes.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }
});

const specOperations = () => {
  const ops = new Set();
  for (const [path, item] of Object.entries(spec.paths)) {
    if (path.startsWith("/health")) continue;
    for (const m of METHODS) if (item[m]) ops.add(`${m.toUpperCase()} ${path}`);
  }
  return ops;
};

describe("api/openapi.yaml", () => {
  it("documents every route", () => {
    const ops = specOperations();
    const missing = [...routes].filter((r) => !ops.has(r)).sort();
    assert.deepEqual(missing, [], `routes missing from api/openapi.yaml:\n${missing.join("\n")}`);
  });

  it("documents no route that does not exist", () => {
    const extra = [...specOperations()].filter((r) => !routes.has(r)).sort();
    assert.deepEqual(extra, [], `api/openapi.yaml has operations without a route:\n${extra.join("\n")}`);
  });

  it("every $ref resolves and every path parameter is declared", () => {
    const resolve = (ref) => ref.replace(/^#\//, "").split("/").reduce((node, key) => node?.[key], spec);
    const broken = [];
    const walk = (node, where) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}[${i}]`));
      if (!node || typeof node !== "object") return;
      if (typeof node.$ref === "string" && resolve(node.$ref) === undefined) broken.push(`${where}: ${node.$ref}`);
      for (const [k, v] of Object.entries(node)) walk(v, `${where}.${k}`);
    };
    walk(spec, "spec");
    assert.deepEqual(broken, []);

    const undeclared = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      const names = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const m of METHODS) {
        if (!item[m]) continue;
        const params = [...(item.parameters ?? []), ...(item[m].parameters ?? [])]
          .map((p) => (p.$ref ? resolve(p.$ref) : p))
          .filter((p) => p.in === "path")
          .map((p) => p.name);
        for (const n of names) if (!params.includes(n)) undeclared.push(`${m.toUpperCase()} ${path} {${n}}`);
      }
    }
    assert.deepEqual(undeclared, []);
  });
});
