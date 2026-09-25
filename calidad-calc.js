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
// ============================================================
(function () {
  'use strict';

  var AVISO_DIAS = 30;

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
   * Lee lo necesario de la base para un mes.
   * @param {object} SB  cliente de Supabase
   * @param {string} mes 'YYYY-MM-01'
   * @returns {Promise<{mps:Array, docs:Array, entregas:Array, falta:string}>}
   *   falta = 'tabla' si todavía no se corrió migracion/calidad_mp.sql
   */
  function cargar(SB, mes) {
    mes = mes || mesISO();
    return Promise.all([
      SB.from('inventario').select('id,codigo,descripcion,proveedor,proveedor_sugerido,ext_id'),
      SB.from('mp_documentos').select('*'),
      SB.from('entregas').select('pedido_id,descripcion,fecha,lote')
        .gte('fecha', mes).lte('fecha', finMesISO(mes))
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
    var llego = {};
    datos.entregas.forEach(function (e) {
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

  window.CalidadMP = {
    AVISO_DIAS: AVISO_DIAS, BUCKET: 'calidad-mp',
    mesISO: mesISO, finMesISO: finMesISO, mesTexto: mesTexto,
    vencimiento: vencimiento, cargar: cargar, estado: estado, resumen: resumen
  };
})();
