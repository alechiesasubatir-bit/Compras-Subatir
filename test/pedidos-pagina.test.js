// Integración: el script REAL de pedidos.html con un DOM de mentira y el
// Supabase falso. Cubre lo que se encontró revisando Pedidos (26/11/2026):
//  · editar el precio de una OC borraba el "NO APLICA" del COA
//  · Crear OC / Guardar / Eliminar no se bloqueaban mientras grababan
//  · COA, lote y check list contados con otra regla que Recepción
//  · el resumen por proveedor sumaba pesos como dólares
//  · el "Atraso" del detalle se medía contra el vencimiento del producto
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { cargar, drenar, RAIZ } = require('./helpers/entorno.js');

function dom() {
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, value: '', checked: false, disabled: false, style: {}, textContent: '', innerHTML: '',
    _clases: new Set(),
    get classList() { const c = this._clases; return { add: (x) => c.add(x), remove: (x) => c.delete(x), toggle() {}, contains: (x) => c.has(x) }; },
    focus() {}, addEventListener() {}, closest() { return null; }, appendChild() {}
  });
  return { els, el };
}

// Línea de la base (columnas de Postgres) y cómo la ve la página (encabezados)
const BASE = { id: 501, n_orden: '1090', fecha: '2026-11-01', proveedor: 'Quimica SA', descripcion: 'Soda caustica',
  cantidad: 100, precio_un: 2, moneda: 'U$S', s_iva: 200, c_iva: 244, coa: 'NO APLICA', conforme: 'SI',
  lote: 'L-77', f_recepcion: '2026-11-10', f_vto: 'NO APLICA', observaciones: null, demora_dias: 5 };
const FILA = { __row: 501, 'N° Orden': '1090', Fecha: '2026-11-01', Proveedor: 'Quimica SA', 'Código': '',
  'Descripción': 'Soda caustica', Cantidad: 100, 'Precio un': 2, '$/U$S': 'U$S', 's/iva': 200, 'c/iva': 244,
  'F.Recepción': '2026-11-10', 'F. Vto': 'NO APLICA', Lote: 'L-77', COA: 'NO APLICA', Conforme: 'SI',
  Observaciones: '', 'Demora días': 5, 'ID Inventario': null };

function abrir(opts = {}) {
  const e = cargar({ pagina: 'login.html',
    scripts: ['supabase-config.js', 'subatir-app.js', 'recepcion-calc.js'],
    tablas: { pedidos: [Object.assign({}, BASE)], entregas: opts.entregas || [], inventario: [] } });
  const w = e.win, d = dom();
  w.document.getElementById = d.el;
  w.document.querySelectorAll = () => [];
  w.confirm = () => true; w.alert = () => {};
  const html = fs.readFileSync(path.join(RAIZ, 'pedidos.html'), 'utf8');
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(m[1], w, { filename: 'pedidos.html' });
  w.load = () => {};
  w.buildDocPdf = () => {};
  const filas = opts.filas || [FILA];
  vm.runInContext('detectKeys(' + JSON.stringify(filas) + '); DATA_RAW=' + JSON.stringify(filas) +
    '; DATA_DISPLAY=DATA_RAW.slice(); ENTREGAS=' + JSON.stringify(opts.entregas || []) + '; buildEntregasMap();', w);
  if (opts.mp) vm.runInContext('esMateriaPrima = function(){ return true; };', w);
  return { e, w, d, run: (js) => vm.runInContext(js, w) };
}
const escrituras = (p, tabla, op) => p.e.log.filter(x => x.tabla === tabla && x.op === op);

describe('pedidos.html: editar una OC', () => {
  test('corregir el precio no borra el COA "NO APLICA" ni los datos de recepcion', async () => {
    const p = abrir();
    p.run("openEdit('501')");
    assert.strictEqual(p.d.el('ed-coa').checked, true, 'NO APLICA se ve como COA resuelto');
    p.d.el('ed-precio').value = '2.5';
    p.run('saveEdit()');
    await drenar();
    const fila = p.e.db.pedidos[0];
    assert.strictEqual(fila.precio_un, 2.5);
    assert.strictEqual(fila.coa, 'NO APLICA');
    assert.strictEqual(fila.f_vto, 'NO APLICA');
    assert.strictEqual(fila.lote, 'L-77');
    assert.strictEqual(fila.f_recepcion, '2026-11-10');
    const patch = escrituras(p, 'pedidos', 'update')[0].payload;
    for (const k of ['coa', 'conforme', 'lote', 'f_recepcion', 'f_vto'])
      assert.ok(!(k in patch), k + ' no se toco y no tenia que viajar');
  });

  test('destildar el COA si se guarda', async () => {
    const p = abrir();
    p.run("openEdit('501')");
    p.d.el('ed-coa').checked = false;
    p.run('saveEdit()');
    await drenar();
    assert.ok(!p.e.db.pedidos[0].coa, 'quedo sin COA');
  });

  test('dos toques en Guardar escriben una sola vez', async () => {
    const p = abrir();
    p.run("openEdit('501')");
    p.d.el('ed-precio').value = '3';
    p.run('saveEdit(); saveEdit();');
    await drenar();
    assert.strictEqual(escrituras(p, 'pedidos', 'update').length, 1);
  });

  test('si la base rechaza, el boton Guardar vuelve a habilitarse', async () => {
    const p = abrir();
    p.e.db.pedidos.length = 0;                       // la fila ya no existe
    p.run("openEdit('501')");
    p.run('saveEdit()');
    await drenar();
    assert.strictEqual(p.d.el('btn-save-edit').disabled, false);
  });
});

describe('pedidos.html: crear y eliminar', () => {
  test('dos toques en Crear Orden crean una sola orden', async () => {
    const p = abrir();
    p.d.el('nw-fecha').value = '2026-11-26';
    p.run("var L=[{desc:'Acido citrico', cant:10, prec:3, moneda:'U$S'}]; crearOC('Quimica SA', L, []); crearOC('Quimica SA', L, []);");
    await drenar(); await drenar();
    const nuevas = p.e.db.pedidos.filter(r => r.descripcion === 'Acido citrico');
    assert.strictEqual(nuevas.length, 1);
    assert.strictEqual(p.d.el('btn-save-new').disabled, false, 'queda listo para la proxima orden');
  });

  test('dos toques en Eliminar mandan un solo borrado', async () => {
    const p = abrir();
    p.run("openDetail('501'); doDelete(); doDelete();");
    await drenar();
    assert.strictEqual(escrituras(p, 'pedidos', 'delete').length, 1);
  });
});

describe('pedidos.html: mismos numeros que Recepcion', () => {
  const ent = (o) => Object.assign({ pedido_id: 501, cantidad: 50, fecha: '2026-11-20', lote: 'L-77', coa: 'SI', checklist: { ok: 1 }, created_at: '2026-11-20T12:00:00Z' }, o);

  test('una entrega sin lote cuenta aunque la linea ya tenga otro lote', () => {
    const p = abrir({ mp: true, entregas: [ent({ id: 1 }), ent({ id: 2, lote: '' })] });
    const r = p.run('DATA_DISPLAY[0]');
    assert.strictEqual(p.w.faltaLote(r), true);
    const st = p.w.RecepcionCalc.lineStats(501, 100, '2026-11-10', p.run('ENTREGAS'));
    assert.strictEqual(p.w.faltaLote(r), p.w.RecepcionCalc.faltaLote(true, st, 'L-77'), 'igual que Recepcion');
  });

  test('materia prima recibida a medias sin COA ya se reclama (como en Recepcion)', () => {
    const fila = Object.assign({}, FILA, { 'F.Recepción': '', COA: '' });
    const p = abrir({ mp: true, filas: [fila], entregas: [ent({ id: 1, coa: null })] });
    assert.strictEqual(p.w.faltaCOA(p.run('DATA_DISPLAY[0]')), true);
  });

  test('"SÍ" con tilde cuenta como COA en la tabla y en el filtro', () => {
    const fila = Object.assign({}, FILA, { COA: 'SÍ' });
    const p = abrir({ filas: [fila] });
    p.d.el('f-coa').value = 'no';
    p.run('applyFilters()');
    assert.strictEqual(p.run('FILTERED.length'), 0, 'filtrar "sin COA" no la muestra');
    p.d.el('f-coa').value = 'si';
    p.run('applyFilters()');
    assert.strictEqual(p.run('FILTERED.length'), 1);
    assert.match(p.d.el('tbody').innerHTML, /✓COA/);
  });
});

describe('pedidos.html: resumen y detalle', () => {
  test('el resumen por proveedor no suma pesos como dolares', () => {
    const usd = Object.assign({}, FILA, { __row: 1, 'F.Recepción': '', 's/iva': 100, '$/U$S': 'U$S' });
    const pso = Object.assign({}, FILA, { __row: 2, 'F.Recepción': '', 's/iva': 50000, '$/U$S': '$' });
    const p = abrir({ filas: [usd, pso] });
    p.run('renderProveedores()');
    const html = p.d.el('prov-grid').innerHTML;
    assert.match(html, /U\$S 100<\/strong>U\$S pend\./);
    assert.match(html, /\$ 50\.000<\/strong>\$ pend\./);
  });

  test('el resumen por proveedor cuenta solo lo que falta llegar', () => {
    const fila = Object.assign({}, FILA, { 'F.Recepción': '', 's/iva': 1000, '$/U$S': 'U$S' });
    const p = abrir({ filas: [fila], entregas: [{ id: 1, pedido_id: 501, cantidad: 75, fecha: '2026-11-20' }] });
    p.run('renderProveedores()');
    assert.match(p.d.el('prov-grid').innerHTML, /U\$S 250<\/strong>/);
  });

  test('el atraso se mide contra la llegada estimada, no contra el vencimiento', () => {
    // OC del 01/11 con 5 días de demora: tenía que llegar el 06/11.
    // El vencimiento (2030) no tiene nada que ver con la entrega.
    const fila = Object.assign({}, FILA, { 'F.Recepción': '', 'F. Vto': '2030-01-01' });
    const p = abrir({ filas: [fila] });
    p.run("openDetail('501')");
    assert.match(p.d.el('detail-grid').innerHTML, /Atraso<\/div><div class="detail-value">\+\d+ días de atraso/);
  });
});
