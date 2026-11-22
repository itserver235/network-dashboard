@echo off
cd /d "%~dp0"
echo ========================================================
echo   NetDash - Menjalankan Server Web (Port 3000)
echo ========================================================
set ELECTRON_RUN_AS_NODE=1
echo Membuka browser ke http://localhost:3000 ...
start http://localhost:3000
echo Menjalankan server... (Tekan Ctrl+C untuk berhenti)
".\node_modules\electron\dist\electron.exe" server.js
pause
