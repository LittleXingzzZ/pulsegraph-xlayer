import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEvidenceUpdates,
  buildExplorerAddressUrl,
  buildExplorerTxUrl,
  parseCliArgs
} from "../scripts/update-manifest.mjs";

const manifest = {
  network: {
    explorer: "https://www.oklink.com/xlayer"
  },
  create2: {
    candidateHookAddress: "0x0f307dc905592fbef047b8dddcc50f9415b286c0"
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
    volatileSwapTx: ""
  }
};

test("buildExplorerTxUrl and buildExplorerAddressUrl target OKLink paths", () => {
  assert.equal(buildExplorerTxUrl(manifest, "0xabc"), "https://www.oklink.com/xlayer/tx/0xabc");
  assert.equal(
    buildExplorerAddressUrl(manifest, "0x0f307dc905592fbef047b8dddcc50f9415b286c0"),
    "https://www.oklink.com/xlayer/address/0x0f307dc905592fbef047b8dddcc50f9415b286c0"
  );
});

test("applyEvidenceUpdates fills common deployment and pool evidence fields", () => {
  const updated = applyEvidenceUpdates(manifest, {
    hookAddress: "0x0f307dc905592fbef047b8dddcc50f9415b286c0",
    hookDeploymentTx: "0xhook",
    verifiedSourceUrl: "https://www.oklink.com/xlayer/address/0xhook/contract",
    currency0: "0x0000000000000000000000000000000000000001",
    currency1: "0x0000000000000000000000000000000000000002",
    fee: "0x800000",
    tickSpacing: "60",
    hooks: "0x0f307dc905592fbef047b8dddcc50f9415b286c0",
    poolCreationTx: "0xpool",
    addLiquidityTx: "0xadd",
    normalSwapTx: "0xswap1",
    volatileSwapTx: "0xswap2"
  });

  assert.equal(updated.evidenceToFillAfterDeployment.hookAddress, manifest.create2.candidateHookAddress);
  assert.equal(updated.evidenceToFillAfterDeployment.hookDeploymentTx, "0xhook");
  assert.equal(updated.evidenceToFillAfterDeployment.hookDeploymentTxUrl, "https://www.oklink.com/xlayer/tx/0xhook");
  assert.equal(updated.evidenceToFillAfterDeployment.poolKey.fee, "0x800000");
  assert.equal(updated.evidenceToFillAfterDeployment.poolCreationTxUrl, "https://www.oklink.com/xlayer/tx/0xpool");
  assert.equal(manifest.evidenceToFillAfterDeployment.hookAddress, "");
});

test("parseCliArgs accepts kebab-case flags", () => {
  assert.deepEqual(parseCliArgs(["--pool-creation-tx", "0xpool", "--tick-spacing", "60"]), {
    poolCreationTx: "0xpool",
    tickSpacing: "60"
  });
});
