import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MANIFEST_PATH,
  collectMissingEvidence,
  renderSubmissionPacket,
  summarizeReadiness
} from "../scripts/submission-packet.mjs";

const baseManifest = {
  status: "pending-live-deployment",
  network: {
    name: "X Layer Testnet",
    chainId: 1952,
    rpcUrl: "https://testrpc.xlayer.tech/terigon",
    explorer: "https://www.oklink.com/xlayer-test"
  },
  uniswapV4: {
    poolManager: "0x360E68Faccca8cA495c1B759Fd9EEe466db9FB32"
  },
  create2: {
    deployer: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    requiredHookBits: "0x06c0",
    contractName: "PulseHookV4",
    candidateSalt: `0x${"0".repeat(60)}4328`,
    candidateSaltDecimal: "17192",
    candidateHookAddress: "0x0f307dc905592fbef047b8dddcc50f9415b286c0",
    initCodeHash: "0x02d7d90fec3bbb7b088690e2ccd44ce0d54ff876a61abfec24c49f8744ec454e"
  },
  evidenceToFillAfterDeployment: {
    hookAddress: "",
    verifiedSourceUrl: "",
    poolKey: {
      currency0: "",
      currency1: "",
      fee: "",
      tickSpacing: "",
      hooks: ""
    },
    poolCreationTx: "",
    addLiquidityTx: "",
    normalSwapTx: "",
    volatileSwapTx: "",
    demoUrl: "",
    demoVideoUrl: "",
    xAccount: "",
    finalXPostUrl: "",
    googleFormSubmittedAtUtc: ""
  }
};

const completeManifest = {
  ...baseManifest,
  status: "ready-for-google-form",
  evidenceToFillAfterDeployment: {
    hookAddress: "0x0f307dc905592fbef047b8dddcc50f9415b286c0",
    verifiedSourceUrl: "https://www.oklink.com/xlayer-test/address/0x0f307dc905592fbef047b8dddcc50f9415b286c0/contract",
    poolKey: {
      currency0: "0x0000000000000000000000000000000000000001",
      currency1: "0x0000000000000000000000000000000000000002",
      fee: "0x800000",
      tickSpacing: "60",
      hooks: "0x0f307dc905592fbef047b8dddcc50f9415b286c0"
    },
    poolCreationTx: "0xpool",
    addLiquidityTx: "0xadd",
    normalSwapTx: "0xswap1",
    volatileSwapTx: "0xswap2",
    demoUrl: "https://example.com/pulsehook",
    demoVideoUrl: "https://example.com/video",
    xAccount: "https://x.com/PulseHook",
    finalXPostUrl: "https://x.com/PulseHook/status/1",
    googleFormSubmittedAtUtc: "2026-05-28T20:00:00Z"
  }
};

test("collectMissingEvidence lists all deployment fields that still need proof", () => {
  const missing = collectMissingEvidence(baseManifest);

  assert.ok(missing.includes("hookAddress"));
  assert.ok(missing.includes("poolKey.currency0"));
  assert.ok(missing.includes("volatileSwapTx"));
  assert.ok(missing.includes("finalXPostUrl"));
});

test("submission packet defaults to the X Layer mainnet manifest", () => {
  assert.equal(DEFAULT_MANIFEST_PATH, "deployment/xlayer-mainnet.pending.json");
});

test("summarizeReadiness marks pending manifests as not ready", () => {
  assert.deepEqual(summarizeReadiness(baseManifest), {
    ready: false,
    missingCount: 15,
    status: "pending-live-deployment"
  });
});

test("renderSubmissionPacket includes the judging essentials when evidence is complete", () => {
  const packet = renderSubmissionPacket(completeManifest, {
    githubUrl: "https://github.com/example/pulsehook"
  });

  assert.match(packet, /Project: PulseGraph/);
  assert.match(packet, /GitHub: https:\/\/github.com\/example\/pulsehook/);
  assert.match(packet, /Hook address: 0x0f307dc905592fbef047b8dddcc50f9415b286c0/);
  assert.match(packet, /PoolKey: currency0=0x0000000000000000000000000000000000000001/);
  assert.match(packet, /Normal swap tx: 0xswap1/);
  assert.match(packet, /Volatile swap tx: 0xswap2/);
  assert.match(packet, /X post: https:\/\/x.com\/PulseHook\/status\/1/);
});
