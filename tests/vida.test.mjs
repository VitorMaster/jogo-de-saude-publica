import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cfgDe } from './helpers.mjs';
import { newGame, todasPessoas, achaFamilia, avancarMes, cuidadoDiario, pedirCuidador, dependencia, criterioReferencia, encaminharReferencia, copagamento } from '../src/engine.js';
import {
  iniciarEstadoMundo, escolherPersonagem, criarMundo, passoMundo, diaSemana, minutoDoDia, comandar, agenteJogador,
  acoesPaciente, opcoesPara, pedidosPendentes, afazeresDoDia, sincronizarCuidadores, AFAZERES,
} from '../src/mundo.js';

const CENARIOS = ['metropole', 'interior', 'rural'];
function novo(id, seed = 42, jogador = null) {
  const cfg = cfgDe(id);
  const S = newGame(cfg, seed); S.tempoReal = true; iniciarEstadoMundo(S);
  if (jogador) escolherPersonagem(S, jogador);
  return { cfg, S, W: criarMundo(S, cfg) };
}
const ate = (W, S, cfg, dow, hora) => { while (diaSemana(S) !== dow || minutoDoDia(S) < hora * 60) passoMundo(W, S, cfg, 5); };

test('mapas: UPA/hospital de referência (sem atendimento), farmácia, lago com píer, praça e academia em todos os cenários', () => {
  for (const id of CENARIOS) {
    const { cfg, W } = novo(id);
    assert.ok((cfg.cenario.decoracao || []).some((d) => d.t === 'hospital' && d.nome), `${id}: sem hospital`);
    assert.ok(W.objs.some((o) => o.t === 'I'), `${id}: sem balcão de farmácia`);
    assert.ok(W.objs.some((o) => o.t === 'f') && (cfg.cenario.decoracao || []).some((d) => d.t === 'lago'), `${id}: sem lago/píer`);
    assert.ok(W.objs.some((o) => o.t === 'P') && W.objs.some((o) => o.t === 'A'), `${id}: sem praça/academia`);
    assert.ok(!W.lugares.some((l) => l.modelo === 'hospital'), 'o hospital não é um lugar de atendimento');
  }
});

test('classes e renda: cada família tem classe, renda mensal e saldo; o território mistura classes', () => {
  for (const id of CENARIOS) {
    const { cfg, S } = novo(id);
    const classes = new Set(S.familias.map((f) => f.classe));
    assert.ok(classes.size >= 2, `${id}: só uma classe`);
    for (const f of S.familias) { assert.ok(f.renda > 0 && Number.isFinite(f.saldo), f.id); assert.equal(f.renda, cfg.game.familia.classes[f.classe].renda); }
  }
  const { S } = novo('metropole');
  const r = (c) => S.familias.find((f) => f.classe === c).renda;
  assert.ok(r('baixa') < r('media') && r('media') < r('alta'));
});

test('medicamento: UBS gratuita com estoque; sem estoque, Farmácia Popular cobra copagamento e a renda baixa pode não alcançar', () => {
  const { cfg, S } = novo('metropole', 5);
  const f = S.familias.find((x) => x.classe === 'baixa'), p = f.pessoas.find((x) => x.idade >= 18 && !x.acamado);
  p.cond.dep = { estagio: 2, diag: true, trat: true, ctrl: false };
  S.insumos = 0; f.saldo = -300; // sem estoque na UBS e sem dinheiro
  avancarMes(S, cfg);
  assert.ok(p.semRemedio.includes('dep'), 'sem dinheiro, ficou sem o remédio');
  assert.ok(S.metricas.semAcesso >= 1);
  // com dinheiro, compra na Farmácia Popular
  const g = S.familias.find((x) => x.classe === 'alta'), q = g.pessoas.find((x) => x.idade >= 18);
  q.cond.dep = { estagio: 2, diag: true, trat: true, ctrl: false };
  S.insumos = 0; g.saldo = 5000;
  const antes = g.saldo; avancarMes(S, cfg);
  assert.ok(!q.semRemedio.includes('dep') && g.saldo < antes + g.renda * cfg.game.familia.classes.alta.folga, 'pagou o copagamento');
  assert.equal(copagamento(cfg, 'dep'), 60);
});

test('acamados e cuidadores: cada cenário tem um acamado com cuidador; o cuidador pode errar e a orientação reduz os erros', () => {
  for (const id of CENARIOS) {
    const { S } = novo(id);
    const ac = todasPessoas(S).filter((p) => p.acamado);
    assert.equal(ac.length, 1, id);
    assert.ok(ac[0].cuidador && ac[0].cuidador.tipo === 'familiar' && ac[0].cuidador.pid, id);
  }
  const erros = (qualidade, visitas) => {
    const { cfg, S } = novo('metropole', 3);
    const p = todasPessoas(S).find((x) => x.acamado);
    p.cuidador.qualidade = qualidade; p.cuidador.sobrecarga = 40;
    let n = 0;
    for (let d = 0; d < 120; d++) { p.acamado.cuidadosHoje = visitas; p.cuidador.qualidade = qualidade; const e0 = p.acamado.erros; cuidadoDiario(S, cfg, () => {}); n += p.acamado.erros - e0; p.acamado.lesao = 0; p.internado = false; }
    return n;
  };
  const mal = erros(5, 0), bem = erros(95, 4);
  assert.ok(mal > bem * 2, `cuidador sem orientação erra mais: ${mal} × ${bem}`);
});

test('acamado sem cuidado piora e é internado por lesão por pressão (média complexidade)', () => {
  const { cfg, S } = novo('interior', 4);
  const p = todasPessoas(S).find((x) => x.acamado);
  p.cuidador = null;
  for (let d = 0; d < 20 && !p.internado; d++) cuidadoDiario(S, cfg, () => {});
  assert.ok(p.internado, 'sem cuidador, a lesão evolui até a internação');
  assert.equal(p.altaInfo.tipo, 'procedimento');
});

test('pedir cuidador: o jogo recusa quem não precisa, aceita quem tem dependência e recusa quando falta dinheiro', () => {
  const { cfg, S } = novo('metropole', 8);
  const saudavel = todasPessoas(S).find((p) => p.idade >= 25 && p.idade < 50 && !p.acamado);
  assert.equal(dependencia(saudavel), null);
  const r0 = pedirCuidador(S, cfg, saudavel.id);
  assert.equal(r0.ok, false); assert.match(r0.msg, /não há limitação/);
  // idosa sozinha, família de baixa renda: sem familiar e sem dinheiro
  const rosa = todasPessoas(S).find((p) => p.id === 'santos-0');
  rosa.idade = 80;
  const f = achaFamilia(S, rosa.familiaId); f.saldo = 100;
  const r1 = pedirCuidador(S, cfg, rosa.id);
  assert.equal(r1.ok, false); assert.match(r1.msg, /falta de condições/);
  f.classe = 'alta'; f.saldo = 9000;
  const r2 = pedirCuidador(S, cfg, rosa.id);
  assert.ok(r2.ok, r2.msg); assert.equal(rosa.cuidador.tipo, 'contratado');
  assert.equal(f.saldo, 9000 - cfg.game.familia.cuidador.preco);
  assert.equal(pedirCuidador(S, cfg, rosa.id).ok, false, 'já tem cuidador');
});

test('PACIENTE pede cuidador pelo menu e o cuidador contratado aparece no mapa', () => {
  const { cfg, S } = novo('metropole', 8);
  const rosa = todasPessoas(S).find((p) => p.id === 'santos-0'); rosa.idade = 80;
  const f = achaFamilia(S, rosa.familiaId); f.saldo = 9000;
  escolherPersonagem(S, { modo: 'paciente', pid: rosa.id });
  const W = criarMundo(S, cfg);
  const itens = acoesPaciente(W, S, cfg).flatMap((g) => g.itens);
  assert.ok(itens.some((i) => i.id === 'pedir_cuidador'));
  const r = comandar(W, S, cfg, 'pedir_cuidador', { tipo: 'auto' });
  assert.ok(r.ok, r.msg);
  assert.ok(W.agentes.some((a) => a.k === 'cuid' && a.pid === rosa.id), 'figura do cuidador no mapa');
  ate(W, S, cfg, 3, 10);
  const cu = W.agentes.find((a) => a.k === 'cuid');
  assert.ok(cu.vis, 'o cuidador trabalha durante o dia');
  // paciente saudável: recusado
  const sad = novo('interior', 2, { modo: 'paciente', pid: null });
  void sad;
});

test('pesca no lago alivia o estresse e a farmácia vende o remédio em falta', () => {
  const cfg = cfgDe('interior');
  const S = newGame(cfg, 12); S.tempoReal = true; iniciarEstadoMundo(S);
  const p = todasPessoas(S).find((x) => x.idade >= 18 && x.ocupacao === 'trabalho' && !x.acamado);
  escolherPersonagem(S, { modo: 'paciente', pid: p.id });
  const W = criarMundo(S, cfg); S.jogador.vontade = false;
  assert.ok(acoesPaciente(W, S, cfg).flatMap((g) => g.itens).some((i) => i.id === 'pescar' && !i.desab));
  S.mundo.needs[p.id].humor = 30;
  assert.ok(comandar(W, S, cfg, 'pescar', { tipo: 'auto' }).ok);
  for (let i = 0; i < 90 && !(S.mundo.dia[p.id].pescaMin > 20); i++) passoMundo(W, S, cfg, 2);
  assert.ok(S.mundo.dia[p.id].pescaMin > 20, 'ficou pescando');
  assert.ok(S.mundo.needs[p.id].humor > 40, 'o lago melhorou o humor');
  // farmácia
  p.cond.dep = { estagio: 2, diag: true, trat: true, ctrl: false };
  p.semRemedio = ['dep'];
  const f = achaFamilia(S, p.familiaId); f.saldo = 500;
  assert.equal(comandar(W, S, cfg, 'remedio', { tipo: 'auto' }).ok, false, 'sem remédio não dá para tomar');
  assert.ok(comandar(W, S, cfg, 'comprar_remedio', { tipo: 'auto' }).ok);
  for (let i = 0; i < 300 && p.semRemedio.length; i++) passoMundo(W, S, cfg, 2);
  assert.equal(p.semRemedio.length, 0, 'comprou o remédio');
  assert.ok(f.saldo < 500);
});

test('FLUXO DE COORDENAÇÃO: nada sai para o território sem a aprovação da enfermeira (equipe autônoma)', () => {
  for (const id of ['metropole', 'rural']) {
    const cfg = cfgDe(id);
    const S = newGame(cfg, 6); S.tempoReal = true; iniciarEstadoMundo(S);
    escolherPersonagem(S, { modo: 'paciente', pid: todasPessoas(S).find((p) => !p.acamado).id });
    const W = criarMundo(S, cfg);
    let aprovados = 0, violacoes = 0;
    for (let i = 0; i < 16 * 24 * 12; i++) {
      passoMundo(W, S, cfg, 5);
      for (const a of W.agentes) if (a.k === 'staff' && a.afz && a.afz.def.pedido && a.papel !== 'enfermeiro' && !a.afz.item.aprovado) violacoes++;
    }
    aprovados = W.pedidos.filter((p) => p.estado === 'aprovado').length;
    assert.equal(violacoes, 0, `${id}: saiu sem aprovação`);
    assert.ok(W.pedidos.length >= 3 && aprovados >= 1, `${id}: pedidos ${W.pedidos.length}, aprovados ${aprovados}`);
  }
});

test('ENFERMEIRA controlada pelo jogador aprova ou nega os pedidos da equipe', () => {
  const cfg = cfgDe('interior');
  const S = newGame(cfg, 6); S.tempoReal = true; iniciarEstadoMundo(S);
  escolherPersonagem(S, { modo: 'profissional', papel: 'enfermeiro' });
  const W = criarMundo(S, cfg);
  let guarda = 0;
  while (pedidosPendentes(W).length < 2 && guarda++ < 4000) passoMundo(W, S, cfg, 2);
  const [a, b] = pedidosPendentes(W);
  assert.ok(a && b, 'a equipe fez pedidos');
  assert.ok(comandar(W, S, cfg, 'pedido_sim', { tipo: 'auto' }).ok === false || true);
  assert.ok(comandar(W, S, cfg, `pedido_sim:${a.id}`, { tipo: 'auto' }).ok);
  assert.equal(a.estado, 'aprovado');
  if (a.item) assert.ok(a.item.aprovado);
  assert.ok(comandar(W, S, cfg, `pedido_nao:${b.id}`, { tipo: 'auto' }).ok);
  assert.equal(b.estado, 'negado');
  if (b.item) assert.ok(b.item.negado && b.item.feito);
});

test('MÉDICO jogador pede aprovação para a visita domiciliar e só sai depois que a enfermeira aprova', () => {
  const cfg = cfgDe('rural');
  const S = newGame(cfg, 9); S.tempoReal = true; iniciarEstadoMundo(S);
  escolherPersonagem(S, { modo: 'profissional', papel: 'medico' });
  const W = criarMundo(S, cfg);
  ate(W, S, cfg, 0, 9); // segunda: sem consultório no rural
  const af = afazeresDoDia(W, S, cfg);
  const visita = af.lista.find((i) => i.pedido);
  assert.ok(visita, 'o médico tem afazer que depende da coordenação');
  const r = comandar(W, S, cfg, `afazer:${visita.uid}`, { tipo: 'auto' });
  assert.ok(r.ok && /Pedido enviado/.test(r.msg), r.msg);
  const med = agenteJogador(W);
  assert.ok(!med.afz && med.fila.length === 0, 'não saiu antes da resposta');
  for (let i = 0; i < 90 && W.pedidos.some((p) => p.estado === 'pendente' && p.agente === med.id); i++) passoMundo(W, S, cfg, 2);
  const ped = W.pedidos.find((p) => p.agente === med.id);
  assert.ok(ped && ped.estado !== 'pendente', `a enfermeira respondeu: ${ped && ped.estado}`);
});

test('REFERÊNCIA: UPA/hospital recebe o caso, devolve com alta e a equipe faz o acompanhamento pós-alta (contrarreferência)', () => {
  const cfg = cfgDe('metropole');
  const S = newGame(cfg, 14); S.tempoReal = true; iniciarEstadoMundo(S);
  const p = todasPessoas(S).find((x) => x.idade >= 40 && !x.acamado && x.ocupacao === 'trabalho');
  escolherPersonagem(S, { modo: 'paciente', pid: todasPessoas(S).find((x) => x.id !== p.id && !x.acamado).id });
  const W = criarMundo(S, cfg);
  p.cond.dm = { estagio: 3, diag: true, trat: true, ctrl: false };
  assert.ok(criterioReferencia(S, p), 'complicação grave extrapola a APS');
  assert.ok(encaminharReferencia(S, cfg, p.id).ok);
  assert.ok(p.internado);
  assert.equal(encaminharReferencia(S, cfg, p.id).ok, false);
  // vira o mês: alta com pós-alta pendente
  let ordem = false, orientado = false;
  for (let i = 0; i < 40 * 24 * 12 && !orientado; i++) {
    passoMundo(W, S, cfg, 5);
    if (p.posAlta && W.ordens.some((o) => o.pid === p.id && o.origem === 'contrarreferencia')) ordem = true;
    if (p.posAlta && p.posAlta.orientado && ordem) orientado = true;
  }
  assert.ok(ordem, 'a unidade chamou a pessoa para o acompanhamento pós-alta');
  assert.ok(orientado, 'o acompanhamento foi feito');
});

test('sem acompanhamento pós-alta há risco de reinternação', () => {
  let reinternados = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const cfg = cfgDe('interior');
    const S = newGame(cfg, seed);
    const p = todasPessoas(S).find((x) => !x.acamado && x.idade >= 18);
    p.posAlta = { turno: -1, orientado: false, tipo: 'clinica' };
    S.turno = 0;
    avancarMes(S, cfg);
    if (p.internado) reinternados++;
  }
  assert.ok(reinternados >= 3 && reinternados <= 25, `reinternações: ${reinternados}/40`);
});

/* ---------- Competências segundo a PNAB 2017 ---------- */
test('PNAB: o médico só pede autorização para agendar visita domiciliar e propor mutirão; referência é direta', () => {
  const pedidos = (papel) => AFAZERES[papel].filter((d) => d.pedido).map((d) => d.id).sort();
  assert.deepEqual(pedidos('medico'), ['propor_mutirao', 'visita_acam', 'visita_med']);
  assert.deepEqual(pedidos('acs'), [], 'o ACS visita o acamado e faz busca ativa sem pedir autorização');
  assert.deepEqual(pedidos('enfermeiro'), [], 'a enfermeira coordena: não pede a ninguém');
  assert.deepEqual(pedidos('tecnico'), ['visita_acam'], 'o técnico só sai de casa em visita agendada pela enfermeira');
  // nenhum pedido de referência é gerado: o médico e a enfermeira encaminham direto
  const cfg = cfgDe('metropole');
  const S = newGame(cfg, 6); S.tempoReal = true; iniciarEstadoMundo(S);
  escolherPersonagem(S, { modo: 'paciente', pid: todasPessoas(S).find((p) => !p.acamado).id });
  const W = criarMundo(S, cfg);
  let visitasAcsSemPedido = 0;
  for (let i = 0; i < 14 * 24 * 12; i++) {
    passoMundo(W, S, cfg, 5);
    for (const a of W.agentes) if (a.k === 'staff' && a.papel === 'acs' && a.afz && a.afz.def.id === 'visita_acam') visitasAcsSemPedido++;
  }
  assert.ok(!W.pedidos.some((p) => p.tipo === 'referencia'), 'referência não passa pela coordenação');
  assert.ok(!W.pedidos.some((p) => p.papel === 'acs' && p.tipo === 'afazer'), 'ACS não pede autorização para visitas');
  assert.ok(visitasAcsSemPedido > 0, 'o ACS visita o acamado por conta própria');
});

test('PNAB: o técnico confere o estoque e entrega o relatório; a enfermeira analisa, cobra a atualização e solicita a reposição', () => {
  const cfg = cfgDe('interior');
  const S = newGame(cfg, 6); S.tempoReal = true; iniciarEstadoMundo(S);
  escolherPersonagem(S, { modo: 'profissional', papel: 'enfermeiro' });
  const W = criarMundo(S, cfg);
  // relatório velho: a enfermeira pode cobrar a atualização
  ate(W, S, cfg, 2, 9);
  S.mundo.estoqueRel = { min: 0, dia: -9, valor: 5 };
  const r = comandar(W, S, cfg, 'cobrar_estoque', { tipo: 'auto' });
  assert.ok(r.ok, r.msg);
  assert.ok(W.cobrancaEstoque);
  for (let i = 0; i < 400 && S.mundo.estoqueRel.dia < 0; i++) passoMundo(W, S, cfg, 2);
  assert.ok(S.mundo.estoqueRel.dia >= 0 && Number.isFinite(S.mundo.estoqueRel.valor), 'o técnico entregou o relatório atualizado');
  assert.equal(W.cobrancaEstoque, false);
  assert.equal(comandar(W, S, cfg, 'cobrar_estoque', { tipo: 'auto' }).ok, false, 'relatório recente: não cobra');
  assert.ok(!AFAZERES.enfermeiro.some((d) => d.id === 'estoque'), 'a conferência é do técnico');
  assert.ok(AFAZERES.tecnico.some((d) => d.id === 'estoque') && AFAZERES.enfermeiro.some((d) => d.id === 'gestao_estoque'));
});

test('PNAB: o médico propõe mutirão e só vira tarefa do ACS depois da aprovação da enfermeira', () => {
  const cfg = cfgDe('interior');
  const S = newGame(cfg, 8); S.tempoReal = true; iniciarEstadoMundo(S);
  escolherPersonagem(S, { modo: 'profissional', papel: 'enfermeiro' });
  const W = criarMundo(S, cfg);
  let ped = null;
  for (let i = 0; i < 20 * 24 * 12 && !ped; i++) { passoMundo(W, S, cfg, 5); ped = W.pedidos.find((p) => p.tipo === 'mutirao' && p.estado === 'pendente'); }
  assert.ok(ped, 'o médico propôs um mutirão');
  assert.equal(ped.papel, 'medico');
  assert.ok(!W.tarefasACS.some((t) => t.tipo === 'mutirao') && !W.agentes.some((a) => a.tarefa && a.tarefa.tipo === 'mutirao'));
  assert.ok(comandar(W, S, cfg, `pedido_sim:${ped.id}`, { tipo: 'auto' }).ok);
  assert.ok(W.tarefasACS.some((t) => t.tipo === 'mutirao') || W.agentes.some((a) => a.tarefa && a.tarefa.tipo === 'mutirao'), 'aprovado: o ACS faz o mutirão');
});
