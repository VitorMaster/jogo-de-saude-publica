// Service worker: o jogo funciona offline depois da primeira visita.
const VERSAO = 'saude-sim-v11';
const ARQUIVOS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'src/main.js', 'src/engine.js', 'src/rng.js', 'src/mundo.js', 'src/render.js', 'src/render2d.js', 'src/feedback.js',
  'vendor/three.min.js',
  'data/game.json', 'data/conditions.json', 'data/cenarios.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Rede primeiro (para receber atualizações), cache como reserva offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => { const cp = r.clone(); caches.open(VERSAO).then((c) => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
