// Integración: los scripts REALES de precios.html y proveedores.html con un
// DOM de mentira. Cubre lo que se encontró revisando el 26/11/2026:
//  · Proveedores: "Comprado USD" sumaba pesos y dólares; todo precio salía con "$"
//  · Proveedores: renombrar al editar creaba una ficha nueva en vez de actualizar
//  · Precios y Proveedores: dos toques en Guardar escribían dos veces
//  · Precios: "1.234,50" se leía 1,234
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { cargar, drenar, RAIZ } = require('./helpers/entorno.js');

function dom() {
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, _v: '', get value() { return this._v; }, set value(x) { this._v = x == null ? '' : String(x); }, checked: false, disabled: false, style: {}, textContent: '', innerHTML: '', options: [],
    _clases: new Set(),
    get classList() { const c = this._clases; return { add: (x) => c.add(x), remove: (x) => c.delete(x), toggle() {}, contains: (x) => c.has(x) }; },
    firstElementChild: { style: {} },
    focus() {}, select() {}, blur() {}, addEventListener() {}, closest() { return null; }, appendChild() {}, scrollIntoView() {}
  });
  return { els, el };
}

function abrir(pagina) {
  const e = cargar({ pagina: 'login.html', scripts: ['supabase-config.js', 'subatir-app.js'], tablas: {} });
  const w = e.win, d = dom();
  w.document.getElementById = d.el;
  w.document.querySelectorAll = () => [];
  w.document.createElement = () => ({ style: {}, appendChild() {} });
  w.confirm = () => true; w.alert = () => {};
  w.Chart = function () { return { destroy() {}, update() {} }; };
  const html = fs.readFileSync(path.join(RAIZ, pagina), 'utf8');
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    try { vm.runInContext(m[1], w, { filename: pagina }); } catch (err) { /* nav/intro */ }
  }
  w.load = () => {}; w.toast = () => {};
  // write que queda colgado hasta que se lo suelta: así se ve el doble toque
  const escrituras = [];
  w.SubatirApp.write = (p) => new Promise((res) => escrituras.push({ p, res }));
  return { e, w, d, escrituras, run: (js) => vm.runInContext(js, w) };
}

// Filas en formato hoja, como las arma getData
const CTT = [{ __row: 7, Empresa: 'Quimica Oriental S.A.', Rubro: '<b>Quimicos</b>', Email: 'x@y' }];
const PED = [
  { __row: 1, 'N° Orden': '1047', Fecha: '2026-10-29', Proveedor: 'Quimica Oriental S.A.', 'Descripción': 'Propilenglicol',
    Cantidad: 60, 'Precio un': 2.72, '$/U$S': 'U$S', 'c/iva': 199.1, 'F.Recepción': '2026-11-02', COA: 'SI', Conforme: 'SI' },
  { __row: 2, 'N° Orden': '1050', Fecha: '2026-11-01', Proveedor: 'Quimica Oriental S.A.', 'Descripción': 'Soda',
    Cantidad: 10, 'Precio un': 1000, '$/U$S': '$', 'c/iva': 12200, 'F.Recepción': '', COA: '', Conforme: '' }
];
const PRC = [{ __row: 169, ARTICULO: 'Propilenglicol', PROVEEDOR: 'Quimica Oriental S.A.', 'PRECIO S/IVA U$S': 2.16, 'PRECIO S/IVA $': null }];

describe('proveedores.html', () => {
  function prov() {
    const p = abrir('proveedores.html');
    p.w.__C = CTT; p.w.__P = PED; p.w.__R = PRC;
    p.run('RAW_CTT=__C; RAW_PED=__P; RAW_PRC=__R; detectCttKeys(); buildProvs();');
    return p;
  }

  test('lo comprado va por moneda, sin sumar pesos y dolares', () => {
    const p = prov();
    const q = p.run('PROVS["QUIMICA ORIENTAL S.A."]');
    assert.strictEqual(q.totUSD, 199.1);
    assert.strictEqual(q.totPSO, 12200);
    assert.strictEqual(p.run('fmtTot(PROVS["QUIMICA ORIENTAL S.A."])'), 'U$S 199 · $ 12,200');
  });

  test('el precio de lista en dolares se muestra como U$S', () => {
    const p = prov();
    p.run('renderDetail(PROVS["QUIMICA ORIENTAL S.A."])');
    const html = p.d.el('pdetail').innerHTML;
    assert.match(html, /art-price">U\$S 2\.16/);
    assert.match(html, /U\$S 2\.72/, 'precio de la OC con su moneda');
    assert.match(html, /\$ 1,000\.00/);
  });

  test('la tasa de conformes cuenta solo lo recibido', () => {
    const p = prov();
    assert.strictEqual(p.run('PROVS["QUIMICA ORIENTAL S.A."].confRate'), 100);
  });

  test('el rubro va escapado', () => {
    const p = prov();
    p.run('renderList(); renderDetail(PROVS["QUIMICA ORIENTAL S.A."])');
    assert.doesNotMatch(p.d.el('pdetail').innerHTML, /<b>Quimicos/);
  });

  test('renombrar al editar actualiza la misma ficha, y dos toques escriben una vez', () => {
    const p = prov();
    p.run('openModal("QUIMICA ORIENTAL S.A.")');
    p.d.el('m-empresa').value = 'Química Oriental SA';
    p.run('saveProveedor(); saveProveedor();');
    assert.strictEqual(p.escrituras.length, 1);
    assert.strictEqual(p.escrituras[0].p.action, 'updateRow');
    assert.strictEqual(String(p.escrituras[0].p.row), '7');
  });
});

describe('precios.html', () => {
  function prec() {
    const p = abrir('precios.html');
    p.w.__R = [{ __row: 169, FECHA: '2026-05-01', ARTICULO: 'Propilenglicol', PROVEEDOR: 'Quimica Oriental S.A.', 'PRECIO S/IVA U$S': 2.16 }];
    p.run('RAW_SERVER=__R; RAW=__R; detectKeys();');
    return p;
  }

  test('dos toques en Guardar escriben una sola vez', async () => {
    const p = prec();
    p.run('openEdit(169)');
    p.d.el('ed-ficha-box').style.display = 'none';
    p.run('saveEdit(); saveEdit();');
    await drenar();
    assert.strictEqual(p.escrituras.length, 1);
    assert.strictEqual(p.d.el('ed-save').disabled, true, 'bloqueado mientras guarda');
    p.escrituras[0].res({ success: true });
    await drenar(); await drenar();
    assert.strictEqual(p.d.el('ed-save').disabled, false);
  });

  test('un precio escrito con miles se lee entero', () => {
    const p = prec();
    assert.strictEqual(p.run('pn("1.234,50")'), 1234.5);
    assert.strictEqual(p.run('pn("U$S 2,16")'), 2.16);
  });

  test('la fecha de un precio nuevo es la de hoy en la PC, no la UTC', () => {
    const p = prec();
    const d = new Date(), q = (n) => (n < 10 ? '0' : '') + n;
    assert.strictEqual(p.run('hoyLocal()'), d.getFullYear() + '-' + q(d.getMonth() + 1) + '-' + q(d.getDate()));
  });
});
