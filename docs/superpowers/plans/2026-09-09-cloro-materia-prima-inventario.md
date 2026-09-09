# Materia prima de Previsión Cloro vinculada al inventario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Previsión Cloro deje de tener su propia lista de materias primas sin stock y se cuelgue del inventario real del módulo Stock, para poder contestar "con lo que hay en el depósito, ¿hasta qué semana de la temporada llegamos?".

**Architecture:** `cl_materias` gana un `inventario_id` que apunta a la fila de `inventario` (por id, nunca por código: el código `218851` está duplicado). El cálculo nuevo vive en `cloro-calc.js`, puro y testeable: `planEnvasado` aplica la regla que ya existe —`Cloro.sugerido`— semana a semana en vez de una sola vez, `kgSemanal` la pasa a kg por materia y `cobertura` cuenta hasta dónde alcanza el stock. La pantalla sólo dibuja.

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
| `cloro-calc.js` (modificar) | Agrega `planEnvasado`, `kgSemanal` y `cobertura`. |
| `test/cloro-calc.test.js` (modificar) | Sus tests. |
| `migracion/cloro_materia_inventario.sql` (nuevo) | Columna `inventario_id`, único, y el vínculo de las 6 materias. |
| `migracion/cloro_carga_planilla.sql` (nuevo) | `materia_id` y `kg_mp_por_unidad` de los 13 productos. |
| `migracion/inventario_220156_unidad.sql` (nuevo) | `unidad` de `'g'` a `'Kg'` en la fila del Jacuzzi. |
| `migracion/cloro_materia_inventario_rollback.sql` (nuevo) | Vuelta atrás de los tres. |
| `cloro.html` (modificar) | Lee `inventario`, tabla de MP con stock y cobertura, avisos, y fuera la sección Productos de Configuración. |

---

### Task 1: `planEnvasado` — la curva semanal de envasado

**Files:**
- Modify: `cloro-calc.js` (antes del `return` final, después de `sugerido`)
- Test: `test/cloro-calc.test.js`

**Interfaces:**
- Consumes: `sugerido` y `proyectarStock`, que ya existen en el mismo archivo.
- Produces:
  - `Cloro.planEnvasado(opts) -> number[]` con
    `opts = {prevision: number[], stockInicial: number, ventas: number[], envasado: number[], semanasCerradas: number, desdeSemana: number, semanas: number, horizonte: number, semanasSeguridad: number, lote: number}`.
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
      prevision: prevision, semanasCerradas: o.semanasCerradas
    });
    var stock = desde >= 2
      ? (parseFloat(base[desde - 2]) || 0)
      : (parseFloat(o.stockInicial) || 0);

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

### Task 2: `kgSemanal` y `cobertura`

**Files:**
- Modify: `cloro-calc.js`
- Test: `test/cloro-calc.test.js`

**Interfaces:**
- Consumes: nada de la Task 1 en tiempo de ejecución (se combinan en la pantalla).
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

### Task 3: El SQL

**Files:**
- Create: `migracion/cloro_materia_inventario.sql`
- Create: `migracion/cloro_carga_planilla.sql`
- Create: `migracion/inventario_220156_unidad.sql`
- Create: `migracion/cloro_materia_inventario_rollback.sql`

**Interfaces:**
- Consumes: las tablas `cl_materias`, `cl_productos` e `inventario`, que ya existen.
- Produces: `cl_materias.inventario_id`; las 6 materias vinculadas; los 13 productos con `materia_id` y `kg_mp_por_unidad`.

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

Decirle que corra, **en este orden**: `cloro_materia_inventario.sql`, `cloro_carga_planilla.sql`, `inventario_220156_unidad.sql`. Esperar confirmación y **verificar leyendo la base desde el navegador** que las 6 materias resuelven a las filas de inventario esperadas y que los 13 productos quedaron con su materia y sus kg.

---

### Task 4: La pantalla lee el inventario y muestra la cobertura

**Files:**
- Modify: `cloro.html` — `<thead>` de la tabla de MP en `cloro.html:505-511`, `cargar()` en `cloro.html:789`, `pintarMP()` en `cloro.html:1494`, `pintarAvisos()` en `cloro.html:1319`

**Interfaces:**
- Consumes: `Cloro.planEnvasado` (Task 1), `Cloro.kgSemanal` y `Cloro.cobertura` (Task 2), y las columnas de la Task 3.
- Produces: las variables globales `INV` y las funciones `matInv(m)`, `matNombre(m)`, `planPorProducto()`, `coberturaPorMateria()`.

- [ ] **Step 1: Leer el inventario en la carga**

En `cloro.html`, junto a las otras globales (`var TEMPS=[], PROD=[], MAT=[], ...`), agregar `INV=[]`.

En `cargar()`, agregar la cuarta consulta al `Promise.all`:

```js
    SB.from('inventario').select('id,codigo,descripcion,unidad,inventario,pendiente_entrega,updated_at').eq('ext_id','MP')
```

y en el `then`, `INV=r[3].data||[];`.

Nota: la materia prima se lee **entera y siempre**, no sólo las 6 vinculadas. Son 79 filas y así la sección de Configuración puede ofrecer las que todavía no están colgadas de ninguna materia.

- [ ] **Step 2: Los ayudantes**

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

- [ ] **Step 3: Las columnas nuevas**

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

- [ ] **Step 4: El aviso de por qué no hay cobertura**

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

- [ ] **Step 5: Verificar que los `<script>` inline parsean**

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

- [ ] **Step 6: Commit**

```bash
git add cloro.html && git commit -m "Cloro: stock real y cobertura en semanas por materia prima"
```

---

### Task 5: Configuración pierde la sección Productos

**Files:**
- Modify: `cloro.html` — HTML de la sección 4 en `cloro.html:573-580`, la sección 3 en `cloro.html:563-571`, `pintarConfig()` en `cloro.html:1533`, `guardarConfig()` en `cloro.html:1715`, `crearMateria()` en `cloro.html:1698`, y el CSS de `.cf-prods`/`.cf-ph`/`.cf-pr` en `cloro.html:204-221`

**Interfaces:**
- Consumes: `matInv`, `matNombre` (Task 4).
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

- [ ] **Step 5: Verificar que no quedaron referencias colgadas**

```bash
grep -n "cf-prods\|cf-merma\|cf-kg\|cf-mat\b\|cf-lote\|nm-nom\|cf-aviso" cloro.html
```
Expected: **sin resultados**. Cualquier línea que aparezca es un `querySelector` que va a devolver null en tiempo de ejecución.

Y la verificación de sintaxis inline de la Task 4, Step 5. Expected: `inline OK`.

- [ ] **Step 6: Commit**

```bash
git add cloro.html
git commit -m "Cloro: la materia prima de cada producto deja de ser configuracion"
```

---

### Task 6: Verificación contra la base y publicación

**Files:**
- Modify: ninguno salvo que aparezca un error.

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Todos los tests**

Run: `node --test`
Expected: PASS, 81 tests — los 66 de antes más los 6 de `planEnvasado` y los 9 de `kgSemanal`/`cobertura`.

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
