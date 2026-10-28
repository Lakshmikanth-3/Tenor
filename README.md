# Tenor

Deliverable USDC/EURC FX forwards on Arc. A hedger locks a EUR/USD rate for a future date with an allowlisted dealer, both sides post USDC margin, and at maturity the trade settles by physical delivery of USDC and EURC in one transaction, or in cash.

Built with [Arc Studio](https://studio.arc.io)

## What you can do

- **Hedge**: pick whether you will receive or pay USD, an amount, a maturity and physical or cash settlement. See live spot, the fair forward, the allowed band and the initial margin, plus a chart of hedged against unhedged outcomes.
- **Dealer**: an allowlisted dealer signs a quote in their wallet and shares a link. No backend is involved.
- **Take a quote**: the hedger opens the link, deposits margin and locks the rate.
- **My trades**: mark-to-market, margin on both sides, margin health, margin-call countdown, and actions to mark, top up, fund a delivery leg, settle, close out and withdraw.
- **Refusal room**: eight attacks and one valid control, each run as a read-only call against the deployed contract.
- **Admin / demo** (testnet only): the feed owner pushes a test EUR/USD price.

The network can be switched between Arc Testnet and Arc Mainnet in the header. A red MAINNET badge and a wrong-network banner are shown when relevant.

## Tech stack

- React, Vite, TypeScript, Tailwind CSS
- wagmi, viem, ConnectKit
- Solidity 0.8.28 and Foundry (OpenZeppelin contracts)

## Development

Prerequisites: Bun and Foundry.

```bash
bun install
bun run dev
bun run check
bun run contracts:build
bun run contracts:test
```

Contract tests only:

```bash
forge test --match-path 'contracts/test/Tenor.*t.sol'
```

Live end-to-end run on Arc Testnet with throwaway wallets (needs keys in `/tmp/e2e/keys.json`, funded on testnet):

```bash
bun run scripts/e2e.ts
```

### Environment variables

All values are public addresses and block numbers. Vite only reads them at startup, so restart the dev server after changing them.

| Name | Purpose |
| --- | --- |
| `VITE_NETWORK_DEFAULT` | `testnet` or `mainnet`, the network used on first load |
| `VITE_TENOR_TESTNET` | Tenor contract on Arc Testnet |
| `VITE_FEED_TESTNET` | Mock EUR/USD feed on Arc Testnet |
| `VITE_EURC_TESTNET` | EURC token on Arc Testnet |
| `VITE_DEPLOY_BLOCK_TESTNET` | Block Tenor was deployed at, where event scanning starts |
| `VITE_TENOR_MAINNET` | Tenor contract on Arc Mainnet (empty until you deploy it) |
| `VITE_FEED_MAINNET` | Chainlink EUR/USD feed on Arc Mainnet |
| `VITE_EURC_MAINNET` | EURC token on Arc Mainnet |
| `VITE_DEPLOY_BLOCK_MAINNET` | Block Tenor was deployed at on Arc Mainnet |
