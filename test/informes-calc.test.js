const { test } = require('node:test');
const assert = require('node:assert');
const { Informes: I } = require('../informes-calc.js');

const HOY = '2026-09-30';
const oc = (o) => Object.assign({
  id: 1, fecha: '2026-09-01', n_orden: '100', proveedor: 'Coltray', cantidad: 10,
  descripcion: 'Bicarbonato', moneda: 'U$S', precio_un: 2, s_iva: 20, f_recepcion: null,
  demora_dias: null, inventario_id: null, conforme: null, coa: null
}, o);

test('estado de linea: entregas parciales y fecha en que se completo', () => {
  const p = oc({ cantidad: 10 });
  assert.strictEqual(I.estadoLinea(p, []).estado, 'PENDIENTE');
  const par = I.estadoLinea(p, [{ cantidad: 4, fecha: '2026-09-05' }]);
  assert.strictEqual(par.estado, 'PARCIAL');
  assert.strictEqual(par.saldo, 6);
  const comp = I.estadoLinea(p, [{ cantidad: 6, fecha: '2026-09-09' }, { cantidad: 4, fecha: '2026-09-05' }]);
  assert.strictEqual(comp.estado, 'COMPLETA');
  assert.strictEqual(comp.completa, '2026-09-09');
  assert.strictEqual(comp.primera, '2026-09-05');
});

test('estado de linea: recibida al viejo estilo (fecha sin entregas) cuenta entera', () => {
  const st = I.estadoLinea(oc({ f_recepcion: '2026-09-03' }), []);
  assert.strictEqual(st.estado, 'COMPLETA');
  assert.strictEqual(st.recibido, 10);
  assert.strictEqual(st.completa, '2026-09-03');
  assert.strictEqual(I.estadoLinea(oc({ f_recepcion: '0000-00-00' }), []).estado, 'PENDIENTE');
});

test('compras: rango con hasta incluido, monedas separadas y pendiente prorrateado', () => {
  const d = {
    pedidos: [
      oc({ id: 1, fecha: '2026-08-31' }),                               // fuera
      oc({ id: 2, fecha: '2026-09-01', s_iva: 100, cantidad: 10 }),
      oc({ id: 3, fecha: '2026-09-30', moneda: '$', s_iva: 5000, n_orden: '101' })
    ],
    entregas: [{ pedido_id: 2, cantidad: 4, fecha: '2026-09-10' }]
  };
  const r = I.compras(d, { desde: '2026-09-01', hasta: '2026-09-30' });
  assert.strictEqual(r.kpis.lineas, 2);
  assert.strictEqual(r.kpis.ordenes, 2);
  assert.strictEqual(r.kpis.netoUSD, 100);
  assert.strictEqual(r.kpis.netoUYU, 5000);
  assert.strictEqual(r.kpis.pendUSD, 60);          // faltan 6 de 10
  assert.strictEqual(r.kpis.pendUYU, 5000);
});

test('compras: Pedidos Varios entran solo si se piden, y los anulados nunca', () => {
  const d = {
    pedidos: [],
    varios: [
      { id: 1, fecha: '2026-09-02', proveedor: 'Ofi', moneda: '$', subtotal: 300, total: 366, estado: 'RECIBIDO' },
      { id: 2, fecha: '2026-09-02', proveedor: 'Ofi', moneda: '$', subtotal: 50, estado: 'ANULADO' }
    ],
    variosItems: [{ pedido_id: 1, articulo: 'Resmas', cantidad: 10 }]
  };
  assert.strictEqual(I.compras(d, {}).kpis.lineas, 0);
  const r = I.compras(d, { varios: true });
  assert.strictEqual(r.kpis.lineas, 1);
  assert.strictEqual(r.kpis.netoUYU, 300);
  assert.strictEqual(r.filas[0].desc, 'Resmas');
});

test('filtros: proveedor y texto ignoran mayusculas y tildes', () => {
  const d = { pedidos: [oc({ proveedor: 'Química Oriental', descripcion: 'Ácido Cítrico' })] };
  assert.strictEqual(I.compras(d, { prov: 'QUIMICA ORIENTAL' }).kpis.lineas, 1);
  assert.strictEqual(I.compras(d, { q: 'acido cit' }).kpis.lineas, 1);
  assert.strictEqual(I.compras(d, { q: 'soda' }).kpis.lineas, 0);
});

test('agrupar por articulo no mezcla monedas y saca precio promedio', () => {
  const lineas = I.lineasCompra({ pedidos: [
    oc({ id: 1, cantidad: 10, s_iva: 20 }), oc({ id: 2, cantidad: 30, s_iva: 90, n_orden: '2' }),
    oc({ id: 3, moneda: '$', cantidad: 5, s_iva: 500 })
  ] }, {});
  const g = I.agruparCompras(lineas, 'art');
  assert.strictEqual(g.length, 2);
  const usd = g.find((x) => x.mon === 'USD');
  assert.strictEqual(usd.cant, 40);
  assert.strictEqual(usd.precioProm, 110 / 40);
  assert.strictEqual(usd.nOrdenes, 2);
});

test('cumplimiento: a tiempo, tarde y vencida sin llegar', () => {
  const d = {
    pedidos: [
      oc({ id: 1, fecha: '2026-09-01', demora_dias: 10 }),   // llega el 8: a tiempo (7 dias)
      oc({ id: 2, fecha: '2026-09-01', demora_dias: 5 }),    // llega el 20: tarde
      oc({ id: 3, fecha: '2026-09-01', demora_dias: 5 })     // no llego y vencio el 6
    ],
    entregas: [
      { pedido_id: 1, cantidad: 10, fecha: '2026-09-08', conforme: 'SI', coa: 'SI' },
      { pedido_id: 2, cantidad: 10, fecha: '2026-09-20', conforme: 'NO', coa: 'SI' }
    ]
  };
  const r = I.cumplimiento(d, {}, HOY);
  const x = r.filas[0];
  assert.strictEqual(x.aTiempo, 1);
  assert.strictEqual(x.tarde, 2);
  assert.strictEqual(x.vencidas, 1);
  assert.strictEqual(x.demoraReal, (7 + 19) / 2);
  assert.strictEqual(x.pctConforme, 50);
  assert.strictEqual(x.pctCoa, 100);
});

test('evolucion de precios: primera contra ultima compra y contra la lista', () => {
  const d = {
    pedidos: [
      oc({ id: 1, fecha: '2026-03-01', precio_un: 2 }),
      oc({ id: 2, fecha: '2026-09-01', precio_un: 2.5 }),
      oc({ id: 3, fecha: '2026-06-01', precio_un: 1.8 })
    ],
    precios: [{ articulo: 'bicarbonato', proveedor: 'COLTRAY', precio_usd: 2, fecha_actualizado: '2026-01-01' }]
  };
  const x = I.evolucionPrecios(d, {}).filas[0];
  assert.strictEqual(x.compras, 3);
  assert.strictEqual(x.primerPrecio, 2);
  assert.strictEqual(x.ultimoPrecio, 2.5);
  assert.strictEqual(x.min, 1.8);
  assert.strictEqual(x.variacion, 25);
  assert.strictEqual(x.lista, 2);
  assert.strictEqual(x.difLista, 25);
});

test('lista de precios: mejor precio solo dentro de la misma moneda', () => {
  const d = {
    pedidos: [],
    precios: [
      { id: 1, articulo: 'Soda', proveedor: 'A', precio_usd: 1.2, fecha_actualizado: '2026-09-01' },
      { id: 2, articulo: 'Soda', proveedor: 'B', precio_usd: 1.0, fecha_actualizado: '2025-01-01' },
      { id: 3, articulo: 'Soda', proveedor: 'C', precio_pesos: 30 }
    ]
  };
  const r = I.listaPrecios(d, { desde: '2026-09-01', hasta: HOY }, HOY);
  const a = r.filas.find((x) => x.prov === 'A');
  const b = r.filas.find((x) => x.prov === 'B');
  const c = r.filas.find((x) => x.prov === 'C');
  assert.strictEqual(a.nProvs, 3);
  assert.ok(Math.abs(a.sobreMejor - 20) < 1e-9);
  assert.strictEqual(b.esMejor, true);
  assert.strictEqual(c.mejor, 30);
  assert.strictEqual(c.esMejor, false);                  // solo hay uno en pesos
  assert.strictEqual(r.kpis.actualizados, 1);
  assert.strictEqual(r.kpis.viejos, 2);                  // B viejo, C sin fecha
});

test('stock: cruza por id de inventario o por nombre, y valoriza al ultimo precio', () => {
  const d = {
    inventario: [
      { id: 7, descripcion: 'Bicarbonato', inventario: 5, stock_minimo: 10, consumo_mensual: 10 },
      { id: 8, descripcion: 'Soda', inventario: 0 }
    ],
    pedidos: [
      oc({ id: 1, fecha: '2026-09-02', inventario_id: 7, precio_un: 2, cantidad: 10 }),
      oc({ id: 2, fecha: '2026-08-01', descripcion: 'bicarbonato', precio_un: 1.5, cantidad: 3, f_recepcion: '2026-08-05' })
    ],
    entregas: [{ pedido_id: 1, cantidad: 4, fecha: '2026-09-10' }]
  };
  const r = I.stock(d, { desde: '2026-09-01', hasta: HOY }, (id) => (id === 7 ? 6 : 0));
  const b = r.filas.find((x) => x.id === 7);
  assert.strictEqual(b.estado, 'BAJO MÍNIMO');
  assert.strictEqual(b.comprado, 10);          // la de agosto queda fuera
  assert.strictEqual(b.recibido, 4);
  assert.strictEqual(b.precioRef, 2);          // la mas nueva
  assert.strictEqual(b.valorUSD, 10);
  assert.strictEqual(b.cobertura, 0.5);
  assert.strictEqual(b.pendiente, 6);
  assert.strictEqual(r.filas[0].estado, 'SIN STOCK'); // los criticos primero
  assert.strictEqual(I.criticos(r.filas).length, 2);
});

test('cloro: las ventas se ubican por el lunes de su semana y se comparan 52 semanas atras', () => {
  const d = {
    clTemporadas: [
      { id: 1, fecha_ini: '2025-08-01' },   // viernes -> semana 1 arranca lunes 28/7/2025
      { id: 2, fecha_ini: '2024-08-01' }    // jueves  -> semana 1 arranca lunes 29/7/2024
    ],
    clMaterias: [{ id: 1, nombre: 'Tricloro' }],
    clProductos: [{ id: 5, nombre: 'Pastilla 200g', materia_id: 1, kg_mp_por_unidad: 0.2, orden: 1 }],
    clVentas: [
      { temporada_id: 1, producto_id: 5, semana: 2, unidades: 100 },  // lunes 4/8/2025
      { temporada_id: 1, producto_id: 5, semana: 3, unidades: 50 },   // lunes 11/8/2025 (fuera)
      { temporada_id: 2, producto_id: 5, semana: 2, unidades: 80 }    // lunes 5/8/2024
    ],
    clEnvasado: [{ producto_id: 5, fecha: '2025-08-06', cantidad: 500 }]
  };
  const r = I.cloro(d, { desde: '2025-08-04', hasta: '2025-08-10' });
  const x = r.filas[0];
  assert.strictEqual(x.vendido, 100);
  assert.strictEqual(x.vendidoAnt, 80);
  assert.strictEqual(x.variacion, 25);
  assert.strictEqual(x.kgEnvasados, 100);
  const m = I.cloroPorMateria(r.filas)[0];
  assert.strictEqual(m.kgVendidos, 20);
  assert.strictEqual(m.kgVendidosAnt, 16);
});

test('depositos: movimientos por articulo, ajuste neto y UBICACION fuera', () => {
  const d = {
    impArticulos: [{ id: 1, descripcion: 'Tapa', proveedor: 'X' }],
    impMovimientos: [
      { articulo_id: 1, tipo: 'INGRESO', deposito: 'Furriol', unidades: 1000, created_at: '2026-09-10T15:00:00' },
      { articulo_id: 1, tipo: 'AJUSTE', deposito: 'Furriol', unidades: 50, stock_antes: 1000, stock_despues: 950, created_at: '2026-09-11T15:00:00' },
      { articulo_id: 1, tipo: 'UBICACION', deposito: 'Furriol', unidades: 1000, created_at: '2026-09-11T15:00:00' },
      { articulo_id: 1, tipo: 'INGRESO', deposito: 'Furriol', unidades: 7, created_at: '2026-08-01T15:00:00' }
    ],
    impPallets: [{ codigo: 'P1', articulo_id: 1, unidades: 500, origen: 'Furriol', destino: 'Artigas',
                   salida_at: '2026-09-12T10:00:00', llegada_at: '2026-09-12T16:00:00' }],
    impSolicitudes: [{ id: 1, created_at: '2026-09-12T08:00:00', entregada_at: '2026-09-12T10:30:00', origen: 'Furriol', destino: 'Artigas' }]
  };
  const r = I.depositos(d, { desde: '2026-09-01', hasta: HOY });
  assert.strictEqual(r.filas.length, 1);
  assert.strictEqual(r.filas[0].INGRESO, 1000);
  assert.strictEqual(r.filas[0].AJUSTE, -50);
  assert.strictEqual(r.kpis.movimientos, 2);
  assert.strictEqual(r.kpis.transitoProm, 6);
  assert.strictEqual(r.kpis.atencionProm, 2.5);
  assert.strictEqual(I.depositos(d, { deposito: 'Artigas' }).kpis.movimientos, 0);
});

test('periodos rapidos', () => {
  assert.deepStrictEqual(I.periodo('mes', '2026-09-30'), { desde: '2026-09-01', hasta: '2026-09-30' });
  assert.deepStrictEqual(I.periodo('mesAnt', '2026-01-15'), { desde: '2025-12-01', hasta: '2025-12-31' });
  assert.deepStrictEqual(I.periodo('trimestre', '2026-08-20'), { desde: '2026-07-01', hasta: '2026-08-20' });
  assert.deepStrictEqual(I.periodo('anio', '2026-08-20'), { desde: '2026-01-01', hasta: '2026-08-20' });
});

test('una orden se cuenta por proveedor: numeros repetidos entre proveedores son dos OC', () => {
  const d = { pedidos: [
    oc({ id: 1, n_orden: '575', proveedor: 'Benzo' }), oc({ id: 2, n_orden: '575', proveedor: 'Nesta' }),
    oc({ id: 3, n_orden: '575', proveedor: 'Benzo', descripcion: 'Otro' }),
    oc({ id: 4, n_orden: '-', proveedor: 'Enzur' }), oc({ id: 5, n_orden: '-', proveedor: 'Enzur' })
  ] };
  const r = I.compras(d, {});
  assert.strictEqual(r.kpis.ordenes, 4);   // 575 Benzo, 575 Nesta, y dos sin numero
  const porProv = I.agruparCompras(r.filas, 'prov');
  assert.strictEqual(porProv.reduce((s, x) => s + x.nOrdenes, 0), r.kpis.ordenes);
});

test('cumplimiento: una recepcion anterior a la OC es fecha mal cargada y no entra en promedios', () => {
  const d = { pedidos: [
    oc({ id: 1, fecha: '2026-04-13', demora_dias: 5, f_recepcion: '2006-04-14' }),
    oc({ id: 2, fecha: '2026-04-13', demora_dias: 5, f_recepcion: '2026-04-16' })
  ] };
  const x = I.cumplimiento(d, {}, HOY).filas[0];
  assert.strictEqual(x.aRevisar, 1);
  assert.strictEqual(x.demoraReal, 3);
  assert.strictEqual(x.aTiempo, 1);
  assert.strictEqual(x.tarde, 0);
});

test('infraestructura: fecha de despacho, sucursal rotulada, cancelados fuera, filtros', () => {
  const d = {
    impArticulos: [{ id: 128, proveedor: 'Rack' }, { id: 129, proveedor: 'Otro' }],
    impInfra: [
      { solicitud_id: 36, pedido_at: '2026-08-27T12:00:00', despachado_at: '2026-09-02T16:27:00', articulo: 'Chapa', codigo: '490079',
        unidades: 2, origen: 'Furriol', destino: 'Artigas', destino_tipo: 'Depósito', motivo: 'Fabrica Diego', estado: 'ENTREGADO', articulo_id: 128 },
      { solicitud_id: 50, pedido_at: '2026-10-06T10:00:00', despachado_at: null, articulo: 'Parante', codigo: '490078',
        unidades: 4, origen: 'Furriol', destino: 'Centro', destino_tipo: 'Sucursal', responsable: 'Ana', motivo: 'gondola', estado: 'PEDIDO', articulo_id: 129 },
      { solicitud_id: 51, pedido_at: '2026-10-06T10:00:00', estado: 'CANCELADO', articulo_id: 129 }
    ]
  };
  const todo = I.infraestructura(d, {});
  assert.deepStrictEqual(todo.map((x) => [x.pedido, x.destino, x.estado]),
    [[50, 'Sucursal Centro', 'Pedido'], [36, 'Artigas', 'Entregado']]);
  // Cuenta la fecha de despacho, no la del pedido
  assert.strictEqual(I.infraestructura(d, { desde: '2026-08-25', hasta: '2026-08-31' }).length, 0);
  assert.strictEqual(I.infraestructura(d, { desde: '2026-09-01', hasta: '2026-09-05' }).length, 1);
  assert.strictEqual(I.infraestructura(d, { prov: 'Rack' }).length, 1);
  assert.strictEqual(I.infraestructura(d, { q: 'diego' })[0].pedido, 36);
  assert.strictEqual(I.infraestructura(d, { deposito: 'Centro' })[0].pedido, 50);
});

// Infraestructura: tres artículos, carga inicial el 28/08 y salidas por pedido
const infraDatos = () => ({
  impArticulos: [
    { id: 128, tipo: 'Infraestructura', codigo: '490079', descripcion: 'Estanteria Picking Chapa Estante 2m x 60cm (x unidad )', proveedor: 'Subatir' },
    { id: 129, tipo: 'Infraestructura', codigo: '490078', descripcion: 'Estanteria Picking Parante 2m x unidad (por  unidad)', proveedor: 'Subatir' },
    { id: 5, tipo: 'Venta', codigo: '1', descripcion: 'Tapa', proveedor: 'Subatir' }
  ],
  impMovimientos: [
    { id: 1, articulo_id: 128, tipo: 'INGRESO', deposito: 'Furriol', unidades: 600, created_at: '2026-08-28T15:27:00' },
    { id: 2, articulo_id: 129, tipo: 'INGRESO', deposito: 'Furriol', unidades: 592, created_at: '2026-08-28T15:30:00' },
    { id: 3, articulo_id: 5, tipo: 'INGRESO', deposito: 'Furriol', unidades: 999, created_at: '2026-08-28T15:30:00' },
    { id: 4, articulo_id: 128, tipo: 'SALIDA', deposito: 'Furriol', destino: 'Minas', unidades: 2, created_at: '2026-09-02T16:27:00', nota: 'Infraestructura · pedido #36 · sin pallet' },
    { id: 5, articulo_id: 129, tipo: 'SALIDA', deposito: 'Furriol', destino: 'Minas', unidades: 14, created_at: '2026-09-02T16:27:00', nota: 'Infraestructura · pedido #36 · sin pallet' },
    { id: 6, articulo_id: 129, tipo: 'UBICACION', deposito: 'Furriol', unidades: 578, created_at: '2026-09-03T10:00:00' },
    { id: 7, articulo_id: 129, tipo: 'SALIDA', deposito: 'Furriol', destino: 'Centro', unidades: 16, created_at: '2026-10-06T12:13:00', nota: 'Infraestructura · pedido #48 · sin pallet' },
    { id: 8, articulo_id: 128, tipo: 'AJUSTE', deposito: 'Furriol', unidades: 3, stock_antes: 598, stock_despues: 595, created_at: '2026-10-07T09:00:00' }
  ],
  impStock: [
    { articulo_id: 128, deposito: 'Furriol', cantidad: 595 }, { articulo_id: 128, deposito: 'Artigas', cantidad: 0 },
    { articulo_id: 129, deposito: 'Furriol', cantidad: 562 }
  ],
  impInfra: [
    { solicitud_id: 36, articulo_id: 128, unidades: 2, origen: 'Furriol', destino: 'Minas', destino_tipo: 'Sucursal', responsable: 'Diego', motivo: 'Reforma', despachado_at: '2026-09-02T16:27:00', estado: 'ENTREGADO' },
    { solicitud_id: 36, articulo_id: 129, unidades: 14, origen: 'Furriol', destino: 'Minas', destino_tipo: 'Sucursal', responsable: 'Diego', motivo: 'Reforma', despachado_at: '2026-09-02T16:27:00', estado: 'ENTREGADO' },
    { solicitud_id: 48, articulo_id: 129, unidades: 16, origen: 'Furriol', destino: 'Centro', destino_tipo: 'Sucursal', responsable: 'Guillermo', motivo: 'Local', despachado_at: '2026-10-06T12:13:00', estado: 'ENTREGADO' },
    { solicitud_id: 53, articulo_id: 128, unidades: 10, origen: 'Furriol', destino: 'Artigas', destino_tipo: 'Depósito', estado: 'PEDIDO' },
    { solicitud_id: 54, articulo_id: 128, unidades: 7, origen: 'Furriol', destino: 'Centro', destino_tipo: 'Sucursal', despachado_at: '2026-10-08T10:00:00', estado: 'CANCELADO' }
  ]
});

test('infra saldos: inicial antes del periodo, entradas/salidas/ajustes adentro, cierre y hoy', () => {
  const d = infraDatos();
  const r = I.infraSaldos(d, { desde: '2026-09-01', hasta: '2026-09-30' });
  assert.deepStrictEqual(r.map((x) => [x.corto, x.inicial, x.ingresos, x.salidas, x.ajustes, x.final, x.nPedidos]),
    [['Chapa Estante 2m x 60cm', 600, 0, 2, 0, 598, 1], ['Parante 2m x unidad', 592, 0, 14, 0, 578, 1]]);
  // Sin fechas: todo es movimiento del período y el cierre tiene que dar lo que dice imp_stock
  const t = I.infraSaldos(d, {});
  assert.deepStrictEqual(t.map((x) => [x.inicial, x.ingresos, x.salidas, x.ajustes, x.final, x.hoy]),
    [[0, 600, 2, -3, 595, 595], [0, 592, 30, 0, 562, 562]]);
  // Lo pedido sin despachar descuenta del disponible; lo cancelado no
  assert.strictEqual(t[0].pedido, 10);
  assert.strictEqual(t[0].disponible, 585);
  assert.strictEqual(I.infraSaldos(d, { deposito: 'Artigas' })[0].hoy, 0);
});

test('infra movimientos: saldo corrido, pedido y destino desde la nota, UBICACION fuera', () => {
  const m = I.infraMovs(infraDatos(), {});
  assert.strictEqual(m.length, 6);
  const parante = m.filter((x) => x.articulo_id === 129);
  assert.deepStrictEqual(parante.map((x) => [x.tipoMov, x.delta, x.saldo]), [['INGRESO', 592, 592], ['SALIDA', -14, 578], ['SALIDA', -16, 562]]);
  assert.strictEqual(parante[2].pedido, 48);
  assert.strictEqual(parante[2].destino, 'Sucursal Centro');
  assert.strictEqual(parante[2].responsable, 'Guillermo');
});

test('infra por destino y por mes: solo lo despachado, cancelado fuera', () => {
  const d = infraDatos();
  const dest = I.infraPorDestino(d, {});
  assert.deepStrictEqual(dest.map((x) => [x.destino, x.total, x.nPedidos, x.por[128] || 0, x.por[129] || 0]),
    [['Sucursal Centro', 16, 1, 0, 16], ['Sucursal Minas', 16, 1, 2, 14]]);
  assert.strictEqual(I.infraPorDestino(d, { desde: '2026-10-01' }).length, 1);
  assert.strictEqual(I.infraPorDestino(d, { q: 'diego' })[0].destino, 'Sucursal Minas');
  const mes = I.infraPorMes(d, {});
  assert.deepStrictEqual(mes.map((x) => [x.mes, x.ingresos, x.salidas, x.ajustes, x.nPedidos]),
    [['2026-08', 1192, 0, 0, 0], ['2026-09', 0, 16, 0, 1], ['2026-10', 0, 16, -3, 1]]);
});
