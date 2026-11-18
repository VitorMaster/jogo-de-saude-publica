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
const js = `(function () {\n'use strict';\nconst BASE_INLINE = ${JSON.stringify(base)};\n${['rng', 'engine', 'mundo', 'render'].map((m) => semModulo(ler(`src/${m}.js`))).join('\n')}\n${main}\n})();`;
new Function(js); // falha aqui se houver nomes duplicados ou erro de sintaxe

// HTML: reaproveita o corpo do index.html
const corpo = ler('index.html').match(/<!--CONTEUDO-->([\s\S]*?)<!--\/CONTEUDO-->/)[1];
const html = `<title>Saúde Sim</title>
<style>\n${css}\n</style>
${corpo}
<script>\ndocument.body.classList.add('sem-jogo');\n${js.replace(/<\/script>/g, '<\\/script>')}\n</script>
`;
const saida = process.argv[2] || 'dist/saude-sim.html';
writeFileSync(saida, html);
console.log(`${saida}: ${(html.length / 1024).toFixed(0)} KB`);
