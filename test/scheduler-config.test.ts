import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConcurrency } from "../src/scheduler-config.js";

test("concurrency has an explicit unlimited default and validated finite opt-in", () => {
  assert.equal(parseConcurrency(), null);
  assert.equal(parseConcurrency("unlimited"), null);
  assert.equal(parseConcurrency("4"), 4);
  assert.equal(parseConcurrency("100"), 100);
  for (const value of [
    "",
    "0",
    "-1",
    "1.5",
    "Infinity",
    "NaN",
    "null",
    "1e3",
    "9007199254740992",
  ])
    assert.throws(() => parseConcurrency(value), /positive safe integer/);
});
