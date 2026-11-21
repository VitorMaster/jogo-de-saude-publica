import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cfgDe } from './helpers.mjs';
import { climaDoDia, climaAgora, rotuloClima } from '../src/clima.js';
import { newGame, avancarMes } from '../src/engine.js';
import { iniciarEstadoMundo, criarMundo, passoMundo, climaDe } from '../src/mundo.js';
import { criarSom } from '../src/som.js';

test('clima: determinístico, mais chuva no verão do que no inverno e calor maior no verão', () => {
  assert.deepEqual(climaDoDia(0, 5, 'interior'), climaDoDia(0, 5, 'interior'));
  const conta = (mes) => { let n = 0; for (let d = 0; d < 300; d++) if (['chuva', 'tempestade'].includes(climaDoDia(mes, d, 'interior').tipo)) n++; return n; };
  assert.ok(conta(0) > conta(6) * 2, `janeiro ${conta(0)} × julho ${conta(6)}`);
  assert.ok(climaDoDia(1, 3, 'metropole').temp >= climaDoDia(6, 3, 'metropole').temp);
  let tempestades = 0; for (let d = 0; d < 300; d++) if (climaDoDia(0, d, 'rural').tipo === 'tempestade') tempestades++;
  assert.ok(tempestades > 5, 'há tempestades de verão');
});

test('clima: só chove dentro da janela do dia e à noite esfria', () => {
  const c = { tipo: 'chuva', temp: 28, vento: 0.4, ini: 14, fim: 17 };
  assert.equal(climaAgora(c, 8).chovendo, false);
  assert.equal(climaAgora(c, 15).chovendo, true);
  assert.equal(climaAgora(c, 18).chovendo, false);
  assert.ok(climaAgora(c, 3).temp < climaAgora(c, 15).temp);
  assert.match(rotuloClima(climaAgora(c, 15)), /🌧️ \d+°/);
});

test('chuva e dengue: meses com muitos dias de chuva aumentam a infestação do mosquito', () => {
  const resultado = (chuvosos) => {
    const cfg = cfgDe('interior');
    const S = newGame(cfg, 5); S.tempoReal = true; iniciarEstadoMundo(S);
    S.mes = 11; S.infestacao = 40; S.mundo.diasChuva = chuvosos;
    avancarMes(S, cfg);
    return S.infestacao;
  };
  assert.ok(resultado(20) > resultado(0) + 5, `${resultado(20)} × ${resultado(0)}`);
  const cfg = cfgDe('interior'); const S = newGame(cfg, 5); S.tempoReal = true; iniciarEstadoMundo(S);
  S.mundo.diasChuva = 12; avancarMes(S, cfg);
  assert.equal(S.mundo.diasChuva, 0);
  assert.ok(S.licoes['chuva-dengue']);
});

test('o mundo conta os dias de chuva e o clima do jogo está disponível para a interface', () => {
  const cfg = cfgDe('interior');
  const S = newGame(cfg, 5); S.tempoReal = true; iniciarEstadoMundo(S);
  S.mes = 0; // janeiro: chuvoso
  const W = criarMundo(S, cfg);
  for (let i = 0; i < 20 * 24 * 12; i++) passoMundo(W, S, cfg, 5);
  assert.ok(S.mundo.diasChuva >= 3 || S.licoes['chuva-dengue'] || S.mes !== 0, `dias de chuva: ${S.mundo.diasChuva}`);
  assert.ok(['sol', 'nublado', 'chuva', 'tempestade'].includes(climaDe(S, cfg).dia.tipo));
});

test('som: sem navegador ele não quebra (no-op) e respeita o interruptor', () => {
  const som = criarSom();
  som.iniciar(); som.atualiza({ dia: 1, chuva: 0, vento: 0.2 }); som.efeito('sino'); som.vibra(20);
  assert.equal(typeof som.alterna(), 'boolean');
  assert.equal(som.pronto, false);
});
