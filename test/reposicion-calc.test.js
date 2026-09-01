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
