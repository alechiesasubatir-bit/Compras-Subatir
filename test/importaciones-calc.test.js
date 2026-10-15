const { test } = require('node:test');
const assert = require('node:assert');
const { ImpCalc } = require('../importaciones-calc.js');

const P = { crecimiento_pct: 0, meses_cobertura: 4, semanas_seguridad: 0, semanas_leadtime: 0 };
const FECHA = new Date('2026-10-13T00:00:00Z');

test('soloAnual: el proyectado es el promedio mensual del año, el trimestre no cuenta', () => {
  const r = ImpCalc.calcular({ consumo_3m: 900, consumo_anual: 600 }, P, { soloAnual: true });
  assert.strictEqual(r.ponderado, 50);
  assert.strictEqual(r.necesidad, 200);
});

test('ponderado 60/40 entre el trimestre y el año', () => {
  // prom3m = 300/3 = 100; promAnual = 600/12 = 50 → 0,6×100 + 0,4×50 = 80
  const r = ImpCalc.calcular({ consumo_3m: 300, consumo_anual: 600 }, P);
  assert.strictEqual(Math.round(r.ponderado * 1000) / 1000, 80);
});

test('crecimiento multiplica el proyectado', () => {
  const r = ImpCalc.calcular({ consumo_3m: 300, consumo_anual: 1200 }, Object.assign({}, P, { crecimiento_pct: 10 }));
  assert.strictEqual(Math.round(r.proyect * 1000) / 1000, 110);
});

test('el lead time entra en la cantidad: lo que se consume mientras viaja', () => {
  // proyect 100/mes; 4 meses + 13 semanas de viaje (3 meses) = 700
  const r = ImpCalc.calcular({ consumo_3m: 300, consumo_anual: 1200 },
    Object.assign({}, P, { semanas_leadtime: 4.333 * 3 }));
  assert.strictEqual(Math.round(r.totalNec), 700);
  assert.strictEqual(r.pedido, 700);
});

test('stock y en tránsito se descuentan y se redondea a caja completa', () => {
  const r = ImpCalc.calcular({ consumo_3m: 300, consumo_anual: 1200, stock_actual: 150, en_transito: 50 },
    P, { unXCaja: 120 });
  // 400 − 200 = 200 → 2 cajas de 120 = 240
  assert.strictEqual(r.cajas, 2);
  assert.strictEqual(r.pedido, 240);
});

test('sin caja redondea a unidades enteras', () => {
  const r = ImpCalc.calcular({ consumo_3m: 10, consumo_anual: 40 }, P);
  // proyect = 0,6×3,333+0,4×3,333 = 3,333 → ×4 = 13,33 → 14
  assert.strictEqual(r.pedido, 14);
  assert.strictEqual(r.cajas, 0);
});

test('justo a caja exacta no agrega una caja de más por redondeo', () => {
  const r = ImpCalc.calcular({ consumo_3m: 300, consumo_anual: 1200 }, P, { unXCaja: 100 });
  assert.strictEqual(r.cajas, 4);
});

test('estados: quiebre, urgente, pedir, ok, sin consumo', () => {
  const pl = Object.assign({}, P, { semanas_leadtime: 12, semanas_seguridad: 4 });
  const base = { consumo_3m: 300, consumo_anual: 1200 };   // 100/mes
  assert.strictEqual(ImpCalc.calcular(Object.assign({ stock_actual: 0 }, base), pl).estado, 'quiebre');
  // 200 u = 8,7 semanas < 16 → urgente
  assert.strictEqual(ImpCalc.calcular(Object.assign({ stock_actual: 200 }, base), pl).estado, 'urgente');
  // 500 u = 21,7 semanas ≥ 16, pero no cubre 12 sem + 4 meses + 4 sem → pedir
  assert.strictEqual(ImpCalc.calcular(Object.assign({ stock_actual: 500 }, base), pl).estado, 'pedir');
  assert.strictEqual(ImpCalc.calcular(Object.assign({ stock_actual: 5000 }, base), pl).estado, 'ok');
  assert.strictEqual(ImpCalc.calcular({ stock_actual: 10 }, pl).estado, 'sin');
});

test('pedir antes de: fecha de la corrida + margen en semanas', () => {
  const pl = Object.assign({}, P, { semanas_leadtime: 12, semanas_seguridad: 4 });
  // 100/mes; stock 100×(26/4,333) = 26 semanas → margen 10 semanas = 70 días
  const r = ImpCalc.calcular({ consumo_3m: 300, consumo_anual: 1200, stock_actual: 100 * 26 / 4.333 }, pl, { fecha: FECHA });
  assert.strictEqual(r.pedirAntes.toISOString().slice(0, 10), '2026-12-22');
});

test('anualizar lleva un listado de 11 meses a 12', () => {
  assert.strictEqual(ImpCalc.anualizar(1100, 11), 1200);
  assert.strictEqual(ImpCalc.anualizar(1200, 12), 1200);
  assert.strictEqual(ImpCalc.anualizar(1200, null), 1200);
});
