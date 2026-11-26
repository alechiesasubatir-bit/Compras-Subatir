// Integración: el script REAL de stock.html con un DOM de mentira y el
// Supabase falso. Cubre lo que se encontró revisando Stock (26/11/2026):
//  · el KPI "Valor en tránsito" sumaba pesos y dólares en un solo "$"
//  · Editar reescribía el stock con el número de cuando se abrió la
//    pantalla y grababa el proveedor de la última OC como sugerido
//  · el Control de Stock leía "1.234,5" como 1,234
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
    focus() {}, select() {}, blur() {}, addEventListener() {}, closest() { return null; }, appendChild() {}
  });
  return { els, el };
}

// Inventario y OC con los encabezados que arma getData (formato hoja)
const INV = [{ __row: 33, CODIGO: 'B33', 'DESCRIPCIÓN': 'Botella Pet 500 mL', INVENTARIO: 2992,
  'STOCK MÍNIMO': 500, 'CONSUMO MENSUAL': 800, 'PROOVEDOR SUGERIDO': 'Envases Sur', PROVEEDOR: '' }];
const OC = (o) => Object.assign({ __row: 1, 'N° Orden': '1100', Fecha: '2026-11-20', Proveedor: 'Plasticos SA',
  'Descripción': 'Botella Pet 500 mL', Cantidad: 1000, 'Precio un': 0.1, '$/U$S': 'U$S', 'F.Recepción': '',
  'ID Inventario': 33 }, o);

function abrir(opts = {}) {
  const e = cargar({ pagina: 'login.html',
    scripts: ['supabase-config.js', 'subatir-app.js', 'reposicion-calc.js'],
    tablas: { inventario: [{ id: 33, descripcion: 'Botella Pet 500 mL', inventario: 2992, stock_minimo: 500 }] } });
  const w = e.win, d = dom();
  w.document.getElementById = d.el;
  w.document.querySelectorAll = () => [];
  w.confirm = () => true; w.alert = () => {};
  const html = fs.readFileSync(path.join(RAIZ, 'stock.html'), 'utf8');
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(m[1], w, { filename: 'stock.html' });
  w.load = () => {};
  w.renderChart = () => {};
  const run = (js) => vm.runInContext(js, w);
  w.__INV = opts.inv || INV; w.__PED = opts.ped || [];
  run('RAW_INV=__INV; RAW_PED=__PED; RAW_ENT=[]; RAW_PREC=[]; RAW_PROVS=[]; detectKeys(); buildMerged(); renderAll();');
  return { e, w, d, run };
}

describe('stock.html: valor en transito', () => {
  test('pesos y dolares no se suman en un solo numero', () => {
    const p = abrir({ ped: [
      OC({ __row: 1, Cantidad: 1000, 'Precio un': 0.1, '$/U$S': 'U$S' }),                 // U$S 100
      OC({ __row: 2, 'Descripción': 'Etiqueta frente', 'ID Inventario': null,
           Cantidad: 5000, 'Precio un': 2, '$/U$S': '$' })                                   // $ 10.000 (sin ficha)
    ] });
    const txt = p.d.el('k-transit').innerHTML;
    assert.match(txt, /U\$S 100/);
    assert.match(txt, /\$ 10\.000/);
    assert.doesNotMatch(txt, /10\.100/, 'no aparece la suma mezclada');
  });

  test('la capa compartida separa las monedas por articulo', () => {
    const p = abrir();
    const tr = p.w.SubatirApp.transito(INV, [OC({ __row: 1 }), OC({ __row: 2, Cantidad: 10, 'Precio un': 50, '$/U$S': '$' })], []);
    assert.strictEqual(tr.de(33).valorUSD, 100);
    assert.strictEqual(tr.de(33).valorPSO, 500);
  });
});

describe('stock.html: editar un articulo', () => {
  test('cambiar el minimo no reescribe el stock ni el proveedor sugerido', async () => {
    const p = abrir({ ped: [OC({ 'F.Recepción': '2026-11-21' })] });       // última OC: Plasticos SA
    p.run("openEdit('Botella Pet 500 mL')");
    assert.strictEqual(p.d.el('ed-prov').value, 'Plasticos SA', 'el formulario arranca con el de la ultima OC');
    p.e.db.inventario[0].inventario = 4992;            // mientras tanto Recepción sumó 2000
    p.d.el('ed-min').value = '600';
    p.run('saveEdit()');
    await drenar();
    const fila = p.e.db.inventario[0];
    assert.strictEqual(fila.stock_minimo, 600);
    assert.strictEqual(fila.inventario, 4992, 'el stock sumado no se pisa');
    assert.ok(!('proveedor_sugerido' in fila), 'no se grabó el proveedor de la ultima OC');
  });

  test('corregir el stock a mano si se guarda', async () => {
    const p = abrir();
    p.run("openEdit('Botella Pet 500 mL')");
    p.d.el('ed-stock').value = '2500';
    p.run('saveEdit()');
    await drenar();
    assert.strictEqual(p.e.db.inventario[0].inventario, 2500);
  });
});

describe('stock.html: Control de Stock', () => {
  const casos = [['1.234,5', 1234.5], ['2,5', 2.5], ['2,500', 2.5], ['0,250', 0.25], ['1.500', 1.5],
                 ['120', 120], [' 3 ', 3], ['', null]];
  for (const [txt, esperado] of casos) {
    test('lo contado "' + txt + '" -> ' + esperado, () => {
      const p = abrir();
      assert.strictEqual(p.w.cntNum(txt), esperado);
    });
  }
  test('texto sin numero no es una cantidad', () => {
    const p = abrir();
    assert.ok(Number.isNaN(p.w.cntNum('abc')));
  });
});
