// ─── La cuenta de Previsión Cloro ────────────────────────────────────
// Vive aparte de cloro.html por lo mismo que reposicion-calc.js: una
// formula dentro de una pantalla es una formula que no se puede probar.
//
// `hoy` y las fechas entran siempre por parametro y nunca se llama a
// new Date() aca: es lo que permite probarla con node --test.
//
// Todo se hace en UTC. Con horas locales, un usuario en otro huso veria
// la venta del lunes a la manana caer en la semana anterior.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = { Cloro: api };
  root.Cloro = api;
})(typeof self !== 'undefined' ? self : this, function () {

  var DIA = 86400000;
  var SEMANA = 7 * DIA;

  // ─── El calendario de la temporada ─────────────────────────────────
  // La temporada va de agosto a marzo, o sea que cruza el ano. Las
  // semanas ISO no sirven: se reinician el 1 de enero, justo en la mitad
  // del pico de venta, y ademas corren respecto de la temporada segun en
  // que dia caiga el 1/8 (la semana 23 de temporada fue ISO 2026-W01 en
  // 2025-26 y va a ser ISO 2026-W53 en 2026-27). Por eso la semana se
  // cuenta desde el arranque de la propia temporada.

  // El lunes de la semana que contiene `fecha`. getUTCDay(): 0=domingo,
  // 1=lunes... por eso el domingo retrocede 6 dias y no 0.
  function lunesInicio(fecha) {
    var dow = fecha.getUTCDay();
    var atras = (dow + 6) % 7;
    return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(),
                             fecha.getUTCDate() - atras));
  }

  // Semana de temporada, base 1. Da menor a 1 si `fecha` es anterior al
  // arranque: el que llama decide si eso se descarta o se avisa.
  function semanaDe(fecha, fechaIni) {
    var base = lunesInicio(fechaIni);
    var dia0 = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
    return Math.floor((dia0 - base.getTime()) / SEMANA) + 1;
  }

  function semanasDeTemporada(fechaIni, fechaFin) {
    return semanaDe(fechaFin, fechaIni);
  }

  // ─── Suavizado ─────────────────────────────────────────────────────
  // Semana contra semana las temporadas se parecen poco: se midio 0,68 de
  // correlacion entre 2024-25 y 2025-26 en el total de la linea, y el pico
  // cayo en la semana 27 de una y en la 23 de la otra. Son camiones
  // mayoristas que caen en semanas distintas. Con una ventana centrada de
  // 5 la correlacion sube a 0,84, y a 0,92 en los productos grandes.
  // Sin esto, la prevision diria "la semana que viene 15.000 unidades"
  // porque el ano pasado justo ahi cargo un camion.

  // Media movil centrada. En los bordes promedia lo que hay en vez de
  // rellenar con ceros: rellenar hundiria artificialmente el arranque y
  // el final de la temporada, que es justo donde menos datos hay.
  function suavizar(serie, ventana) {
    var n = Math.max(1, Math.floor(ventana || 1));
    if (n <= 1) return serie.slice();
    var k = Math.floor(n / 2), out = [], i, j, a, b, s, c;
    for (i = 0; i < serie.length; i++) {
      a = Math.max(0, i - k);
      b = Math.min(serie.length - 1, i + k);
      s = 0; c = 0;
      for (j = a; j <= b; j++) { s += (parseFloat(serie[j]) || 0); c++; }
      out.push(c ? s / c : 0);
    }
    return out;
  }

  function suma(a, hasta) {
    var s = 0, n = (hasta == null ? (a || []).length : Math.min(hasta, (a || []).length));
    for (var i = 0; i < n; i++) s += (parseFloat(a[i]) || 0);
    return s;
  }

  // ─── Crecimiento del ano ───────────────────────────────────────────
  // Se mide comparando el MISMO TRAMO de las dos temporadas. Comparar lo
  // que va de esta contra la anterior entera diria que las ventas se
  // derrumbaron todos los agostos.
  //
  // `hayActual` dice si la temporada en curso tiene ventas CARGADAS, no si
  // suman algo. Son cosas distintas y confundirlas anula el modulo entero:
  // una temporada que ya arranco pero cuyas ventas todavia no se importaron
  // da 0 contra un ano pasado que si vendio, o sea -100% de crecimiento, y
  // ese -100% multiplica TODA la prevision por cero. El modulo terminaria
  // diciendo "no envases nada" justo en el arranque de la temporada. Vale el
  // mismo criterio que en el stock inicial: se mira si el dato existe, no
  // cuanto vale. Un cero cargado es una afirmacion y si mide -100%.
  function crecimiento(o) {
    var min = o.minSemanas == null ? 4 : o.minSemanas;
    var cerradas = o.semanasCerradas || 0;
    var hayActual = o.hayActual == null ? true : !!o.hayActual;
    if (hayActual && cerradas >= min) {
      var den = suma(o.anterior, cerradas);
      if (den > 0) return { pct: suma(o.actual, cerradas) / den - 1, modo: 'auto', sinVentas: false };
    }
    // Temporada recien arrancada (o sin ventas importadas): todavia no hay
    // tramo que comparar, asi que se hereda el crecimiento que hubo entre
    // las dos anteriores.
    var denPrevia = suma(o.previa);
    if (denPrevia > 0) {
      return { pct: suma(o.anterior) / denPrevia - 1, modo: 'temporada-completa', sinVentas: !hayActual };
    }
    return { pct: 0, modo: 'sin-datos', sinVentas: !hayActual };
  }

  // ─── La prevision ──────────────────────────────────────────────────
  // El historico suavizado, corregido por el crecimiento. El orden
  // importa: se suaviza PRIMERO. Crecer sobre la serie cruda y suavizar
  // despues mezclaria semanas ya infladas con otras que no.
  function prever(o) {
    var suave = suavizar(o.anterior || [], o.ventana || 1);
    var f = 1 + (parseFloat(o.crecimientoPct) || 0);
    var out = [];
    for (var i = 0; i < o.semanas; i++) out.push((suave[i] || 0) * f);
    return out;
  }

  // Stock de producto terminado semana a semana. En las semanas ya
  // cerradas manda la venta REAL; en las que vienen, la prevista.
  //
  // `semanaBase` es la semana a la que corresponde el conteo del stock
  // inicial, tomado como saldo de APERTURA de esa semana. Por defecto 1
  // -el arranque de la temporada-, pero un conteo hecho en septiembre NO
  // es el stock de agosto: tratarlo como tal vuelve a restar ventas que
  // el conteo ya tiene descontadas. Paso de verdad, con el conteo del
  // 8/9/2026: la pantalla mostraba -272 unidades de Pastilla Triple
  // Accion donde se habian contado 500, y el sugerido mandaba a envasar
  // de nuevo lo que ya se habia vendido.
  //
  // Antes de esa semana devuelve NULL y no cero. Cero significaria
  // "estaba vacio", que es una afirmacion; null es "no lo sabemos".
  //
  // Puede quedar negativo y NO se recorta: un stock negativo es la senal
  // de que falta envasar, y taparlo en cero esconderia justamente lo que
  // el modulo viene a avisar.
  function proyectarStock(o) {
    var n = Math.max((o.ventas || []).length, (o.envasado || []).length, (o.prevision || []).length);
    var base = Math.max(1, parseFloat(o.semanaBase) || 1);
    var s = parseFloat(o.stockInicial) || 0, out = [], i, salida;
    for (i = 0; i < n; i++) {
      if (i < base - 1) { out.push(null); continue; }
      salida = (i < o.semanasCerradas)
        ? (parseFloat((o.ventas || [])[i]) || 0)
        : (parseFloat((o.prevision || [])[i]) || 0);
      s = s + (parseFloat((o.envasado || [])[i]) || 0) - salida;
      out.push(s);
    }
    return out;
  }

  // Cuanto envasar: lo que se va a vender en el horizonte, mas un colchon
  // proporcional, menos lo que ya hay, redondeado para arriba al lote.
  function sugerido(o) {
    var h = Math.max(1, o.horizonte || 1);
    var desde = Math.max(1, o.desdeSemana || 1);
    var dem = 0, i;
    for (i = desde - 1; i < desde - 1 + h; i++) dem += (parseFloat((o.prevision || [])[i]) || 0);
    var colchon = (parseFloat(o.semanasSeguridad) || 0) * (dem / h);
    var bruto = Math.max(0, dem + colchon - (parseFloat(o.stockHoy) || 0));
    var lote = parseFloat(o.lote) || 1;
    if (lote <= 1) return Math.ceil(bruto);
    return Math.ceil(bruto / lote) * lote;
  }

  // ─── El plan de envasado, semana a semana ──────────────────────────
  // `sugerido` contesta "cuanto envasar AHORA". Para saber hasta que
  // semana alcanza la materia prima hace falta esa misma respuesta para
  // cada semana de lo que queda de temporada.
  //
  // La regla de decision de cada semana es `sugerido`, parada en esa
  // semana con el stock proyectado de esa semana. La respuesta a "cuanto
  // envasar" sigue estando escrita UNA sola vez: es la misma formula
  // aplicada 36 veces. Escribir aca una regla nueva dejaria al modulo con
  // dos respuestas para la misma pregunta, y tarde o temprano se
  // contradicen en la pantalla.
  //
  // El resultado es despareja a proposito: se envasa en multiplos de lote
  // cuando hace falta, no un poquito por semana.
  function planEnvasado(o) {
    var semanas = Math.max(0, parseFloat(o.semanas) || 0);
    var desde = Math.max(1, o.desdeSemana || 1);
    var prevision = o.prevision || [];
    var envasado = o.envasado || [];
    var out = [], i, disponible, env;
    for (i = 0; i < semanas; i++) out.push(0);

    // Stock al empezar la semana `desde`: lo que proyecta el modulo con lo
    // que YA se envaso. Nada de envasado futuro inventado todavia.
    var base = proyectarStock({
      stockInicial: o.stockInicial, ventas: o.ventas, envasado: envasado,
      prevision: prevision, semanasCerradas: o.semanasCerradas,
      semanaBase: o.semanaBase
    });
    // base[desde-2] puede venir en null si el conteo del stock es de esa
    // misma semana o posterior: ahi el punto de partida ES el conteo.
    var previo = desde >= 2 ? base[desde - 2] : null;
    var stock = (previo == null) ? (parseFloat(o.stockInicial) || 0) : previo;

    for (i = desde; i <= semanas; i++) {
      // Lo que ya hay mas lo que YA esta programado envasar esa semana:
      // sin sumarlo, el plan volveria a pedir una orden que ya existe.
      disponible = stock + (parseFloat(envasado[i - 1]) || 0);
      env = sugerido({
        prevision: prevision, desdeSemana: i, horizonte: o.horizonte,
        semanasSeguridad: o.semanasSeguridad, stockHoy: disponible, lote: o.lote
      });
      out[i - 1] = env;
      stock = disponible + env - (parseFloat(prevision[i - 1]) || 0);
    }
    return out;
  }

  // Un producto que vende menos que `umbral` por semana no admite
  // prevision semanal: el ruido es mas grande que la senal. Medido en los
  // datos reales, cuatro productos promedian entre 0,9 y 4,8 u/semana y
  // el siguiente hacia arriba promedia 32; el corte es limpio.
  // Se preve igual, pero la pantalla lo muestra por mes.
  function bajaRotacion(serie, umbral) {
    var a = serie || [];
    if (!a.length) return true;
    return (suma(a) / a.length) < (parseFloat(umbral) || 0);
  }

  // kg de materia prima. Un producto sin materia asignada o sin kg por
  // unidad NO se reparte a ningun lado ni se estima: se devuelve en
  // `sinAsignar` para que la pantalla lo cante. Adivinar aca termina en
  // una compra de toneladas equivocada.
  //
  // Los kg son el teorico puro: unidades x kg por unidad. Hubo un
  // `merma_pct` por producto que recargaba este numero y se saco porque
  // nadie lo iba a cargar, y un porcentaje que queda siempre en cero es
  // una perilla que hay que explicar cada vez sin que cambie nada.
  function kgMateria(productos, sugeridos) {
    var porMateria = {}, sinAsignar = [];
    (productos || []).forEach(function (p) {
      var u = parseFloat((sugeridos || {})[p.id]) || 0;
      var kgu = parseFloat(p.kg_mp_por_unidad) || 0;
      if (p.materia_id == null || kgu <= 0) { sinAsignar.push(p.id); return; }
      porMateria[p.materia_id] = (porMateria[p.materia_id] || 0) + u * kgu;
    });
    return { porMateria: porMateria, sinAsignar: sinAsignar };
  }

  return {
    lunesInicio: lunesInicio,
    semanaDe: semanaDe,
    semanasDeTemporada: semanasDeTemporada,
    suavizar: suavizar,
    crecimiento: crecimiento,
    prever: prever,
    proyectarStock: proyectarStock,
    sugerido: sugerido,
    planEnvasado: planEnvasado,
    bajaRotacion: bajaRotacion,
    kgMateria: kgMateria
  };
});
