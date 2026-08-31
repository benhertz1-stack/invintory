# deploy.ps1 - Build from source and deploy Invintory to Google Cloud Run.
#
# Prerequisites (one-time):
#   gcloud auth login
#   gcloud config set project invintory-495823
#   Secrets ANTHROPIC_API_KEY, OWNER_PASSPHRASE_HASH and AUTH_SECRET exist in Secret Manager
#   (create the last two with:  npm run passphrase  then  .\deploy.ps1 -SetSecrets)
param(
  [string]$ProjectId = "",
  [string]$Region = "us-central1",
  [switch]$SetSecrets
)

$ErrorActionPreference = "Stop"

if (-not $ProjectId) { $ProjectId = (gcloud config get-value project 2>$null).Trim() }
if (-not $ProjectId) { Write-Error "No Google Cloud project set. Run: gcloud config set project YOUR_PROJECT_ID"; exit 1 }

$ServiceName = "invintory"
Write-Host "Project: $ProjectId   Region: $Region   Service: $ServiceName" -ForegroundColor Cyan

if ($SetSecrets) {
  # Reads OWNER_PASSPHRASE_HASH and AUTH_SECRET from .env and stores them in Secret Manager.
  $envLines = Get-Content .env | Where-Object { $_ -match '^(OWNER_PASSPHRASE_HASH|AUTH_SECRET)=' }
  foreach ($line in $envLines) {
    $name, $value = $line -split '=', 2
    $exists = gcloud secrets describe $name --project $ProjectId 2>$null
    if (-not $exists) { gcloud secrets create $name --replication-policy=automatic --project $ProjectId | Out-Null }
    $value | gcloud secrets versions add $name --data-file=- --project $ProjectId | Out-Null
    Write-Host "Secret $name updated." -ForegroundColor Green
  }
  # Let the Cloud Run runtime service account read the secrets.
  $projectNumber = (gcloud projects describe $ProjectId --format="value(projectNumber)").Trim()
  $sa = "$projectNumber-compute@developer.gserviceaccount.com"
  foreach ($name in @("ANTHROPIC_API_KEY", "OWNER_PASSPHRASE_HASH", "AUTH_SECRET")) {
    gcloud secrets add-iam-policy-binding $name --member "serviceAccount:$sa" --role roles/secretmanager.secretAccessor --project $ProjectId --quiet | Out-Null
  }
  Write-Host "Secret access granted to $sa." -ForegroundColor Green
}

Write-Host "Building and deploying from source..." -ForegroundColor Yellow
gcloud run deploy $ServiceName `
  --source . `
  --project $ProjectId `
  --region $Region `
  --platform managed `
  --allow-unauthenticated `
  --port 8080 `
  --memory 512Mi `
  --cpu 1 `
  --min-instances 0 `
  --max-instances 3 `
  --update-secrets "ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,OWNER_PASSPHRASE_HASH=OWNER_PASSPHRASE_HASH:latest,AUTH_SECRET=AUTH_SECRET:latest"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$url = (gcloud run services describe $ServiceName --region $Region --project $ProjectId --format="value(status.url)" 2>$null).Trim()
Write-Host ""
Write-Host "Deployed:            $url" -ForegroundColor Green
Write-Host "Claude connector URL: $url/mcp" -ForegroundColor Green
