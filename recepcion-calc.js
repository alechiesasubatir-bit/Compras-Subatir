// ============================================================
//  RECEPCIÓN — cuentas de una línea de OC y sus entregas
//
//  Lo usan Recepción y Pedidos (las dos registran entregas). Antes
//  cada pantalla tenía su copia de lineStats / coaOk, y Recepción
//  dejaba el formulario abierto y el botón habilitado mientras sumaba
//  al stock: el 08/10, 15/10, 16/10 y 29/10/2026 se registraron la
//  misma entrega dos y tres veces (OC 1006, 1021, 1023, 1046), con
//  segundos de diferencia. Por eso también vive acá el aviso de
//  "entrega repetida / más de lo pedido" antes de guardar.
//
//  Sin DOM: se prueba con node (test/recepcion-calc.test.js).
// ============================================================
(function (root) {
  'use strict';

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var f = root.SubatirApp && root.SubatirApp.num;
    var n = f ? f(v) : parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  // f_recepcion vacía = la línea no se cerró (pendiente o parcial)
  function sinRecepcion(v) { return !v || v === '0000-00-00'; }

  //  Estado de una línea a partir de sus entregas.
  //   · "legacy": recibida al viejo estilo (f_recepcion cargada, sin
  //     entregas): se toma como completa por el total pedido.
  //   · con entregas: COMPLETA cuando lo recibido alcanza lo pedido.
  function lineStats(pid, cantidad, fRecepcion, entregas) {
    var pedida = num(cantidad);
    var ents = entregas || [];
    var recEnt = ents.reduce(function (s, e) { return s + num(e.cantidad); }, 0);
    var legacy = !sinRecepcion(fRecepcion) && recEnt <= 0;
    var recibido = legacy ? pedida : recEnt;
    var estado = legacy ? 'COMPLETA'
      : (recibido <= 0 ? 'PENDIENTE' : (pedida > 0 && recibido >= pedida ? 'COMPLETA' : 'PARCIAL'));
    var saldo = estado === 'COMPLETA' ? 0 : Math.max(0, pedida - recibido);
    return { pid: pid, pedida: pedida, recibido: recibido, saldo: saldo, estado: estado, entregas: ents, legacy: legacy };
  }

  // COA resuelto: lo tiene, o no corresponde. "SÍ" con tilde también
  // (el Dashboard ya lo aceptaba y Recepción no).
  var COA_OK = ['SI', 'SÍ', 'S', '1', 'TRUE', 'NO NECESARIO', 'NO APLICA', 'NO REQUERIDO', 'N/A', 'NA'];
  function coaOk(v) { return COA_OK.indexOf(String(v == null ? '' : v).toUpperCase().trim()) >= 0; }

  var PL06_DESDE = '2026-08-11';   // desde cuándo existe el check list

  // Materia prima que ya recibió algo y no tiene COA ni en la línea ni en
  // ninguna entrega
  function faltaCoa(esMP, st, coaLinea) {
    if (!esMP || !st.recibido) return false;
    return !coaOk(coaLinea) && !(st.entregas || []).some(function (e) { return coaOk(e.coa); });
  }
  function faltaLote(esMP, st, loteLinea) {
    if (!esMP || st.estado === 'PENDIENTE') return false;
    return st.legacy ? !String(loteLinea || '').trim()
                     : (st.entregas || []).some(function (e) { return !String(e.lote || '').trim(); });
  }
  function faltaChecklist(esMP, st) {
    if (!esMP || st.estado === 'PENDIENTE' || st.legacy) return false;
    return (st.entregas || []).some(function (e) { return String(e.fecha || '') >= PL06_DESDE && !e.checklist; });
  }

  //  Hoy en la hora de la PC, 'YYYY-MM-DD'. new Date().toISOString() da
  //  la fecha UTC: en Uruguay, después de las 21 h ya es "mañana" (pasó
  //  con la entrega 84, del 19/08 a las 22:57, guardada con fecha 20/08).
  function hoyLocal(d) {
    d = d || new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  //  Antes de registrar una entrega nueva: ¿hay algo que confirmar?
  //  Devuelve los avisos (texto) o [] si está todo normal.
  //   · repetida: misma cantidad, mismo lote y misma fecha que una
  //     entrega de esta línea cargada hace menos de 15 minutos.
  //   · excede: con esto se pasaría de lo pedido. Puede ser real (el
  //     proveedor mandó de más), por eso se pregunta y no se bloquea.
  var VENTANA_MS = 15 * 60 * 1000;
  function avisosAntesDeRegistrar(st, nueva, ahora) {
    var out = [], t = (ahora || new Date()).getTime();
    var cant = num(nueva.cantidad);
    var lote = String(nueva.lote || '').trim().toUpperCase();
    var rep = (st.entregas || []).filter(function (e) {
      var c = Date.parse(e.created_at || '');
      return num(e.cantidad) === cant &&
             String(e.lote || '').trim().toUpperCase() === lote &&
             String(e.fecha || '') === String(nueva.fecha || '') &&
             isFinite(c) && t - c >= 0 && t - c < VENTANA_MS;
    });
    if (rep.length) {
      out.push('Hace ' + Math.max(1, Math.round((t - Date.parse(rep[rep.length - 1].created_at)) / 60000)) +
               ' min ya se registró una entrega igual (' + cant + (lote ? ', lote ' + lote : '') +
               '). Si es la misma, no la registres de nuevo: se sumaría dos veces al stock.');
    }
    if (st.pedida > 0 && st.recibido + cant > st.pedida + 1e-9) {
      out.push('Con esta entrega se recibirían ' + (st.recibido + cant) + ' y la orden pidió ' + st.pedida +
               (st.saldo > 0 ? ' (faltaban ' + st.saldo + ')' : ' (ya estaba completa)') + '.');
    }
    return out;
  }

  //  Marcar el COA de una línea como resuelto.
  //   · Con entregas: se marca en las entregas y el trigger de la base
  //     (sync_pedido_recepcion) lo copia a la línea. Así le anda también
  //     al operario de recepción, que no tiene permiso sobre `pedidos`.
  //     Antes se escribían las dos tablas a la vez: la de pedidos fallaba
  //     para el operario y la pantalla decía "no se pudo" aunque el COA
  //     sí había quedado marcado.
  //   · Sin entregas (recibida al viejo estilo): no hay otra que la línea.
  function marcarCoa(SB, App, pedidoId, tieneEntregas) {
    if (tieneEntregas) {
      return SB.from('entregas').update({ coa: 'SI' }).eq('pedido_id', pedidoId).select('id').then(function (r) {
        if (r.error) return { error: r.error.message };
        if (!r.data || !r.data.length) return { error: 'la base no dejó marcar el COA (sin permiso sobre las entregas)' };
        return { success: true, entregas: r.data.length };
      });
    }
    return App.updateRow('pedidos', pedidoId, { 'COA': 'SI' }).then(function (d) {
      if (d && d.error) {
        return { error: 'esta OC se recibió antes de las entregas parciales y su COA se marca desde Pedidos ' +
                        '(hace falta ese permiso). Detalle: ' + d.error };
      }
      return { success: true };
    });
  }

  var api = {
    num: num, sinRecepcion: sinRecepcion, lineStats: lineStats, coaOk: coaOk,
    faltaCoa: faltaCoa, faltaLote: faltaLote, faltaChecklist: faltaChecklist, PL06_DESDE: PL06_DESDE,
    hoyLocal: hoyLocal, avisosAntesDeRegistrar: avisosAntesDeRegistrar, marcarCoa: marcarCoa
  };
  if (typeof module === 'object' && module.exports) module.exports = { RecepcionCalc: api };
  else root.RecepcionCalc = api;
})(typeof window !== 'undefined' ? window : this);
