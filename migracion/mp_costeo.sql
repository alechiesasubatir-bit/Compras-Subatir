-- ============================================================
--  MP IMPORTACIÓN · Proforma de costos por OC
--
--  Cada OC de importación (mp_corridas.oc_numero) lleva su costeo:
--  precio FCA de cada artículo + gastos de importación. Hasta que el
--  despachante liquida (20 a 30 días después de la impo) los gastos
--  son ESTIMADOS: se toman de un costeo de referencia y se escalan en
--  proporción al valor FCA de la orden. Cuando llegan los números
--  reales se cargan sobre el mismo costeo y pasa a REAL.
--
--  Referencia: el último costeo REAL del proveedor; si todavía no hay
--  ninguno, mp_parametros.costeo_ref (sembrado con la factura 293).
--  El costeo GUARDA una copia de la referencia con la que se estimó,
--  para que una proforma ya emitida no cambie sola cuando se cargue
--  una liquidación real de otra orden.
--
--  Correr en Supabase → SQL Editor. Idempotente.
-- ============================================================

-- ── 1. Último precio FCA conocido de cada artículo ──────────
alter table public.mp_articulos add column if not exists precio_usd numeric;

-- ── 2. Referencia por defecto, por proveedor ────────────────
alter table public.mp_parametros add column if not exists costeo_ref jsonb;

-- ── 3. Costeo: uno por corrida (= por OC) ───────────────────
create table if not exists public.mp_costeos (
  corrida_id   bigint primary key references public.mp_corridas(id) on delete cascade,
  fecha_impo   date not null default current_date,
  estado       text not null default 'ESTIMADO',
  -- {"<articulo_id>": precio_usd} — el precio de ESTA orden, congelado
  precios      jsonb not null default '{}'::jsonb,
  -- La referencia con la que se estimó: {origen, fca, gastos:{concepto:usd}}
  ref          jsonb not null,
  -- Lo que liquida el despachante: {flete_int, seguro_int, ..., iva_imp, iva_ant}
  gastos_real  jsonb,
  real_at      timestamptz,
  real_by      text,
  nota         text,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now()
);
alter table public.mp_costeos drop constraint if exists mp_costeos_estado_check;
alter table public.mp_costeos add constraint mp_costeos_estado_check
  check (estado in ('ESTIMADO','REAL'));
-- REAL sin números reales sería una proforma "definitiva" vacía
alter table public.mp_costeos drop constraint if exists mp_costeos_real_check;
alter table public.mp_costeos add constraint mp_costeos_real_check
  check (estado <> 'REAL' or gastos_real is not null);

alter table public.mp_costeos enable row level security;
drop policy if exists p_mp_costeos_read on public.mp_costeos;
create policy p_mp_costeos_read on public.mp_costeos
  for select using (auth.role()='authenticated');
drop policy if exists p_mp_costeos_write on public.mp_costeos;
create policy p_mp_costeos_write on public.mp_costeos
  for all using (public.has_module('mp_importacion'))
  with check (public.has_module('mp_importacion'));
grant select, insert, update, delete on public.mp_costeos to authenticated;

-- ── 4. Semilla: referencia = costeo de la factura 293 ───────
--  Planilla "COSTO MEROAR S. A. F. 293": FCA 71.383,20; gastos sin IVA
--  4.184,90 (5,86% sobre FCA). T.C. 40,273.
update public.mp_parametros p set costeo_ref = jsonb_build_object(
    'origen', 'Factura 293 · MEROAR (25/09/2026)',
    'fca', 71383.20,
    'gastos', jsonb_build_object(
      'flete_int', 348.00, 'seguro_int', 69.00,
      'flete_nac', 302.00, 'seguro_nac', 46.00,
      'tributos', 2480.10, 'honorarios', 789.8022, 'gastos_gen', 150.00))
  from public.mp_proveedores v
 where v.id = p.proveedor_id and v.nombre = 'MERO AR' and p.costeo_ref is null;

-- ── 5. Semilla: precios FCA ─────────────────────────────────
--  Factura Meroar E 00101-00000293 + los 6 que pasó el usuario el 25/11
--  (Blemix, Manzana Verde, Vivex, Frasco 120 ml, Uva y Limón AV NEW).
update public.mp_articulos a set precio_usd = v.precio
  from (values
    ('761453',28.00),('761409',18.00),('761412',30.00),('762504',18.40),
    ('761396',21.20),('761410',24.00),('654500',21.00),('655843',23.60),
    ('761407',17.00),('653777',16.00),('761440',27.00),('761395',22.00),
    ('761441',30.00),('654606',25.00),('656270',26.04),('762753',21.90),
    ('761413',20.00),('655717',24.60),('762928',23.40),('763042',24.60),
    ('762950',27.50),('762853',26.00),('762863',23.20),
    ('656221',19.80),('6237',18.00),('654363',18.00),('151005',0.77),
    ('762869',18.00),('762864',18.00)
  ) as v(codigo,precio)
 where a.codigo = v.codigo
   and a.proveedor_id = (select id from public.mp_proveedores where nombre='MERO AR')
   and a.precio_usd is null;

-- ── 6. Costeo de OC-MEROAR-002 (impo hecha el 25/11/2026) ───
insert into public.mp_costeos (corrida_id, fecha_impo, estado, precios, ref, created_by)
select c.id, date '2026-11-25', 'ESTIMADO',
       (select coalesce(jsonb_object_agg(a.id::text, a.precio_usd), '{}'::jsonb)
          from public.mp_datos d join public.mp_articulos a on a.id = d.articulo_id
         where d.corrida_id = c.id and coalesce(d.compra_confirmada,0) > 0
           and a.precio_usd is not null),
       p.costeo_ref, 'migración'
  from public.mp_corridas c
  join public.mp_parametros p on p.proveedor_id = c.proveedor_id
 where c.oc_numero = 'OC-MEROAR-002'
on conflict (corrida_id) do nothing;

-- ── Controles ───────────────────────────────────────────────
--  Tiene que dar: 23 líneas, 23 con precio, FCA 94.109,00
select c.oc_numero, k.estado, k.fecha_impo,
       count(*)                                            as lineas,
       count(k.precios -> d.articulo_id::text)             as con_precio,
       round(sum(d.compra_confirmada * (k.precios ->> d.articulo_id::text)::numeric), 2) as fca
  from public.mp_costeos k
  join public.mp_corridas c on c.id = k.corrida_id
  join public.mp_datos d on d.corrida_id = k.corrida_id and coalesce(d.compra_confirmada,0) > 0
 group by c.oc_numero, k.estado, k.fecha_impo;
