#!/usr/bin/env bash
# Deploy AfterCart / ReceiptCheck web app to Cloud Run.
#
# Prereqs (one-time, already done unless rebuilt from scratch):
#   - APIs enabled (run, sql, artifactregistry, secretmanager, aiplatform, cloudscheduler)
#   - SA aftercart-runner with cloudsql.client + secretmanager.secretAccessor + aiplatform.user + storage.objectViewer
#   - Cloud SQL instance aftercart-pg in us-west1, RUNNABLE
#   - All 5 secrets in Secret Manager: db-password, google-vision-api-key,
#     openrouter-key, inspector-password, refresh-token
#   - Container image at us-west1-docker.pkg.dev/aftercart-494521/aftercart/web:v1
#   - OFF SQLite in gs://aftercart-off-data/us-products.sqlite (downloaded to /tmp at startup)
#
# Usage:
#   bash scripts/deploy-cloud-run.sh           # deploy :v1
#   TAG=v2 bash scripts/deploy-cloud-run.sh    # deploy a different tag

set -euo pipefail

PROJECT=aftercart-494521
REGION=us-west1
SERVICE=aftercart-web
TAG="${TAG:-v1}"
IMAGE="us-west1-docker.pkg.dev/${PROJECT}/aftercart/web:${TAG}"
SA="aftercart-runner@${PROJECT}.iam.gserviceaccount.com"
SQL_CONN="${PROJECT}:${REGION}:aftercart-pg"

gcloud run deploy "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --platform=managed \
  --execution-environment=gen2 \
  --allow-unauthenticated \
  --service-account="${SA}" \
  --add-cloudsql-instances="${SQL_CONN}" \
  --min-instances=1 \
  --max-instances=3 \
  --cpu=2 \
  --memory=4Gi \
  --timeout=120 \
  --port=8080 \
  --set-env-vars="PGHOST=/cloudsql/${SQL_CONN},PGUSER=aftercart_app,PGDATABASE=receiptcheck,OFF_SQLITE_PATH=/tmp/us-products.sqlite,OFF_GCS_PATH=gs://aftercart-off-data/us-products.sqlite,GOOGLE_CLOUD_PROJECT=${PROJECT},GOOGLE_CLOUD_LOCATION=${REGION}" \
  --set-secrets="PGPASSWORD=db-password:latest,GOOGLE_VISION_API_KEY=google-vision-api-key:latest,OPENROUTER_KEY=openrouter-key:latest,INSPECTOR_PASSWORD=inspector-password:latest,REFRESH_TOKEN=refresh-token:latest"

echo
echo "Deployed. URL:"
gcloud run services describe "${SERVICE}" --project="${PROJECT}" --region="${REGION}" --format='value(status.url)'
