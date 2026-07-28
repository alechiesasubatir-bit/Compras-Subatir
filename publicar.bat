@echo off
chcp 65001 >nul
echo.
echo  ==========================================
echo        PUBLICAR ACTUALIZACION
echo  ==========================================
echo.

cd /d "%~dp0"

:: OJO: este archivo tiene que quedar en ASCII y con saltos CRLF.
:: cmd.exe recorre el .bat por posicion de bytes, asi que con acentos
:: o cajas UTF-8 el parser se desfasa despues del chcp y empieza a
:: comerse el principio de cada linea. Hay una regla en .gitattributes
:: para que git no lo pase a LF al clonar.

:: La app de Depositos se recarga sola cuando ve una version nueva.
:: El numero va en dos archivos que tienen que coincidir, asi que se
:: escriben aca y no a mano. Si algo falla, no se publica: es peor
:: subir con las versiones desincronizadas.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bump-version.ps1"
if errorlevel 1 (
  echo.
  echo  ERROR: no se pudo actualizar la version. No se publico nada.
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
echo  Publicado. La pagina se actualiza en 1-2 minutos.
echo  URL: https://alechiesasubatir-bit.github.io/Compras-Subatir/
echo.
pause
