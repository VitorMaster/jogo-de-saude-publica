// Gera uma única página HTML autocontida (CSS, JS e dados embutidos) — útil para publicar/compartilhar.
// Uso: node scripts/build-single.mjs [saida.html]
import { readFileSync, writeFileSync } from 'node:fs';

const raiz = new URL('..', import.meta.url);
const ler = (f) => readFileSync(new URL(f, raiz), 'utf8');

// CSS: garante o modo escuro por preferência do sistema e por escolha explícita do visualizador.
let css = ler('styles.css');
css = css.replace(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n  \}\n\}/, (_, vars) =>
  `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {${vars}\n    color-scheme: dark;\n  }\n}\n:root[data-theme="dark"] {${vars}\n  color-scheme: dark;\n}`);

// JS: junta os módulos num único script clássico.
const semModulo = (src) => src
  .replace(/^import\s*\{[^}]*\}\s*from\s*'[^']*';\n/gm, '')
  .replace(/^export\s+(async\s+)?(function|const|let)/gm, '$1$2');
const dados = { game: JSON.parse(ler('data/game.json')), cond: JSON.parse(ler('data/conditions.json')), territorio: JSON.parse(ler('data/territorio.json')) };
let main = semModulo(ler('src/main.js'))
  .replace('cfg = await carregarConfig();', 'cfg = CFG_INLINE;')
  .replace(/\s*if \('serviceWorker' in navigator\)[^\n]*\n/, '\n');
const js = `(function () {\n'use strict';\nconst CFG_INLINE = ${JSON.stringify(dados)};\n${semModulo(ler('src/rng.js'))}\n${semModulo(ler('src/engine.js'))}\n${main}\n})();`;

const html = `<title>Saúde Sim</title>
<style>\n${css}\n</style>
<div id="app" aria-live="polite"></div>
<div id="toast" role="status"></div>
<script>\n${js.replace(/<\/script>/g, '<\\/script>')}\n</script>
`;
const saida = process.argv[2] || 'dist/saude-sim.html';
writeFileSync(saida, html);
console.log(`${saida}: ${(html.length / 1024).toFixed(0)} KB`);
