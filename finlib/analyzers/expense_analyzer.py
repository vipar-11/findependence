"""
Module #2: Bank Statement Monthly Expense & Category Analyzer.

Uses runtime format/column discovery (`statement_parser`) and a System 1 associative
decision model (`system1_classifier`) to estimate monthly household expenses and
category breakdowns from any uploaded bank statement (.xlsx, .xls, .csv, .tsv).
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from finlib.analyzers.statement_parser import (
    discover_statement_schema_and_extract,
    extract_raw_rows_from_file,
)
from finlib.analyzers.system1_classifier import (
    CATEGORIES,
    classify_transaction_system1,
)
from finlib.core.engine import BaseSimulator, SimulatorMetadata, registry
from finlib.core.finance import format_inr, format_inr_compact


class BankStatementExpenseAnalyzer(BaseSimulator):
    """Pluggable analyzer module for discovering monthly expenses from bank statements."""

    metadata = SimulatorMetadata(
        id="expense_analyzer",
        title="Monthly Expense Analyzer",
        subtitle="Upload Bank Statement (Excel / CSV) • System 1 Classifier",
        description=(
            "Automatically discovers columns in your bank statement at runtime and uses a "
            "System 1 associative decision model to classify every line into Groceries, "
            "Utilities, Rent, EMIs, Dining, Transport, and more."
        ),
        category="Cashflow & Expense Discovery",
        module_type="analyzer",
        status="active",
        icon="receipt",
        tags=["Bank Statement", "System 1 Model", "Excel / CSV", "Runtime Schema Discovery"],
    )

    def get_default_params(self) -> dict[str, Any]:
        return {
            "include_emis_in_expenses": True,
            "include_investments_in_expenses": False,
        }

    def analyze_file(
        self,
        file_bytes: bytes,
        filename: str,
        include_emis_in_expenses: bool = True,
        include_investments_in_expenses: bool = False,
    ) -> dict[str, Any]:
        """Parse an uploaded Excel/CSV bank statement file and classify all expense lines."""
        raw_rows = extract_raw_rows_from_file(file_bytes=file_bytes, filename=filename)
        return self.analyze_rows(
            raw_rows=raw_rows,
            filename=filename,
            include_emis_in_expenses=include_emis_in_expenses,
            include_investments_in_expenses=include_investments_in_expenses,
        )

    def analyze_rows(
        self,
        raw_rows: list[list[Any]],
        filename: str = "statement.csv",
        include_emis_in_expenses: bool = True,
        include_investments_in_expenses: bool = False,
    ) -> dict[str, Any]:
        """Discover schema at runtime, classify each line with System 1 model, and aggregate."""
        parsed = discover_statement_schema_and_extract(raw_rows)
        schema = parsed["discovered_schema"]
        txns = parsed["transactions"]

        if not txns:
            raise ValueError(
                "No debit/withdrawal transactions were found in the statement. "
                "Please verify the file has a transaction description and amount/withdrawal column."
            )

        # Count recurring exact amounts to help System 1 intuition on ambiguous transfers
        amt_counts = Counter(round(t["amount"], 0) for t in txns)

        classified_txns: list[dict[str, Any]] = []
        months_seen: set[str] = set()

        for t in txns:
            if t["month"] != "Unknown-Month":
                months_seen.add(t["month"])

            s1 = classify_transaction_system1(
                description=t["description"],
                amount=t["amount"],
                day_of_month=t["day"],
                recurring_amount_count=amt_counts[round(t["amount"], 0)],
            )
            cat_id = s1["category_id"]

            # Determine if this transaction counts toward monthly living expense burn
            counts_as_expense = s1["is_living_expense"]
            if cat_id == "emis" and not include_emis_in_expenses:
                counts_as_expense = False
            if cat_id == "investments" and include_investments_in_expenses:
                counts_as_expense = True

            classified_txns.append(
                {
                    "row_number": t["row_number"],
                    "date": t["date"],
                    "month": t["month"],
                    "description": t["description"],
                    "amount": t["amount"],
                    "amount_formatted": format_inr(t["amount"]),
                    "category_id": cat_id,
                    "category_label": s1["category_label"],
                    "category_icon": CATEGORIES[cat_id].icon,
                    "category_color": CATEGORIES[cat_id].color,
                    "confidence": s1["confidence"],
                    "matched_cue": s1["matched_cue"],
                    "counts_as_expense": counts_as_expense,
                }
            )

        # Number of distinct calendar months covered by the statement
        sorted_months = sorted(months_seen)
        num_months = max(1, len(sorted_months))

        # Aggregate totals
        total_living_expenses = sum(
            t["amount"] for t in classified_txns if t["counts_as_expense"]
        )
        total_investments = sum(
            t["amount"] for t in classified_txns if t["category_id"] == "investments"
        )
        total_all_outflows = sum(t["amount"] for t in classified_txns)

        estimated_monthly_expense = total_living_expenses / num_months
        estimated_annual_expense = estimated_monthly_expense * 12.0
        estimated_monthly_investments = total_investments / num_months

        # Category Breakdown
        cat_totals: dict[str, float] = defaultdict(float)
        cat_counts: dict[str, int] = defaultdict(int)
        for t in classified_txns:
            cid = t["category_id"]
            cat_totals[cid] += t["amount"]
            cat_counts[cid] += 1

        category_breakdown: list[dict[str, Any]] = []
        for cid, cdef in CATEGORIES.items():
            tot = cat_totals.get(cid, 0.0)
            if tot <= 0:
                continue
            monthly_avg = tot / num_months
            pct_of_expenses = (
                (tot / total_living_expenses * 100.0)
                if (total_living_expenses > 0 and (cdef.is_living_expense or include_investments_in_expenses))
                else 0.0
            )
            if cid == "emis" and not include_emis_in_expenses:
                pct_of_expenses = 0.0

            category_breakdown.append(
                {
                    "category_id": cid,
                    "label": cdef.label,
                    "icon": cdef.icon,
                    "color": cdef.color,
                    "is_living_expense": cdef.is_living_expense if cid != "emis" else include_emis_in_expenses,
                    "total_amount": round(tot, 2),
                    "total_formatted": format_inr_compact(tot),
                    "monthly_average": round(monthly_avg, 0),
                    "monthly_formatted": format_inr_compact(monthly_avg),
                    "monthly_inr_exact": format_inr(monthly_avg),
                    "share_of_expenses_pct": round(pct_of_expenses, 1),
                    "transaction_count": cat_counts[cid],
                }
            )

        # Sort categories: living expenses first (descending by monthly_average), then investments
        category_breakdown.sort(
            key=lambda c: (1 if c["is_living_expense"] else 0, c["monthly_average"]),
            reverse=True,
        )

        # Month-by-month breakdown
        monthly_series: list[dict[str, Any]] = []
        target_month_keys = sorted_months if sorted_months else ["Unknown-Month"]
        for m_key in target_month_keys:
            m_txns = [t for t in classified_txns if t["month"] == m_key]
            m_exp = sum(t["amount"] for t in m_txns if t["counts_as_expense"])
            m_inv = sum(t["amount"] for t in m_txns if t["category_id"] == "investments")
            by_cat: dict[str, float] = defaultdict(float)
            for t in m_txns:
                by_cat[t["category_id"]] += t["amount"]
            monthly_series.append(
                {
                    "month": m_key,
                    "living_expense": round(m_exp, 0),
                    "living_expense_formatted": format_inr_compact(m_exp),
                    "investments": round(m_inv, 0),
                    "by_category": {k: round(v, 0) for k, v in by_cat.items()},
                }
            )

        return {
            "module_id": self.metadata.id,
            "filename": filename,
            "discovered_schema": schema,
            "summary": {
                "num_months_detected": num_months,
                "months_list": sorted_months if sorted_months else ["Single Period"],
                "total_transactions_classified": len(classified_txns),
                "estimated_monthly_expense": round(estimated_monthly_expense, 0),
                "estimated_monthly_expense_formatted": format_inr_compact(estimated_monthly_expense),
                "estimated_monthly_expense_exact": format_inr(estimated_monthly_expense),
                "estimated_annual_expense": round(estimated_annual_expense, 0),
                "estimated_annual_expense_formatted": format_inr_compact(estimated_annual_expense),
                "estimated_monthly_investments": round(estimated_monthly_investments, 0),
                "estimated_monthly_investments_formatted": format_inr_compact(estimated_monthly_investments),
                "total_living_expenses_period": round(total_living_expenses, 0),
                "total_living_expenses_formatted": format_inr_compact(total_living_expenses),
                "total_all_outflows_period": round(total_all_outflows, 0),
                "total_all_outflows_formatted": format_inr_compact(total_all_outflows),
            },
            "category_breakdown": category_breakdown,
            "monthly_trend": monthly_series,
            "transactions": classified_txns,
        }

    def run(self, params: dict[str, Any]) -> dict[str, Any]:
        """Run analysis on raw_rows passed via generic module runner."""
        raw_rows = params.get("raw_rows")
        if not raw_rows:
            raise ValueError("Bank statement raw_rows must be provided for analysis.")
        return self.analyze_rows(
            raw_rows=raw_rows,
            filename=params.get("filename", "uploaded_statement.csv"),
            include_emis_in_expenses=bool(params.get("include_emis_in_expenses", True)),
            include_investments_in_expenses=bool(params.get("include_investments_in_expenses", False)),
        )


def register_analyzer_modules() -> None:
    """Register the Bank Statement Expense Analyzer in the global FinLib registry."""
    registry.register(BankStatementExpenseAnalyzer())


register_analyzer_modules()
