-- ============================================================
--  Calidad MP: fichas tecnicas (FT), hojas de seguridad (HDS) y
--  certificados de analisis (COA) de las materias primas.
--
--  · FT, HDS y COA: por materia prima + proveedor. Los sube solo
--    admin (28/09/2026: antes el COA lo subia tambien Recepcion; ver
--    calidad_mp_solo_admin.sql). El modulo es un archivo, no reclama.
--  · Ver y descargar: cualquier usuario autenticado.
--
--  Los archivos van al bucket privado 'calidad-mp', en carpetas
--  ft/ hds/ coa/. La carpeta decide quien puede subir o borrar, con
--  la misma regla que la tabla: si una sola de las dos dejara pasar,
--  quedarian archivos sin fila o filas sin archivo.
--
--  Idempotente: correrlo dos veces no hace dano.
--  Correr en Supabase -> SQL Editor.
-- ============================================================

-- 1 . Quien puede escribir cada tipo
create or replace function public.puede_doc_mp(t text)
returns boolean language sql stable security definer set search_path = public as $$
  select t in ('FT','HDS','COA') and public.is_admin();
$$;

-- 2 . La tabla
create table if not exists public.mp_documentos (
  id             bigint generated always as identity primary key,
  -- set null y no cascade: borrar el articulo en Stock no puede
  -- llevarse los certificados. Queda el nombre en 'articulo'.
  inventario_id  bigint references public.inventario(id) on delete set null,
  articulo       text,
  tipo           text not null check (tipo in ('FT','HDS','COA')),
  proveedor      text,
  mes            date,          -- COA: dia 1 del mes de la fecha del documento
  lote           text,          -- COA, opcional
  revision       text,          -- FT/HDS: "Rev. 3", "v2024"...
  fecha_doc      date,          -- fecha que figura en el documento
  vence          date,          -- FT/HDS, opcional
  archivo        text not null, -- ruta dentro del bucket
  nombre_archivo text,
  bytes          integer,
  observaciones  text,
  subido_por     text,
  created_at     timestamptz not null default now(),
  constraint mp_doc_mes_ck check (tipo <> 'COA' or mes is not null)
);
create index if not exists idx_mp_doc_inv  on public.mp_documentos(inventario_id);
create index if not exists idx_mp_doc_mes  on public.mp_documentos(tipo, mes);

alter table public.mp_documentos enable row level security;

drop policy if exists p_mp_doc_read  on public.mp_documentos;
create policy p_mp_doc_read on public.mp_documentos
  for select using (auth.role() = 'authenticated');

drop policy if exists p_mp_doc_ins on public.mp_documentos;
create policy p_mp_doc_ins on public.mp_documentos
  for insert with check (public.puede_doc_mp(tipo));

drop policy if exists p_mp_doc_upd on public.mp_documentos;
create policy p_mp_doc_upd on public.mp_documentos
  for update using (public.puede_doc_mp(tipo)) with check (public.puede_doc_mp(tipo));

drop policy if exists p_mp_doc_del on public.mp_documentos;
create policy p_mp_doc_del on public.mp_documentos
  for delete using (public.puede_doc_mp(tipo));

-- 3 . El bucket (privado: se abre con URL firmada de 5 minutos)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('calidad-mp', 'calidad-mp', false, 20971520,
        array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- La primera carpeta de la ruta es el tipo: ft/, hds/ o coa/
create or replace function public.puede_archivo_mp(ruta text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.puede_doc_mp(upper((storage.foldername(ruta))[1]));
$$;

drop policy if exists p_calidad_mp_read on storage.objects;
create policy p_calidad_mp_read on storage.objects
  for select using (bucket_id = 'calidad-mp' and auth.role() = 'authenticated');

drop policy if exists p_calidad_mp_ins on storage.objects;
create policy p_calidad_mp_ins on storage.objects
  for insert with check (bucket_id = 'calidad-mp' and public.puede_archivo_mp(name));

drop policy if exists p_calidad_mp_del on storage.objects;
create policy p_calidad_mp_del on storage.objects
  for delete using (bucket_id = 'calidad-mp' and public.puede_archivo_mp(name));

-- 4 . Tiempo real: que la pantalla y el dashboard se enteren solos
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename = 'mp_documentos') then
    alter publication supabase_realtime add table public.mp_documentos;
  end if;
end $$;

-- 5 . Verificacion: tiene que dar 1 bucket y 4 politicas de tabla
select (select count(*) from storage.buckets where id = 'calidad-mp') as bucket,
       (select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'mp_documentos') as politicas;
