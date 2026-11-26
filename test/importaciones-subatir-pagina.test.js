// importaciones.html?linea=Subatir: Consumo y, debajo, los artículos de
// Venta que se importan con la misma corrida (26/11/2026).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { cargar, drenar, RAIZ } = require('./helpers/entorno.js');

function dom() {
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, _v: '', get value() { return this._v; }, set value(x) { this._v = x == null ? '' : String(x); },
    checked: false, disabled: false, indeterminate: false, style: {}, textContent: '', innerHTML: '', options: [], selectedIndex: 0,
    _clases: new Set(),
    get classList() { const c = this._clases; return { add: (x) => c.add(x), remove: (x) => c.delete(x), toggle() {}, contains: (x) => c.has(x) }; },
    focus() {}, addEventListener() {}, appendChild() {}, getBoundingClientRect() { return { height: 0 }; }
  });
  return { els, el };
}

const ART = [
  { id: 1, codigo: '220001', descripcion: 'Bolsa consumo', proveedor: 'Subatir', tipo: 'Consumo', activo: true },
  { id: 143, codigo: '490187', descripcion: 'Humidifer Modelo 1 220 mL SD05', proveedor: 'Subatir', tipo: 'Venta', activo: true },
  { id: 136, codigo: '490192', descripcion: 'Hornito Chico ROSA (Subatir)', proveedor: 'Subatir', tipo: 'Venta', activo: true },
  { id: 126, codigo: '490115', descripcion: 'Equipo Aromatizador PRL Fun (blanco)', proveedor: 'Subatir', tipo: 'Venta', activo: true },
  { id: 50, codigo: '490159', descripcion: 'Escoba y Pala', proveedor: 'Mopas', tipo: 'Venta', activo: true }
];
const PAR = { linea: 'Subatir', crecimiento_pct: 10, semanas_seguridad: 4, semanas_leadtime: 12, meses_cobertura: 4 };

async function abrir(corridas, datos) {
  const e = cargar({ pagina: 'login.html', scripts: ['supabase-config.js', 'subatir-app.js', 'importaciones-calc.js'],
    tablas: { imp_prev_parametros: [PAR], imp_prev_corridas: corridas, imp_articulos: ART, imp_stock: [], imp_prev_datos: datos } });
  const w = e.win, d = dom();
  w.document.getElementById = d.el;
  w.document.querySelectorAll = () => [];
  w.document.querySelector = () => null;
  const html = fs.readFileSync(path.join(RAIZ, 'importaciones.html'), 'utf8');
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    try { vm.runInContext(m[1], w, { filename: 'importaciones.html' }); } catch (err) { /* nav, sw */ }
  }
  const run = (js) => vm.runInContext(js, w);
  run('LINEA="Subatir"; LIN=LINEAS.Subatir;');
  await run('cargar()'); await drenar();
  return { e, w, d, run };
}

test('los de Venta van debajo de Consumo, y los Aromatizadores no entran', async () => {
  const p = await abrir([{ id: 9, linea: 'Subatir', nombre: 'Dic', fecha: '2026-12-01', cerrada: false }], []);
  const fs_ = p.run('visibles().map(function(f){ return grupoDe(f.art)+":"+f.art.codigo; })');
  assert.deepStrictEqual(Array.from(fs_), ['Consumo:220001', 'Venta:490192', 'Venta:490187']);
  const html = p.d.el('tbody').innerHTML;
  assert.ok(html.indexOf('class="grp"') >= 0);
  assert.ok(html.indexOf('>Consumo<') < html.indexOf('>Venta<'), 'Consumo arriba, Venta abajo');
  assert.doesNotMatch(html, /Aromatizador|Escoba/);
});

test('una corrida cerrada no gana los renglones nuevos', async () => {
  const p = await abrir([{ id: 8, linea: 'Subatir', nombre: 'Nov', fecha: '2026-11-25', cerrada: true }],
    [{ corrida_id: 8, articulo_id: 1, consumo_3m: 30, consumo_anual: 120, stock_actual: 10, en_transito: 0, incluir: true }]);
  assert.strictEqual(p.run('filas().length'), 1);
});
