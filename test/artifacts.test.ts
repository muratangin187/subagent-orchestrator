import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  readArtifact,
  artifactPath,
  artifactLimit,
} from "../src/workspace/artifacts.js";
test("artifact readers preserve unicode, resolve file URLs, and bound workspace reads", () => {
  const root = mkdtempSync(join(tmpdir(), "artifact-"));
  try {
    const file = join(root, "Türkçe rapor.html");
    writeFileSync(file, "<h1>Özet</h1>");
    assert.equal(
      Buffer.from(
        readArtifact(pathToFileURL(file).href, root).content!,
        "base64",
      ).toString(),
      "<h1>Özet</h1>",
    );
    assert.equal(artifactPath(encodeURI(file)), file);
    assert.deepEqual(readArtifact(join(root, "missing.pdf"), root), {
      missing: true,
    });
    assert.deepEqual(readArtifact("/outside/report.pdf", root), {
      missing: true,
    });
    assert.throws(() => artifactPath("https://example.com/file.pdf"));
    assert.throws(() => artifactPath("file://remote/report.pdf"));
    assert.throws(() => readArtifact(join(root, ".secret.json"), root));
    assert.throws(() => readArtifact(join(root, "run.exe"), root));
    symlinkSync("/etc/passwd", join(root, "secret.txt"));
    assert.throws(() => readArtifact(join(root, "secret.txt"), root));
    mkdirSync(join(root, "folder.txt"));
    assert.throws(() => readArtifact(join(root, "folder.txt"), root));
    writeFileSync(join(root, "large.txt"), Buffer.alloc(artifactLimit + 1));
    assert.throws(() => readArtifact(join(root, "large.txt"), root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
