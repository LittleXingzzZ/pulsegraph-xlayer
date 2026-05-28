import solc from "solc";
import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const sourcePaths = [
  "contracts/PulseHook.sol",
  "contracts/PulseHookV4.sol",
  "contracts/PulseHookDemoToken.sol",
  "contracts/PulseHookDemoExecutor.sol",
  "contracts/PulseHookDemoExecutorPublic.sol",
  "contracts/mocks/MockPoolManager.sol"
];

const sources = Object.fromEntries(
  sourcePaths.map((path) => [
    path,
    {
      content: readFileSync(join(root, path), "utf8")
    }
  ])
);

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: {
      enabled: true,
      runs: 20_000
    },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"]
      }
    }
  }
};

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

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = output.errors ?? [];
const fatal = errors.filter((error) => error.severity === "error");

for (const error of errors) {
  const prefix = error.severity === "error" ? "ERROR" : "WARN";
  console.log(`${prefix}: ${error.formattedMessage}`);
}

if (fatal.length > 0) {
  process.exitCode = 1;
} else {
  const pulse = output.contracts["contracts/PulseHook.sol"].PulseHook;
  const pulseV4 = output.contracts["contracts/PulseHookV4.sol"].PulseHookV4;
  const demoExecutor = output.contracts["contracts/PulseHookDemoExecutor.sol"].PulseHookDemoExecutor;
  const publicExecutor =
    output.contracts["contracts/PulseHookDemoExecutorPublic.sol"].PulseHookDemoExecutorPublic;
  console.log(
    `Solidity compile passed. PulseHook ABI entries: ${pulse.abi.length}; bytecode bytes: ${
      pulse.evm.bytecode.object.length / 2
    }; PulseHookV4 ABI entries: ${pulseV4.abi.length}; bytecode bytes: ${
      pulseV4.evm.bytecode.object.length / 2
    }; PulseHookDemoExecutor ABI entries: ${demoExecutor.abi.length}; bytecode bytes: ${
      demoExecutor.evm.bytecode.object.length / 2
    }; PulseHookDemoExecutorPublic ABI entries: ${publicExecutor.abi.length}; bytecode bytes: ${
      publicExecutor.evm.bytecode.object.length / 2
    }`
  );
}
