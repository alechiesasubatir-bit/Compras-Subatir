// Unitarias de la capa compartida de Compras (subatir-app.js):
// permisos, IVA, fecha estimada de llegada, cruce de nombres y tránsito.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { cargar, plano } = require('./helpers/entorno.js');

// Se carga en la página de login: el guard no corre y no redirige
const APP = cargar({ pagina: 'login.html' }).win.SubatirApp;

describe('canAccess', () => {
  const user = (mods, extra) => Object.assign({ role: 'user', activo: true, modules: mods }, extra);
  test('sin perfil o inactivo no entra a nada, ni al dashboard', () => {
    assert.strictEqual(APP.canAccess('dashboard', null), false);
    assert.strictEqual(APP.canAccess('dashboard', user([], { activo: false })), false);
    assert.strictEqual(APP.canAccess('pedidos', { role: 'admin', activo: false }), false);
  });
  test('admin entra a todo, incluido usuarios', () => {
    const a = { role: 'admin', activo: true, modules: [] };
    ['pedidos', 'usuarios', 'stock', 'cualquiera'].forEach(m => assert.strictEqual(APP.canAccess(m, a), true));
  });
  test('usuarios es solo de admin aunque figure en sus modulos', () => {
    assert.strictEqual(APP.canAccess('usuarios', user(['usuarios'])), false);
  });
  test('dashboard abierto a cualquier activo; el resto por modulo', () => {
    const u = user(['pedidos']);
    assert.strictEqual(APP.canAccess('dashboard', u), true);
    assert.strictEqual(APP.canAccess('pedidos', u), true);
    assert.strictEqual(APP.canAccess('stock', u), false);
  });
  test('modules ausente no rompe', () => {
    assert.strictEqual(APP.canAccess('pedidos', { role: 'user', activo: true }), false);
  });
});

describe('IVA', () => {
  test('tasa basica 22% y excepcion de la sal, sin importar tildes ni mayusculas', () => {
    assert.strictEqual(APP.ivaTasa('Botella PET 1L'), 0.22);
    assert.strictEqual(APP.ivaTasa('Sal fina Yodada para detergentes x KG (Materia Prima)'), 0.10);
    assert.strictEqual(APP.ivaTasa('  sal   FINA yodáda '), 0.10);
  });
  test('descripcion vacia o null usa la basica', () => {
    assert.strictEqual(APP.ivaTasa(''), 0.22);
    assert.strictEqual(APP.ivaTasa(null), 0.22);
    assert.strictEqual(APP.ivaTasa(undefined), 0.22);
  });
  test('ivaMult e ivaMonto', () => {
    assert.strictEqual(APP.ivaMult('x'), 1.22);
    assert.ok(Math.abs(APP.ivaMonto('x', 100) - 22) < 1e-9);
    assert.strictEqual(APP.ivaMonto('x', 'abc'), 0);
  });
  test('ivaDeLinea recupera la tasa elegida desde c/iva y s/iva', () => {
    assert.strictEqual(APP.ivaDeLinea(100, 122, 'x'), 0.22);
    assert.strictEqual(APP.ivaDeLinea(100, 110, 'x'), 0.10);
    assert.strictEqual(APP.ivaDeLinea(100, 100, 'x'), 0);
    // redondeos de centavos caen en la tasa más cercana
    assert.strictEqual(APP.ivaDeLinea(33.33, 36.66, 'x'), 0.10);
  });
  test('ivaDeLinea sin datos cae al catalogo (no a 0)', () => {
    assert.strictEqual(APP.ivaDeLinea(0, 0, 'Sal fina yodada'), 0.10);
    assert.strictEqual(APP.ivaDeLinea('', '', 'Botella'), 0.22);
    assert.strictEqual(APP.ivaDeLinea(100, '', 'Botella'), 0.22);
    assert.strictEqual(APP.ivaDeLinea(-5, 10, 'Botella'), 0.22);
  });
});

describe('Fecha estimada de llegada (LLEGADA)', () => {
  const L = APP.llegada;
  test('dias solo acepta enteros positivos', () => {
    assert.strictEqual(L.dias(15), 15);
    assert.strictEqual(L.dias('15 dias'), 15);
    assert.strictEqual(L.dias(0), 0);
    assert.strictEqual(L.dias(-3), 0);
    assert.strictEqual(L.dias(null), 0);
    assert.strictEqual(L.dias('abc'), 0);
  });
  test('estimar suma en UTC y cruza meses y años', () => {
    assert.strictEqual(L.estimar('2026-09-17', 15), '2026-10-02');
    assert.strictEqual(L.estimar('2026-12-20', 15), '2027-01-04');
    assert.strictEqual(L.estimar('2028-02-28', 1), '2028-02-29');   // bisiesto
    assert.strictEqual(L.estimar('2026-09-17T13:00:00', 1), '2026-09-18');
  });
  test('estimar sin fecha o sin demora devuelve vacio', () => {
    assert.strictEqual(L.estimar('', 10), '');
    assert.strictEqual(L.estimar('17/09/2026', 10), '');
    assert.strictEqual(L.estimar('2026-09-17', 0), '');
  });
  test('fmt y texto', () => {
    assert.strictEqual(L.fmt('2026-10-02'), '02/10/2026');
    assert.strictEqual(L.fmt('x'), '');
    assert.strictEqual(L.texto('2026-09-17', 1), '18/09/2026 (1 día)');
    assert.strictEqual(L.texto('2026-09-17', 2), '19/09/2026 (2 días)');
    assert.strictEqual(L.texto('', 2), '—');
  });
  test('faltan: negativo si ya paso, null sin fecha', () => {
    assert.strictEqual(L.faltan(''), null);
    assert.ok(L.faltan('2000-01-01') < 0);
    assert.ok(L.faltan('2999-01-01') > 0);
  });
  test('celda: recibida se muestra apagada, atrasada en rojo', () => {
    assert.match(L.celda('2000-01-01', 5, true), /pill-recv/);
    assert.match(L.celda('2000-01-01', 5, false), /pill-late/);
    assert.match(L.celda('2999-01-01', 5, false), /pill-ok/);
    assert.match(L.celda('', 5, false), /—/);
  });
});

describe('Cruce de nombres (MATCH)', () => {
  const M = APP.match;
  test('norm saca tildes y pasa a mayusculas', () => {
    assert.strictEqual(M.norm('  Cañería Ácida '), 'CANERIA ACIDA');
    assert.strictEqual(M.norm(null), '');
  });
  test('mismo articulo escrito distinto', () => {
    assert.strictEqual(M.igual('Botella Pet x 1 L Verde', 'BOTELLA PET X 1 L VERDE'), true);
    assert.strictEqual(M.igual('Sal Fina Yodada', 'Sal fina Yodada (Materia Prima)'), true);
  });
  test('una palabra significativa de mas los separa', () => {
    assert.strictEqual(M.igual('Botella Pet x 1 L Verde', 'Botella Pet x 1 L Petiza Verde'), false);
  });
  test('numeros que se contradicen los separan', () => {
    assert.strictEqual(M.igual('Tapa rosca 28/400', 'Tapa rosca 28/410'), false);
    assert.strictEqual(M.chocan('rosca 28 400', 'rosca 28 410'), true);
    assert.strictEqual(M.chocan('rosca', 'rosca 28'), false);
  });
  test('descripciones muy cortas nunca matchean', () => {
    assert.strictEqual(M.igual('Sal', 'Sal'), false);
    assert.strictEqual(M.igual('', ''), false);
    assert.deepStrictEqual(plano(M.keys('abc', { ABC: 1 })), []);
  });
  test('keys prefiere el match exacto', () => {
    const idx = { 'SAL FINA YODADA': 1, 'SAL FINA YODADA (MATERIA PRIMA)': 2 };
    assert.deepStrictEqual(plano(M.keys('Sal fina yodada', idx)), ['SAL FINA YODADA']);
  });
});

describe('transito', () => {
  const inv = (id, desc, extra) => Object.assign({ __row: id, 'DESCRIPCIÓN': desc }, extra);
  const oc = (o) => Object.assign({ Fecha: '2026-10-01', 'N° Orden': '1', Proveedor: 'P', Cantidad: 0,
                                    'Descripción': '', 'Precio un': 0, 'F.Recepción': '', 'ID Inventario': '' }, o);

  test('suma solo lo no recibido y valoriza', () => {
    const t = APP.transito([inv(1, 'Botella Pet 1L')], [
      oc({ __row: 10, Cantidad: 100, 'Precio un': 2, 'ID Inventario': 1 }),
      oc({ __row: 11, Cantidad: 50, 'Precio un': 2, 'ID Inventario': 1, 'F.Recepción': '2026-10-05' })
    ]);
    assert.strictEqual(t.de(1).pendiente, 100);
    assert.strictEqual(t.de(1).valorPendiente, 200);
  });
  test('"—", "-", "N/A" y "0" cuentan como no recibido', () => {
    const peds = ['—', '-', 'N/A', '0', ''].map((f, i) => oc({ __row: i, Cantidad: 1, 'ID Inventario': 1, 'F.Recepción': f }));
    assert.strictEqual(APP.transito([inv(1, 'x')], peds).de(1).pendiente, 5);
  });
  test('las entregas parciales descuentan y nunca dejan negativo', () => {
    const peds = [oc({ __row: 10, Cantidad: 100, 'ID Inventario': 1 }), oc({ __row: 11, Cantidad: 10, 'ID Inventario': 1 })];
    const ent = [{ pedido_id: 10, cantidad: 30 }, { pedido_id: 10, cantidad: '20' }, { pedido_id: 11, cantidad: 999 }, { pedido_id: null, cantidad: 5 }];
    assert.strictEqual(APP.transito([inv(1, 'x')], peds, ent).de(1).pendiente, 50);
  });
  test('sin ID cruza por descripcion y anota lo usado', () => {
    const t = APP.transito([inv(1, 'Sal Fina Yodada')],
      [oc({ __row: 1, Cantidad: 40, 'Descripción': 'Sal fina Yodada (Materia Prima)' })]);
    assert.strictEqual(t.de(1).pendiente, 40);
    assert.strictEqual(t.usadas['SAL FINA YODADA (MATERIA PRIMA)'].pendiente, 40);
  });
  test('un ID colgado (sin ficha) no marca su descripcion como usada', () => {
    const t = APP.transito([inv(1, 'Otra cosa')], [oc({ __row: 1, Cantidad: 5, 'ID Inventario': 999, 'Descripción': 'Fantasma' })]);
    assert.strictEqual(t.usadas['FANTASMA'], undefined);
    assert.strictEqual(t.de(999).pendiente, 0);
  });
  test('ultima OC y titular', () => {
    const t = APP.transito([inv(1, 'x', { PROVEEDOR: 'Ficha SA' }), inv(2, 'y', { PROVEEDOR: 'Ficha2' })], [
      oc({ __row: 1, Fecha: '2026-01-01', Proveedor: 'Viejo', 'ID Inventario': 1, 'F.Recepción': '2026-01-02' }),
      oc({ __row: 2, Fecha: '2026-06-01', Proveedor: 'Nuevo', 'N° Orden': '77', 'ID Inventario': 1, 'F.Recepción': '2026-06-02' })
    ]);
    assert.strictEqual(t.de(1).ultimaOrden, '77');
    assert.strictEqual(t.titular(1), 'Nuevo');
    assert.strictEqual(t.titular(2, { PROVEEDOR: 'Ficha2' }), 'Ficha2');
    assert.strictEqual(t.titular(3), '');
  });
  test('entradas vacias o null no rompen y de() nunca es undefined', () => {
    const t = APP.transito(null, null, null);
    assert.deepStrictEqual(plano(t.porArticulo), {});
    assert.strictEqual(t.de(123).pendiente, 0);
  });
  // Los números con formato (1.234,5) están en casos-limite.test.js
});

describe('aHoja (filas de la base -> formato de hoja)', () => {
  test('mapea columnas y deja __row', () => {
    const r = APP.aHoja('pedidos', [{ id: 7, n_orden: '12', cantidad: 3, descripcion: null }]);
    assert.strictEqual(r[0].__row, 7);
    assert.strictEqual(r[0]['N° Orden'], '12');
    assert.strictEqual(r[0]['Descripción'], '');
  });
  test('sheetKey desconocido devuelve lista vacia', () => {
    assert.deepStrictEqual(plano(APP.aHoja('nada', [{ id: 1 }])), []);
    assert.deepStrictEqual(plano(APP.aHoja('pedidos', null)), []);
  });
});
