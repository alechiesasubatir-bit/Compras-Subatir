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

  // Qué módulo habilita cada página. Pedir mercadería no es operar el
  // depósito: alguien de fábrica puede solicitar sin tener que ver el
  // stock, los pallets ni el mapa. El operario también puede pedir.
  var PAGE_MOD = { 'solicitar.html': ['solicitante', 'importacion'] };
  function modsDe() { return PAGE_MOD[page()] || [MODULO]; }

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
          // Un solicitante puro no entra al panel del depósito, pero sí a
          // pedir: mandarlo ahí es más útil que un cartel de "sin permiso".
          if ((profile.modules || []).indexOf('solicitante') >= 0 && page() !== 'solicitar.html') {
            location.replace('solicitar.html'); return;
          }
          location.replace('login.html?denegado=1'); return;
        }
        injectUserBar(profile);
        // El link de vuelta a Compras sólo para quien tenga más módulos
        var back = document.getElementById('nav-compras');
        if (back && (profile.role === 'admin' || (profile.modules || []).length > 1)) back.style.display = '';
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

  window.SubatirApp = {
    ready: _ready,
    getProfile: function () { return _profile; },
    live: live,
    logout: function () {
      return SB.auth.signOut().then(function () { location.replace('login.html'); });
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', guard);
  else guard();
})();
