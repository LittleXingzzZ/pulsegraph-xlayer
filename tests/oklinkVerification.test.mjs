import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOklinkVerificationPacket,
  buildStandardJsonInput,
  encodeConstructorArgs
} from "../scripts/export-oklink-verification.mjs";

const manifest = {
  network: { chainId: 196 },
  uniswapV4: {
    poolManager: "0x360e68faccca8ca495c1b759fd9eee466db9fb32"
  },
  evidenceToFillAfterDeployment: {
    hookAddress: "0x0f307dc905592fbef047b8dddcc50f9415b286c0"
  }
};

test("buildStandardJsonInput includes PulseHookV4 and imported Uniswap sources", () => {
  const input = buildStandardJsonInput({ entrySource: "contracts/PulseHookV4.sol" });

  assert.equal(input.language, "Solidity");
  assert.ok(input.sources["contracts/PulseHookV4.sol"].content.includes("contract PulseHookV4"));
  assert.ok(input.sources["@uniswap/v4-periphery/src/utils/BaseHook.sol"].content.includes("abstract contract BaseHook"));
  assert.equal(input.settings.optimizer.enabled, true);
  assert.equal(input.settings.optimizer.runs, 20_000);
});

test("encodeConstructorArgs ABI-encodes the PoolManager address", () => {
  assert.equal(
    encodeConstructorArgs(["address"], ["0x360e68faccca8ca495c1b759fd9eee466db9fb32"]),
    "0x000000000000000000000000360e68faccca8ca495c1b759fd9eee466db9fb32"
  );
});

test("buildOklinkVerificationPacket targets the deployed Hook on X Layer", () => {
  const packet = buildOklinkVerificationPacket({ manifest });

  assert.equal(packet.chainShortName, "XLAYER");
  assert.equal(packet.contractAddress, "0x0f307dc905592fbef047b8dddcc50f9415b286c0");
  assert.equal(packet.contractName, "PulseHookV4");
  assert.equal(packet.compilerVersion, "v0.8.35+commit.47b9dedd");
  assert.equal(packet.codeFormat, "solidity-standard-json-input");
  assert.equal(packet.optimization, "1");
  assert.equal(packet.optimizationRuns, "20000");
  assert.ok(packet.sourceCode.includes("contracts/PulseHookV4.sol"));
  assert.equal(packet.constructorArguments, "000000000000000000000000360e68faccca8ca495c1b759fd9eee466db9fb32");
});
