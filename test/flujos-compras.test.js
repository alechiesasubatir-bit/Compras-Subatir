// Integración: flujos principales de Compras contra un Supabase falso.
//  · Guardia de acceso: a dónde va cada tipo de usuario según la página.
//  · Capa de datos: getData / updateRow / addRow / deleteRow, con RLS.
//  · SB.todo: paginación de 1000 en 1000.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { cargar, drenar, plano } = require('./helpers/entorno.js');

const U = { id: 'u1', email: 'persona@subatir.test' };
const perfil = (o) => Object.assign({ id: 'u1', role: 'user', activo: true, modules: [] }, o);

async function entrar(pagina, prof, extra) {
  const e = cargar(Object.assign({ pagina, usuario: prof === undefined ? null : U,
    tablas: { profiles: prof ? [prof] : [] } }, extra));
  await drenar();
  return e;
}

describe('Guardia de Compras', () => {
  test('sin sesion -> login', async () => {
    const e = await entrar('pedidos.html', undefined);
    assert.deepStrictEqual(e.redirecciones, ['login.html']);
  });
  test('login.html no se protege a si misma', async () => {
    const e = await entrar('login.html', undefined);
    assert.deepStrictEqual(e.redirecciones, []);
    assert.strictEqual(await e.win.SubatirApp.ready, null);
  });
  test('perfil inactivo -> cierra sesion y avisa', async () => {
    const e = await entrar('index.html', perfil({ role: 'admin', activo: false }));
    assert.strictEqual(e.salidas.length, 1);
    assert.deepStrictEqual(e.redirecciones, ['login.html?inactivo=1']);
  });
  test('admin entra a cualquier pagina y la app queda lista', async () => {
    for (const p of ['index.html', 'pedidos.html', 'usuarios.html', 'stock.html']) {
      const e = await entrar(p, perfil({ role: 'admin' }));
      assert.deepStrictEqual(e.redirecciones, [], p);
      assert.strictEqual(e.eventos[0].type, 'subatir:ready');
      assert.strictEqual((await e.win.SubatirApp.ready).role, 'admin');
    }
  });
  test('usuario sin el modulo de la pagina -> dashboard con aviso', async () => {
    const e = await entrar('precios.html', perfil({ modules: ['pedidos'] }));
    assert.deepStrictEqual(e.redirecciones, ['index.html?denegado=precios']);
  });
  test('usuario comun no entra a Usuarios', async () => {
    const e = await entrar('usuarios.html', perfil({ modules: ['pedidos', 'usuarios'] }));
    assert.deepStrictEqual(e.redirecciones, ['index.html?denegado=usuarios']);
  });
  test('reposicion.html usa el permiso de stock', async () => {
    const ok = await entrar('reposicion.html', perfil({ modules: ['stock'] }));
    assert.deepStrictEqual(ok.redirecciones, []);
    const no = await entrar('reposicion.html', perfil({ modules: ['pedidos'] }));
    assert.deepStrictEqual(no.redirecciones, ['index.html?denegado=stock']);
  });
  test('operario de recepcion queda encerrado en recepcion.html', async () => {
    const op = perfil({ modules: ['recepcion'] });
    assert.deepStrictEqual((await entrar('index.html', op)).redirecciones, ['recepcion.html']);
    assert.deepStrictEqual((await entrar('pedidos.html', op)).redirecciones, ['recepcion.html']);
    assert.deepStrictEqual((await entrar('recepcion.html', op)).redirecciones, []);
  });
  test('operario con Calidad MP tambien puede consultar calidad', async () => {
    const op = perfil({ modules: ['recepcion', 'calidad'] });
    assert.deepStrictEqual((await entrar('calidad.html', op)).redirecciones, []);
    assert.deepStrictEqual((await entrar('calidad-imp.html', op)).redirecciones, []);
    assert.deepStrictEqual((await entrar('stock.html', op)).redirecciones, ['recepcion.html']);
  });
  test('solo Calidad MP (consulta) -> no ve el dashboard con importes', async () => {
    const c = perfil({ modules: ['calidad'] });
    assert.deepStrictEqual((await entrar('index.html', c)).redirecciones, ['calidad.html']);
    assert.deepStrictEqual((await entrar('calidad.html', c)).redirecciones, []);
  });
  test('solo modulos de deposito -> a su pantalla de la otra app', async () => {
    const casos = [
      [['importacion'], 'deposito/index.html'],
      [['recorrido'], 'deposito/recorrido.html'],
      [['recepcion_deposito'], 'deposito/recorrido.html'],
      [['solicitante'], 'deposito/solicitar.html'],
      [['solicitante', 'importacion'], 'deposito/index.html']
    ];
    for (const [mods, destino] of casos) {
      const e = await entrar('index.html', perfil({ modules: mods }));
      assert.deepStrictEqual(e.redirecciones, [destino], mods.join(','));
    }
  });
  test('deposito + Calidad MP: a calidad puede entrar por link directo', async () => {
    const e = await entrar('calidad.html', perfil({ modules: ['solicitante', 'calidad'] }));
    assert.deepStrictEqual(e.redirecciones, []);
  });
  test('usuario sin ningun modulo -> se cierra la sesion', async () => {
    const e = await entrar('index.html', perfil({ modules: [] }));
    assert.strictEqual(e.salidas.length, 1);
    assert.deepStrictEqual(e.redirecciones, ['login.html?sinacceso=1']);
  });
  test('usuario sin fila en profiles: perfil por defecto sin modulos -> afuera', async () => {
    const e = await entrar('index.html', null);
    assert.deepStrictEqual(e.redirecciones, ['login.html?sinacceso=1']);
  });
  test('pagina desconocida se trata como dashboard', async () => {
    const e = await entrar('cualquiera.html', perfil({ modules: ['pedidos'] }));
    assert.deepStrictEqual(e.redirecciones, []);
  });
});

describe('Capa de datos', () => {
  const tablas = () => ({
    profiles: [perfil({ role: 'admin' })],
    pedidos: [{ id: 1, n_orden: '5', cantidad: 10, descripcion: 'Botella', fecha: '2026-10-01' }],
    inventario: [{ id: 3, descripcion: 'Botella', inventario: 100, ext_id: 'ENV' },
                 { id: 4, descripcion: 'Sal Fina Yodada', inventario: 5, ext_id: 'MP' }],
    precios: [], proveedores: [{ id: 9, empresa: 'ACME' }]
  });
  const app = async (extra) => { const e = await entrar('pedidos.html', perfil({ role: 'admin' }), Object.assign({ tablas: tablas() }, extra)); return e; };

  test('getData devuelve las tablas con los nombres de campo del Sheet', async () => {
    const e = await app();
    const d = await e.win.SubatirApp.getData();
    assert.strictEqual(d.pedidos[0]['N° Orden'], '5');
    assert.strictEqual(d.pedidos[0].__row, 1);
    assert.strictEqual(d.inventario.length, 2);
    // contactos y proveedores son la misma tabla bajo dos nombres
    assert.strictEqual(d.contactos[0].EMPRESA, 'ACME');
    assert.strictEqual(d.proveedores, d.contactos);
  });
  test('updateRow convierte numeros en formato local y fechas', async () => {
    const e = await app();
    const r = await e.win.SubatirApp.updateRow('pedidos', 1,
      { Cantidad: '1.234,5', 'Precio un': 'U$S 3,75', Fecha: '2026-11-02T10:00', '__row': 1, Observaciones: '' });
    assert.deepStrictEqual(plano(r), { success: true, row: 1 });
    const fila = e.db.pedidos[0];
    assert.strictEqual(fila.cantidad, 1234.5);
    assert.strictEqual(fila.precio_un, 3.75);
    assert.strictEqual(fila.fecha, '2026-11-02');
    assert.strictEqual(fila.observaciones, null);
  });
  test('updateRow acepta los campos como JSON en texto', async () => {
    const e = await app();
    const r = await e.win.SubatirApp.updateRow('pedidos', 1, JSON.stringify({ Cantidad: 7 }));
    assert.strictEqual(r.success, true);
    assert.strictEqual(e.db.pedidos[0].cantidad, 7);
  });
  test('updateRow ignora columnas que no existen y valores numericos basura', async () => {
    const e = await app();
    await e.win.SubatirApp.updateRow('pedidos', 1, { Inventada: 'x', Cantidad: 'abc' });
    assert.strictEqual(e.db.pedidos[0].cantidad, null);
    assert.strictEqual('Inventada' in e.db.pedidos[0], false);
  });
  test('RLS bloquea el UPDATE en silencio -> se informa como error', async () => {
    const e = await app({ rls: ['pedidos'] });
    const r = await e.win.SubatirApp.updateRow('pedidos', 1, { Cantidad: 99 });
    assert.match(r.error, /no dejó guardar/);
    assert.strictEqual(e.db.pedidos[0].cantidad, 10);
  });
  test('updateRow de una fila que ya no existe -> error', async () => {
    const e = await app();
    const r = await e.win.SubatirApp.updateRow('pedidos', 404, { Cantidad: 1 });
    assert.ok(r.error);
  });
  test('sheetKey desconocido -> error, sin tocar la base', async () => {
    const e = await app();
    const n = e.log.length;
    for (const f of ['updateRow', 'addRow', 'deleteRow']) {
      const r = await e.win.SubatirApp[f]('nada', 1, {});
      assert.match(r.error, /sheetKey desconocido/);
    }
    assert.strictEqual(e.log.length, n);
  });
  test('addRow inserta y devuelve el id; deleteRow lo borra', async () => {
    const e = await app();
    const r = await e.win.SubatirApp.addRow('proveedores', { EMPRESA: 'Nueva SA', RUT: 2100 });
    assert.strictEqual(r.success, true);
    const nueva = e.db.proveedores.find(x => x.id === r.id);
    assert.strictEqual(nueva.empresa, 'Nueva SA');
    assert.strictEqual(nueva.rut, '2100');           // texto, no número
    const d = await e.win.SubatirApp.deleteRow('proveedores', r.id);
    assert.strictEqual(d.success, true);
    assert.strictEqual(e.db.proveedores.some(x => x.id === r.id), false);
  });
  test('addRow con error de la base devuelve el mensaje', async () => {
    const e = await app({ rls: ['precios'] });
    const r = await e.win.SubatirApp.addRow('precios', { ARTICULO: 'x' });
    assert.match(r.error, /row-level security/);
  });
  test('categorias sale de inventario.ext_id', async () => {
    const e = await app();
    const c = await e.win.SubatirApp.categorias();
    assert.deepStrictEqual(plano(c), { BOTELLA: 'Envases', 'SAL FINA YODADA': 'Materias Primas' });
  });
  test('setCategoria escribe en la ficha correcta y valida', async () => {
    const e = await app();
    assert.strictEqual((await e.win.SubatirApp.setCategoria('  sal fina  yodada', 'Consumibles')).success, true);
    assert.strictEqual(e.db.inventario[1].ext_id, 'CON');
    assert.match((await e.win.SubatirApp.setCategoria('Botella', 'Juguetes')).error, /desconocida/);
    assert.match((await e.win.SubatirApp.setCategoria('No existe', 'Envases')).error, /no está en el inventario/);
    assert.strictEqual((await e.win.SubatirApp.setCategoria('Botella', '')).success, true);
    assert.strictEqual(e.db.inventario[0].ext_id, null);
  });
  test('fichaDe: exacta, aproximada, ambigua y ninguna', async () => {
    const e = await app({ tablas: Object.assign(tablas(), { inventario: [
      { id: 1, descripcion: 'Botella Pet 1L Verde' },
      { id: 2, descripcion: 'Tapa Rosca 28/400' }, { id: 3, descripcion: 'Tapa Rosca 28/400 ' }
    ] }) });
    const M = e.win.SubatirApp.match;
    assert.strictEqual((await M.fichaDe('BOTELLA PET 1L VERDE')).ficha.id, 1);
    const aprox = await M.fichaDe('Botella Pet 1 L Verde');
    assert.strictEqual(aprox.exacta, false);
    assert.strictEqual(aprox.ficha.id, 1);
    assert.strictEqual((await M.fichaDe('Tapa rosca 28/400')).ambiguas.length, 2);
    assert.strictEqual((await M.fichaDe('Bidón 5L')).ninguna, true);
    assert.strictEqual((await M.fichaPorId(1)).id, 1);
    assert.strictEqual(await M.fichaPorId(''), null);
  });
});

describe('SB.todo (paginacion)', () => {
  const muchas = (n) => Array.from({ length: n }, (_, i) => ({ id: n - i, v: i }));

  test('trae mas de 1000 filas en paginas y sin repetir', async () => {
    const e = cargar({ pagina: 'login.html', tablas: { t: muchas(2500) } });
    const SB = e.win.SB;
    const r = await SB.todo(() => SB.from('t').select('*'));
    assert.strictEqual(r.error, null);
    assert.strictEqual(r.data.length, 2500);
    assert.strictEqual(new Set(r.data.map(x => x.id)).size, 2500);
    assert.deepStrictEqual(e.log.map(l => plano(l.rango)), [[0, 999], [1000, 1999], [2000, 2999]]);
  });
  test('exactamente 1000 filas pide una pagina extra vacia', async () => {
    const e = cargar({ pagina: 'login.html', tablas: { t: muchas(1000) } });
    const r = await e.win.SB.todo(() => e.win.SB.from('t').select('*'));
    assert.strictEqual(r.data.length, 1000);
    assert.strictEqual(e.log.length, 2);
  });
  test('tabla vacia', async () => {
    const e = cargar({ pagina: 'login.html', tablas: { t: [] } });
    const r = await e.win.SB.todo(() => e.win.SB.from('t').select('*'));
    assert.deepStrictEqual(plano(r.data), []);
  });
  test('si falla una pagina no devuelve una lista a medias', async () => {
    const e = cargar({ pagina: 'login.html', tablas: { t: muchas(2500) },
      errores: { t: (st) => st.rango && st.rango[0] === 1000 } });
    const r = await e.win.SB.todo(() => e.win.SB.from('t').select('*'));
    assert.strictEqual(r.data, null);
    assert.ok(r.error);
  });
});
