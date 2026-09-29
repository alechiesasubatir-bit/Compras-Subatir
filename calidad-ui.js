// ============================================================
//  CALIDAD MP — piezas de pantalla compartidas por calidad.html y
//  calidad-imp.html:
//
//   · Miniaturas: la primera hoja de cada PDF (o la foto) dibujada con
//     pdf.js. Se piden sólo cuando la tarjeta entra en pantalla, de a
//     tres por vez, y quedan en memoria: al filtrar no se vuelven a
//     bajar.
//   · Visor: el documento adentro de la app, con sus versiones al
//     costado. Se dibuja con pdf.js y no con un <iframe> porque el
//     Chrome del celular no muestra PDFs dentro de un iframe.
//   · countUp: los números de los KPI suben en vez de aparecer.
//
//  El bucket es privado: todo pasa por URLs firmadas de 5 minutos.
// ============================================================
(function () {
  'use strict';

  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var BUCKET = 'calidad-mp';
  var QUIETO = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function aviso(msg, tipo) { if (typeof window.toast === 'function') window.toast(msg, tipo); }
  function fechaCorta(iso) { if (!iso) return ''; var p = String(iso).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0].slice(2); }

  // ── pdf.js: se carga la primera vez que hace falta ──────────
  var _pdf = null;
  function pdfjs() {
    if (_pdf) return _pdf;
    _pdf = new Promise(function (ok, mal) {
      var s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.onload = function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
        ok(window.pdfjsLib);
      };
      s.onerror = function () { _pdf = null; mal(new Error('No se pudo cargar el lector de PDF')); };
      document.head.appendChild(s);
    });
    return _pdf;
  }

  function esImagen(x) {
    var n = String((x && (x.nombre_archivo || x.name || x.archivo)) || '').toLowerCase();
    return (x && /^image\//.test(x.type || '')) || /\.(jpe?g|png|webp)$/.test(n);
  }

  // ── URLs firmadas (duran 5 min; se reusan 4) ────────────────
  var _urls = {};
  function firmada(doc) {
    var c = _urls[doc.archivo];
    if (c && c.hasta > Date.now()) return Promise.resolve(c.url);
    return SB.storage.from(BUCKET).createSignedUrl(doc.archivo, 300).then(function (r) {
      if (r.error || !r.data) throw new Error(r.error ? r.error.message : 'sin URL');
      _urls[doc.archivo] = { url: r.data.signedUrl, hasta: Date.now() + 240000 };
      return r.data.signedUrl;
    });
  }

  // ── Miniaturas ──────────────────────────────────────────────
  // Una cola de a 3: con 70 tarjetas en pantalla, pedir todo junto
  // traba la conexión del celular y las primeras tardan más.
  var cola = [], activos = 0, MAX = 3;
  function encolar(fn) {
    return new Promise(function (ok, mal) { cola.push({ fn: fn, ok: ok, mal: mal }); correr(); });
  }
  function correr() {
    while (activos < MAX && cola.length) {
      var t = cola.shift(); activos++;
      t.fn().then(t.ok, t.mal).then(function () { activos--; correr(); });
    }
  }

  function primeraHoja(src, ancho) {
    return pdfjs().then(function (lib) {
      return lib.getDocument(src).promise.then(function (pdf) {
        return pdf.getPage(1).then(function (pg) {
          var v = pg.getViewport({ scale: 1 });
          var vp = pg.getViewport({ scale: ancho / v.width });
          var cv = document.createElement('canvas');
          cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
          return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise.then(function () {
            var url = cv.toDataURL('image/jpeg', 0.82);
            pdf.destroy();
            return url;
          });
        });
      });
    });
  }

  var _mini = {};   // id del documento → Promise<url de la imagen>
  function miniDoc(doc) {
    if (!_mini[doc.id]) {
      _mini[doc.id] = encolar(function () {
        return firmada(doc).then(function (url) { return esImagen(doc) ? url : primeraHoja(url, 280); });
      });
      _mini[doc.id].catch(function () { delete _mini[doc.id]; });
    }
    return _mini[doc.id];
  }
  function miniArchivo(file) {
    if (esImagen(file)) return Promise.resolve(URL.createObjectURL(file));
    return encolar(function () {
      return file.arrayBuffer().then(function (buf) { return primeraHoja({ data: new Uint8Array(buf) }, 200); });
    });
  }

  function pintar(el, prom) {
    prom.then(function (url) {
      var img = new Image();
      img.alt = '';
      img.onload = function () { el.classList.add('ok'); };
      img.onerror = function () { el.classList.add('err'); el.textContent = '📄'; };
      img.src = url;
      el.innerHTML = ''; el.appendChild(img);
    }, function () { el.classList.add('err'); el.textContent = '📄'; });
  }

  // Busca .thumb[data-doc] dentro de root y las llena al verse.
  // docDe(id) devuelve el documento (cada página tiene el suyo).
  var _io = null, _docDe = null;
  function miniaturas(root, docDe) {
    _docDe = docDe;
    var els = (root || document).querySelectorAll('.thumb[data-doc]:not([data-v])');
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { cargarEl(el, docDe); });
      return;
    }
    if (!_io) {
      _io = new IntersectionObserver(function (ents) {
        ents.forEach(function (e) {
          if (e.isIntersecting) { _io.unobserve(e.target); cargarEl(e.target, e.target._docDe); }
        });
      }, { rootMargin: '200px' });
    }
    els.forEach(function (el) { el.setAttribute('data-v', '1'); el._docDe = docDe; _io.observe(el); });
  }
  function cargarEl(el, docDe) {
    var d = (docDe || _docDe) && (docDe || _docDe)(+el.getAttribute('data-doc'));
    if (!d) { el.classList.add('err'); el.textContent = '📄'; return; }
    pintar(el, miniDoc(d));
  }
  function thumbHtml(doc, extra) {
    return '<div class="thumb ' + (extra || '') + '" data-doc="' + doc.id + '"></div>';
  }

  // ── Números que suben ───────────────────────────────────────
  function countUp(el, fin, sufijo) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    sufijo = sufijo || '';
    fin = +fin || 0;
    var desde = +(el.getAttribute('data-n') || 0);
    el.setAttribute('data-n', fin);
    if (QUIETO || desde === fin) { el.textContent = fin + sufijo; return; }
    var t0 = performance.now(), dur = 700;
    (function paso(t) {
      var k = Math.min(1, Math.max(0, (t - t0) / dur)), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(desde + (fin - desde) * e) + sufijo;
      if (k < 1) requestAnimationFrame(paso);
    })(t0);
  }

  // ── Abrir en otra pestaña / bajar ───────────────────────────
  // La ventana se abre ANTES de pedir la URL, dentro del click: si se
  // abre después de esperar, el navegador la toma por popup y la bloquea.
  function pestana(doc) {
    var w = window.open('', '_blank');
    if (w) w.document.write('<p style="font-family:sans-serif;color:#555">Abriendo ' + esc(doc.nombre_archivo || 'documento') + '…</p>');
    firmada(doc).then(function (url) { if (w) w.location.href = url; else location.href = url; },
      function (e) { if (w) w.close(); aviso('No se pudo abrir: ' + e.message, 'err'); });
  }
  function bajar(doc) {
    firmada(doc).then(function (url) { return fetch(url); }).then(function (r) { return r.blob(); }).then(function (b) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = doc.nombre_archivo || 'documento';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }).catch(function (e) { aviso('No se pudo bajar: ' + (e && e.message || e), 'err'); });
  }

  // ── Visor ───────────────────────────────────────────────────
  var TIPO = { FT: 'Ficha técnica', HDS: 'Hoja de seguridad', COA: 'COA', OTRO: 'Documento' };
  var V = { lista: [], i: 0, op: {}, turno: 0, borrar: null };

  function armarVisor() {
    if (document.getElementById('vis')) return;
    var d = document.createElement('div');
    d.id = 'vis'; d.className = 'vis'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    d.innerHTML =
      '<div class="vis-top">'
      + '<span class="vis-tag" id="vis-tag"></span>'
      + '<div class="vis-tt"><b id="vis-t"></b><span id="vis-s"></span></div>'
      + '<div class="vis-nav">'
      + '<button class="vis-ib" id="vis-prev" title="Anterior (←)" aria-label="Anterior">‹</button>'
      + '<span class="vis-pos" id="vis-pos"></span>'
      + '<button class="vis-ib" id="vis-next" title="Siguiente (→)" aria-label="Siguiente">›</button>'
      + '<button class="vis-ib" id="vis-ext" title="Abrir en otra pestaña" aria-label="Abrir en otra pestaña">↗</button>'
      + '<button class="vis-ib" id="vis-x" title="Cerrar (Esc)" aria-label="Cerrar">✕</button>'
      + '</div></div>'
      + '<div class="vis-main"><div class="vis-pages" id="vis-pages"></div>'
      + '<aside class="vis-side" id="vis-side"></aside></div>';
    document.body.appendChild(d);
    document.getElementById('vis-prev').onclick = function () { mover(-1); };
    document.getElementById('vis-next').onclick = function () { mover(1); };
    document.getElementById('vis-x').onclick = cerrarVisor;
    document.getElementById('vis-ext').onclick = function () { pestana(V.lista[V.i]); };
    d.addEventListener('click', function (e) { if (e.target === d || e.target.id === 'vis-pages') cerrarVisor(); });
    // En captura: el Escape del visor no tiene que cerrar además el
    // modal que quedó abajo
    document.addEventListener('keydown', function (e) {
      if (!d.classList.contains('open')) return;
      if (e.key === 'Escape') { e.stopImmediatePropagation(); cerrarVisor(); }
      else if (e.key === 'ArrowLeft') mover(-1);
      else if (e.key === 'ArrowRight') mover(1);
    }, true);
  }

  /**
   * @param {Array} lista  documentos que se recorren con ← →
   * @param {number} i     el que se abre
   * @param {Object} op    { titulo(doc), sub(doc), versiones(doc):Array,
   *                         puedeBorrar:bool, onBorrar(doc):Promise }
   */
  function abrirVisor(lista, i, op) {
    armarVisor();
    V.lista = (lista || []).slice(); V.i = Math.max(0, Math.min(i || 0, V.lista.length - 1)); V.op = op || {};
    document.getElementById('vis').classList.add('open');
    document.body.style.overflow = 'hidden';
    mostrar();
  }
  function cerrarVisor() {
    var d = document.getElementById('vis'); if (!d) return;
    d.classList.remove('open'); document.body.style.overflow = '';
    V.turno++;   // corta un dibujo a medias
    document.getElementById('vis-pages').innerHTML = '';
  }
  function mover(k) {
    var n = V.i + k;
    if (n < 0 || n >= V.lista.length) return;
    V.i = n; mostrar();
  }
  // Cambiar a otra versión del mismo papel sin perder la lista
  function verVersion(id) {
    var ds = (V.op.versiones ? V.op.versiones(V.lista[V.i]) : []).filter(function (d) { return d.id === id; });
    if (!ds.length) return;
    V.lista[V.i] = ds[0]; mostrar();
  }

  function mostrar() {
    var d = V.lista[V.i]; if (!d) { cerrarVisor(); return; }
    var op = V.op, turno = ++V.turno;
    var tag = document.getElementById('vis-tag');
    tag.className = 'vis-tag ' + d.tipo; tag.textContent = d.tipo === 'OTRO' ? 'DOC' : d.tipo;
    document.getElementById('vis-t').textContent = op.titulo ? op.titulo(d) : (d.articulo || d.nombre_archivo);
    document.getElementById('vis-s').textContent = op.sub ? op.sub(d) : (d.nombre_archivo || '');
    document.getElementById('vis-pos').textContent = V.lista.length > 1 ? (V.i + 1) + ' / ' + V.lista.length : '';
    document.getElementById('vis-prev').disabled = V.i <= 0;
    document.getElementById('vis-next').disabled = V.i >= V.lista.length - 1;
    lateral(d);

    var pg = document.getElementById('vis-pages');
    pg.innerHTML = '<div class="vis-msg"><span class="spin"></span> Abriendo ' + esc(d.nombre_archivo || 'documento') + '…</div>';
    pg.scrollTop = 0;
    firmada(d).then(function (url) {
      if (turno !== V.turno) return;
      if (esImagen(d)) {
        var img = new Image(); img.alt = d.nombre_archivo || '';
        img.onload = function () { if (turno === V.turno) { pg.innerHTML = ''; pg.appendChild(img); } };
        img.src = url;
        return;
      }
      return pdfjs().then(function (lib) { return lib.getDocument(url).promise; }).then(function (pdf) {
        if (turno !== V.turno) { pdf.destroy(); return; }
        pg.innerHTML = '';
        var ancho = Math.max(240, Math.min(pg.clientWidth - 24, 920)), n = Math.min(pdf.numPages, 40);
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        // De a una hoja: la primera se ve enseguida y las demás llegan
        var hoja = function (k) {
          if (k > n || turno !== V.turno) return Promise.resolve();
          return pdf.getPage(k).then(function (p) {
            var v = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: ancho / v.width * dpr });
            var cv = document.createElement('canvas');
            cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
            cv.style.width = Math.round(vp.width / dpr) + 'px';
            pg.appendChild(cv);
            return p.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          }).then(function () { return hoja(k + 1); });
        };
        return hoja(1).then(function () {
          if (pdf.numPages > n && turno === V.turno)
            pg.insertAdjacentHTML('beforeend', '<div class="vis-msg">Se muestran ' + n + ' de ' + pdf.numPages + ' hojas · abrilo en otra pestaña para verlo entero</div>');
          pdf.destroy();
        });
      });
    }).catch(function (e) {
      if (turno !== V.turno) return;
      pg.innerHTML = '<div class="vis-msg">⚠ No se pudo mostrar (' + esc(e && e.message || e) + '). '
        + '<button class="btn btn-ghost btn-sm" id="vis-ext2">Abrir en otra pestaña</button></div>';
      document.getElementById('vis-ext2').onclick = function () { pestana(d); };
    });
  }

  function lateral(d) {
    var op = V.op, fe = d.fecha_doc || d.mes || '';
    var filas = [
      ['Tipo', d.tipo === 'OTRO' ? (d.titulo || 'Documento') : TIPO[d.tipo]],
      ['Proveedor', d.proveedor || 'todos'],
      ['Revisión', d.revision], ['Lote', d.lote],
      ['Fecha', fe ? fechaCorta(fe) : ''],
      ['Vence', d.vence ? fechaCorta(d.vence) : ''],
      ['Archivo', d.nombre_archivo],
      ['Tamaño', d.bytes ? (d.bytes / 1024 / 1024).toFixed(2) + ' MB' : ''],
      ['Subió', (d.subido_por || '—') + ' · ' + fechaCorta(d.created_at)],
      ['Obs.', d.observaciones]
    ].filter(function (r) { return r[1]; });
    var vers = op.versiones ? op.versiones(d) : [];
    var h = '<h4>Detalle</h4><dl class="vis-meta">'
      + filas.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>';
    if (vers.length > 1) {
      h += '<h4>Versiones · ' + vers.length + '</h4>' + vers.map(function (v, k) {
        return '<button class="vis-v' + (v.id === d.id ? ' on' : '') + '" data-v="' + v.id + '">'
          + thumbHtml(v) + '<div class="vv"><b>' + (k === 0 ? 'Vigente' : 'Anterior') + (v.revision ? ' · ' + esc(v.revision) : '') + '</b>'
          + '<span>' + esc(fechaCorta(v.fecha_doc || v.created_at)) + '</span></div></button>';
      }).join('');
    }
    h += '<div class="vis-acts">'
      + '<button class="btn btn-teal" id="vis-dl">⬇ Descargar</button>'
      + (op.puedeBorrar ? '<button class="btn btn-ghost" id="vis-del">🗑 Borrar este documento</button>' : '')
      + '</div>';
    var side = document.getElementById('vis-side');
    side.innerHTML = h;
    side.querySelectorAll('.vis-v').forEach(function (b) { b.onclick = function () { verVersion(+b.getAttribute('data-v')); }; });
    miniaturas(side, function (id) { return vers.filter(function (v) { return v.id === id; })[0]; });
    document.getElementById('vis-dl').onclick = function () { bajar(d); };
    var del = document.getElementById('vis-del');
    if (del) del.onclick = function () {
      // Dos toques sobre el mismo botón (sin confirm() nativo)
      if (V.borrar !== d.id) {
        V.borrar = d.id; del.textContent = '¿Seguro? Tocá de nuevo para borrar'; del.style.color = '#fca5a5';
        setTimeout(function () { if (V.borrar === d.id) { V.borrar = null; del.textContent = '🗑 Borrar este documento'; del.style.color = ''; } }, 5000);
        return;
      }
      V.borrar = null; del.disabled = true;
      op.onBorrar(d).then(function () { cerrarVisor(); }, function () { del.disabled = false; });
    };
  }

  window.CalidadUI = {
    esc: esc, esImagen: esImagen, firmada: firmada, pestana: pestana, bajar: bajar,
    miniaturas: miniaturas, miniArchivo: miniArchivo, pintar: pintar, thumbHtml: thumbHtml,
    countUp: countUp, visor: { abrir: abrirVisor, cerrar: cerrarVisor },
    olvidar: function (id) { delete _mini[id]; }
  };
})();
