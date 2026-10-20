@echo off
rem ---------------------------------------------------------------------------
rem  ThreadWorks Studio - back up every design
rem
rem  Writes a timestamped folder under data\backups containing one JSON-lines
rem  file per collection plus a manifest. Uses the MongoDB driver directly, so
rem  mongodump does not need to be installed.
rem
rem  The application does not have to be running, but nothing else may be
rem  writing to the database while this runs.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"

echo.
echo  ThreadWorks Studio - backup
echo  ===========================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js was not found on PATH.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo  [ERROR] Dependencies are not installed. Run start.bat once first.
  echo.
  pause
  exit /b 1
)

netstat -ano | findstr /r /c:"LISTENING" | findstr ":27017" >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] MongoDB is not running on 127.0.0.1:27017.
  echo          There is nothing to back up until the service is started.
  echo.
  pause
  exit /b 1
)

call npm run backup
if errorlevel 1 (
  echo.
  echo  [ERROR] Backup failed. See the message above.
  echo.
  pause
  exit /b 1
)

echo.
echo  Backups are stored in:
echo    %CD%\data\backups
echo.
echo  To restore one, run restore.bat and pass that folder, for example:
echo    restore.bat data\backups\2026-10-14T12-00-00-000Z
echo.
pause
exit /b 0
