// ============================================================
//  TRASLADOS ENTRE DEPÓSITOS — panel de avance
//
//  La barra de 4 pasos de un traslado (Pedido → Preparando → En
//  camino → Llegó) vivía sólo en la pantalla de Solicitar del
//  celular, así que desde Compras no había forma de ver si lo
//  pedido a Furriol estaba en camino sin entrar a la otra app.
//
//  Este archivo pinta el mismo panel en los dos dashboards. Está
//  aparte para que la barra se vea igual en los dos lados: dos
//  copias del mismo dibujo terminan divergiendo.
//
//  Uso:  Traslados.montar('#donde-va');
//  Necesita window.SB (el cliente de Supabase) ya creado.
// ============================================================
window.Traslados = (function () {

  var PASOS = [['PENDIENTE', 'Pedido', '1'], ['EN_PREPARACION', 'Preparando', '2'],
               ['EN_TRANSITO', 'En camino', '3'], ['ENTREGADA', 'Llegó', '4']];

  // Sólo lo que está en curso: un traslado entregado o cancelado ya no
  // se sigue. Se dejan los entregados de hoy, que es la confirmación de
  // que llegó lo que se estaba esperando.
  function enCurso(s) {
    if (s.estado === 'CANCELADA') return false;
    if (s.estado !== 'ENTREGADA') return true;
    if (!s.entregada_at) return false;
    var hoy = new Date(), e = new Date(s.entregada_at);
    return e.toDateString() === hoy.toDateString();
  }

  // Los entregados se pueden sacar de la tira una vez vistos. Es la vista
  // de quien mira, no el traslado: se anota en este dispositivo, igual que
  // en la pantalla de Solicitar del celular.
  var OCULTOS = 'tr_ocultos';
  function ocultos() {
    try { return JSON.parse(localStorage.getItem(OCULTOS) || '[]'); } catch (e) { return []; }
  }
  function ocultar(ids) {
    var v = ocultos().concat(ids);
    try { localStorage.setItem(OCULTOS, JSON.stringify(v.slice(-80))); } catch (e) {}
  }

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(n) { return (parseFloat(n) || 0).toLocaleString('es-UY'); }

  // Avance en 4 puntitos: entra en la misma linea que el texto
  function barra(estado) {
    var i = PASOS.map(function (p) { return p[0]; }).indexOf(estado);
    if (i < 0) i = 0;
    var puntos = PASOS.map(function (p, n) {
      var cls = n < i ? 'done' : (n === i ? (n === 3 ? 'done fin' : 'now') : '');
      return '<span class="tr-p ' + cls + '"><span class="tr-d"></span></span>';
    }).join('');
    var fin = i === 3;
    return '<span class="tr-prog" role="img" aria-label="Avance: ' + esc(PASOS[i][1]) +
           ', paso ' + (i + 1) + ' de 4">' + puntos + '</span>' +
           '<span class="tr-paso ' + (fin ? 'c-fin' : 'c-now') + '">' + PASOS[i][1] + '</span>';
  }

  // ── Renglones agrupados por tipo (28/11/2026) ────────────────
  // Antes era una tira de tarjetas al costado: con varios traslados había
  // que scrollear de lado, y faltaban datos (responsable, motivo, nota) o
  // estaban mal (los sueltos de Infraestructura se contaban como pallets).
  // Ahora cada traslado es un renglón y van agrupados por el tipo de lo que
  // se mueve, como se piden en Depósitos.
  var ORDEN_TIPOS = ['Infraestructura', 'Consumo', 'Venta', 'Varios', 'Sin tipo'];
  var ICONO = { Infraestructura: '🏗', Consumo: '🧴', Venta: '🏷', Varios: '🔀', 'Sin tipo': '📦' };

  // Tipo de cada artículo, del maestro de Depósitos (imp_articulos). La
  // vista de traslados no lo trae; se cruza por código + descripción.
  var TIPOS = null;
  function claveArt(cod, art) { return String(cod || '').trim() + '|' + String(art || '').trim().toLowerCase(); }
  function leerTipos() {
    if (TIPOS) return Promise.resolve(TIPOS);
    return SB.from('imp_articulos').select('codigo,descripcion,tipo').then(function (r) {
      if (r.error) return {};
      var m = {};
      (r.data || []).forEach(function (a) { if (a.tipo) m[claveArt(a.codigo, a.descripcion)] = a.tipo; });
      TIPOS = m;
      return m;
    }, function () { return {}; });
  }
  function tipoDe(s, tipos) {
    var arts = Array.isArray(s.articulos) ? s.articulos : [];
    var vistos = {};
    arts.forEach(function (a) { var t = tipos[claveArt(a.cod, a.art)]; if (t) vistos[t] = 1; });
    var ks = Object.keys(vistos);
    if (ks.length === 1) return ks[0];
    if (ks.length > 1) return 'Varios';
    // Sin cruce: lo que viaja suelto (sin pallet) es Infraestructura
    return s.sueltos > 0 ? 'Infraestructura' : 'Sin tipo';
  }

  function fechaHora(iso) {
    if (!iso) return '';
    var f = new Date(iso);
    return f.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' }) + ' ' +
      f.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  // Pallets y sueltos por separado: Infraestructura no se palletiza
  function bultos(s) {
    var sueltos = parseInt(s.sueltos, 10) || 0;
    var pal = Math.max(0, (parseInt(s.items, 10) || 0) - sueltos);
    var out = [];
    if (pal) out.push(pal + ' pallet' + (pal === 1 ? '' : 's'));
    if (sueltos) out.push(sueltos + ' suelto' + (sueltos === 1 ? '' : 's'));
    return out.join(' + ') || ((s.items || 0) + ' ítems');
  }

  // Un artículo por línea, con su cantidad: nada se resume en "A + B"
  function articulos(s) {
    var arts = Array.isArray(s.articulos) ? s.articulos : [];
    if (!arts.length) return '<span class="tr-a">' + bultos(s) + '</span>';
    return arts.map(function (a) {
      return '<span class="tr-a" title="' + esc(a.art) + (a.cod ? ' · ' + esc(a.cod) : '') + '">' +
        (a.un != null ? '<b>' + num(a.un) + '</b> ' : '') + esc(a.art) +
        (a.cod ? '<span class="cod">' + esc(a.cod) + '</span>' : '') +
        (a.pal ? '<span class="tr-pal">' + a.pal + ' pal.</span>' : '') +
      '</span>';
    }).join('');
  }

  function renglon(s) {
    var llego = s.estado === 'ENTREGADA';
    var quien = s.pedido_por || s.solicitante || '';
    var gente = [];
    if (quien) gente.push('pidió <b>' + esc(quien) + '</b>');
    if (s.responsable) gente.push('resp. <b>' + esc(s.responsable) + '</b>');
    if (s.operario) gente.push('preparó <b>' + esc(s.operario) + '</b>');
    // El motivo de Infraestructura suele repetir el destino: sólo si dice otra cosa
    var notas = [];
    if (s.motivo && String(s.motivo).trim() !== String(s.destino || '').trim()) notas.push(esc(s.motivo));
    if (s.nota) notas.push(esc(s.nota));
    return '<div class="tr-row' + (llego ? ' tr-ok' : '') + '">' +
      '<div class="tr-c tr-c-av">' + barra(s.estado) + '</div>' +
      '<div class="tr-c tr-c-id"><b>#' + s.id + '</b><span>' + fechaHora(s.created_at) + '</span>' +
        (llego && s.entregada_at ? '<span class="tr-lleg">llegó ' + fechaHora(s.entregada_at) + '</span>' : '') + '</div>' +
      '<div class="tr-c tr-c-art">' + articulos(s) + '</div>' +
      '<div class="tr-c tr-c-cant"><b>' + num(s.unidades) + '</b> u.<span>' + bultos(s) + '</span></div>' +
      '<div class="tr-c tr-c-ruta">' + esc(s.origen) + ' <i>→</i> ' + esc(s.destino) + '</div>' +
      '<div class="tr-c tr-c-qui">' + gente.join(' · ') +
        (notas.length ? '<span class="tr-nota">' + notas.join(' · ') + '</span>' : '') + '</div>' +
    '</div>';
  }

  function pintar(host, lista, tipos) {
    if (!lista.length) {
      host.innerHTML = '<div class="tr-vacio">Sin traslados en curso.</div>';
      return;
    }
    var grupos = {};
    lista.forEach(function (s) { var t = tipoDe(s, tipos || {}); (grupos[t] = grupos[t] || []).push(s); });
    host.innerHTML = '<div class="tr-lista">' + ORDEN_TIPOS.filter(function (t) { return grupos[t]; }).map(function (t) {
      return '<div class="tr-grupo">' +
        '<div class="tr-gtit">' + ICONO[t] + ' ' + t + ' <span>' + grupos[t].length + '</span></div>' +
        grupos[t].map(renglon).join('') +
      '</div>';
    }).join('') + '</div>';
  }

  function cargar(host) {
    var pTipos = leerTipos();
    return SB.from('imp_solicitud_resumen').select('*')
      .order('created_at', { ascending: false }).limit(40)
      .then(function (r) { return pTipos.then(function (tipos) { return [r, tipos]; }); })
      .then(function (par) {
        var r = par[0], tipos = par[1];
        if (r.error) {
          host.innerHTML = '<div class="tr-vacio">No se pudieron leer los traslados.</div>';
          return;
        }
        var fuera = ocultos();
        var lista = (r.data || []).filter(enCurso).filter(function (s) { return fuera.indexOf(s.id) < 0; });
        pintar(host, lista, tipos);
        var cnt = document.getElementById('tr-cnt');
        if (cnt) cnt.textContent = lista.length + (lista.length === 1 ? ' traslado' : ' traslados');

        // El boton aparece solo si hay algo terminado para sacar de la vista
        var listos = lista.filter(function (s) { return s.estado === 'ENTREGADA'; });
        var btn = document.getElementById('tr-limpiar');
        if (btn) {
          btn.style.display = listos.length ? 'inline-flex' : 'none';
          btn.onclick = function () {
            ocultar(listos.map(function (s) { return s.id; }));
            cargar(host);
          };
        }
      });
  }

  // sel: selector del contenedor donde va el panel
  function montar(sel) {
    var host = document.querySelector(sel);
    if (!host) return;
    host.innerHTML = '<div class="tr-vacio">Cargando…</div>';
    cargar(host);
    // Se refresca solo cuando cambia el estado de un traslado
    try {
      if (window.SubatirApp && SubatirApp.live) {
        SubatirApp.live(['imp_solicitudes', 'imp_solicitud_items'], function () { cargar(host); });
      }
    } catch (e) {}
    return { recargar: function () { return cargar(host); } };
  }

  return { montar: montar, barra: barra };
})();
