# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sinc-sinc/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sinc-sinc/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar ranks pre-token DeFi protocols from a sealed on-chain snapshot and ships a static offline dashboard (model card, log-log TVL scatter plot, separated Pre-Token Radar / Live Token Peers views, category/chain/watchlist filters, category peer comparison tables, and protocol-specific farming plans).

## Model (v4)

All valuation parameters are derived directly from the sealed snapshot:

- **Split-TVL peer aggregation & power-law scaling:** tokenised protocols split across multiple version records sharing `(symbol, category)` with a single reported market cap (e.g., Aave V1–V4, SushiSwap, Quickswap, Gate) are aggregated by total TVL before fitting. Global OLS on $\log_{10}(\text{mcap}) \sim \log_{10}(\text{TVL})$ across all **128** tokenised peers estimates elasticity $\hat{\beta} = 0.5413$ (clamped to `[0.35, 1.0]`) around the geometric-mean TVL pivot $\bar{T} = \$51.6\text{M}$, defining effective TVL $T_{\text{eff}}(T) = \bar{T}\cdot(T/\bar{T})^{\hat{\beta}}$.
- **Pre-Winsorized log-space category multiples:** normalized peer ratios $r_i = \text{mcap}_i / T_{\text{eff}}(T_i)$ are upper-Winsorized at the data-derived 90th percentile (`1.7802×`) *before* computing category quantiles (`p50`, `p25`, `p75`), then shrunk geometrically in log space (`k = 8`) toward global benchmarks (`0.2310×` median, `0.0680×–0.8548×` IQR).
- **Recentered adjustments:** implied values multiply `T_eff × category multiple` by recentered 7-day TVL momentum (`×0.15` weight), listing-age maturity (`0.90–1.08`, `0.99` when unlisted), and multi-chain breadth (`0.98 / 1.00 / 1.02`).
- **Empirical-Bayes launch priors & continuous farm score:** category launch priors use Beta-Binomial smoothing (`m = 8`) over the clean `>= $5M` TVL pool (`508` protocols, `61.2%` global tokenised share) to eliminate `0%` collapses. `farm_score` (`5–100`) scales `implied × EB prior ÷ smooth TVL^0.45 capital curve` logarithmically (`p1–p99`), removing discrete capital-tier cliffs.
- **Leave-one-out validation:** evaluated across all **128** tokenised peers with TVL ≥ $5M (recomputing $\hat{\beta}$, $\bar{T}$, global quantiles, `p90` cap, and shrunk category quantiles strictly without each held-out protocol), achieving median predicted/actual **1.07×** (`1.0723`), **31.3%** within `2×`, **43.8%** within `3×`, **43.0%** `p25–p75` IQR coverage, `RMSLE(log10) = 0.8958`, `MAE(log10) = 0.6787`, and `Spearman ρ = 0.4238`.
- **Separated token views & chain-accurate farm plans:** the dashboard separates **Pre-Token Radar (197)** from **Live Token Peers (128)**, displays both `Raw` and model-aligned `Norm (T_eff)` peer multiples on each protocol's detail page, and pairs every candidate with a chain-authentic, timing-consistent 5-step farming plan (`~total time` includes setup, weekly cadence, and monthly launch tracking).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=zmdcqv2z&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
