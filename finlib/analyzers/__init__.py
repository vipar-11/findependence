"""Pluggable bank statement & cashflow analyzer modules for FinDependence India."""

from finlib.analyzers.expense_analyzer import (
    BankStatementExpenseAnalyzer,
    register_analyzer_modules,
)

__all__ = [
    "BankStatementExpenseAnalyzer",
    "register_analyzer_modules",
]
