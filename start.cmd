@echo off
cd /d "%~dp0"
echo Snake Arena will be available at http://127.0.0.1:4173
echo Keep this window open while using the game. Press Ctrl+C to stop.
node src\server.js
pause
