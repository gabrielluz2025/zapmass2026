# Executa o teste de staging Evolution sharding na VPS via SSH.
#
# PowerShell (no PC, com chave SSH ou senha configurada):
#   cd "...\zapmass-sender novo"
#   .\deployment\rodar-staging-shard-vps.ps1
#   .\deployment\rodar-staging-shard-vps.ps1 -Limpar
#   .\deployment\rodar-staging-shard-vps.ps1 -SemClientes
#
param(
    [string]$SshTarget = "root@2.24.210.220",
    [string]$RemoteDir = "/opt/zapmass",
    [switch]$Limpar,
    [switch]$SemClientes
)

$ErrorActionPreference = "Stop"

$flags = ""
if ($Limpar) { $flags += " --limpar" }
if ($SemClientes) { $flags += " --sem-clientes" }

$remoteCmd = @"
set -e
cd $RemoteDir
bash deployment/ensure-git-main.sh
chmod +x deployment/*.sh deployment/clientes/scripts/*.sh 2>/dev/null || true
bash deployment/test-evolution-shard-staging.sh$flags
"@

Write-Host "Destino: ${SshTarget}:${RemoteDir}"
Write-Host "Comando remoto: test-evolution-shard-staging.sh$flags"
Write-Host ""

ssh $SshTarget $remoteCmd

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Falhou (exit $LASTEXITCODE). Se Permission denied, configure chave SSH:" -ForegroundColor Red
    Write-Host "  Ver: deployment/HOSTINGER-GITHUB-SSH.md"
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "OK - teste concluido na VPS." -ForegroundColor Green
