// ══════════════════════════════════════════════════════════════
//  COMPRAS-PDF — listado de compras entre fechas (o las de hoy)
//
//  Mismo criterio que oc-pdf.js: el papel no sabe de donde salen las
//  lineas. Pedidos arma el objeto (moneda, estado de recepcion, codigo)
//  con sus propias funciones y aca solo se dibuja. Asi el numero que se
//  ve en la tabla y el del PDF salen de la misma cuenta.
//
//  Uso:
//    ComprasPdf.build({
//      desde:'2026-11-09', hasta:'2026-11-09',
//      lines:[{orden, fecha, proveedor, codigo, desc, cant, moneda:'U$S'|'$',
//              prec, siva, civa, estado:'COMPLETA'|'PARCIAL'|'PENDIENTE',
//              recibido, frec}]
//    });
//
//  Las monedas NUNCA se suman entre si: un total por moneda.
//  Requiere jspdf y jspdf-autotable ya cargados en la pagina.
// ══════════════════════════════════════════════════════════════
window.ComprasPdf = (function(){
  'use strict';

  var PET=[11,59,74], PET2=[15,85,104], OR=[240,124,30], INK=[20,33,43],
      MUT=[93,107,117], LINE=[219,227,232], SOFT=[243,247,249],
      OK=[29,122,69], WARN=[181,84,16], AMB=[161,110,0];

  function fmtNum(n,dec){ dec=dec||0; n=parseFloat(n)||0; return n.toLocaleString('es-UY',{minimumFractionDigits:dec,maximumFractionDigits:dec}); }
  function decCargados(n){
    var s=String(n); if(/e/i.test(s)) return 6;
    var i=s.indexOf('.'); return i<0 ? 0 : Math.min(s.length-i-1, 6);
  }
  // Precio tal cual se cargo (0,012 sigue siendo 0,012), minimo 2 decimales
  function fmtPrec(n){ n=parseFloat(n)||0; var d=Math.max(2,decCargados(n)); return n.toLocaleString('es-UY',{minimumFractionDigits:d,maximumFractionDigits:d}); }
  function fmtDate(d){
    if(!d||d==='0000-00-00') return '';
    var p=String(d).slice(0,10).split('-');
    return p.length===3 ? p[2]+'/'+p[1]+'/'+p[0] : String(d);
  }
  function corto(d){ var f=fmtDate(d); return f ? f.slice(0,5) : ''; }
  function numOC(o){ var n=parseFloat(String(o).replace(/[^\d.]/g,'')); return isNaN(n) ? 0 : n; }

  function estadoTxt(l){
    if(l.estado==='COMPLETA') return l.frec ? 'Recibido '+corto(l.frec) : 'Recibido';
    if(l.estado==='PARCIAL')  return 'Parcial '+fmtNum(l.recibido)+'/'+fmtNum(l.cant);
    return 'Pendiente';
  }

  function build(o){
    if(!window.jspdf || !window.jspdf.jsPDF) throw new Error('No se pudo cargar el generador de PDF (revisá tu conexión).');
    var lines=(o.lines||[]).slice();
    if(!lines.length) throw new Error('No hay compras entre esas fechas.');

    // Fecha y despues numero de OC, como se emitieron
    lines.sort(function(a,b){
      var f=String(a.fecha||'').localeCompare(String(b.fecha||''));
      return f || (numOC(a.orden)-numOC(b.orden)) || String(a.orden).localeCompare(String(b.orden));
    });

    var unDia = o.desde===o.hasta;
    var titulo = unDia ? 'Compras del día · '+fmtDate(o.desde)
                       : 'Compras del '+fmtDate(o.desde)+' al '+fmtDate(o.hasta);

    // ── Agregados ──
    var ocs={}, provs={}, tot={'$':{s:0,c:0,oc:{}}, 'U$S':{s:0,c:0,oc:{}}};
    lines.forEach(function(l){
      var k=String(l.orden);
      var g=ocs[k]||(ocs[k]={n:0,comp:0,parc:0});
      g.n++; if(l.estado==='COMPLETA') g.comp++; else if(l.estado==='PARCIAL') g.parc++;
      provs[String(l.proveedor||'').trim().toUpperCase()]=1;
      var t=tot[l.moneda==='$'?'$':'U$S'];
      t.s+=parseFloat(l.siva)||0; t.c+=parseFloat(l.civa)||0; t.oc[k]=1;
    });
    var nOC=Object.keys(ocs).length, nProv=Object.keys(provs).length;
    var ocComp=0, ocParc=0;
    Object.keys(ocs).forEach(function(k){ var g=ocs[k]; if(g.comp===g.n) ocComp++; else if(g.comp||g.parc) ocParc++; });
    var nums=Object.keys(ocs).map(numOC).filter(Boolean);
    var rango = nums.length ? 'OC '+Math.min.apply(null,nums)+(nums.length>1?' a '+Math.max.apply(null,nums):'') : '';

    var doc=new window.jspdf.jsPDF({unit:'pt', format:'a4', orientation:'landscape'});
    var W=doc.internal.pageSize.getWidth(), H=doc.internal.pageSize.getHeight(), M=30;

    // ── Encabezado ──
    var hy=24, hh=58;
    doc.setFillColor(PET[0],PET[1],PET[2]); doc.roundedRect(M,hy,W-2*M,hh,7,7,'F');
    doc.setFillColor(OR[0],OR[1],OR[2]); doc.rect(M+6,hy+hh-1,W-2*M-12,2.6,'F');
    var logo = window.SubatirApp && SubatirApp.logoCirc ? SubatirApp.logoCirc() : null;
    var tx=M+18;
    if(logo){ try{ doc.addImage(logo,'PNG',M+14,hy+10,38,38); tx=M+62; }catch(e){} }
    doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.setTextColor(255,255,255);
    doc.text(titulo, tx, hy+27);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(200,215,222);
    doc.text([rango, nOC+(nOC===1?' orden':' órdenes'), lines.length+(lines.length===1?' línea':' líneas')].filter(Boolean).join('  ·  '), tx, hy+43);
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(OR[0],OR[1],OR[2]);
    doc.text('Subatir S.A.', W-M-16, hy+25, {align:'right'});
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(200,215,222);
    var ahora=new Date();
    doc.text('Sistema de Compras · emitido '+ahora.toLocaleDateString('es-UY')+' '+ahora.toLocaleTimeString('es-UY',{hour:'2-digit',minute:'2-digit'}), W-M-16, hy+40, {align:'right'});

    // ── KPIs ──
    function moneyK(m){ var t=tot[m]; return { v:(m==='$'?'$ ':'U$S ')+fmtNum(t.c,2), s:'s/IVA '+(m==='$'?'$ ':'U$S ')+fmtNum(t.s,2) }; }
    var nP=Object.keys(tot['$'].oc).length, nU=Object.keys(tot['U$S'].oc).length;
    var kp=[
      {l:'ÓRDENES EMITIDAS', v:String(nOC), s:lines.length+' líneas · '+nProv+(nProv===1?' proveedor':' proveedores'), c:PET2},
      {l:'TOTAL EN PESOS C/IVA ('+nP+' OC)', v:moneyK('$').v, s:moneyK('$').s, c:PET2},
      {l:'TOTAL EN DÓLARES C/IVA ('+nU+' OC)', v:moneyK('U$S').v, s:moneyK('U$S').s, c:PET2},
      {l:'RECEPCIÓN', v:ocComp+' / '+nOC+' completas', s:(ocParc? ocParc+' con entrega parcial · ':'')+(nOC-ocComp-ocParc)+' sin recibir', c:OR}
    ];
    var ky=hy+hh+12, kh=46, gap=10, kw=(W-2*M-gap*3)/4;
    kp.forEach(function(k,i){
      var x=M+i*(kw+gap);
      doc.setFillColor(SOFT[0],SOFT[1],SOFT[2]); doc.setDrawColor(LINE[0],LINE[1],LINE[2]); doc.setLineWidth(0.7);
      doc.roundedRect(x,ky,kw,kh,5,5,'FD');
      doc.setFillColor(k.c[0],k.c[1],k.c[2]); doc.rect(x,ky+4,2.6,kh-8,'F');
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(MUT[0],MUT[1],MUT[2]);
      doc.text(k.l, x+11, ky+12);
      doc.setFont('courier','bold'); doc.setFontSize(12.5); doc.setTextColor(INK[0],INK[1],INK[2]);
      doc.text(k.v, x+11, ky+28);
      doc.setFont('courier','normal'); doc.setFontSize(7.5); doc.setTextColor(MUT[0],MUT[1],MUT[2]);
      doc.text(k.s, x+11, ky+39);
    });

    // ── Tabla ──
    var conFecha=!unDia;
    var head=['OC'].concat(conFecha?['Fecha']:[]).concat(['Proveedor','Cant.','Artículo','Mon.','Precio un.','S/IVA','C/IVA','Estado']);
    var prev=null, primeros={};
    var body=lines.map(function(l,i){
      var k=String(l.orden)+'|'+(l.fecha||'');
      if(k!==prev){ primeros[i]=1; prev=k; }
      var art=(l.codigo?'['+l.codigo+'] ':'')+String(l.desc||'');
      return [String(l.orden)].concat(conFecha?[corto(l.fecha)]:[]).concat([
        String(l.proveedor||''), fmtNum(l.cant, (parseFloat(l.cant)%1)?2:0), art, l.moneda,
        fmtPrec(l.prec), fmtNum(l.siva,2), fmtNum(l.civa,2), estadoTxt(l)
      ]);
    });
    var off=conFecha?1:0;
    var foot=[];
    ['$','U$S'].forEach(function(m){
      var t=tot[m]; if(!Object.keys(t.oc).length) return;
      var r=[{content:'Total '+(m==='$'?'pesos':'dólares')+' · '+Object.keys(t.oc).length+' OC', colSpan:4+off}, m, '', fmtNum(t.s,2), fmtNum(t.c,2), ''];
      foot.push(r);
    });

    var cs={}; var R={halign:'right', font:'courier'};
    // Anchos fijos para todo menos Artículo, que se queda con el resto
    cs[0]={cellWidth:34, fontStyle:'bold', textColor:PET2, font:'courier'};
    if(conFecha) cs[1]={cellWidth:34, font:'courier', textColor:MUT};
    cs[1+off]={cellWidth:125};
    cs[2+off]=Object.assign({cellWidth:46},R);
    cs[3+off]={cellWidth:'auto'};
    cs[4+off]={cellWidth:30, textColor:MUT, fontSize:7.5};
    cs[5+off]=Object.assign({cellWidth:56},R);
    cs[6+off]=Object.assign({cellWidth:66},R);
    cs[7+off]=Object.assign({cellWidth:66},R);
    cs[8+off]={cellWidth:80, fontStyle:'bold', fontSize:7.5};
    var colEst=8+off;

    doc.autoTable({
      startY:ky+kh+12, head:[head], body:body, foot:foot, showFoot:'lastPage', showHead:'everyPage',
      theme:'plain', margin:{left:M,right:M,top:30,bottom:34},
      styles:{font:'helvetica', fontSize:8.2, cellPadding:{top:4,bottom:4,left:5,right:5}, textColor:INK, valign:'middle', overflow:'linebreak'},
      headStyles:{fillColor:PET, textColor:255, fontStyle:'bold', fontSize:7.5},
      footStyles:{fillColor:SOFT, textColor:INK, fontStyle:'bold', fontSize:8.5},
      alternateRowStyles:{fillColor:[250,252,253]},
      columnStyles:cs,
      didParseCell:function(d){
        if(d.section==='head' && [2+off,5+off,6+off,7+off].indexOf(d.column.index)>=0) d.cell.styles.halign='right';
        if(d.section==='foot' && d.column.index>=5+off) { d.cell.styles.halign='right'; d.cell.styles.font='courier'; }
        if(d.section!=='body') return;
        // El N° de OC solo en la primera linea de cada orden: se lee como grupo
        if(d.column.index===0 && !primeros[d.row.index]) d.cell.text=[''];
        if(d.column.index===colEst){
          var e=lines[d.row.index].estado;
          d.cell.styles.textColor = e==='COMPLETA'?OK : e==='PARCIAL'?AMB : WARN;
        }
      },
      didDrawCell:function(d){
        if(d.section==='body'){
          doc.setDrawColor(LINE[0],LINE[1],LINE[2]); doc.setLineWidth(0.5);
          doc.line(d.cell.x, d.cell.y+d.cell.height, d.cell.x+d.cell.width, d.cell.y+d.cell.height);
          // Raya un poco mas marcada donde empieza otra orden
          if(primeros[d.row.index] && d.row.index>0){
            doc.setDrawColor(185,199,207); doc.setLineWidth(0.9);
            doc.line(d.cell.x, d.cell.y, d.cell.x+d.cell.width, d.cell.y);
          }
        }
        if(d.section==='foot' && d.row.index===0){
          doc.setDrawColor(PET[0],PET[1],PET[2]); doc.setLineWidth(1.6);
          doc.line(d.cell.x, d.cell.y, d.cell.x+d.cell.width, d.cell.y);
        }
      }
    });

    // ── Pie en todas las hojas ──
    var np=doc.internal.getNumberOfPages();
    for(var p=1;p<=np;p++){
      doc.setPage(p);
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(MUT[0],MUT[1],MUT[2]);
      doc.text('Fuente: módulo Pedidos · las monedas no se suman entre sí · estado de recepción al momento de emitir', M, H-16);
      doc.text('Página '+p+' de '+np, W-M, H-16, {align:'right'});
    }

    var nombre='Compras_'+o.desde+(unDia?'':'_a_'+o.hasta)+'.pdf';
    doc.save(nombre);
    return nombre;
  }

  return { build: build };
})();
