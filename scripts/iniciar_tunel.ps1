# Sobe o GLPlayer neste PC e publica na internet com um Cloudflare quick tunnel.
# O yt-dlp roda daqui (IP residencial), entao o YouTube nao bloqueia como no Render.
# O link https://*.trycloudflare.com muda a cada execucao.

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root
$Port = 4173
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force $LogDir | Out-Null

function Write-Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Stop-WithError($text) {
    Write-Host "[ERRO] $text" -ForegroundColor Red
    exit 1
}

foreach ($cmd in 'node', 'npm', 'yt-dlp', 'cloudflared') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Stop-WithError "'$cmd' nao encontrado no PATH."
    }
}

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Stop-WithError "A porta $Port ja esta em uso. Feche a outra janela do GLPlayer e tente de novo."
}

if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
    Write-Step 'Instalando dependencias...'
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'Falha no npm install.' }
}

Write-Step 'Gerando build do site...'
npm run build --silent
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Falha no npm run build.' }

$server = $null
$tunnel = $null
try {
    Write-Step "Iniciando servidor em http://127.0.0.1:$Port ..."
    # 127.0.0.1: so o tunel acessa; o servidor nao fica exposto na rede local.
    $env:HOST = '127.0.0.1'
    $env:PORT = "$Port"
    $env:NODE_ENV = 'production'
    $server = Start-Process node -ArgumentList 'server/prod.js' -WorkingDirectory $Root -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $LogDir 'server.log') -RedirectStandardError (Join-Path $LogDir 'server-erro.log')

    $ready = $false
    for ($i = 0; $i -lt 60 -and -not $server.HasExited; $i++) {
        try {
            Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2 | Out-Null
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $ready) { Stop-WithError "Servidor nao respondeu. Veja $LogDir\server-erro.log" }

    Write-Step 'Abrindo tunel do Cloudflare...'
    $tunnelLog = Join-Path $LogDir 'tunel.log'
    $tunnel = Start-Process cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Port" `
        -NoNewWindow -PassThru -RedirectStandardError $tunnelLog -RedirectStandardOutput (Join-Path $LogDir 'tunel-saida.log')

    $url = $null
    for ($i = 0; $i -lt 60 -and -not $tunnel.HasExited; $i++) {
        Start-Sleep -Seconds 1
        $log = Get-Content $tunnelLog -Raw -ErrorAction SilentlyContinue
        if ($log -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $url = $Matches[0] }
        if ($url -and $log -match 'Registered tunnel connection') { break }
    }
    if (-not $url) { Stop-WithError "Tunel nao subiu. Veja $tunnelLog" }

    Set-Clipboard $url
    Write-Host ''
    Write-Host '  GLPlayer no ar:' -ForegroundColor Green
    Write-Host "  $url" -ForegroundColor Yellow
    Write-Host '  (link copiado; se nao abrir de primeira, espere 1 minuto e recarregue)'
    Write-Host ''
    Write-Host '  Deixe esta janela aberta. Ctrl+C ou fechar a janela desliga tudo.'
    Write-Host ''

    while (-not $server.HasExited -and -not $tunnel.HasExited) {
        Start-Sleep -Seconds 2
    }
    if ($server.HasExited) { Write-Host "[ERRO] Servidor parou. Veja $LogDir\server-erro.log" -ForegroundColor Red }
    if ($tunnel.HasExited) { Write-Host "[ERRO] Tunel caiu. Veja $tunnelLog" -ForegroundColor Red }
} finally {
    foreach ($p in $tunnel, $server) {
        if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
}
