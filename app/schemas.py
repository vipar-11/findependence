"""Pydantic schemas for FinDependence India API requests and responses."""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator


class KnownFutureExpenseItem(BaseModel):
    """
    A planned future expense at today's rupee value tagged by event.
    Supports both One-Off events (Education, Marriage, Vehicle) and
    Recurring events (Home Improvement, Vacation) with start year, end year,
    every N years frequency, and +/- variance percentage.
    """

    event_tag: str = Field(default="Planned Goal", max_length=64, description="Label for the event (e.g. Education, Marriage, Vacation)")
    amount_today_inr: float = Field(..., gt=0, description="Expense amount in today's INR (adjusted for inflation over time)")
    is_recurring: bool = Field(default=False, description="Whether this expense repeats periodically")
    years_from_now: int = Field(default=1, ge=1, le=75, description="Years from today for a one-off expense (or start year)")
    start_year: int | None = Field(default=None, ge=1, le=75, description="Start year from now for a recurring expense")
    end_year: int | None = Field(default=None, ge=1, le=75, description="End year from now for a recurring expense (None defaults to end of plan)")
    start_age: int | None = Field(default=None, ge=18, le=110, description="Start age (or one-off age) for a planned expense")
    end_age: int | None = Field(default=None, ge=18, le=110, description="End age for a recurring expense (None defaults to end of plan)")
    every_n_years: int = Field(default=1, ge=1, le=30, description="Repeat frequency in years for a recurring expense")
    variance_pct: float = Field(default=0.0, ge=0.0, le=100.0, description="Plus/minus variance (%) around amount_today_inr (0 means no variance)")

    def get_occurrence_years(self, max_horizon: int = 75, current_age: int | None = None) -> list[int]:
        """Return the exact list of simulation year offsets (1-indexed) when this expense occurs."""
        if not self.is_recurring:
            if self.start_age is not None and current_age is not None:
                y_off = max(1, self.start_age - current_age)
            else:
                y_off = self.years_from_now
            return [y_off] if 1 <= y_off <= max_horizon else []
        if self.start_age is not None and current_age is not None:
            s_yr = max(1, self.start_age - current_age)
        else:
            s_yr = self.start_year if self.start_year is not None else self.years_from_now
        if self.end_age is not None and current_age is not None:
            e_yr = max(s_yr, self.end_age - current_age)
        else:
            e_yr = self.end_year if self.end_year is not None else max_horizon
        e_yr = max(s_yr, min(e_yr, max_horizon))
        step = max(1, self.every_n_years)
        return list(range(s_yr, e_yr + 1, step))


class WealthLongevityRequest(BaseModel):
    """Input configuration for the 'Can I Retire Today?' / 'How Long Will My Wealth Last?' simulator."""

    current_age: int = Field(default=38, ge=18, le=85, description="Current age in years")
    life_expectancy: int = Field(default=90, ge=50, le=110, description="Target planning age / life expectancy")
    has_medical_insurance: bool = Field(
        default=True,
        description="Whether the individual has Medical Insurance coverage (Yes/No)",
    )

    # Individual Asset Class Values in INR (Total Corpus is calculated from these 4 values)
    equity_value: float | None = Field(default=None, ge=0.0, description="Current value of Equity investments in INR")
    fixed_income_value: float | None = Field(default=None, ge=0.0, description="Current value of Fixed Income / Debt in INR")
    real_estate_value: float | None = Field(default=None, ge=0.0, description="Current value of Real Estate / Property in INR")
    cash_value: float | None = Field(default=None, ge=0.0, description="Current value of Cash / Savings Balance in INR")

    # Computed / Legacy Total Corpus & Asset Split Percentages (0 allowed when Step 2 is left blank)
    total_corpus: float = Field(
        default=3_50_00_000.0,
        ge=0.0,
        le=1000_00_00_000.0,
        description="Total current savings in INR (Equity + Fixed Income + Real Estate + Cash)",
    )
    equity_pct: float = Field(default=54.29, ge=0.0, le=100.0, description="Share in Indian Equity (%)")
    fixed_income_pct: float = Field(default=27.14, ge=0.0, le=100.0, description="Share in Fixed Income / Debt (%)")
    property_pct: float = Field(default=14.29, ge=0.0, le=100.0, description="Share in Real Estate / Property (%)")
    cash_pct: float = Field(default=4.28, ge=0.0, le=100.0, description="Share in Cash Balance (%)")

    # Income Categories (Step 3)
    job_monthly_income: float = Field(default=0.0, ge=0.0, description="Current monthly Job / Business income in INR")
    job_income_years: int = Field(default=0, ge=0, le=60, description="How many years Job / Business income is expected to last")
    job_income_until_age: int | None = Field(default=None, ge=18, le=110, description="Age until which Job / Business income is expected to last")
    job_income_growth_pct: float = Field(default=5.0, ge=-10.0, le=50.0, description="Expected annual increment (or lower bound) on Job / Business income (%)")
    job_income_growth_max_pct: float | None = Field(default=None, ge=-10.0, le=50.0, description="Optional upper bound of annual increment range (%) for uniform distribution")
    job_income_growth_range: str | None = Field(default=None, max_length=32, description="Optional increment range string such as '5-7%' or '5'")
    rental_monthly_income: float = Field(default=0.0, ge=0.0, description="Current monthly Rental income in INR")
    other_passive_monthly_income: float = Field(default=0.0, ge=0.0, description="Current monthly Other Passive income in INR")
    passive_income_inflation_interval_years: int = Field(
        default=3,
        ge=1,
        le=20,
        description="Every N years that rental and passive income step up to adjust for cumulative inflation (default 3 years)",
    )

    # Ongoing SIP Investments (Step 4)
    equity_sip_monthly: float = Field(default=0.0, ge=0.0, description="Monthly SIP in Equity in INR")
    equity_sip_stepup_pct: float = Field(default=10.0, ge=0.0, le=50.0, description="Annual step-up (%) on Equity SIP")
    fixed_income_sip_monthly: float = Field(default=0.0, ge=0.0, description="Monthly SIP in Fixed Income in INR")
    fixed_income_sip_stepup_pct: float = Field(default=5.0, ge=0.0, le=50.0, description="Annual step-up (%) on Fixed Income SIP")
    sip_years: int | None = Field(default=None, ge=0, le=75, description="Optional override for SIP years (by default SIPs continue until end of income)")

    # Living Expenses (Step 5)
    expense_amount: float = Field(
        default=1_00_000.0,
        gt=0,
        description="Current household living expense in INR (monthly or annual based on expense_frequency)",
    )
    expense_frequency: Literal["monthly", "annual"] = Field(
        default="monthly",
        description="Whether expense_amount is entered as monthly or annual",
    )
    expense_variance_pct: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Optional plus/minus annual variance (%) on base living expenses (0 means no variance)",
    )
    global_variance_pct: float | None = Field(
        default=None,
        ge=0.0,
        le=100.0,
        description="Optional global cost variance (%) applied across living expenses, recurring goals, and random shocks",
    )

    # Advanced configuration parameters (Inflation comes from historical market data by default)
    base_inflation_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=20.0,
        description="Optional override for baseline CPI inflation rate (% p.a.); None uses historical market data",
    )
    lifestyle_inflation_rate: float = Field(
        default=0.5,
        ge=-5.0,
        le=10.0,
        description="Annual lifestyle creep above market inflation (% p.a.)",
    )
    post_retirement_expense_multiplier: float = Field(
        default=100.0,
        ge=30.0,
        le=200.0,
        description="Post-retirement expense as % of current expense",
    )
    property_mode: Literal[
        "liquidate_fallback",
        "illiquid_with_rent",
        "illiquid_excluded",
        "rebalanced",
    ] = Field(
        default="liquidate_fallback",
        description="How real estate is treated during retirement",
    )
    property_rental_yield: float = Field(
        default=0.0,
        ge=0.0,
        le=12.0,
        description="Optional implicit rental yield on real estate (% p.a.); defaults to 0 so no phantom rent is added",
    )
    property_liquidation_haircut: float = Field(
        default=10.0,
        ge=0.0,
        le=50.0,
        description="Transaction cost / discount when selling real estate (%)",
    )

    # Periodic Rebalancing & Uniform Tax Drag Configuration (Default 10% across all asset classes)
    rebalance_annually: bool = Field(
        default=True,
        description="Whether to periodically rebalance portfolio back to initial allocation",
    )
    rebalance_enabled: bool | None = Field(
        default=None,
        description="Alias for enabling periodic rebalancing",
    )
    rebalance_frequency_years: int = Field(
        default=2,
        ge=1,
        le=20,
        description="Rebalance frequency in years (default every 2 years)",
    )
    tax_drag_rate: float = Field(
        default=10.0,
        ge=0.0,
        le=50.0,
        description="Uniform tax drag rate (%) applicable to all asset classes on withdrawals and rebalancing",
    )
    fixed_income_tax_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=50.0,
        description="Optional legacy tax rate override for Fixed Income (%)",
    )
    equity_tax_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=50.0,
        description="Optional legacy tax rate override for Equity (%)",
    )
    effective_tax_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=50.0,
        description="Optional legacy uniform tax rate override (%)",
    )

    # Legacy Home Improvement fields (kept optional for backward compatibility; moved to recurring future goals)
    home_improvement_enabled: bool = Field(default=False, description="Legacy periodic home improvement toggle")
    home_improvement_interval_years: int = Field(default=5, ge=1, le=30)
    home_improvement_pct_of_property: float = Field(default=3.0, ge=0.0, le=30.0)
    home_improvement_variance_pct: float = Field(default=1.0, ge=0.0, le=20.0)

    # Random Annual Shock Expense Configuration (default is higher when no medical insurance is available)
    random_expense_enabled: bool = Field(
        default=True,
        description="Enable random annual shock expenses",
    )
    random_expense_base_inr: float | None = Field(
        default=None,
        ge=0.0,
        description="Random shock base value in today's INR (defaults to ₹2L with medical insurance, ₹5L without)",
    )
    random_expense_variance_pct: float = Field(
        default=25.0,
        ge=0.0,
        le=100.0,
        description="Plus/minus variance (%) on random shock amount",
    )
    random_expense_annual_probability_pct: float = Field(
        default=15.0,
        ge=0.0,
        le=100.0,
        description="Annual chance (%) of a random shock occurring",
    )

    # Known Future Expenses (One-Off & Recurring) at Today's Value Tagged by Event
    known_future_expenses: list[KnownFutureExpenseItem] = Field(
        default_factory=list,
        description="List of one-off and recurring future expenses at today's value tagged by event",
    )

    num_simulations: int = Field(
        default=2500,
        ge=100,
        le=5000,
        description="Number of simulation runs (default 2,500)",
    )
    sampling_method: Literal["iid_bootstrap", "block_bootstrap", "parametric_correlated"] = Field(
        default="iid_bootstrap",
        description="Historical return sampling methodology",
    )
    use_historical_inflation_volatility: bool = Field(
        default=True,
        description="Whether to use historical CPI inflation volatility from market data",
    )
    seed: int | None = Field(
        default=None,
        description="Optional random seed",
    )

    @model_validator(mode="after")
    def validate_ages_and_assets(self) -> "WealthLongevityRequest":
        if self.life_expectancy <= self.current_age + 4:
            raise ValueError("life_expectancy must be at least 5 years greater than current_age.")

        has_explicit_values = any(
            v is not None
            for v in (self.equity_value, self.fixed_income_value, self.real_estate_value, self.cash_value)
        )
        if has_explicit_values:
            eq_v = float(self.equity_value or 0.0)
            fi_v = float(self.fixed_income_value or 0.0)
            re_v = float(self.real_estate_value or 0.0)
            ca_v = float(self.cash_value or 0.0)
            tot = eq_v + fi_v + re_v + ca_v
            self.equity_value = eq_v
            self.fixed_income_value = fi_v
            self.real_estate_value = re_v
            self.cash_value = ca_v
            self.total_corpus = tot
            if tot > 0:
                self.equity_pct = (eq_v / tot) * 100.0
                self.fixed_income_pct = (fi_v / tot) * 100.0
                self.property_pct = (re_v / tot) * 100.0
                self.cash_pct = (ca_v / tot) * 100.0
            else:
                self.equity_pct = 0.0
                self.fixed_income_pct = 0.0
                self.property_pct = 0.0
                self.cash_pct = 0.0
        else:
            # Legacy percentage mode: if cash_pct wasn't explicitly set by caller, check sum of eq + fi + prop
            three_way = self.equity_pct + self.fixed_income_pct + self.property_pct
            if abs(three_way - 100.0) <= 1.0:
                self.cash_pct = 0.0
            total_w = self.equity_pct + self.fixed_income_pct + self.property_pct + self.cash_pct
            if abs(total_w - 100.0) > 1.0:
                raise ValueError(
                    f"Asset allocation percentages must sum to 100% (currently {total_w:.1f}%)."
                )
            self.equity_value = self.total_corpus * (self.equity_pct / 100.0)
            self.fixed_income_value = self.total_corpus * (self.fixed_income_pct / 100.0)
            self.real_estate_value = self.total_corpus * (self.property_pct / 100.0)
            self.cash_value = self.total_corpus * (self.cash_pct / 100.0)

        if self.random_expense_base_inr is None:
            self.random_expense_base_inr = 2_00_000.0 if self.has_medical_insurance else 5_00_000.0

        return self


class GenericSimulationRequest(BaseModel):
    """Generic payload wrapper for running any registered simulator by ID."""

    params: dict[str, Any] = Field(default_factory=dict)
