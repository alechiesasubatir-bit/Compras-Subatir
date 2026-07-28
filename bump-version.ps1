# ============================================================
#  Sube la version de la app de Depositos.
#
#  El numero vive en DOS lugares que tienen que coincidir:
#    - deposito/version.json      (lo que la app consulta)
#    - deposito/index.html        (window.APP_VER, lo que la app es)
#
#  Si se desincronizan: cambiar solo el JSON hace que cada pestana
#  recargue una vez al pedo y siga igual; cambiar solo el HTML no
#  recarga a nadie. Por eso se escriben juntos aca y no a mano.
#
#  Lo llama publicar.bat antes del commit.
# ============================================================

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$vj = Join-Path $raiz 'deposito\version.json'
$ix = Join-Path $raiz 'deposito\index.html'

if (-not (Test-Path $vj) -or -not (Test-Path $ix)) {
  Write-Host '  AVISO: falta deposito/version.json o deposito/index.html.'
  Write-Host '         Se publica igual, pero sin tocar la version.'
  exit 0
}

$v = Get-Date -Format 'yyyy-MM-dd.HHmm'

# UTF-8 SIN BOM a proposito: con BOM, el JSON.parse del navegador
# falla al leer version.json y el chequeo de version deja de andar.
$utf8 = New-Object System.Text.UTF8Encoding $false

$j  = [System.IO.File]::ReadAllText($vj)
$j2 = [regex]::Replace($j, '("v"\s*:\s*")[^"]*(")', ('${1}' + $v + '${2}'))

$h  = [System.IO.File]::ReadAllText($ix)
$h2 = [regex]::Replace($h, "(window\.APP_VER\s*=\s*')[^']*(')", ('${1}' + $v + '${2}'))

# Si algun reemplazo no encontro su lugar, mejor frenar que publicar
# con las dos versiones desincronizadas.
if ($j2 -eq $j) {
  Write-Host '  ERROR: no se encontro el campo "v" en deposito/version.json.'
  exit 1
}
if ($h2 -eq $h) {
  Write-Host '  ERROR: no se encontro window.APP_VER en deposito/index.html.'
  exit 1
}

[System.IO.File]::WriteAllText($vj, $j2, $utf8)
[System.IO.File]::WriteAllText($ix, $h2, $utf8)

Write-Host "  Version de Depositos: $v"
