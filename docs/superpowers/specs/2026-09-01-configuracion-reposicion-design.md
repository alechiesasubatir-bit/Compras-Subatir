# Configuración de reposición por artículo y proveedor

Fecha: 2026-09-01
Estado: aprobado el enfoque (A + dos pantallas), pendiente plan de implementación

## 1 · El problema

El control de stock es semanal y el semáforo actual (`stock.html:1362`, `recalcItem`)
compara **stock contra mínimo** y calcula cobertura en meses. Eso alcanza para lo que se
compra seguido y llega rápido.

No alcanza para dos casos reales:

- **Artículos con demora de producción.** Las etiquetas (ids 82-88, familia `CON`) se
  fabrican a pedido. Cuando el semáforo se pone en rojo ya es tarde: entre que se emite la
  OC y llega la mercadería pasan semanas, y en el medio la producción se queda sin material.
- **Artículos de compra poco frecuente o pactada a largo plazo.** No los mira nadie porque
  nunca están en rojo, hasta que un día lo están.

El sistema **no tiene ningún dato de cuánto tarda un proveedor en entregar**. Se verificó
que tampoco se puede deducir del historial: sobre 663 OC recibidas, la diferencia entre
`pedidos.fecha` y `pedidos.f_recepcion` da **mediana 3 días**, y las etiquetas de Lipiner
dan **1 día**. `f_recepcion` registra cuándo se cargó la recepción en el sistema, no cuánto
tardó el proveedor. **La demora hay que cargarla a mano.**

## 2 · Alcance

**Entra:**

- Una configuración por **artículo + proveedor** con demora, lote mínimo y compra pactada,
  cada bloque con su tilde de "tener en cuenta".
- Una señal de reposición nueva (fecha límite para pedir) que convive con el semáforo
  actual **sin reemplazarlo**.
- Un recordatorio por fecha para lo pactado y lo de compra infrecuente.
- Tres superficies: el ✏ de Stock, una pantalla nueva de configuración, y un panel en el
  Dashboard.

**No entra:**

- Tocar la lógica del semáforo actual (`recalcItem`). Los estados CRITICO/MEDIO/OPTIMO
  quedan como están.
- Medir la demora automáticamente del historial (verificado: los datos no sirven).
- Notificaciones por mail o push. El aviso es dentro de la app.
- Los módulos de Depósitos y MP Importación.

**Alcance por artículo:** solo los que se marquen con `seguimiento = true`. Un artículo sin
marcar se comporta exactamente como hoy. No se distingue por familia (MP / ENV / CON): el
caso que motivó todo, las etiquetas, es `CON`.

## 3 · Modelo de datos

Decisión: **el mínimo en planta y el consumo mensual NO se duplican.** Siguen en
`inventario.stock_minimo` y `inventario.consumo_mensual`, que es lo que el ✏ ya edita y lo
que toda la pantalla ya lee (144 de 153 artículos con consumo, 147 con mínimo). La
configuración nueva guarda **solo lo que hoy no existe**.

### 3.1 · Columnas nuevas en `inventario`

```sql
alter table public.inventario
  add column if not exists seguimiento        boolean not null default false,
  add column if not exists revisar_cada_meses smallint,
  add column if not exists proxima_revision   date,
  add column if not exists prov_auto_at       timestamptz,
  add column if not exists prov_auto_oc       text;

alter table public.inventario
  add constraint inventario_revisar_meses_ck
  check (revisar_cada_meses is null or revisar_cada_meses between 1 and 60);
```

`prov_auto_at` / `prov_auto_oc` son la auditoría del pisado automático de proveedor
(sección 6.2): sin ellas el dato cambiaría solo y sin explicación.

**Sí se agregan a `MAPS.inventario`** (`subatir-app.js:109`), con nombres de header propios
(`SEGUIMIENTO`, `REVISAR CADA MESES`, `PROXIMA REVISION`, `PROV AUTO AT`, `PROV AUTO OC`).

Ese adaptador es un simple renombrador de columnas en las dos direcciones, y `load()` de
`stock.html:1057` arma `RAW_INV` con lo que él devuelve. Dejarlos afuera obligaría a una
segunda consulta y a un join manual por id en cada carga, para no ganar nada: la alternativa
era "no ensuciar la abstracción de la planilla vieja", pero la abstracción ya es solo un mapa
de nombres. `rowToHeader` (`subatir-app.js:139`) expone `__row = row.id`, así que `CUR.__row`
en Stock **es** el `inventario.id` y sirve directo como FK de `art_proveedor`.

### 3.2 · Tabla nueva `art_proveedor`

```sql
create table if not exists public.art_proveedor (
  id             bigint generated always as identity primary key,
  inventario_id  bigint not null references public.inventario(id) on delete cascade,
  proveedor      text   not null,

  demora_dias    smallint,
  usar_demora    boolean not null default false,

  lote_minimo    numeric,
  multiplo       numeric,
  usar_lote      boolean not null default false,

  pact_cantidad  numeric,
  pact_entregado numeric not null default 0,
  pact_vence     date,
  usar_pactada   boolean not null default false,

  notas          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (inventario_id, proveedor),

  -- Un bloque tildado sin su dato cargado sería una alerta que no puede
  -- calcularse. Se impide en la base, no solo en la pantalla.
  constraint ap_demora_ck  check (not usar_demora  or demora_dias > 0),
  constraint ap_lote_ck    check (not usar_lote    or lote_minimo > 0 or multiplo > 0),
  constraint ap_pactada_ck check (not usar_pactada or (pact_cantidad > 0 and pact_vence is not null))
);

create index if not exists art_proveedor_inv_idx on public.art_proveedor(inventario_id);
```

`proveedor` va como texto y no como FK a `proveedores`: `inventario.proveedor` ya es texto
libre y la normalización se hace con `canonProv()` en el front. Meter una FK ahora obligaría
a resolver los nombres sueltos antes de poder guardar una demora, que es lo que se quiere
desbloquear.

### 3.3 · RLS

Mismo criterio que `entregas`: lectura para cualquier autenticado, escritura para quien
tenga el módulo.

```sql
alter table public.art_proveedor enable row level security;

create policy ap_sel on public.art_proveedor for select to authenticated using (true);
create policy ap_ins on public.art_proveedor for insert to authenticated
  with check (public.is_admin() or public.has_module('stock'));
create policy ap_upd on public.art_proveedor for update to authenticated
  using (public.is_admin() or public.has_module('stock'))
  with check (public.is_admin() or public.has_module('stock'));
create policy ap_del on public.art_proveedor for delete to authenticated
  using (public.is_admin() or public.has_module('stock'));
```

Las columnas nuevas de `inventario` quedan cubiertas por las policies que esa tabla ya
tiene.

**Toda escritura verifica filas afectadas con `.select()`.** Un UPDATE bloqueado por RLS
devuelve cero filas **sin error**, y eso ya causó una pérdida silenciosa en recepción.

Realtime: sumar `art_proveedor` a la publicación (`alter publication supabase_realtime add
table public.art_proveedor`) para que la pantalla de configuración y Stock se refresquen
entre sí.

## 4 · El cálculo

La cuenta vive en un archivo compartido nuevo, **`reposicion-calc.js`**, y no dentro de
`stock.html`: las tres pantallas de la sección 5 necesitan la misma fórmula, y una fórmula
de reposición copiada en tres lados es una fórmula que en tres meses no coincide consigo
misma. Además el archivo se puede cargar desde Node y probar con `node --test` sin
navegador, que es la única lógica de todo el proyecto que se deja testear de verdad.

Se llama desde `recalcItem` (`stock.html:1362`). **No modifica `m.estado`**: escribe campos
nuevos.

```
si !m.seguimiento           → sin señal, se comporta como hoy
consumo diario  = consumo_mensual / 30
días de stock   = (stock + en tránsito − stock_mínimo) / consumo diario
fecha límite    = hoy + (días de stock − demora_días)
```

**Por qué el mínimo entra en la resta:** el `stock_minimo` deja de ser el disparador y pasa
a ser el colchón. La alerta salta cuando pedir *hoy* ya te haría tocar el mínimo antes de
que llegue la mercadería — que es exactamente el problema que hoy no se ve.

Ejemplo real, Etiq. Medianas corto (id 84): stock 25.350, mínimo 35.000, consumo
70.000/mes. Hoy ya está por debajo del mínimo. Con demora de 30 días cargada, la fecha
límite habría caído unas dos semanas antes de cruzarlo.

**Señales:**

| Condición | Señal |
|---|---|
| `fecha_limite < hoy` | `ATRASADO` — había que pedirlo y no se pidió |
| `fecha_limite <= hoy + 7d` | `PEDIR` — entra en el control de esta semana |
| resto | `OK` |

**Sin datos suficientes** no se inventa una señal, se pide el dato que falta:

- `consumo_mensual <= 0` → sin fecha límite; el artículo aparece en "falta consumo".
- Sin ficha `art_proveedor` con `usar_demora` para el proveedor que manda → sin fecha
  límite; aparece en "falta demora".
- En los dos casos el recordatorio por fecha sí funciona, si está cargado.

**Qué demora manda** (decisión del usuario): la de la ficha cuyo `proveedor` normalizado
coincida con `canonProv(inventario.proveedor)`. Si ese proveedor no tiene ficha, ver 6.2.

**Recordatorio por fecha** — el que caiga primero de:

- `proxima_revision` (fecha puntual cargada a mano),
- fecha de la última OC del artículo + `revisar_cada_meses`, y
- `pact_vence` − 30 días, mientras la compra pactada siga activa (ver 6.4).

Señal `REVISAR` cuando esa fecha es hoy o pasó. Al registrar una compra, la regla por meses
se recorre sola; `proxima_revision` no, y por eso se muestra tachada una vez cumplida hasta
que se la cargue de nuevo.

Si el artículo **nunca tuvo una OC**, la regla por meses no tiene desde dónde contar: no
genera recordatorio y el artículo aparece en "falta configurar" sugiriendo cargar una
`proxima_revision`. No se cuenta desde la fecha de alta de la ficha, que no dice nada sobre
el ciclo de compra.

**Cuál es "la última OC del artículo":** `pedidos.inventario_id` está cargado en solo
**160 de 680** filas (63 artículos), así que no se puede depender de él. Se usa
`inventario_id` cuando está, y si no, el match difuso por descripción que ya existe para el
"en tránsito" (`matchKeys` / `findOCMatch` en `stock.html`). No se construye un matcher
nuevo.

**Cantidad sugerida** (solo informativa, no crea ninguna OC):

```
objetivo = stock_mínimo + consumo_mensual × 2
falta    = objetivo − stock − en tránsito
si usar_lote → max(lote_minimo, ceil(falta / multiplo) × multiplo)
```

Los 2 meses son una constante del módulo, no un campo por artículo. Si más adelante hace
falta afinarla por artículo, se agrega; hoy no hay evidencia de que difiera.

## 5 · Las tres pantallas

### 5.1 · `stock.html` — el ✏ (control semanal)

El modal de edición gana un bloque **"Reposición"** debajo de lo que ya tiene (stock,
mínimo, consumo, proveedor, categoría, observaciones — **nada de eso se saca**):

- Switch `seguimiento`.
- `revisar_cada_meses` y `proxima_revision`.
- Una ficha por cada proveedor de `m.provs` (la lista que ya se arma en `collectProvs`),
  cada una con los tres bloques tildables. La del proveedor que manda va marcada como tal.
- El resultado del cálculo explicado en texto: días de stock, demora, fecha límite y
  cantidad sugerida.

Guardado directo a Supabase + `load()`, sin estado local ni botón de sincronizar.

La tabla gana:

- Columna **"Pedir antes de"** con la fecha y los días que faltan (`—` si no hay
  seguimiento).
- KPI **"Hay que pedir"** en la tira superior.
- Filtro nuevo para ver solo `ATRASADO` + `PEDIR` + `REVISAR`.

**La tabla ya tiene 11 columnas** (`stock.html:699-711`). Antes de publicar hay que medir con `td.scrollWidth`
sobre las primeras ~60 filas e iframes del mismo origen a 1366 / 1200 / 844 px. Estimar los
anchos a ojo ya cortó datos dos veces.

### 5.2 · `reposicion.html` — carga masiva

Pantalla nueva, una fila por artículo+proveedor, con buscador, filtro por familia y por
"falta configurar", y edición en línea. Es para sentarse a cargar las fichas de una vez, que
en el modal sería insoportable.

Plomería necesaria:

- `PAGE_MODULE['reposicion.html'] = 'stock'` en `subatir-app.js:16` — **reusa el permiso del
  módulo `stock`**, así que no hay que tocar `usuarios.html` ni dar permisos nuevos.
- Sumarla al array `$modulos` de `bump-version.ps1:63`. Si se olvida, la página se publica
  con el `?v=` viejo de los scripts compartidos y queda con el JS anterior.
- `window.APP_VER` en el HTML, como los otros nueve módulos.
- Link en el nav de las páginas que corresponda.

### 5.3 · `index.html` — panel de avisos

Panel "Reposición" con los artículos en `ATRASADO`, `PEDIR` y `REVISAR`, ordenados por
urgencia, cada uno enlazando a su ficha en Stock. Es la pantalla que se abre al entrar.

## 6 · Casos borde y decisiones

### 6.1 · Bloques tildados sin dato

Imposibles: los `check` de la sección 3.2 los rechazan. La pantalla avisa antes de que la
base tenga que hacerlo.

### 6.2 · El proveedor de la ficha no coincide con a quién se le compra

Caso real: las etiquetas tienen `inventario.proveedor = 'MIL ROLLOS'` pero la OC 927 fue a
**Lipiner S.A.**

Decisión del usuario: **el sistema corrige `inventario.proveedor` solo**, tomándolo del
proveedor de la última OC real del artículo. Solo para artículos con `seguimiento = true`.

Para que un cambio automático no aparezca sin explicación, queda auditado: se escriben
`prov_auto_at` y `prov_auto_oc`, y tanto la ficha como la pantalla de configuración muestran
*"proveedor actualizado el DD/MM según OC #NNN"*, con un botón para volver atrás.

**Riesgo anotado:** esto pisa un dato cargado a mano. Si la última OC fue una compra puntual
a un proveedor alternativo, la demora que manda pasa a ser la de ese proveedor. Planteado y
decidido por el usuario el 01/09/2026.

### 6.3 · Artículo con seguimiento y sin ficha de proveedor

No genera señal de fecha límite. Aparece en la lista "falta configurar" de la pantalla de
configuración y con un ícono en Stock. Nunca se calcula con una demora inventada.

### 6.4 · Compra pactada agotada o vencida

Mientras el contrato está activo aporta un recordatorio **30 días antes de `pact_vence`**,
para llegar a renegociar antes de quedarse sin el precio pactado. Esa ventana es una
constante del módulo (`DIAS_AVISO_PACTADA`), no un campo por ficha.

`pact_entregado >= pact_cantidad` o `pact_vence < hoy` → la ficha se muestra como vencida y
deja de aportar al recordatorio, pero **no se borra ni se destilda sola**: el dato histórico
sirve para renegociar. Deja de aportar a propósito — si no, un contrato viejo dejaría el
artículo en `REVISAR` para siempre y la señal se volvería ruido.

`pact_entregado` **se carga a mano** en la ficha. Deducirlo de las recepciones exigiría
decidir qué OC pertenecen al contrato y cuáles fueron compras sueltas al mismo proveedor, y
hoy no hay ningún campo que los distinga. Queda anotado en la sección 8.

## 7 · Cómo se aplica y cómo se verifica

1. `migracion/reposicion.sql` — idempotente, con un `select` de verificación al final. **Lo
   corre el usuario** en el SQL Editor de Supabase.
2. Verificación desde el navegador con la sesión real (`SB.from(...)` vía `javascript_tool`
   sobre la app publicada): que existan las columnas, la tabla, los `unique`, los `check` y
   que la RLS de escritura devuelva 1 fila. La anon key sola no sirve: RLS devuelve 0 filas.
   Y en el SQL Editor `auth.uid()` es NULL, así que las funciones con chequeo de permiso no
   se prueban ahí.
3. Prueba end-to-end con las **7 etiquetas (ids 82-88)**: cargar demora real, comprobar que
   la id 84 sale `ATRASADO` y que la id 85 (95.000 en stock, consumo 40.000) sale `OK`.
4. Medición de anchos de la tabla antes de publicar (5.1).
5. Publicación: `bump-version.ps1` + `git` a mano, y esperar a ver el número nuevo en
   `version.json` antes de darlo por publicado.

## 8 · Fuera de alcance, anotado para después

- Que la cantidad sugerida genere la OC directamente en Pedidos.
- Descontar `pact_entregado` solo, atando las recepciones a un contrato.
- Afinar los 2 meses de cobertura objetivo por artículo.
- Usar el saldo real de entregas parciales en vez del `f_recepcion` binario para el "en
  tránsito" (ya estaba anotado como mejora futura).
