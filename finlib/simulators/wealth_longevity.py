"""
Simulator #1: "Can I Retire Today?" / "How Long Will My Wealth Last?"

Evaluates whether an individual in India can quit their job today and sustain
their expenses across retirement by randomly sampling the last 20 years of historical
Indian market returns (2006–2025) and simulating thousands of future paths.
"""

from __future__ import annotations

from typing import Any
import numpy as np

from finlib.core.engine import (
    BaseSimulator,
    SimulatorMetadata,
    generate_historical_backtest_paths,
    generate_monte_carlo_paths,
    registry,
)
from finlib.core.finance import (
    compute_longevity_histogram,
    compute_longevity_stats,
    compute_survival_curve,
    compute_trajectory_percentiles,
    format_inr_compact,
    simulate_portfolio_paths,
)
from finlib.data.indian_market_history import HISTORICAL_CRISIS_COHORTS


class WealthLongevitySimulator(BaseSimulator):
    """Simulator evaluating corpus longevity & retirement readiness in India."""

    metadata = SimulatorMetadata(
        id="wealth_longevity",
        title="Can I Retire Today?",
        subtitle="How Long Will My Wealth Last?",
        description=(
            "Randomly samples the last 20 years of Indian equity, fixed income, property, and inflation "
            "returns (2006–2025) across thousands of future paths with Fixed-Income-first withdrawals, "
            "periodic taxable rebalancing, home improvements, random shocks, and tagged future goals."
        ),
        category="Core FIRE Readiness",
        status="active",
        icon="flame",
        tags=["Early Retirement", "Monte Carlo", "20-Yr India Data", "Tax-Aware Rebalancing"],
    )

    def get_default_params(self) -> dict[str, Any]:
        return {
            "current_age": 38,
            "life_expectancy": 90,
            "has_medical_insurance": True,
            "total_corpus": 3_50_00_000.0,  # ₹3.50 Crores
            "equity_pct": 55.0,
            "fixed_income_pct": 30.0,
            "property_pct": 15.0,
            "expense_amount": 1_00_000.0,  # ₹1.00 Lakh / month
            "expense_frequency": "monthly",
            "base_inflation_rate": 6.0,
            "lifestyle_inflation_rate": 0.5,
            "post_retirement_expense_multiplier": 100.0,
            "property_mode": "liquidate_fallback",
            "property_rental_yield": 2.5,
            "property_liquidation_haircut": 10.0,
            # Rebalancing & Taxation
            "rebalance_annually": True,
            "rebalance_frequency_years": 2,
            "fixed_income_tax_rate": 30.0,
            "equity_tax_rate": 12.5,
            # Home Improvement (% ± variance of property value every X years)
            "home_improvement_enabled": True,
            "home_improvement_interval_years": 5,
            "home_improvement_pct_of_property": 3.0,
            "home_improvement_variance_pct": 1.0,
            # Random Shock Expense (at today's ₹ ± variance, adjusted for inflation)
            "random_expense_enabled": True,
            "random_expense_base_inr": 2_00_000.0,
            "random_expense_variance_pct": 25.0,
            "random_expense_annual_probability_pct": 15.0,
            # Known Future Expenses by year at today's value [{years_from_now, amount_today_inr, event_tag}]
            "known_future_expenses": [],
            "num_simulations": 1000,
            "sampling_method": "iid_bootstrap",
            "use_historical_inflation_volatility": True,
            "seed": None,
        }

    def run(self, params: dict[str, Any]) -> dict[str, Any]:
        defaults = self.get_default_params()
        cfg = {**defaults, **params}

        current_age = int(cfg["current_age"])
        life_expectancy = int(cfg["life_expectancy"])
        has_medical_insurance = bool(cfg.get("has_medical_insurance", True))
        target_horizon = max(5, life_expectancy - current_age)
        max_sim_horizon = max(target_horizon + 10, 100 - current_age)
        max_sim_horizon = min(max_sim_horizon, 75)

        total_corpus = float(cfg["total_corpus"])
        eq_w = float(cfg["equity_pct"]) / 100.0
        fi_w = float(cfg["fixed_income_pct"]) / 100.0
        prop_w = float(cfg["property_pct"]) / 100.0

        w_sum = eq_w + fi_w + prop_w
        if w_sum > 0:
            eq_w, fi_w, prop_w = eq_w / w_sum, fi_w / w_sum, prop_w / w_sum

        expense_amount = float(cfg["expense_amount"])
        expense_frequency = str(cfg["expense_frequency"]).lower()
        initial_annual_expense = (
            expense_amount * 12.0 if expense_frequency == "monthly" else expense_amount
        )

        base_inflation = float(cfg["base_inflation_rate"]) / 100.0
        lifestyle_inflation = float(cfg["lifestyle_inflation_rate"]) / 100.0
        post_ret_mult = float(cfg["post_retirement_expense_multiplier"]) / 100.0
        property_mode = cfg["property_mode"]
        property_rental_yield = float(cfg["property_rental_yield"]) / 100.0
        property_haircut = float(cfg["property_liquidation_haircut"]) / 100.0

        rebalance_enabled = bool(
            cfg["rebalance_enabled"]
            if cfg.get("rebalance_enabled") is not None
            else cfg.get("rebalance_annually", True)
        )
        rebalance_freq_years = max(1, int(cfg.get("rebalance_frequency_years", 2)))

        fi_tax_rate = float(cfg.get("fixed_income_tax_rate", 30.0)) / 100.0
        eq_tax_rate = float(cfg.get("equity_tax_rate", 12.5)) / 100.0

        home_imp_enabled = bool(cfg.get("home_improvement_enabled", False))
        home_imp_interval = max(1, int(cfg.get("home_improvement_interval_years", 5)))
        home_imp_pct = float(cfg.get("home_improvement_pct_of_property", 3.0)) / 100.0
        home_imp_var = float(cfg.get("home_improvement_variance_pct", 1.0)) / 100.0

        rand_exp_enabled = bool(cfg.get("random_expense_enabled", False))
        rand_exp_base = float(cfg.get("random_expense_base_inr", 2_00_000.0))
        rand_exp_var = float(cfg.get("random_expense_variance_pct", 25.0)) / 100.0
        rand_exp_prob = float(cfg.get("random_expense_annual_probability_pct", 15.0)) / 100.0

        known_future_expenses = cfg.get("known_future_expenses") or []

        num_simulations = int(cfg["num_simulations"])
        sampling_method = cfg["sampling_method"]
        use_hist_inf_vol = bool(cfg.get("use_historical_inflation_volatility", True))
        seed = cfg.get("seed", None)

        # 1. Generate random Monte Carlo return paths from the last 20 years of Indian history (2006-2025)
        mc_paths = generate_monte_carlo_paths(
            horizon_years=max_sim_horizon,
            num_simulations=num_simulations,
            sampling_method=sampling_method,
            base_inflation_override=base_inflation,
            use_historical_inflation_volatility=use_hist_inf_vol,
            seed=seed,
        )

        common_sim_kwargs: dict[str, Any] = {
            "lifestyle_inflation_rate": lifestyle_inflation,
            "post_retirement_multiplier": post_ret_mult,
            "property_mode": property_mode,
            "property_rental_yield": property_rental_yield,
            "property_liquidation_haircut": property_haircut,
            "rebalance_annually": rebalance_enabled,
            "rebalance_frequency_years": rebalance_freq_years,
            "fixed_income_tax_rate": fi_tax_rate,
            "equity_tax_rate": eq_tax_rate,
            "has_medical_insurance": has_medical_insurance,
            "home_improvement_enabled": home_imp_enabled,
            "home_improvement_interval_years": home_imp_interval,
            "home_improvement_pct_of_property": home_imp_pct,
            "home_improvement_variance_pct": home_imp_var,
            "random_expense_enabled": rand_exp_enabled,
            "random_expense_base_inr": rand_exp_base,
            "random_expense_variance_pct": rand_exp_var,
            "random_expense_annual_probability": rand_exp_prob,
            "known_future_expenses": known_future_expenses,
            "seed": int(mc_paths["seed_used"]),
        }

        # 2. Run vectorized portfolio drawdown simulation across all random paths
        mc_out = simulate_portfolio_paths(
            total_corpus=total_corpus,
            equity_weight=eq_w,
            fixed_income_weight=fi_w,
            property_weight=prop_w,
            initial_annual_expense=initial_annual_expense,
            equity_returns=mc_paths["equity"],
            fixed_income_returns=mc_paths["fixed_income"],
            property_returns=mc_paths["property"],
            inflation_rates=mc_paths["cpi"],
            **common_sim_kwargs,
        )

        display_steps = target_horizon + 1
        drawable_nom_target = mc_out["drawable_nominal"][:, :display_steps]
        drawable_real_target = mc_out["drawable_real"][:, :display_steps]

        longevity_stats = compute_longevity_stats(
            years_lasted=mc_out["years_lasted"],
            current_age=current_age,
            target_horizon=target_horizon,
        )

        trajectories_nominal = compute_trajectory_percentiles(
            corpus_matrix=drawable_nom_target,
            current_age=current_age,
        )
        trajectories_real = compute_trajectory_percentiles(
            corpus_matrix=drawable_real_target,
            current_age=current_age,
        )

        survival_curve = compute_survival_curve(
            drawable_matrix=mc_out["drawable_nominal"],
            current_age=current_age,
        )

        longevity_histogram = compute_longevity_histogram(
            years_lasted=mc_out["years_lasted"],
            horizon_years=target_horizon,
            bucket_size=5,
        )

        # 2b. Extract individual random simulation paths & rich year-by-year run logs
        sample_simulation_paths, notable_runs = self._extract_sample_paths(
            mc_paths=mc_paths,
            mc_out=mc_out,
            current_age=current_age,
            display_steps=display_steps,
            target_horizon=target_horizon,
            lifestyle_inflation_pct=round(lifestyle_inflation * 100.0, 2),
        )

        # 2c. Build chart event annotations (Known Future Expenses + Home Improvements + Rebalance schedule)
        chart_events = self._build_chart_event_annotations(
            current_age=current_age,
            target_horizon=target_horizon,
            known_future_expenses=known_future_expenses,
            home_imp_enabled=home_imp_enabled and (prop_w > 0),
            home_imp_interval=home_imp_interval,
            home_imp_pct=home_imp_pct,
            home_imp_var=home_imp_var,
            rebalance_enabled=rebalance_enabled,
            rebalance_freq_years=rebalance_freq_years,
            notable_runs=notable_runs,
        )

        # 3. Run Historical Rolling Window Backtest across the 20 Indian market start years (2006-2025)
        hist_paths = generate_historical_backtest_paths(
            horizon_years=max_sim_horizon,
            base_inflation_override=None,
        )
        hist_out = simulate_portfolio_paths(
            total_corpus=total_corpus,
            equity_weight=eq_w,
            fixed_income_weight=fi_w,
            property_weight=prop_w,
            initial_annual_expense=initial_annual_expense,
            equity_returns=hist_paths["equity"],
            fixed_income_returns=hist_paths["fixed_income"],
            property_returns=hist_paths["property"],
            inflation_rates=hist_paths["cpi"],
            **common_sim_kwargs,
        )

        start_years = hist_paths["start_years"]
        hist_years_lasted = hist_out["years_lasted"]
        hist_success_rate = float(np.mean(hist_years_lasted >= (target_horizon - 1e-6))) * 100.0
        worst_idx = int(np.argmin(hist_years_lasted))
        best_idx = int(np.argmax(hist_out["drawable_real"][:, min(target_horizon, max_sim_horizon)]))

        crisis_cohort_results: list[dict[str, Any]] = []
        for cohort in HISTORICAL_CRISIS_COHORTS:
            sy = cohort["start_year"]
            if sy in start_years:
                idx = start_years.index(sy)
                yl = float(hist_years_lasted[idx])
                survived = yl >= (target_horizon - 1e-6)
                crisis_cohort_results.append(
                    {
                        "start_year": sy,
                        "label": cohort["label"],
                        "description": cohort["description"],
                        "years_lasted": round(min(yl, float(max_sim_horizon)), 1),
                        "depletion_age": round(current_age + yl, 1),
                        "survived_to_target": survived,
                        "trajectory_real": [
                            round(float(x), 0)
                            for x in hist_out["drawable_real"][idx, :display_steps]
                        ],
                        "trajectory_nominal": [
                            round(float(x), 0)
                            for x in hist_out["drawable_nominal"][idx, :display_steps]
                        ],
                    }
                )

        rolling_backtest_summary = {
            "num_historical_cohorts": len(start_years),
            "historical_success_rate_pct": round(hist_success_rate, 1),
            "median_historical_years": round(float(np.median(hist_years_lasted)), 1),
            "worst_cohort": {
                "start_year": start_years[worst_idx],
                "years_lasted": round(float(hist_years_lasted[worst_idx]), 1),
                "depletion_age": round(current_age + float(hist_years_lasted[worst_idx]), 1),
            },
            "best_cohort": {
                "start_year": start_years[best_idx],
                "years_lasted": round(float(hist_years_lasted[best_idx]), 1),
            },
            "all_cohorts": [
                {
                    "start_year": start_years[i],
                    "years_lasted": round(float(hist_years_lasted[i]), 1),
                    "survived": bool(hist_years_lasted[i] >= target_horizon - 1e-6),
                }
                for i in range(len(start_years))
            ],
            "crisis_cohorts": crisis_cohort_results,
        }

        # 4. Portfolio & Withdrawal Rate Diagnostics
        initial_liquid_corpus = total_corpus * (eq_w + fi_w)
        initial_property_corpus = total_corpus * prop_w
        initial_drawable_corpus = float(mc_out["drawable_nominal"][0, 0])
        initial_annual_rent = (
            initial_property_corpus * property_rental_yield
            if property_mode in ("liquidate_fallback", "illiquid_with_rent", "rebalanced")
            else 0.0
        )
        effective_first_year_expense = initial_annual_expense * post_ret_mult
        net_withdrawal_year1 = max(0.0, effective_first_year_expense - initial_annual_rent)

        swr_on_total = (
            (net_withdrawal_year1 / total_corpus) * 100.0 if total_corpus > 0 else 100.0
        )
        swr_on_drawable = (
            (net_withdrawal_year1 / initial_drawable_corpus) * 100.0
            if initial_drawable_corpus > 0
            else 100.0
        )

        benchmark_swr = max(2.4, min(4.0, 4.2 - 0.025 * target_horizon - 10.0 * lifestyle_inflation))
        required_drawable_corpus = (
            net_withdrawal_year1 / (benchmark_swr / 100.0) if benchmark_swr > 0 else 0.0
        )

        # 5. Sensitivity Scenarios
        sensitivity_scenarios = self._compute_sensitivity_scenarios(
            total_corpus=total_corpus,
            eq_w=eq_w,
            fi_w=fi_w,
            prop_w=prop_w,
            initial_annual_expense=initial_annual_expense,
            mc_paths=mc_paths,
            common_sim_kwargs=common_sim_kwargs,
            current_age=current_age,
            target_horizon=target_horizon,
        )

        # 6. Build Verdict
        verdict = self._build_verdict(
            longevity_stats=longevity_stats,
            current_age=current_age,
            life_expectancy=life_expectancy,
            target_horizon=target_horizon,
            max_sim_horizon=max_sim_horizon,
            swr_on_drawable=swr_on_drawable,
            benchmark_swr=benchmark_swr,
            required_drawable_corpus=required_drawable_corpus,
            initial_drawable_corpus=initial_drawable_corpus,
        )

        return {
            "simulator_id": self.metadata.id,
            "simulation_meta": {
                "seed_used": mc_paths["seed_used"],
                "num_simulations": num_simulations,
                "sampling_method": sampling_method,
                "historical_data_window": "2006–2025 (Last 20 Years)",
                "historical_data_period": "2006–2025 (Last 20 Years)",
                "rebalance_enabled": rebalance_enabled,
                "rebalance_frequency_years": rebalance_freq_years,
                "fixed_income_tax_rate_pct": round(fi_tax_rate * 100.0, 1),
                "equity_tax_rate_pct": round(eq_tax_rate * 100.0, 1),
                "has_medical_insurance": has_medical_insurance,
            },
            "inputs_summary": {
                "current_age": current_age,
                "life_expectancy": life_expectancy,
                "has_medical_insurance": has_medical_insurance,
                "target_horizon_years": target_horizon,
                "max_simulated_years": max_sim_horizon,
                "total_corpus": total_corpus,
                "total_corpus_formatted": format_inr_compact(total_corpus),
                "initial_liquid_corpus": round(initial_liquid_corpus, 0),
                "initial_liquid_formatted": format_inr_compact(initial_liquid_corpus),
                "initial_property_corpus": round(initial_property_corpus, 0),
                "initial_property_formatted": format_inr_compact(initial_property_corpus),
                "initial_drawable_corpus": round(initial_drawable_corpus, 0),
                "initial_drawable_formatted": format_inr_compact(initial_drawable_corpus),
                "annual_expense": round(effective_first_year_expense, 0),
                "annual_expense_formatted": format_inr_compact(effective_first_year_expense),
                "monthly_expense_formatted": format_inr_compact(effective_first_year_expense / 12.0),
                "initial_annual_rent": round(initial_annual_rent, 0),
                "initial_annual_rent_formatted": format_inr_compact(initial_annual_rent),
                "net_first_year_withdrawal": round(net_withdrawal_year1, 0),
                "net_first_year_withdrawal_formatted": format_inr_compact(net_withdrawal_year1),
                "withdrawal_rate_total_pct": round(swr_on_total, 2),
                "withdrawal_rate_drawable_pct": round(swr_on_drawable, 2),
                "india_benchmark_swr_pct": round(benchmark_swr, 2),
                "recommended_drawable_corpus": round(required_drawable_corpus, 0),
                "recommended_drawable_formatted": format_inr_compact(required_drawable_corpus),
                "allocation": {
                    "equity_pct": round(eq_w * 100, 1),
                    "fixed_income_pct": round(fi_w * 100, 1),
                    "property_pct": round(prop_w * 100, 1),
                },
                "fixed_income_tax_rate": round(fi_tax_rate * 100.0, 1),
                "equity_tax_rate": round(eq_tax_rate * 100.0, 1),
                "rebalance_enabled": rebalance_enabled,
                "rebalance_frequency_years": rebalance_freq_years,
                "home_improvement_enabled": home_imp_enabled,
                "home_improvement_interval_years": home_imp_interval,
                "home_improvement_pct_of_property": round(home_imp_pct * 100.0, 2),
                "home_improvement_variance_pct": round(home_imp_var * 100.0, 2),
                "random_expense_enabled": rand_exp_enabled,
                "random_expense_base_inr": round(rand_exp_base, 0),
                "random_expense_variance_pct": round(rand_exp_var * 100.0, 1),
                "random_expense_annual_probability_pct": round(rand_exp_prob * 100.0, 1),
                "known_future_expenses": known_future_expenses,
                "expense_multiplier_X": (
                    round(initial_drawable_corpus / net_withdrawal_year1, 1)
                    if net_withdrawal_year1 > 0
                    else 99.9
                ),
            },
            "verdict": verdict,
            "longevity_stats": longevity_stats,
            "trajectories": {
                "nominal": trajectories_nominal,
                "real": trajectories_real,
            },
            "chart_events": chart_events,
            "sample_paths": sample_simulation_paths,
            "notable_runs": notable_runs,
            "survival_curve": survival_curve,
            "longevity_histogram": longevity_histogram,
            "historical_backtest": rolling_backtest_summary,
            "sensitivity_scenarios": sensitivity_scenarios,
        }

    def _build_chart_event_annotations(
        self,
        *,
        current_age: int,
        target_horizon: int,
        known_future_expenses: list[dict[str, Any]],
        home_imp_enabled: bool,
        home_imp_interval: int,
        home_imp_pct: float,
        home_imp_var: float,
        rebalance_enabled: bool,
        rebalance_freq_years: int,
        notable_runs: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Build a year/age map of Known Future Tagged Events, Home Improvements, Random Shocks, and Rebalance years."""
        by_age: dict[int, list[str]] = {}
        known_ages: set[int] = set()

        for item in known_future_expenses:
            y_off = int(item.get("years_from_now", 0))
            amt_today = float(item.get("amount_today_inr", 0.0))
            tag = str(item.get("event_tag", "Planned Expense")).strip() or "Planned Expense"
            if 1 <= y_off <= target_horizon and amt_today > 0:
                event_age = current_age + y_off
                known_ages.add(event_age)
                by_age.setdefault(event_age, []).append(
                    f"🎯 {tag} (Yr {y_off}): {format_inr_compact(amt_today)} at today's ₹"
                )

        if home_imp_enabled and home_imp_interval > 0:
            for y_off in range(home_imp_interval, target_horizon + 1, home_imp_interval):
                event_age = current_age + y_off
                by_age.setdefault(event_age, []).append(
                    f"🏠 Home Improvement (Yr {y_off}): {home_imp_pct * 100:.1f}% (±{home_imp_var * 100:.1f}%) of Property"
                )

        # Also include random shock & rebalance details from the Median (P50) run so the chart tooltip shows them
        median_run = next((r for r in notable_runs if r["label"].startswith("P50")), None)
        if median_run:
            for row in median_run.get("year_log", []):
                row_age = current_age + int(row["sim_year"])
                if row.get("random_shock_expense", 0) > 0:
                    by_age.setdefault(row_age, []).append(
                        f"⚡ Random Shock (Median Run): {format_inr_compact(row['random_shock_expense'])} nominal"
                    )
                if row.get("rebalance_activity") and row["rebalance_activity"] != "—":
                    by_age.setdefault(row_age, []).append(
                        f"⚖️ Rebalance (Median Run): {row['rebalance_activity']}"
                    )
        elif rebalance_enabled and rebalance_freq_years > 0:
            for y_off in range(rebalance_freq_years, target_horizon + 1, rebalance_freq_years):
                event_age = current_age + y_off
                by_age.setdefault(event_age, []).append(
                    f"⚖️ Scheduled Portfolio Rebalance (Yr {y_off})"
                )

        return {
            "events_by_age": {str(k): v for k, v in by_age.items()},
            "known_expense_ages": sorted(list(known_ages)),
        }

    def _extract_sample_paths(
        self,
        *,
        mc_paths: dict[str, Any],
        mc_out: dict[str, np.ndarray],
        current_age: int,
        display_steps: int,
        target_horizon: int,
        lifestyle_inflation_pct: float,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """
        Extract 40 individual random simulation paths for visualization
        plus detailed year-by-year run logs (including CPI inflation, lifestyle inflation,
        Fixed-Income-first withdrawals, rebalance activity & taxes, home improvement,
        random shocks, and tagged known future events).
        """
        years_lasted = mc_out["years_lasted"]
        drawable_real = mc_out["drawable_real"][:, :display_steps]
        drawable_nom = mc_out["drawable_nominal"][:, :display_steps]
        base_exp_nom = mc_out["base_expenses_nominal"]
        tot_exp_nom = mc_out["expenses_nominal"]
        home_imp_nom = mc_out["home_improvement_nominal"]
        rand_shock_nom = mc_out["random_shock_nominal"]
        known_ev_nom = mc_out["known_event_nominal"]
        known_tags_by_year = mc_out["known_tags_by_year"]
        withdrawn_fi = mc_out["withdrawn_fi_gross"]
        withdrawn_eq = mc_out["withdrawn_eq_gross"]
        withdrawal_tax = mc_out["withdrawal_tax_paid"]
        reb_dir = mc_out["rebalance_direction"]
        reb_sold = mc_out["rebalance_sold_gross"]
        reb_tax = mc_out["rebalance_tax_paid"]

        sampled_years = mc_paths["sampled_years"]
        eq_ret = mc_paths["equity"]
        fi_ret = mc_paths["fixed_income"]
        cpi_ret = mc_paths["cpi"]

        n_sims = len(years_lasted)
        n_sample = min(40, n_sims)
        step = max(1, n_sims // n_sample)
        sample_indices = list(range(0, n_sims, step))[:n_sample]

        sample_paths: list[dict[str, Any]] = []
        for idx in sample_indices:
            yl = float(years_lasted[idx])
            sample_paths.append(
                {
                    "run_number": int(idx + 1),
                    "years_lasted": round(yl, 1),
                    "survived": bool(yl >= target_horizon - 1e-6),
                    "real": [round(float(x), 0) for x in drawable_real[idx]],
                    "nominal": [round(float(x), 0) for x in drawable_nom[idx]],
                    "first_5_sampled_years": [
                        int(y) for y in sampled_years[idx, : min(5, sampled_years.shape[1])]
                    ],
                }
            )

        ending_real = drawable_real[:, -1]
        sort_order = np.lexsort((ending_real, years_lasted))

        percentile_targets = [
            ("P10 — Unlucky Early Crash Run (10th Percentile)", int(0.10 * (n_sims - 1))),
            ("P25 — Conservative Run (25th Percentile)", int(0.25 * (n_sims - 1))),
            ("P50 — Median Simulation Run (50th Percentile)", int(0.50 * (n_sims - 1))),
            ("P75 — Favorable Market Run (75th Percentile)", int(0.75 * (n_sims - 1))),
            ("P90 — Lucky Bull Market Run (90th Percentile)", int(0.90 * (n_sims - 1))),
            ("Random Run #1 — First Drawn Path", 0),
        ]

        notable_runs: list[dict[str, Any]] = []
        max_log_years = display_steps - 1
        for label, rank_idx in percentile_targets:
            sim_idx = int(sort_order[rank_idx]) if "Random Run" not in label else 0
            yl = float(years_lasted[sim_idx])
            year_log: list[dict[str, Any]] = []
            for t in range(max_log_years):
                start_corp = float(drawable_nom[sim_idx, t])
                end_corp = float(drawable_nom[sim_idx, t + 1])
                end_real = float(drawable_real[sim_idx, t + 1])
                if start_corp <= 0 and t > 0:
                    break

                # Format Rebalance Activity
                r_dir = int(reb_dir[sim_idx, t])
                r_sold = float(reb_sold[sim_idx, t])
                r_tax = float(reb_tax[sim_idx, t])
                if r_dir == 1 and r_sold > 0:
                    reb_text = f"Sold {format_inr_compact(r_sold)} Eq → Debt (Tax {format_inr_compact(r_tax)})"
                elif r_dir == -1 and r_sold > 0:
                    reb_text = f"Sold {format_inr_compact(r_sold)} Debt → Eq (Tax {format_inr_compact(r_tax)})"
                else:
                    reb_text = "—"

                # Format Special Events (Home Improvement, Random Shock, Known Future Tagged Events)
                hi_val = float(home_imp_nom[sim_idx, t])
                rs_val = float(rand_shock_nom[sim_idx, t])
                ke_val = float(known_ev_nom[sim_idx, t])
                event_badges: list[str] = []
                if t in known_tags_by_year and ke_val > 0:
                    tags_str = ", ".join(known_tags_by_year[t])
                    event_badges.append(f"🎯 {tags_str} [Nominal: {format_inr_compact(ke_val)}]")
                if hi_val > 0:
                    event_badges.append(f"🏠 Home Imp: {format_inr_compact(hi_val)}")
                if rs_val > 0:
                    event_badges.append(f"⚡ Random Shock: {format_inr_compact(rs_val)}")

                # Format Withdrawal Source (Fixed Income first, then Equity)
                w_fi = float(withdrawn_fi[sim_idx, t])
                w_eq = float(withdrawn_eq[sim_idx, t])
                w_tax = float(withdrawal_tax[sim_idx, t])
                if w_fi > 0 and w_eq <= 1.0:
                    source_str = f"Debt: {format_inr_compact(w_fi)} (Tax {format_inr_compact(w_tax)})"
                elif w_fi > 0 and w_eq > 1.0:
                    source_str = f"Debt: {format_inr_compact(w_fi)} + Eq: {format_inr_compact(w_eq)} (Tax {format_inr_compact(w_tax)})"
                elif w_eq > 1.0:
                    source_str = f"Equity: {format_inr_compact(w_eq)} (Tax {format_inr_compact(w_tax)})"
                else:
                    source_str = "Covered by Rent"

                year_log.append(
                    {
                        "sim_year": t + 1,
                        "age": current_age + t,
                        "sampled_india_year": int(sampled_years[sim_idx, t]),
                        "equity_return_pct": round(float(eq_ret[sim_idx, t]) * 100.0, 1),
                        "debt_return_pct": round(float(fi_ret[sim_idx, t]) * 100.0, 1),
                        "inflation_pct": round(float(cpi_ret[sim_idx, t]) * 100.0, 1),
                        "lifestyle_inflation_pct": lifestyle_inflation_pct,
                        "start_corpus": round(start_corp, 0),
                        "base_living_expense": round(float(base_exp_nom[sim_idx, t]), 0),
                        "home_improvement_expense": round(hi_val, 0),
                        "random_shock_expense": round(rs_val, 0),
                        "known_event_expense": round(ke_val, 0),
                        "special_events_summary": " • ".join(event_badges) if event_badges else "—",
                        "withdrawal": round(float(tot_exp_nom[sim_idx, t]), 0),
                        "withdrawal_source_summary": source_str,
                        "withdrawal_tax_paid": round(w_tax, 0),
                        "rebalance_activity": reb_text,
                        "rebalance_tax_paid": round(r_tax, 0),
                        "end_corpus_nominal": round(end_corp, 0),
                        "end_corpus_real": round(end_real, 0),
                    }
                )
            notable_runs.append(
                {
                    "label": label,
                    "run_number": sim_idx + 1,
                    "years_lasted": round(yl, 1),
                    "depletion_age": round(current_age + yl, 1),
                    "survived": bool(yl >= target_horizon - 1e-6),
                    "trajectory_real": [round(float(x), 0) for x in drawable_real[sim_idx]],
                    "trajectory_nominal": [round(float(x), 0) for x in drawable_nom[sim_idx]],
                    "year_log": year_log,
                }
            )

        return sample_paths, notable_runs

    def _compute_sensitivity_scenarios(
        self,
        *,
        total_corpus: float,
        eq_w: float,
        fi_w: float,
        prop_w: float,
        initial_annual_expense: float,
        mc_paths: dict[str, Any],
        common_sim_kwargs: dict[str, Any],
        current_age: int,
        target_horizon: int,
    ) -> list[dict[str, Any]]:
        scenarios = [
            {
                "name": "Baseline (Current Plan)",
                "description": "Your exact inputs and asset allocation",
                "corpus": total_corpus,
                "expense": initial_annual_expense,
                "weights": (eq_w, fi_w, prop_w),
                "lifestyle_inf": common_sim_kwargs["lifestyle_inflation_rate"],
            },
            {
                "name": "Trim Expenses by 15%",
                "description": f"Reduce annual spend to {format_inr_compact(initial_annual_expense * 0.85)}/yr",
                "corpus": total_corpus,
                "expense": initial_annual_expense * 0.85,
                "weights": (eq_w, fi_w, prop_w),
                "lifestyle_inf": common_sim_kwargs["lifestyle_inflation_rate"],
            },
            {
                "name": "Zero Lifestyle Creep (0%)",
                "description": "Keep expenses strictly indexed to CPI inflation without lifestyle creep",
                "corpus": total_corpus,
                "expense": initial_annual_expense,
                "weights": (eq_w, fi_w, prop_w),
                "lifestyle_inf": 0.0,
            },
            {
                "name": "Boost Corpus by +20%",
                "description": f"Work ~2 more years to reach {format_inr_compact(total_corpus * 1.20)}",
                "corpus": total_corpus * 1.20,
                "expense": initial_annual_expense,
                "weights": (eq_w, fi_w, prop_w),
                "lifestyle_inf": common_sim_kwargs["lifestyle_inflation_rate"],
            },
        ]

        results: list[dict[str, Any]] = []
        for sc in scenarios:
            w_e, w_f, w_p = sc["weights"]
            kw = {**common_sim_kwargs, "lifestyle_inflation_rate": sc["lifestyle_inf"]}
            out = simulate_portfolio_paths(
                total_corpus=sc["corpus"],
                equity_weight=w_e,
                fixed_income_weight=w_f,
                property_weight=w_p,
                initial_annual_expense=sc["expense"],
                equity_returns=mc_paths["equity"],
                fixed_income_returns=mc_paths["fixed_income"],
                property_returns=mc_paths["property"],
                inflation_rates=mc_paths["cpi"],
                **kw,
            )
            st = compute_longevity_stats(
                years_lasted=out["years_lasted"],
                current_age=current_age,
                target_horizon=target_horizon,
            )
            results.append(
                {
                    "name": sc["name"],
                    "description": sc["description"],
                    "success_probability_pct": st["success_probability_pct"],
                    "p10_years": st["percentiles_years"]["p10"],
                    "median_years": st["percentiles_years"]["p50"],
                    "p10_depletion_age": st["depletion_ages"]["p10"],
                    "median_depletion_age": st["depletion_ages"]["p50"],
                }
            )
        return results

    def _build_verdict(
        self,
        *,
        longevity_stats: dict[str, Any],
        current_age: int,
        life_expectancy: int,
        target_horizon: int,
        max_sim_horizon: int,
        swr_on_drawable: float,
        benchmark_swr: float,
        required_drawable_corpus: float,
        initial_drawable_corpus: float,
    ) -> dict[str, Any]:
        success_pct = longevity_stats["success_probability_pct"]
        p10_yrs = longevity_stats["percentiles_years"]["p10"]
        p50_yrs = longevity_stats["percentiles_years"]["p50"]
        p10_age = longevity_stats["depletion_ages"]["p10"]
        p50_age = longevity_stats["depletion_ages"]["p50"]

        median_label = (
            f"{target_horizon}+ yrs (Age {life_expectancy}+)"
            if p50_yrs >= max_sim_horizon - 0.5
            else f"{p50_yrs:.1f} yrs (Age {p50_age:.0f})"
        )

        if success_pct >= 85.0:
            status = "retire_ready"
            badge = "Yes — High Confidence FIRE"
            headline = f"Your wealth lasts {median_label} in the median case and survives to Age {life_expectancy} in {success_pct:.1f}% of random simulations."
            recommendation = (
                f"Your effective withdrawal rate ({swr_on_drawable:.2f}%) is within India's safe "
                f"benchmark ({benchmark_swr:.2f}%). Even in the worst 10% sequence-of-returns stress test (P10), "
                f"your corpus lasts {p10_yrs:.1f} years (until Age {p10_age:.0f})."
            )
        elif success_pct >= 65.0:
            status = "borderline"
            badge = "Borderline — Moderate Sequence Risk"
            headline = f"Median longevity is {median_label}, with a {success_pct:.1f}% probability of reaching Age {life_expectancy}."
            recommendation = (
                f"In normal or bull markets you comfortably outlast Age {life_expectancy}, but an early "
                f"2008/2011-style crash (P10) depletes the corpus in {p10_yrs:.1f} years (Age {p10_age:.0f}). "
                f"Building a buffer toward {format_inr_compact(required_drawable_corpus)} or using flexible spending rules "
                f"will lock in high safety."
            )
        elif success_pct >= 35.0:
            status = "at_risk"
            badge = "Caution — Vulnerable to Inflation & Bear Markets"
            headline = f"Your corpus lasts a median of {p50_yrs:.1f} years (until Age {p50_age:.0f}), falling short of Age {life_expectancy} in {100 - success_pct:.1f}% of runs."
            recommendation = (
                f"Your current withdrawal rate ({swr_on_drawable:.2f}%) exceeds the sustainable Indian rate "
                f"({benchmark_swr:.2f}%). In poor market sequences (P10), funds run out in {p10_yrs:.1f} years "
                f"(Age {p10_age:.0f}). Consider targeting {format_inr_compact(required_drawable_corpus)} in drawable wealth."
            )
        else:
            status = "shortfall"
            badge = "Not Yet — Corpus Shortfall"
            headline = f"Your corpus is projected to last {p50_yrs:.1f} years (median depletion at Age {p50_age:.0f}) vs your {target_horizon}-year horizon."
            shortfall = max(0.0, required_drawable_corpus - initial_drawable_corpus)
            recommendation = (
                f"At a {swr_on_drawable:.2f}% withdrawal rate, inflation and taxes compound outflows faster than portfolio growth. "
                f"You need approximately {format_inr_compact(shortfall)} more in liquid/drawable assets "
                f"(target ~{format_inr_compact(required_drawable_corpus)}) or a lower expense baseline to retire safely."
            )

        return {
            "status": status,
            "badge": badge,
            "headline": headline,
            "recommendation": recommendation,
            "median_longevity_label": median_label,
        }


def register_all_simulators() -> None:
    """Register active and upcoming simulators in the global FinLib registry."""
    registry.register(WealthLongevitySimulator())

    registry.register_planned(
        SimulatorMetadata(
            id="coast_fire_india",
            title="Coast FIRE & Barista FIRE Calculator",
            subtitle="When can I stop saving and let compounding take over?",
            description=(
                "Calculate the exact age and EPF/PPF/Nifty corpus at which you no longer need "
                "active SIPs to hit your target retirement corpus at age 55 or 60."
            ),
            category="Accumulation & Transition",
            status="coming_soon",
            icon="sailboat",
            tags=["Coast FIRE", "SIP Step-Down", "EPF + Equity"],
        )
    )
    registry.register_planned(
        SimulatorMetadata(
            id="three_bucket_decumulation",
            title="3-Bucket Retirement Cashflow Optimizer",
            subtitle="Protect against Indian sequence-of-returns crashes",
            description=(
                "Design an optimal Liquid/Arbitrage (Bucket 1), Short-Duration Debt (Bucket 2), "
                "and Nifty Equity (Bucket 3) refill strategy with LTCG tax harvesting."
            ),
            category="Decumulation Strategy",
            status="coming_soon",
            icon="layers",
            tags=["Bucket Strategy", "Tax Harvesting", "SWP"],
        )
    )
    registry.register_planned(
        SimulatorMetadata(
            id="goal_sip_glidepath",
            title="Multi-Goal SIP & Glidepath Simulator",
            subtitle="Kids' higher education, home upgrade & FIRE simultaneously",
            description=(
                "Simulate lumpy Indian household outflows (education inflation at 10-12%, weddings, "
                "healthcare reserve) alongside core retirement corpus accumulation."
            ),
            category="Holistic Planning",
            status="coming_soon",
            icon="target",
            tags=["Goal Planning", "Education Inflation", "Glidepath"],
        )
    )


register_all_simulators()
