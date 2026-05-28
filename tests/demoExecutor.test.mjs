import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("PulseHookDemoExecutor exposes the chain evidence actions judges need", () => {
  assert.equal(existsSync("contracts/PulseHookDemoExecutor.sol"), true);
  const source = readFileSync("contracts/PulseHookDemoExecutor.sol", "utf8");

  for (const symbol of [
    "PulseHookDemoExecutor",
    "initializePool",
    "addLiquidity",
    "swapExactInput",
    "unlockCallback",
    "DemoPoolInitialized",
    "DemoLiquidityAdded",
    "DemoSwap"
  ]) {
    assert.ok(source.includes(symbol), `PulseHookDemoExecutor.sol should include ${symbol}`);
  }
});

test("PulseHookDemoToken is a local ERC20-style demo asset", () => {
  assert.equal(existsSync("contracts/PulseHookDemoToken.sol"), true);
  const source = readFileSync("contracts/PulseHookDemoToken.sol", "utf8");

  for (const symbol of ["PulseHookDemoToken", "transfer", "approve", "transferFrom", "balanceOf"]) {
    assert.ok(source.includes(symbol), `PulseHookDemoToken.sol should include ${symbol}`);
  }
});
