// Dependency-free X Layer mainnet client for the deployed PulseHook.
// All function selectors and event topics are pre-computed via js-sha3
// at development time; the browser never needs to compute keccak.

export const XLAYER_CHAIN_ID = 196;
export const XLAYER_RPC = "https://rpc.xlayer.tech";
export const XLAYER_EXPLORER_TX = (hash) => `https://www.oklink.com/xlayer/tx/${hash}`;
export const XLAYER_EXPLORER_ADDRESS = (addr) => `https://www.oklink.com/xlayer/address/${addr}`;

export const HOOK_ADDRESS = "0x0f307dc905592fbef047b8dddcc50f9415b286c0";
export const DEMO_EXECUTOR_ADDRESS = "0x872d793708c03818f6fedcc10c176f6faa550b76";
export const POOL_MANAGER_ADDRESS = "0x360e68faccca8ca495c1b759fd9eee466db9fb32";

// The original v1 (owner-gated) demo pool — read-only evidence display.
export const POOL_KEY = {
  currency0: "0x0e31be3f0c7389edc2a43818a12652160d87de8c",
  currency1: "0xfed58b5147f754f93b43562dcdb30247ce642d98",
  fee: 8388608,
  tickSpacing: 60,
  hooks: HOOK_ADDRESS
};
export const POOL_ID = "0x8fd84c892eeef413a213607f9e85631d669a09e27b2a4c193d2c42b4fa8739c0";

// The v2 *permissionless* executor — any wallet can swap / add LP for the live demo.
export const PUBLIC_EXECUTOR_ADDRESS = "0xe52a5698e895da113b217bd8ebff335e5635e900";
export const PUBLIC_POOL_KEY = {
  currency0: "0x77d43db8d43756763f0303bb651d20ab8359541c",
  currency1: "0xc36a61cfe3c55627818b6d8b1e39fe1135577fb3",
  fee: 8388608,
  tickSpacing: 60,
  hooks: HOOK_ADDRESS
};
export const PUBLIC_POOL_ID = "0x6afe92e268ea41202dbe8c218923338b6a7564961458f97e8a6ef02859b6213b";

// Single-call caps that match the on-chain anti-grief limits.
export const PUBLIC_MAX_SWAP = 5_000_000_000_000_000_000_000n;       // 5,000 tokens (18d)
export const PUBLIC_MAX_LIQUIDITY_DELTA = 10_000_000_000_000_000_000_000n; // 10,000 LU

export const KNOWN_EVIDENCE_TXS = [
  { kind: "pool-init", label: "Pool initialized", hash: "0x77bc01a4f0bacc90d4cbac968c8ff09f5a69ae569965522fbfe6a5caac4fb780" },
  { kind: "add-liquidity", label: "Sticky liquidity added", hash: "0xe9a69e4a33cb589693a7ee64d1ad4b588a48c5b400ab072e5483d0e995c46b33" },
  { kind: "normal-swap", label: "Normal swap observed", hash: "0x6e01709628361f5bf79263eb9cd4cb89ee856010a9a7fec55952e1daa0762c22" },
  { kind: "volatile-swap", label: "Volatile swap observed", hash: "0xf214c9cc7836c8d89028290aab96ce7c0d2901c68bb9960174deee9c41780c15" }
];

const SEL_GET_POOL_TELEMETRY = "0x0e2127bd";
const SEL_GET_PROVIDER_SCORE = "0x9c5454ed";

// PulseHookDemoExecutorPublic selectors (precomputed via js-sha3).
export const SEL_SWAP_EXACT_INPUT = "0xb0b325ec"; // swapExactInput(bool,uint128)
export const SEL_ADD_LIQUIDITY    = "0x709e9952"; // addLiquidity(uint128)
export const SEL_INITIALIZE_POOL  = "0x250e6de0"; // initializePool()

const TOPICS = {
  PulseObserved: "0x5aa56ebfe756cd8156f61554a24310f5b30117a6104a90cd0f3374dc16230f03",
  LiquidityScored: "0x2f1fa89983adff4167f3b0d3147de8582d201bd2e1385caf8d4c096772f1c5b9",
  EarlyExitFlagged: "0x0a0f2f644e4c975d77e0fe0ffc6504157dd8221bddf16d0db2dcdb78341218ee"
};

const ALL_HOOK_TOPICS = Object.values(TOPICS);
const TOPIC_TO_NAME = Object.fromEntries(Object.entries(TOPICS).map(([k, v]) => [v, k]));

const stripHex = (value) => (typeof value === "string" ? value.replace(/^0x/i, "").toLowerCase() : "");
const pad32 = (hex) => stripHex(hex).padStart(64, "0");
const padAddress = (addr) => pad32(addr);
const encodeUint = (value) => BigInt(value).toString(16).padStart(64, "0");

function encodePoolKey(key = POOL_KEY) {
  return (
    padAddress(key.currency0) +
    padAddress(key.currency1) +
    encodeUint(key.fee) +
    encodeUint(key.tickSpacing) +
    padAddress(key.hooks)
  );
}

function chunk32(hex) {
  const clean = stripHex(hex);
  const out = [];
  for (let i = 0; i < clean.length; i += 64) out.push(clean.slice(i, i + 64));
  return out;
}

function decodeUint(word) {
  return BigInt("0x" + word);
}

function decodeInt(word) {
  const big = BigInt("0x" + word);
  return word.startsWith("8") || word.startsWith("9") || /^[a-f]/.test(word)
    ? big - (1n << 256n)
    : big;
}

let rpcId = 0;
async function rpc(method, params, endpoint = XLAYER_RPC) {
  rpcId += 1;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params })
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
  return body.result;
}

export async function fetchBlockNumber(endpoint) {
  const hex = await rpc("eth_blockNumber", [], endpoint);
  return Number(BigInt(hex));
}

export async function fetchPoolTelemetry(endpoint, poolKey = PUBLIC_POOL_KEY) {
  const data = SEL_GET_POOL_TELEMETRY + encodePoolKey(poolKey);
  const raw = await rpc("eth_call", [{ to: HOOK_ADDRESS, data }, "latest"], endpoint);
  const words = chunk32(raw);
  if (words.length < 8) throw new Error(`Telemetry call returned ${words.length} words`);

  return {
    lastBlock: Number(decodeUint(words[0])),
    emaNotional: decodeUint(words[1]),
    pressureBps: Number(decodeUint(words[2])),
    currentFeePips: Number(decodeUint(words[3])),
    swapCount: Number(decodeUint(words[4])),
    lastSwapAt: Number(decodeUint(words[5])),
    signedFlow: decodeInt(words[6]),
    lastZeroForOne: decodeUint(words[7]) === 1n
  };
}

export async function fetchProviderScore(providerAddress = PUBLIC_EXECUTOR_ADDRESS, endpoint, poolKey = PUBLIC_POOL_KEY) {
  const data = SEL_GET_PROVIDER_SCORE + encodePoolKey(poolKey) + padAddress(providerAddress);
  const raw = await rpc("eth_call", [{ to: HOOK_ADDRESS, data }, "latest"], endpoint);
  const words = chunk32(raw);
  if (words.length < 5) throw new Error(`ProviderScore call returned ${words.length} words`);

  return {
    score: decodeUint(words[0]),
    firstSeenAt: Number(decodeUint(words[1])),
    lastAddedAt: Number(decodeUint(words[2])),
    activeLiquidity: decodeUint(words[3]),
    earlyExitCount: Number(decodeUint(words[4]))
  };
}

/* ────────────── Wallet helpers (EIP-1193 / EIP-6963) ────────────── */

const eip6963Providers = new Map();
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (ev) => {
    if (ev.detail?.info?.uuid) eip6963Providers.set(ev.detail.info.uuid, ev.detail);
  });
  // Fire-and-forget — wallets may respond async.
  setTimeout(() => window.dispatchEvent(new Event("eip6963:requestProvider")), 0);
}

export function listInjectedWallets() {
  const list = [];
  for (const d of eip6963Providers.values()) {
    list.push({ source: "eip6963", name: d.info.name, icon: d.info.icon, provider: d.provider });
  }
  if (typeof window !== "undefined") {
    if (window.okxwallet && !list.some((w) => /okx/i.test(w.name))) {
      list.push({ source: "okxwallet", name: "OKX Wallet", icon: null, provider: window.okxwallet });
    }
    if (window.ethereum && !list.some((w) => w.provider === window.ethereum)) {
      list.push({ source: "window.ethereum", name: "Browser wallet", icon: null, provider: window.ethereum });
    }
  }
  return list;
}

export function pickProvider() {
  const wallets = listInjectedWallets();
  // Prefer OKX explicitly.
  const okx = wallets.find((w) => /okx/i.test(w.name));
  if (okx) return okx.provider;
  return wallets[0]?.provider ?? null;
}

export async function fetchChainId(provider) {
  const hex = await provider.request({ method: "eth_chainId" });
  return parseInt(hex, 16);
}

export async function sendTx(provider, { to, data, from, value = "0x0" }) {
  return provider.request({
    method: "eth_sendTransaction",
    params: [{ to, data, from, value }]
  });
}

export async function waitForReceipt(txHash, { intervalMs = 2_000, maxMs = 60_000, endpoint } = {}) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const receipt = await rpc("eth_getTransactionReceipt", [txHash], endpoint);
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${txHash}`);
}

/* ────────────── Calldata encoders (public executor) ────────────── */

export function encodeSwapExactInput(zeroForOne, amountIn) {
  return (
    SEL_SWAP_EXACT_INPUT +
    (zeroForOne ? "01" : "00").padStart(64, "0") +
    BigInt(amountIn).toString(16).padStart(64, "0")
  );
}

export function encodeAddLiquidity(liquidity) {
  return SEL_ADD_LIQUIDITY + BigInt(liquidity).toString(16).padStart(64, "0");
}

export function encodeInitializePool() {
  return SEL_INITIALIZE_POOL;
}

function decodePulseObserved(log) {
  const data = chunk32(log.data);
  return {
    kind: "PulseObserved",
    sender: "0x" + log.topics[2].slice(-40),
    notional: decodeUint(data[0]),
    pressureBps: Number(decodeUint(data[1])),
    feePips: Number(decodeUint(data[2]))
  };
}

function decodeLiquidityScored(log) {
  const data = chunk32(log.data);
  return {
    kind: "LiquidityScored",
    provider: "0x" + log.topics[2].slice(-40),
    liquidityAdded: decodeUint(data[0]),
    newScore: decodeUint(data[1])
  };
}

function decodeEarlyExitFlagged(log) {
  const data = chunk32(log.data);
  return {
    kind: "EarlyExitFlagged",
    provider: "0x" + log.topics[2].slice(-40),
    positionAge: Number(decodeUint(data[0])),
    earlyExitCount: Number(decodeUint(data[1]))
  };
}

function decodeHookLog(log) {
  const topic = log.topics[0];
  if (topic === TOPICS.PulseObserved) return decodePulseObserved(log);
  if (topic === TOPICS.LiquidityScored) return decodeLiquidityScored(log);
  if (topic === TOPICS.EarlyExitFlagged) return decodeEarlyExitFlagged(log);
  return null;
}

export async function fetchEvidenceEvents(endpoint) {
  const out = [];
  for (const entry of KNOWN_EVIDENCE_TXS) {
    const receipt = await rpc("eth_getTransactionReceipt", [entry.hash], endpoint);
    if (!receipt) continue;
    const blockNumber = Number(BigInt(receipt.blockNumber));
    const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false], endpoint);
    const timestamp = block ? Number(BigInt(block.timestamp)) : 0;
    const hookLogs = receipt.logs
      .filter((log) => log.address.toLowerCase() === HOOK_ADDRESS.toLowerCase())
      .map(decodeHookLog)
      .filter(Boolean);
    out.push({ ...entry, blockNumber, timestamp, hookLogs });
  }
  return out;
}

export async function fetchRecentHookEvents({ fromBlock, toBlock = "latest", endpoint } = {}) {
  const params = {
    address: HOOK_ADDRESS,
    fromBlock: typeof fromBlock === "number" ? `0x${fromBlock.toString(16)}` : fromBlock,
    toBlock: typeof toBlock === "number" ? `0x${toBlock.toString(16)}` : toBlock,
    topics: [ALL_HOOK_TOPICS]
  };
  const logs = await rpc("eth_getLogs", [params], endpoint);
  return logs.map((log) => ({
    ...decodeHookLog(log),
    blockNumber: Number(BigInt(log.blockNumber)),
    txHash: log.transactionHash
  })).filter((evt) => evt.kind);
}

export { TOPICS, TOPIC_TO_NAME, SEL_GET_POOL_TELEMETRY, SEL_GET_PROVIDER_SCORE };
