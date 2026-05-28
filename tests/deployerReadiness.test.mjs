import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_REQUIRED_BALANCE_WEI,
  RECOMMENDED_BALANCE_WEI,
  assessBalance,
  parseEnvFile,
  resolveDeployerSettings,
  validatePrivateKey
} from "../scripts/check-deployer.mjs";

test("parseEnvFile reads simple KEY=value pairs and ignores comments", () => {
  const env = parseEnvFile(`
# PulseHook deployment
PRIVATE_KEY=0x${"1".repeat(64)}
XLAYER_TESTNET_RPC=https://testrpc.xlayer.tech/terigon
`);

  assert.equal(env.PRIVATE_KEY, `0x${"1".repeat(64)}`);
  assert.equal(env.XLAYER_TESTNET_RPC, "https://testrpc.xlayer.tech/terigon");
});

test("validatePrivateKey rejects placeholder or malformed keys", () => {
  assert.equal(validatePrivateKey("0x" + "0".repeat(64)).valid, false);
  assert.equal(validatePrivateKey("not-a-key").valid, false);
  assert.equal(validatePrivateKey("0x" + "1".repeat(64)).valid, true);
});

test("assessBalance treats 0.01 OKB as the minimum and 0.05 OKB as recommended", () => {
  assert.deepEqual(assessBalance(RECOMMENDED_BALANCE_WEI), {
    ok: true,
    recommended: true,
    balanceOkb: "0.05",
    minimumOkb: "0.01",
    recommendedOkb: "0.05"
  });

  assert.deepEqual(assessBalance(20_000_000_000_000_000n), {
    ok: true,
    recommended: false,
    balanceOkb: "0.02",
    minimumOkb: "0.01",
    recommendedOkb: "0.05"
  });

  assert.deepEqual(assessBalance(MIN_REQUIRED_BALANCE_WEI / 2n), {
    ok: false,
    recommended: false,
    balanceOkb: "0.005",
    minimumOkb: "0.01",
    recommendedOkb: "0.05"
  });
});

test("resolveDeployerSettings selects the intended X Layer network", () => {
  assert.deepEqual(resolveDeployerSettings({ XLAYER_NETWORK: "mainnet" }), {
    networkName: "mainnet",
    networkDisplayName: "X Layer Mainnet",
    expectedChainId: 196,
    rpcUrl: "https://rpc.xlayer.tech"
  });

  assert.deepEqual(resolveDeployerSettings({ XLAYER_NETWORK: "testnet" }), {
    networkName: "testnet",
    networkDisplayName: "X Layer Testnet",
    expectedChainId: 1952,
    rpcUrl: "https://testrpc.xlayer.tech/terigon"
  });
});
