drop table if exists public.art_proveedor;
alter table public.inventario drop constraint if exists inventario_revisar_meses_ck;
alter table public.inventario
  drop column if exists seguimiento,
  drop column if exists revisar_cada_meses,
  drop column if exists proxima_revision,
  drop column if exists prov_auto_at,
  drop column if exists prov_auto_oc;
