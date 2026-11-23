"""
Indian Historical Market Returns & Macroeconomic Dataset Loader.

Reads annual Indian Equity (Nifty 50 TRI), Fixed Income (RBI 1-3 Yr Term Deposit / Debt),
Residential Property (RBI HPI / NHB Residex), and All-India CPI Inflation from
`indian_market_history.csv`.

Automatically selects the last 20 years of available data relative to the current calendar year
without hardcoding year boundaries.
"""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path
from typing import Any, TypedDict
import numpy as np

CSV_DATA_PATH = Path(__file__).parent / "indian_market_history.csv"
DEFAULT_LOOKBACK_YEARS = 20


class AnnualMarketRecord(TypedDict):
    year: int
    equity_return: float
    fixed_income_return: float
    property_return: float
    cpi_inflation: float
    regime_note: str


def load_all_market_data(csv_path: Path | None = None) -> list[AnnualMarketRecord]:
    """Load and sort all historical market records from the CSV file."""
    target_path = csv_path or CSV_DATA_PATH
    records: list[AnnualMarketRecord] = []
    with open(target_path, mode="r", encoding="utf-8") as fp:
        reader = csv.DictReader(fp)
        for row in reader:
            if not row or not row.get("year"):
                continue
            records.append(
                {
                    "year": int(row["year"]),
                    "equity_return": float(row["equity_return"]),
                    "fixed_income_return": float(row["fixed_income_return"]),
                    "property_return": float(row["property_return"]),
                    "cpi_inflation": float(row["cpi_inflation"]),
                    "regime_note": str(row.get("regime_note", "")).strip(),
                }
            )
    records.sort(key=lambda r: r["year"])
    return records


def get_recent_market_data(
    last_n_years: int = DEFAULT_LOOKBACK_YEARS,
    reference_year: int | None = None,
    csv_path: Path | None = None,
) -> list[AnnualMarketRecord]:
    """
    Return the last `last_n_years` (default 20) of market data up to `reference_year`
    (defaults to current calendar year).
    """
    all_records = load_all_market_data(csv_path=csv_path)
    cur_year = reference_year if reference_year is not None else date.today().year
    eligible = [r for r in all_records if r["year"] <= cur_year]
    if not eligible:
        eligible = all_records
    if last_n_years > 0:
        return eligible[-last_n_years:]
    return eligible


def _build_crisis_cohorts(records: list[AnnualMarketRecord]) -> list[dict[str, Any]]:
    """Build notable historical retirement cohorts dynamically from the active 20-year window."""
    cohorts: list[dict[str, Any]] = []
    if not records:
        return cohorts

    # Pick notable years dynamically (lowest equity years, highest inflation year, first year, midpoint)
    sorted_by_eq = sorted(records, key=lambda r: r["equity_return"])
    sorted_by_cpi = sorted(records, key=lambda r: r["cpi_inflation"], reverse=True)

    selected_years: list[int] = []
    for candidate in [
        records[0]["year"],
        sorted_by_eq[0]["year"],
        sorted_by_eq[1]["year"] if len(sorted_by_eq) > 1 else records[0]["year"],
        sorted_by_cpi[0]["year"],
        records[len(records) // 2]["year"],
        records[-3]["year"] if len(records) >= 3 else records[-1]["year"],
    ]:
        if candidate not in selected_years:
            selected_years.append(candidate)

    by_year = {r["year"]: r for r in records}
    for y in sorted(selected_years):
        rec = by_year[y]
        cohorts.append(
            {
                "start_year": y,
                "label": f"{y} — {rec['regime_note']}",
                "description": (
                    f"Equity {rec['equity_return']*100:+.1f}%, "
                    f"Fixed Income {rec['fixed_income_return']*100:+.1f}%, "
                    f"Inflation {rec['cpi_inflation']*100:.1f}%."
                ),
            }
        )
    return cohorts


ALL_INDIAN_MARKET_ANNUAL_DATA: list[AnnualMarketRecord] = load_all_market_data()
INDIAN_MARKET_ANNUAL_DATA: list[AnnualMarketRecord] = get_recent_market_data(DEFAULT_LOOKBACK_YEARS)
HISTORICAL_CRISIS_COHORTS: list[dict[str, Any]] = _build_crisis_cohorts(INDIAN_MARKET_ANNUAL_DATA)


def get_historical_arrays(
    last_n_years: int = DEFAULT_LOOKBACK_YEARS,
    reference_year: int | None = None,
    csv_path: Path | None = None,
) -> dict[str, np.ndarray]:
    """Return numpy arrays for the last `last_n_years` of Indian market history (default last 20 years)."""
    source = get_recent_market_data(
        last_n_years=last_n_years,
        reference_year=reference_year,
        csv_path=csv_path,
    )
    years = np.array([row["year"] for row in source], dtype=np.int32)
    equity = np.array([row["equity_return"] for row in source], dtype=np.float64)
    fixed_income = np.array([row["fixed_income_return"] for row in source], dtype=np.float64)
    property_ret = np.array([row["property_return"] for row in source], dtype=np.float64)
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


def get_market_summary_statistics(
    last_n_years: int = DEFAULT_LOOKBACK_YEARS,
    reference_year: int | None = None,
    csv_path: Path | None = None,
) -> dict[str, Any]:
    """Compute statistical summary of Indian asset classes and inflation over the last 20 years."""
    source_records = get_recent_market_data(
        last_n_years=last_n_years,
        reference_year=reference_year,
        csv_path=csv_path,
    )
    arrays = get_historical_arrays(
        last_n_years=last_n_years,
        reference_year=reference_year,
        csv_path=csv_path,
    )
    asset_keys = ["equity", "fixed_income", "property", "cpi"]
    labels = {
        "equity": "Indian Equity (Stocks / Mutual Funds)",
        "fixed_income": "Indian Fixed Income (Fixed Deposits / Debt)",
        "property": "Indian Real Estate (Housing Price Index)",
        "cpi": "Indian Consumer Inflation (CPI)",
    }

    stats: dict[str, Any] = {}
    for key in asset_keys:
        arr = arrays[key]
        stats[key] = {
            "label": labels[key],
            "mean": round(float(np.mean(arr)) * 100, 2),
            "cagr": round(_compute_cagr(arr) * 100, 2),
            "std_dev": round(float(np.std(arr, ddof=1)) * 100, 2) if len(arr) > 1 else 0.0,
            "min": round(float(np.min(arr)) * 100, 2),
            "max": round(float(np.max(arr)) * 100, 2),
            "p10": round(float(np.percentile(arr, 10)) * 100, 2),
            "median": round(float(np.median(arr)) * 100, 2),
            "p90": round(float(np.percentile(arr, 90)) * 100, 2),
        }

    matrix = np.vstack([arrays[k] for k in asset_keys])
    corr = np.corrcoef(matrix) if matrix.shape[1] > 1 else np.eye(len(asset_keys))
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
        "crisis_cohorts": _build_crisis_cohorts(source_records),
    }
