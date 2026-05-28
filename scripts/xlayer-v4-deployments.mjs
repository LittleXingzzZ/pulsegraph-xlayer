import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

import { parseEnvFile } from "./env-utils.mjs";

export const REQUIRED_MAINNET_CONTRACTS = [
  "PoolManager",
  "PositionManager",
  "UniversalRouter",
  "UniversalRouter211",
  "Quoter",
  "StateView",
  "Permit2"
];

export const XLAYER_V4_NETWORKS = {
  mainnet: {
    name: "X Layer Mainnet",
    chainId: 196,
    rpcUrl: "https://rpc.xlayer.tech",
    explorer: "https://www.oklink.com/xlayer",
    officialV4: true,
    contracts: {
      PoolManager: "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
      PositionDescriptor: "0x9e9fbbef0e1bd752e83de5acff3d0c936a9e5a4b",
      PositionManager: "0xcf1eafc6928dc385a342e7c6491d371d2871458b",
      Quoter: "0x8928074ca1b241d8ec02815881c1af11e8bc5219",
      StateView: "0x76fd297e2d437cd7f76d50f01afe6160f86e9990",
      UniversalRouter: "0xda00ae15d3a71466517129255255db7c0c0956d3",
      UniversalRouter211: "0x8b844f885672f333bc0042cb669255f93a4c1e6b",
      Permit2: "0x000000000022d473030f116ddee9f6b43ac78ba3"
    }
  },
  testnet: {
    name: "X Layer Testnet",
    chainId: 1952,
    rpcUrl: "https://testrpc.xlayer.tech/terigon",
    explorer: "https://www.oklink.com/xlayer-test",
    officialV4: false,
    contracts: {}
  }
};

export function getNetworkConfig(networkName = "mainnet") {
  const config = XLAYER_V4_NETWORKS[networkName];
  if (!config) {
    const supported = Object.keys(XLAYER_V4_NETWORKS).join(", ");
    throw new Error(`Unknown network "${networkName}". Supported: ${supported}.`);
  }

  return config;
}

export function summarizeCodeChecks(checks) {
  const missing = checks.filter((check) => check.codeBytes === 0).map((check) => check.name);
  return { ok: missing.length === 0, missing };
}

function optionalEnv() {
  if (!existsSync(".env")) return {};
  return parseEnvFile(readFileSync(".env", "utf8"));
}

async function readCodeBytes(provider, address) {
  const code = await provider.getCode(address);
  return code === "0x" ? 0 : (code.length - 2) / 2;
}

export async function checkV4Deployments({ networkName = "mainnet", rpcUrl } = {}) {
  const config = getNetworkConfig(networkName);
  if (!config.officialV4) {
    return {
      ok: false,
      network: config.name,
      chainId: config.chainId,
      officialV4: false,
      checks: [],
      missing: [],
      message:
        "No official Uniswap v4 deployment is configured for this X Layer network. Use mainnet official v4 addresses or supply a self-hosted v4 stack."
    };
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl ?? config.rpcUrl);
  const network = await provider.getNetwork();
  const checks = await Promise.all(
    REQUIRED_MAINNET_CONTRACTS.map(async (name) => ({
      name,
      address: config.contracts[name],
      codeBytes: await readCodeBytes(provider, config.contracts[name])
    }))
  );
  const summary = summarizeCodeChecks(checks);
  const chainOk = network.chainId === BigInt(config.chainId);

  return {
    ok: chainOk && summary.ok,
    network: config.name,
    expectedChainId: config.chainId,
    chainId: Number(network.chainId),
    officialV4: true,
    checks,
    missing: summary.missing,
    message: !chainOk
      ? `RPC chainId is ${network.chainId}, expected ${config.chainId}.`
      : summary.ok
        ? "Official X Layer Uniswap v4 deployments are reachable."
        : `Missing deployed code for: ${summary.missing.join(", ")}.`
  };
}

async function main() {
  const env = optionalEnv();
  const networkName = process.argv[2] ?? env.XLAYER_NETWORK ?? "mainnet";
  const config = getNetworkConfig(networkName);
  const rpcEnvName = networkName === "mainnet" ? "XLAYER_MAINNET_RPC" : "XLAYER_TESTNET_RPC";
  const result = await checkV4Deployments({
    networkName,
    rpcUrl: env[rpcEnvName] ?? config.rpcUrl
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
