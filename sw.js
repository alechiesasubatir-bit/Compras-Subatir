// ============================================================
//  Service worker de Compras (PWA)
//
//  Hermano del de Depósitos y con el mismo criterio: existe para
//  que la app se pueda instalar y para que abra sin señal, NO
//  para acelerar cargas a costa de mostrar datos viejos.
//
//   · version.json  → SÓLO red, nunca cache. Es el archivo que le
//     avisa a la pestaña que hay una versión nueva; si lo sirviera
//     el cache, el chequeo de versión dejaría de funcionar.
//   · el documento HTML → red primero, cache de respaldo. Un
//     deploy se ve enseguida, y sin señal abre lo último visto.
//   · imágenes y JS propios → cache primero, refresco de fondo.
//   · CDN (supabase-js, jsPDF) → se dejan pasar sin tocar.
//   · /deposito/ → NO se toca: tiene su propio service worker.
//
//  APP_VER lo reescribe bump-version.ps1 en cada publicación: al
//  cambiar el archivo, el navegador instala el worker nuevo y
//  descarta el cache viejo.
// ============================================================
self.APP_VER = '2026-08-17.1014';
var CACHE = 'compras-' + self.APP_VER;

// Lo mínimo para que la app abra sin señal.
var SHELL = ['./', './index.html', './pedidos.html', './recepcion.html', './stock.html',
             './precios.html', './proveedores.html', './contingencia.html', './varios.html',
             './login.html', './subatir-app.js', './supabase-config.js',
             './logo.jpg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE)
      // addAll falla entero si UNO solo falla; se agregan de a uno para
      // que un archivo movido no deje la app sin service worker.
      .then(function (c) { return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () { });
      })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) {
        // Sólo los caches de Compras: el de Depósitos no es asunto nuestro
        return (k.indexOf('compras-') === 0 && k !== CACHE) ? caches.delete(k) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Otro origen (CDN, Supabase): sin intervenir. Las llamadas a la base
  // NUNCA se cachean — mostrarían datos que ya no son.
  if (url.origin !== self.location.origin) return;

  // Depósitos es otra app y tiene su propio worker. Este alcanza a toda
  // la carpeta por el scope, así que se aparta explícitamente en vez de
  // depender de quién gana por especificidad.
  if (url.pathname.indexOf('/deposito/') >= 0) return;

  // El archivo que gobierna las actualizaciones: siempre de la red.
  if (url.pathname.indexOf('version.json') >= 0) return;

  // El manifest tampoco: no tiene ?v= que subir, y si se cachea, un
  // cambio ahi (orientacion, nombre, iconos) no llega nunca al telefono.
  if (url.pathname.indexOf('manifest.json') >= 0) return;

  // Documento: red primero, cache si no hay señal.
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req).then(function (r) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return r;
      }).catch(function () {
        return caches.match(req).then(function (m) { return m || caches.match('./index.html'); });
      })
    );
    return;
  }

  // Estático propio: se responde del cache y se refresca de fondo.
  ev.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (r) {
        if (r && r.status === 200) {
          var copy = r.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return r;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
