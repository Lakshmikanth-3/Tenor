# Tenor end-to-end run on Arc Testnet

Real transactions, driven by `scripts/e2e.ts` using the same library code as the web app (quote signing, share-link codec, call encoders, error decoding, log scanning, refusal scenarios).

The deployed Tenor is owned by your wallet and only your wallet is an allowlisted dealer, so the run deployed its own copy of the same bytecode and used two throwaway wallets (owner and dealer, hedger).

- Tenor (test copy): [`0x4a970bba80e1f995e20e0e2fd004df5bb62bdfac`](https://explorer.testnet.arc.io/address/0x4a970bba80e1f995e20e0e2fd004df5bb62bdfac)
- MockAggregator (test copy): [`0x036a265985ee5692b75a42b1e8522941e451e331`](https://explorer.testnet.arc.io/address/0x036a265985ee5692b75a42b1e8522941e451e331)
- Owner and dealer: `0xbb54737C60E02B4e141124C1f7b5ab3125D3517D`
- Hedger: `0xFdA85aA1C00454c998bB2E27c2450461eb43FaD3`

## Transactions

| # | Step | Gas used | Tx |
|---|---|---|---|
| 1 | Deploy MockAggregator | 433,821 | [0x52d40014…6f409b](https://explorer.testnet.arc.io/tx/0x52d40014507b1b110aeefd326d3a342c9eb3c45b888e6c695e7d10e0cc6f409b) |
| 2 | Deploy Tenor | 4,018,342 | [0x7d55644f…2f4dac](https://explorer.testnet.arc.io/tx/0x7d55644f50a45325926f33525d81395aeab48982f3254db91390346ca22f4dac) |
| 3 | Hedger: allow USDC | 55,438 | [0x7290037e…906b12](https://explorer.testnet.arc.io/tx/0x7290037e9c60ecf6a8b6232fb7bfb7198cd313463731394f7ed5242ff9906b12) |
| 4 | Hedger: deposit margin 1.000000 USDC | 76,832 | [0x92c7c047…fe6309](https://explorer.testnet.arc.io/tx/0x92c7c047683f17c810c6031555e621a7a4565df78a2020fb4b63ed52adfe6309) |
| 5 | Dealer: allow USDC | 55,438 | [0x7b1743ba…7d668e](https://explorer.testnet.arc.io/tx/0x7b1743ba36f26c80617d98c687142ec61f986dbd2e80743374f78ad7d57d668e) |
| 6 | Dealer: deposit margin 1.500000 USDC | 76,832 | [0xb3af2a86…57b5dd](https://explorer.testnet.arc.io/tx/0xb3af2a86dfab4e116df9ff0518ec1be9b56f88b32fc877a543dc4805d857b5dd) |
| 7 | Hedger: Lock rate, trade A cash-settled 10 USDC | 515,501 | [0xaa084a56…c36224](https://explorer.testnet.arc.io/tx/0xaa084a565350a3de9aa39250125cdc91b2ee7db13ad62c53e28aa7c731c36224) |
| 8 | Hedger: Lock rate, trade B physical 2 USDC | 481,301 | [0xfbad1bd9…b6f05e](https://explorer.testnet.arc.io/tx/0xfbad1bd9b586eb9d4336791538b457748c6b3d54e373a7d161b1668260b6f05e) |
| 9 | Hedger: Lock rate, trade C cash-settled 2 USDC | 481,313 | [0x80b2d616…eeb2bf](https://explorer.testnet.arc.io/tx/0x80b2d6160e7702f8c1260763fd3b84eadf0fcbd4abce245c34e19f9f58eeb2bf) |
| 10 | Owner: push price 1.11500 -> 1.14845 | 73,188 | [0x68f3400d…d1f877](https://explorer.testnet.arc.io/tx/0x68f3400d464a91132daa352841c3de7335cdd1af0a227c23b009e829c0d1f877) |
| 11 | Anyone: Mark trade A | 149,577 | [0x1f7471f8…74062d](https://explorer.testnet.arc.io/tx/0x1f7471f899cf4f5049abe71aca7e536419f1683800746e1e72b22358bb74062d) |
| 12 | Anyone: Mark trade C | 149,577 | [0x0c72247e…c831f0](https://explorer.testnet.arc.io/tx/0x0c72247e2a7e2fe017548cf4b3c339ce0005a4659a8529f029e060fd98c831f0) |
| 13 | Dealer: top up trade A 0.400000 USDC | 45,484 | [0x10d82509…540f05](https://explorer.testnet.arc.io/tx/0x10d82509255c0644eb0284a768c2938f1595de70c80059c52ea4ca9cb1540f05) |
| 14 | Anyone: Close out trade C | 94,591 | [0x4234d789…8554dd](https://explorer.testnet.arc.io/tx/0x4234d789a9ed922346283f25ff17ccfb5151d251f4ebc82f33c6d1a9008554dd) |
| 15 | Hedger: Fund USDC leg (allow USDC) | 55,438 | [0xf68a70e3…74481d](https://explorer.testnet.arc.io/tx/0xf68a70e3d18a25759b0aab13d1f04f4be40425553737b65793e8904fe674481d) |
| 16 | Hedger: Fund USDC leg, trade B | 109,081 | [0x68b1696b…fd7f7c](https://explorer.testnet.arc.io/tx/0x68b1696b042ff5c22dc1959d67fdf6cfcf90030217ce49c04578c8e737fd7f7c) |
| 17 | Dealer: Fund EURC leg (allow EURC) | 55,437 | [0xfd17c7c6…7db890](https://explorer.testnet.arc.io/tx/0xfd17c7c6c866fad86b038c1977854b08b14d52ef3d1dbabf7f14f879e97db890) |
| 18 | Dealer: Fund EURC leg, trade B | 107,488 | [0xe3e7d600…ddaaab](https://explorer.testnet.arc.io/tx/0xe3e7d60091849e84407de4863de71e0c3ab0ac42941483444ec0fcb69addaaab) |
| 19 | Anyone: settle trade B (physical) | 80,729 | [0x44252791…abd06b](https://explorer.testnet.arc.io/tx/0x44252791e95acad0ea4dfa40237a81ba3109241264117b2f0050ee9f74abd06b) |
| 20 | Anyone: Cash settle trade A | 86,633 | [0x71296aaf…b73b9a](https://explorer.testnet.arc.io/tx/0x71296aafaa7d74db57f0ed7b9ea38c4084e15da001a9c05eb491355824b73b9a) |
| 21 | Hedger: Withdraw USDC | 53,594 | [0x269dd85e…b4462a](https://explorer.testnet.arc.io/tx/0x269dd85eed3d9f1dbdd946654341a79ec18fc9b1217c252a025123b95eb4462a) |
| 22 | Hedger: Withdraw EURC | 47,468 | [0x5a0afc19…594870](https://explorer.testnet.arc.io/tx/0x5a0afc192868afc0da9504dc831c5ce67ab2ee809579f88a97fd1917a4594870) |
| 23 | Dealer: Withdraw USDC | 53,594 | [0xbd00b768…ee9549](https://explorer.testnet.arc.io/tx/0xbd00b7680c934ea1ff62b7191cc2a20966b59846206645c579d928f4efee9549) |

## Refused calls (eth_call, no transaction)

- Hedger: replay quote A: NonceUsed
- Dealer: withdrawExcess while called: MarginLocked
- Anyone: closeOut before deadline: CureWindowOpen
- Anyone: Mark again too soon: MarkTooSoon
- Hedger: settle before maturity: NotMatured
- Anyone: settle trade B with a leg missing: LegUnfunded
- Dealer: fund the same leg twice: LegAlreadyFunded
- Anyone: settle trade A again: AlreadySettled

## Checks

- PASS: Share link round-trips and the signature verifies (cash, 10000000 notional) (431 chars)
- PASS: Share link round-trips and the signature verifies (physical, 2000000 notional) (431 chars)
- PASS: Share link round-trips and the signature verifies (cash, 2000000 notional) (430 chars)
- PASS: Hedger: replay quote A refused (NonceUsed)
- PASS: Replay of a used quote is refused with NonceUsed
- PASS: Mark A emitted Marked and MarginCalled
- PASS: Marked MTM equals independent N*(F-K)/K (299999 vs 299999)
- PASS: Dealer: withdrawExcess while called refused (MarginLocked)
- PASS: Anyone: closeOut before deadline refused (CureWindowOpen)
- PASS: Anyone: Mark again too soon refused (MarkTooSoon)
- PASS: Top up cured the margin call
- PASS: Hedger: settle before maturity refused (NotMatured)
- PASS: Close out emitted ClosedOut
- PASS: Anyone: settle trade B with a leg missing refused (LegUnfunded)
- PASS: Dealer: fund the same leg twice refused (LegAlreadyFunded)
- PASS: Physical settle emitted Delivered
- PASS: Hedger EURC credit equals exactly notional*1e18/rate (1793721 vs 1793721)
- PASS: Cash settle emitted CashSettled
- PASS: Anyone: settle trade A again refused (AlreadySettled)
- PASS: After everyone withdraws the contract holds 0 USDC and 0 EURC (solvency) (0 / 0)
- PASS: getLogs windows from the deploy block return the lifecycle events
- PASS: Refusal room: Stale price (StalePrice)
- PASS: Refusal room: Off-market rate (OffMarketRate)
- PASS: Refusal room: Replayed quote (NonceUsed)
- PASS: Refusal room: Forged signature (BadSignature)
- PASS: Refusal room: Expired quote (QuoteExpired)
- PASS: Refusal room: Withdraw while margin-called (MarginLocked)
- PASS: Refusal room: Settle twice (AlreadySettled)
- PASS: Refusal room: Settle before maturity (NotMatured)
- PASS: Refusal room: Control: a valid quote (open() accepted the quote and would create trade #1, locking 0.5 USDC from each side.)

Trade flows covered: A cash-settled (deposit, quote link, open, price push, mark, margin call, top up, cash settle, withdraw), B physical delivery with both legs funded, C uncured margin call closed out.

Note: an earlier run of the same script was stopped after a timing bug in the script itself (trade C was marked before its mark interval elapsed). Its transactions are on its own throwaway copy of the contracts and are not part of this report.
