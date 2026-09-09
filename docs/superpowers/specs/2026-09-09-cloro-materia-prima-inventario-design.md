# Previsión Cloro — materia prima vinculada al inventario real

Fecha: 2026-09-09
Estado: diseño pendiente de aprobación del usuario

## 1 · El problema

Previsión Cloro ya calcula cuántas unidades hay que envasar de cada producto y cuántos kg
de materia prima se van en eso. Lo que no puede decir es **si esos kg están o no**.

Las materias primas del módulo son hoy una lista propia, `cl_materias`, con cinco nombres
que inventé al crear el módulo —Dicloro, Tricloro, Hipoclorito de calcio, Carbonato de
sodio, Bisulfato de sodio— porque de las ventas no se puede deducir qué lleva cada
producto. Esa lista no tiene stock, no se cruza con nada y cuatro de sus cinco nombres ni
siquiera existen en la empresa con esa denominación.

El stock real de materia prima ya está cargado y actualizado en el módulo Stock: son las
filas de `inventario` marcadas con `ext_id = 'MP'`, 79 en total. La pregunta que el módulo
tiene que poder contestar es **"con lo que hay en el depósito, ¿hasta qué semana de la
temporada llegamos?"**, y para eso hay que colgarse de ese número, no de una lista aparte.

## 2 · Los datos que hay

### 2.1 · La planilla

El usuario aportó `Planilla.xlsx`: 13 filas, una por producto, con el código de artículo,
los kg de producto por presentación y el código y nombre de la materia prima que usa.

| Cód. producto | Producto | kg/u | Cód. MP | Materia prima |
|---|---|---:|---|---|
| 21420 | Cloro Granulado x 4 Kg | 4 | 334101 | Cloro Granulado |
| 21421 | Cloro Granulado x 25 Kg | 25 | 334101 | Cloro Granulado |
| 2150250 | Cloro Shock x 240 g | 0,24 | 21550000 | Cloro Shock |
| 2150950 | Cloro Shock x 900 g | 0,9 | 21550000 | Cloro Shock |
| 2153500 | Cloro Shock x 3,5 Kg | 3,5 | 21550000 | Cloro Shock |
| 218801 | Pastilla Triple Acción x 1 Kg | 1 | 218851 | Pastilla Triple Acción |
| 218803 | Pastilla Triple Acción x 3 Unidades | 0,6 | 218851 | Pastilla Triple Acción |
| 218804 | Pastilla Triple Acción x 4 Kg | 4 | 218851 | Pastilla Triple Acción |
| 218825 | Pastilla Triple Acción x 25 Kg | 25 | 218851 | Pastilla Triple Acción |
| 218905 | Pastilla Jacuzzi 50 g x 5 | 0,25 | 220156 | Pastillas Cloro Jacuzzi 50 Grs |
| 219727 | Regulador PH MAS x 2 Kg | 2 | 220043 | Ceniza de soda (PH+) |
| 219729 | Regulador PH Menos x 4 Kg | 4 | 220111 | Metabisulfito (PH−) |
| 230137 | Cloro Shock x 25 Kg VENTA | 25 | 21550000 | Cloro Shock |

**Tres valores de esta tabla no son los que traía la planilla.** Se corrigieron con el
usuario antes de cargarlos:

- **`2150950`** (Cloro Shock 900 g). La planilla decía `215050`, que no existe. El nombre
  coincide exacto y el patrón de los hermanos lo confirma (`2150250` = 240 g).
- **`220156`** para la Pastilla Jacuzzi. La planilla decía `220176`, que no está en el
  inventario. El artículo real es `220156`, "Pastillas Cloro JACUZZI 50 Grs".
- **0,25 kg** para la Pastilla Jacuzzi, no 0,125. Son 5 pastillas de 50 g. Con 0,125 el
  módulo habría pedido la mitad de la materia prima necesaria.

### 2.2 · Las seis materias primas en el inventario

Las seis están en `inventario` con `ext_id = 'MP'` y stock cargado:

| Cód. | Artículo | id | Unidad | Stock |
|---|---|---:|---|---:|
| 334101 | Cloro Granulado | 48 | Kg | 500 |
| 21550000 | Cloro Shock | 49 | Kg | 3.300 |
| 218851 | Pastilla Triple Accion | 107 | Kg | 2.275 |
| 220156 | Pastillas Cloro JACUZZI 50 Grs | 110 | g → **Kg** | 132 |
| 220043 | Ceniza de soda (PH+) | 42 | Kg | 200 |
| 220111 | Metabisulfito ( PH-) | 100 | Kg | 500 |

Dos advertencias sobre estos datos:

- **`218851` aparece DOS veces en `inventario`**: la fila 107 "Pastilla Triple Accion"
  (2.275 kg) y la 108 "Pastilla Triple Accion (3 unidades)" (stock vacío). El usuario
  decidió que los cuatro productos de pastilla se calculan contra **la 107**. Esto es lo
  que prueba que **el código no sirve como clave** y el vínculo tiene que ser por
  `inventario.id`.
- **La fila 110 tiene `unidad = 'g'` y es un error**: son 132 **kg**, no 132 gramos. Se
  corrige. En el módulo Stock `unidad` es sólo una etiqueta que se concatena al número
  formateado —se verificó, no entra en ninguna cuenta—, así que corregirla es inocuo allá
  y necesario acá.

## 3 · El vínculo

`cl_materias` gana una columna `inventario_id` que referencia `public.inventario(id)`, con
**único por columna**: dos materias colgadas del mismo artículo contarían su stock dos
veces y las dos dirían que están cubiertas.

**Regla de presentación: cuando hay vínculo, el nombre que se muestra es el del
inventario.** El `nombre` guardado en `cl_materias` queda sólo como respaldo para una
materia todavía sin vincular. Sin esta regla el mismo artículo tendría dos nombres, uno en
cada tabla, y se irían separando solos en cuanto alguien renombre de un lado.

Se descartó apuntar `cl_productos` directo al inventario y eliminar `cl_materias`: el
gráfico de materia prima **colorea por el id de la materia** —decidido así para que dos
capturas de semanas distintas sean comparables— y migrar los ids repinta todo. Además una
materia que no esté en el inventario dejaría de poder existir, y hoy no hay garantía de
que el próximo producto la tenga.

### 3.1 · Qué pasa con las cinco materias inventadas

| id | Nombre actual | Destino |
|---:|---|---|
| 4 | Carbonato de sodio (pH+) | Se reutiliza: es la ceniza de soda. Pasa a `Ceniza de soda (PH+)` → inventario 42. **Preserva la única asignación de producto que ya existía** (Regulador PH MAS). |
| 5 | Bisulfato de sodio (pH−) | Se reutiliza como el pH−: pasa a `Metabisulfito ( PH-)` → inventario 100. |
| 1, 2, 3 | Dicloro, Tricloro, Hipoclorito de calcio | **`activo = false`.** No existen en el inventario con ese nombre. No se borran: ningún producto las referencia, pero desactivar es reversible y borrar no. |

Las otras cuatro —Cloro Granulado, Cloro Shock, Pastilla Triple Acción, Pastilla Jacuzzi—
se dan de alta ya vinculadas.

El SQL resuelve el `inventario_id` **por código, y para `218851` por código y descripción
exacta**, con un control que falla ruidosamente si alguno no resuelve a exactamente una
fila. Escribir los ids a mano funcionaría hoy y sería una bomba el día que alguien
reimporte el inventario.

## 4 · El cálculo

### 4.0 · Antes que nada: el conteo del stock tiene fecha

Apareció al revisar los datos reales y hay que arreglarlo primero, porque todo lo demás se
apoya en él.

`cl_stock_inicial` se guardaba sin fecha y el módulo lo trataba como **el saldo de la
semana 1**. El conteo real de 2026-2027 se hizo el **08/09/2026, que es la semana 7**, con
**1.458 unidades ya vendidas** en las semanas 1 a 6 e importadas del ERP. Restar esas
ventas de un conteo que ya las tiene descontadas las cuenta dos veces: la pantalla mostraba
**−272** unidades de Pastilla Triple Acción 1 kg donde se habían contado **500**, y el
sugerido mandaba a envasar de nuevo lo ya vendido.

`cl_stock_inicial` gana una columna `fecha` y `Cloro.proyectarStock` un `semanaBase`
opcional: la semana a la que corresponde el conteo, tomada como **saldo de apertura de esa
semana**. Antes de esa semana la serie devuelve **`null`, no cero** — si contamos en
septiembre, qué había en agosto no lo sabemos, y un cero ahí se leería como "estaba vacío",
que es una afirmación que nadie hizo.

La fecha va **por fila**, no por temporada: un reconteo de un solo producto tiene que poder
representarse sin mentir sobre los otros doce. La pantalla las escribe todas juntas desde un
único campo, que es como se hace un inventario.

**Una imprecisión asumida:** el conteo del 8/9 cae dentro de la semana 7, no en su borde, y
tratarlo como saldo de apertura descuenta igual lo que se vendió el lunes y el martes de esa
semana. Subestima el stock en un par de días de venta. De los dos errores posibles, el que
deja sin cloro en enero es el otro.

### 4.1 · Las funciones nuevas

Dos funciones nuevas en `cloro-calc.js`, puras, sin fechas implícitas y con tests, más un
ayudante que las une: `kgSemanal(productos, planes) -> {porMateria: {id: number[]}, sinAsignar}`,
que es `kgMateria` aplicado semana a semana y con la misma regla —un producto sin materia o
sin kg por unidad no se reparte a ningún lado y se lista.

### 4.2 · `planEnvasado` — la curva semanal de envasado

El módulo hoy contesta "cuánto envasar ahora" con un solo número: `Cloro.sugerido`, que
mira el horizonte y el colchón. Para contar semanas de cobertura hace falta esa respuesta
**para cada semana de lo que queda de temporada**.

`planEnvasado` simula la temporada hacia adelante. Para cada semana, la regla de decisión
es **`Cloro.sugerido`, parada en esa semana con el stock proyectado de esa semana**; lo que
decide se suma al stock y se sigue. La respuesta a "cuánto envasar" sigue estando escrita
**una sola vez**: es la misma fórmula aplicada 36 veces en vez de una. Si en cambio se
escribiera una regla nueva para el plan, el módulo tendría dos respuestas para la misma
pregunta y tarde o temprano se contradirían en pantalla.

```
planEnvasado({prevision, stockInicial, ventas, envasado, semanasCerradas,
              desdeSemana, semanas, horizonte, semanasSeguridad, lote}) -> number[]
```

Devuelve un array de largo `semanas`; las semanas anteriores a `desdeSemana` van en cero
—ya pasaron—. El resultado es lumpy a propósito: se envasa en múltiplos de lote cuando
hace falta, no un poquito por semana.

### 4.3 · `cobertura` — hasta qué semana alcanza

```
cobertura({kgSemana: number[], stock: number, desdeSemana: number})
  -> {semanas: number, hastaSemana: number|null, kgTotal: number, alcanza: boolean}
```

Acumula los kg semana a semana desde `desdeSemana` hasta que el acumulado supera `stock`.
`hastaSemana` es la última semana cubierta entera; `semanas` es cuántas son; `alcanza` es
verdadero si el stock cubre todo lo que queda de temporada.

**Cuenta hasta cero, no hasta el stock mínimo.** El mínimo es la señal de reposición y ya
vive en el módulo Stock; traerlo acá sería un segundo umbral para lo mismo, en otra
pantalla, que se puede mover de un lado y no del otro.

**Una semana que no se cubre entera no se cuenta.** Con 100 kg y una semana que pide 150,
la respuesta es cero semanas, no media: media semana de cloro no envasa nada.

### 4.4 · Lo que deliberadamente NO entra

- **`pendiente_entrega`** —materia prima ya pedida y en camino— **no suma al stock.** Se
  muestra al lado como dato, pero contarlo convertiría una promesa de un proveedor en
  cobertura. Si la compra se atrasa, la pantalla habría dicho que estábamos cubiertos.
- **El producto terminado no se descuenta aparte**: ya está adentro del stock proyectado
  que alimenta el plan de envasado. Descontarlo otra vez sería contarlo dos veces.

## 5 · La pantalla

### 5.1 · La tabla de materia prima

Gana tres columnas: el **artículo del inventario** al que está colgada (código y
descripción), el **stock real** con la fecha en que se actualizó, y la **cobertura**.

La fecha importa: el valor de la cobertura vale lo que valga la última vez que alguien
contó el depósito, y eso tiene que estar a la vista y no en la cabeza de quien mira.

Estados de la cobertura, cada uno con su texto propio:

| Situación | Qué muestra |
|---|---|
| Todo cargado | `hasta la semana 21 · 13 semanas` |
| El stock cubre la temporada entera | `cubre la temporada` |
| Sin stock inicial de temporada | `—` + el aviso de la 5.2 |
| Materia sin vincular al inventario | `sin vincular` |
| Stock en cero o negativo | `0 semanas`, en rojo |

### 5.2 · Los avisos

Mientras no haya con qué calcular, el módulo lo dice **con nombre y apellido**, no con un
"faltan datos" genérico:

- Sin stock inicial de temporada: el aviso lista **cuáles** productos faltan cargar y
  manda a Configuración → Stock inicial. Es la condición que hoy tienen los 13.
- Materia prima sin vincular: cuáles, y que su cobertura no se puede calcular.
- Producto sin materia prima: el aviso que ya existe, sin cambios.

### 5.3 · Configuración pierde la sección Productos

La asignación de materia prima, los kg por unidad y el lote dejan de editarse desde la
pantalla: son hechos de la fórmula y de la presentación, no parámetros de planificación, y
tenerlos como campos editables invita a cambiarlos sin que nadie se entere. Se cargan por
SQL. Configuración queda sobre la temporada: temporadas, parámetros, materias primas y
stock inicial.

Esto **elimina la última escritura del módulo sobre `cl_productos`**. La pantalla pasa a
leer ese maestro y no escribirlo.

## 6 · Archivos

| Archivo | Qué cambia |
|---|---|
| `migracion/cloro_stock_fecha.sql` | Columna `fecha` en `cl_stock_inicial` y la del conteo del 08/09. |
| `migracion/cloro_materia_inventario.sql` | Columna `inventario_id`, único, y el vínculo de las 6 materias. |
| `migracion/cloro_carga_planilla.sql` | `materia_id` y `kg_mp_por_unidad` de los 13 productos. |
| `migracion/inventario_220156_unidad.sql` | `unidad` de `'g'` a `'Kg'` en la fila 110. |
| `migracion/cloro_materia_inventario_rollback.sql` | Vuelta atrás de los tres. |
| `cloro-calc.js` | `semanaBase` en `proyectarStock`; `planEnvasado`, `cobertura`, `kgSemanal`. |
| `test/cloro-calc.test.js` | Sus tests. |
| `cloro.html` | Carga de `inventario`, columnas nuevas, avisos, y fuera la sección Productos. |

## 7 · Cómo se verifica

- Los tres `.sql` traen un control que falla ruidosamente si algo no resuelve a una fila.
- Tests de `planEnvasado` y `cobertura` con series armadas a mano, incluidos los bordes:
  stock cero, plan en cero, stock que cubre toda la temporada, y la semana que no se cubre
  entera.
- **Contra la base, desde el navegador**: que los 13 productos queden con su materia y sus
  kg, que las 6 materias resuelvan a las filas de inventario esperadas y que el stock que
  muestra la pantalla sea el mismo que muestra el módulo Stock para ese artículo.
- Un caso de punta a punta a mano: cargar el stock inicial de un producto, comprobar que
  su cobertura aparece y que el número coincide con acumular la curva a mano.
