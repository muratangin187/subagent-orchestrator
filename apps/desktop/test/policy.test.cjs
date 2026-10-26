const { test } = require("node:test");
const assert = require("node:assert/strict");
const { origin, route, webLink } = require("../electron/policy.cjs");
test("credentials only reach HTTPS or explicit loopback origins", () => {
  assert.equal(origin("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  for (const u of [
    "http://remote.test",
    "https://user:pass@host",
    "file:///etc/passwd",
    "https://host/path",
    "https://host/?x=1",
  ])
    assert.throws(() => origin(u));
});
test("IPC cannot become arbitrary network access or arbitrary mutations", () => {
  assert.equal(route("/v1/state"), "/v1/state");
  for (const p of [
    "//evil.test/v1/state",
    "https://evil.test",
    "/v1/pair",
    "/v1/state/../../secret",
    "/v1/state#x",
  ])
    assert.throws(() => route(p));
  assert.throws(() => route("/v1/state", {}));
  assert.throws(() => route("/v1/assistant/messages"));
  assert.equal(route("/v1/assistant/messages", {}), "/v1/assistant/messages");
});
test("external links cannot execute local commands", () => {
  assert.equal(webLink("https://example.com"), "https://example.com/");
  for (const u of [
    "file:///tmp/x",
    "javascript:alert(1)",
    "vscode://file/a",
    "https://u:p@host",
  ])
    assert.throws(() => webLink(u));
});
test("microphone checks accept canonical and slash origins but deny other frames and camera", () => {
  const { microphoneCheck } = require("../electron/policy.cjs");
  for (const origin of ["workspace://app", "workspace://app/"]) {
    assert.equal(
      microphoneCheck("media", origin, {
        isMainFrame: true,
        mediaType: "audio",
      }),
      true,
    );
    assert.equal(
      microphoneCheck("media", origin, {
        isMainFrame: false,
        mediaType: "audio",
      }),
      false,
    );
    assert.equal(
      microphoneCheck("media", origin, {
        isMainFrame: true,
        mediaType: "video",
      }),
      false,
    );
  }
  assert.equal(
    microphoneCheck("media", "workspace://app", {
      securityOrigin: "https://evil.test",
    }),
    false,
  );
  assert.equal(microphoneCheck("media", "workspace://app.evil.test"), false);
  assert.equal(microphoneCheck("display-capture", "workspace://app"), false);
});

test("file downloads, limits and explicit steering are allowed through scoped IPC", () => {
  assert.equal(
    route("/v1/artifacts/open", { path: "/workspace/app.apk" }),
    "/v1/artifacts/open",
  );
  assert.equal(route("/v1/messages/steer", {}), "/v1/messages/steer");
  assert.equal(route("/v1/limits?deviceId=xps"), "/v1/limits?deviceId=xps");
  assert.equal(
    route(
      "/v1/attachments/11111111-1111-1111-1111-111111111111?offset=4194304",
    ),
    "/v1/attachments/11111111-1111-1111-1111-111111111111?offset=4194304",
  );
});

test("visual retrieval is read-only and requires a bounded identifier", () => {
  assert.equal(
    route("/v1/visuals/11111111-1111-4111-8111-111111111111"),
    "/v1/visuals/11111111-1111-4111-8111-111111111111",
  );
  assert.throws(() => route("/v1/visuals/../../secret"));
  assert.throws(() =>
    route("/v1/visuals/11111111-1111-4111-8111-111111111111", {}),
  );
});
