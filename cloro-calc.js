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

  return {
    lunesInicio: lunesInicio,
    semanaDe: semanaDe,
    semanasDeTemporada: semanasDeTemporada
  };
});
