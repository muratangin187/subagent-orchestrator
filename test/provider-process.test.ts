import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcProcess } from "../src/providers/process.js";
const limit = 8 * 1024 * 1024;
const exact = (bytes: number) => {
  const empty = JSON.stringify({ method: "fixture", params: "" });
  return Buffer.from(
    JSON.stringify({
      method: "fixture",
      params: "x".repeat(bytes - Buffer.byteLength(empty)),
    }),
  );
};
async function check(
  chunks: Buffer[],
  count: number,
  failure?: RegExp,
  eof = false,
) {
  const rpc = new RpcProcess(process.execPath, [
    "-e",
    "process.stdin.resume()",
  ]);
  const messages: any[] = [],
    errors: Error[] = [];
  rpc.on("notification", (m) => messages.push(m));
  rpc.on("failure", (e) => errors.push(e));
  try {
    for (const chunk of chunks) rpc.child.stdout.emit("data", chunk);
    if (eof) rpc.child.stdout.emit("end");
    assert.equal(messages.length, count);
    if (failure) {
      assert.equal(errors.length, 1);
      assert.match(errors[0]!.message, failure);
    } else assert.equal(errors.length, 0);
    return messages;
  } finally {
    await rpc.close();
  }
}
for (const size of [limit - 1, limit])
  test(`accept ${size} byte line excluding LF`, async () => {
    await check([Buffer.concat([exact(size), Buffer.from("\n")])], 1);
  });
test("oversize unterminated frame fails immediately, later frames are not dispatched", async () => {
  await check(
    [exact(limit + 1), Buffer.from('\n{"method":"later"}\n')],
    0,
    /exceeds 8 MiB/,
  );
});
test("multiple valid frames may exceed limit in one callback", async () => {
  await check(
    [
      Buffer.concat([
        exact(limit / 2),
        Buffer.from("\n"),
        exact(limit / 2),
        Buffer.from("\n"),
      ]),
    ],
    2,
  );
});
test("chunk alignment cannot change near-limit framing", async () => {
  const bytes = Buffer.concat([
    exact(limit - 10),
    Buffer.from("\n"),
    exact(100),
    Buffer.from("\n"),
  ]);
  for (const offset of [0, 1, 32, 65535]) {
    const chunks = offset ? [bytes.subarray(0, offset)] : [];
    for (let i = offset; i < bytes.length; i += 65536)
      chunks.push(bytes.subarray(i, i + 65536));
    await check(chunks, 2);
  }
});
test("UTF8 codepoints split into single bytes survive decoding", async () => {
  const message = Buffer.from('{"method":"fixture","params":"İ🙂漢"}\r\n');
  const output = await check(
    Array.from(message, (b) => Buffer.from([b])),
    1,
  );
  assert.equal(output[0].params, "İ🙂漢");
});
test("UTF8 size is bytes, not JS string length", async () => {
  await check(
    [
      Buffer.from(
        JSON.stringify({ method: "fixture", params: "ü".repeat(limit / 2) }) +
          "\n",
      ),
    ],
    0,
    /exceeds 8 MiB/,
  );
});
test("EOF refuses truncated or unterminated JSON rather than silently succeeding", async () => {
  for (const text of ['{"method":', '{"method":"complete-but-no-LF"}'])
    await check([Buffer.from(text)], 0, /Incomplete provider frame/, true);
  await check([Buffer.from('{"method":"ok"}\n')], 1, undefined, true);
});
test("malformed JSON error is redacted and stops the current callback", async () => {
  const rpc = new RpcProcess(process.execPath, [
    "-e",
    "process.stdin.resume()",
  ]);
  let error = "";
  let count = 0;
  rpc.on("failure", (e) => (error = e.message));
  rpc.on("notification", () => count++);
  try {
    rpc.child.stdout.emit(
      "data",
      Buffer.from('SECRET_INVALID\n{"method":"later"}\n'),
    );
    assert.match(error, /Invalid provider frame/);
    assert.ok(!error.includes("SECRET"));
    assert.equal(count, 0);
  } finally {
    await rpc.close();
  }
});
test("stderr flood is bounded, separate from stdout, and never included in failures", async () => {
  const rpc = new RpcProcess(process.execPath, [
    "-e",
    "process.stdin.resume()",
  ]);
  let error = "";
  rpc.on("failure", (e) => (error = e.message));
  try {
    rpc.child.stderr.emit("data", Buffer.from("SECRET".repeat(2_000_000)));
    assert.ok(Buffer.byteLength((rpc as any).stderr) <= 4000);
    rpc.child.stdout.emit("data", Buffer.from("bad\n"));
    assert.ok(!error.includes("SECRET"));
  } finally {
    await rpc.close();
  }
});
test("pending requests reject once on incomplete EOF", async () => {
  const rpc = new RpcProcess(process.execPath, [
    "-e",
    "process.stdin.resume()",
  ]);
  let failures = 0;
  rpc.on("failure", () => failures++);
  try {
    const pending = rpc.request("test", {});
    const rejected = assert.rejects(pending, /Incomplete provider frame/);
    rpc.child.stdout.emit("data", Buffer.from("{"));
    rpc.child.stdout.emit("end");
    rpc.child.stdout.emit("end");
    await rejected;
    assert.equal(failures, 1);
  } finally {
    await rpc.close();
  }
});
test("actual pipe drains stdout and reports incomplete EOF before exit", async () => {
  const rpc = new RpcProcess(process.execPath, [
    "-e",
    `process.stderr.write('diagnostic');process.stdout.write('{"id":1');`,
  ]);
  const failure = new Promise<Error>((resolve) => rpc.once("failure", resolve));
  try {
    assert.match((await failure).message, /Incomplete provider frame/);
  } finally {
    await rpc.close();
  }
});

test("oversize image-shaped line in tiny chunks remains bounded", async () => {
  const payload = Buffer.from(
    JSON.stringify({
      method: "image",
      params: "data:image/png;base64," + "A".repeat(limit),
    }) + "\n",
  );
  const chunks: Buffer[] = [];
  for (let i = 0; i < payload.length; i += 1024)
    chunks.push(payload.subarray(i, i + 1024));
  await check(chunks, 0, /exceeds 8 MiB/);
});
