// ══════════════════════════════════════════════════════════════
//  MP-COSTEO — costo de una OC de importación (Proforma)
//
//  Precio FCA por artículo + gastos de importación = costo puesto en
//  depósito. Los gastos son de dos clases según el momento:
//
//   · ESTIMADO: hasta que liquida el despachante (20 a 30 días). Se
//     toma un costeo de referencia (el último real, o la factura 293)
//     y cada concepto se escala por  FCA de esta orden ÷ FCA de la ref.
//   · REAL: los importes que declara el despachante, tal cual.
//
//  En los dos casos el costo de cada línea es  importe FCA × (1 + inc),
//  con inc = gastos ÷ FCA. Las líneas se redondean y la diferencia de
//  centavos va a la línea más grande, así la suma de las líneas es
//  EXACTAMENTE el costo total (un solo número, no dos que no cierran).
//
//  IVA de importación (22% s/CIF) y anticipo de IVA (10% s/CIF) NO son
//  costo: son crédito fiscal. Se muestran aparte, como plata que hay
//  que poner.
//
//  No llama a new Date(): "hoy" entra por parámetro (node --test).
// ══════════════════════════════════════════════════════════════
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = { MPCosteo: api };
  root.MPCosteo = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // cif: true = entra en el valor CIF (lo que se paga hasta la frontera)
  var CONCEPTOS = [
    { k: 'flete_int',  t: 'Flete terrestre tramo internacional', cif: true },
    { k: 'seguro_int', t: 'Seguro tramo internacional',          cif: true },
    { k: 'flete_nac',  t: 'Flete terrestre tramo nacional' },
    { k: 'seguro_nac', t: 'Seguro tramo nacional' },
    { k: 'tributos',   t: 'Tributos aduaneros' },
    { k: 'honorarios', t: 'Honorarios despachante' },
    { k: 'gastos_gen', t: 'Gastos generales' }
  ];
  var IVA_IMP = 0.22, IVA_ANT = 0.10;
  // Cuándo se espera la liquidación del despachante, en días desde la impo
  var ESPERA_DESDE = 20, ESPERA_HASTA = 30;
  var DIA = 86400000;

  function num(v) { var x = parseFloat(v); return isNaN(x) ? 0 : x; }
  function r2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
  function vacio(v) { return v === null || v === undefined || v === ''; }

  /**
   * @param o.lineas [{id, desc, cod, grupo, cant, unidad, precio}]
   * @param o.ref    {origen, fca, gastos:{concepto:usd}}
   * @param o.real   null | {concepto:usd, iva_imp?, iva_ant?}
   */
  function calcular(o) {
    var lineas = (o.lineas || []).map(function (l) {
      var p = vacio(l.precio) ? null : num(l.precio);
      return {
        id: l.id, desc: l.desc, cod: l.cod, grupo: l.grupo || 'Artículos',
        cant: num(l.cant), unidad: l.unidad || 'kg', precio: p,
        sinPrecio: !(p > 0), importe: r2(num(l.cant) * (p || 0))
      };
    });
    var fca = r2(lineas.reduce(function (t, l) { return t + l.importe; }, 0));
    var real = o.real || null;
    var ref = o.ref || { fca: 0, gastos: {} };
    var factor = num(ref.fca) > 0 ? fca / num(ref.fca) : 0;

    var gastos = {};
    CONCEPTOS.forEach(function (c) {
      gastos[c.k] = real ? r2(num(real[c.k])) : r2(num((ref.gastos || {})[c.k]) * factor);
    });
    var totGastos = r2(CONCEPTOS.reduce(function (t, c) { return t + gastos[c.k]; }, 0));
    var inc = fca > 0 ? totGastos / fca : 0;
    var cif = r2(fca + CONCEPTOS.reduce(function (t, c) { return t + (c.cif ? gastos[c.k] : 0); }, 0));
    var ivaImp = real && !vacio(real.iva_imp) ? r2(num(real.iva_imp)) : r2(cif * IVA_IMP);
    var ivaAnt = real && !vacio(real.iva_ant) ? r2(num(real.iva_ant)) : r2(cif * IVA_ANT);
    var costo = r2(fca + totGastos);

    // Costo por línea, con los centavos de redondeo en la línea más grande
    var suma = 0, mayor = -1;
    lineas.forEach(function (l, i) {
      l.costoTotal = r2(l.importe * (1 + inc));
      suma += l.costoTotal;
      if (mayor < 0 || l.importe > lineas[mayor].importe) mayor = i;
    });
    var dif = r2(costo - suma);
    if (mayor >= 0 && dif !== 0) lineas[mayor].costoTotal = r2(lineas[mayor].costoTotal + dif);
    lineas.forEach(function (l) { l.costoUnit = l.cant > 0 ? l.costoTotal / l.cant : 0; });

    // Subtotales por grupo, en el orden en que aparecen
    var grupos = [], idx = {};
    lineas.forEach(function (l) {
      if (idx[l.grupo] === undefined) {
        idx[l.grupo] = grupos.length;
        grupos.push({ titulo: l.grupo, lineas: [], fca: 0, costo: 0 });
      }
      var g = grupos[idx[l.grupo]];
      g.lineas.push(l); g.fca = r2(g.fca + l.importe); g.costo = r2(g.costo + l.costoTotal);
    });

    return {
      real: !!real, lineas: lineas, grupos: grupos, fca: fca, factor: factor,
      gastos: gastos, totGastos: totGastos, inc: inc, cif: cif,
      ivaImp: ivaImp, ivaAnt: ivaAnt, costo: costo, desembolso: r2(costo + ivaImp + ivaAnt),
      sinPrecio: lineas.filter(function (l) { return l.sinPrecio; })
    };
  }

  // Cuánto falta para la liquidación del despachante.
  //  estado: 'real' | 'espera' (antes de los 20 días) | 'ventana' (20–30) | 'vencido' (>30)
  function plazo(fechaImpo, hoy, esReal) {
    var f = new Date(String(fechaImpo).slice(0, 10) + 'T00:00:00Z');
    var h = new Date(String(hoy).slice(0, 10) + 'T00:00:00Z');
    var dias = Math.round((h - f) / DIA);
    var desde = new Date(f.getTime() + ESPERA_DESDE * DIA).toISOString().slice(0, 10);
    var hasta = new Date(f.getTime() + ESPERA_HASTA * DIA).toISOString().slice(0, 10);
    var estado = esReal ? 'real' : dias > ESPERA_HASTA ? 'vencido' : dias >= ESPERA_DESDE ? 'ventana' : 'espera';
    return { dias: dias, desde: desde, hasta: hasta, estado: estado };
  }

  // La referencia para estimar una OC nueva: el último costeo REAL del
  // proveedor (es lo más parecido a lo que va a pasar) y, si no hay
  // ninguno, la de los parámetros.
  //  costeos: [{estado, fecha_impo, gastos_real, fca_real, oc}]  fca_real = FCA de esa orden
  function referencia(costeos, refDefecto) {
    var reales = (costeos || []).filter(function (k) {
      return k.estado === 'REAL' && k.gastos_real && num(k.fca_real) > 0;
    }).sort(function (a, b) { return String(b.fecha_impo).localeCompare(String(a.fecha_impo)); });
    if (reales.length) {
      var k = reales[0], g = {};
      CONCEPTOS.forEach(function (c) { g[c.k] = num(k.gastos_real[c.k]); });
      return { origen: 'Liquidación real ' + (k.oc || '') , fca: num(k.fca_real), gastos: g };
    }
    return refDefecto || null;
  }

  return {
    calcular: calcular, plazo: plazo, referencia: referencia,
    CONCEPTOS: CONCEPTOS, IVA_IMP: IVA_IMP, IVA_ANT: IVA_ANT,
    ESPERA_DESDE: ESPERA_DESDE, ESPERA_HASTA: ESPERA_HASTA
  };
});
