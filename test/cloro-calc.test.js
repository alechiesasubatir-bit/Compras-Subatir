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

// ─── Suavizado y crecimiento ─────────────────────────────────────────

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

// El caso real que rompio la temporada 2026-27: arrancada, 6 semanas
// cerradas y las ventas todavia sin importar. El cociente daba -100% y
// multiplicaba TODA la prevision por cero.
test('una temporada arrancada y sin ventas importadas no da -100%', () => {
  const r = Cloro.crecimiento({
    actual:   [0, 0, 0, 0, 0, 0],
    anterior: [80, 80, 80, 80, 80, 80, 80, 80],
    previa:   [80, 80, 80, 80, 80, 80, 80, 80],
    hayActual: false,
    semanasCerradas: 6
  });
  assert.notStrictEqual(r.modo, 'auto');
  assert.strictEqual(r.sinVentas, true);
  assert.ok(r.pct > -1);
});

test('sin ventas importadas y sin nada que heredar el crecimiento es cero', () => {
  const r = Cloro.crecimiento({
    actual:   [0, 0, 0, 0, 0, 0],
    anterior: [80, 80, 80, 80, 80, 80],
    previa:   null,
    hayActual: false,
    semanasCerradas: 6
  });
  assert.strictEqual(r.modo, 'sin-datos');
  assert.strictEqual(r.pct, 0);
});

// La otra cara: un cero CARGADO es una afirmacion, no una ausencia. Mismo
// criterio que el stock inicial, donde se mira si la fila existe.
test('con ventas cargadas en cero el -100% si es un dato', () => {
  const r = Cloro.crecimiento({
    actual:   [0, 0, 0, 0],
    anterior: [80, 80, 80, 80],
    previa:   null,
    hayActual: true,
    semanasCerradas: 4
  });
  assert.strictEqual(r.modo, 'auto');
  assert.strictEqual(r.pct, -1);
});

test('un crecimiento de -100% deja la prevision entera en cero', () => {
  // por que el -100% no puede entrar por descuido: no encoge la prevision,
  // la anula.
  const r = Cloro.prever({ anterior: [50, 60, 70], ventana: 1, crecimientoPct: -1, semanas: 3 });
  assert.deepStrictEqual(r, [0, 0, 0]);
});

// ─── Prevision, stock, sugerido y materia prima ──────────────────────

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

test('el stock proyectado usa ventas reales en lo cerrado y prevision en lo que viene', () => {
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

test('bajaRotacion marca los cuatro productos que no admiten prevision semanal', () => {
  // Cloro Granulado x 25 Kg: 31 unidades en 35 semanas -> 0,9 por semana
  const granulado25 = new Array(35).fill(0); granulado25[0] = 31;
  assert.strictEqual(Cloro.bajaRotacion(granulado25, 10), true);
  // el siguiente producto hacia arriba promedia 32 u/semana
  assert.strictEqual(Cloro.bajaRotacion(new Array(35).fill(32), 10), false);
});

test('kgMateria suma por materia prima', () => {
  const productos = [
    { id: 1, materia_id: 7, kg_mp_por_unidad: 1 },
    { id: 2, materia_id: 7, kg_mp_por_unidad: 0.9 },
    { id: 3, materia_id: 8, kg_mp_por_unidad: 2 }
  ];
  const r = Cloro.kgMateria(productos, { 1: 100, 2: 100, 3: 50 });
  // materia 7: 100*1 + 100*0.9 = 100 + 90 = 190 ; materia 8: 50*2 = 100
  assert.ok(Math.abs(r.porMateria[7] - 190) < 1e-9);
  assert.ok(Math.abs(r.porMateria[8] - 100) < 1e-9);
  assert.deepStrictEqual(r.sinAsignar, []);
});

test('los kg son el teorico puro, sin ningun recargo', () => {
  // Hubo un merma_pct que multiplicaba este numero. Se saco de la base y
  // del calculo; si alguna fila vieja lo trae igual, se ignora.
  const r = Cloro.kgMateria([{ id: 1, materia_id: 7, kg_mp_por_unidad: 2, merma_pct: 50 }], { 1: 10 });
  assert.strictEqual(r.porMateria[7], 20);
});

test('un producto sin materia prima no suma en ningun lado y se lista', () => {
  const productos = [
    { id: 1, materia_id: null, kg_mp_por_unidad: 1 },
    { id: 2, materia_id: 7,    kg_mp_por_unidad: 1 }
  ];
  const r = Cloro.kgMateria(productos, { 1: 500, 2: 10 });
  assert.deepStrictEqual(r.sinAsignar, [1]);
  assert.strictEqual(r.porMateria[7], 10);
  assert.strictEqual(Object.keys(r.porMateria).length, 1);
});

test('un producto sin kg por unidad cuenta como sin asignar', () => {
  const r = Cloro.kgMateria([{ id: 1, materia_id: 7, kg_mp_por_unidad: 0 }], { 1: 500 });
  assert.deepStrictEqual(r.sinAsignar, [1]);
});
