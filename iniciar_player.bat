@echo off
title JBLGPlayer — Sound & Streaming
echo ========================================================
echo        Iniciando JBLGPlayer — Sound & Streaming
echo ========================================================
echo.

if not exist node_modules (
    echo Instalando dependencias do projeto...
    call npm install
)

start http://127.0.0.1:5173
npm run dev -- --host
pause
