import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DEMO_LIQUIDITY,
  DEFAULT_NORMAL_SWAP_AMOUNT,
  DEFAULT_VOLATILE_SWAP_AMOUNT,
  buildDemoSequence
} from "../scripts/run-demo-sequence.mjs";

test("buildDemoSequence covers initialize, liquidity, normal swap, and volatile swap", () => {
  const steps = buildDemoSequence();

  assert.deepEqual(
    steps.map((step) => step.name),
    ["initializePool", "addLiquidity", "normalSwap", "volatileSwap"]
  );
  assert.equal(steps[1].args[0], DEFAULT_DEMO_LIQUIDITY);
  assert.deepEqual(steps[2].args, [true, DEFAULT_NORMAL_SWAP_AMOUNT]);
  assert.deepEqual(steps[3].args, [false, DEFAULT_VOLATILE_SWAP_AMOUNT]);
});

test("buildDemoSequence can target one evidence step at a time", () => {
  assert.deepEqual(
    buildDemoSequence({ onlyStep: "initializePool" }).map((step) => step.name),
    ["initializePool"]
  );
  assert.deepEqual(
    buildDemoSequence({ onlyStep: "addLiquidity" }).map((step) => step.name),
    ["addLiquidity"]
  );
});
