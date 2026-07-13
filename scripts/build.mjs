import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist", "server");

await rm(resolve(root, "dist"), { recursive: true, force: true });
await mkdir(output, { recursive: true });

const files = {
  "/": {
    body: await readFile(resolve(root, "index.html"), "utf8"),
    type: "text/html; charset=utf-8",
  },
  "/index.html": {
    body: await readFile(resolve(root, "index.html"), "utf8"),
    type: "text/html; charset=utf-8",
  },
  "/styles.css": {
    body: await readFile(resolve(root, "styles.css"), "utf8"),
    type: "text/css; charset=utf-8",
  },
  "/app.js": {
    body: await readFile(resolve(root, "app.js"), "utf8"),
    type: "text/javascript; charset=utf-8",
  },
};

const worker = `const files = ${JSON.stringify(files)};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const file = files[url.pathname];

    if (!file) {
      return new Response("No encontrado", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response(file.body, {
      headers: {
        "content-type": file.type,
        "cache-control": url.pathname === "/" || url.pathname === "/index.html"
          ? "no-cache"
          : "public, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  },
};
`;

await writeFile(resolve(output, "index.js"), worker, "utf8");
console.log("Sitio preparado en dist/server/index.js");
