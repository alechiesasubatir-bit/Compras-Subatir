// ============================================================
//  Service worker de Depósitos (PWA)
//
//  Existe para dos cosas: que la app se pueda instalar en el
//  celular y que abra aunque el wifi del depósito se caiga.
//  NO está para acelerar cargas a costa de mostrar datos viejos.
//
//  Por eso la estrategia es distinta según qué se pide:
//
//   · version.json  → SÓLO red, nunca cache. Es el archivo que le
//     dice a la pestaña que hay una versión nueva; si lo sirviera
//     el cache, el chequeo de versión dejaría de funcionar y
//     volveríamos al problema que vino a resolver.
//   · el documento HTML → red primero, cache de respaldo. Un
//     deploy se ve enseguida, y sin señal igual abre la última
//     versión que se vio.
//   · imágenes y JS propios → cache primero y se refrescan de
//     fondo (stale-while-revalidate). Son los que no cambian entre
//     deploys salvo que se bumpee su ?v=.
//   · CDN (three.js, el lector de QR, supabase-js) → se dejan
//     pasar sin tocar. Guardarlos daría respuestas opacas que no
//     se pueden validar, y el navegador ya las cachea bien solo.
//
//  APP_VER lo reescribe bump-version.ps1 en cada publicación: al
//  cambiar el archivo, el navegador instala el worker nuevo y
//  descarta el cache viejo.
// ============================================================
self.APP_VER = '2026-08-12.1748';
var CACHE = 'deposito-' + self.APP_VER;

// Lo mínimo para que la app abra sin señal.
var SHELL = ['./', './index.html', './solicitar.html', './recorrido.html', './movil.css', './deposito-app.js', '../supabase-config.js',
             './icon-192.png', './icon-512.png', '../logo.jpg'];

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
        return k !== CACHE ? caches.delete(k) : null;   // se va el de la versión anterior
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
  // NUNCA se cachean — mostrarían stock que ya no es.
  if (url.origin !== self.location.origin) return;

  // El archivo que gobierna las actualizaciones: siempre de la red.
  if (url.pathname.indexOf('version.json') >= 0) return;

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
