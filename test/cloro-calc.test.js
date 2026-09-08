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
