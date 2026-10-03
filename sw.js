// Service worker de la carta: guarda la carta y los archivos de la mesa para que se pueda ver con mala señal
// (interior, sótanos). Todo va «red primero, caché si no hay red», así una publicación nueva se ve en la
// siguiente carga y nunca se mezclan archivos de dos versiones. No toca nada de otros dominios (el relevo
// ntfy.sh y la librería del QR pasan directo).

const VERSION = 'atk-mesa-v3';
const PRECARGA = [
  'mesa.html',
  'manifest.webmanifest',
  'datos/carta.json',
  'css/tokens.css',
  'css/base.css',
  'css/mesa.css',
  'js/vistas/mesa.js',
  'js/ui/dom.js',
  'js/ui/comun.js',
  'js/ui/almacen.js',
  'js/ui/caja-local.js',
  'js/ui/cliente-mesa.js',
  'js/ui/relevo.js',
  'js/nucleo/caja.mjs',
  'js/nucleo/carta.mjs',
  'js/nucleo/cuenta.mjs',
  'js/nucleo/dinero.mjs',
  'js/nucleo/division.mjs',
  'js/nucleo/estados.mjs',
  'js/nucleo/intentos.mjs',
  'js/nucleo/mensajes.mjs',
  'js/nucleo/plano.mjs',
  'js/nucleo/propina.mjs',
  'js/nucleo/resumen.mjs',
  'js/nucleo/semilla.mjs',
  'js/nucleo/textos.mjs',
  'js/nucleo/url.mjs',
  'img/iconos.svg',
  'img/favicon.svg',
  'img/yappy-ejemplo.svg',
  'img/marca/logo-claro.svg',
  'img/marca/logo-oscuro.svg',
  'fuentes/bricolage-700-latin.woff2',
  'fuentes/atkinson-next-latin.woff2',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECARGA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k.startsWith('atk-mesa-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Red primero para todo: con señal siempre se ve lo último publicado; sin señal, lo guardado.
  ev.respondWith(
    fetch(req)
      .then((r) => {
        if (r.ok && r.type === 'basic') {
          const copia = r.clone();
          caches.open(VERSION).then((c) => c.put(req, copia));
        }
        return r;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((r) => r || Response.error())),
  );
});
