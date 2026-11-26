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

  // Orden fijo, el que pidió el usuario: primero el circuito de compra
  // (pedir, recibir, guardar, pagar), después los módulos laterales.
  var ITEMS = [
    { k: 'dashboard',    href: 'index.html',          ico: '⬡',  txt: 'Dashboard' },
    { k: 'pedidos',      href: 'pedidos.html',        ico: '📦', txt: 'Pedidos' },
    { k: 'recepcion',    href: 'recepcion.html',      ico: '📥', txt: 'Recepción' },
    { k: 'stock',        href: 'stock.html',          ico: '📊', txt: 'Stock' },
    { k: 'precios',      href: 'precios.html',        ico: '💲', txt: 'Precios' },
    { k: 'proveedores',  href: 'proveedores.html',    ico: '🏭', txt: 'Proveedores' },
    { k: 'varios',       href: 'varios.html',         ico: '🧾', txt: 'Pedidos Varios' },
    { k: 'deposito',     href: 'deposito/index.html', ico: '🏢', txt: 'Depósitos',
      title: 'Ir a la app de Control de Stock de Depósitos' },
    { k: 'stock',        href: 'reposicion.html',     ico: '🔁', txt: 'Reposición',
      title: 'Cargar de una sentada la configuración de reposición: demora, lote y compras pactadas' },
    { k: 'mp_importacion', href: 'mp-importacion.html', ico: '🚢', txt: 'Importaciones', sub: ['importaciones.html'],
      title: 'Previsión de importaciones: MERO AR, Subatir (Consumo) y las líneas de Depósitos' },
    { k: 'cloro', href: 'cloro.html', ico: '💧', txt: 'Previsión Cloro',
      title: 'Previsión de envasado y compra de materia prima de la línea de piscinas' },
    { k: 'calidad', href: 'calidad.html', ico: '🔬', txt: 'Calidad MP', sub: ['calidad-imp.html'],
      title: 'Fichas técnicas, hojas de seguridad y COA de las materias primas' },
    { k: 'informes',     href: 'informes.html',       ico: '📑', txt: 'Informes',
      title: 'Informes entre fechas de Pedidos, Stock, Precios, Proveedores, Importaciones, Cloro y Depósitos' },
    { k: 'usuarios',     href: 'usuarios.html',       ico: '👥', txt: 'Usuarios' }
  ];

  // Módulos que no son para cualquiera: hasta que gateNav diga lo
  // contrario no se dibujan. Mostrarlos y esconderlos después haría
  // parpadear accesos que la persona no tiene.
  var RESERVADOS = { deposito: 1, calidad: 1, informes: 1, usuarios: 1 };

  function pagina() {
    return (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  }

  function texto(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Grupos (opción A, pedida el 25/11/2026) ──────────────────
  // Con 13 módulos la grilla de cuadros ocupaba dos renglones y el
  // encabezado medía 171 px en cada página. Ahora arriba van pestañas
  // de grupo y abajo una sola fila con los módulos del grupo en el que
  // se está: el módulo de al lado sigue a un clic. El orden dentro de
  // cada grupo es el de esta lista, no el de ITEMS.
  var GRUPOS = [
    { k: 'compras', t: 'Compras',       c: '251,146,60',
      m: ['pedidos.html', 'varios.html', 'recepcion.html', 'proveedores.html', 'precios.html'] },
    { k: 'stock',   t: 'Stock',         c: '167,139,250',
      m: ['stock.html', 'reposicion.html', 'deposito/index.html'] },
    { k: 'mp',      t: 'Materia prima', c: '250,204,21',
      m: ['cloro.html', 'calidad.html'] },
    // Importaciones va en su propia pestaña (pedido 25/11/2026). Con un solo
    // módulo la pestaña es un acceso directo: un clic y se está adentro.
    { k: 'imp',     t: 'Importaciones', c: '45,212,191',
      m: ['mp-importacion.html'] },
    { k: 'gestion', t: 'Gestión',       c: '129,140,248',
      m: ['informes.html', 'usuarios.html'] }
  ];
  // Hasta este número de módulos visibles no se agrupa: el operario de
  // recepción ve uno o dos, y una pestaña para cada uno sería un clic
  // de más sin ahorrar lugar.
  var PLANO_HASTA = 5;

  function porHref(h) {
    for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].href === h) return ITEMS[i];
    return null;
  }
  function esAqui(it, aqui) { return it.href === aqui || !!(it.sub && it.sub.indexOf(aqui) >= 0); }

  function link(it, aqui) {
    var on = esAqui(it, aqui);
    return '<a class="sbnl' + (on ? ' on' : '') + '"'
         + ' href="' + it.href + '" data-nav="' + it.k + '"'
         + (it.title ? ' title="' + texto(it.title) + '"' : '')
         + (it.href === aqui ? ' aria-current="page"' : '') + '>'
         + '<span class="sbnl-i" aria-hidden="true">' + it.ico + '</span>'
         + '<span class="sbnl-t">' + texto(it.txt) + '</span>'
         + '</a>';
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
    // para que nav.css agarre en todas por igual.
    if (nav.parentElement) nav.parentElement.classList.add('sbhdr');

    var vis = ITEMS.filter(function (it) { return can(it.k); });
    if (vis.length <= PLANO_HASTA) {
      nav.className = 'sbnav';
      nav.innerHTML = vis.map(function (it) { return link(it, aqui); }).join('');
      return;
    }

    // Cada grupo con lo que esta persona puede ver; los vacíos no van
    var grupos = GRUPOS.map(function (g) {
      var its = g.m.map(porHref).filter(function (it) { return it && can(it.k); });
      return { k: g.k, t: g.t, c: g.c, its: its };
    }).filter(function (g) { return g.its.length; });
    var dash = porHref('index.html');
    var verDash = dash && can(dash.k);

    // El grupo abierto es el de la página actual; en el Dashboard, el primero
    var actual = null;
    grupos.forEach(function (g) {
      if (g.its.some(function (it) { return esAqui(it, aqui); })) actual = g.k;
    });
    var abierto = actual || (grupos[0] && grupos[0].k);
    // En el Dashboard la fila muestra el primer grupo, pero su pestaña no se
    // enciende hasta que la persona la elige: si no, quedaban dos encendidas.
    var elegido = !!actual;

    nav.className = 'sbnav agrupado';
    nav.setAttribute('aria-label', 'Módulos');

    function pintar() {
      var tabs = '';
      if (verDash) {
        var enDash = esAqui(dash, aqui);
        tabs += '<a class="sbtab' + (enDash ? ' on aqui' : '') + '" href="' + dash.href + '" style="--c:27,200,255"'
              + (enDash ? ' aria-current="page"' : '') + '><i aria-hidden="true"></i>Dashboard</a>';
      }
      grupos.forEach(function (g) {
        var cls = 'sbtab' + (g.k === abierto && elegido ? ' on' : '') + (g.k === actual ? ' aqui' : '');
        // Un grupo de un solo módulo es un acceso directo: no hay qué elegir
        if (g.its.length === 1) {
          var it = g.its[0];
          tabs += '<a class="' + cls + '" href="' + it.href + '" style="--c:' + g.c + '"'
                + ' title="' + texto(it.txt) + '"><i aria-hidden="true"></i>' + texto(g.t) + '</a>';
        } else {
          tabs += '<button type="button" class="' + cls + '" data-grupo="' + g.k + '" style="--c:' + g.c + '"'
                + ' aria-expanded="' + (g.k === abierto) + '" aria-controls="sbsub"'
                + ' title="' + texto(g.its.map(function (it) { return it.txt; }).join(' · ')) + '">'
                + '<i aria-hidden="true"></i>' + texto(g.t) + '</button>';
        }
      });
      var ga = grupos.filter(function (g) { return g.k === abierto; })[0];
      var sub = ga ? ga.its.map(function (it) { return link(it, aqui); }).join('') : '';
      nav.innerHTML = '<div class="sbtabs">' + tabs + '</div>'
        + '<div class="sbsub" id="sbsub" style="--c:' + (ga ? ga.c : '27,200,255') + '">' + sub + '</div>';
    }
    // Tocar otra pestaña cambia la fila, sin cambiar de página
    nav.onclick = function (e) {
      var b = e.target.closest && e.target.closest('button[data-grupo]');
      if (!b) return;
      abierto = b.getAttribute('data-grupo');
      elegido = true;
      pintar();
      vigilar(nav);
      var nb = nav.querySelector('button[data-grupo="' + abierto + '"]');
      if (nb) nb.focus();
    };
    pintar();
    vigilar(nav);
  }

  // Las pestañas van en el renglón del logo y del usuario, centradas
  // (pedido del 25/11/2026). nav.css las centra lo más posible: en el centro
  // exacto si los dos costados entran, y corridas hacia el lado más angosto
  // si no (Pedidos, con sus botones). Si ni así entran en el renglón, se
  // marca .baja y pasan a su propio renglón, también centradas. Se decide sumando anchos,
  // que no cambian al mover las pestañas: se puede volver a medir cada vez
  // que algo cambia de tamaño sin entrar en un ida y vuelta.
  var EN_LINEA_DESDE = 1000;   // el mismo corte que el @media de nav.css
  function ajustar(nav) {
    if (!nav.classList.contains('agrupado')) return;
    var hdr = nav.parentElement, tabs = nav.querySelector('.sbtabs');
    if (!hdr || !tabs) return;
    if (window.innerWidth < EN_LINEA_DESDE) { nav.classList.remove('baja'); return; }
    var cs = getComputedStyle(hdr);
    var libre = hdr.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var gap = 16, usado = tabs.getBoundingClientRect().width + 2 * gap;
    for (var i = 0; i < hdr.children.length; i++) {
      var c = hdr.children[i];
      if (c === nav || c.tagName === 'SCRIPT' || c.tagName === 'STYLE') continue;
      usado += c.getBoundingClientRect().width;
    }
    nav.classList.toggle('baja', usado > libre);
  }
  var _ro = null;
  function vigilar(nav) {
    ajustar(nav);
    if (!window.ResizeObserver || !nav.parentElement) return;
    if (!_ro) {
      _ro = new ResizeObserver(function () { ajustar(nav); });
      _ro.observe(nav.parentElement);
      // El logo y los botones de la derecha crecen cuando la página termina
      // de cargar (fuentes, el chip "17 pend. / 978 total" de Pedidos)
      for (var i = 0; i < nav.parentElement.children.length; i++) {
        var c = nav.parentElement.children[i];
        if (c !== nav && c.tagName !== 'SCRIPT') _ro.observe(c);
      }
    }
    var t = nav.querySelector('.sbtabs');
    if (t) _ro.observe(t);
  }

  window.SubatirNav = { render: render, items: ITEMS, grupos: GRUPOS };

  // Se dibuja el menú base ya mismo. Este script va justo después
  // del </nav>, así que el <nav> existe y no se ve el salto: para
  // cuando llega gateNav con el perfil, sólo saca lo que sobra.
  render();
})();
