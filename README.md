# Tenor

Deliverable USDC/EURC FX forwards on Arc. A hedger locks a EUR/USD rate for a future date with an allowlisted dealer, both sides post USDC margin, and at maturity the trade settles by physical delivery of USDC and EURC in one transaction, or in cash.

Built with [Arc Studio](https://studio.arc.io)

## What you can do

- **Hedge**: pick whether you will receive or pay USD, an amount, a maturity and physical or cash settlement. See live spot, the fair forward, the allowed band and the initial margin, plus a chart of hedged against unhedged outcomes.
- **Dealer**: an allowlisted dealer signs a quote in their wallet and shares a link. No backend is involved.
- **Take a quote**: the hedger opens the link, deposits margin and locks the rate.
- **My trades**: mark-to-market, margin on both sides, margin health, margin-call countdown, and actions to mark, top up, approve and fund a delivery leg, settle, close out and withdraw. Delivery tokens can be approved before maturity so funding a leg is one transaction.
- **Refusal room**: eight attacks and one valid control, each run as a read-only call against the deployed contract.
- **Admin / demo** (testnet only): the feed owner pushes a test EUR/USD price, and the Tenor owner updates the delivery grace, cure window, mark interval and minimum tenor within the contract's bounds.

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
| `VITE_TENOR_ADDRESS_TESTNET` | Tenor contract on Arc Testnet |
| `VITE_FEED_TESTNET` | Mock EUR/USD feed on Arc Testnet |
| `VITE_EURC_TESTNET` | EURC token on Arc Testnet |
| `VITE_DEPLOY_BLOCK_TESTNET` | Block Tenor was deployed at, where event scanning starts |
| `VITE_TENOR_ADDRESS_MAINNET` | Tenor contract on Arc Mainnet (empty until you deploy it; the app shows a notice while it is empty) |
| `VITE_FEED_MAINNET` | Chainlink EUR/USD feed on Arc Mainnet |
| `VITE_EURC_MAINNET` | EURC token on Arc Mainnet |
| `VITE_DEPLOY_BLOCK_MAINNET` | Block Tenor was deployed at on Arc Mainnet |

## Roadmap: yield-bearing margin (USYC)

Not built yet. Version 1 keeps all margin in USDC.

### Problem

Initial and variation margin is idle capital until maturity. Each side posts about 5% of the notional, so roughly 10% of notional is locked across both sides. A 100,000 USDC hedge held for 60 days ties up about 10,000 USDC that earns nothing.

### Design

- Margin can be held as USYC, Circle's tokenized money-market fund, using the Teller to deposit USDC and redeem back to it.
- Margin value is the USYC balance multiplied by the USYC price, so margin calls and health checks stay in USDC terms.
- Each party keeps the yield on its own margin.
- A USDC buffer (for example 20% of each party's margin) stays liquid, so margin calls and close-outs never wait for a redemption.

### Arc addresses

| Contract | Mainnet | Testnet |
| --- | --- | --- |
| USYC | `0x8a5D989Bbb96929F689B0200f435f53dA42bF490` | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` |
| Teller | `0x51A8CE47dC08ba5CD19c7aa84EA6fD6664f60f9b` | `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A` |
| Entitlements | `0xb69ecb156Dc0028198028c501340d5367845ca72` | `0xcc205224862c7641930c87679e98999d23c26113` |

### Constraints

- USYC is permissioned. The Tenor contract and every user must be allowlisted before they can hold or redeem it.
- On mainnet, USYC is for institutions outside the United States, with a 100,000 USD minimum investment (per Arc's documentation).
- Because of this, version 1 keeps margin in USDC. Yield-bearing margin would need a permissioned deployment or an opt-in mode for eligible users.

### Example

10,000 USDC of margin earning about 4.5% a year for 60 days earns roughly 10,000 × 0.045 × 60 / 365 ≈ 74 USDC in total, about 37 USDC per side. The 4.5% is an illustration, not a quote.
