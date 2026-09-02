# ============================================================
#  Sube la version de las DOS apps: Compras (los HTML de la raiz)
#  y Depositos (deposito/).
#
#  Cada app se recarga sola cuando ve una version nueva, y para eso
#  el numero tiene que estar en dos lados que coincidan:
#    - version.json            <- lo que la app consulta (sin cache)
#    - window.APP_VER del HTML <- lo que la app es
#
#  Si se desincronizan: cambiar solo el JSON hace que cada pestana
#  recargue una vez al pedo y siga igual; cambiar solo el HTML no
#  recarga a nadie. Por eso se escriben juntos aca y no a mano.
#
#  Ademas reescribe el ?v= de supabase-config.js, subatir-app.js,
#  deposito-app.js, nav.js/.css y traslados.js/.css en todas las paginas. Antes habia que subirlo a
#  mano con un sed cada vez que se tocaba uno de esos archivos, y
#  olvidarse dejaba a la gente con el JS viejo aunque el HTML fuera
#  nuevo. Ahora sube en cada publicacion.
#
#  Lo llama publicar.bat antes del commit. Si algo no cuadra, corta
#  con exit 1 y no se publica nada: es peor subir desincronizado.
#
#  OJO: mantener este archivo en ASCII (sin acentos ni cajas). Windows
#  PowerShell 5.1 lee los .ps1 en la codepage local si no hay BOM.
# ============================================================

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$v = Get-Date -Format 'yyyy-MM-dd.HHmm'

# UTF-8 SIN BOM a proposito: con BOM, el JSON.parse del navegador
# falla al leer version.json y el chequeo de version muere en silencio.
$utf8 = New-Object System.Text.UTF8Encoding $false

# Los tres reemplazos posibles. El ?v= no lleva grupo 2 porque termina
# donde arranca la comilla del atributo.
$SUB_VER = @{
  pat = '("v"\s*:\s*")[^"]*(")'
  rep = '${1}' + $v + '${2}'
  que = 'el campo "v"'
}
$SUB_APP = @{
  # window.APP_VER en las paginas y self.APP_VER en el service worker
  pat = "((?:window|self)\.APP_VER\s*=\s*')[^']*(')"
  rep = '${1}' + $v + '${2}'
  que = 'window.APP_VER'
}
$SUB_BUST = @{
  pat = '((?:supabase-config|subatir-app|deposito-app|traslados|nav|reposicion-calc)\.(?:js|css)\?v=)[^"'']*'
  rep = '${1}' + $v
  que = 'el ?v= de los scripts compartidos'
}
# La hoja de estilos del celular. Sin ?v= quedaba a merced del cache: el
# service worker guarda './movil.css' por su URL, asi que un cambio de
# diseno podia no llegar nunca al telefono aunque el HTML fuera nuevo.
$SUB_CSS = @{
  pat = '(movil\.css\?v=)[^"'']*'
  rep = '${1}' + $v
  que = 'el ?v= de movil.css'
}

# Modulos de Compras: todos tienen APP_VER y cargan los scripts compartidos.
$modulos = @(
  'index.html', 'pedidos.html', 'recepcion.html', 'stock.html', 'reposicion.html', 'precios.html',
  'proveedores.html', 'varios.html', 'usuarios.html', 'mp-importacion.html'
)

# req = si el archivo existe y no aparece el patron, no se publica.
# opt = se reemplaza si esta, y si no, no pasa nada.
$tareas = @()
$tareas += @{ f = 'version.json'; req = @($SUB_VER); opt = @() }
$tareas += @{ f = 'deposito\version.json'; req = @($SUB_VER); opt = @() }
$tareas += @{ f = 'deposito\index.html'; req = @($SUB_APP); opt = @($SUB_BUST) }
# Las pantallas de celular cargan el mismo deposito-app.js: si su ?v= no
# sube, se quedan con la version vieja del JS compartido para siempre.
$tareas += @{ f = 'deposito\solicitar.html'; req = @($SUB_APP, $SUB_BUST, $SUB_CSS); opt = @() }
$tareas += @{ f = 'deposito\recorrido.html'; req = @($SUB_APP, $SUB_BUST, $SUB_CSS); opt = @() }
$tareas += @{ f = 'deposito\sw.js'; req = @($SUB_APP); opt = @() }
# Compras tambien es instalable: su worker lleva el mismo numero, si no
# el navegador se queda con el cache de la version anterior.
$tareas += @{ f = 'sw.js'; req = @($SUB_APP); opt = @() }
$tareas += @{ f = 'deposito\login.html'; req = @(); opt = @($SUB_BUST) }
$tareas += @{ f = 'login.html'; req = @(); opt = @($SUB_BUST) }
foreach ($m in $modulos) {
  $tareas += @{ f = $m; req = @($SUB_APP, $SUB_BUST); opt = @() }
}

# --- Pasada 1: leer y validar, sin escribir nada -------------
# Se valida todo antes de tocar el disco para no dejar la mitad de
# los archivos en la version nueva y la otra mitad en la vieja.
$errores = @()
$avisos = @()
$pendientes = @()

foreach ($t in $tareas) {
  $ruta = Join-Path $raiz $t.f
  if (-not (Test-Path $ruta)) {
    $avisos += ('no esta ' + $t.f + ', se saltea')
    continue
  }
  $txt = [System.IO.File]::ReadAllText($ruta)
  $out = $txt
  foreach ($s in $t.req) {
    if (-not [regex]::IsMatch($out, $s.pat)) {
      $errores += ($t.f + ': no se encontro ' + $s.que)
      continue
    }
    $out = [regex]::Replace($out, $s.pat, $s.rep)
  }
  foreach ($s in $t.opt) {
    if ([regex]::IsMatch($out, $s.pat)) {
      $out = [regex]::Replace($out, $s.pat, $s.rep)
    }
  }
  if ($out -ne $txt) {
    $pendientes += @{ ruta = $ruta; txt = $out }
  }
}

foreach ($a in $avisos) { Write-Host ('  AVISO: ' + $a) }

if ($errores.Count -gt 0) {
  Write-Host '  ERROR: no se pudo actualizar la version.'
  foreach ($e in $errores) { Write-Host ('         - ' + $e) }
  Write-Host '         No se publico nada.'
  exit 1
}

# --- Pasada 2: escribir --------------------------------------
foreach ($p in $pendientes) {
  [System.IO.File]::WriteAllText($p.ruta, $p.txt, $utf8)
}

Write-Host ("  Version: $v  (" + $pendientes.Count + ' archivos)')
