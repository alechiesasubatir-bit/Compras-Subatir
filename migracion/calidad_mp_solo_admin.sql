-- ============================================================
--  Calidad MP: todos los documentos (FT, HDS y COA) los sube
--  solo el administrador.
--
--  Antes el COA lo podia subir tambien quien tuviera el modulo
--  'recepcion' (COA mensual). Ahora Calidad MP es un archivo de
--  documentos independiente: el COA de cada recepcion lo dice el
--  Check List PL-06, no este modulo.
--
--  La funcion decide la tabla Y el bucket (las politicas de
--  storage pasan por puede_archivo_mp -> puede_doc_mp), asi que
--  alcanza con cambiarla aca.
--
--  Idempotente. Correr en Supabase -> SQL Editor.
-- ============================================================

create or replace function public.puede_doc_mp(t text)
returns boolean language sql stable security definer set search_path = public as $$
  select t in ('FT','HDS','COA') and public.is_admin();
$$;

-- Verificacion: la definicion ya no menciona 'recepcion' (tiene que dar false)
select position('recepcion' in pg_get_functiondef('public.puede_doc_mp(text)'::regprocedure)) > 0
       as recepcion_todavia_puede;
