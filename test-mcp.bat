@echo off
echo Testing wine MCP server...
echo.
set GOOGLE_CLOUD_PROJECT=invintory-495823
set GOOGLE_APPLICATION_CREDENTIALS=C:\Users\Lord\AppData\Roaming\gcloud\application_default_credentials.json

echo Checking credentials file...
if exist "%GOOGLE_APPLICATION_CREDENTIALS%" (
  echo   Credentials file: FOUND
) else (
  echo   Credentials file: MISSING - this is the problem!
  echo.
  echo   Fix: Run this command in a terminal:
  echo   gcloud auth application-default login
  goto :end
)

echo.
echo Starting MCP server for 5 seconds to test...
cd /d "%~dp0"
timeout /t 1 /nobreak > nul
node dist-server/mcp.js 2>&1
:end
echo.
pause
