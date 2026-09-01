// ─── La cuenta de la reposición ──────────────────────────────────────
// Vive aparte de stock.html porque la usan tres pantallas (Stock, la de
// configuración y el Dashboard). Una fórmula de reposición copiada en
// tres lados es una fórmula que en tres meses no coincide consigo misma.
//
// `hoy` entra siempre por parámetro y nunca se llama a new Date() acá:
// es lo que permite probarla con node --test sin navegador.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = { Reposicion: api };
  root.Reposicion = api;
})(typeof self !== 'undefined' ? self : this, function () {

  var DIA = 86400000;
  var MESES_OBJETIVO = 2;      // cuántos meses de consumo cubre la sugerencia
  var DIAS_AVISO = 7;          // ventana de "entra en el control de esta semana"
  var DIAS_AVISO_PACTADA = 30; // cuánto antes de que venza un contrato se avisa

  function sumarMeses(fecha, n) {
    var dia = fecha.getUTCDate();
    var d = new Date(fecha.getTime());
    d.setUTCDate(1); // evita el rollover: sin esto, un dia 31 en un mes mas corto se corre al mes siguiente
    d.setUTCMonth(d.getUTCMonth() + n);
    var ultimoDiaMes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(dia, ultimoDiaMes)); // 31/01 + 1 mes = 28/02 (29/02 en bisiesto), no 03/03
    return d;
  }

  // Fecha del recordatorio: la que caiga primero entre la puntual, la
  // regla por meses y el vencimiento de la compra pactada.
  // Sin última OC la regla por meses no tiene desde dónde contar, y una
  // pactada agotada o ya vencida no aporta: seguiría avisando para
  // siempre por algo que ya no se puede usar.
  function fechaRecordatorio(art, hoy) {
    var cand = [];
    if (art.proximaRevision) cand.push(art.proximaRevision);
    if (art.revisarCadaMeses > 0 && art.ultimaOC) cand.push(sumarMeses(art.ultimaOC, art.revisarCadaMeses));
    if (art.pactVence && !pactadaAgotada(art) && art.pactVence >= hoy) {
      cand.push(new Date(art.pactVence.getTime() - DIAS_AVISO_PACTADA * DIA));
    }
    if (!cand.length) return null;
    return new Date(Math.min.apply(null, cand.map(function (f) { return f.getTime(); })));
  }

  function pactadaAgotada(art) {
    return +art.pactCantidad > 0 && (+art.pactEntregado || 0) >= +art.pactCantidad;
  }

  function calcular(art, hoy) {
    var r = {
      senal: null, fechaLimite: null, diasStock: null, diasParaPedir: null,
      demoraUsada: null, sugerido: 0, falta: 0, motivo: '',
      pactadaAgotada: false, pactadaVencida: false
    };
    if (!art || !art.seguimiento) return r;

    var stock = +art.stock || 0, minimo = +art.minimo || 0;
    var consumo = +art.consumo || 0, pend = +art.pendiente || 0;

    // Cantidad sugerida: se calcula siempre que haya consumo, aunque no
    // haya demora, porque sirve igual para decidir cuánto pedir.
    var objetivo = minimo + consumo * MESES_OBJETIVO;
    var falta = Math.max(0, objetivo - stock - pend);
    r.falta = falta;
    r.sugerido = falta;
    if (falta > 0) {
      if (+art.multiplo > 0) r.sugerido = Math.ceil(falta / art.multiplo) * art.multiplo;
      if (+art.loteMinimo > 0) r.sugerido = Math.max(r.sugerido, +art.loteMinimo);
    }

    r.pactadaAgotada = pactadaAgotada(art);
    r.pactadaVencida = !!(art.pactVence && art.pactVence < hoy);

    var recordatorio = fechaRecordatorio(art, hoy);
    var toca = recordatorio !== null && recordatorio <= hoy;

    // Sin los datos para la fecha límite no se inventa una señal: se pide
    // el dato que falta. El recordatorio sí puede disparar igual.
    if (consumo <= 0) { r.senal = toca ? 'REVISAR' : 'SIN_DATOS'; r.motivo = toca ? '' : 'falta-consumo'; return r; }
    if (!(+art.demoraDias > 0)) { r.senal = toca ? 'REVISAR' : 'SIN_DATOS'; r.motivo = toca ? '' : 'falta-demora'; return r; }

    r.demoraUsada = +art.demoraDias;

    // El mínimo es colchón, no disparador: la alerta salta cuando pedir
    // hoy ya te haría tocar el mínimo antes de que llegue la mercadería.
    var diario = consumo / 30;
    r.diasStock = Math.round((stock + pend - minimo) / diario);
    r.diasParaPedir = r.diasStock - r.demoraUsada;
    r.fechaLimite = new Date(hoy.getTime() + r.diasParaPedir * DIA);

    // Lo urgente primero: una fecha límite vencida gana sobre el recordatorio.
    if (r.diasParaPedir < 0) r.senal = 'ATRASADO';
    else if (r.diasParaPedir <= DIAS_AVISO) r.senal = 'PEDIR';
    else if (toca) r.senal = 'REVISAR';
    else if (art.revisarCadaMeses > 0 && !art.ultimaOC && !art.proximaRevision) { r.senal = 'SIN_DATOS'; r.motivo = 'sin-oc'; }
    else r.senal = 'OK';

    return r;
  }

  // ── El adaptador ────────────────────────────────────────────────
  // Traduce una fila del inventario (nombres de header del adaptador de
  // subatir-app.js) + su ficha de art_proveedor al objeto que come
  // calcular(). Vive acá y no en cada pantalla porque lo usan las tres.
  function canonProv(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
  }

  function fecha(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d) ? null : d;
  }

  function desdeFila(inv, ficha, ultimaOC) {
    inv = inv || {};
    var f = ficha || {};
    var seg = inv['SEGUIMIENTO'];
    return {
      // El tilde es el que manda: un dato cargado sin tildar no se usa.
      seguimiento: seg === true || seg === 'true',
      stock:     +inv['INVENTARIO'] || 0,
      minimo:    +inv['STOCK MÍNIMO'] || 0,
      consumo:   +inv['CONSUMO MENSUAL'] || 0,
      pendiente: +inv['PENDIENTE DE ENTREGA'] || 0,
      demoraDias:    f.usar_demora  ? (+f.demora_dias || null) : null,
      loteMinimo:    f.usar_lote    ? (+f.lote_minimo || null) : null,
      multiplo:      f.usar_lote    ? (+f.multiplo    || null) : null,
      pactCantidad:  f.usar_pactada ? (+f.pact_cantidad || null) : null,
      pactEntregado: f.usar_pactada ? (+f.pact_entregado || 0)  : 0,
      pactVence:     f.usar_pactada ? fecha(f.pact_vence) : null,
      proximaRevision:  fecha(inv['PROXIMA REVISION']),
      revisarCadaMeses: +inv['REVISAR CADA MESES'] || null,
      ultimaOC: ultimaOC || null
    };
  }

  return {
    calcular: calcular, desdeFila: desdeFila, canonProv: canonProv,
    MESES_OBJETIVO: MESES_OBJETIVO, DIAS_AVISO: DIAS_AVISO,
    DIAS_AVISO_PACTADA: DIAS_AVISO_PACTADA
  };
});
