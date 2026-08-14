Write-Host "===================================" -ForegroundColor Cyan
Write-Host "Restarting DocuSeal Docker Services" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (Test-Path (Join-Path $scriptDir "docuseal\docker-compose.yml")) {
    Set-Location (Join-Path $scriptDir "docuseal")
} elseif (Test-Path (Join-Path $scriptDir "docker-compose.yml")) {
    Set-Location $scriptDir
}

Write-Host "`nStopping containers..." -ForegroundColor Yellow
docker compose down

Write-Host "`nStarting containers..." -ForegroundColor Green
docker compose up -d

Write-Host "`nChecking status..." -ForegroundColor Cyan
docker compose ps

Write-Host "`n===================================" -ForegroundColor Green
Write-Host "DocuSeal is ready at http://localhost:3000" -ForegroundColor Green
Write-Host "===================================" -ForegroundColor Green
