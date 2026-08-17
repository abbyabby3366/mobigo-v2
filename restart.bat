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
echo DocuSeal:         http://localhost:3000
echo WhatsApp Server:  http://localhost:4000
echo WhatsApp QR Code: http://localhost:4000/api/session/qr
echo ===================================
endlocal
