import assert from "node:assert/strict";
import test from "node:test";

import { auditReadiness, renderAuditReport, renderExternalLinkTemplate } from "../scripts/readiness-audit.mjs";

const baseManifest = {
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

test("auditReadiness reports missing hackathon evidence by category", () => {
  const audit = auditReadiness(baseManifest, { githubUrl: "" });

  assert.equal(audit.ready, false);
  assert.ok(audit.missing.includes("GitHub repository URL"));
  assert.ok(audit.missing.includes("Hook contract address"));
  assert.ok(audit.missing.includes("PoolKey currency0"));
  assert.ok(audit.missing.includes("Final X post URL"));
});

test("auditReadiness passes when all required evidence is present", () => {
  const audit = auditReadiness(
    {
      evidenceToFillAfterDeployment: {
        hookAddress: "0xhook",
        verifiedSourceUrl: "https://explorer/contract",
        poolKey: {
          currency0: "0x1",
          currency1: "0x2",
          fee: "0x800000",
          tickSpacing: "60",
          hooks: "0xhook"
        },
        poolCreationTx: "0xpool",
        addLiquidityTx: "0xadd",
        normalSwapTx: "0xswap",
        volatileSwapTx: "0xvol",
        demoUrl: "https://demo",
        demoVideoUrl: "https://video",
        xAccount: "https://x.com/PulseHook",
        finalXPostUrl: "https://x.com/PulseHook/status/1",
        googleFormSubmittedAtUtc: ""
      }
    },
    { githubUrl: "https://github.com/example/pulsehook" }
  );

  assert.equal(audit.ready, true);
  assert.deepEqual(audit.missing, []);
});

test("renderAuditReport gives a concise checklist", () => {
  const report = renderAuditReport({ ready: false, missing: ["Hook contract address"], warnings: ["Demo video missing"] });

  assert.match(report, /Ready: no/);
  assert.match(report, /Missing/);
  assert.match(report, /Warnings/);
});

test("renderExternalLinkTemplate gives the final manifest update command", () => {
  const template = renderExternalLinkTemplate({
    repo: "LittleXingzzZ/pulsegraph-xlayer",
    xAccount: "https://x.com/PulseHook",
    finalXPostUrl: "https://x.com/PulseHook/status/1",
    demoVideoUrl: "https://video.example/pulsehook"
  });

  assert.match(template, /npm run manifest:update/);
  assert.match(template, /--verified-source-url https:\/\/www\.oklink\.com\/x-layer\/address\/0x0f307dc905592fbef047b8dddcc50f9415b286c0\/contract/);
  assert.match(template, /--demo-url https:\/\/LittleXingzzZ\.github\.io\/pulsegraph-xlayer\//);
  assert.match(template, /--demo-video-url https:\/\/video\.example\/pulsehook/);
  assert.match(template, /GITHUB_URL=https:\/\/github\.com\/LittleXingzzZ\/pulsegraph-xlayer npm run readiness:audit/);
});
