# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

[Brief description of what the app does and its primary use case]

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Tenor (deployed on Arc Testnet, chain 5042002)

- Tenor: `0x6b25c5ba4b1ae7d00bcb15a27d3019d2df1f12d6` (tx `0x85b06a7e65cd88a92e5f545c04f13d9db8c55292037b9b4d408cbb1355087114`)
- MockAggregator (EUR/USD, 8 dp, initial 1.1150): `0xe61921a28c3e96d4dca683f74c31045f9113d840` (tx `0x82557be2fad7782a524482aefc156f8c09058294b36647dac22495b3f7294db7`)
- Owner of both and first allowlisted dealer: `0x43DDBD19381C8Ea8C1e4670d18DdB97c43fbEFDC`
- EURC (testnet): `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`; rUsd 4%, rEur 2% (owner-set, v1 trust assumption)
- MTM is `notional*(forwardNow - rate)/rate` (intentionally not the originally requested `1 - rate/forwardNow`).
- Tests: `forge test --match-path 'contracts/test/Tenor.*t.sol'` (132 tests).

## Web app

- Pages (path routing, `src/App.tsx`): `/` Hedge, `/trades`, `/dealer`, `/quote?q=...` (signed dealer quote link), `/refusal`, `/admin` (testnet only).
- Network is switchable (testnet or mainnet) in the header; addresses come from `VITE_*` env vars (see README). Tenor is not deployed on mainnet yet.
- `src/lib/refusal.ts` runs the refusal scenarios as `eth_call` with state overrides. Storage slots are from `forge inspect Tenor storageLayout`; regenerate them if the contract layout changes.
- The Arc RPC rejects `eth_getLogs` calls with a long topic0 list as "range too large". Filter by address only and decode client-side (`src/hooks/activity.ts`).
- End-to-end run: `bun run scripts/e2e.ts` (throwaway keys in `/tmp/e2e/keys.json`); last report in `docs/e2e-report.md`.

## To Run

```bash
bun install
bun run dev
```
