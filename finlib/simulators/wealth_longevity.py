"""
Simulator #1: "When Can I Retire?" / "How Long Will My Wealth Last?"

Iteratively evaluates retiring at the current age, then +1 year, +2 years, ... up to the
duration of active income/SIPs using a SINGLE pre-generated set of historical market simulations
and random shocks from the last 20 years of Indian market data.
Finds the earliest retirement age achieving an 85% Success Rate (wealth lasting until the end
of the plan, e.g. Age 90) and provides full apples-to-apples outcomes (Median Case, Worst Case,
trajectories, survival curves, and year-by-year table) for every candidate retirement age so
the user can select and inspect any earlier or later retirement age interactively.
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
    _expand_future_expense_items,
    compute_longevity_histogram,
    compute_longevity_stats,
    compute_survival_curve,
    compute_trajectory_percentiles,
    format_inr_compact,
    simulate_portfolio_paths,
)
from finlib.data.indian_market_history import get_historical_arrays, get_market_summary_statistics

TARGET_RETIREMENT_SUCCESS_RATE_PCT = 85.0


class WealthLongevitySimulator(BaseSimulator):
    """Simulator finding the earliest retirement age with >= 85% success rate in India."""

    metadata = SimulatorMetadata(
        id="wealth_longevity",
        title="Decode My Financial Outlook",
        subtitle="See How Long Your Wealth Lasts & When You Can Retire",
        description=(
            "Decodes how long your wealth lasts in the median and worst case across historical Indian "
            "market and shock simulations, and finds when you can retire with an 85% success rate if you have ongoing job or business income."
        ),
        category="Core FIRE Readiness",
        status="active",
        icon="flame",
        tags=["Decode My Financial Outlook", "Wealth Longevity", "85% Success Rate"],
    )

    def get_default_params(self) -> dict[str, Any]:
        return {
            "current_age": 38,
            "life_expectancy": 90,
            "has_medical_insurance": True,
            "equity_value": None,
            "fixed_income_value": None,
            "real_estate_value": None,
            "cash_value": None,
            "total_corpus": 3_50_00_000.0,
            "equity_pct": 55.0,
            "fixed_income_pct": 30.0,
            "property_pct": 15.0,
            "cash_pct": 0.0,
            # Step 3: Income Categories
            "job_monthly_income": 0.0,
            "job_income_years": 0,
            "job_income_until_age": None,
            "job_income_growth_pct": 0.0,
            "job_income_growth_max_pct": None,
            "job_income_growth_range": None,
            "rental_monthly_income": 0.0,
            "other_passive_monthly_income": 0.0,
            "passive_income_inflation_interval_years": 1,
            # Step 4: Ongoing SIPs
            "equity_sip_monthly": 0.0,
            "equity_sip_stepup_pct": 0.0,
            "fixed_income_sip_monthly": 0.0,
            "fixed_income_sip_stepup_pct": 0.0,
            "sip_years": None,
            # Step 5: Living Expenses & Goals
            "expense_amount": 1_00_000.0,
            "expense_frequency": "monthly",
            "expense_variance_pct": 0.0,
            "base_inflation_rate": None,
            "lifestyle_inflation_rate": 0.5,
            "post_retirement_expense_multiplier": 100.0,
            "property_mode": "liquidate_fallback",
            "property_rental_yield": 2.5,
            "property_liquidation_haircut": 10.0,
            # Configuration defaults (prefilled)
            "rebalance_annually": True,
            "rebalance_frequency_years": 2,
            "tax_drag_rate": 10.0,
            "fixed_income_tax_rate": None,
            "equity_tax_rate": None,
            "home_improvement_enabled": False,
            "home_improvement_interval_years": 5,
            "home_improvement_pct_of_property": 3.0,
            "home_improvement_variance_pct": 1.0,
            "random_expense_enabled": True,
            "random_expense_base_inr": None,
            "random_expense_variance_pct": 25.0,
            "random_expense_annual_probability_pct": 15.0,
            "known_future_expenses": [],
            "num_simulations": 2500,
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

        has_explicit_assets = any(
            params.get(k) is not None
            for k in ("equity_value", "fixed_income_value", "real_estate_value", "cash_value")
        )
        if has_explicit_assets:
            eq_val_in = float(cfg.get("equity_value") or 0.0)
            fi_val_in = float(cfg.get("fixed_income_value") or 0.0)
            re_val_in = float(cfg.get("real_estate_value") or 0.0)
            ca_val_in = float(cfg.get("cash_value") or 0.0)
            total_corpus = eq_val_in + fi_val_in + re_val_in + ca_val_in
            if total_corpus <= 0:
                eq_w, fi_w, prop_w, ca_w = 0.0, 0.0, 0.0, 0.0
            else:
                eq_w = eq_val_in / total_corpus
                fi_w = fi_val_in / total_corpus
                prop_w = re_val_in / total_corpus
                ca_w = ca_val_in / total_corpus
        else:
            total_corpus = float(cfg["total_corpus"])
            eq_w = float(cfg["equity_pct"]) / 100.0
            fi_w = float(cfg["fixed_income_pct"]) / 100.0
            prop_w = float(cfg["property_pct"]) / 100.0
            ca_w = float(cfg.get("cash_pct") or 0.0) / 100.0
            if abs((eq_w + fi_w + prop_w) - 1.0) <= 0.01:
                ca_w = 0.0
            w_sum = eq_w + fi_w + prop_w + ca_w
            if w_sum > 0:
                eq_w, fi_w, prop_w, ca_w = eq_w / w_sum, fi_w / w_sum, prop_w / w_sum, ca_w / w_sum
            eq_val_in = total_corpus * eq_w
            fi_val_in = total_corpus * fi_w
            re_val_in = total_corpus * prop_w
            ca_val_in = total_corpus * ca_w

        liquid_corpus = eq_val_in + fi_val_in + ca_val_in
        non_liquid_corpus = re_val_in
        liquid_pct = (liquid_corpus / total_corpus * 100.0) if total_corpus > 0 else 0.0
        non_liquid_pct = (non_liquid_corpus / total_corpus * 100.0) if total_corpus > 0 else 0.0

        job_monthly = float(cfg.get("job_monthly_income") or 0.0)
        raw_until_age = cfg.get("job_income_until_age")
        if raw_until_age is not None and int(raw_until_age) > current_age:
            job_years = max(0, int(raw_until_age) - current_age)
        else:
            job_years = max(0, int(cfg.get("job_income_years") or 0))

        raw_growth_range = cfg.get("job_income_growth_range")
        job_growth_min_pct = float(cfg.get("job_income_growth_pct") or 0.0)
        raw_growth_max_pct = cfg.get("job_income_growth_max_pct")
        job_growth_max_pct = float(raw_growth_max_pct) if raw_growth_max_pct is not None else job_growth_min_pct
        if raw_growth_range:
            import re
            nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", str(raw_growth_range))]
            if len(nums) >= 2:
                job_growth_min_pct = min(nums[0], nums[1])
                job_growth_max_pct = max(nums[0], nums[1])
            elif len(nums) == 1:
                job_growth_min_pct = nums[0]
                job_growth_max_pct = nums[0]
        job_growth = job_growth_min_pct / 100.0
        job_growth_max = job_growth_max_pct / 100.0

        rental_monthly = float(cfg.get("rental_monthly_income") or 0.0)
        passive_monthly = float(cfg.get("other_passive_monthly_income") or 0.0)
        passive_inf_interval = max(1, int(cfg.get("passive_income_inflation_interval_years") or 1))

        eq_sip_monthly = float(cfg.get("equity_sip_monthly") or 0.0)
        eq_sip_stepup = float(cfg.get("equity_sip_stepup_pct") or 0.0) / 100.0
        fi_sip_monthly = float(cfg.get("fixed_income_sip_monthly") or 0.0)
        fi_sip_stepup = float(cfg.get("fixed_income_sip_stepup_pct") or 0.0) / 100.0
        has_passive_or_rental = (rental_monthly > 0) or (passive_monthly > 0)
        raw_sip_years = cfg.get("sip_years")
        if raw_sip_years is not None:
            sip_duration_years = max(0, int(raw_sip_years))
        else:
            # SIPs continue until end of income (job / business / rental / passive)
            sip_duration_years = max_sim_horizon if has_passive_or_rental else job_years

        expense_amount = float(cfg["expense_amount"])
        expense_frequency = str(cfg["expense_frequency"]).lower()
        raw_global_var = cfg.get("global_variance_pct")
        global_var_pct = float(raw_global_var) if raw_global_var is not None else None
        raw_exp_var = float(cfg.get("expense_variance_pct") or 0.0)
        expense_variance = (global_var_pct if (raw_exp_var <= 0 and global_var_pct is not None) else raw_exp_var) / 100.0
        initial_annual_expense = (
            expense_amount * 12.0 if expense_frequency == "monthly" else expense_amount
        )

        raw_base_inf = cfg.get("base_inflation_rate")
        base_inflation_override = float(raw_base_inf) / 100.0 if raw_base_inf is not None else None
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

        tax_drag_rate = float(cfg.get("tax_drag_rate", 10.0)) / 100.0
        raw_fi_tax = cfg.get("fixed_income_tax_rate")
        raw_eq_tax = cfg.get("equity_tax_rate")
        fi_tax_rate = float(raw_fi_tax) / 100.0 if raw_fi_tax is not None else tax_drag_rate
        eq_tax_rate = float(raw_eq_tax) / 100.0 if raw_eq_tax is not None else tax_drag_rate

        home_imp_enabled = bool(cfg.get("home_improvement_enabled", False))
        home_imp_interval = max(1, int(cfg.get("home_improvement_interval_years", 5)))
        home_imp_pct = float(cfg.get("home_improvement_pct_of_property", 3.0)) / 100.0
        home_imp_var = float(cfg.get("home_improvement_variance_pct", 1.0)) / 100.0

        rand_exp_enabled = bool(cfg.get("random_expense_enabled", True))
        default_shock_inr = 2_00_000.0 if has_medical_insurance else 5_00_000.0
        raw_rand_base = cfg.get("random_expense_base_inr")
        rand_exp_base = float(default_shock_inr if raw_rand_base is None else raw_rand_base)
        eff_rand_var_pct = global_var_pct if global_var_pct is not None else float(cfg.get("random_expense_variance_pct", 10.0))
        rand_exp_var = eff_rand_var_pct / 100.0
        rand_exp_prob = float(cfg.get("random_expense_annual_probability_pct", 15.0)) / 100.0

        known_future_expenses = cfg.get("known_future_expenses") or []
        if global_var_pct is not None:
            for k_item in known_future_expenses:
                if isinstance(k_item, dict) and k_item.get("is_recurring") and not k_item.get("variance_pct"):
                    k_item["variance_pct"] = global_var_pct

        num_simulations = int(cfg["num_simulations"])
        sampling_method = cfg["sampling_method"]
        use_hist_inf_vol = bool(cfg.get("use_historical_inflation_volatility", True))
        seed = cfg.get("seed", None)

        hist_arrays = get_historical_arrays()
        mkt_stats = get_market_summary_statistics()
        period_label = f"Last {len(hist_arrays['years'])} Years of Indian Market Data"

        # 1. Generate ONE fixed set of random return paths from the last 20 years of Indian history
        mc_paths = generate_monte_carlo_paths(
            horizon_years=max_sim_horizon,
            num_simulations=num_simulations,
            sampling_method=sampling_method,
            base_inflation_override=base_inflation_override,
            use_historical_inflation_volatility=use_hist_inf_vol,
            seed=seed,
        )

        base_sim_kwargs: dict[str, Any] = {
            "cash_weight": ca_w,
            "current_age": current_age,
            "expense_variance_pct": expense_variance,
            "lifestyle_inflation_rate": lifestyle_inflation,
            "post_retirement_multiplier": post_ret_mult,
            "property_mode": property_mode,
            "property_rental_yield": property_rental_yield,
            "property_liquidation_haircut": property_haircut,
            "job_annual_income": job_monthly * 12.0,
            "job_income_growth_rate": job_growth,
            "job_income_growth_rate_max": job_growth_max,
            "rental_annual_income": rental_monthly * 12.0,
            "other_passive_annual_income": passive_monthly * 12.0,
            "passive_income_inflation_interval_years": passive_inf_interval,
            "equity_sip_annual": eq_sip_monthly * 12.0,
            "equity_sip_stepup_rate": eq_sip_stepup,
            "fixed_income_sip_annual": fi_sip_monthly * 12.0,
            "fixed_income_sip_stepup_rate": fi_sip_stepup,
            "rebalance_annually": rebalance_enabled,
            "rebalance_frequency_years": rebalance_freq_years,
            "tax_drag_rate": tax_drag_rate,
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

        # 2. Apples-to-Apples Retirement Age Search:
        # Evaluate r = 0, 1, 2, ... up to max_search_years using the EXACT same mc_paths and random shock seed.
        # If job/business income is zero, the user has no active future work horizon (already retired / retiring today), so max_search_years = 0.
        effective_job_years = job_years if job_monthly > 0 else 0
        configured_work_horizon = effective_job_years
        max_search_years = min(target_horizon - 1, configured_work_horizon)

        display_steps = target_horizon + 1
        benchmark_swr = max(2.4, min(4.0, 4.2 - 0.025 * target_horizon - 10.0 * lifestyle_inflation))

        candidate_retirement_ages: list[dict[str, Any]] = []
        outcomes_by_age: dict[str, dict[str, Any]] = {}
        best_r: int | None = None
        best_mc_out: dict[str, Any] | None = None
        retire_today_success_pct = 0.0
        last_mc_out: dict[str, Any] | None = None

        for r in range(0, max_search_years + 1):
            ret_age = current_age + r
            active_job_yrs = min(r, effective_job_years)
            if raw_sip_years is not None:
                active_sip_yrs = min(r, sip_duration_years) if effective_job_years > 0 else sip_duration_years
            else:
                active_sip_yrs = max_sim_horizon if has_passive_or_rental else active_job_yrs
            step_kwargs = {
                **base_sim_kwargs,
                "retirement_start_year_offset": r,
                "job_income_years": active_job_yrs,
                "sip_duration_years": active_sip_yrs,
            }
            step_out = simulate_portfolio_paths(
                total_corpus=total_corpus,
                equity_weight=eq_w,
                fixed_income_weight=fi_w,
                property_weight=prop_w,
                initial_annual_expense=initial_annual_expense,
                equity_returns=mc_paths["equity"],
                fixed_income_returns=mc_paths["fixed_income"],
                property_returns=mc_paths["property"],
                inflation_rates=mc_paths["cpi"],
                **step_kwargs,
            )
            step_stats = compute_longevity_stats(
                years_lasted=step_out["years_lasted"],
                current_age=current_age,
                target_horizon=target_horizon,
            )
            sr_pct = step_stats["success_probability_pct"]
            if r == 0:
                retire_today_success_pct = sr_pct

            meets_target = sr_pct >= TARGET_RETIREMENT_SUCCESS_RATE_PCT
            if meets_target and best_r is None:
                best_r = r
                best_mc_out = step_out

            last_mc_out = step_out

            # Build full apples-to-apples outcome bundle for this candidate retirement age
            step_traj_nom = compute_trajectory_percentiles(
                corpus_matrix=step_out["drawable_nominal"][:, :display_steps],
                current_age=current_age,
            )
            step_traj_real = compute_trajectory_percentiles(
                corpus_matrix=step_out["drawable_real"][:, :display_steps],
                current_age=current_age,
            )
            step_survival = compute_survival_curve(
                drawable_matrix=step_out["drawable_nominal"],
                current_age=current_age,
            )
            _, step_notable_runs = self._extract_sample_paths(
                mc_paths=mc_paths,
                mc_out=step_out,
                current_age=current_age,
                display_steps=display_steps,
                target_horizon=target_horizon,
                lifestyle_inflation_pct=round(lifestyle_inflation * 100.0, 2),
            )
            step_chart_events = self._build_chart_event_annotations(
                current_age=current_age,
                target_horizon=target_horizon,
                known_future_expenses=known_future_expenses,
                home_imp_enabled=home_imp_enabled and (prop_w > 0),
                home_imp_interval=home_imp_interval,
                home_imp_pct=home_imp_pct,
                home_imp_var=home_imp_var,
                rebalance_enabled=rebalance_enabled,
                rebalance_freq_years=rebalance_freq_years,
                notable_runs=step_notable_runs,
            )

            outcomes_by_age[str(ret_age)] = {
                "retirement_age": ret_age,
                "retire_in_years": r,
                "longevity_stats": step_stats,
                "trajectories": {
                    "nominal": step_traj_nom,
                    "real": step_traj_real,
                },
                "chart_events": step_chart_events,
                "survival_curve": step_survival,
                "notable_runs": step_notable_runs,
            }

            candidate_retirement_ages.append(
                {
                    "retire_in_years": r,
                    "retirement_age": ret_age,
                    "success_rate_pct": sr_pct,
                    "median_years_lasted": step_stats["percentiles_years"]["p50"],
                    "worst_case_years_lasted": step_stats["percentiles_years"]["p10"],
                    "median_depletion_age": step_stats["depletion_ages"]["p50"],
                    "worst_case_depletion_age": step_stats["depletion_ages"]["p10"],
                    "meets_target": meets_target,
                }
            )

        chosen_r = best_r if best_r is not None else max_search_years
        chosen_age = current_age + chosen_r
        mc_out = best_mc_out if best_mc_out is not None else last_mc_out  # type: ignore[assignment]
        common_sim_kwargs = {
            **base_sim_kwargs,
            "retirement_start_year_offset": chosen_r,
            "job_income_years": min(chosen_r, job_years),
            "sip_duration_years": min(chosen_r, sip_duration_years),
        }

        chosen_bundle = outcomes_by_age[str(chosen_age)]
        longevity_stats = chosen_bundle["longevity_stats"]
        trajectories_nominal = chosen_bundle["trajectories"]["nominal"]
        trajectories_real = chosen_bundle["trajectories"]["real"]
        survival_curve = chosen_bundle["survival_curve"]
        notable_runs = chosen_bundle["notable_runs"]
        chart_events = chosen_bundle["chart_events"]

        longevity_histogram = compute_longevity_histogram(
            years_lasted=mc_out["years_lasted"],
            horizon_years=target_horizon,
            bucket_size=5,
        )
        sample_simulation_paths, _ = self._extract_sample_paths(
            mc_paths=mc_paths,
            mc_out=mc_out,
            current_age=current_age,
            display_steps=display_steps,
            target_horizon=target_horizon,
            lifestyle_inflation_pct=round(lifestyle_inflation * 100.0, 2),
        )

        # 3. Historical Rolling Window Backtest
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
        for cohort in mkt_stats["crisis_cohorts"]:
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
        initial_drawable_corpus = float(mc_out["drawable_nominal"][0, 0])
        initial_annual_rent = (
            rental_monthly * 12.0
            if rental_monthly > 0
            else (
                re_val_in * property_rental_yield
                if property_mode in ("liquidate_fallback", "illiquid_with_rent", "rebalanced")
                else 0.0
            )
        )
        initial_annual_income = (
            (job_monthly * 12.0 if chosen_r > 0 else 0.0)
            + initial_annual_rent
            + (passive_monthly * 12.0)
        )
        effective_first_year_expense = initial_annual_expense * post_ret_mult
        net_withdrawal_year1 = max(0.0, effective_first_year_expense - initial_annual_income)

        swr_on_total = (
            (net_withdrawal_year1 / total_corpus) * 100.0 if total_corpus > 0 else 100.0
        )
        swr_on_drawable = (
            (net_withdrawal_year1 / initial_drawable_corpus) * 100.0
            if initial_drawable_corpus > 0
            else 100.0
        )
        required_drawable_corpus = (
            net_withdrawal_year1 / (benchmark_swr / 100.0) if benchmark_swr > 0 else 0.0
        )

        # Attach per-age verdict to each outcome bundle
        for age_key, bundle in outcomes_by_age.items():
            r_offset = bundle["retire_in_years"]
            bundle["verdict"] = self._build_verdict(
                longevity_stats=bundle["longevity_stats"],
                current_age=current_age,
                life_expectancy=life_expectancy,
                target_horizon=target_horizon,
                max_sim_horizon=max_sim_horizon,
                swr_on_drawable=swr_on_drawable,
                benchmark_swr=benchmark_swr,
                required_drawable_corpus=required_drawable_corpus,
                initial_drawable_corpus=initial_drawable_corpus,
                best_r=best_r,
                max_search_years=max_search_years,
                retire_today_success_pct=retire_today_success_pct,
                selected_r=r_offset,
            )

        verdict = outcomes_by_age[str(chosen_age)]["verdict"]

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

        retirement_readiness = {
            "target_success_rate_pct": TARGET_RETIREMENT_SUCCESS_RATE_PCT,
            "can_retire_at_age": (current_age + best_r) if best_r is not None else None,
            "years_until_retirement": best_r,
            "recommended_retirement_age": chosen_age,
            "recommended_retire_in_years": chosen_r,
            "evaluated_retirement_age": chosen_age,
            "evaluated_retire_in_years": chosen_r,
            "retire_today_success_rate_pct": retire_today_success_pct,
            "evaluated_success_rate_pct": longevity_stats["success_probability_pct"],
            "max_income_years_searched": max_search_years,
            "candidate_retirement_ages": candidate_retirement_ages,
            "outcomes_by_age": outcomes_by_age,
        }

        return {
            "simulator_id": self.metadata.id,
            "simulation_meta": {
                "seed_used": mc_paths["seed_used"],
                "num_simulations": num_simulations,
                "sampling_method": sampling_method,
                "historical_data_window": period_label,
                "historical_data_period": period_label,
                "historical_years_list": [int(y) for y in hist_arrays["years"]],
                "rebalance_enabled": rebalance_enabled,
                "rebalance_frequency_years": rebalance_freq_years,
                "tax_drag_rate_pct": round(tax_drag_rate * 100.0, 1),
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
                "equity_value": round(eq_val_in, 0),
                "equity_value_formatted": format_inr_compact(eq_val_in),
                "fixed_income_value": round(fi_val_in, 0),
                "fixed_income_value_formatted": format_inr_compact(fi_val_in),
                "real_estate_value": round(re_val_in, 0),
                "real_estate_value_formatted": format_inr_compact(re_val_in),
                "cash_value": round(ca_val_in, 0),
                "cash_value_formatted": format_inr_compact(ca_val_in),
                "initial_liquid_corpus": round(liquid_corpus, 0),
                "initial_liquid_formatted": format_inr_compact(liquid_corpus),
                "liquid_pct": round(liquid_pct, 1),
                "initial_property_corpus": round(non_liquid_corpus, 0),
                "initial_property_formatted": format_inr_compact(non_liquid_corpus),
                "non_liquid_pct": round(non_liquid_pct, 1),
                "initial_drawable_corpus": round(initial_drawable_corpus, 0),
                "initial_drawable_formatted": format_inr_compact(initial_drawable_corpus),
                "annual_expense": round(effective_first_year_expense, 0),
                "annual_expense_formatted": format_inr_compact(effective_first_year_expense),
                "monthly_expense_formatted": format_inr_compact(effective_first_year_expense / 12.0),
                "initial_annual_rent": round(initial_annual_rent, 0),
                "initial_annual_rent_formatted": format_inr_compact(initial_annual_rent),
                "initial_annual_income": round(initial_annual_income, 0),
                "initial_annual_income_formatted": format_inr_compact(initial_annual_income),
                "job_monthly_income": round(job_monthly, 0),
                "job_income_years": job_years,
                "job_income_growth_pct": round(job_growth * 100.0, 1),
                "rental_monthly_income": round(rental_monthly, 0),
                "other_passive_monthly_income": round(passive_monthly, 0),
                "equity_sip_monthly": round(eq_sip_monthly, 0),
                "equity_sip_stepup_pct": round(eq_sip_stepup * 100.0, 1),
                "fixed_income_sip_monthly": round(fi_sip_monthly, 0),
                "fixed_income_sip_stepup_pct": round(fi_sip_stepup * 100.0, 1),
                "sip_years": sip_duration_years,
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
                    "cash_pct": round(ca_w * 100, 1),
                },
                "tax_drag_rate": round(tax_drag_rate * 100.0, 1),
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
            "retirement_readiness": retirement_readiness,
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
        """
        Build separate year/age event maps for the Median Case (P50) and Worst Case (P10).
        """
        base_by_age: dict[int, list[str]] = {}
        known_ages: set[int] = set()

        events_by_t, _ = _expand_future_expense_items(
            known_future_expenses, target_horizon, current_age=current_age
        )
        for t_idx, ev_list in events_by_t.items():
            y_off = t_idx + 1
            event_age = current_age + y_off
            known_ages.add(event_age)
            for ev in ev_list:
                var_txt = f" (±{int(round(ev['variance']*100))}%)" if ev["variance"] > 0 else ""
                rec_txt = " [Recurring]" if ev["is_recurring"] else ""
                base_by_age.setdefault(event_age, []).append(
                    f"🎯 {ev['tag']}{rec_txt} (Yr {y_off}): {format_inr_compact(ev['amount_today'])}{var_txt} at today's value"
                )

        if home_imp_enabled and home_imp_interval > 0:
            for y_off in range(home_imp_interval, target_horizon + 1, home_imp_interval):
                event_age = current_age + y_off
                base_by_age.setdefault(event_age, []).append(
                    f"🏠 Home Improvement (Yr {y_off}): {home_imp_pct * 100:.1f}% (±{home_imp_var * 100:.1f}%) of Property"
                )

        by_age_p50: dict[int, list[str]] = {k: list(v) for k, v in base_by_age.items()}
        by_age_p10: dict[int, list[str]] = {k: list(v) for k, v in base_by_age.items()}

        median_run = next((r for r in notable_runs if r["case_key"] == "p50"), None)
        p10_run = next((r for r in notable_runs if r["case_key"] == "p10"), None)

        if median_run:
            for row in median_run.get("year_log", []):
                row_age = current_age + int(row["sim_year"]) - 1
                if row.get("random_shock_expense", 0) > 0:
                    by_age_p50.setdefault(row_age, []).append(
                        f"⚡ Random Shock: {format_inr_compact(row['random_shock_expense'])}"
                    )
                if row.get("rebalance_activity") and row["rebalance_activity"] != "—":
                    by_age_p50.setdefault(row_age, []).append(
                        f"⚖️ Rebalance: {row['rebalance_activity']}"
                    )
        elif rebalance_enabled and rebalance_freq_years > 0:
            for y_off in range(rebalance_freq_years, target_horizon + 1, rebalance_freq_years):
                event_age = current_age + y_off
                by_age_p50.setdefault(event_age, []).append(
                    f"⚖️ Scheduled Portfolio Rebalance (Yr {y_off})"
                )

        if p10_run:
            for row in p10_run.get("year_log", []):
                row_age = current_age + int(row["sim_year"]) - 1
                if row.get("random_shock_expense", 0) > 0:
                    by_age_p10.setdefault(row_age, []).append(
                        f"⚡ Random Shock: {format_inr_compact(row['random_shock_expense'])}"
                    )
                if row.get("rebalance_activity") and row["rebalance_activity"] != "—":
                    by_age_p10.setdefault(row_age, []).append(
                        f"⚖️ Rebalance: {row['rebalance_activity']}"
                    )

        return {
            "events_by_age": {str(k): v for k, v in by_age_p50.items()},
            "events_by_age_p50": {str(k): v for k, v in by_age_p50.items()},
            "events_by_age_p10": {str(k): v for k, v in by_age_p10.items()},
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
        Extract sample simulation paths and detailed year-by-year run logs
        with Median Case prioritized first and combined Events column.
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
        tot_inc_nom = mc_out["total_income_nominal"]
        tot_sip_nom = mc_out["total_sip_nominal"]
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
            ("p50", "P50 — Median Case (Typical Market)", int(0.50 * (n_sims - 1))),
            ("p10", "P10 — Worst Case", int(0.10 * (n_sims - 1))),
            ("p25", "P25 — Cautious Case", int(0.25 * (n_sims - 1))),
            ("p75", "P75 — Favorable Market Case", int(0.75 * (n_sims - 1))),
            ("p90", "P90 — Strong Market Case", int(0.90 * (n_sims - 1))),
            ("random1", "Random Sample Path #1", 0),
        ]

        notable_runs: list[dict[str, Any]] = []
        max_log_years = display_steps - 1
        for case_key, label, rank_idx in percentile_targets:
            sim_idx = int(sort_order[rank_idx]) if case_key != "random1" else 0
            yl = float(years_lasted[sim_idx])
            year_log: list[dict[str, Any]] = []
            for t in range(max_log_years):
                start_corp = float(drawable_nom[sim_idx, t])
                end_corp = float(drawable_nom[sim_idx, t + 1])
                end_real = float(drawable_real[sim_idx, t + 1])
                if start_corp <= 0 and t > 0:
                    break

                r_dir = int(reb_dir[sim_idx, t])
                r_sold = float(reb_sold[sim_idx, t])
                r_tax = float(reb_tax[sim_idx, t])
                if r_dir == 1 and r_sold > 0:
                    reb_text = f"Rebalanced {format_inr_compact(r_sold)} Eq → FD (Tax {format_inr_compact(r_tax)})"
                elif r_dir == -1 and r_sold > 0:
                    reb_text = f"Rebalanced {format_inr_compact(r_sold)} FD → Eq (Tax {format_inr_compact(r_tax)})"
                else:
                    reb_text = "—"

                hi_val = float(home_imp_nom[sim_idx, t])
                rs_val = float(rand_shock_nom[sim_idx, t])
                ke_val = float(known_ev_nom[sim_idx, t])
                inc_val = float(tot_inc_nom[sim_idx, t])
                sip_val = float(tot_sip_nom[sim_idx, t])

                event_badges: list[str] = []
                if t in known_tags_by_year and ke_val > 0:
                    tags_str = ", ".join(known_tags_by_year[t])
                    event_badges.append(f"🎯 {tags_str}: {format_inr_compact(ke_val)}")
                if hi_val > 0:
                    event_badges.append(f"🏠 Home Imp: {format_inr_compact(hi_val)}")
                if rs_val > 0:
                    event_badges.append(f"⚡ Shock: {format_inr_compact(rs_val)}")
                if reb_text != "—":
                    event_badges.append(f"⚖️ {reb_text}")

                w_fi = float(withdrawn_fi[sim_idx, t])
                w_eq = float(withdrawn_eq[sim_idx, t])
                w_tax = float(withdrawal_tax[sim_idx, t])
                if w_fi > 0 and w_eq <= 1.0:
                    source_str = f"From FD/Cash: {format_inr_compact(w_fi)} (Tax {format_inr_compact(w_tax)})"
                elif w_fi > 0 and w_eq > 1.0:
                    source_str = f"FD/Cash: {format_inr_compact(w_fi)} + Equity: {format_inr_compact(w_eq)} (Tax {format_inr_compact(w_tax)})"
                elif w_eq > 1.0:
                    source_str = f"From Equity: {format_inr_compact(w_eq)} (Tax {format_inr_compact(w_tax)})"
                else:
                    source_str = "Covered by Income"

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
                        "income_received": round(inc_val, 0),
                        "sip_contributed": round(sip_val, 0),
                        "home_improvement_expense": round(hi_val, 0),
                        "random_shock_expense": round(rs_val, 0),
                        "known_event_expense": round(ke_val, 0),
                        "special_events_summary": " • ".join(event_badges) if event_badges else "—",
                        "combined_events_summary": " • ".join(event_badges) if event_badges else "—",
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
                    "case_key": case_key,
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
                "name": "Your Current Plan",
                "description": "Your exact savings, income, and expense inputs",
                "corpus": total_corpus,
                "expense": initial_annual_expense,
                "weights": (eq_w, fi_w, prop_w),
                "lifestyle_inf": common_sim_kwargs["lifestyle_inflation_rate"],
            },
            {
                "name": "Reduce Living Expenses by 15%",
                "description": f"Trim annual spend to {format_inr_compact(initial_annual_expense * 0.85)}/yr",
                "corpus": total_corpus,
                "expense": initial_annual_expense * 0.85,
                "weights": (eq_w, fi_w, prop_w),
                "lifestyle_inf": common_sim_kwargs["lifestyle_inflation_rate"],
            },
            {
                "name": "No Extra Lifestyle Creep (0%)",
                "description": "Grow expenses only with regular inflation",
                "corpus": total_corpus,
                "expense": initial_annual_expense,
                "weights": (eq_w, fi_w, prop_w),
                "lifestyle_inf": 0.0,
            },
            {
                "name": "Add +20% More Savings",
                "description": f"Build total savings to {format_inr_compact(total_corpus * 1.20)}",
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
                    "success_rate_pct": st["success_probability_pct"],
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
        best_r: int | None = None,
        max_search_years: int = 0,
        retire_today_success_pct: float | None = None,
        selected_r: int | None = None,
    ) -> dict[str, Any]:
        success_pct = longevity_stats["success_probability_pct"]
        p10_yrs = longevity_stats["percentiles_years"]["p10"]
        p50_yrs = longevity_stats["percentiles_years"]["p50"]
        p10_age = longevity_stats["depletion_ages"]["p10"]
        p50_age = longevity_stats["depletion_ages"]["p50"]

        median_label = (
            f"past Age {life_expectancy}+"
            if p50_yrs >= max_sim_horizon - 0.5
            else f"until Age {p50_age:.0f}"
        )
        worst_label = (
            f"past Age {life_expectancy}+"
            if p10_yrs >= max_sim_horizon - 0.5
            else f"until Age {p10_age:.0f}"
        )

        eval_r = selected_r if selected_r is not None else (best_r if best_r is not None else max_search_years)
        eval_age = current_age + eval_r
        shortfall = max(0.0, required_drawable_corpus - initial_drawable_corpus)

        # Case A: No active job/business income (max_search_years == 0)
        # Do NOT suggest "you can retire today" — focus purely on how long wealth lasts.
        if max_search_years <= 0:
            if success_pct >= TARGET_RETIREMENT_SUCCESS_RATE_PCT:
                status = "retire_ready"
                badge = f"Strong Financial Outlook — {success_pct:.1f}% Success Rate"
                headline = (
                    f"Your wealth lasts {median_label} in the median case and {worst_label} in the worst case."
                )
                recommendation = (
                    f"Your portfolio has a {success_pct:.1f}% success rate of sustaining your expenses "
                    f"all the way through Age {life_expectancy} (above the 85% target)."
                )
            elif success_pct >= 65.0:
                status = "borderline"
                badge = f"Moderate Financial Outlook — {success_pct:.1f}% Success Rate"
                headline = (
                    f"Your wealth lasts {median_label} in the median case and {worst_label} in the worst case."
                )
                recommendation = (
                    f"Your savings sustain past Age {life_expectancy} in a typical market cycle ({success_pct:.1f}% success rate), "
                    f"though severe market crashes can deplete funds {worst_label}. "
                    f"Accessible savings of ~{format_inr_compact(required_drawable_corpus)} would reach the 85% target."
                )
            elif success_pct >= 35.0:
                status = "at_risk"
                badge = f"Watchful Financial Outlook — {success_pct:.1f}% Success Rate"
                headline = (
                    f"Your wealth lasts {median_label} in the median case and {worst_label} in the worst case."
                )
                recommendation = (
                    f"Your portfolio has a {success_pct:.1f}% success rate of lasting through Age {life_expectancy}. "
                    f"Holding ~{format_inr_compact(required_drawable_corpus)} in accessible savings or moderating annual expenses would reach the 85% target."
                )
            else:
                status = "shortfall"
                badge = f"Constrained Financial Outlook — {success_pct:.1f}% Success Rate"
                headline = (
                    f"Your wealth is projected to last {median_label} in the median case and {worst_label} in the worst case."
                )
                recommendation = (
                    f"With a {success_pct:.1f}% success rate of reaching Age {life_expectancy}, "
                    f"approximately {format_inr_compact(shortfall)} more in accessible savings "
                    f"(target ~{format_inr_compact(required_drawable_corpus)}) or lower annual expenses would be needed to sustain through Age {life_expectancy}."
                )
        # Case B: User has active job/business income (max_search_years > 0)
        elif selected_r is not None and best_r is not None and selected_r < best_r:
            rec_age = current_age + best_r
            status = "borderline" if success_pct >= 65.0 else ("at_risk" if success_pct >= 35.0 else "shortfall")
            badge = f"Inspecting Earlier Retirement at Age {eval_age} ({success_pct:.1f}% Success Rate)"
            headline = (
                f"If you retire earlier at Age {eval_age} (instead of suggested Age {rec_age}), "
                f"your wealth lasts {median_label} in the median case with a {success_pct:.1f}% success rate."
            )
            recommendation = (
                f"In the worst case, retiring at Age {eval_age} means your wealth lasts {worst_label}. "
                f"Working until suggested Age {rec_age} raises your success rate past the 85% target."
            )
        elif best_r == 0 and eval_r == 0:
            status = "retire_ready"
            badge = f"Suggested Retirement Age: Age {eval_age} (Retire Now)"
            headline = (
                f"You can retire today at Age {eval_age}! Your wealth lasts {median_label} in the median case "
                f"with a {success_pct:.1f}% success rate of lasting until Age {life_expectancy}."
            )
            recommendation = (
                f"You have already crossed the 85% success rate target. Even in the worst case, "
                f"your money lasts {worst_label}."
            )
        elif best_r is not None and eval_r >= best_r:
            status = "retire_ready"
            today_sr = retire_today_success_pct if retire_today_success_pct is not None else 0.0
            badge = f"Suggested Retirement Age: Age {current_age + best_r} (in {best_r} {'Year' if best_r == 1 else 'Years'})"
            headline = (
                f"Retiring at Age {eval_age} gives you a "
                f"{success_pct:.1f}% success rate of your wealth lasting until Age {life_expectancy}."
            )
            recommendation = (
                f"If you retired today at Age {current_age}, your success rate would be {today_sr:.1f}%. "
                f"Continuing your income and SIPs until Age {eval_age} reaches the 85% target "
                f"(wealth lasts {median_label} in the median case and {worst_label} in the worst case)."
            )
        elif success_pct >= 65.0:
            status = "borderline"
            badge = f"Close to Target — {success_pct:.1f}% Success Rate at Age {eval_age}"
            headline = (
                f"At Age {eval_age}, your wealth lasts {median_label} in the median case with a "
                f"{success_pct:.1f}% success rate (target is 85%)."
            )
            recommendation = (
                f"In the median case your money comfortably outlasts Age {life_expectancy}, "
                f"but in the worst case your savings last {worst_label}. "
                f"Working a couple more years or building accessible savings toward {format_inr_compact(required_drawable_corpus)} will reach the 85% success rate."
            )
        elif success_pct >= 35.0:
            status = "at_risk"
            badge = f"Not Yet at 85% Target — {success_pct:.1f}% Success Rate at Age {eval_age}"
            headline = (
                f"At Age {eval_age}, your savings last {median_label} in the median case, "
                f"giving a {success_pct:.1f}% success rate of reaching Age {life_expectancy}."
            )
            recommendation = (
                f"In the worst case, funds last {worst_label}. "
                f"To hit the 85% success rate for Age {life_expectancy}, aim to extend your earning/SIP years or build savings closer to {format_inr_compact(required_drawable_corpus)}."
            )
        else:
            status = "shortfall"
            badge = f"More Saving Years Needed — {success_pct:.1f}% Success Rate at Age {eval_age}"
            headline = (
                f"At Age {eval_age}, your savings are projected to last {median_label} in the median case "
                f"with a {success_pct:.1f}% success rate (below the 85% target for Age {life_expectancy})."
            )
            recommendation = (
                f"You need approximately {format_inr_compact(shortfall)} more in savings "
                f"(target ~{format_inr_compact(required_drawable_corpus)}) or additional years of income and SIPs to reach an 85% success rate."
            )

        return {
            "status": status,
            "badge": badge,
            "headline": headline,
            "recommendation": recommendation,
            "median_longevity_label": median_label,
            "recommended_retirement_age": (current_age + best_r) if best_r is not None else None,
            "years_until_retirement": best_r,
            "evaluated_retirement_age": eval_age,
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
                "Calculate the exact age and savings level at which you no longer need "
                "new monthly investments to hit your target retirement number."
            ),
            category="Accumulation & Transition",
            status="coming_soon",
            icon="sailboat",
            tags=["Coast FIRE", "SIP Step-Down", "Compounding"],
        )
    )
    registry.register_planned(
        SimulatorMetadata(
            id="three_bucket_decumulation",
            title="3-Bucket Retirement Cashflow Optimizer",
            subtitle="Protect against early market crashes",
            description=(
                "Design an optimal Cash (Bucket 1), Fixed Deposit/Debt (Bucket 2), "
                "and Equity (Bucket 3) refill strategy."
            ),
            category="Decumulation Strategy",
            status="coming_soon",
            icon="layers",
            tags=["Bucket Strategy", "Crash Protection", "SWP"],
        )
    )
    registry.register_planned(
        SimulatorMetadata(
            id="goal_sip_glidepath",
            title="Multi-Goal SIP & Glidepath Simulator",
            subtitle="Plan family goals and retirement together",
            description=(
                "Simulate big family milestones (education, marriage, home upgrades) "
                "alongside core retirement savings."
            ),
            category="Holistic Planning",
            status="coming_soon",
            icon="target",
            tags=["Goal Planning", "Family Milestones", "Glidepath"],
        )
    )


register_all_simulators()
