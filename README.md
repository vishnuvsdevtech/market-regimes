# Market Regimes

**Live:** https://vishnuvsdevtech.github.io/market-regimes/

Volatility, drawdown and regime classification for gold futures, the Nifty 50 and
the S&P 500 — ten years of daily closes, computed locally. **No price prediction,
no signal, no "buy" anywhere on the page.**

## Why not a price predictor

Direction is close to noise: if a repeatable edge existed it would be arbitraged
away within minutes. What *is* forecastable is the **size** of moves — volatility
clusters and mean-reverts, which is why every serious desk models risk rather
than direction. This page does the honest version and states the limit.

## What is computed

| Quantity | Method |
|---|---|
| Returns | log daily |
| Volatility forecast | EWMA, RiskMetrics λ = 0.94, annualised |
| Realised volatility | 21-day rolling stdev, annualised |
| Volatility percentile | vs the trailing 252 days — "high" means high *for this asset now* |
| Drawdown | distance below the running peak |
| Regime | vol percentile > 0.85 → stressed; > 0.60 → elevated; else trend by 50/200-day MA |
| Forward returns | median, interquartile range and % positive after 5/20/60 days, **with sample size** |

**EWMA, not GARCH.** A fitted GARCH(1,1) needs MLE and would imply more precision
than a demo earns. EWMA is standard practice and has one parameter.

## The forward-return table is descriptive

It answers "what historically followed this regime", not "what will happen now".
Every cell carries its `n`. A 60% positive rate from 40 observations is a
coincidence with good manners — the counts are there so you can see the
difference.

## Refresh the data

Yahoo's chart API throttles this host intermittently (429), so the build reads
locally cached payloads:

```bash
curl -s -A 'Mozilla/5.0' \
  'https://query2.finance.yahoo.com/v8/finance/chart/GC%3DF?range=10y&interval=1d' -o /tmp/GOLD.json
# same for %5ENSEI → /tmp/NIFTY.json and %5EGSPC → /tmp/SPX.json
python3 tools/build_data.py
```

## Limits, stated up front

Daily closes only — no intraday, no costs, no slippage, no survivorship
correction needed (indices and futures). Regime thresholds are conventional, not
optimised. Past behaviour in a regime is not a promise about the next occurrence.
**Not investment advice.**
