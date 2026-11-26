// Casos límite que cruzan más de un archivo.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { cargar, drenar, RAIZ } = require('./helpers/entorno.js');

// ── Recorrido de redirecciones ──────────────────────────────────
//  Sigue los location.replace() página por página, con la MISMA sesión,
//  ejecutando el guard de cada app y el script inline de los login.
//  Corta cuando una página no redirige (llegó) o cuando repite (bucle).
const ELEM = () => ({ style: {}, classList: { add() {} }, addEventListener() {}, textContent: '', className: '' });

async function visitar(pagina, prof, sesionViva) {
  const dep = pagina.startsWith('deposito/');
  const archivo = pagina.split('?')[0];
  const esLogin = /login\.html$/.test(archivo);
  const e = cargar({
    pagina: archivo, usuario: sesionViva.v ? { id: 'u1', email: 'x@y' } : null,
    tablas: { profiles: [prof] },
    scripts: esLogin ? ['supabase-config.js'] : ['supabase-config.js', dep ? 'deposito/deposito-app.js' : 'subatir-app.js']
  });
  if (esLogin) {
    e.win.location.search = pagina.includes('?') ? '?' + pagina.split('?')[1] : '';
    e.win.document.getElementById = ELEM;
    const html = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
    vm.runInContext(inline, e.win);
  }
  await drenar();
  if (e.salidas.length) sesionViva.v = false;      // signOut cierra la sesión
  const sig = e.redirecciones[0];
  if (!sig) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(archivo), sig));
}

async function recorrer(inicio, prof) {
  const sesion = { v: true }, visto = [inicio];
  let actual = inicio;
  for (let i = 0; i < 8; i++) {
    const sig = await visitar(actual, prof, sesion);
    if (!sig) return { fin: actual, camino: visto };
    if (visto.includes(sig)) return { bucle: true, camino: visto.concat(sig) };
    visto.push(sig); actual = sig;
  }
  return { bucle: true, camino: visto };
}

describe('Redirecciones entre apps (sin bucles)', () => {
  const perfil = (o) => Object.assign({ id: 'u1', role: 'user', activo: true, modules: [] }, o);

  test('usuario solo de Compras que abre Depositos no queda en un bucle', async () => {
    const r = await recorrer('deposito/index.html', perfil({ modules: ['pedidos'] }));
    assert.ok(!r.bucle, 'bucle de redirecciones: ' + r.camino.join(' -> '));
    assert.strictEqual(r.fin, 'index.html');
  });
  test('usuario solo con Calidad MP que abre Depositos termina en Calidad', async () => {
    const r = await recorrer('deposito/index.html', perfil({ modules: ['calidad'] }));
    assert.ok(!r.bucle, r.camino.join(' -> '));
    assert.strictEqual(r.fin, 'calidad.html');
  });
  test('usuario sin modulos que abre Depositos se queda en el login con el aviso', async () => {
    const r = await recorrer('deposito/index.html', perfil({ modules: [] }));
    assert.ok(!r.bucle, r.camino.join(' -> '));
    assert.strictEqual(r.fin, 'deposito/login.html?denegado=1');
  });
  test('usuario solo de deposito que abre Compras termina en su pantalla', async () => {
    const r = await recorrer('index.html', perfil({ modules: ['solicitante'] }));
    assert.ok(!r.bucle, r.camino && r.camino.join(' -> '));
    assert.strictEqual(r.fin, 'deposito/solicitar.html');
  });
  test('usuario sin modulos termina en el login de Compras, con la sesion cerrada', async () => {
    const r = await recorrer('index.html', perfil({ modules: [] }));
    assert.ok(!r.bucle, r.camino && r.camino.join(' -> '));
    assert.strictEqual(r.fin, 'login.html?sinacceso=1');
  });
  test('usuario inactivo en Depositos termina en el login', async () => {
    const r = await recorrer('deposito/recorrido.html', perfil({ activo: false, modules: ['recorrido'] }));
    assert.ok(!r.bucle, r.camino && r.camino.join(' -> '));
    assert.strictEqual(r.fin, 'deposito/login.html?inactivo=1');
  });
});

// ── Números con formato ─────────────────────────────────────────
//  La escritura (coerce, en updateRow) y la lectura del tránsito (_numTr)
//  tienen cada una su propio parser. Tienen que leer igual el mismo texto.
describe('Numeros con formato local', () => {
  const CASOS = [
    ['1234,5', 1234.5],
    ['1234.5', 1234.5],
    ['1.234,5', 1234.5],       // formato uruguayo con miles
    ['1,234.56', 1234.56],     // formato de cotización en dólares
    ['$ 2.500,00', 2500],
    ['U$S 3,75', 3.75],
    ['1.234.567', 1234567],    // punto repetido = miles
    ['1,234,567', 1234567],    // coma repetida = miles
    ['1,234,567.5', 1234567.5],
    ['-12,5', -12.5],
    ['1,234', 1234],           // comas en grupos de 3 = miles
    ['0,250', 0.25],           // ...salvo con un 0 adelante: es decimal
    ['0.576', 0.576],          // un solo punto = decimal (precios de 3 decimales)
    ['(1.234,50)', -1234.5],   // negativo contable
    [42, 42]                   // lo que ya viene como número no se toca
  ];

  test('texto sin numero: al guardar queda vacio, en transito cuenta 0', async () => {
    const e = cargar({ pagina: 'login.html', tablas: { pedidos: [{ id: 1, precio_un: 5 }] } });
    await e.win.SubatirApp.updateRow('pedidos', 1, { 'Precio un': 'sin precio' });
    assert.strictEqual(e.db.pedidos[0].precio_un, null);
    const t = e.win.SubatirApp.transito([{ __row: 1, 'DESCRIPCIÓN': 'x' }],
      [{ __row: 9, 'ID Inventario': 1, Cantidad: 'abc', 'F.Recepción': '' }]);
    assert.strictEqual(t.de(1).pendiente, 0);
  });

  for (const [txt, esperado] of CASOS) {
    test('al guardar: "' + txt + '" -> ' + esperado, async () => {
      const e = cargar({ pagina: 'login.html', tablas: { pedidos: [{ id: 1 }] } });
      await e.win.SubatirApp.updateRow('pedidos', 1, { 'Precio un': txt });
      assert.strictEqual(e.db.pedidos[0].precio_un, esperado);
    });
    // El tránsito nunca cuenta negativo (saldo = max(0, …)): no aplica
    if (esperado < 0) continue;
    test('en transito: "' + txt + '" -> ' + esperado, () => {
      const APP = cargar({ pagina: 'login.html' }).win.SubatirApp;
      const t = APP.transito([{ __row: 1, 'DESCRIPCIÓN': 'x' }],
        [{ __row: 9, 'ID Inventario': 1, Cantidad: txt, 'Precio un': 1, 'F.Recepción': '' }]);
      assert.strictEqual(t.de(1).pendiente, esperado);
    });
  }
});
