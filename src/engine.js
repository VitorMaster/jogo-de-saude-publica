// Motor de simulação — puro (sem DOM). Todas as regras numéricas vêm de data/*.json.
// O estado do jogo é um objeto simples (serializável em JSON).
import { clamp, rnd, rint, rfloat, sig } from './rng.js';

export const CONDS = ['has', 'dm', 'dep'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const nomeMes = (m) => MESES[m];
export const rotuloData = (s) => `${MESES[s.mes]} de ${s.ano}`;

/* ---------- Fatores de risco ---------- */

function xs(p) {
  return {
    idade: clamp((p.idade - 18) / 62, 0, 1),
    sedentarismo: 1 - p.habitos.atividade / 100,
    alimentacao: 1 - p.habitos.alimentacao / 100,
    sono: 1 - p.habitos.sono / 100,
    estresse: p.habitos.estresse / 100,
    tabagismo: p.tabagismo ? 1 : 0,
    imc: clamp((p.imc - 18) / 20, 0, 1),
  };
}

/** Escore de risco centrado em 0 (≈ 0 para a pessoa "média"). Positivo = mais risco. */
export function riskZ(p, c, id) {
  const x = xs(p);
  let z = 0;
  for (const [k, w] of Object.entries(c.pesos)) z += w * ((k === 'genetica' ? p.genetica[id] : x[k]) - 0.5);
  return z;
}

/* ---------- Criação do jogo ---------- */

function novaPessoa(s, cfg, tpl, famId, idx) {
  const adulto = tpl.idade >= 18;
  const hb = cfg.game.habitosBase || {};
  const h = (k, lo = 20, hi = 90) => { const [a, b] = hb[k] || [lo, hi]; return Math.round(a + rnd(s) * (b - a)); };
  return {
    id: `${famId}-${idx}`, familiaId: famId, nome: tpl.nome, idade: tpl.idade, sexo: tpl.sexo,
    ocupacao: tpl.ocupacao || 'casa', profissao: tpl.profissao || '',
    habitos: { atividade: h('atividade'), alimentacao: h('alimentacao'), sono: h('sono'), estresse: h('estresse', 15, 85) },
    tabagismo: adulto && rnd(s) < (cfg.game.tabagismo ?? 0.16),
    imc: adulto ? Math.round((20 + rnd(s) * 14) * 10) / 10 : 17,
    genetica: { has: rnd(s), dm: rnd(s), dep: rnd(s) },
    cond: Object.fromEntries(CONDS.map((id) => [id, { estagio: 0, diag: false, trat: false, ctrl: false }])),
    dengue: { ativa: false, atendido: false },
    imune: 0,
    internado: false,
    acamado: tpl.acamado ? { causa: tpl.acamado, lesao: 0, erros: 0 } : null, // pessoa acamada (precisa de cuidador)
    cuidador: null, // { tipo: 'familiar'|'contratado', pid, nome, qualidade, sobrecarga }
    posAlta: null, // { turno, orientado, tipo }: acompanhamento depois de UPA/hospital
    semRemedio: [],
    conhecido: { habitos: null, visTurno: null, medidas: null, medidasTurno: null, suspeitas: [], risco: [] },
  };
}

function estagioInicial(s, cfg, p, id) {
  const c = cfg.cond[id];
  if (p.idade < c.idadeMin) return 0;
  const z = riskZ(p, c, id);
  const p1 = sig(c.init.a1 + c.init.b * z);
  const p2 = sig(c.init.a2 + c.init.b * z);
  const r = rnd(s);
  if (r < p2) return rnd(s) < c.init.pComplicadaInicial ? 3 : 2;
  if (r < p1) return 1;
  return 0;
}

function gerarTerritorio(s, cfg) {
  for (let tent = 0; tent < 40; tent++) {
    const familias = cfg.territorio.familias.map((ft) => {
      const E = cfg.game.familia, cl = E.classes[ft.classe || 'media'];
      const f = {
        id: ft.id, nome: ft.nome,
        vinculo: rint(s, ft.vinculo[0], ft.vinculo[1]),
        visTurno: -99, pessoas: [],
        classe: ft.classe || 'media', renda: cl.renda, saldo: Math.round(cl.renda * cl.folga * 2), aperto: false,
      };
      ft.membros.forEach((m, i) => f.pessoas.push(novaPessoa(s, cfg, m, ft.id, i)));
      if (ft.cuidador !== undefined) { // quem cuida da pessoa acamada neste lar
        const cuid = f.pessoas[ft.cuidador], acam = f.pessoas.find((p) => p.acamado);
        if (cuid && acam) acam.cuidador = { tipo: 'familiar', pid: cuid.id, nome: cuid.nome, qualidade: 35, sobrecarga: 45 };
      }
      return f;
    });
    for (const f of familias) for (const p of f.pessoas) for (const id of CONDS) p.cond[id].estagio = estagioInicial(s, cfg, p, id);
    for (const f of familias) for (const p of f.pessoas) if (p.acamado) { // a causa da dependência já é conhecida e tratada
      const id = p.acamado.causa === 'AVC' || p.acamado.causa === 'fragilidade' ? 'has' : 'dm';
      p.cond[id] = { estagio: p.acamado.causa === 'fragilidade' ? 2 : 3, diag: true, trat: true, ctrl: false };
    }
    // Garante um começo com algo a descobrir: ≥3 doenças ocultas, incluindo hipertensão.
    const ocultas = familias.flatMap((f) => f.pessoas).flatMap((p) => CONDS.filter((id) => p.cond[id].estagio >= 2 && !p.cond[id].diag).map((id) => id));
    if (ocultas.length >= 3 && ocultas.includes('has')) return familias;
    if (tent === 39) return familias;
  }
}

export function newGame(cfg, seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0) {
  const G = cfg.game;
  const s = {
    v: 2, seed, rng: seed >>> 0 || 1, tempoReal: false, cenario: cfg.cenario ? cfg.cenario.id : null, jogador: null, metricas: { atendidos: 0, visitas: 0, esperaTotal: 0, triagens: 0, orientacoes: 0, afazeres: 0, reunioes: 0, falhasComunicacao: 0 },
    mes: G.inicio.mes, ano: G.inicio.ano, turno: 0,
    tempo: 0, tempoMax: 0, insumos: G.inicio.insumos, verba: G.inicio.verba,
    infestacao: G.inicio.infestacao, mutiraoTurno: -99,
    predios: Object.fromEntries(Object.keys(G.predios).map((k) => [k, 0])), obra: null,
    familias: [], diario: [], licoes: {}, internacoes: [], ultimoRelatorio: [],
  };
  s.familias = gerarTerritorio(s, cfg);
  s.tempoMax = tempoMaximo(s, cfg);
  s.tempo = s.tempoMax;
  s.diario.push({ mes: s.mes, ano: s.ano, tipo: 'info', texto: `Você assumiu a ${cfg.territorio.nomeUnidade}. Conheça as famílias do território, identifique riscos e acompanhe cada pessoa ao longo do tempo.` });
  return s;
}

/* ---------- Consultas ao estado ---------- */

export const todasPessoas = (s) => s.familias.flatMap((f) => f.pessoas);
export const achaPessoa = (s, id) => todasPessoas(s).find((p) => p.id === id);
export const achaFamilia = (s, id) => s.familias.find((f) => f.id === id);
export const familiaDe = (s, p) => achaFamilia(s, p.familiaId);

export function tempoMaximo(s, cfg) {
  return cfg.game.inicio.tempoBase + cfg.game.tempoPorNivel * s.predios.consultorio;
}

export function sintomasDengueVisiveis(s, p) {
  if (!p.dengue.ativa) return false;
  const f = familiaDe(s, p);
  return f.vinculo >= 50 || f.visTurno === s.turno;
}

export function adesao(f) {
  return (0.35 + 0.6 * (f.vinculo / 100)) * (f.aperto ? 0.75 : 1); // sem dinheiro sobrando, o tratamento é mais difícil de seguir
}

/** Quanto a família paga por mês na Farmácia Popular (copagamento) por um tratamento. */
export const copagamento = (cfg, id) => { const m = cfg.game.familia.medicamento[id]; return Math.round(m.preco * m.popular); };
export const precoPrivado = (cfg, id) => cfg.game.familia.medicamento[id].preco;
/** Pessoas que dependem de cuidado de outra pessoa (acamadas, muito idosas ou com complicação grave). */
export function dependencia(p) {
  if (p.acamado) return 'acamado(a)';
  if (p.idade >= 75) return 'idade avançada';
  if (p.idade >= 60 && CONDS.some((id) => p.cond[id].estagio >= 3)) return 'sequela de doença crônica';
  if (p.posAlta && !p.posAlta.orientado) return 'recuperação pós-alta';
  return null;
}

/* ---------- Ações do jogador ---------- */

const falha = (msg) => ({ ok: false, msg });
const sucesso = (msg, extra = {}) => ({ ok: true, msg, ...extra });

function gasta(s, custo) {
  if (s.tempoReal) return true; // no mundo em tempo real o custo é o tempo (deslocamento, fila) de quem executa
  if (s.tempo < custo) return false;
  s.tempo -= custo;
  return true;
}

function lembraHabitos(p) {
  p.conhecido.habitos = { ...p.habitos, tabagismo: p.tabagismo, imc: p.imc };
}

export function acaoVisita(s, cfg, famId) {
  const f = achaFamilia(s, famId);
  if (f.visTurno === s.turno) return falha('Esta família já foi visitada neste mês.');
  if (!gasta(s, cfg.game.custos.visita)) return falha('Sem horas de equipe suficientes neste mês.');
  f.visTurno = s.turno;
  f.vinculo = clamp(f.vinculo + 8, 0, 100);
  const achados = [];
  for (const p of f.pessoas) {
    if (p.internado) continue;
    lembraHabitos(p);
    p.conhecido.visTurno = s.turno;
    if (p.posAlta) p.posAlta.orientado = true;
    if (p.dengue.ativa) achados.push(`${p.nome} está com sintomas de dengue`);
    for (const id of ['dm', 'dep']) {
      if (p.cond[id].estagio >= 2 && !p.cond[id].diag && rnd(s) < 0.5) {
        achados.push(`${p.nome} relata ${cfg.cond[id].queixas[rint(s, 0, cfg.cond[id].queixas.length - 1)]}`);
      }
    }
  }
  return sucesso(
    achados.length ? `Visita feita (vínculo +8). Você notou: ${achados.join('; ')}.` : 'Visita feita (vínculo +8). Você conheceu melhor os hábitos da família.',
  );
}

function valoresMedidos(s, p) {
  const h = p.cond.has, d = p.cond.dm;
  const faixa = (est, ctrl, tab, tabCtrl) => (ctrl && est >= 2 ? tabCtrl : tab[est]);
  const pasR = faixa(h.estagio, h.ctrl, [[105, 125], [126, 139], [142, 172], [150, 188]], [118, 136]);
  const glicR = faixa(d.estagio, d.ctrl, [[78, 97], [100, 125], [130, 250], [180, 300]], [95, 124]);
  const pas = rint(s, pasR[0], pasR[1]);
  const pad = Math.round(pas * 0.62 + rfloat(s, -4, 4));
  const glic = rint(s, glicR[0], glicR[1]);
  return { pas, pad, glic };
}

function registraMedidas(s, p) {
  const m = valoresMedidos(s, p);
  p.conhecido.medidas = m;
  p.conhecido.medidasTurno = s.turno;
  const susp = [];
  if (m.pas >= 140 || m.pad >= 90) susp.push('has');
  if (m.glic >= 126) susp.push('dm');
  p.conhecido.suspeitas = susp;
  return m;
}

export function acaoMedir(s, cfg, pid) {
  const p = achaPessoa(s, pid);
  if (p.internado) return falha(`${p.nome} está internado(a).`);
  if (p.idade < 18) return falha('A aferição de rotina de PA e glicemia é indicada para adultos.');
  if (!gasta(s, cfg.game.custos.medir)) return falha('Sem horas de equipe suficientes neste mês.');
  const m = registraMedidas(s, p);
  const susp = p.conhecido.suspeitas;
  let msg = `PA ${m.pas}/${m.pad} mmHg · glicemia ${m.glic} mg/dL.`;
  if (susp.length) msg += ` Valores alterados — agende consulta para confirmar.`;
  else msg += ' Sem alterações importantes.';
  return sucesso(msg);
}

export function acaoConsulta(s, cfg, pid) {
  const p = achaPessoa(s, pid);
  const f = familiaDe(s, p);
  if (p.internado) return falha(`${p.nome} está internado(a).`);
  if (!gasta(s, cfg.game.custos.consulta)) return falha('Sem horas de equipe suficientes neste mês.');
  lembraHabitos(p);
  p.conhecido.visTurno = s.turno;
  if (p.posAlta) p.posAlta.orientado = true; // acompanhamento pós-alta feito
  const achados = [];
  if (p.idade >= 18) registraMedidas(s, p);

  if (p.dengue.ativa) {
    p.dengue.atendido = true;
    achados.push('Quadro compatível com dengue: hidratação, repouso e sinais de alarme orientados');
  }
  for (const id of CONDS) {
    const c = cfg.cond[id], st = p.cond[id];
    if (p.idade < c.idadeMin || st.diag) continue;
    if (st.estagio >= 2) {
      const chance = id === 'dep' ? 0.35 + 0.5 * (f.vinculo / 100) : 0.9;
      if (rnd(s) < chance) {
        st.diag = true;
        achados.push(`Diagnóstico: ${c.nome.toLowerCase()}`);
      } else if (id === 'dep') {
        achados.push('Está reservado(a); a conversa ainda não revelou o que sente (mais vínculo ajuda)');
      }
    } else if (st.estagio === 1 && !p.conhecido.risco.includes(id) && (id !== 'dep' || rnd(s) < 0.5)) {
      p.conhecido.risco.push(id);
      achados.push(`Sinais de risco para ${c.nome.toLowerCase()} — vale orientar hábitos`);
    }
  }
  p.conhecido.suspeitas = p.conhecido.suspeitas.filter((id) => !p.cond[id].diag);
  return sucesso(achados.length ? `Consulta: ${achados.join('. ')}.` : 'Consulta sem achados novos. Hábitos atualizados.');
}

export function acaoTratamento(s, cfg, pid, condId, ligar) {
  const p = achaPessoa(s, pid);
  const st = p.cond[condId];
  if (!st.diag) return falha('É preciso diagnosticar antes de tratar.');
  st.trat = ligar;
  return sucesso(ligar
    ? `Tratamento de ${cfg.cond[condId].nome.toLowerCase()} iniciado. Consome 1 insumo por mês.`
    : `Tratamento de ${cfg.cond[condId].nome.toLowerCase()} suspenso.`);
}

export const FOCOS = {
  atividade: 'Atividade física', alimentacao: 'Alimentação', sono: 'Sono', fumo: 'Parar de fumar', estresse: 'Manejo do estresse',
};

export function acaoOrientar(s, cfg, pid, foco) {
  const p = achaPessoa(s, pid);
  const f = familiaDe(s, p);
  if (p.internado) return falha(`${p.nome} está internado(a).`);
  if (p.posAlta) p.posAlta.orientado = true;
  if (!gasta(s, cfg.game.custos.orientar)) return falha('Sem horas de equipe suficientes neste mês.');
  f.vinculo = clamp(f.vinculo + 3, 0, 100);
  if (foco === 'fumo') {
    if (!p.tabagismo) { s.tempo += cfg.game.custos.orientar; return falha('Esta pessoa não fuma.'); }
    if (rnd(s) < 0.25 + 0.3 * (f.vinculo / 100)) { p.tabagismo = false; lembraHabitos(p); return sucesso(`${p.nome} parou de fumar! (com apoio e vínculo, a chance aumenta)`); }
    return sucesso('Orientação feita. Parar de fumar costuma exigir várias tentativas — continue apoiando.');
  }
  if (foco === 'estresse') p.habitos.estresse = clamp(p.habitos.estresse - 12, 0, 100);
  else p.habitos[foco] = clamp(p.habitos[foco] + 12, 0, 100);
  lembraHabitos(p);
  return sucesso(`Orientação sobre ${FOCOS[foco].toLowerCase()} feita (vínculo +3).`);
}

export function acaoMutirao(s, cfg) {
  if (s.mutiraoTurno === s.turno) return falha('O mutirão já foi realizado neste mês.');
  if (!gasta(s, cfg.game.custos.mutirao)) return falha('Sem horas de equipe suficientes neste mês.');
  s.mutiraoTurno = s.turno;
  const ef = cfg.game.dengue.mutiraoEfeito + 4 * s.predios.vigilancia;
  s.infestacao = clamp(s.infestacao - ef, 0, 100);
  for (const f of s.familias) f.vinculo = clamp(f.vinculo + 2, 0, 100);
  return sucesso(`Mutirão contra focos do mosquito realizado: infestação −${ef} (vínculo +2 em todas as famílias).`);
}

export function acaoObra(s, cfg, id) {
  const b = cfg.game.predios[id];
  const nivel = s.predios[id];
  if (s.obra) return falha('Já existe uma obra em andamento — só uma por vez.');
  if (nivel >= b.custo.length) return falha('Nível máximo.');
  const custo = b.custo[nivel];
  if (s.verba < custo) return falha('Verba insuficiente.');
  s.verba -= custo;
  s.obra = { id, meses: b.meses[nivel] };
  return sucesso(`Obra iniciada: ${b.nome} (nível ${nivel + 1}) — ${b.meses[nivel]} mês(es).`);
}

/* ---------- Indicadores ---------- */

export function indicadores(s, cfg) {
  const pess = todasPessoas(s);
  const adultos = pess.filter((p) => p.idade >= 18);
  const rastreados = adultos.filter((p) => p.conhecido.medidasTurno !== null && s.turno - p.conhecido.medidasTurno < 12);
  const frac = (num, den) => (den === 0 ? null : num / den);
  const ctrlDe = (id) => {
    const d = pess.filter((p) => p.cond[id].diag);
    return { total: d.length, bons: d.filter((p) => p.cond[id].trat && p.cond[id].ctrl).length };
  };
  const has = ctrlDe('has'), dm = ctrlDe('dm'), dep = ctrlDe('dep');
  const interAno = s.internacoes.filter((t) => s.turno - t < 12).length;
  const vinculoMedio = s.familias.reduce((a, f) => a + f.vinculo, 0) / s.familias.length / 100;
  const partes = [
    frac(rastreados.length, adultos.length),
    frac(has.bons, has.total), frac(dm.bons, dm.total), frac(dep.bons, dep.total),
    1 - Math.min(1, interAno / 4), vinculoMedio,
  ].filter((v) => v !== null);
  const score = partes.reduce((a, v) => a + v, 0) / partes.length;
  const liga = score >= 0.85 ? 'Cristal' : score >= 0.65 ? 'Ouro' : score >= 0.4 ? 'Prata' : 'Bronze';
  return {
    rastreamento: frac(rastreados.length, adultos.length),
    has: frac(has.bons, has.total), hasTotal: has.total,
    dm: frac(dm.bons, dm.total), dmTotal: dm.total,
    dep: frac(dep.bons, dep.total), depTotal: dep.total,
    internacoesAno: interAno, vinculoMedio, score, liga,
  };
}

/* ---------- Passagem do mês ---------- */

/** O caso extrapola a atenção primária? Devolve o motivo (ou null). */
export function criterioReferencia(s, p) {
  if (p.internado) return null;
  if (s.turno - (p.refTurno === undefined ? -99 : p.refTurno) < 6) return null;
  if (p.dengue.ativa && !p.dengue.referido && (p.idade >= 65 || p.idade < 5 || p.cond.has.diag || p.cond.dm.diag)) return 'dengue com risco de sinais de alarme (idoso, criança ou com doença crônica)';
  if (p.acamado && p.acamado.lesao >= 2) return 'lesão por pressão avançada: precisa de avaliação e procedimento hospitalar';
  if (p.cond.has.estagio >= 3 || p.cond.dm.estagio >= 3) { if (p.cond.has.diag || p.cond.dm.diag) return 'complicação grave de doença crônica: avaliação especializada'; }
  return null;
}

/** Encaminha para a UPA/hospital de referência (média/alta complexidade). Não há atendimento no jogo: a pessoa fica fora do mapa e volta com alta. */
export function internarPessoa(s, cfg, p, motivo, add, extra = {}) {
  const G = cfg.game;
  p.internado = true;
  p.altaInfo = { tipo: extra.tipo || 'clinica', causa: extra.causa || null };
  const f = familiaDe(s, p);
  f.vinculo = clamp(f.vinculo - 6, 0, 100);
  s.verba = Math.max(0, s.verba - G.economia.custoInternacao);
  s.internacoes.push(s.turno);
  const msg = `🏥 ${p.nome} ${motivo}. (custo de internação: −${G.economia.custoInternacao} de verba)`;
  if (add) add('alerta', msg, { pessoaId: p.id }); else s.diario.push({ mes: s.mes, ano: s.ano, tipo: 'alerta', texto: msg, pessoaId: p.id });
}

/** Referência pedida pela equipe (via regulação da enfermeira): evita o agravamento e prepara o retorno com orientação pós-alta. */
export function encaminharReferencia(s, cfg, pid) {
  const p = achaPessoa(s, pid);
  if (p.internado) return falha(`${p.nome} já está na UPA/hospital.`);
  p.refTurno = s.turno;
  const motivo = p.dengue.ativa ? 'com dengue com sinais de alarme foi encaminhado(a) à UPA' : p.acamado && p.acamado.lesao >= 2 ? 'com lesão por pressão infectada foi encaminhado(a) ao hospital' : 'foi encaminhado(a) à UPA/hospital de referência (fora da competência da atenção primária)';
  if (p.dengue.ativa) p.dengue.referido = true;
  const tipo = !p.dengue.ativa && (CONDS.some((id) => p.cond[id].estagio >= 3) || (p.acamado && p.acamado.lesao >= 2)) ? 'procedimento' : 'clinica';
  if (p.acamado) p.acamado.lesao = Math.max(0, p.acamado.lesao - 1.5);
  internarPessoa(s, cfg, p, motivo, null, { tipo });
  return sucesso(`${p.nome} foi encaminhado(a) à UPA/hospital. Na alta, volta para orientação e acompanhamento na unidade.`);
}

/** Orientação/atendimento domiciliar a uma pessoa acamada e ao seu cuidador (ACS, técnico, enfermeiro ou médico). */
export function acaoCuidador(s, cfg, pid, papel) {
  const p = achaPessoa(s, pid), f = familiaDe(s, p);
  if (p.internado) return falha(`${p.nome} está internado(a).`);
  const ac = p.acamado, cu = p.cuidador, partes = [];
  if (cu) {
    const ganho = { acs: 12, tecnico: 14, enfermeiro: 22, medico: 16 }[papel] || 12;
    cu.qualidade = clamp(cu.qualidade + ganho, 0, 100);
    cu.sobrecarga = clamp(cu.sobrecarga - (papel === 'acs' ? 14 : 8), 0, 100);
    partes.push(`${cu.nome} foi orientado(a) sobre posição no leito, higiene, alimentação e remédios (qualidade do cuidado ${Math.round(cu.qualidade)}%, sobrecarga ${Math.round(cu.sobrecarga)}%)`);
  } else partes.push('Não há cuidador em casa: converse com a família sobre apoio');
  if (ac && (papel === 'enfermeiro' || papel === 'tecnico')) { ac.lesao = clamp(ac.lesao - (papel === 'enfermeiro' ? 1 : 0.7), 0, 5); partes.push('pele avaliada e curativo feito (risco de lesão reduzido)'); }
  if (ac && papel === 'medico') { ac.lesao = clamp(ac.lesao - 0.8, 0, 5); partes.push('avaliação médica em casa e prescrição revisada'); for (const id of CONDS) if (p.cond[id].diag && !p.cond[id].trat) p.cond[id].trat = true; }
  f.vinculo = clamp(f.vinculo + 2, 0, 100);
  if (p.posAlta) p.posAlta.orientado = true;
  return sucesso(`${partes.join('. ')}.`);
}

/** O paciente pede um cuidador: o jogo aceita ou recusa conforme a necessidade de saúde e a renda da família. */
export function pedirCuidador(s, cfg, pid) {
  const p = achaPessoa(s, pid), f = familiaDe(s, p), C = cfg.game.familia.cuidador;
  if (p.cuidador) return falha('Você já conta com um cuidador.');
  const motivo = dependencia(p);
  if (!motivo) return falha('Pedido recusado: não há limitação de saúde que justifique um cuidador. Alimentação, atividade física, sono e remédio continuam sendo com você.');
  const fam = f.pessoas.filter((q) => q !== p && q.idade >= 18 && q.idade <= 75 && !q.internado && !q.acamado && q.ocupacao !== 'trabalho');
  if (fam.length) {
    const q = fam[0];
    p.cuidador = { tipo: 'familiar', pid: q.id, nome: q.nome, qualidade: 35, sobrecarga: 40 };
    return sucesso(`Pedido aceito (${motivo}): ${q.nome} passa a ajudar nos cuidados. Cuidador familiar sem orientação pode errar: peça apoio da equipe.`);
  }
  if (f.saldo >= C.preco) {
    f.saldo -= C.preco;
    p.cuidador = { tipo: 'contratado', pid: null, nome: 'cuidador(a) contratado(a)', qualidade: C.qualidadeContratado, sobrecarga: 0 };
    return sucesso(`Pedido aceito (${motivo}): cuidador contratado por R$ ${C.preco}/mês. O cuidador ajuda no remédio e no dia a dia, mas não faz o seu exercício nem a sua alimentação por você.`);
  }
  return falha(`Pedido recusado por falta de condições: um cuidador custa R$ ${C.preco}/mês e o saldo da família é R$ ${f.saldo}. Procure o ACS/UBS: a equipe pode orientar a família e articular apoio.`);
}

/** Cuidado diário das pessoas acamadas: o cuidador pode errar; a orientação dos profissionais reduz os erros. */
export function cuidadoDiario(s, cfg, avisa) {
  const C = cfg.game.familia.cuidador;
  for (const f of s.familias) for (const p of f.pessoas) {
    if (!p.acamado || p.internado) continue;
    const ac = p.acamado, cu = p.cuidador;
    if (!cu) { ac.lesao = clamp(ac.lesao + 0.3, 0, 5); ac.semCuidador = (ac.semCuidador || 0) + 1; if (ac.semCuidador === 1) avisa('alerta', `⚠️ ${p.nome} está acamado(a) e sem cuidador: o risco de lesão e de piora é alto.`, p); }
    else {
      cu.sobrecarga = clamp(cu.sobrecarga + (cu.tipo === 'familiar' ? C.sobrecargaDia : 0.2), 0, 100);
      cu.qualidade = clamp(cu.qualidade - 0.5, 0, 100); // sem reforço, as orientações se perdem
      const base = cu.tipo === 'familiar' ? C.erroFamiliar : C.erroContratado;
      const visitas = ac.cuidadosHoje || 0; // quantas vezes o cuidador foi até o leito hoje
      const rotina = visitas >= 3 ? 0.8 : visitas >= 1 ? 1 : 1.5;
      const pErro = clamp(base * rotina * (1 + cu.sobrecarga / 60) * (1.4 - cu.qualidade / 100), 0, 0.85);
      if (rnd(s) < pErro) {
        ac.erros = (ac.erros || 0) + 1;
        const tipo = ['esqueceu o remédio', 'não fez a mudança de posição no leito', 'fez a higiene de forma inadequada'][rint(s, 0, 2)];
        if (tipo !== 'esqueceu o remédio') ac.lesao = clamp(ac.lesao + 0.5, 0, 5); else p.adesaoOverride = clamp((typeof p.adesaoOverride === 'number' ? p.adesaoOverride : 0.8) - 0.05, 0.2, 1);
        if (ac.erros % 4 === 1) avisa('info', `🤲 ${cu.nome} ${tipo} no cuidado de ${p.nome} (cuidador ${cu.tipo === 'familiar' ? `sobrecarregado: ${Math.round(cu.sobrecarga)}%` : 'contratado'}). Orientação e apoio da equipe reduzem esses erros.`, p);
      } else ac.lesao = clamp(ac.lesao - 0.05, 0, 5);
    }
    if (ac.lesao >= C.lesaoLimite) { // lesão por pressão infectada: precisa de média complexidade
      internarPessoa(s, cfg, p, 'foi internado(a) com lesão por pressão infectada (falha no cuidado do acamado)', null, { tipo: 'procedimento', causa: ac.causa });
      ac.lesao = 1.5;
    }
  }
}

export function avancarMes(s, cfg) {
  const G = cfg.game, D = G.dengue;
  const saida = [];
  const add = (tipo, texto, extra = {}) => {
    const e = { mes: s.mes, ano: s.ano, tipo, texto, ...extra };
    s.diario.push(e);
    saida.push(e);
  };
  const licao = (chave, titulo, texto) => {
    if (s.licoes[chave]) return;
    s.licoes[chave] = true;
    add('aprendizado', `${titulo} — ${texto}`);
  };
  const internar = (p, motivo, extra) => internarPessoa(s, cfg, p, motivo, add, extra);

  // 0. altas da UPA/hospital de referência do mês anterior: a pessoa volta para o acompanhamento na atenção primária
  for (const p of todasPessoas(s)) if (p.internado) {
    p.internado = false;
    const tipo = (p.altaInfo && p.altaInfo.tipo) || 'clinica';
    p.posAlta = { turno: s.turno, orientado: false, tipo };
    let extra = '';
    if (tipo === 'procedimento' && p.idade >= 50 && !p.acamado && rnd(s) < 0.45) { // sequela: passa a depender de cuidador
      p.acamado = { causa: p.altaInfo.causa || 'sequela', lesao: 0, erros: 0 };
      const cand = familiaDe(s, p).pessoas.filter((q) => q !== p && q.idade >= 18 && q.idade <= 75 && !q.acamado && !q.internado).sort((x, y) => (x.ocupacao === 'trabalho') - (y.ocupacao === 'trabalho'))[0];
      if (cand) p.cuidador = { tipo: 'familiar', pid: cand.id, nome: cand.nome, qualidade: 30, sobrecarga: 30 };
      extra = ` Ficou acamado(a)${cand ? ` e ${cand.nome} assumiu o cuidado` : ' e ainda não tem cuidador'}: oriente e acompanhe.`;
    }
    p.altaInfo = null;
    add('info', `🏥➡️🏠 ${p.nome} teve alta da UPA/hospital${tipo === 'procedimento' ? ' (pós-procedimento/cirurgia)' : ''} e precisa de acompanhamento e orientação na unidade em até 1 mês.${extra}`, { pessoaId: p.id });
  }
  // pós-alta sem acompanhamento: risco de reinternação
  for (const p of todasPessoas(s)) {
    if (!p.posAlta || p.internado) continue;
    if (p.posAlta.orientado) { p.posAlta = null; continue; }
    if (s.turno - p.posAlta.turno >= 1) {
      if (rnd(s) < 0.3) internar(p, 'foi reinternado(a): ficou sem acompanhamento depois da alta', { tipo: 'clinica' });
      else add('alerta', `⚠️ ${p.nome} ainda não recebeu o acompanhamento pós-alta: o risco de reinternação continua.`, { pessoaId: p.id });
      if (p.posAlta) p.posAlta.turno = s.turno;
    }
  }

  // 1. desfecho da dengue do mês anterior
  for (const p of todasPessoas(s)) {
    if (!p.dengue.ativa) continue;
    const idoso = p.idade >= 65 || p.idade < 5;
    const comorb = (p.cond.has.diag || p.cond.dm.diag) ? 1.3 : 1;
    const pg = (p.dengue.referido ? D.pGraveComAtendimento / 4 : p.dengue.atendido ? D.pGraveComAtendimento : D.pGraveSemAtendimento) * (idoso ? 1.8 : 1) * comorb;
    p.dengue = { ativa: false, atendido: false };
    p.imune = D.imunidadeMeses;
    if (rnd(s) < pg) {
      internar(p, 'evoluiu para dengue grave e foi internado(a)');
      licao('dengue', '💡 Dengue', cfg.cond.dengue.licao);
    } else {
      add('bom', `${p.nome} se recuperou da dengue.`, { pessoaId: p.id });
    }
  }

  // 2. economia da família, medicamentos (farmácia básica da UBS → Farmácia Popular) e adesão
  const E = G.familia;
  for (const f of s.familias) { const cl = E.classes[f.classe]; const folga = f.renda * cl.folga; f.saldo = Math.round(Math.min(f.saldo + folga, folga * 8)); }
  let precisam = 0, faltou = 0, semDinheiro = 0, naoAderiu = 0, gastoFarmacia = 0;
  for (const f of s.familias) for (const p of f.pessoas) {
    p.semRemedio = [];
    for (const id of CONDS) {
      const st = p.cond[id];
      st.ctrl = false;
      if (!st.trat || !st.diag) continue;
      precisam++;
      let obteve = false;
      if (s.insumos >= 1) { s.insumos -= 1; obteve = true; } // farmácia básica da UBS (gratuita, com estoque limitado)
      else {
        const copag = copagamento(cfg, id);
        if (f.saldo >= copag) { f.saldo -= copag; gastoFarmacia += copag; obteve = true; } // Farmácia Popular (conveniada, privada): paga parte
        else semDinheiro++;
      }
      if (!obteve) { faltou++; p.semRemedio.push(id); continue; }
      let ad = typeof p.adesaoOverride === 'number' ? p.adesaoOverride : adesao(f);
      if (p.cuidador && !p.acamado) ad = Math.max(ad, 0.6); // o cuidador lembra do remédio, mas não substitui o esforço da pessoa
      if (rnd(s) < ad) st.ctrl = true; else naoAderiu++;
    }
  }
  for (const p of todasPessoas(s)) if (p.cuidador && !p.acamado && !dependencia(p)) { // a necessidade passou: o cuidador deixa de ser necessário
    add('info', `${p.nome} se recuperou e não precisa mais de cuidador.`, { pessoaId: p.id }); p.cuidador = null;
  }
  // cuidador contratado é pago pela família; sem dinheiro, é dispensado
  for (const f of s.familias) {
    for (const p of f.pessoas) {
      if (!p.cuidador || p.cuidador.tipo !== 'contratado') continue;
      if (f.saldo >= E.cuidador.preco) { f.saldo -= E.cuidador.preco; }
      else { p.cuidador = null; add('alerta', `💸 A família ${f.nome.replace('Família ', '')} não conseguiu mais pagar o cuidador de ${p.nome}: ele(a) ficou sem cuidador.`, { pessoaId: p.id }); }
    }
    f.aperto = f.saldo < f.renda * E.classes[f.classe].folga * 0.5;
  }
  s.metricas.semAcesso = (s.metricas.semAcesso || 0) + semDinheiro;
  if (faltou > semDinheiro) add('alerta', `💊 Faltou medicamento na farmácia da unidade para ${faltou - semDinheiro} tratamento(s) neste mês (as famílias com dinheiro compraram na Farmácia Popular).`);
  if (semDinheiro > 0) add('alerta', `💸 ${semDinheiro} tratamento(s) ficaram sem medicamento: a farmácia da unidade estava sem estoque e a família não pôde pagar a Farmácia Popular. Renda baixa pesa no cuidado.`);
  if (naoAderiu > 0) add('info', `${naoAderiu} tratamento(s) não foram seguidos direito — vínculo e orientação aumentam a adesão.`);

  // 3. progressão das doenças crônicas
  for (const f of s.familias) for (const p of f.pessoas) {
    if (p.internado) continue;
    for (const id of CONDS) {
      const c = cfg.cond[id], st = p.cond[id];
      if (p.idade < c.idadeMin) continue;
      const z = riskZ(p, c, id);
      const m = G.ritmo * Math.exp(c.prog.k * z);
      if (st.estagio === 0) {
        if (rnd(s) < c.prog.p01 * m) st.estagio = 1;
      } else if (st.estagio === 1) {
        const protecao = (p.habitos.atividade + p.habitos.alimentacao) / 200;
        if (rnd(s) < c.prog.p12 * m) st.estagio = 2;
        else if (rnd(s) < 0.05 * protecao * protecao) st.estagio = 0;
      } else if (st.estagio === 2) {
        const fator = st.ctrl ? c.prog.fatorControlado : 1;
        if (rnd(s) < c.prog.p23 * m * fator) {
          st.estagio = 3;
          st.diag = true;
          internar(p, c.evento);
          licao(id, `💡 ${c.nome}`, c.licao);
        } else if (id === 'dep' && st.ctrl && rnd(s) < c.prog.remissao) {
          st.estagio = 1;
          st.diag = false; st.trat = false;
          add('bom', `${p.nome} teve melhora importante da depressão com o acompanhamento.`, { pessoaId: p.id });
        }
      }
    }
  }

  // 4. hábitos e peso (no mundo em tempo real, os hábitos vêm do comportamento diário dos personagens)
  for (const f of s.familias) for (const p of f.pessoas) {
    if (p.idade < 12) continue;
    if (!s.tempoReal) {
      const t = f.vinculo > 60 ? 0.5 : -0.3;
      for (const k of ['atividade', 'alimentacao', 'sono']) p.habitos[k] = clamp(p.habitos[k] + rfloat(s, -3, 3) + t, 0, 100);
      p.habitos.estresse = clamp(p.habitos.estresse + rfloat(s, -3, 3), 0, 100);
    }
    if (p.cond.dep.estagio >= 2 && !p.cond.dep.ctrl) {
      p.habitos.atividade = clamp(p.habitos.atividade - 1.5, 0, 100);
      p.habitos.alimentacao = clamp(p.habitos.alimentacao - 1, 0, 100);
    }
    if (p.idade >= 18) p.imc = Math.round(clamp(p.imc + (50 - (p.habitos.atividade + p.habitos.alimentacao) / 2) / 400, 17, 45) * 10) / 10;
  }

  // 5. novos casos de dengue
  const emTemporada = D.estacao.includes(s.mes);
  const pInf = Math.pow(s.infestacao / 100, 1.5) * D.ataque;
  let casos = 0, notificados = 0;
  for (const f of s.familias) for (const p of f.pessoas) {
    if (p.imune > 0) { p.imune -= 1; continue; }
    if (p.internado) continue;
    if (rnd(s) < pInf) {
      p.dengue = { ativa: true, atendido: false };
      casos++;
      if (f.vinculo >= 50) {
        notificados++;
        add('alerta', `🦟 ${p.nome} procurou a unidade com febre e dor no corpo (suspeita de dengue).`, { pessoaId: p.id });
      }
    }
  }
  if (casos >= 2) add('alerta', `🦟 Vigilância: aumento de casos suspeitos no território (${casos} novos). Atenção às famílias de menor vínculo — elas podem não procurar a unidade.`);
  if (casos > 0 && notificados === 0) add('info', 'A vigilância recebeu sinais de febre no bairro. Visitas domiciliares ajudam a encontrar quem não veio à unidade.');
  if (casos > 0) licao('dengue-surto', '💡 Vigilância', 'Quem tem pouco vínculo com a unidade tende a procurar atendimento só quando o quadro piora. Visitas domiciliares e mutirões contra focos protegem quem não vem até você.');

  // 6. ambiente: infestação
  if (emTemporada) s.infestacao = clamp(s.infestacao + rfloat(s, D.crescimentoEstacao[0], D.crescimentoEstacao[1]) * (1 - 0.25 * s.predios.vigilancia), 0, 100);
  else s.infestacao = clamp(s.infestacao - D.quedaForaEstacao, 0, 100);
  s.infestacao = Math.round(s.infestacao);

  // 7. vínculo
  for (const f of s.familias) {
    if (s.turno - f.visTurno > 2) f.vinculo -= 1;
    f.vinculo += 1.5 * s.predios.acs;
    f.vinculo = clamp(Math.round(f.vinculo * 10) / 10, 0, 100);
  }

  // 8. obra
  if (s.obra) {
    s.obra.meses -= 1;
    if (s.obra.meses <= 0) {
      s.predios[s.obra.id] += 1;
      add('bom', `🔨 Obra concluída: ${G.predios[s.obra.id].nome} (nível ${s.predios[s.obra.id]}).`);
      s.obra = null;
    }
  }

  // 9. economia e relógio
  const ind = indicadores(s, cfg);
  const bonus = Math.round(G.economia.verbaBonus * ind.score);
  s.verba += G.economia.verbaBase + bonus;
  s.insumos = Math.min(G.economia.insumosCap, s.insumos + G.insumosBase + G.insumosPorNivel * s.predios.farmacia);
  s.mes += 1;
  s.turno += 1;
  if (s.mes === 12) {
    s.mes = 0; s.ano += 1;
    for (const p of todasPessoas(s)) p.idade += 1;
    const i = indicadores(s, cfg);
    add('info', `📅 Balanço do ano: liga ${i.liga} · ${s.internacoes.filter((t) => s.turno - t < 12).length} internação(ões) · vínculo médio ${Math.round(i.vinculoMedio * 100)}%.`);
  }
  s.tempoMax = tempoMaximo(s, cfg);
  s.tempo = s.tempoMax;
  s.ultimoRelatorio = saida;
  return saida;
}
