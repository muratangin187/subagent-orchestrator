import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Store } from "../src/store.js";
import {
  initVisuals,
  previewVisual,
  publishVisual,
  visualDocument,
} from "../src/workspace/visuals.js";
import type { Task } from "../src/types.js";

test("visuals enforce bounded self-contained documents", () => {
  assert.throws(() => visualDocument("x".repeat(512001)));
  assert.throws(() => visualDocument("<style>main{height:100vh}</style>"));
  assert.match(visualDocument("<p>Merhaba</p>"), /connect-src 'none'/);
});
test("visual preview validates both sizes and binds publication to exact HTML and task", async () => {
  const store = new Store(":memory:");
  initVisuals(store);
  const task = { id: "visual-test", runId: "run" } as Task;
  store.db
    .prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?)")
    .run(task.id, "test", null, "completed", Date.now(), "{}");
  const html = readFileSync(
    new URL("../examples/visuals/solar-system.html", import.meta.url),
    "utf8",
  );
  try {
    const p = await previewVisual(store, task, html);
    assert.equal(p.ok, true, JSON.stringify(p.errors));
    assert.equal(p.screenshots.length, 2);
    assert.deepEqual(
      p.measurements.map((m) => m.width),
      [375, 728],
    );
    const input = {
      html,
      title: "Güneş",
      previewId: p.previewId!,
      clientRequestId: "publish",
    };
    assert.throws(() => publishVisual(store, { ...task, id: "other" }, input));
    assert.throws(() =>
      publishVisual(store, task, { ...input, html: html + " " }),
    );
    const result = publishVisual(store, task, input);
    assert.ok(result.htmlRender.id);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM visual_documents").get()!.n,
      1,
    );
    const bad = await previewVisual(
      store,
      task,
      '<script>throw Error("broken")</script>',
    );
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => e.includes("broken")));
  } finally {
    store.db.close();
  }
});

test("solar and chart controls work at both sizes inside an opaque sandbox", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [375, 728]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      for (const example of ["solar-system", "charts"]) {
        const html = visualDocument(
          readFileSync(
            new URL(`../examples/visuals/${example}.html`, import.meta.url),
            "utf8",
          ),
        );
        await page.setContent(
          '<iframe sandbox="allow-scripts" style="width:100%;height:850px;border:0"></iframe>',
        );
        await page.locator("iframe").evaluate((frame, html) => {
          (frame as HTMLIFrameElement).srcdoc = html;
        }, html);
        const f = page.frameLocator("iframe");
        if (example === "solar-system") {
          await f.getByLabel("Gezegen", { exact: true }).selectOption("mars");
          assert.match(await f.locator("#detail").innerText(), /687/);
          await f.getByLabel("Geçen gün", { exact: true }).fill("687");
          assert.match(await f.locator("#detail").innerText(), /1.00/);
          await f.getByRole("button", { name: "Oynat", exact: true }).click();
          assert.equal(await f.locator("#play").innerText(), "Duraklat");
          await f.getByRole("button", { name: "Başa dön" }).click();
          assert.equal(await f.locator("#day").innerText(), "0");
        } else {
          await f.getByRole("button", { name: "Çalışma süresi" }).click();
          assert.equal(
            await f.locator("#summary").innerText(),
            "Toplam 335 dakika",
          );
          await f.locator("summary").click();
          assert.equal(await f.locator("tbody tr").count(), 5);
        }
        const security = await f.locator("body").evaluate(async () => {
          let host = false,
            network = false;
          try {
            void parent.document.body;
            host = true;
          } catch {}
          try {
            await fetch("https://example.com");
            network = true;
          } catch {}
          return {
            host,
            network,
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
          };
        });
        assert.deepEqual(security, {
          host: false,
          network: false,
          overflow: false,
        });
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
