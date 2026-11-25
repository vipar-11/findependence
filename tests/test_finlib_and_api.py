"""
Comprehensive unit and integration test suite for FinLib, Wealth Longevity Simulator,
Bank Statement Expense Analyzer (Runtime Schema Discovery + System 1 Model),
and Module Lifecycle Registry.
"""

from __future__ import annotations

import csv
import io
from typing import Any
import numpy as np
import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.main import app
from finlib.analyzers.statement_parser import discover_statement_schema_and_extract
from finlib.analyzers.system1_classifier import classify_transaction_system1
from finlib.core.engine import BaseSimulator, SimulatorMetadata, SimulatorRegistry
from finlib.core.finance import (
    compute_longevity_stats,
    compute_trajectory_percentiles,
    fisher_real_return,
    format_inr,
    format_inr_compact,
    project_expenses,
    simulate_portfolio_paths,
)
from finlib.data.indian_market_history import (
    INDIAN_MARKET_ANNUAL_DATA,
    get_historical_arrays,
    get_market_summary_statistics,
)

client = TestClient(app)


def test_indian_currency_formatting() -> None:
    assert format_inr(100000) == "₹1,00,000"
    assert format_inr(35000000) == "₹3,50,00,000"
    assert format_inr_compact(35000000) == "₹3.50 Cr"
    assert format_inr_compact(150000) == "₹1.50 L"


def test_fisher_real_return() -> None:
    r_real = fisher_real_return(0.1236, 0.06)
    assert pytest.approx(r_real, rel=1e-4) == 0.06


def test_indian_historical_dataset_integrity() -> None:
    assert len(INDIAN_MARKET_ANNUAL_DATA) == 20
    arrays = get_historical_arrays()
    assert arrays["years"][0] == 2006
    assert arrays["years"][-1] == 2025
    stats = get_market_summary_statistics()
    assert "equity" in stats["asset_statistics"]
    assert "fixed_income" in stats["asset_statistics"]
    assert "property" in stats["asset_statistics"]
    assert "cpi" in stats["asset_statistics"]
    assert stats["asset_statistics"]["equity"]["cagr"] > stats["asset_statistics"]["fixed_income"]["cagr"]


def test_project_expenses_with_lifestyle_creep() -> None:
    inf = np.full((2, 5), 0.06)
    expenses, cpi = project_expenses(
        initial_annual_expense=12_00_000.0,
        horizon_years=5,
        inflation_rates=inf,
        lifestyle_inflation_rate=0.01,
        post_retirement_multiplier=1.0,
    )
    assert expenses.shape == (2, 5)
    assert cpi.shape == (2, 6)
    expected_yr1 = 12_00_000.0 * 1.06 * 1.01
    assert pytest.approx(expenses[0, 1], rel=1e-5) == expected_yr1


def test_portfolio_drawdown_and_longevity_ordering() -> None:
    n_paths, horizon = 50, 40
    eq = np.full((n_paths, horizon), 0.11)
    fi = np.full((n_paths, horizon), 0.07)
    prop = np.full((n_paths, horizon), 0.06)
    cpi = np.full((n_paths, horizon), 0.06)

    low_corpus_out = simulate_portfolio_paths(
        total_corpus=50_00_000.0,
        equity_weight=0.6,
        fixed_income_weight=0.4,
        property_weight=0.0,
        initial_annual_expense=12_00_000.0,
        equity_returns=eq,
        fixed_income_returns=fi,
        property_returns=prop,
        inflation_rates=cpi,
    )
    high_corpus_out = simulate_portfolio_paths(
        total_corpus=5_00_00_000.0,
        equity_weight=0.6,
        fixed_income_weight=0.4,
        property_weight=0.0,
        initial_annual_expense=12_00_000.0,
        equity_returns=eq,
        fixed_income_returns=fi,
        property_returns=prop,
        inflation_rates=cpi,
    )
    low_stats = compute_longevity_stats(low_corpus_out["years_lasted"], current_age=40, target_horizon=40)
    high_stats = compute_longevity_stats(high_corpus_out["years_lasted"], current_age=40, target_horizon=40)

    assert low_stats["percentiles_years"]["p50"] < 10.0
    assert high_stats["percentiles_years"]["p50"] == 40.0
    assert high_stats["success_probability_pct"] == 100.0

    traj = compute_trajectory_percentiles(high_corpus_out["drawable_real"], current_age=40)
    assert len(traj["ages"]) == 41


def test_pluggable_simulator_registry_and_retirement_lifecycle() -> None:
    custom_reg = SimulatorRegistry()

    class DummySipSimulator(BaseSimulator):
        metadata = SimulatorMetadata(
            id="dummy_sip",
            title="Dummy SIP Simulator",
            subtitle="Test pluggability",
            description="Test",
            category="Testing",
        )

        def get_default_params(self) -> dict[str, Any]:
            return {"monthly_sip": 50000}

        def run(self, params: dict[str, Any]) -> dict[str, Any]:
            return {"projected": params.get("monthly_sip", 50000) * 12}

    custom_reg.register(DummySipSimulator())
    assert len(custom_reg.list_active()) == 1
    out = custom_reg.get("dummy_sip").run({"monthly_sip": 10000})
    assert out["projected"] == 120000

    # Retire the module -> hidden from list_active() and raises KeyError on get()
    custom_reg.retire("dummy_sip")
    assert len(custom_reg.list_active()) == 0
    with pytest.raises(KeyError):
        custom_reg.get("dummy_sip")

    # Re-activate the module
    custom_reg.activate("dummy_sip")
    assert len(custom_reg.list_active()) == 1


def test_system1_decision_model_classification() -> None:
    assert classify_transaction_system1("UPI/SUPERMARKET GROCERY STORE", 1450.0)["category_id"] == "groceries"
    assert classify_transaction_system1("BBPS/ELECTRICITY UTILITY BILL", 2900.0)["category_id"] == "utilities"
    assert classify_transaction_system1("UPI/LANDLORD HOUSE RENT OCT", 35000.0)["category_id"] == "rent"
    assert classify_transaction_system1("ACH D- HOME LOAN EMI", 28500.0)["category_id"] == "emis"
    assert classify_transaction_system1("UPI/RESTAURANT FOOD ORDER", 650.0)["category_id"] == "dining"
    assert classify_transaction_system1("POS PETROL PUMP FUEL STATION", 3200.0)["category_id"] == "transport"
    assert classify_transaction_system1("UPI/ONLINE SHOPPING APPAREL", 4999.0)["category_id"] == "shopping"
    assert classify_transaction_system1("UPI/PHARMACY MEDICINES", 820.0)["category_id"] == "healthcare"
    assert classify_transaction_system1("SI-STREAMING SUBSCRIPTION", 649.0)["category_id"] == "subscriptions"

    inv = classify_transaction_system1("ACH D- CLEARING CORP MUTUAL FUND SIP", 25000.0)
    assert inv["category_id"] == "investments"
    assert inv["is_living_expense"] is False


def test_runtime_statement_schema_discovery_multiple_formats() -> None:
    # Format 1: Single Amount column + Dr/Cr column
    rows_drcr = [
        ["Statement Summary for Account 00001", "", "", "", ""],
        ["Tran Date", "Particulars", "Amount (INR)", "Dr/Cr", "Balance"],
        ["2026-09-02", "NEFT SALARY CREDIT", "1,80,000.00", "CR", "3,20,000.00"],
        ["2026-09-03", "UPI/MONTHLY HOUSE RENT", "30,000.00", "DR", "2,90,000.00"],
        ["2026-09-07", "POS SUPERMARKET GROCERIES", "5,200.00", "Debit", "2,84,800.00"],
    ]
    res1 = discover_statement_schema_and_extract(rows_drcr)
    assert res1["discovered_schema"]["layout_mode"] == "amount_with_drcr_column"
    assert res1["discovered_schema"]["skipped_credit_rows"] == 1
    assert len(res1["transactions"]) == 2
    assert res1["transactions"][0]["amount"] == 30000.0
    assert res1["transactions"][1]["amount"] == 5200.0

    # Format 2: Custom spreadsheet with signed amounts & Dr suffix
    rows_signed = [
        ["Date", "Merchant / Memo", "Txn Amount"],
        ["12-10-2026", "Restaurant Dinner", "1,250.00 Dr"],
        ["15-10-2026", "Electricity Power Bill", "-2,400.00"],
        ["18-10-2026", "Interest Credit", "450.00 Cr"],
    ]
    res2 = discover_statement_schema_and_extract(rows_signed)
    assert len(res2["transactions"]) == 2
    assert res2["transactions"][0]["amount"] == 1250.0
    assert res2["transactions"][1]["amount"] == 2400.0


def test_expense_analyzer_upload_excel_and_csv_endpoints() -> None:
    rows = [
        ["Txn Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
        ["02/09/2026", "UPI/MONTHLY HOUSE RENT", "30,000.00", "", "2,50,000.00"],
        ["05/09/2026", "ACH D- HOME LOAN EMI", "28,500.00", "", "2,21,500.00"],
        ["05/09/2026", "ACH D- MUTUAL FUND SIP", "25,000.00", "", "1,96,500.00"],
        ["08/09/2026", "BBPS/ELECTRICITY POWER BILL", "3,000.00", "", "1,93,500.00"],
        ["10/09/2026", "POS SUPERMARKET GROCERY", "6,500.00", "", "1,87,000.00"],
        ["14/09/2026", "UPI/RESTAURANT DINING", "2,000.00", "", "1,85,000.00"],
    ]

    # 1. Test uploading an .xlsx file via multipart form upload
    wb = openpyxl.Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    xlsx_buf = io.BytesIO()
    wb.save(xlsx_buf)
    xlsx_bytes = xlsx_buf.getvalue()

    r_xlsx = client.post(
        "/api/v1/analyzers/expense-analyzer/upload",
        files={
            "file": (
                "statement.xlsx",
                io.BytesIO(xlsx_bytes),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        data={"include_emis_in_expenses": "true", "include_investments_in_expenses": "false"},
    )
    assert r_xlsx.status_code == 200
    xlsx_res = r_xlsx.json()
    assert xlsx_res["summary"]["num_months_detected"] == 1
    assert xlsx_res["summary"]["estimated_monthly_expense"] == 70000.0
    cat_ids = {c["category_id"] for c in xlsx_res["category_breakdown"]}
    assert {"groceries", "utilities", "rent", "emis", "dining", "investments"}.issubset(cat_ids)

    # 2. Test uploading a .csv file via multipart form upload
    csv_buf = io.StringIO()
    writer = csv.writer(csv_buf)
    writer.writerows(rows)
    csv_bytes = csv_buf.getvalue().encode("utf-8")

    r_csv = client.post(
        "/api/v1/analyzers/expense-analyzer/upload",
        files={"file": ("statement.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"include_emis_in_expenses": "false", "include_investments_in_expenses": "false"},
    )
    assert r_csv.status_code == 200
    csv_res = r_csv.json()
    # When EMIs (₹28,500/mo) are excluded, monthly expense drops by exactly ₹28,500
    assert csv_res["summary"]["estimated_monthly_expense"] == pytest.approx(
        xlsx_res["summary"]["estimated_monthly_expense"] - 28500.0, abs=5
    )


def test_random_historical_sampling_and_api_endpoints() -> None:
    r_health = client.get("/api/v1/health")
    assert r_health.status_code == 200
    assert r_health.json()["active_simulators"] >= 2

    payload = {
        "current_age": 38,
        "life_expectancy": 90,
        "has_medical_insurance": True,
        "total_corpus": 35000000,
        "equity_pct": 55,
        "fixed_income_pct": 30,
        "property_pct": 15,
        "expense_amount": 100000,
        "expense_frequency": "monthly",
        "fixed_income_tax_rate": 30.0,
        "equity_tax_rate": 12.5,
        "rebalance_enabled": True,
        "rebalance_frequency_years": 2,
        "home_improvement_enabled": True,
        "home_improvement_interval_years": 5,
        "home_improvement_pct_of_property": 3.0,
        "home_improvement_variance_pct": 1.0,
        "random_expense_enabled": True,
        "random_expense_base_inr": 200000,
        "random_expense_variance_pct": 25.0,
        "random_expense_annual_probability_pct": 20.0,
        "known_future_expenses": [
            {"years_from_now": 4, "amount_today_inr": 2500000, "event_tag": "Higher Education"},
            {"years_from_now": 8, "amount_today_inr": 3500000, "event_tag": "Marriage"},
        ],
        "num_simulations": 500,
    }
    r1 = client.post("/api/v1/simulators/wealth-longevity/run", json=payload).json()
    r2 = client.post("/api/v1/simulators/wealth-longevity/run", json=payload).json()

    assert r1["simulation_meta"]["seed_used"] != r2["simulation_meta"]["seed_used"]
    assert "Last 20 Years" in r1["simulation_meta"]["historical_data_period"]
    assert len(r1["sample_paths"]) == 40
    assert len(r1["notable_runs"]) == 6
    assert r1["notable_runs"][0]["case_key"] == "p50"
    assert r1["notable_runs"][1]["case_key"] == "p10"
    assert "Worst Case" in r1["notable_runs"][1]["label"]
    # Verify that when job_monthly_income is 0 (already retired), all future ages are identical / no future age is recommended
    assert len(r1["retirement_readiness"]["candidate_retirement_ages"]) == 1
    assert r1["retirement_readiness"]["evaluated_retirement_age"] == 38
    assert r1["retirement_readiness"]["evaluated_retire_in_years"] == 0
    assert "retire today" not in r1["verdict"]["headline"].lower()
    assert r1["verdict"]["badge"] in ("Strong", "Action Required")
    assert "events_by_age_p50" in r1["chart_events"]
    assert "events_by_age_p10" in r1["chart_events"]

    # Verify chart_events contains the known future expenses at Age 42 (38+4) and Age 46 (38+8)
    assert 42 in r1["chart_events"]["known_expense_ages"]
    assert 46 in r1["chart_events"]["known_expense_ages"]

    # Verify year_log in notable_runs has inflation_pct, combined_events_summary, and rebalance_activity
    median_run = r1["notable_runs"][0]
    yr2 = median_run["year_log"][1]  # Year 2 (sim_year=2) -> Rebalance year!
    assert "inflation_pct" in yr2
    assert "combined_events_summary" in yr2
    assert "rebalance_activity" in yr2
    assert "withdrawal_source_summary" in yr2
    assert "special_events_summary" in yr2

    # Year 4 (index 3) should contain Higher Education in combined_events_summary
    if len(median_run["year_log"]) >= 4:
        yr4 = median_run["year_log"][3]
        assert "Higher Education" in yr4["combined_events_summary"]

    # Test "When Can I Retire?" iterative search across job_income_years (starting < 85% and reaching >= 85%)
    payload_new = {
        "current_age": 38,
        "life_expectancy": 90,
        "has_medical_insurance": False,
        "equity_value": 26000000,
        "fixed_income_value": 8000000,
        "real_estate_value": 3000000,
        "cash_value": 1000000,
        "job_monthly_income": 350000,
        "job_income_until_age": 44,
        "job_income_growth_range": "8-12%",
        "rental_monthly_income": 20000,
        "other_passive_monthly_income": 10000,
        "passive_income_inflation_interval_years": 2,
        "equity_sip_monthly": 80000,
        "equity_sip_stepup_pct": 10.0,
        "fixed_income_sip_monthly": 30000,
        "fixed_income_sip_stepup_pct": 5.0,
        "expense_amount": 100000,
        "expense_variance_pct": 10.0,
        "tax_drag_rate": 10.0,
        "known_future_expenses": [
            {
                "event_tag": "Home Improvement",
                "amount_today_inr": 500000,
                "is_recurring": True,
                "start_age": 43,
                "end_age": None,
                "every_n_years": 5,
                "variance_pct": 15.0,
            },
            {
                "event_tag": "Vehicle",
                "amount_today_inr": 1000000,
                "is_recurring": False,
                "start_age": 42,
                "variance_pct": 10.0,
            },
        ],
        "num_simulations": 200,
        "seed": 42,
    }
    r_new = client.post("/api/v1/simulators/wealth-longevity/run", json=payload_new)
    assert r_new.status_code == 200
    d_new = r_new.json()
    assert d_new["inputs_summary"]["total_corpus"] == 38000000.0
    assert d_new["inputs_summary"]["random_expense_base_inr"] == 500000.0
    assert d_new["inputs_summary"]["tax_drag_rate"] == 10.0
    assert len(d_new["retirement_readiness"]["candidate_retirement_ages"]) == 7
    assert d_new["retirement_readiness"]["can_retire_at_age"] is not None
    assert d_new["retirement_readiness"]["can_retire_at_age"] >= 38
    outcomes_by_age = d_new["retirement_readiness"]["outcomes_by_age"]
    assert "38" in outcomes_by_age
    assert "40" in outcomes_by_age
    # Apples-to-apples check: retiring later at Age 40 has higher or equal median longevity than retiring at Age 38
    assert (
        outcomes_by_age["40"]["longevity_stats"]["percentiles_years"]["p50"]
        >= outcomes_by_age["38"]["longevity_stats"]["percentiles_years"]["p50"]
    )
    # Verify year_log in notable_runs has liquid corpus reconciliation fields and job income stops at candidate retirement age
    age40_log = outcomes_by_age["40"]["notable_runs"][0]["year_log"]
    # Retiring at Age 40 (r=2): job_income is > 0 at Age 38 & Age 39, and 0 from Age 40 onwards, while rental/passive income continues!
    assert age40_log[0]["job_income"] > 0
    assert age40_log[1]["job_income"] > 0
    assert age40_log[2]["job_income"] == 0
    assert age40_log[2]["rental_income"] > 0
    assert age40_log[2]["passive_income"] > 0
    # Verify exact Starting Liquid Corpus -> Ending Liquid Corpus math reconciliation
    # Note: outflows_total now includes Tax Drag (expenses + SIPs + tax_drag)
    row0 = age40_log[0]
    expected_end_liq = (
        row0["start_liquid_corpus"]
        + row0["inflows_total"]
        - row0["outflows_total"]
        + row0["sip_contributed"]
        + row0["property_liquidated_inflow"]
        + row0["capital_gains_nominal"]
    )
    assert pytest.approx(row0["end_liquid_corpus"], abs=5.0) == expected_end_liq
    assert "Start Liquid Corpus:" in row0["math_explanation"]
    assert "Ending Liquid Corpus:" in row0["math_explanation"]


def test_fixed_income_first_withdrawal_and_taxable_rebalancing() -> None:
    n_paths, horizon = 4, 6
    eq = np.full((n_paths, horizon), 0.15)
    fi = np.full((n_paths, horizon), 0.06)
    prop = np.full((n_paths, horizon), 0.05)
    cpi = np.full((n_paths, horizon), 0.06)

    out = simulate_portfolio_paths(
        total_corpus=2_00_00_000.0,
        equity_weight=0.50,
        fixed_income_weight=0.50,
        property_weight=0.0,
        initial_annual_expense=10_00_000.0,
        equity_returns=eq,
        fixed_income_returns=fi,
        property_returns=prop,
        inflation_rates=cpi,
        fixed_income_tax_rate=0.30,
        equity_tax_rate=0.125,
        rebalance_enabled=True,
        rebalance_frequency_years=2,
        home_improvement_enabled=False,
        random_expense_enabled=False,
        known_future_expenses=[{"years_from_now": 3, "amount_today_inr": 15_00_000.0, "event_tag": "Marriage"}],
    )

    # Year 1 (index 0): Fixed income has plenty of funds (~1.06 Cr), so withdrawal is 100% from Fixed Income
    # Gross withdrawal from Fixed Income = 10,00,000 / (1 - 0.30) = 14,28,571.43
    assert pytest.approx(out["withdrawn_from_fi_gross"][0, 0], rel=1e-4) == 10_00_000.0 / 0.70
    assert out["withdrawn_from_eq_gross"][0, 0] == 0.0

    # Year 1 (index 0) is not a rebalance year (frequency=2), Year 2 (index 1) IS a rebalance year
    assert out["rebalance_direction"][0, 0] == 0
    assert out["rebalance_direction"][0, 1] == 1  # Sold overweight Equity -> Bought Fixed Income
    assert out["rebalance_tax_paid"][0, 1] > 0.0

    # Year 3 (index 2) has Known Future Expense ("Marriage") inflated by 2 years of 6% CPI
    assert pytest.approx(out["known_expense_incurred"][0, 2], rel=1e-4) == 15_00_000.0 * (1.06**2)


def test_bank_first_waterfall_cash_reserve_and_sip_never_redeems() -> None:
    """Verify:
    1) Inflows go to bank (cash) first.
    2) Outflows are paid from bank without dipping below inflation-adjusted initial cash reserve.
    3) Larger outflows redeem Fixed Income first, then Equity.
    4) SIPs are NEVER funded by redeeming FI/Equity; they are reduced/paused if bank lacks excess cash.
    """
    n_paths, horizon = 2, 3
    eq = np.full((n_paths, horizon), 0.10)
    fi = np.full((n_paths, horizon), 0.06)
    prop = np.full((n_paths, horizon), 0.05)
    cpi = np.full((n_paths, horizon), 0.06)

    # Case A: No income, 10L cash reserve, 12L expense, 6L scheduled SIP
    # Bank starts at 10L (= reserve), so expenses cannot dip below reserve -> 12L redeemed from FI.
    # Remaining bank above reserve is 0 -> SIP MUST be paused (0), NOT redeemed from FI/Equity!
    out_paused = simulate_portfolio_paths(
        total_corpus=1_10_00_000.0,
        equity_weight=50 / 110,
        fixed_income_weight=50 / 110,
        property_weight=0.0,
        cash_weight=10 / 110,
        initial_annual_expense=12_00_000.0,
        equity_returns=eq,
        fixed_income_returns=fi,
        property_returns=prop,
        inflation_rates=cpi,
        equity_sip_annual=6_00_000.0,
        sip_duration_years=3,
        fixed_income_tax_rate=0.10,
        equity_tax_rate=0.10,
        rebalance_enabled=False,
        home_improvement_enabled=False,
        random_expense_enabled=False,
    )
    assert out_paused["total_sip_nominal"][0, 0] == 0.0
    assert out_paused["withdrawn_from_fi_gross"][0, 0] > 0.0
    assert out_paused["withdrawn_from_eq_gross"][0, 0] == 0.0

    # Case B: 15L job income, 10L cash reserve, 12L expense, 6L scheduled SIP
    # Bank receives 15L -> 25L; pays 12L expense from bank (leaves 13L >= 10L reserve) -> 0 redemption!
    # Excess bank cash above 10L reserve = 3L -> SIP is reduced from 6L to 3L (never redeems FI/Eq!).
    out_reduced = simulate_portfolio_paths(
        total_corpus=1_10_00_000.0,
        equity_weight=50 / 110,
        fixed_income_weight=50 / 110,
        property_weight=0.0,
        cash_weight=10 / 110,
        initial_annual_expense=12_00_000.0,
        equity_returns=eq,
        fixed_income_returns=fi,
        property_returns=prop,
        inflation_rates=cpi,
        job_annual_income=15_00_000.0,  # 15L/yr
        job_income_years=3,
        equity_sip_annual=6_00_000.0,  # 6L/yr scheduled
        sip_duration_years=3,
        fixed_income_tax_rate=0.10,
        equity_tax_rate=0.10,
        rebalance_enabled=False,
        home_improvement_enabled=False,
        random_expense_enabled=False,
    )
    assert out_reduced["withdrawn_from_fi_gross"][0, 0] == 0.0
    assert out_reduced["withdrawn_from_eq_gross"][0, 0] == 0.0
    assert pytest.approx(out_reduced["total_sip_nominal"][0, 0], abs=1.0) == 3_00_000.0


def test_self_contained_static_css_and_js_no_external_cdns() -> None:
    r_index = client.get("/")
    assert r_index.status_code == 200
    html_text = r_index.text
    assert "cdn.tailwindcss.com" not in html_text
    assert "cdn.jsdelivr.net" not in html_text
    assert "/static/css/styles.css" in html_text
    assert "/static/js/chart.js" in html_text

    r_css = client.get("/static/css/styles.css")
    assert r_css.status_code == 200
    assert ".hidden { display: none !important; }" in r_css.text

    r_chart = client.get("/static/js/chart.js")
    assert r_chart.status_code == 200
    assert "LocalChart" in r_chart.text


def test_complete_api_routes_and_error_branches(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    from finlib.core.engine import registry

    # 1. List simulators & market data endpoints
    r_mods = client.get("/api/v1/modules?include_retired=true")
    assert r_mods.status_code == 200
    assert "simulators" in r_mods.json()

    r_mkt = client.get("/api/v1/market-data/india")
    assert r_mkt.status_code == 200
    assert r_mkt.json()["num_years"] == 20

    # 2. Retire and activate module routes (valid & 404 invalid)
    r_ret_404 = client.post("/api/v1/modules/unknown_mod/retire")
    assert r_ret_404.status_code == 404
    r_act_404 = client.post("/api/v1/modules/unknown_mod/activate")
    assert r_act_404.status_code == 404

    r_ret = client.post("/api/v1/modules/wealth_longevity/retire")
    assert r_ret.status_code == 200
    assert r_ret.json()["status"] == "retired"

    # Running retired wealth_longevity returns 404
    r_wl_404 = client.post("/api/v1/simulators/wealth-longevity/run", json={})
    assert r_wl_404.status_code == 404
    r_gen_404 = client.post("/api/v1/simulators/wealth_longevity/run", json={"params": {}})
    assert r_gen_404.status_code == 404

    # Re-activate wealth_longevity
    r_act = client.post("/api/v1/modules/wealth_longevity/activate")
    assert r_act.status_code == 200
    assert r_act.json()["status"] == "active"

    # Generic simulator run for wealth_longevity & expense_analyzer
    r_gen_wl = client.post(
        "/api/v1/simulators/wealth_longevity/run",
        json={"params": {"current_age": 40, "life_expectancy": 85, "num_simulations": 100}},
    )
    assert r_gen_wl.status_code == 200

    r_gen_exp = client.post(
        "/api/v1/simulators/expense_analyzer/run",
        json={
            "params": {
                "raw_rows": [
                    ["Date", "Narration", "Debit"],
                    ["2026-09-01", "UPI/GROCERY SUPERMARKET", "1500"],
                ]
            }
        },
    )
    assert r_gen_exp.status_code == 200

    # 3. Upload error branches (retired analyzer, empty file, no debits, corrupt xlsx, wrong analyzer instance)
    client.post("/api/v1/modules/expense_analyzer/retire")
    r_up_ret = client.post(
        "/api/v1/analyzers/expense-analyzer/upload",
        files={"file": ("s.csv", io.BytesIO(b"a,b\n1,2"), "text/csv")},
    )
    assert r_up_ret.status_code == 404
    client.post("/api/v1/modules/expense_analyzer/activate")

    r_up_empty = client.post(
        "/api/v1/analyzers/expense-analyzer/upload",
        files={"file": ("empty.csv", io.BytesIO(b""), "text/csv")},
    )
    assert r_up_empty.status_code == 400

    r_up_nodebits = client.post(
        "/api/v1/analyzers/expense-analyzer/upload",
        files={
            "file": (
                "credits.csv",
                io.BytesIO(b"Date,Narration,Credit\n01/09/2026,NEFT SALARY CREDIT,100000\n"),
                "text/csv",
            )
        },
    )
    assert r_up_nodebits.status_code == 422

    r_up_corrupt = client.post(
        "/api/v1/analyzers/expense-analyzer/upload",
        files={"file": ("bad.xlsx", io.BytesIO(b"not-a-zip"), "application/octet-stream")},
    )
    assert r_up_corrupt.status_code == 400

    # Wrong analyzer instance registered
    orig_analyzer = registry.get("expense_analyzer")
    monkeypatch.setitem(registry._modules, "expense_analyzer", registry.get("wealth_longevity"))
    r_up_wrong = client.post(
        "/api/v1/analyzers/expense-analyzer/upload",
        files={"file": ("s.csv", io.BytesIO(b"a,b\n1,2"), "text/csv")},
    )
    assert r_up_wrong.status_code == 500
    monkeypatch.setitem(registry._modules, "expense_analyzer", orig_analyzer)

    # Missing index.html -> 404
    import app.main as main_mod

    monkeypatch.setattr(main_mod, "STATIC_DIR", tmp_path)
    r_no_idx = client.get("/")
    assert r_no_idx.status_code == 404


def test_schemas_and_engine_edge_cases() -> None:
    from app.schemas import WealthLongevityRequest
    from finlib.core.engine import (
        generate_historical_backtest_paths,
        generate_monte_carlo_paths,
    )
    from finlib.data.indian_market_history import _compute_cagr

    # Schema validation errors & occurrence helper
    from app.schemas import KnownFutureExpenseItem

    rec_item = KnownFutureExpenseItem(
        event_tag="Vacation",
        amount_today_inr=200000,
        is_recurring=True,
        start_year=2,
        end_year=10,
        every_n_years=2,
        variance_pct=15.0,
    )
    assert rec_item.get_occurrence_years() == [2, 4, 6, 8, 10]
    one_item = KnownFutureExpenseItem(event_tag="Car", amount_today_inr=1500000, is_recurring=False, years_from_now=5)
    assert one_item.get_occurrence_years() == [5]

    with pytest.raises(ValueError, match="life_expectancy"):
        WealthLongevityRequest(current_age=50, life_expectancy=53)
    with pytest.raises(ValueError, match="Asset allocation"):
        WealthLongevityRequest(equity_pct=50.0, fixed_income_pct=20.0, property_pct=10.0, cash_pct=5.0)
    zero_req = WealthLongevityRequest(equity_value=0, fixed_income_value=0, real_estate_value=0, cash_value=0)
    assert zero_req.total_corpus == 0.0
    assert zero_req.num_simulations == 2500

    # Registry edge cases on planned & unknown modules
    reg = SimulatorRegistry()
    reg.register_planned(
        SimulatorMetadata(
            id="planned_calc",
            title="Planned",
            subtitle="Sub",
            description="Desc",
            category="Cat",
            status="coming_soon",
        )
    )
    assert len(reg.list_all(include_retired=False)) == 1
    reg.retire("planned_calc")
    assert len(reg.list_all(include_retired=False)) == 0
    assert len(reg.list_all(include_retired=True)) == 1
    reg.activate("planned_calc")
    assert reg.get_status("planned_calc") == "active"

    # Clear status override to test direct metadata status fallback
    reg._status_overrides.clear()
    assert reg.get_status("planned_calc") == "coming_soon"

    with pytest.raises(KeyError):
        reg.retire("nope")
    with pytest.raises(KeyError):
        reg.activate("nope")
    with pytest.raises(KeyError):
        reg.get_status("nope")
    with pytest.raises(KeyError):
        reg.get("nope")

    # Monte Carlo sampling methods: parametric_correlated, block_bootstrap, and constant inflation
    mc_param = generate_monte_carlo_paths(
        horizon_years=10,
        num_simulations=50,
        sampling_method="parametric_correlated",
        base_inflation_override=0.06,
        use_historical_inflation_volatility=False,
        seed=42,
    )
    assert mc_param["equity"].shape == (50, 10)
    assert np.allclose(mc_param["cpi"], 0.06)

    mc_block = generate_monte_carlo_paths(
        horizon_years=10,
        num_simulations=50,
        sampling_method="block_bootstrap",
        block_size=3,
        seed=42,
    )
    assert mc_block["equity"].shape == (50, 10)

    hist_override = generate_historical_backtest_paths(horizon_years=10, base_inflation_override=0.06)
    assert hist_override["cpi"].shape == (20, 10)

    # CAGR edge cases
    assert _compute_cagr(np.array([])) == 0.0
    assert _compute_cagr(np.array([-1.5])) == 0.0


def test_finance_and_simulator_verdict_branches() -> None:
    from finlib.core.finance import compute_longevity_histogram
    from finlib.simulators.wealth_longevity import WealthLongevitySimulator

    assert format_inr(500) == "₹500"
    assert format_inr(-500) == "-₹500"
    assert format_inr_compact(2500) == "₹2.5 K"
    assert format_inr_compact(500) == "₹500"
    assert compute_longevity_histogram(np.array([]), horizon_years=30) == []

    # Test property modes, zero financial weights, uninsured medical shocks, and overweight FI rebalancing
    n_paths, horizon = 6, 6
    eq_low = np.full((n_paths, horizon), -0.25)
    fi_high = np.full((n_paths, horizon), 0.15)
    prop_ret = np.full((n_paths, horizon), 0.08)
    cpi = np.full((n_paths, horizon), 0.05)

    for p_mode in ("illiquid_excluded", "illiquid_with_rent", "rebalanced", "liquidate_fallback"):
        res = simulate_portfolio_paths(
            total_corpus=1_50_00_000.0,
            equity_weight=0.4,
            fixed_income_weight=0.4,
            property_weight=0.2,
            initial_annual_expense=18_00_000.0,
            equity_returns=eq_low,
            fixed_income_returns=fi_high,
            property_returns=prop_ret,
            inflation_rates=cpi,
            property_mode=p_mode,  # type: ignore[arg-type]
            has_medical_insurance=False,
            random_expense_enabled=False,
            rebalance_enabled=True,
            rebalance_frequency_years=1,
        )
        assert res["drawable_nominal"].shape == (n_paths, horizon + 1)

    # 100% property (zero financial weight)
    res_prop_only = simulate_portfolio_paths(
        total_corpus=1_00_00_000.0,
        equity_weight=0.0,
        fixed_income_weight=0.0,
        property_weight=1.0,
        initial_annual_expense=2_00_000.0,
        equity_returns=eq_low,
        fixed_income_returns=fi_high,
        property_returns=prop_ret,
        inflation_rates=cpi,
        property_mode="illiquid_with_rent",
        property_rental_yield=0.05,
    )
    assert res_prop_only["years_lasted"][0] == 0.0

    # Test WealthLongevitySimulator 6-scenario verdicts
    sim = WealthLongevitySimulator()
    stats_strong = {
        "success_probability_pct": 92.0,
        "percentiles_years": {"p10": 35.0, "p50": 55.0},
        "depletion_ages": {"p10": 75.0, "p50": 95.0},
    }
    stats_shortfall = {
        "success_probability_pct": 45.0,
        "percentiles_years": {"p10": 15.0, "p50": 32.0},
        "depletion_ages": {"p10": 55.0, "p50": 72.0},
    }
    common_v = dict(
        current_age=40,
        life_expectancy=85,
        target_horizon=45,
        max_sim_horizon=55,
        swr_on_drawable=3.5,
        benchmark_swr=3.2,
        required_drawable_corpus=4_00_00_000.0,
        initial_drawable_corpus=3_00_00_000.0,
    )
    # 1. Already retired, has enough wealth
    v1 = sim._build_verdict(longevity_stats=stats_strong, max_search_years=0, **common_v)
    assert v1["status"] == "strong" and v1["badge"] == "Strong"
    assert v1["headline"] == "Your retirement is well-funded"
    assert "stress-tested" in v1["recommendation"]

    # 2. Working, can retire immediately
    v2 = sim._build_verdict(longevity_stats=stats_strong, max_search_years=5, best_r=0, selected_r=0, **common_v)
    assert v2["status"] == "financial_freedom" and v2["badge"] == "Financial Freedom"
    assert v2["headline"] == "You have enough to retire today"

    # 3. Working, can retire early
    v3 = sim._build_verdict(longevity_stats=stats_strong, max_search_years=5, best_r=2, selected_r=2, **common_v)
    assert v3["status"] == "ahead_of_plan" and v3["badge"] == "Ahead of Plan"
    assert v3["headline"] == "You can retire 3 years early, at age 42"

    # 4. Working, on track for planned retirement
    v4 = sim._build_verdict(longevity_stats=stats_strong, max_search_years=5, best_r=5, selected_r=5, **common_v)
    assert v4["status"] == "on_track" and v4["badge"] == "On Track"
    assert v4["headline"] == "Stay the course until age 45"

    # 5. Working, shortfall at planned retirement
    v5 = sim._build_verdict(longevity_stats=stats_shortfall, max_search_years=5, best_r=None, selected_r=5, **common_v)
    assert v5["status"] == "needs_attention" and v5["badge"] == "Needs Attention"
    assert v5["headline"] == "Projected shortfall at age 45"

    # 6. Retired, wealth not likely to last
    v6 = sim._build_verdict(longevity_stats=stats_shortfall, max_search_years=0, **common_v)
    assert v6["status"] == "action_required" and v6["badge"] == "Action Required"
    assert v6["headline"] == "Your corpus faces an early depletion risk"

    # Chart event annotations fallback when notable_runs is empty
    ann = sim._build_chart_event_annotations(
        current_age=40,
        target_horizon=10,
        known_future_expenses=[],
        home_imp_enabled=False,
        home_imp_interval=5,
        home_imp_pct=0.03,
        home_imp_var=0.01,
        rebalance_enabled=True,
        rebalance_freq_years=2,
        notable_runs=[],
    )
    assert "42" in ann["events_by_age"]


def test_parser_and_system1_classifier_all_heuristics(monkeypatch: pytest.MonkeyPatch) -> None:
    from datetime import date, datetime
    import xlrd
    from finlib.analyzers.expense_analyzer import BankStatementExpenseAnalyzer
    from finlib.analyzers.statement_parser import (
        extract_raw_rows_from_file,
        np_isnan,
        try_parse_amount,
        try_parse_date,
    )

    # 1. System 1 Contextual Heuristics (3a, 3b, 3c, 3d, and fallback)
    assert classify_transaction_system1("ATM CASH WITHDRAWAL", 5000.0)["matched_cue"] == "ATM / Cash Withdrawal"
    rent_h = classify_transaction_system1(
        "NEFT TRANSFER TO OWNER", 25000.0, day_of_month=5, recurring_amount_count=2
    )
    assert rent_h["category_id"] == "rent"
    assert classify_transaction_system1("SI- AUTO DEBIT MANDATE", 5000.0)["category_id"] == "emis"
    assert classify_transaction_system1("SI- AUTO DEBIT MANDATE", 500.0)["category_id"] == "subscriptions"
    assert classify_transaction_system1("UPI/987654/TEA STALL", 120.0)["category_id"] == "groceries"
    assert classify_transaction_system1("IMPS/999111/MISC OUTFLOW", 1234.0)["category_id"] == "other"

    # 2. ExpenseAnalyzer with investments included & missing raw_rows error
    analyzer = BankStatementExpenseAnalyzer()
    with pytest.raises(ValueError, match="raw_rows"):
        analyzer.run({})
    res_inv = analyzer.analyze_rows(
        raw_rows=[
            ["Date", "Narration", "Debit"],
            ["2026-09-05", "ACH D- MUTUAL FUND SIP", "25000"],
        ],
        include_investments_in_expenses=True,
    )
    assert res_inv["summary"]["estimated_monthly_expense"] == 25000.0

    # 3. Date & Amount parser edge cases
    assert try_parse_date(None) is None
    assert try_parse_date(datetime(2026, 9, 1, 12, 0)) == date(2026, 9, 1)
    assert try_parse_date(date(2026, 9, 2)) == date(2026, 9, 2)
    assert try_parse_date(45200) == date(2023, 10, 1)
    assert try_parse_date("short") is None

    assert try_parse_amount(None) == (None, None)
    assert try_parse_amount(-450.0) == (450.0, "DR")
    assert try_parse_amount(float("nan")) == (None, None)
    assert try_parse_amount("123456789012") == (None, None)
    assert try_parse_amount("Rs. ") == (None, None)
    assert np_isnan(float("nan")) is True

    # 4. File extraction (.xls mock, latin-1 CSV, empty CSV, pipe delimiter fallback)
    class FakeCell:
        def __init__(self, ctype: int, value: Any) -> None:
            self.ctype = ctype
            self.value = value

    class FakeSheet:
        nrows = 2
        ncols = 2

        def cell(self, r: int, c: int) -> FakeCell:
            if r == 0:
                return FakeCell(1, "Date" if c == 0 else "Amount")
            return FakeCell(xlrd.XL_CELL_DATE if c == 0 else 2, 45200.0 if c == 0 else 1200.0)

    class FakeBook:
        nsheets = 1
        datemode = 0

        def sheet_by_index(self, idx: int) -> FakeSheet:
            return FakeSheet()

    monkeypatch.setattr(xlrd, "open_workbook", lambda file_contents: FakeBook())
    xls_rows = extract_raw_rows_from_file(b"fake-xls", "statement.xls")
    assert len(xls_rows) == 2

    assert extract_raw_rows_from_file(b"   \n  ", "empty.csv") == []
    latin1_rows = extract_raw_rows_from_file("Date|Narration|Amount\n01/09/2026|Café|250\n".encode("latin-1"), "s.csv")
    assert len(latin1_rows) == 2

    # 5. Schema discovery edge cases (empty rows, headerless grid, footer/summary rows, salary inflow skip)
    with pytest.raises(ValueError, match="no readable rows"):
        discover_statement_schema_and_extract([])
    with pytest.raises(ValueError, match="No transaction rows"):
        discover_statement_schema_and_extract([["Date", "Narration", "Withdrawal"]])
    with pytest.raises(ValueError, match="description/narration"):
        discover_statement_schema_and_extract([["Date"], ["01/09/2026"]])
    with pytest.raises(ValueError, match="numeric transaction amount"):
        discover_statement_schema_and_extract([["Date", "Narration"], ["01/09/2026", "Only text"]])

    headerless = [
        ["01/09/2026", "UPI/GROCERY STORE", "1200.00"],
        ["02/09/2026", "NEFT SALARY CREDIT", "95000.00"],
        ["03/09/2026", "Opening Balance", "50000.00"],
        ["04/09/2026", "**End of Statement**", "50000.00"],
        ["05/09/2026", "x", "100.00"],
        ["06/09/2026"],
    ]
    res_hl = discover_statement_schema_and_extract(headerless)
    assert res_hl["discovered_schema"]["header_row_number"] is None
    assert len(res_hl["transactions"]) == 1
    assert res_hl["discovered_schema"]["skipped_credit_rows"] == 1


def test_frontend_javascript_test_suite_and_coverage() -> None:
    import re
    import subprocess

    proc = subprocess.run(
        ["npm", "test"],
        capture_output=True,
        text=True,
        check=True,
    )
    output = proc.stdout + "\n" + proc.stderr
    for js_file in ("app/static/js/app.js", "app/static/js/chart.js"):
        match = re.search(
            rf"{re.escape(js_file)}\s+(\d+)\s+(\d+)\s+(\d+)%\s+([\d.]+)%",
            output,
        )
        assert match is not None, f"Coverage row not found for {js_file}:\n{output}"
        func_cov = float(match.group(3))
        line_cov = float(match.group(4))
        assert line_cov >= 95.0, f"{js_file} line coverage {line_cov}% < 95%"
        assert func_cov >= 95.0, f"{js_file} function coverage {func_cov}% < 95%"



