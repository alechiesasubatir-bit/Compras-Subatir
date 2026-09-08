# Previsión Cloro — previsión de envasado y compra de materia prima

Fecha: 2026-09-08
Estado: diseño pendiente de aprobación del usuario

## 1 · El problema

La línea de piscinas es **estacional y corta**: se vende de agosto a marzo y el resto del
año no existe. Son 13 productos que se envasan contra pedido semana a semana, y la
materia prima —cloro— se compra importada, con lo cual la decisión de comprar se toma
meses antes de la venta que la justifica.

Hoy eso se decide mirando planillas de ventas por producto exportadas del ERP, una por
producto y por temporada. No hay ningún lugar donde estén juntas, ni donde se vea qué se
envasó contra qué se vendió, ni cuántos kg de cloro hacen falta para el envasado que
viene.

## 2 · Los datos que hay

Dos temporadas completas, 13 productos, mismos códigos en las dos. Formato del ERP:
`Fecha · Documento · Cod. Art. · Descripción · Cantidad`, una fila por línea de factura,
**cantidad en unidades vendidas, no en kg**. Archivos `.xls` binarios (Excel 97), no
`.xlsx`.

| Producto | Cód. | 2024-25 | 2025-26 | var |
|---|---|---:|---:|---:|
| Pastilla Triple Acción Piscinas x 1 Kg | 218801 | 19.498 | 22.253 | +14,1% |
| Cloro Shock x 240 g | 2150250 | 10.681 | 13.227 | +23,8% |
| Cloro Shock x 900 g | 2150950 | 10.676 | 11.075 | +3,7% |
| Pastilla Triple Acción Piscinas x 3 Unidades | 218803 | 6.823 | 7.931 | +16,2% |
| Regulador PH MAS x 2 Kg | 219727 | 3.912 | 3.986 | +1,9% |
| Pastilla Triple Acción Piscinas x 4 Kg | 218804 | 3.216 | 3.320 | +3,2% |
| Pastilla Cloro Jacuzzis/Piscinas x 50 g x 5 uni | 218905 | 2.932 | 3.599 | +22,7% |
| Cloro Shock x 3.5 Kg | 2153500 | 2.474 | 2.415 | −2,4% |
| Regulador PH Menos x 4 Kg | 219729 | 976 | 1.125 | +15,3% |
| Cloro Granulado x 4 Kg | 21420 | 207 | 163 | −21,3% |
| Cloro Shock x 25 Kgs VENTA | 230137 | 110 | 168 | +52,7% |
| Pastilla Triple Acción Piscinas x 25 Kg | 218825 | 131 | 161 | +22,9% |
| Cloro Granulado x 25 Kg | 21421 | 9 | 31 | +244,4% |

La temporada va del **1/8 al 31/3**: 35 semanas, a veces 36 según dónde caiga el 1/8.

### 2.1 · Lo que se verificó antes de elegir la fórmula

**Semana contra semana, las temporadas se parecen poco; suavizadas, se parecen mucho.**
Correlación entre la serie semanal de 2024-25 y la de 2025-26, con distintas ventanas de
suavizado centrado:

| Producto | crudo | ±1 | ±2 | ±3 |
|---|---:|---:|---:|---:|
| Pastilla Triple Acción 4 Kg | 0,75 | 0,87 | **0,92** | 0,95 |
| Regulador PH Menos 4 Kg | 0,62 | 0,81 | **0,90** | 0,92 |
| Cloro Shock 900 g | 0,66 | 0,76 | **0,85** | 0,90 |
| Pastilla Triple Acción 1 Kg | 0,68 | 0,77 | **0,84** | 0,90 |
| Total de la línea | 0,68 | 0,78 | **0,84** | 0,90 |

El motivo se ve en el pico: en 2024-25 cayó en la semana 27 y en 2025-26 en la 23. Son
pedidos mayoristas grandes que caen en semanas distintas. Predecir con la semana cruda
diría "la semana que viene 15.000 unidades" porque el año pasado justo ahí cargó un
camión. **Por eso la previsión lee el histórico suavizado.**

**Cuatro productos no admiten previsión semanal.** Promedio semanal de la temporada
2025-26:

- Cloro Granulado x 25 Kg: **0,9 u/semana** (correlación −0,17)
- Pastilla Triple Acción x 25 Kg: **4,6 u/semana** (0,39)
- Cloro Granulado x 4 Kg: **4,7 u/semana** (0,16)
- Cloro Shock x 25 Kgs: **4,8 u/semana** (0,26)

El siguiente producto hacia arriba promedia **32 u/semana**. El corte es limpio: cualquier
umbral entre 5 y 30 separa los mismos cuatro. Para ellos la previsión se muestra
**mensual** y la ficha lleva un aviso, en vez de fingir una precisión que los datos no
tienen.

## 3 · Alcance

**Entra:**

- Módulo nuevo `cloro.html`, con su entrada en el menú y su permiso propio (`cloro`).
- Importación de ventas desde los `.xls` del ERP, **varios archivos a la vez**.
- Carga de órdenes de envasado semana a semana.
- Previsión de venta por producto y semana, con el histórico suavizado.
- Stock proyectado de producto terminado, deducido de envasado − ventas.
- Sugerido de envasado y **kg de materia prima a comprar** en un horizonte configurable.
- Configuración por producto: materia prima, kg de MP por unidad, merma, lote.
- Semilla con las dos temporadas históricas ya cargadas.

**No entra:**

- Costos ni precios. El módulo razona en unidades y en kg.
- Emitir órdenes de compra de la MP. Eso ya vive en Pedidos / MP Importación.
- Tocar Stock: el stock de producto terminado de este módulo es una proyección de la
  línea de piscinas, no el inventario general.
- Adivinar qué materia prima lleva cada producto (ver §5.3).

## 4 · Datos

Tablas nuevas, prefijo `cl_`, RLS con `public.has_module('cloro')` igual que el resto.

```
cl_temporadas    id, nombre('2026-2027'), fecha_ini, fecha_fin, activa, nota
cl_materias      id, nombre, activo, nota
cl_productos     id, codigo(unique), nombre, materia_id→cl_materias,
                 kg_mp_por_unidad, merma_pct(0), lote_unidades(1), orden, activo
cl_ventas        id, temporada_id, producto_id, semana, unidades,
                 origen(nombre del archivo), importado_at
                 unique(temporada_id, producto_id, semana)
cl_envasado      id, temporada_id, producto_id, fecha, cantidad, orden(text), nota
cl_stock_inicial temporada_id, producto_id, cantidad     PK(temporada_id, producto_id)
cl_parametros    temporada_id PK, suavizado_semanas(5), horizonte_semanas(8),
                 semanas_seguridad(2), crecimiento_pct(null=automático),
                 umbral_baja_rotacion(10), updated_at
```

**`cl_ventas` guarda semanas agregadas, no líneas de factura.** El detalle factura por
factura ya vive en el ERP y acá serían ~35.000 filas para dibujar exactamente el mismo
gráfico. La semana es el grano en el que el módulo piensa.

**Semana 1 = el lunes de la semana que contiene `fecha_ini`.** Las semanas ISO no sirven:
la temporada cruza el año y la semana 1 ISO cae en enero, en la mitad del pico.

## 5 · El cálculo

Vive en la pantalla, no en la base, para que al mover un parámetro se vea moverse todo —
igual criterio que MP Importación.

### 5.1 · Previsión de venta

```
hist[s][w]   = unidades vendidas en la semana w de la temporada s
suave[s][w]  = promedio de hist[s][w-k .. w+k]      k = (suavizado−1)/2, default ±2
crecimiento  = Σ ventas de esta temporada hasta la semana actual
               ÷ Σ ventas de la anterior en el mismo tramo   − 1
previsión[w] = suave[anterior][w] × (1 + crecimiento)
```

El crecimiento automático necesita temporada cargada para valer algo. **Con menos de 4
semanas** usa el crecimiento de temporada completa de la anterior contra la previa y lo
dice en pantalla. Siempre se puede forzar a mano desde Configuración.

Los productos de baja rotación (promedio semanal de la temporada anterior por debajo de
`umbral_baja_rotacion`) se previenen igual, pero la pantalla **muestra el acumulado
mensual** y marca la ficha.

### 5.2 · Stock y sugerido

```
stock[w] = stock[w-1] + envasado[w] − ventas[w]
```

con `stock[0] = cl_stock_inicial`, ventas reales en las semanas ya cerradas y previstas
en las que vienen. El envasado de las semanas futuras es 0 salvo que haya una orden
cargada con fecha futura.

```
demanda_H  = Σ previsión de las próximas H semanas
colchón    = semanas_seguridad × (demanda_H / H)
sugerido   = techo( max(0, demanda_H + colchón − stock_hoy) / lote ) × lote
```

### 5.3 · Materia prima

```
kg_MP(m) = Σ  sugerido(p) × kg_mp_por_unidad(p) × (1 + merma_pct(p)/100)
          p con materia_id = m
```

**Un producto sin materia prima asignada no se calcula y la pantalla lo dice.** No hay
default: no tengo cómo saber si el Cloro Granulado es hipoclorito de calcio o el Cloro
Shock es dicloro, y una suposición silenciosa acá se convierte en una compra de toneladas
equivocada. Los 13 arrancan sin asignar y Configuración los muestra en rojo hasta que
alguien los asigne.

## 6 · Pantalla

`cloro.html`, mismo lenguaje visual que el resto de Compras. Los tokens CSS se copian del
`:root` de `mp-importacion.html`, no de esta memoria: no todos los módulos usan los mismos
nombres.

- **Barra de contexto**: temporada, semana actual, estado. Botones: ⚙ Configuración,
  📥 Importar ventas, ➕ Orden de envasado, ⬇ CSV, 🖨.
- **KPIs**: ventas de temporada y su variación · envasado · stock hoy · demanda del
  horizonte · **kg de MP a comprar**.
- **Gráfico de temporada**: las temporadas superpuestas por semana de temporada, y la
  previsión continuando la actual en punteado con banda. Marca la semana de hoy. El trazo
  se dibuja al entrar; crosshair y tooltip al recorrerlo.
- **Gráfico de materia prima**: barras apiladas por MP, kg por semana dentro del
  horizonte.
- **Tarjetas por producto**: sparkline de las temporadas, previsión de la semana que
  viene, semanas de cobertura del stock, aviso de baja rotación.
- **Tablas**: por producto (ventas, envasado, stock, previsión, sugerido, kg MP) y por
  materia prima (kg del horizonte y kg del resto de la temporada).

Toda la animación respeta `prefers-reduced-motion`.

## 7 · Importar ventas

SheetJS desde CDN, cargado **sólo al abrir el modal**. Los `.xls` son binarios Excel 97 y
el lector de `.xlsx` del proyecto —que recorre el ZIP a mano— no los abre. Escribir un
lector de ese formato binario es donde un número mal leído se cuela sin avisar, y todas
las cuentas del módulo cuelgan de esas ventas.

- Acepta **varios archivos de una vez** (los 13 de la semana de un tirón).
- Producto por `Cod. Art.`; si el código no está registrado, se lista y se ignora.
- Temporada por el rango de fechas del archivo.
- **Para cada producto, el archivo es la verdad**: reemplaza todas sus semanas de esa
  temporada dentro del rango del archivo, **incluidas las de venta cero**. Una semana sin
  ventas no aparece en el listado, y saltearla dejaría el número de la importación
  anterior mezclado con datos nuevos.
- Previsualización antes de aplicar: qué producto, qué temporada, cuántas semanas, total
  de unidades y diferencia contra lo que ya había.

## 8 · Semilla

`migracion/cloro_seed.sql` con las dos temporadas agregadas por semana (13 productos ×
~35 semanas × 2 = ~900 filas) y los 13 productos, y los totales de la tabla de §2 como
consulta de control al final.

## 9 · Errores y bordes

- Producto sin materia prima → no suma kg, se muestra en rojo en Configuración y en la
  tabla de MP.
- Temporada sin la anterior cargada → no hay previsión; se dice, no se muestra cero.
- Semana fuera del rango de la temporada (un `.xls` con fechas de abril) → se ignora esa
  fila y se avisa cuántas.
- Código de artículo desconocido → se lista al final de la previsualización.
- Crecimiento con denominador cero (producto que el año pasado no existía) → se usa el
  crecimiento general de la línea.
- RLS: todo `update` chequea que vuelva la fila. Un update bloqueado por RLS devuelve cero
  filas **sin error**.

## 10 · Etapas

1. SQL: tablas, RLS, semilla de las dos temporadas y los 13 productos.
2. Pantalla base: contexto, tabla por producto, cálculo y KPIs. Sin gráficos.
3. Configuración: materias primas, asignación, kg por unidad, merma, lote, parámetros.
4. Órdenes de envasado y stock inicial.
5. Importador `.xls` con previsualización.
6. Gráficos y animación.
7. CSV, impresión y verificación en el navegador contra los totales de §2.
