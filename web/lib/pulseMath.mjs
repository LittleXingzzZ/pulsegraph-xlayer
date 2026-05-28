export const MIN_FEE_PIPS = 500;
export const BASE_FEE_PIPS = 3_000;
export const MAX_FEE_PIPS = 30_000;
export const OVERRIDE_FEE_FLAG = 0x400000;
export const EARLY_EXIT_WINDOW_SECONDS = 86_400;

const MAX_PRESSURE_BPS = 10_000;

const toBigInt = (value) => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string") return BigInt(value);
  return 0n;
};

const absBigInt = (value) => (value < 0n ? -value : value);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function computeDynamicFeePips({ pressureBps = 0, emaNotional = 0n, includeFlag = false } = {}) {
  const pressure = clamp(Number(pressureBps) || 0, 0, MAX_PRESSURE_BPS);
  const notional = toBigInt(emaNotional);
  const activitySurcharge = notional > 1_000_000n ? 4_000 : notional > 100_000n ? 1_500 : 0;
  const pressureSurcharge = Math.floor(pressure * 2.8);
  const fee = clamp(BASE_FEE_PIPS + pressureSurcharge + activitySurcharge, MIN_FEE_PIPS, MAX_FEE_PIPS);

  return includeFlag ? fee | OVERRIDE_FEE_FLAG : fee;
}

export function nextTelemetry(previous, swap) {
  const amount = absBigInt(toBigInt(swap.amountSpecified));
  const direction = swap.zeroForOne ? 1n : -1n;
  const lastEma = previous?.emaNotional ?? 0n;
  const lastSignedFlow = previous?.signedFlow ?? 0n;
  const previousDirection = previous?.lastDirection ?? direction;
  const blockNumber = Number(swap.blockNumber ?? previous?.lastBlock ?? 0);

  const emaNotional = lastEma === 0n ? amount : (lastEma * 7n + amount * 3n) / 10n;
  const signedFlow = (lastSignedFlow * 8n) / 10n + amount * direction;
  const flowMagnitude = absBigInt(signedFlow);
  const basePressure = emaNotional === 0n ? 0 : Number((flowMagnitude * 10_000n) / (emaNotional * 8n + 1n));
  const flipPremium = previous && previousDirection !== direction ? 1_800 : 0;
  const spikePremium = lastEma > 0n && amount > lastEma * 2n ? 1_200 : 0;
  const pressureBps = clamp(basePressure + flipPremium + spikePremium, 0, MAX_PRESSURE_BPS);
  const currentFeePips = computeDynamicFeePips({ pressureBps, emaNotional });

  return {
    lastBlock: blockNumber,
    emaNotional,
    signedFlow,
    pressureBps,
    currentFeePips,
    swapCount: (previous?.swapCount ?? 0) + 1,
    lastDirection: direction
  };
}

export function scoreLiquidity({ liquidityDelta, pressureBps = 0, currentScore = 0n }) {
  const liquidity = absBigInt(toBigInt(liquidityDelta));
  const pressure = clamp(Number(pressureBps) || 0, 0, MAX_PRESSURE_BPS);
  const stressDiscountBps = Math.floor(Math.min(pressure, 8_000) / 2);
  const multiplierBps = 10_000 - stressDiscountBps;

  return toBigInt(currentScore) + (liquidity * BigInt(multiplierBps)) / 10_000n;
}

export function shouldFlagEarlyExit({ lastAddedAt, now, liquidityDelta }) {
  const withdrawal = toBigInt(liquidityDelta) < 0n;
  if (!withdrawal || !lastAddedAt) return false;

  return Number(now) - Number(lastAddedAt) < EARLY_EXIT_WINDOW_SECONDS;
}

export function computePulseIndex({
  pressureBps = 0,
  swapCount = 0,
  lpScore = 0n,
  earlyExitCount = 0
} = {}) {
  const pressure = clamp(Number(pressureBps) || 0, 0, MAX_PRESSURE_BPS);
  const exits = Math.max(0, Number(earlyExitCount) || 0);
  const swaps = Math.max(0, Number(swapCount) || 0);
  const score = toBigInt(lpScore);

  let index = 100;
  index -= Math.round((pressure / MAX_PRESSURE_BPS) * 45);
  index -= Math.min(exits * 8, 30);

  const immunityUnit = 100_000n;
  const immunity = score > 0n ? Math.min(Number(score / immunityUnit), 20) : 0;
  index += immunity;
  index += Math.min(Math.floor(swaps / 5), 5);

  return clamp(index, 0, 100);
}

export function classifyPulsePhase(index) {
  if (index >= 80) return "Healthy";
  if (index >= 55) return "Stabilizing";
  if (index >= 30) return "Stressed";
  return "Critical";
}

export function formatFee(feePips) {
  return `${(Number(feePips & ~OVERRIDE_FEE_FLAG) / 10_000).toFixed(2)}%`;
}

export function formatBigInt(value) {
  return new Intl.NumberFormat("en-US").format(Number(toBigInt(value)));
}
