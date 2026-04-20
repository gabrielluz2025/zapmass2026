@echo off
chcp 65001 >nul
color 0A
cls

echo ╔════════════════════════════════════════════════════════════╗
echo ║                                                            ║
echo ║              ZapMass v2.6.0 - Modo Hibrido               ║
echo ║                                                            ║
echo ║          Sistema de Envio com WhatsApp Web API            ║
echo ║                                                            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │ PASSO 1: Parando processos anteriores...                  │
echo └────────────────────────────────────────────────────────────┘

REM Matar processos Node na porta 3001
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; try { $pids = Get-NetTCPConnection -LocalPort 3001 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($pid in $pids) { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue; Write-Host '  ✓ Processo parado' -ForegroundColor Green } } catch { Write-Host '  ℹ Nenhum processo ativo' -ForegroundColor Yellow }"

timeout /t 2 /nobreak >nul

echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │ PASSO 2: Iniciando ZapMass v2.6.0...                      │
echo └────────────────────────────────────────────────────────────┘
echo.
echo  ⚡ NOVA VERSÃO: Modo hibrido gratis
echo  ✅ Envio automatico para numeros aquecidos
echo  ✅ Numeros novos vao para lista de aquecimento
echo  ✅ Use AQUECER_NUMEROS.bat quando precisar abrir conversas
echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │ INSTRUÇÕES RÁPIDAS:                                        │
echo └────────────────────────────────────────────────────────────┘
echo.
echo  1. Aguarde servidor iniciar (porta 3001)
echo  2. Abra http://localhost:8000 no navegador
echo  3. Crie campanha normalmente
echo  4. Se algum numero falhar, ele vai para aquecimento
echo  5. Rode AQUECER_NUMEROS.bat e abra as conversas
echo  6. Marque como aquecido na tela de campanhas
echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │ LOGS IMPORTANTES:                                          │
echo └────────────────────────────────────────────────────────────┘
echo.
echo  Procure por:
echo   [Campaign:WARN] Aquecimento necessario
echo   [Queue] ✅ Mensagem enviada!
echo.
echo ════════════════════════════════════════════════════════════
echo.

REM Verificar se npm existe
where npm >nul 2>&1
if errorlevel 1 (
    echo.
    echo ❌ ERRO: NPM não encontrado!
    echo.
    echo Possíveis soluções:
    echo  1. Abra um NOVO PowerShell ou CMD
    echo  2. Execute: npm run dev
    echo.
    pause
    exit /b 1
)

echo ✓ NPM encontrado
echo.

REM Iniciar o sistema
echo Iniciando servidor...
call npm run dev

if errorlevel 1 (
    echo.
    echo ❌ ERRO ao iniciar o servidor!
    echo.
    pause
)

pause
