import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LOCALES, MESSAGES } from "../web/assets/i18n.js";

const root = resolve(import.meta.dirname, "..");
const read = (path, encoding = "utf8") => readFile(resolve(root, path), encoding);

test("vendored C encoder matches the reviewed public 0.9.0 source", async () => {
  const bytes = await read("upstream/single_file_c_hcc2d_encoder_v0.9.0.c", null);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "8566a5f9c1c0521257ea9aa52b6a4eb50d711cdb4c56a087447d97dfda7e9ff1"
  );
});

test("every JavaScript ID lookup exists in the HTML", async () => {
  const [html, application] = await Promise.all([
    read("web/index.html"),
    read("web/assets/app.js")
  ]);
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const lookedUpIds = new Set([...application.matchAll(/\$\("#([A-Za-z][\w-]*)"\)/g)].map((match) => match[1]));
  const missing = [...lookedUpIds].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, []);
});

test("HTML IDs are unique", async () => {
  const html = await read("web/index.html");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("service worker cache list covers every runtime asset", async () => {
  const worker = await read("web/service-worker.js");
  const required = [
    "index.html",
    "manifest.webmanifest",
    "assets/styles.css",
    "assets/app.js",
    "assets/core.js",
    "assets/i18n.js",
    "assets/theme-bootstrap.js",
    "assets/encoder-worker.js",
    "assets/hcc2d-wasm.js",
    "assets/hcc2d-wasm.wasm",
    "assets/favicon.svg",
    "assets/icon-192.png",
    "assets/icon-512.png"
  ];
  for (const asset of required) assert.match(worker, new RegExp(asset.replaceAll(".", "\\.")));
  assert.match(worker, /__BUILD_VERSION__/);
});

test("public version label matches the package version", async () => {
  const [html, packageJson] = await Promise.all([
    read("web/index.html"),
    read("package.json").then(JSON.parse)
  ]);
  assert.equal(packageJson.version, "0.9.0");
  assert.match(html, /HCC2D Web Encoder 0\.9\.0/);
  assert.doesNotMatch(html, /Encoder 0\.9\.0 · Apache-2\.0/);
});

test("all five locales provide the complete interface message set", () => {
  assert.deepEqual(LOCALES.map(({ code }) => code), ["en", "es", "it", "ja", "zh-hans"]);
  const englishKeys = Object.keys(MESSAGES.en).sort();
  for (const { code } of LOCALES) {
    assert.deepEqual(Object.keys(MESSAGES[code]).sort(), englishKeys, `${code} message keys`);
    for (const key of englishKeys) assert.ok(MESSAGES[code][key], `${code}:${key}`);
  }
});

test("HTML translation markers reference known messages", async () => {
  const html = await read("web/index.html");
  const referenced = [...html.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(referenced.length > 60);
  for (const key of referenced) assert.ok(MESSAGES.en[key], key);
  assert.equal(html.includes(["Stu", "dio"].join("")), false);
});

test("license and browser safety controls are present", async () => {
  const [license, bridge, html] = await Promise.all([
    read("LICENSE"),
    read("src/hcc2d_wasm.c"),
    read("web/index.html")
  ]);
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(bridge, /HCC2D_WEB_MAX_OUTPUT_DIMENSION 4096/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /id="scale"[^>]+min="6"[^>]+max="64"/);
});
