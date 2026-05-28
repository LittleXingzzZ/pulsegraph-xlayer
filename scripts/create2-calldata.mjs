import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CREATE2_DEPLOYER,
  DEFAULT_HOOK_CONTRACT,
  XLAYER_POOL_MANAGER,
  buildPulseHookInitCode,
  mineHookAddress
} from "./hook-miner.mjs";
import { parseEnvFile } from "./env-utils.mjs";
import { getNetworkConfig } from "./xlayer-v4-deployments.mjs";

function optionalEnv() {
  if (!existsSync(".env")) return {};
  return parseEnvFile(readFileSync(".env", "utf8"));
}

export function buildCreate2DeploymentPacket({
  bytecode,
  poolManager = XLAYER_POOL_MANAGER,
  deployer = DEFAULT_CREATE2_DEPLOYER,
  contractName = DEFAULT_HOOK_CONTRACT,
  networkName = "mainnet",
  startSalt = 0n,
  maxIterations = 500_000
} = {}) {
  getNetworkConfig(networkName);
  const rpcEnvVar = networkName === "mainnet" ? "XLAYER_MAINNET_RPC" : "XLAYER_TESTNET_RPC";
  const mined = mineHookAddress({ bytecode, poolManager, deployer, contractName, startSalt, maxIterations });
  const initCode = buildPulseHookInitCode({ bytecode, poolManager, contractName });
  const calldata = `0x${mined.salt.slice(2)}${initCode}`;

  return {
    ...mined,
    networkName,
    calldata,
    calldataBytes: calldata.length / 2 - 1,
    castCommand: `cast send ${deployer} ${calldata} --rpc-url "$${rpcEnvVar}" --private-key "$PRIVATE_KEY"`
  };
}

async function main() {
  const env = optionalEnv();
  const packet = buildCreate2DeploymentPacket({
    poolManager: env.POOL_MANAGER ?? process.env.POOL_MANAGER ?? XLAYER_POOL_MANAGER,
    deployer: env.CREATE2_DEPLOYER ?? process.env.CREATE2_DEPLOYER ?? DEFAULT_CREATE2_DEPLOYER,
    contractName: env.HOOK_CONTRACT ?? process.env.HOOK_CONTRACT ?? DEFAULT_HOOK_CONTRACT,
    networkName: env.XLAYER_NETWORK ?? process.env.XLAYER_NETWORK ?? "mainnet",
    startSalt: BigInt(process.env.START_SALT ?? "0"),
    maxIterations: Number(process.env.MAX_ITERATIONS ?? "500000")
  });

  console.log(JSON.stringify(packet, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
