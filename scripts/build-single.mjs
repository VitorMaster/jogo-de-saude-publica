// Gera uma única página HTML autocontida (CSS, JS e dados embutidos) — útil para publicar/compartilhar.
// Uso: node scripts/build-single.mjs [saida.html]
import { readFileSync, writeFileSync } from 'node:fs';

const raiz = new URL('..', import.meta.url);
const ler = (f) => readFileSync(new URL(f, raiz), 'utf8');

// CSS: modo escuro por preferência do sistema e por escolha explícita do visualizador.
let css = ler('styles.css');
css = css.replace(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n  \}\n\}/, (_, vars) =>
  `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {${vars}\n    color-scheme: dark;\n  }\n}\n:root[data-theme="dark"] {${vars}\n  color-scheme: dark;\n}`);

// JS: junta os módulos num único script clássico (nomes de topo não podem se repetir entre módulos).
const semModulo = (src) => src
  .replace(/^import\s*\{[^}]*\}\s*from\s*'[^']*';\n/gm, '')
  .replace(/^export\s+(async\s+)?(function|const|let)/gm, '$1$2');
const base = {
  game: JSON.parse(ler('data/game.json')),
  cond: JSON.parse(ler('data/conditions.json')),
  cenarios: JSON.parse(ler('data/cenarios.json')),
};
const main = semModulo(ler('src/main.js')).replace('base = await carregarBase();', 'base = BASE_INLINE;');
const js = `(function () {\n'use strict';\nconst BASE_INLINE = ${JSON.stringify(base)};\n${['rng', 'engine', 'mundo', 'feedback', 'render'].map((m) => semModulo(ler(`src/${m}.js`))).join('\n')}
const { criarRenderer2D } = (function () {\n${semModulo(ler('src/render2d.js'))}\nreturn { criarRenderer2D };\n})();\n${main}\n})();`;
new Function(js); // falha aqui se houver nomes duplicados ou erro de sintaxe

// HTML: reaproveita o corpo do index.html
const corpo = ler('index.html').match(/<!--CONTEUDO-->([\s\S]*?)<!--\/CONTEUDO-->/)[1];
const diag = `(function () {
  var d = document.createElement('div');
  d.id = 'diag';
  d.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 72px);z-index:200;background:#fff;color:#14201e;border:1px solid #cbd5d1;border-radius:12px;padding:12px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.2)';
  d.innerHTML = '<b>Carregando o jogo…</b><div id="diag-msg" style="margin-top:6px;color:#5b6b68"></div>';
  (document.body || document.documentElement).appendChild(d);
  var msgs = [];
  window.__diag = function (m) { msgs.push(String(m)); var e = document.getElementById('diag-msg'); if (e) e.textContent = msgs.slice(-4).join(' | '); };
  window.addEventListener('error', function (ev) { window.__diag('Erro: ' + (ev.message || 'desconhecido') + (ev.lineno ? ' (linha ' + ev.lineno + ')' : '')); }, true);
  window.addEventListener('unhandledrejection', function (ev) { window.__diag('Erro: ' + (ev.reason && ev.reason.message ? ev.reason.message : ev.reason)); });
  setTimeout(function () {
    if (!window.__jogoPronto) {
      var e = document.getElementById('diag');
      if (e) { e.firstChild.textContent = 'O jogo não iniciou'; window.__diag('Navegador: ' + navigator.userAgent.slice(0, 90)); }
    }
  }, 4000);
})();`;
// Three.js: por padrão vem do cdnjs de forma ASSÍNCRONA (com limite de tempo): se a rede/visualizador bloquear ou demorar, o jogo abre no modo 2D
// em vez de ficar em branco. --inline embute o arquivo local; --sem-three não inclui nada (o carregador da versão protegida já traz).
const inline = process.argv.includes('--inline');
const semThree = process.argv.includes('--sem-three');
const padrao2d = process.argv.includes('--padrao-2d'); // abre em 2D e só carrega o 3D quando o jogador pedir
const URL3 = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const principal = `document.body.classList.add('sem-jogo');\n${js.replace(/<\/script>/g, '<\\/script>')}`;
let blocoJogo;
if (inline) blocoJogo = `<script>\n${ler('vendor/three.min.js').replace(/<\/script>/g, '<\\/script>')}\n</script>\n<script>\n${principal}\n</script>`;
else if (padrao2d) blocoJogo = `<script>window.__sem3d = true; window.__URL3 = '${URL3}';</script>\n<script>\n${principal}\n</script>`;
else if (semThree) blocoJogo = `<script>\n${principal}\n</script>`;
else {
  const carregador = `(function () {
  var feito = false;
  function ir(motivo) {
    if (feito) return; feito = true;
    if (motivo && window.__diag) window.__diag(motivo);
    try { window.__jogoMain(); } catch (e) { if (window.__diag) window.__diag('Erro: ' + (e && e.message ? e.message : e)); }
  }
  var s = document.createElement('script');
  s.src = '${URL3}'; s.async = true;
  s.onload = function () { ir(); };
  s.onerror = function () { ir('3D indisponível: abrindo em modo simples (2D)'); };
  (document.head || document.documentElement).appendChild(s);
  setTimeout(function () { ir('O 3D demorou para carregar: abrindo em modo simples (2D)'); }, 4000);
})();`;
  blocoJogo = `<script>\nwindow.__jogoMain = function () {\n${principal}\n};\n</script>\n<script>\n${carregador}\n</script>`;
}
const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Saudedavida - SV</title>
<style>\n${css}\n</style>
${corpo}
<script>\n${diag}\n</script>
${blocoJogo}
`;
const saida = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'dist/saude-sim.html';
writeFileSync(saida, html);
console.log(`${saida}: ${(html.length / 1024).toFixed(0)} KB`);
