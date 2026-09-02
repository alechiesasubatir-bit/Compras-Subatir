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
    'reposicion.html': 'stock',
    'precios.html': 'precios',
    'proveedores.html': 'proveedores',
    'varios.html': 'varios',
    'mp-importacion.html': 'mp_importacion',
    'usuarios.html': 'usuarios'
  };
  // Módulos visibles/accesibles para cualquier usuario autenticado
  var OPEN_MODULES = ['dashboard'];

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
        codigo: 'Código', inventario_id: 'ID Inventario',
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
        proveedor: 'PROVEEDOR', ext_id: 'ID',
        seguimiento: 'SEGUIMIENTO', revisar_cada_meses: 'REVISAR CADA MESES',
        proxima_revision: 'PROXIMA REVISION', prov_auto_at: 'PROV AUTO AT',
        prov_auto_oc: 'PROV AUTO OC', prov_auto_anterior: 'PROV AUTO ANTERIOR',
        prov_auto_off: 'PROV AUTO OFF'
      },
      num: ['consumo_mensual', 'stock_minimo', 'inventario', 'compra_sugerencia', 'pendiente_entrega', 'revisar_cada_meses'], date: ['proxima_revision']
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
  };
  // sheetKey (el que mandan los módulos) → definición
  var SHEETKEY = {
    precios: MAPS.precios, pedidos: MAPS.pedidos, inventario: MAPS.inventario,
    contactos: MAPS.contactos, proveedores: MAPS.contactos
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

    // Ida a la app de Depósitos. La vuelta ya existía allá; faltaba este
    // lado, así que para cruzar había que escribir la URL a mano.
    // Solo a quien tenga algo que hacer allá: al resto su guard lo rebota.
    var mods = profile.modules || [];
    var vaAlDeposito = profile.role === 'admin' ||
      ['solicitante', 'recorrido', 'recepcion_deposito', 'importacion'].some(function (m) {
        return mods.indexOf(m) >= 0;
      });

    // El menú lo arma nav.js: un solo orden y un color por módulo para
    // las nueve páginas. Acá sólo se decide QUIÉN ve qué.
    if (window.SubatirNav) {
      SubatirNav.render({
        page: currentPage(),
        can: function (k) {
          // El operario de recepción no sale de su pantalla: menú de uno.
          if (operario) return k === 'recepcion';
          if (k === 'deposito') return vaAlDeposito;
          if (k === 'usuarios') return profile.role === 'admin';
          return canAccess(k, profile);
        }
      });
      return;
    }

    // Respaldo por si nav.js no cargó: se filtra el menú escrito en el HTML.
    document.querySelectorAll('nav a, .nl').forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('/').pop();
      var mod = PAGE_MODULE[href];
      if (operario) { if (mod !== 'recepcion') a.style.display = 'none'; return; }
      if (mod && mod !== 'usuarios' && !canAccess(mod, profile)) a.style.display = 'none';
    });
    var nav = document.querySelector('nav');
    // La clase se saca de un link INACTIVO: copiar la del primero pintaba
    // de "página actual" a todo lo que se agregara acá (en el dashboard el
    // primero es el activo, y quedaban tres accesos iluminados a la vez).
    var navClass = 'nl';
    if (nav) {
      var muestra = nav.querySelector('a:not(.on):not(.active)') || nav.querySelector('a');
      if (muestra) navClass = muestra.className;
    }
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

    // Ida a la app de Depósitos (vaAlDeposito ya se resolvió arriba).
    if (nav && vaAlDeposito && !nav.querySelector('[href="deposito/index.html"]')) {
      var d = document.createElement('a');
      d.href = 'deposito/index.html'; d.className = navClass;
      d.textContent = '🏢 Depósitos';
      d.title = 'Ir a la app de Control de Stock de Depósitos';
      nav.appendChild(d);
    }
  }

  // Barra de usuario (nombre + salir) en el header
  function injectUserBar(profile) {
    // Cada página nombró distinto al bloque de la derecha del header, y
    // el dashboard además usa <div class="hdr"> en vez de <header>: con
    // sólo dos candidatos se quedaba sin nombre de usuario ni "Salir".
    var host = document.querySelector('.hdr-r, .hdr-right, .header-right')
            || document.querySelector('header, .hdr');
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

  //  El .select() del final NO es decorativo: cuando RLS bloquea un
  //  UPDATE, Postgres no devuelve error — devuelve CERO filas. Sin
  //  esto, la pantalla mostraba "guardado ✓" y no se había guardado
  //  nada. Así se descubrió que los operarios de recepción sumaban al
  //  stock sin permiso y el cartel verde les mentía. Una escritura que
  //  no tocó ninguna fila es un error, y hay que decirlo.
  function updateRow(sheetKey, row, fields) {
    var def = SHEETKEY[sheetKey]; if (!def) return Promise.resolve({ error: 'sheetKey desconocido: ' + sheetKey });
    var patch = mapFields(def, typeof fields === 'string' ? JSON.parse(fields) : fields);
    return SB.from(def.table).update(patch).eq('id', row).select('id').then(function (r) {
      if (r.error) return { error: r.error.message };
      if (!r.data || !r.data.length) {
        return { error: 'la base no dejó guardar el cambio en ' + def.table +
                        ' (no alcanzan los permisos, o la fila ya no existe)' };
      }
      return { success: true, row: row };
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
        var row = {
          n_orden: orden, fecha: fecha, proveedor: prov, descripcion: it.descripcion || null,
          cantidad: cant, precio_un: prec, moneda: it.moneda || null,
          s_iva: +siva.toFixed(2), c_iva: +civa.toFixed(2), observaciones: obs
        };
        // La línea queda atada a la ficha, no al nombre: si mañana
        // renombran el artículo, la orden sigue sabiendo cuál es
        if (it.inventario_id) row.inventario_id = it.inventario_id;
        return row;
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

  // ── Configuración de reposición por artículo + proveedor ──────
  // Las tres verifican filas afectadas con .select(): una escritura
  // bloqueada por RLS devuelve cero filas SIN error.
  function getArtProveedor(invIds) {
    var q = SB.from('art_proveedor').select('*');
    if (invIds && invIds.length) q = q.in('inventario_id', invIds);
    return q.then(function (r) { return r.data || []; }, function () { return []; });
  }

  function saveArtProveedor(fila) {
    return SB.from('art_proveedor')
      .upsert(fila, { onConflict: 'inventario_id,proveedor' })
      .select()
      .then(function (r) {
        if (r.error) return { data: null, error: r.error.message };
        if (!r.data || !r.data.length) return { data: null, error: 'Sin permiso para guardar (0 filas).' };
        return { data: r.data[0], error: null };
      });
  }

  function deleteArtProveedor(id) {
    return SB.from('art_proveedor').delete().eq('id', id).select()
      .then(function (r) {
        if (r.error) return { data: null, error: r.error.message };
        if (!r.data || !r.data.length) return { data: null, error: 'Sin permiso para borrar (0 filas).' };
        return { data: r.data[0], error: null };
      });
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

    // ── Logo PROlimpio del encabezado ──
    // Se precarga recortado en círculo como PNG (data URL) para meterlo en
    // el PDF. Si no llegó a cargar, se dibuja una marca vectorial parecida
    // para no dejar el formulario sin logo.
    var LOGO = null;
    (function preloadLogo() {
      try {
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
          try {
            var D = 320, c = document.createElement('canvas'); c.width = c.height = D;
            var ctx = c.getContext('2d');
            ctx.beginPath(); ctx.arc(D / 2, D / 2, D / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
            var s = Math.min(img.width, img.height);
            ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, D, D);
            LOGO = c.toDataURL('image/png');
          } catch (e) { /* canvas tainted: queda el dibujo vectorial */ }
        };
        // Relativo al propio script, no a la página que lo incluye
        img.src = new URL('logo-prolimpio.jpg', _selfSrc).href;
      } catch (e) {}
    })();

    function drawProlimpio(doc, x, y, w, h) {
      var OR = [242, 101, 34];
      // "SUBATIR S.A." va abajo a la izquierda, como en el original
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(20, 20, 20);
      doc.text('SUBATIR S.A.', x + 2, y + h - 3);

      var box = h - 14, size = Math.min(box, w - 16), lx = x + (w - size) / 2, ly = y + 4;
      if (LOGO) {
        try { doc.addImage(LOGO, 'PNG', lx, ly, size, size); return; } catch (e) {}
      }
      // Fallback vectorial: dos círculos + la palabra al lado
      var cy = y + h / 2, r = Math.min(13, h / 2 - 9), cx = x + 12 + r;
      doc.setFillColor(250, 176, 60); doc.circle(cx, cy - 2, r, 'F');
      doc.setFillColor(233, 84, 56);  doc.circle(cx - r * 0.18, cy - 2 + r * 0.12, r * 0.72, 'F');
      var tx = cx + r + 5, maxW = (x + w - 6) - tx, fs = 15;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(fs);
      while (fs > 8 && doc.getTextWidth('PROlimpio') > maxW) { fs -= 0.5; doc.setFontSize(fs); }
      doc.setTextColor(45, 45, 45);        doc.text('PRO', tx, cy + 3);
      doc.setTextColor(OR[0], OR[1], OR[2]);
      doc.text('limpio', tx + doc.getTextWidth('PRO'), cy + 3);
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

  // ══ Cruce de nombres de artículo ══════════════════════════
  //  El mismo insumo se escribe distinto en cada tabla: la OC dice
  //  "Botella Pet x 1 L Verde", la ficha decía "…Petiza VERDE" y la
  //  lista de precios otra cosa. Este es el criterio con el que Stock
  //  reparte el tránsito, y vive acá para que Recepción sume al MISMO
  //  artículo al que Stock le mostró la mercadería en camino. Dos
  //  copias de esta lógica se desincronizarían y la mercadería
  //  terminaría sumándose a una ficha distinta de la que la esperaba.
  var MATCH = (function () {

    function norm(s) {
      return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
    }

    // Palabras significativas: sin paréntesis (ahí viven "(Materia Prima)",
    // los gramajes) y sin los tokens que empiezan con dígito
    function tokenize(s) {
      return norm(s)
        .replace(/\([^)]*\)/g, ' ')
        .split(/[\s\/\-\.°\(\)]+/)
        .filter(function (w) { return w.length >= 2 && !/^\d/.test(w); });
    }

    // Los números se leen aparte: tokenize los tira, pero son lo que
    // separa "rosca 28 /400" de "rosca 28 /410"
    function numeros(s) {
      return (norm(s).replace(/\([^)]*\)/g, ' ').match(/\d+(?:[.,]\d+)?/g) || [])
        .map(function (n) { return n.replace(',', '.'); });
    }

    // Se contradicen si cada uno tiene un número que el otro no
    function chocan(a, b) {
      var na = numeros(a), nb = numeros(b);
      if (!na.length || !nb.length) return false;
      var sa = {}, sb = {};
      na.forEach(function (n) { sa[n] = 1; });
      nb.forEach(function (n) { sb[n] = 1; });
      return na.some(function (n) { return !sb[n]; }) && nb.some(function (n) { return !sa[n]; });
    }

    // ¿desc y cand son el mismo artículo?
    function igual(desc, cand) {
      var nd = norm(desc), nc = norm(cand);
      if (!nd || nd.length < 4) return false;
      if (nd === nc) return true;

      var a = tokenize(desc), b = tokenize(cand);
      if (!a.length || !b.length) return false;
      var setA = {}, setB = {};
      a.forEach(function (t) { setA[t] = 1; });
      b.forEach(function (t) { setB[t] = 1; });

      var corto = a.length <= b.length ? a : b;
      var cortoSet = a.length <= b.length ? setA : setB;
      var largo = a.length <= b.length ? b : a;
      var largoSet = a.length <= b.length ? setB : setA;

      var fwd = corto.filter(function (t) { return largoSet[t]; }).length / corto.length;
      if (fwd < 0.8) return false;
      // Una palabra de más que signifique algo los separa ("PETIZA", "CORTA")
      if (largo.some(function (t) { return !cortoSet[t] && t.length >= 3; })) return false;
      return !chocan(desc, cand);
    }

    // Claves de un índice {NORM(desc): algo} que son el mismo artículo
    function keys(desc, idx) {
      var nd = norm(desc);
      if (!nd || nd.length < 4) return [];
      if (idx[nd]) return [nd];
      return Object.keys(idx).filter(function (k) { return igual(desc, k); });
    }

    // ── Ficha de inventario que le corresponde a una descripción ──
    //  Devuelve {ficha} si hay una sola, {ambiguas:[...]} si hay varias
    //  y {ninguna:true} si no hay. Nunca elige por su cuenta entre
    //  varias: sumar stock al artículo equivocado no se ve hasta que
    //  alguien cuenta.
    var _cache = null;
    function invalidar() { _cache = null; }
    function fichas() {
      if (_cache) return Promise.resolve(_cache);
      return SB.from('inventario').select('id,codigo,descripcion,inventario,unidad')
        .then(function (r) { _cache = r.data || []; return _cache; });
    }
    function fichaDe(desc) {
      return fichas().then(function (lista) {
        var exacta = lista.filter(function (f) { return norm(f.descripcion) === norm(desc); });
        if (exacta.length === 1) return { ficha: exacta[0], exacta: true };
        if (exacta.length > 1) return { ambiguas: exacta };
        var cerca = lista.filter(function (f) { return igual(desc, f.descripcion); });
        if (cerca.length === 1) return { ficha: cerca[0], exacta: false };
        if (cerca.length > 1) return { ambiguas: cerca };
        return { ninguna: true };
      });
    }

    // Ficha por id: la que la OC dejó anotada. Sin cruces ni nombres.
    function fichaPorId(id) {
      if (!id) return Promise.resolve(null);
      return fichas().then(function (lista) {
        return lista.filter(function (f) { return String(f.id) === String(id); })[0] || null;
      });
    }

    return { norm: norm, tokenize: tokenize, numeros: numeros, chocan: chocan,
             igual: igual, keys: keys, fichaDe: fichaDe, fichaPorId: fichaPorId,
             invalidar: invalidar };
  })();

  // ══════════════════════════════════════════════════════════
  //  SUMAR AL STOCK LO QUE SE RECIBE
  //
  //  Vive acá y no en cada módulo porque durante un tiempo NO fue así
  //  y se notó: Recepción sumaba a la ficha de inventario y el botón
  //  "Recibir" de Pedidos no, así que la misma mercadería entraba o no
  //  al stock según la pantalla que hubiera usado la persona. Ahora
  //  las dos llaman a esto y no hay dos versiones que se separen.
  //
  //  Cuándo pregunta y cuándo no:
  //    · La OC trae el id de la ficha, o el nombre coincide exacto
  //      → suma sola y avisa. No hay nada que decidir.
  //    · El nombre se parece pero no es igual (órdenes viejas escritas
  //      a mano) → pregunta. Acá es donde podría estarle sumando al
  //      artículo equivocado, y eso no se nota hasta que alguien cuenta
  //      el depósito.
  //    · No hay ficha, o el nombre se parece a más de una → no suma y
  //      lo explica. La entrega ya quedó registrada igual.
  // ══════════════════════════════════════════════════════════
  var STOCK = (function () {

    var CSS =
      '.sm-ovl{position:fixed;inset:0;z-index:900;background:rgba(4,6,11,.72);' +
      'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);' +
      'display:none;align-items:center;justify-content:center;padding:18px;' +
      'font-family:"DM Sans",sans-serif}' +
      '.sm-ovl.open{display:flex}' +
      '.sm-box{width:100%;max-width:440px;color:#e2e8f0;' +
      'background:linear-gradient(150deg,#0c1119,#111926);' +
      'border:1px solid rgba(255,255,255,.12);border-radius:16px;' +
      'box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden}' +
      '.sm-h{display:flex;align-items:center;justify-content:space-between;' +
      'padding:17px 20px 14px;border-bottom:1px solid rgba(255,255,255,.08);' +
      'font-family:"Manrope",sans-serif;font-size:15px;font-weight:800}' +
      '.sm-x{background:none;border:none;color:#7a8fa8;font-size:19px;line-height:1;' +
      'cursor:pointer;padding:2px 7px;border-radius:7px}' +
      '.sm-x:hover{color:#fff;background:rgba(255,255,255,.08)}' +
      '.sm-b{padding:18px 20px}' +
      '.sm-f{display:flex;justify-content:flex-end;gap:9px;padding:14px 20px;' +
      'border-top:1px solid rgba(255,255,255,.08)}' +
      '.sm-btn{cursor:pointer;font-family:"DM Sans",sans-serif;font-weight:700;font-size:12px;' +
      'padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.12);' +
      'background:rgba(255,255,255,.06);color:#e2e8f0}' +
      '.sm-btn:hover{filter:brightness(1.14)}' +
      '.sm-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.sm-btn.pri{background:linear-gradient(135deg,#ea6a08,#fb923c);border-color:transparent;color:#fff}' +
      '.sm-art{font-size:13px;font-weight:700;margin-bottom:10px;line-height:1.35}' +
      '.sm-warn{font-size:11px;color:#fcd34d;background:rgba(245,158,11,.10);' +
      'border:1px solid rgba(245,158,11,.3);border-radius:8px;padding:8px 10px;' +
      'margin-bottom:10px;line-height:1.5}' +
      '.sm-nums{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center}' +
      '.sm-l{font-size:9.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#7a8fa8}' +
      '.sm-v{font-family:"IBM Plex Mono",monospace;font-size:17px;font-weight:600;margin-top:3px}' +
      '.sm-txt{font-size:12px;line-height:1.55}';

    var _cur = null;   // {ficha, cant, luego}

    function injectCSS() {
      if (document.getElementById('sm-css')) return;
      var s = document.createElement('style');
      s.id = 'sm-css'; s.textContent = CSS;
      document.head.appendChild(s);
    }

    function montar() {
      injectCSS();
      var ovl = document.getElementById('sm-ovl');
      if (ovl) return ovl;
      ovl = document.createElement('div');
      ovl.className = 'sm-ovl'; ovl.id = 'sm-ovl';
      ovl.innerHTML =
        '<div class="sm-box">' +
          '<div class="sm-h"><span>📥 Sumar al stock</span>' +
            '<button type="button" class="sm-x" id="sm-x">✕</button></div>' +
          '<div class="sm-b" id="sm-body"></div>' +
          '<div class="sm-f">' +
            '<button type="button" class="sm-btn" id="sm-no">Ahora no</button>' +
            '<button type="button" class="sm-btn pri" id="sm-ok">✓ Sumar al stock</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(ovl);
      // Cerrar por la X, por el fondo o con Escape es "ahora no": la
      // entrega ya se guardó, lo único que se saltea es la suma.
      var no = function () { cerrar(); seguir(); };
      document.getElementById('sm-x').onclick = no;
      document.getElementById('sm-no').onclick = no;
      ovl.addEventListener('click', function (e) { if (e.target === ovl) no(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && ovl.classList.contains('open')) no();
      });
      return ovl;
    }

    function abrir()  { montar().classList.add('open'); }
    function cerrar() { var o = document.getElementById('sm-ovl'); if (o) o.classList.remove('open'); }

    function seguir() {
      var f = _cur && _cur.luego; _cur = null;
      if (f) f();
    }

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function num(n) {
      n = parseFloat(n) || 0;
      return n.toLocaleString('es-UY', { maximumFractionDigits: 2 });
    }
    function aviso(msg, tipo) { if (window.toast) window.toast(msg, tipo); }

    /**
     * Suma al inventario lo que se acaba de recibir.
     * @param {object} o
     *   o.descripcion  texto de la línea de la OC
     *   o.cantidad     cuánto llegó en esta entrega
     *   o.inventarioId id de ficha que la OC dejó anotada (si lo tiene)
     *   o.luego        se llama SIEMPRE al terminar, sume o no
     */
    function sumarAlRecibir(o) {
      o = o || {};
      var desc  = String(o.descripcion || '');
      var cant  = parseFloat(o.cantidad) || 0;
      var invId = o.inventarioId;
      _cur = { luego: o.luego || function () {} };

      // Con el id no hay nada que cruzar: la orden sabe a qué ficha
      // pertenece aunque después la hayan renombrado. Las órdenes
      // viejas no lo tienen y siguen yendo por nombre.
      var buscar = invId
        ? MATCH.fichaPorId(invId).then(function (f) {
            return f ? { ficha: f, exacta: true, porId: true } : MATCH.fichaDe(desc);
          })
        : MATCH.fichaDe(desc);

      return buscar.then(function (res) {
        if (res.ficha && res.exacta) { _cur.ficha = res.ficha; _cur.cant = cant; return aplicar(true); }

        if (res.ficha) {
          _cur.ficha = res.ficha; _cur.cant = cant;
          var hoy = parseFloat(res.ficha.inventario) || 0, un = res.ficha.unidad || '';
          document.getElementById('sm-body') || montar();
          document.getElementById('sm-body').innerHTML =
            '<div class="sm-art">' + esc(res.ficha.descripcion) + '</div>' +
            '<div class="sm-warn">⚠ En la orden figura como “' + esc(desc) + '”. ' +
            'Es el artículo al que el módulo de Stock le venía mostrando esta mercadería en camino.</div>' +
            '<div class="sm-nums">' +
              '<div><div class="sm-l">Stock hoy</div><div class="sm-v">' + num(hoy) + '</div></div>' +
              '<div><div class="sm-l">Llegó</div><div class="sm-v" style="color:#22c55e">+' + num(cant) + '</div></div>' +
              '<div><div class="sm-l">Queda</div><div class="sm-v" style="color:#1bc8ff">' + num(hoy + cant) + ' ' + esc(un) + '</div></div>' +
            '</div>';
          document.getElementById('sm-ok').style.display = '';
          document.getElementById('sm-ok').onclick = function () { aplicar(false); };
          abrir();
          return;
        }

        // No hay a dónde sumar: se explica y se sigue. La entrega ya está.
        montar();
        document.getElementById('sm-body').innerHTML = res.ambiguas
          ? '<div class="sm-txt">No se puede sumar solo: “' + esc(desc) + '” se parece a más de una ficha (<b>' +
            res.ambiguas.map(function (f) { return esc(f.descripcion); }).join('</b>, <b>') +
            '</b>). Cargalo a mano en Stock, o unificá los nombres.</div>'
          : '<div class="sm-txt">“' + esc(desc) + '” no tiene ficha en <b>Inventario</b>, así que no hay dónde sumarlo. ' +
            'La entrega quedó registrada igual. Creale la ficha desde Precios o Pedidos y después cargá el stock contándolo.</div>';
        document.getElementById('sm-ok').style.display = 'none';
        abrir();
      }, function () { seguir(); });   // si falla la consulta, no se traba la recepción
    }

    // auto = el nombre coincidía exacto: no hubo modal, sólo se avisa
    //
    //  La suma la hace la BASE, con inventario_sumar (ver
    //  migracion/inventario_sumar.sql). Dos motivos:
    //
    //   · Permiso. Escribir directo en `inventario` pide el módulo
    //     'stock', que el operario de recepción no tiene. La función
    //     corre con privilegios y sólo deja sumar, nada más.
    //   · Carrera. Antes se leía el stock, se sumaba en el navegador y
    //     se escribía el TOTAL. Dos personas recibiendo a la vez se
    //     pisaban. Ahora la base suma sobre el valor del momento.
    function aplicar(auto) {
      if (!_cur || !_cur.ficha) { cerrar(); seguir(); return; }
      var ficha = _cur.ficha, cant = _cur.cant;
      var b = document.getElementById('sm-ok');
      if (!auto && b) { b.disabled = true; b.textContent = 'Sumando…'; }
      var hoy = parseFloat(ficha.inventario) || 0;
      return SB.rpc('inventario_sumar', { p_id: ficha.id, p_delta: cant }).then(function (r) {
        if (!auto && b) { b.disabled = false; b.textContent = '✓ Sumar al stock'; }
        var d = r && r.data;
        var err = (r && r.error && r.error.message) || (d && d.ok === false && d.error);
        if (err) {
          aviso('La entrega se registró, pero NO se pudo sumar al stock: ' + err +
                '. Anotalo y cargalo a mano en Stock.', 'err');
          if (!auto) return;      // el modal queda abierto para reintentar
          seguir(); return;
        }
        MATCH.invalidar();        // la caché de fichas quedó vieja
        // El total lo devuelve la base: es el de verdad, no el que
        // calculó esta pestaña con un stock que podía estar viejo.
        var nuevo = (d && d.inventario != null) ? parseFloat(d.inventario) : (hoy + cant);
        aviso('📥 ' + String(ficha.descripcion).slice(0, 26) + ': ' +
              num(hoy) + ' + ' + num(cant) + ' = ' + num(nuevo), 'ok');
        cerrar();
        seguir();
      });
    }

    return { sumarAlRecibir: sumarAlRecibir };
  })();

  // ══ Categoría del artículo ════════════════════════════════
  //  Envases / Consumibles / Materias Primas. Vive en la ficha de
  //  inventario (ext_id), y hace falta en varios módulos para saber a
  //  qué se le pide COA y lote: solo a las materias primas.
  //  Se resuelve por id de ficha —las OC nuevas lo traen— y por nombre
  //  para las viejas, que solo tienen el texto.
  var CAT = (function () {
    var EXT = { MP: 'Materias Primas', ENV: 'Envases', CON: 'Consumibles' };
    var porId = {}, porNombre = {};

    // inv: el payload de inventario que ya trae getData, con los nombres
    // de encabezado ('ID' es ext_id, 'DESCRIPCIÓN' la descripción)
    function cargar(inv) {
      porId = {}; porNombre = {};
      (inv || []).forEach(function (f) {
        var cat = EXT[String(f['ID'] || '').trim()] || '';
        if (!cat) return;
        if (f.__row) porId[String(f.__row)] = cat;
        var d = String(f['DESCRIPCIÓN'] || '').trim();
        if (d) porNombre[MATCH.norm(d)] = cat;
      });
    }

    function de(invId, desc) {
      if (invId && porId[String(invId)]) return porId[String(invId)];
      return porNombre[MATCH.norm(String(desc || ''))] || '';
    }
    function esMP(invId, desc) { return de(invId, desc) === 'Materias Primas'; }

    return { cargar: cargar, de: de, esMP: esMP };
  })();

  // ══ Excel (.xlsx) ═════════════════════════════════════════
  //  Genera un xlsx de verdad, sin librerias: un xlsx es un ZIP con
  //  XML adentro. Antes la unica salida era CSV, que Excel abre pero
  //  sin formato, sin anchos de columna y rompiendo los numeros con
  //  coma decimal segun la configuracion regional de cada PC.
  //
  //  El ZIP va sin comprimir (metodo "store"): ahorra meter un
  //  deflate a mano y a Excel le da igual. Los textos van "inline",
  //  asi que tampoco hace falta la tabla de strings compartidos.
  //
  //  Uso: SubatirApp.xlsx({hoja, cols, filas, imagen, ...}) -> Blob
  //  Cada celda es {v:valor, s:'estilo'} y los estilos salen del
  //  catalogo de abajo (ESTILOS), no de indices sueltos.
  var XLSX = (function () {

    // ── CRC32 (lo exige el ZIP para cada archivo) ────────────
    var CRC_TBL = null;
    function crcTable() {
      if (CRC_TBL) return CRC_TBL;
      CRC_TBL = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TBL[n] = c >>> 0;
      }
      return CRC_TBL;
    }
    function crc32(buf) {
      var t = crcTable(), c = 0xFFFFFFFF;
      for (var i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
      return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function utf8(s) { return new TextEncoder().encode(s); }

    // ── ZIP sin compresion ───────────────────────────────────
    function zip(files) {
      var enc = utf8, locals = [], central = [], off = 0;
      // Fecha/hora DOS (segundos con resolucion de 2)
      var d = new Date();
      var dosT = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
      var dosD = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;

      function u8(n) { return [n & 255]; }
      function u16(n) { return [n & 255, (n >>> 8) & 255]; }
      function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }

      files.forEach(function (f) {
        var name = enc(f.name);
        var data = f.data instanceof Uint8Array ? f.data : enc(String(f.data));
        var crc = crc32(data);
        var head = [].concat(
          u32(0x04034B50), u16(20), u16(0), u16(0), u16(dosT), u16(dosD),
          u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0)
        );
        locals.push(new Uint8Array(head), name, data);
        central.push([].concat(
          u32(0x02014B50), u16(20), u16(20), u16(0), u16(0), u16(dosT), u16(dosD),
          u32(crc), u32(data.length), u32(data.length), u16(name.length),
          u16(0), u16(0), u16(0), u16(0), u32(0), u32(off)
        ), name);
        off += head.length + name.length + data.length;
      });

      var cenParts = [], cenLen = 0;
      for (var i = 0; i < central.length; i += 2) {
        var h = new Uint8Array(central[i]);
        cenParts.push(h, central[i + 1]);
        cenLen += h.length + central[i + 1].length;
      }
      var end = new Uint8Array([].concat(
        u32(0x06054B50), u16(0), u16(0), u16(files.length), u16(files.length),
        u32(cenLen), u32(off), u16(0)
      ));

      var total = off + cenLen + end.length, out = new Uint8Array(total), p = 0;
      locals.concat(cenParts).concat([end]).forEach(function (part) { out.set(part, p); p += part.length; });
      return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    // ── Catalogo de estilos (el indice es el orden en cellXfs) ─
    var ESTILOS = ['normal', 'titulo', 'subtitulo', 'rotulo', 'valor', 'th',
                   'td', 'num', 'centro', 'menos', 'mas', 'negrita', 'pie'];
    function sIdx(nombre) { var i = ESTILOS.indexOf(nombre || 'normal'); return i < 0 ? 0 : i; }

    var STYLES_XML =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.###"/></numFmts>' +
      '<fonts count="8">' +
        '<font><sz val="11"/><name val="Calibri"/><color rgb="FF1F2933"/></font>' +
        '<font><b/><sz val="20"/><name val="Calibri"/><color rgb="FF0B2A3A"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>' +
        '<font><sz val="9"/><name val="Calibri"/><color rgb="FF6B7F93"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF1F2933"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFB42318"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF067647"/></font>' +
        '<font><b/><sz val="13"/><name val="Calibri"/><color rgb="FFC2580A"/></font>' +
      '</fonts>' +
      '<fills count="6">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFF97316"/><bgColor indexed="64"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFDECEC"/><bgColor indexed="64"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF7EE"/><bgColor indexed="64"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF4E5"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
        '<border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border>' +
          '<left style="thin"><color rgb="FFD5DBE1"/></left><right style="thin"><color rgb="FFD5DBE1"/></right>' +
          '<top style="thin"><color rgb="FFD5DBE1"/></top><bottom style="thin"><color rgb="FFD5DBE1"/></bottom><diagonal/>' +
        '</border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="13">' +
        '<xf numFmtId="0"   fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                      /* normal    */
        '<xf numFmtId="0"   fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center"/></xf>' +      /* titulo    */
        '<xf numFmtId="0"   fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center"/></xf>' +      /* subtitulo */
        '<xf numFmtId="0"   fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                        /* rotulo    */
        '<xf numFmtId="0"   fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                        /* valor     */
        '<xf numFmtId="0"   fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' + /* th */
        '<xf numFmtId="0"   fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' + /* td */
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + /* num */
        '<xf numFmtId="0"   fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + /* centro */
        '<xf numFmtId="164" fontId="5" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + /* menos */
        '<xf numFmtId="164" fontId="6" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + /* mas */
        '<xf numFmtId="164" fontId="4" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + /* negrita */
        '<xf numFmtId="0"   fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                        /* pie       */
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // Excel rechaza los de control
    }
    // 0 -> A, 25 -> Z, 26 -> AA
    function colName(n) {
      var s = '';
      do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
      return s;
    }

    // opts = {hoja, cols:[{w}], filas:[{alto, celdas:[{v,s,f}]}], imagen:{dataUrl,ancho,alto},
    //         congelar:'A8', filtro:'A7:H99', apaisado:true}
    function build(opts) {
      opts = opts || {};
      var filas = opts.filas || [], cols = opts.cols || [];
      var img = opts.imagen && opts.imagen.dataUrl ? opts.imagen : null;

      var sd = filas.map(function (fila, r) {
        var celdas = (fila.celdas || []).map(function (c, i) {
          if (c == null) return '';
          var ref = colName(i) + (r + 1), s = ' s="' + sIdx(c.s) + '"';
          var v = c.v;
          if (v === '' || v == null) return '<c r="' + ref + '"' + s + '/>';
          if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
          return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
        }).join('');
        return '<row r="' + (r + 1) + '"' + (fila.alto ? ' ht="' + fila.alto + '" customHeight="1"' : '') + '>' + celdas + '</row>';
      }).join('');

      var colsXml = cols.length ? '<cols>' + cols.map(function (c, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.w || 12) + '" customWidth="1"/>';
      }).join('') + '</cols>' : '';

      var panes = opts.congelar
        ? '<pane ySplit="' + (parseInt(String(opts.congelar).replace(/\D/g, ''), 10) - 1) +
          '" topLeftCell="' + opts.congelar + '" activePane="bottomLeft" state="frozen"/>' +
          '<selection pane="bottomLeft" activeCell="' + opts.congelar + '" sqref="' + opts.congelar + '"/>'
        : '';

      var sheet =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheetViews><sheetView showGridLines="0" workbookViewId="0">' + panes + '</sheetView></sheetViews>' +
        '<sheetFormatPr defaultRowHeight="15"/>' + colsXml +
        '<sheetData>' + sd + '</sheetData>' +
        (opts.filtro ? '<autoFilter ref="' + opts.filtro + '"/>' : '') +
        '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
        '<pageSetup orientation="' + (opts.apaisado ? 'landscape' : 'portrait') + '" fitToWidth="1" fitToHeight="0" paperSize="9"/>' +
        (img ? '<drawing r:id="rId1"/>' : '') +
        '</worksheet>';

      var files = [
        { name: '[Content_Types].xml', data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          (img ? '<Default Extension="png" ContentType="image/png"/>' : '') +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          (img ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') +
          '</Types>' },
        { name: '_rels/.rels', data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>' },
        { name: 'xl/workbook.xml', data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="' + esc((opts.hoja || 'Hoja1').slice(0, 31)) + '" sheetId="1" r:id="rId1"/></sheets>' +
          '</workbook>' },
        { name: 'xl/_rels/workbook.xml.rels', data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>' },
        { name: 'xl/styles.xml', data: STYLES_XML },
        { name: 'xl/worksheets/sheet1.xml', data: sheet }
      ];

      if (img) {
        var px = 9525; // 1 pixel = 9525 EMU
        var cx = Math.round((img.ancho || 96) * px), cy = Math.round((img.alto || 96) * px);
        files.push(
          { name: 'xl/worksheets/_rels/sheet1.xml.rels', data:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>' +
            '</Relationships>' },
          { name: 'xl/drawings/drawing1.xml', data:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
              'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
            '<xdr:oneCellAnchor>' +
            '<xdr:from><xdr:col>0</xdr:col><xdr:colOff>57150</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>38100</xdr:rowOff></xdr:from>' +
            '<xdr:ext cx="' + cx + '" cy="' + cy + '"/>' +
            '<xdr:pic>' +
            '<xdr:nvPicPr><xdr:cNvPr id="2" name="Logo Subatir"/>' +
            '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
            '<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/>' +
            '<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
            '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
            '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>' },
          { name: 'xl/drawings/_rels/drawing1.xml.rels', data:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/>' +
            '</Relationships>' },
          { name: 'xl/media/logo.png', data: b64ToBytes(img.dataUrl) }
        );
      }
      return zip(files);
    }

    function b64ToBytes(dataUrl) {
      var b64 = String(dataUrl).split(',')[1] || '';
      var bin = atob(b64), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }

    // Dispara la descarga del Blob con el nombre pedido
    function save(blob, nombre) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nombre;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }

    return { build: build, save: save, colName: colName, estilos: ESTILOS };
  })();

  // ── Logo circular en PNG, listo para PDF y Excel ───────────
  //  Se recorta una sola vez al cargar la pagina. Si el canvas
  //  falla (o el logo no esta) queda null y cada salida usa su
  //  propio respaldo dibujado.
  var LOGO_CIRC = null;
  (function preloadLogo() {
    try {
      var img = new Image();
      img.onload = function () {
        try {
          var D = 320, c = document.createElement('canvas'); c.width = c.height = D;
          var ctx = c.getContext('2d');
          ctx.save();
          ctx.beginPath(); ctx.arc(D / 2, D / 2, D / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
          var s = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, D, D);
          ctx.restore();
          LOGO_CIRC = c.toDataURL('image/png');
        } catch (e) { /* canvas tainted: se usa el respaldo dibujado */ }
      };
      img.src = 'logo.jpg';
    } catch (e) {}
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
    getArtProveedor: getArtProveedor, saveArtProveedor: saveArtProveedor, deleteArtProveedor: deleteArtProveedor,
    PL06: PL06, operador: OPER, stock: STOCK,
    live: live,
    xlsx: XLSX, logoCirc: function () { return LOGO_CIRC; }, match: MATCH, cat: CAT,
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
