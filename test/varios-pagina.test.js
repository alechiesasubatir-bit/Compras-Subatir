// Integración: el script REAL de varios.html con el Supabase falso.
// Cubre lo que se encontró revisando Pedidos Varios el 26/11/2026:
//  · el "Total final" puesto al recibir no rehacía neto ni IVA: Informes
//    tomaba el total con IVA como neto (pedido 1)
//  · si fallaba el borrado de renglones al editar, igual se insertaban los
//    nuevos y quedaban duplicados
//  · la fecha de hoy era la UTC (después de las 21 h, "mañana")
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { cargar, drenar, RAIZ } = require('./helpers/entorno.js');

function dom() {
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, _v: '', get value() { return this._v; }, set value(x) { this._v = x == null ? '' : String(x); },
    checked: false, disabled: false, style: {}, textContent: '', innerHTML: '', _clases: new Set(),
    get classList() { const c = this._clases; return { add: (x) => c.add(x), remove: (x) => c.delete(x), toggle() {}, contains: (x) => c.has(x) }; },
    focus() {}, addEventListener() {}, closest() { return null; }, appendChild() {}, querySelector() { return null; }
  });
  return { els, el };
}

const PED = { id: 1, fecha: '2026-08-01', proveedor: 'Ferreteria X', moneda: '$', iva_incluido: false, iva_tasa: 22,
  subtotal: null, iva_monto: null, total: null, estado: 'PENDIENTE' };
const ITEMS = [{ id: 10, pedido_id: 1, articulo: 'Tornillos', cantidad: 100, precio: null, orden: 0 }];

async function abrir(opts = {}) {
  const e = cargar({ pagina: 'login.html', tablas: { pedidos_varios: [Object.assign({}, PED)], pedidos_varios_items: ITEMS.slice(), proveedores: [] },
    errores: opts.errores });
  const w = e.win, d = dom();
  w.document.getElementById = d.el;
  w.document.querySelectorAll = (sel) => (sel === '#ed-items .it-row' ? (opts.filas || []) : []);
  w.confirm = () => true; w.alert = () => {};
  const html = fs.readFileSync(path.join(RAIZ, 'varios.html'), 'utf8');
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    try { vm.runInContext(m[1], w, { filename: 'varios.html' }); } catch (err) { /* nav */ }
  }
  w.toast = () => {};
  await drenar(); await drenar();
  return { e, w, d, run: (js) => vm.runInContext(js, w) };
}

describe('varios.html', () => {
  test('el total puesto al recibir rehace neto e IVA con la tasa del pedido', async () => {
    const p = await abrir();
    p.run('DATA=[' + JSON.stringify(Object.assign({}, PED, { items: ITEMS })) + ']; openRecibir(1);');
    p.d.el('rc-total').value = '6652';
    p.run('recibir()');
    await drenar();
    const r = p.e.db.pedidos_varios[0];
    assert.strictEqual(r.estado, 'RECIBIDO');
    assert.strictEqual(r.total, 6652);
    assert.strictEqual(r.subtotal, 5452.46);
    assert.strictEqual(r.iva_monto, 1199.54);
  });

  test('si el total no cambia, neto e IVA quedan como estaban', async () => {
    const p = await abrir();
    const d = Object.assign({}, PED, { subtotal: 100, iva_monto: 22, total: 122, items: ITEMS });
    p.e.db.pedidos_varios[0] = Object.assign({}, d);
    p.run('DATA=[' + JSON.stringify(d) + ']; openRecibir(1);');
    p.run('recibir()');
    await drenar();
    const r = p.e.db.pedidos_varios[0];
    assert.strictEqual(r.subtotal, 100);
    assert.ok(!('subtotal' in p.e.log.filter((x) => x.op === 'update').pop().payload));
  });

  test('si falla el borrado de renglones, no se insertan duplicados', async () => {
    const fila = (art, cant, prec) => ({ querySelector: (c) => ({ value: c === '.it-art' ? art : c === '.it-cant' ? cant : prec }) });
    const p = await abrir({ filas: [fila('Tornillos', '100', '2')],
      errores: { pedidos_varios_items: (st) => st.op === 'delete' } });
    p.run('CUR=DATA[0]||' + JSON.stringify(PED) + ';');
    p.d.el('ed-prov').value = 'Ferreteria X'; p.d.el('ed-fecha').value = '2026-08-01';
    p.d.el('ed-moneda').value = '$'; p.d.el('ed-iva-tasa').value = '22';
    p.run('guardar()');
    await drenar(); await drenar();
    assert.strictEqual(p.e.log.filter((x) => x.tabla === 'pedidos_varios_items' && x.op === 'insert').length, 0);
    assert.strictEqual(p.e.db.pedidos_varios_items.length, 1);
  });

  test('hoy es la fecha de la PC, no la UTC', async () => {
    const p = await abrir();
    const d = new Date(), q = (n) => (n < 10 ? '0' : '') + n;
    assert.strictEqual(p.run('hoy()'), d.getFullYear() + '-' + q(d.getMonth() + 1) + '-' + q(d.getDate()));
  });
});
