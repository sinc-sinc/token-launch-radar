# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sinc-sinc/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sinc-sinc/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar ranks pre-token DeFi protocols from a sealed on-chain snapshot and ships a static offline dashboard (with model card, TVL-vs-implied-value scatter plot, category/chain filters, and protocol-specific farming plans).

## Model (v2)

All valuation parameters are derived directly from the sealed snapshot:

- **Category multiples:** median market-cap-to-TVL ratio of tokenised peers in each category, shrunk toward the global peer median (`0.2138×` across 128 tokenised peers) with `(n + 5)` weighting and capped at the data-derived 90th percentile of all peer multiples (`2.9555×`, no flat upper clamp), then adjusted for 7-day TVL momentum, listing maturity, and multi-chain breadth.
- **Implied valuation ranges:** every protocol receives an `[implied_low_usd, implied_high_usd]` band computed from shrunk category `p25–p75` peer multiples, with a global-quartile widening fallback (`0.0468×–1.0467×`) whenever a category's interquartile spread is narrower than `1.25×`.
- **Leave-one-out validation:** evaluated across all **128** tokenised protocols with TVL ≥ $5M (recomputing global median, `p90` cap, and category median without the held-out protocol), achieving a median predicted/actual ratio of **1.21** (`1.2062`), with **21.1%** within `2×` and **32.8%** within `3×`.
- **Launch prior & farm score:** each category carries a **launch prior** (the share of snapshot protocols with TVL ≥ $5M in that category that already have a token), which feeds a **1–100 farm score** index computed as `implied_value_usd × launch_prior ÷ plan_capital_usd`, log-scaled across the board.
- **Actionable farm plans:** each protocol gets a 5-step farming plan whose step 1 states the TVL-tiered capital budget, expected duration, and weekly time commitment (e.g., `Budget: $2,500 over ~16 weeks, ~15 min/week.`).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=zmdcqv2z&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
