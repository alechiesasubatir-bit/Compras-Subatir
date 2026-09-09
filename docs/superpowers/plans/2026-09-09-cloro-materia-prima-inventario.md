# Materia prima de Previsión Cloro vinculada al inventario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Previsión Cloro deje de tener su propia lista de materias primas sin stock y se cuelgue del inventario real del módulo Stock, para poder contestar "con lo que hay en el depósito, ¿hasta qué semana de la temporada llegamos?".

**Architecture:** `cl_materias` gana un `inventario_id` que apunta a la fila de `inventario` (por id, nunca por código: el código `218851` está duplicado). El cálculo nuevo vive en `cloro-calc.js`, puro y testeable: `planEnvasado` aplica la regla que ya existe —`Cloro.sugerido`— semana a semana en vez de una sola vez, `kgSemanal` la pasa a kg por materia y `cobertura` cuenta hasta dónde alcanza el stock. Antes de todo eso, `proyectarStock` aprende de qué semana es el conteo del stock inicial, porque el de esta temporada se hizo en la semana 7 y el módulo lo estaba tratando como si fuera de la semana 1. La pantalla sólo dibuja.

**Tech Stack:** HTML/CSS/JS sin framework (ES5 en el navegador), Supabase JS v2, `node --test` para los tests del cálculo.

**Spec:** `docs/superpowers/specs/2026-09-09-cloro-materia-prima-inventario-design.md`

## Global Constraints

- **JS de navegador en ES5**: `var`, `function`, nada de arrow functions ni `let/const` en `cloro.html` y `cloro-calc.js`. Los tests en `test/` sí usan sintaxis moderna (corren en node).
- **Nunca `new Date()` dentro de `cloro-calc.js`**: la fecha entra siempre por parámetro.
- **Toda escritura va directo a Supabase.** No hay guardado local ni botón de "sincronizar".
- **Todo `update`/`insert` lleva `.select()` y chequea que vuelva la fila.** Un update bloqueado por RLS devuelve **cero filas y ningún error**.
- **Los cambios de datos van en un archivo `.sql` dentro de `migracion/`** que corre el usuario. Nunca se ejecuta SQL desde acá.
- **El vínculo materia → inventario es por `inventario.id`.** El código no es único: `218851` tiene dos filas.
- **Cuando una materia tiene vínculo, el nombre que se muestra es el del inventario**, nunca el guardado en `cl_materias`.
- **Correr los tests con `node --test` sin argumentos.** `node --test test/` no funciona en Node 24: interpreta `test` como archivo.
- Formato de números en pantalla: `toLocaleString('es-UY')`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `cloro-calc.js` (modificar) | `proyectarStock` acepta la semana del conteo; agrega `planEnvasado`, `kgSemanal` y `cobertura`. |
| `test/cloro-calc.test.js` (modificar) | Sus tests. |
| `migracion/cloro_stock_fecha.sql` (nuevo) | Columna `fecha` en `cl_stock_inicial` y la del conteo del 08/09. |
| `migracion/cloro_materia_inventario.sql` (nuevo) | Columna `inventario_id`, único, y el vínculo de las 6 materias. |
| `migracion/cloro_carga_planilla.sql` (nuevo) | `materia_id` y `kg_mp_por_unidad` de los 13 productos. |
| `migracion/inventario_220156_unidad.sql` (nuevo) | `unidad` de `'g'` a `'Kg'` en la fila del Jacuzzi. |
| `migracion/cloro_materia_inventario_rollback.sql` (nuevo) | Vuelta atrás de los tres. |
| `cloro.html` (modificar) | Lee `inventario`, tabla de MP con stock y cobertura, avisos, y fuera la sección Productos de Configuración. |

---

### Task 1: La semana del conteo

El stock inicial se guardaba sin fecha y el módulo lo trataba como el saldo de la **semana 1**. El conteo real de la temporada 2026-2027 se hizo el **08/09/2026, que es la semana 7**, con 1.458 unidades ya vendidas en las semanas 1 a 6 e importadas desde los `.xls`. El módulo restaba esas ventas de un número que ya las tenía descontadas: mostraba −272 unidades de Pastilla Triple Acción 1 kg donde se habían contado 500, y el sugerido mandaba a envasar de nuevo lo ya vendido.

**Files:**
- Modify: `cloro-calc.js` — `proyectarStock`
- Test: `test/cloro-calc.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `Cloro.proyectarStock(opts)` acepta un `semanaBase` nuevo y **opcional** (default 1): la semana a la que corresponde el conteo, como saldo de apertura de esa semana. Las posiciones anteriores devuelven **`null`**, no cero.
  - El tipo de retorno pasa de `number[]` a `(number|null)[]`. Con `semanaBase` ausente o 1 no hay ningún null, así que todo lo que ya existe sigue funcionando igual.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `test/cloro-calc.test.js`:

```js
test('proyectarStock sin semanaBase se comporta igual que siempre', () => {
  // La compatibilidad no es un detalle: la tabla, el grafico y las fichas
  // llaman a esto sin el parametro nuevo.
  const r = Cloro.proyectarStock({
    stockInicial: 100, ventas: [30, 30, 0, 0], envasado: [0, 50, 0, 0],
    prevision: [99, 99, 20, 20], semanasCerradas: 2
  });
  assert.deepStrictEqual(r, [70, 90, 70, 50]);
});

test('proyectarStock: antes de la semana del conteo no inventa un stock', () => {
  // Si contamos en septiembre, que habia en agosto no lo sabemos. Un cero
  // ahi se leeria como "estaba vacio", que es una afirmacion que nadie hizo.
  const r = Cloro.proyectarStock({
    stockInicial: 100, ventas: [10, 10, 10, 10], envasado: [0, 0, 0, 0],
    prevision: [5, 5, 5, 5], semanasCerradas: 4, semanaBase: 3
  });
  assert.strictEqual(r[0], null);
  assert.strictEqual(r[1], null);
  assert.strictEqual(r[2], 90);   // 100 - 10
  assert.strictEqual(r[3], 80);   // 90 - 10
});

test('proyectarStock: el conteo del 8/9 no vuelve a restar lo vendido en agosto', () => {
  // El caso real que motivo esto. Cloro Granulado x 4 Kg: se contaron 11
  // unidades en la semana 7, con 16 vendidas en las semanas 1 a 6.
  const ventas    = [0, 3, 4, 2, 3, 4, 0];
  const prevision = [0, 0, 0, 0, 0, 0, 5];
  const args = { stockInicial: 11, ventas, envasado: [0,0,0,0,0,0,0],
                 prevision, semanasCerradas: 6 };
  // Sin la semana del conteo: 11 - 16 - 5 = -10, y el modulo grita
  // "FALTA ENVASAR" sobre un stock que en realidad esta bien.
  assert.strictEqual(Cloro.proyectarStock(args)[6], -10);
  // Con ella: el conteo es el saldo de apertura de la semana 7.
  const conBase = Cloro.proyectarStock(Object.assign({}, args, { semanaBase: 7 }));
  assert.strictEqual(conBase[6], 6);   // 11 - 5
  assert.strictEqual(conBase[5], null);
});

test('proyectarStock: una semanaBase de 1 es lo mismo que no ponerla', () => {
  const args = { stockInicial: 50, ventas: [10], envasado: [0], prevision: [0], semanasCerradas: 1 };
  assert.deepStrictEqual(Cloro.proyectarStock(Object.assign({}, args, { semanaBase: 1 })),
                         Cloro.proyectarStock(args));
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test`
Expected: FAIL en los dos tests de `semanaBase` — devuelven número donde se espera `null`.

- [ ] **Step 3: Implementación**

Reemplazar `proyectarStock` en `cloro-calc.js` por:

```js
  // Stock de producto terminado semana a semana. En las semanas ya
  // cerradas manda la venta REAL; en las que vienen, la prevista.
  //
  // `semanaBase` es la semana a la que corresponde el conteo del stock
  // inicial, como saldo de apertura. Por defecto 1 -el arranque de la
  // temporada-, pero un conteo hecho en septiembre NO es el stock de
  // agosto: tratarlo como tal vuelve a restar ventas que el conteo ya
  // tiene descontadas, y el modulo termina mostrando stock negativo y
  // mandando a envasar de nuevo lo que ya se vendio.
  //
  // Antes de esa semana devuelve NULL y no cero. Cero significaria
  // "estaba vacio", que es una afirmacion; null es "no lo sabemos", que
  // es la verdad.
  //
  // Puede quedar negativo y NO se recorta: un stock negativo es la senal
  // de que falta envasar, y taparlo en cero esconderia justamente lo que
  // el modulo viene a avisar.
  function proyectarStock(o) {
    var n = Math.max((o.ventas || []).length, (o.envasado || []).length, (o.prevision || []).length);
    var base = Math.max(1, parseFloat(o.semanaBase) || 1);
    var s = parseFloat(o.stockInicial) || 0, out = [], i, salida;
    for (i = 0; i < n; i++) {
      if (i < base - 1) { out.push(null); continue; }
      salida = (i < o.semanasCerradas)
        ? (parseFloat((o.ventas || [])[i]) || 0)
        : (parseFloat((o.prevision || [])[i]) || 0);
      s = s + (parseFloat((o.envasado || [])[i]) || 0) - salida;
      out.push(s);
    }
    return out;
  }
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test`
Expected: PASS, los 4 nuevos en verde y **ninguno de los 66 anteriores roto** — ese es el punto del primer test.

- [ ] **Step 5: Commit**

```bash
git add cloro-calc.js test/cloro-calc.test.js
git commit -m "Cloro: el stock inicial sabe de que semana es"
```

---

### Task 2: `planEnvasado` — la curva semanal de envasado

**Files:**
- Modify: `cloro-calc.js` (antes del `return` final, después de `sugerido`)
- Test: `test/cloro-calc.test.js`

**Interfaces:**
- Consumes: `sugerido` y `proyectarStock` **con el `semanaBase` de la Task 1**.
- Produces:
  - `Cloro.planEnvasado(opts) -> number[]` con
    `opts = {prevision: number[], stockInicial: number, ventas: number[], envasado: number[], semanasCerradas: number, semanaBase: number, desdeSemana: number, semanas: number, horizonte: number, semanasSeguridad: number, lote: number}`.
    Array de largo `semanas`; las posiciones anteriores a `desdeSemana` van en 0.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/cloro-calc.test.js`:

```js
test('planEnvasado: la primera semana del plan ES el sugerido parado ahi', () => {
  // Es la garantia de que no hay una segunda respuesta a "cuanto envasar".
  const prevision = new Array(20).fill(100);
  const args = { prevision, stockInicial: 0, ventas: [], envasado: [],
                 semanasCerradas: 0, desdeSemana: 1, semanas: 20,
                 horizonte: 8, semanasSeguridad: 2, lote: 1 };
  const plan = Cloro.planEnvasado(args);
  const solo = Cloro.sugerido({ prevision, desdeSemana: 1, horizonte: 8,
                                semanasSeguridad: 2, stockHoy: 0, lote: 1 });
  assert.strictEqual(plan[0], solo);
});

test('planEnvasado: envasa el horizonte y despues solo repone', () => {
  // sem 1: demanda 8x100=800 + colchon 2x100=200 - stock 0 = 1000
  // sem 2: ya hay 900 en stock -> 1000 - 900 = 100, y se estabiliza ahi
  const plan = Cloro.planEnvasado({
    prevision: new Array(20).fill(100), stockInicial: 0, ventas: [], envasado: [],
    semanasCerradas: 0, desdeSemana: 1, semanas: 20,
    horizonte: 8, semanasSeguridad: 2, lote: 1
  });
  assert.strictEqual(plan[0], 1000);
  assert.strictEqual(plan[1], 100);
  assert.strictEqual(plan[2], 100);
});

test('planEnvasado: las semanas ya pasadas van en cero', () => {
  const plan = Cloro.planEnvasado({
    prevision: new Array(10).fill(100), stockInicial: 0, ventas: [], envasado: [],
    semanasCerradas: 2, desdeSemana: 3, semanas: 10,
    horizonte: 4, semanasSeguridad: 0, lote: 1
  });
  assert.strictEqual(plan[0], 0);
  assert.strictEqual(plan[1], 0);
  assert.ok(plan[2] > 0);
});

test('planEnvasado: redondea al lote y por eso la semana siguiente no pide nada', () => {
  // sem 1: bruto 1000, lote 300 -> 1200. Queda stock 1100, mas que los
  // 1000 que pide la semana 2, asi que no hay que envasar.
  const plan = Cloro.planEnvasado({
    prevision: new Array(20).fill(100), stockInicial: 0, ventas: [], envasado: [],
    semanasCerradas: 0, desdeSemana: 1, semanas: 20,
    horizonte: 8, semanasSeguridad: 2, lote: 300
  });
  assert.strictEqual(plan[0], 1200);
  assert.strictEqual(plan[1], 0);
});

test('planEnvasado: una orden de envasado ya cargada evita pedirla de nuevo', () => {
  // La orden real de 1000 en la semana 1 cubre exactamente lo que haria falta.
  const envasado = new Array(20).fill(0); envasado[0] = 1000;
  const plan = Cloro.planEnvasado({
    prevision: new Array(20).fill(100), stockInicial: 0, ventas: [], envasado,
    semanasCerradas: 0, desdeSemana: 1, semanas: 20,
    horizonte: 8, semanasSeguridad: 2, lote: 1
  });
  assert.strictEqual(plan[0], 0);
});

test('planEnvasado: sin nada que vender no hay nada que envasar', () => {
  const plan = Cloro.planEnvasado({
    prevision: new Array(10).fill(0), stockInicial: 0, ventas: [], envasado: [],
    semanasCerradas: 0, desdeSemana: 1, semanas: 10,
    horizonte: 8, semanasSeguridad: 2, lote: 1
  });
  assert.deepStrictEqual(plan, new Array(10).fill(0));
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test`
Expected: FAIL — `Cloro.planEnvasado is not a function`

- [ ] **Step 3: Implementación**

En `cloro-calc.js`, justo después de la función `sugerido`:

```js
  // ─── El plan de envasado, semana a semana ──────────────────────────
  // `sugerido` contesta "cuanto envasar AHORA". Para saber hasta que
  // semana alcanza la materia prima hace falta esa misma respuesta para
  // cada semana de lo que queda de temporada.
  //
  // La regla de decision de cada semana es `sugerido`, parada en esa
  // semana con el stock proyectado de esa semana. La respuesta a "cuanto
  // envasar" sigue estando escrita UNA sola vez: es la misma formula
  // aplicada 36 veces. Escribir aca una regla nueva dejaria al modulo con
  // dos respuestas para la misma pregunta, y tarde o temprano se
  // contradicen en la pantalla.
  //
  // El resultado es despareja a proposito: se envasa en multiplos de lote
  // cuando hace falta, no un poquito por semana.
  function planEnvasado(o) {
    var semanas = Math.max(0, parseFloat(o.semanas) || 0);
    var desde = Math.max(1, o.desdeSemana || 1);
    var prevision = o.prevision || [];
    var envasado = o.envasado || [];
    var out = [], i;
    for (i = 0; i < semanas; i++) out.push(0);

    // Stock al empezar la semana `desde`: lo que proyecta el modulo con lo
    // que YA se envaso. Nada de envasado futuro inventado todavia.
    var base = proyectarStock({
      stockInicial: o.stockInicial, ventas: o.ventas, envasado: envasado,
      prevision: prevision, semanasCerradas: o.semanasCerradas,
      semanaBase: o.semanaBase
    });
    // base[desde-2] puede venir en null si el conteo del stock es de esa
    // misma semana o posterior: ahi el punto de partida ES el conteo.
    var previo = desde >= 2 ? base[desde - 2] : null;
    var stock = (previo == null) ? (parseFloat(o.stockInicial) || 0) : previo;

    for (i = desde; i <= semanas; i++) {
      // Lo que ya hay mas lo que YA esta programado envasar esa semana:
      // sin sumarlo, el plan volveria a pedir una orden que ya existe.
      var disponible = stock + (parseFloat(envasado[i - 1]) || 0);
      var env = sugerido({
        prevision: prevision, desdeSemana: i, horizonte: o.horizonte,
        semanasSeguridad: o.semanasSeguridad, stockHoy: disponible, lote: o.lote
      });
      out[i - 1] = env;
      stock = disponible + env - (parseFloat(prevision[i - 1]) || 0);
    }
    return out;
  }
```

Y agregar `planEnvasado: planEnvasado,` al objeto que devuelve el módulo.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test`
Expected: PASS. Los 6 tests nuevos en verde y ninguno de los anteriores roto.

- [ ] **Step 5: Commit**

```bash
git add cloro-calc.js test/cloro-calc.test.js
git commit -m "Cloro: plan de envasado semana a semana, con la regla del sugerido"
```

---

### Task 3: `kgSemanal` y `cobertura`

**Files:**
- Modify: `cloro-calc.js`
- Test: `test/cloro-calc.test.js`

**Interfaces:**
- Consumes: nada de la Task 2 en tiempo de ejecución (se combinan en la pantalla).
- Produces:
  - `Cloro.kgSemanal(productos, planes) -> {porMateria: {materiaId: number[]}, sinAsignar: number[]}` con
    `productos = [{id, materia_id, kg_mp_por_unidad}]` y `planes = {productoId: number[]}`.
  - `Cloro.cobertura(opts) -> {semanas: number, hastaSemana: number|null, kgTotal: number, alcanza: boolean}` con
    `opts = {kgSemana: number[], stock: number, desdeSemana: number}`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `test/cloro-calc.test.js`:

```js
test('kgSemanal suma por materia, semana a semana', () => {
  const productos = [
    { id: 1, materia_id: 7, kg_mp_por_unidad: 2 },
    { id: 2, materia_id: 7, kg_mp_por_unidad: 0.5 },
    { id: 3, materia_id: 8, kg_mp_por_unidad: 1 }
  ];
  const r = Cloro.kgSemanal(productos, { 1: [10, 20], 2: [100, 0], 3: [5, 5] });
  // materia 7 -> sem1: 10*2 + 100*0.5 = 70 ; sem2: 20*2 + 0 = 40
  assert.deepStrictEqual(r.porMateria[7], [70, 40]);
  assert.deepStrictEqual(r.porMateria[8], [5, 5]);
  assert.deepStrictEqual(r.sinAsignar, []);
});

test('kgSemanal aplica la misma regla que kgMateria para lo que no se puede calcular', () => {
  const productos = [
    { id: 1, materia_id: null, kg_mp_por_unidad: 3 },
    { id: 2, materia_id: 7,    kg_mp_por_unidad: 0 },
    { id: 3, materia_id: 7,    kg_mp_por_unidad: 1 }
  ];
  const r = Cloro.kgSemanal(productos, { 1: [10], 2: [10], 3: [10] });
  assert.deepStrictEqual(r.sinAsignar, [1, 2]);
  assert.deepStrictEqual(r.porMateria[7], [10]);
});

test('kgSemanal y kgMateria dan el mismo total', () => {
  // La serie semanal sumada tiene que dar lo mismo que la cuenta de una
  // sola vez sobre el total de unidades. Si se separan, la tabla y el
  // grafico empiezan a decir cosas distintas.
  const productos = [{ id: 1, materia_id: 7, kg_mp_por_unidad: 2 }];
  const serie = Cloro.kgSemanal(productos, { 1: [3, 4, 5] }).porMateria[7];
  const total = serie.reduce((a, x) => a + x, 0);
  assert.strictEqual(total, Cloro.kgMateria(productos, { 1: 12 }).porMateria[7]);
});

test('cobertura: el stock que alcanza para toda la temporada lo dice', () => {
  const r = Cloro.cobertura({ kgSemana: [10, 10, 10], stock: 1000, desdeSemana: 1 });
  assert.strictEqual(r.alcanza, true);
  assert.strictEqual(r.semanas, 3);
  assert.strictEqual(r.hastaSemana, 3);
});

test('cobertura: se corta en la semana en que el acumulado pasa el stock', () => {
  // 100 + 100 = 200 entra en 250 ; +100 = 300 no entra
  const r = Cloro.cobertura({ kgSemana: [100, 100, 100, 100], stock: 250, desdeSemana: 1 });
  assert.strictEqual(r.alcanza, false);
  assert.strictEqual(r.semanas, 2);
  assert.strictEqual(r.hastaSemana, 2);
  assert.strictEqual(r.kgTotal, 200);
});

test('cobertura: una semana que no se cubre entera no cuenta', () => {
  // Con 100 kg y una semana que pide 150 la respuesta es CERO semanas.
  // Media semana de cloro no envasa nada.
  const r = Cloro.cobertura({ kgSemana: [150], stock: 100, desdeSemana: 1 });
  assert.strictEqual(r.semanas, 0);
  assert.strictEqual(r.hastaSemana, null);
  assert.strictEqual(r.alcanza, false);
});

test('cobertura: sin stock no hay cobertura', () => {
  const r = Cloro.cobertura({ kgSemana: [1, 1], stock: 0, desdeSemana: 1 });
  assert.strictEqual(r.semanas, 0);
  assert.strictEqual(r.alcanza, false);
});

test('cobertura: sin consumo, el stock cero alcanza igual', () => {
  // No es un caso de laboratorio: es una materia cuyos productos no se
  // envasan en lo que queda de temporada.
  const r = Cloro.cobertura({ kgSemana: [0, 0], stock: 0, desdeSemana: 1 });
  assert.strictEqual(r.alcanza, true);
  assert.strictEqual(r.semanas, 2);
});

test('cobertura: arranca en desdeSemana y no en la semana 1', () => {
  const r = Cloro.cobertura({ kgSemana: [9999, 100, 100], stock: 250, desdeSemana: 2 });
  assert.strictEqual(r.alcanza, true);
  assert.strictEqual(r.semanas, 2);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test`
Expected: FAIL — `Cloro.kgSemanal is not a function`

- [ ] **Step 3: Implementación**

En `cloro-calc.js`, después de `kgMateria`:

```js
  // kg de materia prima semana a semana. Es `kgMateria` aplicado a una
  // serie en vez de a un total, y con la MISMA regla: un producto sin
  // materia o sin kg por unidad no se reparte a ningun lado y se lista.
  function kgSemanal(productos, planes) {
    var porMateria = {}, sinAsignar = [], semanas = 0, i;
    (productos || []).forEach(function (p) {
      var plan = (planes || {})[p.id] || [];
      if (plan.length > semanas) semanas = plan.length;
    });
    (productos || []).forEach(function (p) {
      var kgu = parseFloat(p.kg_mp_por_unidad) || 0;
      if (p.materia_id == null || kgu <= 0) { sinAsignar.push(p.id); return; }
      var plan = (planes || {})[p.id] || [];
      var acc = porMateria[p.materia_id];
      if (!acc) {
        acc = []; for (i = 0; i < semanas; i++) acc.push(0);
        porMateria[p.materia_id] = acc;
      }
      for (i = 0; i < semanas; i++) acc[i] += (parseFloat(plan[i]) || 0) * kgu;
    });
    return { porMateria: porMateria, sinAsignar: sinAsignar };
  }

  // Hasta que semana alcanza el stock de una materia prima.
  //
  // Cuenta hasta CERO, no hasta el stock minimo: el minimo es la senal de
  // reposicion y ya vive en el modulo Stock. Traerlo aca serian dos
  // umbrales para lo mismo, en dos pantallas, que se pueden mover de un
  // lado y no del otro.
  //
  // Una semana que no se cubre ENTERA no cuenta. Con 100 kg y una semana
  // que pide 150, la respuesta es cero semanas y no media: media semana
  // de cloro no envasa nada.
  function cobertura(o) {
    var kg = o.kgSemana || [];
    var desde = Math.max(1, o.desdeSemana || 1);
    var stock = parseFloat(o.stock) || 0;
    var acum = 0, semanas = 0, i, w;
    for (i = desde; i <= kg.length; i++) {
      w = parseFloat(kg[i - 1]) || 0;
      if (acum + w > stock) {
        return { semanas: semanas, hastaSemana: semanas ? i - 1 : null,
                 kgTotal: acum, alcanza: false };
      }
      acum += w; semanas++;
    }
    return { semanas: semanas, hastaSemana: semanas ? kg.length : null,
             kgTotal: acum, alcanza: true };
  }
```

Y agregar `kgSemanal: kgSemanal,` y `cobertura: cobertura` al objeto devuelto.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test`
Expected: PASS, los 9 tests nuevos en verde.

- [ ] **Step 5: Commit**

```bash
git add cloro-calc.js test/cloro-calc.test.js
git commit -m "Cloro: kg de materia prima por semana y cobertura en semanas"
```

---

### Task 4: El SQL

**Files:**
- Create: `migracion/cloro_stock_fecha.sql`
- Create: `migracion/cloro_materia_inventario.sql`
- Create: `migracion/cloro_carga_planilla.sql`
- Create: `migracion/inventario_220156_unidad.sql`
- Create: `migracion/cloro_materia_inventario_rollback.sql`

**Interfaces:**
- Consumes: las tablas `cl_materias`, `cl_productos`, `cl_stock_inicial` e `inventario`, que ya existen.
- Produces: `cl_stock_inicial.fecha`; `cl_materias.inventario_id`; las 6 materias vinculadas; los 13 productos con `materia_id` y `kg_mp_por_unidad`.

- [ ] **Step 0: La fecha del conteo**

Crear `migracion/cloro_stock_fecha.sql`:

```sql
-- ============================================================
--  PREVISION CLORO  ·  el stock inicial pasa a saber de que dia es
--
--  `cl_stock_inicial` se guardaba sin fecha y el modulo lo trataba como
--  el saldo de la semana 1 de la temporada. El conteo real de 2026-2027
--  se hizo el 08/09/2026 -semana 7-, con 1.458 unidades ya vendidas en
--  las semanas 1 a 6 e importadas del ERP.
--
--  Restar esas ventas de un conteo que YA las tiene descontadas las
--  cuenta dos veces: la pantalla mostraba -272 unidades de Pastilla
--  Triple Accion x 1 kg donde se habian contado 500, y el sugerido
--  mandaba a envasar de nuevo lo que ya se habia vendido.
--
--  La fecha va por fila y no por temporada: un reconteo de un solo
--  producto tiene que poder representarse sin mentir sobre los otros
--  doce. La pantalla las escribe todas juntas desde un unico campo.
-- ============================================================

alter table public.cl_stock_inicial
  add column if not exists fecha date;

-- El conteo que ya esta cargado, de la temporada activa.
update public.cl_stock_inicial
   set fecha = date '2026-09-08'
 where fecha is null
   and temporada_id = (select id from public.cl_temporadas where nombre = '2026-2027');

-- Control: no tiene que quedar ninguna fila de esa temporada sin fecha.
-- Una fila sin fecha vuelve al comportamiento viejo -se asume semana 1- y
-- ese es exactamente el error que esto viene a sacar.
select t.nombre, count(*) as filas, count(s.fecha) as con_fecha, min(s.fecha) as fecha
  from public.cl_stock_inicial s
  join public.cl_temporadas t on t.id = s.temporada_id
 group by t.nombre order by t.nombre;
```

- [ ] **Step 1: El vínculo**

Crear `migracion/cloro_materia_inventario.sql`:

```sql
-- ============================================================
--  PREVISION CLORO  ·  colgar las materias primas del inventario real
--
--  Las materias primas del modulo eran una lista propia de cinco nombres
--  puestos a mano al crearlo, sin stock y sin cruce con nada. El stock
--  real ya vive en `inventario`, marcado con ext_id='MP'.
--
--  EL VINCULO ES POR ID, NO POR CODIGO. El codigo 218851 tiene DOS filas
--  en inventario ("Pastilla Triple Accion" y "Pastilla Triple Accion
--  (3 unidades)"), asi que un join por codigo devolveria dos y contaria
--  el stock dos veces.
--
--  Correr ANTES de cloro_carga_planilla.sql.
-- ============================================================

-- 1) La columna, con unico: dos materias colgadas del mismo articulo
--    contarian su stock dos veces y las dos dirian que estan cubiertas.
alter table public.cl_materias
  add column if not exists inventario_id bigint
  references public.inventario(id) on delete set null;

create unique index if not exists ux_cl_materias_inventario
  on public.cl_materias(inventario_id) where inventario_id is not null;

-- 2) Las dos materias inventadas que SI tienen contraparte real. Se
--    reutilizan en vez de crearse de nuevo: la fila del carbonato es la
--    unica que ya tenia un producto asignado (Regulador PH MAS), y
--    borrarla lo dejaria huerfano.
update public.cl_materias
   set nombre = 'Ceniza de soda (PH+)',
       inventario_id = (select id from public.inventario
                         where codigo = '220043' and ext_id = 'MP')
 where nombre = 'Carbonato de sodio (pH+)';

update public.cl_materias
   set nombre = 'Metabisulfito ( PH-)',
       inventario_id = (select id from public.inventario
                         where codigo = '220111' and ext_id = 'MP')
 where nombre = 'Bisulfato de sodio (pH-)';

-- 3) Las tres que no existen en el inventario con ese nombre. Se
--    DESACTIVAN, no se borran: ningun producto las referencia, pero
--    desactivar es reversible y borrar no.
update public.cl_materias set activo = false
 where nombre in ('Dicloro', 'Tricloro', 'Hipoclorito de calcio');

-- 4) Las cuatro que faltan, ya vinculadas. Para la Pastilla Triple
--    Accion se desempata por descripcion exacta: es la fila que tiene el
--    stock cargado (2.275 kg), no la de "(3 unidades)", que esta vacia.
insert into public.cl_materias (nombre, inventario_id)
select i.descripcion, i.id
  from public.inventario i
 where i.ext_id = 'MP'
   and (i.codigo, i.descripcion) in (
        ('334101',   'Cloro Granulado'),
        ('21550000', 'Cloro Shock'),
        ('218851',   'Pastilla Triple Accion'),
        ('220156',   'Pastillas Cloro JACUZZI 50 Grs'))
   and not exists (select 1 from public.cl_materias m where m.inventario_id = i.id);

-- 5) Control que FALLA si algo no resolvio. Un vinculo que quedo en null
--    sin que nadie se entere es una materia que dice "sin stock" para
--    siempre.
do $$
declare n int;
begin
  select count(*) into n from public.cl_materias where activo and inventario_id is null;
  if n > 0 then
    raise exception 'Quedaron % materias activas sin vincular al inventario', n;
  end if;
  select count(*) into n from public.cl_materias where activo;
  if n <> 6 then
    raise exception 'Se esperaban 6 materias activas y hay %', n;
  end if;
end $$;

-- 6) Como quedaron
select m.id, m.nombre, i.codigo, i.descripcion, i.unidad, i.inventario as stock
  from public.cl_materias m
  left join public.inventario i on i.id = m.inventario_id
 where m.activo
 order by m.nombre;
```

- [ ] **Step 2: La carga de la planilla**

Crear `migracion/cloro_carga_planilla.sql`:

```sql
-- ============================================================
--  PREVISION CLORO  ·  materia prima y kg por unidad de los 13 productos
--
--  Sale de la planilla que aporto el usuario (Planilla.xlsx). TRES
--  valores NO son los que traia la planilla; se corrigieron con el antes
--  de cargarlos:
--
--   · 2150950 para el Cloro Shock 900 g. La planilla decia 215050, que
--     no existe. El nombre coincide exacto y el patron de los hermanos
--     lo confirma (2150250 = 240 g).
--   · 220156 para la Pastilla Jacuzzi. La planilla decia 220176, que no
--     esta en el inventario.
--   · 0,25 kg para la Pastilla Jacuzzi, no 0,125: son 5 pastillas de
--     50 g. Con 0,125 el modulo habria pedido la mitad de la materia
--     prima necesaria.
--
--  Correr DESPUES de cloro_materia_inventario.sql.
-- ============================================================

update public.cl_productos p
   set kg_mp_por_unidad = v.kgu,
       materia_id       = m.id
  from (values
         ('21420',   4.0,   '334101'),
         ('21421',   25.0,  '334101'),
         ('2150250', 0.24,  '21550000'),
         ('2150950', 0.9,   '21550000'),
         ('2153500', 3.5,   '21550000'),
         ('218801',  1.0,   '218851'),
         ('218803',  0.6,   '218851'),
         ('218804',  4.0,   '218851'),
         ('218825',  25.0,  '218851'),
         ('218905',  0.25,  '220156'),
         ('219727',  2.0,   '220043'),
         ('219729',  4.0,   '220111'),
         ('230137',  25.0,  '21550000')
       ) as v(codigo, kgu, cod_mp)
  join public.inventario  i on i.codigo = v.cod_mp and i.ext_id = 'MP'
  join public.cl_materias m on m.inventario_id = i.id
 where p.codigo = v.codigo;

-- El join contra cl_materias.inventario_id es lo que desempata el
-- 218851 duplicado: de sus dos filas de inventario, solo una tiene una
-- materia colgada, asi que la otra se cae sola.

do $$
declare n int;
begin
  select count(*) into n from public.cl_productos
   where activo and (materia_id is null or coalesce(kg_mp_por_unidad,0) <= 0);
  if n > 0 then
    raise exception 'Quedaron % productos activos sin materia prima o sin kg por unidad', n;
  end if;
end $$;

select p.codigo, p.nombre, p.kg_mp_por_unidad, m.nombre as materia,
       i.codigo as cod_mp, i.inventario as stock_mp
  from public.cl_productos p
  left join public.cl_materias m on m.id = p.materia_id
  left join public.inventario  i on i.id = m.inventario_id
 order by p.codigo;
```

- [ ] **Step 3: La unidad del Jacuzzi**

Crear `migracion/inventario_220156_unidad.sql`:

```sql
-- La fila 220156 "Pastillas Cloro JACUZZI 50 Grs" tiene unidad 'g' y son
-- 132 KG, no 132 gramos. Lo confirmo el usuario: la descripcion habla del
-- tamano de la pastilla, la materia prima entra en kilos.
--
-- En el modulo Stock `unidad` es solo una etiqueta que se concatena al
-- numero formateado -se verifico: no entra en ninguna cuenta-, asi que
-- corregirla es inocuo alla y necesario en Prevision Cloro, donde todo se
-- suma en kg.
update public.inventario set unidad = 'Kg'
 where codigo = '220156' and unidad = 'g';

select codigo, descripcion, unidad, inventario
  from public.inventario where codigo = '220156';
```

- [ ] **Step 4: El rollback**

Crear `migracion/cloro_materia_inventario_rollback.sql`:

```sql
-- Vuelve el modulo a su lista propia de materias primas.
--
-- Los kg por unidad de los productos NO se borran: son un dato bueno que
-- no depende del vinculo, y volver a ponerlos en cero seria perder
-- trabajo por nada.
delete from public.cl_materias
 where inventario_id is not null
   and nombre in ('Cloro Granulado', 'Cloro Shock', 'Pastilla Triple Accion',
                  'Pastillas Cloro JACUZZI 50 Grs');

update public.cl_materias set nombre = 'Carbonato de sodio (pH+)', inventario_id = null
 where nombre = 'Ceniza de soda (PH+)';
update public.cl_materias set nombre = 'Bisulfato de sodio (pH-)', inventario_id = null
 where nombre = 'Metabisulfito ( PH-)';
update public.cl_materias set activo = true
 where nombre in ('Dicloro', 'Tricloro', 'Hipoclorito de calcio');

drop index if exists public.ux_cl_materias_inventario;
alter table public.cl_materias drop column if exists inventario_id;

update public.inventario set unidad = 'g' where codigo = '220156' and unidad = 'Kg';

-- La fecha del conteo se va con la columna. Ojo: sin ella el modulo
-- vuelve a suponer que el stock es de la semana 1, que es el bug que
-- motivo todo esto.
alter table public.cl_stock_inicial drop column if exists fecha;

select m.id, m.nombre, m.activo from public.cl_materias m order by m.id;
```

- [ ] **Step 5: Releer los cuatro archivos buscando errores de sintaxis**

No se ejecutan desde acá. Verificación: releer entero cada archivo buscando comas colgantes, paréntesis sin cerrar en la lista de `values`, y que **los 13 códigos de producto de `cloro_carga_planilla.sql` sean exactamente los 13 de `cl_productos`** (`21420, 21421, 2150250, 2150950, 2153500, 218801, 218803, 218804, 218825, 218905, 219727, 219729, 230137`). Un código mal escrito no falla: simplemente no actualiza esa fila, y el control del final la caza.

- [ ] **Step 6: Commit**

```bash
git add migracion/cloro_materia_inventario.sql migracion/cloro_carga_planilla.sql \
        migracion/inventario_220156_unidad.sql migracion/cloro_materia_inventario_rollback.sql
git commit -m "Cloro: SQL para colgar las materias primas del inventario y cargar la planilla"
```

- [ ] **Step 7: Pedirle al usuario que los corra**

Decirle que corra, **en este orden**: `cloro_stock_fecha.sql`, `cloro_materia_inventario.sql`, `cloro_carga_planilla.sql`, `inventario_220156_unidad.sql`. Esperar confirmación y **verificar leyendo la base desde el navegador** que las 13 filas de stock inicial quedaron con fecha 2026-09-08, que las 6 materias resuelven a las filas de inventario esperadas y que los 13 productos quedaron con su materia y sus kg.

---

### Task 5: La pantalla lee el inventario y muestra la cobertura

**Files:**
- Modify: `cloro.html` — `<thead>` de la tabla de MP en `cloro.html:505-511`, `cargar()` en `cloro.html:789`, `pintarMP()` en `cloro.html:1494`, `pintarAvisos()` en `cloro.html:1319`

**Interfaces:**
- Consumes: `Cloro.planEnvasado` (Task 2), `Cloro.kgSemanal` y `Cloro.cobertura` (Task 3), y las columnas de la Task 4.
- Produces: las variables globales `INV` y las funciones `matInv(m)`, `matNombre(m)`, `planPorProducto()`, `coberturaPorMateria()`.

- [ ] **Step 1: Leer el inventario en la carga**

En `cloro.html`, junto a las otras globales (`var TEMPS=[], PROD=[], MAT=[], ...`), agregar `INV=[]`.

En `cargar()`, agregar la cuarta consulta al `Promise.all`:

```js
    SB.from('inventario').select('id,codigo,descripcion,unidad,inventario,pendiente_entrega,updated_at').eq('ext_id','MP')
```

y en el `then`, `INV=r[3].data||[];`.

Nota: la materia prima se lee **entera y siempre**, no sólo las 6 vinculadas. Son 79 filas y así la sección de Configuración puede ofrecer las que todavía no están colgadas de ninguna materia.

- [ ] **Step 2: La fecha del conteo llega hasta el cálculo**

Hasta acá el arreglo de la Task 1 no se ve en la pantalla: `filas()` sigue llamando a `proyectarStock` sin `semanaBase`. **Éste es el step que apaga el bug.**

En `cloro.html:682`, agregar `STOCK0F={}` a las globales — la cantidad y la fecha se guardan aparte para no tocar los cuatro lugares que ya leen `STOCK0` como un número.

En `cargarTemporada()`, `cloro.html:840`, junto al armado de `STOCK0`:

```js
    STOCK0={}; STOCK0F={};
    (r[2].data||[]).forEach(function(x){
      STOCK0[x.producto_id]=num(x.cantidad);
      if(x.fecha) STOCK0F[x.producto_id]=x.fecha;
    });
```

Agregar el ayudante, cerca de `hayBaseDe`:

```js
// La semana de temporada a la que corresponde el conteo de stock de un
// producto. Sin fecha cae en 1, que es como se comportaba el modulo
// antes: un conteo viejo sin fecha no se puede reinterpretar solo.
// Se acota a la temporada porque una fecha de otra temporada -o un dedo
// en el campo- mandaria el arranque fuera del rango dibujado y el stock
// desapareceria entero de la pantalla.
function semanaDelConteo(prodId){
  var t=temporadaActual(), f=STOCK0F[prodId];
  if(!t || !f) return 1;
  return Math.min(Math.max(Cloro.semanaDe(new Date(f+'T00:00:00Z'), dIni(t)), 1), NSEM);
}
```

Y en `filas()`, `cloro.html:919`, pasarle la semana a `proyectarStock`:

```js
        ? Cloro.proyectarStock({stockInicial:(STOCK0[p.id]||0), ventas:vAct,
                                envasado:env, prevision:prevision,
                                semanasCerradas:cerradas,
                                semanaBase:semanaDelConteo(p.id)})
```

`proyectarStock` ahora puede devolver `null` en las semanas anteriores al conteo. Verificar que todo lo que consume esa serie lo tolere: `f.stockHoy` ya se compara con `!=null` en la tabla y en las fichas, y `tot.s+=num(f.stockHoy)` convierte null en 0. El gráfico de temporada, si dibuja la serie de stock, tiene que **cortar la línea** en los null y no dibujarlos como cero.

- [ ] **Step 3: Los ayudantes de materia prima**

Agregar cerca de `kgDe`, antes de `// ══ LAS FILAS ══`:

```js
// La fila de inventario a la que esta colgada una materia, o null.
function matInv(m){
  if(!m || m.inventario_id==null) return null;
  return INV.filter(function(x){ return x.id===m.inventario_id; })[0] || null;
}
// El nombre de una materia es SIEMPRE el del inventario cuando hay
// vinculo. El `nombre` guardado es solo el respaldo de una materia
// todavia sin colgar: si se mostrara el guardado, el mismo articulo
// tendria dos nombres que se van separando solos.
function matNombre(m){
  var i=matInv(m);
  return (i && i.descripcion) ? i.descripcion : (m?m.nombre:'?');
}
// El plan de envasado de cada producto, de la semana actual al final de
// la temporada. Devuelve {} si no hay con que calcularlo.
function planPorProducto(){
  var t=temporadaActual(); if(!t || !PAR) return {};
  var out={};
  filas().forEach(function(f){
    if(!f.prevision || !hayBaseDe(f.prod.id)) return;
    out[f.prod.id] = Cloro.planEnvasado({
      prevision: f.prevision,
      stockInicial: (STOCK0[f.prod.id]||0),
      ventas: f.vAct,
      envasado: envasadoPorSemana(t, f.prod.id),
      semanasCerradas: Math.max(0, SEM_ACTUAL-1),
      semanaBase: semanaDelConteo(f.prod.id),
      desdeSemana: SEM_ACTUAL, semanas: NSEM,
      horizonte: num(PAR.horizonte_semanas),
      semanasSeguridad: num(PAR.semanas_seguridad),
      lote: num(f.prod.lote_unidades)||1
    });
  });
  return out;
}
// La cobertura de cada materia: {materiaId: resultado de Cloro.cobertura}.
function coberturaPorMateria(){
  var planes=planPorProducto();
  if(!Object.keys(planes).length) return {};
  var activos=PROD.filter(function(p){ return p.activo!==false; });
  var kgs=Cloro.kgSemanal(activos, planes).porMateria;
  var out={};
  MAT.forEach(function(m){
    var inv=matInv(m); if(!inv) return;          // sin vinculo no hay stock
    out[m.id]=Cloro.cobertura({
      kgSemana: kgs[m.id]||[], stock: num(inv.inventario), desdeSemana: SEM_ACTUAL
    });
  });
  return out;
}
```

- [ ] **Step 4: Las columnas nuevas**

En `cloro.html:505-511`, reemplazar el `<thead>` de la tabla de materia prima por:

```html
        <thead>
          <tr>
            <th class="l">Materia prima</th>
            <th class="l">Productos</th>
            <th class="out">kg del horizonte</th>
            <th>Stock</th>
            <th>Cobertura</th>
          </tr>
        </thead>
```

Y en `pintarMP()`, dentro del `forEach` de materias, reemplazar el `h+=` por:

```js
    var inv=matInv(m), cob=COB[m.id];
    // `updated_at` es un timestamptz completo y fechaCorta parte por
    // guiones: sin el slice devolveria "07T16:54:07.317+00:00/09/2026".
    var pend = inv ? num(inv.pendiente_entrega) : 0;
    var stTxt = inv
      ? n0(inv.inventario)+' kg'
        +'<span class="upd">al '+fechaCorta(String(inv.updated_at).slice(0,10))
        // El pendiente NO suma a la cobertura -es una promesa de un
        // proveedor, no stock- pero se muestra para que no parezca olvidado.
        +(pend>0 ? ' · +'+n0(pend)+' en camino' : '')+'</span>'
      : '<span class="calc">sin vincular</span>';
    var cbTxt;
    if(!inv)             cbTxt='<span class="calc">sin vincular</span>';
    else if(!cob)        cbTxt='<span class="calc">—</span>';
    else if(cob.alcanza) cbTxt='cubre la temporada';
    else {
      var flojo = cob.semanas < horiz;
      cbTxt = n0(cob.semanas)+' sem'
        +'<span class="cob'+(flojo?' bajo':'')+'">'
        +(cob.semanas===0 ? 'no alcanza' : 'hasta la semana '+cob.hastaSemana)+'</span>';
    }
    h+='<tr><td class="l" style="font-weight:600">'+esc(matNombre(m))
      +(inv?'<span class="cod">'+esc(inv.codigo)+'</span>':'')+'</td>'
      +'<td class="l calc" style="font-family:\'DM Sans\',sans-serif">'
        +(prods.length? prods.map(function(p){ return esc(p.nombre); }).join(' · ') : '—')+'</td>'
      +'<td class="kgmp">'+n0(kg)+'</td>'
      +'<td>'+stTxt+'</td>'
      +'<td>'+cbTxt+'</td></tr>';
```

Al principio de `pintarMP()`, agregar:

```js
  var COB=coberturaPorMateria();
  // PAR puede no estar todavia; sin horizonte no hay con que decidir si
  // una cobertura es corta, y 0 nunca marca nada en rojo.
  var horiz = PAR ? num(PAR.horizonte_semanas) : 0;
```

Se reusan `.cob` y `.cob.bajo`, que son las clases que la tabla principal ya usa para las semanas de cobertura del stock — misma idea, mismo vocabulario visual. Ajustar los `colspan` de las filas de "Sin asignar", vacío y TOTAL de 3 a 5.

Agregar una sola regla CSS junto a `.cod` (`cloro.html:117`):

```css
.upd{display:block;font-family:var(--mono);font-size:9.5px;color:var(--muted);margin-top:2px}
```

- [ ] **Step 5: El aviso de por qué no hay cobertura**

En `pintarAvisos()`, después del aviso de `sinBase`, agregar:

```js
  var sinVinc = MAT.filter(function(m){ return m.activo!==false && m.inventario_id==null; });
  if(sinVinc.length){
    a.push({t:'temp', txt:'<b>'+sinVinc.length+' materia'+(sinVinc.length===1?'':'s')
      +' prima'+(sinVinc.length===1?'':'s')+' sin vincular al inventario</b>: '
      +sinVinc.map(function(m){ return esc(m.nombre); }).join(' · ')
      +'. Su stock y su cobertura no se pueden calcular — el stock real vive en el módulo '
      +'Stock y hay que decirle a cuál artículo corresponde cada una.'});
  }
```

El aviso de stock inicial que ya existe (`sinBase`) es el que explica por qué la cobertura va en `—`; agregarle al final del texto: `' Sin eso tampoco hay cobertura de materia prima.'`

- [ ] **Step 6: Verificar que los `<script>` inline parsean**

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('cloro.html','utf8');
const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m,p=[],n=0; while((m=re.exec(h))){n++;p.push('// bloque '+n+'\n'+m[1]);}
fs.writeFileSync(process.env.TEMP+'/cloro_inline.js',p.join('\n'));
console.log('bloques:',n);
" && node --check "$TEMP/cloro_inline.js" && echo "inline OK"
```
Expected: `bloques: 2` e `inline OK`.

- [ ] **Step 7: Commit**

```bash
git add cloro.html && git commit -m "Cloro: stock real y cobertura en semanas por materia prima"
```

---

### Task 6: Configuración pierde la sección Productos

**Files:**
- Modify: `cloro.html` — HTML de la sección 4 en `cloro.html:573-580`, la sección 3 en `cloro.html:563-571`, `pintarConfig()` en `cloro.html:1533`, `guardarConfig()` en `cloro.html:1715`, `crearMateria()` en `cloro.html:1698`, y el CSS de `.cf-prods`/`.cf-ph`/`.cf-pr` en `cloro.html:204-221`

**Interfaces:**
- Consumes: `matInv`, `matNombre` (Task 5).
- Produces: nada nuevo. **Elimina** `crearMateria()` en su forma actual y las clases `.cf-prods`, `.cf-ph`, `.cf-pr`.

- [ ] **Step 1: Sacar el HTML de la sección Productos**

Borrar el bloque completo `cloro.html:573-580` (`<div class="cf">` con `<span class="cf-n">4</span><h4>Productos</h4>` hasta su `</div>`) y renumerar la sección siguiente de `5` a `4` (el `<span class="cf-n">5</span>` de Stock inicial).

- [ ] **Step 2: Vincular en vez de escribir un nombre libre**

La sección 3 hoy da de alta materias primas escribiendo un nombre suelto, que con el modelo nuevo nace sin stock y sin cobertura. Reemplazar el `<div class="cf-add">` de `cloro.html:566-570` por un select de artículos de materia prima del inventario todavía no vinculados:

```html
        <div class="cf-add">
          <div class="fg" style="grid-column:span 2"><label>Vincular un artículo del inventario</label>
            <select class="inp" id="nm-inv"></select></div>
          <div class="fg"><button class="btn" style="width:100%" onclick="crearMateria()">➕ Agregar</button></div>
        </div>
```

Y en `pintarConfig()`, donde hoy se limpia `nm-nom`, poblar el select con los artículos libres:

```js
  // Solo los articulos de materia prima que no estan colgados de ninguna
  // materia: ofrecer uno ya vinculado crearia el duplicado que el indice
  // unico rechaza, con un error feo en vez de una opcion que no aparece.
  var usados={}; MAT.forEach(function(m){ if(m.inventario_id!=null) usados[m.inventario_id]=1; });
  document.getElementById('nm-inv').innerHTML =
    '<option value="">— elegí un artículo —</option>'
    + INV.filter(function(i){ return !usados[i.id]; })
         .sort(function(a,b){ return String(a.descripcion||'').localeCompare(String(b.descripcion||'')); })
         .map(function(i){ return '<option value="'+i.id+'">'+esc(i.descripcion)
              +' · '+esc(i.codigo)+'</option>'; }).join('');
```

Reemplazar `crearMateria()` entero por:

```js
function crearMateria(){
  var sel=document.getElementById('nm-inv');
  var id=parseInt(sel.value,10);
  if(!id){ toast('Elegí un artículo del inventario','err'); return; }
  var inv=INV.filter(function(x){ return x.id===id; })[0];
  if(!inv){ toast('Ese artículo ya no está en el inventario','err'); return; }
  SB.from('cl_materias').insert({nombre:inv.descripcion, inventario_id:id}).select().then(function(r){
    if(r.error) throw r.error;
    if(!r.data || !r.data.length) throw new Error('la base no devolvió la fila (¿permiso del módulo?)');
    MAT.push(r.data[0]);
    toast('Materia prima vinculada','ok');
    pintarConfig(); pintarTodo();
  }).catch(function(e){
    toast('No se pudo vincular: '+((e&&e.message)||e),'err');
  });
}
```

- [ ] **Step 3: Mostrar el vínculo y el stock en la lista de materias**

En `pintarConfig()`, en el bloque que arma `cf-mats`, mostrar de dónde sale el stock. Reemplazar el `<small>` de cada fila por:

```js
      +'<small>'+(n? n+' producto'+(n===1?'':'s') : 'sin productos')
        +(matInv(m) ? ' · '+esc(matInv(m).codigo)+' · '+n0(matInv(m).inventario)+' kg'
                    : ' · <b>sin vincular</b>')+'</small>'
```

y usar `matNombre(m)` en lugar de `m.nombre` para el título de la fila.

- [ ] **Step 4: Sacar los productos de `guardarConfig()`**

En `guardarConfig()`, borrar el bloque que recorre `#cf-prods .cf-pr` y arma los `ops` de `cl_productos` (el `document.querySelectorAll('#cf-prods .cf-pr').forEach(...)` completo). **Ésta es la última escritura del módulo sobre `cl_productos`**: después de esto, Previsión Cloro lee ese maestro y no lo toca nunca.

Borrar también el bloque de `pintarConfig()` que arma `#cf-prods` y `#cf-aviso`, y las reglas CSS `.cf-prods`, `.cf-ph`, `.cf-pr` y sus derivadas de `cloro.html:204-221`.

- [ ] **Step 5: La fecha del conteo, en la sección de Stock inicial**

Sin esto la columna `fecha` sólo se puede escribir por SQL y el próximo conteo repite el bug.

En el HTML de la sección de Stock inicial, arriba de la lista de productos:

```html
        <div class="fg" style="max-width:230px;margin-bottom:10px">
          <label>Estos números son al</label>
          <input class="inp" id="cf-s0-fecha" type="date"/>
        </div>
```

En `pintarConfig()`, precargarlo con la fecha que ya tienen las filas, o con hoy si no hay ninguna:

```js
  // Se toma la primera fecha cargada: hoy son todas la misma porque se
  // escriben juntas. Si mañana hay un reconteo de un solo producto, esto
  // muestra la mas vieja y el guardado las vuelve a igualar, que es
  // exactamente lo que hace un conteo nuevo.
  var f0=null;
  PROD.forEach(function(p){ var f=STOCK0F[p.id]; if(f && (!f0 || f<f0)) f0=f; });
  document.getElementById('cf-s0-fecha').value = f0 || hoyISO();
```

Si no existe `hoyISO()`, agregarlo junto a `fechaCorta`:

```js
function hoyISO(){
  var d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')
        +'-'+String(d.getDate()).padStart(2,'0');
}
```

En `guardarConfig()`, en el `upsert` de `cl_stock_inicial`, agregar `fecha` a cada fila. Validar **antes de guardar** y no guardar si falla:

```js
  var fCont=document.getElementById('cf-s0-fecha').value;
  // Una fecha fuera de la temporada mandaria el arranque del calculo a
  // una semana que la pantalla no dibuja, y el stock desapareceria
  // entero sin decir por que.
  if(s0.length && (!fCont || fCont < t.fecha_ini || fCont > t.fecha_fin)){
    toast('La fecha del conteo tiene que caer dentro de la temporada','err'); return;
  }
```

y en cada fila del upsert: `fecha: fCont`.

**El `fecha` se escribe sólo en las filas que se están guardando.** Un renglón vacío se sigue salteando, igual que hoy: vacío es "no lo sé" y cero es "arrancó en cero", y esa distinción no la cambia esta fecha.

- [ ] **Step 6: Verificar que no quedaron referencias colgadas**

```bash
grep -n "cf-prods\|cf-merma\|cf-kg\|cf-mat\b\|cf-lote\|nm-nom\|cf-aviso" cloro.html
```
Expected: **sin resultados**. Cualquier línea que aparezca es un `querySelector` que va a devolver null en tiempo de ejecución.

Y la verificación de sintaxis inline de la Task 5, Step 5. Expected: `inline OK`.

- [ ] **Step 7: Commit**

```bash
git add cloro.html
git commit -m "Cloro: la materia prima de cada producto deja de ser configuracion"
```

---

### Task 7: Verificación contra la base y publicación

**Files:**
- Modify: ninguno salvo que aparezca un error.

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Todos los tests**

Run: `node --test`
Expected: PASS, 85 tests — los 66 de antes más los 4 de `semanaBase`, los 6 de `planEnvasado` y los 9 de `kgSemanal`/`cobertura`.

- [ ] **Step 2: Publicar**

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File bump-version.ps1
git add -A && git commit -m "Version" && git push origin main
```

Esperar a que GitHub Pages sirva la versión nueva antes de mirar nada: comprobar que `APP_VER` de `cloro.html` publicado coincide con el que escribió `bump-version.ps1`.

- [ ] **Step 3: Verificar contra la base, desde el navegador**

Con la temporada 2025-2026 seleccionada (es la que tiene ventas):

- Las 6 materias resuelven a las filas de inventario esperadas: `334101→48`, `21550000→49`, `218851→107`, `220156→110`, `220043→42`, `220111→100`.
- Los 13 productos tienen materia y kg por unidad; **ninguno queda en "sin asignar"**.
- El stock que muestra la pantalla para cada materia es **el mismo número** que muestra el módulo Stock para ese artículo. Si no coincide, el vínculo está mal y todo lo demás miente.
- La fila 220156 muestra `132 kg`, no `132 g`.

- [ ] **Step 4: La cobertura, de punta a punta y a mano**

Cargar el stock inicial de **un solo producto** en Configuración → Stock inicial. Después comprobar, en la consola del navegador, que la cobertura de su materia coincide con acumular la curva a mano:

```js
var m = MAT.filter(function(x){ return x.activo!==false && x.inventario_id!=null; })[0];
var kgs = Cloro.kgSemanal(PROD.filter(function(p){return p.activo!==false;}), planPorProducto()).porMateria[m.id];
var stock = matInv(m).inventario, acum = 0, sem = 0;
for (var i = SEM_ACTUAL; i <= kgs.length; i++) {
  if (acum + kgs[i-1] > stock) break;
  acum += kgs[i-1]; sem++;
}
console.log('a mano:', sem, ' modulo:', coberturaPorMateria()[m.id].semanas);
```
Expected: los dos números iguales.

Después **revertir el stock inicial cargado** para no dejar dato de prueba en la base.

- [ ] **Step 5: Que Configuración no haya quedado rota**

Abrir Configuración y comprobar: cuatro secciones numeradas 1 a 4, sin lista de productos, el select de artículos ofrece sólo los no vinculados, y **guardar los parámetros sigue funcionando** — cambiar el horizonte, guardar, confirmar contra la base que cambió, y volverlo atrás. Un update bloqueado por RLS vuelve con cero filas y sin error, así que sin este chequeo la pantalla diría "guardado" sin haber guardado.

- [ ] **Step 6: Anotar los desvíos en el plan y commitear**

Agregar al final de este archivo una sección "Desvíos al ejecutar" con lo que haya cambiado respecto de lo planeado y por qué, y una sección "Verificaciones hechas" con los números concretos que se comprobaron.

```bash
git add docs/superpowers/plans/2026-09-09-cloro-materia-prima-inventario.md
git commit -m "Plan: anotar los desvios y las verificaciones de la materia prima vinculada"
```

---

## Desvíos al ejecutar

1. **La Task 1 no estaba en el plan original.** Apareció cuando el usuario avisó que el conteo de stock era al 08/09. Todas las tasks se corrieron un número.

2. **La cobertura medía la cosa equivocada, y se publicó así** (Task 5). El plan decía calcularla sobre `planEnvasado` con el horizonte y el colchón de los parámetros. Eso es una **orden de compra** —"envasá ahora las próximas 8 semanas más 2 de colchón"—, así que concentra diez semanas de demanda en la primera y el acumulado se pasa del stock en el paso uno: **las seis materias daban "0 semanas", con 3.300 kg de Cloro Shock en el depósito**. Lo que hay que medir es el ritmo justo a tiempo, y no hizo falta fórmula nueva: es el mismo `sugerido` con `horizonte: 1` y `semanasSeguridad: 0`. `planPorProducto` pasó a llamarse `planConsumo` y dos tests nuevos fijan la diferencia con la misma entrada.

3. **Las clases `.cf-prods`, `.cf-ph` y `.cf-pr` NO se borraron** (Task 6). El plan decía sacarlas con la sección Productos, pero las usan también el stock inicial y la lista de órdenes de envasado, las dos con su propio `grid-template-columns` inline. Sí quedó muerto el `grid-template-columns` por defecto de `.cf-ph,.cf-pr` y se sacó.

4. **`stockHoy` puede venir en `null`** (Task 5). No estaba previsto: son las semanas anteriores al conteo. `Cloro.sugerido` habría tratado ese null como cero —"no hay nada"— y mandado a envasar de más, así que sin `stockHoy` no hay sugerido.

5. **`pintarCfAviso` y su listener se fueron con la sección Productos** (Task 6). Sólo servían para pintar en rojo los productos sin materia prima dentro de ese bloque.

6. Un test extra en la Task 2 (`planEnvasado` arrancando del conteo cuando la semana anterior viene en `null`): es la costura entre las tasks 1 y 2 y no había otra forma de fijarla.

## Verificaciones hechas

- **88 tests** de `node --test` en verde, 22 más que al empezar.
- Contra la base, después de correr el SQL: **6 materias activas**, las 6 vinculadas y en Kg (`334101→48`, `21550000→49`, `218851→107`, `220156→110`, `220043→42`, `220111→100`); 3 desactivadas; **13 productos con materia y kg**, ninguno sin asignar; **13 filas de stock inicial con fecha 2026-09-08**, ninguna sin fecha.
- **El bug del conteo, medido antes y después** en la pantalla publicada: Pastilla Triple Acción 1 kg pasó de **−272 a 215** sobre 500 contadas; Cloro Shock 240 g de **−73 a 69** sobre 120; Cloro Shock 3,5 Kg de −121 a −15; Cloro Granulado 4 Kg de −11 a 5. Los sugeridos bajaron en consecuencia (4.147 → 3.660 en la Pastilla).
- **La cobertura, verificada a mano contra el módulo** acumulando la curva del Cloro Shock semana a semana: 6 y 6.
- Las seis coberturas se separan y ordenan como corresponde: Ceniza de soda 1 semana, Pastilla Triple Acción 3, Metabisulfito 4, Cloro Shock 6, Cloro Granulado 9, Pastilla Jacuzzi 14.
- El `pendiente_entrega` se muestra sin sumarse: Cloro Granulado dice "500 kg · +500 en camino" y su cobertura de 9 semanas sale de los 500, no de 1.000.
- Configuración: 4 secciones, sin lista de productos, 74 artículos ofrecidos en el select (79 MP − 6 ya vinculadas + el placeholder), fecha del conteo precargada en 2026-09-08.
- Las 5 columnas de la tabla de materia prima cierran en todas las filas, sin desborde horizontal, sin `NaN` ni `undefined`, consola sin mensajes.
