import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ethers } from "ethers";

import { parseEnvFile } from "../scripts/env-utils.mjs";

const envExample = parseEnvFile(readFileSync(".env.example", "utf8"));

test(".env.example defaults to the official X Layer mainnet v4 path", () => {
  assert.equal(envExample.XLAYER_NETWORK, "mainnet");
  assert.equal(envExample.XLAYER_MAINNET_RPC, "https://rpc.xlayer.tech");
  assert.equal(envExample.XLAYER_TESTNET_RPC, "https://testrpc.xlayer.tech/terigon");
});

test(".env.example address values are lowercase and ethers-compatible", () => {
  for (const key of [
    "POOL_MANAGER",
    "CREATE2_DEPLOYER",
    "POSITION_MANAGER",
    "UNIVERSAL_ROUTER",
    "UNIVERSAL_ROUTER_211",
    "QUOTER",
    "STATE_VIEW",
    "PERMIT2"
  ]) {
    assert.equal(envExample[key], envExample[key].toLowerCase(), `${key} should be lowercase`);
    assert.equal(ethers.isAddress(envExample[key]), true, `${key} should be an ethers-compatible address`);
  }
});
