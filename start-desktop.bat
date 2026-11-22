@echo off
cd /d "%~dp0"
echo ========================================================
echo   NetDash - Menjalankan Aplikasi Desktop
echo ========================================================
start "" ".\node_modules\electron\dist\electron.exe" .
