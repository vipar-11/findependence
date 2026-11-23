"""
FastAPI Backend Service & Web Application Server for FinDependence India.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.schemas import GenericSimulationRequest, WealthLongevityRequest
from finlib.analyzers.expense_analyzer import BankStatementExpenseAnalyzer
from finlib.core.engine import registry
from finlib.data.indian_market_history import get_market_summary_statistics
import finlib.analyzers  # noqa: F401 - registers analyzer modules
import finlib.simulators  # noqa: F401 - registers simulator modules

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(
    title="FinDependence India — Financial Independence & Cashflow Platform",
    description=(
        "Modular simulation and cashflow intelligence platform for individuals in India seeking "
        "financial independence (FIRE). Includes the Wealth Longevity Simulator and the System 1 "
        "Bank Statement Expense Analyzer."
    ),
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/api/v1/health", tags=["System"])
def health_check() -> dict[str, Any]:
    """Service health and registered active modules count."""
    all_mods = registry.list_all(include_retired=True)
    active_mods = registry.list_active()
    return {
        "status": "ok",
        "service": "FinDependence India API",
        "active_simulators": len(active_mods),
        "total_registered_simulators": len(all_mods),
    }


@app.get("/api/v1/simulators", tags=["Modules & Lifecycle"])
@app.get("/api/v1/modules", tags=["Modules & Lifecycle"])
def list_simulators(include_retired: bool = Query(default=False)) -> dict[str, Any]:
    """List registered modules (active, coming_soon, and optionally retired)."""
    return {
        "simulators": registry.list_all(include_retired=include_retired),
        "active_modules": registry.list_active(),
    }


@app.post("/api/v1/modules/{module_id}/retire", tags=["Modules & Lifecycle"])
def retire_module(module_id: str) -> dict[str, Any]:
    """Retire a module so it is removed from active navigation and execution."""
    try:
        registry.retire(module_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"module_id": module_id, "status": registry.get_status(module_id)}


@app.post("/api/v1/modules/{module_id}/activate", tags=["Modules & Lifecycle"])
def activate_module(module_id: str) -> dict[str, Any]:
    """Re-activate a retired module."""
    try:
        registry.activate(module_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"module_id": module_id, "status": registry.get_status(module_id)}


@app.get("/api/v1/market-data/india", tags=["Market Data"])
def get_indian_market_data() -> dict[str, Any]:
    """Return historical Indian market returns (last 20 years), summary statistics, and correlations."""
    return get_market_summary_statistics()


# ==================== FUNCTION 1: RETIREMENT WEALTH LONGEVITY SIMULATOR ====================
@app.post("/api/v1/simulators/wealth-longevity/run", tags=["Wealth Longevity Simulator"])
def run_wealth_longevity_simulation(payload: WealthLongevityRequest) -> dict[str, Any]:
    """
    Execute the 'Can I Retire Today? / How Long Will My Wealth Last?' simulation.
    """
    try:
        simulator = registry.get("wealth_longevity")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return simulator.run(payload.model_dump())


# ==================== FUNCTION 2: BANK STATEMENT EXPENSE ANALYZER (SYSTEM 1) ====================
@app.post("/api/v1/analyzers/expense-analyzer/upload", tags=["Bank Statement Expense Analyzer"])
async def upload_bank_statement(
    file: UploadFile = File(...),
    include_emis_in_expenses: bool = Form(default=True),
    include_investments_in_expenses: bool = Form(default=False),
) -> dict[str, Any]:
    """
    Upload a bank statement (.xlsx, .xls, .csv, .tsv), discover its format & columns at runtime,
    and classify each line using the System 1 associative decision model.
    """
    try:
        analyzer = registry.get("expense_analyzer")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if not isinstance(analyzer, BankStatementExpenseAnalyzer):
        raise HTTPException(status_code=500, detail="Invalid analyzer instance registered.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        return analyzer.analyze_file(
            file_bytes=file_bytes,
            filename=file.filename or "statement.xlsx",
            include_emis_in_expenses=include_emis_in_expenses,
            include_investments_in_expenses=include_investments_in_expenses,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not parse bank statement file '{file.filename}': {exc}",
        ) from exc


@app.post("/api/v1/simulators/{simulator_id}/run", tags=["Modules & Lifecycle"])
def run_simulator_by_id(simulator_id: str, payload: GenericSimulationRequest) -> dict[str, Any]:
    """
    Execute any registered active module by its `simulator_id` using the pluggable engine.
    """
    try:
        simulator = registry.get(simulator_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if simulator_id == "wealth_longevity":
        validated = WealthLongevityRequest(**payload.params)
        return simulator.run(validated.model_dump())

    return simulator.run(payload.params)


@app.get("/", include_in_schema=False)
def serve_frontend() -> FileResponse:
    """Serve the interactive FinDependence India Single Page Application."""
    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend index.html not found.")
    return FileResponse(str(index_path))
