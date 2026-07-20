// ============================================================
//  SUBATIR — Configuración Supabase (cliente compartido)
//  Requiere cargar antes: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
//  El anon key es público por diseño; la seguridad la aplica RLS.
// ============================================================
window.SUPABASE_URL      = 'https://wbbscaitwdwhuufiiwsw.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndiYnNjYWl0d2R3aHV1Zmlpd3N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNDQyNzIsImV4cCI6MjA5OTgyMDI3Mn0.R-aZY2PtRkFoh_Ia-MTcZvMxHUgmMDbClAHcRZMeDeg';

window.SB = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'subatir_auth' }
});
