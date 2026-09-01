# Configuración de reposición por artículo y proveedor — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avisar cuándo hay que pedir un artículo con demora de producción o de compra poco frecuente, antes de que el semáforo actual se ponga en rojo — que para esos casos ya es tarde.

**Architecture:** La cuenta vive en un archivo compartido nuevo (`reposicion-calc.js`) que se carga en las tres pantallas y se puede probar con `node --test` sin navegador. Los datos van en columnas nuevas de `inventario` (lo del artículo) y una tabla nueva `art_proveedor` (lo del proveedor), expuestos por el adaptador `MAPS` que ya existe. La señal nueva convive con el semáforo actual sin reemplazarlo.

**Tech Stack:** HTML + JS plano (sin build, sin framework), Supabase (Postgres + RLS) vía `supabase-js` por CDN, GitHub Pages. Tests con `node --test` (Node 24, sin dependencias).

**Spec:** `docs/superpowers/specs/2026-09-01-configuracion-reposicion-design.md`

## Global Constraints

- **Cloud-only.** Toda escritura va directo a Supabase + `load()` para refrescar. Nada de `localStorage`, nada de botón "Sincronizar".
- **Toda escritura verifica filas afectadas con `.select()`.** Un UPDATE bloqueado por RLS devuelve cero filas **sin error**. Ya causó una pérdida de datos silenciosa en recepción.
- **Los cambios de datos van como archivo SQL en `migracion/`, idempotente y con un `select` de verificación al final. Lo corre el usuario**, no el implementador. En el SQL Editor de Supabase `auth.uid()` es NULL, así que las funciones con chequeo de permiso no se prueban ahí.
- **No se elimina ninguna funcionalidad existente.** El semáforo (`recalcItem`) y todo lo que hoy hace el modal ✏ quedan intactos.
- **Estética:** fondo oscuro, glassmorphism, acentos naranja/petróleo. Variables CSS ya definidas (`--bg`, `--teal`, `--or`, `--txt`, `--mut`, `--bdr`, `--gl`). Fuentes Syne (títulos) / DM Sans (texto) / IBM Plex Mono (números).
- **No se publica desde una tarea.** La publicación es la Tarea 9, una sola vez, al final.
- **JS de navegador en estilo ES5**, como el resto del proyecto: `var`, `function`, sin arrow functions ni `const` en los archivos que carga el navegador. El archivo de tests sí puede usar sintaxis moderna (corre en Node).

---

### Task 1: La cuenta de reposición, aislada y testeada

**Files:**
- Create: `reposicion-calc.js`
- Create: `test/reposicion-calc.test.js`

**Interfaces:**
- Consumes: nada. Es la base de todo lo demás.
- Produces: `Reposicion.calcular(art, hoy)` → objeto con `{ senal, fechaLimite, diasStock, diasParaPedir, demoraUsada, sugerido, falta, motivo, pactadaAgotada, pactadaVencida }`.
  - `art` = `{ seguimiento, stock, minimo, consumo, pendiente, demoraDias, loteMinimo, multiplo, proximaRevision, revisarCadaMeses, ultimaOC, pactCantidad, pactEntregado, pactVence }`
  - `senal` ∈ `'ATRASADO' | 'PEDIR' | 'REVISAR' | 'OK' | 'SIN_DATOS' | null`
  - `null` = el artículo no tiene seguimiento y no participa.
  - `motivo` = `'falta-consumo' | 'falta-demora' | 'sin-oc'` cuando `senal === 'SIN_DATOS'`, si no `''`.
  - Fechas de entrada y salida como `Date`. `hoy` se pasa siempre por parámetro (nunca `new Date()` adentro) para que los tests sean deterministas.
- Produces: `Reposicion.desdeFila(invRow, ficha, ultimaOC)` → el objeto `art` que come `calcular`, armado desde una fila de `RAW_INV` (con los nombres de header del adaptador) y su ficha de `art_proveedor`.
  - **Las tres pantallas (Tareas 5, 6 y 7) lo usan.** Es el único lugar donde se traduce de los nombres de header a los del cálculo. Escrito tres veces, en tres meses no coincide consigo mismo — que es la razón por la que este archivo existe.
  - `ficha` puede venir `{}` o `null` (artículo sin ficha cargada). **Los bloques destildados se ignoran**: una demora cargada con `usar_demora` en false no se usa.
  - `ultimaOC` puede venir `null` (el dashboard no arma el índice de OC).
- Produces: `Reposicion.canonProv(s)` → normalizador de nombre de proveedor, para que las tres pantallas indexen las fichas igual.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `test/reposicion-calc.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { Reposicion } = require('../reposicion-calc.js');

const HOY = new Date('2026-09-01T00:00:00Z');
const base = {
  seguimiento: true, stock: 0, minimo: 0, consumo: 0, pendiente: 0,
  demoraDias: null, loteMinimo: null, multiplo: null,
  proximaRevision: null, revisarCadaMeses: null, ultimaOC: null,
  pactCantidad: null, pactEntregado: 0, pactVence: null
};
const art = (o) => Object.assign({}, base, o);

test('sin seguimiento devuelve senal null y no participa', () => {
  const r = Reposicion.calcular(art({ seguimiento: false, stock: 10, minimo: 100, consumo: 50, demoraDias: 30 }), HOY);
  assert.strictEqual(r.senal, null);
});

test('el minimo es colchon: la fecha limite resta demora sobre el stock util', () => {
  // stock util = 100000 - 40000 = 60000; consumo diario = 30000/30 = 1000
  // dias de stock = 60; menos 30 de demora => hay que pedir en 30 dias
  const r = Reposicion.calcular(art({ stock: 100000, minimo: 40000, consumo: 30000, demoraDias: 30 }), HOY);
  assert.strictEqual(r.diasStock, 60);
  assert.strictEqual(r.diasParaPedir, 30);
  assert.strictEqual(r.senal, 'OK');
  assert.strictEqual(r.fechaLimite.toISOString().slice(0, 10), '2026-10-01');
});

test('el stock en transito cuenta como disponible', () => {
  const r = Reposicion.calcular(art({ stock: 40000, minimo: 40000, consumo: 30000, pendiente: 60000, demoraDias: 30 }), HOY);
  assert.strictEqual(r.diasStock, 60);
  assert.strictEqual(r.senal, 'OK');
});

test('a 7 dias o menos la senal es PEDIR', () => {
  const r = Reposicion.calcular(art({ stock: 77000, minimo: 40000, consumo: 30000, demoraDias: 30 }), HOY);
  assert.strictEqual(r.diasParaPedir, 7);
  assert.strictEqual(r.senal, 'PEDIR');
});

test('fecha limite en el pasado es ATRASADO', () => {
  // Etiq. Medianas corto (id 84), datos reales: ya esta debajo del minimo
  const r = Reposicion.calcular(art({ stock: 25350, minimo: 35000, consumo: 70000, demoraDias: 30 }), HOY);
  assert.ok(r.diasParaPedir < 0);
  assert.strictEqual(r.senal, 'ATRASADO');
});

test('Etiq. Medianas largo (id 85) con datos reales queda OK', () => {
  const r = Reposicion.calcular(art({ stock: 95000, minimo: 20000, consumo: 40000, demoraDias: 30 }), HOY);
  assert.strictEqual(r.senal, 'OK');
});

test('sin consumo no inventa fecha limite: pide el dato', () => {
  const r = Reposicion.calcular(art({ stock: 100, minimo: 50, consumo: 0, demoraDias: 30 }), HOY);
  assert.strictEqual(r.senal, 'SIN_DATOS');
  assert.strictEqual(r.motivo, 'falta-consumo');
  assert.strictEqual(r.fechaLimite, null);
});

test('sin demora cargada no inventa fecha limite: pide el dato', () => {
  const r = Reposicion.calcular(art({ stock: 100, minimo: 50, consumo: 30, demoraDias: null }), HOY);
  assert.strictEqual(r.senal, 'SIN_DATOS');
  assert.strictEqual(r.motivo, 'falta-demora');
  assert.strictEqual(r.fechaLimite, null);
});

test('proxima revision vencida da REVISAR aunque el stock alcance', () => {
  const r = Reposicion.calcular(art({
    stock: 999999, minimo: 10, consumo: 30, demoraDias: 5,
    proximaRevision: new Date('2026-08-20T00:00:00Z')
  }), HOY);
  assert.strictEqual(r.senal, 'REVISAR');
});

test('la regla por meses cuenta desde la ultima OC', () => {
  const r = Reposicion.calcular(art({
    stock: 999999, minimo: 10, consumo: 30, demoraDias: 5,
    revisarCadaMeses: 3, ultimaOC: new Date('2026-05-01T00:00:00Z')
  }), HOY);
  assert.strictEqual(r.senal, 'REVISAR'); // 01/05 + 3 meses = 01/08, ya paso
});

test('la regla por meses todavia no cumplida no dispara', () => {
  const r = Reposicion.calcular(art({
    stock: 999999, minimo: 10, consumo: 30, demoraDias: 5,
    revisarCadaMeses: 3, ultimaOC: new Date('2026-08-01T00:00:00Z')
  }), HOY);
  assert.strictEqual(r.senal, 'OK');
});

test('regla por meses sin ninguna OC no cuenta desde ningun lado', () => {
  const r = Reposicion.calcular(art({
    stock: 999999, minimo: 10, consumo: 30, demoraDias: 5,
    revisarCadaMeses: 3, ultimaOC: null
  }), HOY);
  assert.strictEqual(r.senal, 'SIN_DATOS');
  assert.strictEqual(r.motivo, 'sin-oc');
});

test('la compra pactada avisa 30 dias antes de vencer', () => {
  const r = Reposicion.calcular(art({
    stock: 999999, minimo: 10, consumo: 30, demoraDias: 5,
    pactCantidad: 1000, pactEntregado: 200, pactVence: new Date('2026-09-20T00:00:00Z')
  }), HOY);
  assert.strictEqual(r.senal, 'REVISAR'); // faltan 19 dias, entra en la ventana
});

test('la pactada todavia lejos no dispara', () => {
  const r = Reposicion.calcular(art({
    stock: 999999, minimo: 10, consumo: 30, demoraDias: 5,
    pactCantidad: 1000, pactEntregado: 200, pactVence: new Date('2026-12-01T00:00:00Z')
  }), HOY);
  assert.strictEqual(r.senal, 'OK');
});

test('la pactada agotada deja de aportar al recordatorio', () => {
  const r = Reposicion.calcular(art({
    stock: 999999, minimo: 10, consumo: 30, demoraDias: 5,
    pactCantidad: 1000, pactEntregado: 1000, pactVence: new Date('2026-09-20T00:00:00Z')
  }), HOY);
  assert.strictEqual(r.senal, 'OK');
  assert.strictEqual(r.pactadaAgotada, true);
});

test('la pactada vencida deja de aportar pero se marca vencida', () => {
  const r = Reposicion.calcular(art({
    stock: 999999, minimo: 10, consumo: 30, demoraDias: 5,
    pactCantidad: 1000, pactEntregado: 200, pactVence: new Date('2026-07-01T00:00:00Z')
  }), HOY);
  assert.strictEqual(r.senal, 'OK');
  assert.strictEqual(r.pactadaVencida, true);
});

test('ATRASADO gana sobre REVISAR: lo urgente primero', () => {
  const r = Reposicion.calcular(art({
    stock: 0, minimo: 100, consumo: 30, demoraDias: 5,
    proximaRevision: new Date('2026-08-20T00:00:00Z')
  }), HOY);
  assert.strictEqual(r.senal, 'ATRASADO');
});

test('la cantidad sugerida cubre dos meses mas el minimo', () => {
  // objetivo = 100 + 50*2 = 200; falta = 200 - 20 - 30 = 150
  const r = Reposicion.calcular(art({ stock: 20, minimo: 100, consumo: 50, pendiente: 30, demoraDias: 5 }), HOY);
  assert.strictEqual(r.falta, 150);
  assert.strictEqual(r.sugerido, 150);
});

test('la sugerida sube al multiplo del proveedor', () => {
  const r = Reposicion.calcular(art({ stock: 20, minimo: 100, consumo: 50, pendiente: 30, demoraDias: 5, multiplo: 40 }), HOY);
  assert.strictEqual(r.sugerido, 160); // ceil(150/40)*40
});

test('la sugerida nunca baja del lote minimo', () => {
  const r = Reposicion.calcular(art({ stock: 20, minimo: 100, consumo: 50, pendiente: 30, demoraDias: 5, loteMinimo: 500 }), HOY);
  assert.strictEqual(r.sugerido, 500);
});

test('si sobra stock no sugiere comprar', () => {
  const r = Reposicion.calcular(art({ stock: 100000, minimo: 100, consumo: 50, demoraDias: 5 }), HOY);
  assert.strictEqual(r.sugerido, 0);
});

// ── desdeFila: el adaptador que usan las tres pantallas ──────────────
const FILA = {
  __row: 85, 'DESCRIPCIÓN': 'Etiq. Medianas largo', 'PROVEEDOR': 'MIL ROLLOS',
  'INVENTARIO': 95000, 'STOCK MÍNIMO': 20000, 'CONSUMO MENSUAL': 40000,
  'PENDIENTE DE ENTREGA': null, 'SEGUIMIENTO': true,
  'REVISAR CADA MESES': 3, 'PROXIMA REVISION': '2026-10-15'
};

test('desdeFila traduce los nombres de header a los del calculo', () => {
  const a = Reposicion.desdeFila(FILA, { demora_dias: 30, usar_demora: true }, null);
  assert.strictEqual(a.seguimiento, true);
  assert.strictEqual(a.stock, 95000);
  assert.strictEqual(a.minimo, 20000);
  assert.strictEqual(a.consumo, 40000);
  assert.strictEqual(a.pendiente, 0);
  assert.strictEqual(a.demoraDias, 30);
  assert.strictEqual(a.revisarCadaMeses, 3);
  assert.strictEqual(a.proximaRevision.toISOString().slice(0, 10), '2026-10-15');
});

test('desdeFila ignora los bloques destildados', () => {
  // dato cargado pero sin tildar: no se usa. El tilde es el que manda.
  const a = Reposicion.desdeFila(FILA, {
    demora_dias: 30, usar_demora: false,
    lote_minimo: 500, multiplo: 40, usar_lote: false,
    pact_cantidad: 1000, pact_vence: '2026-12-01', usar_pactada: false
  }, null);
  assert.strictEqual(a.demoraDias, null);
  assert.strictEqual(a.loteMinimo, null);
  assert.strictEqual(a.multiplo, null);
  assert.strictEqual(a.pactCantidad, null);
  assert.strictEqual(a.pactVence, null);
});

test('desdeFila tolera un articulo sin ficha', () => {
  const a = Reposicion.desdeFila(FILA, null, null);
  assert.strictEqual(a.demoraDias, null);
  assert.strictEqual(a.seguimiento, true);
  assert.strictEqual(Reposicion.calcular(a, HOY).motivo, 'falta-demora');
});

test('desdeFila trata el SEGUIMIENTO en texto como booleano', () => {
  // el adaptador puede devolverlo como string segun de donde venga
  const a = Reposicion.desdeFila(Object.assign({}, FILA, { 'SEGUIMIENTO': 'true' }), null, null);
  assert.strictEqual(a.seguimiento, true);
  const b = Reposicion.desdeFila(Object.assign({}, FILA, { 'SEGUIMIENTO': '' }), null, null);
  assert.strictEqual(b.seguimiento, false);
});

test('canonProv normaliza tildes, espacios y mayusculas', () => {
  assert.strictEqual(Reposicion.canonProv(' Química S.A. '), Reposicion.canonProv('QUIMICA S.A.'));
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test` (desde la raíz, SIN pasarle `test/`: Node 24 en Windows no resuelve el directorio como argumento)
Expected: FAIL — `Cannot find module '../reposicion-calc.js'`

- [ ] **Step 3: Escribir la implementación mínima**

Crear `reposicion-calc.js`:

```js
// ─── La cuenta de la reposición ──────────────────────────────────────
// Vive aparte de stock.html porque la usan tres pantallas (Stock, la de
// configuración y el Dashboard). Una fórmula de reposición copiada en
// tres lados es una fórmula que en tres meses no coincide consigo misma.
//
// `hoy` entra siempre por parámetro y nunca se llama a new Date() acá:
// es lo que permite probarla con node --test sin navegador.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = { Reposicion: api };
  root.Reposicion = api;
})(typeof self !== 'undefined' ? self : this, function () {

  var DIA = 86400000;
  var MESES_OBJETIVO = 2;      // cuántos meses de consumo cubre la sugerencia
  var DIAS_AVISO = 7;          // ventana de "entra en el control de esta semana"
  var DIAS_AVISO_PACTADA = 30; // cuánto antes de que venza un contrato se avisa

  function sumarMeses(fecha, n) {
    var d = new Date(fecha.getTime());
    d.setUTCMonth(d.getUTCMonth() + n);
    return d;
  }

  // Fecha del recordatorio: la que caiga primero entre la puntual, la
  // regla por meses y el vencimiento de la compra pactada.
  // Sin última OC la regla por meses no tiene desde dónde contar, y una
  // pactada agotada o ya vencida no aporta: seguiría avisando para
  // siempre por algo que ya no se puede usar.
  function fechaRecordatorio(art, hoy) {
    var cand = [];
    if (art.proximaRevision) cand.push(art.proximaRevision);
    if (art.revisarCadaMeses > 0 && art.ultimaOC) cand.push(sumarMeses(art.ultimaOC, art.revisarCadaMeses));
    if (art.pactVence && !pactadaAgotada(art) && art.pactVence >= hoy) {
      cand.push(new Date(art.pactVence.getTime() - DIAS_AVISO_PACTADA * DIA));
    }
    if (!cand.length) return null;
    return new Date(Math.min.apply(null, cand.map(function (f) { return f.getTime(); })));
  }

  function pactadaAgotada(art) {
    return +art.pactCantidad > 0 && (+art.pactEntregado || 0) >= +art.pactCantidad;
  }

  function calcular(art, hoy) {
    var r = {
      senal: null, fechaLimite: null, diasStock: null, diasParaPedir: null,
      demoraUsada: null, sugerido: 0, falta: 0, motivo: '',
      pactadaAgotada: false, pactadaVencida: false
    };
    if (!art || !art.seguimiento) return r;

    var stock = +art.stock || 0, minimo = +art.minimo || 0;
    var consumo = +art.consumo || 0, pend = +art.pendiente || 0;

    // Cantidad sugerida: se calcula siempre que haya consumo, aunque no
    // haya demora, porque sirve igual para decidir cuánto pedir.
    var objetivo = minimo + consumo * MESES_OBJETIVO;
    var falta = Math.max(0, objetivo - stock - pend);
    r.falta = falta;
    r.sugerido = falta;
    if (falta > 0) {
      if (+art.multiplo > 0) r.sugerido = Math.ceil(falta / art.multiplo) * art.multiplo;
      if (+art.loteMinimo > 0) r.sugerido = Math.max(r.sugerido, +art.loteMinimo);
    }

    r.pactadaAgotada = pactadaAgotada(art);
    r.pactadaVencida = !!(art.pactVence && art.pactVence < hoy);

    var recordatorio = fechaRecordatorio(art, hoy);
    var toca = recordatorio !== null && recordatorio <= hoy;

    // Sin los datos para la fecha límite no se inventa una señal: se pide
    // el dato que falta. El recordatorio sí puede disparar igual.
    if (consumo <= 0) { r.senal = toca ? 'REVISAR' : 'SIN_DATOS'; r.motivo = toca ? '' : 'falta-consumo'; return r; }
    if (!(+art.demoraDias > 0)) { r.senal = toca ? 'REVISAR' : 'SIN_DATOS'; r.motivo = toca ? '' : 'falta-demora'; return r; }

    r.demoraUsada = +art.demoraDias;

    // El mínimo es colchón, no disparador: la alerta salta cuando pedir
    // hoy ya te haría tocar el mínimo antes de que llegue la mercadería.
    var diario = consumo / 30;
    r.diasStock = Math.round((stock + pend - minimo) / diario);
    r.diasParaPedir = r.diasStock - r.demoraUsada;
    r.fechaLimite = new Date(hoy.getTime() + r.diasParaPedir * DIA);

    // Lo urgente primero: una fecha límite vencida gana sobre el recordatorio.
    if (r.diasParaPedir < 0) r.senal = 'ATRASADO';
    else if (r.diasParaPedir <= DIAS_AVISO) r.senal = 'PEDIR';
    else if (toca) r.senal = 'REVISAR';
    else if (art.revisarCadaMeses > 0 && !art.ultimaOC && !art.proximaRevision) { r.senal = 'SIN_DATOS'; r.motivo = 'sin-oc'; }
    else r.senal = 'OK';

    return r;
  }

  // ── El adaptador ────────────────────────────────────────────────
  // Traduce una fila del inventario (nombres de header del adaptador de
  // subatir-app.js) + su ficha de art_proveedor al objeto que come
  // calcular(). Vive acá y no en cada pantalla porque lo usan las tres.
  function canonProv(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  }

  function fecha(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d) ? null : d;
  }

  function desdeFila(inv, ficha, ultimaOC) {
    inv = inv || {};
    var f = ficha || {};
    var seg = inv['SEGUIMIENTO'];
    return {
      // El tilde es el que manda: un dato cargado sin tildar no se usa.
      seguimiento: seg === true || seg === 'true',
      stock:     +inv['INVENTARIO'] || 0,
      minimo:    +inv['STOCK MÍNIMO'] || 0,
      consumo:   +inv['CONSUMO MENSUAL'] || 0,
      pendiente: +inv['PENDIENTE DE ENTREGA'] || 0,
      demoraDias:    f.usar_demora  ? (+f.demora_dias || null) : null,
      loteMinimo:    f.usar_lote    ? (+f.lote_minimo || null) : null,
      multiplo:      f.usar_lote    ? (+f.multiplo    || null) : null,
      pactCantidad:  f.usar_pactada ? (+f.pact_cantidad || null) : null,
      pactEntregado: f.usar_pactada ? (+f.pact_entregado || 0)  : 0,
      pactVence:     f.usar_pactada ? fecha(f.pact_vence) : null,
      proximaRevision:  fecha(inv['PROXIMA REVISION']),
      revisarCadaMeses: +inv['REVISAR CADA MESES'] || null,
      ultimaOC: ultimaOC || null
    };
  }

  return {
    calcular: calcular, desdeFila: desdeFila, canonProv: canonProv,
    MESES_OBJETIVO: MESES_OBJETIVO, DIAS_AVISO: DIAS_AVISO,
    DIAS_AVISO_PACTADA: DIAS_AVISO_PACTADA
  };
});
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test` (desde la raíz, SIN pasarle `test/`: Node 24 en Windows no resuelve el directorio como argumento)
Expected: PASS — 26 tests.

- [ ] **Step 5: Commit**

```bash
git add reposicion-calc.js test/reposicion-calc.test.js
git commit -m "Stock: la cuenta de la reposicion, aislada y con tests"
```

---

### Task 2: El SQL de la base

**Files:**
- Create: `migracion/reposicion.sql`
- Create: `migracion/reposicion_rollback.sql`

**Interfaces:**
- Consumes: nada.
- Produces: columnas `inventario.seguimiento` (boolean), `.revisar_cada_meses` (smallint), `.proxima_revision` (date), `.prov_auto_at` (timestamptz), `.prov_auto_oc` (text); tabla `public.art_proveedor` con las columnas de la sección 3.2 del spec y `unique (inventario_id, proveedor)`.

- [ ] **Step 1: Escribir el SQL**

Crear `migracion/reposicion.sql`:

```sql
-- ============================================================
--  Configuracion de reposicion por articulo y proveedor.
--  Idempotente: correrlo dos veces no hace dano.
--  Correr en Supabase -> SQL Editor.
-- ============================================================

-- 1 . Lo del articulo, en la tabla que ya lo describe
alter table public.inventario
  add column if not exists seguimiento        boolean not null default false,
  add column if not exists revisar_cada_meses smallint,
  add column if not exists proxima_revision   date,
  add column if not exists prov_auto_at       timestamptz,
  add column if not exists prov_auto_oc       text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventario_revisar_meses_ck') then
    alter table public.inventario
      add constraint inventario_revisar_meses_ck
      check (revisar_cada_meses is null or revisar_cada_meses between 1 and 60);
  end if;
end $$;

-- 2 . Lo del proveedor
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

  -- Un bloque tildado sin su dato cargado seria una alerta que no puede
  -- calcularse. Se impide en la base, no solo en la pantalla.
  --
  -- El "is not null" de cada lado no es decorativo: un CHECK solo rechaza
  -- la fila cuando evalua a FALSE, y "NULL > 0" da NULL, que pasa. Sin el,
  -- "not usar_demora or demora_dias > 0" deja entrar justo el caso que
  -- dice bloquear (tildado y vacio).
  constraint ap_demora_ck  check (not usar_demora  or (demora_dias is not null and demora_dias > 0)),
  constraint ap_lote_ck    check (not usar_lote    or (lote_minimo is not null and lote_minimo > 0)
                                                   or (multiplo    is not null and multiplo    > 0)),
  constraint ap_pactada_ck check (not usar_pactada or (pact_cantidad is not null and pact_cantidad > 0
                                                       and pact_vence is not null))
);

create index if not exists art_proveedor_inv_idx on public.art_proveedor(inventario_id);

-- 3 . RLS: lectura para autenticados, escritura para quien tenga el modulo
alter table public.art_proveedor enable row level security;

drop policy if exists ap_sel on public.art_proveedor;
drop policy if exists ap_ins on public.art_proveedor;
drop policy if exists ap_upd on public.art_proveedor;
drop policy if exists ap_del on public.art_proveedor;

create policy ap_sel on public.art_proveedor for select to authenticated using (true);
create policy ap_ins on public.art_proveedor for insert to authenticated
  with check (public.is_admin() or public.has_module('stock'));
create policy ap_upd on public.art_proveedor for update to authenticated
  using (public.is_admin() or public.has_module('stock'))
  with check (public.is_admin() or public.has_module('stock'));
create policy ap_del on public.art_proveedor for delete to authenticated
  using (public.is_admin() or public.has_module('stock'));

-- 4 . Realtime, para que Stock y la pantalla de configuracion se refresquen entre si
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'art_proveedor'
  ) then
    alter publication supabase_realtime add table public.art_proveedor;
  end if;
end $$;
```

Y al final, el `select` de verificación:

```sql
select 'columnas' as que, count(*)::text as valor
  from information_schema.columns
 where table_name = 'inventario'
   and column_name in ('seguimiento','revisar_cada_meses','proxima_revision','prov_auto_at','prov_auto_oc')
union all
select 'tabla art_proveedor', count(*)::text from information_schema.tables where table_name = 'art_proveedor'
union all
select 'checks', count(*)::text from information_schema.table_constraints
 where table_name = 'art_proveedor' and constraint_type = 'CHECK'
   and constraint_name in ('ap_demora_ck','ap_lote_ck','ap_pactada_ck')
union all
select 'policies', count(*)::text from pg_policies where tablename = 'art_proveedor';

-- Esperado: columnas 5 | tabla art_proveedor 1 | checks 3 | policies 4
```

Crear `migracion/reposicion_rollback.sql`:

```sql
drop table if exists public.art_proveedor;
alter table public.inventario drop constraint if exists inventario_revisar_meses_ck;
alter table public.inventario
  drop column if exists seguimiento,
  drop column if exists revisar_cada_meses,
  drop column if exists proxima_revision,
  drop column if exists prov_auto_at,
  drop column if exists prov_auto_oc;
```

- [ ] **Step 2: Chequear la sintaxis sin tocar la base**

No hay Postgres local. Releer el archivo contra la sección 3 del spec, campo por campo, y verificar a mano:
- que los nombres de columna coincidan **exactos** con los que usa `MAPS.inventario` en la Tarea 3;
- que los tres `check` estén escritos como en el spec (`not usar_X or <dato cargado>`);
- que no haya acentos en nombres de objeto.

- [ ] **Step 3: Pedirle al usuario que lo corra**

Decirle: *"Corré `migracion/reposicion.sql` en el SQL Editor de Supabase"*. **No aplicarlo desde acá.**

- [ ] **Step 4: Verificar contra la base real**

Con `mcp__claude-in-chrome__javascript_tool` sobre una página publicada de la app (donde `window.SB` tiene la sesión del usuario), verificar:

```js
// que la tabla existe y se puede leer
const sel = await SB.from('art_proveedor').select('*').limit(1);
// que la RLS de escritura funciona: tiene que devolver 1 fila, no 0
const ins = await SB.from('art_proveedor').insert({ inventario_id: 85, proveedor: 'PRUEBA', demora_dias: 30, usar_demora: true }).select();
// que el check rechaza un bloque tildado sin dato
const mal = await SB.from('art_proveedor').insert({ inventario_id: 85, proveedor: 'PRUEBA2', usar_demora: true }).select();
// limpiar
const del = await SB.from('art_proveedor').delete().eq('proveedor', 'PRUEBA').select();
JSON.stringify({ sel: sel.error, insFilas: (ins.data||[]).length, malDaError: !!mal.error, delFilas: (del.data||[]).length });
```

Expected: `insFilas: 1`, `malDaError: true`, `delFilas: 1`. **Cero filas en el insert = RLS bloqueando, no éxito.**

- [ ] **Step 5: Commit**

```bash
git add migracion/reposicion.sql migracion/reposicion_rollback.sql
git commit -m "Stock: SQL de la configuracion de reposicion"
```

---

### Task 3: Exponer los campos nuevos en la capa de datos

**Files:**
- Modify: `subatir-app.js:109-119` (`MAPS.inventario`)
- Modify: `subatir-app.js:16-26` (`PAGE_MODULE`)
- Modify: `subatir-app.js` (agregar los helpers de `art_proveedor` al objeto público)

**Interfaces:**
- Consumes: la tabla y las columnas de la Tarea 2.
- Produces:
  - `RAW_INV` de `stock.html` pasa a traer las claves `SEGUIMIENTO`, `REVISAR CADA MESES`, `PROXIMA REVISION`, `PROV AUTO AT`, `PROV AUTO OC`.
  - `SubatirApp.getArtProveedor(invIds)` → `Promise<Array>` — filas de `art_proveedor` de esos artículos (o de todos si se omite).
  - `SubatirApp.saveArtProveedor(fila)` → `Promise<{data, error}>` — upsert por `(inventario_id, proveedor)`, con `.select()`; error si devuelve cero filas.
  - `SubatirApp.deleteArtProveedor(id)` → `Promise<{data, error}>` — con `.select()`.
  - `PAGE_MODULE['reposicion.html'] = 'stock'`.

- [ ] **Step 1: Agregar las columnas al adaptador**

En `subatir-app.js:111-117`, dentro de `inventario.cols`, sumar:

```js
        seguimiento: 'SEGUIMIENTO', revisar_cada_meses: 'REVISAR CADA MESES',
        proxima_revision: 'PROXIMA REVISION', prov_auto_at: 'PROV AUTO AT',
        prov_auto_oc: 'PROV AUTO OC'
```

y en la línea `num:` de esa misma definición agregar `'revisar_cada_meses'`, y en `date:` agregar `'proxima_revision'`.

**`seguimiento` y `prov_auto_at` NO van en ninguna de las dos listas.** `date` coerciona a tipo `date` y ya rompió una vez con `f_vto` — por eso se lo sacaron de ahí. El boolean viaja tal cual y el timestamptz se escribe como ISO string.

- [ ] **Step 2: Agregar la entrada de la página nueva**

En `subatir-app.js:16`, dentro de `PAGE_MODULE`, agregar `'reposicion.html': 'stock',`. Reusa el permiso del módulo `stock`: no hay que tocar `usuarios.html` ni repartir permisos nuevos.

- [ ] **Step 3: Escribir los helpers**

Agregarlos junto a los demás helpers públicos (donde están `getEntregas` / `addEntrega` / `deleteEntrega`), siguiendo ese mismo estilo:

```js
  // ── Configuración de reposición por artículo + proveedor ──────
  // Las tres verifican filas afectadas con .select(): una escritura
  // bloqueada por RLS devuelve cero filas SIN error.
  function getArtProveedor(invIds) {
    var q = SB.from('art_proveedor').select('*');
    if (invIds && invIds.length) q = q.in('inventario_id', invIds);
    return q.then(function (r) { return r.data || []; });
  }

  function saveArtProveedor(fila) {
    return SB.from('art_proveedor')
      .upsert(fila, { onConflict: 'inventario_id,proveedor' })
      .select()
      .then(function (r) {
        if (r.error) return { data: null, error: r.error.message };
        if (!r.data || !r.data.length) return { data: null, error: 'Sin permiso para guardar (0 filas).' };
        return { data: r.data[0], error: null };
      });
  }

  function deleteArtProveedor(id) {
    return SB.from('art_proveedor').delete().eq('id', id).select()
      .then(function (r) {
        if (r.error) return { data: null, error: r.error.message };
        if (!r.data || !r.data.length) return { data: null, error: 'Sin permiso para borrar (0 filas).' };
        return { data: r.data[0], error: null };
      });
  }
```

y exportarlas en el objeto que devuelve el módulo (`getArtProveedor: getArtProveedor, saveArtProveedor: saveArtProveedor, deleteArtProveedor: deleteArtProveedor`).

- [ ] **Step 4: Verificar en el navegador**

Levantar la página local con un query anti-caché y comprobar desde la consola:

```js
// que el adaptador trae las columnas nuevas
SubatirApp.getData().then(d => console.log(Object.keys(d.inventario[0]).filter(k => /SEGUIMIENTO|REVISAR|PROXIMA|PROV AUTO/.test(k))));
// que el helper escribe y devuelve la fila (no cero filas)
SubatirApp.saveArtProveedor({ inventario_id: 85, proveedor: 'PRUEBA', demora_dias: 30, usar_demora: true }).then(console.log);
```

Expected: las 5 claves nuevas listadas, y el save devolviendo `{data: {...}, error: null}`. Después borrar la fila de prueba con `deleteArtProveedor`.

- [ ] **Step 5: Commit**

```bash
git add subatir-app.js
git commit -m "Stock: la capa de datos expone la configuracion de reposicion"
```

---

### Task 4: El bloque "Reposición" en el ✏ de Stock

**Files:**
- Modify: `stock.html:775-809` (el `#edit-form` del modal)
- Modify: `stock.html:1831-1852` (`toggleEdit`, para poblar los campos nuevos)
- Modify: `stock.html:1854-1885` (`saveEdit`, para guardar los campos nuevos)
- Modify: `stock.html` `<head>` (cargar `reposicion-calc.js?v=1`)

**Interfaces:**
- Consumes: `Reposicion.calcular` (Tarea 1), `SubatirApp.getArtProveedor/saveArtProveedor/deleteArtProveedor` y las columnas nuevas de `RAW_INV` (Tarea 3). `CUR.__row` **es** el `inventario.id` (`subatir-app.js:139`), así que sirve directo como `inventario_id`.
- Produces: `renderFichasProv(invId)` y `saveReposicion()`, que la Tarea 6 reusa.

- [ ] **Step 1: Cargar el script compartido**

En el `<head>` de `stock.html`, junto a los otros `<script src>`, agregar:

```html
<script src="reposicion-calc.js?v=1"></script>
```

- [ ] **Step 2: Agregar el bloque al formulario**

Al final de `#edit-form` (después del `<div class="fg">` de Observaciones, antes de cerrar el div en `stock.html:809`):

```html
        <div class="fg" style="border-top:1px solid var(--bdr);margin-top:14px;padding-top:14px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="ed-seg" onchange="toggleSeg()"/>
            <span>Seguir la reposición de este artículo</span>
          </label>
          <div class="muted" style="font-size:11px;margin-top:4px">
            Avisa cuándo hay que pedirlo según la demora del proveedor, antes de que toque el mínimo.
          </div>
        </div>
        <div id="ed-rep" style="display:none">
          <div class="fg-row">
            <div class="fg">
              <label>Revisar cada (meses)</label>
              <input type="number" class="fi2" id="ed-rev-meses" min="1" max="60" step="1" placeholder="—"/>
            </div>
            <div class="fg">
              <label>Próxima revisión</label>
              <input type="date" class="fi2" id="ed-rev-fecha"/>
            </div>
          </div>
          <div id="ed-fichas"></div>
          <div id="ed-rep-calc" class="muted" style="font-size:12px;margin-top:10px"></div>
        </div>
```

- [ ] **Step 3: Poblar y guardar**

Agregar junto a `toggleEdit` / `saveEdit`:

```js
function toggleSeg(){
  document.getElementById('ed-rep').style.display =
    document.getElementById('ed-seg').checked ? 'block' : 'none';
}

// Una ficha por cada proveedor que el artículo ya tiene (la lista que
// arma collectProvs), con los tres bloques tildables. El proveedor que
// manda para la fecha límite va marcado.
function renderFichasProv(invId){
  var cont = document.getElementById('ed-fichas');
  var provs = (CUR && CUR.provs) || [];
  SubatirApp.getArtProveedor([invId]).then(function(fichas){
    var byProv = {}; fichas.forEach(function(f){ byProv[canonProv(f.proveedor)] = f; });
    cont.innerHTML = provs.map(function(p){
      var f = byProv[canonProv(p)] || {};
      var manda = canonProv(p) === canonProv(CUR.proveedor);
      return ''
       +'<div class="glass" style="padding:10px;margin-top:8px" data-prov="'+esc(p)+'">'
       +'<div style="display:flex;justify-content:space-between;align-items:center">'
       +'<strong>'+esc(p)+'</strong>'
       +(manda?'<span class="badge b-info">manda</span>':'')+'</div>'
       +'<label><input type="checkbox" class="ap-usar-demora"'+(f.usar_demora?' checked':'')+'/> Demora</label>'
       +'<input type="number" class="fi2 ap-demora" min="1" placeholder="días" value="'+(f.demora_dias||'')+'"/>'
       +'<label><input type="checkbox" class="ap-usar-lote"'+(f.usar_lote?' checked':'')+'/> Lote mínimo / múltiplo</label>'
       +'<input type="number" class="fi2 ap-lote" placeholder="lote mínimo" value="'+(f.lote_minimo||'')+'"/>'
       +'<input type="number" class="fi2 ap-mult" placeholder="múltiplo" value="'+(f.multiplo||'')+'"/>'
       +'<label><input type="checkbox" class="ap-usar-pact"'+(f.usar_pactada?' checked':'')+'/> Compra pactada</label>'
       +'<input type="number" class="fi2 ap-pact-cant" placeholder="cantidad total" value="'+(f.pact_cantidad||'')+'"/>'
       +'<input type="number" class="fi2 ap-pact-ent" placeholder="ya entregado" value="'+(f.pact_entregado||0)+'"/>'
       +'<input type="date" class="fi2 ap-pact-vence" value="'+(f.pact_vence||'')+'"/>'
       +'</div>';
    }).join('') || '<div class="muted">Este artículo no tiene proveedores cargados.</div>';
  });
}

// Guarda una fila de art_proveedor por ficha con algún bloque tildado.
// Devuelve una promesa que resuelve con el primer error, si hubo.
function saveReposicion(invId){
  var ops = [];
  [].forEach.call(document.querySelectorAll('#ed-fichas [data-prov]'), function(box){
    var v = function(sel){ var e=box.querySelector(sel); return e && e.value!=='' ? parseFloat(e.value) : null; };
    var c = function(sel){ var e=box.querySelector(sel); return !!(e && e.checked); };
    var fila = {
      inventario_id: invId, proveedor: box.getAttribute('data-prov'),
      demora_dias: v('.ap-demora'), usar_demora: c('.ap-usar-demora'),
      lote_minimo: v('.ap-lote'), multiplo: v('.ap-mult'), usar_lote: c('.ap-usar-lote'),
      pact_cantidad: v('.ap-pact-cant'), pact_entregado: v('.ap-pact-ent') || 0,
      pact_vence: (box.querySelector('.ap-pact-vence')||{}).value || null,
      usar_pactada: c('.ap-usar-pact')
    };
    var vacia = !fila.usar_demora && !fila.usar_lote && !fila.usar_pactada &&
                fila.demora_dias===null && fila.lote_minimo===null && fila.pact_cantidad===null;
    if(!vacia) ops.push(SubatirApp.saveArtProveedor(fila));
  });
  return Promise.all(ops).then(function(res){
    return (res.filter(function(r){ return r && r.error; })[0]||{}).error || null;
  });
}
```

En `toggleEdit` (`stock.html:1843`), dentro del `if(CUR){...}`, agregar:

```js
      document.getElementById('ed-seg').checked = !!CUR.seguimiento;
      document.getElementById('ed-rev-meses').value = CUR.revisarCadaMeses || '';
      document.getElementById('ed-rev-fecha').value = CUR.proximaRevision || '';
      toggleSeg();
      if(CUR.__row) renderFichasProv(CUR.__row);
```

En `saveEdit`, antes del `Promise.all(ops)`, agregar los tres campos del artículo a `fields` y encadenar el guardado de las fichas.

**Solo si cambiaron.** `saveEdit` tiene un early-return (`if(!hasFields && !catChanged)`) que evita escribir cuando no se tocó nada; poblarlos siempre lo anula y cada apertura-y-cierre del modal escribiría en la base:

```js
  var seg = document.getElementById('ed-seg').checked;
  if(seg !== !!CUR.seguimiento) fields['SEGUIMIENTO'] = seg;
  var rm = document.getElementById('ed-rev-meses').value;
  var rmVal = rm!=='' ? parseInt(rm,10) : null;
  if(rmVal !== (CUR.revisarCadaMeses||null)) fields['REVISAR CADA MESES'] = rmVal;
  var rf = document.getElementById('ed-rev-fecha').value || null;
  if(rf !== (CUR.proximaRevision||null)) fields['PROXIMA REVISION'] = rf;
```

y en el `.then` de éxito, antes de `load()`, llamar a `saveReposicion(CUR.__row)` y mostrar el error si vuelve alguno.

- [ ] **Step 4: Probar en el navegador**

Sobre la página local con query anti-caché, como admin:
1. Abrir el ✏ de "Etiq. Medianas largo" (id 85), tildar seguimiento, cargar demora 30 en MIL ROLLOS, guardar.
2. Recargar y verificar que el tilde y la demora **quedaron**.
3. Verificar en la base: `SB.from('art_proveedor').select('*').eq('inventario_id',85)` devuelve la fila, y `SB.from('inventario').select('seguimiento').eq('id',85)` devuelve `true`.
4. Verificar que **no se rompió nada de lo de antes**: cambiar el stock desde el mismo modal y ver que sigue guardando.

- [ ] **Step 5: Commit**

```bash
git add stock.html
git commit -m "Stock: configurar la reposicion desde el boton de ajustar"
```

---

### Task 5: La señal en la tabla de Stock

**Files:**
- Modify: `stock.html:699-711` (encabezados de la tabla)
- Modify: `stock.html:1362-1393` (`recalcItem`, para llamar a la cuenta)
- Modify: `stock.html:1402-1450` (`buildMerged`, para leer los campos nuevos)
- Modify: `stock.html:1640-1665` (armado de la fila)
- Modify: `stock.html:624-655` (tira de KPIs)
- Modify: `stock.html:672-694` (filtros) y `stock.html:1544-1560` (`applyFilters`)

**Interfaces:**
- Consumes: `Reposicion.calcular` (Tarea 1), las columnas nuevas de `RAW_INV` (Tarea 3).
- Produces: cada item de `MERGED` gana `seguimiento`, `revisarCadaMeses`, `proximaRevision`, `ultimaOC`, `rep` (el objeto que devuelve `Reposicion.calcular`).

- [ ] **Step 1: Leer los campos nuevos en `buildMerged`**

Dentro del `RAW_INV.forEach`, junto a `stock`/`minimo`/`consumo`, agregar al objeto que se pasa a `recalcItem`:

```js
      seguimiento:     item['SEGUIMIENTO'] === true || item['SEGUIMIENTO'] === 'true',
      revisarCadaMeses: pn(item['REVISAR CADA MESES']),
      proximaRevision: item['PROXIMA REVISION'] || '',
      // Última OC del artículo: por inventario_id cuando está (solo 160
      // de 680 filas lo tienen) y si no, por el match difuso de descripción
      // que ya se usa para el "en tránsito". No se arma un matcher nuevo.
      ultimaOC:        ocData.lastFecha || '',
      ultimaOCOrden:   ocData.lastOrden || '',
```

`findOCMatch` hoy devuelve `lastProv` y `lastPrecio`, o sea **ya identifica la OC más reciente**. Agregar en ese mismo lugar `lastFecha` (la fecha de esa OC) y `lastOrden` (su `N° Orden`), que la Tarea 8 necesita para el cartel de auditoría. Un solo cambio, dos consumidores.

- [ ] **Step 2: Llamar a la cuenta desde `recalcItem`**

En `buildMerged`, guardar en el item la fila cruda y su ficha, y al final de `recalcItem`, antes del `return m`:

```js
  // La reposición NO toca m.estado: es una señal aparte que convive con
  // el semáforo de siempre. El armado del objeto vive en desdeFila, que
  // es el mismo que usan la pantalla de configuración y el dashboard.
  m.rep = window.Reposicion
    ? Reposicion.calcular(Reposicion.desdeFila(m._inv, m._ficha, m.ultimaOC ? new Date(m.ultimaOC) : null), new Date())
    : { senal: null };
```

Para eso, en `buildMerged` sumar al objeto que se pasa a `recalcItem`:

```js
      _inv:   item,                 // la fila cruda, con los nombres de header
      _ficha: fichaDe(item.__row, proveedor),
```

Las fichas se cargan una sola vez por `load()` con `SubatirApp.getArtProveedor()` y se indexan antes de `buildMerged`. **El índice usa `Reposicion.canonProv`, no el `canonProv` de `stock.html`**, para que las tres pantallas emparejen igual:

```js
var FICHAS_IDX = {};
function indexarFichas(fichas){
  FICHAS_IDX = {};
  (fichas||[]).forEach(function(f){
    FICHAS_IDX[f.inventario_id + '|' + Reposicion.canonProv(f.proveedor)] = f;
  });
}
// La que manda es la del proveedor de la ficha de stock (decisión del usuario).
function fichaDe(invId, proveedor){
  return FICHAS_IDX[invId + '|' + Reposicion.canonProv(proveedor)] || null;
}
```

- [ ] **Step 3: Columna, KPI y filtro**

Encabezado nuevo después de "Cobertura" (`stock.html:707`): `<th onclick="sortBy('pedir')">Pedir antes de</th>`. **Actualizar el `colspan="11"` de `stock.html:714` a 12.**

Celda, en el armado de la fila (junto a la de cobertura, `stock.html:1648`):

```js
    html += '<td>'+repCell(x)+'</td>';
```

y la función, junto a las otras de presentación:

```js
// Cómo se ve la señal de reposición en la tabla. Sin seguimiento no se
// muestra nada: el artículo no participa y un "OK" mentiría.
var REP_LOOK = {
  ATRASADO:  ['var(--red)',  '🔴 atrasado'],
  PEDIR:     ['var(--amb)',  '🟠 pedir'],
  REVISAR:   ['var(--pur)',  '🔔 revisar'],
  OK:        ['var(--grn)',  '✓'],
  SIN_DATOS: ['var(--mut2)', '⚙ falta dato']
};
var REP_MOTIVO = {
  'falta-consumo': 'sin consumo cargado',
  'falta-demora':  'sin demora cargada',
  'sin-oc':        'sin OC previa'
};
// stock.html tiene fmtN/esc/setText (2858-2860) pero ninguna de fecha.
function fmtFecha(d){
  if(!(d instanceof Date) || isNaN(d)) return '';
  var p=function(n){ return (n<10?'0':'')+n; };
  return p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear();
}
function repCell(x){
  var rep = x.rep || {}, s = rep.senal;
  if(!s) return '<span class="muted">—</span>';
  var look = REP_LOOK[s] || ['var(--mut2)', s];
  var det = '';
  if(s === 'SIN_DATOS')      det = REP_MOTIVO[rep.motivo] || '';
  else if(rep.fechaLimite)   det = fmtFecha(rep.fechaLimite) + ' · ' +
                                   (rep.diasParaPedir < 0
                                     ? Math.abs(rep.diasParaPedir)+'d tarde'
                                     : rep.diasParaPedir+'d');
  return '<span style="color:'+look[0]+';font-weight:700;white-space:nowrap">'+look[1]+'</span>'
       + (det ? '<br><span class="muted" style="font-size:10px">'+esc(det)+'</span>' : '');
}
```

KPI nuevo en la tira (`stock.html:649`, antes del de tránsito):

```html
    <div class="glass kpi" style="--accent:var(--or)">
      <div class="kpi-icon">🔔</div>
      <div class="kpi-label">Hay que pedir</div>
      <div class="kpi-num c-amber" id="k-pedir">—</div>
      <div class="kpi-sub" id="k-pedir-sub">con demora contemplada</div>
    </div>
```

y donde se pintan los otros KPIs:

```js
  var pedir = MERGED.filter(function(m){
    var s=(m.rep||{}).senal; return s==='ATRASADO'||s==='PEDIR';
  });
  setText('k-pedir', pedir.length);
  var atr = pedir.filter(function(m){ return m.rep.senal==='ATRASADO'; }).length;
  setText('k-pedir-sub', atr ? atr+' ya atrasado'+(atr>1?'s':'') : 'con demora contemplada');
```

**El encabezado ordena por `pedir`, así que el comparador tiene que conocer esa clave** o el `<th>` queda siendo un botón que no hace nada. En la cadena de `if` de `sortCmp` (`stock.html:1585`), junto a las otras:

```js
  // null (sin seguimiento / sin datos) al fondo, como cobertura
  else if(SORT_K==='pedir'){
    va = (a.rep && a.rep.diasParaPedir!=null) ? a.rep.diasParaPedir : 99999;
    vb = (b.rep && b.rep.diasParaPedir!=null) ? b.rep.diasParaPedir : 99999;
  }
```

Opción nueva en el select `#f-est`: `<option value="REPONER">🔔 Hay que pedir</option>`, y en `applyFilters` tratarla aparte:

```js
    if(est === 'REPONER'){
      var s = (x.rep||{}).senal;
      if(s!=='ATRASADO' && s!=='PEDIR' && s!=='REVISAR') return false;
    } else if(est && x.estado!==est) return false;
```

- [ ] **Step 4: Medir los anchos antes de dar por buena la columna**

La tabla pasa de 11 a 12 columnas. **Medir, no estimar** — calcular los anchos a ojo ya cortó datos dos veces:

```js
// sobre la tabla ya renderizada, recorrer las primeras ~60 filas
var need = [];
document.querySelectorAll('#tbody tr').forEach((tr,i) => { if(i>60) return;
  tr.querySelectorAll('td').forEach((td,c) => { need[c] = Math.max(need[c]||0, td.scrollWidth); });
});
console.log(need.map((n,c) => c+': necesita '+n+' tiene '+document.querySelectorAll('#tbody tr td')[c].clientWidth));
```

Y probar 1366 / 1200 / 844 px con un **iframe del mismo origen** sobre la página ya autenticada, pidiéndola con un query único (`stock.html?p=<random>`) para que no sirva la copia cacheada. Ninguna celda con importe o fecha puede quedar cortada.

- [ ] **Step 5: Commit**

```bash
git add stock.html
git commit -m "Stock: columna, KPI y filtro de que hay que pedir"
```

---

### Task 6: `reposicion.html` — la pantalla de carga

**Files:**
- Create: `reposicion.html`
- Modify: `bump-version.ps1:63-66` (array `$modulos`)
- Modify: `bump-version.ps1:49` (patrón `$SUB_BUST`)
- Modify: `nav.js` (link en el nav)

**Interfaces:**
- Consumes: todo lo de las Tareas 1, 3 y 4.
- Produces: la pantalla. Nada consume de ella.

- [ ] **Step 1: Crear la página**

Copiar de `stock.html` el `<head>` completo (fuentes Syne/DM Sans/IBM Plex Mono, `supabase-config.js?v=1`, `subatir-app.js?v=1`, `nav.js?v=1`, `nav.css?v=1`, `reposicion-calc.js?v=1`, `window.APP_VER`, el bloque `:root` de variables CSS, `body::before` con los gradientes, `.glass`, `.hdr`, `.fi`, `.btn`) y el header con logo y nav. **Copiar, no importar**: cada módulo del proyecto es autocontenido salvo los cuatro compartidos.

Cuerpo:

```html
<div class="filters">
  <div class="search-wrap">
    <input class="fi fi-search" id="f-q" placeholder="Buscar artículo, código…" oninput="render()"/>
  </div>
  <select class="fi" id="f-fam" onchange="render()">
    <option value="">Todas las familias</option>
    <option value="MP">Materia prima</option>
    <option value="ENV">Envases</option>
    <option value="CON">Consumibles</option>
  </select>
  <select class="fi" id="f-est" onchange="render()">
    <option value="">Todos</option>
    <option value="SEG">Solo con seguimiento</option>
    <option value="FALTA">Falta configurar</option>
  </select>
</div>
<div class="tbl-wrap">
  <table>
    <thead><tr>
      <th>Artículo</th><th>Familia</th><th>Seguir</th><th>Proveedor</th>
      <th class="num">Demora (d)</th><th class="num">Lote mín.</th><th class="num">Múltiplo</th>
      <th>Pactada</th><th>Señal</th><th></th>
    </tr></thead>
    <tbody id="tbody"><tr><td colspan="10" class="empty-td">Cargando…</td></tr></tbody>
  </table>
</div>
```

Carga y armado:

```js
var ARTS = [], FICHAS = [];

function load(){
  Promise.all([
    SubatirApp.getData(),
    SubatirApp.getArtProveedor()
  ]).then(function(res){
    ARTS   = res[0].inventario || [];
    FICHAS = res[1] || [];
    render();
  });
}

// Una fila por artículo × proveedor con ficha, más una fila por artículo
// con seguimiento que todavía no tiene ninguna: son las que hay que cargar.
function filas(){
  var porArt = {};
  FICHAS.forEach(function(f){ (porArt[f.inventario_id] = porArt[f.inventario_id] || []).push(f); });
  var out = [];
  ARTS.forEach(function(a){
    var fs = porArt[a.__row] || [];
    if(fs.length) fs.forEach(function(f){ out.push({ art: a, ficha: f }); });
    else out.push({ art: a, ficha: { inventario_id: a.__row, proveedor: a['PROVEEDOR'] || '' } });
  });
  return out;
}
```

La columna **Señal** se calcula con el mismo camino que Stock y el Dashboard — no con uno propio, o la misma etiqueta muestra dos estados distintos según la pantalla:

```js
function senalDe(par){
  var rep = Reposicion.calcular(Reposicion.desdeFila(par.art, par.ficha, null), new Date());
  return rep.senal;   // ultimaOC va null: esta pantalla no arma el índice de OC
}
```

`toast()` no existe en una página nueva: copiar la de `stock.html` junto con su CSS, como hace cada módulo del proyecto.

`render()` filtra por los tres controles, arma una fila por elemento de `filas()` con inputs editables (mismos nombres de clase que en la Tarea 4: `.ap-demora`, `.ap-usar-demora`, `.ap-lote`, `.ap-mult`, `.ap-usar-lote`, `.ap-pact-cant`, `.ap-pact-ent`, `.ap-pact-vence`, `.ap-usar-pact`), un checkbox de seguimiento por artículo y un botón 💾 por fila que llama a:

```js
function guardarFila(tr){
  var v = function(sel){ var e=tr.querySelector(sel); return e && e.value!=='' ? parseFloat(e.value) : null; };
  var c = function(sel){ var e=tr.querySelector(sel); return !!(e && e.checked); };
  SubatirApp.saveArtProveedor({
    inventario_id: +tr.getAttribute('data-inv'),
    proveedor: tr.getAttribute('data-prov'),
    demora_dias: v('.ap-demora'), usar_demora: c('.ap-usar-demora'),
    lote_minimo: v('.ap-lote'), multiplo: v('.ap-mult'), usar_lote: c('.ap-usar-lote'),
    pact_cantidad: v('.ap-pact-cant'), pact_entregado: v('.ap-pact-ent') || 0,
    pact_vence: (tr.querySelector('.ap-pact-vence')||{}).value || null,
    usar_pactada: c('.ap-usar-pact')
  }).then(function(r){
    if(r.error){ toast('Error: '+r.error, 'err'); return; }
    toast('Guardado ✓','ok'); load();
  });
}
```

El tilde de seguimiento escribe en `inventario` con `SubatirApp.write({action:'updateRow', sheetKey:'inventario', row:invId, fields:JSON.stringify({'SEGUIMIENTO':true})})`.

Cerrar con `SubatirApp.live(['inventario','art_proveedor'], load)`.

- [ ] **Step 2: Sumarla al versionado**

En `bump-version.ps1:63`, agregar `'reposicion.html'` al array `$modulos`. Y en el patrón `$SUB_BUST` de la línea 49, agregar `reposicion-calc` a la alternancia:

```powershell
  pat = '((?:supabase-config|subatir-app|deposito-app|traslados|nav|reposicion-calc)\.(?:js|css)\?v=)[^"'']*'
```

**Si se olvida cualquiera de las dos, la página se publica con el JS viejo** y nadie se entera.

- [ ] **Step 3: Link en el nav**

Agregar el link a `reposicion.html` donde `nav.js` arma los accesos. Queda oculto solo si el usuario no tiene el módulo `stock`, porque `PAGE_MODULE` ya lo mapea ahí (Tarea 3).

- [ ] **Step 4: Probar**

1. Correr `powershell -NoProfile -ExecutionPolicy Bypass -File bump-version.ps1` y verificar que **no aborta** y que reporta a `reposicion.html` entre los archivos tocados. Después `git checkout .` para no dejar el bump a medias — la publicación es la Tarea 9.
2. Abrir la página local, cargar una demora en un artículo, recargar y ver que quedó.
3. Verificar que un usuario sin el módulo `stock` no ve el link ni entra a la página.

- [ ] **Step 5: Commit**

```bash
git add reposicion.html bump-version.ps1 nav.js
git commit -m "Stock: pantalla para cargar la configuracion de reposicion"
```

---

### Task 7: El panel del Dashboard

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Reposicion.calcular` (Tarea 1), `SubatirApp.getArtProveedor` (Tarea 3).
- Produces: nada.

- [ ] **Step 1: Cargar el script compartido**

En el `<head>` de `index.html`, agregar `<script src="reposicion-calc.js?v=1"></script>`.

- [ ] **Step 2: Agregar el panel**

Panel "🔔 Reposición" con los artículos en `ATRASADO`, `PEDIR` y `REVISAR`, ordenados por `diasParaPedir` ascendente (los atrasados primero), enlazando a `stock.html`:

```html
<div class="glass" style="padding:18px">
  <div class="sec-hdr"><h2>🔔 <em>Reposición</em></h2>
    <span class="badge b-warn" id="rep-cnt">—</span></div>
  <div id="rep-list"></div>
</div>
```

```js
function renderReposicion(inventario, fichas){
  // Índice de fichas por artículo + proveedor normalizado: la que manda es
  // la del proveedor de la ficha de stock.
  var idx = {};
  (fichas||[]).forEach(function(f){
    idx[f.inventario_id+'|'+Reposicion.canonProv(f.proveedor)] = f;
  });

  var hoy = new Date(), avisos = [];
  (inventario||[]).forEach(function(a){
    // La ficha que manda es la del proveedor de la ficha de stock.
    // ultimaOC va null: el dashboard no arma el índice de OC que tiene
    // Stock, así que acá la regla "cada N meses" no dispara y sí lo hacen
    // proxima_revision y la pactada. El aviso completo está en Stock.
    var f = idx[a.__row+'|'+Reposicion.canonProv(a['PROVEEDOR']||'')] || null;
    var rep = Reposicion.calcular(Reposicion.desdeFila(a, f, null), hoy);
    if(['ATRASADO','PEDIR','REVISAR'].indexOf(rep.senal)>=0) avisos.push({ a:a, rep:rep });
  });

  avisos.sort(function(x,y){
    return (x.rep.diasParaPedir==null?9999:x.rep.diasParaPedir)
         - (y.rep.diasParaPedir==null?9999:y.rep.diasParaPedir);
  });

  document.getElementById('rep-cnt').textContent = avisos.length;
  document.getElementById('rep-list').innerHTML = avisos.length
    ? avisos.map(function(x){
        return '<a href="stock.html" class="rep-row">'
             + '<strong>'+esc(x.a['DESCRIPCIÓN'])+'</strong>'
             + '<span>'+x.rep.senal+'</span>'
             + '<span>'+(x.rep.sugerido>0 ? 'pedir '+x.rep.sugerido : '')+'</span></a>';
      }).join('')
    : '<div class="muted" style="padding:14px 0">Nada para pedir. ✓</div>';
}
```

La diferencia de `ultimaOC` entre pantallas **queda comentada en el código**, como arriba: no es algo para redescubrir dentro de seis meses.

`esc` está definida en `stock.html`, no necesariamente en `index.html`. Verificar si existe y definirla ahí mismo si falta. `canonProv` sale de `Reposicion`, no se redefine.

El dashboard es un módulo abierto a cualquier autenticado (`OPEN_MODULES`), así que el panel tiene que tolerar que `art_proveedor` venga vacío por permisos sin romper la pantalla.

- [ ] **Step 3: Probar**

Abrir el dashboard con el artículo 84 configurado (que da `ATRASADO`) y verificar que aparece primero. Después con ninguno configurado y verificar el estado vacío.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Dashboard: panel de avisos de reposicion"
```

---

### Task 8: La corrección automática del proveedor, auditada

**Files:**
- Modify: `stock.html` (detección y aviso)
- Modify: `reposicion.html` (el mismo aviso en la grilla)

**Interfaces:**
- Consumes: `ocData.lastProv` (que `findOCMatch` ya calcula), `SubatirApp.write` con `sheetKey: 'inventario'`.
- Produces: nada.

- [ ] **Step 1: Detectar y corregir**

Para artículos con `seguimiento === true` cuyo `canonProv(inventario.proveedor)` no coincide con `canonProv(ocData.lastProv)`, escribir en `inventario`:

```js
fields['PROVEEDOR'] = ocData.lastProv;
fields['PROV AUTO AT'] = new Date().toISOString();
fields['PROV AUTO OC'] = ocData.lastOrden;
```

Solo una vez por cambio: si `PROV AUTO OC` ya es esa misma OC, no se reescribe (si no, cada `load()` dispararía un UPDATE).

- [ ] **Step 2: Mostrarlo**

En la ficha y en la grilla, cuando `prov_auto_at` tiene valor, un cartel: *"Proveedor actualizado el DD/MM según OC #NNN"* con un botón **"Volver a MIL ROLLOS"** que restaura el anterior y limpia `PROV AUTO AT` / `PROV AUTO OC`.

Sin ese cartel el dato cambia solo y sin explicación, que es el riesgo anotado en la sección 6.2 del spec.

- [ ] **Step 3: Probar con el caso real**

Las etiquetas tienen `inventario.proveedor = 'MIL ROLLOS'` y su última OC (la 927) fue a **Lipiner S.A.** Marcar seguimiento en la id 85 y verificar:
1. que el proveedor pasa a Lipiner S.A. y aparece el cartel con la OC 927;
2. que recargar **no** dispara un segundo UPDATE (mirar la pestaña Network o contar con un contador en consola);
3. que el botón de volver atrás restaura MIL ROLLOS y saca el cartel.

- [ ] **Step 4: Commit**

```bash
git add stock.html reposicion.html
git commit -m "Stock: corregir solo el proveedor del articulo, con aviso y vuelta atras"
```

---

### Task 9: Publicar y verificar de punta a punta

**Files:**
- Modify: `version.json`, `sw.js` y los `window.APP_VER` (los escribe `bump-version.ps1`, no a mano)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la versión publicada.

- [ ] **Step 1: Correr los tests**

Run: `node --test` (desde la raíz, SIN pasarle `test/`: Node 24 en Windows no resuelve el directorio como argumento)
Expected: PASS, 26 tests. Si falla alguno, **no se publica**.

- [ ] **Step 2: Chequear el JS de cada módulo tocado**

Cada HTML tiene varios `<script>`. Juntar **todos** los inline (no solo el último, que es el registro del service worker y pasa `node --check` sin haber mirado nada):

```js
var re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g, m, js='';
while((m=re.exec(t))) js += '\n;\n' + m[1];
```

Si el archivo extraído queda chico, está mal extraído. Correr `node --check` sobre el resultado de `stock.html`, `reposicion.html` e `index.html`.

- [ ] **Step 3: Bump y push**

`publicar.bat` es interactivo y no se puede correr desde acá. Los pasos sueltos:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File bump-version.ps1
git add -A
git commit -m "Stock: configuracion de reposicion por articulo y proveedor"
git push origin main
```

- [ ] **Step 4: Esperar el deploy de verdad**

Pedir `version.json` en loop hasta que devuelva la versión nueva. Tarda de 30 s a 1 min. **Nunca dar por publicado sin ver el número.** Si el build queda colgado en `queued`, no perder tiempo con la API de GitHub: empujar un commit nuevo lo destraba.

- [ ] **Step 5: Verificar en producción con las 7 etiquetas**

Sobre la app publicada, con la sesión real, configurar las etiquetas (ids 82-88) con su demora real y verificar:
1. La **id 84** (stock 25.350, mínimo 35.000, consumo 70.000) sale **ATRASADO**.
2. La **id 85** (stock 95.000, mínimo 20.000, consumo 40.000) sale **OK**.
3. El KPI "Hay que pedir" cuenta lo mismo que muestra el filtro.
4. El panel del Dashboard lista los mismos artículos.
5. Nada del semáforo viejo cambió: los conteos de Crítico / Medio / Óptimo son los mismos que antes de publicar.

Reportar el antes/después con números, no con "funciona".

- [ ] **Step 6: Commit final si hubo ajustes**

```bash
git add -A && git commit -m "Stock: ajustes de la verificacion en produccion"
```

---

## Notas para quien ejecute

- **No inventar un framework de tests.** El proyecto no tiene ninguno y no hace falta: la única lógica que se deja testear de verdad es `reposicion-calc.js`, y va con `node --test`, sin dependencias. Todo lo demás se verifica en el navegador contra la base real.
- **No verificar contra `migracion/seed.sql`**, que quedó viejo. La verdad está en la base.
- **La anon key sola no sirve para leer**: RLS devuelve 0 filas. Hay que ejecutar `SB.from(...)` sobre una página de la app publicada, donde `window.SB` ya tiene la sesión.
- **Antes de borrar cualquier código que parezca muerto**, contar los usos de cada símbolo y resolver cada `onclick` del HTML contra las funciones definidas. Sacar una función huérfana de un módulo de estos ya arrastró siete encadenadas.
