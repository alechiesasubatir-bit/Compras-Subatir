// Integración: el script REAL de index.html (Dashboard) con un DOM de
// mentira y el Supabase falso, cargando los datos por el mismo camino que
// en producción (getData). Cubre lo que se encontró el 26/11/2026:
//  · "Stock crítico" salía de la columna SOLICITAR, congelada del Sheet:
//    marcaba artículos sobre el mínimo y no los que estaban debajo
//  · COA / lote / check list con otra regla que Recepción y Pedidos
//  · textos de la base metidos en la tabla sin escapar
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

// Filas de la base (columnas de Postgres), como las lee getData
const INV = [
  // bajo el mínimo, pero la columna vieja dice "hay suficiente"
  { id: 33, descripcion: 'Botella Pet x 500 mL', inventario: 2992, stock_minimo: 3000, consumo_mensual: 11000, solicitar: 'hay suficiente' },
  // muy sobre el mínimo, pero la columna vieja dice "solicitar material"
  { id: 63, descripcion: 'Doypack blanco', inventario: 7000, stock_minimo: 1200, consumo_mensual: 300, solicitar: 'solicitar material' },
  // entre el mínimo y 1,5 × mínimo: MEDIO
  { id: 70, descripcion: 'Soda caustica', inventario: 140, stock_minimo: 100, consumo_mensual: 50, solicitar: null }
];

async function abrir(opts = {}) {
  const e = cargar({ pagina: 'login.html',
    scripts: ['supabase-config.js', 'subatir-app.js', 'recepcion-calc.js', 'reposicion-calc.js'],
    tablas: { inventario: opts.inv || INV, pedidos: opts.pedidos || [], entregas: opts.entregas || [],
              precios: [], proveedores: [], categorias: opts.categorias || [], art_proveedor: [], imp_pallets: [] } });
  const w = e.win, d = dom();
  w.document.getElementById = d.el;
  w.document.querySelectorAll = () => [];
  w.Chart = function () { return { destroy() {}, update() {} }; };
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    try { vm.runInContext(m[1], w, { filename: 'index.html' }); } catch (err) { /* intro, nav: no hacen a esto */ }
  }
  await drenar(); await drenar(); await drenar();
  return { e, w, d, run: (js) => vm.runInContext(js, w) };
}

describe('Dashboard: stock critico', () => {
  // La tarjeta "Stock Crítico" y el panel de la derecha se sacaron del
  // Dashboard el 28/11/2026 (pedido del usuario). La misma regla sigue
  // en el aviso rojo de arriba y en el ticker.
  test('el aviso y el ticker cuentan lo que esta bajo el minimo, no la columna SOLICITAR', async () => {
    const p = await abrir();
    const aviso = String(p.d.el('alert-text').textContent);
    assert.match(aviso, /^🔴 1 artículo\(s\) requieren reposición urgente: Botella Pet x 500 mL\.$/);
    assert.doesNotMatch(aviso, /Doypack/, 'el que sobra no es critico aunque diga "solicitar material"');
    assert.strictEqual(p.d.el('alert-banner').style.display, 'flex');
    assert.strictEqual(String(p.d.el('tk-crit').textContent), '1');
  });

  test('ya no se dibujan la tarjeta ni los paneles de stock critico y reposicion', async () => {
    const p = await abrir();
    assert.ok(!('kpi-critical' in p.d.els), 'nadie escribe en la tarjeta');
    assert.ok(!('stock-list' in p.d.els), 'nadie escribe en el panel');
    assert.ok(!('rep-list' in p.d.els) && !('rep-cnt' in p.d.els), 'Reposicion tambien se fue (vive en Stock)');
  });

  test('mismo semaforo que el modulo Stock', async () => {
    const p = await abrir();
    const S = p.w.SubatirApp.estadoStock;
    assert.strictEqual(S({ stock: 2992, minimo: 3000 }).estado, 'CRITICO');
    assert.strictEqual(S({ stock: 7000, minimo: 1200, solicitar: 'solicitar material' }).estado, 'OPTIMO');
    assert.strictEqual(S({ stock: 140, minimo: 100 }).estado, 'MEDIO');
    assert.strictEqual(S({ stock: 5, consumo: 20 }).estado, 'CRITICO');
    assert.strictEqual(S({ stock: 5, consumo: 20, pendiente: 25 }).estado, 'MEDIO', 'sin minimo cuenta el transito');
    assert.strictEqual(S({ stock: 0, solicitar: 'solicitar material' }).estado, 'CRITICO', 'SOLICITAR solo como ultimo recurso');
  });
});

describe('Dashboard: pedidos', () => {
  const PED = { id: 990, n_orden: '1078', fecha: '2026-11-20', proveedor: 'Alliance <b>Uruguay</b>',
    descripcion: 'Hipoclorito 130gr/L', cantidad: 100, precio_un: 1, moneda: '$', s_iva: 100, c_iva: 122,
    f_recepcion: '2026-11-25', lote: 'A126220', coa: 'SÍ', inventario_id: 106 };
  const CAT = [{ ext_id: 106, categoria: 'Materias Primas', producto: 'Hipoclorito 130gr/L' }];

  test('una entrega sin lote se reclama aunque la linea tenga otro lote (como Recepcion)', async () => {
    const p = await abrir({ pedidos: [PED], categorias: CAT, entregas: [
      { id: 1, pedido_id: 990, cantidad: 60, fecha: '2026-11-25', lote: 'A126220', coa: 'SI', checklist: {} },
      { id: 2, pedido_id: 990, cantidad: 40, fecha: '2026-11-25', lote: '', coa: 'SI', checklist: {} }] });
    p.run('esMP = function(){ return true; };');      // es materia prima
    const r = p.run('DATA.pedidos[0]');
    assert.strictEqual(p.w.faltaLote(r), true);
    const st = p.w.RecepcionCalc.lineStats(990, 100, '2026-11-25', p.run('ENTREGAS_POR_PEDIDO[990]'));
    assert.strictEqual(p.w.faltaLote(r), p.w.RecepcionCalc.faltaLote(true, st, 'A126220'), 'igual que Recepcion');
  });

  test('"SÍ" cuenta como COA y los textos de la base van escapados', async () => {
    const p = await abrir({ pedidos: [PED] });
    const tabla = p.d.el('tbody-pedidos').innerHTML;
    assert.match(tabla, /Alliance &lt;b&gt;Uruguay&lt;\/b&gt;/);
    assert.match(tabla, /pill-ok">✓</);
  });

  test('una linea con entrega parcial se ve como Parcial', async () => {
    const p = await abrir({ pedidos: [Object.assign({}, PED, { f_recepcion: null })],
      entregas: [{ id: 1, pedido_id: 990, cantidad: 30, fecha: '2026-11-25' }] });
    assert.match(p.d.el('tbody-pedidos').innerHTML, /Parcial · saldo 70/);
  });
});
