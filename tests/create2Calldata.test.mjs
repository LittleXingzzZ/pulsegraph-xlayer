import assert from "node:assert/strict";
import test from "node:test";

import { buildCreate2DeploymentPacket } from "../scripts/create2-calldata.mjs";

test("buildCreate2DeploymentPacket emits a mainnet RPC command by default", () => {
  const packet = buildCreate2DeploymentPacket({
    bytecode: "6000",
    maxIterations: 100_000
  });

  assert.match(packet.castCommand, /\$XLAYER_MAINNET_RPC/);
  assert.doesNotMatch(packet.castCommand, /\$XLAYER_TESTNET_RPC/);
});

test("buildCreate2DeploymentPacket can emit a testnet RPC command explicitly", () => {
  const packet = buildCreate2DeploymentPacket({
    bytecode: "6000",
    networkName: "testnet",
    maxIterations: 100_000
  });

  assert.match(packet.castCommand, /\$XLAYER_TESTNET_RPC/);
});
