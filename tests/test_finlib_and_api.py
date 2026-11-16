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
    assert r1["simulation_meta"]["historical_data_period"] == "2006–2025 (Last 20 Years)"
    assert len(r1["sample_paths"]) == 40
    assert len(r1["notable_runs"]) == 6

    # Verify chart_events contains the known future expenses at Age 42 (38+4) and Age 46 (38+8)
    assert 42 in r1["chart_events"]["known_expense_ages"]
    assert 46 in r1["chart_events"]["known_expense_ages"]

    # Verify year_log in notable_runs has inflation_pct, lifestyle_inflation_pct, rebalance_activity, and special_events
    median_run = next(r for r in r1["notable_runs"] if r["label"].startswith("P50"))
    yr2 = median_run["year_log"][1]  # Year 2 (sim_year=2) -> Rebalance year!
    assert "inflation_pct" in yr2
    assert "lifestyle_inflation_pct" in yr2
    assert "rebalance_activity" in yr2
    assert "withdrawal_source_summary" in yr2
    assert "special_events_summary" in yr2
    assert yr2["sampled_india_year"] >= 2006 and yr2["sampled_india_year"] <= 2025

    # Year 4 (index 3) should contain Higher Education in special_events_summary
    if len(median_run["year_log"]) >= 4:
        yr4 = median_run["year_log"][3]
        assert "Higher Education" in yr4["special_events_summary"]


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


