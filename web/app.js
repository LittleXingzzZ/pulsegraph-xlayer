import {
  EARLY_EXIT_WINDOW_SECONDS,
  classifyPulsePhase,
  computeDynamicFeePips,
  computePulseIndex,
  formatBigInt,
  formatFee,
  nextTelemetry,
  scoreLiquidity
} from "./lib/pulseMath.mjs";
import {
  HOOK_ADDRESS,
  KNOWN_EVIDENCE_TXS,
  PUBLIC_EXECUTOR_ADDRESS,
  PUBLIC_MAX_LIQUIDITY_DELTA,
  PUBLIC_MAX_SWAP,
  PUBLIC_POOL_ID,
  PUBLIC_POOL_KEY,
  XLAYER_CHAIN_ID,
  XLAYER_EXPLORER_ADDRESS,
  XLAYER_EXPLORER_TX,
  encodeAddLiquidity,
  encodeSwapExactInput,
  fetchBlockNumber,
  fetchChainId,
  fetchEvidenceEvents,
  fetchPoolTelemetry,
  fetchProviderScore,
  listInjectedWallets,
  pickProvider,
  sendTx,
  waitForReceipt
} from "./lib/xlayerClient.mjs";

const PHASE_COLORS = {
  Healthy: { line: "#c4ff3d", glow: "rgba(196, 255, 61, 0.40)" },
  Stabilizing: { line: "#5be9d8", glow: "rgba(91, 233, 216, 0.32)" },
  Stressed: { line: "#ffb547", glow: "rgba(255, 181, 71, 0.32)" },
  Critical: { line: "#ff5a3c", glow: "rgba(255, 90, 60, 0.32)" }
};

const TRACE_LENGTH = 520;
const QRS_PATTERN = [-0.03, -0.06, 0.74, -0.48, -0.14, 0.05, 0.02, 0];

const POLL_BLOCK_MS = 6_000;
const POLL_TELEMETRY_MS = 12_000;
const EVENT_LIST_CAP = 8;

const state = {
  live: {
    block: null,
    telemetry: null,
    providerScore: null,
    online: false,
    lastTelemetrySwapCount: 0,
    lastProviderLiquidity: 0n,
    lastProviderExits: 0,
    evidenceLoaded: false
  },
  sim: {
    extraTelemetry: null,
    extraLpScore: 0n,
    extraExits: 0,
    lastLiquidityAt: undefined
  },
  wallet: {
    provider: null,
    account: null,
    chainId: null,
    walletName: null,
    error: null,
    busy: false
  },
  events: [],
  historicEvents: [],
  pulseTrace: new Array(TRACE_LENGTH).fill(0),
  pendingShape: []
};

const $ = (id) => document.getElementById(id);
const els = {
  livePill: $("livePill"),
  liveBlock: $("liveBlock"),
  walletLabel: $("walletLabel"),
  chainBadge: $("chainBadge"),
  walletError: $("walletError"),
  monitorTimestamp: $("monitorTimestamp"),
  poolIdReadout: $("poolIdReadout"),
  hookAddressLink: $("hookAddressLink"),
  feeValue: $("feeValue"),
  feeSim: $("feeSim"),
  pressureValue: $("pressureValue"),
  pressureSim: $("pressureSim"),
  scoreValue: $("scoreValue"),
  scoreSim: $("scoreSim"),
  exitValue: $("exitValue"),
  exitSim: $("exitSim"),
  simBanner: $("simBanner"),
  clearSimBtn: $("clearSim"),
  pulseIndex: $("pulseIndex"),
  pulsePhase: $("pulsePhase"),
  eventList: $("eventList"),
  historicList: $("historicList"),
  evidenceGrid: $("evidenceGrid"),
  tapeRail: $("tapeRail"),
  hookStatus: $("hookStatus"),
  canvas: $("pulseCanvas")
};

const ctx = els.canvas.getContext("2d");
let animationFrame = 0;
let frameTick = 0;

if (els.hookAddressLink) {
  els.hookAddressLink.href = XLAYER_EXPLORER_ADDRESS(HOOK_ADDRESS);
}
if (els.poolIdReadout) {
  els.poolIdReadout.textContent = `POOL ${PUBLIC_POOL_ID.slice(0, 8)}…${PUBLIC_POOL_ID.slice(-6)}`;
}

function fmtClock(ts) {
  if (!ts) return "— —";
  const date = new Date(ts * 1000);
  const hh = `${date.getUTCHours()}`.padStart(2, "0");
  const mm = `${date.getUTCMinutes()}`.padStart(2, "0");
  const ss = `${date.getUTCSeconds()}`.padStart(2, "0");
  return `${hh}:${mm}:${ss} UTC`;
}

function fmtRelative(ts) {
  if (!ts) return "unknown";
  const now = Date.now() / 1000;
  const delta = Math.max(0, now - ts);
  if (delta < 60) return `${Math.floor(delta)}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86_400)}d ago`;
}

function fmtAddress(addr) {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const TOKEN_UNIT = 1_000_000_000_000_000_000n;

function fmtImmunity(score) {
  const big = typeof score === "bigint" ? score : BigInt(score ?? 0);
  if (big === 0n) return "0";
  if (big >= TOKEN_UNIT) {
    const scaled = Number((big * 1000n) / TOKEN_UNIT) / 1000;
    if (scaled >= 1_000_000) return `${(scaled / 1_000_000).toFixed(2)}M LU`;
    if (scaled >= 1_000) return `${(scaled / 1_000).toFixed(2)}K LU`;
    return `${scaled.toLocaleString(undefined, { maximumFractionDigits: 2 })} LU`;
  }
  return formatBigInt(big);
}

function liveTelemetry() {
  return (
    state.live.telemetry ?? {
      pressureBps: 0,
      currentFeePips: computeDynamicFeePips(),
      swapCount: 0,
      emaNotional: 0n,
      lastSwapAt: 0
    }
  );
}

function simActive() {
  return Boolean(
    state.sim.extraTelemetry ||
      state.sim.extraLpScore > 0n ||
      state.sim.extraExits > 0
  );
}

function snapshot() {
  // Live always wins for display; sim contributes a separate overlay delta.
  const live = liveTelemetry();
  const sim = state.sim.extraTelemetry;
  const liveLp = state.live.providerScore?.score ?? 0n;
  const liveExits = state.live.providerScore?.earlyExitCount ?? 0;

  const overlay = {
    feeDeltaPips: sim ? sim.currentFeePips - live.currentFeePips : 0,
    pressureDeltaBps: sim ? sim.pressureBps - live.pressureBps : 0,
    lpDelta: state.sim.extraLpScore,
    exitDelta: state.sim.extraExits
  };

  // Pulse Index uses live + sim combined so the user can preview impact.
  const combinedPressure = (sim ? sim.pressureBps : live.pressureBps);
  const combinedSwapCount = (sim ? sim.swapCount : live.swapCount);
  const combinedLp = liveLp + state.sim.extraLpScore;
  const combinedExits = liveExits + state.sim.extraExits;
  const pulseIndex = computePulseIndex({
    pressureBps: combinedPressure,
    swapCount: combinedSwapCount,
    lpScore: combinedLp,
    earlyExitCount: combinedExits
  });

  return {
    live,
    liveLp,
    liveExits,
    overlay,
    pulseIndex,
    phase: classifyPulsePhase(pulseIndex)
  };
}

function pushEvent({ kind = "Sim", description, meta = "" }) {
  state.events.unshift({ kind, description, meta, when: Date.now() });
  state.events = state.events.slice(0, EVENT_LIST_CAP);
}

function pushHistoric({ kind, description, meta }) {
  state.historicEvents.push({ kind, description, meta });
}

function renderEvents() {
  if (!els.eventList) return;
  els.eventList.replaceChildren();
  if (state.events.length === 0) {
    const li = document.createElement("li");
    li.dataset.kind = "Sim";
    const tag = document.createElement("span");
    tag.className = "ev-tag";
    tag.textContent = "IDLE";
    const desc = document.createElement("span");
    desc.className = "ev-desc";
    desc.textContent = "Press a button or wait for the next mainnet pulse.";
    li.append(tag, desc);
    els.eventList.append(li);
    return;
  }
  for (const ev of state.events) {
    const li = document.createElement("li");
    li.dataset.kind = ev.kind;
    const tag = document.createElement("span");
    tag.className = "ev-tag";
    tag.textContent = ev.kind === "Sim" ? "SIM" : ev.kind;
    const desc = document.createElement("span");
    desc.className = "ev-desc";
    desc.textContent = ev.description;
    const meta = document.createElement("span");
    meta.className = "ev-meta";
    meta.textContent = ev.meta || fmtRelative(ev.when / 1000);
    li.append(tag, desc, meta);
    els.eventList.append(li);
  }
}

function renderHistoric() {
  if (!els.historicList) return;
  els.historicList.replaceChildren();
  if (state.historicEvents.length === 0) {
    const li = document.createElement("li");
    const tag = document.createElement("span");
    tag.className = "ev-tag";
    tag.textContent = "LOADING";
    const desc = document.createElement("span");
    desc.className = "ev-desc";
    desc.textContent = "Replaying mainnet vitals…";
    li.append(tag, desc);
    els.historicList.append(li);
    return;
  }
  for (const ev of state.historicEvents) {
    const li = document.createElement("li");
    li.dataset.kind = ev.kind;
    const tag = document.createElement("span");
    tag.className = "ev-tag";
    tag.textContent = ev.kind;
    const desc = document.createElement("span");
    desc.className = "ev-desc";
    desc.textContent = ev.description;
    const meta = document.createElement("span");
    meta.className = "ev-meta";
    meta.textContent = ev.meta;
    li.append(tag, desc, meta);
    els.historicList.append(li);
  }
}

function renderTape() {
  if (!els.tapeRail) return;
  const evidence = state.evidence ?? [];
  const entries = [];
  for (const ev of evidence) {
    const hashShort = `${ev.hash.slice(0, 10)}…${ev.hash.slice(-6)}`;
    entries.push({ tag: ev.label.toUpperCase(), body: ` · block ${ev.blockNumber.toLocaleString()} · tx ${hashShort}` });
  }
  if (state.live.telemetry) {
    entries.push({
      tag: "LIVE FEE",
      body: ` ${formatFee(state.live.telemetry.currentFeePips)} · pressure ${state.live.telemetry.pressureBps} bps`
    });
  }
  if (state.live.providerScore) {
    entries.push({
      tag: "STICKY LP",
      body: ` ${fmtImmunity(state.live.providerScore.score)} · exits ${state.live.providerScore.earlyExitCount}`
    });
  }
  if (entries.length === 0) entries.push({ tag: "● LIVE", body: " awaiting first block …" });

  els.tapeRail.replaceChildren();
  const append = (entry) => {
    const span = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = entry.tag;
    const body = document.createTextNode(entry.body);
    span.append(strong, body);
    els.tapeRail.append(span);
  };
  for (const e of entries) append(e);
  for (const e of entries) append(e); // double for seamless marquee
}

function renderEvidence() {
  if (!els.evidenceGrid) return;
  els.evidenceGrid.replaceChildren();
  const evidence = state.evidence ?? KNOWN_EVIDENCE_TXS.map((entry) => ({ ...entry, blockNumber: 0, timestamp: 0, hookLogs: [] }));

  const toneByKind = {
    "pool-init": "vital",
    "add-liquidity": "calm",
    "normal-swap": "vital",
    "volatile-swap": "warn"
  };

  let index = 1;
  for (const ev of evidence) {
    const card = document.createElement("a");
    card.className = "evidence-card";
    card.href = XLAYER_EXPLORER_TX(ev.hash);
    card.target = "_blank";
    card.rel = "noreferrer";
    card.dataset.tone = toneByKind[ev.kind] ?? "vital";

    const kicker = document.createElement("div");
    kicker.className = "evidence-kicker";
    const idx = document.createElement("span");
    idx.className = "index";
    idx.textContent = `/0${index} · /04`;
    const kind = document.createElement("span");
    kind.textContent = ev.kind.replace(/-/g, " ");
    kicker.append(idx, kind);

    const title = document.createElement("h3");
    title.className = "evidence-title";
    const titleMap = {
      "pool-init": "Pool Initialized",
      "add-liquidity": "Sticky Liquidity",
      "normal-swap": "Normal Swap",
      "volatile-swap": "Volatile Swap"
    };
    title.textContent = titleMap[ev.kind] ?? ev.label;

    const rows = document.createElement("div");
    rows.className = "evidence-rows";
    const addRow = (label, value) => {
      const row = document.createElement("div");
      row.className = "row";
      const l = document.createElement("span");
      l.textContent = label;
      const v = document.createElement("span");
      v.textContent = value;
      row.append(l, v);
      rows.append(row);
    };
    addRow("Block", ev.blockNumber ? ev.blockNumber.toLocaleString() : "—");
    addRow("When", ev.timestamp ? `${fmtClock(ev.timestamp)} · ${fmtRelative(ev.timestamp)}` : "fetching…");
    addRow("Tx hash", `${ev.hash.slice(0, 10)}…${ev.hash.slice(-6)}`);
    if (ev.hookLogs && ev.hookLogs.length > 0) {
      const log = ev.hookLogs[0];
      if (log.kind === "PulseObserved") {
        addRow("Event", `PulseObserved · ${log.pressureBps} bps · fee ${(log.feePips / 10_000).toFixed(2)}%`);
      } else if (log.kind === "LiquidityScored") {
        addRow("Event", `LiquidityScored · score ${formatBigInt(log.newScore)}`);
      } else if (log.kind === "EarlyExitFlagged") {
        addRow("Event", `EarlyExitFlagged · ${log.earlyExitCount} total`);
      }
    } else if (ev.kind === "pool-init") {
      addRow("Event", "Pool created (hook idle)");
    }

    const cta = document.createElement("span");
    cta.className = "evidence-cta";
    cta.textContent = "Open on OKLink →";

    card.append(kicker, title, rows, cta);
    els.evidenceGrid.append(card);
    index += 1;
  }
}

function formatPipsDelta(deltaPips) {
  if (deltaPips === 0) return "";
  const pct = (deltaPips / 10_000).toFixed(2);
  return `${deltaPips > 0 ? "+" : ""}${pct}% sim`;
}

function formatBpsDelta(deltaBps) {
  if (deltaBps === 0) return "";
  return `${deltaBps > 0 ? "+" : ""}${deltaBps} bps sim`;
}

function renderStats() {
  const { live, liveLp, liveExits, overlay, pulseIndex, phase } = snapshot();
  if (els.feeValue) els.feeValue.textContent = formatFee(live.currentFeePips);
  if (els.feeSim) els.feeSim.textContent = formatPipsDelta(overlay.feeDeltaPips);
  if (els.pressureValue) els.pressureValue.textContent = `${live.pressureBps} bps`;
  if (els.pressureSim) els.pressureSim.textContent = formatBpsDelta(overlay.pressureDeltaBps);
  if (els.scoreValue) els.scoreValue.textContent = fmtImmunity(liveLp);
  if (els.scoreSim) {
    els.scoreSim.textContent = overlay.lpDelta > 0n ? `+${fmtImmunity(overlay.lpDelta)} sim` : "";
  }
  if (els.exitValue) els.exitValue.textContent = `${liveExits}`;
  if (els.exitSim) {
    els.exitSim.textContent = overlay.exitDelta > 0 ? `+${overlay.exitDelta} sim` : "";
  }
  if (els.pulseIndex) {
    els.pulseIndex.textContent = `${pulseIndex}`;
    els.pulseIndex.dataset.phase = phase.toLowerCase();
  }
  if (els.pulsePhase) {
    els.pulsePhase.textContent = phase;
    els.pulsePhase.dataset.phase = phase.toLowerCase();
  }
  if (els.simBanner) {
    els.simBanner.dataset.active = simActive() ? "yes" : "no";
  }
  if (els.clearSimBtn) {
    els.clearSimBtn.disabled = !simActive();
  }
}

function setLive({ block, online, lastSwapAt }) {
  if (typeof block === "number") {
    state.live.block = block;
    if (els.liveBlock) els.liveBlock.textContent = `#${block.toLocaleString()}`;
  }
  if (els.livePill) {
    els.livePill.dataset.state = online ? "live" : "offline";
    if (!online && els.liveBlock) {
      els.liveBlock.textContent = "OFFLINE";
    }
  }
  if (typeof lastSwapAt === "number" && els.monitorTimestamp) {
    els.monitorTimestamp.textContent = `LAST EVENT ${fmtClock(lastSwapAt)}`;
  }
}

function render() {
  renderStats();
  renderEvents();
  renderHistoric();
  renderTape();
}

/* ─────────────────────────────────────────────── LIVE DATA */
async function refreshBlock() {
  try {
    const block = await fetchBlockNumber();
    setLive({ block, online: true });
  } catch (err) {
    setLive({ online: false });
  }
}

async function refreshTelemetry() {
  try {
    const [telemetry, providerScore] = await Promise.all([
      fetchPoolTelemetry(),
      fetchProviderScore(PUBLIC_EXECUTOR_ADDRESS).catch(() => null)
    ]);
    setLive({ online: true, lastSwapAt: telemetry.lastSwapAt });

    // Surface new on-chain swaps as ECG spikes + event list entries.
    if (state.live.telemetry && telemetry.swapCount > state.live.telemetry.swapCount) {
      const delta = telemetry.swapCount - state.live.telemetry.swapCount;
      for (let i = 0; i < delta; i += 1) queueQrs(1.0);
      pushEvent({
        kind: "PulseObserved",
        description: `On-chain swap · fee ${formatFee(telemetry.currentFeePips)} · pressure ${telemetry.pressureBps} bps`,
        meta: `block #${telemetry.lastBlock}`
      });
    }
    if (
      providerScore &&
      state.live.providerScore &&
      providerScore.activeLiquidity > state.live.providerScore.activeLiquidity
    ) {
      queueQrs(0.5);
      pushEvent({
        kind: "LiquidityScored",
        description: `On-chain sticky LP added · score ${formatBigInt(providerScore.score)}`,
        meta: `provider ${fmtAddress(PUBLIC_EXECUTOR_ADDRESS)}`
      });
    }
    if (
      providerScore &&
      state.live.providerScore &&
      providerScore.earlyExitCount > state.live.providerScore.earlyExitCount
    ) {
      queueQrs(0.7);
      pushEvent({
        kind: "EarlyExitFlagged",
        description: `On-chain early exit flagged · ${providerScore.earlyExitCount} total`,
        meta: `provider ${fmtAddress(PUBLIC_EXECUTOR_ADDRESS)}`
      });
    }

    state.live.telemetry = telemetry;
    state.live.providerScore = providerScore;

    if (els.hookStatus) {
      els.hookStatus.textContent = `Live · swapCount=${telemetry.swapCount} · pressure=${telemetry.pressureBps}bps · fee=${formatFee(telemetry.currentFeePips)} · provider score=${formatBigInt(providerScore?.score ?? 0n)}`;
    }

    render();
  } catch (err) {
    setLive({ online: false });
    if (els.hookStatus) {
      els.hookStatus.textContent = `Offline (X Layer RPC unreachable). UI is showing the most recent snapshot; click Inject simulated swap to keep poking.`;
    }
  }
}

async function loadEvidence() {
  try {
    const evidence = await fetchEvidenceEvents();
    state.evidence = evidence;
    state.live.evidenceLoaded = true;

    state.historicEvents = [];
    for (const ev of evidence) {
      if (ev.hookLogs.length === 0) {
        pushHistoric({
          kind: "Sim",
          description: `${ev.label} (no hook event)`,
          meta: `block ${ev.blockNumber.toLocaleString()} · ${fmtRelative(ev.timestamp)}`
        });
      }
      for (const log of ev.hookLogs) {
        if (log.kind === "PulseObserved") {
          pushHistoric({
            kind: "PulseObserved",
            description: `${ev.label} · ${log.pressureBps} bps · fee ${(log.feePips / 10_000).toFixed(2)}%`,
            meta: `block ${ev.blockNumber.toLocaleString()} · ${fmtRelative(ev.timestamp)}`
          });
        } else if (log.kind === "LiquidityScored") {
          pushHistoric({
            kind: "LiquidityScored",
            description: `${ev.label} · score ${formatBigInt(log.newScore)}`,
            meta: `block ${ev.blockNumber.toLocaleString()} · ${fmtRelative(ev.timestamp)}`
          });
        } else if (log.kind === "EarlyExitFlagged") {
          pushHistoric({
            kind: "EarlyExitFlagged",
            description: `${ev.label} · ${log.earlyExitCount} flagged`,
            meta: `block ${ev.blockNumber.toLocaleString()} · ${fmtRelative(ev.timestamp)}`
          });
        }
      }
    }
    renderEvidence();
    renderHistoric();
    renderTape();
  } catch (err) {
    renderEvidence();
  }
}

/* ─────────────────────────────────────────────── WALLET */

function showWalletError(message) {
  state.wallet.error = message;
  if (els.walletError) els.walletError.textContent = message ?? "";
  if (els.walletError) els.walletError.hidden = !message;
}

function updateWalletUi() {
  const w = state.wallet;
  if (els.walletLabel) {
    if (w.busy) els.walletLabel.textContent = "Connecting…";
    else if (w.account) els.walletLabel.textContent = fmtAddress(w.account);
    else els.walletLabel.textContent = "Connect wallet";
  }
  if (els.chainBadge) {
    if (!w.account) {
      els.chainBadge.hidden = true;
    } else if (w.chainId === XLAYER_CHAIN_ID) {
      els.chainBadge.hidden = false;
      els.chainBadge.dataset.state = "ok";
      els.chainBadge.textContent = "X LAYER ✓";
    } else {
      els.chainBadge.hidden = false;
      els.chainBadge.dataset.state = "warn";
      els.chainBadge.textContent = `WRONG CHAIN ${w.chainId ?? "?"} — click to switch`;
    }
  }
}

function attachProviderListeners(provider) {
  if (!provider || !provider.on || provider.__pulseHookListeners) return;
  provider.__pulseHookListeners = true;
  provider.on("accountsChanged", (accounts) => {
    state.wallet.account = accounts[0] ?? null;
    updateWalletUi();
    render();
  });
  provider.on("chainChanged", (hex) => {
    state.wallet.chainId = parseInt(hex, 16);
    updateWalletUi();
    render();
  });
}

export async function connectWallet() {
  showWalletError(null);
  const wallets = listInjectedWallets();
  if (wallets.length === 0) {
    showWalletError(
      "No wallet detected. Install OKX Wallet (chrome web store) or MetaMask, then refresh."
    );
    return;
  }
  const provider = pickProvider();
  state.wallet.provider = provider;
  state.wallet.walletName = wallets.find((w) => w.provider === provider)?.name ?? "wallet";
  state.wallet.busy = true;
  updateWalletUi();
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    state.wallet.account = accounts[0] ?? null;
    state.wallet.chainId = await fetchChainId(provider);
    attachProviderListeners(provider);
    pushEvent({
      kind: "Wallet",
      description: `Connected via ${state.wallet.walletName} · ${fmtAddress(state.wallet.account)}`,
      meta: state.wallet.chainId === XLAYER_CHAIN_ID ? "X Layer ✓" : `chain ${state.wallet.chainId}`
    });
    if (state.wallet.chainId !== XLAYER_CHAIN_ID) {
      showWalletError(`Wallet is on chain ${state.wallet.chainId}. Click "WRONG CHAIN" to switch.`);
    }
  } catch (err) {
    if (err?.code === 4001) showWalletError("You rejected the request. Click again to retry.");
    else if (err?.code === -32002) showWalletError("Wallet already has a pending request — open the extension.");
    else showWalletError(`Connect failed: ${err?.message ?? err}`);
  } finally {
    state.wallet.busy = false;
    updateWalletUi();
    render();
  }
}

export async function switchToXLayerMainnet() {
  showWalletError(null);
  const provider = state.wallet.provider ?? pickProvider();
  if (!provider) {
    showWalletError("No wallet detected.");
    return;
  }
  const hexChain = `0x${XLAYER_CHAIN_ID.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChain }] });
  } catch (err) {
    if (err?.code === 4902 || err?.code === -32603) {
      // Chain not added — add it.
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexChain,
            chainName: "X Layer Mainnet",
            nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
            rpcUrls: ["https://rpc.xlayer.tech"],
            blockExplorerUrls: ["https://www.oklink.com/xlayer"]
          }
        ]
      });
    } else {
      showWalletError(`Switch failed: ${err?.message ?? err}`);
      return;
    }
  }
  state.wallet.chainId = await fetchChainId(provider);
  updateWalletUi();
  render();
}

/* ─────────────────────────────────────────────── REAL ON-CHAIN ACTIONS */

async function requireReadyWallet() {
  if (!state.wallet.provider || !state.wallet.account) {
    await connectWallet();
    if (!state.wallet.account) return false;
  }
  if (state.wallet.chainId !== XLAYER_CHAIN_ID) {
    await switchToXLayerMainnet();
    if (state.wallet.chainId !== XLAYER_CHAIN_ID) return false;
  }
  return true;
}

async function submitTx({ label, data, scaleQrs = 1.0 }) {
  if (!(await requireReadyWallet())) return;
  showWalletError(null);
  try {
    const txHash = await sendTx(state.wallet.provider, {
      to: PUBLIC_EXECUTOR_ADDRESS,
      data,
      from: state.wallet.account
    });
    pushEvent({
      kind: "TxSubmitted",
      description: `${label} · tx ${txHash.slice(0, 10)}…${txHash.slice(-6)}`,
      meta: "broadcast"
    });
    queueQrs(scaleQrs);
    render();
    const receipt = await waitForReceipt(txHash);
    pushEvent({
      kind: receipt.status === "0x1" ? "TxMined" : "TxFailed",
      description: `${label} · block ${parseInt(receipt.blockNumber, 16)}`,
      meta: `${receipt.status === "0x1" ? "ok" : "failed"} · ${(parseInt(receipt.gasUsed, 16) / 1000).toFixed(1)}k gas`
    });
    await refreshBlock();
    await refreshTelemetry();
  } catch (err) {
    if (err?.code === 4001) showWalletError("You rejected the transaction.");
    else showWalletError(`Tx failed: ${err?.message ?? err}`);
  }
}

// Pick the direction opposite to the last on-chain swap so repeated clicks
// keep the pool oscillating around the active LP range instead of pushing
// the price into the PriceLimitAlreadyExceeded revert zone.
function nextSwapDirection() {
  const last = state.live.telemetry?.lastZeroForOne;
  if (typeof last !== "boolean") return true; // first swap on a fresh poll → A→B
  return !last;
}

export async function sendRealSwap() {
  const amount = 500_000_000_000_000_000_000n; // 500 tokens
  const zeroForOne = nextSwapDirection();
  await submitTx({
    label: `Real swap on X Layer (${amount / TOKEN_UNIT} tokens, ${zeroForOne ? "A→B" : "B→A"})`,
    data: encodeSwapExactInput(zeroForOne, amount)
  });
}

export async function sendRealVolatileSwap() {
  // Bigger amount → bigger pressure spike on chain.
  const amount = PUBLIC_MAX_SWAP; // 5,000 tokens (capped at contract level)
  const zeroForOne = nextSwapDirection();
  await submitTx({
    label: `Volatile swap on X Layer (${amount / TOKEN_UNIT} tokens, ${zeroForOne ? "A→B" : "B→A"})`,
    data: encodeSwapExactInput(zeroForOne, amount),
    scaleQrs: 1.2
  });
}

export async function sendRealAddLiquidity() {
  const amount = 200_000_000_000_000_000_000n; // 200 LU
  await submitTx({
    label: `Add sticky LP on X Layer (${amount / TOKEN_UNIT} LU)`,
    data: encodeAddLiquidity(amount),
    scaleQrs: 0.6
  });
}

/* ─────────────────────────────────────────────── PREVIEW (simulation, no tx) */

export function simulateSwap() {
  const baseline = state.sim.extraTelemetry ?? state.live.telemetry ?? undefined;
  const amount = BigInt(Math.round(50_000 + Math.random() * 900_000));
  const swapDirection = !(baseline?.lastZeroForOne ?? false);
  state.sim.extraTelemetry = nextTelemetry(baseline, {
    amountSpecified: swapDirection ? amount : -amount,
    zeroForOne: swapDirection,
    blockNumber: (baseline?.lastBlock ?? state.live.block ?? 0) + 1
  });
  queueQrs(1.0);
  pushEvent({
    description: `Preview swap (UI only) · fee ${formatFee(state.sim.extraTelemetry.currentFeePips)} · pressure ${state.sim.extraTelemetry.pressureBps} bps`,
    meta: "sim"
  });
  render();
}

export function simulateLiquidity() {
  const baseline = state.sim.extraTelemetry ?? liveTelemetry();
  const delta = BigInt(Math.round(250 + Math.random() * 1500)) * TOKEN_UNIT;
  state.sim.extraLpScore = scoreLiquidity({
    liquidityDelta: delta,
    pressureBps: baseline.pressureBps,
    currentScore: state.sim.extraLpScore
  });
  state.sim.lastLiquidityAt = Date.now();
  pushEvent({
    description: `Preview sticky LP (UI only) · ${fmtImmunity(delta)} · pressure ${baseline.pressureBps} bps`,
    meta: "sim"
  });
  render();
}

export function simulateEarlyExit() {
  state.sim.extraExits += 1;
  queueQrs(0.7);
  const withinWindow = state.sim.lastLiquidityAt
    ? Date.now() - state.sim.lastLiquidityAt < EARLY_EXIT_WINDOW_SECONDS * 1_000
    : false;
  pushEvent({
    description: withinWindow
      ? "Preview early exit (UI only) within sticky window"
      : "Preview stress (UI only) · withdrawal honored, signal published",
    meta: "sim"
  });
  render();
}

export function clearSim() {
  state.sim.extraTelemetry = null;
  state.sim.extraLpScore = 0n;
  state.sim.extraExits = 0;
  state.sim.lastLiquidityAt = undefined;
  pushEvent({ kind: "Wallet", description: "Sim overlay cleared — back to pure live", meta: "ui" });
  render();
}

/* ─────────────────────────────────────────────── ECG CANVAS */
function queueQrs(scale = 1) {
  // Pad consecutive QRS shapes with baseline samples so spikes stay readable.
  if (state.pendingShape.length > 0) {
    for (let i = 0; i < 14; i += 1) state.pendingShape.push(0);
  }
  for (const v of QRS_PATTERN) state.pendingShape.push(v * scale);
}

function tickTrace(intensity) {
  let next = (Math.random() - 0.5) * 0.025 + Math.sin(frameTick * 0.04) * 0.012;
  if (state.pendingShape.length > 0) next = state.pendingShape.shift();
  next *= 0.55 + intensity * 0.55;
  state.pulseTrace.shift();
  state.pulseTrace.push(next);
}

function drawGrid(w, h, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const step = 36;
  for (let x = step; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = step; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawScanline(w, h) {
  const y = (frameTick * 1.2) % (h + 60) - 30;
  const grad = ctx.createLinearGradient(0, y - 30, 0, y + 30);
  grad.addColorStop(0, "rgba(196, 255, 61, 0)");
  grad.addColorStop(0.5, "rgba(196, 255, 61, 0.08)");
  grad.addColorStop(1, "rgba(196, 255, 61, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, y - 30, w, 60);
}

function drawTrace(w, h, color, glow) {
  const baseline = h * 0.62;
  const amplitude = Math.min(h * 0.28, 92);
  const step = w / (TRACE_LENGTH - 1);

  ctx.save();
  ctx.lineWidth = 1.8;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  for (let i = 0; i < TRACE_LENGTH; i += 1) {
    const x = i * step;
    const y = baseline - state.pulseTrace[i] * amplitude;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawPulse() {
  const { canvas } = els;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = canvas.clientWidth || 480;
  const cssHeight = canvas.clientHeight || 200;
  const targetW = Math.round(cssWidth * dpr);
  const targetH = Math.round(cssHeight * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = cssWidth;
  const height = cssHeight;

  const { live, overlay, phase } = snapshot();
  const effectivePressure = (live.pressureBps ?? 0) + (overlay.pressureDeltaBps ?? 0);
  const intensity = Math.min(1, effectivePressure / 10_000);
  const colors = PHASE_COLORS[phase] ?? PHASE_COLORS.Healthy;

  if (frameTick % 2 === 0) tickTrace(intensity);

  ctx.fillStyle = "rgba(7, 8, 9, 1)";
  ctx.fillRect(0, 0, width, height);
  drawGrid(width, height, "rgba(196, 255, 61, 0.05)");
  drawScanline(width, height);
  drawTrace(width, height, colors.line, colors.glow);

  frameTick += 1;
  animationFrame = requestAnimationFrame(drawPulse);
}

/* ─────────────────────────────────────────────── BOOT */
function bindButtons() {
  $("sendRealSwap")?.addEventListener("click", sendRealSwap);
  $("sendRealVolatileSwap")?.addEventListener("click", sendRealVolatileSwap);
  $("sendRealAddLiquidity")?.addEventListener("click", sendRealAddLiquidity);
  $("simulateSwap")?.addEventListener("click", simulateSwap);
  $("simulateLiquidity")?.addEventListener("click", simulateLiquidity);
  $("simulateEarlyExit")?.addEventListener("click", simulateEarlyExit);
  $("clearSim")?.addEventListener("click", clearSim);
  $("connectWallet")?.addEventListener("click", connectWallet);
  $("switchNetwork")?.addEventListener("click", switchToXLayerMainnet);
  $("chainBadge")?.addEventListener("click", switchToXLayerMainnet);
}

async function boot() {
  bindButtons();
  render();
  animationFrame = requestAnimationFrame(drawPulse);
  // Seed a few baseline heartbeats so the trace is visible immediately.
  for (let i = 0; i < 3; i += 1) queueQrs(0.6);

  await refreshBlock();
  await refreshTelemetry();
  loadEvidence();

  setInterval(refreshBlock, POLL_BLOCK_MS);
  setInterval(refreshTelemetry, POLL_TELEMETRY_MS);
}

boot();

window.addEventListener("beforeunload", () => cancelAnimationFrame(animationFrame));
