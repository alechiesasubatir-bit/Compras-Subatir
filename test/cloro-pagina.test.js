// cloro.html: la semana "actual" sale del día de la PC, no del día UTC.
// Hasta el 26/11/2026 el domingo después de las 21 h (ya lunes en UTC) la
// pantalla pasaba a la semana siguiente. Se toman las funciones REALES de
// la página y se corren con un reloj fijo en hora de Montevideo.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Cloro } = require('../cloro-calc.js');

process.env.TZ = 'America/Montevideo';

function funcion(src, nombre) {
  const i = src.indexOf('function ' + nombre + '(');
  if (i < 0) return '';
  let j = src.indexOf('{', i), n = 0;
  for (; j < src.length; j++) { if (src[j] === '{') n++; else if (src[j] === '}' && --n === 0) break; }
  return src.slice(i, j + 1);
}

function contexto(ahoraISO) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'cloro.html'), 'utf8');
  const Real = Date;
  class Fijo extends Real {
    constructor(...a) { if (a.length) super(...a); else super(ahoraISO); }
    static now() { return new Real(ahoraISO).getTime(); }
  }
  const ctx = { Date: Fijo, Cloro, Math, String, NSEM: 36, dIni: (t) => new Real(t.fecha_ini + 'T00:00:00Z') };
  vm.createContext(ctx);
  ['hoyISO', 'hoyUTC', 'semanaHoy'].forEach((f) => vm.runInContext(funcion(html, f), ctx));
  return ctx;
}

const T = { fecha_ini: '2026-08-01' };   // semana 1 arranca el lunes 27/07/2026

test('domingo 22:30 en Uruguay sigue siendo la semana del domingo', () => {
  // 29/11/2026 domingo 22:30 en Montevideo = 30/11 01:30 UTC (lunes)
  const c = contexto('2026-11-30T01:30:00Z');
  assert.strictEqual(c.hoyISO(), '2026-11-29');
  const domingo = c.semanaHoy(T);
  const lunes = contexto('2026-11-30T12:00:00Z').semanaHoy(T);
  assert.strictEqual(lunes - domingo, 1, 'cambia el lunes, no el domingo a la noche');
});
