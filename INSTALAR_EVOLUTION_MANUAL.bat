@echo off
chcp 65001 >nul
cls
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║                                                            ║
echo ║         Evolution API - Instalação Manual (SEM Docker)    ║
echo ║                                                            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo.
echo  Este script vai instalar Evolution API MANUALMENTE.
echo  Não precisa de Docker!
echo.
echo  Tempo estimado: 5-10 minutos
echo.
pause

echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │  PASSO 1/6: Verificando Git...                            │
echo └────────────────────────────────────────────────────────────┘
echo.

git --version >nul 2>&1
if errorlevel 1 (
    echo  ❌ Git não está instalado!
    echo.
    echo  Baixe em: https://git-scm.com/download/win
    echo.
    pause
    exit /b 1
)

echo  ✓ Git encontrado!

echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │  PASSO 2/6: Verificando Node.js...                        │
echo └────────────────────────────────────────────────────────────┘
echo.

node --version >nul 2>&1
if errorlevel 1 (
    echo  ❌ Node.js não está instalado!
    echo.
    pause
    exit /b 1
)

echo  ✓ Node.js encontrado!

echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │  PASSO 3/6: Clonando Evolution API...                     │
echo └────────────────────────────────────────────────────────────┘
echo.

cd /d C:\

if exist evolution-api (
    echo  Pasta evolution-api já existe!
    echo  Deseja apagar e clonar novamente? [S/N]
    set /p resposta=
    if /i "%resposta%"=="S" (
        rmdir /s /q evolution-api
        echo  ✓ Pasta removida
    ) else (
        echo  ✓ Usando pasta existente
        goto install_deps
    )
)

echo  Clonando repositório...
git clone https://github.com/EvolutionAPI/evolution-api.git

if errorlevel 1 (
    echo.
    echo  ❌ Erro ao clonar repositório!
    pause
    exit /b 1
)

echo  ✓ Repositório clonado!

:install_deps
echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │  PASSO 4/6: Instalando dependências...                    │
echo └────────────────────────────────────────────────────────────┘
echo.
echo  ⏳ Isso pode demorar 3-5 minutos...
echo.

cd C:\evolution-api
npm install

if errorlevel 1 (
    echo.
    echo  ❌ Erro ao instalar dependências!
    pause
    exit /b 1
)

echo  ✓ Dependências instaladas!

echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │  PASSO 5/6: Configurando .env...                          │
echo └────────────────────────────────────────────────────────────┘
echo.

if exist .env (
    echo  Arquivo .env já existe!
    echo  Deseja sobrescrever? [S/N]
    set /p resposta2=
    if /i "%resposta2%"=="N" goto start_server
)

echo # Evolution API Configuration > .env
echo AUTHENTICATION_API_KEY=zapmass-secure-key-2026 >> .env
echo SERVER_PORT=8080 >> .env
echo LOG_LEVEL=INFO >> .env
echo NODE_ENV=development >> .env
echo WEBHOOK_ENABLED=true >> .env
echo DATABASE_ENABLED=false >> .env

echo  ✓ Arquivo .env criado!

:start_server
echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │  PASSO 6/6: Iniciando Evolution API...                    │
echo └────────────────────────────────────────────────────────────┘
echo.
echo  🚀 Iniciando servidor...
echo.
echo  ┌─────────────────────────────────────┐
echo  │  Evolution API                      │
echo  │  URL: http://localhost:8080         │
echo  │  API Key: zapmass-secure-key-2026   │
echo  │  Manager: http://localhost:8080/manager │
echo  └─────────────────────────────────────┘
echo.
echo  ⚠️  NÃO FECHE ESTA JANELA!
echo  ⚠️  Este terminal precisa ficar aberto!
echo.
echo ════════════════════════════════════════════════════════════
echo.

npm run start:dev

pause
