import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEFAULT_MANIFEST_PATH } from "./submission-packet.mjs";

const requiredChecks = [
  { label: "GitHub repository URL", source: "githubUrl" },
  { label: "Hook contract address", path: "hookAddress" },
  { label: "Verified contract source URL", path: "verifiedSourceUrl" },
  { label: "PoolKey currency0", path: "poolKey.currency0" },
  { label: "PoolKey currency1", path: "poolKey.currency1" },
  { label: "PoolKey fee", path: "poolKey.fee" },
  { label: "PoolKey tickSpacing", path: "poolKey.tickSpacing" },
  { label: "PoolKey hooks", path: "poolKey.hooks" },
  { label: "Pool creation transaction", path: "poolCreationTx" },
  { label: "Add-liquidity transaction", path: "addLiquidityTx" },
  { label: "Normal swap transaction", path: "normalSwapTx" },
  { label: "Volatile swap transaction", path: "volatileSwapTx" },
  { label: "Demo URL", path: "demoUrl" },
  { label: "Demo video URL", path: "demoVideoUrl" },
  { label: "Project X account", path: "xAccount" },
  { label: "Final X post URL", path: "finalXPostUrl" }
];

const optionalWarningChecks = [
  { label: "Hook deployment transaction is useful for reviewer traceability", path: "hookDeploymentTx" },
  { label: "Demo executor address makes the chain demo easier to replay", path: "demoExecutorAddress" },
  { label: "Demo executor deployment transaction makes the demo setup auditable", path: "demoExecutorDeploymentTx" },
  { label: "Google Form submission timestamp should be recorded after final submit", path: "googleFormSubmittedAtUtc" }
];

const getPath = (object, path) =>
  path.split(".").reduce((current, key) => (current && current[key] !== undefined ? current[key] : undefined), object);

const isFilled = (value) => {
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null;
};

export function auditReadiness(manifest, { githubUrl = process.env.GITHUB_URL || "" } = {}) {
  const evidence = manifest.evidenceToFillAfterDeployment ?? {};
  const missing = requiredChecks
    .filter((check) => {
      if (check.source === "githubUrl") return !isFilled(githubUrl);
      return !isFilled(getPath(evidence, check.path));
    })
    .map((check) => check.label);

  const warnings = optionalWarningChecks
    .filter((check) => !isFilled(getPath(evidence, check.path)))
    .map((check) => check.label);

  return {
    ready: missing.length === 0,
    missing,
    warnings
  };
}

export function renderAuditReport(audit) {
  const missingLines =
    audit.missing.length === 0 ? ["Missing: none"] : ["Missing:", ...audit.missing.map((item) => `- ${item}`)];
  const warningLines =
    audit.warnings.length === 0 ? ["Warnings: none"] : ["Warnings:", ...audit.warnings.map((item) => `- ${item}`)];

  return [`Ready: ${audit.ready ? "yes" : "no"}`, ...missingLines, ...warningLines].join("\n");
}

export function renderExternalLinkTemplate({
  repo = "LittleXingzzZ/pulsegraph-xlayer",
  xAccount = "https://x.com/YOUR_PROJECT_ACCOUNT",
  finalXPostUrl = "https://x.com/YOUR_PROJECT_ACCOUNT/status/...",
  demoVideoUrl = "https://YOUR_VIDEO_URL"
} = {}) {
  const [owner, name] = repo.split("/");
  const demoUrl = `https://${owner}.github.io/${name}/`;

  return [
    "Next external-link fill command:",
    "```bash",
    "npm run manifest:update -- \\",
    "  --verified-source-url https://www.oklink.com/x-layer/address/0x0f307dc905592fbef047b8dddcc50f9415b286c0/contract \\",
    `  --demo-url ${demoUrl} \\`,
    `  --demo-video-url ${demoVideoUrl} \\`,
    `  --x-account ${xAccount} \\`,
    `  --final-x-post-url ${finalXPostUrl}`,
    "```",
    "",
    `Then run: GITHUB_URL=https://github.com/${repo} npm run readiness:audit`
  ].join("\n");
}

export function loadManifest(path = DEFAULT_MANIFEST_PATH) {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
}

async function main() {
  const manifestPath = process.argv[2] ?? DEFAULT_MANIFEST_PATH;
  const manifest = loadManifest(manifestPath);
  const audit = auditReadiness(manifest);

  console.log(renderAuditReport(audit));
  if (!audit.ready) {
    console.log("\n---\n");
    console.log(renderExternalLinkTemplate());
  }
  if (!audit.ready) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
