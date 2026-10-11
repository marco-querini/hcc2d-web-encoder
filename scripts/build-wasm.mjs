import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "dist/assets");
await mkdir(outputDirectory, { recursive: true });

const exportedFunctions = [
  "_malloc",
  "_free",
  "_hcc2d_encode",
  "_hcc2d_result_ptr",
  "_hcc2d_result_len",
  "_hcc2d_result_width",
  "_hcc2d_result_height",
  "_hcc2d_result_version",
  "_hcc2d_result_mask",
  "_hcc2d_error_ptr",
  "_hcc2d_result_clear"
];

const args = [
  resolve(root, "src/hcc2d_wasm.c"),
  "-std=c11",
  "-O3",
  "--use-port=zlib",
  "-sMODULARIZE=1",
  "-sEXPORT_ES6=1",
  "-sENVIRONMENT=web,worker",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sFILESYSTEM=0",
  "-sASSERTIONS=0",
  `-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions)}`,
  `-sEXPORTED_RUNTIME_METHODS=${JSON.stringify(["HEAPU8"])}`,
  "-o",
  resolve(outputDirectory, "hcc2d-wasm.js")
];

const result = spawnSync("emcc", args, { cwd: root, stdio: "inherit" });
if (result.error?.code === "ENOENT") {
  console.error("emcc was not found. Activate the Emscripten SDK before building.");
  process.exit(127);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const versionedAssets = [
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
const hash = createHash("sha256");
for (const relativePath of versionedAssets) {
  hash.update(relativePath);
  hash.update(await readFile(resolve(root, "dist", relativePath)));
}
const buildVersion = hash.digest("hex").slice(0, 16);
const serviceWorkerPath = resolve(root, "dist/service-worker.js");
const serviceWorker = await readFile(serviceWorkerPath, "utf8");
if (!serviceWorker.includes("__BUILD_VERSION__")) {
  throw new Error("Service worker build-version placeholder is missing.");
}
await writeFile(
  serviceWorkerPath,
  serviceWorker.replaceAll("__BUILD_VERSION__", buildVersion),
  "utf8"
);
console.log(`Built service worker cache version ${buildVersion}`);
