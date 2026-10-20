@echo off
rem ---------------------------------------------------------------------------
rem  ThreadWorks Studio - start the application (production mode)
rem
rem  What this does, in order:
rem    1. Checks the prerequisites (Node, npm, MongoDB) and stops with a
rem       readable message if something is missing.
rem    2. Installs dependencies and builds the app if it has not been built
rem       yet. After the first run these are skipped, so startup stays fast.
rem    3. Seeds the built-in hoops, palettes and presets (idempotent).
rem    4. Starts the server, which serves BOTH the API and the editor.
rem    5. Opens the browser once the health endpoint answers.
rem
rem  Stop it with shutdown.bat, or close this window.
rem ---------------------------------------------------------------------------

setlocal enabledelayedexpansion
cd /d "%~dp0"

set "APP_URL=http://127.0.0.1:4000"
set "TITLE=ThreadWorks Studio"

title %TITLE% - starting...

echo.
echo  ============================================================
echo    %TITLE%
echo  ============================================================
echo.

rem --- 1. Prerequisites ------------------------------------------------------

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js was not found on PATH.
  echo.
  echo  Install Node.js 20 or newer, then run this script again.
  echo  https://nodejs.org/
  echo.
  goto :fail
)

for /f "delims=" %%v in ('node --version') do set "NODE_VERSION=%%v"
echo  Node      %NODE_VERSION%

for /f "delims=" %%v in ('npm --version 2^>nul') do set "NPM_VERSION=%%v"
if not defined NPM_VERSION (
  echo  [ERROR] npm was not found on PATH.
  echo.
  goto :fail
)
echo  npm       %NPM_VERSION%

rem Check whether something is already listening on the app port. Starting a
rem second instance would fail confusingly on the bind, so say so plainly.
netstat -ano | findstr /r /c:"LISTENING" | findstr ":4000" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo  [ERROR] Port 4000 is already in use, so ThreadWorks is probably
  echo          already running. Open %APP_URL% in your browser,
  echo          or run shutdown.bat first.
  echo.
  goto :fail
)

rem --- MongoDB ---------------------------------------------------------------

echo.
echo  Checking MongoDB on 127.0.0.1:27017 ...
netstat -ano | findstr /r /c:"LISTENING" | findstr ":27009 :27017" >nul 2>nul
if not errorlevel 1 (
  echo  MongoDB     running
  goto :mongo_ok
)

echo  MongoDB     not detected - trying to start the Windows service...
net start MongoDB >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERROR] Could not start MongoDB.
  echo.
  echo  ThreadWorks stores every design in MongoDB. It will not fall back to
  echo  files or browser storage, because that would make "saved" designs
  echo  disappear on the next start.
  echo.
  echo  Try one of these, then run this script again:
  echo    - Open Services (services.msc) and start "MongoDB"
  echo    - Run:  net start MongoDB
  echo.
  goto :fail
)

rem Wait for the port to come up before continuing.
set /a "WAITED=0"
:wait_mongo
timeout /t 1 /nobreak >nul
set /a "WAITED+=1"
netstat -ano | findstr /r /c:"LISTENING" | findstr ":27017" >nul 2>nul
if not errorlevel 1 goto :mongo_ok
if %WAITED% geq 30 (
  echo  [ERROR] MongoDB did not start within 30 seconds.
  goto :fail
)
goto :wait_mongo

:mongo_ok

rem --- 2. Install / build ----------------------------------------------------

if not exist "node_modules" (
  echo.
  echo  Installing dependencies for the first time. This can take a few minutes...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  [ERROR] npm install failed. See the output above.
    goto :fail
  )
)

if not exist "server\dist\server.js" (
  echo.
  echo  Building the application for the first time...
  call npm run build
  if errorlevel 1 (
    echo.
    echo  [ERROR] Build failed. See the output above.
    goto :fail
  )
)

if not exist "client\dist\index.html" (
  echo.
  echo  Building the editor...
  call npm run build -w @threadworks/client
  if errorlevel 1 (
    echo.
    echo  [ERROR] Client build failed. See the output above.
    goto :fail
  )
)

rem --- 3. Environment and seed ----------------------------------------------

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo.
  echo  Created .env from .env.example
)

echo.
echo  Seeding built-in hoops, palettes and presets...
call npm run seed >nul 2>nul
if errorlevel 1 (
  echo  [WARN] Seeding failed - the editor will still run, but the hoop
  echo         preset list may be empty. Run  npm run seed  to retry.
)

rem --- 4. Start --------------------------------------------------------------

echo.
echo  Starting the server...
echo  Editor:  %APP_URL%
echo  Health:  %APP_URL%/api/health
echo.
echo  Press Ctrl+C in this window, or run shutdown.bat, to stop.
echo  ============================================================
echo.

rem /B keeps the process in this window so Ctrl+C works and the log is visible.
start "ThreadWorks Studio" /b cmd /c "npm run start"

rem --- 5. Wait for readiness, then open the browser ---------------------------

set /a "WAITED=0"
:wait_ready
timeout /t 1 /nobreak >nul
set /a "WAITED+=1"

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%APP_URL%/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } ; exit 1 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto :ready
if %WAITED% geq 45 goto :not_ready
goto :wait_ready

:ready
echo  Server is up. Opening %APP_URL% ...
start "" "%APP_URL%"
echo.
echo  You can close this window - ThreadWorks keeps running in the background.
echo  Run shutdown.bat to stop it.
echo.
pause
exit /b 0

:not_ready
echo.
echo  [ERROR] The server did not become ready within 45 seconds.
echo          Port 4000 may be blocked, or the database connection failed.
echo          The log above should say why.
echo.
pause
exit /b 1

:fail
echo.
pause
exit /b 1
