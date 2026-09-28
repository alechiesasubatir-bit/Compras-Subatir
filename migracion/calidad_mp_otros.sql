-- ============================================================
--  Calidad MP: "Otros documentos" de cada materia prima.
--
--  · Tipo nuevo 'OTRO' en mp_documentos, con un nombre (titulo):
--    certificado kosher, declaracion de alergenos, etc.
--  · Proveedor opcional: vacio = vale para el producto, con todos
--    sus proveedores.
--  · Lo sube solo el admin, igual que FT/HDS/COA. Los archivos van
--    a la carpeta otro/ del bucket 'calidad-mp'; la misma funcion
--    decide la tabla y el bucket.
--
--  Correr DESPUES de calidad_mp_solo_admin.sql (o en lugar de el:
--  este tambien deja el COA solo para admin).
--  Idempotente. Correr en Supabase -> SQL Editor.
-- ============================================================

-- 1 . Nombre del documento
alter table public.mp_documentos add column if not exists titulo text;

-- 2 . Aceptar el tipo 'OTRO'. El check original se creo sin nombre
--     (Postgres le puso uno solo), asi que se busca por la columna
--     y se borra antes de poner el nuevo.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
     where con.conrelid = 'public.mp_documentos'::regclass
       and con.contype = 'c' and att.attname = 'tipo'
       -- solo los que miran UNICAMENTE tipo: mp_doc_mes_ck (tipo + mes) se queda
       and array_length(con.conkey, 1) = 1
  loop
    execute format('alter table public.mp_documentos drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.mp_documentos
  add constraint mp_doc_tipo_ck check (tipo in ('FT','HDS','COA','OTRO'));

-- Un "otro documento" sin nombre no se entiende en la lista
alter table public.mp_documentos drop constraint if exists mp_doc_titulo_ck;
alter table public.mp_documentos
  add constraint mp_doc_titulo_ck check (tipo <> 'OTRO' or coalesce(trim(titulo),'') <> '');

-- 3 . Quien puede subir: solo admin, los cuatro tipos
create or replace function public.puede_doc_mp(t text)
returns boolean language sql stable security definer set search_path = public as $$
  select t in ('FT','HDS','COA','OTRO') and public.is_admin();
$$;

-- 4 . Verificacion: tiene que dar titulo = 1 y otro_ok = true
select (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'mp_documentos'
           and column_name = 'titulo') as titulo,
       position('OTRO' in pg_get_constraintdef(
         (select oid from pg_constraint where conname = 'mp_doc_tipo_ck'
            and conrelid = 'public.mp_documentos'::regclass))) > 0 as otro_ok;
