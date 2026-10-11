import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";

const directory = resolve(process.argv[2] || "dist");
const port = Number(process.env.PORT || 8080);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json"
};

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

createServer((request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { ...securityHeaders, "Allow": "GET, HEAD" }).end("Method not allowed");
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const requestedPath = normalize(pathname).replace(/^([/\\])+/, "") || "index.html";
    let target = resolve(directory, requestedPath);
    const pathFromRoot = relative(directory, target);
    if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
      response.writeHead(403, securityHeaders).end("Forbidden");
      return;
    }
    if (statSync(target).isDirectory()) target = join(target, "index.html");
    response.writeHead(200, {
      ...securityHeaders,
      "Content-Type": types[extname(target)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404, securityHeaders).end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`HCC2D Web Encoder: http://127.0.0.1:${port}`);
});
