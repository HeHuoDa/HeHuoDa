import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

/** 静态预览与生产回退契约一致；不启动、不代理旧 Web，也不伪造 API。 */
export function createH5Preview(directory) {
  const root = resolve(directory);
  return createServer(async (request, response) => {
    const missing = () => {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    };
    try {
      const path = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      if (/^\/api(?:\/|$)/.test(path)) return missing();
      const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
      if (!file.startsWith(root + sep)) return missing();
      let data;
      let extension = extname(file);
      try {
        data = await readFile(file);
      } catch {
        if (extension || /^\/(?:assets|static)(?:\/|$)/.test(path))
          return missing();
        data = await readFile(resolve(root, "index.html"));
        extension = ".html";
      }
      response.writeHead(200, {
        "Content-Type": types[extension] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : data);
    } catch {
      missing();
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../dist/build/h5", import.meta.url));
  const port = Number(process.env.PORT || 5176);
  createH5Preview(root).listen(port, "127.0.0.1", () =>
    console.info(`uni H5 preview: http://127.0.0.1:${port}`),
  );
}
