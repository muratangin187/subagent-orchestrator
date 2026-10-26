const { test } = require('node:test');
const assert = require('node:assert/strict');

test('paste and drop files deduplicate files/items and preserve text-only paste', async () => {
  const { transferredFiles } = await import('../src/attachment-input.mjs');
  const f = { name: 'a.png' };
  const item = { kind: 'file', getAsFile: () => f };
  assert.deepEqual(transferredFiles({ files: [f], items: [item] }), [f]);
  assert.deepEqual(transferredFiles({ items: [item] }), [f]);
  assert.deepEqual(transferredFiles({ items: [{ kind: 'string' }] }), []);
  assert.deepEqual(transferredFiles(null), []);
});

test('attachment input enforces the server limits and gives clipboard images extensions', async () => {
  const { validateAttachments, MAX_ATTACHMENT_BYTES } = await import('../src/attachment-input.mjs');
  const image = { name: 'clipboard', type: 'image/png', size: 8 };
  assert.match(validateAttachments([image], 4)[0], /\.png$/);
  assert.throws(() => validateAttachments([image], 5), /5 dosya/);
  assert.throws(() => validateAttachments([{ ...image, size: MAX_ATTACHMENT_BYTES + 1 }], 0), /5 MiB/);
  assert.throws(() => validateAttachments([{ ...image, size: 0 }], 0), /boş/);
  assert.throws(() => validateAttachments([{ name: 'bad.exe', type: '', size: 8 }], 0), /desteklenmeyen/);
  assert.deepEqual(validateAttachments([{ name: 'a.PDF', type: '', size: 8 }], 0), ['a.PDF']);
});
