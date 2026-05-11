@echo off
chcp 65001 >nul
cd /d "%~dp0"

:menu
cls
echo.
echo  ============================================================
echo    ZapMass — menu de arranque (Windows)
echo  ============================================================
echo.
echo   [1]  ZapMass apenas (npm run dev — API 3001, UI 8000)
echo   [2]  Evolution API (Docker) e depois ZapMass
echo   [3]  Evolution API apenas (Docker, porta 8080)
echo   [4]  Instalacao manual da Evolution (script auxiliar)
echo   [5]  Aquecimento — modo headful (WhatsApp visivel)
echo   [6]  Liberar porta 3001 e iniciar ZapMass (diagnostico)
echo   [7]  Estudio criador (script em scripts\)
echo   [0]  Sair
echo.
set /p zm="  Escolha: "

if "%zm%"=="0" exit /b 0
if "%zm%"=="1" goto only_zapmass
if "%zm%"=="2" goto evo_then_zapmass
if "%zm%"=="3" goto only_evo
if "%zm%"=="4" goto manual_evo
if "%zm%"=="5" goto warmup
if "%zm%"=="6" goto free3001
if "%zm%"=="7" goto creator
echo   Opcao invalida.
timeout /t 2 /nobreak >nul
goto menu

:only_zapmass
echo.
echo  Iniciando ZapMass...
call npm run dev
goto after_run

:only_evo
echo.
echo  Evolution API (Docker)...
docker --version >nul 2>&1
if errorlevel 1 (
  echo  ERRO: Docker nao encontrado. Instale Docker Desktop ou use opcao [4].
  pause
  goto menu
)
docker stop evolution-api >nul 2>&1
docker rm evolution-api >nul 2>&1
docker run -d -p 8080:8080 -e AUTHENTICATION_API_KEY=zapmass-secure-key-2026 --name evolution-api atendai/evolution-api:latest
if errorlevel 1 (
  echo  Falha ao subir o container.
  pause
  goto menu
)
echo  OK: http://localhost:8080  (API Key: zapmass-secure-key-2026)
pause
goto menu

:evo_then_zapmass
echo.
docker --version >nul 2>&1
if errorlevel 1 (
  echo  ERRO: Docker nao encontrado.
  pause
  goto menu
)
docker stop evolution-api >nul 2>&1
docker rm evolution-api >nul 2>&1
docker run -d -p 8080:8080 -e AUTHENTICATION_API_KEY=zapmass-secure-key-2026 -e SERVER_PORT=8080 -e LOG_LEVEL=INFO --name evolution-api atendai/evolution-api:latest
if errorlevel 1 (
  echo  Falha ao iniciar Evolution API.
  pause
  goto menu
)
echo  Evolution a subir. Aguarde 15 s...
timeout /t 15 /nobreak >nul
goto free3001_core

:free3001
echo.
echo  Liberando porta 3001...
:free3001_core
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; try { $pids = Get-NetTCPConnection -LocalPort 3001 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($procId in $pids) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } } catch { }"
timeout /t 2 /nobreak >nul
echo  Iniciando ZapMass (npm run dev)...
call npm run dev
goto after_run

:manual_evo
if exist "%~dp0INSTALAR_EVOLUTION_MANUAL.bat" (
  call "%~dp0INSTALAR_EVOLUTION_MANUAL.bat"
) else (
  echo  Arquivo INSTALAR_EVOLUTION_MANUAL.bat nao encontrado.
  pause
)
goto menu

:warmup
if exist "%~dp0AQUECER_NUMEROS.bat" (
  call "%~dp0AQUECER_NUMEROS.bat"
) else (
  echo  Arquivo AQUECER_NUMEROS.bat nao encontrado.
  pause
)
goto menu

:creator
if exist "%~dp0scripts\iniciar-estudio-criador.bat" (
  call "%~dp0scripts\iniciar-estudio-criador.bat"
) else (
  echo  scripts\iniciar-estudio-criador.bat nao encontrado.
  pause
)
goto menu

:after_run
echo.
pause
goto menu
