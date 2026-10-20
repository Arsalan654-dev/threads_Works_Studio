@echo off
rem ---------------------------------------------------------------------------
rem  ThreadWorks Studio - restore a backup
rem
rem  Usage:
rem     restore.bat                       lists available backups
rem     restore.bat <backup-folder>       restores (replaces everything)
rem     restore.bat <backup-folder> merge  restores as a merge, keeping
rem                                        records that are not in the backup
rem
rem  Restore REPLACES the current database by default. That is deliberate: a
rem  merge can resurrect designs you deliberately deleted, which is usually
rem  worse than having done nothing.
rem ---------------------------------------------------------------------------

setlocal enabledelayedexpansion
cd /d "%~dp0"

set "BACKUP_DIR=%~1"
set "MODE=%~2"

echo.
echo  ThreadWorks Studio - restore
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
  echo.
  pause
  exit /b 1
)

rem --- No folder given: list what is available --------------------------------

if "%BACKUP_DIR%"=="" (
  echo  Available backups in data\backups:
  echo.
  if exist "data\backups" (
    dir /b /ad /o-n "data\backups" 2>nul
  ) else (
    echo    No backups have been taken yet. Run backup.bat first.
  )
  echo.
  echo  Usage: restore.bat ^<backup-folder^> [merge]
  echo.
  pause
  exit /b 0
)

if not exist "%BACKUP_DIR%\manifest.json" (
  echo  [ERROR] "%BACKUP_DIR%" does not look like a backup folder.
  echo          It should contain manifest.json alongside the collection files.
  echo.
  pause
  exit /b 1
)

rem --- Stop the app before touching the data ----------------------------------

netstat -ano | findstr /r /c:"LISTENING" | findstr ":4000" >nul 2>nul
if errorlevel 1 goto :app_stopped

echo  ThreadWorks is still running. Restoring underneath it could leave the
echo  editor holding stale document versions.
echo.
choice /c YN /m "Stop it now"
if errorlevel 2 (
  echo.
  echo  Restore cancelled.
  echo.
  pause
  exit /b 1
)

call shutdown.bat >nul 2>nul
timeout /t 2 /nobreak >nul

:app_stopped

rem --- Confirm ----------------------------------------------------------------

echo  You are about to restore:
echo.
echo     %BACKUP_DIR%
echo.
if /i "%MODE%"=="merge" (
  echo  Mode: MERGE - existing records are kept.
  echo.
  echo  [WARNING] Merging can resurrect designs you deleted on purpose.
) else (
  echo  Mode: REPLACE - everything currently in the database will be erased.
)
echo.
choice /c YN /m "Continue"
if errorlevel 2 (
  echo.
  echo  Restore cancelled. Nothing was changed.
  echo.
  pause
  exit /b 0
)

echo.

if /i "%MODE%"=="merge" (
  call npm run restore -- "%BACKUP_DIR%" --merge
) else (
  call npm run restore -- "%BACKUP_DIR%"
)

if errorlevel 1 (
  echo.
  echo  [ERROR] Restore failed. The previous data may have been cleared.
  echo          Check the message above. Your backups in data\backups are
  echo          untouched, so you can try another one.
  echo.
  pause
  exit /b 1
)

echo.
echo  Restore complete. Run start.bat to reopen the editor.
echo.
pause
exit /b 0
