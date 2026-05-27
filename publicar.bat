@echo off
chcp 65001 >nul
echo.
echo  ╔══════════════════════════════════════╗
echo  ║     PUBLICAR ACTUALIZACIÓN           ║
echo  ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0"

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
