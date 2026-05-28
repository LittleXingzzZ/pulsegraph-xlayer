import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CREATE2_DEPLOYER,
  REQUIRED_HOOK_BITS,
  buildPulseHookInitCode,
  encodeAddressConstructorArg,
  hasExactHookBits,
  makeCreate2Address,
  saltFromNumber
} from "../scripts/hook-miner.mjs";

test("encodeAddressConstructorArg ABI-encodes an address as one 32-byte word", () => {
  assert.equal(
    encodeAddressConstructorArg("0x360E68Faccca8cA495c1B759Fd9EEe466db9FB32"),
    "000000000000000000000000360e68faccca8ca495c1b759fd9eee466db9fb32"
  );
});

test("saltFromNumber creates a 32-byte salt", () => {
  assert.equal(saltFromNumber(7n), `0x${"0".repeat(63)}7`);
});

test("makeCreate2Address is deterministic and returns an address", () => {
  const address = makeCreate2Address({
    deployer: DEFAULT_CREATE2_DEPLOYER,
    salt: saltFromNumber(1n),
    initCodeHash: `0x${"11".repeat(32)}`
  });

  assert.match(address, /^0x[0-9a-f]{40}$/);
  assert.equal(
    address,
    makeCreate2Address({
      deployer: DEFAULT_CREATE2_DEPLOYER,
      salt: saltFromNumber(1n),
      initCodeHash: `0x${"11".repeat(32)}`
    })
  );
});

test("hasExactHookBits requires exact low permission bits", () => {
  assert.equal(hasExactHookBits(`0x${"0".repeat(36)}06c0`), true);
  assert.equal(hasExactHookBits(`0x${"0".repeat(36)}06c1`), false);
  assert.equal(hasExactHookBits(`0x${"0".repeat(36)}0ec0`), false);
  assert.equal(Number(REQUIRED_HOOK_BITS), 0x06c0);
});

test("buildPulseHookInitCode appends the PoolManager constructor argument", () => {
  const initCode = buildPulseHookInitCode({
    bytecode: "60016002",
    poolManager: "0x360E68Faccca8cA495c1B759Fd9EEe466db9FB32"
  });

  assert.equal(
    initCode,
    "60016002000000000000000000000000360e68faccca8ca495c1b759fd9eee466db9fb32"
  );
});
