// ============================================================
//  SUBATIR — Capa de aplicación compartida
//  · Autenticación + control de acceso por módulo (roles)
//  · Capa de datos: devuelve los datos con los MISMOS nombres de
//    campo que los módulos esperaban del Google Sheet (adaptador),
//    y expone updateRow/addRow/deleteRow como el backend anterior.
//  Requiere: supabase-config.js (window.SB)
// ============================================================
(function () {
  var SB = window.SB;
  // URL de este propio script: sirve para resolver version.json sin
  // depender de en qué carpeta esté la página que lo incluye.
  var _selfSrc = (document.currentScript && document.currentScript.src) || location.href;

  // ── Módulo de cada página ──────────────────────────────────
  var PAGE_MODULE = {
    'index.html': 'dashboard',
    'pedidos.html': 'pedidos',
    'recepcion.html': 'recepcion',
    'stock.html': 'stock',
    'precios.html': 'precios',
    'proveedores.html': 'proveedores',
    'contingencia.html': 'contingencia',
    'copiloto.html': 'copiloto',
    'usuarios.html': 'usuarios'
  };
  // Módulos visibles/accesibles para cualquier usuario autenticado
  var OPEN_MODULES = ['dashboard', 'copiloto'];

  // Operario de recepción: usuario cuyo ÚNICO módulo es "recepcion".
  // Queda encerrado en recepcion.html (no ve costos ni otros módulos).
  function isOperario(profile) {
    return profile && profile.role === 'user' &&
      (profile.modules || []).length > 0 &&
      (profile.modules || []).every(function (m) { return m === 'recepcion'; });
  }

  function currentPage() {
    var p = location.pathname.split('/').pop() || 'index.html';
    return p === '' ? 'index.html' : p;
  }
  function currentModule() { return PAGE_MODULE[currentPage()] || 'dashboard'; }

  function canAccess(mod, profile) {
    if (!profile || !profile.activo) return false;
    if (profile.role === 'admin') return true;
    if (OPEN_MODULES.indexOf(mod) >= 0) return true;
    if (mod === 'usuarios') return false; // solo admin
    return (profile.modules || []).indexOf(mod) >= 0;
  }

  // ── Adaptadores tabla ↔ nombres de campo del Sheet ─────────
  // dbCol : headerKey que espera el módulo. num/date = tipos para escritura.
  var MAPS = {
    precios: {
      table: 'precios', payloadKeys: ['precios'],
      cols: {
        fecha_actualizado: 'FECHA ACTUALIZADO', codigo: 'CODIGO', articulo: 'ARTICULO',
        cod_prov: 'Cod Prov', proveedor: 'PROVEEDOR', precio_usd: 'PRECIO S/IVA U$S',
        precio_pesos: 'PRECIO S/IVA $', atencion: 'ATENCION DE VENTA', calidad: 'CALIDAD',
        demora: 'DEMORA DE ENTREGA', modalidad_pago: 'MODALIDAD DE PAGO'
      },
      num: ['precio_usd', 'precio_pesos'], date: ['fecha_actualizado']
    },
    pedidos: {
      table: 'pedidos', payloadKeys: ['pedidos'],
      cols: {
        fecha: 'Fecha', n_orden: 'N° Orden', proveedor: 'Proveedor', cantidad: 'Cantidad',
        descripcion: 'Descripción', moneda: '$/U$S', precio_un: 'Precio un', s_iva: 's/iva',
        c_iva: 'c/iva', f_recepcion: 'F.Recepción', f_vto: 'F. Vto', lote: 'Lote',
        coa: 'COA', conforme: 'Conforme', observaciones: 'Observaciones', recibido_por: 'Recibido por'
      },
      num: ['cantidad', 'precio_un', 's_iva', 'c_iva'], date: ['fecha', 'f_recepcion']
    },
    inventario: {
      table: 'inventario', payloadKeys: ['inventario'],
      cols: {
        codigo: 'CODIGO', descripcion: 'DESCRIPCIÓN', unidad: 'Unid.', presentacion: 'PRES.',
        consumo_mensual: 'CONSUMO MENSUAL', stock_minimo: 'STOCK MÍNIMO', inventario: 'INVENTARIO',
        solicitar: 'SOLICITAR', compra_sugerencia: 'COMPRA SUGERENCIA',
        proveedor_sugerido: 'PROOVEDOR SUGERIDO', pendiente_entrega: 'PENDIENTE DE ENTREGA',
        proveedor: 'PROVEEDOR', ext_id: 'ID'
      },
      num: ['consumo_mensual', 'stock_minimo', 'inventario', 'compra_sugerencia', 'pendiente_entrega'], date: []
    },
    contactos: {
      table: 'proveedores', payloadKeys: ['contactos', 'proveedores'],
      cols: {
        empresa: 'EMPRESA', nombre_contacto: 'Contacto', puesto: 'Puesto', email: 'Email',
        celular: 'Celular', telefono: 'Tel', rut: 'RUT', condicion_pago: 'Pago',
        rubro: 'Rubro', direccion: 'Direccion', calidad: 'Calidad', observaciones: 'Observaciones'
      },
      num: [], date: []
    },
    contingencia: {
      table: 'contingencia', payloadKeys: ['contingencia'],
      cols: {
        articulo: 'Artículo (Materia Prima)', unidad: 'Unidad', stock_inicial: 'Stock Inicial (KG/UN)',
        consumido: 'Consumido hasta hoy', stock_disponible: 'Stock Disponible', pct_restante: '% Restante',
        precio_usd_kg: 'Precio Compra USD/KG', consumo_mensual_est: 'Consumo Mensual Est.',
        meses_cobertura: 'Meses Cobertura', estado: 'Estado', motivo: 'Motivo', observaciones: 'Observaciones'
      },
      num: ['stock_inicial', 'consumido', 'stock_disponible', 'pct_restante', 'precio_usd_kg', 'consumo_mensual_est', 'meses_cobertura'], date: []
    }
  };
  // sheetKey (el que mandan los módulos) → definición
  var SHEETKEY = {
    precios: MAPS.precios, pedidos: MAPS.pedidos, inventario: MAPS.inventario,
    contactos: MAPS.contactos, proveedores: MAPS.contactos, contingencia: MAPS.contingencia
  };

  function rowToHeader(def, row) {
    var o = {};
    Object.keys(def.cols).forEach(function (c) { o[def.cols[c]] = row[c] == null ? '' : row[c]; });
    o.__row = row.id;   // los módulos usan __row como identificador de fila
    return o;
  }
  // invierte cols: headerKey → dbCol
  function headerToCol(def) {
    var inv = {}; Object.keys(def.cols).forEach(function (c) { inv[def.cols[c]] = c; }); return inv;
  }
  function coerce(def, dbCol, val) {
    if (val === '' || val === undefined || val === null) return null;
    if (def.num.indexOf(dbCol) >= 0) {
      var s = String(val).replace(/[^\d.,-]/g, '');
      if (s.indexOf('.') >= 0 && s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
      else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
      var n = parseFloat(s); return isFinite(n) ? n : null;
    }
    if (def.date.indexOf(dbCol) >= 0) {
      var m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null;
    }
    return String(val);
  }
  // fields con headerKeys → objeto {dbCol:valor} tipado
  function mapFields(def, fields) {
    var inv = headerToCol(def), out = {};
    Object.keys(fields).forEach(function (h) {
      if (h.indexOf('__') === 0 || h === 'id') return;
      var col = inv[h]; if (!col) return;
      out[col] = coerce(def, col, fields[h]);
    });
    return out;
  }

  // ── Estado de auth ─────────────────────────────────────────
  var _profile = null, _readyResolve, _ready = new Promise(function (r) { _readyResolve = r; });

  function loadProfile() {
    return SB.auth.getUser().then(function (res) {
      var user = res.data && res.data.user; if (!user) return null;
      return SB.from('profiles').select('*').eq('id', user.id).single().then(function (r) {
        return r.data || { id: user.id, email: user.email, role: 'user', modules: [], activo: true };
      });
    });
  }

  // ── Guardia de la página ───────────────────────────────────
  function guard() {
    var page = currentPage();
    if (page === 'login.html') { _readyResolve(null); return; }
    SB.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) { location.replace('login.html'); return; }
      loadProfile().then(function (profile) {
        _profile = profile;
        if (!profile || !profile.activo) {
          SB.auth.signOut().then(function () { location.replace('login.html?inactivo=1'); });
          return;
        }
        // El operario de recepción solo puede estar en recepcion.html
        if (isOperario(profile) && page !== 'recepcion.html') { location.replace('recepcion.html'); return; }
        var mod = currentModule();
        if (!canAccess(mod, profile)) { location.replace(isOperario(profile) ? 'recepcion.html' : ('index.html?denegado=' + mod)); return; }
        gateNav(profile);
        injectUserBar(profile);
        _readyResolve(profile);
        document.dispatchEvent(new CustomEvent('subatir:ready', { detail: profile }));
      });
    });
  }

  // Oculta links de nav a módulos sin acceso + agrega Usuarios (admin)
  function gateNav(profile) {
    var operario = isOperario(profile);
    document.querySelectorAll('nav a, .nl').forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('/').pop();
      var mod = PAGE_MODULE[href];
      if (operario) { if (mod !== 'recepcion') a.style.display = 'none'; return; }
      if (mod && mod !== 'usuarios' && !canAccess(mod, profile)) a.style.display = 'none';
    });
    var nav = document.querySelector('nav');
    var navClass = (nav && nav.querySelector('a')) ? nav.querySelector('a').className : 'nl';
    // Link a Recepción para quien tenga acceso (admin u operario)
    if (nav && !operario && canAccess('recepcion', profile) && !nav.querySelector('[href="recepcion.html"]')) {
      var r = document.createElement('a');
      r.href = 'recepcion.html'; r.className = navClass; r.textContent = '📥 Recepción';
      nav.appendChild(r);
    }
    // "Control de Stock Depósitos" ya no es un módulo de Compras: vive como
    // app aparte en /deposito (login y bootstrap propios, misma base).
    // Se llega desde el aviso de mercadería en camino del dashboard.
    // La clave 'importacion' se conserva porque está guardada en
    // profiles.modules de cada usuario y la usa el guard de esa app.
    if (profile.role === 'admin' && nav && !nav.querySelector('[href="usuarios.html"]')) {
      var a = document.createElement('a');
      a.href = 'usuarios.html'; a.className = navClass; a.textContent = '👥 Usuarios';
      nav.appendChild(a);
    }
  }

  // Barra de usuario (nombre + salir) en el header
  function injectUserBar(profile) {
    var host = document.querySelector('.hdr-r') || document.querySelector('header');
    if (!host || document.getElementById('sb-userbar')) return;
    var wrap = document.createElement('span');
    wrap.id = 'sb-userbar';
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:8px';
    var who = (profile.full_name || profile.email || '').split('@')[0];
    wrap.innerHTML = '<span style="font-size:11px;color:#7a8fa8;font-family:monospace">' +
      (profile.role === 'admin' ? '★ ' : '') + who + '</span>' +
      '<button id="sb-logout" style="cursor:pointer;font-size:10px;font-weight:700;padding:4px 9px;' +
      'border-radius:7px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#e2e8f0">Salir</button>';
    host.appendChild(wrap);
    document.getElementById('sb-logout').onclick = function () {
      SB.auth.signOut().then(function () { location.replace('login.html'); });
    };
  }

  // ── API de datos (compatible con el backend anterior) ──────
  function getData() {
    return _ready.then(function () {
      var jobs = Object.keys(MAPS).map(function (k) {
        var def = MAPS[k];
        return SB.from(def.table).select('*').then(function (r) {
          return { def: def, rows: (r.data || []).map(function (row) { return rowToHeader(def, row); }), error: r.error };
        });
      });
      return Promise.all(jobs).then(function (results) {
        var payload = { timestamp: new Date().toISOString(), sheetNames: [], historial: [], stock: [] };
        results.forEach(function (res) {
          res.def.payloadKeys.forEach(function (pk) { payload[pk] = res.rows; });
          if (res.error) console.error('getData', res.def.table, res.error);
        });
        return payload;
      });
    });
  }

  function updateRow(sheetKey, row, fields) {
    var def = SHEETKEY[sheetKey]; if (!def) return Promise.resolve({ error: 'sheetKey desconocido: ' + sheetKey });
    var patch = mapFields(def, typeof fields === 'string' ? JSON.parse(fields) : fields);
    return SB.from(def.table).update(patch).eq('id', row).then(function (r) {
      return r.error ? { error: r.error.message } : { success: true, row: row };
    });
  }
  function addRow(sheetKey, fields) {
    var def = SHEETKEY[sheetKey]; if (!def) return Promise.resolve({ error: 'sheetKey desconocido: ' + sheetKey });
    var ins = mapFields(def, typeof fields === 'string' ? JSON.parse(fields) : fields);
    return SB.from(def.table).insert(ins).select('id').single().then(function (r) {
      return r.error ? { error: r.error.message } : { success: true, id: r.data && r.data.id };
    });
  }
  function deleteRow(sheetKey, row) {
    var def = SHEETKEY[sheetKey]; if (!def) return Promise.resolve({ error: 'sheetKey desconocido: ' + sheetKey });
    return SB.from(def.table).delete().eq('id', row).then(function (r) {
      return r.error ? { error: r.error.message } : { success: true, row: row };
    });
  }

  // ── Pedidos: acciones legadas identificadas por N° Orden ───
  function updatePedidoByOrden(params) {
    var orden = String(params.get('orden'));
    var patch = {
      f_recepcion:   coerce(MAPS.pedidos, 'f_recepcion', params.get('recepcion')),
      f_vto:         params.get('vto') || null,   // fecha (texto) o "NO APLICA"
      lote:          params.get('lote') || null,
      coa:           params.get('coa') || null,
      conforme:      params.get('conforme') || null,
      observaciones: params.get('obs') || null
    };
    if (params.get('recibido_por')) patch.recibido_por = params.get('recibido_por');
    return SB.from('pedidos').update(patch).eq('n_orden', orden).then(function (r) {
      return r.error ? { error: r.error.message } : { success: true, orden: orden };
    });
  }
  function addPedidoLegacy(params) {
    return SB.from('pedidos').select('n_orden').then(function (r) {
      var max = 500;
      (r.data || []).forEach(function (x) { var n = parseInt(x.n_orden, 10); if (!isNaN(n) && n > max) max = n; });
      var cant = parseFloat(params.get('cantidad')) || 0, prec = parseFloat(params.get('precio')) || 0;
      var siva = cant * prec, civa = siva * 1.22;
      var ins = {
        n_orden: String(max + 1),
        fecha: coerce(MAPS.pedidos, 'fecha', params.get('fecha')),
        proveedor: params.get('proveedor') || null,
        descripcion: params.get('descripcion') || null,
        cantidad: cant, precio_un: prec,
        moneda: params.get('moneda') || null,
        s_iva: +siva.toFixed(2), c_iva: +civa.toFixed(2),
        f_vto: coerce(MAPS.pedidos, 'f_vto', params.get('vto')),
        observaciones: params.get('obs') || null
      };
      return SB.from('pedidos').insert(ins).select('id').single().then(function (r2) {
        return r2.error ? { error: r2.error.message } : { success: true, orden: ins.n_orden };
      });
    });
  }
  // Alta de una OC con varias líneas: todas comparten el mismo N° Orden
  function addPedidoMultiLegacy(params) {
    var items;
    try { items = JSON.parse(params.get('items') || '[]'); } catch (e) { return Promise.resolve({ error: 'items inválido' }); }
    if (!Array.isArray(items) || !items.length) return Promise.resolve({ error: 'Sin productos para la orden' });
    return SB.from('pedidos').select('n_orden').then(function (r) {
      var max = 500;
      (r.data || []).forEach(function (x) { var n = parseInt(x.n_orden, 10); if (!isNaN(n) && n > max) max = n; });
      var orden = String(max + 1);
      var fecha = coerce(MAPS.pedidos, 'fecha', params.get('fecha'));
      var prov  = params.get('proveedor') || null;
      var obs   = params.get('obs') || null;
      var rows = items.map(function (it) {
        var cant = parseFloat(it.cantidad) || 0, prec = parseFloat(it.precio) || 0;
        var siva = cant * prec, civa = siva * 1.22;
        return {
          n_orden: orden, fecha: fecha, proveedor: prov, descripcion: it.descripcion || null,
          cantidad: cant, precio_un: prec, moneda: it.moneda || null,
          s_iva: +siva.toFixed(2), c_iva: +civa.toFixed(2), observaciones: obs
        };
      });
      return SB.from('pedidos').insert(rows).select('id').then(function (r2) {
        return r2.error ? { error: r2.error.message } : { success: true, orden: orden, count: rows.length };
      });
    });
  }
  function deletePedidoByOrden(orden) {
    return SB.from('pedidos').delete().eq('n_orden', String(orden)).then(function (r) {
      return r.error ? { error: r.error.message } : { success: true, orden: orden };
    });
  }

  // ── Adaptador de compatibilidad: enruta URLs del backend viejo ──
  function legacyFetch(url, ok, err) {
    var params;
    try { params = new URL(url).searchParams; } catch (e) { return err && err(e); }
    var action = params.get('action') || 'getData';
    var run = function (p) { p.then(function (r) { ok && ok(r); }).catch(function (e) { (err || function () {})(e); }); };

    switch (action) {
      case 'getData':            return run(getData());
      case 'updateRow':          return run(updateRow(params.get('sheetKey'), params.get('row'), params.get('fields')));
      case 'addRow':             return run(addRow(params.get('sheetKey'), params.get('fields')));
      case 'deleteRow':          return run(deleteRow(params.get('sheetKey'), params.get('row')));
      case 'updateContingencia': return run(updateRow('contingencia', params.get('row'), params.get('fields')));
      case 'updatePedido':       return run(updatePedidoByOrden(params));
      case 'addPedido':          return run(addPedidoLegacy(params));
      case 'addPedidoMulti':     return run(addPedidoMultiLegacy(params));
      case 'deletePedido':       return run(deletePedidoByOrden(params.get('orden')));
      default:                   return run(Promise.resolve({ error: 'Acción no soportada: ' + action }));
    }
  }

  // ── Tiempo real ────────────────────────────────────────────
  // Suscribe a cambios de las tablas indicadas y llama a fn() (con debounce)
  // cuando algo cambia. Respaldo: también recarga al volver a la pestaña.
  function live(tables, fn, opts) {
    opts = opts || {};
    tables = Array.isArray(tables) ? tables : [tables];
    var delay = opts.delay || 600, timer = null, lastRun = 0;
    function trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; lastRun = Date.now(); try { fn(); } catch (e) { console.error('live()', e); } }, delay);
    }
    try {
      var ch = SB.channel('rt-' + tables.join('_') + '-' + Math.random().toString(36).slice(2));
      tables.forEach(function (t) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, trigger);
      });
      ch.subscribe(function (status) {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Realtime] ' + status + ' en ' + tables.join(', ') + ' — ¿tablas agregadas a la publicación supabase_realtime?');
        }
      });
    } catch (e) { console.warn('[Realtime] no disponible:', e); }
    // Respaldo: al volver a la pestaña, refrescá (evita quedar con datos viejos
    // si Realtime aún no está habilitado). Se ignora si recién se recargó.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Date.now() - lastRun > 1500) trigger();
    });
    return { reload: trigger };
  }

  // ── Escritura directa a la base (unificada para todos los módulos) ──
  // Devuelve una promesa con el resultado {success|error|...}. Sin cola de sync.
  function write(params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k] == null ? '' : params[k]);
    }).join('&');
    return new Promise(function (resolve) {
      legacyFetch('https://sb.local/?' + qs,
        function (d) { resolve(d || {}); },
        function (e) { resolve({ error: (e && e.message) || String(e) }); });
    });
  }

  // ── Categorías de productos (Envases / Consumibles / Materias Primas) ──
  function _catNorm(s){ return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' '); }
  // Devuelve un mapa { NORM(producto) : categoria }
  function categorias() {
    return SB.from('categorias').select('producto,categoria').then(function (r) {
      var map = {};
      (r.data || []).forEach(function (x) { map[_catNorm(x.producto)] = x.categoria; });
      return map;
    }, function () { return {}; });
  }
  function setCategoria(producto, categoria) {
    return SB.from('categorias').upsert({ producto: producto, categoria: categoria, updated_at: new Date().toISOString() })
      .then(function (r) { return r.error ? { error: r.error.message } : { success: true }; });
  }

  // ── Entregas parciales de recepción ────────────────────────
  function getEntregas() {
    return SB.from('entregas').select('*').then(function (r) { return r.data || []; }, function () { return []; });
  }
  function addEntrega(row) {
    return SB.from('entregas').insert(row).select('id').single()
      .then(function (r) { return r.error ? { error: r.error.message } : { success: true, id: r.data && r.data.id }; });
  }
  function deleteEntrega(id) {
    return SB.from('entregas').delete().eq('id', id)
      .then(function (r) { return r.error ? { error: r.error.message } : { success: true }; });
  }

  // ── Chequeo de versión ─────────────────────────────────────
  //  GitHub Pages sirve los HTML con max-age=600 y la gente deja la
  //  pestaña abierta todo el día, así que sin esto nunca se enteran de
  //  un deploy. El ?v= de los <script> no alcanza: lo que se queda
  //  viejo es el documento.
  //
  //  version.json se pide con cache:'no-store' + parámetro de tiempo,
  //  así que llega fresco aunque el HTML esté cacheado. Se compara con
  //  el window.APP_VER que cada módulo trae embebido (los escribe juntos
  //  bump-version.ps1). Mismo mecanismo que la app de Depósitos.
  //
  //  Diferencia con Depósitos: acá se editan formularios, así que NO se
  //  recarga encima de un modal abierto o de un campo con el foco — en
  //  ese caso se avisa con un cartel y decide la persona.
  var VER_URL = (function () {
    try { return new URL('version.json', _selfSrc).href; } catch (e) { return 'version.json'; }
  })();

  // ¿Hay algo abierto que se perdería al recargar?
  //  Los modales se detectan por GEOMETRÍA, no por clase ni por posición
  //  en el DOM: cada módulo usa su propia convención (.ovl, .overlay,
  //  .modal-overlay, clase .open, style.display…) y no todos cuelgan de
  //  <body>. Se mira qué elemento tapa el centro de la pantalla y se sube
  //  por sus padres buscando una capa que cubra el viewport. Es O(1) y no
  //  se confunde con el header sticky ni con el toast de abajo, que no
  //  pasan por el centro.
  function pageBusy() {
    var ae = document.activeElement;
    if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return true;
    if (ae && ae.isContentEditable) return true;
    if (!document.body) return false;
    var el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    while (el && el !== document.body && el !== document.documentElement) {
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { break; }
      if (cs.position === 'fixed' || cs.position === 'absolute') {
        var r = el.getBoundingClientRect();
        if (r.width >= innerWidth * 0.6 && r.height >= innerHeight * 0.6) return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  function verBanner(v) {
    if (document.getElementById('sb-ver-banner')) return;
    var b = document.createElement('div');
    b.id = 'sb-ver-banner';
    b.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;' +
      'display:flex;align-items:center;gap:12px;padding:11px 16px;border-radius:12px;' +
      'background:rgba(7,9,15,.94);backdrop-filter:blur(16px);border:1px solid rgba(249,115,22,.45);' +
      'box-shadow:0 12px 34px rgba(0,0,0,.5);color:#e2e8f0;font-family:system-ui,sans-serif;font-size:12.5px';
    b.innerHTML = '<span>Hay una versión nueva de la app.</span>' +
      '<button id="sb-ver-go" style="cursor:pointer;font-size:11px;font-weight:700;padding:6px 13px;' +
      'border-radius:8px;border:0;background:#f97316;color:#0b0f16">Actualizar</button>' +
      '<button id="sb-ver-x" title="Después" style="cursor:pointer;font-size:14px;line-height:1;padding:4px 7px;' +
      'border-radius:8px;border:1px solid rgba(255,255,255,.14);background:transparent;color:#7a8fa8">✕</button>';
    document.body.appendChild(b);
    document.getElementById('sb-ver-go').onclick = function () { reloadTo(v); };
    document.getElementById('sb-ver-x').onclick = function () { b.remove(); };
  }

  function reloadTo(v) {
    location.replace(location.pathname + '?v=' + encodeURIComponent(v) + location.hash);
  }

  function checkVersion() {
    if (!window.APP_VER) return;                    // módulo sin versionar: no molestar
    return fetch(VER_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.v || j.v === window.APP_VER) return;
        // Ya se recargó por esta versión y seguimos viejos: el servidor
        // todavía manda el documento cacheado. Cartel, no bucle.
        if (sessionStorage.getItem('sb_ver_reload') === j.v) { verBanner(j.v); return; }
        if (pageBusy()) { verBanner(j.v); return; }
        sessionStorage.setItem('sb_ver_reload', j.v);
        if (window.toast) toast('Hay una versión nueva — actualizando…', 'info');
        setTimeout(function () { reloadTo(j.v); }, 1200);
      })
      .catch(function () { });                       // sin conexión no es motivo para molestar
  }

  function startVersionCheck() {
    if (!window.APP_VER) return;
    checkVersion();
    setInterval(checkVersion, 600000);              // 10 min: la pestaña queda abierta todo el día
    // Volver a la pestaña es el mejor momento para mirar
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkVersion();
    });
  }

  // ── Export ─────────────────────────────────────────────────
  window.SubatirApp = {
    ready: _ready,
    checkVersion: checkVersion,
    getProfile: function () { return _profile; },
    getData: getData,
    updateRow: updateRow, addRow: addRow, deleteRow: deleteRow,
    legacyFetch: legacyFetch, write: write,
    categorias: categorias, setCategoria: setCategoria,
    getEntregas: getEntregas, addEntrega: addEntrega, deleteEntrega: deleteEntrega,
    live: live,
    logout: function () { return SB.auth.signOut().then(function () { location.replace('login.html'); }); },
    canAccess: canAccess, currentModule: currentModule
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { guard(); startVersionCheck(); });
  } else { guard(); startVersionCheck(); }
})();
