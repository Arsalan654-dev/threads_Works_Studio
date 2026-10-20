@echo off
rem ---------------------------------------------------------------------------
rem  ThreadWorks Studio - development mode
rem
rem  Runs three watchers in one window:
rem     engine  - recompiles the embroidery engine on change
rem     server  - Express API with automatic restart (tsx watch)
rem     client  - Vite dev server with hot reload
rem
rem  The editor is served by Vite at http://127.0.0.1:5173 and proxies /api
rem  to the Express process on port 4000.
rem
rem  Use this when you are changing code. For normal use, run start.bat.
rem ---------------------------------------------------------------------------

setlocal enabledelayedexpansion
cd /d "%~dp0"

set "APP_URL=http://127.0.0.1:5173"

title ThreadWorks Studio - development

echo.
echo  ============================================================
echo    ThreadWorks Studio - development
echo  ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js was not found on PATH.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo  Installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo  Created .env from .env.example
)

rem The engine is consumed as a built package, so it must be compiled at least
rem once before the server or client can import it.
if not exist "packages\embroidery-engine\dist\index.js" (
  echo.
  echo  Building the embroidery engine...
  call npm run build -w @threadworks/engine
  if errorlevel 1 (
    echo  [ERROR] Engine build failed.
    pause
    exit /b 1
  )
)

rem --- MongoDB ----------------------------------------------------------------

netstat -ano | findstr /r /c:"LISTENING" | findstr ":27017" >nul 2>nul
if not errorlevel 1 goto :mongo_ok

echo  MongoDB is not running - starting the Windows service...
net start MongoDB >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [WARN] Could not start MongoDB automatically. The API will report
  echo         "database disconnected" until the service is started.
  echo         Start it from Services (services.msc) and restart this script.
  echo.
  goto :mongo_ok
)

set /a "WAITED=0"
:wait_mongo
timeout /t 1 /nobreak >nul
set /a "WAITED+=1"
netstat -ano | findstr /r /c:"LISTENING" | findstr ":27017" >nul 2>nul
if not errorlevel 1 goto :mongo_ok
if %WAITED% geq 30 goto :mongo_ok
goto :wait_mongo

:mongo_ok

call npm run seed >nul 2>nul

echo  Editor:  %APP_URL%
echo  API:     http://127.0.0.1:4000/api/health
echo.
echo  Press Ctrl+C to stop everything.
echo  ============================================================
echo.

timeout /t 3 /nobreak >nul
start "" "%APP_URL%"

rem `concurrently` runs all three and tears them all down together, so Ctrl+C
rem does not leave an orphaned watcher holding a port.
call npm run dev
if errorlevel 1 (
  echo.
  echo  [ERROR] The dev servers exited unexpectedly.
  echo.
)
pause
