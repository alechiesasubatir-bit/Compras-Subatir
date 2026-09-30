// ============================================================
//  CALIDAD MP — archivo de documentos de las materias primas
//
//  Lo usa sólo calidad.html. Es un acopio de documentos, independiente
//  del resto: no mira entregas, pedidos ni COA de las líneas (si el
//  COA de una recepción está o no lo dice el Check List PL-06).
//
//  Reglas (acordadas con el usuario, 28/09/2026):
//   · Materia prima = ficha de inventario con ext_id 'MP'.
//   · Una MP puede tener varios proveedores, y cada proveedor su propia
//     FT, HDS y COA. Por eso la unidad es MP × proveedor: una fila por
//     cada proveedor que figura en la ficha o en algún documento.
//   · FT y HDS: NO vencen y no guardan versiones (29/09/2026, pedido del
//     usuario): cuando llega documentación nueva se carga y REEMPLAZA a la
//     anterior, que se borra. aReemplazar() dice cuáles se van.
//   · COA: se guardan todos; se muestra el último. No se reclama.
//   · OTRO: cualquier otro documento del producto, con un nombre
//     (titulo). Con proveedor va en la fila de ese proveedor; sin
//     proveedor es del producto y aparece en todas sus filas.
//   · Todo lo sube el administrador.
//
//  MP IMPORTADAS (29/09/2026): las materias primas que se compran afuera
//  no están en el inventario como MP: viven en mp_articulos, por
//  proveedor (MERO AR), la misma lista que usa MP Importación. Sus FT y
//  HDS van a la misma tabla mp_documentos con mp_articulo_id en vez de
//  inventario_id, así que filas() de arriba no las ve (y no debe).
// ============================================================
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = { CalidadMP: api };
  root.CalidadMP = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hoyISO() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function norm(s) {
    if (typeof SubatirApp !== 'undefined' && SubatirApp.match && SubatirApp.match.norm) return SubatirApp.match.norm(String(s || ''));
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  }

  // Fecha con la que se ordena un documento. Los COA viejos traen sólo
  // el mes que cubrían.
  function fechaDe(d) { return d.fecha_doc || d.mes || ''; }

  // El que vale: el de fecha más nueva; a igual fecha, el último subido.
  function ordenar(docs) {
    return (docs || []).slice().sort(function (a, b) {
      var fa = fechaDe(a), fb = fechaDe(b);
      if (fa !== fb) return fa < fb ? 1 : -1;
      return String(a.created_at) < String(b.created_at) ? 1 : -1;
    });
  }
  function ultimo(docs) { return ordenar(docs)[0] || null; }

  /**
   * Lee las materias primas y todos sus documentos.
   * @returns {Promise<{mps:Array, docs:Array, falta:string}>}
   *   falta = 'tabla' si todavía no se corrió migracion/calidad_mp.sql
   */
  function cargar(SB) {
    return Promise.all([
      SB.todo(function () { return SB.from('inventario').select('id,codigo,descripcion,proveedor,ext_id').eq('ext_id', 'MP'); }),
      SB.todo(function () { return SB.from('mp_documentos').select('*'); })
    ]).then(function (r) {
      if (r[0].error) throw new Error(r[0].error.message);
      return {
        mps: r[0].data || [],
        docs: r[1].error ? [] : (r[1].data || []),
        falta: r[1].error ? 'tabla' : ''
      };
    });
  }

  /**
   * Una fila por materia prima × proveedor. Los proveedores salen de la
   * ficha de Stock y de los documentos cargados; se juntan sin importar
   * mayúsculas ni acentos. Una MP sin proveedor ni documentos queda en
   * una fila con el proveedor vacío.
   */
  function filas(datos) {
    var porArt = {};
    datos.docs.forEach(function (d) {
      if (d.inventario_id == null) return;
      (porArt[d.inventario_id] = porArt[d.inventario_id] || []).push(d);
    });
    var out = [];
    datos.mps.forEach(function (m) {
      var docs = porArt[m.id] || [];
      var provs = {}, orden = [], delProducto = [];
      var sumar = function (p) {
        var k = norm(p);
        if (!(k in provs)) { provs[k] = { nombre: String(p || '').trim(), docs: [] }; orden.push(k); }
        return provs[k];
      };
      if (m.proveedor) sumar(m.proveedor);
      docs.forEach(function (d) {
        // Un "otro documento" sin proveedor es del producto: va en todas
        // sus filas y no abre una fila "sin proveedor" propia.
        if (d.tipo === 'OTRO' && !norm(d.proveedor)) delProducto.push(d);
        else sumar(d.proveedor).docs.push(d);
      });
      if (!orden.length) sumar('');
      orden.forEach(function (k) {
        var g = provs[k];
        var todos = g.docs.concat(delProducto);
        var de = function (t) { return todos.filter(function (d) { return d.tipo === t; }); };
        var ft = ultimo(de('FT')), hds = ultimo(de('HDS')), coas = de('COA');
        out.push({
          key: m.id + '|' + k, mp: m, prov: g.nombre, docs: todos,
          ft: ft, hds: hds,
          coa: ultimo(coas), nCoa: coas.length,
          otros: ordenar(de('OTRO'))
        });
      });
    });
    return out;
  }

  function resumen(fs) {
    var r = { filas: fs.length, mps: 0, sinFT: 0, sinHDS: 0, sinCOA: 0, completas: 0 };
    var vistos = {};
    fs.forEach(function (f) {
      if (!vistos[f.mp.id]) { vistos[f.mp.id] = 1; r.mps++; }
      if (!f.ft) r.sinFT++;
      if (!f.hds) r.sinHDS++;
      if (!f.coa) r.sinCOA++;
      if (f.ft && f.hds) r.completas++;
    });
    return r;
  }

  // ── MP IMPORTADAS ─────────────────────────────────────────

  // Texto de un nombre de archivo listo para buscar palabras: sin
  // extensión ni acentos, en mayúsculas y con todo lo que no es letra o
  // número hecho espacio ("HDS_Esencia-Bosque.pdf" → "HDS ESENCIA BOSQUE").
  function palabras(s) {
    return String(s || '').replace(/\.[A-Za-z0-9]{2,5}$/, '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ').trim();
  }

  // Tipo de documento según el nombre del archivo: 'FT', 'HDS' o ''.
  // HDS se mira primero: "Ficha de datos de SEGURIDAD" es una HDS
  // aunque diga "ficha".
  var RX_HDS = /(^| )(HDS|MSDS|SDS|FDS|HOJA SEG\w*|SEGURIDAD|SAFETY)( |$)/;
  var RX_FT = /(^| )(FT|TDS|FICHA|FICHA TEC\w*|TECNICA|TECHNICAL|SPEC\w*|ESPECIFICACION\w*)( |$)/;
  function detectarTipo(nombreArchivo) {
    var t = palabras(nombreArchivo);
    if (RX_HDS.test(t)) return 'HDS';
    if (RX_FT.test(t)) return 'FT';
    return '';
  }

  // Palabras de un nombre de artículo que no sirven para distinguirlo:
  // están en todos ("Esencia … MEROAR") o son del tipo de documento.
  var RUIDO = { ESENCIA: 1, ESENCIAS: 1, MEROAR: 1, MEORAR: 1, MERO: 1, AR: 1, MP: 1, KG: 1, X: 1,
    Y: 1, DE: 1, LA: 1, EL: 1, CON: 1, FT: 1, HDS: 1, MSDS: 1, SDS: 1, FDS: 1, TDS: 1 };
  function clave(nombre) {
    return palabras(nombre).split(' ').filter(function (w) { return w && !RUIDO[w] && !/^\d+$/.test(w); });
  }

  /**
   * A qué artículo corresponde un archivo, por su nombre.
   *  1. Un número del nombre igual al código del artículo (761453).
   *  2. Si no, las palabras propias del artículo ("BOSQUE") que aparecen
   *     en el nombre. Gana el que más cubre, y sólo si cubre al menos la
   *     mitad y no empata: "HDS Lavanda.pdf" puede ser Lavanda Limpiador
   *     o Lavanda Textil, y ahí mejor que elija la persona.
   * @returns {{art:Object|null, por:'codigo'|'nombre'|''}}
   */
  function emparejar(nombreArchivo, arts) {
    var t = palabras(nombreArchivo), ws = t.split(' ');
    var nums = ws.filter(function (w) { return /^\d{4,}$/.test(w); });
    for (var i = 0; i < arts.length; i++) {
      var c = String(arts[i].codigo || '').trim();
      if (c && nums.indexOf(c) >= 0) return { art: arts[i], por: 'codigo' };
    }
    var set = {}; ws.forEach(function (w) { set[w] = 1; });
    var mejor = null, pMejor = 0, empate = false;
    arts.forEach(function (a) {
      var k = clave(a.nombre); if (!k.length) return;
      var hits = k.filter(function (w) { return set[w]; }).length;
      var p = hits / k.length;
      if (p > pMejor) { mejor = a; pMejor = p; empate = false; }
      else if (p === pMejor && p > 0) empate = true;
    });
    if (mejor && pMejor >= 0.5 && !empate) return { art: mejor, por: 'nombre' };
    return { art: null, por: '' };
  }

  /**
   * Una fila por artículo importado del proveedor, con su FT y HDS
   * vigentes (el último de cada tipo, igual que en las MP de Stock).
   */
  function filasImp(arts, docs) {
    var por = {};
    (docs || []).forEach(function (d) {
      if (d.mp_articulo_id == null) return;
      (por[d.mp_articulo_id] = por[d.mp_articulo_id] || []).push(d);
    });
    return (arts || []).map(function (a) {
      var ds = por[a.id] || [];
      var de = function (t) { return ds.filter(function (d) { return d.tipo === t; }); };
      var ft = ultimo(de('FT')), hds = ultimo(de('HDS'));
      return { art: a, docs: ordenar(ds), ft: ft, hds: hds,
        nFt: de('FT').length, nHds: de('HDS').length };
    });
  }

  function resumenImp(fs) {
    var r = { arts: fs.length, conFT: 0, conHDS: 0, completos: 0, docs: 0 };
    fs.forEach(function (f) {
      if (f.ft) r.conFT++;
      if (f.hds) r.conHDS++;
      if (f.ft && f.hds) r.completos++;
      r.docs += f.docs.length;
    });
    // Cobertura = de todos los papeles que tendría que haber (FT + HDS
    // por artículo), cuántos están
    r.cobertura = r.arts ? Math.round((r.conFT + r.conHDS) * 100 / (2 * r.arts)) : 0;
    return r;
  }

  /**
   * Qué documentos borra una FT/HDS recién cargada: los otros del mismo
   * tipo y del mismo lugar — la misma MP de Stock con el mismo proveedor
   * (sin importar mayúsculas ni acentos), o el mismo artículo importado.
   * COA y otros documentos no se reemplazan: devuelve [].
   * @param {Array} docs  candidatos (leídos de la base justo antes)
   * @param {Object} nuevo  la fila recién insertada (con id)
   */
  function aReemplazar(docs, nuevo) {
    if (!nuevo || (nuevo.tipo !== 'FT' && nuevo.tipo !== 'HDS')) return [];
    return (docs || []).filter(function (d) {
      if (d.id === nuevo.id || d.tipo !== nuevo.tipo) return false;
      if (nuevo.mp_articulo_id != null) return d.mp_articulo_id === nuevo.mp_articulo_id;
      return nuevo.inventario_id != null && d.inventario_id === nuevo.inventario_id
        && norm(d.proveedor) === norm(nuevo.proveedor);
    });
  }

  return {
    BUCKET: 'calidad-mp',
    norm: norm, hoyISO: hoyISO, fechaDe: fechaDe, aReemplazar: aReemplazar,
    ordenar: ordenar, cargar: cargar, filas: filas, resumen: resumen,
    palabras: palabras, detectarTipo: detectarTipo, emparejar: emparejar,
    filasImp: filasImp, resumenImp: resumenImp
  };
});
