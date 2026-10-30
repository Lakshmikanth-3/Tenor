# Tenor

**Lock your EUR/USD rate today. Settle USDC and EURC in one transaction on the date you chose.**

A small business that earns dollars but pays costs in euros (or the other way round) has no simple way to lock an exchange rate: banks want credit lines and large minimums. Tenor is a deliverable FX forward on Arc. A business and a dealer agree a rate for a future date, both post USDC margin, the contract enforces margin calls, and at maturity USDC and EURC swap atomically: both legs or neither. Idle margin can earn yield in Circle USYC while the hedge is open.

Built end to end with [Arc Studio](https://studio.arc.io) for Arc Microgrants.

| | |
| --- | --- |
| Live app | https://arc-studio-e5ec61eb5f7847d88423d315.vercel.app |
| Arc Studio project | https://studio.arc.io/app/e5ec61eb-5f78-47d8-8423-d315eba31d29 |
| Evidence (every contract and tx) | [docs/EVIDENCE.md](docs/EVIDENCE.md) |
| Builder | https://github.com/Lakshmikanth-3 |

---

## Proof on Arc

### Arc Mainnet (chain 5042)

| | |
| --- | --- |
| Tenor | _added after mainnet deploy_ |
| First USDC trade | _added after mainnet deploy_ |
| EUR/USD price | Chainlink feed [`0xDd5B15443cd733D3966a50a3E48cB7DF9Fb5DE0D`](https://explorer.arc.io/address/0xDd5B15443cd733D3966a50a3E48cB7DF9Fb5DE0D) |
| EURC | [`0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`](https://explorer.arc.io/address/0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1) |

### Arc Testnet (chain 5042002): contracts

| Contract | Address |
| --- | --- |
| **Tenor v2** (current, yield-bearing margin) | [`0xfa9d0a455959c5fa6e57b4e3fdee9b062bacc3ee`](https://explorer.testnet.arc.io/address/0xfa9d0a455959c5fa6e57b4e3fdee9b062bacc3ee) |
| **USYC adapter** (allowlisted by Circle, v2's vault) | [`0x3b636e4ce4d4991115cba54f57ec451702371179`](https://explorer.testnet.arc.io/address/0x3b636e4ce4d4991115cba54f57ec451702371179) |
| Tenor v1 (no yield, fully tested) | [`0x6b25c5ba4b1ae7d00bcb15a27d3019d2df1f12d6`](https://explorer.testnet.arc.io/address/0x6b25c5ba4b1ae7d00bcb15a27d3019d2df1f12d6) |
| Mock EUR/USD feed (testnet only) | [`0xe61921a28c3e96d4dca683f74c31045f9113d840`](https://explorer.testnet.arc.io/address/0xe61921a28c3e96d4dca683f74c31045f9113d840) |

### Arc Testnet: real trades, two wallets, through the live app

| What happened | Tx |
| --- | --- |
| Open a 10 USDC forward at 1.11500 (cash-settled) | [0xf7867753…2bbaa](https://explorer.testnet.arc.io/tx/0xf7867753b5877db12ff687e9c6c19eaec1bd273511a51ee9c6f23126ffe2bbaa) |
| EUR/USD drops 1.115 → 1.09, mark raises a margin call | [0xb004835f…882fa](https://explorer.testnet.arc.io/tx/0xb004835fd6c66fc16cfd68ecdbe78992c15248d5e55d1b928fb38f2c5e6882fa) |
| Hedger tops up, call cured | [0xddcf4b96…a727d](https://explorer.testnet.arc.io/tx/0xddcf4b96f14bdcb54641d29b06eae0229a2aa4694f58f1514947a7f6703a727d) |
| Cash settlement: hedger pays the dealer 0.224225 USDC | [0x11b9b32e…94db2](https://explorer.testnet.arc.io/tx/0x11b9b32ef977116aa69974597992be23b0e979605e57536526d853362d494db2) |
| Physical forward: dealer funds the EURC leg | [0xd8aefbfe…eeedb](https://explorer.testnet.arc.io/tx/0xd8aefbfedd832757a1f415a253286b55d684ed47cb0fbd5514c8f03bdedeeedb) |
| Hedger funds the USDC leg | [0x128c73a4…9aa0f](https://explorer.testnet.arc.io/tx/0x128c73a49382b0a3e9c50abe75a92d9388ec09ed9693033aee9d3791b119aa0f) |
| **Delivery: 2 USDC ↔ 1.834861 EURC in one transaction** | [0xc5f032d2…c407b](https://explorer.testnet.arc.io/tx/0xc5f032d2e67147cb4ba1069c9204e0a6cd527449bbcae26d00a71b1ff22c407b) |
| A missing leg past grace → delivery failed, funded leg refunded in full | trade #2, funded at [0x615f65be…3f082](https://explorer.testnet.arc.io/tx/0x615f65bec0a1ec3191c80e4d5ff3c4a71f172012b2a68d084c7aacec5213f082) |

### Arc Testnet: margin earning real Circle USYC (Tenor v2)

| What happened | Tx |
| --- | --- |
| Hedger switches yield on | [0x1a2946b0…cf8e8](https://explorer.testnet.arc.io/tx/0x1a2946b0cae8fabcac727453e50972c68cca1262e62ee9afe1a6eb35fbdcf8e8) |
| 0.6 USDC margin becomes **0.525449 USYC** via Circle's Teller | [0x532467a5…355dc](https://explorer.testnet.arc.io/tx/0x532467a58e2649f92623e1d67d8d0055f026345e68336cab3e3bb2203a3355dc) |
| Dealer posts 0.3 USDC margin | [0xf516dbd0…177dc](https://explorer.testnet.arc.io/tx/0xf516dbd0c6b99f6e0fddbe3e25a16e68ab2b07196e403d33ac4905e4865177dc) |
| Open a trade: only the 0.1 USDC locked margin leaves USYC | [0xfa622155…c7a66](https://explorer.testnet.arc.io/tx/0xfa6221558614546d15ff2732ffe161718453b7ca514d0177f6c2c6a292bc7a66) |
| Cash settle at maturity | [0xb5f19341…deccd](https://explorer.testnet.arc.io/tx/0xb5f1934197aa0e3caf1168eb22d4d7313f8f11d0a48d3eabad71bbd2915deccd) |
| Dealer withdraws | [0x61d2d1fd…123aed](https://explorer.testnet.arc.io/tx/0x61d2d1fd8bed0a8b00ab75b5ba90bdf75c6cee8ed2be3983cef5344f9f123aed) |
| Hedger withdraws: remaining USYC redeemed to USDC, contract empty | [0x21e76a21…08d81](https://explorer.testnet.arc.io/tx/0x21e76a2116f17f12d3d9164a006692f17e57f4118de4f6064f1b6bb45f008d81) |

### Tests and attacks

- **245 Foundry tests passing** (unit, fuzz and invariant): solvency (all balances equal tokens held), variation margin is zero-sum, delivery moves exact amounts, owner can never move user funds, yield vault failure can never block settlement.
- Two audit passes and Slither inside Arc Studio, no High findings.
- **Refusal room**: eight attacks run live against the deployed contract and refused by name: `StalePrice`, `OffMarketRate`, `NonceUsed` (replayed quote), `BadSignature` (forged quote), `QuoteExpired`, `MarginLocked`, `AlreadySettled`, `NotMatured`, plus one valid control that passes.
- USYC adapter: 17/17 local end-to-end checks against the real Tenor v2 code.

---

## How it works

```
Dealer signs a quote (EIP-712) ──► Hedger opens: both post USDC margin
        │
        ├── price moves ──► anyone marks ──► margin moves loser → winner
        │                        └─ below maintenance ──► margin call ──► top up, or close-out
        │
        └── maturity ──► both legs funded ──► settle(): USDC ⇄ EURC in one tx (both or neither)
                     └── a leg missing after grace ──► funded leg refunded + compensated from margin
```

- **Pricing:** the agreed rate must sit inside a band around the covered-interest-parity forward: spot × (1 + r_usd·t) / (1 + r_eur·t).
- **Price:** Chainlink EUR/USD on mainnet; on testnet a mock feed the owner updates.
- **Payouts:** credited first, then withdrawn (pull pattern), so a blocked recipient can never freeze anyone else's settlement.
- **Cash-settled mode:** at maturity only the difference is paid, in USDC.

## Why Arc and Circle

- **USDC and EURC are both native Circle assets on one ledger**, so an atomic two-currency settlement is one transaction, not two banks and a settlement window.
- **Deterministic sub-second finality**: a settlement that cannot be rolled back.
- **Fees of a fraction of a cent in USDC** make frequent marking practical, which keeps exposure small.
- **Chainlink EUR/USD and Circle USYC are live on Arc.**
- **Next to Circle StableFX:** StableFX settles spot USDC↔EURC within at most one day. Tenor extends the same both-or-neither delivery to a fixed rate on a future date, with margin and default handling.

## Yield-bearing margin with Circle USYC

Each side posts about 5% of the notional, so roughly 10% sits idle until maturity. With Tenor v2 an account can hold its free margin in Circle USYC, a tokenized money-market fund.

- Optional, per account ("Earn yield on idle margin" in My trades or Dealer). Off, Tenor behaves exactly like v1.
- Only free margin goes into USYC. Margin locked in a trade is always plain USDC, so marks, margin calls, close-out and settlement never wait for a redemption.
- Tenor talks to `USYCYieldVault` ([source](contracts/adapters/USYCYieldVault.sol)), a ~100-line adapter over Circle's USYC Teller. Only Tenor v2 can call it; it has no admin function that can move funds. It redeems to itself and forwards USDC, so only the adapter needs Circle's allowlist, not Tenor or its users.
- At the 3.4% net yield seen in testing, 10,000 USDC of margin for 60 days earns about **56 USDC**.
- Limits: USYC is permissioned. On testnet the Teller allows the adapter 1 USDC of subscriptions and 1 USDC of redemptions per day; over the limit, deposits simply stay plain USDC. On mainnet USYC is for eligible non-US institutions, so yield-bearing margin is a testnet feature for now.

## What was built where

Tenor v1, Tenor v2, the mock vault, all 245 tests and the web app were written, tested and deployed in Arc Studio. The USYC adapter and its local test harness were written outside Studio, with Claude, on 2026-10-29 while Studio's daily usage limit was reached; it has not been through Studio's review.

## Honest limits (v1)

Reference interest rates are owner-set within bounds; one allowlisted dealer; 50 USDC cap per trade; not audited by a third party; no legal ISDA agreement behind the on-chain terms; testnet price comes from a mock feed the owner updates.

## Roadmap

1. Netting across all of a defaulter's trades, with pro-rata shortfall.
2. Keeper tips so marks and settlements never depend on one operator.
3. Multi-dealer quotes, and dealers hedging their book through Circle StableFX.
4. More currency pairs as Circle and Chainlink add them (JPY, MXN, BRL and others already have Chainlink feeds on Arc mainnet).
5. USYC margin on mainnet for eligible users.

---

## Run it

Prerequisites: Bun and Foundry.

```bash
bun install
bun run dev              # app
bun run check            # lint + typecheck
bun run contracts:test   # Foundry tests
```

### Environment variables

All values are public addresses and block numbers.

| Name | Purpose |
| --- | --- |
| `VITE_NETWORK_DEFAULT` | `testnet` or `mainnet` on first load |
| `VITE_TENOR_ADDRESS_TESTNET` | Tenor on Arc Testnet (v2: `0xfa9d…3ee`) |
| `VITE_DEPLOY_BLOCK_TESTNET` | Where event scanning starts (v2: 69655019) |
| `VITE_FEED_TESTNET` / `VITE_EURC_TESTNET` | Mock feed and EURC on testnet |
| `VITE_TENOR_ADDRESS_MAINNET` / `VITE_DEPLOY_BLOCK_MAINNET` | Tenor on Arc Mainnet (the app shows a notice while empty) |
| `VITE_FEED_MAINNET` / `VITE_EURC_MAINNET` | Chainlink EUR/USD and EURC on mainnet |

### USYC addresses

| Contract | Mainnet | Testnet |
| --- | --- | --- |
| USYC | `0x8a5D989Bbb96929F689B0200f435f53dA42bF490` | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` |
| Teller | `0x51A8CE47dC08ba5CD19c7aa84EA6fD6664f60f9b` | `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A` |
| Entitlements | `0xb69ecb156Dc0028198028c501340d5367845ca72` | `0xcc205224862c7641930c87679e98999d23c26113` |

## Tech stack

React, Vite, TypeScript, Tailwind CSS, wagmi, viem, ConnectKit · Solidity 0.8.28, Foundry, OpenZeppelin.
