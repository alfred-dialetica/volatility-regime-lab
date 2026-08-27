#!/usr/bin/env python3
"""Build a compact, public-EOD dataset for the volatility dashboard."""

from __future__ import annotations

import csv
import io
import json
import math
import statistics
import urllib.request
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent

CBOE = {
    "vix": "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv",
    "vix1d": "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX1D_History.csv",
    "vix9d": "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX9D_History.csv",
    "vix3m": "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX3M_History.csv",
    "vix6m": "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX6M_History.csv",
    "vix1y": "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX1Y_History.csv",
    "vvix": "https://cdn.cboe.com/api/global/us_indices/daily_prices/VVIX_History.csv",
    "skew": "https://cdn.cboe.com/api/global/us_indices/daily_prices/SKEW_History.csv",
    "dspx": "https://cdn.cboe.com/api/global/us_indices/daily_prices/DSPX_History.csv",
    "vixeq": "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIXEQ_History.csv",
    "cor1m": "https://cdn.cboe.com/api/global/us_indices/daily_prices/COR1M_History.csv",
    "cor3m": "https://cdn.cboe.com/api/global/us_indices/daily_prices/COR3M_History.csv",
    "cor6m": "https://cdn.cboe.com/api/global/us_indices/daily_prices/COR6M_History.csv",
    "cor1y": "https://cdn.cboe.com/api/global/us_indices/daily_prices/COR1Y_History.csv",
}

FRED_SP500 = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500"


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Dialetica research preview/1.0"})
    with urllib.request.urlopen(req, timeout=45) as response:
        return response.read().decode("utf-8-sig")


def parse_cboe(url: str) -> dict[str, float]:
    reader = csv.DictReader(io.StringIO(fetch_text(url)))
    rows: dict[str, float] = {}
    for row in reader:
        date_raw = row.get("DATE") or row.get("Date")
        if not date_raw:
            continue
        value_raw = row.get("CLOSE")
        if value_raw is None:
            candidates = [v for k, v in row.items() if k and k.upper() != "DATE"]
            value_raw = candidates[0] if len(candidates) == 1 else None
        try:
            date = datetime.strptime(date_raw.strip(), "%m/%d/%Y").date().isoformat()
            rows[date] = float(value_raw)
        except (TypeError, ValueError):
            continue
    return rows


def parse_fred_sp500() -> dict[str, float]:
    reader = csv.DictReader(io.StringIO(fetch_text(FRED_SP500)))
    rows: dict[str, float] = {}
    for row in reader:
        try:
            rows[row["observation_date"]] = float(row["SP500"])
        except (KeyError, TypeError, ValueError):
            continue
    return rows


def rolling_vol(returns: list[float], window: int) -> float | None:
    if len(returns) < window:
        return None
    sample = returns[-window:]
    return statistics.stdev(sample) * math.sqrt(252) * 100


def round_or_none(value: float | None, digits: int = 3):
    return None if value is None or not math.isfinite(value) else round(value, digits)


def build() -> dict:
    cboe = {name: parse_cboe(url) for name, url in CBOE.items()}
    sp500 = parse_fred_sp500()
    dates = sorted(set(cboe["vix"]) & set(sp500))

    sp_returns: list[float] = []
    history: list[dict] = []
    previous_sp: float | None = None
    previous_vix: float | None = None

    for date in dates:
        sp = sp500[date]
        sp_ret = None
        if previous_sp and previous_sp > 0:
            log_ret = math.log(sp / previous_sp)
            sp_returns.append(log_ret)
            sp_ret = (sp / previous_sp - 1) * 100

        vix = cboe["vix"][date]
        rv21 = rolling_vol(sp_returns, 21)
        rv63 = rolling_vol(sp_returns, 63)
        rv252 = rolling_vol(sp_returns, 252)
        vix3m = cboe["vix3m"].get(date)
        vix9d = cboe["vix9d"].get(date)
        vvix = cboe["vvix"].get(date)
        skew = cboe["skew"].get(date)
        dspx = cboe["dspx"].get(date)
        vixeq = cboe["vixeq"].get(date)
        cor1m = cboe["cor1m"].get(date)
        cor3m = cboe["cor3m"].get(date)
        cor6m = cboe["cor6m"].get(date)
        cor1y = cboe["cor1y"].get(date)
        curve_3m = vix3m - vix if vix3m is not None else None
        front_slope = vix - vix9d if vix9d is not None else None
        vrp_vol = vix - rv21 if rv21 is not None else None
        vrp_var = vix * vix - rv21 * rv21 if rv21 is not None else None
        constituent_spread = vixeq - vix if vixeq is not None else None
        correlation_slope = cor1y - cor1m if cor1y is not None and cor1m is not None else None

        history.append({
            "d": date,
            "spx": round_or_none(sp, 2),
            "spRet": round_or_none(sp_ret),
            "vix": round_or_none(vix),
            "vixChg": round_or_none(vix - previous_vix if previous_vix is not None else None),
            "vix1d": round_or_none(cboe["vix1d"].get(date)),
            "vix9d": round_or_none(vix9d),
            "vix3m": round_or_none(vix3m),
            "vix6m": round_or_none(cboe["vix6m"].get(date)),
            "vix1y": round_or_none(cboe["vix1y"].get(date)),
            "vvix": round_or_none(vvix),
            "skew": round_or_none(skew),
            "dspx": round_or_none(dspx),
            "vixeq": round_or_none(vixeq),
            "cor1m": round_or_none(cor1m),
            "cor3m": round_or_none(cor3m),
            "cor6m": round_or_none(cor6m),
            "cor1y": round_or_none(cor1y),
            "constituentSpread": round_or_none(constituent_spread),
            "correlationSlope": round_or_none(correlation_slope),
            "rv21": round_or_none(rv21),
            "rv63": round_or_none(rv63),
            "rv252": round_or_none(rv252),
            "vrpVol": round_or_none(vrp_vol),
            "vrpVar": round_or_none(vrp_var, 1),
            "curve3m": round_or_none(curve_3m),
            "frontSlope": round_or_none(front_slope),
        })
        previous_sp = sp
        previous_vix = vix

    # Six-plus years are enough for the interactive prototype and keep the payload small.
    history = history[-1800:]
    as_of = history[-1]["d"]
    return {
        "meta": {
            "revision": "vol-lab-20260827.2",
            "asOf": as_of,
            "generatedAt": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "frequency": "Public end-of-day",
            "classification": "Public market data",
            "sources": [
                {"name": "Cboe Global Indices", "url": "https://www.cboe.com/us/indices/market_statistics/"},
                {"name": "Cboe S&P 500 Dispersion", "url": "https://www.cboe.com/us/indices/dispersion/"},
                {"name": "Cboe Implied Correlation", "url": "https://www.cboe.com/us/indices/implied/"},
                {"name": "FRED · S&P 500", "url": "https://fred.stlouisfed.org/series/SP500"},
            ],
        },
        "series": history,
    }


if __name__ == "__main__":
    payload = build()
    out = ROOT / "data.js"
    out.write_text("window.VOL_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"wrote {out} with {len(payload['series'])} observations through {payload['meta']['asOf']}")
