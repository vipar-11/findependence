#!/usr/bin/env bash
# Local & Mobile Wi-Fi startup script for FinDependence India ("Decode My Financial Outlook")
# Activates the Python virtual environment (.venv), binds to 0.0.0.0 so mobile devices
# on the same Wi-Fi can connect, and prints the exact Wi-Fi IP URL to open on your phone.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="${VENV_DIR:-.venv}"
HOST="${HOST:-0.0.0.0}"
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

# Detect local Wi-Fi / LAN IPv4 address on macOS / Linux
detect_lan_ip() {
  local ip=""
  if command -v ipconfig >/dev/null 2>&1; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if [ -z "$ip" ]; then
    ip="$(python3 -c 'import socket; s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(("8.8.8.8", 80)); print(s.getsockname()[0]); s.close()' 2>/dev/null || true)"
  fi
  if [ -z "$ip" ] && command -v ifconfig >/dev/null 2>&1; then
    ip="$(ifconfig | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}' || true)"
  fi
  echo "${ip:-127.0.0.1}"
}

LAN_IP="$(detect_lan_ip)"

echo "=================================================================="
echo "  FinDependence India — Local & Mobile Wi-Fi Dev Server"
echo "------------------------------------------------------------------"
echo "  Virtual Env       : $VIRTUAL_ENV"
echo "  On This Mac       : http://127.0.0.1:${PORT}"
echo "  On Mobile (Wi-Fi) : http://${LAN_IP}:${PORT}"
echo "=================================================================="

exec uvicorn app.main:app --host "$HOST" --port "$PORT" --reload "$@"
