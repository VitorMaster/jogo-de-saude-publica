// Calibração: prevalência inicial em muitos territórios e incidência ao longo de 5 anos.
import { cfg } from '../tests/helpers.mjs';
import { newGame, avancarMes, todasPessoas, CONDS } from '../src/engine.js';

const N = 300;
const tot = { adultos: 0, has: 0, dm: 0, dep: 0 };
for (let i = 1; i <= N; i++) {
  const s = newGame(cfg, i * 7919);
  for (const p of todasPessoas(s)) {
    if (p.idade < 18) continue;
    tot.adultos++;
    for (const id of CONDS) if (p.cond[id].estagio >= 2) tot[id]++;
  }
}
console.log('Prevalência inicial (adultos):', Object.fromEntries(CONDS.map((id) => [id, (100 * tot[id] / tot.adultos).toFixed(1) + '%'])));

// 5 anos sem fazer nada: quantas complicações?
let compl = { has: 0, dm: 0, dep: 0 }, deng = 0, intern = 0;
for (let i = 1; i <= 100; i++) {
  const s = newGame(cfg, i * 104729);
  for (let m = 0; m < 60; m++) avancarMes(s, cfg);
  for (const p of todasPessoas(s)) for (const id of CONDS) if (p.cond[id].estagio === 3) compl[id]++;
  intern += s.internacoes.length;
}
console.log('Complicações ao fim de 5 anos sem intervenção (por território):', Object.fromEntries(Object.entries(compl).map(([k, v]) => [k, (v / 100).toFixed(2)])), 'internações/território:', (intern / 100).toFixed(1));
