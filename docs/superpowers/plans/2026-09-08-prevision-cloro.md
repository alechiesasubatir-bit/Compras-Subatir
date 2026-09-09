# Previsión Cloro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un módulo nuevo que prevé, semana a semana, cuánto hay que envasar de cada producto de la línea de piscinas y cuántos kg de materia prima comprar, a partir de las ventas históricas de las temporadas anteriores.

**Architecture:** El cálculo vive en `cloro-calc.js`, un módulo UMD puro y sin fechas implícitas —igual que `reposicion-calc.js`— para poder probarlo con `node --test` sin navegador. La pantalla `cloro.html` lo consume y sólo se ocupa de dibujar y de hablar con Supabase. Los datos van en tablas `cl_*` con la misma RLS que el resto de Compras.

**Tech Stack:** HTML/CSS/JS sin framework (ES5 en el navegador), Supabase JS v2, SheetJS desde CDN sólo para leer los `.xls`, `node --test` para los tests del cálculo.

**Spec:** `docs/superpowers/specs/2026-09-08-prevision-cloro-design.md`

## Global Constraints

- **JS de navegador en ES5**: `var`, `function`, nada de arrow functions ni `let/const` en `cloro.html` y `cloro-calc.js`. Es el estilo de todo el proyecto. Los tests en `test/` sí usan sintaxis moderna (corren en node).
- **Nunca `new Date()` dentro de `cloro-calc.js`**: la fecha entra siempre por parámetro. Es lo que permite probarlo.
- **Tokens CSS: leer el `:root` de `mp-importacion.html` y copiarlo.** No todos los módulos del proyecto usan los mismos nombres de token (`--bdr` vs `--border`, `--amb` vs `--amber`); un token inexistente no falla, deja el texto invisible sobre el fondo oscuro.
- **Toda escritura va directo a Supabase.** No hay guardado local ni botón de "sincronizar".
- **Todo `update`/`insert` lleva `.select()` y chequea que vuelva la fila.** Un update bloqueado por RLS devuelve **cero filas y ningún error**; sin el chequeo, la pantalla dice "guardado" y no guardó nada.
- **Los cambios de datos van en un archivo `.sql` dentro de `migracion/`** que corre el usuario. Nunca se ejecuta SQL desde acá.
- **Clave de permiso del módulo: `cloro`.** Serie de nombres de tabla: prefijo `cl_`.
- **Semana 1 = el lunes de la semana que contiene `fecha_ini` de la temporada.** Nunca semanas ISO.
- **Todas las fechas se manipulan en UTC** (`getUTCDay`, `Date.UTC`, …) para que el resultado no cambie con el huso horario.
- Formato de números en pantalla: `toLocaleString('es-UY')`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `cloro-calc.js` (nuevo) | Todo el cálculo, puro y testeable: semanas de temporada, suavizado, crecimiento, previsión, stock proyectado, sugerido, kg de MP. |
| `test/cloro-calc.test.js` (nuevo) | Tests de `cloro-calc.js` con `node --test`. |
| `migracion/cloro_schema.sql` (nuevo) | Tablas `cl_*`, índices, RLS. |
| `migracion/cloro_seed.sql` (generado) | 13 productos, 2 temporadas y sus ventas semanales. |
| `cloro.html` (nuevo) | La pantalla: contexto, KPIs, tablas, modales, gráficos. |
| `nav.js` (modificar) | Entrada del menú. |
| `nav.css` (modificar) | Color del módulo en el menú. |
| `subatir-app.js` (modificar) | `PAGE_MODULE['cloro.html'] = 'cloro'`. |
| `usuarios.html` (modificar) | Alta del permiso en la pantalla de usuarios. |
| `sw.js` (modificar) | `cloro.html` en el SHELL del service worker. |
| `bump-version.ps1` (modificar) | `cloro.html` en `$modulos` y `cloro-calc` en el patrón de `?v=`. |

---

### Task 1: El calendario de la temporada

**Files:**
- Create: `cloro-calc.js`
- Test: `test/cloro-calc.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `Cloro.lunesInicio(fechaIni: Date) -> Date` — el lunes de la semana que contiene `fechaIni`, en UTC.
  - `Cloro.semanaDe(fecha: Date, fechaIni: Date) -> number` — semana de temporada, base 1. Puede dar 0 o negativo si `fecha` es anterior.
  - `Cloro.semanasDeTemporada(fechaIni: Date, fechaFin: Date) -> number` — cuántas semanas tiene la temporada.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/cloro-calc.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { Cloro } = require('../cloro-calc.js');

const d = (s) => new Date(s + 'T00:00:00Z');

test('lunesInicio devuelve el lunes de la semana que contiene el 1/8', () => {
  // 1/8/2025 cae viernes -> el lunes de esa semana es el 28/7
  assert.strictEqual(Cloro.lunesInicio(d('2025-08-01')).toISOString().slice(0, 10), '2025-07-28');
  // 1/8/2024 cae jueves -> 29/7
  assert.strictEqual(Cloro.lunesInicio(d('2024-08-01')).toISOString().slice(0, 10), '2024-07-29');
  // 1/8/2027 cae domingo: el lunes de SU semana es el 26/7, no el 2/8
  assert.strictEqual(Cloro.lunesInicio(d('2027-08-01')).toISOString().slice(0, 10), '2027-07-26');
});

test('un lunes es su propio lunes de inicio', () => {
  assert.strictEqual(Cloro.lunesInicio(d('2026-08-03')).toISOString().slice(0, 10), '2026-08-03');
});

test('la semana 1 es la del arranque', () => {
  assert.strictEqual(Cloro.semanaDe(d('2025-08-01'), d('2025-08-01')), 1);
  assert.strictEqual(Cloro.semanaDe(d('2025-07-28'), d('2025-08-01')), 1);
  assert.strictEqual(Cloro.semanaDe(d('2025-08-03'), d('2025-08-01')), 1);
  assert.strictEqual(Cloro.semanaDe(d('2025-08-04'), d('2025-08-01')), 2);
});

test('el pico de 2025-26 cae en la semana 23', () => {
  // verificado contra los .xls: la semana del 29/12/2025 al 4/1/2026
  assert.strictEqual(Cloro.semanaDe(d('2025-12-29'), d('2025-08-01')), 23);
  assert.strictEqual(Cloro.semanaDe(d('2026-01-04'), d('2025-08-01')), 23);
});

test('una fecha anterior al arranque da semana menor a 1', () => {
  assert.ok(Cloro.semanaDe(d('2025-07-20'), d('2025-08-01')) < 1);
});

test('semanasDeTemporada cubre hasta el ultimo dia', () => {
  // 28/7/2025 .. 31/3/2026 son 36 semanas empezadas
  assert.strictEqual(Cloro.semanasDeTemporada(d('2025-08-01'), d('2026-03-31')), 36);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/cloro-calc.test.js`
Expected: FAIL — `Cannot find module '../cloro-calc.js'`

- [ ] **Step 3: Implementación mínima**

Crear `cloro-calc.js`:

```js
// ─── La cuenta de Previsión Cloro ────────────────────────────────────
// Vive aparte de cloro.html por lo mismo que reposicion-calc.js: una
// formula dentro de una pantalla es una formula que no se puede probar.
//
// `hoy` y las fechas entran siempre por parametro y nunca se llama a
// new Date() aca: es lo que permite probarla con node --test.
//
// Todo se hace en UTC. Con horas locales, un usuario en otro huso veria
// la venta del lunes a la manana caer en la semana anterior.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = { Cloro: api };
  root.Cloro = api;
})(typeof self !== 'undefined' ? self : this, function () {

  var DIA = 86400000;
  var SEMANA = 7 * DIA;

  // El lunes de la semana que contiene `fecha`. getUTCDay(): 0=domingo,
  // 1=lunes... por eso el domingo retrocede 6 dias y no 0.
  function lunesInicio(fecha) {
    var dow = fecha.getUTCDay();
    var atras = (dow + 6) % 7;
    return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(),
                             fecha.getUTCDate() - atras));
  }

  function semanaDe(fecha, fechaIni) {
    var base = lunesInicio(fechaIni);
    var dia0 = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
    return Math.floor((dia0 - base.getTime()) / SEMANA) + 1;
  }

  function semanasDeTemporada(fechaIni, fechaFin) {
    return semanaDe(fechaFin, fechaIni);
  }

  return {
    lunesInicio: lunesInicio,
    semanaDe: semanaDe,
    semanasDeTemporada: semanasDeTemporada
  };
});
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/cloro-calc.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add cloro-calc.js test/cloro-calc.test.js
git commit -m "Cloro: el calendario de la temporada, en semanas propias y no ISO"
```

---

### Task 2: Suavizado y crecimiento

**Files:**
- Modify: `cloro-calc.js`
- Test: `test/cloro-calc.test.js`

**Interfaces:**
- Consumes: nada de Task 1.
- Produces:
  - `Cloro.suavizar(serie: number[], ventana: number) -> number[]` — media móvil centrada. `ventana` impar; en los bordes promedia lo que hay (ventana truncada), no rellena con ceros.
  - `Cloro.crecimiento(opts) -> {pct: number, modo: string}` con
    `opts = {actual: number[], anterior: number[], previa: number[]|null, semanasCerradas: number, minSemanas?: number}`.
    `modo` es `'auto'`, `'temporada-completa'` o `'sin-datos'`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `test/cloro-calc.test.js`:

```js
test('suavizar con ventana 1 no toca nada', () => {
  assert.deepStrictEqual(Cloro.suavizar([1, 2, 3], 1), [1, 2, 3]);
});

test('suavizar promedia centrado y trunca en los bordes', () => {
  // [10,20,30,40,50] con ventana 3:
  //   borde: (10+20)/2=15 ; centro: (10+20+30)/3=20 ; ... ; borde: (40+50)/2=45
  assert.deepStrictEqual(Cloro.suavizar([10, 20, 30, 40, 50], 3), [15, 20, 30, 40, 45]);
});

test('suavizar aplasta el pico aislado, que es para lo que existe', () => {
  // el camion mayorista de una sola semana no debe predecir otro camion
  const r = Cloro.suavizar([0, 0, 100, 0, 0], 5);
  assert.strictEqual(r[2], 20);
});

test('suavizar no cambia el total cuando la ventana entra entera', () => {
  const r = Cloro.suavizar([10, 10, 10, 10, 10], 3);
  assert.deepStrictEqual(r, [10, 10, 10, 10, 10]);
});

test('crecimiento automatico compara el mismo tramo de las dos temporadas', () => {
  const r = Cloro.crecimiento({
    actual:   [100, 100, 100, 100],
    anterior: [80, 80, 80, 80, 80, 80],
    previa:   null,
    semanasCerradas: 4
  });
  assert.strictEqual(r.modo, 'auto');
  assert.ok(Math.abs(r.pct - 0.25) < 1e-9);
});

test('con menos de 4 semanas cerradas usa la temporada completa anterior', () => {
  const r = Cloro.crecimiento({
    actual:   [100, 100],
    anterior: [50, 50, 50, 50],     // total 200
    previa:   [40, 40, 40, 40],     // total 160  -> 200/160-1 = 0.25
    semanasCerradas: 2
  });
  assert.strictEqual(r.modo, 'temporada-completa');
  assert.ok(Math.abs(r.pct - 0.25) < 1e-9);
});

test('sin nada con que comparar el crecimiento es cero y lo dice', () => {
  const r = Cloro.crecimiento({ actual: [10], anterior: [], previa: null, semanasCerradas: 1 });
  assert.strictEqual(r.modo, 'sin-datos');
  assert.strictEqual(r.pct, 0);
});

test('un producto que el anio pasado no existia no divide por cero', () => {
  const r = Cloro.crecimiento({
    actual:   [100, 100, 100, 100],
    anterior: [0, 0, 0, 0],
    previa:   null,
    semanasCerradas: 4
  });
  assert.strictEqual(r.modo, 'sin-datos');
  assert.strictEqual(r.pct, 0);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/cloro-calc.test.js`
Expected: FAIL — `Cloro.suavizar is not a function`

- [ ] **Step 3: Implementación mínima**

En `cloro-calc.js`, antes del `return`:

```js
  // Media movil centrada. En los bordes promedia lo que hay en vez de
  // rellenar con ceros: rellenar hundiria artificialmente el arranque y
  // el final de la temporada, que es justo donde menos datos hay.
  function suavizar(serie, ventana) {
    var n = Math.max(1, Math.floor(ventana || 1));
    if (n <= 1) return serie.slice();
    var k = Math.floor(n / 2), out = [], i, j, a, b, s, c;
    for (i = 0; i < serie.length; i++) {
      a = Math.max(0, i - k);
      b = Math.min(serie.length - 1, i + k);
      s = 0; c = 0;
      for (j = a; j <= b; j++) { s += (parseFloat(serie[j]) || 0); c++; }
      out.push(c ? s / c : 0);
    }
    return out;
  }

  function suma(a, hasta) {
    var s = 0, n = (hasta == null ? (a || []).length : Math.min(hasta, (a || []).length));
    for (var i = 0; i < n; i++) s += (parseFloat(a[i]) || 0);
    return s;
  }

  // El crecimiento del anio. Se mide comparando el MISMO TRAMO de las dos
  // temporadas: comparar lo que va de esta contra la anterior entera diria
  // que las ventas se derrumbaron todos los agostos.
  function crecimiento(o) {
    var min = o.minSemanas == null ? 4 : o.minSemanas;
    var cerradas = o.semanasCerradas || 0;
    if (cerradas >= min) {
      var den = suma(o.anterior, cerradas);
      if (den > 0) return { pct: suma(o.actual, cerradas) / den - 1, modo: 'auto' };
    }
    // Temporada recien arrancada: todavia no hay tramo que comparar, asi
    // que se hereda el crecimiento que hubo entre las dos anteriores.
    var denPrevia = suma(o.previa);
    if (denPrevia > 0) return { pct: suma(o.anterior) / denPrevia - 1, modo: 'temporada-completa' };
    return { pct: 0, modo: 'sin-datos' };
  }
```

y agregar al objeto que devuelve: `suavizar: suavizar, crecimiento: crecimiento,`

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/cloro-calc.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add cloro-calc.js test/cloro-calc.test.js
git commit -m "Cloro: suavizado centrado y factor de crecimiento del anio"
```

---

### Task 3: Previsión, stock proyectado, sugerido y kg de materia prima

**Files:**
- Modify: `cloro-calc.js`
- Test: `test/cloro-calc.test.js`

**Interfaces:**
- Consumes: `Cloro.suavizar` (Task 2).
- Produces:
  - `Cloro.prever(opts) -> number[]` con `opts = {anterior: number[], ventana: number, crecimientoPct: number, semanas: number}`. Devuelve un array de largo `semanas`.
  - `Cloro.proyectarStock(opts) -> number[]` con `opts = {stockInicial: number, ventas: number[], envasado: number[], prevision: number[], semanasCerradas: number}`. Índice 0 = semana 1.
  - `Cloro.sugerido(opts) -> number` con `opts = {prevision: number[], desdeSemana: number, horizonte: number, semanasSeguridad: number, stockHoy: number, lote: number}`.
  - `Cloro.bajaRotacion(serie: number[], umbral: number) -> boolean`
  - `Cloro.kgMateria(productos, sugeridos) -> {porMateria: object, sinAsignar: number[]}` con
    `productos = [{id, materia_id, kg_mp_por_unidad, merma_pct}]` y `sugeridos = {productoId: unidades}`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `test/cloro-calc.test.js`:

```js
test('prever aplica el crecimiento sobre el historico suavizado', () => {
  const r = Cloro.prever({ anterior: [10, 10, 10, 10], ventana: 1, crecimientoPct: 0.2, semanas: 4 });
  assert.deepStrictEqual(r.map((x) => Math.round(x * 100) / 100), [12, 12, 12, 12]);
});

test('prever devuelve exactamente `semanas` valores y rellena con cero', () => {
  const r = Cloro.prever({ anterior: [10, 10], ventana: 1, crecimientoPct: 0, semanas: 4 });
  assert.strictEqual(r.length, 4);
  assert.strictEqual(r[3], 0);
});

test('prever suaviza antes de crecer, no despues', () => {
  // el pico de 100 en una sola semana se reparte; ninguna semana debe quedar en 120
  const r = Cloro.prever({ anterior: [0, 0, 100, 0, 0], ventana: 5, crecimientoPct: 0.2, semanas: 5 });
  assert.ok(r[2] < 30);
});

test('el stock proyectado usa ventas reales en lo cerrado y previsión en lo que viene', () => {
  const r = Cloro.proyectarStock({
    stockInicial: 100,
    ventas:    [30, 30, 0, 0],   // semanas 3 y 4 todavia no pasaron
    envasado:  [0, 50, 0, 0],
    prevision: [99, 99, 20, 20], // en lo cerrado no se debe mirar
    semanasCerradas: 2
  });
  // s1: 100 + 0 - 30 = 70 ; s2: 70 + 50 - 30 = 90
  // s3: 90 - 20 = 70       ; s4: 70 - 20 = 50
  assert.deepStrictEqual(r, [70, 90, 70, 50]);
});

test('el stock proyectado puede quedar negativo y no se recorta', () => {
  // un stock negativo es la senal de que falta envasar: taparlo en cero
  // esconderia justamente lo que el modulo viene a avisar
  const r = Cloro.proyectarStock({
    stockInicial: 10, ventas: [30], envasado: [0], prevision: [0], semanasCerradas: 1
  });
  assert.strictEqual(r[0], -20);
});

test('sugerido = demanda del horizonte + colchon - stock, redondeado al lote', () => {
  const p = new Array(20).fill(100);
  // demanda 8 sem = 800 ; colchon = 2 * (800/8) = 200 ; bruto = 1000 - 300 = 700
  assert.strictEqual(Cloro.sugerido({
    prevision: p, desdeSemana: 1, horizonte: 8, semanasSeguridad: 2, stockHoy: 300, lote: 1
  }), 700);
  assert.strictEqual(Cloro.sugerido({
    prevision: p, desdeSemana: 1, horizonte: 8, semanasSeguridad: 2, stockHoy: 300, lote: 250
  }), 750);
});

test('sugerido nunca es negativo', () => {
  const p = new Array(20).fill(10);
  assert.strictEqual(Cloro.sugerido({
    prevision: p, desdeSemana: 1, horizonte: 8, semanasSeguridad: 2, stockHoy: 99999, lote: 1
  }), 0);
});

test('sugerido arranca en desdeSemana y no en la semana 1', () => {
  const p = [1000, 1000, 10, 10, 10, 10];
  // desde la semana 3, horizonte 4 -> 10+10+10+10 = 40, sin colchon, sin stock
  assert.strictEqual(Cloro.sugerido({
    prevision: p, desdeSemana: 3, horizonte: 4, semanasSeguridad: 0, stockHoy: 0, lote: 1
  }), 40);
});

test('bajaRotacion marca los cuatro productos que no admiten previsión semanal', () => {
  // Cloro Granulado x 25 Kg: 31 unidades en 35 semanas -> 0,9 por semana
  const granulado25 = new Array(35).fill(0); granulado25[0] = 31;
  assert.strictEqual(Cloro.bajaRotacion(granulado25, 10), true);
  // el siguiente producto hacia arriba promedia 32 u/semana
  assert.strictEqual(Cloro.bajaRotacion(new Array(35).fill(32), 10), false);
});

test('kgMateria suma por materia prima y aplica la merma', () => {
  const productos = [
    { id: 1, materia_id: 7, kg_mp_por_unidad: 1,   merma_pct: 0 },
    { id: 2, materia_id: 7, kg_mp_por_unidad: 0.9, merma_pct: 10 },
    { id: 3, materia_id: 8, kg_mp_por_unidad: 2,   merma_pct: 0 }
  ];
  const r = Cloro.kgMateria(productos, { 1: 100, 2: 100, 3: 50 });
  // materia 7: 100*1 + 100*0.9*1.1 = 100 + 99 = 199 ; materia 8: 50*2 = 100
  assert.ok(Math.abs(r.porMateria[7] - 199) < 1e-9);
  assert.ok(Math.abs(r.porMateria[8] - 100) < 1e-9);
  assert.deepStrictEqual(r.sinAsignar, []);
});

test('un producto sin materia prima no suma en ningun lado y se lista', () => {
  const productos = [
    { id: 1, materia_id: null, kg_mp_por_unidad: 1, merma_pct: 0 },
    { id: 2, materia_id: 7,    kg_mp_por_unidad: 1, merma_pct: 0 }
  ];
  const r = Cloro.kgMateria(productos, { 1: 500, 2: 10 });
  assert.deepStrictEqual(r.sinAsignar, [1]);
  assert.strictEqual(r.porMateria[7], 10);
  assert.strictEqual(Object.keys(r.porMateria).length, 1);
});

test('un producto sin kg por unidad cuenta como sin asignar', () => {
  const r = Cloro.kgMateria([{ id: 1, materia_id: 7, kg_mp_por_unidad: 0, merma_pct: 0 }], { 1: 500 });
  assert.deepStrictEqual(r.sinAsignar, [1]);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/cloro-calc.test.js`
Expected: FAIL — `Cloro.prever is not a function`

- [ ] **Step 3: Implementación mínima**

En `cloro-calc.js`, antes del `return`:

```js
  // La prevision: el historico suavizado, corregido por el crecimiento.
  // El orden importa. Suavizar DESPUES de crecer daria lo mismo, pero
  // crecer sobre la serie cruda y suavizar despues mezclaria semanas ya
  // infladas con otras que no: se suaviza primero, siempre.
  function prever(o) {
    var suave = suavizar(o.anterior || [], o.ventana || 1);
    var f = 1 + (parseFloat(o.crecimientoPct) || 0);
    var out = [];
    for (var i = 0; i < o.semanas; i++) out.push((suave[i] || 0) * f);
    return out;
  }

  // Stock de producto terminado semana a semana. En las semanas ya
  // cerradas manda la venta REAL; en las que vienen, la prevista.
  function proyectarStock(o) {
    var n = Math.max((o.ventas || []).length, (o.envasado || []).length, (o.prevision || []).length);
    var s = parseFloat(o.stockInicial) || 0, out = [], i, salida;
    for (i = 0; i < n; i++) {
      salida = (i < o.semanasCerradas)
        ? (parseFloat((o.ventas || [])[i]) || 0)
        : (parseFloat((o.prevision || [])[i]) || 0);
      s = s + (parseFloat((o.envasado || [])[i]) || 0) - salida;
      out.push(s);
    }
    return out;
  }

  function sugerido(o) {
    var h = Math.max(1, o.horizonte || 1);
    var desde = Math.max(1, o.desdeSemana || 1);
    var dem = 0, i;
    for (i = desde - 1; i < desde - 1 + h; i++) dem += (parseFloat((o.prevision || [])[i]) || 0);
    var colchon = (parseFloat(o.semanasSeguridad) || 0) * (dem / h);
    var bruto = Math.max(0, dem + colchon - (parseFloat(o.stockHoy) || 0));
    var lote = parseFloat(o.lote) || 1;
    if (lote <= 1) return Math.ceil(bruto);
    return Math.ceil(bruto / lote) * lote;
  }

  // Un producto que vende menos que `umbral` por semana no admite
  // prevision semanal: el ruido es mas grande que la senal. Se prevé
  // igual, pero la pantalla lo muestra por mes.
  function bajaRotacion(serie, umbral) {
    var a = serie || [];
    if (!a.length) return true;
    return (suma(a) / a.length) < (parseFloat(umbral) || 0);
  }

  // kg de materia prima. Un producto sin materia asignada o sin kg por
  // unidad NO se reparte a ningun lado ni se estima: se devuelve en
  // `sinAsignar` para que la pantalla lo cante. Adivinar aca termina en
  // una compra de toneladas equivocada.
  function kgMateria(productos, sugeridos) {
    var porMateria = {}, sinAsignar = [];
    (productos || []).forEach(function (p) {
      var u = parseFloat((sugeridos || {})[p.id]) || 0;
      var kgu = parseFloat(p.kg_mp_por_unidad) || 0;
      if (p.materia_id == null || kgu <= 0) { sinAsignar.push(p.id); return; }
      var kg = u * kgu * (1 + (parseFloat(p.merma_pct) || 0) / 100);
      porMateria[p.materia_id] = (porMateria[p.materia_id] || 0) + kg;
    });
    return { porMateria: porMateria, sinAsignar: sinAsignar };
  }
```

y agregar al objeto devuelto: `prever, proyectarStock, sugerido, bajaRotacion, kgMateria`.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/cloro-calc.test.js`
Expected: PASS, 26 tests.

- [ ] **Step 5: Commit**

```bash
git add cloro-calc.js test/cloro-calc.test.js
git commit -m "Cloro: prevision, stock proyectado, sugerido de envasado y kg de MP"
```

---

### Task 4: Las tablas

**Files:**
- Create: `migracion/cloro_schema.sql`

**Interfaces:**
- Consumes: la función `public.has_module(text)` que ya existe.
- Produces: tablas `cl_temporadas`, `cl_materias`, `cl_productos`, `cl_ventas`, `cl_envasado`, `cl_stock_inicial`, `cl_parametros`.

- [ ] **Step 1: Escribir el SQL**

Crear `migracion/cloro_schema.sql` con el encabezado de comentario explicando el porqué (como `migracion/mp_importacion.sql`), y:

```sql
create table if not exists public.cl_temporadas (
  id         bigint generated always as identity primary key,
  nombre     text not null unique,          -- '2026-2027'
  fecha_ini  date not null,                 -- 1/8
  fecha_fin  date not null,                 -- 31/3
  activa     boolean not null default false,
  nota       text,
  created_at timestamptz not null default now()
);

create table if not exists public.cl_materias (
  id     bigint generated always as identity primary key,
  nombre text not null unique,
  activo boolean not null default true,
  nota   text
);

create table if not exists public.cl_productos (
  id               bigint generated always as identity primary key,
  codigo           text not null unique,     -- el Cod. Art. del ERP
  nombre           text not null,
  materia_id       bigint references public.cl_materias(id) on delete set null,
  kg_mp_por_unidad numeric not null default 0,
  merma_pct        numeric not null default 0,
  lote_unidades    numeric not null default 1,
  orden            int not null default 0,
  activo           boolean not null default true
);

-- Ventas AGREGADAS POR SEMANA. El detalle factura por factura vive en el
-- ERP; aca serian ~35.000 filas para dibujar exactamente el mismo grafico.
create table if not exists public.cl_ventas (
  id           bigint generated always as identity primary key,
  temporada_id bigint not null references public.cl_temporadas(id) on delete cascade,
  producto_id  bigint not null references public.cl_productos(id) on delete cascade,
  semana       int not null,
  unidades     numeric not null default 0,
  origen       text,
  importado_at timestamptz not null default now(),
  unique (temporada_id, producto_id, semana)
);
create index if not exists idx_cl_ventas_temp on public.cl_ventas(temporada_id);

-- Una fila por ORDEN de envasado, no por semana: si en una semana se
-- envasa dos veces son dos ordenes, y borrar una no debe borrar la otra.
create table if not exists public.cl_envasado (
  id           bigint generated always as identity primary key,
  temporada_id bigint not null references public.cl_temporadas(id) on delete cascade,
  producto_id  bigint not null references public.cl_productos(id) on delete cascade,
  fecha        date not null,
  cantidad     numeric not null,
  orden        text,
  nota         text,
  created_at   timestamptz not null default now(),
  created_by   text
);
create index if not exists idx_cl_env_temp on public.cl_envasado(temporada_id);

create table if not exists public.cl_stock_inicial (
  temporada_id bigint not null references public.cl_temporadas(id) on delete cascade,
  producto_id  bigint not null references public.cl_productos(id) on delete cascade,
  cantidad     numeric not null default 0,
  primary key (temporada_id, producto_id)
);

create table if not exists public.cl_parametros (
  temporada_id         bigint primary key references public.cl_temporadas(id) on delete cascade,
  suavizado_semanas    int     not null default 5,
  horizonte_semanas    int     not null default 8,
  semanas_seguridad    numeric not null default 2,
  crecimiento_pct      numeric,          -- null = automatico
  umbral_baja_rotacion numeric not null default 10,
  updated_at           timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['cl_temporadas','cl_materias','cl_productos','cl_ventas',
                           'cl_envasado','cl_stock_inicial','cl_parametros'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists p_%I_read on public.%I;', t, t);
    execute format('create policy p_%I_read on public.%I for select using (auth.role()=''authenticated'');', t, t);
    execute format('drop policy if exists p_%I_write on public.%I;', t, t);
    execute format('create policy p_%I_write on public.%I for all using (public.has_module(''cloro'')) with check (public.has_module(''cloro''));', t, t);
  end loop;
end $$;

-- Las materias primas de la linea. Los productos arrancan SIN asignar a
-- proposito: ver la seccion 5.3 del spec.
insert into public.cl_materias (nombre)
select x from unnest(array['Dicloro','Tricloro','Hipoclorito de calcio',
                           'Carbonato de sodio (pH+)','Bisulfato de sodio (pH-)']) as x
where not exists (select 1 from public.cl_materias m where m.nombre = x);

-- Control
select (select count(*) from public.cl_materias) as materias,
       (select count(*) from public.cl_productos) as productos;
```

- [ ] **Step 2: Verificar que el SQL parsea**

No se ejecuta desde acá. Verificación: releer el archivo entero buscando comas colgantes, `create policy` sin `drop policy` previo y nombres de tabla mal escritos en el array del `do $$`. El array del `do $$` tiene que tener **exactamente** las 7 tablas creadas arriba.

- [ ] **Step 3: Commit**

```bash
git add migracion/cloro_schema.sql
git commit -m "Cloro: tablas cl_* con RLS por modulo"
```

- [ ] **Step 4: Pedirle al usuario que lo corra**

Decirle: "Corré `migracion/cloro_schema.sql` en Supabase → SQL Editor". Esperar confirmación antes de la Task 5.

---

### Task 5: La semilla con las dos temporadas

**Files:**
- Create: `migracion/cloro_seed.sql` (generado por script)

**Interfaces:**
- Consumes: las tablas de Task 4; `Cloro.semanaDe` sólo como referencia conceptual (el script lo replica en Python).
- Produces: 13 filas en `cl_productos`, 2 en `cl_temporadas`, ~910 en `cl_ventas`.

- [ ] **Step 1: Escribir el generador**

Guardar como `scratchpad/gen_cloro_seed.py` (fuera del repo) y correr con `python`. Requiere `pip install xlrd`.

```python
import xlrd, os, datetime, io

RAIZ = r'C:\Users\alech\Downloads\PREVISION DE CLORO\PREVISION DE CLORO'
TEMPS = [('2024-2025', 2024), ('2025-2026', 2025)]

def excel_a_fecha(n):
    return datetime.date(1899, 12, 30) + datetime.timedelta(days=int(n))

def lunes_ini(anio):
    d = datetime.date(anio, 8, 1)
    return d - datetime.timedelta(days=d.weekday())

def semana(f, anio):
    return (f - lunes_ini(anio)).days // 7 + 1

productos = {}          # codigo -> nombre
ventas = {}             # (temporada, codigo, semana) -> unidades
rango = {}              # (temporada, codigo) -> (semana_min, semana_max)

for temp, anio in TEMPS:
    for fn in sorted(os.listdir(os.path.join(RAIZ, temp))):
        sh = xlrd.open_workbook(os.path.join(RAIZ, temp, fn)).sheet_by_index(0)
        for r in range(5, sh.nrows):
            v = sh.row(r)
            if not isinstance(v[0].value, float) or v[0].value < 1000:
                continue                      # encabezado y fila de total
            cod = str(v[2].value).strip()
            productos.setdefault(cod, str(v[3].value).strip())
            w = semana(excel_a_fecha(v[0].value), anio)
            ventas[(temp, cod, w)] = ventas.get((temp, cod, w), 0) + float(v[4].value)
            lo, hi = rango.get((temp, cod), (w, w))
            rango[(temp, cod)] = (min(lo, w), max(hi, w))

# Las semanas sin venta dentro del rango del archivo van en CERO. Si se
# saltearan, la pantalla las dibujaria como huecos y el suavizado las
# promediaria como si no existieran, inflando la prevision.
for (temp, cod), (lo, hi) in list(rango.items()):
    for w in range(lo, hi + 1):
        ventas.setdefault((temp, cod, w), 0)

def q(s):
    return "'" + str(s).replace("'", "''") + "'"

out = io.StringIO()
out.write("""-- ============================================================
--  PREVISION CLORO - semilla: productos y las dos temporadas historicas
--
--  Generado desde los .xls del ERP. Las ventas van AGREGADAS POR SEMANA
--  de temporada (semana 1 = el lunes de la semana que contiene el 1/8).
--
--  Los productos quedan SIN materia prima asignada a proposito: nadie
--  puede deducir de estos datos si el Cloro Granulado es hipoclorito o
--  el Cloro Shock es dicloro, y una suposicion ahi se convierte en una
--  compra de toneladas equivocada. Se asignan desde Configuracion.
--
--  Correr DESPUES de cloro_schema.sql.
-- ============================================================

""")

out.write("insert into public.cl_temporadas (nombre, fecha_ini, fecha_fin, activa) values\n")
out.write(",\n".join(
    "  (%s, '%d-08-01', '%d-03-31', false)" % (q(t), a, a + 1) for t, a in TEMPS))
out.write("\non conflict (nombre) do nothing;\n\n")

out.write("insert into public.cl_productos (codigo, nombre, orden) values\n")
out.write(",\n".join(
    "  (%s, %s, %d)" % (q(c), q(productos[c]), i + 1)
    for i, c in enumerate(sorted(productos))))
out.write("\non conflict (codigo) do nothing;\n\n")

out.write("insert into public.cl_ventas (temporada_id, producto_id, semana, unidades, origen)\n"
          "select t.id, p.id, v.semana, v.unidades, 'semilla'\n"
          "  from (values\n")
filas = sorted(ventas.items())
out.write(",\n".join(
    "    (%s, %s, %d, %s)" % (q(t), q(c), w, repr(round(u, 3)))
    for (t, c, w), u in filas))
out.write("\n  ) as v(temporada, codigo, semana, unidades)\n"
          "  join public.cl_temporadas t on t.nombre = v.temporada\n"
          "  join public.cl_productos  p on p.codigo = v.codigo\n"
          "on conflict (temporada_id, producto_id, semana) do nothing;\n\n")

out.write("insert into public.cl_parametros (temporada_id) select id from public.cl_temporadas\n"
          "  where not exists (select 1 from public.cl_parametros x where x.temporada_id = cl_temporadas.id);\n\n")

out.write("-- Control: tienen que dar exactamente estos totales por temporada.\n")
for t, a in TEMPS:
    tot = sum(u for (tt, c, w), u in ventas.items() if tt == t)
    out.write("--   %s = %s unidades\n" % (t, round(tot)))
out.write("""select t.nombre, count(*) as semanas_cargadas, round(sum(v.unidades)) as unidades
  from public.cl_ventas v join public.cl_temporadas t on t.id = v.temporada_id
 group by t.nombre order by t.nombre;
""")

open(r'C:\SubatirApps\SistemaComprasSubatir\migracion\cloro_seed.sql', 'w',
     encoding='utf-8').write(out.getvalue())
print('filas de venta:', len(filas), ' productos:', len(productos))
```

- [ ] **Step 2: Correr el generador y verificar los totales**

Run: `python scratchpad/gen_cloro_seed.py`

Expected: `filas de venta:` alrededor de 900, `productos: 13`.

Después verificar contra los totales que ya se midieron de los archivos originales — el `.sql` generado los trae como comentario al final. Tienen que coincidir con esta tabla:

| Cód. | Producto | 2024-25 | 2025-26 |
|---|---|---:|---:|
| 218801 | Pastilla Triple Acción 1 Kg | 19.498 | 22.253 |
| 2150250 | Cloro Shock 240 g | 10.681 | 13.227 |
| 2150950 | Cloro Shock 900 g | 10.676 | 11.075 |
| 218803 | Pastilla Triple Acción 3 Un | 6.823 | 7.931 |
| 219727 | Regulador PH MAS 2 Kg | 3.912 | 3.986 |
| 218804 | Pastilla Triple Acción 4 Kg | 3.216 | 3.320 |
| 218905 | Pastilla Jacuzzi 50 g x 5 | 2.932 | 3.599 |
| 2153500 | Cloro Shock 3,5 Kg | 2.474 | 2.415 |
| 219729 | Regulador PH Menos 4 Kg | 976 | 1.125 |
| 21420 | Cloro Granulado 4 Kg | 207 | 163 |
| 230137 | Cloro Shock 25 Kg | 110 | 168 |
| 218825 | Pastilla Triple Acción 25 Kg | 131 | 161 |
| 21421 | Cloro Granulado 25 Kg | 9 | 31 |

Comando para comprobar el total por producto dentro del `.sql` generado, sin abrir Excel:

```bash
python -c "
import re,collections
s=open(r'migracion/cloro_seed.sql',encoding='utf-8').read()
t=collections.Counter()
for m in re.finditer(r\"\\('(20\\d\\d-20\\d\\d)', '(\\d+)', (\\d+), ([\\d.]+)\\)\", s):
    t[(m.group(1),m.group(2))]+=float(m.group(4))
for k in sorted(t): print(k, round(t[k]))
"
```

- [ ] **Step 3: Commit**

```bash
git add migracion/cloro_seed.sql
git commit -m "Cloro: semilla con las dos temporadas historicas, agregadas por semana"
```

- [ ] **Step 4: Pedirle al usuario que lo corra**

Decirle: "Corré `migracion/cloro_seed.sql`". Esperar confirmación y después **verificar leyendo la base desde el navegador** que las 13 filas de productos y los totales por temporada coinciden con la tabla de arriba.

---

### Task 6: La pantalla base y el cableado del módulo

**Files:**
- Create: `cloro.html`
- Modify: `nav.js:22-37` (array `ITEMS`)
- Modify: `nav.css:113` (zona de colores por módulo)
- Modify: `subatir-app.js:16-27` (`PAGE_MODULE`)
- Modify: `usuarios.html:210-211` (`MODULES` y `MODLABEL`)
- Modify: `sw.js:25-27` (array `SHELL`)
- Modify: `bump-version.ps1:49` y `bump-version.ps1:63-66`

**Interfaces:**
- Consumes: todo `Cloro.*` de las tasks 1-3; las tablas de la Task 4.
- Produces: en `cloro.html`, las funciones globales `cargar()`, `cargarTemporada()`, `serieVentas(tempId, prodId) -> number[]`, `envasadoPorSemana(temporada, prodId) -> number[]`, `temporadaActual() -> object`, `temporadaPrevia(temporada) -> object|null`, `semanaHoy(temporada) -> number`, `filas()`, `pintarTodo()`, `pintarAvisos()`, `pintarKPIs()`, `pintarTabla()`, y las variables `TEMPS`, `PROD`, `MAT`, `VENTAS`, `ENVASADO`, `STOCK0`, `PAR`, `CUR_TEMP`, `NSEM`, `SEM_ACTUAL`, `CREC`. Las tasks 7-11 se cuelgan de estas.
- Cada fila que devuelve `filas()` es `{prod, vAct, vPrev, vPre2, prevision: number[]|null, stock: number[]|null, sugerido: number, bajaRot: boolean}`. `prevision` y `stock` vienen en `null` cuando no hay temporada anterior cargada.

- [ ] **Step 1: Cablear el módulo en los seis archivos compartidos**

En `nav.js`, dentro de `ITEMS`, después de la entrada de `mp_importacion`:

```js
    { k: 'cloro', href: 'cloro.html', ico: '💧', txt: 'Previsión Cloro',
      title: 'Previsión de envasado y compra de materia prima de la línea de piscinas' },
```

En `nav.css`, junto a las otras reglas `nav.sbnav a[data-nav=...]`:

```css
nav.sbnav a[data-nav="cloro"]{--c:56,189,248}   /* celeste piscina */
```

En `subatir-app.js`, dentro de `PAGE_MODULE`, después de `'mp-importacion.html': 'mp_importacion',`:

```js
    'cloro.html': 'cloro',
```

En `usuarios.html`, agregar `'cloro'` al array `MODULES` y `cloro:'Previsión Cloro'` a `MODLABEL`.

En `sw.js`, agregar `'./cloro.html',` al array `SHELL`.

En `bump-version.ps1`: agregar `'cloro.html'` al array `$modulos`, y `cloro-calc` a la alternancia del patrón `$SUB_BUST` (queda `...|reposicion-calc|cloro-calc|oc-pdf)`).

- [ ] **Step 2: Verificar el cableado**

```bash
node --check nav.js && node --check subatir-app.js && node --check sw.js
powershell -NoProfile -ExecutionPolicy Bypass -Command "[scriptblock]::Create((Get-Content -Raw bump-version.ps1)) | Out-Null; 'ps1 ok'"
```
Expected: sin errores.

- [ ] **Step 3: Crear `cloro.html` con la estructura y el `<head>` copiados de `mp-importacion.html`**

Copiar de `mp-importacion.html`: el `<head>` completo (fuentes, `:root`, `.hdr`, `.glass`, `.kpi*`, `.btn*`, `.inp`, `.chip`, `.ovl`/`.modal`, `.toast`, tabla), el `<header>` con `<nav></nav>` y los `<script>` de supabase / `supabase-config.js` / `subatir-app.js` / `nav.js`. Cambiar el `title`, el `data-nav` activo y los textos.

Agregar al final del body, antes del script propio:

```html
<script src="cloro-calc.js?v=2026-09-08.1349"></script>
```

(el `?v=` lo reescribe `bump-version.ps1` en cada publicación).

Barra de contexto:

```html
<div class="card ctx">
  <div class="ctx-g">
    <span class="ctx-l">Temporada</span>
    <select class="inp" id="f-temp" onchange="cambioTemporada()" aria-label="Temporada"></select>
  </div>
  <div class="ctx-g">
    <span class="ctx-l">Semana</span>
    <span id="sem-actual" class="chip">—</span>
  </div>
  <div class="ctx-g">
    <span class="ctx-l">Crecimiento</span>
    <span id="crec" class="chip">—</span>
  </div>
  <div class="ctx-sp"></div>
  <div class="sec-tools">
    <button class="btn btn-sm" onclick="openConfig()">⚙ Configuración</button>
    <button class="btn btn-sm btn-teal" onclick="openImportar()">📥 Importar ventas</button>
    <button class="btn btn-sm btn-pri" onclick="openEnvasado()">➕ Orden de envasado</button>
    <button class="btn btn-sm" onclick="exportCSV()">⬇ CSV</button>
    <button class="btn btn-sm" onclick="window.print()">🖨 Imprimir</button>
  </div>
</div>
<div id="avisos"></div>
<div class="kpi-grid" id="kpis"></div>
<div class="card"><table class="tbl"><thead id="thead"></thead><tbody id="tbody"></tbody></table></div>
<div class="card"><h3 class="sec-t">Materia prima</h3><table class="tbl"><tbody id="tbody-mp"></tbody></table></div>
```

Dejar `openConfig`, `openImportar`, `openEnvasado` y `exportCSV` como funciones vacías con un `toast('En construcción')` — se completan en las tasks 7, 8, 9 y 11.

- [ ] **Step 4: Escribir la carga y el cálculo de la pantalla**

En el `<script>` propio, siguiendo el patrón de `mp-importacion.html` (`SubatirApp.ready.then(...)`, `falta(e)` para el mensaje de "falta correr el SQL"):

```js
var TEMPS=[], PROD=[], MAT=[], VENTAS={}, ENVASADO=[], STOCK0={}, PAR=null;
var CUR_TEMP=null, NSEM=0, SEM_ACTUAL=0, CREC={pct:0,modo:'sin-datos'};

// VENTAS se indexa por temporada y producto: VENTAS[tempId][prodId] = [semana1, semana2, ...]
function serieVentas(tempId, prodId){
  return ((VENTAS[tempId]||{})[prodId]) || [];
}
// Las órdenes de envasado se guardan por FECHA (una fila por orden) y el
// cálculo las quiere por semana: acá es donde se pasa de una cosa a la otra.
function envasadoPorSemana(t, prodId){
  var ini = new Date(t.fecha_ini+'T00:00:00Z');
  var out = new Array(NSEM); for(var i=0;i<NSEM;i++) out[i]=0;
  ENVASADO.forEach(function(e){
    if(e.temporada_id!==t.id || e.producto_id!==prodId) return;
    var w = Cloro.semanaDe(new Date(e.fecha+'T00:00:00Z'), ini);
    if(w>=1 && w<=NSEM) out[w-1] += (parseFloat(e.cantidad)||0);
  });
  return out;
}
function temporadaActual(){ return TEMPS.filter(function(t){ return t.id===CUR_TEMP; })[0]; }
function temporadaPrevia(t){   // la inmediata anterior por fecha_ini
  var prev=null;
  TEMPS.forEach(function(x){
    if(x.fecha_ini < t.fecha_ini && (!prev || x.fecha_ini > prev.fecha_ini)) prev=x;
  });
  return prev;
}
```

`cargar()` lee `cl_temporadas`, `cl_materias`, `cl_productos` y elige temporada (la `activa`, o la de `fecha_ini` más reciente). `cargarTemporada()` lee `cl_ventas` de la temporada actual **y de las dos anteriores**, más `cl_envasado`, `cl_stock_inicial` y `cl_parametros` de la actual.

La semana actual sale de la fecha de hoy contra `fecha_ini`, acotada al largo de la temporada:

```js
function semanaHoy(t){
  var w = Cloro.semanaDe(new Date(), new Date(t.fecha_ini+'T00:00:00Z'));
  return Math.min(Math.max(w,1), NSEM);
}
```

`filas()` arma, por producto, todo lo que la pantalla necesita. Las semanas cerradas son `SEM_ACTUAL - 1`: la semana en curso todavía no terminó, así que su venta está incompleta y contarla haría que el crecimiento se desplome todos los lunes.

```js
function filas(){
  var t = temporadaActual(); if(!t || !PAR) return [];
  var prev = temporadaPrevia(t);
  var prev2 = prev ? temporadaPrevia(prev) : null;
  var cerradas = Math.max(0, SEM_ACTUAL - 1);
  return PROD.filter(function(p){ return p.activo!==false; })
    .sort(function(a,b){ return (a.orden||0)-(b.orden||0); })
    .map(function(p){
      var vAct  = serieVentas(t.id, p.id);
      var vPrev = prev  ? serieVentas(prev.id,  p.id) : [];
      var vPre2 = prev2 ? serieVentas(prev2.id, p.id) : [];
      // Sin temporada anterior no hay de dónde prever. Se devuelve null y
      // la pantalla lo dice; un cero se leería como "no hay que envasar".
      var prevision = prev
        ? Cloro.prever({anterior:vPrev, ventana:PAR.suavizado_semanas,
                        crecimientoPct:CREC.pct, semanas:NSEM})
        : null;
      var env = envasadoPorSemana(t, p.id);          // array de largo NSEM
      var stock = prevision
        ? Cloro.proyectarStock({stockInicial:(STOCK0[p.id]||0), ventas:vAct,
                                envasado:env, prevision:prevision, semanasCerradas:cerradas})
        : null;
      var sug = prevision
        ? Cloro.sugerido({prevision:prevision, desdeSemana:SEM_ACTUAL,
                          horizonte:PAR.horizonte_semanas,
                          semanasSeguridad:PAR.semanas_seguridad,
                          stockHoy:(stock[Math.max(0,SEM_ACTUAL-1)]||0),
                          lote:p.lote_unidades})
        : 0;
      return {prod:p, vAct:vAct, vPrev:vPrev, vPre2:vPre2,
              prevision:prevision, stock:stock, sugerido:sug,
              bajaRot: prev ? Cloro.bajaRotacion(vPrev, PAR.umbral_baja_rotacion) : false};
    });
}
```

- [ ] **Step 4b: El caso "no hay temporada anterior"**

Cuando `temporadaPrevia()` devuelve null —la primera temporada que se carga, o una que quedó suelta— **no hay previsión y hay que decirlo**. En `pintarAvisos()`:

```js
if(!temporadaPrevia(temporadaActual())){
  a.push({t:'urg', txt:'<b>No hay temporada anterior cargada.</b> Sin ella no se puede prever: '
    +'la previsión sale del histórico de la temporada pasada. Importá sus ventas y volvé.'});
}
```

Y las columnas de previsión, sugerido y kg de MP de la tabla muestran `—`, **no cero**. Un cero se lee como "no hay que envasar nada", que es exactamente la conclusión opuesta a la correcta.

- [ ] **Step 4c: El caso "no hay con qué calcular un stock"** *(agregado al ejecutar)*

Con las temporadas históricas cargadas —ventas sí, envasado no— la pantalla mostró `stock hoy −69.309 u` y sugirió envasar 13.227 unidades de Cloro Shock 240 g. Es aritmética correcta sobre datos que no están, y sale con cara de dato.

```js
// Un stock inicial cargado EN CERO sí cuenta: es una afirmación, no una
// ausencia. Por eso se mira si existe la fila, no su valor.
function hayBaseDeStock(){
  return Object.keys(STOCK0).length>0 || ENVASADO.length>0;
}
```

Mientras `hayBaseDeStock()` sea falso, `stock`, `sugerido` y `kg de MP` van en `—` (fila, total y KPI) y un aviso explica qué falta cargar. Las ventas y la previsión **sí** se muestran: esas no dependen del stock.

- [ ] **Step 5: Verificar que los tres `<script>` inline parsean**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('cloro.html','utf8');
const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m,p=[],n=0; while((m=re.exec(h))){n++;p.push('// bloque '+n+'\n'+m[1]);}
fs.writeFileSync(process.env.TMP+'/cloro_inline.js',p.join('\n'));
console.log('bloques:',n);
" && node --check "$TMP/cloro_inline.js" && echo "inline OK"
```
Expected: `inline OK`.

- [ ] **Step 6: Commit**

```bash
git add cloro.html nav.js nav.css subatir-app.js usuarios.html sw.js bump-version.ps1
git commit -m "Cloro: pantalla base, KPIs y tabla por producto"
```

- [ ] **Step 7: Publicar y verificar en el navegador**

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File bump-version.ps1 && git add -A && git commit -m "Version" && git push origin main
```

Después, abrir `cloro.html` en el navegador y comprobar contra la base que los totales de temporada de la tabla coinciden con los de la Task 5. **No dar por buena la pantalla sin haberla mirado.**

---

### Task 7: Configuración

**Files:**
- Modify: `cloro.html`

**Interfaces:**
- Consumes: `PROD`, `MAT`, `PAR`, `pintarTodo()` de la Task 6.
- Produces: `openConfig()`, `guardarConfig()`.

- [ ] **Step 1: El modal**

Un `<div class="ovl" id="ovl-conf">` con dos secciones:

**Nueva temporada** *(agregado al ejecutar: no estaba en el plan original y sin esto el módulo no se puede usar)* — nombre, fecha de inicio y de fin, y un tilde de "activa". Al crearla se inserta también su fila en `cl_parametros`, copiando los parámetros de la temporada que se estaba viendo. Sin esta pantalla las temporadas sólo se pueden crear por SQL, y la 2026-2027 —la que de verdad hay que planificar— no existe todavía.

**Parámetros de la temporada** — suavizado (semanas, impar), horizonte (semanas), colchón (semanas), umbral de baja rotación, y crecimiento: un checkbox "calcular solo" y, si se destilda, un campo de %.

**Productos** — una fila por producto con: nombre (sólo lectura), select de materia prima, kg de MP por unidad, merma %, lote. Los que tengan `materia_id` en null o `kg_mp_por_unidad` en 0 llevan la fila marcada en rojo y arriba un contador: *"N productos sin materia prima asignada — no suman kg"*.

También un botón para dar de alta una materia prima nueva (`cl_materias`).

- [ ] **Step 2: Guardar**

Un `update` por producto cambiado y uno de `cl_parametros`, todos con `.select()`:

```js
function guardarConfig(){
  var ops=[]; /* ... arma los updates de PROD cambiados y de PAR ... */
  Promise.all(ops).then(function(rs){
    var mal=rs.filter(function(r){ return r.error || !r.data || !r.data.length; });
    // Un update bloqueado por RLS vuelve con cero filas y SIN error: sin
    // este chequeo la pantalla dice "guardado" y no guardo nada.
    if(mal.length){ toast('No se pudo guardar ('+mal.length+' filas). ¿Tenés el permiso del módulo?','err'); return; }
    toast('Configuración guardada','ok'); cerrar('ovl-conf'); cargarTemporada();
  });
}
```

- [ ] **Step 3: Verificar la sintaxis inline**

Mismo comando de la Task 6, Step 5. Expected: `inline OK`.

- [ ] **Step 4: Commit y verificar en el navegador**

```bash
git add cloro.html && git commit -m "Cloro: configuracion de materias primas, kg por unidad y parametros"
```

Publicar, asignar una materia prima a un producto desde la pantalla y **verificar leyendo `cl_productos` desde la sesión del navegador** que quedó guardada.

---

### Task 8: Órdenes de envasado y stock inicial

**Files:**
- Modify: `cloro.html`

**Interfaces:**
- Consumes: `PROD`, `CUR_TEMP`, `ENVASADO`, `STOCK0` de la Task 6.
- Produces: `openEnvasado()`, `guardarEnvasado()`, `borrarEnvasado(id)`, `openStockInicial()`, `guardarStockInicial()`.

- [ ] **Step 1: Modal de orden de envasado**

Campos: producto (select), fecha (date, default hoy), cantidad (unidades), N° de orden (texto libre), nota. Al guardar, `insert` en `cl_envasado` con `.select()` y chequeo de fila devuelta.

Debajo del formulario, la lista de las órdenes ya cargadas de la temporada, con su semana calculada (`Cloro.semanaDe`) y un botón de borrar por fila.

Validaciones que el modal hace y por qué:
- **Fecha fuera de la temporada** → no se guarda, se avisa. Una orden fuera de rango caería en una semana que la pantalla no dibuja y desaparecería sin dejar rastro.
- **Cantidad ≤ 0** → no se guarda.

- [ ] **Step 2: Stock inicial**

*(Cambiado al ejecutar: NO va en un modal aparte, va como sección 5 de Configuración.)* Es una carga de una vez por temporada, con el mismo ciclo de vida que los parámetros; un sexto botón en la barra para algo que se toca una vez al año está mal puesto. Una fila por producto y un `upsert` a `cl_stock_inicial` (`onConflict: 'temporada_id,producto_id'`).

**Un renglón vacío no es un cero.** Vacío significa "todavía no lo sé" y cero significa "arrancó en cero"; el módulo se comporta distinto con cada uno, así que el guardado **saltea los vacíos** en vez de escribirlos. Si se escribieran como cero, abrir y cerrar Configuración sin tocar nada habilitaría el cálculo de stock de los 13 productos con datos que nadie afirmó.

- [ ] **Step 3: Verificar la sintaxis inline y commit**

Mismo comando de la Task 6, Step 5.

```bash
git add cloro.html && git commit -m "Cloro: ordenes de envasado y stock inicial de temporada"
```

- [ ] **Step 4: Verificar en el navegador**

Cargar una orden, comprobar que la semana que muestra es la correcta y que el stock proyectado de la tabla se movió en esa semana y en las siguientes.

---

### Task 9: Importar las ventas

**Files:**
- Modify: `cloro.html`

**Interfaces:**
- Consumes: `PROD`, `TEMPS`, `CUR_TEMP`; `Cloro.semanaDe`.
- Produces: `openImportar()`, `xlElegidos(files)`, `previsualizarImport()`, `aplicarImport()`.

- [ ] **Step 1: Cargar SheetJS sólo al abrir el modal**

```js
// SheetJS pesa ~900 KB y sólo hace falta para importar. Cargarlo en el
// <head> le costaria esa descarga a todo el que abre la pantalla a mirar
// un grafico.
var SHEETJS=null;
function cargarSheetJS(){
  if(SHEETJS) return SHEETJS;
  SHEETJS = new Promise(function(ok, mal){
    var s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload=function(){ ok(window.XLSX); };
    s.onerror=function(){ SHEETJS=null; mal(new Error('No se pudo cargar el lector de Excel (revisá tu conexión)')); };
    document.head.appendChild(s);
  });
  return SHEETJS;
}
```

- [ ] **Step 2: Leer los archivos**

`<input type="file" multiple accept=".xls,.xlsx">` más zona de arrastre. Por cada archivo:

```js
function leerArchivo(XLSX, file){
  return file.arrayBuffer().then(function(buf){
    var wb = XLSX.read(new Uint8Array(buf), {type:'array', cellDates:true});
    var sh = wb.Sheets[wb.SheetNames[0]];
    // header:1 devuelve filas como arrays: el encabezado del ERP ocupa 5
    // filas y no sirve como nombres de columna.
    var rows = XLSX.utils.sheet_to_json(sh, {header:1, raw:true});
    var out=[], i, r, f;
    for(i=0;i<rows.length;i++){
      r=rows[i];
      if(!r || r.length<5) continue;
      f = r[0];
      if(!(f instanceof Date)) continue;   // saltea encabezado y fila de total
      out.push({fecha:f, cod:String(r[2]).trim(), desc:String(r[3]).trim(), cant:parseFloat(r[4])||0});
    }
    return {nombre:file.name, filas:out};
  });
}
```

- [ ] **Step 3: Previsualizar**

Por archivo, mostrar: producto reconocido (o **código desconocido**, listado aparte), temporada deducida del rango de fechas, semanas que cubre, total de unidades, y la diferencia contra lo que ya hay cargado para ese producto y temporada.

Reglas, con su porqué en el código:
- Filas con fecha fuera de `[fecha_ini, fecha_fin]` de la temporada deducida → se descartan y se cuentan. Un `.xls` con fechas de abril traería semanas que la temporada no tiene.
- Código de artículo que no está en `cl_productos` → el archivo entero se ignora y se lista el código. Dar de alta el producto solo, sin materia prima ni kg por unidad, metería un producto mudo en todas las cuentas.

- [ ] **Step 4: Aplicar**

Por cada (producto, temporada) del lote:

```js
// El archivo es la verdad para ese producto y esa temporada: primero se
// borran TODAS sus semanas dentro del rango que cubre el archivo y despues
// se insertan las del archivo, CEROS INCLUIDOS. Una semana sin ventas no
// aparece en el listado del ERP, y saltearla dejaria el numero de la
// importacion anterior mezclado con datos nuevos.
SB.from('cl_ventas').delete()
  .eq('temporada_id', tempId).eq('producto_id', prodId)
  .gte('semana', wMin).lte('semana', wMax).select()
  .then(function(){ return SB.from('cl_ventas').insert(filas).select(); })
```

Chequear que el `insert` devuelva tantas filas como se mandaron.

- [ ] **Step 5: Verificar contra los archivos reales**

Publicar y subir los 13 `.xls` de `2025-2026` en el navegador. El total por producto de la previsualización tiene que coincidir con la tabla de la Task 5, Step 2. **Si un solo producto no coincide, no seguir**: el problema está en el lector, y todo el módulo cuelga de esas ventas.

- [ ] **Step 6: Commit**

```bash
git add cloro.html && git commit -m "Cloro: importar ventas desde los .xls del ERP, varios a la vez"
```

---

### Task 10: Los gráficos

**Files:**
- Modify: `cloro.html`

**Interfaces:**
- Consumes: `filas()`, `PAR`, `SEM_ACTUAL`, `NSEM` de la Task 6.
- Produces: `pintarGrafTemporada()`, `pintarGrafMP()`, `pintarTarjetas()`, llamadas desde `pintarTodo()`.

- [ ] **Step 1: Cargar las skills de diseño y motion**

Antes de escribir una línea de gráfico, invocar con la herramienta Skill: `dataviz`, `frontend-design:frontend-design`, `web-animation-skills:svg-animation`, `web-animation-skills:60fps-animation` y `web-animation-skills:accessible-animation`. El usuario las pidió explícitamente y traen las reglas de paleta, de tipos de marca y de `prefers-reduced-motion` que este paso tiene que respetar.

- [ ] **Step 2: Gráfico de temporada**

SVG dibujado a mano (el proyecto no usa librerías de gráficos; `mp-importacion.html` hace lo mismo con su dónut y sus barras). Eje X = semana de temporada 1..NSEM. Series:

- Temporada anterior a la anterior, línea tenue.
- Temporada anterior, línea llena.
- Temporada actual, línea gruesa, hasta `SEM_ACTUAL`.
- Previsión: continúa la actual en punteado, con banda de ±(1 desvío del suavizado).
- Una guía vertical en `SEM_ACTUAL` rotulada "hoy".

Animación: el trazo entra con `stroke-dasharray`/`stroke-dashoffset`; las áreas con `opacity`. Interacción: crosshair y tooltip con los valores de las tres temporadas en esa semana.

- [ ] **Step 3: Gráfico de materia prima**

Barras apiladas por materia prima, kg por semana, dentro del horizonte. Las barras crecen desde la base con un retardo escalonado por índice. Leyenda con toggle por materia (mismo patrón que la leyenda del dónut de `mp-importacion.html`).

- [ ] **Step 4: Tarjetas por producto**

Una tarjeta por producto con sparkline de las temporadas, previsión de la semana que viene, semanas de cobertura del stock y, en los de baja rotación, el aviso y la previsión mostrada por mes.

- [ ] **Step 5: Respetar `prefers-reduced-motion`**

```css
@media (prefers-reduced-motion: reduce){
  .graf *{ animation:none !important; transition:none !important; }
  .graf .trazo{ stroke-dashoffset:0 !important; }
}
```

El gráfico tiene que quedar **completo y legible** con la animación apagada, no invisible: el estado final es el que se dibuja, la animación sólo lo revela.

- [ ] **Step 6: Verificar en el navegador**

Publicar y mirar los tres gráficos con datos reales. Comprobar a ojo que el pico de la temporada 2025-26 cae en la semana 23 y el de 2024-25 en la 27 — es la forma que se midió en el spec y es la prueba de que el eje está bien armado.

- [ ] **Step 7: Commit**

```bash
git add cloro.html && git commit -m "Cloro: graficos de temporada, materia prima y fichas por producto"
```

---

### Task 11: CSV, impresión y verificación final

**Files:**
- Modify: `cloro.html`

**Interfaces:**
- Consumes: `filas()`.
- Produces: `exportCSV()`.

- [ ] **Step 1: CSV**

Mismo formato que `exportCSV()` de `mp-importacion.html`: separador `;`, comillas dobles escapadas, decimales con coma, BOM `\ufeff` al principio para que Excel lo abra en UTF-8. Columnas: Producto, Código, Materia prima, Ventas temporada, Envasado temporada, Stock hoy, Previsión próxima semana, Demanda horizonte, Sugerido, kg MP.

- [ ] **Step 2: Impresión**

Regla `@media print` copiada de `mp-importacion.html:343` (esconde header, contexto, herramientas y toasts) más los gráficos en tamaño fijo.

- [ ] **Step 3: Correr todos los tests**

Run: `node --test` (sin argumentos: descubre solo todo lo que hay en `test/`. `node --test test/` **no** funciona en Node 24, interpreta `test` como un archivo).
Expected: PASS, 61 tests — los 26 de `cloro-calc` más los 35 de `reposicion-calc`.

- [ ] **Step 4: Verificación final en el navegador**

Con la temporada 2025-2026 seleccionada, comprobar:
- El total de ventas de cada producto coincide con la tabla de la Task 5.
- Los cuatro productos de baja rotación aparecen marcados y mostrados por mes.
- Un producto sin materia prima no suma kg y sale avisado.
- Con el crecimiento forzado a 0 %, la previsión de la semana W es exactamente el promedio de las semanas W−2..W+2 de la temporada anterior.

- [ ] **Step 5: Commit y publicar**

```bash
git add cloro.html && git commit -m "Cloro: CSV, impresion y verificacion final"
powershell -NoProfile -ExecutionPolicy Bypass -File bump-version.ps1 && git add -A && git commit -m "Version" && git push origin main
```

---

## Desvíos al ejecutar

Lo que cambió respecto del plan, y por qué. Todo verificado en el navegador contra la base.

1. **Crear temporadas** (Task 7). No estaba. Sin eso las temporadas sólo se creaban por SQL y la 2026-2027 —la única que hay que planificar— no existía. Los parámetros de la nueva se copian de la que se estaba viendo.

2. **La base de stock es por producto, no por temporada** (Tasks 6 y 8). Primero se arregló globalmente: mientras no hubiera stock inicial ni envasado, `stock` y `sugerido` iban en `—`. Pero alcanzaba con cargar el stock inicial de un solo producto para que los otros doce volvieran a mostrar el stock fantasma. Ahora la base se evalúa por producto.

3. **Stock inicial dentro de Configuración**, no en un modal propio (Task 8). Se toca una vez por temporada, igual que los parámetros.

4. **La paleta la eligió el validador, no el ojo** (Task 10). La primera, armada a mano con los tokens del proyecto, falló tres de las cinco pruebas contra este fondo: croma (un gris), separación para daltonismo (ΔE 5,2) y piso de visión normal (ΔE 14,5). La que quedó —`#0891b2 #a16207 #a855f7 #16a34a #ea580c`— pasa las cinco.

5. **La regla global de `prefers-reduced-motion` borraba los gráficos** (Task 10). `*{animation:none!important}` dejaba los trazos en `stroke-dashoffset:1`, o sea invisibles. Comprobado en el navegador: sin el arreglo, `dashoffset:1px`; con él, `0px` y `dasharray:none`. Quien tenga "reducir movimiento" prendido habría visto un gráfico vacío.

6. **Los colores de materia prima siguen al ID, no al ranking**, y a partir de la sexta materia se pliegan en "Otras" (Task 10). Si siguieran al tamaño, una semana en la que una materia pasa a otra repintaría el gráfico y dos capturas dejarían de ser comparables; y un hue ciclado haría pasar dos materias distintas por la misma en un gráfico que decide compras.

7. **`node --test test/` no funciona en Node 24** (Task 11): interpreta `test` como archivo. Va `node --test` sin argumentos.

## Verificaciones hechas

- Los totales de venta de los 13 productos coinciden con los `.xls` en las 26 combinaciones producto-temporada, tanto en la semilla como leyendo la base desde el navegador.
- **11 semanas con venta neta negativa** (devoluciones que superan a las ventas). No es un error de carga: la primera verificación las daba como diferencia y el error estaba en el chequeo. Se dejan porque el neto es la demanda real.
- El importador SheetJS reproduce exactamente lo mismo que el `xlrd` de la semilla: 13 de 13, cero códigos desconocidos, cero filas fuera de temporada.
- Aplicar la importación sobre datos ya cargados es idempotente: 457 filas antes, 457 después, total 69.454 sin cambios.
- Con el crecimiento forzado a 0 %, la previsión de la semana W es exactamente el promedio de W−2..W+2 de la temporada anterior (comprobado en las semanas 5, 15, 23 y 30).
- Los 4 productos de baja rotación que se midieron en el spec son los 4 que la pantalla marca, y son los 4 que la ficha muestra por mes.
- Alta y borrado de una orden de envasado, y guardado de configuración: round-trip contra la base, revertido.
- 61 tests de `node --test` en verde.
