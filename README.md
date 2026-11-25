# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sinc-sinc/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sinc-sinc/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar ranks pre-token DeFi protocols from a sealed on-chain snapshot and ships a static offline dashboard (model card, log-log TVL scatter plot, separated Pre-Token Radar / Live Token Peers views, category/chain/watchlist filters, category peer comparison tables, and protocol-specific farming plans).

## Model (v3)

All valuation parameters are derived directly from the sealed snapshot:

- **TVL power-law scaling:** global OLS on $\log_{10}(\text{mcap}) \sim \log_{10}(\text{TVL})$ across all **128** tokenised peers estimates elasticity $\hat{\beta} = 0.5223$ (clamped to `[0.35, 1.0]`) around the geometric-mean TVL pivot $\bar{T} = \$49.1\text{M}$, defining effective TVL $T_{\text{eff}}(T) = \bar{T}\cdot(T/\bar{T})^{\hat{\beta}}$.
- **Pre-Winsorized log-space category multiples:** normalized peer ratios $r_i = \text{mcap}_i / T_{\text{eff}}(T_i)$ are upper-Winsorized at the data-derived 90th percentile (`1.9010×`) *before* computing category quantiles (`p50`, `p25`, `p75`), then shrunk geometrically in log space (`k = 8`) toward global benchmarks (`0.2410×` median, `0.0697×–0.9209×` IQR).
- **Recentered adjustments:** implied values multiply `T_eff × category multiple` by recentered 7-day TVL momentum (`×0.15` weight), listing-age maturity (`0.90–1.08`, `0.99` when unlisted), and multi-chain breadth (`0.98 / 1.00 / 1.02`).
- **Leave-one-out validation:** evaluated across all **128** tokenised peers with TVL ≥ $5M (recomputing $\hat{\beta}$, $\bar{T}$, global quantiles, `p90` cap, and shrunk category quantiles strictly without each held-out protocol), achieving median predicted/actual **1.09×** (`1.0862`), **32.8%** within `2×`, **43.0%** within `3×`, **43.0%** `p25–p75` IQR coverage, `RMSLE(log10) = 0.9155`, and `MAE(log10) = 0.6919`.
- **Separated token views & farm plans:** the dashboard separates **Pre-Token Radar (197)** from **Live Token Peers (128)**, shows same-category live peers under each protocol's valuation breakdown, and pairs every candidate with a 5-step TVL-tiered farming plan.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=zmdcqv2z&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
