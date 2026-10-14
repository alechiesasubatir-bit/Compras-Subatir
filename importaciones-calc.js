// ─── Previsión de importación (artículos de Depósitos) ───────────────
// La usan los submódulos Subatir · Consumo, y después Intex, Enjoy y
// Mopas. MERO AR tiene su propia cuenta en mp-importacion.html porque
// viene de la planilla de Drive y la tiene que reproducir tal cual.
//
// La diferencia con MERO AR es el LEAD TIME: allá sólo marca riesgo,
// acá entra en la cantidad. Una importación tarda meses en llegar y
// mientras viaja el stock de hoy se sigue consumiendo, así que lo que
// hay que pedir es lo que cubre el viaje + la cobertura + el colchón,
// menos lo que hay y lo que ya viene en camino:
//
//    prom3m     = consumo3m / 3
//    promAnual  = consumoAnual / 12
//    ponderado  = 0,6 × prom3m + 0,4 × promAnual     (igual que MERO AR)
//    proyect    = ponderado × (1 + crecimiento)
//    durante LT = proyect × (semanasLead / 4,333)
//    necesidad  = proyect × mesesCobertura
//    stockSeg   = proyect × (semanasSeguridad / 4,333)
//    total      = durante LT + necesidad + stockSeg
//    aPedir     = max(0, total − stock − enTransito)
//    cajas      = techo(aPedir / unXCaja)     (sin caja: unidades enteras)
//
// No llama a new Date(): la fecha de la corrida entra por parámetro, así
// se prueba con node --test.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = { ImpCalc: api };
  root.ImpCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {

  var SEM_MES = 4.333;   // semanas por mes, la misma constante que MERO AR
  var DIA = 86400000;

  function num(v) { var x = parseFloat(v); return isNaN(x) ? 0 : x; }

  /**
   * @param d  {consumo_3m, consumo_anual, stock_actual, en_transito}
   * @param p  {crecimiento_pct, meses_cobertura, semanas_seguridad, semanas_leadtime}
   * @param o  {unXCaja, fecha:Date}  fecha = la de la corrida
   */
  function calcular(d, p, o) {
    o = o || {};
    var c3m = num(d.consumo_3m), anual = num(d.consumo_anual);
    var stock = num(d.stock_actual), transito = num(d.en_transito);
    var lead = num(p.semanas_leadtime), seg = num(p.semanas_seguridad);

    var prom3m = c3m / 3;
    var promAnual = anual / 12;
    var ponderado = 0.6 * prom3m + 0.4 * promAnual;
    var proyect = ponderado * (1 + num(p.crecimiento_pct) / 100);
    var duranteLead = proyect * (lead / SEM_MES);
    var necesidad = proyect * num(p.meses_cobertura);
    var stockSeg = proyect * (seg / SEM_MES);
    var totalNec = duranteLead + necesidad + stockSeg;
    var disponible = stock + transito;
    var aPedir = Math.max(0, totalNec - disponible);

    var caja = num(o.unXCaja);
    var cajas = 0, pedido = 0;
    if (aPedir > 0) {
      if (caja > 0) { cajas = Math.ceil(aPedir / caja - 1e-9); pedido = cajas * caja; }
      else pedido = Math.ceil(aPedir - 1e-9);
    }

    // Semanas que aguanta lo que hay + lo que viene, al ritmo proyectado
    var cobertura = proyect > 0 ? (disponible / proyect) * SEM_MES : (disponible > 0 ? 999 : 0);
    var quiebre = stock <= 0 && proyect > 0;

    // Cuándo hay que haber pedido: cuando lo que queda alcance justo
    // para el viaje más el colchón. Si ya pasó, es urgente.
    var margen = proyect > 0 ? cobertura - lead - seg : 999;
    var pedirAntes = null;
    if (proyect > 0 && o.fecha) pedirAntes = new Date(o.fecha.getTime() + Math.round(margen * 7) * DIA);

    var estado;
    if (proyect <= 0 && pedido <= 0) estado = 'sin';      // sin consumo: no hay qué prever
    else if (quiebre) estado = 'quiebre';
    else if (margen < 0) estado = 'urgente';               // no llega al arribo con el colchón
    else if (pedido > 0) estado = 'pedir';
    else estado = 'ok';

    return {
      prom3m: prom3m, promAnual: promAnual, ponderado: ponderado, proyect: proyect,
      duranteLead: duranteLead, necesidad: necesidad, stockSeg: stockSeg, totalNec: totalNec,
      disponible: disponible, aPedir: aPedir, cajas: cajas, pedido: pedido,
      cobertura: cobertura, margen: margen, pedirAntes: pedirAntes,
      quiebre: quiebre, estado: estado
    };
  }

  // Un listado anual que no abarca 12 meses justos se lleva a 12, así
  // el "consumo anual" guardado siempre significa lo mismo.
  function anualizar(total, meses) {
    meses = num(meses);
    if (!(meses > 0) || meses === 12) return num(total);
    return num(total) * 12 / meses;
  }

  return { calcular: calcular, anualizar: anualizar, SEM_MES: SEM_MES };
});
