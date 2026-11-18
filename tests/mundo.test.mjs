import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cfgDe } from './helpers.mjs';
import { newGame, todasPessoas, achaPessoa } from '../src/engine.js';
import {
  iniciarEstadoMundo, criarMundo, passoMundo, pularMes, ordenarVisita, ordenarUnidade, ordenarOrientar,
  ordenarMutirao, diaDoJogo, diaSemana, minutoDoDia,
} from '../src/mundo.js';

const CENARIOS = ['metropole', 'interior', 'rural'];

function novo(id, seed = 42) {
  const cfg = cfgDe(id);
  const S = newGame(cfg, seed);
  S.tempoReal = true;
  iniciarEstadoMundo(S);
  const W = criarMundo(S, cfg);
  return { cfg, S, W };
}

test('todos os cenários: cada casa e a UBS têm porta, e todas as portas se conectam entre si', () => {
  for (const id of CENARIOS) {
    const { cfg, S, W } = novo(id);
    assert.ok(W.ubs && W.ubs.porta, `${id}: UBS sem porta`);
    for (const f of cfg.territorio.familias) assert.ok(W.casas[f.id] && W.casas[f.id].porta, `${id}: casa ${f.id} sem porta`);
    // BFS a partir da porta da UBS: alcança a frente de todas as portas e todos os objetos públicos
    const { w, h } = W;
    const visto = new Uint8Array(w * h);
    const ini = W.ubs.porta.fora;
    const fila = [ini.y * w + ini.x]; visto[fila[0]] = 1;
    for (let i = 0; i < fila.length; i++) {
      const c = fila[i], x = c % w, y = (c / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || visto[k] || W.bloq[k]) continue;
        visto[k] = 1; fila.push(k);
      }
    }
    for (const casa of Object.values(W.casas)) {
      assert.ok(visto[casa.porta.fora.y * w + casa.porta.fora.x], `${id}: rua em frente a ${casa.casa} inacessível`);
      assert.ok(visto[casa.porta.dentro.y * w + casa.porta.dentro.x], `${id}: interior de ${casa.casa} inacessível`);
    }
    for (const o of W.objs.filter((o) => o.casa === null)) {
      const alcanca = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => visto[(o.y + dy) * w + (o.x + dx)]);
      assert.ok(alcanca, `${id}: objeto ${o.t} em (${o.x},${o.y}) inacessível`);
    }
    // cada casa tem cama, cozinha, chuveiro e sofá
    for (const f of cfg.territorio.familias) for (const t of ['B', 'C', 'G', 'S']) assert.ok(W.objs.some((o) => o.casa === f.id && o.t === t), `${id}: ${f.id} sem ${t}`);
    assert.equal(S.familias.length, cfg.territorio.familias.length);
  }
});

test('simulação de 40 dias: ninguém fica preso, valores válidos, o mês vira e os hábitos mudam pelo comportamento', () => {
  for (const id of CENARIOS) {
    const { cfg, S, W } = novo(id, 7);
    const hab0 = todasPessoas(S).map((p) => ({ ...p.habitos }));
    let meses = 0;
    for (let i = 0; i < 40 * 24 * 4; i++) if (passoMundo(W, S, cfg, 15)) meses++;
    assert.ok(meses >= 1, `${id}: o mês não virou`);
    assert.equal(S.turno, meses);
    for (const a of W.agentes) {
      assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), `${id}: posição inválida de ${a.id}`);
      assert.ok(a.x >= 0 && a.y >= 0 && a.x < W.w && a.y < W.h);
    }
    for (const p of todasPessoas(S)) {
      const n = S.mundo.needs[p.id];
      for (const v of Object.values(n)) assert.ok(v >= 0 && v <= 100);
      for (const v of Object.values(p.habitos)) assert.ok(v >= 0 && v <= 100);
    }
    const mudou = todasPessoas(S).some((p, i) => Math.abs(p.habitos.atividade - hab0[i].atividade) > 0.5);
    assert.ok(mudou, `${id}: hábitos não mudaram`);
  }
});

test('moradores têm rotina: dormem à noite, saem para trabalhar/estudar e comem', () => {
  const { cfg, S, W } = novo('interior', 3);
  const visto = { dormir: 0, trabalho: 0, escola: 0, comer: 0 };
  for (let i = 0; i < 3 * 24 * 12; i++) {
    passoMundo(W, S, cfg, 5);
    for (const a of W.agentes) if (a.k === 'res' && a.acao && visto[a.acao.k] !== undefined) visto[a.acao.k]++;
  }
  for (const k of Object.keys(visto)) assert.ok(visto[k] > 0, `ninguém executou "${k}"`);
});

test('triagem e consulta: o morador vai à unidade, espera, é atendido e o diagnóstico acontece', () => {
  const { cfg, S, W } = novo('interior', 11);
  const alvo = todasPessoas(S).find((p) => p.idade >= 18 && p.cond.has.estagio >= 2);
  assert.ok(alvo);
  S.familias.forEach((f) => (f.vinculo = 100));
  assert.ok(ordenarUnidade(W, S, cfg, alvo.id, 'triagem').ok);
  assert.equal(ordenarUnidade(W, S, cfg, alvo.id, 'consulta').ok, false, 'não duplica chamado');
  let ok = false;
  for (let i = 0; i < 4 * 24 * 12 && !ok; i++) { passoMundo(W, S, cfg, 5); ok = alvo.conhecido.medidasTurno !== null; }
  assert.ok(ok, 'a triagem não aconteceu');
  assert.ok(ordenarUnidade(W, S, cfg, alvo.id, 'consulta').ok);
  let diag = false;
  for (let tent = 0; tent < 6 && !diag; tent++) {
    for (let i = 0; i < 3 * 24 * 12 && !alvo.cond.has.diag; i++) passoMundo(W, S, cfg, 5);
    diag = alvo.cond.has.diag;
    if (!diag) ordenarUnidade(W, S, cfg, alvo.id, 'consulta');
  }
  assert.ok(diag, 'a consulta não diagnosticou');
});

test('visita domiciliar: o agente comunitário vai até a casa e a visita é concluída', () => {
  const { cfg, S, W } = novo('interior', 5);
  const f = S.familias[0];
  const v0 = f.vinculo;
  assert.ok(ordenarVisita(W, S, cfg, f.id).ok);
  assert.equal(ordenarVisita(W, S, cfg, f.id).ok, false);
  for (let i = 0; i < 2 * 24 * 12 && f.visTurno !== S.turno; i++) passoMundo(W, S, cfg, 5);
  assert.equal(f.visTurno, S.turno);
  assert.ok(f.vinculo > v0);
  assert.ok(f.pessoas.every((p) => p.conhecido.habitos), 'hábitos conhecidos após a visita');
});

test('orientar muda a intenção e o mutirão reduz a infestação', () => {
  const { cfg, S, W } = novo('interior', 9);
  const p = todasPessoas(S).find((x) => x.idade >= 18);
  assert.ok(ordenarOrientar(W, S, cfg, p.id, 'atividade').ok);
  assert.ok(ordenarMutirao(W, S, cfg).ok);
  const inf0 = S.infestacao;
  for (let i = 0; i < 2 * 24 * 12; i++) passoMundo(W, S, cfg, 5);
  assert.ok(S.mundo.intencao[p.id].atividade > 0 || p.habitos.atividade > 0);
  assert.equal(S.mutiraoTurno, S.turno);
  assert.ok(S.infestacao < inf0);
});

test('zona rural: o médico só atende nos dias configurados; quem quer consulta espera esses dias', () => {
  const { cfg, S, W } = novo('rural', 13);
  const alvo = todasPessoas(S).find((p) => p.idade >= 18 && p.cond.has.estagio >= 2) || todasPessoas(S).find((p) => p.idade >= 18);
  S.familias.forEach((f) => (f.vinculo = 100));
  ordenarUnidade(W, S, cfg, alvo.id, 'consulta');
  const diasAtendido = new Set();
  const antes = (S.diario.length);
  for (let i = 0; i < 8 * 24 * 12; i++) {
    passoMundo(W, S, cfg, 5);
    if (W.agentes.some((a) => a.id === alvo.id && a.atend && a.atend.pronto)) diasAtendido.add(diaSemana(S));
  }
  for (const d of diasAtendido) assert.ok(cfg.cenario.mundo.medicoDias.includes(d), `atendido num dia sem médico: ${d}`);
  assert.ok(S.diario.length > antes, 'a consulta deveria ter ocorrido em 8 dias');
});

test('pularMes termina o mês e é determinístico', () => {
  const a = novo('metropole', 21), b = novo('metropole', 21);
  pularMes(a.W, a.S, a.cfg); pularMes(b.W, b.S, b.cfg);
  assert.equal(a.S.turno, 1);
  assert.deepEqual(a.S.mundo, b.S.mundo);
  assert.deepEqual(a.S.familias, b.S.familias);
});

test('o estado salvo (S) pode ser recarregado e o mundo reconstruído', () => {
  const { cfg, S, W } = novo('interior', 17);
  for (let i = 0; i < 5 * 24 * 12; i++) passoMundo(W, S, cfg, 5);
  const S2 = JSON.parse(JSON.stringify(S));
  const W2 = criarMundo(S2, cfg);
  for (let i = 0; i < 24 * 12; i++) passoMundo(W2, S2, cfg, 5);
  assert.ok(S2.mundo.min > S.mundo.min);
  assert.ok(minutoDoDia(S2) >= 0 && diaDoJogo(S2) >= 5);
});

test('internado some do mapa e volta depois da alta', () => {
  const { cfg, S, W } = novo('interior', 4);
  const p = todasPessoas(S)[0];
  p.internado = true;
  passoMundo(W, S, cfg, 5);
  const a = W.agentes.find((x) => x.pid === p.id);
  assert.equal(a.vis, false);
  p.internado = false;
  passoMundo(W, S, cfg, 5);
  assert.equal(a.vis, true);
});

test('a página única (build) compila sem nomes duplicados', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const saida = join(mkdtempSync(join(tmpdir(), 'ss-')), 'saida.html');
  execFileSync('node', ['scripts/build-single.mjs', saida], { cwd: new URL('..', import.meta.url).pathname });
  const html = readFileSync(saida, 'utf8');
  assert.ok(html.includes('BASE_INLINE') && html.includes('data-act="familias"'));
});

test('ritmo do tempo: devagar no expediente, mais rápido à noite; pularDia vai até as 7h', async () => {
  const { minutosPorSegundo, pularDia } = await import('../src/mundo.js');
  const { cfg, S, W } = novo('interior', 31);
  S.mundo.min = 10 * 60;
  const dia = minutosPorSegundo(S);
  S.mundo.min = 23 * 60;
  const noite = minutosPorSegundo(S);
  assert.ok(dia < noite, `expediente (${dia}) deve ser mais lento que a noite (${noite})`);
  S.mundo.min = 14 * 60;
  pularDia(W, S, cfg);
  assert.equal(Math.floor(minutoDoDia(S)), 7 * 60);
});
