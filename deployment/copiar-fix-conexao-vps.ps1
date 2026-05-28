# Copia ficheiros do fix "conexao visivel + sync" para a VPS.
# PowerShell no PC: cd "...\zapmass-sender novo" ; .\deployment\copiar-fix-conexao-vps.ps1
param(
    [string]$SshTarget = "root@2.24.210.220",
    [string]$RemoteDir = "/opt/zapmass"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent

$files = @(
    @{ Local = "server\evolutionService.ts"; Remote = "server/evolutionService.ts" },
    @{ Local = "server\connectionsSyncRoutes.ts"; Remote = "server/connectionsSyncRoutes.ts" },
    @{ Local = "server\server.ts"; Remote = "server/server.ts" },
    @{ Local = "src\utils\connectionScope.ts"; Remote = "src/utils/connectionScope.ts" },
    @{ Local = "src\context\ZapMassContext.tsx"; Remote = "src/context/ZapMassContext.tsx" }
)

Write-Host "Origem: $Root"
Write-Host "Destino: ${SshTarget}:${RemoteDir}"
foreach ($f in $files) {
    $lp = Join-Path $Root $f.Local
    if (-not (Test-Path $lp)) { throw "Ficheiro em falta: $lp" }
    $rp = "$RemoteDir/$($f.Remote)"
    Write-Host " -> $rp"
    scp $lp "${SshTarget}:${rp}"
}

Write-Host ""
Write-Host "OK. Na VPS execute:"
Write-Host "  cd /opt/zapmass"
Write-Host "  grep -c syncConnectionsForOwner server/evolutionService.ts   # deve ser >= 1"
Write-Host "  docker build -t zapmass:latest ."
Write-Host "  docker service update --force --image zapmass:latest zapmass_api"
