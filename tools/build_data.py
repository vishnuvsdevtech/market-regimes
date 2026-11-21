#!/usr/bin/env python3
"""Fetch daily prices and compute regime statistics.

Honest scope: this measures volatility, drawdown and trend regime. It does not
predict price. Volatility is genuinely forecastable (it clusters); direction is
close to noise, which is why there is no direction model here.

Vol forecast = EWMA (RiskMetrics lambda=0.94), not GARCH: a fitted GARCH needs
MLE and would imply more precision than a demo deserves.
"""
import json, math, urllib.request
from datetime import datetime, timezone

ASSETS = [
    ("GOLD", "GC=F", "Gold futures", "#e2b160"),
    ("NIFTY", "^NSEI", "Nifty 50", "#7fb8ae"),
    ("SPX", "^GSPC", "S&P 500", "#9aa7f0"),
]
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"


def fetch(sym, rng="10y"):
    """Read a locally cached Yahoo payload.

    Yahoo's chart API 429s this host intermittently; the raw responses were
    fetched with plain curl and cached, so the build is deterministic and does
    not depend on the throttle's mood. Refresh with:
        curl -s -A '<UA>' 'https://query2.finance.yahoo.com/v8/finance/chart/GC%3DF?range=10y&interval=1d' -o /tmp/GOLD.json
    """
    path = f"/tmp/{sym}.json"
    with open(path) as f:
        d = json.load(f)
    r = d["chart"]["result"][0]
    ts, closes = r["timestamp"], r["indicators"]["quote"][0]["close"]
    return [(datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"), c)
            for t, c in zip(ts, closes) if c is not None]


def stdev(xs):
    n = len(xs)
    if n < 2: return 0.0
    m = sum(xs) / n
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))


def percentile(sorted_vals, v):
    # fraction of history at or below v
    lo, hi = 0, len(sorted_vals)
    while lo < hi:
        mid = (lo + hi) // 2
        if sorted_vals[mid] <= v: lo = mid + 1
        else: hi = mid
    return lo / max(1, len(sorted_vals))


def build(sym):
    rows = fetch(sym)
    dates = [r[0] for r in rows]
    px = [r[1] for r in rows]
    n = len(px)

    rets = [0.0] + [math.log(px[i] / px[i - 1]) for i in range(1, n)]

    # EWMA variance, lambda = 0.94 (RiskMetrics)
    lam = 0.94
    var = [0.0] * n
    seed = stdev([r for r in rets[1:41]]) ** 2 if n > 41 else (stdev(rets[1:]) ** 2 or 1e-6)
    var[0] = seed
    for i in range(1, n):
        var[i] = lam * var[i - 1] + (1 - lam) * (rets[i] ** 2)
    vol_ann = [math.sqrt(max(v, 1e-12) * 252) for v in var]

    # realised 21-day vol, annualised
    rv = []
    for i in range(n):
        w = rets[max(0, i - 20):i + 1]
        rv.append(stdev(w) * math.sqrt(252) if len(w) > 5 else None)

    # drawdown from running max, and 50/200 day trend
    peak, dd = -1e18, []
    for p in px:
        peak = max(peak, p)
        dd.append((p / peak - 1) * 100)

    ma50, ma200, trend = [], [], []
    for i in range(n):
        w50 = px[max(0, i - 49):i + 1]
        w200 = px[max(0, i - 199):i + 1]
        a = sum(w50) / len(w50)
        b = sum(w200) / len(w200)
        ma50.append(a); ma200.append(b)
        trend.append(1 if a > b else -1)

    # volatility percentile within a trailing year, so "high" means high for now
    volpct = []
    for i in range(n):
        window = sorted(v for v in rv[max(0, i - 251):i + 1] if v)
        volpct.append(percentile(window, rv[i]) if rv[i] and window else None)

    # regime rules: volatility first (it is the reliable signal), then trend
    regimes = []
    for i in range(n):
        p = volpct[i]
        if p is None:
            regimes.append("unknown"); continue
        if p > 0.85: regimes.append("stressed")
        elif p > 0.6: regimes.append("elevated")
        elif trend[i] > 0: regimes.append("calm-up")
        else: regimes.append("calm-down")

    # forward returns by regime — descriptive only, with counts so nobody
    # mistakes a 2011 sample for an edge
    horizons = [5, 20, 60]
    fwd = {}
    for h in horizons:
        fwd[h] = {}
        for r in set(regimes):
            vals = []
            for i in range(n - h):
                if regimes[i] != r: continue
                vals.append((px[i + h] / px[i] - 1) * 100)
            if len(vals) >= 20:
                vals.sort()
                fwd[h][r] = {
                    "n": len(vals),
                    "median": round(vals[len(vals) // 2], 2),
                    "p25": round(vals[len(vals) // 4], 2),
                    "p75": round(vals[3 * len(vals) // 4], 2),
                    "positive": round(100 * sum(1 for v in vals if v > 0) / len(vals)),
                }

    return {
        "dates": dates,
        "close": [round(p, 2) for p in px],
        "vol": [round(v * 100, 2) if v else None for v in vol_ann],
        "rv": [round(v * 100, 2) if v else None for v in rv],
        "volpct": [round(p, 3) if p is not None else None for p in volpct],
        "dd": [round(v, 2) for v in dd],
        "trend": trend,
        "regime": regimes,
        "fwd": fwd,
        "_n": n,
    }


urllib.parse = __import__("urllib.parse", fromlist=["parse"])
out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "assets": []}
import time as _t
for idx, (aid, sym, name, color) in enumerate(ASSETS):
    if idx:
        _t.sleep(4)          # Yahoo counts bursts per IP; space the assets out
    try:
        d = build(aid)
        d.update(id=aid, symbol=sym, name=name, color=color)
        out["assets"].append(d)
        json.dump(out, open("assets/data.json", "w"))   # write as we go: a later failure must not lose earlier assets
        print(f"{aid:6} {d['_n']:5} days  {d['dates'][0]} → {d['dates'][-1]}  "
              f"vol {d['vol'][-1]:.1f}%  regime {d['regime'][-1]}")
    except Exception as e:
        print(f"{aid}: FAILED {type(e).__name__} {e}")

json.dump(out, open("assets/data.json", "w"))
print("wrote assets/data.json")
