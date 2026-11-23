#!/usr/bin/env bash
# Startup script for FinDependence India ("Decode My Financial Outlook")
# Activates the virtual environment (creating it if missing) and starts the FastAPI server.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="${VENV_DIR:-.venv}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtual environment in $VENV_DIR..."
  python3 -m venv "$VENV_DIR"
  source "$VENV_DIR/bin/activate"
  echo "Installing dependencies from requirements.txt..."
  pip install --upgrade pip
  pip install -r requirements.txt
else
  source "$VENV_DIR/bin/activate"
fi

echo "Starting FinDependence India at http://${HOST}:${PORT} ..."
exec uvicorn app.main:app --host "$HOST" --port "$PORT" --reload "$@"
