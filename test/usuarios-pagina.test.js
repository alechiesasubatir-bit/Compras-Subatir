// usuarios.html con el Supabase falso (26/11/2026):
//  · guardar cuando la base no deja (RLS: cero filas, sin error) decía
//    "Usuario actualizado"
//  · un admin podía quitarse el rol o desactivarse a sí mismo
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
    checked: false, disabled: false, style: {}, textContent: '', innerHTML: '', _clases: new Set(),
    get classList() { const c = this._clases; return { add: (x) => c.add(x), remove: (x) => c.delete(x), toggle() {}, contains: (x) => c.has(x) }; },
    focus() {}, addEventListener() {}, appendChild() {}
  });
  return { els, el };
}

const YO = { id: 'u-admin', email: 'a@x', full_name: 'Admin', role: 'admin', activo: true, modules: [] };
const OTRO = { id: 'u-2', email: 'b@x', full_name: 'Operario', role: 'user', activo: true, modules: ['pedidos'] };

async function abrir(opts = {}) {
  const e = cargar({ pagina: 'login.html', tablas: { profiles: [Object.assign({}, YO), Object.assign({}, OTRO)] }, rls: opts.rls });
  const w = e.win, d = dom();
  w.document.getElementById = d.el;
  w.document.querySelectorAll = () => [];
  const toasts = [];
  const html = fs.readFileSync(path.join(RAIZ, 'usuarios.html'), 'utf8');
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    try { vm.runInContext(m[1], w, { filename: 'usuarios.html' }); } catch (err) { /* sw */ }
  }
  w.toast = (t, tipo) => toasts.push([t, tipo]);
  w.SubatirApp.getProfile = () => YO;
  w.__U = [YO, OTRO];
  vm.runInContext('USERS = __U;', w);
  return { e, w, d, toasts, run: (js) => vm.runInContext(js, w) };
}

test('si la base no acepta el cambio, no dice "actualizado"', async () => {
  const p = await abrir({ rls: ['profiles'] });
  p.run('openM("u-2")');
  p.d.el('m-role').value = 'user'; p.d.el('m-activo').value = 'false';
  p.run('saveM()');
  await drenar();
  assert.ok(!p.toasts.some((t) => /actualizado/.test(t[0])), JSON.stringify(p.toasts));
  assert.ok(p.toasts.some((t) => t[1] === 'err'));
});

test('un admin no puede quitarse el rol ni desactivarse', async () => {
  const p = await abrir();
  p.run('openM("u-admin")');
  p.d.el('m-role').value = 'user'; p.d.el('m-activo').value = 'true';
  p.run('saveM()');
  await drenar();
  assert.strictEqual(p.e.db.profiles[0].role, 'admin');
  assert.ok(p.toasts.some((t) => t[1] === 'err'));
});

test('editar a otro usuario guarda', async () => {
  const p = await abrir();
  p.run('openM("u-2")');
  p.d.el('m-role').value = 'user'; p.d.el('m-activo').value = 'false';
  p.run('saveM()');
  await drenar();
  assert.strictEqual(p.e.db.profiles[1].activo, false);
  assert.ok(p.toasts.some((t) => /actualizado/.test(t[0])));
});
