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
    'recorrido.html': ['recorrido', 'importacion']
  };
  // Módulos que viven de este lado: los demás son de Compras.
  var MODULOS_DEPOSITO = ['solicitante', 'recorrido', 'importacion'];
  function modsDe() { return PAGE_MOD[page()] || [MODULO]; }

  // A dónde mandar a quien no puede abrir esta página. Un cartel de "sin
  // permiso" no le sirve a nadie: si tiene una pantalla de celular
  // habilitada, va derecho ahí.
  var CASA = [['recorrido', 'recorrido.html'], ['solicitante', 'solicitar.html']];
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

  function startVersionCheck() {
    if (!window.APP_VER) return;
    checkVersion();
    setInterval(checkVersion, 600000);          // la pestaña queda abierta todo el día
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkVersion();     // volver a la app es buen momento
    });
  }

  window.SubatirApp = {
    ready: _ready,
    getProfile: function () { return _profile; },
    puede: puede,
    checkVersion: checkVersion,
    live: live,
    logout: function () {
      return SB.auth.signOut().then(function () { location.replace('login.html'); });
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ guard(); startVersionCheck(); });
  else { guard(); startVersionCheck(); }
})();
