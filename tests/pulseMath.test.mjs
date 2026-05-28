import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_FEE_PIPS,
  MAX_FEE_PIPS,
  MIN_FEE_PIPS,
  OVERRIDE_FEE_FLAG,
  classifyPulsePhase,
  computeDynamicFeePips,
  computePulseIndex,
  nextTelemetry,
  scoreLiquidity,
  shouldFlagEarlyExit
} from "../web/lib/pulseMath.mjs";

test("computeDynamicFeePips keeps quiet pools at the base fee", () => {
  assert.equal(computeDynamicFeePips({ pressureBps: 0, emaNotional: 0 }), BASE_FEE_PIPS);
});

test("computeDynamicFeePips raises fees as pressure rises and caps at max", () => {
  const warm = computeDynamicFeePips({ pressureBps: 850, emaNotional: 75_000n });
  const hot = computeDynamicFeePips({ pressureBps: 20_000, emaNotional: 10_000_000n });

  assert.ok(warm > BASE_FEE_PIPS);
  assert.equal(hot, MAX_FEE_PIPS);
});

test("computeDynamicFeePips never falls below the minimum fee", () => {
  assert.equal(computeDynamicFeePips({ pressureBps: -100, emaNotional: 0 }), BASE_FEE_PIPS);
  assert.ok(MIN_FEE_PIPS < BASE_FEE_PIPS);
});

test("dynamic fee override includes Uniswap v4 override flag", () => {
  const fee = computeDynamicFeePips({ pressureBps: 550, emaNotional: 200_000n, includeFlag: true });

  assert.equal((fee & OVERRIDE_FEE_FLAG) !== 0, true);
});

test("nextTelemetry tracks exponential notional and signed pressure per pool", () => {
  const first = nextTelemetry(undefined, { amountSpecified: 100_000n, zeroForOne: true, blockNumber: 10 });
  const second = nextTelemetry(first, { amountSpecified: -50_000n, zeroForOne: false, blockNumber: 11 });

  assert.equal(first.swapCount, 1);
  assert.equal(second.swapCount, 2);
  assert.ok(second.emaNotional > 0n);
  assert.ok(second.pressureBps > first.pressureBps);
  assert.ok(second.signedFlow < first.signedFlow);
});

test("scoreLiquidity rewards larger deposits and penalizes stressed pools", () => {
  const calmScore = scoreLiquidity({ liquidityDelta: 1_000_000n, pressureBps: 0, currentScore: 0n });
  const stressedScore = scoreLiquidity({ liquidityDelta: 1_000_000n, pressureBps: 7_500, currentScore: 0n });

  assert.ok(calmScore > stressedScore);
  assert.ok(stressedScore > 0n);
});

test("shouldFlagEarlyExit only flags meaningful early withdrawals", () => {
  assert.equal(shouldFlagEarlyExit({ lastAddedAt: 1_000, now: 1_300, liquidityDelta: -50n }), true);
  assert.equal(shouldFlagEarlyExit({ lastAddedAt: 1_000, now: 90_000, liquidityDelta: -50n }), false);
  assert.equal(shouldFlagEarlyExit({ lastAddedAt: 1_000, now: 1_300, liquidityDelta: 50n }), false);
});

test("computePulseIndex returns a perfect score for a fresh, quiet pool", () => {
  assert.equal(computePulseIndex(), 100);
});

test("computePulseIndex drops as pressure rises and exits accumulate", () => {
  const calm = computePulseIndex({ pressureBps: 0 });
  const stressed = computePulseIndex({ pressureBps: 8_000 });
  const damaged = computePulseIndex({ pressureBps: 8_000, earlyExitCount: 4 });

  assert.ok(calm > stressed);
  assert.ok(stressed > damaged);
  assert.ok(damaged >= 0);
});

test("computePulseIndex rewards sticky LP score and stays within 0-100", () => {
  const bare = computePulseIndex({ pressureBps: 6_000 });
  const protectedByLps = computePulseIndex({ pressureBps: 6_000, lpScore: 2_000_000n });

  assert.ok(protectedByLps > bare);
  assert.ok(protectedByLps <= 100);
  assert.equal(computePulseIndex({ pressureBps: 10_000, earlyExitCount: 50 }) >= 0, true);
});

test("classifyPulsePhase labels the four health bands", () => {
  assert.equal(classifyPulsePhase(95), "Healthy");
  assert.equal(classifyPulsePhase(70), "Stabilizing");
  assert.equal(classifyPulsePhase(40), "Stressed");
  assert.equal(classifyPulsePhase(10), "Critical");
});
