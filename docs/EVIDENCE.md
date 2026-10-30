# Tenor: on-chain evidence

Every row links to the Arc explorer. Testnet = Arc Testnet (5042002). Mainnet rows are added after the mainnet deploy.

## Contracts

| Contract | Network | Address | Built with |
| --- | --- | --- | --- |
| Tenor v1 | Testnet | [0x6b25c5ba4b1ae7d00bcb15a27d3019d2df1f12d6](https://explorer.testnet.arc.io/address/0x6b25c5ba4b1ae7d00bcb15a27d3019d2df1f12d6) | Arc Studio |
| MockAggregator (test EUR/USD feed) | Testnet | [0xe61921a28c3e96d4dca683f74c31045f9113d840](https://explorer.testnet.arc.io/address/0xe61921a28c3e96d4dca683f74c31045f9113d840) | Arc Studio |
| Tenor v2 (yield-bearing margin) | Testnet | [0xfa9d0a455959c5fa6e57b4e3fdee9b062bacc3ee](https://explorer.testnet.arc.io/address/0xfa9d0a455959c5fa6e57b4e3fdee9b062bacc3ee) | Arc Studio |
| MockYieldVault (v2's first vault) | Testnet | [0xf724adeaa22f546b84e796c09734e36f13d9dd4b](https://explorer.testnet.arc.io/address/0xf724adeaa22f546b84e796c09734e36f13d9dd4b) | Arc Studio |
| USYCYieldVault adapter (allowlisted by Circle) | Testnet | [0x3b636e4ce4d4991115cba54f57ec451702371179](https://explorer.testnet.arc.io/address/0x3b636e4ce4d4991115cba54f57ec451702371179) | Outside Studio (Claude), see note |
| Tenor | **Mainnet** | _pending_ | Arc Studio bytecode |

External contracts used: USDC `0x3600…0000`, EURC testnet `0x89B5…D72a` / mainnet `0xbEf5…21c1`, USYC Teller testnet `0x9fdF…105A`, Chainlink EUR/USD mainnet `0xDd5B…DE0D`.

## Testnet: Tenor v1, full lifecycle in the live app (two MetaMask wallets)

| Step | Tx |
| --- | --- |
| Trade #1 open (cash-settled, 10 USDC at 1.11500) | 0xf7867753… (see explorer) |
| Mark after EUR/USD 1.115 → 1.09, margin call raised | 0xb004835f… |
| Top-up cures the call | 0xddcf4b96… |
| Cash settlement (hedger pays 0.224225 USDC) | 0x11b9b32e… |
| Trade #3 physical delivery: 2 USDC ↔ 1.834861 EURC in one tx | 0xc5f032d2… |
| Trade #2 delivery failed → funded leg refunded in full | settle of trade #2 |
| Risk params updated (deliveryGrace 15 min, cureWindow 5 min) | 0x9517c966… |

## Testnet: Tenor v2 + real Circle USYC

| Step | Tx |
| --- | --- |
| Wallet A subscribes 2 USDC → 1.751497 USYC (Hashnote portal) | [0x2ea24798…09efd6](https://explorer.testnet.arc.io/tx/0x2ea24798c8382b1cdfcfc25b23a7fcc179766081254f122b6e820e444509efd6) |
| Wallet A redeems 1 USYC → 1.14176 USDC | [0x153eba81…bad729](https://explorer.testnet.arc.io/tx/0x153eba8130d3f4296f5b5c3fdfa2c955b38ff20de01696ec7af5424e4dbad729) |
| Tenor v2 yield vault switched to the USYC adapter | setYieldVault (owner) |
| Hedger: yield mode ON | 0x1a2946b0…dcf8e8 |
| Hedger deposits 0.6 USDC → 0.525449 USYC via adapter | 0x532467a5…3355dc |
| Dealer deposits 0.3 USDC (plain) | 0xf516dbd0…5177dc |
| Open trade: 0.1 USDC locked margin redeemed from USYC, rest stays in USYC | 0xfa622155…bc7a66 |
| Cash settle at maturity | 0xb5f19341…5deccd |
| Dealer withdraws | 0x61d2d1fd…123aed |
| Hedger withdraws: remaining USYC redeemed to USDC | 0x21e76a21…008d81 |

End state: Tenor holds 0 USDC and 0 vault shares; adapter holds 0 USYC.

## Tests

- Studio: 132 Foundry tests for v1 (unit, fuzz, invariant), then the v2 yield suites (Yield, YieldFailure, YieldInvariant, YieldOwner, YieldTrade). Two audit passes, Slither with no High findings.
- Adapter: 17/17 local end-to-end checks against the real Tenor v2 code and a Teller mock that enforces caller/receiver allowlisting ([test/e2e.mjs](../usyc-adapter/test/e2e.mjs)).
- Refusal room: 8 attacks rejected with named errors (StalePrice, OffMarketRate, NonceUsed, BadSignature, QuoteExpired, MarginLocked, AlreadySettled, NotMatured), plus one valid control.

## Findings worth knowing

- The USYC Teller limits the adapter to **1 USDC subscribe and 1 USDC redeem per day** on testnet. Over the limit, Tenor's deposit simply stays plain USDC (fail-safe, tested).
- The Teller checks permission on both the holder and the redeem receiver, so the adapter redeems to itself and forwards plain USDC. Only the adapter needs allowlisting; Tenor and its users do not.
- USYC price at test time: 1.141868 USDC; yield 3.778% gross / 3.4% net (Hashnote portal).

## Note on what was built where

Tenor v1, Tenor v2, the mock vaults, the tests and the web app were built in Arc Studio (project `e5ec61eb-5f78-47d8-8423-d315eba31d29`). The 100-line USYC adapter and its local test harness were written outside Studio with Claude on 2026-10-29, while Studio's daily usage limit was reached.
