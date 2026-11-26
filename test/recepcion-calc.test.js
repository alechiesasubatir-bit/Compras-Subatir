// Recepción: estado de cada línea, alertas de COA / lote / check list,
// aviso de entrega repetida, fecha local y "Marcar COA" con permisos.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { cargar } = require('./helpers/entorno.js');

const SCRIPTS = ['supabase-config.js', 'subatir-app.js', 'recepcion-calc.js'];
const R = cargar({ pagina: 'login.html', scripts: SCRIPTS }).win.RecepcionCalc;
const ent = (o) => Object.assign({ cantidad: 0, lote: '', fecha: '2026-10-16', coa: null, checklist: null }, o);

describe('lineStats', () => {
  test('pendiente, parcial y completa', () => {
    assert.strictEqual(R.lineStats(1, 100, '', []).estado, 'PENDIENTE');
    const p = R.lineStats(1, 100, '', [ent({ cantidad: 30 }), ent({ cantidad: '20' })]);
    assert.deepStrictEqual([p.estado, p.recibido, p.saldo], ['PARCIAL', 50, 50]);
    const c = R.lineStats(1, 100, '2026-10-16', [ent({ cantidad: 100 })]);
    assert.deepStrictEqual([c.estado, c.saldo, c.legacy], ['COMPLETA', 0, false]);
  });
  test('recibida al viejo estilo (fecha sin entregas) cuenta completa por lo pedido', () => {
    const s = R.lineStats(1, 800, '2026-07-01', []);
    assert.deepStrictEqual([s.estado, s.recibido, s.legacy], ['COMPLETA', 800, true]);
  });
  test('"0000-00-00" es sin recepcion', () => {
    assert.strictEqual(R.lineStats(1, 10, '0000-00-00', []).estado, 'PENDIENTE');
  });
  test('recibir de mas no deja saldo negativo', () => {
    const s = R.lineStats(1, 2000, '', [ent({ cantidad: 2000 }), ent({ cantidad: 2000 })]);
    assert.deepStrictEqual([s.estado, s.saldo, s.recibido], ['COMPLETA', 0, 4000]);
  });
  test('ruido de punto flotante no deja una linea abierta', () => {
    // OC 1072: 4859.93 pedidas, dos entregas que suman 4859.9300000000003
    assert.strictEqual(R.lineStats(1, 4859.93, '', [ent({ cantidad: 2429.965 }), ent({ cantidad: 2429.965 })]).estado, 'COMPLETA');
  });
  test('cantidades con formato local', () => {
    assert.strictEqual(R.lineStats(1, '1.500,5', '', [ent({ cantidad: '1.500,5' })]).estado, 'COMPLETA');
  });
  test('linea sin cantidad pedida con entregas queda PARCIAL (no se puede completar)', () => {
    const s = R.lineStats(1, '', '', [ent({ cantidad: 5 })]);
    assert.deepStrictEqual([s.estado, s.saldo], ['PARCIAL', 0]);
  });
});

describe('COA, lote y check list', () => {
  test('coaOk acepta SI, SÍ y los "no aplica"', () => {
    ['SI', 'sí', ' Sí ', 'S', 'NO APLICA', 'n/a', 'TRUE'].forEach(v => assert.ok(R.coaOk(v), v));
    ['', null, 'NO', 'PENDIENTE'].forEach(v => assert.ok(!R.coaOk(v), String(v)));
  });
  test('falta COA: solo materia prima que ya recibio algo', () => {
    const parcial = R.lineStats(1, 100, '', [ent({ cantidad: 10 })]);
    assert.strictEqual(R.faltaCoa(true, parcial, ''), true);
    assert.strictEqual(R.faltaCoa(false, parcial, ''), false);
    assert.strictEqual(R.faltaCoa(true, R.lineStats(1, 100, '', []), ''), false);
    assert.strictEqual(R.faltaCoa(true, parcial, 'SI'), false);
    assert.strictEqual(R.faltaCoa(true, R.lineStats(1, 100, '', [ent({ cantidad: 10, coa: 'SI' })]), ''), false);
  });
  test('falta lote: en alguna entrega, o en la linea si es del viejo estilo', () => {
    assert.strictEqual(R.faltaLote(true, R.lineStats(1, 100, '', [ent({ cantidad: 10, lote: 'A' }), ent({ cantidad: 5 })]), ''), true);
    assert.strictEqual(R.faltaLote(true, R.lineStats(1, 100, '2026-01-01', []), ''), true);
    assert.strictEqual(R.faltaLote(true, R.lineStats(1, 100, '2026-01-01', []), 'L1'), false);
  });
  test('check list: solo entregas desde el 11/08/2026', () => {
    const vieja = R.lineStats(1, 100, '', [ent({ cantidad: 10, fecha: '2026-08-10' })]);
    const nueva = R.lineStats(1, 100, '', [ent({ cantidad: 10, fecha: '2026-08-11' })]);
    assert.strictEqual(R.faltaChecklist(true, vieja), false);
    assert.strictEqual(R.faltaChecklist(true, nueva), true);
    assert.strictEqual(R.faltaChecklist(true, R.lineStats(1, 100, '', [ent({ cantidad: 10, checklist: [] })])), false);
  });
});

describe('hoyLocal', () => {
  test('a las 22:57 sigue siendo hoy (la entrega 84 quedo con fecha del dia siguiente)', () => {
    assert.strictEqual(R.hoyLocal(new Date(2026, 7, 19, 22, 57)), '2026-08-19');
    assert.strictEqual(R.hoyLocal(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
    assert.match(R.hoyLocal(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Aviso antes de registrar', () => {
  const ahora = new Date('2026-10-16T15:23:40Z');
  const hace = (seg) => new Date(ahora.getTime() - seg * 1000).toISOString();

  test('caso real OC 1023: misma entrega 1 segundo despues -> aviso de repetida', () => {
    const st = R.lineStats(872, 2000, '', [ent({ cantidad: 2000, lote: '260XA00956', created_at: hace(1) })]);
    const av = R.avisosAntesDeRegistrar(st, { cantidad: 2000, lote: '260xa00956 ', fecha: '2026-10-16' }, ahora);
    assert.strictEqual(av.length, 2);              // repetida + se pasa de lo pedido
    assert.match(av[0], /entrega igual/);
    assert.match(av[1], /ya estaba completa/);
  });
  test('una entrega parcial normal no avisa nada', () => {
    const st = R.lineStats(1, 1000, '', [ent({ cantidad: 400, lote: 'A', created_at: hace(3600) })]);
    assert.deepStrictEqual([...R.avisosAntesDeRegistrar(st, { cantidad: 600, lote: 'B', fecha: '2026-10-16' }, ahora)], []);
  });
  test('misma cantidad pero otro lote, otra fecha o hace mas de 15 min: no es repetida', () => {
    const st = R.lineStats(1, 10000, '', [ent({ cantidad: 100, lote: 'A', created_at: hace(60) })]);
    const n = (o) => R.avisosAntesDeRegistrar(st, Object.assign({ cantidad: 100, lote: 'A', fecha: '2026-10-16' }, o), ahora).length;
    assert.strictEqual(n({}), 1);
    assert.strictEqual(n({ lote: 'B' }), 0);
    assert.strictEqual(n({ fecha: '2026-10-17' }), 0);
    const vieja = R.lineStats(1, 10000, '', [ent({ cantidad: 100, lote: 'A', created_at: hace(16 * 60) })]);
    assert.strictEqual(R.avisosAntesDeRegistrar(vieja, { cantidad: 100, lote: 'A', fecha: '2026-10-16' }, ahora).length, 0);
  });
  test('pasarse de lo pedido avisa con lo que faltaba', () => {
    const st = R.lineStats(1, 23500, '', [ent({ cantidad: 11000, created_at: hace(9e5) })]);
    const av = R.avisosAntesDeRegistrar(st, { cantidad: 42000, fecha: '2026-10-16' }, ahora);
    assert.strictEqual(av.length, 1);
    assert.match(av[0], /faltaban 12500/);
  });
  test('completar justo lo que falta no avisa; linea sin cantidad pedida tampoco', () => {
    const st = R.lineStats(1, 100, '', [ent({ cantidad: 40, created_at: hace(9e5) })]);
    assert.strictEqual(R.avisosAntesDeRegistrar(st, { cantidad: 60, fecha: 'x' }, ahora).length, 0);
    assert.strictEqual(R.avisosAntesDeRegistrar(R.lineStats(1, '', '', []), { cantidad: 60, fecha: 'x' }, ahora).length, 0);
  });
});

describe('Marcar COA', () => {
  const tablas = () => ({
    pedidos: [{ id: 870, coa: null }, { id: 500, coa: null }],
    entregas: [{ id: 1, pedido_id: 870, coa: null }, { id: 2, pedido_id: 870, coa: null }, { id: 3, pedido_id: 9, coa: null }]
  });
  const app = (rls) => cargar({ pagina: 'login.html', scripts: SCRIPTS, tablas: tablas(), rls });

  test('operario (sin permiso en pedidos) con entregas: anda, marca solo las de esa linea', async () => {
    const e = app(['pedidos']);
    const r = await e.win.RecepcionCalc.marcarCoa(e.win.SB, e.win.SubatirApp, 870, true);
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(e.db.entregas.map(x => x.coa), ['SI', 'SI', null]);
    assert.ok(!e.log.some(l => l.tabla === 'pedidos' && l.op === 'update'), 'no tiene que intentar escribir pedidos');
  });
  test('sin permiso sobre entregas -> error (no un "ok" falso)', async () => {
    const e = app(['entregas']);
    const r = await e.win.RecepcionCalc.marcarCoa(e.win.SB, e.win.SubatirApp, 870, true);
    assert.match(r.error, /sin permiso/);
  });
  test('OC del viejo estilo: se marca la linea si hay permiso', async () => {
    const e = app([]);
    const r = await e.win.RecepcionCalc.marcarCoa(e.win.SB, e.win.SubatirApp, 500, false);
    assert.strictEqual(r.success, true);
    assert.strictEqual(e.db.pedidos[1].coa, 'SI');
  });
  test('OC del viejo estilo y operario: explica que va por Pedidos', async () => {
    const e = app(['pedidos']);
    const r = await e.win.RecepcionCalc.marcarCoa(e.win.SB, e.win.SubatirApp, 500, false);
    assert.match(r.error, /desde Pedidos/);
  });
});
