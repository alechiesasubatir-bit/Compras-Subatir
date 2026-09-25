// ============================================================
//  CALIDAD MP — qué documentos tiene cada materia prima y qué falta
//
//  Lo usan calidad.html (la tabla) y el Dashboard (el aviso). Vive
//  en un solo lugar a propósito: "le falta el COA del mes" se decide
//  acá y en ningún otro lado, para que el aviso y la pantalla no
//  puedan mostrar dos números distintos.
//
//  Reglas (acordadas con el usuario, 25/09/2026):
//   · Materia prima = ficha de inventario con ext_id 'MP'.
//   · COA: uno por MP y por mes, suelto. Se reclama sólo si esa MP
//     tuvo alguna entrega (Recepción) en ese mes.
//   · FT y HDS: el último cargado de cada tipo es el que vale. Si
//     tiene fecha de vencimiento, avisa 30 días antes.
//   · El COA mensual REEMPLAZÓ a la marca ⚠ COA por línea de OC
//     (decisión del usuario, 25/09/2026). Pedidos, Recepción y el
//     Dashboard preguntan acá con lineaCOA(): una línea de materia
//     prima pide COA si alguno de los meses en que llegó no tiene el
//     COA de esa MP. Rige desde DESDE; lo anterior no se reclama.
// ============================================================
(function () {
  'use strict';

  var AVISO_DIAS = 30;
  // Primer mes con COA mensual: el módulo se publicó en septiembre 2026.
  // Reclamar meses anteriores sería pedir algo que nadie pudo cargar.
  var DESDE = '2026-09-01';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // 'YYYY-MM-01' del mes de la fecha (hora local: el mes es el de acá)
  function mesISO(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01'; }
  function finMesISO(mes) {
    var p = mes.split('-'), d = new Date(+p[0], +p[1], 0);   // día 0 del mes siguiente
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
               'septiembre','octubre','noviembre','diciembre'];
  function mesTexto(mes) { var p = String(mes || '').split('-'); return p.length < 2 ? '—' : MESES[+p[1] - 1] + ' ' + p[0]; }

  function norm(s) {
    if (window.SubatirApp && SubatirApp.match && SubatirApp.match.norm) return SubatirApp.match.norm(String(s || ''));
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  }

  // Estado de vencimiento de una FT/HDS: '' (vale o no tiene fecha),
  // 'pronto' (vence en 30 días o menos) o 'vencido'.
  function vencimiento(doc, hoy) {
    if (!doc || !doc.vence) return '';
    hoy = hoy || new Date(); var h = new Date(hoy); h.setHours(0, 0, 0, 0);
    var d = new Date(doc.vence + 'T00:00:00');
    var dias = Math.round((d - h) / 86400000);
    return dias < 0 ? 'vencido' : (dias <= AVISO_DIAS ? 'pronto' : '');
  }

  // El que vale: el de fecha de documento más nueva; a igual fecha, el
  // último subido.
  function ultimo(docs) {
    return (docs || []).slice().sort(function (a, b) {
      var fa = a.fecha_doc || '', fb = b.fecha_doc || '';
      if (fa !== fb) return fa < fb ? 1 : -1;
      return String(a.created_at) < String(b.created_at) ? 1 : -1;
    })[0] || null;
  }

  /**
   * Lee lo necesario de la base para un mes, o para un rango de meses.
   * @param {object} SB  cliente de Supabase
   * @param {string} mes 'YYYY-MM-01' (el primero del rango)
   * @param {string} [hasta] 'YYYY-MM-01' último mes del rango (default: mes)
   * @returns {Promise<{mps:Array, docs:Array, entregas:Array, falta:string}>}
   *   falta = 'tabla' si todavía no se corrió migracion/calidad_mp.sql
   */
  function cargar(SB, mes, hasta) {
    mes = mes || mesISO();
    return Promise.all([
      SB.from('inventario').select('id,codigo,descripcion,proveedor,proveedor_sugerido,ext_id'),
      SB.from('mp_documentos').select('*'),
      SB.from('entregas').select('pedido_id,descripcion,fecha,lote')
        .gte('fecha', mes).lte('fecha', finMesISO(hasta || mes))
    ]).then(function (r) {
      if (r[0].error) throw new Error(r[0].error.message);
      if (r[2].error) throw new Error(r[2].error.message);
      var out = {
        mps: (r[0].data || []).filter(function (x) { return x.ext_id === 'MP'; }),
        todos: r[0].data || [],
        docs: r[1].error ? [] : (r[1].data || []),
        entregas: r[2].data || [],
        falta: r[1].error ? 'tabla' : ''
      };
      indexar(out.docs);
      // La entrega sabe su OC, y la OC su ficha de inventario
      var ids = {}; out.entregas.forEach(function (e) { if (e.pedido_id) ids[e.pedido_id] = 1; });
      ids = Object.keys(ids);
      if (!ids.length) { out.pedInv = {}; return out; }
      return SB.from('pedidos').select('id,inventario_id,descripcion').in('id', ids).then(function (p) {
        out.pedInv = {};
        (p.data || []).forEach(function (x) { out.pedInv[x.id] = x; });
        return out;
      });
    });
  }

  /**
   * Una fila por materia prima con todo lo que la pantalla necesita.
   * @param {object} datos lo que devolvió cargar()
   * @param {string} mes   'YYYY-MM-01'
   */
  function estado(datos, mes, hoy) {
    mes = mes || mesISO();
    var porNombre = {};
    datos.mps.forEach(function (m) { porNombre[norm(m.descripcion)] = m.id; });

    // Qué días llegó cada MP en el mes. Las OC nuevas traen el id de la
    // ficha; las viejas sólo el nombre, y se cruzan por nombre.
    var llego = {}, fin = finMesISO(mes);
    datos.entregas.forEach(function (e) {
      if (!e.fecha || e.fecha < mes || e.fecha > fin) return;   // datos puede traer varios meses
      var ped = (datos.pedInv || {})[e.pedido_id] || {};
      var id = ped.inventario_id || porNombre[norm(ped.descripcion || e.descripcion)];
      if (!id) return;
      (llego[id] = llego[id] || []).push(e.fecha);
    });

    var porArt = {};
    datos.docs.forEach(function (d) {
      if (d.inventario_id == null) return;
      (porArt[d.inventario_id] = porArt[d.inventario_id] || []).push(d);
    });

    return datos.mps.map(function (m) {
      var docs = porArt[m.id] || [];
      var de = function (t) { return docs.filter(function (d) { return d.tipo === t; }); };
      var ft = ultimo(de('FT')), hds = ultimo(de('HDS'));
      var coas = de('COA');
      var coaMes = coas.filter(function (d) { return d.mes === mes; });
      var fechas = (llego[m.id] || []).slice().sort();
      return {
        mp: m, docs: docs,
        ft: ft, hds: hds, ftVto: vencimiento(ft, hoy), hdsVto: vencimiento(hds, hoy),
        coaMes: coaMes, coaUltimo: ultimo(coas.map(function (d) {
          return Object.assign({}, d, { fecha_doc: d.mes });   // el último por mes cubierto
        })),
        llego: fechas,
        faltaCOA: fechas.length > 0 && coaMes.length === 0
      };
    });
  }

  function resumen(filas) {
    var r = { total: filas.length, sinFT: 0, sinHDS: 0, vencidos: 0, pronto: 0, llegaron: 0, faltaCOA: 0, conCOA: 0 };
    filas.forEach(function (f) {
      if (!f.ft) r.sinFT++;
      if (!f.hds) r.sinHDS++;
      if (f.ftVto === 'vencido' || f.hdsVto === 'vencido') r.vencidos++;
      else if (f.ftVto === 'pronto' || f.hdsVto === 'pronto') r.pronto++;
      if (f.llego.length) r.llegaron++;
      if (f.faltaCOA) r.faltaCOA++;
      if (f.coaMes.length) r.conCOA++;
    });
    return r;
  }

  // ── COA por línea de OC ──────────────────────────────────
  //  Índice "inventario_id|mes" de los COA cargados. Lo llena cargar()
  //  o cargarCOAs(); mientras no se haya leído, lineaCOA() no opina
  //  (mejor callado que marcar en rojo algo que no se pudo mirar).
  var IDX = null;
  function indexar(docs) {
    IDX = {};
    (docs || []).forEach(function (d) {
      if (d.tipo === 'COA' && d.inventario_id != null && d.mes) IDX[d.inventario_id + '|' + d.mes] = 1;
    });
    return IDX;
  }
  function cargarCOAs(SB) {
    return SB.from('mp_documentos').select('tipo,inventario_id,mes').eq('tipo', 'COA').then(function (r) {
      if (r.error) { IDX = null; return null; }
      return indexar(r.data);
    }, function () { IDX = null; return null; });
  }
  // 'YYYY-MM-DD' desde ISO o dd/mm/aaaa
  function iso10(v) {
    v = String(v || '').trim();
    var m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    return '';
  }
  /**
   * Estado del COA de UNA línea de OC de materia prima.
   * @param {number} invId  ficha de inventario de la línea
   * @param {Array}  fechas cuándo llegó (fechas de sus entregas)
   * @returns {null|{estado:'ok'|'falta', mes:string}} null = no aplica
   *   (sin ficha, llegó antes de DESDE, o el índice no se leyó todavía)
   */
  function lineaCOA(invId, fechas) {
    if (!IDX || invId == null || invId === '') return null;
    var meses = {};
    (fechas || []).forEach(function (f) { f = iso10(f); if (f && f >= DESDE) meses[f.slice(0, 7) + '-01'] = 1; });
    var ms = Object.keys(meses).sort();
    if (!ms.length) return null;
    for (var i = 0; i < ms.length; i++) if (!IDX[invId + '|' + ms[i]]) return { estado: 'falta', mes: ms[i] };
    return { estado: 'ok', mes: ms[ms.length - 1] };
  }

  // ── Pendientes de todos los meses ────────────────────────
  //  Cada par materia prima × mes que llegó y no tiene COA, desde DESDE
  //  hasta el mes actual. Es EL número de "sin COA": el Dashboard y
  //  Pedidos lo muestran tal cual, y en Calidad MP es la suma de los
  //  "falta COA" de cada mes.
  function mesesDesde(ini, fin) {
    var out = [], p = ini.split('-'), y = +p[0], m = +p[1];
    for (var guard = 0; guard < 240; guard++) {
      var k = y + '-' + pad(m) + '-01'; if (k > fin) break;
      out.push(k); if (++m > 12) { m = 1; y++; }
    }
    return out;
  }
  function cargarPendientes(SB) {
    var hoy = mesISO();
    return cargar(SB, DESDE, hoy).then(function (d) {
      if (d.falta) return { datos: d, pend: [], falta: d.falta };
      var pend = [];
      mesesDesde(DESDE, hoy).forEach(function (mes) {
        estado(d, mes).forEach(function (f) { if (f.faltaCOA) pend.push({ mp: f.mp, mes: mes }); });
      });
      return { datos: d, pend: pend, falta: '' };
    });
  }
  // Agrupa los pendientes por mes, del más viejo al más nuevo
  function porMes(pend) {
    var g = {};
    (pend || []).forEach(function (p) { g[p.mes] = (g[p.mes] || 0) + 1; });
    return Object.keys(g).sort().map(function (m) { return { mes: m, n: g[m] }; });
  }

  window.CalidadMP = {
    AVISO_DIAS: AVISO_DIAS, BUCKET: 'calidad-mp', DESDE: DESDE,
    mesISO: mesISO, finMesISO: finMesISO, mesTexto: mesTexto,
    vencimiento: vencimiento, cargar: cargar, estado: estado, resumen: resumen,
    cargarCOAs: cargarCOAs, lineaCOA: lineaCOA, iso10: iso10,
    cargarPendientes: cargarPendientes, porMes: porMes
  };
})();
