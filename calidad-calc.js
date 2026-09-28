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
//   · FT y HDS: el último cargado de cada tipo es el que vale. Si tiene
//     fecha de vencimiento, avisa 30 días antes.
//   · COA: se guardan todos; se muestra el último. No se reclama.
//   · OTRO: cualquier otro documento del producto, con un nombre
//     (titulo). Con proveedor va en la fila de ese proveedor; sin
//     proveedor es del producto y aparece en todas sus filas.
//   · Todo lo sube el administrador.
// ============================================================
(function () {
  'use strict';

  var AVISO_DIAS = 30;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hoyISO() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function norm(s) {
    if (window.SubatirApp && SubatirApp.match && SubatirApp.match.norm) return SubatirApp.match.norm(String(s || ''));
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  }

  // Estado de vencimiento de una FT/HDS: '' (vale o no tiene fecha),
  // 'pronto' (vence en 30 días o menos) o 'vencido'.
  function vencimiento(doc, hoy) {
    if (!doc || !doc.vence) return '';
    hoy = hoy || new Date(); var h = new Date(hoy); h.setHours(0, 0, 0, 0);
    var d = new Date(doc.vence + 'T00:00:00');
    var dias = Math.round((d - h) / 86400000);
    return dias < 0 ? 'vencido' : (dias <= AVISO_DIAS ? 'pronto' : '');
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
      SB.from('inventario').select('id,codigo,descripcion,proveedor,ext_id').eq('ext_id', 'MP'),
      SB.from('mp_documentos').select('*')
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
  function filas(datos, hoy) {
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
          ft: ft, hds: hds, ftVto: vencimiento(ft, hoy), hdsVto: vencimiento(hds, hoy),
          coa: ultimo(coas), nCoa: coas.length,
          otros: ordenar(de('OTRO'))
        });
      });
    });
    return out;
  }

  function resumen(fs) {
    var r = { filas: fs.length, mps: 0, sinFT: 0, sinHDS: 0, sinCOA: 0, vencidos: 0, pronto: 0 };
    var vistos = {};
    fs.forEach(function (f) {
      if (!vistos[f.mp.id]) { vistos[f.mp.id] = 1; r.mps++; }
      if (!f.ft) r.sinFT++;
      if (!f.hds) r.sinHDS++;
      if (!f.coa) r.sinCOA++;
      if (f.ftVto === 'vencido' || f.hdsVto === 'vencido') r.vencidos++;
      else if (f.ftVto === 'pronto' || f.hdsVto === 'pronto') r.pronto++;
    });
    return r;
  }

  window.CalidadMP = {
    AVISO_DIAS: AVISO_DIAS, BUCKET: 'calidad-mp',
    norm: norm, hoyISO: hoyISO, vencimiento: vencimiento, fechaDe: fechaDe,
    ordenar: ordenar, cargar: cargar, filas: filas, resumen: resumen
  };
})();
