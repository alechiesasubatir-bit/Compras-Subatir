-- ============================================================
--  PL-06 · Check List para la recepción de mercadería
--  Cada entrega (= recepción de un producto de una OC) guarda
--  su propio checklist de 8 puntos, más el N° de factura y el
--  N° de remito/guía que acompañan a esa entrega.
--
--  checklist = jsonb, array de 8 objetos:
--    [{"n":1,"conforme":"SI"|"NO"|"","obs":"texto"}, ...]
--  El texto del ítem NO se guarda: vive en el HTML (CHK_ITEMS)
--  para que un cambio de redacción no obligue a migrar datos.
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

alter table public.entregas
  add column if not exists factura   text,
  add column if not exists remito    text,
  add column if not exists checklist jsonb;

comment on column public.entregas.factura   is 'PL-06 · Factura N° de esta entrega';
comment on column public.entregas.remito    is 'PL-06 · Remito/Guía N° de esta entrega';
comment on column public.entregas.checklist is 'PL-06 · [{n,conforme,obs}] x8 puntos de control';

-- Verificación: las 3 columnas nuevas tienen que aparecer acá.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'entregas'
  and column_name in ('factura','remito','checklist')
order by column_name;
