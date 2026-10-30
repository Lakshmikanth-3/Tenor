# Tenor

Deliverable USDC/EURC FX forwards on Arc. A hedger locks a EUR/USD rate for a future date with an allowlisted dealer, both sides post USDC margin, and at maturity the trade settles by physical delivery of USDC and EURC in one transaction, or in cash.

Built with [Arc Studio](https://studio.arc.io)

## What you can do

- **Hedge**: pick whether you will receive or pay USD, an amount, a maturity and physical or cash settlement. See live spot, the fair forward, the allowed band and the initial margin, plus a chart of hedged against unhedged outcomes.
- **Dealer**: an allowlisted dealer signs a quote in their wallet and shares a link. No backend is involved.
- **Take a quote**: the hedger opens the link, deposits margin and locks the rate.
- **My trades**: mark-to-market, margin on both sides, margin health, margin-call countdown, and actions to mark, top up, approve and fund a delivery leg, settle, close out and withdraw. Delivery tokens can be approved before maturity so funding a leg is one transaction.
- **Earn yield on idle margin** (optional, per account, testnet): switch it on in My trades or Dealer and your free margin is held in Circle USYC instead of sitting idle. You see your USYC shares, their value in USDC, the yield you have earned and the current USYC price. Margin locked in an open trade stays plain USDC and earns nothing.
- **Refusal room**: eight attacks and one valid control, each run as a read-only call against the deployed contract.
- **Admin / demo** (testnet only): the feed owner pushes a test EUR/USD price, and the Tenor owner updates the delivery grace, cure window, mark interval and minimum tenor within the contract's bounds. If the owner points Tenor at the testnet mock vault instead of USYC, a demo card also lets anyone fund its reserve.

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

## Deployments (Arc Testnet, chain 5042002)

| | Address |
| --- | --- |
| **Tenor v2** (current, yield-bearing margin) | `0xfa9d0a455959c5fa6e57b4e3fdee9b062bacc3ee` (deployed at block 69655019, tx `0xa5307afdf43ac3ab3e167292aba851170ae67829a08e038204ccfed776af78c7`) |
| **USYC yield vault** (Circle USYC adapter, current vault of v2) | `0x3b636e4ce4d4991115cba54f57ec451702371179` |
| Mock USYC (testnet) vault, no longer used | `0xf724adeaa22f546b84e796c09734e36f13d9dd4b` (tx `0x3e3d715b218add114ef10b7c7bcebc66294d5d44f411c4003ee897687d078b4a`) |
| **Tenor v1** (kept, untouched, no yield feature) | `0x6b25c5ba4b1ae7d00bcb15a27d3019d2df1f12d6` (tx `0x85b06a7e65cd88a92e5f545c04f13d9db8c55292037b9b4d408cbb1355087114`) |
| EUR/USD mock feed (shared by v1 and v2) | `0xe61921a28c3e96d4dca683f74c31045f9113d840` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| Owner and first dealer (both versions) | `0x43DDBD19381C8Ea8C1e4670d18DdB97c43fbEFDC` |

v2 keeps the v1 risk settings in production: 900 s delivery grace and 300 s cure window are now the contract defaults. To point the app at v1 again, set `VITE_TENOR_ADDRESS_TESTNET` to the v1 address and `VITE_DEPLOY_BLOCK_TESTNET` to its deploy block (v1 has no yield feature, so the yield card will not work there).

Tenor never depends on the yield vault to mark, close out or settle a trade. The adapter source is in `contracts/adapters/USYCYieldVault.sol` (see the next section for where it came from). Full transaction hashes are in [docs/EVIDENCE.md](docs/EVIDENCE.md).

### Environment variables

All values are public addresses and block numbers. Vite only reads them at startup, so restart the dev server after changing them.

| Name | Purpose |
| --- | --- |
| `VITE_NETWORK_DEFAULT` | `testnet` or `mainnet`, the network used on first load |
| `VITE_TENOR_ADDRESS_TESTNET` | Tenor contract on Arc Testnet |
| `VITE_FEED_TESTNET` | Mock EUR/USD feed on Arc Testnet |
| `VITE_EURC_TESTNET` | EURC token on Arc Testnet |
| `VITE_DEPLOY_BLOCK_TESTNET` | Block Tenor was deployed at, where event scanning starts (v2: 69655019) |
| `VITE_TENOR_ADDRESS_MAINNET` | Tenor contract on Arc Mainnet (empty until you deploy it; the app shows a notice while it is empty) |
| `VITE_FEED_MAINNET` | Chainlink EUR/USD feed on Arc Mainnet |
| `VITE_EURC_MAINNET` | EURC token on Arc Mainnet |
| `VITE_DEPLOY_BLOCK_MAINNET` | Block Tenor was deployed at on Arc Mainnet |

## Yield-bearing margin with Circle USYC

Margin is idle capital until maturity: each side posts about 5% of the notional, so roughly 10% of the notional sits locked across both sides. On Arc Testnet, Tenor v2 lets an account put its idle margin into Circle USYC, a tokenized money-market fund, while a hedge is open.

### Design

- Optional and per account. Switch on "Earn yield on idle margin (Circle USYC)" in My trades or Dealer margin. With it off, or with no vault set, Tenor behaves exactly like v1.
- Only free margin goes into USYC. Margin locked in an open trade is always plain USDC, so marking, margin calls, close-out and settlement never wait for a redemption. Opening a trade or topping up pulls just the needed amount out of USYC.
- Yield belongs to the account that holds the USYC. The app shows your USYC shares, their value in USDC, the yield earned and the current USYC price.
- Proceeds from a settled trade come back as plain USDC and can be moved into USYC again.

### The adapter

Tenor talks to a small adapter contract, `USYCYieldVault`, which exposes deposit, redeem and the two conversion functions on top of Circle's USYC Teller. It subscribes USDC into USYC, redeems USYC back to USDC, and prices shares at the Teller's price. Only Tenor v2 can call it and it has no owner or admin function that can move funds.

The adapter source is at `contracts/adapters/USYCYieldVault.sol`. It was written outside Arc Studio, with Claude, on 2026-10-29 while Arc Studio's daily usage limit was reached, and it has not been through the review Arc Studio ran on Tenor. Tenor v2, the tests and the web app were built in Arc Studio.

### Allowlisting and limits

- USYC is permissioned. Circle has allowlisted the adapter on Arc Testnet. Tenor and its users do not need to be allowlisted: the Teller checks the holder and the redeem receiver, and the adapter is both.
- On testnet the Teller limits the adapter to 1 USDC of subscriptions and 1 USDC of redemptions per day. A deposit over the limit simply stays plain USDC and can be moved into USYC later.
- On mainnet, USYC is only for institutions outside the United States, with a 100,000 USD minimum investment (per Arc's documentation). Tenor v2 is not deployed on mainnet and the app offers no yield option there.

### Example

At the 3.4% net yield seen in testing, 10,000 USDC of margin held for 60 days earns about 10,000 x 3.4% x 60/365 = ~56 USDC. That is a testnet reading, not a promise: the USYC price moves with the fund.

## Evidence

A full real-USYC trade has run on Arc Testnet against Tenor v2: yield mode on, a 0.6 USDC deposit became 0.525449 USYC, opening a trade pulled the 0.1 USDC of locked margin out of USYC, then cash settlement and both withdrawals, ending with the contract empty. Every transaction hash is in [docs/EVIDENCE.md](docs/EVIDENCE.md). The hackathon write-up is in [docs/SUBMISSION.md](docs/SUBMISSION.md).

## Roadmap: yield-bearing margin (USYC)

Next steps are mainnet and a wider audience, both gated by USYC's permissioning.

### Arc addresses

| Contract | Mainnet | Testnet |
| --- | --- | --- |
| USYC | `0x8a5D989Bbb96929F689B0200f435f53dA42bF490` | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` |
| Teller | `0x51A8CE47dC08ba5CD19c7aa84EA6fD6664f60f9b` | `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A` |
| Entitlements | `0xb69ecb156Dc0028198028c501340d5367845ca72` | `0xcc205224862c7641930c87679e98999d23c26113` |

### Open questions

- Mainnet needs the adapter allowlisted by Circle on mainnet, and a deployment limited to eligible institutions (non-US, 100,000 USD minimum).
- Tenor pools many users' free margin, so whether one allowlisted adapter may hold USYC on behalf of several users has to be confirmed with Circle for mainnet.
- A third-party review of the adapter before it holds real funds.
