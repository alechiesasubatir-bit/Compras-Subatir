// ============================================================
//  NAVEGACIÓN — el menú de Compras se arma acá y en un solo lado
//
//  Cada página tenía su propia lista de <a> escrita a mano. Se
//  desincronizaron: "Recepción" aparecía tercera en recepcion.html
//  y varios.html pero última en el resto (la agregaba subatir-app),
//  las clases eran .nl en unas páginas y .nav-link en otras, y en
//  el dashboard los accesos que agregaba el JS copiaban la clase
//  del PRIMER link — que ahí es el activo — así que Recepción,
//  Depósitos y Usuarios se veían los tres iluminados a la vez.
//
//  Ahora el HTML sólo pone <nav></nav> y este archivo lo llena:
//  mismo orden, mismos íconos y un color por módulo (nav.css).
//  Quién ve qué lo decide gateNav() en subatir-app.js, que llama
//  a render({can:...}) una vez que sabe el perfil.
// ============================================================
(function () {
  'use strict';

  // Orden fijo: sigue el recorrido real de una compra —
  // se pide, se recibe, se guarda, se paga, y después los laterales.
  var ITEMS = [
    { k: 'dashboard',    href: 'index.html',          ico: '⬡',  txt: 'Dashboard' },
    { k: 'pedidos',      href: 'pedidos.html',        ico: '📦', txt: 'Pedidos' },
    { k: 'recepcion',    href: 'recepcion.html',      ico: '📥', txt: 'Recepción' },
    { k: 'stock',        href: 'stock.html',          ico: '📊', txt: 'Stock' },
    { k: 'precios',      href: 'precios.html',        ico: '💲', txt: 'Precios' },
    { k: 'proveedores',  href: 'proveedores.html',    ico: '🏭', txt: 'Proveedores' },
    { k: 'varios',       href: 'varios.html',         ico: '🧾', txt: 'Pedidos Varios' },
    { k: 'mp_importacion', href: 'mp-importacion.html', ico: '🧪', txt: 'MP Importación',
      title: 'Previsión y control de compra de materia prima importada' },
    { k: 'deposito',     href: 'deposito/index.html', ico: '🏢', txt: 'Depósitos',
      title: 'Ir a la app de Control de Stock de Depósitos' },
    { k: 'usuarios',     href: 'usuarios.html',       ico: '👥', txt: 'Usuarios' }
  ];

  // Módulos que no son para cualquiera: hasta que gateNav diga lo
  // contrario no se dibujan. Mostrarlos y esconderlos después haría
  // parpadear accesos que la persona no tiene.
  var RESERVADOS = { deposito: 1, usuarios: 1 };

  function pagina() {
    return (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  }

  function texto(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Dibuja el menú dentro del <nav> de la página.
   * @param {{can?:function(string):boolean, page?:string}} opts
   *        can(clave) decide si el módulo se muestra. Sin opts se
   *        dibuja el menú base (sin Depósitos ni Usuarios).
   */
  function render(opts) {
    opts = opts || {};
    var nav = document.querySelector('nav');
    if (!nav) return;

    var aqui = (opts.page || pagina());
    var can = opts.can || function (k) { return !RESERVADOS[k]; };

    // El header cambia de etiqueta según la página (<header> o
    // <div class="hdr">): la clase la ponemos sobre el padre real
    // para que nav.css agarre en las nueve por igual.
    if (nav.parentElement) nav.parentElement.classList.add('sbhdr');
    nav.className = 'sbnav';

    var html = '';
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i];
      if (!can(it.k)) continue;
      html += '<a class="sbnl' + (it.href === aqui ? ' on' : '') + '"'
            + ' href="' + it.href + '" data-nav="' + it.k + '"'
            + (it.title ? ' title="' + texto(it.title) + '"' : '')
            + (it.href === aqui ? ' aria-current="page"' : '') + '>'
            + '<span class="sbnl-i" aria-hidden="true">' + it.ico + '</span>'
            + '<span class="sbnl-t">' + texto(it.txt) + '</span>'
            + '</a>';
    }
    nav.innerHTML = html;
  }

  window.SubatirNav = { render: render, items: ITEMS };

  // Se dibuja el menú base ya mismo. Este script va justo después
  // del </nav>, así que el <nav> existe y no se ve el salto: para
  // cuando llega gateNav con el perfil, sólo saca lo que sobra.
  render();
})();
