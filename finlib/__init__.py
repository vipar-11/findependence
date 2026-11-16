"""
FinLib: Reusable Financial Independence & Simulation Library for India.

Provides core financial mathematics, Indian historical market return series,
statistical Monte Carlo & historical backtesting engines, and a pluggable
simulator registry for financial independence calculators.
"""

from finlib.core.engine import BaseSimulator, SimulatorMetadata, SimulatorRegistry, registry
from finlib.core.finance import (
    compute_longevity_stats,
    compute_trajectory_percentiles,
    fisher_real_return,
    format_inr,
    format_inr_compact,
    project_expenses,
)
from finlib.data.indian_market_history import (
    HISTORICAL_CRISIS_COHORTS,
    INDIAN_MARKET_ANNUAL_DATA,
    get_historical_arrays,
    get_market_summary_statistics,
)

__all__ = [
    "BaseSimulator",
    "SimulatorMetadata",
    "SimulatorRegistry",
    "registry",
    "compute_longevity_stats",
    "compute_trajectory_percentiles",
    "fisher_real_return",
    "format_inr",
    "format_inr_compact",
    "project_expenses",
    "HISTORICAL_CRISIS_COHORTS",
    "INDIAN_MARKET_ANNUAL_DATA",
    "get_historical_arrays",
    "get_market_summary_statistics",
]

