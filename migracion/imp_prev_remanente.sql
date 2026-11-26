-- ============================================================
--  IMPORTACIONES · Subatir Consumo · columna "Remanente Fábrica"
--
--  Pedido del usuario (25/11/2026): unidades que ya llegaron a la
--  fábrica pero todavía no se usaron (ej.: un pallet de Furriol con
--  5 cajas de 300 u que se va gastando de a poco). Para la previsión
--  cuentan igual que el stock de Depósitos: se suman a lo disponible
--  y bajan lo que hay que pedir.
--
--  Se carga a mano, por corrida (como En tránsito): una corrida
--  nueva arranca en 0 porque lo de hace 4 meses ya se consumió.
--  Default 0: las corridas existentes no cambian su cuenta.
--  Las políticas RLS de imp_prev_datos ya cubren la columna nueva.
--
--  Idempotente. Correr en Supabase → SQL Editor ANTES de publicar
--  la versión que la usa (si no, en Subatir no se guarda nada).
-- ============================================================

alter table public.imp_prev_datos
  add column if not exists remanente_fabrica numeric not null default 0;

-- ── Control ─────────────────────────────────────────────────
-- Esperado: la columna existe y todas las filas en 0.
select c.linea, count(*) as filas, sum(d.remanente_fabrica) as remanente
  from public.imp_prev_datos d
  join public.imp_prev_corridas c on c.id = d.corrida_id
 group by c.linea
 order by c.linea;
