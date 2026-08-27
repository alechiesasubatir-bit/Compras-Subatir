-- ============================================================
--  MP IMPORTACIÓN · separar la compra de junio del control de agosto
--
--  Hoy hay UNA sola corrida y es una mezcla: los datos son los del
--  control del 27/08 (hoja "270826") pero arrastra las cantidades
--  confirmadas de la compra del 08/06 (hoja "CONF. COMPRA 080626"),
--  y encima está fechada 08/06. Son dos momentos distintos pegados.
--
--  Queda así:
--
--   · La corrida que YA EXISTE pasa a ser el CONTROL DEL 27/08.
--     No se le toca un solo dato: los que tiene son los correctos.
--     Sólo cambia el nombre, la fecha y se le sacan las cantidades
--     confirmadas, que son de junio. Queda ABIERTA, que es la que
--     están usando.
--
--   · Se agrega la COMPRA DEL 08/06 como corrida aparte, con los
--     datos de la hoja 080626 y las cantidades que se pidieron de
--     verdad (4.770 kg). Queda CERRADA: es historia.
--
--  Correr en Supabase → SQL Editor. Es idempotente.
-- ============================================================

do $$
declare
  v_prov bigint;
  v_ctrl bigint;
  v_jun  bigint;
  r      record;
  v_art  bigint;
begin
  select id into v_prov from public.mp_proveedores where nombre='MERO AR';
  if v_prov is null then raise exception 'No está el proveedor MERO AR'; end if;

  -- ── 1. La corrida que existe ES el control del 27/08 ────────────
  --  Los datos ya son los de la hoja 270826 (verificado artículo por
  --  artículo), así que NO se tocan. Sólo se la identifica bien.
  select id into v_ctrl from public.mp_corridas
   where proveedor_id=v_prov order by id limit 1;
  if v_ctrl is null then raise exception 'No hay ninguna corrida cargada'; end if;

  update public.mp_corridas
     set nombre  = 'Control intermedio',
         fecha   = '2026-08-27',
         nota    = 'Seguimiento entre compras: stock al día. Hoja 270826 de la planilla.',
         cerrada = false          -- es la que está en uso
   where id = v_ctrl;

  -- ── 2. La compra del 08/06, como corrida aparte ─────────────────
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
  end if;
end $$;


-- ============================================================
--  El control va sin cantidades confirmadas
--
--  Las 4.770 kg son de la compra de junio y quedan guardadas en SU
--  corrida. Dejarlas también en el control hacía que la columna
--  "Dif." comparara la compra de junio contra el cálculo de agosto,
--  que no significa nada. Igual que la hoja 270826, que tiene esa
--  columna vacía.
--
--  Aplicado el 27/08/2026. Queda acá para que correr el archivo de
--  cero llegue al mismo estado.
-- ============================================================
update public.mp_datos set compra_confirmada = null
 where corrida_id = (select id from public.mp_corridas c
                      join public.mp_proveedores p on p.id=c.proveedor_id
                     where p.nombre='MERO AR' and c.nombre='Control intermedio');


-- ── Control ─────────────────────────────────────────────────
--  Tienen que quedar dos: la de junio cerrada con 4.770 kg
--  confirmados, y la de agosto abierta con el stock al día.
select c.fecha, c.nombre, c.cerrada,
       (select count(*) from public.mp_datos d where d.corrida_id=c.id) as articulos,
       (select round(sum(d.stock_actual),1) from public.mp_datos d where d.corrida_id=c.id) as stock_kg,
       (select coalesce(sum(d.compra_confirmada),0) from public.mp_datos d where d.corrida_id=c.id) as confirmado_kg
  from public.mp_corridas c
  join public.mp_proveedores p on p.id=c.proveedor_id
 where p.nombre='MERO AR'
 order by c.fecha;
