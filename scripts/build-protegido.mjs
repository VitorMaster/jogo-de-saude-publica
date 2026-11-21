// Gera a versão de TESTE protegida em dist-teste/: o jogo inteiro fica criptografado (AES-256-GCM) e só abre com um
// código pessoal por testador. A pasta gerada pode ser hospedada em qualquer lugar público sem expor o código do jogo.
//
// Uso:
//   node scripts/build-protegido.mjs                    # usa testers.local.json (cria com 10 vagas se não existir)
//   node scripts/build-protegido.mjs --nomes "Ana,Bruno" # cria/atualiza a lista com esses nomes
//   node scripts/build-protegido.mjs --dias 30           # validade dos códigos (padrão: 45 dias)
//
// testers.local.json NUNCA vai para o git (contém os códigos). Guarde uma cópia: sem ele, é preciso gerar códigos novos.
import { execFileSync } from 'node:child_process';
import { webcrypto, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const raiz = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const opc = (nome, padrao) => { const i = args.indexOf(`--${nome}`); return i >= 0 ? args[i + 1] : padrao; };
const dias = Number(opc('dias', 45));
const nomes = opc('nomes', '');
const arquivoLista = join(raiz, 'testers.local.json');
const ITER = 200000;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function novoCodigo(id) {
  const b = randomBytes(10);
  let s = '';
  for (const x of b) s += ALFABETO[x % ALFABETO.length];
  return `${id}-${s.slice(0, 5)}-${s.slice(5)}`;
}
const dataMais = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

// 1) Lista de testadores
let lista = [];
if (existsSync(arquivoLista)) lista = JSON.parse(readFileSync(arquivoLista, 'utf8'));
if (nomes) {
  nomes.split(',').map((n) => n.trim()).filter(Boolean).forEach((nome) => {
    if (lista.find((t) => t.nome === nome)) return;
    const id = 'T' + String(lista.length + 1).padStart(2, '0');
    lista.push({ id, nome, codigo: novoCodigo(id), expira: dataMais(dias) });
  });
}
if (!lista.length) for (let i = 1; i <= 10; i++) { const id = 'T' + String(i).padStart(2, '0'); lista.push({ id, nome: `Testador ${i}`, codigo: novoCodigo(id), expira: dataMais(dias) }); }
for (const t of lista) if (!t.expira) t.expira = dataMais(dias);
writeFileSync(arquivoLista, JSON.stringify(lista, null, 2) + '\n');

// 2) Jogo em página única (sem a tag do Three.js: o carregador já traz a biblioteca)
const tmp = join(tmpdir(), `saude-sim-${process.pid}.html`);
execFileSync('node', [join(raiz, 'scripts/build-single.mjs'), tmp, '--sem-three'], { stdio: 'pipe' });
let jogo = readFileSync(tmp, 'utf8').replace(/<script src="https:\/\/cdnjs[^"]*"><\/script>\n?/, '');
rmSync(tmp);

// 3) Criptografia
const { subtle } = webcrypto;
const b64 = (buf) => Buffer.from(buf).toString('base64');
const K = randomBytes(32);
const kCrypto = await subtle.importKey('raw', K, 'AES-GCM', false, ['encrypt']);
const iv = randomBytes(12);
const cifra = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, kCrypto, Buffer.from(jogo, 'utf8')));

const entradas = {};
for (const t of lista) {
  const salt = randomBytes(16), ivT = randomBytes(12);
  const base = await subtle.importKey('raw', Buffer.from(t.codigo.toUpperCase().replace(/\s/g, ''), 'utf8'), 'PBKDF2', false, ['deriveKey']);
  const kw = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const dados = Buffer.from(JSON.stringify({ k: b64(K), id: t.id, exp: t.expira }), 'utf8');
  entradas[t.id] = { s: b64(salt), i: b64(ivT), c: b64(new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: ivT }, kw, dados))) };
}
const PACOTE = { it: ITER, i: b64(iv), c: b64(cifra), t: entradas };

// 4) Página carregadora (só tela de código + decifragem em memória)
const carregador = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#0f766e"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="SV"><link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-192.png"><link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<title>Saudedavida - SV</title>
<style>
html,body{margin:0;height:100%;background:#0f766e;font:16px/1.45 system-ui,-apple-system,sans-serif;color:#14201e;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
main{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px}
.c{background:#fff;border-radius:18px;padding:22px;max-width:380px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.25)}
h1{margin:0 0 6px;font-size:22px}p{margin:6px 0;color:#5b6b68;font-size:14px}
input{width:100%;box-sizing:border-box;font:inherit;font-size:18px;letter-spacing:.06em;text-transform:uppercase;padding:12px;margin-top:12px;border:1px solid #cbd5d1;border-radius:12px;-webkit-user-select:text;user-select:text}
button{width:100%;margin-top:12px;min-height:48px;border:0;border-radius:12px;background:#0f766e;color:#fff;font:inherit;font-weight:700}
#msg{color:#b91c1c;min-height:20px;font-size:14px;margin-top:8px}.aviso{font-size:12px;margin-top:14px}
</style></head><body><main><div class="c">
<h1>🩺 Saudedavida - SV</h1><p>Versão de teste <b>confidencial</b>. Digite o código pessoal que você recebeu.</p>
<form id="f" autocomplete="off"><input id="cod" placeholder="T01-XXXXX-XXXXX" autocapitalize="characters" autocorrect="off" spellcheck="false" aria-label="Código de acesso"><button type="submit">Entrar</button></form>
<div id="msg" role="status"></div>
<p class="aviso">Este material é protegido e de uso exclusivo de testadores autorizados. Cada tela é identificada com o seu código. É proibido compartilhar o acesso, divulgar imagens ou copiar o conteúdo.</p>
</div></main>
<script src="three.min.js"></script>
<script>
(function () {
  var P = ${JSON.stringify(PACOTE)};
  function d(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  var enc = new TextEncoder(), dec = new TextDecoder();
  function msg(t) { document.getElementById('msg').textContent = t; }
  async function abrir(codigo) {
    codigo = codigo.toUpperCase().replace(/\\s/g, '');
    var e = P.t[codigo.split('-')[0]];
    if (!e || !window.crypto || !crypto.subtle) throw new Error(window.crypto && crypto.subtle ? 'inv' : 'sem-crypto');
    var base = await crypto.subtle.importKey('raw', enc.encode(codigo), 'PBKDF2', false, ['deriveKey']);
    var kw = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: d(e.s), iterations: P.it }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var info;
    try { info = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d(e.i) }, kw, d(e.c)))); } catch (x) { throw new Error('inv'); }
    if (info.exp && new Date().toISOString().slice(0, 10) > info.exp) throw new Error('exp');
    var k = await crypto.subtle.importKey('raw', d(info.k), 'AES-GCM', false, ['decrypt']);
    var html = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d(P.i) }, k, d(P.c)));
    var marca = '<script>window.__testador={id:' + JSON.stringify(info.id) + '};<\\/script>'
      + '<style>#marca-d{position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden;opacity:.07;font:700 13px system-ui;color:#000}#marca-d span{position:absolute;white-space:nowrap;transform:rotate(-24deg)}'
      + 'body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}input,textarea{-webkit-user-select:text;user-select:text}</style>';
    var tiles = ''; for (var y = -2; y < 12; y++) for (var x = -1; x < 4; x++) tiles += '<span style="left:' + (x * 150 + (y % 2) * 70) + 'px;top:' + (y * 90) + 'px">' + info.id + ' · confidencial</span>';
    html = html + '<div id="marca-d">' + tiles + '</div>';
    html = html.replace('<title>', marca + '<title>');
    try { localStorage.setItem('ss-cod', codigo); } catch (x) { /* ok */ }
    document.open(); document.write(html); document.close();
    document.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  }
  async function tentar(c, auto) {
    msg(auto ? '' : 'Verificando…');
    try { await abrir(c); } catch (x) {
      if (auto) { try { localStorage.removeItem('ss-cod'); } catch (y) { /* ok */ } return; }
      msg({ inv: 'Código inválido.', exp: 'Este código expirou. Peça um novo.', 'sem-crypto': 'Abra o link em https (Safari/Chrome atualizados).' }[x.message] || 'Não foi possível abrir.');
    }
  }
  document.getElementById('f').addEventListener('submit', function (ev) { ev.preventDefault(); var v = document.getElementById('cod').value; if (v) tentar(v, false); });
  var salvo = null; try { salvo = localStorage.getItem('ss-cod'); } catch (x) { /* ok */ }
  if (salvo) tentar(salvo, true);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
})();
</script></body></html>
`;

// 5) Saída
const saida = join(raiz, 'dist-teste');
rmSync(saida, { recursive: true, force: true });
mkdirSync(join(saida, 'icons'), { recursive: true });
writeFileSync(join(saida, 'index.html'), carregador);
cpSync(join(raiz, 'vendor/three.min.js'), join(saida, 'three.min.js'));
for (const f of ['icon.svg', 'icon-192.png', 'icon-512.png']) cpSync(join(raiz, 'icons', f), join(saida, 'icons', f));
const manifesto = JSON.parse(readFileSync(join(raiz, 'manifest.webmanifest'), 'utf8'));
manifesto.description = 'Versão de teste';
writeFileSync(join(saida, 'manifest.webmanifest'), JSON.stringify(manifesto, null, 2));
writeFileSync(join(saida, 'sw.js'), `const V = 'ss-teste-${Date.now()}';
const A = ['./', 'index.html', 'three.min.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(A)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
`);
writeFileSync(join(saida, '.nojekyll'), '');
console.log(`dist-teste/ pronto (${(carregador.length / 1024).toFixed(0)} KB). Testadores:`);
for (const t of lista) console.log(`  ${t.id}  ${t.nome.padEnd(16)} ${t.codigo}  (até ${t.expira})`);
