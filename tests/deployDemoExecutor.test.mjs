import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_DEMO_TOKEN_SUPPLY, buildDemoExecutorDeployArgs } from "../scripts/deploy-demo-executor.mjs";

test("buildDemoExecutorDeployArgs uses pool manager, hook address, and token supply", () => {
  const args = buildDemoExecutorDeployArgs({
    poolManager: "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
    hookAddress: "0x0f307dc905592fbef047b8dddcc50f9415b286c0",
    tokenSupply: "123"
  });

  assert.deepEqual(args, [
    "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
    "0x0f307dc905592fbef047b8dddcc50f9415b286c0",
    123n
  ]);
});

test("buildDemoExecutorDeployArgs defaults to a million 18-decimal demo tokens", () => {
  assert.equal(DEFAULT_DEMO_TOKEN_SUPPLY, 1_000_000_000_000_000_000_000_000n);
});
