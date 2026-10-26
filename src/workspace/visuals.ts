import { createHash, randomUUID } from "node:crypto";
import { chromium, type Browser } from "playwright";
import type { Store } from "../store.js";
import type { Task } from "../types.js";

export const VISUAL_INSTRUCTIONS = `When a diagram, simulation or interactive chart helps, use html_preview then html_render from standalone_children. These tools show a live interactive HTML page directly inside the user's desktop and mobile chat, not a link or code block. Write one self-contained HTML document with inline CSS/JavaScript, SVG or Canvas. No external libraries, network requests, local file paths or host APIs: all are blocked. Embed images as data URLs. Use responsive layouts at 360px and 728px, accessible buttons, readable labels, and fixed/content-based heights (no vh). Use CSS variables --background, --foreground, --muted, --accent, --border; leave the outer background transparent. Interactions only update the page; they cannot message the agent or execute tools. Label sample data and simplified simulations honestly. Preview returns screenshots, console errors and measured heights for mobile and desktop. Inspect them, fix errors and overflow, then publish the exact HTML with previewId and a stable clientRequestId. Publication creates a durable chat item in YOUR conversation. Do not claim publication in the parent chat. After publication give only a short useful conclusion; do not repeat the visual as text. Small visual answers may be authored directly by the assistant; repository implementation work still belongs to children.`;
export const VISUAL_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function visualDocument(html: string) {
  if (Buffer.byteLength(html) > 512_000) throw Error("HTML exceeds 500 KiB");
  if (/\b\d+(?:\.\d+)?(?:s|l|d)?vh\b/i.test(html))
    throw Error("Use content or pixel heights, not viewport heights");
  // The policy is first and cannot be relaxed by another CSP in the authored page.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${VISUAL_CSP}"><style>:root{color-scheme:light dark;--background:#fff;--foreground:#202523;--muted:#58645e;--accent:#197e70;--border:#cdd6d0;font-family:system-ui} @media(prefers-color-scheme:dark){:root{--background:#171a19;--foreground:#edf1ef;--muted:#a9b4af;--accent:#79cec0;--border:#48544d}}*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--foreground)}button,input,select{font:inherit}img,svg,canvas{max-width:100%}</style><script>for(const name of ['RTCPeerConnection','webkitRTCPeerConnection']){try{Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false})}catch{}}addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='workspace-theme')return;for(const name of ['background','foreground','muted','accent','border']){const value=e.data.colors?.[name];if(typeof value==='string'&&CSS.supports('color',value))document.documentElement.style.setProperty('--'+name,value)}if(['light','dark'].includes(e.data.scheme))document.documentElement.style.colorScheme=e.data.scheme});</script></head><body>${html}</body></html>`;
}
export function initVisuals(store: Store) {
  store.db
    .exec(`CREATE TABLE IF NOT EXISTS visual_previews(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,hash TEXT NOT NULL,measurements TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS visual_documents(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,title TEXT NOT NULL,html TEXT NOT NULL,measurements TEXT NOT NULL);`);
}
const hash = (html: string) => createHash("sha256").update(html).digest("hex");
let busy = false;
export async function previewVisual(store: Store, task: Task, html: string) {
  if (busy) throw Error("Another HTML preview is running; retry shortly");
  const preparedHtml = visualDocument(html);
  busy = true;
  let browser: Browser | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: process.platform === "linux",
      timeout: 15000,
    });
    deadline = setTimeout(() => {
      void browser?.close();
    }, 30000);
    const context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
      colorScheme: "dark",
    });
    await context.route("**/*", (route) =>
      route.request().url() === "https://visual.invalid/page" &&
      route.request().isNavigationRequest()
        ? route.fulfill({
            body: preparedHtml,
            contentType: "text/html",
            headers: {
              "Content-Security-Policy": VISUAL_CSP + "; sandbox allow-scripts",
            },
          })
        : route.abort(),
    );
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript(() => {
      delete (window as any).RTCPeerConnection;
      delete (window as any).webkitRTCPeerConnection;
    });
    const measurements = [],
      screenshots = [],
      errors: string[] = [];
    for (const width of [375, 728]) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 600 });
      page.on("pageerror", (e) => {
        if (errors.length < 20) errors.push(e.message.slice(0, 500));
      });
      page.on("dialog", (d) => void d.dismiss());
      await page.goto("https://visual.invalid/page", {
        waitUntil: "load",
        timeout: 10000,
      });
      await page.evaluate(() => document.fonts.ready);
      const size = await page.evaluate(() => ({
        height: Math.max(
          document.body.scrollHeight,
          document.body.getBoundingClientRect().height,
        ),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      }));
      measurements.push({
        width,
        height: Math.min(1600, Math.max(160, Math.ceil(size.height))),
        overflow: size.overflow,
      });
      await page.setViewportSize({
        width,
        height: Math.min(1600, Math.max(160, Math.ceil(size.height))),
      });
      screenshots.push({
        width,
        mimeType: "image/png",
        data: (await page.screenshot({ timeout: 5000 })).toString("base64"),
      });
      await page.close();
    }
    if (errors.length || measurements.some((m) => m.overflow))
      return {
        ok: false,
        errors,
        measurements,
        screenshots,
        message: "Fix script errors or horizontal overflow before publishing.",
      };
    const previewId = randomUUID();
    store.db
      .prepare("DELETE FROM visual_previews WHERE created < ?")
      .run(Date.now() - 86400000);
    store.db
      .prepare("INSERT INTO visual_previews VALUES(?,?,?,?,?)")
      .run(
        previewId,
        task.id,
        hash(html),
        JSON.stringify(measurements),
        Date.now(),
      );
    return {
      ok: true,
      previewId,
      measurements,
      errors,
      screenshots,
      message:
        "Inspect both screenshots; publish this exact HTML using html_render.",
    };
  } finally {
    clearTimeout(deadline);
    try {
      await browser?.close();
    } finally {
      busy = false;
    }
  }
}
export function publishVisual(
  store: Store,
  task: Task,
  input: {
    html: string;
    title: string;
    previewId: string;
    clientRequestId: string;
  },
) {
  const p = store.db
    .prepare(
      "SELECT hash,measurements FROM visual_previews WHERE id=? AND task_id=?",
    )
    .get(input.previewId, task.id) as
    { hash: string; measurements: string } | undefined;
  if (!p || p.hash !== hash(input.html))
    throw Error(
      "Preview this exact HTML in this conversation before publishing",
    );
  const document = visualDocument(input.html),
    id = randomUUID();
  const reference = {
    id,
    title: input.title,
    measurements: JSON.parse(p.measurements),
  };
  store.db
    .prepare("INSERT INTO visual_documents VALUES(?,?,?,?,?)")
    .run(id, task.id, input.title, document, p.measurements);
  store.event(task, "html_render", reference);
  return {
    htmlRender: reference,
    message:
      "Shown inline in this conversation on desktop and mobile. Do not repeat its contents in your final reply.",
  };
}
