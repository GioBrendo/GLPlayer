@echo off
chcp 65001 >nul
title JBLGPlayer - Sound ^& Streaming
cd /d "%~dp0"

echo ========================================================
echo        Iniciando JBLGPlayer - Sound ^& Streaming
echo ========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org/ e tente de novo.
    pause
    exit /b 1
)

where yt-dlp >nul 2>nul
if errorlevel 1 (
    echo [AVISO] yt-dlp nao encontrado no PATH. As musicas online nao vao tocar.
    echo         Instale com:  pip install -U yt-dlp   ou   winget install yt-dlp
    echo.
)

if not exist node_modules (
    echo Instalando dependencias do projeto...
    call npm install
    if errorlevel 1 (
        echo [ERRO] Falha ao instalar as dependencias.
        pause
        exit /b 1
    )
)

rem --open abre o navegador so quando o servidor ja estiver pronto
call npm run dev -- --open
pause
