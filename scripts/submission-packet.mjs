import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_MANIFEST_PATH = "deployment/xlayer-mainnet.pending.json";

const requiredEvidencePaths = [
  "hookAddress",
  "verifiedSourceUrl",
  "poolKey.currency0",
  "poolKey.currency1",
  "poolKey.fee",
  "poolKey.tickSpacing",
  "poolKey.hooks",
  "poolCreationTx",
  "addLiquidityTx",
  "normalSwapTx",
  "volatileSwapTx",
  "demoUrl",
  "demoVideoUrl",
  "xAccount",
  "finalXPostUrl"
];

const getPath = (object, path) =>
  path.split(".").reduce((current, key) => (current && current[key] !== undefined ? current[key] : undefined), object);

const isFilled = (value) => {
  if (typeof value !== "string") return value !== undefined && value !== null;
  return value.trim().length > 0;
};

export function collectMissingEvidence(manifest) {
  const evidence = manifest.evidenceToFillAfterDeployment ?? {};

  return requiredEvidencePaths.filter((path) => !isFilled(getPath(evidence, path)));
}

export function summarizeReadiness(manifest) {
  const missing = collectMissingEvidence(manifest);

  return {
    ready: missing.length === 0,
    missingCount: missing.length,
    status: manifest.status
  };
}

export function renderSubmissionPacket(manifest, { githubUrl = "" } = {}) {
  const evidence = manifest.evidenceToFillAfterDeployment ?? {};
  const poolKey = evidence.poolKey ?? {};
  const github = githubUrl || process.env.GITHUB_URL || "";

  return [
    "Project: PulseGraph",
    "One-liner: Pool Vital Signs Protocol for Uniswap v4 on X Layer — every pool gets a 0-100 Pulse Index.",
    "Track: X Layer Build X Hook the Future",
    `Network: ${manifest.network?.name ?? "X Layer Mainnet"} (chainId ${manifest.network?.chainId ?? 196})`,
    `GitHub: ${github}`,
    `Demo: ${evidence.demoUrl ?? ""}`,
    `Demo video: ${evidence.demoVideoUrl ?? ""}`,
    `X account: ${evidence.xAccount ?? ""}`,
    `X post: ${evidence.finalXPostUrl ?? ""}`,
    `Hook contract: ${manifest.create2?.contractName ?? "PulseHookV4"}`,
    `Hook address: ${evidence.hookAddress || manifest.create2?.candidateHookAddress || ""}`,
    `Hook deployment tx: ${evidence.hookDeploymentTx ?? ""}`,
    `Verified source: ${evidence.verifiedSourceUrl ?? ""}`,
    `PoolManager: ${manifest.uniswapV4?.poolManager ?? ""}`,
    `PoolKey: currency0=${poolKey.currency0 ?? ""}, currency1=${poolKey.currency1 ?? ""}, fee=${poolKey.fee ?? ""}, tickSpacing=${poolKey.tickSpacing ?? ""}, hooks=${poolKey.hooks ?? ""}`,
    `Pool creation tx: ${evidence.poolCreationTx ?? ""}`,
    `Demo executor: ${evidence.demoExecutorAddress ?? ""}`,
    `Demo executor deployment tx: ${evidence.demoExecutorDeploymentTx ?? ""}`,
    `Add liquidity tx: ${evidence.addLiquidityTx ?? ""}`,
    `Normal swap tx: ${evidence.normalSwapTx ?? ""}`,
    `Volatile swap tx: ${evidence.volatileSwapTx ?? ""}`,
    `CREATE2 deployer: ${manifest.create2?.deployer ?? ""}`,
    `CREATE2 salt: ${manifest.create2?.candidateSalt ?? ""}`,
    `CREATE2 init code hash: ${manifest.create2?.initCodeHash ?? ""}`,
    "Mechanism: beforeSwap returns a dynamic fee override, afterSwap records pressure, afterAddLiquidity scores LP retention, and beforeRemoveLiquidity flags early exits without blocking withdrawals.",
    "Market value: PulseGraph gives wallets, launchpads, and Exchange OS markets a live, on-chain health signal for new and long-tail pools, so users can tell strong liquidity from fragile flow before they trade."
  ].join("\n");
}

export function renderMissingEvidenceReport(manifest) {
  const missing = collectMissingEvidence(manifest);
  if (missing.length === 0) return "All required deployment evidence fields are filled.";

  return [`Missing deployment evidence (${missing.length}):`, ...missing.map((field) => `- ${field}`)].join("\n");
}

async function main() {
  const manifestPath = process.argv[2] ?? DEFAULT_MANIFEST_PATH;
  const manifest = JSON.parse(readFileSync(new URL(`../${manifestPath}`, import.meta.url), "utf8"));
  const readiness = summarizeReadiness(manifest);

  console.log(renderSubmissionPacket(manifest));
  console.log("\n---\n");
  console.log(renderMissingEvidenceReport(manifest));
  console.log(`\nReady: ${readiness.ready ? "yes" : "no"} (${readiness.missingCount} missing)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
