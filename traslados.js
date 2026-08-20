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

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(n) { return (parseFloat(n) || 0).toLocaleString('es-UY'); }

  function barra(estado) {
    var i = PASOS.map(function (p) { return p[0]; }).indexOf(estado);
    if (i < 0) i = 0;
    return '<div class="prog" role="img" aria-label="Avance: ' + esc(PASOS[i][1]) + ', paso ' + (i + 1) + ' de 4">' +
      PASOS.map(function (p, n) {
        var cls = n < i ? 'done' : (n === i ? (n === 3 ? 'done fin' : 'now') : '');
        var ico = n < i ? '✓' : (n === 3 && i === 3 ? '✓' : p[2]);
        return '<div class="prog-s ' + cls + '"><span class="prog-d" aria-hidden="true">' + ico + '</span>' +
               '<span class="prog-l">' + p[1] + '</span></div>';
      }).join('') + '</div>';
  }

  function titulo(s) {
    var arts = Array.isArray(s.articulos) ? s.articulos : [];
    if (arts.length === 1) return esc(arts[0].art);
    if (!arts.length) return s.items + ' pallet' + (s.items === 1 ? '' : 's');
    return arts.length + ' artículos';
  }

  function tarjeta(s) {
    var f = new Date(s.created_at);
    var llego = s.estado === 'ENTREGADA';
    return '<div class="tr-card' + (llego ? ' tr-ok' : '') + '">' +
      '<div class="tr-top">' +
        '<div class="tr-art">' + titulo(s) + '</div>' +
        '<div class="tr-un">' + num(s.unidades) + ' <span>u.</span></div>' +
      '</div>' +
      '<div class="tr-ruta">#' + s.id + ' · <b>' + esc(s.origen) + ' → ' + esc(s.destino) + '</b> · ' +
        s.items + ' pallet' + (s.items === 1 ? '' : 's') +
        ' · ' + f.toLocaleDateString('es-UY') +
        (s.pedido_por ? ' · pidió <b>' + esc(s.pedido_por) + '</b>' : '') + '</div>' +
      barra(s.estado) +
    '</div>';
  }

  function pintar(host, lista) {
    if (!lista.length) {
      host.innerHTML = '<div class="tr-vacio">Sin traslados en curso.</div>';
      return;
    }
    host.innerHTML = '<div class="tr-grid">' + lista.map(tarjeta).join('') + '</div>';
  }

  function cargar(host) {
    return SB.from('imp_solicitud_resumen').select('*')
      .order('created_at', { ascending: false }).limit(40)
      .then(function (r) {
        if (r.error) {
          host.innerHTML = '<div class="tr-vacio">No se pudieron leer los traslados.</div>';
          return;
        }
        var lista = (r.data || []).filter(enCurso);
        pintar(host, lista);
        var cnt = document.getElementById('tr-cnt');
        if (cnt) cnt.textContent = lista.length + (lista.length === 1 ? ' traslado' : ' traslados');
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
