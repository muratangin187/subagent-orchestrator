import { test } from "node:test";
import assert from "node:assert/strict";
import { Glasses } from "../src/glasses.ts";
import type { EvenAppBridge, EvenHubEvent } from "@evenrealities/even_hub_sdk";
import { Client } from "../src/core.ts";
const until = async (f: () => boolean) => {
  const end = Date.now() + 2000;
  while (!f() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
  assert.ok(f());
};
function fixture(devices = false) {
  let handler: (e: EvenHubEvent) => void = () => {};
  const layouts: any[] = [];
  const audio: boolean[] = [];
  const exits: number[] = [];
  let posts = 0;
  const bodies: any[] = [];
  const bridge = {
    onEvenHubEvent(fn: any) {
      handler = fn;
      return () => {};
    },
    async createStartUpPageContainer(p: any) {
      layouts.push(p);
      return 0;
    },
    async rebuildPageContainer(p: any) {
      layouts.push(p);
      return true;
    },
    async textContainerUpgrade() {
      return true;
    },
    async shutDownPageContainer(mode: number) {
      exits.push(mode);
      return true;
    },
    async audioControl(open: boolean) {
      audio.push(open);
      return true;
    },
  } as unknown as EvenAppBridge;
  const client = new Client(
    "http://127.0.0.1:8787",
    "test",
    async (url: any, init: any) => {
      if (String(url).endsWith("/transcribe")) {
        posts++;
        bodies.push(JSON.parse(init.body));
        return Response.json({ commandId: "c" });
      }
      if (String(url).endsWith("/status"))
        return Response.json({ configured: true });
      return Response.json({
        tasks: [],
        inputs: [],
        ...(devices
          ? {
              defaultDeviceId: "xps",
              devices: [
                { id: "xps", name: "XPS" },
                { id: "macbook", name: "MacBook" },
              ],
            }
          : {}),
      });
    },
  );
  const notices: string[] = [];
  const g = new Glasses(
    () => client,
    (s) => notices.push(s),
    () => {},
  );
  return {
    g,
    bridge,
    layouts,
    audio,
    exits,
    notices,
    posts: () => posts,
    bodies,
    emit: (e: any) => handler(e),
  };
}
test("SDK omitted zero click selects first row; nested double back; root uses OS exit confirmation", async () => {
  const f = fixture();
  try {
    await f.g.start(f.bridge);
    f.emit({ listEvent: { currentSelectItemIndex: 2 } });
    await until(() => f.layouts.length === 2);
    assert.equal(f.layouts.at(-1).textObject[0].content, "İşler");
    f.emit({ listEvent: { eventType: 3 } });
    await until(() => f.layouts.length === 3);
    f.emit({ listEvent: { eventType: 3 } });
    await until(() => f.exits.length === 1);
    assert.equal(f.exits[0], 1);
  } finally {
    await f.g.dispose();
  }
});
test("recording background event stops mic and never submits; a new recording submits exactly once", async () => {
  const f = fixture();
  try {
    await f.g.start(f.bridge);
    await f.g.beginRecording();
    f.emit({ audioEvent: { audioPcm: new Uint8Array(3200) } });
    f.emit({ sysEvent: { eventType: 5 } });
    await until(() => f.audio.at(-1) === false);
    assert.equal(f.posts(), 0);
    f.emit({ sysEvent: { eventType: 4 } });
    await new Promise((r) => setTimeout(r, 10));
    await f.g.beginRecording();
    f.emit({ audioEvent: { audioPcm: new Uint8Array(3200) } });
    await f.g.stopRecording(true);
    await f.g.stopRecording(true);
    assert.equal(f.posts(), 1);
    assert.deepEqual(f.audio, [true, false, true, false]);
  } finally {
    await f.g.dispose();
  }
});
test("layouts stay within firmware constraints and one input container", async () => {
  const f = fixture();
  try {
    await f.g.start(f.bridge);
    await f.g.beginRecording();
    for (const p of f.layouts) {
      const objects = [...p.textObject, ...p.listObject];
      assert.equal(objects.length, 3);
      assert.equal(objects.filter((o) => o.isEventCapture === 1).length, 1);
      for (const o of objects) {
        assert.ok(o.xPosition + o.width <= 576);
        assert.ok(o.yPosition + o.height <= 288);
        assert.ok((o.content ?? "").length <= 1000);
      }
    }
  } finally {
    await f.g.dispose();
  }
});

test("glasses device selection is sent with new voice work", async () => {
  const f = fixture(true);
  try {
    await f.g.start(f.bridge);
    await f.g.refresh();
    f.emit({ listEvent: { currentSelectItemIndex: 4 } });
    await until(
      () => f.layouts.at(-1)?.textObject[0]?.content === "Çalışacağı cihaz",
    );
    f.emit({ listEvent: { currentSelectItemIndex: 1 } });
    await until(
      () => f.layouts.at(-1)?.textObject[0]?.content === "Agent Workspace",
    );
    await f.g.beginRecording();
    f.emit({ audioEvent: { audioPcm: new Uint8Array(6400) } });
    await f.g.stopRecording(true);
    assert.equal(f.bodies[0].deviceId, "macbook");
  } finally {
    await f.g.dispose();
  }
});
