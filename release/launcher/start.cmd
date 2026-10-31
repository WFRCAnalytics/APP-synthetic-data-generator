@echo off
rem Starts the app on this computer only, with no internet. Double-click this file.
rem It runs start.ps1 for this one run; no Windows setting is changed.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 (
  echo.
  echo The launcher stopped with an error. See README.txt, section "If it does not start".
  pause
)
