# Tenor

Deliverable USDC/EURC FX forwards on Arc. A hedger locks a EUR/USD rate for a future date with an allowlisted dealer, both sides post USDC margin, and at maturity the trade settles by physical delivery of USDC and EURC in one transaction, or in cash.

Built with [Arc Studio](https://studio.arc.io)

## What you can do

- **Hedge**: pick whether you will receive or pay USD, an amount, a maturity and physical or cash settlement. See live spot, the fair forward, the allowed band and the initial margin, plus a chart of hedged against unhedged outcomes.
- **Dealer**: an allowlisted dealer signs a quote in their wallet and shares a link. No backend is involved.
- **Take a quote**: the hedger opens the link, deposits margin and locks the rate.
- **My trades**: mark-to-market, margin on both sides, margin health, margin-call countdown, and actions to mark, top up, approve and fund a delivery leg, settle, close out and withdraw. Delivery tokens can be approved before maturity so funding a leg is one transaction.
- **Earn yield on idle margin** (optional, per account, testnet): switch it on in My trades or Dealer and your free margin is held in a yield vault (labelled Mock USYC (testnet)) instead of sitting idle. You see the APY, what is in the vault and the yield you have earned. Margin locked in an open trade stays plain USDC and earns nothing.
- **Refusal room**: eight attacks and one valid control, each run as a read-only call against the deployed contract.
- **Admin / demo** (testnet only): the feed owner pushes a test EUR/USD price, and the Tenor owner updates the delivery grace, cure window, mark interval and minimum tenor within the contract's bounds, and anyone can fund the demo yield vault's reserve (the vault owner can also bump its share price).

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
| Mock USYC (testnet) vault | `0xf724adeaa22f546b84e796c09734e36f13d9dd4b` (tx `0x3e3d715b218add114ef10b7c7bcebc66294d5d44f411c4003ee897687d078b4a`) |
| Tenor v1 (kept, untouched) | `0x6b25c5ba4b1ae7d00bcb15a27d3019d2df1f12d6` (tx `0x85b06a7e65cd88a92e5f545c04f13d9db8c55292037b9b4d408cbb1355087114`) |
| EUR/USD mock feed (shared by v1 and v2) | `0xe61921a28c3e96d4dca683f74c31045f9113d840` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| Owner and first dealer (both versions) | `0x43DDBD19381C8Ea8C1e4670d18DdB97c43fbEFDC` |

v2 keeps the v1 risk settings in production: 900 s delivery grace and 300 s cure window are now the contract defaults. To point the app at v1 again, set `VITE_TENOR_ADDRESS_TESTNET` to the v1 address and `VITE_DEPLOY_BLOCK_TESTNET` to its deploy block (v1 has no yield feature, so the yield card will not work there).

The demo vault does not invest anything. Its share price grows 4.5% a year by formula, and accrued yield is only redeemable from USDC that has been funded to its reserve (Admin / demo, "Fund reserve"). Tenor itself never depends on the vault to mark, close out or settle a trade.

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

## Roadmap: yield-bearing margin (USYC)

Status: built and live on Arc Testnet with a mock vault. The real USYC integration is waiting for Circle allowlisting and is not available yet. Testnet only until real USYC access.

### Problem

Initial and variation margin is idle capital until maturity. Each side posts about 5% of the notional, so roughly 10% of notional is locked across both sides. A 100,000 USDC hedge held for 60 days ties up about 10,000 USDC that earns nothing.

### What exists today (v2)

- Opt-in per account. When on, an account's free margin is held as vault shares and only that account earns the yield.
- Margin locked in an open trade is always plain USDC, so marking, margin calls, close-out and settlement never wait for a redemption.
- The owner sets the vault address. A zero address turns the feature off and Tenor behaves exactly like v1.
- The testnet vault is "Mock USYC (testnet)": an ERC-4626 vault over testnet USDC with a share price that grows 4.5% a year, because real testnet USYC needs Circle allowlisting that is still pending.

### How a real USYC adapter would work

Tenor talks to any vault with deposit, redeem, convertToAssets and convertToShares. Real USYC is not an ERC-4626 vault, so an adapter contract would sit in between and expose that interface:

- deposit: take USDC from Tenor, subscribe through the USYC Teller and hold the USYC.
- redeem: redeem USYC through the Teller and send the USDC back to Tenor.
- convertToAssets and convertToShares: use the USYC price the Teller applies, so the value of an account's shares is always shown in USDC.
- The adapter (or Tenor, depending on who holds the USYC) must be allowlisted in the Entitlements contract before it can hold or redeem USYC.
- The Teller's real subscription and redemption rules, timing and liquidity limits have to be checked against Circle's USYC documentation before building. They are not assumed here.

### Arc addresses

| Contract | Mainnet | Testnet |
| --- | --- | --- |
| USYC | `0x8a5D989Bbb96929F689B0200f435f53dA42bF490` | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` |
| Teller | `0x51A8CE47dC08ba5CD19c7aa84EA6fD6664f60f9b` | `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A` |
| Entitlements | `0xb69ecb156Dc0028198028c501340d5367845ca72` | `0xcc205224862c7641930c87679e98999d23c26113` |

### Constraints

- USYC is permissioned. Every holder must be allowlisted before it can hold or redeem USYC.
- On mainnet, USYC is only for institutions outside the United States, with a 100,000 USD minimum investment (per Arc's documentation).
- Tenor pools many users' free margin, so whether one allowlisted contract may hold USYC on behalf of several users has to be confirmed with Circle first. If it may not, yield mode would need a permissioned deployment limited to eligible institutions.
- Mainnet is out of scope until real USYC access exists: Tenor v2 is not deployed on mainnet and the app shows no yield option there.

### Example

10,000 USDC of margin earning 4.5% a year for 60 days earns roughly 10,000 x 0.045 x 60 / 365 = 74 USDC in total. The 4.5% is the mock vault's rate on testnet, not a USYC quote.
