// ============================================================
//  LECTOR DE .XLSX SIN LIBRERÍAS
//
//  Un .xlsx es un ZIP de XML y el navegador ya sabe inflar
//  (DecompressionStream 'deflate-raw'), así que alcanza con leer el
//  índice del ZIP y la primera hoja. Lo usan MP Importación (MERO AR)
//  e Importaciones (artículos de Depósitos): antes vivía copiado dentro
//  de mp-importacion.html.
//
//  Las funciones quedan globales con el mismo nombre que tenían, para
//  que mp-importacion.html las siga llamando igual.
// ============================================================
function u16(dv,o){ return dv.getUint16(o,true); }
function u32(dv,o){ return dv.getUint32(o,true); }

function zipAbrir(buf){
  var dv=new DataView(buf), n=buf.byteLength;
  // El índice del ZIP está al final; se lo busca hacia atrás porque
  // puede haber un comentario de largo variable después.
  var eo=-1, lim=Math.max(0,n-66000);
  for(var i=n-22;i>=lim;i--){ if(u32(dv,i)===0x06054b50){ eo=i; break; } }
  if(eo<0) throw new Error('No parece un archivo .xlsx.');
  var cnt=u16(dv,eo+10), p=u32(dv,eo+16), idx={}, td=new TextDecoder();
  for(var k=0;k<cnt;k++){
    if(u32(dv,p)!==0x02014b50) throw new Error('El archivo está dañado (índice del ZIP).');
    var met=u16(dv,p+10), csz=u32(dv,p+20), fnl=u16(dv,p+28),
        exl=u16(dv,p+30), cml=u16(dv,p+32), lho=u32(dv,p+42);
    idx[td.decode(new Uint8Array(buf,p+46,fnl))]={met:met,csz:csz,lho:lho};
    p += 46+fnl+exl+cml;
  }
  return {buf:buf, dv:dv, idx:idx};
}
function zipTexto(z,nombre){
  var e=z.idx[nombre];
  if(!e) return Promise.resolve(null);
  var p=e.lho;
  if(u32(z.dv,p)!==0x04034b50) return Promise.reject(new Error('El archivo está dañado.'));
  var ini=p+30+u16(z.dv,p+26)+u16(z.dv,p+28);
  var datos=new Uint8Array(z.buf, ini, e.csz);
  if(e.met===0) return Promise.resolve(new TextDecoder().decode(datos));
  if(e.met!==8) return Promise.reject(new Error('El .xlsx usa una compresión que no se puede leer acá.'));
  return new Response(new Blob([datos]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))).text();
}
function xmlDoc(txt,que){
  var d=new DOMParser().parseFromString(txt,'application/xml');
  if(d.getElementsByTagName('parsererror').length) throw new Error('No se pudo leer '+que+'.');
  return d;
}
// Hoja → [{n:fila, c:{A:'...', P:'...'}}]
function xlHoja(sheetTxt, ssTxt){
  var ss=[];
  if(ssTxt){
    var sd=xmlDoc(ssTxt,'los textos del Excel');
    Array.prototype.forEach.call(sd.getElementsByTagName('si'), function(si){
      var t=si.getElementsByTagName('t'), s='';
      for(var i=0;i<t.length;i++) s+=t[i].textContent;
      ss.push(s);
    });
  }
  var doc=xmlDoc(sheetTxt,'la hoja del Excel'), out=[];
  Array.prototype.forEach.call(doc.getElementsByTagName('row'), function(row){
    var c={};
    Array.prototype.forEach.call(row.getElementsByTagName('c'), function(cel){
      var ref=cel.getAttribute('r')||'', col=ref.replace(/[0-9]/g,''), ty=cel.getAttribute('t'), v=null;
      if(ty==='inlineStr'){ var it=cel.getElementsByTagName('t'); v=it.length?it[0].textContent:''; }
      else {
        var vv=cel.getElementsByTagName('v');
        if(vv.length){ v = ty==='s' ? (ss[parseInt(vv[0].textContent,10)]||'') : vv[0].textContent; }
      }
      if(v!==null && v!=='') c[col]=v;
    });
    if(Object.keys(c).length) out.push({n:parseInt(row.getAttribute('r'),10)||0, c:c});
  });
  return out;
}


// Archivo → filas de la primera hoja
function xlLeerArchivo(file){
  return file.arrayBuffer().then(function(buf){
    var z=zipAbrir(buf);
    var hoja = z.idx['xl/worksheets/sheet1.xml'] ? 'xl/worksheets/sheet1.xml'
             : Object.keys(z.idx).filter(function(k){ return /^xl\/worksheets\/.*\.xml$/.test(k); }).sort()[0];
    if(!hoja) throw new Error('El .xlsx no tiene ninguna hoja.');
    return Promise.all([zipTexto(z,hoja), zipTexto(z,'xl/sharedStrings.xml')]);
  }).then(function(r){ return xlHoja(r[0], r[1]); });
}

// El listado "Ranking por Artículo" del sistema: encabezado buscado por
// nombre (no por posición), período del renglón "Del: … Al: …" y los
// renglones con código numérico en la columna del código.
// Los números van con parseFloat: vienen crudos de máquina y a veces en
// notación científica ("5.89E-2").
// modo 'ventas': el "Ranking por Articulo Ventas" no trae Salidas; la
// cantidad está bajo un encabezado "Cantidad" con "VENTAS MN" arriba.
// Se toma la columna del grupo "Ventas…" (o una que se llame Ventas).
// El valor sale igual en .salidas para no tocar a quien lo usa.
function xlRanking(rows, modo){
  var norm=function(s){ return String(s==null?'':s).replace(/\s+/g,' ').trim().toLowerCase(); };
  var cCod='A', cArt='B', cSal='P', filaCab=0, hayCab=false, colVentas=null;
  if(modo==='ventas'){
    for(var v=0;v<rows.length && v<20 && !colVentas;v++)
      for(var cv in rows[v].c){ if(/^ventas\b/.test(norm(rows[v].c[cv]))){ colVentas=cv; break; } }
  }
  for(var i=0;i<rows.length && i<20;i++){
    var c=rows[i].c, h={};
    for(var col in c){
      var t=norm(c[col]);
      if(t.indexOf('cod')===0 && t.indexOf('articulo')>0) h.cod=col;
      else if(t==='articulo') h.art=col;
      else if(modo==='ventas'){ if(col===colVentas && (t==='cantidad' || t==='ventas')) h.sal=col; }
      else if(t==='salidas')  h.sal=col;
    }
    if(h.sal && (h.cod||h.art)){ cCod=h.cod||cCod; cArt=h.art||cArt; cSal=h.sal; filaCab=rows[i].n; hayCab=true; break; }
  }
  var fecha=function(s){ var m=String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? new Date(+m[3], +m[2]-1, +m[1]) : null; };
  var ini=null, fin=null;
  for(var j=0;j<rows.length && j<20 && !(ini&&fin);j++){
    for(var k in rows[j].c){
      var s=String(rows[j].c[k]);
      if(/del\s*:/i.test(s) && /al\s*:/i.test(s)){ var p=s.split(/al\s*:/i); ini=fecha(p[0]); fin=fecha(p[1]||''); break; }
    }
  }
  var meses = (ini&&fin) ? Math.max(1, Math.round((fin-ini)/(1000*60*60*24*30.437))) : null;
  var filas=[];
  rows.forEach(function(r){
    if(filaCab && r.n<=filaCab) return;
    var cod=r.c[cCod];
    if(!cod || !/^\d+$/.test(String(cod).trim())) return;
    var x=parseFloat(r.c[cSal]);
    filas.push({interno:String(cod).trim(), desc:String(r.c[cArt]||''), salidas:isNaN(x)?0:x});
  });
  return {ini:ini, fin:fin, meses:meses, filas:filas, hayCab:hayCab};
}
