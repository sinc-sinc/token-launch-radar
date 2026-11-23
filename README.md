# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sinc-sinc/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sinc-sinc/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar ranks pre-token DeFi protocols from a sealed on-chain snapshot and ships a static offline dashboard with protocol-specific farming plans. Implied launch values are derived entirely from the snapshot by scaling each protocol's TVL with a shrunk peer category market-cap-to-TVL multiple, then adjusting for 7-day TVL momentum, listing maturity, and multi-chain breadth.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=zmdcqv2z&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
