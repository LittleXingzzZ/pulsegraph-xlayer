import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEFAULT_MANIFEST_PATH } from "./submission-packet.mjs";

const flagMap = {
  "hook-address": "hookAddress",
  "hook-deployment-tx": "hookDeploymentTx",
  "verified-source-url": "verifiedSourceUrl",
  currency0: "currency0",
  currency1: "currency1",
  fee: "fee",
  "tick-spacing": "tickSpacing",
  hooks: "hooks",
  "pool-creation-tx": "poolCreationTx",
  "demo-executor": "demoExecutorAddress",
  "demo-executor-address": "demoExecutorAddress",
  "demo-executor-tx": "demoExecutorDeploymentTx",
  "demo-executor-deployment-tx": "demoExecutorDeploymentTx",
  "add-liquidity-tx": "addLiquidityTx",
  "normal-swap-tx": "normalSwapTx",
  "volatile-swap-tx": "volatileSwapTx",
  "demo-url": "demoUrl",
  "demo-video-url": "demoVideoUrl",
  "x-account": "xAccount",
  "final-x-post-url": "finalXPostUrl",
  "google-form-submitted-at-utc": "googleFormSubmittedAtUtc"
};

const txFields = [
  "hookDeploymentTx",
  "poolCreationTx",
  "demoExecutorDeploymentTx",
  "addLiquidityTx",
  "normalSwapTx",
  "volatileSwapTx"
];

export function buildExplorerTxUrl(manifest, txHash) {
  if (!txHash) return "";
  return `${manifest.network?.explorer ?? "https://www.oklink.com/xlayer"}/tx/${txHash}`;
}

export function buildExplorerAddressUrl(manifest, address) {
  if (!address) return "";
  return `${manifest.network?.explorer ?? "https://www.oklink.com/xlayer"}/address/${address}`;
}

export function parseCliArgs(args = []) {
  const updates = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "manifest") {
      index += 1;
      continue;
    }

    const mappedKey = flagMap[key];
    if (!mappedKey) throw new Error(`Unknown flag: --${key}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    updates[mappedKey] = value;
    index += 1;
  }

  return updates;
}

export function manifestPathFromArgs(args = []) {
  const index = args.indexOf("--manifest");
  return index === -1 ? DEFAULT_MANIFEST_PATH : args[index + 1];
}

export function applyEvidenceUpdates(manifest, updates = {}) {
  const next = structuredClone(manifest);
  const evidence = {
    ...(next.evidenceToFillAfterDeployment ?? {}),
    poolKey: {
      ...(next.evidenceToFillAfterDeployment?.poolKey ?? {})
    }
  };

  for (const [key, value] of Object.entries(updates)) {
    if (["currency0", "currency1", "fee", "tickSpacing", "hooks"].includes(key)) {
      evidence.poolKey[key] = value;
    } else {
      evidence[key] = value;
    }
  }

  if (!evidence.hookAddress && next.create2?.candidateHookAddress) {
    evidence.hookAddress = next.create2.candidateHookAddress;
  }
  if (!evidence.poolKey.hooks && evidence.hookAddress) {
    evidence.poolKey.hooks = evidence.hookAddress;
  }
  if (evidence.hookAddress && !evidence.hookAddressUrl) {
    evidence.hookAddressUrl = buildExplorerAddressUrl(next, evidence.hookAddress);
  }
  if (evidence.demoExecutorAddress && !evidence.demoExecutorAddressUrl) {
    evidence.demoExecutorAddressUrl = buildExplorerAddressUrl(next, evidence.demoExecutorAddress);
  }

  for (const field of txFields) {
    const value = evidence[field];
    const urlField = `${field}Url`;
    if (value && !evidence[urlField]) {
      evidence[urlField] = buildExplorerTxUrl(next, value);
    }
  }

  next.evidenceToFillAfterDeployment = evidence;
  return next;
}

async function main() {
  const args = process.argv.slice(2);
  const manifestPath = manifestPathFromArgs(args);
  if (!manifestPath) throw new Error("Missing value for --manifest");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const updates = parseCliArgs(args);
  const updated = applyEvidenceUpdates(manifest, updates);
  writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`Updated ${manifestPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
