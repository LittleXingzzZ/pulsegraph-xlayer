import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

import { parseEnvFile } from "./env-utils.mjs";
import { getNetworkConfig } from "./xlayer-v4-deployments.mjs";

export { parseEnvFile } from "./env-utils.mjs";

export const MIN_REQUIRED_BALANCE_WEI = 10_000_000_000_000_000n;
export const RECOMMENDED_BALANCE_WEI = 50_000_000_000_000_000n;
export const MIN_RECOMMENDED_BALANCE_WEI = RECOMMENDED_BALANCE_WEI;
export const DEFAULT_ENV_PATH = ".env";

export function validatePrivateKey(privateKey) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey ?? "")) {
    return { valid: false, reason: "PRIVATE_KEY must be a 32-byte hex string." };
  }

  if (/^0x0{64}$/.test(privateKey)) {
    return { valid: false, reason: "PRIVATE_KEY is still the placeholder zero key." };
  }

  return { valid: true, reason: "PRIVATE_KEY format is valid." };
}

export function formatOkb(wei) {
  const whole = wei / 1_000_000_000_000_000_000n;
  const fraction = wei % 1_000_000_000_000_000_000n;
  const fractionText = fraction.toString().padStart(18, "0").replace(/0+$/, "");

  return fractionText ? `${whole}.${fractionText}` : `${whole}`;
}

export function assessBalance(
  balanceWei,
  minimumWei = MIN_REQUIRED_BALANCE_WEI,
  recommendedWei = RECOMMENDED_BALANCE_WEI
) {
  return {
    ok: balanceWei >= minimumWei,
    recommended: balanceWei >= recommendedWei,
    balanceOkb: formatOkb(balanceWei),
    minimumOkb: formatOkb(minimumWei),
    recommendedOkb: formatOkb(recommendedWei)
  };
}

export function resolveDeployerSettings(env = {}) {
  const networkName = (env.XLAYER_NETWORK || "mainnet").toLowerCase();
  const config = getNetworkConfig(networkName);
  const rpcEnvName = networkName === "mainnet" ? "XLAYER_MAINNET_RPC" : "XLAYER_TESTNET_RPC";

  return {
    networkName,
    networkDisplayName: config.name,
    expectedChainId: config.chainId,
    rpcUrl: env[rpcEnvName] || config.rpcUrl
  };
}

export async function checkDeployer({ envPath = DEFAULT_ENV_PATH } = {}) {
  if (!existsSync(envPath)) {
    return {
      ok: false,
      missingEnv: true,
      message: `Missing ${envPath}. Copy .env.example to .env and set PRIVATE_KEY.`
    };
  }

  const env = parseEnvFile(readFileSync(envPath, "utf8"));
  const privateKeyCheck = validatePrivateKey(env.PRIVATE_KEY);
  if (!privateKeyCheck.valid) {
    return {
      ok: false,
      missingEnv: false,
      message: privateKeyCheck.reason
    };
  }

  const settings = resolveDeployerSettings(env);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY);
  const provider = new ethers.JsonRpcProvider(settings.rpcUrl);
  const network = await provider.getNetwork();
  const balance = await provider.getBalance(wallet.address);
  const balanceAssessment = assessBalance(balance);
  const chainOk = network.chainId === BigInt(settings.expectedChainId);

  return {
    ok: chainOk && balanceAssessment.ok,
    missingEnv: false,
    network: settings.networkDisplayName,
    address: wallet.address,
    chainId: Number(network.chainId),
    expectedChainId: settings.expectedChainId,
    rpcUrl: settings.rpcUrl,
    ...balanceAssessment,
    message:
      !chainOk
        ? `RPC chainId is ${network.chainId}, expected ${settings.expectedChainId}.`
        : balanceAssessment.ok && balanceAssessment.recommended
          ? `Deployer is ready for ${settings.networkDisplayName} deployment.`
          : balanceAssessment.ok
            ? `Deployer has enough OKB to try (${balanceAssessment.balanceOkb}), but ${balanceAssessment.recommendedOkb} is recommended.`
            : `Deployer needs more OKB: ${balanceAssessment.balanceOkb} available, ${balanceAssessment.minimumOkb} minimum.`
  };
}

async function main() {
  const result = await checkDeployer({ envPath: process.argv[2] ?? DEFAULT_ENV_PATH });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
