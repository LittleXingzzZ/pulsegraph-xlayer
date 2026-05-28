import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";

const root = new URL("../web", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4173);
// Bind to 0.0.0.0 by default so the demo is reachable from LAN devices
// (phone testing, OKX Wallet on another laptop, etc.). Set HOST=127.0.0.1
// to restrict back to loopback if needed.
const host = process.env.HOST ?? "0.0.0.0";

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

const server = createServer((request, response) => {
  const rawPath = decodeURIComponent(new URL(request.url ?? "/", `http://localhost:${port}`).pathname);
  const safePath = normalize(rawPath === "/" ? "/index.html" : rawPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypes.get(extname(filePath)) ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  if (host === "0.0.0.0") {
    console.log(`PulseGraph demo listening on 0.0.0.0:${port}`);
    console.log(`  Local:   http://localhost:${port}`);
    console.log(`  LAN:     http://<your-lan-ip>:${port}`);
  } else {
    console.log(`PulseGraph demo available at http://${host}:${port}`);
  }
});
