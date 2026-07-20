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

  // ── Módulo de cada página ──────────────────────────────────
  var PAGE_MODULE = {
    'index.html': 'dashboard',
    'pedidos.html': 'pedidos',
    'stock.html': 'stock',
    'precios.html': 'precios',
    'proveedores.html': 'proveedores',
    'contingencia.html': 'contingencia',
    'copiloto.html': 'copiloto',
    'usuarios.html': 'usuarios'
  };
  // Módulos visibles/accesibles para cualquier usuario autenticado
  var OPEN_MODULES = ['dashboard', 'copiloto'];

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
        coa: 'COA', conforme: 'Conforme', observaciones: 'Observaciones'
      },
      num: ['cantidad', 'precio_un', 's_iva', 'c_iva'], date: ['fecha', 'f_recepcion', 'f_vto']
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
        var mod = currentModule();
        if (!canAccess(mod, profile)) { location.replace('index.html?denegado=' + mod); return; }
        gateNav(profile);
        injectUserBar(profile);
        _readyResolve(profile);
        document.dispatchEvent(new CustomEvent('subatir:ready', { detail: profile }));
      });
    });
  }

  // Oculta links de nav a módulos sin acceso + agrega Usuarios (admin)
  function gateNav(profile) {
    document.querySelectorAll('nav a, .nl').forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('/').pop();
      var mod = PAGE_MODULE[href];
      if (mod && mod !== 'usuarios' && !canAccess(mod, profile)) a.style.display = 'none';
    });
    if (profile.role === 'admin') {
      var nav = document.querySelector('nav');
      if (nav && !nav.querySelector('[href="usuarios.html"]')) {
        var a = document.createElement('a');
        a.href = 'usuarios.html'; a.className = 'nl'; a.textContent = '👥 Usuarios';
        nav.appendChild(a);
      }
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
      lote:          params.get('lote') || null,
      coa:           params.get('coa') || null,
      conforme:      params.get('conforme') || null,
      observaciones: params.get('obs') || null
    };
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

  // ── Export ─────────────────────────────────────────────────
  window.SubatirApp = {
    ready: _ready,
    getProfile: function () { return _profile; },
    getData: getData,
    updateRow: updateRow, addRow: addRow, deleteRow: deleteRow,
    legacyFetch: legacyFetch,
    logout: function () { return SB.auth.signOut().then(function () { location.replace('login.html'); }); },
    canAccess: canAccess, currentModule: currentModule
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', guard);
  else guard();
})();
