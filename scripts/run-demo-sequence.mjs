import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

import { validatePrivateKey, resolveDeployerSettings } from "./check-deployer.mjs";
import { compileDemoExecutor } from "./deploy-demo-executor.mjs";
import { parseEnvFile } from "./env-utils.mjs";

export const DEFAULT_DEMO_LIQUIDITY = 10_000_000_000_000_000_000_000n;
export const DEFAULT_NORMAL_SWAP_AMOUNT = 10_000_000_000_000_000_000n;
export const DEFAULT_VOLATILE_SWAP_AMOUNT = 250_000_000_000_000_000_000n;

export function buildDemoSequence({
  liquidity = DEFAULT_DEMO_LIQUIDITY,
  normalSwapAmount = DEFAULT_NORMAL_SWAP_AMOUNT,
  volatileSwapAmount = DEFAULT_VOLATILE_SWAP_AMOUNT,
  skipInitialize = false,
  onlyStep = ""
} = {}) {
  const steps = [];
  if (!skipInitialize) {
    steps.push({ name: "initializePool", method: "initializePool", args: [] });
  }
  steps.push({ name: "addLiquidity", method: "addLiquidity", args: [BigInt(liquidity)] });
  steps.push({ name: "normalSwap", method: "swapExactInput", args: [true, BigInt(normalSwapAmount)] });
  steps.push({ name: "volatileSwap", method: "swapExactInput", args: [false, BigInt(volatileSwapAmount)] });

  if (!onlyStep) return steps;

  const selected = steps.filter((step) => step.name === onlyStep);
  if (selected.length === 0) {
    throw new Error(`Unknown demo sequence step: ${onlyStep}`);
  }
  return selected;
}

function readRequiredEnv(envPath) {
  if (!existsSync(envPath)) {
    throw new Error(`Missing ${envPath}. Copy .env.example to .env and set PRIVATE_KEY.`);
  }

  return parseEnvFile(readFileSync(envPath, "utf8"));
}

function parseBroadcastFlag(args = []) {
  return args.includes("--broadcast");
}

function parseOnlyStep(args = []) {
  const stepFlagAt = args.indexOf("--step");
  if (stepFlagAt === -1) return "";
  return args[stepFlagAt + 1] ?? "";
}

function serializeValue(value) {
  return typeof value === "bigint" ? value.toString() : value;
}

export async function runDemoSequence({ envPath = ".env", broadcast = false } = {}) {
  const env = readRequiredEnv(envPath);
  const privateKeyCheck = validatePrivateKey(env.PRIVATE_KEY);
  if (!privateKeyCheck.valid) throw new Error(privateKeyCheck.reason);
  if (!env.DEMO_EXECUTOR || !ethers.isAddress(env.DEMO_EXECUTOR)) {
    throw new Error("Missing DEMO_EXECUTOR in .env. Deploy the demo executor first.");
  }

  const settings = resolveDeployerSettings(env);
  const provider = new ethers.JsonRpcProvider(settings.rpcUrl);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(settings.expectedChainId)) {
    throw new Error(`RPC chainId is ${network.chainId}, expected ${settings.expectedChainId}.`);
  }

  const executorCode = await provider.getCode(env.DEMO_EXECUTOR);
  if (executorCode === "0x") {
    throw new Error(`Demo executor has no code at ${env.DEMO_EXECUTOR}.`);
  }

  const { abi } = compileDemoExecutor();
  const executor = new ethers.Contract(env.DEMO_EXECUTOR, abi, wallet);
  const steps = buildDemoSequence({
    liquidity: env.DEMO_LIQUIDITY ?? DEFAULT_DEMO_LIQUIDITY,
    normalSwapAmount: env.DEMO_NORMAL_SWAP_AMOUNT ?? DEFAULT_NORMAL_SWAP_AMOUNT,
    volatileSwapAmount: env.DEMO_VOLATILE_SWAP_AMOUNT ?? DEFAULT_VOLATILE_SWAP_AMOUNT,
    skipInitialize: env.DEMO_SKIP_INITIALIZE === "true",
    onlyStep: env.DEMO_SEQUENCE_STEP ?? process.env.DEMO_SEQUENCE_STEP ?? ""
  });

  const results = [];
  for (const step of steps) {
    const txRequest = await executor[step.method].populateTransaction(...step.args);
    const gasEstimate = await wallet.estimateGas(txRequest);
    if (!broadcast) {
      results.push({
        name: step.name,
        method: step.method,
        args: step.args.map(serializeValue),
        gasEstimate: gasEstimate.toString(),
        broadcast: false
      });
      continue;
    }

    const tx = await wallet.sendTransaction(txRequest);
    const receipt = await tx.wait();
    results.push({
      name: step.name,
      method: step.method,
      args: step.args.map(serializeValue),
      transactionHash: tx.hash,
      blockNumber: receipt?.blockNumber,
      gasUsed: receipt?.gasUsed?.toString(),
      ok: receipt?.status === 1,
      broadcast: true
    });
    if (receipt?.status !== 1) break;
  }

  return {
    ok: results.every((result) => result.ok !== false),
    broadcast,
    network: settings.networkDisplayName,
    chainId: Number(network.chainId),
    demoExecutor: env.DEMO_EXECUTOR,
    results,
    message: broadcast
      ? "Demo sequence transactions completed. Copy the transaction hashes into the deployment manifest."
      : "Dry run only. Re-run with --broadcast to execute the demo sequence."
  };
}

async function main() {
  try {
    const result = await runDemoSequence({ broadcast: parseBroadcastFlag(process.argv.slice(2)) });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const onlyStep = parseOnlyStep(process.argv.slice(2));
  if (onlyStep) process.env.DEMO_SEQUENCE_STEP = onlyStep;
  await main();
}
