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
