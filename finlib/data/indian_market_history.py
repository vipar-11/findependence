"""
Indian Historical Market Returns & Macroeconomic Dataset.

By default, simulations use the last 20 years of historical Indian market data
(2006–2025) so that return distributions, bond yields, and inflation regimes are
representative of modern India.
"""

from __future__ import annotations

from typing import Any, TypedDict
import numpy as np


class AnnualMarketRecord(TypedDict):
    year: int
    equity_return: float
    fixed_income_return: float
    property_return: float
    cpi_inflation: float
    regime_note: str


# Full archive (1991–2025); simulations slice the last 20 years (2006–2025) by default
ALL_INDIAN_MARKET_ANNUAL_DATA: list[AnnualMarketRecord] = [
    {"year": 1991, "equity_return": 0.821, "fixed_income_return": 0.118, "property_return": 0.145, "cpi_inflation": 0.139, "regime_note": "Economic Liberalization Boom"},
    {"year": 1992, "equity_return": 0.380, "fixed_income_return": 0.125, "property_return": 0.160, "cpi_inflation": 0.118, "regime_note": "Securities Market Surge & Correction"},
    {"year": 1993, "equity_return": 0.295, "fixed_income_return": 0.122, "property_return": 0.135, "cpi_inflation": 0.064, "regime_note": "Institutional Entry & Post-Reform Recovery"},
    {"year": 1994, "equity_return": 0.182, "fixed_income_return": 0.110, "property_return": 0.180, "cpi_inflation": 0.102, "regime_note": "Mid-90s Industrial Expansion"},
    {"year": 1995, "equity_return": -0.201, "fixed_income_return": 0.115, "property_return": 0.110, "cpi_inflation": 0.102, "regime_note": "Liquidity Tightening Bear Market"},
    {"year": 1996, "equity_return": -0.004, "fixed_income_return": 0.124, "property_return": 0.055, "cpi_inflation": 0.090, "regime_note": "Political Transition Consolidation"},
    {"year": 1997, "equity_return": 0.198, "fixed_income_return": 0.132, "property_return": -0.020, "cpi_inflation": 0.072, "regime_note": "Asian Financial Crisis Contagion"},
    {"year": 1998, "equity_return": -0.157, "fixed_income_return": 0.119, "property_return": -0.035, "cpi_inflation": 0.132, "regime_note": "Sanctions & Global Turmoil"},
    {"year": 1999, "equity_return": 0.652, "fixed_income_return": 0.128, "property_return": 0.045, "cpi_inflation": 0.047, "regime_note": "IT & Dot-Com Surge"},
    {"year": 2000, "equity_return": -0.199, "fixed_income_return": 0.109, "property_return": 0.040, "cpi_inflation": 0.040, "regime_note": "Dot-Com Bubble Burst"},
    {"year": 2001, "equity_return": -0.150, "fixed_income_return": 0.145, "property_return": 0.035, "cpi_inflation": 0.038, "regime_note": "Global Recession & Market Crash"},
    {"year": 2002, "equity_return": 0.053, "fixed_income_return": 0.138, "property_return": 0.052, "cpi_inflation": 0.043, "regime_note": "Rate Cut Bond Rally"},
    {"year": 2003, "equity_return": 0.738, "fixed_income_return": 0.088, "property_return": 0.115, "cpi_inflation": 0.038, "regime_note": "Structural Bull Market Launch"},
    {"year": 2004, "equity_return": 0.130, "fixed_income_return": 0.032, "property_return": 0.155, "cpi_inflation": 0.038, "regime_note": "Infrastructure & Capex Cycle"},
    {"year": 2005, "equity_return": 0.386, "fixed_income_return": 0.058, "property_return": 0.195, "cpi_inflation": 0.042, "regime_note": "High GDP Growth Boom"},
    # --- LAST 20 YEARS REPRESENTATIVE MODERN INDIA DATASET (2006 - 2025) ---
    {"year": 2006, "equity_return": 0.419, "fixed_income_return": 0.052, "property_return": 0.210, "cpi_inflation": 0.058, "regime_note": "Real Estate & Equity Surge"},
    {"year": 2007, "equity_return": 0.568, "fixed_income_return": 0.074, "property_return": 0.185, "cpi_inflation": 0.064, "regime_note": "Pre-GFC Peak Euphoria"},
    {"year": 2008, "equity_return": -0.513, "fixed_income_return": 0.112, "property_return": -0.045, "cpi_inflation": 0.083, "regime_note": "Global Financial Crisis Crash"},
    {"year": 2009, "equity_return": 0.776, "fixed_income_return": 0.048, "property_return": 0.095, "cpi_inflation": 0.109, "regime_note": "Post-GFC Stimulus Rebound"},
    {"year": 2010, "equity_return": 0.192, "fixed_income_return": 0.056, "property_return": 0.165, "cpi_inflation": 0.120, "regime_note": "Double-Digit Inflation Recovery"},
    {"year": 2011, "equity_return": -0.238, "fixed_income_return": 0.068, "property_return": 0.140, "cpi_inflation": 0.089, "regime_note": "Euro Crisis & Rate Hikes"},
    {"year": 2012, "equity_return": 0.294, "fixed_income_return": 0.098, "property_return": 0.150, "cpi_inflation": 0.093, "regime_note": "Liquidity Driven Rebound"},
    {"year": 2013, "equity_return": 0.081, "fixed_income_return": 0.045, "property_return": 0.105, "cpi_inflation": 0.109, "regime_note": "Taper Tantrum & Currency Depreciation"},
    {"year": 2014, "equity_return": 0.329, "fixed_income_return": 0.135, "property_return": 0.080, "cpi_inflation": 0.064, "regime_note": "Inflation Targeting & Reform Rally"},
    {"year": 2015, "equity_return": -0.030, "fixed_income_return": 0.086, "property_return": 0.048, "cpi_inflation": 0.049, "regime_note": "Earnings Consolidation"},
    {"year": 2016, "equity_return": 0.044, "fixed_income_return": 0.122, "property_return": 0.032, "cpi_inflation": 0.049, "regime_note": "Currency Transition & Bond Rally"},
    {"year": 2017, "equity_return": 0.303, "fixed_income_return": 0.054, "property_return": 0.038, "cpi_inflation": 0.033, "regime_note": "Tax Reform & Domestic SIP Boom"},
    {"year": 2018, "equity_return": 0.046, "fixed_income_return": 0.062, "property_return": 0.042, "cpi_inflation": 0.039, "regime_note": "Credit Tightening & Midcap Fall"},
    {"year": 2019, "equity_return": 0.135, "fixed_income_return": 0.102, "property_return": 0.035, "cpi_inflation": 0.037, "regime_note": "Corporate Tax Cut & Largecap Rally"},
    {"year": 2020, "equity_return": 0.161, "fixed_income_return": 0.118, "property_return": 0.015, "cpi_inflation": 0.066, "regime_note": "COVID-19 Shock & V-Shaped Recovery"},
    {"year": 2021, "equity_return": 0.256, "fixed_income_return": 0.042, "property_return": 0.055, "cpi_inflation": 0.051, "regime_note": "Post-Pandemic Tech & Cyclical Boom"},
    {"year": 2022, "equity_return": 0.057, "fixed_income_return": 0.038, "property_return": 0.078, "cpi_inflation": 0.067, "regime_note": "Global Rate Hike Cycle & Geopolitics"},
    {"year": 2023, "equity_return": 0.213, "fixed_income_return": 0.074, "property_return": 0.095, "cpi_inflation": 0.057, "regime_note": "Domestic Capex & Manufacturing Surge"},
    {"year": 2024, "equity_return": 0.101, "fixed_income_return": 0.086, "property_return": 0.088, "cpi_inflation": 0.049, "regime_note": "Steady Domestic Flows & Bond Inclusion"},
    {"year": 2025, "equity_return": 0.114, "fixed_income_return": 0.079, "property_return": 0.075, "cpi_inflation": 0.045, "regime_note": "Disinflation & Balanced Growth"},
]

# Active 20-year representative dataset (2006–2025)
INDIAN_MARKET_ANNUAL_DATA: list[AnnualMarketRecord] = ALL_INDIAN_MARKET_ANNUAL_DATA[-20:]

# Key historical Indian retirement cohorts within the 20-year window (2006–2025)
HISTORICAL_CRISIS_COHORTS: list[dict[str, Any]] = [
    {
        "start_year": 2006,
        "label": "2006 Pre-GFC Boom & Crash Cycle",
        "description": "Retiring during the 2006-07 boom followed by the 2008 crash.",
    },
    {
        "start_year": 2008,
        "label": "2008 Global Financial Crisis Peak",
        "description": "Retiring right before the -51.3% Sensex/Nifty crash and 2009-2013 high CPI inflation.",
    },
    {
        "start_year": 2011,
        "label": "2011 Stagflation & Taper Tantrum",
        "description": "Retiring into a -23.8% equity drop combined with 9-11% persistent Indian consumer inflation.",
    },
    {
        "start_year": 2015,
        "label": "2015 Low-Inflation Modern Era",
        "description": "Retiring under RBI's modern inflation-targeting regime and steady domestic SIP inflows.",
    },
    {
        "start_year": 2020,
        "label": "2020 Pandemic & Recovery Era",
        "description": "Retiring during COVID-19 volatility and post-pandemic expansion.",
    },
    {
        "start_year": 2022,
        "label": "2022 Global Rate Hike Regime",
        "description": "Retiring into global central bank tightening and domestic capex resilience.",
    },
]


def get_historical_arrays(last_n_years: int = 20) -> dict[str, np.ndarray]:
    """Return numpy arrays for the last `last_n_years` of Indian market history (default 20 years: 2006-2025)."""
    source = ALL_INDIAN_MARKET_ANNUAL_DATA[-last_n_years:] if last_n_years > 0 else INDIAN_MARKET_ANNUAL_DATA
    years = np.array([row["year"] for row in source], dtype=np.int32)
    equity = np.array([row["equity_return"] for row in source], dtype=np.float64)
    fixed_income = np.array(
        [row["fixed_income_return"] for row in source], dtype=np.float64
    )
    property_ret = np.array(
        [row["property_return"] for row in source], dtype=np.float64
    )
    cpi = np.array([row["cpi_inflation"] for row in source], dtype=np.float64)

    return {
        "years": years,
        "equity": equity,
        "fixed_income": fixed_income,
        "property": property_ret,
        "cpi": cpi,
    }


def _compute_cagr(returns: np.ndarray) -> float:
    """Compute geometric mean / CAGR from an array of annual decimal returns."""
    n = len(returns)
    if n == 0:
        return 0.0
    compounded = float(np.prod(1.0 + returns))
    if compounded <= 0:
        return 0.0
    return float(compounded ** (1.0 / n) - 1.0)


def get_market_summary_statistics(last_n_years: int = 20) -> dict[str, Any]:
    """Compute statistical summary of Indian asset classes and inflation (default last 20 years: 2006-2025)."""
    arrays = get_historical_arrays(last_n_years=last_n_years)
    source_records = ALL_INDIAN_MARKET_ANNUAL_DATA[-last_n_years:] if last_n_years > 0 else INDIAN_MARKET_ANNUAL_DATA
    asset_keys = ["equity", "fixed_income", "property", "cpi"]
    labels = {
        "equity": "Indian Equity (Nifty 50 / Sensex TRI)",
        "fixed_income": "Indian Fixed Income (10Y G-Sec / Debt)",
        "property": "Indian Residential Property (HPI)",
        "cpi": "Indian CPI Inflation",
    }

    stats: dict[str, Any] = {}
    for key in asset_keys:
        arr = arrays[key]
        stats[key] = {
            "label": labels[key],
            "mean": round(float(np.mean(arr)) * 100, 2),
            "cagr": round(_compute_cagr(arr) * 100, 2),
            "std_dev": round(float(np.std(arr, ddof=1)) * 100, 2),
            "min": round(float(np.min(arr)) * 100, 2),
            "max": round(float(np.max(arr)) * 100, 2),
            "p10": round(float(np.percentile(arr, 10)) * 100, 2),
            "median": round(float(np.median(arr)) * 100, 2),
            "p90": round(float(np.percentile(arr, 90)) * 100, 2),
        }

    matrix = np.vstack([arrays[k] for k in asset_keys])
    corr = np.corrcoef(matrix)
    correlation_dict: dict[str, dict[str, float]] = {}
    for i, k1 in enumerate(asset_keys):
        correlation_dict[k1] = {}
        for j, k2 in enumerate(asset_keys):
            correlation_dict[k1][k2] = round(float(corr[i, j]), 3)

    return {
        "period_start": int(arrays["years"][0]),
        "period_end": int(arrays["years"][-1]),
        "num_years": int(len(arrays["years"])),
        "asset_statistics": stats,
        "correlations": correlation_dict,
        "annual_series": source_records,
        "crisis_cohorts": HISTORICAL_CRISIS_COHORTS,
    }
