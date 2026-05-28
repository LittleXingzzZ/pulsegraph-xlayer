import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const requiredFiles = [
  "contracts/PulseHook.sol",
  "contracts/PulseHookV4.sol",
  "contracts/PulseHookDemoToken.sol",
  "contracts/PulseHookDemoExecutor.sol",
  "contracts/PulseHookDemoExecutorPublic.sol",
  "contracts/mocks/MockPoolManager.sol",
  "script/DeployPulseHook.s.sol",
  "script/DeployPulseHookV4.s.sol",
  "scripts/env-utils.mjs",
  "scripts/hook-miner.mjs",
  "scripts/create2-calldata.mjs",
  "scripts/check-deployer.mjs",
  "scripts/deploy-create2-hook.mjs",
  "scripts/deploy-demo-executor.mjs",
  "scripts/deploy-public-demo-executor.mjs",
  "scripts/run-demo-sequence.mjs",
  "scripts/xlayer-v4-deployments.mjs",
  "scripts/submission-packet.mjs",
  "scripts/readiness-audit.mjs",
  "scripts/export-oklink-verification.mjs",
  "scripts/release-guide.mjs",
  "scripts/update-manifest.mjs",
  "web/index.html",
  "web/styles.css",
  "web/app.js",
  "web/lib/pulseMath.mjs",
  "web/lib/xlayerClient.mjs",
  "web/abi/PulseHook.json",
  "web/abi/PulseHookDemoExecutorPublic.json",
  "verification/PulseHookV4.oklink-standard-json.json",
  "verification/PulseHookV4.oklink-payload.json",
  "verification/PulseHookV4.constructor-args.txt",
  "deployment/xlayer-mainnet.pending.json",
  "deployment/xlayer-testnet.pending.json",
  "README.md"
];

for (const file of requiredFiles) {
  const stats = statSync(join(root.pathname, file));
  assert.ok(stats.size > 0, `${file} should not be empty`);
}

const contract = read("contracts/PulseHook.sol");
const v4Contract = read("contracts/PulseHookV4.sol");
const demoExecutor = read("contracts/PulseHookDemoExecutor.sol");
for (const symbol of [
  "beforeSwap",
  "afterSwap",
  "afterAddLiquidity",
  "beforeRemoveLiquidity",
  "OVERRIDE_FEE_FLAG",
  "PoolTelemetry",
  "ProviderScore",
  "PulseObserved",
  "LiquidityScored",
  "EarlyExitFlagged"
]) {
  assert.ok(contract.includes(symbol), `PulseHook.sol should include ${symbol}`);
}

for (const symbol of ["BaseHook", "Hooks.Permissions", "LPFeeLibrary.OVERRIDE_FEE_FLAG", "PulseHookV4"]) {
  assert.ok(v4Contract.includes(symbol), `PulseHookV4.sol should include ${symbol}`);
}

for (const symbol of ["IUnlockCallback", "initializePool", "addLiquidity", "swapExactInput", "DYNAMIC_FEE_FLAG"]) {
  assert.ok(demoExecutor.includes(symbol), `PulseHookDemoExecutor.sol should include ${symbol}`);
}

const readme = read("README.md");
const readmeLower = readme.toLowerCase();
for (const requiredText of [
  "X Layer",
  "Uniswap v4",
  "PoolManager",
  "1952",
  "Demo",
  "Submission"
]) {
  assert.ok(readme.includes(requiredText), `README should mention ${requiredText}`);
}
assert.ok(
  readmeLower.includes("0x360e68faccca8ca495c1b759fd9eee466db9fb32"),
  "README should mention the X Layer PoolManager address"
);

const app = read("web/app.js");
for (const handler of ["connectWallet", "simulateSwap", "simulateLiquidity", "switchToXLayerMainnet"]) {
  assert.ok(app.includes(handler), `web/app.js should include ${handler}`);
}

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.scripts["mine:hook"], "node scripts/hook-miner.mjs");
assert.equal(packageJson.scripts["build:create2-calldata"], "node scripts/create2-calldata.mjs");
assert.equal(packageJson.scripts["check:deployer"], "node scripts/check-deployer.mjs");
assert.equal(packageJson.scripts["check:v4-deployments"], "node scripts/xlayer-v4-deployments.mjs");
assert.equal(packageJson.scripts["deploy:hook"], "node scripts/deploy-create2-hook.mjs");
assert.equal(packageJson.scripts["deploy:demo-executor"], "node scripts/deploy-demo-executor.mjs");
assert.equal(packageJson.scripts["run:demo-sequence"], "node scripts/run-demo-sequence.mjs");
assert.equal(packageJson.scripts["submission:packet"], "node scripts/submission-packet.mjs");
assert.equal(packageJson.scripts["readiness:audit"], "node scripts/readiness-audit.mjs");
assert.equal(packageJson.scripts["verification:oklink"], "node scripts/export-oklink-verification.mjs");
assert.equal(packageJson.scripts["release:guide"], "node scripts/release-guide.mjs");
assert.equal(packageJson.scripts["manifest:update"], "node scripts/update-manifest.mjs");

const deployment = JSON.parse(read("deployment/xlayer-mainnet.pending.json"));
assert.equal(deployment.network.chainId, 196);
assert.equal(deployment.network.name, "X Layer Mainnet");
assert.equal(deployment.create2.requiredHookBits, "0x06c0");
assert.match(deployment.create2.candidateHookAddress, /^0x[0-9a-f]{40}$/);
assert.equal(BigInt(deployment.create2.candidateHookAddress) & 0x3fffn, 0x06c0n);

console.log("Project validation passed.");
