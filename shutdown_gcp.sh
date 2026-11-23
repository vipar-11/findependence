#!/usr/bin/env bash
# Shut down (delete) the FinDependence India service on Google Cloud Run
# Usage:
#   ./shutdown_gcp.sh [GCP_PROJECT_ID] [REGION] [SERVICE_NAME]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Error: Google Cloud SDK (gcloud) is not installed."
  exit 1
fi

# Load local git-ignored .env if present
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PROJECT_ID="${1:-${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}}"
REGION="${2:-${GCP_REGION:-asia-south1}}"
SERVICE_NAME="${3:-${GCP_SERVICE_NAME:-findependence}}"

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "Error: No Google Cloud Project ID specified."
  echo "Usage: ./shutdown_gcp.sh <YOUR_GCP_PROJECT_ID> [REGION] [SERVICE_NAME]"
  exit 1
fi

echo "Shutting down Google Cloud Run service:"
echo "  Project ID   : $PROJECT_ID"
echo "  Region       : $REGION"
echo "  Service Name : $SERVICE_NAME"

gcloud run services delete "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --platform managed \
  --quiet

echo "Service '$SERVICE_NAME' has been shut down and deleted from Google Cloud Run."
