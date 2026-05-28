import solc from "solc";
import sha3 from "js-sha3";
import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const { keccak_256 } = sha3;
const root = new URL("..", import.meta.url).pathname;

export const XLAYER_POOL_MANAGER = "0x360e68faccca8ca495c1b759fd9eee466db9fb32";
export const DEFAULT_CREATE2_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c";
export const REQUIRED_HOOK_BITS = 0x06c0n;
export const LOW_14_BITS_MASK = 0x3fffn;
export const DEFAULT_HOOK_CONTRACT = "PulseHookV4";

const contractSources = {
  PulseHook: "contracts/PulseHook.sol",
  PulseHookV4: "contracts/PulseHookV4.sol"
};

const cleanHex = (value, bytes) => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`Expected hex string, got ${value}`);
  }

  const hex = value.slice(2).toLowerCase();
  if (bytes && hex.length !== bytes * 2) {
    throw new Error(`Expected ${bytes} bytes, got ${hex.length / 2}`);
  }
  return hex;
};

export function encodeAddressConstructorArg(address) {
  const hex = cleanHex(address, 20);
  return hex.padStart(64, "0");
}

export function saltFromNumber(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

const keccakHex = (hex) => `0x${keccak_256(Buffer.from(hex, "hex"))}`;

export function makeCreate2Address({ deployer, salt, initCodeHash }) {
  const input = `ff${cleanHex(deployer, 20)}${cleanHex(salt, 32)}${cleanHex(initCodeHash, 32)}`;
  const hash = keccakHex(input).slice(2);
  return `0x${hash.slice(-40)}`;
}

export function hasExactHookBits(address) {
  return (BigInt(address) & LOW_14_BITS_MASK) === REQUIRED_HOOK_BITS;
}

function findImports(importPath) {
  const candidates = [
    importPath.startsWith("@") ? join(root, "node_modules", importPath) : undefined,
    join(root, importPath),
    join(root, "contracts", importPath),
    join(root, "node_modules", importPath)
  ].filter(Boolean);

  for (const candidate of candidates) {
    const safePath = normalize(candidate);
    if (safePath.startsWith(root) && existsSync(safePath)) {
      return { contents: readFileSync(safePath, "utf8") };
    }
  }

  return { error: `Import not found: ${importPath}` };
}

export function compilePulseHookBytecode({ contractName = DEFAULT_HOOK_CONTRACT } = {}) {
  const sourcePath = contractSources[contractName];
  if (!sourcePath) throw new Error(`Unsupported Hook contract: ${contractName}`);

  const source = readFileSync(join(root, sourcePath), "utf8");
  const input = {
    language: "Solidity",
    sources: {
      [sourcePath]: { content: source }
    },
    settings: {
      optimizer: { enabled: true, runs: 20_000 },
      outputSelection: {
        "*": {
          "*": ["evm.bytecode.object"]
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = output.errors ?? [];
  const fatal = errors.filter((error) => error.severity === "error");
  if (fatal.length > 0) {
    throw new Error(fatal.map((error) => error.formattedMessage).join("\n"));
  }

  return output.contracts[sourcePath][contractName].evm.bytecode.object;
}

export function buildPulseHookInitCode({ bytecode, poolManager = XLAYER_POOL_MANAGER, contractName = DEFAULT_HOOK_CONTRACT } = {}) {
  return `${bytecode ?? compilePulseHookBytecode({ contractName })}${encodeAddressConstructorArg(poolManager)}`;
}

export function mineHookAddress({
  bytecode,
  poolManager = XLAYER_POOL_MANAGER,
  deployer = DEFAULT_CREATE2_DEPLOYER,
  contractName = DEFAULT_HOOK_CONTRACT,
  startSalt = 0n,
  maxIterations = 500_000
} = {}) {
  const initCode = buildPulseHookInitCode({ bytecode, poolManager, contractName });
  const initCodeHash = keccakHex(initCode);

  for (let index = 0n; index < BigInt(maxIterations); index += 1n) {
    const salt = saltFromNumber(BigInt(startSalt) + index);
    const address = makeCreate2Address({ deployer, salt, initCodeHash });
    if (hasExactHookBits(address)) {
      return {
        address,
        salt,
        saltDecimal: (BigInt(startSalt) + index).toString(),
        deployer,
        poolManager,
        contractName,
        initCodeHash,
        requiredHookBits: `0x${REQUIRED_HOOK_BITS.toString(16).padStart(4, "0")}`,
        iterations: Number(index) + 1
      };
    }
  }

  throw new Error(`No matching Hook address found in ${maxIterations} salts.`);
}

async function main() {
  const result = mineHookAddress({
    poolManager: process.env.POOL_MANAGER ?? XLAYER_POOL_MANAGER,
    deployer: process.env.CREATE2_DEPLOYER ?? DEFAULT_CREATE2_DEPLOYER,
    contractName: process.env.HOOK_CONTRACT ?? DEFAULT_HOOK_CONTRACT,
    startSalt: BigInt(process.env.START_SALT ?? "0"),
    maxIterations: Number(process.env.MAX_ITERATIONS ?? "500000")
  });

  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
