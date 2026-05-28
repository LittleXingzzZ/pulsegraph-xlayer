import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

import { buildCreate2DeploymentPacket } from "./create2-calldata.mjs";
import { parseEnvFile } from "./env-utils.mjs";
import { DEFAULT_CREATE2_DEPLOYER, DEFAULT_HOOK_CONTRACT, XLAYER_POOL_MANAGER } from "./hook-miner.mjs";
import { resolveDeployerSettings, validatePrivateKey } from "./check-deployer.mjs";

export function parseBroadcastFlag(args = []) {
  return args.includes("--broadcast");
}

export function buildCreate2DeployTx(packet) {
  return {
    to: packet.deployer,
    data: packet.calldata,
    value: 0n
  };
}

function readRequiredEnv(envPath) {
  if (!existsSync(envPath)) {
    throw new Error(`Missing ${envPath}. Copy .env.example to .env and set PRIVATE_KEY.`);
  }

  return parseEnvFile(readFileSync(envPath, "utf8"));
}

export async function deployHookWithCreate2({ envPath = ".env", broadcast = false } = {}) {
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

  const packet = buildCreate2DeploymentPacket({
    poolManager: env.POOL_MANAGER ?? XLAYER_POOL_MANAGER,
    deployer: env.CREATE2_DEPLOYER ?? DEFAULT_CREATE2_DEPLOYER,
    contractName: env.HOOK_CONTRACT ?? DEFAULT_HOOK_CONTRACT,
    networkName: settings.networkName
  });

  const txRequest = buildCreate2DeployTx(packet);
  const [hookCode, deployerCode, balance] = await Promise.all([
    provider.getCode(packet.address),
    provider.getCode(packet.deployer),
    provider.getBalance(wallet.address)
  ]);

  if (deployerCode === "0x") {
    throw new Error(`CREATE2 deployer has no code at ${packet.deployer} on ${settings.networkDisplayName}.`);
  }

  if (hookCode !== "0x") {
    return {
      ok: true,
      broadcast: false,
      alreadyDeployed: true,
      network: settings.networkDisplayName,
      chainId: Number(network.chainId),
      deployerAddress: wallet.address,
      deployerBalanceOkb: ethers.formatEther(balance),
      hookAddress: packet.address,
      message: "Hook address already has code; no transaction was sent."
    };
  }

  const gasEstimate = await wallet.estimateGas(txRequest);
  if (!broadcast) {
    return {
      ok: true,
      broadcast: false,
      alreadyDeployed: false,
      network: settings.networkDisplayName,
      chainId: Number(network.chainId),
      deployerAddress: wallet.address,
      deployerBalanceOkb: ethers.formatEther(balance),
      hookAddress: packet.address,
      gasEstimate: gasEstimate.toString(),
      message: "Dry run only. Re-run with --broadcast to deploy the Hook."
    };
  }

  const tx = await wallet.sendTransaction(txRequest);
  const receipt = await tx.wait();

  return {
    ok: receipt?.status === 1,
    broadcast: true,
    alreadyDeployed: false,
    network: settings.networkDisplayName,
    chainId: Number(network.chainId),
    deployerAddress: wallet.address,
    hookAddress: packet.address,
    transactionHash: tx.hash,
    blockNumber: receipt?.blockNumber,
    gasUsed: receipt?.gasUsed?.toString(),
    message: receipt?.status === 1 ? "Hook deployment transaction confirmed." : "Hook deployment transaction failed."
  };
}

async function main() {
  try {
    const broadcast = parseBroadcastFlag(process.argv.slice(2));
    const result = await deployHookWithCreate2({ broadcast });
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
