#!/usr/bin/env bash
# Deploy FinDependence India to Google Cloud Run
# Usage:
#   ./deploy_gcp.sh [GCP_PROJECT_ID] [REGION] [SERVICE_NAME]
# Example:
#   ./deploy_gcp.sh my-gcp-project-id asia-south1 findependence

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Error: Google Cloud SDK (gcloud) is not installed."
  echo "Install it from https://cloud.google.com/sdk/docs/install and run 'gcloud auth login'."
  exit 1
fi

# Load local git-ignored .env if present (so GCP_PROJECT_ID is never hardcoded in git)
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
  echo "Usage: ./deploy_gcp.sh <YOUR_GCP_PROJECT_ID> [REGION] [SERVICE_NAME]"
  exit 1
fi

echo "Configuring deployment for:"
echo "  Project ID   : $PROJECT_ID"
echo "  Region       : $REGION (Mumbai / India default)"
echo "  Service Name : $SERVICE_NAME"

gcloud config set project "$PROJECT_ID"

echo "Enabling required Google Cloud APIs (Cloud Run, Cloud Build, Artifact Registry)..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project "$PROJECT_ID"

echo "Building and deploying $SERVICE_NAME to Google Cloud Run (conservative 1-instance, 256Mi config)..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 256Mi \
  --cpu 1 \
  --cpu-throttling \
  --min-instances 0 \
  --max-instances 1

echo "Deployment complete!"
