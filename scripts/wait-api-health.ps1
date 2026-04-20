param(
    [string]$Uri = 'http://127.0.0.1:3001/api/health',
    [int]$TimeoutSec = 120
)

$ErrorActionPreference = 'SilentlyContinue'
$deadline = (Get-Date).AddSeconds($TimeoutSec)

while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) {
            Write-Host "[wait-api-health] OK: $Uri"
            exit 0
        }
    } catch {}

    Start-Sleep -Milliseconds 400
}

Write-Host "[wait-api-health] Timeout apos ${TimeoutSec}s: $Uri"
exit 1
