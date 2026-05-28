import solc from "solc";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

import { parseEnvFile } from "./env-utils.mjs";
import { XLAYER_POOL_MANAGER } from "./hook-miner.mjs";
import { resolveDeployerSettings, validatePrivateKey } from "./check-deployer.mjs";

const root = new URL("..", import.meta.url).pathname;

export const DEFAULT_DEMO_TOKEN_SUPPLY = 1_000_000_000_000_000_000_000_000n; // 1e24
export const DEFAULT_HOOK_ADDRESS = "0x0f307dc905592fbef047b8dddcc50f9415b286c0";
// Initial demo liquidity for the new permissionless pool: 1,000 LU.
export const DEFAULT_INITIAL_LIQUIDITY = 1_000_000_000_000_000_000_000n; // 1e21

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

export function compilePublicDemoExecutor() {
  const sourcePaths = [
    "contracts/PulseHookDemoToken.sol",
    "contracts/PulseHookDemoExecutorPublic.sol"
  ];
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

  const contract =
    output.contracts["contracts/PulseHookDemoExecutorPublic.sol"].PulseHookDemoExecutorPublic;
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

function buildArgs({
  poolManager = XLAYER_POOL_MANAGER,
  hookAddress = DEFAULT_HOOK_ADDRESS,
  tokenSupply = DEFAULT_DEMO_TOKEN_SUPPLY
} = {}) {
  if (!ethers.isAddress(poolManager)) throw new Error(`Invalid PoolManager: ${poolManager}`);
  if (!ethers.isAddress(hookAddress)) throw new Error(`Invalid Hook: ${hookAddress}`);
  return [poolManager.toLowerCase(), hookAddress.toLowerCase(), BigInt(tokenSupply)];
}

function parseArgs(argv = []) {
  return {
    broadcast: argv.includes("--broadcast"),
    initAfter: argv.includes("--init"),
    writeManifest: argv.includes("--write-manifest")
  };
}

export async function deployPublicDemoExecutor({ envPath = ".env", broadcast = false, initAfter = false, writeManifest = false } = {}) {
  const env = readRequiredEnv(envPath);
  const pkCheck = validatePrivateKey(env.PRIVATE_KEY);
  if (!pkCheck.valid) throw new Error(pkCheck.reason);

  const settings = resolveDeployerSettings(env);
  const provider = new ethers.JsonRpcProvider(settings.rpcUrl);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(settings.expectedChainId)) {
    throw new Error(`RPC chainId is ${network.chainId}, expected ${settings.expectedChainId}.`);
  }

  const hookAddress = env.HOOK_ADDRESS ?? DEFAULT_HOOK_ADDRESS;
  const [poolManager, hook, tokenSupply] = buildArgs({
    poolManager: env.POOL_MANAGER ?? XLAYER_POOL_MANAGER,
    hookAddress,
    tokenSupply: env.DEMO_TOKEN_SUPPLY ?? DEFAULT_DEMO_TOKEN_SUPPLY
  });
  const hookCode = await provider.getCode(hook);
  if (hookCode === "0x") {
    throw new Error(`Hook has no code at ${hook}.`);
  }

  const { abi, bytecode } = compilePublicDemoExecutor();
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const txRequest = await factory.getDeployTransaction(poolManager, hook, tokenSupply);
  const [gasEstimate, balance, feeData] = await Promise.all([
    wallet.estimateGas(txRequest),
    provider.getBalance(wallet.address),
    provider.getFeeData()
  ]);
  const estCostWei = gasEstimate * (feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n);

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
      gasPriceWei: (feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n).toString(),
      estCostOkb: ethers.formatEther(estCostWei),
      message: "Dry run only. Re-run with --broadcast --init to deploy + initialize the pool."
    };
  }

  const contract = await factory.deploy(poolManager, hook, tokenSupply);
  const deployReceipt = await contract.deploymentTransaction().wait();
  const executorAddress = await contract.getAddress();
  const tokenA = await contract.tokenA();
  const tokenB = await contract.tokenB();
  const poolKey = await contract.poolKey();
  const poolKeyTuple = {
    currency0: poolKey[0],
    currency1: poolKey[1],
    fee: Number(poolKey[2]),
    tickSpacing: Number(poolKey[3]),
    hooks: poolKey[4]
  };
  const poolId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [poolKeyTuple.currency0, poolKeyTuple.currency1, poolKeyTuple.fee, poolKeyTuple.tickSpacing, poolKeyTuple.hooks]
    )
  );

  const out = {
    ok: deployReceipt?.status === 1,
    broadcast: true,
    network: settings.networkDisplayName,
    chainId: Number(network.chainId),
    deployerAddress: wallet.address,
    hookAddress: hook,
    publicExecutor: {
      address: executorAddress,
      deploymentTx: contract.deploymentTransaction().hash,
      tokenA,
      tokenB,
      poolKey: poolKeyTuple,
      poolId
    },
    gasUsed: deployReceipt?.gasUsed?.toString()
  };

  if (initAfter) {
    const c = new ethers.Contract(executorAddress, abi, wallet);
    const initTx = await c.initializePool();
    const initReceipt = await initTx.wait();
    const addTx = await c.addLiquidity(DEFAULT_INITIAL_LIQUIDITY);
    const addReceipt = await addTx.wait();
    out.publicExecutor.initTx = initTx.hash;
    out.publicExecutor.addLiquidityTx = addTx.hash;
    out.publicExecutor.initBlock = initReceipt?.blockNumber;
    out.publicExecutor.addLiquidityBlock = addReceipt?.blockNumber;
    out.publicExecutor.initialLiquidity = DEFAULT_INITIAL_LIQUIDITY.toString();
  }

  if (writeManifest) {
    const manifestPath = join(root, "deployment/xlayer-mainnet.pending.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.publicExecutor = {
      ...out.publicExecutor,
      explorer: {
        address: `https://www.oklink.com/xlayer/address/${executorAddress}`,
        deploymentTx: `https://www.oklink.com/xlayer/tx/${out.publicExecutor.deploymentTx}`,
        ...(out.publicExecutor.initTx && { initTx: `https://www.oklink.com/xlayer/tx/${out.publicExecutor.initTx}` }),
        ...(out.publicExecutor.addLiquidityTx && {
          addLiquidityTx: `https://www.oklink.com/xlayer/tx/${out.publicExecutor.addLiquidityTx}`
        })
      }
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    out.manifestUpdated = manifestPath;
  }

  out.message = out.ok ? "Public demo executor deployed." : "Deployment failed.";
  return out;
}

async function main() {
  try {
    const { broadcast, initAfter, writeManifest } = parseArgs(process.argv.slice(2));
    const result = await deployPublicDemoExecutor({ broadcast, initAfter, writeManifest });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.log(
      JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }, null, 2)
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
