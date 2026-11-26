// Importaciones (MERO AR y líneas de Depósitos): las fechas que se
// proponen salen del día de la PC. Hasta el 26/11/2026 salían de la fecha
// UTC: de noche, la corrida nueva quedaba con fecha de mañana y, el último
// día del mes, la oferta se cargaba en el mes siguiente.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.TZ = 'America/Montevideo';

function funcion(src, nombre) {
  const i = src.indexOf('function ' + nombre + '(');
  if (i < 0) return '';
  let j = src.indexOf('{', i), n = 0;
  for (; j < src.length; j++) { if (src[j] === '{') n++; else if (src[j] === '}' && --n === 0) break; }
  return src.slice(i, j + 1);
}
function contexto(pagina, fns, ahoraISO) {
  const html = fs.readFileSync(path.join(__dirname, '..', pagina), 'utf8');
  const Real = Date;
  class Fijo extends Real { constructor(...a) { if (a.length) super(...a); else super(ahoraISO); } static now() { return new Real(ahoraISO).getTime(); } }
  const els = {};
  const ctx = { Date: Fijo, Math, String, document: { getElementById: (id) => els[id] || (els[id] = { value: '' }) }, pintarConfEstado() {} };
  vm.createContext(ctx);
  fns.forEach((f) => vm.runInContext(funcion(html, f), ctx));
  return { ctx, els };
}

// 30/11/2026 22:30 en Montevideo = 01/12 01:30 UTC
const NOCHE = '2026-12-01T01:30:00Z';

test('MERO AR: el mes de la oferta y la revisión usan el día de la PC', () => {
  const { ctx, els } = contexto('mp-importacion.html', ['hoyISO', 'sumarDias', 'mesActual', 'revisionEn'], NOCHE);
  assert.strictEqual(ctx.mesActual(), '2026-11');
  ctx.revisionEn(30);
  assert.strictEqual(els['cf-rev'].value, '2026-12-30');
});

test('líneas de Depósitos: hoyISO es el día de la PC', () => {
  const { ctx } = contexto('importaciones.html', ['hoyISO'], NOCHE);
  assert.strictEqual(ctx.hoyISO(), '2026-11-30');
  const src = fs.readFileSync(path.join(__dirname, '..', 'importaciones.html'), 'utf8');
  assert.doesNotMatch(funcion(src, 'openNuevaCorrida'), /toISOString/);
});

test('Depósitos: el rango del historial y la importación nueva usan el día de la PC', () => {
  const { ctx } = contexto('deposito/index.html', ['diaLocal', 'fabFechaDef'], NOCHE);
  assert.strictEqual(ctx.diaLocal(new ctx.Date()), '2026-11-30');
  assert.strictEqual(ctx.fabFechaDef(30), '2026-10-31');
});
