const test = require('node:test');
const assert = require('node:assert/strict');
test('appearance survives storage and rejects malformed or inherited option names', async () => {
  const { loadAppearance, normalizeAppearance } = await import('../src/appearance.mjs');
  assert.deepEqual(loadAppearance({ getItem: () => '{broken' }), { mode: 'system', accent: 'teal' });
  assert.deepEqual(normalizeAppearance({ mode: 'constructor', accent: '__proto__' }), { mode: 'system', accent: 'teal' });
  assert.deepEqual(loadAppearance({ getItem: () => JSON.stringify({ mode: 'dark', accent: 'copper' }) }), { mode: 'dark', accent: 'copper' });
});
test('system follows OS changes while explicit theme ignores them', async () => {
  const { applyAppearance } = await import('../src/appearance.mjs');
  const root = { dataset: {} };
  applyAppearance({ mode: 'system', accent: 'rose' }, root, true);
  assert.deepEqual(root.dataset, { theme: 'dark', accent: 'rose' });
  applyAppearance({ mode: 'system', accent: 'rose' }, root, false);
  assert.equal(root.dataset.theme, 'light');
  applyAppearance({ mode: 'dark', accent: 'blue' }, root, false);
  assert.equal(root.dataset.theme, 'dark');
});
