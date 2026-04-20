@echo off
chcp 65001 >nul
cls
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║                                                            ║
echo ║              ZapMass v2.3.0 - Evolution API                ║
echo ║                                                            ║
echo ║        Sistema de Envio em Massa para WhatsApp            ║
echo ║                                                            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │  PASSO 1: Inicializar Evolution API                       │
echo └────────────────────────────────────────────────────────────┘
echo.
echo  A Evolution API fornece a conexão com WhatsApp (99%% estável)
echo.
echo  Escolha o método de instalação:
echo.
echo    [1] Docker          (Mais simples - recomendado)
echo    [2] Manual          (Clone do repositório)
echo    [3] Já está rodando (Pular este passo)
echo    [0] Cancelar
echo.
set /p choice="  Digite sua escolha (1/2/3/0): "

if "%choice%"=="0" goto end
if "%choice%"=="3" goto start_zapmass
if "%choice%"=="1" goto docker
if "%choice%"=="2" goto manual

echo.
echo  ❌ Opção inválida!
timeout /t 2 >nul
goto end

:docker
echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │  DOCKER: Iniciando Evolution API...                       │
echo └────────────────────────────────────────────────────────────┘
echo.

docker --version >nul 2>&1
if errorlevel 1 (
    echo  ❌ ERRO: Docker não está instalado!
    echo.
    echo  Instale Docker Desktop:
    echo  https://www.docker.com/products/docker-desktop
    echo.
    pause
    goto end
)

echo  ✓ Docker encontrado!
echo.
echo  Parando container anterior (se existir)...
docker stop evolution-api >nul 2>&1
docker rm evolution-api >nul 2>&1

echo  Baixando e iniciando Evolution API...
echo.
docker run -d ^
  -p 8080:8080 ^
  -e AUTHENTICATION_API_KEY=zapmass-secure-key-2026 ^
  -e SERVER_PORT=8080 ^
  -e LOG_LEVEL=INFO ^
  --name evolution-api ^
  atendai/evolution-api:latest

if errorlevel 1 (
    echo.
    echo  ❌ Erro ao iniciar Docker container!
    echo.
    pause
    goto end
)

echo.
echo  ✓ Evolution API iniciada com sucesso!
echo.
echo  ┌─────────────────────────────────────┐
echo  │  Evolution API                      │
echo  │  URL: http://localhost:8080         │
echo  │  API Key: zapmass-secure-key-2026   │
echo  └─────────────────────────────────────┘
echo.
echo  Aguardando inicialização (15 segundos)...
timeout /t 15 /nobreak >nul

goto start_zapmass

:manual
echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │  MANUAL: Instruções para Instalação                       │
echo └────────────────────────────────────────────────────────────┘
echo.
echo  Execute os seguintes comandos em OUTRO terminal:
echo.
echo    git clone https://github.com/EvolutionAPI/evolution-api.git
echo    cd evolution-api
echo    npm install
echo    cp .env.example .env
echo.
echo  Edite o arquivo .env e configure:
echo    AUTHENTICATION_API_KEY=zapmass-secure-key-2026
echo    SERVER_PORT=8080
echo.
echo  Então inicie o servidor:
echo    npm run start:dev
echo.
echo  Quando a Evolution API estiver rodando, pressione qualquer tecla...
pause >nul

goto start_zapmass

:start_zapmass
echo.
echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │  PASSO 2: Iniciando ZapMass...                            │
echo └────────────────────────────────────────────────────────────┘
echo.

echo  Parando processos anteriores...
powershell -NoProfile -Command "Get-Process | Where-Object { $_.ProcessName -match 'node' -and $_.ProcessName -ne 'docker' } | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1
timeout /t 2 /nobreak >nul

echo  ✓ Processos limpos
echo.
echo  Iniciando servidores...
echo.
echo  ┌─────────────────────────────────────┐
echo  │  ZapMass Frontend                   │
echo  │  URL: http://localhost:8000         │
echo  └─────────────────────────────────────┘
echo.
echo  ┌─────────────────────────────────────┐
echo  │  ZapMass Backend                    │
echo  │  URL: http://localhost:3001         │
echo  └─────────────────────────────────────┘
echo.
echo  ┌─────────────────────────────────────┐
echo  │  Evolution API                      │
echo  │  URL: http://localhost:8080         │
echo  └─────────────────────────────────────┘
echo.
echo ════════════════════════════════════════════════════════════
echo.
echo  🚀 INICIANDO ZAPMASS v2.3.0...
echo.
echo ════════════════════════════════════════════════════════════
echo.

npm run dev

:end
echo.
echo  Pressione qualquer tecla para sair...
pause >nul
