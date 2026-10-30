# DoraHacks submission: Arc Microgrants (Built with Arc Studio)

## Project name
Tenor

## One-liner
Lock a EUR/USD rate today, settle USDC and EURC in one transaction on the date you chose, while your margin earns Circle USYC yield.

## Short description (what it does + how Arc Studio was used)
Small businesses that earn in one currency and pay in another can't easily lock an exchange rate; banks want credit lines and large minimums. Tenor is a deliverable FX forward on Arc:

- A hedger and an allowlisted dealer agree a USDC↔EURC rate for a future date with an EIP-712 signed quote, priced by covered interest parity around the Chainlink EUR/USD feed.
- Both sides post USDC margin. Anyone can mark the trade; a side that falls below maintenance gets a margin call and a cure window, and is closed out if it doesn't top up.
- At maturity both legs are funded and `settle()` swaps USDC and EURC in one transaction: both legs or neither, so there is no settlement (Herstatt) risk. A missing leg is refunded in full and compensated from the defaulter's margin. Cash-settled trades pay only the difference.
- Margin is idle until maturity, so free margin can be held in Circle USYC through a Circle-allowlisted adapter on the USYC Teller; locked margin is always plain USDC.

Arc Studio built the contracts (Foundry, 132+ tests including fuzz and invariants), ran two audit passes and Slither, deployed to Arc testnet, built the React app (Hedge, Dealer, My trades, Refusal room, Admin) and deployed it to Vercel. Studio also built v2 (yield-bearing margin) with its own test suites.

## Links
- Arc Studio project: https://studio.arc.io/app/e5ec61eb-5f78-47d8-8423-d315eba31d29
- Live app: https://arc-studio-e5ec61eb5f7847d88423d315.vercel.app
- Repo: https://github.com/Lakshmikanth-3/Tenor
- Mainnet contract: _fill after deploy_
- Example mainnet tx: _fill after first mainnet trade_
- Video: _fill_
- Builder profile: https://github.com/Lakshmikanth-3

## Why Arc
- USDC and EURC are both native Circle assets on one ledger, which makes an atomic two-currency settlement possible.
- Deterministic sub-second finality: a settlement that can't be rolled back.
- Fees of a fraction of a cent, paid in USDC, make frequent marking practical.
- Chainlink EUR/USD and Circle USYC are live on Arc.

## How it differs
Circle StableFX settles spot USDC↔EURC within at most one day. Tenor extends the same both-or-neither delivery to a fixed rate on a future date, adding margin, margin calls and default handling.

## Honest limits (v1)
Reference interest rates are owner-set within bounds; notional is capped (50 USDC); single allowlisted dealer; not audited by a third party; no legal ISDA agreement. USYC is permissioned (non-US, eligibility, daily Teller limits), so yield-bearing margin is shown on testnet.

## Roadmap
Netting across trades and counterparties; keeper tips; multi-dealer RFQ; dealers hedging through StableFX; more currency pairs as Circle and Chainlink add them (JPY, MXN, BRL feeds are already live on Arc mainnet); USYC margin on mainnet for eligible users.

---

# Video script (under 5 minutes)

1. **0:00–0:30 Problem.** "A business in India or Europe is owed dollars in 60 days. Every cent EUR/USD moves changes what it receives. Banks hedge this, but only with credit lines and big minimums."
2. **0:30–1:15 Built in Arc Studio.** Show the Studio project: the prompt, the Contracts panel with both deployments, the test run (132 passing), the audit summary.
3. **1:15–2:30 The app (testnet).** Hedge page (fair forward, hedged vs unhedged chart). Dealer signs a quote → hedger opens the link → Lock rate. Push price → Mark → margin call → Top up. Settle.
4. **2:30–3:15 Physical delivery.** Both legs funded → Settle → USDC and EURC swap in one transaction (show the explorer tx).
5. **3:15–3:45 Refusal room.** Run all: 8 attacks refused by name.
6. **3:45–4:15 USYC yield.** Margin goes into real USYC via the Circle-allowlisted adapter; opening a trade pulls only the locked part out.
7. **4:15–4:50 Mainnet.** Show the mainnet contract and the mainnet USDC transaction on explorer.arc.io.
8. **4:50–5:00 Close.** "Tenor: lock your rate, settle both currencies at once."
