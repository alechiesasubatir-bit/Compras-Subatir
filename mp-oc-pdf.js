// ══════════════════════════════════════════════════════════════
//  MP-OC-PDF — la Orden de Compra de importacion, en un solo lugar
//
//  NO es el mismo papel que oc-pdf.js y por eso no lo reusa:
//   · La OC de plaza lleva precios, IVA y totales en pesos o dolares.
//     Esta no lleva NINGUN precio: MP Importacion no los tiene y el
//     papel que se le manda a MERO AR sale solo con cantidades en kg.
//   · Va en A4 VERTICAL y agrupada por bloque de articulos, no en una
//     tabla unica apaisada.
//  Meter los dos en el mismo modulo hubiera sido un archivo lleno de
//  "if esImportacion", que es la forma segura de romper el papel de una
//  pantalla arreglando el de la otra.
//
//  Lo que si comparte es el criterio de oc-pdf.js: es AUTOCONTENIDO.
//  Trae sus propios formateadores y el membrete de la empresa, no va a
//  buscar nada a variables globales de la pantalla, y no llama a
//  toast(): tira la excepcion y la pantalla avisa como sabe.
//
//  Uso:
//    MPOCPdf.build({
//      numero:'OC-MEROAR-001',
//      fecha:'2026-06-08',
//      proveedor:'MERO AR',
//      condicion:'CIF Montevideo — importación',
//      corrida:'Importación base',                    // opcional, va al pie
//      grupos:[{ titulo:'Esencias',
//                lines:[{desc:'Esencia Acqua MEROAR', cod:'761453', cant:30}] }]
//    });
//
//  Requiere jspdf y jspdf-autotable ya cargados en la pagina.
// ══════════════════════════════════════════════════════════════
window.MPOCPdf = (function(){
  'use strict';

  // El membrete vive aca y no en la pantalla: este papel se manda por
  // mail al exterior y los datos de la empresa son del documento, no
  // del modulo que lo dispara.
  var EMPRESA = {
    nombre: 'SUBATIR S.A.',
    dir: ['Ruta 8 Km 26', 'Calle José Gervasio Artigas', 'entre Los Mimbres y Cinacinas'],
    ruc: 'RUC 218386010019'
  };

  var OR    = [242,101,34];    // naranja Subatir
  var BK    = [22,22,22];
  var GRIS  = [110,110,110];
  var SUAVE = [253,236,226];   // naranja lavado, para la banda de cada grupo
  var LINEA = [226,214,206];
  var CEBRA = [250,249,248];

  // ── Formato ─────────────────────────────────────────────────
  // Los kg se cargan casi siempre redondos (son tarrinas de 30), asi
  // que mostrar "30,0" seria ruido. Un decimal solo si de verdad lo hay.
  function fmtKg(n){
    n = parseFloat(n) || 0;
    var d = Math.abs(n - Math.round(n)) < 0.05 ? 0 : 1;
    return n.toLocaleString('es-UY', {minimumFractionDigits:d, maximumFractionDigits:d});
  }
  function fmtDate(d){
    if(!d || d==='' || d==='0000-00-00') return '—';
    var p = String(d).split('-');
    if(p.length===3 && p[0].length===4) return p[2]+'/'+p[1]+'/'+p[0];
    return String(d);
  }

  // ── Logo ────────────────────────────────────────────────────
  // Se precarga a data URL apenas carga la pagina porque addImage es
  // sincronico: si se leyera recien al apretar el boton, el PDF saldria
  // sin logo la primera vez y con logo la segunda.
  var LOGO = null, LOGO_AR = 1.2;
  (function precargar(){
    try{
      var img = new Image();
      img.onload = function(){
        try{
          var c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          LOGO = c.toDataURL('image/jpeg', 0.92);
          LOGO_AR = img.naturalWidth / img.naturalHeight;
        }catch(e){ /* canvas tainted: queda el fallback dibujado */ }
      };
      img.src = 'logo-oc.jpg';
    }catch(e){}
  })();

  function build(oc){
    if(!window.jspdf || !window.jspdf.jsPDF){
      throw new Error('No se pudo cargar el generador de PDF (revisá tu conexión).');
    }
    var doc = new window.jspdf.jsPDF({unit:'pt', format:'a4', orientation:'portrait'});
    var W = doc.internal.pageSize.getWidth();
    var H = doc.internal.pageSize.getHeight();
    var M = 36;
    var PIE = 30;                  // franja de abajo reservada para el pie

    function txt(c){  doc.setTextColor(c[0],c[1],c[2]); }
    function fill(c){ doc.setFillColor(c[0],c[1],c[2]); }
    function line(c){ doc.setDrawColor(c[0],c[1],c[2]); }

    // Corta a la pagina siguiente si el bloque que viene no entra entero.
    // Un TOTAL GENERAL o un cuadro de firma partido al medio es peor que
    // una hoja de mas.
    function sitio(y, alto){
      if(y + alto > H - PIE) { doc.addPage(); return M + 10; }
      return y;
    }

    // ══ Membrete ══════════════════════════════════════════════
    var logoH = 54, logoW = logoH * LOGO_AR;
    dibujarLogo(doc, M, 30, logoW, logoH);

    doc.setFont('helvetica','bold'); doc.setFontSize(19); txt(BK);
    doc.text(EMPRESA.nombre, M + logoW + 14, 58);

    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); txt(GRIS);
    var ry = 42;
    EMPRESA.dir.forEach(function(l){ doc.text(l, W-M, ry, {align:'right'}); ry += 11.5; });
    doc.setFont('helvetica','bold'); txt(BK);
    doc.text(EMPRESA.ruc, W-M, ry+4, {align:'right'});

    var y = Math.max(30 + logoH, ry + 8) + 10;
    line(OR); doc.setLineWidth(1.6); doc.line(M, y, W-M, y);
    y += 15;

    // ══ Titulo ════════════════════════════════════════════════
    fill(OR); doc.roundedRect(M, y, W-2*M, 26, 5, 5, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(15); txt([255,255,255]);
    doc.text('ORDEN DE COMPRA', W/2, y+18, {align:'center'});
    y += 26 + 11;

    // ══ Datos de la orden (2 x 2) ═════════════════════════════
    var bw = W - 2*M, bh = 60, half = bw/2;
    line(OR); doc.setLineWidth(0.9); doc.roundedRect(M, y, bw, bh, 5, 5, 'S');
    doc.setLineWidth(0.7);
    doc.line(M+half, y, M+half, y+bh);
    doc.line(M, y+bh/2, M+bw, y+bh/2);

    function campo(lbl, val, x, yTop, maxW){
      doc.setFont('helvetica','bold'); doc.setFontSize(7.5); txt(OR);
      doc.text(lbl, x, yTop);
      var s = 11.5, t = String(val==null || val==='' ? '—' : val);
      doc.setFont('helvetica','bold'); txt(BK); doc.setFontSize(s);
      while(s > 7 && doc.getTextWidth(t) > maxW){ s -= 0.5; doc.setFontSize(s); }
      if(doc.getTextWidth(t) > maxW){
        while(t.length > 1 && doc.getTextWidth(t+'…') > maxW) t = t.slice(0,-1);
        t += '…';
      }
      doc.text(t, x, yTop+14);
    }
    campo('FECHA',      fmtDate(oc.fecha), M+11,        y+12,      half-22);
    campo('N° ORDEN',   oc.numero,         M+half+11,   y+12,      half-22);
    campo('PROVEEDOR',  oc.proveedor,      M+11,        y+bh/2+12, half-22);
    campo('CONDICIÓN',  oc.condicion,      M+half+11,   y+bh/2+12, half-22);
    y += bh + 13;

    // ══ Un bloque por grupo de articulos ══════════════════════
    var grupos = oc.grupos || [];
    var total = 0;
    grupos.forEach(function(g){
      var lines = g.lines || [];
      var kgG = lines.reduce(function(s,l){ return s + (parseFloat(l.cant)||0); }, 0);
      total += kgG;

      // El encabezado no se manda solo al pie de una pagina: se pide
      // sitio para el titulo mas la cabecera de la tabla y dos filas.
      y = sitio(y, 70);
      fill(SUAVE); line(OR); doc.setLineWidth(0.8);
      doc.roundedRect(M, y, W-2*M, 19, 4, 4, 'FD');
      doc.setFont('helvetica','bold'); doc.setFontSize(9.5); txt(OR);
      doc.text(String(g.titulo||'').toUpperCase(), M+11, y+13);
      doc.setFontSize(9);
      doc.text('Subtotal  ' + fmtKg(kgG) + ' kg', W-M-11, y+13, {align:'right'});
      y += 19;

      doc.autoTable({
        startY: y,
        head: [['ÍTEM','DESCRIPCIÓN','CÓD.','CANTIDAD (kg)']],
        body: lines.map(function(l,i){
          return [String(i+1), String(l.desc||''), String(l.cod||'—'), fmtKg(l.cant)];
        }),
        theme: 'grid',
        margin: {left:M, right:M, top:M+10, bottom:PIE},
        styles: {fontSize:8.5, cellPadding:2.8, valign:'middle',
                 lineColor:LINEA, lineWidth:0.5, textColor:BK},
        headStyles: {fillColor:[38,38,38], textColor:255, fontStyle:'bold',
                     fontSize:8.5, cellPadding:5, halign:'center'},
        alternateRowStyles: {fillColor:CEBRA},
        columnStyles: {0:{cellWidth:34, halign:'center', textColor:GRIS},
                       1:{halign:'left', fontStyle:'bold'},
                       2:{cellWidth:58, halign:'center'},
                       3:{cellWidth:82, halign:'right'}}
      });
      y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : y) + 9;
    });

    // ══ Total general ═════════════════════════════════════════
    // Se suma de las lineas que de verdad se imprimieron. La planilla de
    // la que salio este modulo tenia el SUM corto y se pedia de menos:
    // el numero del papel no puede volver a escribirse a mano.
    y = sitio(y, 34);
    var tw = 240, tx = W - M - tw;
    fill(OR); doc.roundedRect(tx, y, tw, 30, 5, 5, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(10.5); txt([255,255,255]);
    doc.text('TOTAL GENERAL', tx+14, y+19.5);
    doc.setFontSize(13);
    doc.text(fmtKg(total) + ' kg', tx+tw-14, y+19.5, {align:'right'});
    y += 30 + 10;

    // ══ Firmas ════════════════════════════════════════════════
    y = sitio(y, 50);
    var mitad = (W - 2*M - 18)/2;
    firma(doc, M,            y, mitad, 'AUTORIZADO POR');
    firma(doc, M+mitad+18,   y, mitad, 'RECIBIDO POR');

    // ══ Pie, en todas las paginas ═════════════════════════════
    // Se dibuja al final y no en didDrawPage para poder poner
    // "Pagina 1 de 2": cuando se dibuja la primera todavia no se sabe
    // cuantas van a ser.
    var n = doc.internal.getNumberOfPages();
    var izq = EMPRESA.nombre + ' · ' + EMPRESA.ruc
            + (oc.corrida ? '  ·  Corrida: ' + oc.corrida : '')
            + '  ·  Generado el ' + new Date().toLocaleString('es-UY');
    for(var i=1; i<=n; i++){
      doc.setPage(i);
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); txt([155,155,155]);
      doc.text(izq, M, H-18);
      doc.text('Página ' + i + ' de ' + n, W-M, H-18, {align:'right'});
    }

    doc.save((oc.numero || 'ORDEN-DE-COMPRA') + '.pdf');
  }

  // Recuadro de firma: la linea y las dos etiquetas de abajo.
  function firma(doc, x, y, w, titulo){
    var h = 50;
    doc.setDrawColor(OR[0],OR[1],OR[2]); doc.setLineWidth(0.9);
    doc.roundedRect(x, y, w, h, 5, 5, 'S');
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(OR[0],OR[1],OR[2]);
    doc.text(titulo, x+w/2, y+14, {align:'center'});
    doc.setDrawColor(120,120,120); doc.setLineWidth(0.6);
    doc.line(x+18, y+31, x+w-18, y+31);
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(120,120,120);
    doc.text('Firma', x+18, y+42);
    doc.text('Aclaración y fecha', x+w-18, y+42, {align:'right'});
  }

  // El logo real si cargo; si no, un sello naranja con el nombre, que es
  // mejor que un hueco blanco en un papel que sale para afuera.
  function dibujarLogo(doc, x, y, w, h){
    if(LOGO){
      try{ doc.addImage(LOGO, 'JPEG', x, y, w, h); return; }catch(e){}
    }
    doc.setFillColor(OR[0],OR[1],OR[2]);
    doc.roundedRect(x, y, w, h, 6, 6, 'F');
    doc.setFont('helvetica','bolditalic'); doc.setTextColor(255,255,255);
    doc.setFontSize(h*0.24);
    doc.text('subatir', x+w/2, y+h*0.58, {align:'center'});
    doc.setFont('helvetica','bold'); doc.setFontSize(h*0.12);
    doc.text('D R O G U E R Í A', x+w/2, y+h*0.78, {align:'center'});
  }

  // Para que la pantalla pueda avisar antes en vez de reventar al clic.
  function disponible(){ return !!(window.jspdf && window.jspdf.jsPDF); }

  return { build: build, disponible: disponible };
})();
