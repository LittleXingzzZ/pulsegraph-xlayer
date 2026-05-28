import assert from "node:assert/strict";
import test from "node:test";

import { buildCreate2DeployTx, parseBroadcastFlag } from "../scripts/deploy-create2-hook.mjs";

test("buildCreate2DeployTx creates a zero-value transaction to the deterministic deployer", () => {
  const tx = buildCreate2DeployTx({
    deployer: "0x4e59b44847b379578588920ca78fbf26c0b4956c",
    calldata: "0x1234"
  });

  assert.deepEqual(tx, {
    to: "0x4e59b44847b379578588920ca78fbf26c0b4956c",
    data: "0x1234",
    value: 0n
  });
});

test("parseBroadcastFlag requires an explicit broadcast flag", () => {
  assert.equal(parseBroadcastFlag([]), false);
  assert.equal(parseBroadcastFlag(["--broadcast"]), true);
});
