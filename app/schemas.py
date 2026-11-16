"""Pydantic schemas for FinDependence India API requests and responses."""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator


class KnownFutureExpenseItem(BaseModel):
    """A known future one-time expense at today's rupee value tagged by event (e.g., Education, Marriage)."""

    years_from_now: int = Field(..., ge=1, le=75, description="How many years from today this expense occurs")
    amount_today_inr: float = Field(..., gt=0, description="Expense amount in today's INR (will be adjusted for inflation)")
    event_tag: str = Field(default="Planned Goal", max_length=64, description="Tag/label for the event (e.g. Marriage, Education)")


class WealthLongevityRequest(BaseModel):
    """Input configuration for the 'Can I Retire Today?' / 'How Long Will My Wealth Last?' simulator."""

    current_age: int = Field(default=38, ge=18, le=85, description="Current age in years")
    life_expectancy: int = Field(default=90, ge=50, le=110, description="Target planning age / life expectancy")
    has_medical_insurance: bool = Field(
        default=True,
        description="Whether the individual has comprehensive Medical Insurance coverage (Yes/No)",
    )
    total_corpus: float = Field(
        default=3_50_00_000.0,
        gt=0,
        le=1000_00_00_000.0,
        description="Total current corpus in INR (Equity + Fixed Income + Property)",
    )
    equity_pct: float = Field(default=55.0, ge=0.0, le=100.0, description="Allocation to Indian Equity (%)")
    fixed_income_pct: float = Field(default=30.0, ge=0.0, le=100.0, description="Allocation to Fixed Income / Debt (%)")
    property_pct: float = Field(default=15.0, ge=0.0, le=100.0, description="Allocation to Real Estate / Property (%)")
    expense_amount: float = Field(
        default=1_00_000.0,
        gt=0,
        description="Current household expense in INR (monthly or annual based on expense_frequency)",
    )
    expense_frequency: Literal["monthly", "annual"] = Field(
        default="monthly",
        description="Whether expense_amount is entered as monthly or annual",
    )

    # Advanced configuration parameters
    base_inflation_rate: float = Field(
        default=6.0,
        ge=0.0,
        le=20.0,
        description="Expected baseline Indian CPI inflation rate (% p.a.)",
    )
    lifestyle_inflation_rate: float = Field(
        default=0.5,
        ge=-5.0,
        le=10.0,
        description="Annual lifestyle creep / healthcare escalation above CPI (% p.a.)",
    )
    post_retirement_expense_multiplier: float = Field(
        default=100.0,
        ge=30.0,
        le=200.0,
        description="Post-retirement expense as % of current expense (e.g., 100% = same lifestyle)",
    )
    property_mode: Literal[
        "liquidate_fallback",
        "illiquid_with_rent",
        "illiquid_excluded",
        "rebalanced",
    ] = Field(
        default="liquidate_fallback",
        description="How property allocation is treated during retirement drawdown",
    )
    property_rental_yield: float = Field(
        default=2.5,
        ge=0.0,
        le=12.0,
        description="Net annual rental yield on property allocation (% p.a.)",
    )
    property_liquidation_haircut: float = Field(
        default=10.0,
        ge=0.0,
        le=50.0,
        description="Transaction cost / illiquidity discount when liquidating property (%)",
    )

    # Periodic Rebalancing & Taxation Configuration
    rebalance_annually: bool = Field(
        default=True,
        description="Whether to periodically rebalance portfolio back to initial allocation",
    )
    rebalance_frequency_years: int = Field(
        default=2,
        ge=1,
        le=20,
        description="Rebalance frequency in years (default every 2 years)",
    )
    fixed_income_tax_rate: float = Field(
        default=30.0,
        ge=0.0,
        le=50.0,
        description="Tax rate on Fixed Income withdrawals and sales (%)",
    )
    equity_tax_rate: float = Field(
        default=12.5,
        ge=0.0,
        le=50.0,
        description="Tax rate on Equity withdrawals and sales (%)",
    )
    effective_tax_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=50.0,
        description="Optional legacy uniform tax rate override",
    )

    # Home Improvement Configuration (% ± variance of property value every X years)
    home_improvement_enabled: bool = Field(
        default=True,
        description="Enable periodic home improvement expenses as % of property value",
    )
    home_improvement_interval_years: int = Field(
        default=5,
        ge=1,
        le=30,
        description="Frequency of home improvement in years (every X years)",
    )
    home_improvement_pct_of_property: float = Field(
        default=3.0,
        ge=0.0,
        le=30.0,
        description="Base percentage of property value spent on home improvement (%)",
    )
    home_improvement_variance_pct: float = Field(
        default=1.0,
        ge=0.0,
        le=20.0,
        description="Plus/minus variance percentage of property value (%)",
    )

    # Random Shock Expense Configuration (at today's ₹ ± variance, adjusted for inflation)
    random_expense_enabled: bool = Field(
        default=True,
        description="Enable random annual shock expenses",
    )
    random_expense_base_inr: float = Field(
        default=2_00_000.0,
        ge=0.0,
        description="Random expense base value in today's INR",
    )
    random_expense_variance_pct: float = Field(
        default=25.0,
        ge=0.0,
        le=100.0,
        description="Plus/minus variance (%) on random expense amount",
    )
    random_expense_annual_probability_pct: float = Field(
        default=15.0,
        ge=0.0,
        le=100.0,
        description="Probability (%) of random expense occurring in any given year",
    )

    # Known Future Expenses by Year at Today's Value Tagged by Event
    known_future_expenses: list[KnownFutureExpenseItem] = Field(
        default_factory=list,
        description="List of known future expenses at today's value tagged by event (e.g. Marriage, Education)",
    )

    num_simulations: int = Field(
        default=1000,
        ge=100,
        le=5000,
        description="Number of Monte Carlo simulation runs",
    )
    sampling_method: Literal["iid_bootstrap", "block_bootstrap", "parametric_correlated"] = Field(
        default="iid_bootstrap",
        description="Monte Carlo return sampling methodology",
    )
    use_historical_inflation_volatility: bool = Field(
        default=True,
        description="Whether to superimpose historical Indian CPI volatility around base_inflation_rate",
    )
    seed: int | None = Field(
        default=None,
        description="Optional random seed; when None, generates a fresh random sample of historical returns",
    )

    @model_validator(mode="after")
    def validate_ages_and_weights(self) -> "WealthLongevityRequest":
        if self.life_expectancy <= self.current_age + 4:
            raise ValueError("life_expectancy must be at least 5 years greater than current_age.")
        total_w = self.equity_pct + self.fixed_income_pct + self.property_pct
        if abs(total_w - 100.0) > 1.0:
            raise ValueError(
                f"Asset allocation percentages must sum to 100% (currently {total_w:.1f}%)."
            )
        return self


class GenericSimulationRequest(BaseModel):
    """Generic payload wrapper for running any registered simulator by ID."""

    params: dict[str, Any] = Field(default_factory=dict)
