@echo off
rem ---------------------------------------------------------------------------
rem  ThreadWorks Studio - stop the running application
rem
rem  Finds whatever is listening on port 4000 and terminates that process
rem  tree. Running this when nothing is listening is harmless.
rem ---------------------------------------------------------------------------

setlocal enabledelayedexpansion
cd /d "%~dp0"

set "PORT=4000"
set "FOUND=0"

echo.
echo  Stopping ThreadWorks Studio on port %PORT% ...

rem netstat's PID column is the fifth token on the LISTENING line.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":%PORT%"') do (
  set "FOUND=1"
  echo  Terminating process %%p ...
  rem /T kills child processes too (npm spawns node, which spawns tsx).
  taskkill /PID %%p /F /T >nul 2>nul
  if errorlevel 1 (
    echo  [WARN] Could not stop process %%p - it may need administrator rights.
  )
)

if "%FOUND%"=="0" (
  echo  Nothing is listening on port %PORT%. ThreadWorks is not running.
  echo.
  exit /b 0
)

timeout /t 1 /nobreak >nul

netstat -ano | findstr /r /c:"LISTENING" | findstr ":%PORT%" >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ThreadWorks Studio has stopped.
  echo.
  exit /b 0
)

echo.
echo  [WARN] Something is still listening on port %PORT%.
echo         Another program may own that port.
echo.
exit /b 1
