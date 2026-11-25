@echo off
setlocal
cd /d "%~dp0"
title Viajes AGYL - TravelQuote
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Instala Node.js 24 LTS desde https://nodejs.org/ y vuelve a abrir este archivo.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
  echo Se necesita Node.js 24 o posterior. Actualiza Node.js y vuelve a intentar.
  pause
  exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo No se encontro npm.cmd. Reinstala Node.js 24 LTS desde https://nodejs.org/.
  pause
  exit /b 1
)
if not exist node_modules\exceljs\package.json (
  echo Preparando dependencias. Este paso necesita internet la primera vez.
  call npm.cmd ci --ignore-scripts --no-audit --no-fund
  if errorlevel 1 goto :failed
)
echo Compilando TravelQuote...
call npm.cmd run build
if errorlevel 1 goto :failed
node scripts\launch.mjs
if errorlevel 1 goto :failed
exit /b 0
:failed
echo.
echo No se pudo iniciar TravelQuote. El error aparece arriba.
pause
exit /b 1
