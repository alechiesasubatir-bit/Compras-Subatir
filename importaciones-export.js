// ══════════════════════════════════════════════════════════════
//  IMPORTACIONES · reporte en PDF y Excel
//
//  Lo usan las dos pantallas del módulo: mp-importacion.html (MERO AR)
//  e importaciones.html?linea=… (Subatir, Mopas y, cuando se
//  habiliten, Intex y Enjoy). Antes "Imprimir" era window.print() y
//  salía la página entera, con botones, inputs y fondo oscuro.
//
//  Este archivo NO sabe nada de ninguna línea: cada pantalla arma el
//  reporte con sus columnas, sus filas ya calculadas y sus KPIs, y acá
//  sólo se dibuja. Así una línea nueva no toca este archivo, y la
//  cuenta sigue viviendo en un solo lugar (la pantalla), no copiada.
//
//  Uso:
//    var r = {
//      linea:'Subatir · Consumo',            // va debajo del título
//      corrida:'Importación 1 · 2027', fecha:'2026-10-13', estado:'Abierta',
//      kpis:[{l:'A importar', v:'12.400 u', s:'310 cajas'}],
//      nota:'Proyectado/mes = …',            // la fórmula, en texto plano
//      filtro:'Estado: Hay que pedir',       // '' si no hay filtro
//      cols:[{t:'Artículo', tipo:'txt', w:34}, {t:'Stock', tipo:'n0'}, …],
//      //   tipo: txt | n0 (entero) | n1 (1 decimal) | c (centrado) | est (estado)
//      //   w = ancho en Excel; pdf:false = sólo va al Excel
//      filas:[{grupo:'Esencias'},
//             {v:['Art', 120, …], est:[r,g,b], apagada:false}],
//      total:['TOTAL', null, 1234, …],      // alineado con cols
//      archivo:'Importacion_Subatir_Corrida_1'   // sin extensión
//    };
//    ImpExport.pdf(r)   → Promise (carga jsPDF la primera vez)
//    ImpExport.xlsx(r)
// ══════════════════════════════════════════════════════════════
window.ImpExport = (function(){
  'use strict';

  var OR=[242,101,34], BK=[20,20,20], GR=[120,120,120], TEAL=[14,138,170];

  // Helvetica del PDF es WinAnsi: el signo menos tipográfico, las
  // comillas angulares raras o un emoji salen como basura. Se pasan a
  // su equivalente ASCII antes de escribir.
  function pdfTxt(s){
    return String(s==null?'':s).replace(/[−–]/g,'-').replace(/[“”]/g,'"')
      .replace(/[^\u0000-ÿ·…]/g,'').replace(/\s+/g,' ').trim();
  }
  function fmt(v, tipo){
    if(v==null || v==='') return '';
    if(typeof v!=='number') return String(v);
    var d = tipo==='n1' ? 1 : 0;
    return v.toLocaleString('es-UY',{minimumFractionDigits:d, maximumFractionDigits:d});
  }
  function fmtFecha(iso){
    var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||''));
    return m ? m[3]+'/'+m[2]+'/'+m[1] : (iso||'—');
  }
  function ahora(){ return new Date().toLocaleString('es-UY'); }

  // ── jsPDF on-demand ────────────────────────────────────────
  //  Pesa ~400 KB y sólo hace falta al exportar: no se le cobra a
  //  quien entra a mirar. Mismo criterio que Previsión Cloro.
  var LIB=null;
  function cargarPDF(){
    if(window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable) return Promise.resolve();
    if(LIB) return LIB;
    function uno(src){
      return new Promise(function(ok, mal){
        var s=document.createElement('script'); s.src=src;
        s.onload=function(){ ok(); };
        s.onerror=function(){ mal(new Error('No se pudo cargar el generador de PDF (revisá tu conexión)')); };
        document.head.appendChild(s);
      });
    }
    LIB = (window.jspdf && window.jspdf.jsPDF ? Promise.resolve()
          : uno('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'))
      .then(function(){ return window.jspdf.jsPDF.API.autoTable ? null
          : uno('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'); })
      .catch(function(e){ LIB=null; throw e; });
    return LIB;
  }
  function logo(){ return window.SubatirApp && SubatirApp.logoCirc ? SubatirApp.logoCirc() : null; }

  // ══ PDF ════════════════════════════════════════════════════
  function pdf(r){
    return cargarPDF().then(function(){ dibujarPDF(r); });
  }
  function dibujarPDF(r){
    var doc = new window.jspdf.jsPDF({unit:'pt', format:'a4', orientation:'landscape'});
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 30;
    var cols = r.cols.filter(function(c){ return c.pdf!==false; });
    var idx = r.cols.map(function(c,i){ return c.pdf!==false ? i : -1; }).filter(function(i){ return i>=0; });

    // ── Encabezado: logo, empresa, título y la línea ───────────
    var lg = logo();
    if(lg){ try{ doc.addImage(lg, 'PNG', M, 22, 54, 54); }catch(e){ lg=null; } }
    var tx = lg ? M+66 : M;
    doc.setFont('helvetica','bold'); doc.setFontSize(19); doc.setTextColor(BK[0],BK[1],BK[2]);
    doc.text('SUBATIR S.A.', tx, 42);
    doc.setTextColor(OR[0],OR[1],OR[2]); doc.setFontSize(14);
    doc.text('PREVISIÓN DE IMPORTACIÓN', tx, 61);
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(GR[0],GR[1],GR[2]);
    doc.text(pdfTxt('Importaciones · '+r.linea), tx, 75);

    // Recuadro con la corrida, a la derecha
    var bw=250, bx=W-M-bw, by=20, bh=60, midX=bx+bw/2, midY=by+bh/2;
    doc.setDrawColor(OR[0],OR[1],OR[2]); doc.setLineWidth(1); doc.roundedRect(bx,by,bw,bh,5,5,'S');
    doc.setLineWidth(0.6); doc.line(midX,by+bh/2,midX,by+bh); doc.line(bx,midY,bx+bw,midY);
    function lbl(t,x,y){ doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(OR[0],OR[1],OR[2]); doc.text(t,x,y); }
    function val(t,x,y,max){ doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(BK[0],BK[1],BK[2]);
      var s=pdfTxt(t||'—'); while(max && s.length>3 && doc.getTextWidth(s)>max) s=s.slice(0,-2)+'…'; doc.text(s,x,y); }
    lbl('CORRIDA', bx+8, by+11);   val(r.corrida, bx+8, by+25, bw-16);
    lbl('FECHA', bx+8, midY+11);   val(fmtFecha(r.fecha), bx+8, midY+25);
    lbl('ESTADO', midX+8, midY+11); val(r.estado, midX+8, midY+25);

    var y = by+bh+16;
    doc.setDrawColor(OR[0],OR[1],OR[2]); doc.setLineWidth(1.2); doc.line(M, y-6, W-M, y-6);

    // ── KPIs: una franja de recuadros, como en la pantalla ─────
    var ks = r.kpis||[];
    if(ks.length){
      var gap=8, kw=(W-2*M-gap*(ks.length-1))/ks.length, kh=44;
      ks.forEach(function(k,i){
        var x=M+i*(kw+gap);
        doc.setFillColor(250,247,244); doc.setDrawColor(230,222,214); doc.setLineWidth(0.6);
        doc.roundedRect(x, y, kw, kh, 4, 4, 'FD');
        doc.setFillColor(OR[0],OR[1],OR[2]); doc.rect(x, y+4, 2.2, kh-8, 'F');
        doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(GR[0],GR[1],GR[2]);
        doc.text(pdfTxt(k.l).toUpperCase(), x+9, y+12);
        doc.setFontSize(13); doc.setTextColor(BK[0],BK[1],BK[2]);
        doc.text(pdfTxt(k.v), x+9, y+28);
        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(GR[0],GR[1],GR[2]);
        var s=pdfTxt(k.s); while(s.length>3 && doc.getTextWidth(s)>kw-14) s=s.slice(0,-2)+'…';
        doc.text(s, x+9, y+38);
      });
      y += kh+10;
    }
    if(r.filtro){
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(TEAL[0],TEAL[1],TEAL[2]);
      doc.text(pdfTxt('Filtro aplicado: '+r.filtro), M, y+4); y += 12;
    }

    // ── Tabla ──────────────────────────────────────────────────
    var body=[], meta=[];
    (r.filas||[]).forEach(function(f){
      if(f.grupo!=null){
        body.push([{content:pdfTxt(f.grupo).toUpperCase(), colSpan:cols.length}]);
        meta.push({grupo:true}); return;
      }
      body.push(idx.map(function(i){ return pdfTxt(fmt(f.v[i], r.cols[i].tipo)); }));
      meta.push(f);
    });
    var foot = r.total ? [idx.map(function(i){ return pdfTxt(fmt(r.total[i], r.cols[i].tipo)); })] : null;

    var colStyles={};
    cols.forEach(function(c,j){
      var st={};
      if(c.tipo==='txt'){ st.halign='left'; }
      else if(c.tipo==='c' || c.tipo==='est'){ st.halign='center'; }
      else { st.halign='right'; }
      if(c.pw) st.cellWidth=c.pw;
      if(c.fuerte) st.fontStyle='bold';
      colStyles[j]=st;
    });

    doc.autoTable({
      startY: y+2, head:[cols.map(function(c){ return pdfTxt(c.t); })], body:body, foot:foot||undefined,
      showFoot:'lastPage', showHead:'everyPage', theme:'grid',
      margin:{left:M, right:M, top:34, bottom:36},
      styles:{fontSize:7.6, cellPadding:{top:3.6,bottom:3.6,left:3.5,right:3.5}, valign:'middle',
              lineColor:[226,226,226], lineWidth:0.5, textColor:BK, overflow:'linebreak'},
      headStyles:{fillColor:OR, textColor:255, fontStyle:'bold', fontSize:7, halign:'center', lineColor:OR},
      footStyles:{fillColor:[245,241,236], textColor:BK, fontStyle:'bold', fontSize:8},
      alternateRowStyles:{fillColor:[252,250,248]},
      columnStyles:colStyles,
      didParseCell:function(d){
        if(d.section==='foot'){ d.cell.styles.halign = colStyles[d.column.index].halign; return; }
        if(d.section!=='body') return;
        var m=meta[d.row.index]||{};
        if(m.grupo){
          d.cell.styles.fillColor=[238,246,249]; d.cell.styles.textColor=TEAL;
          d.cell.styles.fontStyle='bold'; d.cell.styles.halign='left'; d.cell.styles.fontSize=7.4;
          return;
        }
        if(m.apagada){ d.cell.styles.textColor=[150,150,150]; d.cell.styles.fontStyle='italic'; }
        var c=cols[d.column.index];
        if(c.tipo==='est' && m.est && !m.apagada){ d.cell.styles.textColor=m.est; d.cell.styles.fontStyle='bold'; }
        if(c.resalta && !m.apagada && d.cell.raw && d.cell.raw!=='0'){ d.cell.styles.textColor=OR; d.cell.styles.fontStyle='bold'; }
      }
    });

    // ── Cómo se calcula, debajo de la tabla ────────────────────
    var yy=(doc.lastAutoTable?doc.lastAutoTable.finalY:y)+14;
    if(r.nota){
      // El corte en renglones mide con la letra actual: se fija antes
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
      var lineas=doc.splitTextToSize(pdfTxt(r.nota), W-2*M);
      if(yy+12+lineas.length*9 > H-40){ doc.addPage(); yy=40; }
      doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(OR[0],OR[1],OR[2]);
      doc.text('CÓMO SE CALCULA', M, yy);
      doc.setFont('helvetica','normal'); doc.setTextColor(GR[0],GR[1],GR[2]);
      doc.text(lineas, M, yy+10);
    }

    // ── Pie en todas las páginas ───────────────────────────────
    var n = doc.internal.getNumberOfPages(), gen = ahora();
    for(var i=1;i<=n;i++){
      doc.setPage(i);
      doc.setDrawColor(OR[0],OR[1],OR[2]); doc.setLineWidth(0.6); doc.line(M, H-24, W-M, H-24);
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(160,160,160);
      doc.text(pdfTxt('Subatir S.A. · Importaciones · '+r.linea+' · '+r.corrida+' · generado el '+gen), M, H-13);
      doc.text('Página '+i+' de '+n, W-M, H-13, {align:'right'});
    }
    doc.save(r.archivo+'.pdf');
  }

  // ══ EXCEL ══════════════════════════════════════════════════
  //  El .xlsx sale del generador compartido de subatir-app.js (el mismo
  //  de Informes y Stock): números como números, para que se pueda
  //  sumar y filtrar, con el encabezado de la empresa arriba.
  function xlsx(r){
    if(!(window.SubatirApp && SubatirApp.xlsx)) throw new Error('No se pudo cargar el generador de Excel.');
    var filas=[];
    function fila(celdas, alto){ filas.push({celdas:celdas, alto:alto}); }
    fila([null,{v:'SUBATIR S.A. / PROLIMPIO', s:'titulo'}], 24);
    fila([null,{v:'Previsión de importación · '+r.linea, s:'subtitulo'}], 20);
    fila([null,{v:'Corrida', s:'rotulo'},{v:r.corrida+'  ·  '+fmtFecha(r.fecha)+'  ·  '+r.estado, s:'valor'}]);
    fila([null,{v:'Resumen', s:'rotulo'},{v:(r.kpis||[]).map(function(k){
      return k.l+': '+k.v+(k.s?' ('+k.s+')':''); }).join('  ·  '), s:'valor'}]);
    if(r.filtro) fila([null,{v:'Filtro', s:'rotulo'},{v:r.filtro, s:'valor'}]);
    fila([null,{v:'Generado', s:'rotulo'},{v:ahora(), s:'valor'}]);
    fila([]);
    fila(r.cols.map(function(c){ return {v:c.t, s:'th'}; }), 30);
    var desde=filas.length;
    (r.filas||[]).forEach(function(f){
      if(f.grupo!=null){ fila([{v:f.grupo, s:'negrita'}]); return; }
      fila(r.cols.map(function(c,i){
        var v=f.v[i];
        if(typeof v==='number'){
          v = c.tipo==='n1' ? Math.round(v*10)/10 : Math.round(v);
          return {v:v, s:'num'};
        }
        return {v:v==null?'':v, s:c.tipo==='txt' ? 'td' : 'centro'};
      }));
    });
    var ult=filas.length;
    if(r.total) fila(r.total.map(function(v,i){
      if(v==null || v==='') return {v:'', s:'negrita'};
      return {v: typeof v==='number' ? (r.cols[i].tipo==='n1' ? Math.round(v*10)/10 : Math.round(v)) : v, s:'negrita'};
    }));
    if(r.nota){ fila([]); fila([null,{v:'Cómo se calcula', s:'rotulo'},{v:r.nota, s:'pie'}]); }

    var ultCol=SubatirApp.xlsx.colName(r.cols.length-1);
    var lg=logo();
    var blob=SubatirApp.xlsx.build({
      hoja:String(r.linea).replace(/[\\\/\?\*\[\]:]/g,' ').slice(0,31), apaisado:true,
      congelar:'A'+(desde+1), filtro:'A'+desde+':'+ultCol+ult,
      cols:r.cols.map(function(c){ return {w:c.w || (c.tipo==='txt' ? 30 : 11)}; }),
      imagen: lg ? {dataUrl:lg, ancho:80, alto:80} : null,
      filas:filas
    });
    SubatirApp.xlsx.save(blob, r.archivo+'.xlsx');
  }

  return { pdf:pdf, xlsx:xlsx };
})();
