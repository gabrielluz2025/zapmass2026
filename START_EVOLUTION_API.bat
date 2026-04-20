@echo off
echo ========================================
echo Evolution API - Inicializar
echo ========================================
echo.
echo Escolha o metodo de instalacao:
echo.
echo 1) Docker (Recomendado - mais simples)
echo 2) Manual (Clone do repositorio)
echo 3) Ja esta rodando (pular)
echo.
set /p choice="Escolha (1/2/3): "

if "%choice%"=="1" goto docker
if "%choice%"=="2" goto manual
if "%choice%"=="3" goto skip
goto end

:docker
echo.
echo Verificando Docker...
docker --version >nul 2>&1
if errorlevel 1 (
    echo ERRO: Docker nao esta instalado!
    echo.
    echo Instale Docker Desktop: https://www.docker.com/products/docker-desktop
    pause
    goto end
)

echo.
echo Parando container anterior (se existir)...
docker stop evolution-api >nul 2>&1
docker rm evolution-api >nul 2>&1

echo.
echo Iniciando Evolution API via Docker...
docker run -d ^
  -p 8080:8080 ^
  -e AUTHENTICATION_API_KEY=zapmass-secure-key-2026 ^
  --name evolution-api ^
  atendai/evolution-api:latest

echo.
echo ========================================
echo Evolution API iniciada!
echo URL: http://localhost:8080
echo API Key: zapmass-secure-key-2026
echo ========================================
echo.
echo Aguarde 10 segundos para inicializar...
timeout /t 10 /nobreak
goto end

:manual
echo.
echo Instalacao manual:
echo.
echo 1. Clone o repositorio:
echo    git clone https://github.com/EvolutionAPI/evolution-api.git
echo.
echo 2. Entre na pasta:
echo    cd evolution-api
echo.
echo 3. Instale dependencias:
echo    npm install
echo.
echo 4. Copie .env.example para .env
echo    cp .env.example .env
echo.
echo 5. Edite .env e configure:
echo    AUTHENTICATION_API_KEY=zapmass-secure-key-2026
echo    SERVER_PORT=8080
echo.
echo 6. Inicie o servidor:
echo    npm run start:dev
echo.
pause
goto end

:skip
echo.
echo OK! Continuando...
goto end

:end
echo.
echo Agora inicie o ZapMass:
echo npm run dev
echo.
pause
