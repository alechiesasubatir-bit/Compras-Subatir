-- ============================================================
--  MP IMPORTACIÓN · separar la historia en sus corridas reales
--
--  La carga inicial dejó UNA sola corrida que era una mezcla: el
--  consumo y las cantidades confirmadas de junio con el stock del
--  control de agosto. Son dos cosas distintas y así no se puede
--  comparar nada.
--
--  Queda dividido en tres, según la organización de la planilla:
--
--   1) 08/06/2026 · Compra confirmada  (hoja "080626")
--      La compra que se hizo, con las cantidades que se pidieron
--      de verdad: 4.770 kg. Queda CERRADA para que no se toque.
--
--   2) 27/08/2026 · Control intermedio (hoja "270826")
--      El seguimiento entre compras: mismo consumo, stock puesto al
--      día, sin cantidades confirmadas porque no se compró nada.
--      También CERRADA: es una foto.
--
--   3) Próxima compra · ABIERTA
--      Copia de la de junio, para armar el pedido que viene sin
--      pisar la historia. Renombrala y ponele la fecha que va.
--
--  Correr en Supabase → SQL Editor. Es idempotente: si ya se corrió,
--  no duplica nada.
-- ============================================================

do $$
declare
  v_prov  bigint;
  v_ctrl  bigint;   -- la corrida que ya existe → pasa a ser el control de agosto
  v_jun   bigint;
  v_prox  bigint;
  r       record;
  v_art   bigint;
begin
  select id into v_prov from public.mp_proveedores where nombre='MERO AR';
  if v_prov is null then raise exception 'No está el proveedor MERO AR'; end if;

  -- ── 1. La corrida que ya existe pasa a ser el CONTROL de agosto ──
  select id into v_ctrl from public.mp_corridas
   where proveedor_id=v_prov order by id limit 1;
  if v_ctrl is null then raise exception 'No hay ninguna corrida cargada'; end if;

  update public.mp_corridas
     set nombre='Control intermedio',
         fecha='2026-08-27',
         nota='Seguimiento entre compras: stock al día, sin pedido. Hoja 270826 de la planilla.',
         cerrada=true
   where id=v_ctrl;

  -- Un control no tiene compra confirmada: eso es de la corrida de junio
  update public.mp_datos set compra_confirmada=null where corrida_id=v_ctrl;

  -- Stock y consumo del 27/08. Las 4 filas de potes que no figuran acá
  -- (Cítrico AV, UVA AV, Limón AV y Tirillas) se dejan como están: no
  -- las pude leer de la planilla y es preferible conservar lo que hay
  -- antes que inventar un número.
  for r in
    select * from (values
      ('Esencia Acqua MEROAR',36.8,46.0,11.8),
      ('Esencia Arpegge MEROAR',134.1,44.0,34.8),
      ('Esencia Beatifull Clothes MEROAR',38.0,52.0,8.9),
      ('Esencia Blemix MEORAR',9.6,23.5,3.5),
      ('Esencia Bosque MEROAR',386.2,453.0,136.8),
      ('Esencia Chicle MEROAR',64.3,255.0,23.1),
      ('Esencia Citrico Limpiador MEROAR',189.9,282.0,69.3),
      ('Esencia Citrico Textil MEROAR',230.8,139.0,72.4),
      ('Esencia Coniglio Bebe MEROAR',152.1,174.0,51.0),
      ('Esencia DIALUX MEROAR',535.5,442.0,171.7),
      ('Esencia Eucalipto MEROAR',117.5,102.0,45.0),
      ('Esencia Lavanda Limpiador MEROAR',321.8,395.0,123.1),
      ('Esencia Lavanda Textil MEROAR',16.0,30.0,6.0),
      ('Esencia Lemmon & Fruit MEROAR',92.0,27.0,22.2),
      ('Esencia Lenin MEROAR',287.5,232.0,93.2),
      ('Esencia Limon TEXTIL Y DETER MEROAR',198.7,183.0,67.5),
      ('Esencia Manzana Verde MEROAR',48.0,164.0,24.2),
      ('Esencia Nivea MEROAR',43.2,40.0,14.2),
      ('Esencia SKIP MEROAR',255.2,281.0,94.0),
      ('Esencia Tentación de moras MEROAR',280.5,243.0,99.8),
      ('Esencia Uva MEROAR',54.8,42.0,15.9),
      ('Esencia Vainilla MEROAR',52.5,60.0,17.8),
      ('Esencia Vivex MEROAR',18.0,57.0,8.5),
      ('Esencia Erba Pura 2RB1 P5R1',80.0,10.0,6.7),
      ('Esencia Yara Y1R1',88.0,1.5,7.3),
      ('Esencia Asad 1S1D',88.0,0.0,7.3),
      ('Esencia Naranja Pimienta',47.1,12.0,3.9),
      ('Frasco Plastico 120 ml con tapa',750.0,720.0,102.0),
      ('Esencia Frutilla AV NEW',12.0,52.0,2.5),
      ('Esencia Chicle AV NEW',18.2,44.0,6.1)
    ) as t(nombre,c3m,stk,anual)
  loop
    select id into v_art from public.mp_articulos
     where proveedor_id=v_prov and nombre=r.nombre;
    if v_art is not null then
      update public.mp_datos
         set consumo_3m=r.c3m, stock_actual=r.stk, prom_anual=r.anual
       where corrida_id=v_ctrl and articulo_id=v_art;
    end if;
  end loop;

  -- ── 2. La compra del 08/06, con lo que se pidió de verdad ────────
  if not exists (select 1 from public.mp_corridas
                  where proveedor_id=v_prov and fecha='2026-06-08' and nombre='Compra confirmada') then
    insert into public.mp_corridas (proveedor_id,nombre,fecha,nota,cerrada,created_by)
      values (v_prov,'Compra confirmada','2026-06-08',
              'La compra que se hizo. Cantidades de la hoja CONF. COMPRA 080626: 4.770 kg.',
              true,'migración')
      returning id into v_jun;

    for r in
      select * from (values
        ('Esencia Acqua MEROAR',34.0,30.0,11.0,30.0),
        ('Esencia Arpegge MEROAR',86.0,60.0,31.0,90.0),
        ('Esencia Beatifull Clothes MEROAR',17.0,60.0,8.0,0.0),
        ('Esencia Blemix MEORAR',10.0,30.0,4.0,0.0),
        ('Esencia Bosque MEROAR',460.0,150.0,138.0,630.0),
        ('Esencia Chicle MEROAR',99.0,60.0,97.0,210.0),
        ('Esencia Citrico Limpiador MEROAR',248.0,90.0,72.0,330.0),
        ('Esencia Citrico Textil MEROAR',222.0,220.0,71.0,150.0),
        ('Esencia Coniglio Bebe MEROAR',178.0,30.0,53.0,240.0),
        ('Esencia DIALUX MEROAR',556.0,210.0,173.0,690.0),
        ('Esencia Eucalipto MEROAR',150.0,16.0,46.0,210.0),
        ('Esencia Lavanda Limpiador MEROAR',374.0,120.0,127.0,510.0),
        ('Esencia Lavanda Textil MEROAR',16.0,50.0,6.0,0.0),
        ('Esencia Lemmon & Fruit MEROAR',56.0,90.0,18.0,0.0),
        ('Esencia Lenin MEROAR',289.0,120.0,92.0,330.0),
        ('Esencia Limon TEXTIL Y DETER MEROAR',223.0,125.0,68.0,240.0),
        ('Esencia Manzana Verde MEROAR',122.0,210.0,24.0,0.0),
        ('Esencia Nivea MEROAR',32.0,60.0,13.0,0.0),
        ('Esencia SKIP MEROAR',300.0,240.0,100.0,240.0),
        ('Esencia Tentación de moras MEROAR',270.0,240.0,102.0,240.0),
        ('Esencia Uva MEROAR',50.0,60.0,14.0,30.0),
        ('Esencia Vainilla MEROAR',45.0,60.0,17.0,30.0),
        ('Esencia Vivex MEROAR',30.0,30.0,9.0,30.0),
        -- Las cuatro nuevas se compraron sin histórico de consumo
        ('Esencia Erba Pura 2RB1 P5R1',0.0,0.0,0.0,90.0),
        ('Esencia Yara Y1R1',0.0,0.0,0.0,90.0),
        ('Esencia Asad 1S1D',0.0,0.0,0.0,90.0),
        ('Esencia Naranja Pimienta',0.0,0.0,0.0,60.0),
        ('Frasco Plastico 120 ml con tapa',750.0,1000.0,102.0,0.0),
        ('Esencia Frutilla AV NEW',40.0,0.0,8.0,60.0),
        ('Esencia Chicle AV NEW',33.0,35.0,6.0,30.0),
        ('Esencia Citrico AV NEW',52.0,16.0,14.0,60.0),
        ('Esencia UVA AV NEW',28.0,6.0,5.0,30.0),
        ('Esencia Limon AV NEW',36.0,18.0,8.0,30.0),
        ('Tirillas 1 kg (350 Unid)',750.0,1050.0,102.0,0.0)
      ) as t(nombre,c3m,stk,anual,conf)
    loop
      select id into v_art from public.mp_articulos
       where proveedor_id=v_prov and nombre=r.nombre;
      if v_art is not null then
        insert into public.mp_datos (corrida_id,articulo_id,consumo_3m,stock_actual,prom_anual,compra_confirmada)
          values (v_jun,v_art,r.c3m,r.stk,r.anual,r.conf)
          on conflict (corrida_id,articulo_id) do nothing;
      end if;
    end loop;
  else
    select id into v_jun from public.mp_corridas
     where proveedor_id=v_prov and fecha='2026-06-08' and nombre='Compra confirmada';
  end if;

  -- ── 3. La próxima, abierta, para no volver a pisar la historia ───
  if not exists (select 1 from public.mp_corridas
                  where proveedor_id=v_prov and nombre='Próxima compra') then
    insert into public.mp_corridas (proveedor_id,nombre,fecha,nota,cerrada,created_by)
      values (v_prov,'Próxima compra',current_date,
              'Copia de la compra de junio para armar el pedido que viene. Renombrala y ponele la fecha.',
              false,'migración')
      returning id into v_prox;

    insert into public.mp_datos (corrida_id,articulo_id,consumo_3m,stock_actual,prom_anual,compra_confirmada)
      select v_prox, d.articulo_id, d.consumo_3m, d.stock_actual, d.prom_anual, null
        from public.mp_datos d where d.corrida_id=v_jun
      on conflict (corrida_id,articulo_id) do nothing;
  end if;
end $$;

-- ── Controles ───────────────────────────────────────────────
-- 1) Tres corridas, las dos históricas cerradas.
select c.fecha, c.nombre, c.cerrada,
       (select count(*) from public.mp_datos d where d.corrida_id=c.id) as articulos,
       (select coalesce(sum(d.compra_confirmada),0) from public.mp_datos d where d.corrida_id=c.id) as confirmado_kg
  from public.mp_corridas c
  join public.mp_proveedores p on p.id=c.proveedor_id
 where p.nombre='MERO AR'
 order by c.fecha;

-- 2) La del 08/06 tiene que dar 4.770 kg confirmados, y el control 0.
