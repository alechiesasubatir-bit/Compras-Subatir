// ============================================================
//  Entorno de navegador mínimo para las pruebas de integración
//
//  Carga los scripts de la app (supabase-config.js, subatir-app.js,
//  deposito-app.js…) en un contexto vm con:
//   · un cliente Supabase FALSO, en memoria, que entiende lo que la
//     app usa: select/eq/order/range/single/insert/update/delete.
//     Puede simular RLS (un UPDATE bloqueado devuelve 0 filas sin
//     error, igual que Postgres) y errores por tabla.
//   · document/location/storage lo justo para que arranquen.
//  Sin dependencias: sólo node.
// ============================================================
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');

// ── Supabase falso ───────────────────────────────────────────
function crearBase(tablas, opts) {
  opts = opts || {};
  const db = {};
  Object.keys(tablas || {}).forEach(function (t) {
    db[t] = tablas[t].map(function (r) { return Object.assign({}, r); });
  });
  const log = [];              // cada consulta ejecutada: {tabla, op, rango}
  let nextId = 100000;

  function builder(tabla) {
    const st = { tabla, op: 'select', filtros: [], orden: [], rango: null, single: false, payload: null, devolver: false };
    const b = {
      select() { if (st.op !== 'select') st.devolver = true; return b; },
      eq(c, v) { st.filtros.push([c, v]); return b; },
      in(c, vs) { st.filtros.push([c, (vs || []).map(String)]); return b; },
      order(c, o) { st.orden.push([c, !(o && o.ascending === false)]); return b; },
      range(a, z) { st.rango = [a, z]; return b; },
      limit(n) { st.rango = [0, n - 1]; return b; },
      single() { st.single = true; return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      delete() { st.op = 'delete'; return b; },
      then(ok, ko) { return Promise.resolve().then(function () { return ejecutar(st); }).then(ok, ko); }
    };
    return b;
  }

  function coincide(st, r) { return st.filtros.every(function (f) { return Array.isArray(f[1]) ? f[1].indexOf(String(r[f[0]])) >= 0 : String(r[f[0]]) === String(f[1]); }); }

  function ejecutar(st) {
    log.push({ tabla: st.tabla, op: st.op, rango: st.rango, payload: st.payload });
    const err = opts.errores && opts.errores[st.tabla];
    if (err && (typeof err !== 'function' || err(st))) {
      return { data: null, error: { message: 'falla simulada en ' + st.tabla } };
    }
    const filas = db[st.tabla] || (db[st.tabla] = []);
    const bloqueada = (opts.rls || []).indexOf(st.tabla) >= 0;
    if (st.op === 'select') {
      let out = filas.filter(function (r) { return coincide(st, r); });
      if (st.orden.length) {
        out = out.slice().sort(function (a, b) {
          for (const [c, asc] of st.orden) {
            if (a[c] < b[c]) return asc ? -1 : 1;
            if (a[c] > b[c]) return asc ? 1 : -1;
          }
          return 0;
        });
      }
      if (st.rango) out = out.slice(st.rango[0], st.rango[1] + 1);
      if (st.single) return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'no rows' } };
      return { data: out, error: null };
    }
    if (st.op === 'insert') {
      if (bloqueada) return { data: null, error: { message: 'new row violates row-level security policy' } };
      const nuevas = (Array.isArray(st.payload) ? st.payload : [st.payload])
        .map(function (p) { return Object.assign({ id: nextId++ }, p); });
      nuevas.forEach(function (n) { filas.push(n); });
      return { data: st.single ? nuevas[0] : nuevas, error: null };
    }
    if (st.op === 'update') {
      if (bloqueada) return { data: [], error: null };            // Postgres: 0 filas, sin error
      const tocadas = filas.filter(function (r) { return coincide(st, r); });
      tocadas.forEach(function (r) { Object.assign(r, st.payload); });
      return { data: st.devolver ? tocadas.map(function (r) { return { id: r.id }; }) : null, error: null };
    }
    if (st.op === 'delete') {
      if (bloqueada) return { data: [], error: null };
      db[st.tabla] = filas.filter(function (r) { return !coincide(st, r); });
      return { data: null, error: null };
    }
    return { data: null, error: { message: 'op desconocida' } };
  }

  return { db, log, from: builder };
}

function crearSupabase(base, usuario) {
  const salidas = [];
  return {
    salidas,
    createClient() {
      return {
        from: base.from,
        auth: {
          getSession() { return Promise.resolve({ data: { session: usuario ? { user: usuario } : null } }); },
          getUser() { return Promise.resolve({ data: { user: usuario || null } }); },
          signOut() { salidas.push(1); return Promise.resolve({}); }
        },
        channel() { const ch = { on() { return ch; }, subscribe() { return ch; } }; return ch; },
        removeChannel() {}
      };
    }
  };
}

// ── DOM mínimo ───────────────────────────────────────────────
function elemento(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(), style: {}, children: [], className: '', id: '',
    textContent: '', innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; }, remove() {},
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
}

function crearDocumento() {
  const eventos = [];
  return {
    eventos, readyState: 'complete', currentScript: null, hidden: false,
    head: elemento('head'), body: elemento('body'), documentElement: elemento('html'),
    createElement: elemento,
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {},
    dispatchEvent(e) { eventos.push(e); return true; }
  };
}

function almacen() {
  const m = {};
  return { getItem(k) { return k in m ? m[k] : null; }, setItem(k, v) { m[k] = String(v); }, removeItem(k) { delete m[k]; } };
}

// ── Cargar la app en un contexto aislado ─────────────────────
//  opts: { pagina, scripts, tablas, rls, errores, usuario }
function cargar(opts) {
  opts = opts || {};
  const base = crearBase(opts.tablas, { rls: opts.rls, errores: opts.errores });
  const supa = crearSupabase(base, opts.usuario || null);
  const redirecciones = [];
  const pathname = '/' + (opts.pagina || 'index.html');
  const location = {
    pathname, search: '', hash: '', href: 'https://app.test' + pathname,
    replace(u) { redirecciones.push(u); }
  };
  const document = crearDocumento();
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    requestAnimationFrame() { return 0; },
    Promise, URL, URLSearchParams, TextEncoder, TextDecoder, Blob, Response, DataView,
    Uint8Array, Uint32Array, DecompressionStream, Date, Math, JSON,
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    location, document, history: {}, scrollTo() {}, addEventListener() {},
    localStorage: almacen(), sessionStorage: almacen(),
    innerWidth: 1280, innerHeight: 800, navigator: {},
    fetch() { return Promise.resolve({ ok: false, json() { return Promise.resolve(null); } }); },
    supabase: supa
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  (opts.scripts || ['supabase-config.js', 'subatir-app.js']).forEach(function (s) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, s), 'utf8'), ctx, { filename: s });
  });
  return { win: ctx, base, db: base.db, log: base.log, redirecciones, salidas: supa.salidas, eventos: document.eventos };
}

// Deja correr todas las promesas pendientes (las cadenas del guard son largas)
function drenar() { return new Promise(function (r) { setTimeout(r, 15); }); }

// Objetos creados dentro del vm tienen otro Object.prototype: deepStrictEqual
// los rechaza. Se pasan por JSON para comparar sólo los datos.
function plano(x) { return JSON.parse(JSON.stringify(x)); }

module.exports = { cargar, drenar, crearBase, plano, RAIZ };
