"""
Reusable financial calculation primitives for Indian FIRE & retirement simulators.

Includes:
- Indian numbering system formatting (₹, Lakhs, Crores)
- Real vs. nominal return conversions
- Multi-factor expense inflation projection (market CPI + lifestyle creep)
- Vectorized multi-asset portfolio simulation with:
  - Apples-to-apples pre-drawn random shocks and future expense variances across candidate retirement ages
  - Pre-retirement working years (`retirement_start_year_offset`) vs. post-retirement drawdown years
  - Equity, Fixed Income, Real Estate, and Cash Balance buckets
  - Job/Business Income, Rental Income, and Other Passive Income
  - Ongoing Equity and Fixed Income SIPs (with annual step-up %)
  - Fixed-Income/Cash-first withdrawal priority & configurable uniform tax drag (default 10%)
  - Periodic rebalancing with tax drag
  - One-Off and Recurring future expenses with variance
  - Random annual shock expenses (higher default when no medical insurance is available)
"""

from __future__ import annotations

from typing import Any, Literal
import numpy as np

PropertyTreatmentMode = Literal[
    "liquidate_fallback",
    "illiquid_with_rent",
    "illiquid_excluded",
    "rebalanced",
]


def format_inr(amount: float) -> str:
    """Format a number in the Indian numbering system (e.g., ₹1,23,45,678)."""
    sign = "-" if amount < 0 else ""
    val = int(round(abs(amount)))
    s = str(val)
    if len(s) <= 3:
        return f"{sign}₹{s}"
    last3 = s[-3:]
    rest = s[:-3]
    groups = []
    while len(rest) > 2:
        groups.append(rest[-2:])
        rest = rest[:-2]
    if rest:
        groups.append(rest)
    groups.reverse()
    return f"{sign}₹{','.join(groups)},{last3}"


def format_inr_compact(amount: float, decimals: int = 2) -> str:
    """Format an INR amount compactly into Crores (Cr) or Lakhs (L)."""
    sign = "-" if amount < 0 else ""
    abs_val = abs(amount)
    if abs_val >= 1_00_00_000:
        return f"{sign}₹{abs_val / 1_00_00_000:.{decimals}f} Cr"
    if abs_val >= 1_00_000:
        return f"{sign}₹{abs_val / 1_00_000:.{decimals}f} L"
    if abs_val >= 1_000:
        return f"{sign}₹{abs_val / 1_000:.1f} K"
    return f"{sign}₹{abs_val:.0f}"


def fisher_real_return(nominal_return: float | np.ndarray, inflation_rate: float | np.ndarray) -> float | np.ndarray:
    """Compute exact real return: (1 + r_nom) / (1 + i) - 1."""
    return (1.0 + nominal_return) / (1.0 + inflation_rate) - 1.0


def project_expenses(
    initial_annual_expense: float,
    horizon_years: int,
    inflation_rates: np.ndarray,
    lifestyle_inflation_rate: float = 0.0,
    post_retirement_multiplier: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Project annual base living expenses across `horizon_years` for `n_paths` simulations.
    """
    n_paths = inflation_rates.shape[0]
    base_year0 = initial_annual_expense * post_retirement_multiplier

    cumulative_cpi = np.ones((n_paths, horizon_years + 1), dtype=np.float64)
    for t in range(horizon_years):
        cumulative_cpi[:, t + 1] = cumulative_cpi[:, t] * (1.0 + inflation_rates[:, t])

    expenses_nominal = np.zeros((n_paths, horizon_years), dtype=np.float64)
    expenses_nominal[:, 0] = base_year0
    for t in range(1, horizon_years):
        effective_escalation = (1.0 + inflation_rates[:, t - 1]) * (1.0 + lifestyle_inflation_rate)
        expenses_nominal[:, t] = expenses_nominal[:, t - 1] * effective_escalation

    return expenses_nominal, cumulative_cpi


def _expand_future_expense_items(
    known_future_expenses: list[dict[str, Any]] | None,
    horizon_years: int,
    current_age: int | None = None,
) -> tuple[dict[int, list[dict[str, Any]]], dict[int, list[str]]]:
    """
    Expand one-off and recurring future expense items into a per-year map `t_idx -> list[{amount_today, variance, tag}]`.
    Supports `start_age` / `end_age` (with empty `end_age` defaulting to end of plan `horizon_years`)
    as well as `years_from_now` / `start_year` / `end_year`.
    """
    events_by_t: dict[int, list[dict[str, Any]]] = {}
    tags_by_t: dict[int, list[str]] = {}
    if not known_future_expenses:
        return events_by_t, tags_by_t

    for raw in known_future_expenses:
        item = raw if isinstance(raw, dict) else (raw.model_dump() if hasattr(raw, "model_dump") else dict(raw))
        amt_today = float(item.get("amount_today_inr", 0.0))
        if amt_today <= 0:
            continue
        tag = str(item.get("event_tag", "Planned Goal")).strip() or "Planned Goal"
        is_rec = bool(item.get("is_recurring", False))
        var_pct = float(item.get("variance_pct") or 0.0) / 100.0
        var_pct = max(0.0, min(1.0, var_pct))

        raw_s_age = item.get("start_age")
        raw_e_age = item.get("end_age")

        if is_rec:
            if raw_s_age is not None and current_age is not None:
                s_yr = max(1, int(raw_s_age) - current_age)
            else:
                s_yr = int(item.get("start_year") or item.get("years_from_now") or 1)
            if raw_e_age is not None and current_age is not None:
                e_yr = max(s_yr, int(raw_e_age) - current_age)
            else:
                e_yr = int(item.get("end_year") or horizon_years)
            step = max(1, int(item.get("every_n_years") or 3))
            s_yr = max(1, s_yr)
            e_yr = max(s_yr, min(e_yr, horizon_years))
            occ_years = list(range(s_yr, e_yr + 1, step))
        else:
            # Variance is only for recurring expenses
            var_pct = 0.0
            if raw_s_age is not None and current_age is not None:
                y_off = max(1, int(raw_s_age) - current_age)
            else:
                y_off = int(item.get("years_from_now") or item.get("start_year") or 0)
            occ_years = [y_off] if 1 <= y_off <= horizon_years else []

        for y_off in occ_years:
            t_idx = y_off - 1
            events_by_t.setdefault(t_idx, []).append(
                {
                    "amount_today": amt_today,
                    "variance": var_pct,
                    "tag": tag,
                    "is_recurring": is_rec,
                }
            )
            var_label = f" ±{int(round(var_pct * 100))}%" if var_pct > 0 else ""
            tags_by_t.setdefault(t_idx, []).append(f"{tag} ({format_inr_compact(amt_today)}{var_label} today)")

    return events_by_t, tags_by_t


def simulate_portfolio_paths(
    total_corpus: float,
    equity_weight: float,
    fixed_income_weight: float,
    property_weight: float,
    initial_annual_expense: float,
    equity_returns: np.ndarray,
    fixed_income_returns: np.ndarray,
    property_returns: np.ndarray,
    inflation_rates: np.ndarray,
    cash_weight: float = 0.0,
    current_age: int | None = None,
    expense_variance_pct: float = 0.0,
    lifestyle_inflation_rate: float = 0.0,
    post_retirement_multiplier: float = 1.0,
    property_mode: PropertyTreatmentMode = "liquidate_fallback",
    property_rental_yield: float = 0.025,
    property_liquidation_haircut: float = 0.10,
    # Pre-retirement work offset (years before retiring; 0 = retire immediately today)
    retirement_start_year_offset: int = 0,
    # Income streams
    job_annual_income: float = 0.0,
    job_income_years: int = 0,
    job_income_growth_rate: float = 0.07,
    job_income_growth_rate_max: float | None = None,
    rental_annual_income: float = 0.0,
    other_passive_annual_income: float = 0.0,
    passive_income_inflation_interval_years: int = 1,
    # Ongoing SIP investments
    equity_sip_annual: float = 0.0,
    equity_sip_stepup_rate: float = 0.10,
    fixed_income_sip_annual: float = 0.0,
    fixed_income_sip_stepup_rate: float = 0.05,
    sip_duration_years: int = 0,
    # Rebalancing configuration
    rebalance_annually: bool = True,
    rebalance_enabled: bool | None = None,
    rebalance_frequency_years: int = 2,
    # Uniform Tax Drag configuration (Default: 10% across all asset classes)
    tax_drag_rate: float = 0.10,
    fixed_income_tax_rate: float | None = None,
    equity_tax_rate: float | None = None,
    effective_tax_rate: float | None = None,
    # Medical insurance status
    has_medical_insurance: bool = True,
    # Legacy Home improvement configuration
    home_improvement_enabled: bool = False,
    home_improvement_interval_years: int = 5,
    home_improvement_pct_of_property: float = 0.03,
    home_improvement_variance_pct: float = 0.01,
    # Random shock expense configuration (higher default when no medical insurance is available)
    random_expense_enabled: bool = False,
    random_expense_base_inr: float | None = None,
    random_expense_variance_pct: float = 0.25,
    random_expense_annual_probability: float = 0.15,
    # Known future expenses (One-Off & Recurring)
    known_future_expenses: list[dict[str, Any]] | None = None,
    seed: int | None = 12345,
) -> dict[str, Any]:
    """
    Vectorized multi-asset portfolio simulator across `n_paths` over `horizon_years`.

    Apples-to-Apples Guarantee:
    All random shock triggers, shock magnitudes, home improvement percentages, and
    planned goal variances are pre-generated upfront as `(n_paths, horizon_years)` matrices
    from `seed`, so comparing different candidate retirement ages (`retirement_start_year_offset`)
    uses the exact same random shocks and market returns in every single year `t`.
    """
    n_paths, horizon_years = equity_returns.shape
    rng = np.random.default_rng(seed)

    base_tax = tax_drag_rate if effective_tax_rate is None else effective_tax_rate
    tau_fi = float(np.clip(base_tax if fixed_income_tax_rate is None else fixed_income_tax_rate, 0.0, 0.60))
    tau_eq = float(np.clip(base_tax if equity_tax_rate is None else equity_tax_rate, 0.0, 0.60))

    reb_freq = max(1, int(rebalance_frequency_years))
    if rebalance_enabled is not None:
        rebalance_annually = bool(rebalance_enabled)

    base_expenses_nominal, cumulative_cpi = project_expenses(
        initial_annual_expense=initial_annual_expense,
        horizon_years=horizon_years,
        inflation_rates=inflation_rates,
        lifestyle_inflation_rate=lifestyle_inflation_rate,
        post_retirement_multiplier=post_retirement_multiplier,
    )

    events_by_t, known_tags_by_year = _expand_future_expense_items(
        known_future_expenses=known_future_expenses,
        horizon_years=horizon_years,
        current_age=current_age,
    )

    # Pre-draw all random matrices upfront so every candidate retirement age experiences identical shocks & variances
    exp_var = max(0.0, min(1.0, float(expense_variance_pct)))
    if exp_var > 0:
        pre_exp_var_matrix = rng.uniform(max(0.0, 1.0 - exp_var), 1.0 + exp_var, size=(n_paths, horizon_years))
        base_expenses_nominal = base_expenses_nominal * pre_exp_var_matrix

    # Pre-draw job income annual increment matrix (supports fixed % or uniform range [min_rate, max_rate])
    g_min = float(job_income_growth_rate)
    g_max = float(job_income_growth_rate_max) if job_income_growth_rate_max is not None else g_min
    if g_max > g_min + 1e-9:
        pre_job_growth_rates = rng.uniform(g_min, g_max, size=(n_paths, horizon_years))
    else:
        pre_job_growth_rates = np.full((n_paths, horizon_years), g_min, dtype=np.float64)
    cumulative_job_growth = np.ones((n_paths, horizon_years), dtype=np.float64)
    for t_g in range(1, horizon_years):
        cumulative_job_growth[:, t_g] = cumulative_job_growth[:, t_g - 1] * (1.0 + pre_job_growth_rates[:, t_g - 1])

    passive_inf_step = max(1, int(passive_income_inflation_interval_years))

    default_shock_base = 2_00_000.0 if has_medical_insurance else 5_00_000.0
    actual_rand_base = float(default_shock_base if random_expense_base_inr is None else random_expense_base_inr)

    effective_random_enabled = random_expense_enabled or (not has_medical_insurance)
    if random_expense_enabled:
        eff_rand_base = actual_rand_base * (1.0 if has_medical_insurance else (1.35 if actual_rand_base <= 2_50_000.0 else 1.0))
        eff_rand_var = random_expense_variance_pct
        eff_rand_prob = min(1.0, random_expense_annual_probability + (0.0 if has_medical_insurance else 0.08))
    else:
        eff_rand_base = 5_00_000.0 if not has_medical_insurance else 0.0
        eff_rand_var = 0.35
        eff_rand_prob = 0.20 if not has_medical_insurance else 0.0

    pre_shock_triggers = rng.random((n_paths, horizon_years)) < eff_rand_prob
    low_mult = max(0.0, 1.0 - eff_rand_var)
    high_mult = max(low_mult, 1.0 + eff_rand_var)
    pre_shock_today_matrix = (
        eff_rand_base * rng.uniform(low_mult, high_mult, size=(n_paths, horizon_years))
        if (effective_random_enabled and eff_rand_prob > 0 and eff_rand_base > 0)
        else np.zeros((n_paths, horizon_years), dtype=np.float64)
    )

    low_hi_p = max(0.0, home_improvement_pct_of_property - home_improvement_variance_pct)
    high_hi_p = max(low_hi_p, home_improvement_pct_of_property + home_improvement_variance_pct)
    pre_home_imp_pct_matrix = rng.uniform(low_hi_p, high_hi_p, size=(n_paths, horizon_years))

    pre_known_today_matrix = np.zeros((n_paths, horizon_years), dtype=np.float64)
    for t_idx, ev_list in events_by_t.items():
        for ev_item in ev_list:
            amt_base = ev_item["amount_today"]
            v_pct = ev_item["variance"]
            if v_pct > 0:
                mult = rng.uniform(max(0.0, 1.0 - v_pct), 1.0 + v_pct, size=n_paths)
            else:
                mult = 1.0
            pre_known_today_matrix[:, t_idx] += amt_base * mult

    # Initial buckets at t = 0
    # Cash Balance is protected so it never drops below its initial value (inflation-adjusted).
    initial_cash_inr = total_corpus * max(0.0, float(cash_weight))
    eq_val = np.full(n_paths, total_corpus * equity_weight, dtype=np.float64)
    fi_val = np.full(n_paths, total_corpus * fixed_income_weight, dtype=np.float64)
    cash_val = np.full(n_paths, initial_cash_inr, dtype=np.float64)
    prop_val = np.full(n_paths, total_corpus * property_weight, dtype=np.float64)
    prop_liquidated = np.zeros(n_paths, dtype=bool)

    fin_total_w = equity_weight + fixed_income_weight
    if fin_total_w > 1e-9:
        target_eq_fin_ratio = equity_weight / fin_total_w
        target_fi_fin_ratio = fixed_income_weight / fin_total_w
    else:
        target_eq_fin_ratio = 0.5
        target_fi_fin_ratio = 0.5

    drawable_nominal = np.zeros((n_paths, horizon_years + 1), dtype=np.float64)
    net_worth_nominal = np.zeros((n_paths, horizon_years + 1), dtype=np.float64)
    liquid_corpus_nominal = np.zeros((n_paths, horizon_years + 1), dtype=np.float64)
    cash_balance_nominal = np.zeros((n_paths, horizon_years + 1), dtype=np.float64)
    eq_balance_nominal = np.zeros((n_paths, horizon_years + 1), dtype=np.float64)
    fi_balance_nominal = np.zeros((n_paths, horizon_years + 1), dtype=np.float64)
    bank_paid_expenses_nominal = np.zeros((n_paths, horizon_years), dtype=np.float64)
    cash_reserve_floor_nominal = np.zeros((n_paths, horizon_years), dtype=np.float64)
    liquid_before_returns_nominal = np.zeros((n_paths, horizon_years), dtype=np.float64)
    eq_cap_gains_nominal = np.zeros((n_paths, horizon_years), dtype=np.float64)
    fi_cap_gains_nominal = np.zeros((n_paths, horizon_years), dtype=np.float64)
    cash_cap_gains_nominal = np.zeros((n_paths, horizon_years), dtype=np.float64)
    job_income_series = np.zeros((n_paths, horizon_years), dtype=np.float64)
    rental_income_series = np.zeros((n_paths, horizon_years), dtype=np.float64)
    passive_income_series = np.zeros((n_paths, horizon_years), dtype=np.float64)
    total_income_series = np.zeros((n_paths, horizon_years), dtype=np.float64)
    eq_sip_series = np.zeros((n_paths, horizon_years), dtype=np.float64)
    fi_sip_series = np.zeros((n_paths, horizon_years), dtype=np.float64)
    total_sip_series = np.zeros((n_paths, horizon_years), dtype=np.float64)
    capital_gains_nominal = np.zeros((n_paths, horizon_years), dtype=np.float64)
    property_liquidated_series = np.zeros((n_paths, horizon_years), dtype=np.float64)

    rs100_equity = np.full((n_paths, horizon_years + 1), 100.0, dtype=np.float64)
    rs100_fd = np.full((n_paths, horizon_years + 1), 100.0, dtype=np.float64)
    rs100_inflation = np.full((n_paths, horizon_years + 1), 100.0, dtype=np.float64)
    for t in range(horizon_years):
        rs100_equity[:, t + 1] = rs100_equity[:, t] * (1.0 + equity_returns[:, t])
        rs100_fd[:, t + 1] = rs100_fd[:, t] * (1.0 + fixed_income_returns[:, t])
        rs100_inflation[:, t + 1] = rs100_inflation[:, t] * (1.0 + inflation_rates[:, t])

    home_imp_nominal = np.zeros((n_paths, horizon_years), dtype=np.float64)
    random_shock_nominal = np.zeros((n_paths, horizon_years), dtype=np.float64)
    known_event_nominal = np.zeros((n_paths, horizon_years), dtype=np.float64)
    total_expenses_nominal = np.zeros((n_paths, horizon_years), dtype=np.float64)
    withdrawn_fi_gross = np.zeros((n_paths, horizon_years), dtype=np.float64)
    withdrawn_eq_gross = np.zeros((n_paths, horizon_years), dtype=np.float64)
    withdrawal_tax_paid = np.zeros((n_paths, horizon_years), dtype=np.float64)
    rebalance_direction = np.zeros((n_paths, horizon_years), dtype=np.int8)
    rebalance_sold_gross = np.zeros((n_paths, horizon_years), dtype=np.float64)
    rebalance_tax_paid = np.zeros((n_paths, horizon_years), dtype=np.float64)

    def _get_drawable(eq: np.ndarray, fi: np.ndarray, prop: np.ndarray) -> np.ndarray:
        if property_mode in ("liquidate_fallback", "rebalanced"):
            haircut_factor = (
                (1.0 - property_liquidation_haircut)
                if property_mode == "liquidate_fallback"
                else 1.0
            )
            return eq + fi + prop * haircut_factor
        return eq + fi

    drawable_nominal[:, 0] = _get_drawable(eq_val, fi_val, prop_val)
    liquid_corpus_nominal[:, 0] = eq_val + fi_val + cash_val
    net_worth_nominal[:, 0] = eq_val + fi_val + cash_val + prop_val
    cash_balance_nominal[:, 0] = cash_val
    eq_balance_nominal[:, 0] = eq_val
    fi_balance_nominal[:, 0] = fi_val

    years_lasted = np.full(n_paths, float(horizon_years), dtype=np.float64)
    depleted_mask = np.zeros(n_paths, dtype=bool)

    zero_start = drawable_nominal[:, 0] <= 1.0
    years_lasted[zero_start] = 0.0
    depleted_mask[zero_start] = True

    for t in range(horizon_years):
        active = ~depleted_mask
        if not np.any(active):
            cash_val = np.maximum(cash_val, initial_cash_inr * cumulative_cpi[:, t + 1])
            cash_balance_nominal[:, t + 1] = cash_val
            liquid_corpus_nominal[:, t + 1] = eq_val + fi_val + cash_val
            net_worth_nominal[:, t + 1] = eq_val + fi_val + cash_val + prop_val
            continue

        # 1. Income streams in year t (Job/Business + Rental + Other Passive)
        if t < job_income_years and job_annual_income > 0:
            job_inc_t: np.ndarray = job_annual_income * cumulative_job_growth[:, t]
        else:
            job_inc_t = np.zeros(n_paths, dtype=np.float64)
        job_income_series[:, t] = job_inc_t

        # Rental & Passive income step up for cumulative inflation every `passive_inf_step` years
        step_cpi_t = (t // passive_inf_step) * passive_inf_step
        if rental_annual_income > 0:
            rent_t = rental_annual_income * cumulative_cpi[:, step_cpi_t]
        elif property_mode in ("liquidate_fallback", "illiquid_with_rent", "rebalanced"):
            rent_t = np.where(prop_val > 0, prop_val * property_rental_yield, 0.0)
        else:
            rent_t = np.zeros(n_paths, dtype=np.float64)
        rental_income_series[:, t] = rent_t

        passive_t = (
            other_passive_annual_income * cumulative_cpi[:, step_cpi_t]
            if other_passive_annual_income > 0
            else np.zeros(n_paths, dtype=np.float64)
        )
        passive_income_series[:, t] = passive_t
        tot_inc_t = rent_t + job_inc_t + passive_t
        total_income_series[:, t] = tot_inc_t

        # 2. Legacy Periodic Home Improvement Expense (using pre-drawn matrix)
        if (
            home_improvement_enabled
            and home_improvement_interval_years > 0
            and ((t + 1) % int(home_improvement_interval_years) == 0)
        ):
            home_imp_t = np.where(active & (prop_val > 0), prop_val * pre_home_imp_pct_matrix[:, t], 0.0)
        else:
            home_imp_t = np.zeros(n_paths, dtype=np.float64)
        home_imp_nominal[:, t] = home_imp_t

        # 3. Random Shock Expense (using pre-drawn matrix for apples-to-apples comparison)
        if effective_random_enabled and eff_rand_prob > 0 and eff_rand_base > 0:
            triggers = active & pre_shock_triggers[:, t]
            shock_nom_t = np.where(triggers, pre_shock_today_matrix[:, t] * cumulative_cpi[:, t], 0.0)
        else:
            shock_nom_t = np.zeros(n_paths, dtype=np.float64)
        random_shock_nominal[:, t] = shock_nom_t

        # 4. Known Future Tagged Expenses (using pre-drawn matrix for apples-to-apples comparison)
        if t in events_by_t:
            known_nom_t = np.where(active, pre_known_today_matrix[:, t] * cumulative_cpi[:, t], 0.0)
        else:
            known_nom_t = np.zeros(n_paths, dtype=np.float64)
        known_event_nominal[:, t] = known_nom_t

        # Total expenses in year t
        tot_exp_t = base_expenses_nominal[:, t] + home_imp_t + shock_nom_t + known_nom_t
        total_expenses_nominal[:, t] = tot_exp_t

        # 5. Bank-First Cashflow Waterfall:
        #    (a) All Inflows go into the Bank (`cash_val`) first.
        #    (b) Outflows (Expenses) are paid first from the Bank WITHOUT dipping below
        #        the inflation-adjusted reserve (`cash_reserve_t = initial_cash_inr * cumulative_cpi[:, t]`).
        #    (c) SIPs are funded ONLY from remaining Bank cash above reserve (reduced or paused if insufficient;
        #        NEVER redeem Fixed Income or Equity for an SIP).
        #    (d) Any remaining expense shortfall (`net_need > 0`) redeems Fixed Income first, then Equity.
        cash_reserve_t = initial_cash_inr * cumulative_cpi[:, t]
        cash_reserve_floor_nominal[:, t] = cash_reserve_t
        cash_val = np.where(active, cash_val + tot_inc_t, cash_val)

        bank_avail_for_exp = np.maximum(0.0, cash_val - cash_reserve_t)
        paid_from_bank = np.where(active, np.minimum(tot_exp_t, bank_avail_for_exp), 0.0)
        bank_paid_expenses_nominal[:, t] = paid_from_bank
        cash_val = np.where(active, cash_val - paid_from_bank, cash_val)
        net_need = np.where(active, np.maximum(0.0, tot_exp_t - paid_from_bank), 0.0)

        # Ongoing SIP Contributions: funded strictly from remaining Bank cash above reserve (never redeem for SIP)
        if t < sip_duration_years and (equity_sip_annual + fixed_income_sip_annual) > 0:
            sched_eq_sip = equity_sip_annual * ((1.0 + equity_sip_stepup_rate) ** t) if equity_sip_annual > 0 else 0.0
            sched_fi_sip = fixed_income_sip_annual * ((1.0 + fixed_income_sip_stepup_rate) ** t) if fixed_income_sip_annual > 0 else 0.0
            sched_sip_total = sched_eq_sip + sched_fi_sip
            bank_avail_for_sip = np.maximum(0.0, cash_val - cash_reserve_t)
            sip_affordable = np.where(
                active & (tot_inc_t > 0) & (net_need <= 1e-6),
                np.minimum(sched_sip_total, bank_avail_for_sip),
                0.0,
            )
            eq_sip_ratio = sched_eq_sip / max(1e-9, sched_sip_total)
            eq_sip_vec = sip_affordable * eq_sip_ratio
            fi_sip_vec = sip_affordable - eq_sip_vec
            cash_val = np.where(active, cash_val - sip_affordable, cash_val)
            eq_val += eq_sip_vec
            fi_val += fi_sip_vec
            eq_sip_series[:, t] = eq_sip_vec
            fi_sip_series[:, t] = fi_sip_vec
            total_sip_series[:, t] = sip_affordable
        else:
            total_sip_series[:, t] = 0.0

        # 5. Check Property Fallback Liquidation if financial assets cannot cover net_need
        max_net_from_fin = fi_val * (1.0 - tau_fi) + eq_val * (1.0 - tau_eq)
        if property_mode == "liquidate_fallback":
            need_liq = active & (max_net_from_fin < net_need) & (prop_val > 0) & (~prop_liquidated)
            if np.any(need_liq):
                realized_prop = prop_val[need_liq] * (1.0 - property_liquidation_haircut)
                property_liquidated_series[need_liq, t] = realized_prop
                eq_val[need_liq] += realized_prop * target_eq_fin_ratio
                fi_val[need_liq] += realized_prop * target_fi_fin_ratio
                prop_val[need_liq] = 0.0
                prop_liquidated[need_liq] = True
                max_net_from_fin = fi_val * (1.0 - tau_fi) + eq_val * (1.0 - tau_eq)
        elif property_mode == "rebalanced":
            max_net_from_fin = (
                fi_val * (1.0 - tau_fi)
                + (eq_val + prop_val) * (1.0 - tau_eq)
            )

        # 6. Check for portfolio depletion
        newly_depleted = active & (max_net_from_fin <= net_need) & (net_need > 0)
        if np.any(newly_depleted):
            frac = np.clip(max_net_from_fin[newly_depleted] / np.maximum(1.0, net_need[newly_depleted]), 0.0, 1.0)
            years_lasted[newly_depleted] = float(t) + frac
            withdrawn_fi_gross[newly_depleted, t] = fi_val[newly_depleted]
            withdrawn_eq_gross[newly_depleted, t] = eq_val[newly_depleted]
            withdrawal_tax_paid[newly_depleted, t] = (
                fi_val[newly_depleted] * tau_fi + eq_val[newly_depleted] * tau_eq
            )
            eq_val[newly_depleted] = 0.0
            fi_val[newly_depleted] = 0.0
            if property_mode in ("liquidate_fallback", "rebalanced"):
                prop_val[newly_depleted] = 0.0
            depleted_mask[newly_depleted] = True

        # 7. Perform Withdrawal: ALWAYS FROM FIXED INCOME / CASH FIRST, then Equity
        still_active = active & (~newly_depleted)
        if np.any(still_active):
            need_s = net_need[still_active]
            fi_s = fi_val[still_active]
            eq_s = eq_val[still_active]

            max_net_fi = fi_s * (1.0 - tau_fi)
            fi_sufficient = max_net_fi >= need_s
            gross_fi = np.where(
                fi_sufficient,
                need_s / max(1e-6, 1.0 - tau_fi),
                fi_s,
            )
            net_from_fi = gross_fi * (1.0 - tau_fi)
            rem_net_for_eq = np.maximum(0.0, need_s - net_from_fi)
            gross_eq = rem_net_for_eq / max(1e-6, 1.0 - tau_eq)

            fi_val[still_active] = np.maximum(0.0, fi_s - gross_fi)
            if property_mode == "rebalanced":
                eq_draw = np.minimum(eq_s, gross_eq)
                prop_draw = np.maximum(0.0, gross_eq - eq_draw)
                eq_val[still_active] = np.maximum(0.0, eq_s - eq_draw)
                prop_val[still_active] = np.maximum(0.0, prop_val[still_active] - prop_draw)
            else:
                eq_val[still_active] = np.maximum(0.0, eq_s - gross_eq)

            withdrawn_fi_gross[still_active, t] = gross_fi
            withdrawn_eq_gross[still_active, t] = gross_eq
            withdrawal_tax_paid[still_active, t] = gross_fi * tau_fi + gross_eq * tau_eq

        # 8. Periodic Rebalancing (every `reb_freq` years) back to initial allocation with Tax Drag
        surviving = ~depleted_mask
        is_rebalance_year = rebalance_annually and ((t + 1) % reb_freq == 0)
        if is_rebalance_year and np.any(surviving) and fin_total_w > 1e-9:
            r_eq = target_eq_fin_ratio
            r_fi = target_fi_fin_ratio

            eq_surv = eq_val[surviving]
            fi_surv = fi_val[surviving]
            imbalance = r_fi * eq_surv - r_eq * fi_surv

            dir_arr = np.zeros(len(eq_surv), dtype=np.int8)
            sold_arr = np.zeros(len(eq_surv), dtype=np.float64)
            tax_arr = np.zeros(len(eq_surv), dtype=np.float64)

            ow_eq = imbalance > 100.0
            if np.any(ow_eq):
                denom_eq = r_fi + r_eq * (1.0 - tau_eq)
                sell_eq = imbalance[ow_eq] / max(1e-6, denom_eq)
                tax_eq_reb = sell_eq * tau_eq
                eq_surv[ow_eq] = np.maximum(0.0, eq_surv[ow_eq] - sell_eq)
                fi_surv[ow_eq] += sell_eq - tax_eq_reb
                dir_arr[ow_eq] = 1
                sold_arr[ow_eq] = sell_eq
                tax_arr[ow_eq] = tax_eq_reb

            ow_fi = imbalance < -100.0
            if np.any(ow_fi):
                denom_fi = r_eq + r_fi * (1.0 - tau_fi)
                sell_fi = (-imbalance[ow_fi]) / max(1e-6, denom_fi)
                tax_fi_reb = sell_fi * tau_fi
                fi_surv[ow_fi] = np.maximum(0.0, fi_surv[ow_fi] - sell_fi)
                eq_surv[ow_fi] += sell_fi - tax_fi_reb
                dir_arr[ow_fi] = -1
                sold_arr[ow_fi] = sell_fi
                tax_arr[ow_fi] = tax_fi_reb

            eq_val[surviving] = eq_surv
            fi_val[surviving] = fi_surv
            rebalance_direction[surviving, t] = dir_arr
            rebalance_sold_gross[surviving, t] = sold_arr
            rebalance_tax_paid[surviving, t] = tax_arr

        # 9. Capital Gains calculated on top of whatever is left after Inflows, Outflows, and Tax Drag
        eq_before_ret = eq_val.copy()
        fi_before_ret = fi_val.copy()
        cash_before_ret = cash_val.copy()
        liquid_before_ret = eq_before_ret + fi_before_ret + cash_before_ret
        liquid_before_returns_nominal[:, t] = liquid_before_ret
        if np.any(surviving):
            eq_val[surviving] = np.maximum(0.0, eq_val[surviving] * (1.0 + equity_returns[surviving, t]))
            fi_val[surviving] = np.maximum(0.0, fi_val[surviving] * (1.0 + fixed_income_returns[surviving, t]))
        cash_floor_next = initial_cash_inr * cumulative_cpi[:, t + 1]
        cash_val = np.maximum(cash_val * (1.0 + np.maximum(0.0, inflation_rates[:, t])), cash_floor_next)
        cash_balance_nominal[:, t + 1] = cash_val
        eq_balance_nominal[:, t + 1] = eq_val
        fi_balance_nominal[:, t + 1] = fi_val
        eq_cap_gains_nominal[:, t] = eq_val - eq_before_ret
        fi_cap_gains_nominal[:, t] = fi_val - fi_before_ret
        cash_cap_gains_nominal[:, t] = cash_val - cash_before_ret
        capital_gains_nominal[:, t] = (eq_val + fi_val + cash_val) - liquid_before_ret

        has_prop = prop_val > 0
        if np.any(has_prop):
            prop_val[has_prop] = np.maximum(0.0, prop_val[has_prop] * (1.0 + property_returns[has_prop, t]))

        drawable_nominal[:, t + 1] = _get_drawable(eq_val, fi_val, prop_val)
        liquid_corpus_nominal[:, t + 1] = eq_val + fi_val + cash_val
        net_worth_nominal[:, t + 1] = eq_val + fi_val + cash_val + prop_val

    drawable_real = drawable_nominal / cumulative_cpi
    liquid_corpus_real = liquid_corpus_nominal / cumulative_cpi
    net_worth_real = net_worth_nominal / cumulative_cpi
    cash_balance_real = cash_balance_nominal / cumulative_cpi
    expenses_real = total_expenses_nominal / cumulative_cpi[:, :-1]

    return {
        "years_lasted": years_lasted,
        "depleted_mask": depleted_mask,
        "drawable_nominal": drawable_nominal,
        "drawable_real": drawable_real,
        "liquid_corpus_nominal": liquid_corpus_nominal,
        "liquid_corpus_real": liquid_corpus_real,
        "net_worth_nominal": net_worth_nominal,
        "net_worth_real": net_worth_real,
        "cash_balance_nominal": cash_balance_nominal,
        "cash_balance_real": cash_balance_real,
        "eq_balance_nominal": eq_balance_nominal,
        "fi_balance_nominal": fi_balance_nominal,
        "bank_paid_expenses_nominal": bank_paid_expenses_nominal,
        "cash_reserve_floor_nominal": cash_reserve_floor_nominal,
        "liquid_before_returns_nominal": liquid_before_returns_nominal,
        "eq_cap_gains_nominal": eq_cap_gains_nominal,
        "fi_cap_gains_nominal": fi_cap_gains_nominal,
        "cash_cap_gains_nominal": cash_cap_gains_nominal,
        "base_expenses_nominal": base_expenses_nominal,
        "expenses_nominal": total_expenses_nominal,
        "expenses_real": expenses_real,
        "home_improvement_nominal": home_imp_nominal,
        "random_shock_nominal": random_shock_nominal,
        "known_event_nominal": known_event_nominal,
        "known_expense_incurred": known_event_nominal,
        "known_tags_by_year": known_tags_by_year,
        "job_income_nominal": job_income_series,
        "rental_income_nominal": rental_income_series,
        "passive_income_nominal": passive_income_series,
        "total_income_nominal": total_income_series,
        "eq_sip_nominal": eq_sip_series,
        "fi_sip_nominal": fi_sip_series,
        "total_sip_nominal": total_sip_series,
        "capital_gains_nominal": capital_gains_nominal,
        "property_liquidated_nominal": property_liquidated_series,
        "withdrawn_fi_gross": withdrawn_fi_gross,
        "withdrawn_from_fi_gross": withdrawn_fi_gross,
        "withdrawn_eq_gross": withdrawn_eq_gross,
        "withdrawn_from_eq_gross": withdrawn_eq_gross,
        "withdrawal_tax_paid": withdrawal_tax_paid,
        "rebalance_direction": rebalance_direction,
        "rebalance_sold_gross": rebalance_sold_gross,
        "rebalance_tax_paid": rebalance_tax_paid,
        "cumulative_cpi": cumulative_cpi,
        "rs100_equity": rs100_equity,
        "rs100_fd": rs100_fd,
        "rs100_inflation": rs100_inflation,
    }


def compute_longevity_stats(
    years_lasted: np.ndarray,
    current_age: int,
    target_horizon: int,
) -> dict[str, Any]:
    """Compute statistical percentiles and survival summary for wealth longevity."""
    p10 = float(np.percentile(years_lasted, 10))
    p25 = float(np.percentile(years_lasted, 25))
    p50 = float(np.percentile(years_lasted, 50))
    p75 = float(np.percentile(years_lasted, 75))
    p90 = float(np.percentile(years_lasted, 90))
    mean_years = float(np.mean(years_lasted))
    std_years = float(np.std(years_lasted))

    success_rate = float(np.mean(years_lasted >= (target_horizon - 1e-6))) * 100.0

    return {
        "success_probability_pct": round(success_rate, 1),
        "success_rate_pct": round(success_rate, 1),
        "mean_years": round(mean_years, 1),
        "std_dev_years": round(std_years, 1),
        "percentiles_years": {
            "p10": round(p10, 1),
            "p25": round(p25, 1),
            "p50": round(p50, 1),
            "p75": round(p75, 1),
            "p90": round(p90, 1),
        },
        "depletion_ages": {
            "p10": round(current_age + p10, 1),
            "p25": round(current_age + p25, 1),
            "p50": round(current_age + p50, 1),
            "p75": round(current_age + p75, 1),
            "p90": round(current_age + p90, 1),
        },
    }


def compute_trajectory_percentiles(
    corpus_matrix: np.ndarray,
    current_age: int,
) -> dict[str, list[float | int]]:
    """
    Compute year-by-year P10, P25, P50, P75, P90 wealth trajectories across runs.
    """
    n_steps = corpus_matrix.shape[1]
    ages = [current_age + t for t in range(n_steps)]
    years_offset = list(range(n_steps))

    pcts = np.percentile(corpus_matrix, [10, 25, 50, 75, 90], axis=0)
    return {
        "years_offset": years_offset,
        "ages": ages,
        "p10": [round(float(x), 0) for x in pcts[0]],
        "p25": [round(float(x), 0) for x in pcts[1]],
        "p50": [round(float(x), 0) for x in pcts[2]],
        "p75": [round(float(x), 0) for x in pcts[3]],
        "p90": [round(float(x), 0) for x in pcts[4]],
        "mean": [round(float(x), 0) for x in np.mean(corpus_matrix, axis=0)],
    }


def compute_survival_curve(
    drawable_matrix: np.ndarray,
    current_age: int,
) -> dict[str, list[float | int]]:
    """Compute portfolio success rate (%) at each age from current_age to horizon end."""
    n_steps = drawable_matrix.shape[1]
    ages = [current_age + t for t in range(n_steps)]
    survival_pct = np.mean(drawable_matrix > 1.0, axis=0) * 100.0
    return {
        "ages": ages,
        "survival_probability_pct": [round(float(x), 1) for x in survival_pct],
    }


def compute_longevity_histogram(
    years_lasted: np.ndarray,
    horizon_years: int,
    bucket_size: int = 5,
) -> list[dict[str, Any]]:
    """Group longevity outcomes into clean histogram buckets."""
    buckets: list[dict[str, Any]] = []
    n_total = len(years_lasted)
    if n_total == 0:
        return buckets

    for start in range(0, horizon_years, bucket_size):
        end = min(start + bucket_size, horizon_years)
        if end == horizon_years:
            mask = (years_lasted >= start) & (years_lasted < horizon_years - 1e-6)
        else:
            mask = (years_lasted >= start) & (years_lasted < end)
        count = int(np.sum(mask))
        buckets.append(
            {
                "label": f"{start}–{end} yrs",
                "min_year": start,
                "max_year": end,
                "count": count,
                "percentage": round(count / n_total * 100.0, 1),
            }
        )

    survived_count = int(np.sum(years_lasted >= horizon_years - 1e-6))
    buckets.append(
        {
            "label": f"{horizon_years}+ yrs (Full Goal)",
            "min_year": horizon_years,
            "max_year": horizon_years,
            "count": survived_count,
            "percentage": round(survived_count / n_total * 100.0, 1),
        }
    )
    return buckets
