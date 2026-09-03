// ══════════════════════════════════════════════════════════════
//  OC-PDF — el papel de la Orden de Compra, en un solo lugar
//
//  Vivia dentro de pedidos.html. Cuando Pedidos Varios tuvo que emitir
//  ordenes "identicas a las de pedidos normal", copiarlo hubiera sido
//  mas rapido — y hubiera sido tambien la forma de que dejaran de ser
//  identicas: el dia que se ajusta el papel en una pantalla, la otra se
//  queda vieja y nadie se entera. Ya paso en este proyecto con la cuenta
//  de reposicion, y por eso termino compartida.
//
//  El modulo es AUTOCONTENIDO a proposito:
//   · Trae sus propios formateadores. Son los mismos de pedidos.html,
//     copiados tal cual para que el PDF salga byte por byte igual.
//   · NO va a buscar el contacto del proveedor a una variable global de
//     la pantalla: entra dentro del objeto . El papel no tiene por
//     que saber como cada modulo indexa sus proveedores.
//   · NO llama a toast(): tira una excepcion y cada pantalla avisa como
//     sabe. Si no, el modulo tendria que conocer el sistema de avisos de
//     todas las pantallas que lo usen.
//
//  Uso:
//    OCPdf.build({
//      orden:'927' | 'V-007',
//      fecha:'2026-09-03',
//      proveedor:'Lipiner S.A.',
//      obs:'texto libre',
//      contacto:{rut, cel, tel, direccion, contacto},   // opcional
//      lines:[{desc, cant, prec, moneda:'U'|'$'}]
//    }, 'compra' | 'recepcion');
//
//  'compra'    → con costos y totales
//  'recepcion' → solo cantidades, para firmar al recibir
//
//  Requiere jspdf y jspdf-autotable ya cargados en la pagina.
// ══════════════════════════════════════════════════════════════
window.OCPdf = (function(){
  'use strict';

  // Los mismos de pedidos.html. Copiados y no importados: si algun dia
  // cambian alla, el papel NO tiene que cambiar solo.
  function fmtNum(n,dec){ dec=dec||0; n=parseFloat(n)||0; return n.toLocaleString('es-UY',{minimumFractionDigits:dec,maximumFractionDigits:dec}); }
  function decCargados(n){
    var s = String(n);
    if(s.indexOf('e') >= 0 || s.indexOf('E') >= 0) return 6;
    var i = s.indexOf('.');
    return i < 0 ? 0 : Math.min(s.length - i - 1, 6);
  }
  function fmtPrec(n){
    n = parseFloat(n) || 0;
    var d = Math.max(2, decCargados(n));
    return n.toLocaleString('es-UY',{minimumFractionDigits:d, maximumFractionDigits:d});
  }
  function fmtDate(d){
    if (!d || d==='' || d==='0000-00-00') return '—';
    var p = String(d).split('-');
    if (p.length===3 && p[0].length===4) return p[2]+'/'+p[1]+'/'+p[0];
    return d;
  }

  // oc = {orden, fecha, proveedor, obs, lines:[{desc,cant,prec,moneda('U$S'|'$')}]}
  function clipStr(s,n){ s=String(s==null?'':s); return s.length>n ? s.slice(0,n-1)+'…' : s; }

  // Precarga el logo (logo.jpg) recortado en círculo como PNG (data URL)
  var LOGO_CIRC = null;
  (function preloadLogo(){
    try{
      var img = new Image();
      img.onload = function(){
        try{
          var D = 320, c = document.createElement('canvas'); c.width = c.height = D;
          var ctx = c.getContext('2d');
          ctx.save();
          ctx.beginPath(); ctx.arc(D/2, D/2, D/2, 0, Math.PI*2); ctx.closePath(); ctx.clip();
          var s = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width-s)/2, (img.height-s)/2, s, s, 0, 0, D, D); // recorte "cover" centrado
          ctx.restore();
          LOGO_CIRC = c.toDataURL('image/png');
        }catch(e){ /* canvas tainted u otro: se usa el fallback dibujado */ }
      };
      img.src = 'logo.jpg';
    }catch(e){}
  })();

  // Dibuja el logo circular en el PDF (imagen real si cargó; si no, matraz dibujado)
  function drawDocLogo(doc, cx, cy, r){
    if(LOGO_CIRC){
      try{ doc.addImage(LOGO_CIRC, 'PNG', cx-r, cy-r, 2*r, 2*r); return; }catch(e){}
    }
    var OR=[242,101,34];
    doc.setDrawColor(OR[0],OR[1],OR[2]); doc.setLineWidth(2.4); doc.circle(cx,cy,r,'S');
    doc.setLineWidth(2);
    doc.lines([[7,0],[0,9],[12,20],[-31,0],[12,-20],[0,-9]], cx-3.5, cy-r*0.55, [1,1], 'S', true);
    doc.line(cx-6, cy-r*0.55, cx+6, cy-r*0.55);
    doc.setFont('helvetica','bolditalic'); doc.setTextColor(OR[0],OR[1],OR[2]);
    doc.setFontSize(r*0.32); doc.text('subatir', cx, cy+r*0.5, {align:'center'});
    doc.setFont('helvetica','bold'); doc.setFontSize(r*0.17);
    doc.text('D R O G U E R Í A', cx, cy+r+11, {align:'center'});
  }

  function drawSignBlock(doc, x, y, w, title){
    var OR=[242,101,34], h=72;
    doc.setDrawColor(OR[0],OR[1],OR[2]); doc.setLineWidth(1); doc.roundedRect(x,y,w,h,6,6,'S');
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(OR[0],OR[1],OR[2]);
    doc.text(title, x+w/2, y+22, {align:'center'});
    doc.setDrawColor(70,70,70); doc.setLineWidth(0.8); doc.line(x+16, y+44, x+w-16, y+44);
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(30,30,30);
    doc.text('Firma:', x+16, y+62);
    doc.text('Fecha:', x+w/2+8, y+62);
  }

  // Construye el PDF. mode: 'compra' (con costos+totales) | 'recepcion' (solo cantidades)
  function build(oc, mode){
    if(!window.jspdf || !window.jspdf.jsPDF){ throw new Error('No se pudo cargar el generador de PDF (revisá tu conexión).'); }
    var esRecep = (mode==='recepcion');
    var doc = new window.jspdf.jsPDF({unit:'pt', format:'a4', orientation:'landscape'});
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    var M = 28, OR=[242,101,34], BK=[20,20,20];

    drawDocLogo(doc, M+52, 92, 46);

    // Título
    var tx = M+120;
    doc.setFont('helvetica','bold'); doc.setTextColor(BK[0],BK[1],BK[2]); doc.setFontSize(32);
    doc.text('SUBATIR S.A.', tx, 74);
    doc.setTextColor(OR[0],OR[1],OR[2]);
    if(esRecep){ doc.setFontSize(27); doc.text('RECEPCIÓN DE', tx, 108); doc.text('MERCADERÍA', tx, 136); }
    else { doc.setFontSize(29); doc.text('ORDEN DE COMPRA', tx, 112); }

    var c = {};
    c = oc.contacto || {};

    // Caja de datos (derecha): 3 filas izq (Fecha, N° Orden, RUC) + 3 der (Proveedor, Dirección, Contacto|Celular)
    var bx=W-352, by=30, bw=W-M-bx, bh=150, bottom=by+bh;
    var leftW=120, rightX=bx+leftW, rightW=bw-leftW, splitX=rightX+rightW/2;
    var r1=by+50, r2=by+100; // divisores horizontales (filas de 50)
    doc.setDrawColor(OR[0],OR[1],OR[2]); doc.setLineWidth(1.1); doc.roundedRect(bx,by,bw,bh,7,7,'S');
    doc.setLineWidth(0.9);
    doc.line(rightX,by,rightX,bottom);                 // divisor vertical principal
    doc.line(bx,r1,rightX,r1); doc.line(bx,r2,rightX,r2);        // filas izquierda
    doc.line(rightX,r1,bx+bw,r1); doc.line(rightX,r2,bx+bw,r2);  // filas derecha
    doc.line(splitX,r2,splitX,bottom);                 // divisor Contacto|Celular

    function lbl(t,x,y){ doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(OR[0],OR[1],OR[2]); doc.text(t,x,y); }
    // Escribe el valor autoajustando el tamaño (y truncando) para que NO se salga de la celda
    function fit(t,x,y,maxW,size){
      t=String(t==null||t===''?'—':t);
      doc.setFont('helvetica','bold'); doc.setTextColor(BK[0],BK[1],BK[2]);
      var s=size||12; doc.setFontSize(s);
      while(s>7 && doc.getTextWidth(t)>maxW){ s-=0.5; doc.setFontSize(s); }
      if(doc.getTextWidth(t)>maxW){ while(t.length>1 && doc.getTextWidth(t+'…')>maxW){ t=t.slice(0,-1); } t+='…'; }
      doc.text(t,x,y);
    }
    var lw=leftW-16, hw=rightW/2-14;
    // Izquierda
    lbl('Fecha', bx+10, by+17);    fit(fmtDate(oc.fecha||'')||'—', bx+10, by+39, lw, 12);
    lbl('N° Orden', bx+10, r1+17); fit(oc.orden, bx+10, r1+40, lw, 15);
    lbl('RUC', bx+10, r2+17);      fit(c.rut||'—', bx+10, r2+39, lw, 12);
    // Derecha
    lbl('Proveedor', rightX+10, by+17); fit(oc.proveedor, rightX+10, by+40, rightW-16, 13);
    lbl('Dirección', rightX+10, r1+16);
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(BK[0],BK[1],BK[2]);
    doc.text(doc.splitTextToSize(String(c.direccion||'—'), rightW-16).slice(0,2), rightX+10, r1+32);
    lbl('Contacto vendedor', rightX+10, r2+16); fit(c.contacto||'—', rightX+10, r2+39, hw, 11);
    lbl('Celular vendedor', splitX+10, r2+16);  fit(c.cel||c.tel||'—', splitX+10, r2+39, hw, 11);

    // Tabla
    var startY = Math.max(bottom, 184) + 16, head, body, colStyles;
    if(esRecep){
      head=[['ÍTEM','DESCRIPCIÓN','CANTIDAD']];
      body=(oc.lines||[]).map(function(l,i){ return [String(i+1), String(l.desc||''), fmtNum(l.cant)]; });
      colStyles={0:{cellWidth:70}, 1:{halign:'center', fontStyle:'bold'}, 2:{cellWidth:160}};
    } else {
      head=[['ÍTEM','DESCRIPCIÓN','CANTIDAD','P. UNIT','SUBTOTAL']];
      body=(oc.lines||[]).map(function(l,i){ var sym=l.moneda==='$'?'$':'U$S'; var sub=(parseFloat(l.cant)||0)*(parseFloat(l.prec)||0); return [String(i+1), String(l.desc||''), fmtNum(l.cant), sym+' '+fmtPrec(l.prec), sym+' '+fmtNum(sub,2)]; });
      colStyles={0:{cellWidth:46}, 1:{halign:'center', fontStyle:'bold'}, 2:{cellWidth:82}, 3:{cellWidth:95}, 4:{cellWidth:108}};
    }
    doc.autoTable({
      startY:startY, head:head, body:body, theme:'grid', margin:{left:M,right:M},
      styles:{fontSize:10, cellPadding:9, halign:'center', valign:'middle', lineColor:OR, lineWidth:0.8, textColor:BK},
      headStyles:{fillColor:OR, textColor:255, fontStyle:'bold', fontSize:11, halign:'center', cellPadding:8},
      columnStyles:colStyles
    });
    var yy=(doc.lastAutoTable?doc.lastAutoTable.finalY:startY)+16;

    if(!esRecep){
      // Subtotal por moneda y el IVA abierto por tasa: una OC puede mezclar
      // artículos al 22% y al 10%, así que el total no es el subtotal x 1.22.
      var tot={'U$S':{neto:0,iva:{}}, '$':{neto:0,iva:{}}};
      (oc.lines||[]).forEach(function(l){
        var sym=l.moneda==='$'?'$':'U$S';
        var neto=(parseFloat(l.cant)||0)*(parseFloat(l.prec)||0);
        var pct=Math.round(ivaTasa(l.desc)*100);
        tot[sym].neto+=neto;
        tot[sym].iva[pct]=(tot[sym].iva[pct]||0)+neto*pct/100;
      });
      doc.setFontSize(10);
      ['U$S','$'].forEach(function(sym){
        var t=tot[sym]; if(!(t.neto>0)) return;
        doc.setFont('helvetica','normal'); doc.setTextColor(BK[0],BK[1],BK[2]);
        doc.text('Subtotal s/IVA: '+sym+' '+fmtNum(t.neto,2), W-M, yy, {align:'right'}); yy+=15;
        var totIva=0;
        Object.keys(t.iva).sort(function(a,b){ return b-a; }).forEach(function(pct){
          totIva+=t.iva[pct];
          doc.text('IVA '+pct+'%: '+sym+' '+fmtNum(t.iva[pct],2), W-M, yy, {align:'right'}); yy+=15;
        });
        doc.setFont('helvetica','bold'); doc.setTextColor(OR[0],OR[1],OR[2]);
        doc.text('TOTAL c/IVA: '+sym+' '+fmtNum(t.neto+totIva,2), W-M, yy, {align:'right'}); yy+=20;
      });
    }

    // Observaciones (caja)
    var obsLines=[];
    if(String(oc.obs||'').trim()) obsLines.push(String(oc.obs).trim());
    if(c.pago) obsLines.push('Plazo de pago: '+c.pago);
    if(!obsLines.length) obsLines.push('—');
    var obsBoxH = 22 + obsLines.length*14;
    doc.setDrawColor(OR[0],OR[1],OR[2]); doc.setLineWidth(1); doc.roundedRect(M, yy, W-2*M, obsBoxH, 6,6,'S');
    doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(OR[0],OR[1],OR[2]);
    doc.text('OBSERVACIONES:', M+12, yy+16);
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(BK[0],BK[1],BK[2]);
    doc.text(obsLines, M+12, yy+32);

    // Firmas
    var sy = yy + obsBoxH + 20; if(sy > H-92) sy = H-92;
    var half=(W-2*M-20)/2;
    drawSignBlock(doc, M, sy, half, 'RECIBÍ CONFORME');
    drawSignBlock(doc, M+half+20, sy, half, 'ENTREGÓ');

    doc.setFontSize(7.5); doc.setTextColor(160,160,160);
    doc.text('Generado el '+new Date().toLocaleString('es-UY'), M, H-14);

    doc.save((esRecep?'Recepcion':'OC')+'-'+oc.orden+'.pdf');
  }


  // Para que la pantalla pueda esconder el boton en vez de dejar que
  // explote reciendo el clic.
  function disponible(){ return !!(window.jspdf && window.jspdf.jsPDF); }

  return { build: build, disponible: disponible };
})();
