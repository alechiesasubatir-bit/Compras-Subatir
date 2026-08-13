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
