// ============================================================
//  IMPORTACIONES · barra de submódulos
//
//  MERO AR vive en mp-importacion.html (sus tablas mp_* y su cuenta,
//  calcada de la planilla de Drive). Las líneas de Depósitos viven en
//  importaciones.html?linea=… con la cuenta de importaciones-calc.js.
//  Esta barra las junta para que se vean como un solo módulo.
//
//  El HTML pone <div class="imp-tabs" data-on="clave"></div> y este
//  script, justo después, lo llena.
// ============================================================
(function () {
  'use strict';
  var TABS = [
    { k: 'mero',    href: 'mp-importacion.html',               ico: '🧪', t: 'MERO AR',  s: 'Esencias' },
    { k: 'Subatir', href: 'importaciones.html?linea=Subatir',  ico: '🏭', t: 'Subatir',  s: 'Consumo' },
    { k: 'Intex',   href: 'importaciones.html?linea=Intex',    ico: '🏊', t: 'Intex',    s: 'Piscina', pronto: true },
    { k: 'Enjoy',   href: 'importaciones.html?linea=Enjoy',    ico: '☀',  t: 'Enjoy',    s: 'Piscina', pronto: true },
    { k: 'Mopas',   href: 'importaciones.html?linea=Mopas',    ico: '🧹', t: 'Mopas',    s: 'Sin artículos', pronto: true }
  ];
  var host = document.getElementById('imp-tabs');
  if (!host) return;
  var on = host.getAttribute('data-on');
  host.setAttribute('role', 'navigation');
  host.setAttribute('aria-label', 'Submódulos de Importaciones');
  host.innerHTML = '<span class="imp-tabs-l">Importaciones</span>' + TABS.map(function (x) {
    var cls = 'imp-tab' + (x.k === on ? ' on' : '') + (x.pronto ? ' pronto' : '');
    var cuerpo = '<span class="imp-tab-i" aria-hidden="true">' + x.ico + '</span>'
      + '<span class="imp-tab-t">' + x.t + '<small>' + (x.pronto ? 'Próximamente' : x.s) + '</small></span>';
    if (x.pronto && x.k !== on) return '<span class="' + cls + '" aria-disabled="true" title="Se arma después, con el mismo criterio que Subatir">' + cuerpo + '</span>';
    return '<a class="' + cls + '" href="' + x.href + '"' + (x.k === on ? ' aria-current="page"' : '') + '>' + cuerpo + '</a>';
  }).join('');
  window.ImpTabs = TABS;
})();
