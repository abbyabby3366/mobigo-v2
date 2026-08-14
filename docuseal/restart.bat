@echo off
setlocal
echo ===================================
echo Restarting DocuSeal Docker Services
echo ===================================

cd /d "%~dp0"

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
