// ============================================================
//  CONTROL DE STOCK DEPÓSITOS — bootstrap propio
//
//  Esta app es independiente del sistema de Compras: no depende
//  de subatir-app.js. Comparte el mismo proyecto Supabase y el
//  mismo padrón de usuarios, para que Compras pueda ver lo que
//  sale de un depósito y entra a otro.
//
//  Requiere cargar antes: supabase-js + ../supabase-config.js
//  Expone window.SubatirApp con la misma superficie que usa la
//  página: ready / getProfile / live / logout.
// ============================================================
(function () {
  var SB = window.SB;
  var MODULO = 'importacion';   // clave histórica del módulo: está guardada
                                // en profiles.modules, no se renombra

  // Qué módulo habilita cada página.
  //  Las dos pantallas de CELULAR tienen permiso propio a propósito:
  //  'importacion' abre el panel entero (stock, pallets, mapa, config),
  //  que no es lo que necesita quien sólo pide mercadería o sale a
  //  levantar pedidos con el teléfono. Quien tenga 'importacion' igual
  //  entra a las dos: es el permiso completo del depósito.
  var PAGE_MOD = {
    'solicitar.html': ['solicitante', 'importacion'],
    // El operador logístico de destino entra a la misma pantalla, pero
    // la ve en modo recepción: sólo lo que está por llegar.
    'recorrido.html': ['recorrido', 'recepcion_deposito', 'importacion']
  };
  // Módulos que viven de este lado: los demás son de Compras.
  var MODULOS_DEPOSITO = ['solicitante', 'recorrido', 'recepcion_deposito', 'importacion'];
  function modsDe() { return PAGE_MOD[page()] || [MODULO]; }

  // A dónde mandar a quien no puede abrir esta página. Un cartel de "sin
  // permiso" no le sirve a nadie: si tiene una pantalla de celular
  // habilitada, va derecho ahí.
  var CASA = [['recorrido', 'recorrido.html'], ['recepcion_deposito', 'recorrido.html'],
              ['solicitante', 'solicitar.html']];
  function casaDe(profile) {
    var mods = profile.modules || [];
    for (var i = 0; i < CASA.length; i++) {
      if (mods.indexOf(CASA[i][0]) >= 0 && page() !== CASA[i][1]) return CASA[i][1];
    }
    return null;
  }
  // Para que cada pantalla esconda lo que la persona no puede abrir
  function puede(mod) {
    var p = _profile;
    if (!p) return false;
    if (p.role === 'admin') return true;
    return (p.modules || []).indexOf(mod) >= 0;
  }

  var _profile = null, _readyResolve;
  var _ready = new Promise(function (r) { _readyResolve = r; });

  function page() { return (location.pathname.split('/').pop() || 'index.html'); }

  function canAccess(profile) {
    if (!profile || !profile.activo) return false;
    if (profile.role === 'admin') return true;
    var mods = profile.modules || [];
    return modsDe().some(function (m) { return mods.indexOf(m) >= 0; });
  }

  function loadProfile() {
    return SB.auth.getUser().then(function (res) {
      var user = res.data && res.data.user;
      if (!user) return null;
      return SB.from('profiles').select('*').eq('id', user.id).single().then(function (r) {
        return r.data || { id: user.id, email: user.email, role: 'user', modules: [], activo: true };
      });
    });
  }

  // ── Guardia: sin sesión válida no se entra ─────────────────
  function guard() {
    if (page() === 'login.html') { _readyResolve(null); return; }
    SB.auth.getSession().then(function (res) {
      if (!(res.data && res.data.session)) { location.replace('login.html'); return; }
      loadProfile().then(function (profile) {
        _profile = profile;
        if (!profile || !profile.activo) {
          SB.auth.signOut().then(function () { location.replace('login.html?inactivo=1'); });
          return;
        }
        if (!canAccess(profile)) {
          var casa = casaDe(profile);
          if (casa) { location.replace(casa); return; }
          location.replace('login.html?denegado=1'); return;
        }
        injectUserBar(profile);
        // El link de vuelta a Compras sólo para quien tenga algún módulo
        // de allá: al que sólo trabaja en el depósito, Compras lo rebota.
        var back = document.getElementById('nav-compras');
        var deCompras = (profile.modules || []).filter(function (m) {
          return MODULOS_DEPOSITO.indexOf(m) < 0;
        });
        if (back && (profile.role === 'admin' || deCompras.length > 0)) back.style.display = '';
        _readyResolve(profile);
        document.dispatchEvent(new CustomEvent('subatir:ready', { detail: profile }));
      });
    });
  }

  function injectUserBar(profile) {
    var host = document.querySelector('.header-right') || document.querySelector('header');
    if (!host || document.getElementById('sb-userbar')) return;
    var who = (profile.full_name || profile.email || '').split('@')[0];
    var wrap = document.createElement('span');
    wrap.id = 'sb-userbar';
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:4px';
    wrap.innerHTML =
      '<span style="font-size:11px;color:var(--muted-l);font-family:var(--mono)">' +
      (profile.role === 'admin' ? '★ ' : '') + esc(who) + '</span>' +
      '<button id="sb-logout" class="btn btn-ghost btn-sm">Salir</button>';
    host.appendChild(wrap);
    document.getElementById('sb-logout').onclick = function () {
      SB.auth.signOut().then(function () { location.replace('login.html'); });
    };
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Realtime con rebote, más refresco al volver a la pestaña ─
  function live(tables, fn, opts) {
    opts = opts || {};
    tables = Array.isArray(tables) ? tables : [tables];
    var delay = opts.delay || 600, timer = null, lastRun = 0;
    function trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null; lastRun = Date.now();
        try { fn(); } catch (e) { console.error('live()', e); }
      }, delay);
    }
    try {
      var ch = SB.channel('dep-' + tables.join('_') + '-' + Math.random().toString(36).slice(2));
      tables.forEach(function (t) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, trigger);
      });
      ch.subscribe(function (status) {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Realtime] ' + status + ' en ' + tables.join(', ') +
                       ' — ¿tablas agregadas a la publicación supabase_realtime?');
        }
      });
    } catch (e) { console.warn('[Realtime] no disponible:', e); }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Date.now() - lastRun > 1500) trigger();
    });
    return { reload: trigger };
  }

  // ── Chequeo de versión ─────────────────────────────────────
  //  Vive acá y no en cada página: las tres pantallas de Depósitos lo
  //  necesitan, y en el celular MÁS que en ninguna — el operario no
  //  cierra la app entre pedidos, así que sin esto se queda con el
  //  código de hace semanas.
  //
  //  version.json se pide con cache:'no-store' y un parámetro de
  //  tiempo, así que llega fresco aunque el HTML esté cacheado. El
  //  service worker tampoco lo toca (ver sw.js). El sessionStorage
  //  evita el bucle si el servidor sigue mandando el documento viejo:
  //  se intenta una sola vez por versión.
  var VER_URL = (function () {
    var src = (document.currentScript && document.currentScript.src) || location.href;
    try { return new URL('version.json', src).href; } catch (e) { return 'version.json'; }
  })();

  // Cada página puede decir "ahora no": recargar en medio de un escaneo
  // o con un pedido a medio armar tira el trabajo de la persona.
  function ocupada() {
    try { return typeof window.appOcupada === 'function' && !!window.appOcupada(); }
    catch (e) { return false; }
  }

  function checkVersion() {
    if (!window.APP_VER) return;
    return fetch(VER_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.v || j.v === window.APP_VER) return;
        if (sessionStorage.getItem('dep_ver_reload') === j.v) return;
        if (ocupada()) return;                  // se reintenta en la próxima vuelta
        sessionStorage.setItem('dep_ver_reload', j.v);
        if (window.toast) window.toast('Hay una versión nueva — actualizando…', 'info');
        setTimeout(function () {
          location.replace(location.pathname + '?v=' + encodeURIComponent(j.v) + location.hash);
        }, 1200);
      })
      .catch(function () { });   // sin señal no es motivo para molestar
  }

  // ── Arrancar siempre desde arriba ──────────────────────────
  //  El navegador guarda dónde había quedado el scroll y lo restaura al
  //  volver a abrir la app o al recargarse por una versión nueva. En una
  //  página larga —el panel del depósito— eso deja al operario en el
  //  medio, mirando una tabla sin encabezado, teniendo que subir a mano.
  //  Se apaga esa restauración y se sube al tope cuando la página ya
  //  midió su alto (si no, el navegador vuelve a bajar después).
  function alTope() {
    try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}
    var sube = function () { window.scrollTo(0, 0); };
    sube();
    // Dos pasadas más: una al terminar de pintar y otra cuando cargó
    // todo (imágenes y fuentes cambian el alto y arrastran el scroll).
    requestAnimationFrame(sube);
    window.addEventListener('load', function () { setTimeout(sube, 0); });
  }

  function startVersionCheck() {
    if (!window.APP_VER) return;
    checkVersion();
    setInterval(checkVersion, 600000);          // la pestaña queda abierta todo el día
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkVersion();     // volver a la app es buen momento
    });
  }

  // ══════════════════════════════════════════════════════════
  //  QUIÉN OPERA · cuentas compartidas
  //  produccionsubatir, operadorprueba y logistica.artigas las usan
  //  varias personas. Si el perfil está marcado como compartida, al
  //  entrar se pregunta quién está operando y ese nombre —no el de
  //  la cuenta— es el que queda en lo que se registre.
  //  El nombre vive en sessionStorage: dura lo que dura la pestaña,
  //  que es aproximadamente lo que dura el turno.
  // ══════════════════════════════════════════════════════════
  var OPER = (function () {
    var KEY = 'subatir_operador';
    var _nombre = null, _onChange = null, _leido = false;

    function perfil() { return _profile || {}; }
    function esCompartida() { return !!perfil().compartida; }
    function lista() {
      var l = perfil().operadores;
      if (typeof l === 'string') { try { l = JSON.parse(l); } catch (e) { l = []; } }
      return Array.isArray(l) ? l : [];
    }
    // El nombre queda atado a la CUENTA que lo eligió: si en la misma
    // pestaña alguien cierra sesión y entra con otra, no se le arrastra
    // el operador de la anterior.
    function cuentaId() { return perfil().id || perfil().email || '?'; }
    function get() {
      if (_nombre) return _nombre;
      if (_leido) return null;
      _leido = true;
      try {
        var g = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        if (g && g.cuenta === cuentaId()) _nombre = g.nombre || null;
        else if (g) sessionStorage.removeItem(KEY);
      } catch (e) {}
      return _nombre;
    }
    function set(n) {
      _nombre = (n || '').trim() || null;
      _leido = true;
      try {
        if (_nombre) sessionStorage.setItem(KEY, JSON.stringify({ cuenta: cuentaId(), nombre: _nombre }));
        else sessionStorage.removeItem(KEY);
      } catch (e) {}
      pintarChip();
      if (_onChange) _onChange(_nombre);
    }
    // El nombre que va al registro: la persona si la cuenta es
    // compartida, si no el de la cuenta.
    function nombre() {
      var p = perfil();
      var base = p.full_name || (p.email || '').split('@')[0] || 'Operario';
      return (esCompartida() && get()) ? get() : base;
    }

    function css() {
      if (document.getElementById('oper-css')) return;
      var s = document.createElement('style');
      s.id = 'oper-css';
      s.textContent = [
        '.oper-ovl{position:fixed;inset:0;z-index:9000;display:none;align-items:center;',
        'justify-content:center;padding:18px;background:rgba(3,6,12,.82);backdrop-filter:blur(6px)}',
        '.oper-ovl.open{display:flex}',
        '.oper-box{width:100%;max-width:430px;border-radius:18px;padding:20px;',
        'background:linear-gradient(150deg,rgba(13,27,46,.98),rgba(10,18,32,.99));',
        'border:1px solid rgba(255,255,255,.10);box-shadow:0 24px 80px rgba(0,0,0,.75)}',
        '.oper-h{font-size:17px;font-weight:800;margin:0 0 3px}',
        '.oper-s{font-size:12.5px;color:#94a3b8;margin-bottom:14px;line-height:1.45}',
        '.oper-l{display:grid;gap:7px;margin-bottom:12px}',
        '.oper-i{display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:11px;cursor:pointer;',
        'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);transition:border-color .15s,background .15s}',
        '.oper-i:hover{border-color:rgba(27,200,255,.45);background:rgba(27,200,255,.07)}',
        '.oper-i.on{border-color:#1bc8ff;background:rgba(27,200,255,.13)}',
        '.oper-i input{width:17px;height:17px;accent-color:#1bc8ff;flex:0 0 auto;margin:0;cursor:pointer}',
        '.oper-n{display:block;font-size:14px;font-weight:700;color:#e2e8f0;line-height:1.25}',
        '.oper-r{font-size:11px;color:#94a3b8;margin-top:2px}',
        '.oper-txt{width:100%;padding:11px 13px;border-radius:11px;font-size:14px;',
        'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.10);color:#e2e8f0;outline:none}',
        '.oper-txt:focus{border-color:#1bc8ff}',
        '.oper-btn{width:100%;margin-top:13px;padding:13px;border-radius:11px;border:0;cursor:pointer;',
        'font-size:14px;font-weight:800;color:#fff;background:linear-gradient(135deg,#f97316,#c2580a)}',
        '.oper-btn:disabled{opacity:.45;cursor:not-allowed}',
        '.oper-chip{display:inline-flex;align-items:center;gap:7px;padding:4px 10px;border-radius:20px;',
        'font-size:11.5px;font-weight:700;color:#7dd3fc;background:rgba(27,200,255,.12);',
        'border:1px solid rgba(27,200,255,.32);white-space:nowrap}',
        '.oper-chip button{background:none;border:0;color:#94a3b8;font-size:10.5px;cursor:pointer;',
        'text-decoration:underline;padding:0;font-weight:600}',
        '.oper-chip button:hover{color:#e2e8f0}'
      ].join('');
      document.head.appendChild(s);
    }

    // Chip "👤 NOMBRE · cambiar" en el header
    function pintarChip() {
      var host = document.getElementById('oper-chip');
      if (!host) return;
      css();   // el chip puede aparecer sin que el diálogo se haya abierto
      if (!esCompartida() || !get()) { host.innerHTML = ''; return; }
      host.innerHTML = '<span class="oper-chip">👤 ' + esc(get())
        + ' <button type="button" onclick="SubatirApp.operador.preguntar(true)">cambiar</button></span>';
    }
    function esc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
             .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Muestra el diálogo. forzar=true lo abre aunque ya haya nombre.
    function preguntar(forzar) {
      if (!esCompartida()) return;
      if (!forzar && get()) { pintarChip(); return; }
      css();
      var ov = document.getElementById('oper-ovl');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'oper-ovl'; ov.className = 'oper-ovl';
        document.body.appendChild(ov);
      }
      var ops = lista(), actual = get();
      var esOtro = !!actual && !ops.some(function (o) { return o.nombre === actual; });
      ov.innerHTML =
        '<div class="oper-box" role="dialog" aria-modal="true" aria-labelledby="oper-h">'
        + '<h3 class="oper-h" id="oper-h">¿Quién está operando?</h3>'
        + '<div class="oper-s">Esta cuenta la usan varias personas. Lo que registres queda a tu nombre.</div>'
        + (ops.length
            ? '<div class="oper-l">'
              + ops.map(function (o, i) {
                  var on = o.nombre === actual;
                  return '<label class="oper-i' + (on ? ' on' : '') + '" id="oper-i' + i + '">'
                    + '<input type="radio" name="oper-pick" value="' + esc(o.nombre) + '"'
                    + (on ? ' checked' : '') + ' onchange="SubatirApp.operador._pick()"/>'
                    + '<span><span class="oper-n">' + esc(o.nombre) + '</span>'
                    + (o.rol ? '<span class="oper-r">' + esc(o.rol) + '</span>' : '') + '</span></label>';
                }).join('')
              + '<label class="oper-i' + (esOtro ? ' on' : '') + '" id="oper-iotro">'
              + '<input type="radio" name="oper-pick" value="__otro__"' + (esOtro ? ' checked' : '')
              + ' onchange="SubatirApp.operador._pick()"/>'
              + '<span class="oper-n">Otro</span></label>'
              + '</div>'
              + '<input class="oper-txt" id="oper-otro" placeholder="Nombre y apellido completo"'
              + ' value="' + (esOtro ? esc(actual) : '') + '"'
              + ' style="display:' + (esOtro ? 'block' : 'none') + '"'
              + ' oninput="SubatirApp.operador._pick()"/>'
            : '<input class="oper-txt" id="oper-otro" placeholder="Nombre y apellido completo"'
              + ' value="' + esc(actual || '') + '" oninput="SubatirApp.operador._pick()"/>')
        + '<button class="oper-btn" id="oper-ok" onclick="SubatirApp.operador._ok()">Continuar</button>'
        + '</div>';
      ov.classList.add('open');
      _pick();
      setTimeout(function () {
        var t = document.getElementById('oper-otro');
        if (t && t.style.display !== 'none' && !ops.length) t.focus();
      }, 60);
    }

    // Habilita/deshabilita Continuar y muestra el campo libre
    function _pick() {
      var sel = document.querySelector('input[name="oper-pick"]:checked');
      var txt = document.getElementById('oper-otro');
      var ops = lista();
      if (ops.length && txt) {
        var otro = sel && sel.value === '__otro__';
        txt.style.display = otro ? 'block' : 'none';
        if (otro && document.activeElement !== txt) txt.focus();
      }
      // El resalte de la fila elegida
      document.querySelectorAll('.oper-i').forEach(function (el) {
        var r = el.querySelector('input');
        el.classList.toggle('on', !!(r && r.checked));
      });
      var btn = document.getElementById('oper-ok');
      if (btn) btn.disabled = !_valor();
    }
    function _valor() {
      var ops = lista();
      var txt = document.getElementById('oper-otro');
      if (!ops.length) return txt ? txt.value.trim() : '';
      var sel = document.querySelector('input[name="oper-pick"]:checked');
      if (!sel) return '';
      if (sel.value !== '__otro__') return sel.value;
      return txt ? txt.value.trim() : '';
    }
    function _ok() {
      var v = _valor();
      if (!v) return;
      set(v);
      var ov = document.getElementById('oper-ovl');
      if (ov) ov.classList.remove('open');
    }

    // Llamar una vez cuando la página ya tiene perfil.
    // onChange se dispara al elegir o cambiar de operador.
    function init(onChange) {
      _onChange = onChange || null;
      if (!esCompartida()) { pintarChip(); return; }
      preguntar(false);
      pintarChip();
    }

    return { init: init, preguntar: preguntar, nombre: nombre, get: get, set: set,
             esCompartida: esCompartida, lista: lista, pintarChip: pintarChip,
             _pick: _pick, _ok: _ok };
  })();

  window.SubatirApp = {
    ready: _ready,
    getProfile: function () { return _profile; },
    puede: puede,
    operador: OPER,
    checkVersion: checkVersion,
    live: live,
    logout: function () {
      return SB.auth.signOut().then(function () { location.replace('login.html'); });
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ alTope(); guard(); startVersionCheck(); });
  else { alTope(); guard(); startVersionCheck(); }
})();
