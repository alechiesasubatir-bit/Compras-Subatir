// ============================================================
//  SUBATIR — Base compartida (cliente Supabase + ajustes de pantalla)
//
//  Es el primer script que cargan TODAS las paginas de las dos apps
//  (Compras y Depositos), asi que ademas del cliente vive aca lo que
//  tiene que valer igual en todos lados.
//
//  Requiere cargar antes: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
//  El anon key es publico por diseño; la seguridad la aplica RLS.
// ============================================================
window.SUPABASE_URL      = 'https://wbbscaitwdwhuufiiwsw.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndiYnNjYWl0d2R3aHV1Zmlpd3N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNDQyNzIsImV4cCI6MjA5OTgyMDI3Mn0.R-aZY2PtRkFoh_Ia-MTcZvMxHUgmMDbClAHcRZMeDeg';

window.SB = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'subatir_auth' }
});

// ------------------------------------------------------------
//  Leer TODAS las filas de una consulta
//
//  Supabase devuelve como mucho 1000 filas por consulta y NO avisa
//  cuando corta: la pantalla suma de menos y parece que anda. Con 788
//  lineas de OC y 950 semanas de venta de cloro (30/09/2026) estabamos
//  a punto de pasarlo. Esto pide de a 1000 hasta que vuelve una pagina
//  incompleta.
//
//  Uso:  SB.todo(function () { return SB.from('x').select('*').eq(...).order(...); })
//        -> Promise<{ data, error }>, lo mismo que una consulta comun.
//
//  - Se pasa una FUNCION que arma la consulta porque cada pagina
//    necesita una consulta nueva: un builder de Supabase no se reusa.
//  - Se agrega order('id') al final como desempate. Sin un orden unico
//    dos paginas pueden repetir o saltearse filas. El orden que ya
//    traiga la consulta sigue mandando. Para una tabla sin columna id:
//    SB.todo(fabrica, { sinId: true }) (y que la consulta ya ordene).
//  - Si una pagina falla, devuelve el error y data null: una lista a
//    medias es peor que ninguna, porque no se nota.
//  - PASO tiene que ser igual al "Max rows" del proyecto (API settings
//    de Supabase, 1000 por defecto). Si alguien lo baja, bajarlo aca.
// ------------------------------------------------------------
window.SB.todo = function (fabrica, opts) {
  var PASO = 1000, sinId = !!(opts && opts.sinId), filas = [];
  function pagina(desde) {
    var q = fabrica();
    if (!sinId) q = q.order('id', { ascending: true });
    return q.range(desde, desde + PASO - 1).then(function (r) {
      if (r.error) return { data: null, error: r.error };
      var lote = r.data || [];
      filas = filas.concat(lote);
      return lote.length === PASO ? pagina(desde + PASO) : { data: filas, error: null };
    });
  }
  return pagina(0);
};

// ------------------------------------------------------------
//  Sin zoom con los dedos
//
//  En el deposito se opera con guantes y el telefono en una mano: el
//  pellizco sale sin querer y deja la pantalla corrida, con la barra
//  de acciones fuera de vista. Como el diseño ya es responsive, el
//  zoom no suma nada y molesta.
//
//  Hacen falta las tres capas porque cada navegador escucha una:
//   1) el meta viewport (en cada HTML) -> Chrome / Android
//   2) touch-action -> saca el doble-toque, que es el otro zoom
//   3) los eventos gesture* -> Safari, que ignora el meta viewport
//      salvo cuando la app esta instalada en la pantalla de inicio
//
//  NO se toca el zoom de escritorio (Ctrl + rueda, Ctrl +/-): ahi no
//  estorba y hay gente que lo necesita para leer las tablas.
// ------------------------------------------------------------
(function () {
  var st = document.createElement('style');
  // pan-x pan-y = se puede arrastrar para scrollear, no pellizcar.
  // Los canvas que necesitan otro comportamiento ya declaran el suyo
  // y ganan por especificidad.
  st.textContent = 'html,body{touch-action:pan-x pan-y}';
  (document.head || document.documentElement).appendChild(st);

  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false });
  });
})();
