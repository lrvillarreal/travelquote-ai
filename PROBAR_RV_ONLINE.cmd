@echo off
setlocal
cd /d "%~dp0"
title Viajes AGYL - Piloto RV Online
where node.exe >nul 2>nul
if errorlevel 1 goto :node_missing
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 goto :node_missing
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo No se encontro npm.cmd. Revisa tu instalacion de Node.js.
  goto :failed
)
echo Preparando las dependencias del piloto...
call npm.cmd ci --ignore-scripts --no-audit --no-fund
if errorlevel 1 goto :failed
node scripts\rv-pilot.mjs %*
if errorlevel 3 goto :failed
if errorlevel 2 goto :partial
if errorlevel 1 goto :failed
echo.
echo Consulta terminada. El resultado aparece en la carpeta data\rv-pilot.
pause
exit /b 0
:partial
echo.
echo Consulta parcial: se conservaron los hoteles. Los traslados siguen pendientes.
echo Revisa arriba el paso que fallo y el resultado en data\rv-pilot.
pause
exit /b 2
:node_missing
echo Se necesita Node.js 24 o posterior desde https://nodejs.org/.
:failed
echo.
echo El piloto no termino correctamente. Revisa el mensaje anterior.
pause
exit /b 1
