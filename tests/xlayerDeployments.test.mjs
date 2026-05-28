import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_MAINNET_CONTRACTS,
  XLAYER_V4_NETWORKS,
  getNetworkConfig,
  summarizeCodeChecks
} from "../scripts/xlayer-v4-deployments.mjs";

test("X Layer mainnet registry includes the official v4 deployment addresses", () => {
  const mainnet = getNetworkConfig("mainnet");

  assert.equal(mainnet.chainId, 196);
  assert.equal(mainnet.rpcUrl, "https://rpc.xlayer.tech");
  assert.equal(mainnet.contracts.PoolManager.toLowerCase(), "0x360e68faccca8ca495c1b759fd9eee466db9fb32");
  assert.equal(mainnet.contracts.PositionManager.toLowerCase(), "0xcf1eafc6928dc385a342e7c6491d371d2871458b");
  assert.equal(mainnet.contracts.UniversalRouter.toLowerCase(), "0xda00ae15d3a71466517129255255db7c0c0956d3");
  assert.equal(mainnet.contracts.Permit2.toLowerCase(), "0x000000000022d473030f116ddee9f6b43ac78ba3");
});

test("X Layer testnet is explicitly marked as lacking official v4 deployments", () => {
  const testnet = getNetworkConfig("testnet");

  assert.equal(testnet.chainId, 1952);
  assert.equal(testnet.officialV4, false);
  assert.deepEqual(testnet.contracts, {});
});

test("summarizeCodeChecks requires code at all mainnet v4 contracts", () => {
  const goodChecks = REQUIRED_MAINNET_CONTRACTS.map((name) => ({
    name,
    address: XLAYER_V4_NETWORKS.mainnet.contracts[name],
    codeBytes: 42
  }));
  assert.deepEqual(summarizeCodeChecks(goodChecks), { ok: true, missing: [] });

  const missingOne = goodChecks.map((check) => (check.name === "PoolManager" ? { ...check, codeBytes: 0 } : check));
  assert.deepEqual(summarizeCodeChecks(missingOne), { ok: false, missing: ["PoolManager"] });
});
