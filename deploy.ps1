# deploy.ps1 - Deploy Invintory to Google Cloud Run
param(
  [string]$ProjectId = "",
  [string]$Region = "us-central1",
  [string]$AnthropicApiKey = $env:ANTHROPIC_API_KEY
)

if (-not $ProjectId) {
  $ProjectId = (gcloud config get-value project 2>$null).Trim()
}

if (-not $ProjectId) {
  Write-Error "No Google Cloud project set. Run: gcloud config set project YOUR_PROJECT_ID"
  exit 1
}

$ServiceName = "invintory"
$Image = "gcr.io/$ProjectId/$ServiceName"

Write-Host "Project: $ProjectId" -ForegroundColor Cyan
Write-Host "Region:  $Region" -ForegroundColor Cyan
Write-Host "Image:   $Image" -ForegroundColor Cyan
Write-Host ""

Write-Host "Building and pushing container image..." -ForegroundColor Yellow
gcloud builds submit --tag $Image .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Deploying to Cloud Run..." -ForegroundColor Yellow

$deployArgs = @(
  "run", "deploy", $ServiceName,
  "--image", $Image,
  "--platform", "managed",
  "--region", $Region,
  "--allow-unauthenticated",
  "--port", "8080",
  "--memory", "512Mi",
  "--cpu", "1"
)

if ($AnthropicApiKey) {
  $deployArgs += "--set-env-vars"
  $deployArgs += "ANTHROPIC_API_KEY=$AnthropicApiKey"
  Write-Host "ANTHROPIC_API_KEY will be set on Cloud Run." -ForegroundColor Green
} else {
  Write-Warning "ANTHROPIC_API_KEY not set. Wine Advisor will be disabled. Re-run with -AnthropicApiKey or set env:ANTHROPIC_API_KEY."
}

& gcloud @deployArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$url = (gcloud run services describe $ServiceName --region $Region --format="value(status.url)" 2>$null).Trim()
Write-Host ""
Write-Host "Deployed to: $url" -ForegroundColor Green
