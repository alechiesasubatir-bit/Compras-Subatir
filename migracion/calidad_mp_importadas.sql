-- ============================================================
--  Calidad MP · MP Importadas
--
--  Las materias primas importadas (las esencias de MERO AR) no estan
--  en el inventario como MP: viven en mp_articulos, por proveedor,
--  la misma lista que usa MP Importacion. Sus fichas tecnicas y
--  hojas de seguridad van a la MISMA tabla mp_documentos y al MISMO
--  bucket 'calidad-mp', colgadas del articulo importado en vez de la
--  ficha de Stock:
--
--    inventario_id  = null
--    mp_articulo_id = mp_articulos.id
--
--  Asi valen las mismas reglas que ya estan: sube y borra solo el
--  admin (puede_doc_mp), ver es para cualquier usuario autenticado,
--  y la pantalla de Calidad MP de Stock no las mezcla (filtra por
--  inventario_id).
--
--  set null y no cascade: borrar un articulo en MP Importacion no
--  puede llevarse sus papeles. Queda el nombre en 'articulo'.
--
--  Correr DESPUES de calidad_mp.sql. Idempotente.
--  Correr en Supabase -> SQL Editor.
-- ============================================================

alter table public.mp_documentos
  add column if not exists mp_articulo_id bigint
  references public.mp_articulos(id) on delete set null;

create index if not exists idx_mp_doc_imp on public.mp_documentos(mp_articulo_id);

-- Verificacion: tiene que dar columna = 1 y proveedores >= 1 (MERO AR)
select (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'mp_documentos'
           and column_name = 'mp_articulo_id') as columna,
       (select count(*) from public.mp_proveedores) as proveedores,
       (select count(*) from public.mp_articulos) as articulos;
