# Deploy do front para Firebase Hosting (build + firebase deploy).
# Uso (na raiz do projeto):
#   .\scripts\deploy-hosting.ps1
#   .\scripts\deploy-hosting.ps1 -ApiOrigin "https://api.seudominio.com"
#
# Se não passar -ApiOrigin, o script usa variáveis de `.env.production` (se existir).

param(
  [Parameter(Mandatory = $false)]
  [string] $ApiOrigin
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $ProjectRoot

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

if ($ApiOrigin -and $ApiOrigin.Trim().Length -gt 0) {
  $trim = $ApiOrigin.Trim().TrimEnd('/')
  $env:VITE_API_ORIGIN = $trim
  Write-Step "VITE_API_ORIGIN definido para esta sessão: $trim"
}
elseif (Test-Path -LiteralPath (Join-Path $ProjectRoot '.env.production')) {
  Write-Step "A usar variáveis de .env.production (inclui VITE_API_ORIGIN se definires lá)."
}
else {
  Write-Host ""
  Write-Host "Falta a URL da API no build." -ForegroundColor Yellow
  Write-Host " Opcao A: copie env.production.template para .env.production e edite VITE_API_ORIGIN."
  Write-Host " Opcao B: execute com -ApiOrigin, por exemplo:"
  Write-Host '   .\scripts\deploy-hosting.ps1 -ApiOrigin "https://api.seudominio.com"'
  Write-Host ""
  exit 1
}

Write-Step "npm run build"
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step "firebase deploy --only hosting"
firebase deploy --only hosting
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Pronto. Site (Firebase): https://zapflow25.web.app (projeto default)." -ForegroundColor Green
Write-Host "Lembrete: na API, ALLOWED_ORIGINS deve incluir a URL do site (ex.: https://zapflow25.web.app)." -ForegroundColor DarkGray
