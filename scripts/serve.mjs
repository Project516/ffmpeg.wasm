// Static file server for the browser tests. Sends the COOP/COEP headers the
// multithread core needs for SharedArrayBuffer, which http-server cannot set.
// Usage: node scripts/serve.mjs [port] [--no-isolation]
// --no-isolation drops COOP/COEP so the page has no SharedArrayBuffer.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(".");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
};
const ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
const BASE_HEADERS = {
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

export const serve = (port, { isolated = true } = {}) => {
  const HEADERS = isolated ? { ...ISOLATION, ...BASE_HEADERS } : BASE_HEADERS;
  return createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    let file = join(ROOT, path);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403, HEADERS).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      await stat(file);
    } catch {
      res.writeHead(404, HEADERS).end();
      return;
    }
    res.writeHead(200, {
      ...HEADERS,
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  }).listen(port);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 3000);
  const isolated = !process.argv.includes("--no-isolation");
  serve(port, { isolated }).on("listening", () =>
    console.log(`serving ${ROOT} on http://localhost:${port} (isolated: ${isolated})`)
  );
}
