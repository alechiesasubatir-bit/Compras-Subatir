const { test } = require('node:test');
const assert = require('node:assert');
const { MPCosteo } = require('../mp-costeo.js');

// Costeo de la factura 293 (planilla "COSTO MEROAR S. A. F. 293")
const REF = {
  origen: 'Factura 293', fca: 71383.2,
  gastos: { flete_int: 348, seguro_int: 69, flete_nac: 302, seguro_nac: 46,
            tributos: 2480.1, honorarios: 789.8022, gastos_gen: 150 }
};
// OC-MEROAR-002 tal como salió en la Proforma del 25/11/2026
const L = (desc, cant, precio, grupo, unidad) => ({ desc, cant, precio, grupo: grupo || 'Esencias', unidad });
const OC2 = [
  L('Acqua',30,28), L('Arpegge',90,18), L('Blemix',30,19.8), L('Bosque',750,18.4),
  L('Citrico Limp',240,21.2), L('Citrico Textil',270,24), L('Coniglio',180,21),
  L('Dialux',390,23.6), L('Eucalipto',120,17), L('Lavanda',420,16), L('Lenin',390,22),
  L('Limon Textil',210,30), L('Manzana',60,18), L('Nivea',60,25), L('SKIP',450,26.04),
  L('Moras',390,21.9), L('Uva',120,20), L('Vainilla',30,24.6), L('Vivex',30,18),
  L('Frasco 120',1000,0.77,'Esencia y Potes','un'), L('Citrico AV',30,23.2,'Esencia y Potes'),
  L('Uva AV',30,18,'Esencia y Potes'), L('Limon AV',30,18,'Esencia y Potes')
];

test('la referencia contra sí misma reproduce la planilla de la 293', () => {
  const r = MPCosteo.calcular({ lineas: [L('x', 1, 71383.2)], ref: REF });
  assert.strictEqual(r.cif, 71800.2);
  assert.strictEqual(r.totGastos, 4184.9);
  assert.strictEqual(r.ivaImp, 15796.04);
  assert.strictEqual(r.ivaAnt, 7180.02);
  assert.strictEqual(r.inc.toFixed(6), '0.058626');
});

test('OC-MEROAR-002: los mismos números que la Proforma entregada', () => {
  const r = MPCosteo.calcular({ lineas: OC2, ref: REF });
  assert.strictEqual(r.fca, 94109);
  assert.strictEqual(r.totGastos, 5517.22);
  assert.strictEqual(r.costo, 99626.22);
  assert.strictEqual(r.cif, 94658.76);
  assert.strictEqual(r.grupos.length, 2);
  assert.strictEqual(r.grupos[0].fca, 91563);
  assert.strictEqual(r.grupos[1].fca, 2546);
});

test('las líneas suman exactamente el costo total (sin centavos sueltos)', () => {
  const r = MPCosteo.calcular({ lineas: OC2, ref: REF });
  const suma = Math.round(r.lineas.reduce((t, l) => t + l.costoTotal, 0) * 100) / 100;
  assert.strictEqual(suma, r.costo);
  const g = Math.round((r.grupos[0].costo + r.grupos[1].costo) * 100) / 100;
  assert.strictEqual(g, r.costo);
});

test('con valores reales se usan tal cual, sin escalar', () => {
  const real = { flete_int: 500, seguro_int: 100, flete_nac: 400, seguro_nac: 50,
                 tributos: 3000, honorarios: 1000, gastos_gen: 200, iva_imp: 21000, iva_ant: '' };
  const r = MPCosteo.calcular({ lineas: OC2, ref: REF, real });
  assert.strictEqual(r.real, true);
  assert.strictEqual(r.totGastos, 5250);
  assert.strictEqual(r.costo, 99359);
  assert.strictEqual(r.cif, 94709);
  assert.strictEqual(r.ivaImp, 21000);          // el declarado
  assert.strictEqual(r.ivaAnt, 9470.9);         // vacío → 10% del CIF
});

test('un artículo sin precio se marca y no suma', () => {
  const r = MPCosteo.calcular({ lineas: [L('a', 30, 20), L('b', 30, null), L('c', 30, '')], ref: REF });
  assert.strictEqual(r.fca, 600);
  assert.deepStrictEqual(r.sinPrecio.map(l => l.desc), ['b', 'c']);
});

test('plazo: espera, ventana de 20–30 días y vencido', () => {
  assert.deepStrictEqual(MPCosteo.plazo('2026-11-25', '2026-11-25', false),
    { dias: 0, desde: '2026-12-15', hasta: '2026-12-25', estado: 'espera' });
  assert.strictEqual(MPCosteo.plazo('2026-11-25', '2026-12-15', false).estado, 'ventana');
  assert.strictEqual(MPCosteo.plazo('2026-11-25', '2026-12-25', false).estado, 'ventana');
  assert.strictEqual(MPCosteo.plazo('2026-11-25', '2026-12-26', false).estado, 'vencido');
  assert.strictEqual(MPCosteo.plazo('2026-11-25', '2027-02-01', true).estado, 'real');
});

test('referencia: el último costeo real le gana a la de los parámetros', () => {
  assert.strictEqual(MPCosteo.referencia([], REF), REF);
  assert.strictEqual(MPCosteo.referencia([{ estado: 'ESTIMADO', fecha_impo: '2026-12-01' }], REF), REF);
  const r = MPCosteo.referencia([
    { estado: 'REAL', fecha_impo: '2026-11-25', fca_real: 94109, oc: 'OC-MEROAR-002', gastos_real: { flete_int: 1 } },
    { estado: 'REAL', fecha_impo: '2027-03-01', fca_real: 50000, oc: 'OC-MEROAR-003', gastos_real: { flete_int: 2 } }
  ], REF);
  assert.strictEqual(r.fca, 50000);
  assert.strictEqual(r.gastos.flete_int, 2);
  assert.strictEqual(r.gastos.tributos, 0);
});
