// Mostra o mapa em ASCII e um resumo do comportamento simulado (para conferir o equilíbrio).
import { cfgDe } from '../tests/helpers.mjs';
import { newGame, todasPessoas } from '../src/engine.js';
import { iniciarEstadoMundo, criarMundo, passoMundo, minutoDoDia, ACOES_INFO } from '../src/mundo.js';

const id = process.argv[2] || 'interior';
const cfg = cfgDe(id);
const S = newGame(cfg, 42); S.tempoReal = true; iniciarEstadoMundo(S);
const W = criarMundo(S, cfg);
const linhas = [];
for (let y = 0; y < W.h; y++) {
  let l = '';
  for (let x = 0; x < W.w; x++) {
    const o = W.objs.find((q) => q.x === x && q.y === y);
    l += o ? o.t : W.terr[y * W.w + x];
  }
  linhas.push(l);
}
console.log(linhas.join('\n'));
const contagem = {};
let exMin = 0, n = 0;
for (let i = 0; i < 12 * 24 * 12; i++) {
  passoMundo(W, S, cfg, 5);
  if (i % 12 === 0) for (const a of W.agentes) if (a.k === 'res' && a.vis) { const k = a.acao ? a.acao.k : a.path.length ? 'andando' : a.espera ? 'espera' : '-'; contagem[k] = (contagem[k] || 0) + 1; n++; }
}
console.log('\nTempo (%) por atividade em 12 dias:');
console.log(Object.entries(contagem).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / n).toFixed(0)}%`).join(' · '));
console.log('Hábitos médios (adultos):', ['atividade', 'alimentacao', 'sono', 'estresse'].map((k) => {
  const ps = todasPessoas(S).filter((p) => p.idade >= 18);
  return `${k} ${(ps.reduce((a, p) => a + p.habitos[k], 0) / ps.length).toFixed(0)}`;
}).join(' · '));

// minutos de exercício por dia segundo o hábito inicial de atividade (sedentário x ativo)
{
  const S2 = newGame(cfg, 77); S2.tempoReal = true; iniciarEstadoMundo(S2);
  const W2 = criarMundo(S2, cfg);
  const adultos = todasPessoas(S2).filter((p) => p.idade >= 18);
  const tot = {}; adultos.forEach((p) => (tot[p.id] = 0));
  let dias = 0;
  for (let i = 0; i < 10 * 24 * 12; i++) {
    const antes = Math.floor(S2.mundo.min / 1440);
    adultos.forEach((p) => (tot[p.id] += 0));
    passoMundo(W2, S2, cfg, 5);
    if (Math.floor(S2.mundo.min / 1440) > antes) dias++;
  }
  const grupos = { baixo: [], medio: [], alto: [] };
  adultos.forEach((p) => grupos[p.habitos.atividade < 40 ? 'baixo' : p.habitos.atividade < 70 ? 'medio' : 'alto'].push(p.habitos.atividade));
  console.log('Hábito de atividade ao fim de 10 dias (adultos):', Object.entries(grupos).map(([k, v]) => `${k}: ${v.length} pessoas`).join(' · '));
}
