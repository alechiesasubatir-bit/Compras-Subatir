@echo off
chcp 65001 >nul
echo.
echo  ╔══════════════════════════════════════╗
echo  ║     PUBLICAR ACTUALIZACIÓN           ║
echo  ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: La app de Depósitos se recarga sola cuando ve una versión nueva.
:: El número va en dos archivos que tienen que coincidir, así que se
:: escriben acá y no a mano. Si algo falla, no se publica: es peor
:: subir con las versiones desincronizadas.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bump-version.ps1"
if errorlevel 1 (
  echo.
  echo  ✗ No se pudo actualizar la version. No se publico nada.
  pause
  exit /b 1
)

git add .

set /p msg="Descripcion del cambio (Enter para usar fecha): "
if "%msg%"=="" (
    for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set hoy=%%c-%%b-%%a
    for /f "tokens=1-2 delims=: " %%a in ("%time%") do set hora=%%a:%%b
    set msg=Actualizacion %hoy% %hora%
)

git commit -m "%msg%"
git push

echo.
echo  ✓ Publicado. La pagina se actualiza en 1-2 minutos.
echo  URL: https://alechiesasubatir-bit.github.io/Compras-Subatir/
echo.
pause
