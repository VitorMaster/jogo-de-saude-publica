import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cfg } from './helpers.mjs';
import {
  newGame, avancarMes, todasPessoas, acaoVisita, acaoMedir, acaoConsulta, acaoTratamento,
  acaoOrientar, acaoMutirao, acaoObra, indicadores, CONDS,
} from '../src/engine.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

test('mesma semente gera o mesmo território e a mesma evolução (determinismo)', () => {
  const a = newGame(cfg, 123), b = newGame(cfg, 123);
  assert.deepEqual(a, b);
  for (let i = 0; i < 24; i++) { avancarMes(a, cfg); avancarMes(b, cfg); }
  assert.deepEqual(a, b);
});

test('jogo é serializável em JSON e continua igual após recarregar', () => {
  const a = newGame(cfg, 5);
  for (let i = 0; i < 6; i++) avancarMes(a, cfg);
  const b = clone(a);
  avancarMes(a, cfg); avancarMes(b, cfg);
  assert.deepEqual(a, b);
});

test('território tem todas as idades e começa com doenças ocultas, incluindo hipertensão', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = newGame(cfg, seed);
    const pess = todasPessoas(s);
    assert.ok(pess.some((p) => p.idade < 5) && pess.some((p) => p.idade >= 65));
    const ocultas = pess.flatMap((p) => CONDS.filter((id) => p.cond[id].estagio >= 2));
    assert.ok(ocultas.length >= 3 && ocultas.includes('has'), `semente ${seed}`);
    assert.ok(pess.every((p) => CONDS.every((id) => !p.cond[id].diag)), 'nada começa diagnosticado');
  }
});

test('crianças não desenvolvem hipertensão/diabetes', () => {
  const s = newGame(cfg, 9);
  for (let i = 0; i < 24; i++) avancarMes(s, cfg);
  for (const p of todasPessoas(s).filter((x) => x.idade < 12)) {
    assert.equal(p.cond.has.estagio, 0);
    assert.equal(p.cond.dm.estagio, 0);
  }
});

test('ações consomem tempo e falham sem tempo', () => {
  const s = newGame(cfg, 11);
  const f = s.familias[0];
  const t0 = s.tempo;
  assert.ok(acaoVisita(s, cfg, f.id).ok);
  assert.equal(s.tempo, t0 - cfg.game.custos.visita);
  assert.equal(acaoVisita(s, cfg, f.id).ok, false, 'não visita duas vezes no mês');
  s.tempo = 0;
  assert.equal(acaoMedir(s, cfg, todasPessoas(s).find((p) => p.idade >= 18).id).ok, false);
  assert.equal(acaoConsulta(s, cfg, todasPessoas(s)[0].id).ok, false);
});

test('consulta diagnostica hipertensão; tratar exige diagnóstico', () => {
  const s = newGame(cfg, 21);
  const p = todasPessoas(s).find((x) => x.cond.has.estagio >= 2);
  assert.equal(acaoTratamento(s, cfg, p.id, 'has', true).ok, false);
  let diag = false;
  for (let i = 0; i < 10 && !diag; i++) { s.tempo = 8; acaoConsulta(s, cfg, p.id); diag = p.cond.has.diag; }
  assert.ok(diag);
  assert.ok(acaoTratamento(s, cfg, p.id, 'has', true).ok);
});

test('tratamento consome insumo e a falta de insumo derruba o controle', () => {
  const s = newGame(cfg, 33);
  const p = todasPessoas(s).find((x) => x.cond.has.estagio >= 2);
  p.cond.has.diag = true; p.cond.has.trat = true;
  s.familias.forEach((f) => (f.vinculo = 100));
  s.insumos = 0;
  avancarMes(s, cfg);
  assert.equal(p.cond.has.ctrl, false);
  s.insumos = 30;
  let ctrl = false;
  for (let i = 0; i < 8 && !ctrl; i++) { avancarMes(s, cfg); ctrl = p.cond.has.ctrl; }
  assert.ok(ctrl);
});

test('tratamento reduz complicações em comparação com nenhum cuidado (estatístico)', () => {
  let semCuidado = 0, comCuidado = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const a = newGame(cfg, seed * 31), b = newGame(cfg, seed * 31);
    for (const p of todasPessoas(b)) for (const id of CONDS) if (p.cond[id].estagio >= 2) { p.cond[id].diag = true; p.cond[id].trat = true; }
    b.familias.forEach((f) => (f.vinculo = 90));
    b.insumos = 60;
    for (let m = 0; m < 36; m++) {
      b.familias.forEach((f) => (f.vinculo = 90));
      avancarMes(a, cfg); avancarMes(b, cfg);
    }
    const conta = (s) => todasPessoas(s).reduce((n, p) => n + CONDS.filter((id) => p.cond[id].estagio === 3).length, 0);
    semCuidado += conta(a); comCuidado += conta(b);
  }
  assert.ok(comCuidado < semCuidado * 0.7, `com=${comCuidado} sem=${semCuidado}`);
});

test('hábitos ruins aumentam o risco de hipertensão (estatístico)', () => {
  const run = (hab) => {
    let n = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const s = newGame(cfg, seed * 17);
      for (const p of todasPessoas(s)) { p.habitos.atividade = hab; p.habitos.alimentacao = hab; p.tabagismo = hab < 50; p.cond.has.estagio = 0; }
      for (let m = 0; m < 60; m++) {
        for (const p of todasPessoas(s)) { p.habitos.atividade = hab; p.habitos.alimentacao = hab; }
        avancarMes(s, cfg);
      }
      n += todasPessoas(s).filter((p) => p.cond.has.estagio >= 1).length;
    }
    return n;
  };
  assert.ok(run(15) > run(90) * 1.5);
});

test('dengue: infestação alta gera casos; mutirão reduz a infestação', () => {
  const s = newGame(cfg, 77);
  s.infestacao = 90;
  const antes = s.infestacao;
  assert.ok(acaoMutirao(s, cfg).ok);
  assert.ok(s.infestacao < antes);
  assert.equal(acaoMutirao(s, cfg).ok, false);
  let casos = 0;
  for (let i = 0; i < 12; i++) {
    s.infestacao = 90; s.imune = 0;
    todasPessoas(s).forEach((p) => (p.imune = 0));
    avancarMes(s, cfg);
    casos += todasPessoas(s).filter((p) => p.dengue.ativa).length;
  }
  assert.ok(casos > 5);
});

test('dengue atendida evolui melhor que dengue sem atendimento (estatístico)', () => {
  const run = (atende) => {
    let graves = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = newGame(cfg, seed * 13);
      const p = todasPessoas(s)[0];
      p.dengue = { ativa: true, atendido: atende };
      avancarMes(s, cfg);
      if (s.internacoes.length > 0 && s.diario.some((e) => e.texto.includes('dengue grave'))) graves++;
    }
    return graves;
  };
  assert.ok(run(false) > run(true));
});

test('obra: custa verba, leva meses, só uma por vez, e aumenta o tempo da equipe', () => {
  const s = newGame(cfg, 3);
  s.verba = 200;
  assert.ok(acaoObra(s, cfg, 'consultorio').ok);
  assert.equal(acaoObra(s, cfg, 'farmacia').ok, false);
  const t = s.tempoMax;
  avancarMes(s, cfg);
  assert.equal(s.predios.consultorio, 1);
  assert.equal(s.obra, null);
  assert.equal(s.tempoMax, t + cfg.game.tempoPorNivel);
  s.verba = 0;
  assert.equal(acaoObra(s, cfg, 'farmacia').ok, false, 'sem verba');
});

test('orientar melhora o hábito escolhido e o vínculo', () => {
  const s = newGame(cfg, 4);
  const p = todasPessoas(s).find((x) => x.idade >= 18);
  p.habitos.atividade = 30;
  const v = s.familias.find((f) => f.id === p.familiaId).vinculo;
  assert.ok(acaoOrientar(s, cfg, p.id, 'atividade').ok);
  assert.equal(p.habitos.atividade, 42);
  assert.ok(s.familias.find((f) => f.id === p.familiaId).vinculo > v);
});

test('indicadores: rastreamento sobe ao medir adultos; liga é definida', () => {
  const s = newGame(cfg, 8);
  const i0 = indicadores(s, cfg);
  assert.equal(i0.rastreamento, 0);
  for (const p of todasPessoas(s).filter((x) => x.idade >= 18)) { s.tempo = 8; acaoMedir(s, cfg, p.id); }
  assert.equal(indicadores(s, cfg).rastreamento, 1);
  assert.ok(['Bronze', 'Prata', 'Ouro', 'Cristal'].includes(i0.liga));
});

test('uma partida longa não gera valores inválidos', () => {
  const s = newGame(cfg, 99);
  for (let i = 0; i < 120; i++) avancarMes(s, cfg);
  assert.ok(s.insumos >= 0 && s.verba >= 0 && s.infestacao >= 0 && s.infestacao <= 100);
  for (const f of s.familias) assert.ok(f.vinculo >= 0 && f.vinculo <= 100);
  for (const p of todasPessoas(s)) {
    assert.ok(Object.values(p.habitos).every((v) => v >= 0 && v <= 100));
    assert.ok(p.imc >= 17 && p.imc <= 45);
  }
});
