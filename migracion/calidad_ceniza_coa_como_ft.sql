-- ============================================================
--  CALIDAD MP: UN COA CARGADO COMO FICHA TÉCNICA  ·  26/11/2026
--
--  Ceniza de soda · Quimica S.A. tiene dos "fichas técnicas" desde el
--  25/09: la 20 es la FT de verdad ("FTS Ceniza de soda.pdf") y la 19 es
--  la foto de un COA ("COA No_ 26L204.jpg"). Es el único FT/HDS repetido
--  de todo el archivo.
--
--  Mientras siga como FT, la próxima ficha técnica que se cargue de este
--  producto borra LAS DOS (las FT se reemplazan), y con ellas ese COA.
--
--  Esto la pasa a COA del lote 26L204, mes de septiembre. El archivo no
--  se toca.
--
--  Correr en Supabase → SQL Editor, de una sola vez.
-- ============================================================

begin;

select id, tipo, proveedor, lote, mes, nombre_archivo from public.mp_documentos where inventario_id = 42 order by id;

update public.mp_documentos
   set tipo = 'COA', lote = '26L204', mes = '2026-09-01'
 where id = 19 and tipo = 'FT' and nombre_archivo = 'COA No_ 26L204.jpg';

-- Después: 19 COA (lote 26L204), 20 FT, 108 HDS
select id, tipo, proveedor, lote, mes, nombre_archivo from public.mp_documentos where inventario_id = 42 order by id;

commit;
