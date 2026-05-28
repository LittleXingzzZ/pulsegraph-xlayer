# PulseGraph

**Pool Vital Signs Protocol for Uniswap v4 on X Layer.**

Every Uniswap v4 pool is a living asset. PulseGraph gives it a heartbeat — a single 0–100 **Pulse Index** that any wallet, launchpad, or Exchange OS market can read to see whether a pool is healthy, stressed, or in distress. The on-chain implementation is the `PulseHookV4` contract; the brand and UI live under the PulseGraph name.

It collapses four v4 lifecycle callbacks into one composite vital sign:

| Vital sign | Source callback | What it tells the market |
| --- | --- | --- |
| **Heart Rate** — Dynamic Fee | `beforeSwap` | How urgently the pool needs to defend itself right now. |
| **Blood Pressure** — Volatility | `afterSwap` | Order-flow imbalance, EMA notional, signed pressure. |
| **Immunity** — Sticky LP Score | `afterAddLiquidity` | Quality of liquidity backing the pool, not just quantity. |
| **Stress Signal** — Early Exit | `beforeRemoveLiquidity` | Surfaces meaningful short-horizon withdrawals without ever blocking them. |

The four readings combine into the **Pulse Index** — one number that turns raw v4 callbacks into a pool-health signal users can actually act on.

## Why It Can Win

OKX just launched **Exchange OS** — permissionless custom trading markets on X Layer. Every custom market needs the same thing on day one: a way for users to tell a healthy pool from a fragile one. PulseGraph is the missing health layer.

- **Innovation:** Most v4 Hooks try to *change* trading. PulseGraph is the first to make pools *legible* — turning the v4 callback surface into a subscribable vital-signs stream.
- **Market value:** Long-tail pools, meme launches, Exchange OS markets, and launchpads all need pool-health signals to attract real users instead of mercenary flow.
- **Completion:** Live on X Layer mainnet — Hook deployed via CREATE2 with permission bits encoded in the address, demo pool initialized, real swaps and LP events captured on-chain. See Live X Layer Evidence below.
- **Demo clarity:** Pulse Index, ECG-style waveform, vital-sign breakdown, and live mainnet evidence in a single screen.

## X Layer Targets

| Item | Value |
| --- | --- |
| X Layer mainnet chain ID | `196` |
| X Layer testnet chain ID | `1952` |
| X Layer mainnet RPC | `https://rpc.xlayer.tech` |
| X Layer testnet RPC | `https://testrpc.xlayer.tech/terigon` |
| Uniswap v4 PoolManager | `0x360E68Faccca8cA495c1B759Fd9EEe466db9FB32` |
| Uniswap v4 PositionManager | `0xcf1eafc6928dc385a342e7c6491d371d2871458b` |
| Uniswap v4 Universal Router | `0xda00ae15d3a71466517129255255db7c0c0956d3` |

Uniswap's current deployment table lists these v4 contracts for X Layer mainnet. A read-only RPC check against X Layer testnet returned no code at the mainnet PoolManager address, so the strongest path is mainnet official v4 deployment unless official testnet v4 addresses are provided.

## Hook Callbacks as Vital Signs

PulseGraph's on-chain Hook (`PulseHookV4.sol`) implements the hackathon-critical callback surface and exposes each one as a vital sign:

- `beforeSwap` → **Heart Rate**: returns the latest dynamic fee with the Uniswap v4 override flag.
- `afterSwap` → **Blood Pressure**: records per-pool exponential notional, signed flow, pressure, and active fee.
- `afterAddLiquidity` → **Immunity**: scores LP deposits against the current pool pressure (sticky liquidity gets a higher multiplier).
- `beforeRemoveLiquidity` → **Stress Signal**: flags early liquidity exits without ever blocking withdrawals.

`web/lib/pulseMath.mjs` exposes `computePulseIndex({ pressureBps, swapCount, lpScore, earlyExitCount })`, the single 0–100 health score derived from those four readings. The same function is the source of truth for the demo UI and the algorithm tests, and mirrors the on-chain logic in both `PulseHook.sol` and `PulseHookV4.sol`.

The repository keeps the self-contained MVP for fast local review and includes `PulseHookV4.sol` for deployment with official `v4-core` and `v4-periphery` imports. Deploy the v4 variant with CREATE2 so the Hook address contains the required permission bits (`0x06c0`).

## Repository

```text
contracts/PulseHook.sol              Self-contained Hook MVP
contracts/PulseHookV4.sol            Official Uniswap v4 BaseHook variant
contracts/mocks/MockPoolManager.sol  Local callback driver
script/DeployPulseHookV4.s.sol       Foundry deployment scaffold
web/                                Static demo app (live + sim overlay)
tests/                              Node-native algorithm tests
verification/                       OKLink standard-json verification payload
deployment/xlayer-mainnet.pending.json   Authoritative on-chain evidence manifest
```

## Local Verification

```bash
npm run check
npm run check:v4-deployments
```

Mine a CREATE2 Hook address candidate with the correct low permission bits:

```bash
npm run mine:hook
npm run build:create2-calldata
npm run deploy:hook
npm run deploy:demo-executor
npm run run:demo-sequence
npm run manifest:update -- --hook-deployment-tx 0x... --pool-creation-tx 0x... --add-liquidity-tx 0x... --normal-swap-tx 0x... --volatile-swap-tx 0x...
npm run submission:packet
GITHUB_URL=https://github.com/LittleXingzzZ/pulsegraph-xlayer npm run readiness:audit
```

Run the demo:

```bash
npm run serve
```

Open:

```text
http://localhost:4173
```

## Deployment Path

1. Install Foundry and dependencies.
2. Copy `.env.example` to `.env`, set `PRIVATE_KEY` locally, and fund that deployer. Use mainnet OKB for the official X Layer v4 path; testnet OKB only works if official testnet v4 addresses or a self-hosted v4 stack are used.
3. Run `npm run check:deployer` and `npm run check:v4-deployments` before broadcasting. `0.01` OKB is the minimum balance check, `0.02` OKB is enough to try, and `0.05+` is the safer working balance for deployment plus several verification transactions.
4. Mine the Hook address with the mask returned by `requiredHookAddressMask()`.
5. Deploy `PulseHookV4` with the X Layer PoolManager.
6. Create a Uniswap v4 Pool using the mined Hook address.
7. Add liquidity, execute normal and volatile swaps, then capture transaction hashes.
8. Verify source on the X Layer explorer using the standard-json payload in `verification/`.
9. Capture every tx hash via `npm run manifest:update -- ...` so they land in `deployment/xlayer-mainnet.pending.json` — that file is the authoritative submission record.

Example:

```bash
forge install foundry-rs/forge-std
forge script script/DeployPulseHookV4.s.sol:DeployPulseHookV4 \
  --rpc-url "$XLAYER_MAINNET_RPC" \
  --broadcast \
  --verify \
  --private-key "$PRIVATE_KEY"
```

Current CREATE2 candidate for the official `PulseHookV4` contract:

```text
deployer: 0x4e59b44847b379578588920cA78FbF26c0B4956C
salt:    0x000000000000000000000000000000000000000000000000000000000000278c
hook:    0x0f307dc905592fbef047b8dddcc50f9415b286c0
bits:    0x06c0
```

The candidate is recorded in `deployment/xlayer-mainnet.pending.json`. Re-run `npm run mine:hook` after any Solidity bytecode change.

`npm run build:create2-calldata` prints the exact calldata and `cast send` command for the deterministic CREATE2 deployer.

`npm run deploy:hook` performs a dry run with the `.env` wallet and does not send a transaction. Re-run as `npm run deploy:hook -- --broadcast` only when the deployer wallet, selected network, and expected Hook address have been checked.

After the Hook is live, `npm run deploy:demo-executor` dry-runs a small executor that deploys two local demo ERC20 assets and can call PoolManager directly. Re-run as `npm run deploy:demo-executor -- --broadcast`, then add the deployed address to `DEMO_EXECUTOR` and dry-run `npm run run:demo-sequence`. The broadcast form of that last command produces the pool initialization, add-liquidity, normal swap, and volatile swap transaction hashes for the submission manifest.

Use `npm run manifest:update -- ...` to copy confirmed transaction hashes into `deployment/xlayer-mainnet.pending.json`. It also adds OKLink transaction and address URLs for the filled evidence.

## Demo Flow

1. Connect OKX Wallet (EIP-6963 multi-wallet picker, OKX preferred). Click `Add / switch to X Layer` if you are on the wrong chain — the badge surfaces a `WRONG CHAIN` alert when the wallet is not on chainId 196.
2. Click **Send volatile swap** — your wallet signs a real `swapExactInput` call on X Layer mainnet against the permissionless executor. Within ~10 seconds the live `getPoolTelemetry` poll picks up the new on-chain state.
3. Watch Blood Pressure spike, Heart Rate (Dynamic Fee) climb, and the **Pulse Index drop** along the ECG waveform — all values read from the deployed Hook via JSON-RPC.
4. Click **Add real LP** to deposit sticky liquidity on-chain. Immunity rises and the Pulse Index recovers toward 100.
5. The `Preview …` ghost buttons remain available for visitors without a wallet — they apply a clearly-labelled SIM overlay on top of the live values rather than replacing them.

## Live X Layer Evidence

PulseGraph is live on X Layer mainnet (chainId 196). The deployed Hook contract is `PulseHookV4`; the original owner-gated executor (used to seed the submission evidence) and the new permissionless executor (powers the live demo) share that same Hook.

```text
Hook:                       0x0f307dc905592fbef047b8dddcc50f9415b286c0
Owner-gated executor v1:    0x872d793708C03818f6FedcC10C176f6FAa550b76
Permissionless executor v2: 0xe52a5698e895DA113b217Bd8eBfF335e5635e900
Pool init tx (v1):          0x77bc01a4f0bacc90d4cbac968c8ff09f5a69ae569965522fbfe6a5caac4fb780
Add LP tx (v1):             0xe9a69e4a33cb589693a7ee64d1ad4b588a48c5b400ab072e5483d0e995c46b33
Normal swap (v1):           0x6e01709628361f5bf79263eb9cd4cb89ee856010a9a7fec55952e1daa0762c22
Volatile swap (v1):         0xf214c9cc7836c8d89028290aab96ce7c0d2901c68bb9960174deee9c41780c15
Public pool deployment:     0xfb927d4a515cb760434e1e29f3b05d07b1159f7b01d3962a8d89f23173b67e54
Public pool init:           0xe47ceb2b8468f6f6cedaf4b6abff1df5179acbe3e3da53be72e89534e8312cef
```

See `deployment/xlayer-mainnet.pending.json` for the full PoolKey, public-executor coordinates, and the OKLink URLs for every transaction.

## Submission

`deployment/xlayer-mainnet.pending.json` is the authoritative submission record — `npm run submission:packet` prints it in the form the OKX Build X Hook the Future Google Form expects. `npm run readiness:audit` re-validates that every required field (GitHub URL, verified source, demo URL, X account, final post URL, etc.) is filled.

| Field | Value |
| --- | --- |
| Project | PulseGraph |
| Track | OKX Build X Hook the Future |
| Network | X Layer mainnet (chainId 196) |
| Hook contract | `PulseHookV4` @ `0x0f307dc905592fbef047b8dddcc50f9415b286c0` ([verified ✓](https://www.oklink.com/xlayer/address/0x0f307dc905592fbef047b8dddcc50f9415b286c0/contract)) |
| Permissionless executor | `0xe52a5698e895DA113b217Bd8eBfF335e5635e900` |
| Live demo | https://littlexingzzz.github.io/pulsegraph-xlayer/ |
| Demo video | https://x.com/i/status/2060031496044581369 |
| Submission tweet | https://x.com/LittleXingzzZ/status/2060031496044581369 |

## Author & Contact

- **Builder**: LittleXing
- **GitHub**: [@LittleXingzzZ](https://github.com/LittleXingzzZ)
- **X / Twitter**: [@LittleXingzzZ](https://x.com/LittleXingzzZ)
- **Project repository**: https://github.com/LittleXingzzZ/pulsegraph-xlayer
- **Submission tweet**: https://x.com/LittleXingzzZ/status/2060031496044581369

Open an issue on GitHub or DM on X for collaboration, integration questions, or anything PulseGraph-related.

## License

[MIT](./LICENSE) — free to fork, audit, and build on.
