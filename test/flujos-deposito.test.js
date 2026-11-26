// Integración: guardia de la app de Depósitos (deposito/deposito-app.js)
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { cargar, drenar } = require('./helpers/entorno.js');

const U = { id: 'u1', email: 'op@subatir.test' };
const perfil = (o) => Object.assign({ id: 'u1', role: 'user', activo: true, modules: [] }, o);

async function entrar(pagina, prof) {
  const e = cargar({ pagina: 'deposito/' + pagina, usuario: prof === undefined ? null : U,
    tablas: { profiles: prof ? [prof] : [] },
    scripts: ['supabase-config.js', 'deposito/deposito-app.js'] });
  await drenar();
  return e;
}

describe('Guardia de Depósitos', () => {
  test('sin sesion -> login', async () => {
    assert.deepStrictEqual((await entrar('index.html', undefined)).redirecciones, ['login.html']);
  });
  test('inactivo -> cierra sesion', async () => {
    const e = await entrar('index.html', perfil({ role: 'admin', activo: false }));
    assert.deepStrictEqual(e.redirecciones, ['login.html?inactivo=1']);
    assert.strictEqual(e.salidas.length, 1);
  });
  test('admin entra a las tres pantallas', async () => {
    for (const p of ['index.html', 'solicitar.html', 'recorrido.html']) {
      assert.deepStrictEqual((await entrar(p, perfil({ role: 'admin' }))).redirecciones, [], p);
    }
  });
  test('importacion es el permiso completo', async () => {
    const p = perfil({ modules: ['importacion'] });
    for (const pg of ['index.html', 'solicitar.html', 'recorrido.html']) {
      assert.deepStrictEqual((await entrar(pg, p)).redirecciones, [], pg);
    }
  });
  test('solicitante: solo solicitar; el panel lo manda a su pantalla', async () => {
    const p = perfil({ modules: ['solicitante'] });
    assert.deepStrictEqual((await entrar('solicitar.html', p)).redirecciones, []);
    assert.deepStrictEqual((await entrar('index.html', p)).redirecciones, ['solicitar.html']);
    assert.deepStrictEqual((await entrar('recorrido.html', p)).redirecciones, ['solicitar.html']);
  });
  test('recepcion_deposito entra a recorrido', async () => {
    const p = perfil({ modules: ['recepcion_deposito'] });
    assert.deepStrictEqual((await entrar('recorrido.html', p)).redirecciones, []);
    assert.deepStrictEqual((await entrar('index.html', p)).redirecciones, ['recorrido.html']);
  });
  test('solo modulos de Compras -> vuelve a Compras, sin cerrar la sesion', async () => {
    const e = await entrar('index.html', perfil({ modules: ['pedidos'] }));
    assert.deepStrictEqual(e.redirecciones, ['../index.html']);
    assert.strictEqual(e.salidas.length, 0);
  });
  test('sin ningun modulo -> login con aviso de denegado', async () => {
    const e = await entrar('index.html', perfil({ modules: [] }));
    assert.deepStrictEqual(e.redirecciones, ['login.html?denegado=1']);
  });
  test('la pantalla lista avisa con subatir:ready', async () => {
    const e = await entrar('index.html', perfil({ role: 'admin' }));
    assert.strictEqual(e.eventos[0].type, 'subatir:ready');
  });
});
