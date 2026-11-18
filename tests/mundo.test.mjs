import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cfgDe } from './helpers.mjs';
import { newGame, todasPessoas, achaPessoa } from '../src/engine.js';
import {
  iniciarEstadoMundo, criarMundo, passoMundo, pularMes, pularDia, ordenarVisita, ordenarUnidade, ordenarOrientar,
  ordenarMutirao, diaDoJogo, diaSemana, minutoDoDia, minutosPorSegundo, escolherPersonagem, agenteJogador,
  opcoesPara, comandar, acoesPaciente, iniciarAtendimento, finalizarAtendimento, atendimentoAtual, filaEspera, sintomasDe,
} from '../src/mundo.js';

const CENARIOS = ['metropole', 'interior', 'rural'];
const ministros = (W, S, cfg, minutos) => { for (let i = 0; i < minutos / 5; i++) passoMundo(W, S, cfg, 5); };

function novo(id, seed = 42, jogador = null) {
  const cfg = cfgDe(id);
  const S = newGame(cfg, seed);
  S.tempoReal = true;
  iniciarEstadoMundo(S);
  if (jogador) escolherPersonagem(S, jogador);
  const W = criarMundo(S, cfg);
  return { cfg, S, W };
}

test('todos os cenários: portas, móveis essenciais e conexão entre todos os lugares', () => {
  for (const id of CENARIOS) {
    const { cfg, S, W } = novo(id);
    assert.ok(W.ubs && W.ubs.porta, `${id}: UBS sem porta`);
    for (const f of cfg.territorio.familias) assert.ok(W.casas[f.id] && W.casas[f.id].porta, `${id}: casa ${f.id} sem porta`);
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
    const alcanca = (o) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => visto[(o.y + dy) * w + (o.x + dx)]);
    for (const casa of Object.values(W.casas)) {
      assert.ok(visto[casa.porta.fora.y * w + casa.porta.fora.x], `${id}: rua em frente a ${casa.casa} inacessível`);
      assert.ok(visto[casa.porta.dentro.y * w + casa.porta.dentro.x], `${id}: interior de ${casa.casa} inacessível`);
    }
    for (const o of W.objs.filter((o) => !o.decor)) assert.ok(alcanca(o), `${id}: objeto ${o.t} em (${o.x},${o.y}) inacessível`);
    for (const f of cfg.territorio.familias) for (const t of ['B', 'C', 'G', 'S', 'V', 'X', 'N']) assert.ok(W.objs.some((o) => o.casa === f.id && o.t === t), `${id}: ${f.id} sem ${t}`);
    for (const t of ['H', 'U', 'D', 'Y']) assert.ok(W.objs.some((o) => o.lugar === 'ubs' && o.t === t), `${id}: UBS sem ${t}`);
    assert.ok(W.objs.filter((o) => o.lugar === 'ubs' && o.t === 'D').length >= 2, 'UBS precisa de 2 consultórios');
    assert.equal(S.familias.length, cfg.territorio.familias.length);
  }
});

test('simulação de 40 dias sem jogador: valores válidos, o mês vira e os hábitos mudam pelo comportamento', () => {
  for (const id of CENARIOS) {
    const { cfg, S, W } = novo(id, 7);
    const hab0 = todasPessoas(S).map((p) => ({ ...p.habitos }));
    let meses = 0;
    for (let i = 0; i < 40 * 24 * 4; i++) if (passoMundo(W, S, cfg, 15)) meses++;
    assert.ok(meses >= 1, `${id}: o mês não virou`);
    for (const a of W.agentes) { assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y)); assert.ok(a.x >= 0 && a.y >= 0 && a.x < W.w && a.y < W.h); }
    for (const p of todasPessoas(S)) {
      for (const v of Object.values(S.mundo.needs[p.id])) assert.ok(v >= 0 && v <= 100);
      for (const v of Object.values(p.habitos)) assert.ok(v >= 0 && v <= 100);
    }
    assert.ok(todasPessoas(S).some((p, i) => Math.abs(p.habitos.atividade - hab0[i].atividade) > 0.5), `${id}: hábitos não mudaram`);
  }
});

test('rotina: dormir, cozinhar e comer à mesa, TV, trabalho/escola', () => {
  const { cfg, S, W } = novo('interior', 3);
  const visto = {};
  for (let i = 0; i < 3 * 24 * 12; i++) {
    passoMundo(W, S, cfg, 5);
    for (const a of W.agentes) if (a.k === 'res' && a.acao) visto[a.acao.k] = (visto[a.acao.k] || 0) + 1;
  }
  for (const k of ['dormir', 'cozinhar', 'comer_mesa', 'tv', 'trabalho', 'escola']) assert.ok(visto[k] > 0, `ninguém executou "${k}": ${JSON.stringify(visto)}`);
});

test('refeição: cozinha primeiro e depois come à mesa (ação encadeada)', () => {
  const { cfg, S, W } = novo('interior', 5);
  const p = todasPessoas(S).find((x) => x.idade >= 18);
  const a = W.agentes.find((x) => x.pid === p.id);
  S.mundo.needs[p.id].fome = 10;
  const sequencia = [];
  for (let i = 0; i < 40 * 5 && sequencia.filter((k) => k === 'comer_mesa').length === 0; i++) { passoMundo(W, S, cfg, 1); if (a.acao && sequencia[sequencia.length - 1] !== a.acao.k) sequencia.push(a.acao.k); }
  const i = sequencia.indexOf('cozinhar');
  assert.ok(i >= 0 && sequencia[i + 1] === 'comer_mesa', `sequência: ${sequencia}`);
});

test('triagem e consulta (equipe autônoma): o morador vai à unidade, espera, é atendido e diagnosticado', () => {
  const { cfg, S, W } = novo('interior', 11);
  const alvo = todasPessoas(S).find((p) => p.idade >= 18 && p.cond.has.estagio >= 2);
  assert.ok(alvo);
  S.familias.forEach((f) => (f.vinculo = 100));
  assert.ok(ordenarUnidade(W, S, cfg, alvo.id, 'triagem', { espontaneo: true, meta: { consulta: true } }).ok);
  assert.equal(ordenarUnidade(W, S, cfg, alvo.id, 'consulta').ok, false, 'não duplica chamado');
  let diag = false;
  for (let i = 0; i < 6 * 24 * 12 && !diag; i++) { passoMundo(W, S, cfg, 5); diag = alvo.cond.has.diag; }
  assert.ok(alvo.conhecido.medidasTurno !== null, 'triagem não aconteceu');
  assert.ok(diag, 'a consulta não diagnosticou (ou o fluxo triagem→consulta falhou)');
  assert.ok(alvo.cond.has.trat, 'o médico autônomo deve iniciar o tratamento');
});

test('o agente comunitário autônomo visita as famílias sozinho', () => {
  const { cfg, S, W } = novo('interior', 5);
  for (let i = 0; i < 10 * 24 * 12; i++) passoMundo(W, S, cfg, 5);
  assert.ok(S.familias.some((f) => f.visTurno >= 0), 'nenhuma visita aconteceu em 10 dias');
  assert.ok(S.metricas.visitas > 0);
});

test('zona rural: médico só nos dias configurados', () => {
  const { cfg, S, W } = novo('rural', 13);
  const alvo = todasPessoas(S).find((p) => p.idade >= 18);
  S.familias.forEach((f) => (f.vinculo = 100));
  ordenarUnidade(W, S, cfg, alvo.id, 'consulta', { espontaneo: true });
  const dias = new Set();
  for (let i = 0; i < 9 * 24 * 12; i++) {
    passoMundo(W, S, cfg, 5);
    if (W.agentes.some((a) => a.pid === alvo.id && a.atend && a.atend.pronto && a.atend.tipo === 'consulta')) dias.add(diaSemana(S));
  }
  for (const d of dias) assert.ok(cfg.cenario.mundo.medicoDias.includes(d), `atendido num dia sem médico: ${d}`);
  assert.ok(dias.size > 0, 'a consulta deveria ter ocorrido em 9 dias');
});

test('PACIENTE: o jogador comanda; assistir TV senta no sofá e a necessidade muda', () => {
  const { cfg, S, W } = novo('interior', 21);
  const p = todasPessoas(S).find((x) => x.idade >= 18);
  escolherPersonagem(S, { modo: 'paciente', pid: p.id });
  const W2 = criarMundo(S, cfg);
  const a = agenteJogador(W2);
  assert.equal(a.pid, p.id);
  assert.equal(W2.agentes.filter((x) => x.jogador).length, 1);
  S.mundo.min = 11 * 60; // sábado? segue o dia; o ponto é a ordem do jogador
  S.jogador.vontade = false;
  const sofa = W2.objs.find((o) => o.t === 'S' && o.casa === p.familiaId);
  const ops = opcoesPara(W2, S, cfg, { tipo: 'obj', obj: sofa });
  assert.ok(ops.some((o) => o.id === 'tv'));
  assert.ok(comandar(W2, S, cfg, 'tv', { tipo: 'obj', obj: sofa }).ok);
  const humor0 = S.mundo.needs[p.id].humor;
  let viu = false;
  for (let i = 0; i < 60 && !viu; i++) { passoMundo(W2, S, cfg, 2); viu = !!(a.acao && a.acao.k === 'tv' && a.acao.obj === sofa); }
  assert.ok(viu, 'o personagem não foi ao sofá assistir TV');
  ministros(W2, S, cfg, 30);
  assert.ok(S.mundo.needs[p.id].humor >= humor0 - 5);
  // outra casa não é utilizável
  const outraCama = W2.objs.find((o) => o.t === 'B' && o.casa !== p.familiaId);
  assert.ok(opcoesPara(W2, S, cfg, { tipo: 'obj', obj: outraCama }).every((o) => o.desab));
});

test('PACIENTE: sem vontade própria o personagem fica parado esperando ordens; com vontade, segue a rotina', () => {
  const { cfg, S, W } = novo('interior', 22);
  const p = todasPessoas(S).find((x) => x.idade >= 18);
  escolherPersonagem(S, { modo: 'paciente', pid: p.id });
  const W2 = criarMundo(S, cfg);
  const a = agenteJogador(W2);
  S.jogador.vontade = false;
  ministros(W2, S, cfg, 180);
  assert.ok(!a.acao || a.acao.k === 'dormir', 'não deveria agir sozinho');
  S.jogador.vontade = true;
  ministros(W2, S, cfg, 600);
  assert.ok(S.mundo.needs[p.id].fome > 5);
});

test('PACIENTE: pedir consulta leva o personagem à unidade (triagem → consulta) e o tratamento depende de tomar o remédio', () => {
  const { cfg, S, W } = novo('interior', 11);
  const p = todasPessoas(S).find((x) => x.idade >= 18 && x.cond.has.estagio >= 2);
  escolherPersonagem(S, { modo: 'paciente', pid: p.id });
  const W2 = criarMundo(S, cfg);
  S.jogador.vontade = false;
  S.familias.forEach((f) => (f.vinculo = 100));
  // vai até a quarta-feira, 8h30 (dia útil com médico)
  while (diaSemana(S) !== 2 || minutoDoDia(S) < 8 * 60) passoMundo(W2, S, cfg, 30);
  assert.ok(comandar(W2, S, cfg, 'ubs_consulta', { tipo: 'obj', obj: W2.objs.find((o) => o.t === 'U') }).ok);
  let diag = false;
  for (let i = 0; i < 400 && !diag; i++) { passoMundo(W2, S, cfg, 2); diag = p.cond.has.diag; }
  assert.ok(diag, 'não foi diagnosticado após pedir consulta');
  assert.ok(p.cond.has.trat);
  const ops = opcoesPara(W2, S, cfg, { tipo: 'obj', obj: W2.objs.find((o) => o.t === 'G' && o.casa === p.familiaId) });
  assert.ok(ops.some((o) => o.id === 'remedio'), 'deve poder tomar o remédio em casa');
});

test('PACIENTE: sintomas aparecem para doenças que dão sintomas, não para hipertensão silenciosa', () => {
  const { cfg, S } = novo('interior', 8);
  const p = todasPessoas(S).find((x) => x.idade >= 18);
  p.cond.has.estagio = 2; p.cond.dm.estagio = 0; p.cond.dep.estagio = 0;
  assert.ok(!sintomasDe(S, cfg, p.id).some((s) => /cabe/i.test(s)), 'hipertensão não deve dar sintoma');
  p.cond.dm.estagio = 2;
  assert.ok(sintomasDe(S, cfg, p.id).length >= 1);
});

test('MÉDICO: o jogador chama o paciente, atende, decide o tratamento e conclui', () => {
  const { cfg, S, W } = novo('interior', 11);
  escolherPersonagem(S, { modo: 'profissional', papel: 'medico' });
  const W2 = criarMundo(S, cfg);
  const doente = todasPessoas(S).find((p) => p.idade >= 18 && p.cond.has.estagio >= 2);
  S.familias.forEach((f) => (f.vinculo = 100));
  while (diaSemana(S) !== 2 || minutoDoDia(S) < 8 * 60) passoMundo(W2, S, cfg, 30);
  ordenarUnidade(W2, S, cfg, doente.id, 'consulta', { espontaneo: true, permiteCrianca: true });
  let espera = false;
  for (let i = 0; i < 400 && !espera; i++) { passoMundo(W2, S, cfg, 2); espera = W2.ordens.some((o) => o.pid === doente.id && o.estado === 'espera' && o.tipo === 'consulta'); }
  assert.ok(espera, 'o paciente deveria estar esperando na fila do médico');
  const med = agenteJogador(W2);
  assert.equal(med.papel, 'medico');
  const alvo = { tipo: 'agente', id: W2.agentes.find((a) => a.pid === doente.id).id };
  assert.ok(opcoesPara(W2, S, cfg, alvo).some((o) => o.id === 'chamar' && !o.desab));
  assert.ok(comandar(W2, S, cfg, 'chamar', alvo).ok);
  let pronto = false;
  for (let i = 0; i < 200 && !pronto; i++) { passoMundo(W2, S, cfg, 1); pronto = atendimentoAtual(W2, S) && atendimentoAtual(W2, S).fase === 'pronto'; }
  assert.ok(pronto, 'o paciente não chegou ao consultório');
  assert.ok(iniciarAtendimento(W2, S, cfg, {}).ok);
  let fim = false;
  for (let i = 0; i < 200 && !fim; i++) { passoMundo(W2, S, cfg, 1); fim = atendimentoAtual(W2, S) && atendimentoAtual(W2, S).fase === 'resultado'; }
  assert.ok(fim, 'o atendimento não terminou');
  assert.ok(finalizarAtendimento(W2, S, cfg, 'liberar').ok);
  assert.equal(atendimentoAtual(W2, S), null);
  assert.ok(S.metricas.atendidos >= 1);
});

test('AGENTE COMUNITÁRIO: o jogador vai até um morador e afere a pressão', () => {
  const { cfg, S, W } = novo('interior', 5);
  escolherPersonagem(S, { modo: 'profissional', papel: 'acs' });
  const W2 = criarMundo(S, cfg);
  const alvo = todasPessoas(S).find((p) => p.idade >= 18);
  // dia útil de manhã
  while (diaSemana(S) > 4 || minutoDoDia(S) < 8 * 60 + 5) passoMundo(W2, S, cfg, 30);
  const ag = W2.agentes.find((a) => a.pid === alvo.id);
  assert.ok(ag.vis);
  const ops = opcoesPara(W2, S, cfg, { tipo: 'agente', id: ag.id });
  assert.ok(ops.some((o) => o.id === 'acs_medir'));
  assert.ok(comandar(W2, S, cfg, 'acs_medir', { tipo: 'agente', id: ag.id }).ok);
  let ok = false;
  for (let i = 0; i < 300 && !ok; i++) { passoMundo(W2, S, cfg, 2); ok = alvo.conhecido.medidasTurno !== null; }
  assert.ok(ok, 'a aferição não aconteceu');
});

test('o jogador não controla os outros: só um personagem é controlável', () => {
  for (const jog of [{ modo: 'paciente', pid: 'silva-0' }, { modo: 'profissional', papel: 'tecnico' }, { modo: 'profissional', papel: 'enfermeiro' }]) {
    const { cfg, S } = novo('interior', 4);
    escolherPersonagem(S, jog);
    const W = criarMundo(S, cfg);
    assert.equal(W.agentes.filter((a) => a.jogador).length, 1);
  }
});

test('pularMes termina o mês e é determinístico', () => {
  const a = novo('metropole', 21), b = novo('metropole', 21);
  pularMes(a.W, a.S, a.cfg); pularMes(b.W, b.S, b.cfg);
  assert.equal(a.S.turno, 1);
  assert.deepEqual(a.S.mundo, b.S.mundo);
  assert.deepEqual(a.S.familias, b.S.familias);
});

test('o estado salvo (S) pode ser recarregado e o mundo reconstruído, mantendo o personagem', () => {
  const { cfg, S } = novo('interior', 17, { modo: 'paciente', pid: 'silva-0' });
  const W = criarMundo(S, cfg);
  ministros(W, S, cfg, 5 * 24 * 60);
  const S2 = JSON.parse(JSON.stringify(S));
  const W2 = criarMundo(S2, cfg);
  assert.equal(agenteJogador(W2).pid, 'silva-0');
  ministros(W2, S2, cfg, 24 * 60);
  assert.ok(S2.mundo.min > S.mundo.min);
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

test('ritmo do tempo: devagar no expediente, mais rápido à noite; pularDia vai até as 7h', () => {
  const { cfg, S, W } = novo('interior', 31);
  S.mundo.min = 10 * 60; const dia = minutosPorSegundo(S);
  S.mundo.min = 23 * 60; const noite = minutosPorSegundo(S);
  assert.ok(dia < noite);
  S.mundo.min = 14 * 60;
  pularDia(W, S, cfg);
  assert.equal(Math.floor(minutoDoDia(S)), 7 * 60);
});

test('a página única (build) compila sem nomes duplicados', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const saida = join(mkdtempSync(join(tmpdir(), 'ss-')), 'saida.html');
  execFileSync('node', ['scripts/build-single.mjs', saida], { cwd: new URL('..', import.meta.url).pathname });
  assert.ok(readFileSync(saida, 'utf8').includes('BASE_INLINE'));
});

test('móveis têm ocupação: ninguém senta no colo de ninguém (sofá, mesa, cadeira, chuveiro)', () => {
  for (const id of CENARIOS) {
    const { cfg, S, W } = novo(id, 31);
    for (let i = 0; i < 4 * 24 * 12; i++) {
      passoMundo(W, S, cfg, 5);
      const uso = new Map();
      for (const a of W.agentes) {
        if (a.k !== 'res' || !a.vis) continue;
        if (a.acao && a.acao.obj) uso.set(a.acao.obj, (uso.get(a.acao.obj) || 0) + 1);
        if (a.cadeira) uso.set(a.cadeira, (uso.get(a.cadeira) || 0) + 1);
      }
      for (const [o, n] of uso) assert.ok(n <= (o.t === 'B' ? 2 : 1), `${id}: ${n} pessoas no móvel ${o.t} (${o.x},${o.y})`);
    }
  }
});

test('PACIENTE: menu por ações — cada ação possível funciona sem tocar em nada (ler, caminhar, dormir, banho…)', () => {
  const { cfg, S, W } = novo('interior', 12);
  const p = todasPessoas(S).find((x) => x.idade >= 18 && x.ocupacao === 'trabalho');
  escolherPersonagem(S, { modo: 'paciente', pid: p.id });
  const W2 = criarMundo(S, cfg);
  S.jogador.vontade = false;
  const a = agenteJogador(W2);
  const grupos = acoesPaciente(W2, S, cfg);
  const ids = grupos.flatMap((g) => g.itens.filter((i) => !i.desab).map((i) => i.id));
  for (const esperado of ['dormir', 'banho', 'cozinhar_saudavel', 'tv', 'ler', 'caminhar', 'ir_casa']) assert.ok(ids.includes(esperado), `faltou a ação ${esperado}`);
  // ler: senta na poltrona da própria casa
  S.mundo.min = 20 * 60;
  assert.ok(comandar(W2, S, cfg, 'ler', { tipo: 'auto' }).ok);
  let leu = false;
  for (let i = 0; i < 200 && !leu; i++) { passoMundo(W2, S, cfg, 1); leu = !!(a.acao && a.acao.k === 'ler' && a.acao.obj && a.acao.obj.t === 'N' && a.acao.obj.casa === p.familiaId); }
  assert.ok(leu, 'o personagem não foi ler na poltrona');
  // caminhada de verdade: percorre vários pontos diferentes
  a.fila = []; a.acao = null; a.proximos = []; a.path = [];
  assert.ok(comandar(W2, S, cfg, 'caminhar', { tipo: 'auto' }).ok);
  const visitados = new Set();
  let andou = 0;
  for (let i = 0; i < 400; i++) { const x0 = a.x, y0 = a.y; passoMundo(W2, S, cfg, 1); andou += Math.hypot(a.x - x0, a.y - y0); visitados.add(`${Math.round(a.x / 4)},${Math.round(a.y / 4)}`); if (!a.acao && !a.path.length && !a.proximos.length && i > 20) break; }
  assert.ok(andou > 20, `a caminhada deveria percorrer um trecho longo (andou ${andou.toFixed(1)} tiles)`);
  assert.ok(visitados.size >= 4, 'a caminhada deveria passar por várias regiões');
});

test('a decoração de fundo não bloqueia nada importante e fica em terreno livre', () => {
  for (const id of CENARIOS) {
    const { cfg, W } = novo(id);
    assert.ok((W.decoracao || []).length > 0, `${id}: sem decoração`);
    for (const d of W.decoracao) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) {
      assert.ok(W.terr[y * W.w + x] === ',' || W.terr[y * W.w + x] === 'c', `${id}: decoração ${d.t} sobre terreno ${W.terr[y * W.w + x]}`);
      assert.ok(!W.objs.some((o) => !o.decor && o.x === x && o.y === y), `${id}: decoração ${d.t} sobre móvel`);
    }
  }
});
