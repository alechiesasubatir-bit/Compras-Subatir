// ============================================================
//  tema.js — modo claro (27–28/11/2026)
//
//  Sin navegador: hojas de estilo y style="" simulados, con lo
//  justo de CSSOM que usa tema.js (length/índice, getPropertyValue,
//  getPropertyPriority, setProperty, cssText).
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'tema.js'), 'utf8');

// Declaración de estilo mínima. `props` en orden; los valores tal cual.
function estilo(props, cssText) {
  const v = Object.assign({}, props), prio = {};
  const st = {
    getPropertyValue(p) { return v[p] || ''; },
    getPropertyPriority(p) { return prio[p] || ''; },
    setProperty(p, val, pr) { if (!(p in v)) orden.push(p); v[p] = val; prio[p] = pr || ''; sync(); },
    cssText: cssText || ''
  };
  const orden = Object.keys(v);
  function sync() {
    st.length = orden.length;
    orden.forEach(function (p, i) { st[i] = p; });
  }
  sync();
  return st;
}

function entorno(opts) {
  opts = opts || {};
  const attrs = {};
  const oyentes = {};
  const store = Object.assign({}, opts.storage);
  const hojas = (opts.hojas || []).concat((opts.reglas || []).map(function (st) { return { cssRules: [{ style: st }] }; }));
  const observadores = [];
  const html = {
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    setAttribute(k, v) { attrs[k] = String(v); }
  };
  const document = {
    documentElement: html,
    head: { appendChild() { } },
    body: opts.body || null,
    styleSheets: hojas,
    createElement(tag) {
      const el = { tagName: tag.toUpperCase(), attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
      return el;
    },
    querySelector() { return null; },
    addEventListener(ev, fn) { (oyentes['doc:' + ev] = oyentes['doc:' + ev] || []).push(fn); }
  };
  const window = {
    MutationObserver: function (cb) { this.cb = cb; this.observe = function () { }; this.disconnect = function () { }; observadores.push(this); },
    addEventListener(ev, fn) { (oyentes['win:' + ev] = oyentes['win:' + ev] || []).push(fn); },
    dispatchEvent() { }
  };
  const ctx = {
    window, document,
    localStorage: { getItem(k) { return k in store ? store[k] : null; }, setItem(k, v) { store[k] = String(v); } },
    WeakSet, WeakMap, CustomEvent: function () { },
    MutationObserver: window.MutationObserver
  };
  window.window = window;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return {
    tema: window.SubatirTema, html, store, hojas,
    mutar(registros) { observadores.forEach(function (o) { o.cb(registros); }); },
    disparar(clave, ev) { (oyentes[clave] || []).forEach(function (f) { f(ev); }); }
  };
}

test('arrancar en claro convierte fondos oscuros y textos pastel; volver a oscuro deja todo igual', function () {
  const tarjeta = estilo({ 'background-color': '#0c1119', color: '#fca5a5', 'border-top-color': 'rgba(255,255,255,.07)' });
  const e = entorno({ storage: { 'sb-tema': 'claro' }, reglas: [tarjeta] });
  assert.equal(e.html.getAttribute('data-tema'), 'claro');
  const fondo = tarjeta.getPropertyValue('background-color');
  assert.match(fondo, /^rgb\(2[2-5]\d, 2[2-5]\d, 2[2-5]\d\)$/, 'fondo claro: ' + fondo);
  const letra = tarjeta.getPropertyValue('color');
  const [r, g, b] = letra.match(/\d+/g).map(Number);
  assert.ok(r > g && r > b && r < 200, 'rojo oscuro: ' + letra);
  assert.match(tarjeta.getPropertyValue('border-top-color'), /^rgba\(15, 23, 42,/);

  e.tema.poner('oscuro');
  assert.equal(tarjeta.getPropertyValue('background-color'), '#0c1119');
  assert.equal(tarjeta.getPropertyValue('color'), '#fca5a5');
  assert.equal(tarjeta.getPropertyValue('border-top-color'), 'rgba(255,255,255,.07)');
  assert.equal(e.store['sb-tema'], 'oscuro');
});

test('blanco sobre botón de color queda blanco; sobre tinte suave de --c pasa a oscuro', function () {
  const boton = estilo({ background: 'var(--orange)', color: '#fff' });
  const pestana = estilo({ background: 'linear-gradient(158deg,rgba(var(--c),.36),rgba(var(--c),.13) 75%)', color: '#fff' });
  entorno({ storage: { 'sb-tema': 'claro' }, reglas: [boton, pestana] });
  assert.equal(boton.getPropertyValue('color'), '#fff');
  assert.notEqual(pestana.getPropertyValue('color'), '#fff');
});

test('en oscuro no se toca nada', function () {
  const r = estilo({ 'background-color': '#0c1119', color: '#e2e8f0' });
  const e = entorno({ reglas: [r] });
  assert.equal(e.tema.actual(), 'oscuro');
  assert.equal(r.getPropertyValue('background-color'), '#0c1119');
  assert.equal(r.getPropertyValue('color'), '#e2e8f0');
});

test('si se vuelve a oscuro antes de terminar la carga, DOMContentLoaded y load no convierten', function () {
  const e = entorno({ storage: { 'sb-tema': 'claro' } });
  e.tema.poner('oscuro');
  const tarde = estilo({ 'background-color': '#111926' });
  e.hojas.push({ cssRules: [{ style: tarde }] });
  e.disparar('doc:DOMContentLoaded');
  e.disparar('win:load');
  assert.equal(tarde.getPropertyValue('background-color'), '#111926');
});

test('una hoja que llega tarde se convierte en el load si sigue en claro', function () {
  const e = entorno({ storage: { 'sb-tema': 'claro' } });
  const tarde = estilo({ 'background-color': '#111926' });
  e.hojas.push({ cssRules: [{ style: tarde }] });
  e.disparar('win:load');
  assert.notEqual(tarde.getPropertyValue('background-color'), '#111926');
});

test('style="" que la página vuelve a tocar: lo nuestro no se reconvierte (la sombra no se va aclarando)', function () {
  const st = estilo({ 'box-shadow': '0 8px 24px rgba(0,0,0,.6)', 'background-color': 'rgba(255,255,255,.05)', color: '#fca5a5' });
  const el = {
    nodeType: 1, style: st,
    getAttribute(k) { return k === 'style' ? ['box-shadow', 'background-color', 'color', 'width'].map(function (p) { return st.getPropertyValue(p); }).join(';') : null; },
    querySelectorAll() { return []; }
  };
  const body = { nodeType: 1, style: null, getAttribute() { return null; }, querySelectorAll() { return [el]; } };
  const e = entorno({ body });
  e.tema.poner('claro');
  const sombra1 = st.getPropertyValue('box-shadow');
  const fondo1 = st.getPropertyValue('background-color');
  assert.notEqual(sombra1, '0 8px 24px rgba(0,0,0,.6)');

  // la página cambia el ancho varias veces: el observador ve el style cambiado
  for (let k = 1; k <= 5; k++) {
    st.setProperty('width', (k * 10) + '%');
    e.mutar([{ type: 'attributes', target: el }]);
  }
  assert.equal(st.getPropertyValue('box-shadow'), sombra1);
  assert.equal(st.getPropertyValue('background-color'), fondo1);

  // la página pone un color nuevo: ése sí se convierte
  st.setProperty('color', '#86efac');
  e.mutar([{ type: 'attributes', target: el }]);
  assert.notEqual(st.getPropertyValue('color'), '#86efac');

  // y volver a oscuro restaura lo original de lo que no tocó la página
  e.tema.poner('oscuro');
  assert.equal(st.getPropertyValue('box-shadow'), '0 8px 24px rgba(0,0,0,.6)');
  assert.equal(st.getPropertyValue('background-color'), 'rgba(255,255,255,.05)');
  assert.equal(st.getPropertyValue('color'), '#86efac');
});

test('título con degradé en la letra: se lee del texto de la regla y se oscurece', function () {
  const titulo = estilo({ 'background-clip': 'text', '-webkit-text-fill-color': 'transparent' },
    'background-image: linear-gradient(100deg, #e9f6ff, var(--teal-l)); background-clip: text;');
  const e = entorno({ storage: { 'sb-tema': 'claro' }, reglas: [titulo] });
  const g = titulo.getPropertyValue('background-image');
  assert.match(g, /^linear-gradient\(100deg, rgb\(\d+, \d+, \d+\), var\(--teal-l\)\)$/);
  assert.doesNotMatch(g, /#e9f6ff/);
  e.tema.poner('oscuro');
  assert.equal(titulo.getPropertyValue('background-image'), 'linear-gradient(100deg, #e9f6ff, var(--teal-l))');
});

test('la impresión queda como está', function () {
  const imp = estilo({ 'background-color': '#0c1119' });
  const pant = estilo({ 'background-color': '#0c1119' });
  entorno({ storage: { 'sb-tema': 'claro' }, hojas: [{ cssRules: [
    { media: { mediaText: 'print' }, cssRules: [{ style: imp }] },
    { media: { mediaText: 'screen and (max-width:760px)' }, cssRules: [{ style: pant }] }
  ] }] });
  assert.equal(imp.getPropertyValue('background-color'), '#0c1119');
  assert.notEqual(pant.getPropertyValue('background-color'), '#0c1119');
});

// ── Modo gris (28/11/2026): como claro pero sin blancos ──────
function luz(rgb) {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
}

test('gris: los fondos oscuros llegan a un gris medio, no a blanco', function () {
  const tarjeta = estilo({ 'background-color': '#0c1119', color: '#fca5a5' });
  entorno({ storage: { 'sb-tema': 'gris' }, reglas: [tarjeta] });
  const l = luz(tarjeta.getPropertyValue('background-color'));
  assert.ok(l > .78 && l < .9, 'gris intermedio, luz ' + l.toFixed(2));
  assert.notEqual(tarjeta.getPropertyValue('color'), '#fca5a5', 'el texto pastel igual se oscurece');
});

test('gris apaga los blancos sólidos; claro los deja', function () {
  const enGris = estilo({ 'background-color': '#ffffff' });
  entorno({ storage: { 'sb-tema': 'gris' }, reglas: [enGris] });
  const l = luz(enGris.getPropertyValue('background-color'));
  assert.ok(l < .92, 'blanco → gris perla, luz ' + l.toFixed(2));

  const enClaro = estilo({ 'background-color': '#ffffff' });
  entorno({ storage: { 'sb-tema': 'claro' }, reglas: [enClaro] });
  assert.equal(enClaro.getPropertyValue('background-color'), '#ffffff');
});

test('el botón recorre oscuro → claro → gris → oscuro y al final todo queda como estaba', function () {
  const r = estilo({ 'background-color': '#0c1119', color: '#e2e8f0', 'box-shadow': '0 8px 24px rgba(0,0,0,.6)' });
  const blanco = estilo({ 'background-color': '#fff' });
  const e = entorno({ reglas: [r, blanco] });
  const b = e.tema.boton();
  const original = ['background-color', 'color', 'box-shadow'].map(function (p) { return r.getPropertyValue(p); });

  assert.equal(e.tema.actual(), 'oscuro');
  b.onclick();
  assert.equal(e.tema.actual(), 'claro');
  const fondoClaro = r.getPropertyValue('background-color');
  b.onclick();
  assert.equal(e.tema.actual(), 'gris');
  const fondoGris = r.getPropertyValue('background-color');
  assert.ok(luz(fondoGris) < luz(fondoClaro), 'gris más oscuro que claro');
  assert.notEqual(blanco.getPropertyValue('background-color'), '#fff', 'en gris el blanco se apaga');
  b.onclick();
  assert.equal(e.tema.actual(), 'oscuro');
  assert.deepEqual(['background-color', 'color', 'box-shadow'].map(function (p) { return r.getPropertyValue(p); }), original);
  assert.equal(blanco.getPropertyValue('background-color'), '#fff');
  assert.equal(e.store['sb-tema'], 'oscuro');
});

test('el botón dice a qué modo pasa', function () {
  const e = entorno();
  const b = e.tema.boton();
  assert.match(b.innerHTML, /Modo claro/);
  e.tema.poner('claro');
  assert.match(b.innerHTML, /Modo gris/);
  e.tema.poner('gris');
  assert.match(b.innerHTML, /Modo oscuro/);
});

test('un valor raro guardado arranca en oscuro', function () {
  const r = estilo({ 'background-color': '#0c1119' });
  const e = entorno({ storage: { 'sb-tema': 'azul' }, reglas: [r] });
  assert.equal(e.tema.actual(), 'oscuro');
  assert.equal(r.getPropertyValue('background-color'), '#0c1119');
});

test('seguir el cambio de otra pestaña no vuelve a guardar (una versión vieja pisaba la elección)', function () {
  const r = estilo({ 'background-color': '#0c1119' });
  const e = entorno({ reglas: [r] });
  // otra pestaña guardó gris
  e.store['sb-tema'] = 'gris';
  e.disparar('win:storage', { key: 'sb-tema' });
  assert.equal(e.tema.actual(), 'gris');
  assert.notEqual(r.getPropertyValue('background-color'), '#0c1119');
  // otra pestaña guardó algo que esta versión no conoce: se sigue en oscuro
  // pero NO se pisa lo guardado
  e.store['sb-tema'] = 'sepia';
  e.disparar('win:storage', { key: 'sb-tema' });
  assert.equal(e.tema.actual(), 'oscuro');
  assert.equal(e.store['sb-tema'], 'sepia');
});
