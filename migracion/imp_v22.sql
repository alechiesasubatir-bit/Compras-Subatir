-- ============================================================
--  FIFO · la fecha del pallet llega a la pantalla de Solicitar
--
--  El que pide elige pallets concretos, pero no tenía cómo saber cuál
--  era el más viejo: la vista de disponibles no traía ninguna fecha y
--  la pantalla los ordenaba por ubicación. Con eso, que saliera primero
--  lo más viejo dependía de que alguien se acordara.
--
--  Esto sólo AGREGA dos columnas a la vista. No cambia qué pallets
--  aparecen ni toca una sola fila de datos.
--
--    created_at  → cuándo se armó el pallet
--    dias        → cuántos días hace, ya calculado, para no repetir
--                  la cuenta en cada pantalla
--
--  OJO con qué significa created_at: es la fecha en que se ARMÓ el
--  pallet, no en la que llegó la mercadería. Mientras se palletice más
--  o menos en el orden en que entra, alcanza. Si algún día se arma un
--  pallet con mercadería vieja que quedó suelta mucho tiempo, ese
--  pallet va a figurar como nuevo. Para eso haría falta marcar la
--  tanda de ingreso en el pallet, que es un cambio aparte.
--
--  Correr en Supabase → SQL Editor.
-- ============================================================

create or replace view public.imp_pallets_disponibles
with (security_invoker = true) as
select p.id, p.codigo, p.deposito, p.articulo_id,
       a.descripcion as articulo, a.codigo as art_codigo, a.tipo,
       p.unidades, p.cajas, p.estado,
       p.estanteria_id, e.nombre as estanteria, e.subdeposito_id,
       s.nombre as subdeposito,
       p.fila, p.columna,
       public.imp_ubic_txt2(p.estanteria_id, p.fila, p.columna, p.zona_id) as ubicacion,
       -- ── FIFO ──
       p.created_at,
       greatest(0, (current_date - p.created_at::date))::int as dias
  from public.imp_pallets p
  left join public.imp_articulos a on a.id = p.articulo_id
  left join public.imp_estanterias e on e.id = p.estanteria_id
  left join public.imp_subdepositos s on s.id = e.subdeposito_id
 where p.estado = 'ESTACIONADO'
   and p.destino is null
   and not exists (
     select 1 from public.imp_solicitud_items i
      where i.pallet_id = p.id and i.estado in ('PEDIDO','ENVIADO')
   );

-- Control: tienen que aparecer created_at y dias, y los pallets
-- ordenados del más viejo al más nuevo.
select codigo, articulo, deposito, created_at::date as armado, dias
  from public.imp_pallets_disponibles
 order by created_at asc
 limit 20;
