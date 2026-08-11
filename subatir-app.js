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

  // Pantallas de celular de la app de Depósitos: viven en /deposito, con
  // su propio guard, y no abren nada de Compras. No cuentan para decidir
  // quién es operario: un operario de recepción que además pide mercadería
  // sigue siendo operario acá.
  var MODULOS_DEPOSITO = ['solicitante', 'recorrido'];

  // Dónde vive cada pantalla de celular del depósito, para poder mandar
  // a su casa a quien no tiene nada que hacer en Compras. El orden importa:
  // el primero que tenga es el que se usa.
  var CASA_DEPOSITO = [['recorrido', 'deposito/recorrido.html'],
                       ['solicitante', 'deposito/solicitar.html']];

  // Los módulos del usuario que abren algo de ESTA app.
  function modulosCompras(profile) {
    return (profile && profile.modules || []).filter(function (m) {
      return MODULOS_DEPOSITO.indexOf(m) < 0;
    });
  }

  // Operario de recepción: usuario cuyo único módulo DE COMPRAS es
  // "recepcion". Queda encerrado en recepcion.html (no ve costos ni
  // otros módulos).
  function isOperario(profile) {
    if (!profile || profile.role !== 'user') return false;
    var mods = modulosCompras(profile);
    return mods.length > 0 && mods.every(function (m) { return m === 'recepcion'; });
  }

  // Quien sólo tiene módulos del depósito no entra a Compras: el dashboard
  // está abierto a cualquier autenticado y muestra importes. Devuelve a
  // dónde mandarlo, o null si Compras sí es su lugar.
  function casaDeposito(profile) {
    if (!profile || profile.role === 'admin') return null;
    if (modulosCompras(profile).length > 0) return null;
    var mods = profile.modules || [];
    for (var i = 0; i < CASA_DEPOSITO.length; i++) {
      if (mods.indexOf(CASA_DEPOSITO[i][0]) >= 0) return CASA_DEPOSITO[i][1];
    }
    return null;
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
        codigo: 'Código',
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
        // Sin ningún módulo de Compras no se entra acá: si su lugar es la
        // app de Depósitos va derecho ahí, y si no tiene nada asignado se
        // cierra la sesión (dejarlo pasar sería mostrarle el dashboard).
        var casa = casaDeposito(profile);
        if (casa) { location.replace(casa); return; }
        if (profile.role !== 'admin' && modulosCompras(profile).length === 0) {
          SB.auth.signOut().then(function () { location.replace('login.html?sinacceso=1'); });
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
      var desc = params.get('descripcion') || null;
      var siva = cant * prec, civa = siva * ivaMult(desc);
      var ins = {
        n_orden: String(max + 1),
        fecha: coerce(MAPS.pedidos, 'fecha', params.get('fecha')),
        proveedor: params.get('proveedor') || null,
        descripcion: desc,
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
        var siva = cant * prec, civa = siva * ivaMult(it.descripcion);
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

  // ── IVA por artículo ───────────────────────────────────────
  //  Casi todo va al 22% (tasa básica), pero hay artículos que por
  //  su naturaleza van a la tasa mínima del 10%. Antes el 1.22
  //  estaba escrito a mano en 12 lugares de pedidos/recepción, así
  //  que una excepción había que acordarse de aplicarla en todos.
  //  Ahora la tasa sale siempre de acá.
  //
  //  El match es por nombre normalizado y por "contiene", no por
  //  igualdad: el mismo artículo se llama distinto en cada tabla
  //  ("Sal Fina Yodada" en inventario, "Sal fina Yodada para
  //  detergentes x KG (Materia Prima)" en las OC), así que un
  //  match exacto fallaría justo donde importa, que es la OC.
  var IVA_BASICA = 0.22;
  var IVA_EXCEPCIONES = [
    { patron: 'SAL FINA YODADA', tasa: 0.10 }
  ];

  // Tasa como fracción: 0.22 / 0.10
  function ivaTasa(descripcion) {
    var d = _catNorm(descripcion);
    if (!d) return IVA_BASICA;
    for (var i = 0; i < IVA_EXCEPCIONES.length; i++) {
      if (d.indexOf(IVA_EXCEPCIONES[i].patron) >= 0) return IVA_EXCEPCIONES[i].tasa;
    }
    return IVA_BASICA;
  }
  // Multiplicador para pasar de s/IVA a c/IVA: 1.22 / 1.10
  function ivaMult(descripcion) { return 1 + ivaTasa(descripcion); }
  // Monto de IVA de una línea
  function ivaMonto(descripcion, sIva) { return (parseFloat(sIva) || 0) * ivaTasa(descripcion); }

  // ── Categorías de productos (Envases / Consumibles / Materias Primas) ──
  function _catNorm(s){ return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' '); }
  // Devuelve un mapa { NORM(producto) : categoria }
  // ── Categorías ─────────────────────────────────────────────
  //  La categoría sale de inventario.ext_id, NO de la tabla
  //  `categorias`. Había dos fuentes y se contradecían en 13
  //  productos; el equipo de la plataforma confirmó que en esos 13
  //  la buena es ext_id (coincide con core.insumos). La tabla
  //  `categorias` queda como dato viejo: no se lee más.
  //
  //  En la Etapa 4 de la integración, ext_id se reemplaza por el FK
  //  a core.insumos. Al estar acá y no repartido por los módulos,
  //  ese cambio es este solo lugar.
  var EXT_CAT = { MP: 'Materias Primas', ENV: 'Envases', CON: 'Consumibles' };
  var CAT_EXT = { 'Materias Primas': 'MP', 'Envases': 'ENV', 'Consumibles': 'CON' };

  function categorias() {
    return SB.from('inventario').select('descripcion,ext_id').then(function (r) {
      var map = {};
      (r.data || []).forEach(function (x) {
        var c = EXT_CAT[x.ext_id];
        if (c) map[_catNorm(x.descripcion)] = c;
      });
      return map;
    }, function () { return {}; });
  }

  //  Escribe sobre la fila de inventario que se llame igual. Si el
  //  artículo no está en inventario no hay dónde guardarlo: se avisa
  //  en vez de escribir en una tabla que ya nadie lee, que se vería
  //  como que guardó y no cambiaría nada.
  function setCategoria(producto, categoria) {
    var ext = categoria ? CAT_EXT[categoria] : null;
    if (categoria && !ext) return Promise.resolve({ error: 'Categoría desconocida: ' + categoria });
    var objetivo = _catNorm(producto);
    return SB.from('inventario').select('id,descripcion').then(function (r) {
      if (r.error) return { error: r.error.message };
      var fila = (r.data || []).find(function (x) { return _catNorm(x.descripcion) === objetivo; });
      if (!fila) {
        return { error: '"' + producto + '" no está en el inventario, así que no tiene dónde guardar la categoría' };
      }
      return SB.from('inventario').update({ ext_id: ext }).eq('id', fila.id).then(function (u) {
        return u.error ? { error: u.error.message } : { success: true };
      });
    });
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

  // ══════════════════════════════════════════════════════════
  //  PL-06 · Check List para la recepción de mercadería
  //  Documento controlado de Dirección Técnica. Vive acá y no en
  //  cada módulo para que una revisión del procedimiento se toque
  //  en UN solo lugar: lo usan Recepción y Pedidos.
  //  Se guarda en entregas.checklist (jsonb) como [{n,conforme,obs}].
  // ══════════════════════════════════════════════════════════
  var PL06 = (function () {
    var ITEMS = [
      'Fecha vencimiento del producto (mínimo 6 meses de vida útil).',
      'Factura y remito coinciden con la Orden de Compra',
      'Verificación de cantidades recibidas (kg/L)',
      'Certificados de Análisis (COA) correspondencia con lote recibido',
      'Ausencia de derrames, daños, roturas o fugas, cierre correcto.',
      'Etiquetado completo (nombre, lote, peso neto, etc).',
      'Envases originales (pesado aleatorio)',
      'Envases rellenados o a granel (pesado total)'
    ];
    var DOC = {
      codigo: 'PL-06', version: '1', creacion: 'Dic-25',
      rev: { fecha: '28.12.25', n: '1', elaboro: 'Carolina Marín', aprobo: 'Carolina Marín',
             motivo: 'Actualizacion de formato del documento', cambios: 'Cambio de formato' }
    };

    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function fmtDate(d) {
      if (!d || d === '' || d === '0000-00-00') return '—';
      var p = String(d).split('-');
      if (p.length === 3 && p[0].length === 4) return p[2] + '/' + p[1] + '/' + p[0];
      return String(d);
    }
    function fmtNum(n) {
      var v = parseFloat(n); if (isNaN(v)) return '';
      return v.toLocaleString('es-UY', { maximumFractionDigits: 2 });
    }
    function $(id) { return document.getElementById(id); }

    // ── Estilos: se inyectan una sola vez, con clases propias (cl-*)
    var CSS = [
      '.cl-wrap{margin-top:18px;border:1px solid rgba(249,115,22,.22);border-radius:12px;',
      'background:linear-gradient(150deg,rgba(249,115,22,.07),rgba(255,255,255,.02));padding:14px}',
      '.cl-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:12px}',
      '.cl-head h4{margin:0;font-size:12px;font-weight:800;letter-spacing:.5px;',
      'text-transform:uppercase;color:var(--orange-l,#fb923c)}',
      '.cl-tag{font-family:var(--mono,monospace);font-size:10px;color:var(--muted-l,#94a3b8);',
      'border:1px solid var(--border,rgba(255,255,255,.07));border-radius:6px;padding:2px 7px}',
      '.cl-all{margin-left:auto}',
      '.cl-auto{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}',
      '.cl-af{background:rgba(255,255,255,.04);border:1px solid var(--border,rgba(255,255,255,.07));',
      'border-radius:8px;padding:6px 10px}',
      '.cl-af span{display:block;font-size:9.5px;font-weight:700;letter-spacing:.4px;',
      'text-transform:uppercase;color:var(--muted,#5a6a80)}',
      '.cl-af b{font-size:12.5px;font-weight:600;color:var(--text,#e2e8f0)}',
      '.cl-tbl{border:1px solid var(--border,rgba(255,255,255,.07));border-radius:9px;',
      'overflow:hidden;background:rgba(255,255,255,.02)}',
      '.cl-row{display:grid;grid-template-columns:26px 1fr 104px 168px;gap:9px;align-items:center;',
      'padding:7px 10px;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px}',
      '.cl-row:last-child{border-bottom:none}',
      '.cl-row.hdr{background:rgba(255,255,255,.05);font-size:9.5px;font-weight:800;',
      'letter-spacing:.4px;text-transform:uppercase;color:var(--muted,#5a6a80)}',
      '.cl-row.hdr div:nth-child(3){text-align:center}',
      '.cl-row:not(.hdr):hover{background:rgba(27,200,255,.045)}',
      '.cl-row.falta{background:rgba(245,158,11,.07)}',
      '.cl-n{font-family:var(--mono,monospace);color:var(--muted-l,#94a3b8);text-align:center}',
      '.cl-it{line-height:1.35}',
      '.cl-sn{display:flex;gap:12px;justify-content:center}',
      '.cl-sn label{display:flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;',
      'text-transform:none;letter-spacing:0;color:var(--muted-l,#94a3b8);cursor:pointer}',
      '.cl-sn input{width:15px;height:15px;cursor:pointer;margin:0;accent-color:var(--ok,#22c55e)}',
      '.cl-sn input.n{accent-color:var(--danger,#ef4444)}',
      '.cl-sn label.on-si{color:var(--ok,#22c55e)}',
      '.cl-sn label.on-no{color:var(--danger,#ef4444)}',
      '.cl-obs{width:100%;padding:5px 8px;font-size:11.5px;border-radius:7px;',
      'background:rgba(255,255,255,.06);border:1px solid var(--border,rgba(255,255,255,.07));',
      'color:var(--text,#e2e8f0);outline:none}',
      '.cl-obs:focus{border-color:var(--teal-l,#1bc8ff)}',
      '.cl-obs.req{border-color:var(--danger,#ef4444)}',
      '@media(max-width:640px){',
      '.cl-auto{grid-template-columns:1fr}',
      '.cl-row{grid-template-columns:24px 1fr;row-gap:7px}',
      '.cl-row.hdr{display:none}',
      '.cl-sn,.cl-obs{grid-column:2}',
      '.cl-sn{justify-content:flex-start}}'
    ].join('');

    function injectCSS() {
      if (document.getElementById('pl06-css')) return;
      var s = document.createElement('style');
      s.id = 'pl06-css'; s.textContent = CSS;
      document.head.appendChild(s);
    }

    // ── Monta el bloque completo dentro de un contenedor ──
    function mount(hostId) {
      var host = $(hostId); if (!host) return;
      injectCSS();
      host.innerHTML =
        '<div class="cl-wrap">'
        + '<div class="cl-head">'
          + '<h4>📋 Check List de Recepción</h4>'
          + '<span class="cl-tag">' + DOC.codigo + ' · v' + DOC.version + ' · ' + DOC.creacion + '</span>'
          + '<button type="button" class="btn btn-ghost btn-sm cl-all" style="padding:4px 10px" '
          + 'onclick="SubatirApp.PL06.todoSi()">✓ Todo Sí</button>'
        + '</div>'
        + '<div class="cl-auto">'
          + '<div class="cl-af"><span>Fecha de recepción</span><b id="cl-fecha">—</b></div>'
          + '<div class="cl-af"><span>Proveedor</span><b id="cl-prov">—</b></div>'
          + '<div class="cl-af"><span>Orden de compra N°</span><b id="cl-orden">—</b></div>'
          + '<div class="cl-af"><span>Producto</span><b id="cl-prod">—</b></div>'
          + '<div class="form-group"><label>Factura N°</label>'
            + '<input type="text" class="form-input" id="cl-factura" placeholder="Ej: A 0001-0012345"/></div>'
          + '<div class="form-group"><label>Remito / Guía N°</label>'
            + '<input type="text" class="form-input" id="cl-remito" placeholder="Ej: R 0001-0004321"/></div>'
        + '</div>'
        + '<div class="cl-tbl">'
          + '<div class="cl-row hdr"><div>N°</div><div>Ítem</div><div>Conforme</div><div>Observaciones</div></div>'
          + ITEMS.map(function (txt, i) {
              var n = i + 1;
              return '<div class="cl-row" id="cl-r' + n + '">'
                + '<div class="cl-n">' + n + '</div>'
                + '<div class="cl-it">' + esc(txt) + '</div>'
                + '<div class="cl-sn">'
                  + '<label id="cl-l' + n + 's"><input type="radio" name="cl-' + n + '" value="SI" '
                  + 'onchange="SubatirApp.PL06.pick(' + n + ')"/>Sí</label>'
                  + '<label id="cl-l' + n + 'n"><input type="radio" class="n" name="cl-' + n + '" value="NO" '
                  + 'onchange="SubatirApp.PL06.pick(' + n + ')"/>No</label>'
                + '</div>'
                + '<div><input type="text" class="cl-obs" id="cl-o' + n + '" placeholder="—"/></div>'
                + '</div>';
            }).join('')
        + '</div>'
        + '<div style="margin-top:8px;font-size:11px;color:var(--muted,#5a6a80)">Si marcás '
        + '<b style="color:var(--danger,#ef4444)">No</b> en algún punto, la observación es obligatoria.</div>'
        + '</div>';
      reset();
    }

    function valor(n) {
      var el = document.querySelector('input[name="cl-' + n + '"]:checked');
      return el ? el.value : '';
    }
    function pick(n) {
      var v = valor(n);
      $('cl-l' + n + 's').className = v === 'SI' ? 'on-si' : '';
      $('cl-l' + n + 'n').className = v === 'NO' ? 'on-no' : '';
      $('cl-r' + n).classList.remove('falta');
      var o = $('cl-o' + n);
      if (v === 'NO') { o.placeholder = 'Detallar el desvío…'; }
      else { o.placeholder = '—'; o.classList.remove('req'); }
    }
    function todoSi() {
      for (var n = 1; n <= ITEMS.length; n++) {
        var r = document.querySelector('input[name="cl-' + n + '"][value="SI"]');
        if (r) { r.checked = true; pick(n); }
      }
    }
    function reset() {
      if (!$('cl-r1')) return;
      for (var n = 1; n <= ITEMS.length; n++) {
        var rs = document.getElementsByName('cl-' + n);
        for (var i = 0; i < rs.length; i++) rs[i].checked = false;
        var o = $('cl-o' + n); if (o) { o.value = ''; o.classList.remove('req'); }
        pick(n);
      }
      $('cl-factura').value = ''; $('cl-remito').value = '';
    }
    // Encabezado autocompletado con lo que ya sabemos de la OC
    function setHead(h) {
      if (!$('cl-fecha')) return;
      $('cl-fecha').textContent = fmtDate(h.fecha);
      $('cl-prov').textContent  = String(h.proveedor || '—');
      $('cl-orden').textContent = String(h.orden || '—');
      $('cl-prod').textContent  = String(h.producto || '—');
    }
    // Lo que se guarda en la columna jsonb
    function read() {
      var out = [];
      for (var n = 1; n <= ITEMS.length; n++) {
        out.push({ n: n, conforme: valor(n), obs: ($('cl-o' + n).value || '').trim() });
      }
      return out;
    }
    function factura() { return ($('cl-factura').value || '').trim() || null; }
    function remito()  { return ($('cl-remito').value  || '').trim() || null; }

    // Antes de guardar. toast = la función de avisos del módulo.
    function validate(toast) {
      if (!$('cl-r1')) return true;
      var faltaObs = [], sinMarcar = [];
      for (var n = 1; n <= ITEMS.length; n++) {
        var v = valor(n), o = $('cl-o' + n);
        o.classList.remove('req');
        $('cl-r' + n).classList.remove('falta');
        if (!v) sinMarcar.push(n);
        if (v === 'NO' && !o.value.trim()) { faltaObs.push(n); o.classList.add('req'); }
      }
      if (faltaObs.length) {
        toast('Punto ' + faltaObs.join(', ') + ' marcado "No": completá la observación', 'err');
        $('cl-o' + faltaObs[0]).focus();
        return false;
      }
      if (sinMarcar.length) {
        $('cl-r' + sinMarcar[0]).classList.add('falta');
        return confirm('Quedan ' + sinMarcar.length + ' punto(s) del check list sin marcar ('
          + sinMarcar.join(', ') + ').\n\n¿Registrar la entrega igual?');
      }
      return true;
    }
    function parse(v) {
      if (!v) return [];
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return []; } }
      return Array.isArray(v) ? v : [];
    }
    // Para el chip del historial: "7 Sí / 1 No"
    function resumen(v) {
      var a = parse(v); if (!a.length) return null;
      var si = 0, no = 0;
      a.forEach(function (c) { if (c.conforme === 'SI') si++; else if (c.conforme === 'NO') no++; });
      return { si: si, no: no, total: a.length };
    }
    // Rellena el bloque con una entrega ya guardada
    function fill(e) {
      reset();
      $('cl-factura').value = e.factura || '';
      $('cl-remito').value  = e.remito  || '';
      parse(e.checklist).forEach(function (c) {
        var r = document.querySelector('input[name="cl-' + c.n + '"][value="' + c.conforme + '"]');
        if (r) { r.checked = true; pick(c.n); }
        var o = $('cl-o' + c.n); if (o) o.value = c.obs || '';
      });
    }

    // ── Marca PROlimpio del encabezado (vectorial: sin depender de una imagen)
    function drawProlimpio(doc, x, y, w, h) {
      var OR = [242, 101, 34], cy = y + h / 2;
      var r = Math.min(13, h / 2 - 9), cx = x + 12 + r;
      doc.setFillColor(OR[0], OR[1], OR[2]); doc.circle(cx, cy - 2, r, 'F');
      doc.setFillColor(255, 255, 255); doc.circle(cx - r * 0.30, cy - 2 - r * 0.28, r * 0.52, 'F');
      doc.setFillColor(OR[0], OR[1], OR[2]); doc.circle(cx - r * 0.10, cy - 2 - r * 0.10, r * 0.52, 'F');
      // El texto se achica hasta entrar en la celda (si no, lo corta el divisor)
      var tx = cx + r + 5, maxW = (x + w - 6) - tx, fs = 15;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(fs);
      while (fs > 8 && doc.getTextWidth('PROlimpio') > maxW) { fs -= 0.5; doc.setFontSize(fs); }
      doc.setTextColor(45, 45, 45);        doc.text('PRO', tx, cy + 3);
      doc.setTextColor(OR[0], OR[1], OR[2]);
      doc.text('limpio', tx + doc.getTextWidth('PRO'), cy + 3);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(20, 20, 20);
      doc.text('SUBATIR S.A.', x + 2, y + h - 3);
    }

    // ── PDF: réplica del formulario PL-06 (A4 vertical, blanco y negro)
    //  d = {fecha, proveedor, orden, producto, factura, remito, lote,
    //       cantidad, recibido_por, items:[{n,conforme,obs}]}
    function pdf(d, toast) {
      if (!window.jspdf || !window.jspdf.jsPDF) {
        (toast || alert)('No se pudo cargar el generador de PDF (revisá tu conexión).', 'err');
        return;
      }
      var doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
      var M = 42, CW = W - 2 * M, GR = 0.7;
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(GR);

      // Encabezado: logo | título | datos del documento
      var hy = 52, hh = 62, c1 = M + 118, c2 = W - M - 152;
      doc.rect(M, hy, CW, hh, 'S'); doc.line(c1, hy, c1, hy + hh); doc.line(c2, hy, c2, hy + hh);
      drawProlimpio(doc, M, hy, c1 - M, hh);
      // El título va en UNA sola línea (como el original): achico hasta que entre
      var tit = 'CHECK LIST PARA RECEPCIÓN DE MERCADERIA', ts = 10.5;
      doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0); doc.setFontSize(ts);
      while (ts > 7 && doc.getTextWidth(tit) > c2 - c1 - 12) { ts -= 0.25; doc.setFontSize(ts); }
      doc.text(tit, (c1 + c2) / 2, hy + hh / 2 + 4, { align: 'center' });
      var meta = [['CÓDIGO', DOC.codigo], ['VERSIÓN', DOC.version],
                  ['FECHA CREACION', DOC.creacion], ['PÁGINA', '1-1']];
      var rh = hh / 4, mx = c2 + 80;
      doc.line(mx, hy, mx, hy + hh);
      meta.forEach(function (m, i) {
        var ry = hy + rh * i;
        if (i) doc.line(c2, ry, W - M, ry);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6);
        doc.text(m[0], c2 + 4, ry + rh / 2 + 2.5);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6);
        doc.text(m[1], mx + 4, ry + rh / 2 + 2.5);
      });

      // Datos de la recepción
      var dat = [
        ['Fecha de recepción:', fmtDate(d.fecha) === '—' ? '' : fmtDate(d.fecha)],
        ['Proveedor:',          String(d.proveedor || '')],
        ['Orden de compra N°:', String(d.orden || '')],
        ['Factura N°:',         String(d.factura || '')],
        ['Remito/Guía N°:',     String(d.remito || '')],
        ['Producto:',           String(d.producto || '')],
        ['Lote / Cantidad recibida:',
          [String(d.lote || ''), (d.cantidad ? fmtNum(d.cantidad) : '')].filter(Boolean).join('   ·   ')]
      ];
      var dy = hy + hh + 20, drh = 22, dlw = 170;
      doc.rect(M, dy, CW, drh * dat.length, 'S');
      doc.line(M + dlw, dy, M + dlw, dy + drh * dat.length);
      dat.forEach(function (p, i) {
        var ry = dy + drh * i;
        if (i) doc.line(M, ry, W - M, ry);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6); doc.setTextColor(0, 0, 0);
        doc.text(p[0], M + 6, ry + drh / 2 + 3);
        doc.setFont('helvetica', 'bold');
        var t = String(p[1] || ''), maxW = CW - dlw - 14, s = 9;
        doc.setFontSize(s);
        while (s > 6.5 && doc.getTextWidth(t) > maxW) { s -= 0.4; doc.setFontSize(s); }
        doc.text(t, M + dlw + 7, ry + drh / 2 + 3, { maxWidth: maxW });
      });

      // Los 8 puntos de control
      var items = (d.items && d.items.length)
        ? d.items
        : ITEMS.map(function (_, i) { return { n: i + 1, conforme: '', obs: '' }; });
      var byN = {}; items.forEach(function (c) { byN[c.n] = c; });
      var body = ITEMS.map(function (txt, i) {
        var c = byN[i + 1] || {};
        return [String(i + 1), txt,
                c.conforme === 'SI' ? 'Sí' : (c.conforme === 'NO' ? 'No' : ''),
                String(c.obs || '')];
      });
      doc.autoTable({
        startY: dy + drh * dat.length + 22,
        head: [['N°', 'Item', 'Conforme\n(Sí / No)', 'Observaciones']],
        body: body, theme: 'grid', margin: { left: M, right: M },
        styles: { font: 'helvetica', fontSize: 8.4, cellPadding: 6, textColor: [0, 0, 0],
                  lineColor: [0, 0, 0], lineWidth: 0.7, valign: 'middle', minCellHeight: 26 },
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold',
                      fontSize: 8.4, halign: 'center', valign: 'middle' },
        columnStyles: { 0: { cellWidth: 32, halign: 'center' },
                        1: { cellWidth: CW - 32 - 66 - 130 },
                        2: { cellWidth: 66, halign: 'center', fontStyle: 'bold' },
                        3: { cellWidth: 130, fontSize: 7.6 } }
      });

      // Firma del responsable
      var fy = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 400) + 26, fh = 76;
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(GR); doc.rect(M, fy, CW, fh, 'S');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
      doc.text('Firma responsable de recepción:', M + 7, fy + 16);
      if (d.recibido_por) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.4); doc.setTextColor(70, 70, 70);
        doc.text('Recibió: ' + String(d.recibido_por), M + 7, fy + fh - 9);
      }

      // Tabla de revisiones (pie del procedimiento)
      var rv = DOC.rev;
      doc.autoTable({
        startY: Math.min(fy + fh + 40, H - 150),
        head: [['Fecha:', 'N° revisión:', 'Elaborado por:', 'Aprobado por:',
                'Motivos de la revisión:', 'Cambios realizados:']],
        body: [[rv.fecha, rv.n, rv.elaboro, rv.aprobo, rv.motivo, rv.cambios]],
        theme: 'grid', margin: { left: M, right: M },
        styles: { font: 'helvetica', fontSize: 7.4, cellPadding: 5, halign: 'center',
                  valign: 'middle', textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.7 },
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold',
                      fontSize: 7.4, halign: 'center' }
      });

      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(0, 0, 0);
      doc.text('SUBATIR S.A.S Dirección Técnica', W / 2, H - 30, { align: 'center' });

      var slug = String(d.producto || 'producto')
        .replace(/[^\w\dáéíóúñÁÉÍÓÚÑ ]+/g, '').trim().slice(0, 28).replace(/\s+/g, '-');
      doc.save('PL-06-OC' + String(d.orden || '') + '-' + slug + '.pdf');
    }

    // Las columnas del PL-06 son nuevas: si la base todavía no las tiene
    // (falta correr migracion/checklist_pl06.sql) el insert falla por schema.
    function esErrorDeEsquema(msg) {
      return /column|checklist|factura|remito|schema cache/i.test(String(msg || ''));
    }

    return {
      ITEMS: ITEMS, DOC: DOC,
      mount: mount, reset: reset, setHead: setHead, pick: pick, todoSi: todoSi,
      read: read, factura: factura, remito: remito,
      validate: validate, parse: parse, resumen: resumen, fill: fill,
      pdf: pdf, esErrorDeEsquema: esErrorDeEsquema
    };
  })();

  // ── Export ─────────────────────────────────────────────────
  window.SubatirApp = {
    ready: _ready,
    checkVersion: checkVersion,
    getProfile: function () { return _profile; },
    getData: getData,
    updateRow: updateRow, addRow: addRow, deleteRow: deleteRow,
    legacyFetch: legacyFetch, write: write,
    categorias: categorias, setCategoria: setCategoria,
    ivaTasa: ivaTasa, ivaMult: ivaMult, ivaMonto: ivaMonto,
    getEntregas: getEntregas, addEntrega: addEntrega, deleteEntrega: deleteEntrega,
    PL06: PL06,
    live: live,
    logout: function () { return SB.auth.signOut().then(function () { location.replace('login.html'); }); },
    canAccess: canAccess, currentModule: currentModule
  };

  // ── Arrancar siempre desde arriba ──────────────────────────
  //  Mismo criterio que en Depósitos: el navegador restaura el scroll
  //  donde había quedado y en estas páginas —tablas de 600 renglones—
  //  eso te deja en el medio, sin encabezados y sin saber dónde estás.
  //  Se sube al tope al arrancar y otra vez cuando terminó de cargar:
  //  las tablas se pintan después y arrastran el scroll con ellas.
  function alTope() {
    try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}
    var sube = function () { window.scrollTo(0, 0); };
    sube();
    requestAnimationFrame(sube);
    window.addEventListener('load', function () { setTimeout(sube, 0); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { alTope(); guard(); startVersionCheck(); });
  } else { alTope(); guard(); startVersionCheck(); }
})();
