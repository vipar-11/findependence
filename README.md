# FinDependence India — Financial Independence & Wealth Longevity Platform

An interactive FastAPI web application and reusable financial simulation library (`finlib`) built for individuals in India seeking Financial Independence (FIRE).

---

## Quick Start

### 1. Activate the Project Virtual Environment
A project-specific Python virtual environment is pre-configured at `.venv/`:
```bash
source .venv/bin/activate
```

### 2. Start the FastAPI Server
```bash
.venv/bin/uvicorn app.main:app --reload --port 8000
```
Then open **http://127.0.0.1:8000** in your browser.
- Interactive Web UI: `http://127.0.0.1:8000/`
- Swagger API Docs: `http://127.0.0.1:8000/docs`

### 3. Run the Test Suite
```bash
.venv/bin/pytest -v
```

---

## Architecture & Reusable Library (`finlib`)

```text
findependence/
├── .venv/                              # Dedicated Python virtual environment
├── finlib/                             # Reusable Financial Independence Library
│   ├── __init__.py
│   ├── data/
│   │   └── indian_market_history.py    # 35 years (1991–2025) of Indian Equity, Debt, Property & CPI data
│   ├── core/
│   │   ├── finance.py                  # Reusable INR formatting, Fisher real return, expense inflation,
│   │   │                               # vectorized portfolio drawdown, and percentile aggregators
│   │   └── engine.py                   # Pluggable BaseSimulator, SimulatorRegistry, Block Bootstrap &
│   │                                   # Correlated Monte Carlo + Historical Rolling Backtest engines
│   └── simulators/
│       └── wealth_longevity.py         # Simulator #1: "Can I Retire Today? / How Long Will My Wealth Last?"
├── app/                                # FastAPI Backend + Interactive Frontend
│   ├── main.py                         # REST API routes & static SPA server
│   ├── schemas.py                      # Pydantic v2 validation models
│   └── static/
│       ├── index.html                  # Visual dashboard (Tailwind CSS + Chart.js)
│       ├── css/styles.css
│       └── js/app.js
└── tests/
    └── test_finlib_and_api.py          # Unit & integration tests
```

---

## Plugging in a New Simulator

To add a new calculator or simulator to the platform:
1. Subclass `BaseSimulator` from `finlib.core.engine` and define `SimulatorMetadata`.
2. Reuse `finlib.core.finance` and `finlib.core.engine` primitives (`generate_monte_carlo_paths`, `simulate_portfolio_paths`, `project_expenses`, `compute_trajectory_percentiles`, etc.).
3. Register it via `registry.register(MyNewSimulator())`.
4. It automatically becomes available via `GET /api/v1/simulators` and executable via `POST /api/v1/simulators/{simulator_id}/run`.

