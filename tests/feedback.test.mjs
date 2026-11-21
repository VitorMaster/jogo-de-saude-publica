import test from 'node:test';
import assert from 'node:assert/strict';
import { PERGUNTAS, contextoTecnico, textoRelatorio, temResposta, enviarFeedback } from '../src/feedback.js';

const ctx = contextoTecnico({ userAgent: 'iPhone Safari', graficos: '3D', cenario: 'interior', personagem: 'paciente', mesesJogados: 2, instalado: true, tela: '390x780' });

test('relatório inclui só o que foi respondido e o contexto técnico', () => {
  const t = textoRelatorio({ nota: 4, gostou: 'Gráficos', entendeu: undefined }, ctx);
  assert.match(t, /Nota geral do jogo\n {2}4\/5/);
  assert.match(t, /Gráficos/);
  assert.doesNotMatch(t, /Você entendeu/);
  assert.match(t, /Cenário: interior/);
  assert.match(t, /Instalado: sim/);
});

test('temResposta ignora o campo de contato', () => {
  assert.equal(temResposta({}), false);
  assert.equal(temResposta({ contato: 'ana' }), false);
  assert.equal(temResposta({ nota: 5 }), true);
  assert.ok(PERGUNTAS.length >= 10);
});

test('envio via Google Forms usa o mapeamento de campos', async () => {
  let chamada;
  const amb = { fetch: async (url, op) => { chamada = { url, op }; } };
  const r = await enviarFeedback({ nota: 5, gostou: 'ok' }, ctx, { formAction: 'https://forms.example/x', campos: { nota: 'entry.1', gostou: 'entry.2', tecnico: 'entry.9' } }, amb);
  assert.deepEqual(r, { ok: true, via: 'forms' });
  assert.equal(chamada.op.mode, 'no-cors');
  assert.equal(chamada.op.body.get('entry.1'), '5');
  assert.match(chamada.op.body.get('entry.9'), /Gráficos: 3D/);
});

test('sem formulário: compartilha; sem compartilhar: copia; sem nada: falha com texto', async () => {
  let dito;
  assert.equal((await enviarFeedback({ nota: 3 }, ctx, {}, { navigator: { share: async (d) => { dito = d; } } })).via, 'compartilhar');
  assert.match(dito.text, /3\/5/);
  assert.equal((await enviarFeedback({ nota: 3 }, ctx, {}, { navigator: { clipboard: { writeText: async () => {} } } })).via, 'copia');
  const f = await enviarFeedback({ nota: 3 }, ctx, {}, { navigator: {} });
  assert.equal(f.ok, false);
  assert.match(f.texto, /3\/5/);
});

test('rede caindo no Forms recai para copiar', async () => {
  const r = await enviarFeedback({ nota: 2 }, ctx, { formAction: 'https://x', campos: { nota: 'entry.1' } }, { fetch: async () => { throw new Error('offline'); }, navigator: { clipboard: { writeText: async () => {} } } });
  assert.equal(r.via, 'copia');
});
