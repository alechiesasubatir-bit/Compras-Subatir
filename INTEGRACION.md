# Relevamiento técnico para integración al core

Datos consultados contra la base **el 2026-07-31**, no de memoria. Los conteos
son reales.

Son **dos aplicaciones** que comparten un único proyecto Supabase:

| App | Carpeta | Qué hace |
|---|---|---|
| **Compras** | raíz del repo | Precios, proveedores, órdenes de compra, stock, recepción, contingencia |
| **Depósitos** | `deposito/` | Movimiento físico entre depósitos: pallets, ubicaciones, QR, transferencias |

---

## 1. Stack y hosting

| | |
|---|---|
| **Framework** | Ninguno. HTML + CSS + JavaScript ES5 plano, sin build, sin npm, sin bundler. Cada módulo es un `.html` autocontenido |
| **Librerías** | Todas por CDN, sin instalar: `supabase-js@2` (jsdelivr), `three.js` r128 + OrbitControls (el 3D de depósitos), `html5-qrcode@2.3.8` (lector QR), `qrcodejs` (generación), Chart.js |
| **Hosting** | **GitHub Pages** — `https://alechiesasubatir-bit.github.io/Compras-Subatir/`. No hay Netlify ni Vercel |
| **Repo** | `github.com/alechiesasubatir-bit/Compras-Subatir`, rama `main` |
| **Deploy** | `publicar.bat` → `bump-version.ps1` (versiona 17 archivos) → `git add . && commit && push`. Sin CI |
| **Backend propio** | **No existe.** El navegador habla directo con Supabase |

### Supabase

| | |
|---|---|
| **Project ref** | `wbbscaitwdwhuufiiwsw` |
| **URL** | `https://wbbscaitwdwhuufiiwsw.supabase.co` |
| **¿Propio y separado?** | **Sí.** Proyecto exclusivo de estas dos apps, creado en 2026-07 al migrar desde Google Sheets. Ninguna otra app de la empresa lo usa hoy |

---

## 2. Inventario de tablas

Filas reales al 2026-07-31.

### Compras

| Tabla | Filas | Qué guarda |
|---|---:|---|
| `profiles` | 3 | Usuarios: rol, módulos habilitados, activo. Espejo de `auth.users` |
| `proveedores` | 65 | Ficha del proveedor: empresa, contacto, RUT, condición de pago, calidad |
| `precios` | 214 | Lista de precios **por producto y proveedor**. Es lo que dice quién provee qué |
| `pedidos` | 589 | Órdenes de compra, **una fila por línea**. Varias filas comparten `n_orden` |
| `inventario` | 148 | **Materias primas e insumos.** Stock, mínimo, consumo mensual. Ver §3 |
| `contingencia` | 3 | Reserva estratégica de materias primas críticas |
| `categorias` | 178 | Clasificación por producto (Envases / Consumibles / Materias Primas) |
| `entregas` | 30 | Entregas parciales de una línea de OC: cantidad, lote, vencimiento, COA |

### Depósitos

| Tabla | Filas | Qué guarda |
|---|---:|---|
| `imp_articulos` | 119 | **Catálogo propio de artículos** de depósitos. Ver la advertencia en §3 |
| `imp_depositos` | 2 | Furriol (almacén) y Artigas (fábrica), con medidas de la nave |
| `imp_subdepositos` | 6 | Sub-áreas dibujadas dentro de un depósito, con coordenadas en metros |
| `imp_estanterias` | 6 | Racks: niveles × bahías y su posición real en el plano |
| `imp_zonas` | 3 | **Legacy.** Fuera del flujo desde 2026-07; se conserva por la bitácora vieja |
| `imp_pallets` | 7 | Pallet físico con QR: artículo, unidades, estado, ubicación |
| `imp_stock` | 238 | Stock por artículo y depósito |
| `imp_movimientos` | 29 | Bitácora inmutable: ingreso, salida, entrada, consumo, cambio de ubicación |
| `imp_solicitudes` | 4 | Pedidos de mercadería de un depósito a otro |
| `imp_solicitud_items` | 4 | Los pallets concretos de cada solicitud |

### Vistas

`imp_en_camino` · `imp_pallets_disponibles` · `imp_subdep_uso` · `imp_solicitud_resumen`

`imp_en_camino` es el punto de contacto entre las dos apps: Compras la lee para
avisar qué viene en camino a cada fábrica.

---

## 3. Materias primas — LO CRÍTICO

### Hay DOS catálogos y están casi desconectados

| | `inventario` (Compras) | `imp_articulos` (Depósitos) |
|---|---|---|
| Filas | 148 | 119 |
| Identificador | `codigo` (texto) | `codigo` (texto) |

Cruzándolos:

- **12 códigos** aparecen en los dos.
- **4 descripciones** coinciden (normalizando mayúsculas y tildes).
- **143** productos existen solo en Compras, **115** solo en Depósitos.

**No son el mismo maestro.** Son dos listas que crecieron por separado. Cualquier
unificación tiene que empezar por decidir cuál es la fuente de verdad y mapear a
mano — no hay forma automática de casarlas.

### Estructura de `inventario`

| Campo | Tipo | Obligatorio | Nota |
|---|---|---|---|
| `id` | bigint identity | sí (PK) | Es el **único identificador confiable** |
| `codigo` | text | **no** | 7 filas sin código y 6 códigos repetidos entre productos distintos |
| `descripcion` | text | no | En la práctica siempre viene |
| `unidad` | text | no | Texto libre: conviven `kg` y `Kg`, `Unid.` y `Unid` |
| `presentacion` | text | no | |
| `consumo_mensual` | numeric | no | Alimenta la cobertura en meses |
| `stock_minimo` | numeric | no | |
| `inventario` | numeric | no | El stock actual |
| `solicitar` | text | no | Bandera heredada del Excel |
| `compra_sugerencia` | numeric | no | |
| `proveedor_sugerido` | text | no | **Texto libre**, no FK |
| `pendiente_entrega` | numeric | no | |
| `proveedor` | text | no | **Texto libre**, no FK |
| `ext_id` | text | no | Categoría: `MP` materia prima, `ENV` envases, `CON` consumibles |
| `created_at` / `updated_at` | timestamptz | sí | |

**Ningún campo salvo `id` tiene restricción de unicidad ni de obligatoriedad.**

### Cómo se identifica una materia prima

- **`id`** (bigint) es lo único unívoco. Es interno de Supabase, no lo conoce nadie
  en la empresa.
- **`codigo`** es el que usan las personas, pero **no sirve como clave**: 7 filas no
  lo tienen y hay 6 códigos duplicados entre productos distintos:

  ```
  220171 → "Botella C/ Serigrafia A. Eucaliptado PET 1L"  vs  "... A. Rectificado PET 1L"
  220105 → "Gatillo Pulverizador Comun rosca 28"          vs  "... rosca 28 CORTA"
  218851 → "Pastilla Triple Accion"                        vs  "... (3 unidades)"
  220132 → "Tapas Alcoa rosca 28"                          vs  "... rosca 28 CORTA"
  220900 → "Tapas Flip Top TFT rosca 28/400"               vs  "... rosca 28/410"
  220135 → "Valvula Crema rosca 28/400 corta"              vs  "... rosca 28/410"
  ```

  El patrón se repite: son **variantes reales de producto que comparten código**.
  Hay que decidir si son un producto con variantes o productos distintos mal
  codificados.

- **No hay UUID ni SKU.**

### Cuántas hay

| Categoría | Filas |
|---|---:|
| `MP` — materias primas | 75 |
| `ENV` — envases | 53 |
| `CON` — consumibles | 19 |
| Sin categoría | 1 |
| **Total** | **148** |

Si "materia prima" se toma en sentido estricto (`ext_id = 'MP'`), son **75**.

Ojo que la categoría no siempre acompaña al producto: `MP06 · Cintas Ph
Fabricacion` figura como `CON`, y hay 1 fila sin categorizar.

### Muestra real

| Código | Descripción | Unidad | Cat. | Proveedor |
|---|---|---|---|---|
| 220005 | Acido Sulfonico 99 % TYPOL Labrex 200 | kg | MP | Enzur S.A. |
| 220139 | BTC 80 | Kg | MP | Quimica Oriental S.A. |
| 220042 | Carbonato de Calcio (Pulidor) | kg | MP | Nortesur S.A. |
| 220010 | Alcohol Rectificado 95 % | L | MP | Nortesur S.A. |
| 220043 | Ceniza de soda (PH+) | Kg | MP | Quimica Oriental S.A. |
| 220148 | Bidon PEAD Natural Pesado x 10 L (400 g) c/ tapa 43 mm | Unid. | ENV | PLASTICO SANCHEZ |
| *(vacío)* | Bidones x 5 L | Unid. | ENV | PLASTICO SANCHEZ |
| 220039 | Envase Pet de 60cc limpia notebooks (tubo largo) | Unid. | ENV | — |
| 220098 | Etiq. Logo (COD. 22020520) 76 mm (2000 x R.) | Unid. | CON | MIL ROLLOS |
| 220115 | Etiq. Medianas corto (COD 232246) 102 x 78 mm (1930 x R) | Unid. | CON | MIL ROLLOS |
| MP06 | Cintas Ph Fabricacion | Unid. | CON | DIU |

Notar: códigos numéricos de 6 dígitos conviven con `MP06`; hay filas sin código;
y la unidad alterna mayúsculas.

### Duplicados e inconsistencias

- **6 códigos duplicados** (arriba).
- **1 descripción exactamente repetida**: `"Tapas Alcoa rosca 28 CORTA"` en dos filas.
- **Unidades inconsistentes**: `kg` / `Kg`, `Unid.` / `Unid`, además de `L`, `mL`, `g`.
- **Proveedores ya normalizados** el 2026-07-29 (139 celdas): antes convivían
  `CARRETO` y `Carretto Rodriguez`, `GREEN OIL` y `Green Oil S.A.`. Hoy los 65 del
  maestro están unificados.

---

## 4. Relaciones de `inventario`

### No tiene ninguna foreign key. Ni entrante ni saliente.

Buscando en todo el SQL, **nada referencia a `inventario`**. Tampoco a `precios`
ni a `proveedores`. La única FK de Compras es:

```
entregas.pedido_id → pedidos.id   (on delete cascade)
```

### Cómo se relacionan las cosas entonces

Por **texto libre**, resuelto en el navegador con comparación difusa:

| Desde | Hacia | Cómo |
|---|---|---|
| `precios.articulo` | producto | texto normalizado |
| `precios.proveedor` | `proveedores.empresa` | texto normalizado |
| `pedidos.descripcion` | producto | texto normalizado + match por palabras |
| `pedidos.proveedor` | `proveedores.empresa` | texto normalizado |
| `inventario.proveedor` / `proveedor_sugerido` | `proveedores.empresa` | texto normalizado |
| `contingencia.articulo` | producto | superposición de palabras |

Qué tan bien matchean, medido:

- `precios`: 148 artículos distintos, **118 coinciden** con una descripción de
  `inventario`. Quedan ~30 sueltos.
- `pedidos`: 247 descripciones distintas, **solo 24 coinciden** con `inventario`.

Ese último número es el más importante del documento: **las órdenes de compra
nombran los productos de una forma que casi nunca coincide literalmente con el
catálogo**. El frontend lo resuelve con un matcher difuso (`matchKeys` en
`stock.html`) que compara por palabras con umbral del 80% y descarta si aparecen
palabras discriminadoras (`AZUL`, `CORTA`, `VERDE`).

### Qué implica para mover o compartir las materias primas

- **A nivel base de datos no se rompe nada**: no hay FKs que respetar.
- **A nivel aplicación se rompe todo lo que importa.** Los cálculos de stock en
  tránsito, proveedor sugerido, comparación de precios y cobertura dependen de que
  la descripción de `inventario` siga siendo *parecida* a la de `precios` y
  `pedidos`. Cambiar las descripciones al migrar rompe los cruces en silencio: no
  hay error, simplemente los números dejan de cuadrar.
- **Recomendación**: al unificar, agregar `articulo_id` como FK real y hacer la
  migración de datos con una tabla de equivalencias revisada a mano, conservando
  las descripciones actuales como alias hasta que todo apunte al id.

### Depósitos sí está normalizado

A diferencia de Compras, `deposito/` tiene FKs reales: `imp_pallets.articulo_id →
imp_articulos.id`, `imp_stock.articulo_id`, `imp_estanterias.subdeposito_id`, y 9
FKs contra `imp_depositos.nombre`. Ahí sí hay que respetar el orden al migrar.

---

## 5. Proveedores

**Confirmado: son propios y no se comparten con ninguna otra app.**

- Tabla `proveedores`, 65 filas, creada en la migración desde Google Sheets.
- Ninguna otra aplicación de la empresa lee ni escribe esta tabla hoy.
- **Pero tampoco están normalizados hacia adentro**: `precios.proveedor`,
  `pedidos.proveedor` e `inventario.proveedor` son texto libre que *coincide* con
  `proveedores.empresa` porque se limpió a mano, no porque haya una FK.
- El 2026-07-29 se completó el maestro: tenía 30 fichas y se usaban 65 proveedores.
  Hoy no queda ninguno en uso sin ficha, pero **33 de 65 no tienen ningun dato de contacto** (ni nombre, ni email, ni celular).

---

## 6. Autenticación

- **Supabase Auth**, email + contraseña. Sin OAuth ni SSO.
- Un trigger `on_auth_user_created` crea el perfil en `profiles` al alta.
- La autorización es por **módulos**: `profiles.modules` es un array de texto y
  `profiles.role` es `admin` o `user`. Las políticas RLS usan dos funciones,
  `is_admin()` y `has_module(texto)`.

### Usuarios hoy: 3

| Email | Rol | Módulos |
|---|---|---|
| alechiesa.subatir@gmail.com | admin | todos (9) |
| diegolaluz.subatir@gmail.com | admin | todos (9) |
| germanmartinezsubatir@gmail.com | user | solo `recepcion` |

Módulos existentes: `recepcion`, `precios`, `proveedores`, `pedidos`, `stock`,
`contingencia`, `importacion`, `solicitante`, `recorrido`.

Un usuario con solo `recepcion` queda encerrado en su pantalla; lo mismo con
`solicitante` y `recorrido` en la app de celular.

---

## 7. Cómo consulta la base

- **Cliente de Supabase (PostgREST)**: `SB.from('tabla').select()/insert()/update()`.
  **No hay SQL crudo desde el navegador.**
- Las operaciones que tocan stock o estado van por **RPC `SECURITY DEFINER`**, no
  por escritura directa: `imp_ingreso`, `imp_pallet_armar`, `imp_pallet_cerrar`,
  `imp_pallet_scan`, `imp_pallet_ubicar`, `imp_pallet_consumir`,
  `imp_solicitud_crear/iniciar/cancelar`, entre otras. Cada una valida el permiso
  con `has_module()` adentro.
- **Realtime** suscrito en las dos apps para refrescar solo.

### Credenciales

- **`supabase-config.js`**, en la raíz del repo, **versionado en git**:
  contiene la URL y la **anon key** en texto plano.
- **No hay variables de entorno** — es un sitio estático, no hay dónde ponerlas.
- Esto es correcto para el modelo de Supabase: la anon key es pública por diseño y
  la seguridad la aplica RLS. **No hay ninguna `service_role` key en el frontend**
  (se verificó).
- Excepción: `copiloto.html` puede usar la API de Anthropic con una key que el
  usuario pega y queda en su `localStorage` — nunca en el repo.

---

## 8. Deploy y automatizaciones

### No hay

- **Sin Edge Functions.**
- **Sin cron jobs** ni `pg_cron`.
- **Sin webhooks.**
- **Sin integración con Google** activa. La app nació sobre Google Sheets + Apps
  Script y migró en 2026-07; queda una URL de Apps Script **vestigial** en
  `contingencia.html` y `copiloto.html` que ya no se llama. Conviene borrarla.
- **Sin CI/CD**: el deploy es un `.bat` que hace push.

### Sí hay

**Triggers en la base** (4):

| Trigger | Qué hace |
|---|---|
| `on_auth_user_created` | Crea el perfil al dar de alta un usuario |
| `trg_entregas_sync` | Marca la línea de OC como recibida cuando las entregas parciales completan la cantidad |
| `trg_imp_sol_sync` | Avanza la solicitud y sus items según el estado del pallet al escanear |
| `trg_touch_*` | `updated_at` automático |

**Realtime**: las tablas están en la publicación `supabase_realtime`.

**Service worker** en `deposito/` (PWA instalable). Cachea la cáscara, **nunca**
las llamadas a Supabase ni `version.json`.

**Chequeo de versión propio**: cada página lleva un `APP_VER` que compara contra
`version.json`; si difiere, la pestaña se recarga sola. `bump-version.ps1` los
escribe juntos y aborta si alguno falta.

---

## Resumen para el plan de integración

Los tres puntos que van a definir el trabajo:

1. **Hay dos catálogos de productos** (`inventario` 148 / `imp_articulos` 119) con
   solo 12 códigos en común. Unificarlos es el trabajo grande y necesita decisión
   de negocio, no técnica.

2. **Compras no tiene integridad referencial.** Todo se cruza por texto difuso en
   el navegador. Se puede mover la tabla sin que la base se queje, pero los
   números dejan de cuadrar en silencio. Antes de compartir materias primas hay
   que introducir `articulo_id` real.

3. **`codigo` no sirve como clave**: 7 filas sin código y 6 códigos compartidos
   entre productos distintos. Hace falta definir un identificador estable antes
   de exponer estas materias primas a otra app.
