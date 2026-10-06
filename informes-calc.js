// ============================================================
//  INFORMES — cálculos puros (sin DOM ni base de datos)
//
//  Cada informe recibe las filas tal como vienen de Supabase (columnas
//  snake_case) y un filtro común { desde, hasta, prov, q }, y devuelve
//  { kpis, filas }. La pantalla (informes.html) sólo dibuja.
//
//  Las fechas se comparan como texto 'YYYY-MM-DD', con `hasta` incluido.
//  Los timestamps (created_at, salida_at…) se pasan antes al día LOCAL:
//  un movimiento de las 22 h del 30 es del 30, no del 31 como diría UTC.
//
//  Los importes nunca se suman entre monedas: no hay tipo de cambio en
//  el sistema, así que todo va en dos columnas, U$S y $.
//
//  Tests: node --test test/informes-calc.test.js
// ============================================================
(function (root, factory) {
  var cloro = (typeof module === 'object' && module.exports)
    ? require('./cloro-calc.js').Cloro
    : root.Cloro;
  var api = factory(cloro);
  if (typeof module === 'object' && module.exports) module.exports = { Informes: api };
  else root.Informes = api;
})(typeof self !== 'undefined' ? self : this, function (Cloro) {
  'use strict';

  var DIA = 86400000;

  // ─── Utilidades ───────────────────────────────────────────────────
  function p2(n) { return (n < 10 ? '0' : '') + n; }

  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : 0;
  }

  // Día local 'YYYY-MM-DD' de una fecha o un timestamp. '' si no hay.
  function dia(v) {
    if (!v) return '';
    var s = String(v);
    if (/^0000/.test(s)) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d = new Date(s);
    if (isNaN(d.getTime())) return s.slice(0, 10);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }

  function utc(f) { return Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10)); }

  function diasEntre(a, b) {
    a = dia(a); b = dia(b);
    if (!a || !b) return null;
    return Math.round((utc(b) - utc(a)) / DIA);
  }

  function sumarDias(f, n) {
    return new Date(utc(dia(f)) + n * DIA).toISOString().slice(0, 10);
  }

  function horasEntre(a, b) {
    if (!a || !b) return null;
    var ms = new Date(b).getTime() - new Date(a).getTime();
    return isFinite(ms) ? ms / 3600000 : null;
  }

  function enRango(f, r) {
    f = dia(f);
    if (!f) return false;
    if (r.desde && f < r.desde) return false;
    if (r.hasta && f > r.hasta) return false;
    return true;
  }

  function moneda(m) { return /U\$S|USD|US\$|D[OÓ]LAR/i.test(String(m || '')) ? 'USD' : 'UYU'; }

  function provOk(p, f) { return !f.prov || norm(p) === norm(f.prov); }

  function textoOk(textos, f) {
    if (!f.q) return true;
    var q = norm(f.q);
    return textos.some(function (t) { return norm(t).indexOf(q) >= 0; });
  }

  function prom(arr) {
    if (!arr.length) return null;
    return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
  }

  function pct(parte, total) { return total ? parte / total * 100 : null; }

  function variacion(desde, hasta) { return desde ? (hasta - desde) / desde * 100 : null; }

  function r2(n) { return n == null ? null : Math.round(n * 100) / 100; }

  function porClave(filas, clave) {
    var m = {};
    (filas || []).forEach(function (x) { var k = x[clave]; (m[k] = m[k] || []).push(x); });
    return m;
  }

  // ─── Estado de una línea de OC ────────────────────────────────────
  // El mismo criterio que lineStats() en pedidos.html: una línea con
  // fecha de recepción y sin entregas es de antes de las entregas
  // parciales y cuenta como recibida entera.
  function estadoLinea(p, ents) {
    ents = (ents || []).slice().sort(function (a, b) {
      return (dia(a.fecha) + String(a.created_at || '')).localeCompare(dia(b.fecha) + String(b.created_at || ''));
    });
    var pedida = num(p.cantidad);
    var recEnt = ents.reduce(function (s, e) { return s + num(e.cantidad); }, 0);
    var frec = dia(p.f_recepcion);
    var legacy = !!frec && recEnt <= 0;
    var recibido = legacy ? pedida : recEnt;
    var estado = legacy ? 'COMPLETA'
      : (recibido <= 0 ? 'PENDIENTE' : (pedida > 0 && recibido >= pedida ? 'COMPLETA' : 'PARCIAL'));
    var completa = '';
    if (legacy) completa = frec;
    else if (estado === 'COMPLETA') {
      var acc = 0;
      for (var i = 0; i < ents.length; i++) {
        acc += num(ents[i].cantidad);
        if (acc >= pedida) { completa = dia(ents[i].fecha); break; }
      }
    }
    return {
      pedida: pedida, recibido: recibido, estado: estado,
      saldo: estado === 'COMPLETA' ? 0 : Math.max(0, pedida - recibido),
      primera: legacy ? frec : (ents.length ? dia(ents[0].fecha) : ''),
      completa: completa, legacy: legacy, entregas: ents
    };
  }

  function netoLinea(p) {
    var s = num(p.s_iva);
    return s > 0 ? s : num(p.cantidad) * num(p.precio_un);
  }

  // ═══ PEDIDOS (COMPRAS) ════════════════════════════════════════════
  // Líneas de OC del período (y, si se pide, los Pedidos Varios).
  function lineasCompra(d, f) {
    var ents = porClave(d.entregas, 'pedido_id');
    var out = [];
    (d.pedidos || []).forEach(function (p) {
      if (!enRango(p.fecha, f) || !provOk(p.proveedor, f)) return;
      if (!textoOk([p.descripcion, p.codigo, p.n_orden], f)) return;
      var st = estadoLinea(p, ents[p.id]);
      var neto = netoLinea(p);
      out.push({
        id: p.id, origen: 'OC', fecha: dia(p.fecha), orden: String(p.n_orden || ''),
        prov: p.proveedor || '', codigo: p.codigo || '', desc: p.descripcion || '',
        cant: num(p.cantidad), precio: num(p.precio_un), mon: moneda(p.moneda), neto: neto,
        estado: st.estado, recibido: st.recibido, saldo: st.saldo,
        pendNeto: st.pedida > 0 ? neto * st.saldo / st.pedida : (st.estado === 'COMPLETA' ? 0 : neto),
        invId: p.inventario_id
      });
    });
    if (f.varios) {
      var items = porClave(d.variosItems, 'pedido_id');
      (d.varios || []).forEach(function (v) {
        if (/ANULAD|CANCELAD/i.test(v.estado || '')) return;
        if (!enRango(v.fecha, f) || !provOk(v.proveedor, f)) return;
        var its = items[v.id] || [];
        var nombres = its.length ? its.map(function (i) { return i.articulo; }) : [v.articulo];
        if (!textoOk(nombres.concat([v.orden_nro]), f)) return;
        var neto = v.subtotal != null ? num(v.subtotal) : num(v.total);
        var recibida = /RECIBID/i.test(v.estado || '');
        out.push({
          id: 'V' + v.id, origen: 'Varios', fecha: dia(v.fecha),
          orden: v.orden_nro ? 'V-' + String(v.orden_nro).replace(/^V-?/i, '') : '',
          prov: v.proveedor || '', codigo: '', desc: nombres.filter(Boolean).join(' · '),
          cant: its.length === 1 ? num(its[0].cantidad) : null, precio: null,
          mon: moneda(v.moneda), neto: neto, estado: recibida ? 'COMPLETA' : 'PENDIENTE',
          recibido: null, saldo: null, pendNeto: recibida ? 0 : neto, invId: null
        });
      });
    }
    out.sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0; });
    return out;
  }

  // Una OC es de un solo proveedor: hay números repetidos entre
  // proveedores (y el "-" de las cargadas sin número), así que la orden
  // se identifica por origen + proveedor + número.
  function claveOrden(l) { return l.origen + '|' + norm(l.prov) + '|' + (l.orden && l.orden !== '-' ? l.orden : l.id); }

  function sumaMon() { return { USD: 0, UYU: 0 }; }

  function compras(d, f) {
    var lineas = lineasCompra(d, f);
    var ordenes = {}, neto = sumaMon(), pend = sumaMon(), completas = 0;
    lineas.forEach(function (l) {
      ordenes[claveOrden(l)] = 1;
      neto[l.mon] += l.neto;
      pend[l.mon] += l.pendNeto;
      if (l.estado === 'COMPLETA') completas++;
    });
    return {
      kpis: {
        ordenes: Object.keys(ordenes).length, lineas: lineas.length,
        netoUSD: neto.USD, netoUYU: neto.UYU, pendUSD: pend.USD, pendUYU: pend.UYU,
        completas: completas, pctCompletas: pct(completas, lineas.length)
      },
      filas: lineas
    };
  }

  // Agrupa líneas de compra por proveedor, artículo o mes.
  function agruparCompras(lineas, por) {
    var g = {};
    lineas.forEach(function (l) {
      var k, label;
      if (por === 'prov') { k = norm(l.prov); label = l.prov; }
      else if (por === 'mes') { k = l.fecha.slice(0, 7); label = k; }
      else { k = norm(l.desc) + '|' + l.mon; label = l.desc; }
      var x = g[k];
      if (!x) {
        x = g[k] = { clave: label, prov: l.prov, mon: l.mon, ordenes: {}, provs: {}, lineas: 0, cant: 0,
                     USD: 0, UYU: 0, pendUSD: 0, pendUYU: 0, ultima: '' };
      }
      x.ordenes[claveOrden(l)] = 1;
      x.provs[norm(l.prov)] = l.prov;
      x.lineas++;
      x.cant += l.cant || 0;
      x[l.mon] += l.neto;
      x[l.mon === 'USD' ? 'pendUSD' : 'pendUYU'] += l.pendNeto;
      if (l.fecha > x.ultima) x.ultima = l.fecha;
    });
    return Object.keys(g).map(function (k) {
      var x = g[k];
      x.nOrdenes = Object.keys(x.ordenes).length;
      x.nProvs = Object.keys(x.provs).length;
      x.proveedores = Object.keys(x.provs).map(function (p) { return x.provs[p]; }).join(', ');
      x.precioProm = x.cant > 0 ? x[x.mon] / x.cant : null;
      delete x.ordenes; delete x.provs;
      return x;
    }).sort(function (a, b) {
      if (por === 'mes') return a.clave < b.clave ? 1 : -1;
      return (b.USD - a.USD) || (b.UYU - a.UYU) || String(a.clave).localeCompare(String(b.clave));
    });
  }

  // ═══ PROVEEDORES ══════════════════════════════════════════════════
  // Cumplimiento: cuánto tardaron de verdad contra lo pactado, cuántas
  // líneas llegaron a tiempo y cómo vino la mercadería (conforme / COA).
  function cumplimiento(d, f, hoy) {
    hoy = dia(hoy);
    var ents = porClave(d.entregas, 'pedido_id');
    var g = {};
    (d.pedidos || []).forEach(function (p) {
      if (!enRango(p.fecha, f) || !provOk(p.proveedor, f)) return;
      if (!textoOk([p.descripcion, p.codigo, p.n_orden], f)) return;
      var k = norm(p.proveedor);
      if (!k) return;
      var x = g[k] || (g[k] = {
        prov: p.proveedor, lineas: 0, completas: 0, parciales: 0, pendientes: 0,
        conDemora: 0, aTiempo: 0, tarde: 0, vencidas: 0, aRevisar: 0, pactadas: [], reales: [],
        recepciones: 0, conformes: 0, conCoa: 0
      });
      var st = estadoLinea(p, ents[p.id]);
      x.lineas++;
      if (st.estado === 'COMPLETA') x.completas++;
      else if (st.estado === 'PARCIAL') x.parciales++;
      else x.pendientes++;

      var fecha = dia(p.fecha), demora = num(p.demora_dias);
      // Recibida ANTES de la OC: es una fecha mal cargada (2006 por 2026)
      // o una OC hecha después de recibir. No se puede medir la demora:
      // queda fuera de los promedios y se cuenta aparte para corregirla.
      var real = st.completa ? diasEntre(fecha, st.completa) : null;
      var invalida = real != null && real < 0;
      if (invalida) x.aRevisar++;
      else if (real != null) x.reales.push(real);
      if (demora > 0) {
        x.conDemora++;
        x.pactadas.push(demora);
        var est = sumarDias(fecha, demora);
        if (st.completa) { if (!invalida) { if (st.completa <= est) x.aTiempo++; else x.tarde++; } }
        else if (hoy > est) { x.tarde++; x.vencidas++; }
      }
      // Calidad de lo recibido: cada entrega cuenta; una línea vieja,
      // recibida sin entregas, cuenta como una recepción con sus datos.
      var recs = st.legacy ? [p] : st.entregas;
      recs.forEach(function (e) {
        x.recepciones++;
        if (String(e.conforme || '').toUpperCase() === 'SI') x.conformes++;
        if (String(e.coa || '').toUpperCase() === 'SI') x.conCoa++;
      });
    });
    var filas = Object.keys(g).map(function (k) {
      var x = g[k];
      x.demoraPactada = r2(prom(x.pactadas));
      x.demoraReal = r2(prom(x.reales));
      x.pctATiempo = pct(x.aTiempo, x.aTiempo + x.tarde);
      x.pctConforme = pct(x.conformes, x.recepciones);
      x.pctCoa = pct(x.conCoa, x.recepciones);
      delete x.pactadas; delete x.reales;
      return x;
    }).sort(function (a, b) { return b.lineas - a.lineas; });
    var tot = filas.reduce(function (t, x) {
      t.aTiempo += x.aTiempo; t.tarde += x.tarde; t.vencidas += x.vencidas; t.lineas += x.lineas; t.aRevisar += x.aRevisar;
      return t;
    }, { aTiempo: 0, tarde: 0, vencidas: 0, lineas: 0, aRevisar: 0 });
    return {
      kpis: { proveedores: filas.length, lineas: tot.lineas, pctATiempo: pct(tot.aTiempo, tot.aTiempo + tot.tarde),
              tarde: tot.tarde, vencidas: tot.vencidas, aRevisar: tot.aRevisar },
      filas: filas
    };
  }

  // Resumen por proveedor: ficha + lista de precios + compras del período.
  function proveedores(d, f, hoy) {
    var lineas = lineasCompra(d, { desde: f.desde, hasta: f.hasta, prov: f.prov, q: f.q, varios: true });
    var cump = cumplimiento(d, f, hoy).filas;
    var g = {};
    function fila(nombre) {
      var k = norm(nombre);
      if (!k) return null;
      return g[k] || (g[k] = {
        prov: nombre, rubro: '', contacto: '', telefono: '', email: '', pago: '', calidad: '', enFicha: false,
        articulosLista: 0, ordenes: {}, lineas: 0, USD: 0, UYU: 0, pendUSD: 0, pendUYU: 0,
        ultimaCompra: '', pctATiempo: null
      });
    }
    (d.proveedores || []).forEach(function (p) {
      if (!provOk(p.empresa, f)) return;
      var x = fila(p.empresa); if (!x) return;
      x.enFicha = true; x.prov = p.empresa;
      x.rubro = p.rubro || ''; x.contacto = p.nombre_contacto || '';
      x.telefono = p.celular || p.telefono || ''; x.email = p.email || '';
      x.pago = p.condicion_pago || ''; x.calidad = p.calidad || '';
    });
    (d.precios || []).forEach(function (r) {
      if (!provOk(r.proveedor, f)) return;
      var x = fila(r.proveedor); if (x) x.articulosLista++;
    });
    lineas.forEach(function (l) {
      var x = fila(l.prov); if (!x) return;
      x.ordenes[claveOrden(l)] = 1;
      x.lineas++;
      x[l.mon] += l.neto;
      x[l.mon === 'USD' ? 'pendUSD' : 'pendUYU'] += l.pendNeto;
      if (l.fecha > x.ultimaCompra) x.ultimaCompra = l.fecha;
    });
    cump.forEach(function (c) { var x = g[norm(c.prov)]; if (x) x.pctATiempo = c.pctATiempo; });
    // Con artículo buscado, sólo quedan los que lo compraron o lo cotizan
    var filas = Object.keys(g).map(function (k) {
      var x = g[k];
      x.nOrdenes = Object.keys(x.ordenes).length;
      delete x.ordenes;
      return x;
    }).filter(function (x) { return !f.q || x.lineas > 0; })
      .sort(function (a, b) { return (b.USD - a.USD) || (b.UYU - a.UYU) || String(a.prov).localeCompare(String(b.prov)); });
    var activos = filas.filter(function (x) { return x.lineas > 0; });
    return {
      kpis: {
        proveedores: filas.length, conCompras: activos.length,
        netoUSD: activos.reduce(function (s, x) { return s + x.USD; }, 0),
        netoUYU: activos.reduce(function (s, x) { return s + x.UYU; }, 0),
        sinFicha: filas.filter(function (x) { return !x.enFicha; }).length
      },
      filas: filas
    };
  }

  // ═══ PRECIOS ══════════════════════════════════════════════════════
  function precioLista(r) {
    var usd = num(r.precio_usd), uyu = num(r.precio_pesos);
    if (usd > 0) return { mon: 'USD', precio: usd };
    if (uyu > 0) return { mon: 'UYU', precio: uyu };
    return { mon: null, precio: null };
  }

  // Índice artículo × proveedor → fila de la lista de precios
  function indiceLista(precios) {
    var ix = {};
    (precios || []).forEach(function (r) {
      var k = norm(r.articulo) + '|' + norm(r.proveedor);
      if (!ix[k]) ix[k] = r;
    });
    return ix;
  }

  // La lista comparada: cada precio contra el mejor del mismo artículo
  // (en la misma moneda), cuánto hace que no se actualiza y a cuánto se
  // compró de verdad la última vez.
  function listaPrecios(d, f, hoy) {
    hoy = dia(hoy);
    var ultima = {}, compradoPeriodo = {};
    (d.pedidos || []).forEach(function (p) {
      var k = norm(p.descripcion) + '|' + norm(p.proveedor);
      var fe = dia(p.fecha);
      if (num(p.precio_un) > 0 && (!ultima[k] || fe > ultima[k].fecha)) {
        ultima[k] = { fecha: fe, precio: num(p.precio_un), mon: moneda(p.moneda) };
      }
      if (enRango(fe, f)) {
        var c = compradoPeriodo[k] || (compradoPeriodo[k] = { cant: 0, neto: 0 });
        c.cant += num(p.cantidad); c.neto += netoLinea(p);
      }
    });
    var porArt = {};
    (d.precios || []).forEach(function (r) {
      var pl = precioLista(r);
      var a = norm(r.articulo);
      (porArt[a] = porArt[a] || []).push({ prov: norm(r.proveedor), mon: pl.mon, precio: pl.precio });
    });
    var filas = [];
    (d.precios || []).forEach(function (r) {
      if (!provOk(r.proveedor, f) || !textoOk([r.articulo, r.codigo, r.cod_prov], f)) return;
      var pl = precioLista(r), a = norm(r.articulo), k = a + '|' + norm(r.proveedor);
      var hermanos = porArt[a] || [];
      var provs = {};
      hermanos.forEach(function (h) { provs[h.prov] = 1; });
      var mismos = hermanos.filter(function (h) { return h.mon && h.mon === pl.mon; });
      var mejor = mismos.length ? Math.min.apply(null, mismos.map(function (h) { return h.precio; })) : null;
      var u = ultima[k] || null;
      var c = compradoPeriodo[k] || null;
      filas.push({
        id: r.id, articulo: r.articulo || '', codigo: r.codigo || '', prov: r.proveedor || '',
        mon: pl.mon, precio: pl.precio, actualizado: dia(r.fecha_actualizado),
        dias: r.fecha_actualizado ? diasEntre(r.fecha_actualizado, hoy) : null,
        nProvs: Object.keys(provs).length, mejor: mejor,
        esMejor: pl.precio != null && mejor != null && pl.precio <= mejor && mismos.length > 1,
        sobreMejor: pl.precio != null && mejor ? variacion(mejor, pl.precio) : null,
        ultFecha: u ? u.fecha : '', ultPrecio: u ? u.precio : null, ultMon: u ? u.mon : null,
        difUltima: u && pl.precio && u.mon === pl.mon ? variacion(pl.precio, u.precio) : null,
        cantPeriodo: c ? c.cant : 0, netoPeriodo: c ? c.neto : 0,
        calidad: r.calidad || '', pago: r.modalidad_pago || ''
      });
    });
    filas.sort(function (a, b) { return a.articulo.localeCompare(b.articulo) || (a.precio || 0) - (b.precio || 0); });
    return {
      kpis: {
        precios: filas.length,
        actualizados: filas.filter(function (x) { return enRango(x.actualizado, f); }).length,
        viejos: filas.filter(function (x) { return x.dias == null || x.dias > 180; }).length,
        conAlternativa: filas.filter(function (x) { return x.nProvs > 1; }).length,
        desfasados: filas.filter(function (x) { return x.difUltima != null && Math.abs(x.difUltima) >= 1; }).length
      },
      filas: filas
    };
  }

  // Lo que se pagó de verdad en las OC del período, artículo × proveedor,
  // contra el precio que hoy tiene cargado la lista.
  function evolucionPrecios(d, f) {
    var lista = indiceLista(d.precios);
    var g = {};
    (d.pedidos || []).forEach(function (p) {
      if (!enRango(p.fecha, f) || !provOk(p.proveedor, f)) return;
      if (!textoOk([p.descripcion, p.codigo], f)) return;
      var precio = num(p.precio_un);
      if (!(precio > 0)) return;
      var mon = moneda(p.moneda);
      var k = norm(p.descripcion) + '|' + norm(p.proveedor) + '|' + mon;
      (g[k] = g[k] || []).push({ fecha: dia(p.fecha), id: p.id, precio: precio, cant: num(p.cantidad), p: p, mon: mon });
    });
    var filas = Object.keys(g).map(function (k) {
      var v = g[k].sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id; });
      var pri = v[0], ult = v[v.length - 1];
      var precios = v.map(function (x) { return x.precio; });
      var lr = lista[norm(ult.p.descripcion) + '|' + norm(ult.p.proveedor)];
      var lp = lr ? precioLista(lr) : null;
      var listaPrecio = lp && lp.mon === ult.mon ? lp.precio : null;
      return {
        articulo: ult.p.descripcion || '', prov: ult.p.proveedor || '', mon: ult.mon,
        compras: v.length, cant: v.reduce(function (s, x) { return s + x.cant; }, 0),
        primeraFecha: pri.fecha, primerPrecio: pri.precio,
        ultimaFecha: ult.fecha, ultimoPrecio: ult.precio,
        min: Math.min.apply(null, precios), max: Math.max.apply(null, precios),
        variacion: variacion(pri.precio, ult.precio),
        lista: listaPrecio, listaFecha: lr ? dia(lr.fecha_actualizado) : '',
        enLista: !!lr,
        difLista: listaPrecio ? variacion(listaPrecio, ult.precio) : null
      };
    }).sort(function (a, b) { return Math.abs(b.variacion || 0) - Math.abs(a.variacion || 0) || a.articulo.localeCompare(b.articulo); });
    return {
      kpis: {
        articulos: filas.length,
        suben: filas.filter(function (x) { return x.variacion > 0.5; }).length,
        bajan: filas.filter(function (x) { return x.variacion < -0.5; }).length,
        desfasados: filas.filter(function (x) { return x.difLista != null && Math.abs(x.difLista) >= 1; }).length,
        sinLista: filas.filter(function (x) { return !x.enLista; }).length
      },
      filas: filas
    };
  }

  // ═══ STOCK ════════════════════════════════════════════════════════
  // Foto actual del inventario cruzada con las OC: lo que se compró y lo
  // que entró en el período, y el stock valorizado al último precio pagado.
  // `pendienteDe(id)` lo da SubatirApp.transito, el mismo número que Stock.
  function stock(d, f, pendienteDe) {
    var ents = porClave(d.entregas, 'pedido_id');
    var porId = {}, porDesc = {};
    (d.pedidos || []).forEach(function (p) {
      if (p.inventario_id != null && p.inventario_id !== '') (porId[p.inventario_id] = porId[p.inventario_id] || []).push(p);
      else (porDesc[norm(p.descripcion)] = porDesc[norm(p.descripcion)] || []).push(p);
    });
    var filas = [];
    (d.inventario || []).forEach(function (a) {
      if (!textoOk([a.descripcion, a.codigo], f)) return;
      var lineas = (porId[a.id] || []).concat(porDesc[norm(a.descripcion)] || []);
      if (f.prov && !provOk(a.proveedor, f) && !provOk(a.proveedor_sugerido, f) &&
          !lineas.some(function (p) { return provOk(p.proveedor, f); })) return;
      var comprado = 0, recibido = 0, ult = null;
      lineas.forEach(function (p) {
        var fe = dia(p.fecha);
        if (enRango(fe, f)) comprado += num(p.cantidad);
        var st = estadoLinea(p, ents[p.id]);
        if (st.legacy) { if (enRango(st.completa, f)) recibido += st.pedida; }
        else st.entregas.forEach(function (e) { if (enRango(e.fecha, f)) recibido += num(e.cantidad); });
        if (num(p.precio_un) > 0 && (!ult || fe > ult.fecha)) ult = { fecha: fe, precio: num(p.precio_un), mon: moneda(p.moneda), prov: p.proveedor };
      });
      var st = num(a.inventario), min = num(a.stock_minimo), cons = num(a.consumo_mensual);
      var estado = st <= 0 ? 'SIN STOCK' : (min > 0 && st < min ? 'BAJO MÍNIMO' : 'OK');
      var valor = ult ? st * ult.precio : null;
      filas.push({
        id: a.id, codigo: a.codigo || '', desc: a.descripcion || '', unidad: a.unidad || '',
        stock: st, minimo: min, consumo: cons, cobertura: cons > 0 ? st / cons : null,
        pendiente: pendienteDe ? num(pendienteDe(a.id)) : 0, estado: estado,
        comprado: comprado, recibido: recibido,
        precioRef: ult ? ult.precio : null, monRef: ult ? ult.mon : null, provRef: ult ? ult.prov : '',
        valorUSD: ult && ult.mon === 'USD' ? valor : null, valorUYU: ult && ult.mon === 'UYU' ? valor : null
      });
    });
    filas.sort(function (a, b) {
      var o = { 'SIN STOCK': 0, 'BAJO MÍNIMO': 1, 'OK': 2 };
      return o[a.estado] - o[b.estado] || a.desc.localeCompare(b.desc);
    });
    return {
      kpis: {
        articulos: filas.length,
        sinStock: filas.filter(function (x) { return x.estado === 'SIN STOCK'; }).length,
        bajoMinimo: filas.filter(function (x) { return x.estado === 'BAJO MÍNIMO'; }).length,
        valorUSD: filas.reduce(function (s, x) { return s + (x.valorUSD || 0); }, 0),
        valorUYU: filas.reduce(function (s, x) { return s + (x.valorUYU || 0); }, 0),
        sinPrecio: filas.filter(function (x) { return x.precioRef == null && x.stock > 0; }).length
      },
      filas: filas
    };
  }

  // Los que piden atención: sin stock, bajo el mínimo o con menos de un
  // mes de cobertura sin nada en camino que lo cubra.
  function criticos(filas) {
    return filas.filter(function (x) {
      return x.estado !== 'OK' || (x.cobertura != null && x.cobertura < 1 && x.pendiente <= 0);
    });
  }

  // ═══ MP IMPORTACIÓN ═══════════════════════════════════════════════
  function mp(d, f) {
    var provs = {}, arts = {}, corr = {};
    (d.mpProveedores || []).forEach(function (p) { provs[p.id] = p.nombre; });
    (d.mpArticulos || []).forEach(function (a) { arts[a.id] = a; });
    (d.mpCorridas || []).forEach(function (c) {
      if (enRango(c.fecha, f) && provOk(provs[c.proveedor_id], f)) corr[c.id] = c;
    });
    var filas = [];
    (d.mpDatos || []).forEach(function (x) {
      var c = corr[x.corrida_id], a = arts[x.articulo_id];
      if (!c || !a || !textoOk([a.nombre, a.codigo, a.grupo], f)) return;
      var mensual = num(x.consumo_3m) / 3;
      filas.push({
        corridaId: c.id, corrida: c.nombre || '', fecha: dia(c.fecha), prov: provs[c.proveedor_id] || '',
        articuloId: a.id, grupo: a.grupo || '', articulo: a.nombre || '', codigo: a.codigo || '',
        consumo3m: num(x.consumo_3m), mensual: mensual, stock: num(x.stock_actual),
        promAnual: num(x.prom_anual), compra: x.compra_confirmada == null ? null : num(x.compra_confirmada),
        cobertura: mensual > 0 ? num(x.stock_actual) / mensual : null, cerrada: !!c.cerrada
      });
    });
    filas.sort(function (a, b) { return b.fecha.localeCompare(a.fecha) || a.grupo.localeCompare(b.grupo) || a.articulo.localeCompare(b.articulo); });
    return {
      kpis: {
        corridas: Object.keys(corr).length,
        articulos: Object.keys(porClave(filas, 'articuloId')).length,
        compraTotal: filas.reduce(function (s, x) { return s + (x.compra || 0); }, 0),
        bajaCobertura: filas.filter(function (x) { return x.cobertura != null && x.cobertura < 2; }).length
      },
      filas: filas
    };
  }

  // Cómo se movió cada artículo entre la primera y la última corrida del período
  function mpEvolucion(filas) {
    var g = porClave(filas, 'articuloId');
    return Object.keys(g).map(function (k) {
      var v = g[k].slice().sort(function (a, b) { return a.fecha.localeCompare(b.fecha); });
      var pri = v[0], ult = v[v.length - 1];
      return {
        prov: ult.prov, grupo: ult.grupo, articulo: ult.articulo, codigo: ult.codigo, corridas: v.length,
        mensualIni: pri.mensual, mensualFin: ult.mensual, variacion: variacion(pri.mensual, ult.mensual),
        stockIni: pri.stock, stockFin: ult.stock, cobertura: ult.cobertura,
        compras: v.reduce(function (s, x) { return s + (x.compra || 0); }, 0)
      };
    }).sort(function (a, b) { return a.grupo.localeCompare(b.grupo) || a.articulo.localeCompare(b.articulo); });
  }

  // ═══ PREVISIÓN CLORO ══════════════════════════════════════════════
  // Las ventas se guardan por semana de temporada: una semana entra en
  // el período si su lunes cae adentro. La comparación es contra las
  // mismas fechas un año antes, corridas 364 días para que los lunes
  // sigan siendo lunes.
  function ventasCloro(d, desde, hasta) {
    var temps = {};
    (d.clTemporadas || []).forEach(function (t) { temps[t.id] = t; });
    var out = {};
    (d.clVentas || []).forEach(function (v) {
      var t = temps[v.temporada_id];
      if (!t || !t.fecha_ini) return;
      var lunes = Cloro.fechaDeSemana(num(v.semana), new Date(t.fecha_ini + 'T00:00:00Z')).toISOString().slice(0, 10);
      if (!enRango(lunes, { desde: desde, hasta: hasta })) return;
      out[v.producto_id] = (out[v.producto_id] || 0) + num(v.unidades);
    });
    return out;
  }

  function cloro(d, f) {
    var mats = {};
    (d.clMaterias || []).forEach(function (m) { mats[m.id] = m.nombre; });
    var vend = ventasCloro(d, f.desde, f.hasta);
    var vendAnt = ventasCloro(d, f.desde ? sumarDias(f.desde, -364) : '', f.hasta ? sumarDias(f.hasta, -364) : '');
    var env = {};
    (d.clEnvasado || []).forEach(function (e) {
      if (enRango(e.fecha, f)) env[e.producto_id] = (env[e.producto_id] || 0) + num(e.cantidad);
    });
    var filas = [];
    (d.clProductos || []).forEach(function (p) {
      if (!textoOk([p.nombre, p.codigo, mats[p.materia_id]], f)) return;
      var kg = num(p.kg_mp_por_unidad);
      var x = {
        id: p.id, codigo: p.codigo || '', producto: p.nombre || '', materia: mats[p.materia_id] || '',
        kgUnidad: kg, vendido: vend[p.id] || 0, vendidoAnt: vendAnt[p.id] || 0,
        envasado: env[p.id] || 0, activo: p.activo !== false, orden: num(p.orden)
      };
      x.variacion = variacion(x.vendidoAnt, x.vendido);
      x.kgVendidos = x.vendido * kg;
      x.kgEnvasados = x.envasado * kg;
      if (x.activo || x.vendido || x.envasado || x.vendidoAnt) filas.push(x);
    });
    filas.sort(function (a, b) { return a.orden - b.orden || a.producto.localeCompare(b.producto); });
    var t = filas.reduce(function (s, x) {
      s.v += x.vendido; s.va += x.vendidoAnt; s.e += x.envasado; s.kg += x.kgEnvasados; return s;
    }, { v: 0, va: 0, e: 0, kg: 0 });
    return {
      kpis: { vendido: t.v, vendidoAnt: t.va, variacion: variacion(t.va, t.v), envasado: t.e, kgEnvasados: t.kg },
      filas: filas
    };
  }

  function cloroPorMateria(filas) {
    var g = {};
    filas.forEach(function (x) {
      var k = x.materia || '(sin materia prima)';
      var m = g[k] || (g[k] = { materia: k, productos: 0, vendido: 0, kgVendidos: 0, kgVendidosAnt: 0, envasado: 0, kgEnvasados: 0 });
      m.productos++;
      m.vendido += x.vendido;
      m.kgVendidos += x.kgVendidos;
      m.kgVendidosAnt += x.vendidoAnt * x.kgUnidad;
      m.envasado += x.envasado;
      m.kgEnvasados += x.kgEnvasados;
    });
    return Object.keys(g).map(function (k) {
      g[k].variacion = variacion(g[k].kgVendidosAnt, g[k].kgVendidos);
      return g[k];
    }).sort(function (a, b) { return b.kgVendidos - a.kgVendidos; });
  }

  // ═══ DEPÓSITOS ════════════════════════════════════════════════════
  var TIPOS_MOV = ['INGRESO', 'ARMADO', 'SALIDA', 'ENTRADA', 'CONSUMO', 'AJUSTE'];

  function artsDep(d, f) {
    var arts = {};
    (d.impArticulos || []).forEach(function (a) {
      if (provOk(a.proveedor, f) && textoOk([a.descripcion, a.codigo], f)) arts[a.id] = a;
    });
    return arts;
  }

  function depositos(d, f) {
    var arts = artsDep(d, f);
    var g = {};
    var nMov = 0, ingresado = 0;
    (d.impMovimientos || []).forEach(function (m) {
      var a = arts[m.articulo_id];
      if (!a || !enRango(m.created_at, f)) return;
      if (f.deposito && m.deposito !== f.deposito && m.origen !== f.deposito && m.destino !== f.deposito) return;
      if (TIPOS_MOV.indexOf(m.tipo) < 0) return;      // UBICACION sólo cambia de lugar
      var k = a.id + '|' + (m.deposito || m.origen || '');
      var x = g[k] || (g[k] = {
        articulo: a.descripcion || '', codigo: a.codigo || '', tipo: a.tipo || 'Consumo', prov: a.proveedor || '',
        deposito: m.deposito || m.origen || '', movimientos: 0, INGRESO: 0, ARMADO: 0, SALIDA: 0, ENTRADA: 0, CONSUMO: 0, AJUSTE: 0
      });
      var u = num(m.unidades);
      if (m.tipo === 'AJUSTE' && m.stock_antes != null && m.stock_despues != null) u = num(m.stock_despues) - num(m.stock_antes);
      x[m.tipo] += u;
      x.movimientos++;
      nMov++;
      if (m.tipo === 'INGRESO') ingresado += u;
    });
    var filas = Object.keys(g).map(function (k) { return g[k]; })
      .sort(function (a, b) { return a.articulo.localeCompare(b.articulo) || a.deposito.localeCompare(b.deposito); });

    var trans = transferencias(d, f);
    var sols = solicitudes(d, f);
    return {
      kpis: {
        movimientos: nMov, ingresado: ingresado, pallets: trans.length,
        transitoProm: r2(prom(trans.filter(function (t) { return t.horas != null; }).map(function (t) { return t.horas; }))),
        solicitudes: sols.length,
        atencionProm: r2(prom(sols.filter(function (s) { return s.horas != null; }).map(function (s) { return s.horas; })))
      },
      filas: filas, transferencias: trans, solicitudes: sols
    };
  }

  function transferencias(d, f) {
    var arts = artsDep(d, f);
    return (d.impPallets || []).filter(function (p) {
      if (!p.salida_at || !arts[p.articulo_id] || !enRango(p.salida_at, f)) return false;
      return !f.deposito || p.origen === f.deposito || p.destino === f.deposito;
    }).map(function (p) {
      var a = arts[p.articulo_id];
      return {
        codigo: p.codigo || '', articulo: a.descripcion || '', unidades: num(p.unidades), cajas: num(p.cajas),
        origen: p.origen || '', destino: p.destino || '', salida: p.salida_at, llegada: p.llegada_at || '',
        horas: p.llegada_at ? r2(horasEntre(p.salida_at, p.llegada_at)) : null, estado: p.estado || ''
      };
    }).sort(function (a, b) { return String(b.salida).localeCompare(String(a.salida)); });
  }

  function solicitudes(d, f) {
    return (d.impSolicitudes || []).filter(function (s) {
      if (!enRango(s.created_at, f)) return false;
      return !f.deposito || s.origen === f.deposito || s.destino === f.deposito;
    }).map(function (s) {
      return {
        id: s.id, fecha: s.created_at, solicitante: s.solicitante || '', origen: s.origen || '',
        destino: s.destino || (s.sucursal ? 'Sucursal ' + s.sucursal : ''),
        estado: s.estado || '', operario: s.operario || '', entregada: s.entregada_at || '',
        horas: s.entregada_at ? r2(horasEntre(s.created_at, s.entregada_at)) : null
      };
    }).sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
  }

  // Infraestructura: un renglón por artículo movido, sin pallet (vista
  // imp_infra_traza). La fecha que cuenta es la del despacho, que es
  // cuando salió del stock; lo pedido y no despachado entra por la
  // fecha del pedido para que no quede afuera de ningún período.
  function infraestructura(d, f) {
    var prov = {};
    (d.impArticulos || []).forEach(function (a) { prov[a.id] = a.proveedor; });
    return (d.impInfra || []).filter(function (x) {
      if (x.estado === 'CANCELADO') return false;
      if (!provOk(prov[x.articulo_id], f)) return false;
      // La búsqueda también encuentra por quién pidió, motivo o sucursal
      if (!textoOk([x.articulo, x.codigo, x.responsable, x.motivo, x.destino, x.solicitante], f)) return false;
      if (!enRango(x.despachado_at || x.pedido_at, f)) return false;
      return !f.deposito || x.origen === f.deposito || x.destino === f.deposito;
    }).map(function (x) {
      return {
        fecha: x.despachado_at || x.pedido_at, pedido: x.solicitud_id, articulo: x.articulo || '', codigo: x.codigo || '',
        unidades: num(x.unidades), origen: x.origen || '',
        destino: (x.destino_tipo === 'Sucursal' ? 'Sucursal ' : '') + (x.destino || ''),
        responsable: x.responsable || '', motivo: x.motivo || '',
        despacho: x.despachado_by || '', recibio: x.recibido_by || '', recibido: x.recibido_at || '',
        estado: x.estado === 'PEDIDO' ? 'Pedido' : x.estado === 'ENVIADO' ? 'En camino' : 'Entregado'
      };
    }).sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
  }

  // Stock actual por depósito: una columna por depósito.
  function stockDepositos(d, f) {
    var arts = artsDep(d, f), deps = {}, g = {};
    (d.impStock || []).forEach(function (s) {
      var a = arts[s.articulo_id];
      if (!a) return;
      deps[s.deposito] = 1;
      var x = g[a.id] || (g[a.id] = { articulo: a.descripcion || '', codigo: a.codigo || '', tipo: a.tipo || 'Consumo', prov: a.proveedor || '', total: 0, por: {} });
      x.por[s.deposito] = (x.por[s.deposito] || 0) + num(s.cantidad);
      x.total += num(s.cantidad);
    });
    var lista = Object.keys(deps).sort();
    if (f.deposito) lista = lista.filter(function (x) { return x === f.deposito; });
    var filas = Object.keys(g).map(function (k) { return g[k]; })
      .filter(function (x) { return lista.some(function (dp) { return x.por[dp]; }); })
      .sort(function (a, b) { return a.articulo.localeCompare(b.articulo); });
    return { depositos: lista, filas: filas };
  }

  // ─── Períodos rápidos ─────────────────────────────────────────────
  function periodo(clave, hoy) {
    var h = dia(hoy), y = +h.slice(0, 4), m = +h.slice(5, 7);
    function ymd(yy, mm, dd) { return new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10); }
    switch (clave) {
      case 'mes':       return { desde: ymd(y, m, 1), hasta: h };
      case 'mesAnt':    return { desde: ymd(y, m - 1, 1), hasta: ymd(y, m, 0) };
      case 'trimestre': var q = Math.floor((m - 1) / 3) * 3 + 1; return { desde: ymd(y, q, 1), hasta: h };
      case 'anio':      return { desde: ymd(y, 1, 1), hasta: h };
      case '12m':       return { desde: sumarDias(h, -365), hasta: h };
      default:          return { desde: '', hasta: '' };
    }
  }

  return {
    norm: norm, num: num, dia: dia, diasEntre: diasEntre, sumarDias: sumarDias, enRango: enRango,
    moneda: moneda, variacion: variacion, periodo: periodo,
    estadoLinea: estadoLinea, lineasCompra: lineasCompra, compras: compras, agruparCompras: agruparCompras,
    cumplimiento: cumplimiento, proveedores: proveedores,
    listaPrecios: listaPrecios, evolucionPrecios: evolucionPrecios,
    stock: stock, criticos: criticos,
    mp: mp, mpEvolucion: mpEvolucion,
    cloro: cloro, cloroPorMateria: cloroPorMateria,
    depositos: depositos, stockDepositos: stockDepositos, infraestructura: infraestructura
  };
});
