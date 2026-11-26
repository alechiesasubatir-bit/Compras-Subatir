// Integración: el script REAL de recepcion.html (y el de pedidos.html),
// con un DOM de mentira y el Supabase falso. Reproduce lo que pasó en
// octubre 2026: la misma entrega registrada 2 y 3 veces porque el
// formulario quedaba abierto y el botón habilitado mientras se sumaba
// al stock.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { cargar, drenar, RAIZ } = require('./helpers/entorno.js');

// Elementos que recuerdan su estado (value, checked, disabled, clase open)
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

function abrirPagina(pagina, opts) {
  const e = cargar({ pagina: 'login.html',   // sin guard: la página se maneja a mano
    scripts: ['supabase-config.js', 'subatir-app.js', 'recepcion-calc.js'],
    tablas: { entregas: opts.entregas || [], pedidos: [], inventario: [] } });
  const w = e.win, d = dom();
  w.document.getElementById = d.el;
  w.document.querySelectorAll = () => [];
  w.confirm = (msg) => { e.confirmaciones.push(msg); return opts.confirmar !== false; };
  w.alert = () => {};
  e.confirmaciones = [];
  const html = fs.readFileSync(path.join(RAIZ, pagina), 'utf8');
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(m[1], w, { filename: pagina });

  // Lo que no se prueba acá: check list (formulario) y la suma al stock,
  // que se demora como en un celular con mala señal.
  e.sumas = [];
  Object.assign(w.SubatirApp.PL06, { read: () => [], validate: () => true, factura: () => null, remito: () => null,
    esErrorDeEsquema: () => false, mount() {}, setHead() {}, resumen: () => null, fill() {} });
  w.SubatirApp.stock.sumarAlRecibir = (o) => { e.sumas.push(o.cantidad); setTimeout(o.luego, 300); };
  w.load = () => {};               // no recargar desde la base en el medio

  const fila = { __row: 1023, 'N° Orden': '1023', Fecha: '2026-10-16', Proveedor: 'P', Cantidad: 2000,
    'Descripción': 'Metabisulfito ( PH-)', 'F.Recepción': '', 'ID Inventario': 100 };
  vm.runInContext('detectKeys([' + JSON.stringify(fila) + ']); DATA_RAW=[' + JSON.stringify(fila) +
    ']; DATA_DISPLAY=DATA_RAW.slice(); ENTREGAS=' + JSON.stringify(opts.entregas || []) + '; buildEntregasMap();', w);
  return { e, w, d };
}

// Un toque en el botón: sólo si se ve y está habilitado, como en el navegador
function tocar(p, modal) {
  const btn = p.d.el('btn-save-entrega');
  if (btn.disabled || !p.d.el(modal).classList.contains('open')) return false;
  vm.runInContext('saveEntrega()', p.w);
  return true;
}

for (const [pagina, modal] of [['recepcion.html', 'edit-overlay'], ['pedidos.html', 'entrega-overlay']]) {
  describe(pagina + ': registrar una entrega', () => {
    test('tocar "Registrar" de nuevo mientras suma al stock no duplica la entrega', async () => {
      const p = abrirPagina(pagina, {});
      vm.runInContext('openEntrega(1023)', p.w);
      p.d.el('en-conforme').checked = true;            // no es MP: sin check list
      p.d.el('en-lote').value = '260XA00956';
      assert.ok(tocar(p, modal));
      await new Promise(r => setTimeout(r, 30));       // ya guardó, todavía está sumando
      tocar(p, modal); tocar(p, modal);                // los toques de más
      await drenar(); await new Promise(r => setTimeout(r, 350));
      assert.strictEqual(p.e.db.entregas.length, 1, 'entregas registradas');
      assert.deepStrictEqual(p.e.sumas, [2000], 'sumas al stock');
    });

    test('volver a abrir la linea y registrar lo mismo pide confirmacion', async () => {
      const p = abrirPagina(pagina, { confirmar: false });
      vm.runInContext('openEntrega(1023)', p.w);
      p.d.el('en-conforme').checked = true;
      p.d.el('en-lote').value = 'L1';
      p.d.el('en-cant').value = '800';
      tocar(p, modal);
      await drenar(); await new Promise(r => setTimeout(r, 350));
      vm.runInContext('openEntrega(1023)', p.w);       // reabre antes de que recargue
      assert.strictEqual(p.d.el('en-cant').value, 1200, 'el saldo ya descuenta la entrega recién hecha');
      p.d.el('en-conforme').checked = true;
      p.d.el('en-lote').value = 'L1';
      p.d.el('en-cant').value = '800';
      tocar(p, modal);
      await drenar();
      assert.strictEqual(p.e.confirmaciones.length, 1);
      assert.match(p.e.confirmaciones[0], /entrega igual/);
      assert.strictEqual(p.e.db.entregas.length, 1, 'dijo que no: no se registra');
    });

    test('la fecha propuesta es la de hoy en hora local', () => {
      const p = abrirPagina(pagina, {});
      vm.runInContext('openEntrega(1023)', p.w);
      assert.strictEqual(p.d.el('en-fecha').value, p.w.RecepcionCalc.hoyLocal());
    });

    test('si la base rechaza la entrega, el boton vuelve a habilitarse', async () => {
      const p = abrirPagina(pagina, {});
      p.w.SubatirApp.addEntrega = () => Promise.resolve({ error: 'sin permiso' });
      vm.runInContext('openEntrega(1023)', p.w);
      p.d.el('en-conforme').checked = true;
      tocar(p, modal);
      await drenar();
      assert.strictEqual(p.d.el('btn-save-entrega').disabled, false);
      assert.deepStrictEqual(p.e.sumas, []);
    });
  });
}
