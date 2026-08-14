@echo off
setlocal
echo ===================================
echo Restarting DocuSeal Docker Services
echo ===================================

:: Navigate to docuseal directory if we are in root
if exist "%~dp0docuseal\docker-compose.yml" (
    cd /d "%~dp0docuseal"
) else if exist "%~dp0docker-compose.yml" (
    cd /d "%~dp0"
)

echo.
echo Stopping containers...
docker compose down

echo.
echo Starting containers...
docker compose up -d

echo.
echo Checking status...
docker compose ps

echo.
echo ===================================
echo DocuSeal is ready at http://localhost:3000
echo ===================================
endlocal
