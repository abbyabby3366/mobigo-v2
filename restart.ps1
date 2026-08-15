Write-Host "===================================" -ForegroundColor Cyan
Write-Host "Restarting DocuSeal Docker Services" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check if Docker daemon is running, start Docker Desktop if not
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nDocker daemon is not running. Launching Docker Desktop..." -ForegroundColor Yellow
    $dockerPath = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerPath) {
        Start-Process -FilePath $dockerPath
    } else {
        try {
            Start-Process "Docker Desktop"
        } catch {
            Write-Host "Could not locate or launch Docker Desktop automatically." -ForegroundColor Red
            exit 1
        }
    }

    Write-Host "Waiting for Docker daemon to start..." -NoNewline -ForegroundColor Yellow
    $timeout = 90
    $elapsed = 0
    while ($elapsed -lt $timeout) {
        Start-Sleep -Seconds 3
        $elapsed += 3
        docker info 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            break
        }
        Write-Host "." -NoNewline -ForegroundColor Yellow
    }
    Write-Host ""

    docker info 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Timed out waiting for Docker daemon to start." -ForegroundColor Red
        exit 1
    }
    Write-Host "Docker daemon is now active!`n" -ForegroundColor Green
}

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
