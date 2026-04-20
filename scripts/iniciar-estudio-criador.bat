@echo off
setlocal EnableExtensions
chcp 65001 >nul
title ZapMass — Estudio do criador
cd /d "%~dp0\.."

echo.
echo  ============================================================
echo   ZapMass — Estudio do criador (dev)
echo  ============================================================
echo   Backend: porta 3001   Frontend: porta 8000
echo   Assinatura desligada + menu "Estudio criador"
echo.
echo   Defina seu e-mail (MESMO Google do login), de UM destes jeitos:
echo   A^) Arquivo  scripts\creator-email.txt  com UMA linha so, ex.:
echo        voce@gmail.com
echo   B^) Editar a linha "set CREATOR_EMAIL=..." mais abaixo
echo   C^) Se ainda estiver o texto padrao, o script vai PERGUNTAR o e-mail
echo  ============================================================
echo.

set "CREATOR_EMAIL="

if exist "%~dp0creator-email.txt" (
  for /f "usebackq eol=# tokens=* delims=" %%a in ("%~dp0creator-email.txt") do (
    set "CREATOR_EMAIL=%%a"
    goto _afterfile
  )
)
:_afterfile

if not defined CREATOR_EMAIL set "CREATOR_EMAIL=COLOQUE_SEU_EMAIL@gmail.com"

call :precisa_corrigir_email
if errorlevel 1 (
  echo.
  echo  Digite o e-mail do Google que voce usa para entrar no ZapMass:
  set /p "CREATOR_EMAIL=> "
)

call :precisa_corrigir_email
if errorlevel 1 (
  echo.
  echo [ERRO] E-mail invalido. Exemplos validos: voce@gmail.com   contato@empresa.com.br
  echo        Opcao A: crie scripts\creator-email.txt com uma linha ^(sugestao^).
  echo        Opcao B: edite este .bat na linha set CREATOR_EMAIL=...
  echo.
  pause
  exit /b 1
)

echo [OK] Conta: %CREATOR_EMAIL%
echo.

set "VITE_CREATOR_STUDIO=true"
set "VITE_ENFORCE_SUBSCRIPTION=false"
set "VITE_ADMIN_EMAILS=%CREATOR_EMAIL%"
set "ADMIN_EMAILS=%CREATOR_EMAIL%"

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERRO] npm nao encontrado. Instale Node.js LTS e marque "Add to PATH".
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [INFO] Instalando dependencias ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo [ERRO] npm install falhou.
    pause
    exit /b 1
  )
)

echo [INFO] Abrindo http://localhost:8000 em ~12 s...
start "" /B cmd /c "timeout /t 12 /nobreak >nul && start http://localhost:8000/"

echo [INFO] Iniciando npm run dev ...
echo.
call npm run dev
echo.
if errorlevel 1 pause
endlocal
goto :eof

:precisa_corrigir_email
REM retorna errorlevel 1 se PRECISA corrigir (e-mail ruim ou placeholder)
if not defined CREATOR_EMAIL exit /b 1
if /I "%CREATOR_EMAIL%"=="COLOQUE_SEU_EMAIL@gmail.com" exit /b 1
echo.%CREATOR_EMAIL%| findstr /R "@.*\." >nul
if errorlevel 1 exit /b 1
exit /b 0
