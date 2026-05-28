import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import solc from "solc";

import { DEFAULT_MANIFEST_PATH } from "./submission-packet.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const importPattern = /import\s+(?:[^"']+from\s+)?["']([^"']+)["'];/g;

function normalizeSourceKey(value) {
  return normalize(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function sourceKeyToPath(sourceKey) {
  if (sourceKey.startsWith("@")) return join(root, "node_modules", sourceKey);
  return join(root, sourceKey);
}

function resolveImport(importPath, fromSourceKey) {
  if (importPath.startsWith("@")) return importPath;
  if (importPath.startsWith(".")) {
    return normalizeSourceKey(posix.join(posix.dirname(fromSourceKey), importPath));
  }
  return normalizeSourceKey(importPath);
}

function readSource(sourceKey) {
  const sourcePath = sourceKeyToPath(sourceKey);
  if (!existsSync(sourcePath)) throw new Error(`Missing Solidity source: ${sourceKey}`);
  return readFileSync(sourcePath, "utf8");
}

export function buildStandardJsonInput({ entrySource = "contracts/PulseHookV4.sol" } = {}) {
  const sources = {};

  function visit(sourceKey) {
    const normalizedKey = normalizeSourceKey(sourceKey);
    if (sources[normalizedKey]) return;

    const content = readSource(normalizedKey);
    sources[normalizedKey] = { content };

    for (const match of content.matchAll(importPattern)) {
      visit(resolveImport(match[1], normalizedKey));
    }
  }

  visit(entrySource);

  return {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 20_000 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"]
        }
      }
    }
  };
}

export function encodeConstructorArgs(types, values) {
  return ethers.AbiCoder.defaultAbiCoder().encode(types, values);
}

export function oklinkCompilerVersion(version = solc.version()) {
  const match = version.match(/^(\d+\.\d+\.\d+\+commit\.[0-9a-f]+)/i);
  if (!match) throw new Error(`Unsupported solc version format: ${version}`);
  return `v${match[1]}`;
}

export function buildOklinkVerificationPacket({
  manifest,
  entrySource = "contracts/PulseHookV4.sol",
  contractName = "PulseHookV4"
} = {}) {
  const hookAddress = manifest.evidenceToFillAfterDeployment?.hookAddress || manifest.create2?.candidateHookAddress;
  const poolManager = manifest.uniswapV4?.poolManager;
  if (!hookAddress) throw new Error("Manifest is missing Hook address.");
  if (!poolManager) throw new Error("Manifest is missing PoolManager address.");

  const standardJson = buildStandardJsonInput({ entrySource });
  const constructorArguments = encodeConstructorArgs(["address"], [poolManager]);

  return {
    chainShortName: manifest.network?.chainId === 1952 ? "XLAYER_TESTNET" : "XLAYER",
    contractAddress: hookAddress,
    contractName,
    sourceCode: JSON.stringify(standardJson),
    codeFormat: "solidity-standard-json-input",
    compilerVersion: oklinkCompilerVersion(),
    optimization: "1",
    optimizationRuns: "20000",
    constructorArguments: constructorArguments.slice(2)
  };
}

export function exportOklinkVerificationFiles({
  manifestPath = DEFAULT_MANIFEST_PATH,
  outputDir = "verification"
} = {}) {
  const manifest = JSON.parse(readFileSync(join(root, manifestPath), "utf8"));
  const packet = buildOklinkVerificationPacket({ manifest });
  const standardJson = JSON.parse(packet.sourceCode);
  const targetDir = join(root, outputDir);
  mkdirSync(targetDir, { recursive: true });

  const files = {
    standardJson: join(targetDir, "PulseHookV4.oklink-standard-json.json"),
    payload: join(targetDir, "PulseHookV4.oklink-payload.json"),
    constructorArgs: join(targetDir, "PulseHookV4.constructor-args.txt")
  };

  writeFileSync(files.standardJson, `${JSON.stringify(standardJson, null, 2)}\n`);
  writeFileSync(files.payload, `${JSON.stringify(packet, null, 2)}\n`);
  writeFileSync(files.constructorArgs, `${packet.constructorArguments}\n`);
  return { packet, files };
}

async function main() {
  const { packet, files } = exportOklinkVerificationFiles();
  console.log(
    JSON.stringify(
      {
        ok: true,
        contractAddress: packet.contractAddress,
        chainShortName: packet.chainShortName,
        compilerVersion: packet.compilerVersion,
        files
      },
      null,
      2
    )
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
