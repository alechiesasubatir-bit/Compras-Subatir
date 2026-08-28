-- ============================================================
--  MP IMPORTACIÓN · productos terminados con sus esencias
--
--  Una oferta del mes es siempre la misma receta: "Bactripro usa
--  limón y chicle, y sube el consumo tanto por ciento". Cargarla a
--  mano cada vez que la promoción se repite es trabajo repetido y,
--  peor, es la oportunidad de olvidarse una esencia o de poner otro %.
--
--  Se guarda una vez con el nombre del producto y después se aplica
--  al mes que toque.
--
--    mp_productos          el producto terminado (Bactripro)
--    mp_producto_esencias  qué esencias lleva y con qué % cada una
--
--  Y mp_ofertas guarda de qué producto salió cada fila, así se puede
--  ver de dónde vino y sacar todas juntas.
--
--  El producto es una PLANTILLA: cambiarlo no toca las ofertas ya
--  aplicadas. Si se corrige el % de Bactripro, el pedido de un mes
--  que ya se armó con el valor anterior no cambia solo — eso sería
--  reescribir una decisión que ya se tomó.
--
--  Correr en Supabase → SQL Editor.
-- ============================================================

create table if not exists public.mp_productos (
  id           bigint generated always as identity primary key,
  proveedor_id bigint not null references public.mp_proveedores(id) on delete cascade,
  nombre       text not null,
  nota         text,
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   text,
  unique (proveedor_id, nombre)
);

create table if not exists public.mp_producto_esencias (
  id          bigint generated always as identity primary key,
  producto_id bigint not null references public.mp_productos(id) on delete cascade,
  articulo_id bigint not null references public.mp_articulos(id) on delete cascade,
  pct         numeric not null default 0,
  unique (producto_id, articulo_id)
);
create index if not exists idx_mp_prod_esc on public.mp_producto_esencias(producto_id);

-- De qué producto salió cada oferta. Nulo = se cargó suelta a mano.
-- on delete set null: borrar la plantilla no borra la historia de lo
-- que ya se pidió con ella.
alter table public.mp_ofertas
  add column if not exists producto_id bigint;
do $$ begin
  alter table public.mp_ofertas add constraint mp_ofertas_producto_fk
    foreign key (producto_id) references public.mp_productos(id) on delete set null;
exception when duplicate_object then null; when others then null; end $$;

-- ── RLS: igual que el resto del módulo ──────────────────────
do $$
declare t text;
begin
  foreach t in array array['mp_productos','mp_producto_esencias'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists p_%I_read on public.%I;', t, t);
    execute format('create policy p_%I_read on public.%I for select using (auth.role()=''authenticated'');', t, t);
    execute format('drop policy if exists p_%I_write on public.%I;', t, t);
    execute format('create policy p_%I_write on public.%I for all using (public.has_module(''mp_importacion'')) with check (public.has_module(''mp_importacion''));', t, t);
  end loop;
end $$;

-- ── Control ─────────────────────────────────────────────────
select p.nombre,
       (select count(*) from public.mp_producto_esencias e where e.producto_id = p.id) as esencias
  from public.mp_productos p order by p.nombre;
