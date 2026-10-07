@echo off
cd /d "%~dp0app"
if not exist node_modules (call npm install)
start "" http://localhost:5173
call npm run dev
