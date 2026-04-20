@echo off
chcp 65001 >nul
color 0B
cls

echo ╔════════════════════════════════════════════════════════════╗
echo ║            ZapMass v2.6.0 - Aquecer Numeros               ║
echo ║                 Modo Headful (Visivel)                    ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo Este modo abre o WhatsApp Web VISIVEL para aquecer numeros.
echo Abra as conversas manualmente uma vez e depois marque como aquecido no sistema.
echo.

set HEADFUL_MODE=true

REM Iniciar o sistema em modo headful
call npm run dev

pause
