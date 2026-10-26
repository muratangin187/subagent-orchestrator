import { createServer } from "node:http";
/** Compatibility endpoint only. No local engine or second assistant is started. */
export async function startProxy(target: string, port: number) {
  const origin = new URL(target);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/"
  )
    throw Error("HTTPS coordinator origin required");
  const server = createServer(async (req, res) => {
    try {
      const parts: Buffer[] = [];
      let size = 0;
      for await (const p of req) {
        size += p.length;
        if (size > 8 * 1024 * 1024) {
          res.writeHead(413).end();
          return;
        }
        parts.push(p);
      }
      const url = new URL(req.url ?? "/", origin);
      if (url.origin !== origin.origin || !url.pathname.startsWith("/v1/")) {
        res.writeHead(404).end();
        return;
      }
      const headers: Record<string, string> = {};
      for (const key of [
        "authorization",
        "content-type",
        "origin",
        "access-control-request-method",
        "access-control-request-headers",
      ]) {
        const v = req.headers[key];
        if (typeof v === "string") headers[key] = v;
      }
      const r = await fetch(url, {
        method: req.method,
        headers,
        body: req.method === "POST" ? Buffer.concat(parts) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(65000),
      });
      for (const key of [
        "content-type",
        "access-control-allow-origin",
        "access-control-allow-methods",
        "access-control-allow-headers",
        "vary",
      ]) {
        const v = r.headers.get(key);
        if (v) res.setHeader(key, v);
      }
      res.setHeader("Cache-Control", "no-store");
      res.writeHead(r.status);
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "XPS coordinator unavailable. A sent operation may still be running; do not replay it blindly.",
        }),
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
