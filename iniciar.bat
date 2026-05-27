@echo off
title Dashboard Compras - Subatir / Prolimpio
chcp 65001 >nul 2>&1
echo.
echo  ╔══════════════════════════════════════════╗
echo  ║    SUBATIR - Dashboard de Compras        ║
echo  ║    Iniciando servidor local...           ║
echo  ╚══════════════════════════════════════════╝
echo.
cd /d "%~dp0"

:: Intentar con "python"
python --version >nul 2>&1
if %errorlevel% == 0 (
  echo  OK: Python encontrado.
  echo  Servidor en:  http://localhost:8080
  echo  Presiona Ctrl+C para detener.
  echo.
  timeout /t 1 /nobreak >nul
  start "" "http://localhost:8080"
  python -m http.server 8080
  goto fin
)

:: Intentar con "py" (launcher de Windows)
py --version >nul 2>&1
if %errorlevel% == 0 (
  echo  OK: Python (py) encontrado.
  echo  Servidor en:  http://localhost:8080
  echo  Presiona Ctrl+C para detener.
  echo.
  timeout /t 1 /nobreak >nul
  start "" "http://localhost:8080"
  py -m http.server 8080
  goto fin
)

echo  AVISO: Python no encontrado en este equipo.
echo.
echo  Opciones:
echo    1) Instalar Python desde https://python.org  (recomendado)
echo    2) Abrir index.html directamente - puede fallar por CORS.
echo.
echo  Abriendo index.html de todas formas...
start "" "%~dp0index.html"

:fin
pause
