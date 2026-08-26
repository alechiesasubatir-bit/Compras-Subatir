// ============================================================
//  NAVEGACIÓN — Depósitos
//
//  Hermano del nav.js de Compras, copiado a propósito: esta app es
//  independiente (ver el encabezado de nav.css) y su menú no tiene
//  los mismos destinos.
//
//  La diferencia de fondo con Compras: acá el menú mezcla SECCIONES
//  de esta misma página (#sec-stock, #sec-mapa, #sec-pallets) con
//  PANTALLAS aparte (recorrido, solicitar, volver a Compras). El
//  resaltado estaba escrito a mano en "Stock" y no se movía nunca:
//  se podía estar mirando el Mapa con "Stock" iluminado. Ahora lo
//  sigue un observador de scroll.
//
//  "↩ Compras" conserva su id nav-compras porque deposito-app.js lo
//  muestra sólo a quien tenga algún módulo de aquel lado; nace
//  escondido y ese código lo destapa.
// ============================================================
(function () {
  'use strict';

  // Orden: primero lo que se mira en esta pantalla, después lo que
  // se abre aparte, y al final la puerta de vuelta a Compras.
  var ITEMS = [
    { k: 'stock',     href: '#sec-stock',    ico: '📊', txt: 'Stock' },
    { k: 'mapa',      href: '#sec-mapa',     ico: '🗺',  txt: 'Mapa' },
    { k: 'pallets',   href: '#sec-pallets',  ico: '📦', txt: 'Pallets' },
    { k: 'recorrido', href: 'recorrido.html', ico: '🚚', txt: 'Recorrido',
      title: 'Atender pedidos y escanear' },
    { k: 'solicitar', href: 'solicitar.html', ico: '📋', txt: 'Solicitar',
      title: 'Pedir mercadería de un depósito a otro' },
    { k: 'compras',   href: '../index.html', ico: '↩',  txt: 'Compras',
      id: 'nav-compras', oculto: true, title: 'Volver al sistema de Compras' }
  ];

  function pagina() {
    return (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  }

  function texto(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function marcar(clave) {
    var nav = document.querySelector('nav.sbnav');
    if (!nav) return;
    [].forEach.call(nav.children, function (a) {
      var esta = a.getAttribute('data-nav') === clave;
      a.classList.toggle('on', esta);
      if (esta) a.setAttribute('aria-current', a.getAttribute('href').charAt(0) === '#' ? 'true' : 'page');
      else a.removeAttribute('aria-current');
    });
  }

  /**
   * Sigue la sección que se está mirando y mueve el resaltado.
   *
   * Se calcula en el evento de scroll y no con IntersectionObserver:
   * el navegador ya junta los scroll en uno por cuadro, tres medidas
   * no cuestan nada, y así la regla es una sola línea que se puede
   * leer — con IO había que acertarle a un rootMargin en porcentajes
   * para compensar el header pegajoso.
   */
  function espiarSecciones() {
    var secs = ITEMS.filter(function (it) { return it.href.charAt(0) === '#'; })
      .map(function (it) { return { k: it.k, el: document.querySelector(it.href) }; })
      .filter(function (s) { return s.el; });
    if (!secs.length) return;

    function altoHeader() {
      var hdr = document.querySelector('.sbhdr');
      return hdr ? hdr.getBoundingClientRect().height : 0;
    }

    // El header es pegajoso y el salto del menú dejaba el título de la
    // sección tapado abajo de él. Se mide en vez de escribirlo en el CSS
    // porque el menú ocupa uno o dos renglones según el ancho.
    function ajustarMargen() {
      var m = Math.round(altoHeader() + 12) + 'px';
      secs.forEach(function (s) { s.el.style.scrollMarginTop = m; });
    }

    function recalcular() {
      // Una sección cuenta como "la que se está mirando" recién cuando
      // pasa por debajo del encabezado.
      var corte = altoHeader() + 14;
      var elegida = secs[0].k;
      secs.forEach(function (s) {
        if (s.el.getBoundingClientRect().top <= corte) elegida = s.k;
      });
      // Al fondo de la página gana la última. Si no, una sección corta
      // al final nunca llega a cruzar el corte y no se marca sola.
      var doc = document.documentElement;
      if (window.innerHeight + window.pageYOffset >= doc.scrollHeight - 4) {
        elegida = secs[secs.length - 1].k;
      }
      marcar(elegida);
    }

    window.addEventListener('scroll', recalcular, { passive: true });
    window.addEventListener('resize', function () { ajustarMargen(); recalcular(); });
    ajustarMargen();
    recalcular();
  }

  function render() {
    var nav = document.querySelector('nav');
    if (!nav) return;

    var aqui = pagina();
    if (nav.parentElement) nav.parentElement.classList.add('sbhdr');
    nav.className = 'sbnav';
    nav.setAttribute('aria-label', 'Secciones');

    var html = '';
    ITEMS.forEach(function (it) {
      // En esta página la sección Stock arranca resaltada; en las otras
      // pantallas manda el archivo abierto.
      var activo = (aqui === 'index.html' || aqui === '')
        ? it.k === 'stock'
        : it.href.toLowerCase() === aqui;
      html += '<a class="sbnl' + (activo ? ' on' : '') + '"'
            + ' href="' + it.href + '" data-nav="' + it.k + '"'
            + (it.id ? ' id="' + it.id + '"' : '')
            + (it.oculto ? ' style="display:none"' : '')
            + (it.title ? ' title="' + texto(it.title) + '"' : '')
            + (activo ? ' aria-current="' + (it.href.charAt(0) === '#' ? 'true' : 'page') + '"' : '')
            + '>'
            + '<span class="sbnl-i" aria-hidden="true">' + it.ico + '</span>'
            + '<span class="sbnl-t">' + texto(it.txt) + '</span>'
            + '</a>';
    });
    nav.innerHTML = html;

    // El click no necesita marcar nada: mueve el scroll, y de eso ya se
    // encarga el espía. Con scroll-behavior:smooth el resaltado incluso
    // acompaña el viaje.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', espiarSecciones);
    } else {
      espiarSecciones();
    }
  }

  window.SubatirNav = { render: render, marcar: marcar, items: ITEMS };

  // Este script va justo después del </nav>, así que el elemento ya
  // existe y el menú se pinta sin salto.
  render();
})();
