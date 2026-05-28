import solc from "solc";
import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

import { parseEnvFile } from "./env-utils.mjs";
import { XLAYER_POOL_MANAGER } from "./hook-miner.mjs";
import { resolveDeployerSettings, validatePrivateKey } from "./check-deployer.mjs";

const root = new URL("..", import.meta.url).pathname;

export const DEFAULT_DEMO_TOKEN_SUPPLY = 1_000_000_000_000_000_000_000_000n;
export const DEFAULT_HOOK_ADDRESS = "0x0f307dc905592fbef047b8dddcc50f9415b286c0";

export function buildDemoExecutorDeployArgs({
  poolManager = XLAYER_POOL_MANAGER,
  hookAddress = DEFAULT_HOOK_ADDRESS,
  tokenSupply = DEFAULT_DEMO_TOKEN_SUPPLY
} = {}) {
  if (!ethers.isAddress(poolManager)) throw new Error(`Invalid PoolManager address: ${poolManager}`);
  if (!ethers.isAddress(hookAddress)) throw new Error(`Invalid Hook address: ${hookAddress}`);

  return [poolManager.toLowerCase(), hookAddress.toLowerCase(), BigInt(tokenSupply)];
}

function findImports(importPath) {
  const candidates = [
    importPath.startsWith("@") ? join(root, "node_modules", importPath) : undefined,
    join(root, importPath),
    join(root, "contracts", importPath),
    join(root, "node_modules", importPath)
  ].filter(Boolean);

  for (const candidate of candidates) {
    const safePath = normalize(candidate);
    if (safePath.startsWith(root) && existsSync(safePath)) {
      return { contents: readFileSync(safePath, "utf8") };
    }
  }

  return { error: `Import not found: ${importPath}` };
}

export function compileDemoExecutor() {
  const sourcePaths = ["contracts/PulseHookDemoToken.sol", "contracts/PulseHookDemoExecutor.sol"];
  const sources = Object.fromEntries(
    sourcePaths.map((path) => [path, { content: readFileSync(join(root, path), "utf8") }])
  );
  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 20_000 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const fatal = (output.errors ?? []).filter((error) => error.severity === "error");
  if (fatal.length > 0) throw new Error(fatal.map((error) => error.formattedMessage).join("\n"));

  const contract = output.contracts["contracts/PulseHookDemoExecutor.sol"].PulseHookDemoExecutor;
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`
  };
}

function readRequiredEnv(envPath) {
  if (!existsSync(envPath)) {
    throw new Error(`Missing ${envPath}. Copy .env.example to .env and set PRIVATE_KEY.`);
  }

  return parseEnvFile(readFileSync(envPath, "utf8"));
}

export async function deployDemoExecutor({ envPath = ".env", broadcast = false } = {}) {
  const env = readRequiredEnv(envPath);
  const privateKeyCheck = validatePrivateKey(env.PRIVATE_KEY);
  if (!privateKeyCheck.valid) throw new Error(privateKeyCheck.reason);

  const settings = resolveDeployerSettings(env);
  const provider = new ethers.JsonRpcProvider(settings.rpcUrl);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(settings.expectedChainId)) {
    throw new Error(`RPC chainId is ${network.chainId}, expected ${settings.expectedChainId}.`);
  }

  const hookAddress = env.HOOK_ADDRESS ?? DEFAULT_HOOK_ADDRESS;
  const [poolManager, hook, tokenSupply] = buildDemoExecutorDeployArgs({
    poolManager: env.POOL_MANAGER ?? XLAYER_POOL_MANAGER,
    hookAddress,
    tokenSupply: env.DEMO_TOKEN_SUPPLY ?? DEFAULT_DEMO_TOKEN_SUPPLY
  });
  const hookCode = await provider.getCode(hook);
  if (hookCode === "0x") {
    throw new Error(`Hook has no code at ${hook}. Deploy PulseHookV4 before deploying the demo executor.`);
  }

  const { abi, bytecode } = compileDemoExecutor();
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const txRequest = await factory.getDeployTransaction(poolManager, hook, tokenSupply);
  const [gasEstimate, balance] = await Promise.all([wallet.estimateGas(txRequest), provider.getBalance(wallet.address)]);

  if (!broadcast) {
    return {
      ok: true,
      broadcast: false,
      network: settings.networkDisplayName,
      chainId: Number(network.chainId),
      deployerAddress: wallet.address,
      deployerBalanceOkb: ethers.formatEther(balance),
      hookAddress: hook,
      tokenSupply: tokenSupply.toString(),
      gasEstimate: gasEstimate.toString(),
      message: "Dry run only. Re-run with --broadcast to deploy the demo executor."
    };
  }

  const contract = await factory.deploy(poolManager, hook, tokenSupply);
  const receipt = await contract.deploymentTransaction().wait();

  return {
    ok: receipt?.status === 1,
    broadcast: true,
    network: settings.networkDisplayName,
    chainId: Number(network.chainId),
    deployerAddress: wallet.address,
    hookAddress: hook,
    demoExecutor: await contract.getAddress(),
    transactionHash: contract.deploymentTransaction().hash,
    blockNumber: receipt?.blockNumber,
    gasUsed: receipt?.gasUsed?.toString(),
    message: receipt?.status === 1 ? "Demo executor deployment confirmed." : "Demo executor deployment failed."
  };
}

function parseBroadcastFlag(args = []) {
  return args.includes("--broadcast");
}

async function main() {
  try {
    const result = await deployDemoExecutor({ broadcast: parseBroadcastFlag(process.argv.slice(2)) });
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
  await main();
}
