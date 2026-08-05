-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — Consumo de Furriol a cero
--
--  Los artículos de tipo "Consumo" arrancan de cero en Furriol:
--  ese stock se va a cargar con los ingresos reales a medida que
--  entre la mercadería. El resto no se toca.
--
--  Qué queda en cero (9 renglones, 194.787 unidades):
--    220105 Gatillo Pulverizador Común rosca 28      49.900
--    220132 Tapas Alcoa Rosca 28                     47.660
--    220106 Gatillo Mini Trigger rosca 24            36.400
--    220040 Botella Vidrio Piramidal x 100 ml        16.200
--    220034 Botella PET x 250 ml c/ Mini trigger     12.160
--    220031 Botella PET x 100 ml (Green Oil)         11.220
--    220028 Frasco vidrio ámbar x 30 ml               9.830
--    220210 Envase Unicornio 30 mL                    9.767
--    220209 Tubo Kraft 5 x 16                         1.650
--
--  Qué NO se toca:
--    · Venta          — Furriol 415 u. / Artigas 1.657 u.
--    · Venta Piscina  — Furriol 1.684 u. / Artigas 96 u.
--    · Infraestructura — ya está en cero en los dos
--    · Consumo en ARTIGAS — ya está en cero, igual queda excluido
--
--  No deja movimiento en la bitácora a propósito: es el punto de
--  partida, no un ajuste de operación. La bitácora arranca limpia
--  con el primer ingreso real.
--
--  Correr UNA vez en Supabase → SQL Editor. Es idempotente.
-- ============================================================

-- ── 1. Antes: ver qué se va a tocar (opcional, sólo lee) ─────
-- select a.codigo, a.descripcion, s.cantidad
--   from public.imp_stock s
--   join public.imp_articulos a on a.id = s.articulo_id
--  where a.tipo = 'Consumo' and s.deposito = 'Furriol' and s.cantidad <> 0
--  order by s.cantidad desc;

-- ── 2. A cero ────────────────────────────────────────────────
update public.imp_stock s
   set cantidad = 0
  from public.imp_articulos a
 where a.id = s.articulo_id
   and a.tipo = 'Consumo'
   and s.deposito = 'Furriol'
   and s.cantidad <> 0;

-- ── 3. Después: cómo queda el stock por tipo y depósito ──────
select a.tipo,
       s.deposito,
       count(*) filter (where s.cantidad > 0) as articulos_con_stock,
       sum(s.cantidad)                        as unidades
  from public.imp_stock s
  join public.imp_articulos a on a.id = s.articulo_id
 group by 1, 2
 order by 1, 2;
-- Esperado después de correrlo:
--   Consumo         · Artigas 0 / Furriol 0
--   Infraestructura · Artigas 0 / Furriol 0
--   Venta           · Artigas 1.657 (7 art.) / Furriol 415 (2 art.)
--   Venta Piscina   · Artigas 96 (4 art.) / Furriol 1.684 (18 art.)
