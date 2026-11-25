// ══════════════════════════════════════════════════════════════
//  MP-OC-PDF — la Orden de Compra de importacion, en un solo lugar
//
//  NO es el mismo papel que oc-pdf.js y por eso no lo reusa:
//   · La OC de plaza lleva precios, IVA y totales en pesos o dolares.
//     Esta no lleva NINGUN precio: MP Importacion no los tiene y el
//     papel que se le manda a MERO AR sale solo con cantidades: kg las
//     esencias y unidades el resto (frascos, tirillas), cada linea con
//     su unidad (l.unidad 'kg'|'un'; sin unidad se toma kg).
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

    var y = membrete(doc, M, 'ORDEN DE COMPRA');

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
    // kg y unidades no se suman entre si: cada uno lleva su cuenta
    var grupos = oc.grupos || [];
    var total = {kg:0, un:0};
    function esUn(l){ return l.unidad === 'un'; }
    function sumar(lines){
      var t = {kg:0, un:0};
      lines.forEach(function(l){ t[esUn(l) ? 'un' : 'kg'] += (parseFloat(l.cant)||0); });
      return t;
    }
    function cantTxt(t){
      var p = [];
      if(t.kg || !t.un) p.push(fmtKg(t.kg) + ' kg');
      if(t.un) p.push(fmtKg(t.un) + ' un');
      return p.join(' + ');
    }
    grupos.forEach(function(g){
      var lines = g.lines || [];
      var sg = sumar(lines);
      total.kg += sg.kg; total.un += sg.un;

      // El encabezado no se manda solo al pie de una pagina: se pide
      // sitio para el titulo mas la cabecera de la tabla y dos filas.
      y = sitio(y, 70);
      fill(SUAVE); line(OR); doc.setLineWidth(0.8);
      doc.roundedRect(M, y, W-2*M, 19, 4, 4, 'FD');
      doc.setFont('helvetica','bold'); doc.setFontSize(9.5); txt(OR);
      doc.text(String(g.titulo||'').toUpperCase(), M+11, y+13);
      doc.setFontSize(9);
      doc.text('Subtotal  ' + cantTxt(sg), W-M-11, y+13, {align:'right'});
      y += 19;

      doc.autoTable({
        startY: y,
        head: [['ÍTEM','DESCRIPCIÓN','CÓD.','CANTIDAD']],
        body: lines.map(function(l,i){
          return [String(i+1), String(l.desc||''), String(l.cod||'—'), fmtKg(l.cant) + (esUn(l) ? ' un' : ' kg')];
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
    var tw = total.un ? 300 : 240, tx = W - M - tw;
    fill(OR); doc.roundedRect(tx, y, tw, 30, 5, 5, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(10.5); txt([255,255,255]);
    doc.text('TOTAL GENERAL', tx+14, y+19.5);
    var totTxt = cantTxt(total);
    doc.setFontSize(13);
    while(doc.getFontSize() > 8 && doc.getTextWidth(totTxt) > tw-128) doc.setFontSize(doc.getFontSize()-0.5);
    doc.text(totTxt, tx+tw-14, y+19.5, {align:'right'});
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

  // ══ Membrete + banda de titulo ════════════════════════════
  // Compartido por la OC y la Proforma: los dos papeles salen con la
  // misma cabecera. Devuelve la y donde sigue el contenido.
  function membrete(doc, M, titulo, sub){
    var W = doc.internal.pageSize.getWidth();
    var logoH = 54, logoW = logoH * LOGO_AR;
    dibujarLogo(doc, M, 30, logoW, logoH);

    doc.setFont('helvetica','bold'); doc.setFontSize(19); doc.setTextColor(BK[0],BK[1],BK[2]);
    doc.text(EMPRESA.nombre, M + logoW + 14, 58);

    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(GRIS[0],GRIS[1],GRIS[2]);
    var ry = 42;
    EMPRESA.dir.forEach(function(l){ doc.text(l, W-M, ry, {align:'right'}); ry += 11.5; });
    doc.setFont('helvetica','bold'); doc.setTextColor(BK[0],BK[1],BK[2]);
    doc.text(EMPRESA.ruc, W-M, ry+4, {align:'right'});

    var y = Math.max(30 + logoH, ry + 8) + 10;
    doc.setDrawColor(OR[0],OR[1],OR[2]); doc.setLineWidth(1.6); doc.line(M, y, W-M, y);
    y += 15;

    var h = sub ? 36 : 26;
    doc.setFillColor(OR[0],OR[1],OR[2]); doc.roundedRect(M, y, W-2*M, h, 5, 5, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(255,255,255);
    doc.text(titulo, W/2, y+18, {align:'center'});
    if(sub){
      doc.setFont('helvetica','normal'); doc.setFontSize(8);
      doc.text(sub, W/2, y+30, {align:'center'});
    }
    return y + h + 11;
  }

  // ══════════════════════════════════════════════════════════════
  //  PROFORMA — costo de la OC por artículo y total
  //
  //  pf = { numero, proveedor, fechaImpo, real:bool,
  //         plazo:{desde,hasta,dias,estado}, refOrigen,
  //         calc: MPCosteo.calcular(...), conceptos: MPCosteo.CONCEPTOS }
  //
  //  Mientras sea ESTIMADO lo dice tres veces —en la banda del titulo,
  //  en un recuadro ambar arriba de la tabla y en el pie de cada hoja—
  //  porque este papel circula y alguien va a querer usar el número
  //  como definitivo.
  // ══════════════════════════════════════════════════════════════
  var AMBAR = [180,83,9], AMBAR_F = [254,243,199];
  var PET = [13,74,90], PET_F = [232,243,246];

  function fmtUsd(n, d){
    d = d == null ? 2 : d;
    return (parseFloat(n)||0).toLocaleString('es-UY', {minimumFractionDigits:d, maximumFractionDigits:d});
  }

  // Precio unitario: 2 decimales, hasta 4 si los tiene (frasco a 0,77 → 0,77)
  function fmtPrecio(n){
    return (parseFloat(n)||0).toLocaleString('es-UY', {minimumFractionDigits:2, maximumFractionDigits:4});
  }

  function proforma(pf){
    if(!window.jspdf || !window.jspdf.jsPDF){
      throw new Error('No se pudo cargar el generador de PDF (revisá tu conexión).');
    }
    var k = pf.calc;
    var doc = new window.jspdf.jsPDF({unit:'pt', format:'a4', orientation:'portrait'});
    var W = doc.internal.pageSize.getWidth();
    var H = doc.internal.pageSize.getHeight();
    var M = 30, PIE = 30;
    function txt(c){  doc.setTextColor(c[0],c[1],c[2]); }
    function fill(c){ doc.setFillColor(c[0],c[1],c[2]); }
    function line(c){ doc.setDrawColor(c[0],c[1],c[2]); }
    function sitio(y, alto){
      if(y + alto > H - PIE){ doc.addPage(); return M + 10; }
      return y;
    }

    var y = membrete(doc, M, 'PROFORMA', pf.real
      ? 'COSTOS REALES · LIQUIDACIÓN DEL DESPACHANTE'
      : 'COSTOS ESTIMADOS · FALTAN LOS VALORES REALES DEL DESPACHANTE');

    // ── Datos (4 en fila) ──
    var bw = W - 2*M, bh = 32, q = bw/4;
    line(OR); doc.setLineWidth(0.9); doc.roundedRect(M, y, bw, bh, 5, 5, 'S');
    doc.setLineWidth(0.7);
    [1,2,3].forEach(function(i){ doc.line(M+q*i, y, M+q*i, y+bh); });
    [['OC', pf.numero], ['FECHA IMPORTACIÓN', fmtDate(pf.fechaImpo)],
     ['PROVEEDOR · MONEDA', pf.proveedor + ' · US$'], ['ESTADO', pf.real ? 'REAL' : 'ESTIMADO']]
    .forEach(function(c, i){
      doc.setFont('helvetica','bold'); doc.setFontSize(7); txt(OR);
      doc.text(c[0], M+q*i+9, y+11);
      doc.setFontSize(10.5); txt(i===3 && !pf.real ? AMBAR : BK);
      doc.text(String(c[1]||'—'), M+q*i+9, y+25);
    });
    y += bh + 9;

    // ── Aviso de estimado ──
    if(!pf.real){
      var p = pf.plazo || {};
      var l1 = 'ESTIMADO — todavía faltan los valores reales declarados por el despachante.';
      var l2 = 'Importación del ' + fmtDate(pf.fechaImpo) + '. La liquidación se espera entre el '
             + fmtDate(p.desde) + ' y el ' + fmtDate(p.hasta) + ' (20 a 30 días)'
             + (p.estado==='vencido' ? ' — YA PASARON ' + p.dias + ' DÍAS: RECLAMAR.' : '.');
      var l3 = 'Gastos estimados sobre ' + (pf.refOrigen||'la referencia') + ' (incidencia '
             + fmtUsd(k.inc*100) + '% s/FCA). No usar como costo definitivo.';
      fill(AMBAR_F); line(AMBAR); doc.setLineWidth(0.9);
      doc.roundedRect(M, y, bw, 44, 5, 5, 'FD');
      doc.setFont('helvetica','bold'); doc.setFontSize(9); txt(AMBAR);
      doc.text(l1, M+10, y+13);
      doc.setFont('helvetica','normal'); doc.setFontSize(7.8);
      doc.text(l2, M+10, y+25);
      doc.text(doc.splitTextToSize(l3, bw-20)[0], M+10, y+36);
      y += 44 + 6;
    }

    // ── Una tabla por grupo ──
    k.grupos.forEach(function(g){
      y = sitio(y, 70);
      fill(SUAVE); line(OR); doc.setLineWidth(0.8);
      doc.roundedRect(M, y, bw, 18, 4, 4, 'FD');
      doc.setFont('helvetica','bold'); doc.setFontSize(9); txt(OR);
      doc.text(String(g.titulo).toUpperCase(), M+10, y+12.5);
      doc.text('FCA US$ ' + fmtUsd(g.fca) + '  ·  Costo ' + (pf.real?'real':'est.') + ' US$ ' + fmtUsd(g.costo),
               W-M-10, y+12.5, {align:'right'});
      y += 18;
      doc.autoTable({
        startY: y,
        head: [['ÍTEM','DESCRIPCIÓN','CÓD.','CANT.','P. UNIT. FCA','IMPORTE FCA',
                'COSTO UNIT.' + (pf.real?'':' EST.'), 'COSTO TOTAL' + (pf.real?'':' EST.')]],
        body: g.lineas.map(function(l, i){
          return [String(i+1), l.desc, l.cod || '—', fmtKg(l.cant) + ' ' + l.unidad,
                  l.sinPrecio ? 'SIN PRECIO' : fmtPrecio(l.precio), fmtUsd(l.importe),
                  fmtUsd(l.costoUnit, l.costoUnit < 1 ? 4 : 2), fmtUsd(l.costoTotal)];
        }),
        theme: 'grid',
        margin: {left:M, right:M, top:M+10, bottom:PIE},
        styles: {fontSize:7.6, cellPadding:1.9, valign:'middle', lineColor:LINEA, lineWidth:0.5, textColor:BK},
        headStyles: {fillColor:[38,38,38], textColor:255, fontStyle:'bold', fontSize:7, cellPadding:4, halign:'center'},
        alternateRowStyles: {fillColor:CEBRA},
        columnStyles: {0:{cellWidth:26, halign:'center', textColor:GRIS},
                       1:{halign:'left', fontStyle:'bold'},
                       2:{cellWidth:44, halign:'center', textColor:GRIS},
                       3:{cellWidth:52, halign:'right'},
                       4:{cellWidth:56, halign:'right'},
                       5:{cellWidth:62, halign:'right'},
                       6:{cellWidth:58, halign:'right', fillColor:PET_F},
                       7:{cellWidth:66, halign:'right', fillColor:PET_F, fontStyle:'bold'}},
        didParseCell: function(d){
          if(d.section==='head' && d.column.index>=6) d.cell.styles.fillColor = PET;
          if(d.section==='body' && d.column.index===4 && d.cell.raw==='SIN PRECIO'){
            d.cell.styles.textColor = [200,30,30]; d.cell.styles.fontStyle = 'bold';
          }
        }
      });
      y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : y) + 8;
    });

    // ── Gastos (izq) y totales (der) ──
    var nC = pf.conceptos.length;
    var altoG = 18 + (nC+1)*12 + 6;
    y = sitio(y, Math.max(altoG, 5*19 + 23) + 4);
    var gw = bw*0.52, tx = M + gw + 10, tw = bw - gw - 10;

    line(OR); doc.setLineWidth(0.8); fill(SUAVE);
    doc.roundedRect(M, y, gw, 18, 4, 4, 'FD');
    doc.setFont('helvetica','bold'); doc.setFontSize(8.5); txt(OR);
    doc.text('GASTOS DE IMPORTACIÓN ' + (pf.real?'REALES':'ESTIMADOS') + ' (US$)', M+9, y+12.5);
    var gy = y + 18 + 11;
    pf.conceptos.forEach(function(c){
      doc.setFont('helvetica','normal'); doc.setFontSize(8); txt(BK);
      doc.text(c.t, M+9, gy);
      doc.text(fmtUsd(k.gastos[c.k]), M+gw-9, gy, {align:'right'});
      line(LINEA); doc.setLineWidth(0.4); doc.line(M+6, gy+3.5, M+gw-6, gy+3.5);
      gy += 12;
    });
    doc.setFont('helvetica','bold'); txt(BK);
    doc.text('Total · incidencia ' + fmtUsd(k.inc*100) + '% s/FCA', M+9, gy+1);
    doc.text(fmtUsd(k.totGastos), M+gw-9, gy+1, {align:'right'});
    line(OR); doc.setLineWidth(0.8);
    doc.roundedRect(M, y, gw, gy + 7 - y, 4, 4, 'S');

    var filas = [
      ['VALOR FCA', k.fca, 'n'], ['VALOR CIF' + (pf.real?'':' ESTIMADO'), k.cif, 'n'],
      ['+ GASTOS DE IMPORTACIÓN', k.totGastos, 'n'],
      ['COSTO TOTAL' + (pf.real?' REAL':' ESTIMADO'), k.costo, 'big'],
      ['IVA IMPORT. 22% + ANTICIPO 10% (crédito)', k.ivaImp + k.ivaAnt, 'pet'],
      ['DESEMBOLSO TOTAL' + (pf.real?'':' ESTIMADO'), k.desembolso, 'n']
    ];
    var ty = y;
    filas.forEach(function(f){
      var h = f[2]==='big' ? 22 : 16;
      if(f[2]==='big'){ fill(OR); doc.roundedRect(tx, ty, tw, h, 4, 4, 'F'); }
      else if(f[2]==='pet'){ fill(PET); doc.roundedRect(tx, ty, tw, h, 4, 4, 'F'); }
      else { line(OR); doc.setLineWidth(0.8); doc.roundedRect(tx, ty, tw, h, 4, 4, 'S'); }
      var claro = f[2]!=='n';
      doc.setFont('helvetica','bold'); doc.setFontSize(7); txt(claro ? [255,255,255] : OR);
      doc.text(f[0], tx+8, ty + h/2 + 2.5);
      doc.setFontSize(f[2]==='big' ? 13 : 9.5); txt(claro ? [255,255,255] : BK);
      doc.text('US$ ' + fmtUsd(f[1]), tx+tw-8, ty + h/2 + 3.5, {align:'right'});
      ty += h + 3;
    });
    y = Math.max(gy + 7, ty) + 8;

    // ── Nota ──
    var kg = 0, un = 0;
    k.lineas.forEach(function(l){ if(l.unidad==='kg') kg += l.cant; else un += l.cant; });
    var nota = [
      'Cantidades: ' + fmtKg(kg) + ' kg' + (un ? ' · ' + fmtKg(un) + ' un' : '') + '.  Precios FCA de la orden en US$.',
      pf.real
        ? 'Gastos según liquidación del despachante. Costo unitario = precio FCA × ' + fmtUsd(1+k.inc, 4) + '.'
        : 'Gastos estimados sobre ' + (pf.refOrigen||'la referencia') + ', escalados por valor FCA. Costo unitario estimado = precio FCA × '
          + fmtUsd(1+k.inc, 4) + '. Se reemplaza al cargar la liquidación real.',
      'El costo no incluye IVA de importación ni anticipo de IVA (crédito fiscal).'
    ];
    if(k.sinPrecio.length) nota.push('ATENCIÓN: ' + k.sinPrecio.length + ' artículo(s) sin precio — el total está incompleto.');
    y = sitio(y, nota.length*10 + 4);
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); txt(GRIS);
    nota.forEach(function(s){
      doc.splitTextToSize(s, bw).forEach(function(t){ doc.text(t, M, y); y += 9.5; });
    });

    // ── Pie ──
    var n = doc.internal.getNumberOfPages();
    var izq = EMPRESA.nombre + ' · Proforma de ' + pf.numero
            + (pf.real ? ' · COSTOS REALES' : ' · ESTIMADO, sujeto a la liquidación del despachante')
            + ' · Generado el ' + new Date().toLocaleString('es-UY');
    for(var i=1; i<=n; i++){
      doc.setPage(i);
      doc.setFont('helvetica', pf.real ? 'normal' : 'bold'); doc.setFontSize(7.2);
      txt(pf.real ? [155,155,155] : AMBAR);
      doc.text(izq, M, H-18);
      doc.setFont('helvetica','normal'); txt([155,155,155]);
      doc.text('Página ' + i + ' de ' + n, W-M, H-18, {align:'right'});
    }
    doc.save('Proforma-' + String(pf.numero||'OC').replace(/^OC-/,'') + (pf.real?'':'-ESTIMADA') + '.pdf');
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

  return { build: build, proforma: proforma, disponible: disponible };
})();
