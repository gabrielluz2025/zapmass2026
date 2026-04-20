param(
    [Parameter(Mandatory=$true)]
    [int]$Port
)

$ErrorActionPreference = 'SilentlyContinue'

function Get-PortPids {
    param([int]$P)
    $ids = @()
    try {
        $conns = Get-NetTCPConnection -LocalPort $P -ErrorAction SilentlyContinue
        if ($conns) {
            $ids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
        }
    } catch {}

    if (-not $ids -or $ids.Count -eq 0) {
        try {
            $raw = netstat -ano | Select-String ":$P\s" | ForEach-Object { $_.ToString().Trim() }
            foreach ($line in $raw) {
                $parts = ($line -split '\s+')
                $candidate = $parts[$parts.Length - 1]
                if ($candidate -match '^\d+$') { $ids += [int]$candidate }
            }
            $ids = $ids | Select-Object -Unique
        } catch {}
    }
    return $ids
}

function Kill-PortPids {
    param([int]$P)
    $ids = Get-PortPids -P $P
    if ($ids -and $ids.Count -gt 0) {
        foreach ($procId in $ids) {
            if ($procId -and $procId -ne 0) {
                try {
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                    Write-Host "[kill-port] Encerrado PID $procId na porta $P"
                } catch {}
            }
        }
    }
}

Write-Host "[kill-port] Liberando porta $Port..."

for ($attempt = 1; $attempt -le 10; $attempt++) {
    Kill-PortPids -P $Port
    Start-Sleep -Milliseconds 600
    $remaining = Get-PortPids -P $Port
    if (-not $remaining -or $remaining.Count -eq 0) {
        Write-Host "[kill-port] Porta $Port livre (tentativa $attempt)."
        exit 0
    }
    Write-Host "[kill-port] Porta $Port ainda ocupada por $($remaining -join ', '). Retentando ($attempt/10)..."
}

Write-Warning "[kill-port] Nao foi possivel liberar a porta $Port apos 10 tentativas. Prosseguindo mesmo assim."
exit 0
