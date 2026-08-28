-- ============================================================
--  MP IMPORTACIÓN · ofertas del mes
--
--  Un producto en promoción se produce más, y eso consume más de las
--  esencias que lleva. Hasta ahora ese pico no entraba en la
--  previsión: se compraba contra el consumo histórico, que todavía no
--  lo refleja, y se llegaba corto justo el mes que más se necesitaba.
--
--  Se carga: MES + ESENCIA + % de aumento. Una fila por esencia y por
--  mes. Las ofertas duran un mes, así que el mes es la unidad.
--
--  CÓMO PEGA EN EL CÁLCULO — y esto es lo importante:
--  la compra cubre varios meses (3 por defecto), pero la oferta dura
--  UNO. Aplicarle el % al consumo proyectado inflaría los tres meses
--  y se compraría de más. En vez de eso, el aumento se suma sólo por
--  el mes que corresponde:
--
--     necesidad = proyectado × (meses_cobertura + Σ % de las ofertas
--                               cuyo mes cae dentro de la cobertura)
--
--  Ejemplo: 100 kg/mes proyectado, 3 meses de cobertura, una oferta de
--  +50% en uno de esos meses  →  100 × (3 + 0,5) = 350 kg, en lugar de
--  300 kg sin oferta o de 450 kg si el +50% se aplicara a los tres.
--
--  La ventana son los `meses_cobertura` meses que arrancan en el mes
--  de la corrida. Una oferta de un mes que ya pasó, o de uno posterior
--  a la ventana, no afecta ese pedido.
--
--  Correr en Supabase → SQL Editor.
-- ============================================================

create table if not exists public.mp_ofertas (
  id           bigint generated always as identity primary key,
  proveedor_id bigint not null references public.mp_proveedores(id) on delete cascade,
  articulo_id  bigint not null references public.mp_articulos(id)   on delete cascade,
  -- Siempre el día 1: la unidad es el mes, no el día
  mes          date   not null,
  pct          numeric not null default 0,
  nota         text,                       -- qué promoción lo motiva
  created_at   timestamptz not null default now(),
  created_by   text,
  -- Una esencia, un mes, una fila. Si hay dos promociones que la usan
  -- el mismo mes, se suma el % en esa fila y se aclara en la nota:
  -- dos filas serían dos verdades para el mismo dato.
  unique (articulo_id, mes)
);
create index if not exists idx_mp_ofertas_mes on public.mp_ofertas(proveedor_id, mes);

-- El día 1 se fuerza acá y no en la pantalla: si alguien inserta desde
-- otro lado, la ventana de cobertura tiene que seguir cerrando.
create or replace function public.mp_ofertas_dia1()
returns trigger language plpgsql as $$
begin
  new.mes := date_trunc('month', new.mes)::date;
  return new;
end $$;
drop trigger if exists trg_mp_ofertas_dia1 on public.mp_ofertas;
create trigger trg_mp_ofertas_dia1
  before insert or update on public.mp_ofertas
  for each row execute function public.mp_ofertas_dia1();

-- RLS: igual que el resto del módulo
alter table public.mp_ofertas enable row level security;
drop policy if exists p_mp_ofertas_read on public.mp_ofertas;
create policy p_mp_ofertas_read on public.mp_ofertas
  for select using (auth.role() = 'authenticated');
drop policy if exists p_mp_ofertas_write on public.mp_ofertas;
create policy p_mp_ofertas_write on public.mp_ofertas
  for all using (public.has_module('mp_importacion'))
  with check (public.has_module('mp_importacion'));

-- ── Control ─────────────────────────────────────────────────
select o.mes, a.nombre, o.pct, o.nota
  from public.mp_ofertas o
  join public.mp_articulos a on a.id = o.articulo_id
 order by o.mes desc, a.nombre;
