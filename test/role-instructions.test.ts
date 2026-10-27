import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VISUAL_INSTRUCTIONS } from '../src/workspace/visuals.js';
import { ASSISTANT_INSTRUCTIONS } from '../src/workspace/controller.js';
test('visual capability never forces workers to delegate implementation', () => {
  assert.doesNotMatch(VISUAL_INSTRUCTIONS, /repository implementation work still belongs to children/);
  assert.match(ASSISTANT_INSTRUCTIONS, /delegate all file edits/);
});

import { providerInstructions } from '../src/providers/instructions.js';
import type { Task } from '../src/types.js';
for (const role of ['implementation','research','review']) {
  test(`${role} worker can act directly with or without child tools`, () => {
    for (const delegation of [undefined, {command:'node',args:[]}]) {
      const prompt = providerInstructions({task:{role,depth:99} as Task,delegation});
      assert.match(prompt,/delegation is optional/);
      assert.doesNotMatch(prompt,/delegate all file edits|repository implementation work still belongs/);
      assert.match(prompt,/runtime permissions/);
    }
  });
}
