// ============================================================
//  TEMA — modo oscuro (el de siempre) o modo claro
//
//  Pedido del 27/11/2026: poder pasar la app a claro sin perder el
//  oscuro. La elección queda guardada en el equipo (localStorage) y
//  vale para todos los módulos de Compras.
//
//  Por qué no alcanza con cambiar las variables (--bg, --text...):
//  los 16 módulos tienen cientos de colores escritos a mano en su
//  CSS y en el HTML que arma el JS (#0c1119 de fondo, #fca5a5 de
//  texto, rgba(255,255,255,.06) de borde). Con sólo las variables,
//  en claro quedaban textos rosados sobre blanco y cuadros negros.
//  Así que, en claro, este archivo hace dos cosas:
//    1. Pisa las variables de cada módulo (son nombres distintos
//       según la página: --text/--txt, --border/--bdr, etc.).
//    2. Recorre las hojas de estilo y los style="" del HTML y pasa
//       cada color a su par claro: fondos oscuros → claros, textos
//       claros → oscuros del mismo tono, bordes blancos → grises.
//  Al volver a oscuro se deshace todo lo que se cambió, uno por uno.
//
//  Se carga en el <head>, antes de subatir-app.js: así el atributo
//  data-tema está puesto antes de que se pinte nada y no hay un
//  parpadeo negro al abrir cada página.
// ============================================================
(function () {
  'use strict';

  var CLAVE = 'sb-tema';
  var html = document.documentElement;

  function leer() {
    try { return localStorage.getItem(CLAVE) === 'claro' ? 'claro' : 'oscuro'; } catch (e) { return 'oscuro'; }
  }
  function guardar(t) {
    try { localStorage.setItem(CLAVE, t); } catch (e) { }
  }

  // ── 1. Variables de cada módulo, en claro ─────────────────────
  // Especificidad html[data-tema] (0,1,1) le gana a :root (0,1,0)
  // sin importar el orden de carga.
  var CSS_CLARO = [
    'html[data-tema="claro"]{color-scheme:light !important;',
    // fondos
    '--bg:#edf1f6;--bg0:#edf1f6;--bg1:#f7f9fc;--bg2:#ffffff;--bg3:#f1f5f9;',
    // vidrio: blanco translúcido sobre el gris azulado del fondo
    '--glass:rgba(255,255,255,.74);--gl:rgba(255,255,255,.74);--gl2:rgba(255,255,255,.92);',
    '--glass-b:rgba(15,23,42,.10);',
    // bordes
    '--border:rgba(15,23,42,.10);--bdr:rgba(15,23,42,.10);--border-b:rgba(15,23,42,.17);--bdr2:rgba(15,23,42,.17);',
    // texto (en claro, "apagado" es más claro, no más oscuro)
    '--text:#0f1b2d;--txt:#0f1b2d;--muted:#6b7a8f;--mut:#6b7a8f;--muted-l:#4b5a6e;--mut2:#4b5a6e;',
    // acentos: los "claros" pensados para fondo negro no se leen sobre blanco
    '--teal:#0b7894;--tl:#0a7fa3;--teal-l:#0a7fa3;--teal-g:rgba(14,107,138,.12);',
    '--orange:#f26a0f;--or:#f26a0f;--orange-d:#c2410c;--orange-l:#e2580a;--orl:#e2580a;',
    '--gold:#b7860b;--amber:#d97706;--amb:#d97706;--warn:#d97706;',
    '--green:#16a34a;--grn:#16a34a;--ok:#16a34a;',
    '--red:#dc2626;--danger:#dc2626;--purple:#7c3aed;--pur:#7c3aed;',
    '--agua:#0284c7;--agua-d:#075985;--coral:#e11d48;',
    '--red-g:rgba(220,38,38,.10);--amber-g:rgba(217,119,6,.10);--green-g:rgba(22,163,74,.10);',
    // Depósitos
    '--border-s:rgba(15,23,42,.17);--teal-d:#075f78;--focus:#0891b2;--shadow-l:0 22px 56px rgba(15,23,42,.16);',
    '--shadow:0 8px 28px rgba(15,23,42,.10);--shd:0 8px 28px rgba(15,23,42,.10)}',
    'html[data-tema="claro"] body{background-color:var(--bg,#edf1f6)}',
    'html[data-tema="claro"] select,html[data-tema="claro"] input,html[data-tema="claro"] textarea{color-scheme:light !important}',
    'html[data-tema="claro"] ::-webkit-scrollbar-thumb{background:rgba(15,23,42,.22)}',
    // Sin desenfoque en claro: con fondo claro el blur dejaba el Dashboard
    // (165 tarjetas de Cobertura) y Previsión Cloro casi congelados, y sobre
    // un fondo liso no se nota. El encabezado ya es blanco al 90 %.
    'html[data-tema="claro"] *{-webkit-backdrop-filter:none !important;backdrop-filter:none !important}',
    // El botón del tema, junto al usuario
    '.sb-tema-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;',
    'padding:0;border-radius:8px;cursor:pointer;font-size:13px;line-height:1;',
    'border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);transition:background .15s,border-color .15s}',
    '.sb-tema-btn:hover{background:rgba(255,255,255,.12)}',
    'html[data-tema="claro"] .sb-tema-btn{border-color:rgba(15,23,42,.16);background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.08)}',
    'html[data-tema="claro"] .sb-tema-btn:hover{background:#f1f5f9}',
    '.sb-tema-btn:focus-visible{outline:2px solid #1bc8ff;outline-offset:2px}'
  ].join('');

  // ── 2. Conversión de colores escritos a mano ─────────────────
  function rgbAHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return { h: h, s: s, l: l };
  }
  function hslARgb(h, s, l) {
    if (!s) { var v = Math.round(l * 255); return [v, v, v]; }
    function f(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [Math.round(f(p, q, h + 1 / 3) * 255), Math.round(f(p, q, h) * 255), Math.round(f(p, q, h - 1 / 3) * 255)];
  }
  function leerColor(t) {
    t = t.toLowerCase();
    if (t === 'white') return { r: 255, g: 255, b: 255, a: 1 };
    if (t === 'black') return { r: 0, g: 0, b: 0, a: 1 };
    if (t.charAt(0) === '#') {
      var x = t.slice(1);
      if (x.length === 3 || x.length === 4) x = x.split('').map(function (c) { return c + c; }).join('');
      if (x.length !== 6 && x.length !== 8) return null;
      return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16),
               a: x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1 };
    }
    var m = t.match(/rgba?\(([^)]*)\)/);
    if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean);
    if (p.length < 3) return null;
    var a = p.length > 3 ? (p[3].indexOf('%') > 0 ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1;
    return { r: +p[0], g: +p[1], b: +p[2], a: isNaN(a) ? 1 : a };
  }
  function css(c) {
    var a = Math.round(c.a * 1000) / 1000;
    return a >= 1 ? 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')'
                  : 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + a + ')';
  }
  function tinta(a) { return { r: 15, g: 23, b: 42, a: a }; }   // pizarra, el "negro" del modo claro
  function conHsl(h, s, l, a) { var v = hslARgb(h, s, l); return { r: v[0], g: v[1], b: v[2], a: a }; }

  // tipo: texto | fondo | borde | sombra. ctx: {blanco, capa}
  function convertir(c, tipo, ctx) {
    var x = rgbAHsl(c.r, c.g, c.b), a = c.a;
    if (a === 0) return null;
    if (tipo === 'texto') {
      if (x.l < .25) return null;                            // ya es oscuro (letra sobre botón de color)
      if (ctx.blanco && x.l > .85 && x.s < .25) return null; // blanco sobre botón naranja/teal: queda
      if (x.s < .22) {
        if (x.l < .55) return null;                          // gris medio: se lee igual sobre blanco
        return conHsl(x.h, Math.min(x.s, .3), .45 - (x.l - .55) / .45 * .32, a);
      }
      if (x.l <= .42) return null;
      return conHsl(x.h, Math.min(x.s, .82), x.l >= .6 ? .33 : Math.max(.33, x.l - .12), a);
    }
    if (tipo === 'fondo') {
      if (x.l < .2) {
        if (ctx.capa && a >= .4) return tinta(.38);          // velo detrás de un modal
        if (a >= .5) return conHsl(x.h, Math.min(x.s, .35), .99 - x.l * .4, a);
        return tinta(Math.max(.015, a * .18));
      }
      if (x.l > .9 && x.s < .3 && a < .35) return tinta(Math.max(.015, a * .9));
      return null;
    }
    if (tipo === 'borde') {
      if (x.l > .9 && x.s < .3 && a < .5) return tinta(Math.min(.22, Math.max(.06, a * 1.4)));
      if (x.l < .2 && a >= .5) return conHsl(x.h, Math.min(x.s, .25), .87, a);
      return null;
    }
    if (tipo === 'sombra') {
      if (x.l < .15) return tinta(Math.min(.16, a * .3));
      if (x.l > .9) return null;
      return { r: c.r, g: c.g, b: c.b, a: a * .6 };
    }
    return null;
  }

  var RE_COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b/g;
  function convertirValor(v, tipo, ctx) {
    if (!v) return null;
    var cambio = false;
    var out = v.replace(RE_COLOR, function (t) {
      var c = leerColor(t); if (!c) return t;
      var n = convertir(c, tipo, ctx); if (!n) return t;
      cambio = true; return css(n);
    });
    return cambio ? out : null;
  }

  function tipoDe(prop) {
    if (prop === 'color' || prop === 'fill' || prop === 'stroke' || prop === 'caret-color' ||
        prop === '-webkit-text-fill-color' || prop === 'text-decoration-color') return 'texto';
    if (prop === 'background-color' || prop === 'background-image') return 'fondo';
    if (/^border-.*-color$/.test(prop) || prop === 'outline-color' || prop === 'column-rule-color') return 'borde';
    if (prop === 'box-shadow' || prop === 'text-shadow') return 'sombra';
    return null;
  }

  // Fondos que hacen que un texto blanco tenga que seguir blanco
  var ACENTOS = /var\(--(teal|tl|teal-l|or|orl|orange|orange-d|orange-l|red|danger|grn|green|ok|amb|amber|warn|pur|purple|gold|agua|agua-d|coral)\b/;
  // --c (color del módulo en el menú) sólo cuenta a color pleno: con un tinte
  // suave detrás, el blanco no se leía (pestaña abierta de Depósitos)
  var ACENTO_C = /rgb\(var\(--c\)\)|rgba\(var\(--c\),\s*(0?\.[5-9]|1)/;
  function contexto(st) {
    var bg = (st.getPropertyValue('background') || '') + ' ' + (st.getPropertyValue('background-color') || '') +
             ' ' + (st.getPropertyValue('background-image') || '');
    var blanco = ACENTOS.test(bg) || ACENTO_C.test(bg);
    if (!blanco) {
      (bg.match(RE_COLOR) || []).forEach(function (t) {
        var c = leerColor(t); if (!c) return;
        var x = rgbAHsl(c.r, c.g, c.b);
        if (x.s > .35 && c.a >= .5 && x.l > .2 && x.l < .75) blanco = true;
      });
    }
    var cero = function (p) { var v = st.getPropertyValue(p); return v === '0px' || v === '0'; };
    var capa = st.getPropertyValue('position') === 'fixed' && cero('top') && cero('left') &&
               (cero('right') || cero('bottom') || st.getPropertyValue('width') === '100%');
    return { blanco: blanco, capa: capa };
  }

  // Cambios hechos: [{st, prop, orig, nuevo, prio}]. Volver a oscuro
  // restaura sólo lo que sigue como lo dejamos (si el JS de la página
  // lo cambió después, manda el JS).
  var hechos = [];
  function convertirEstilo(st) {
    var props = [];
    for (var i = 0; i < st.length; i++) props.push(st[i]);
    if (!props.length) return;
    var ctx = null;
    // Títulos con degradé en la letra (background-clip:text): el degradé es
    // el color del texto, así que se convierte como texto. Se lee del
    // atajo 'background' porque si lleva var() el longhand viene vacío.
    var degradeTexto = /text/.test(st.getPropertyValue('-webkit-background-clip') + st.getPropertyValue('background-clip'));
    if (degradeTexto) {
      var g = st.getPropertyValue('background-image') || st.getPropertyValue('background');
      var ng = g && g.indexOf('gradient') >= 0 ? convertirValor(g, 'texto', {}) : null;
      if (ng && ng !== g) {
        var pg = st.getPropertyPriority('background-image');
        st.setProperty('background-image', ng, pg);
        hechos.push({ st: st, prop: 'background-image', orig: g, nuevo: st.getPropertyValue('background-image'), prio: pg });
      }
    }
    props.forEach(function (p) {
      if (p.charAt(0) === '-' && p.charAt(1) === '-') return;   // variables: las maneja CSS_CLARO
      if (degradeTexto && p === 'background-image') return;
      var tipo = tipoDe(p); if (!tipo) return;
      var v = st.getPropertyValue(p);
      if (!v) return;
      ctx = ctx || contexto(st);
      var n = convertirValor(v, tipo, ctx);
      if (n == null || n === v) return;
      var prio = st.getPropertyPriority(p);
      st.setProperty(p, n, prio);
      hechos.push({ st: st, prop: p, orig: v, nuevo: st.getPropertyValue(p), prio: prio });
    });
  }

  function recorrerReglas(reglas) {
    for (var i = 0; i < reglas.length; i++) {
      var r = reglas[i];
      if (r.media && /^\s*print\s*$/i.test(r.media.mediaText)) continue;   // la impresión queda como está
      if (r.style) convertirEstilo(r.style);
      if (r.cssRules) recorrerReglas(r.cssRules);
    }
  }
  var hojasVistas = (typeof WeakSet === 'function') ? new WeakSet() : null;
  function convertirHojas() {
    var hs = document.styleSheets;
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (h.ownerNode && h.ownerNode.id === 'sb-tema-css') continue;
      if (hojasVistas && hojasVistas.has(h)) continue;
      var reglas;
      try { reglas = h.cssRules; } catch (e) { continue; }   // Google Fonts: de otro origen, no se puede leer
      if (!reglas) continue;
      if (hojasVistas) hojasVistas.add(h);
      recorrerReglas(reglas);
    }
  }

  // style="" del HTML (lo que arman los módulos con innerHTML)
  var vistos = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function convertirElemento(el) {
    if (!el.style || !el.getAttribute('style')) return;
    var marca = el.getAttribute('style');
    if (vistos && vistos.get(el) === marca) return;
    convertirEstilo(el.style);
    if (vistos) vistos.set(el, el.getAttribute('style'));
  }
  function convertirArbol(raiz) {
    if (raiz.nodeType !== 1) return;
    convertirElemento(raiz);
    var els = raiz.querySelectorAll('[style]');
    for (var i = 0; i < els.length; i++) convertirElemento(els[i]);
  }

  var obs = null;
  function vigilar() {
    if (obs || !window.MutationObserver) return;
    obs = new MutationObserver(function (ms) {
      var nuevasHojas = false;
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type === 'attributes') { convertirElemento(m.target); continue; }
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeName === 'STYLE' || n.nodeName === 'LINK') nuevasHojas = true;
          convertirArbol(n);
        }
      }
      if (nuevasHojas) convertirHojas();
    });
    obs.observe(html, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  }

  function aplicarClaro() {
    convertirHojas();
    if (document.body) convertirArbol(document.body);
    vigilar();
  }
  function deshacer() {
    if (obs) { obs.disconnect(); obs = null; }
    for (var i = hechos.length - 1; i >= 0; i--) {
      var h = hechos[i];
      if (h.st.getPropertyValue(h.prop) === h.nuevo) h.st.setProperty(h.prop, h.orig, h.prio);
    }
    hechos = [];
    if (hojasVistas) hojasVistas = new WeakSet();
    if (vistos) vistos = new WeakMap();
  }

  // ── Gráficos (Chart.js) ──────────────────────────────────────
  // Los colores de un gráfico no pasan por CSS: la grilla viene como
  // rgba(255,255,255,.04) en las opciones y en claro desaparecía (Precios).
  // Antes de cada dibujado se pasa la grilla y los textos de los ejes por
  // la misma conversión; el original queda guardado para volver a oscuro.
  var origGraf = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function colorEje(obj, clave, tipo, claro) {
    if (!obj || !origGraf) return;
    var o = origGraf.get(obj) || {};
    if (!(clave in o)) { o[clave] = obj[clave]; origGraf.set(obj, o); }
    var v = o[clave];
    obj[clave] = (claro && typeof v === 'string') ? (convertirValor(v, tipo, {}) || v) : v;
  }
  function engancharGraficos() {
    var C = window.Chart;
    if (!C || !C.register || C._sbTema) return;
    C._sbTema = true;
    C.register({
      id: 'sbTema',
      beforeUpdate: function (ch) {
        var claro = html.getAttribute('data-tema') === 'claro';
        var sc = (ch.options && ch.options.scales) || {};
        Object.keys(sc).forEach(function (k) {
          var s = sc[k]; if (!s) return;
          colorEje(s.grid, 'color', 'borde', claro);
          colorEje(s.ticks, 'color', 'texto', claro);
        });
      }
    });
  }
  function redibujarGraficos() {
    var C = window.Chart;
    if (!C || !C.instances) return;
    Object.keys(C.instances).forEach(function (k) {
      try { C.instances[k].update('none'); } catch (e) { }
    });
  }
  engancharGraficos();
  document.addEventListener('DOMContentLoaded', engancharGraficos);

  // ── Botón ☀ / 🌙 ──────────────────────────────────────────────
  var botones = [];
  function pintarBoton(b) {
    var claro = html.getAttribute('data-tema') === 'claro';
    b.textContent = claro ? '🌙' : '☀️';
    b.title = claro ? 'Pasar a modo oscuro' : 'Pasar a modo claro';
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', claro ? 'true' : 'false');
  }
  function boton() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sb-tema-btn';
    b.onclick = function () { poner(html.getAttribute('data-tema') === 'claro' ? 'oscuro' : 'claro'); };
    pintarBoton(b);
    botones.push(b);
    return b;
  }

  var META_OSCURO = null;
  function poner(t) {
    var antes = html.getAttribute('data-tema') || 'oscuro';
    guardar(t);
    html.setAttribute('data-tema', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      if (META_OSCURO == null) META_OSCURO = meta.getAttribute('content');
      meta.setAttribute('content', t === 'claro' ? '#edf1f6' : META_OSCURO);
    }
    if (t === 'claro' && antes !== 'claro') aplicarClaro();
    else if (t === 'oscuro' && antes === 'claro') deshacer();
    botones.forEach(pintarBoton);
    engancharGraficos();
    redibujarGraficos();
    // Por si algún módulo quiere enterarse del cambio
    try { window.dispatchEvent(new CustomEvent('sb-tema', { detail: t })); } catch (e) { }
  }

  // ── Arranque ─────────────────────────────────────────────────
  var st = document.createElement('style');
  st.id = 'sb-tema-css';
  st.textContent = CSS_CLARO;
  (document.head || html).appendChild(st);

  if (leer() === 'claro') {
    html.setAttribute('data-tema', 'claro');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) { META_OSCURO = meta.getAttribute('content'); meta.setAttribute('content', '#edf1f6'); }
    // Las hojas que ya están cargadas, ahora (antes del primer pintado);
    // las que aparezcan después y el HTML del cuerpo, cuando lleguen.
    convertirHojas();
    vigilar();
    document.addEventListener('DOMContentLoaded', aplicarClaro);
    window.addEventListener('load', convertirHojas);
  }

  // Otra pestaña cambió el tema: ésta lo sigue
  window.addEventListener('storage', function (e) {
    if (e.key === CLAVE) poner(leer());
  });

  window.SubatirTema = { boton: boton, poner: poner, actual: function () { return html.getAttribute('data-tema') || 'oscuro'; } };
})();
