// Interface (mobile-first). O jogador escolhe UM personagem (paciente ou profissional) e joga só com ele: toca em
// móveis, pessoas e no chão para dar ordens. Nenhuma regra de jogo mora aqui.
import {
  CONDS, FOCOS, newGame, todasPessoas, achaPessoa, achaFamilia, indicadores, acaoTratamento, rotuloData, sintomasDengueVisiveis,
} from './engine.js';
import {
  montarCfg, iniciarEstadoMundo, escolherPersonagem, criarMundo, passoMundo, pularMes, pularDia, minutosPorSegundo,
  rotuloRelogio, diaDoMes, ubsAberta, agenteJogador, acaoAtual, opcoesPara, comandar, cancelarFila, alternaVontade,
  iniciarAtendimento, finalizarAtendimento, atendimentoAtual, filaEspera, acoesPaciente, resumoEquipe, afazeresDoDia, trocarPersonagem, vinculosEquipe, coesaoDe, sintomasDe, ROTULO_NEC, PAPEIS, diaSemana,
} from './mundo.js';
import { criarRenderer } from './render.js';
import { criarRenderer2D } from './render2d.js';
import { PERGUNTAS, contextoTecnico, temResposta, enviarFeedback } from './feedback.js';

const SAVE_KEY = 'saude-sim-save-v3';
const INTRO_KEY = 'saude-sim-intro-v3';
const FEEDBACK_KEY = 'saude-sim-feedback-v1';
const ARQ_KEY = 'saude-sim-arq-v1'; // vidas arquivadas: cada personagem é uma vida independente

let base, cfg, S, W, R;
let aba = 'mundo';
let folha = null;
let menu = null; // { titulo, ops, alvo }
let abaPers = 'paciente';
let vel = 1, velAntes = 1;
let jaDeuOrdem = false;
let assinaturaCartao = '';
let ultimaChaveAtend = '';
let errosSeguidos = 0;
let arquivo = { cen: null, seed: null, itens: {} }; // vidas (estados de jogo) dos personagens que não estão em uso agora
let confirmaReinicio = null;
let painelOculto = false; // esconde a barra de ações do personagem para ver e navegar pelo cenário
let fbResp = {}, fbEstado = 'editando', fbMsg = ''; // rascunho e estado do envio do feedback

const $ = (q) => document.querySelector(q);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const MESES_ABR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/* ---------- Falhas: mostra o motivo e permite recomeçar ---------- */
function telaErro(msg) {
  if (document.getElementById('tela-erro')) return;
  const d = document.createElement('div');
  d.id = 'tela-erro';
  d.innerHTML = `<div class="folha" style="margin:auto;max-width:420px;border-radius:18px">
    <h2>Algo deu errado ao abrir o jogo</h2>
    <p class="dica-t" style="margin:8px 0">Tente recarregar. Se continuar, apague o progresso salvo e comece de novo.</p>
    <pre style="white-space:pre-wrap;font-size:11px;background:var(--card);padding:8px;border-radius:8px;max-height:120px;overflow:auto">${esc(msg)}</pre>
    <button class="btn primario" style="margin-top:10px" id="erro-reload"><span>Recarregar</span></button>
    <button class="btn perigo" id="erro-limpar"><span>Apagar progresso e recomeçar</span></button></div>`;
  d.style.cssText = 'position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.6);display:flex;padding:16px;overflow:auto';
  document.body.appendChild(d);
  document.getElementById('erro-reload').onclick = () => location.reload();
  document.getElementById('erro-limpar').onclick = () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* ok */ } location.reload(); };
}
window.addEventListener('error', (e) => { if (!S) telaErro(`${e.message || e.error}`); });
window.addEventListener('unhandledrejection', (e) => { if (!S) telaErro(`${e.reason && e.reason.message ? e.reason.message : e.reason}`); });

/* ---------- Persistência ---------- */
function salvar() { try { if (S && S.jogador) localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch { /* sem armazenamento: segue o jogo */ } }
function carregarSalvo() {
  try { const t = localStorage.getItem(SAVE_KEY); if (t) { const s = JSON.parse(t); if (s.v === 2 && s.tempoReal && s.mundo && s.jogador && s.metricas) return s; } } catch { /* ignora */ }
  return null;
}
/* ---------- Vidas independentes: cada personagem tem o seu próprio mundo, diário e progresso ---------- */
const chaveDe = (esc) => (esc.modo === 'paciente' ? `p:${esc.pid}` : `f:${esc.papel}`);
const vidaValida = (x) => !!(x && x.v === 2 && x.tempoReal && x.mundo && x.jogador && x.metricas);
function carregaArquivo() {
  arquivo = { cen: cfg.cenario.id, seed: S.seed, itens: {} };
  try {
    const t = localStorage.getItem(ARQ_KEY);
    if (!t) return;
    const a = JSON.parse(t);
    if (a && a.cen === arquivo.cen && a.seed === arquivo.seed) { for (const [k, v] of Object.entries(a.itens || {})) if (vidaValida(v)) arquivo.itens[k] = v; }
  } catch { /* ignora */ }
}
function gravaArquivo() {
  try { localStorage.setItem(ARQ_KEY, JSON.stringify(arquivo)); } catch { /* sem espaço: as vidas arquivadas ficam só nesta sessão */ }
}
function novaVida(escolha) {
  const s2 = newGame(cfg, S.seed); // mesmo bairro e mesmas pessoas, mas uma história só desta vida
  s2.tempoReal = true;
  iniciarEstadoMundo(s2);
  escolherPersonagem(s2, escolha);
  return s2;
}
const diasDeVida = (x) => Math.floor(x.mundo.min / 1440) + 1;

function jaViuIntro() { try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return true; } }
function carregaRascunhoFb() { try { fbResp = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '{}') || {}; } catch { fbResp = {}; } }
function salvaRascunhoFb() { try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(fbResp)); } catch { /* ok */ } }
function marcaIntro() { try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* ok */ } }

/* ---------- Apresentação ---------- */
function emojiPessoa(p) {
  if (p.idade < 3) return '👶';
  if (p.idade < 13) return p.sexo === 'F' ? '👧' : '👦';
  if (p.idade < 18) return p.sexo === 'F' ? '👩‍🎓' : '👨‍🎓';
  if (p.idade >= 60) return p.sexo === 'F' ? '👵' : '👴';
  return p.sexo === 'F' ? '👩' : '👨';
}
const EMOJI_PAPEL = { acs: '🧑‍🌾', tecnico: '🧑‍🔬', enfermeiro: '🧑‍⚕️', medico: '🧑‍⚕️' };

let toastTimer;
function toast(msg, ok = true) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `on ${ok ? '' : 'erro'}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 4800);
}
function limpaToast() { clearTimeout(toastTimer); $('#toast').className = ''; }

const modo = () => (S && S.jogador ? S.jogador.modo : null);
const papel = () => (S && S.jogador && S.jogador.modo === 'profissional' ? S.jogador.papel : null);
const clinico = () => ['tecnico', 'enfermeiro', 'medico'].includes(papel());
const meuAgente = () => (W ? agenteJogador(W) : null);
const minhaPessoa = () => { const a = meuAgente(); return a && a.k === 'res' ? achaPessoa(S, a.pid) : null; };

function tagsPessoa(p) {
  const t = [];
  if (p.internado) t.push('<span class="selo bad">🏥 internado(a)</span>');
  for (const id of CONDS) {
    const st = p.cond[id];
    if (st.diag) t.push(`<span class="selo ${st.trat ? 'ok' : 'warn'}">${cfg.cond[id].icone} ${esc(cfg.cond[id].nome)}${st.trat ? ' · em tratamento' : ''}</span>`);
    else if (p.conhecido.suspeitas.includes(id)) t.push(`<span class="selo warn">⚠ suspeita: ${esc(cfg.cond[id].nome)}</span>`);
  }
  return t.join('');
}

/** Pistas sobre a vida da pessoa (sem revelar doenças). */
function dicasDe(p) {
  const d = [];
  const oc = { trabalho: p.profissao ? `Trabalha como ${p.profissao.toLowerCase()}` : 'Trabalha', escola: 'Estuda', aposentado: 'Aposentado(a)', casa: p.idade < 6 ? 'Fica em casa' : 'Cuida da casa' }[p.ocupacao] || '';
  if (oc) d.push(oc);
  if (p.tabagismo) d.push('Fuma');
  if (p.idade >= 18 && p.imc >= 30) d.push('Acima do peso');
  if (p.idade >= 12) {
    if (p.habitos.atividade < 35) d.push('Quase não se exercita'); else if (p.habitos.atividade >= 70) d.push('Gosta de se movimentar');
    if (p.habitos.alimentacao < 35) d.push('Come muita coisa pronta'); else if (p.habitos.alimentacao >= 70) d.push('Come bem');
    if (p.habitos.sono < 40) d.push('Dorme mal');
    if (p.habitos.estresse > 65) d.push('Vive estressado(a)');
  }
  return d.slice(0, 5);
}

/* ---------- Topo, abas e painel ---------- */
function montaTopo() {
  $('#topo').innerHTML = `
    <div class="linha"><h1 id="t-nome"></h1><div class="chips"><span class="chip" id="t-c1"></span><span class="chip" id="t-c2"></span></div><button class="ajuda" data-act="ajuda" aria-label="Como jogar">?</button></div>
    <div class="linha2">
      <span class="data" id="t-data"></span>
      <div class="vel" role="group" aria-label="Velocidade do tempo">
        <button data-act="vel" data-v="0" title="Pausar">⏸</button><button data-act="vel" data-v="1">1×</button><button data-act="vel" data-v="3">3×</button><button data-act="vel" data-v="8">8×</button><button data-act="pular-dia" title="Pular até as 7h do dia seguinte">☀ dia</button><button data-act="pular" title="Pular até o fim do mês">📅 mês</button>
      </div>
    </div>`;
}
function montaRodape() {
  const abas = modo() === 'paciente'
    ? [['mundo', '🗺️', 'Mundo'], ['saude', '🩺', 'Saúde'], ['diario', '📓', 'Diário'], ['feedback', '💬', 'Feedback']]
    : [['mundo', '🗺️', 'Mundo'], ['unidade', '🏥', 'Unidade'], ['diario', '📓', 'Diário'], ['desempenho', '📊', 'Desempenho'], ['feedback', '💬', 'Feedback']];
  $('#rodape').innerHTML = `<div class="abas" style="grid-template-columns:repeat(${abas.length},1fr)">${abas.map(([id, ic, nome]) => `<button class="aba" data-act="aba" data-id="${id}"><span class="ic">${ic}</span>${nome}</button>`).join('')}</div>`;
}

function atualizaTopo() {
  const ag = meuAgente();
  $('#t-nome').textContent = modo() === 'paciente' ? `${emojiPessoa(minhaPessoa())} ${minhaPessoa().nome}` : `${EMOJI_PAPEL[papel()]} ${cfg.papeis[papel()].curto}`;
  $('#t-data').textContent = `${MESES_ABR[S.mes]} · dia ${diaDoMes(S)} · ${rotuloRelogio(S)}`;
  if (modo() === 'paciente') {
    const n = S.mundo.needs[ag.pid];
    $('#t-c1').textContent = `😊 ${Math.round(n.humor)}`;
    $('#t-c2').textContent = ubsAberta(W, S, cfg) ? '🏥 aberta' : '🏥 fechada';
  } else {
    const r = resumoEquipe(W);
    $('#t-c1').textContent = `📋 fila ${r.triagem + r.enfermagem + r.consulta}`;
    $('#t-c2').textContent = `💊 ${S.insumos}`;
  }
  document.querySelectorAll('#topo [data-act=vel]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === vel)));
  document.querySelectorAll('#rodape .aba').forEach((b) => (b.dataset.id === aba ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
}

function barraNec(k, v) { return `<div class="nec" title="${ROTULO_NEC[k][1]}"><span>${ROTULO_NEC[k][0]}</span><span class="barra mini"><i id="n-${k}"></i></span></div>`; }

function montaPainel(forcar = false) {
  const el = $('#cartao');
  if (!S || aba !== 'mundo' || painelOculto) { el.hidden = true; return; }
  const ag = meuAgente();
  let assin = `${modo()}|${papel()}|${ag.id}`;
  if (modo() === 'paciente') { const p = minhaPessoa(); assin += `|${p.tabagismo}|${CONDS.some((id) => p.cond[id].diag && p.cond[id].trat)}|${S.jogador.vontade}|${ag.fila.length}|${sintomasDe(S, cfg, p.id).length}`; }
  else assin += `|${ag.fila.length}|${atendimentoAtual(W, S) ? 1 : 0}|${afazeresDoDia(W, S, cfg).feitos}`;
  if (!forcar && assin === assinaturaCartao) return;
  assinaturaCartao = assin;
  el.hidden = false;
  if (modo() === 'paciente') {
    const p = minhaPessoa();
    const emTrat = CONDS.some((id) => p.cond[id].diag && p.cond[id].trat);
    const sint = sintomasDe(S, cfg, p.id);
    el.innerHTML = `<div class="c-topo"><span class="emoji">${emojiPessoa(p)}</span>
        <div class="c-id"><b>${esc(p.nome)}</b> <small>${p.idade} anos</small><div class="c-acao" id="c-acao"></div></div>
        ${ag.fila.length ? `<button class="chip-fila" data-act="cartao-cancelar" aria-label="Cancelar ordens">✕ ${ag.fila.length} na fila</button>` : ''}</div>
      ${sint.length ? `<div class="alerta-sint">🤒 Você está sentindo: ${esc(sint.join(', '))}</div>` : ''}
      <div class="necs">${Object.keys(ROTULO_NEC).map((k) => barraNec(k)).join('')}</div>
      <div class="c-btns um"><button class="btn primario" data-act="abrir-acoes">🎬 Fazer algo…</button></div>
      <div class="c-btns">
        <button class="btn peq" data-act="cartao-unidade">🏥 Unidade</button>
        ${emTrat ? '<button class="btn peq" data-act="cartao-remedio">💊 Remédio</button>' : ''}
        ${p.tabagismo ? '<button class="btn peq" data-act="cartao-fumar">🚬 Fumar</button>' : ''}
        <button class="btn peq ${S.jogador.vontade ? 'ligado' : ''}" data-act="cartao-vontade">🧠 Vontade ${S.jogador.vontade ? 'ligada' : 'desl.'}</button>
      </div>`;
  } else {
    const at = atendimentoAtual(W, S);
    el.innerHTML = `<div class="c-topo"><span class="emoji">${EMOJI_PAPEL[papel()]}</span>
        <div class="c-id"><b>${esc(cfg.papeis[papel()].nome)}</b><div class="c-acao" id="c-acao"></div></div>
        ${ag.fila.length ? `<button class="chip-fila" data-act="cartao-cancelar">✕ ${ag.fila.length} na fila</button>` : ''}</div>
      ${(() => { const af = afazeresDoDia(W, S, cfg); return af.aberto ? `<div class="alerta-sint af">📋 Afazeres do dia: <b>${af.feitos}/${af.total}</b></div>` : ''; })()}
      <div class="c-btns um"><button class="btn primario" data-act="abrir-acoes">🎬 Ações…</button></div>
      <div class="c-btns" style="grid-template-columns:repeat(2,1fr)">
        ${papel() === 'acs' ? '<button class="btn peq" data-act="abrir-territorio">🏘️ Minhas famílias</button><button class="btn peq" data-act="cartao-mutirao">🧹 Mutirão</button>'
    : `<button class="btn peq" data-act="abrir-fila">📋 Fila de espera</button><button class="btn peq" data-act="abrir-atend" ${at ? '' : 'disabled'}>🩺 Atendimento atual</button>`}
      </div>`;
  }
}

function atualizaPainel() {
  if (aba !== 'mundo' || $('#cartao').hidden) return;
  const ag = meuAgente();
  const acao = $('#c-acao');
  if (acao) acao.textContent = acaoAtual(W, S, ag);
  if (modo() === 'paciente') {
    const n = S.mundo.needs[ag.pid];
    for (const k of Object.keys(ROTULO_NEC)) {
      const b = $(`#n-${k}`);
      if (b) { b.style.width = `${n[k]}%`; b.className = n[k] < 25 ? 'ruim' : n[k] < 50 ? 'medio' : ''; }
    }
  }
}

function dicaDoMomento() {
  if (modo() === 'paciente') {
    const p = minhaPessoa();
    if (!jaDeuOrdem) return (R && R.modo === '2d' && window.__sem3d ? '<b>Modo simples (2D):</b> sem câmera giratória. Toque em <b>⟳</b> para ligar o 3D. ' : '') + 'Toque em <b>🎬 Fazer algo…</b> para escolher o que ele faz (dormir, ler, caminhar…).';
    const sint = sintomasDe(S, cfg, p.id);
    if (sint.length && !p.conhecido.medidas) return `Você está sentindo <b>${esc(sint[0])}</b>. Pode ser algo sério: pense em procurar a unidade (toque nos móveis dela).`;
    if (p.idade >= 18 && p.conhecido.medidasTurno === null && S.turno >= 0 && S.mundo.min > 3 * 1440) return 'Você nunca mediu pressão e glicemia. Muita doença é <b>silenciosa</b>: considere pedir uma <b>triagem</b> na unidade.';
    if (CONDS.some((id) => p.cond[id].diag && p.cond[id].trat) && !S.mundo.remedios[p.id].hoje && S.mundo.min % 1440 > 6 * 60 && S.mundo.min % 1440 < 12 * 60) return 'Hora do <b>remédio</b>: toque na cozinha e escolha "Tomar o remédio".';
    return null;
  }
  if (!jaDeuOrdem) {
    if (papel() === 'acs') return 'Toque numa <b>pessoa</b> para aferir pressão, orientar ou convidar à unidade, e numa <b>casa</b> para visitar a família.';
    return 'Toque numa <b>pessoa sentada na fila</b> (⏳) para chamar para atendimento. Seu painel mostra a fila.';
  }
  if (clinico() && resumoEquipe(W)[papel() === 'tecnico' ? 'triagem' : papel() === 'enfermeiro' ? 'enfermagem' : 'consulta'] > 0 && !atendimentoAtual(W, S) && meuAgente().fila.length === 0) return 'Há gente na sua fila. Toque numa pessoa com ⏳ e escolha <b>Chamar para atendimento</b>.';
  if (clinico() || papel() === 'acs') {
    const ag = meuAgente(), af = afazeresDoDia(W, S, cfg);
    if (af.aberto && af.feitos < af.total && !ag.tarefa && !ag.afz && !ag.fila.length && !ag.path.length) return `Sem ninguém para atender agora. Escolha um <b>afazer do dia</b> em 🎬 Ações (${af.feitos}/${af.total} feitos).`;
  }
  return null;
}
function atualizaDica() {
  const el = $('#dica');
  const txt = aba === 'mundo' && !folha && !menu && !painelOculto ? dicaDoMomento() : null;
  if (!txt) { el.hidden = true; return; }
  if (el.dataset.t !== txt) { el.innerHTML = txt; el.dataset.t = txt; }
  el.hidden = false;
}

/* ---------- Telas de lista ---------- */
function barraIndicador(rotulo, valor, detalhe = '') {
  const v = valor === null ? 0 : valor * 100;
  return `<div style="margin-bottom:12px"><div class="rotulo"><span>${rotulo}</span><span>${pct(valor)}${detalhe}</span></div>
    <div class="barra ${valor !== null && valor < 0.3 ? 'perigo' : valor !== null && valor < 0.6 ? 'alerta' : ''}"><i style="width:${v}%"></i></div></div>`;
}
function linhaHabito(rotulo, v, inverso = false) {
  const bom = inverso ? 100 - v : v;
  return `<div class="hab"><div class="rotulo"><span>${rotulo}</span><span>${Math.round(v)}</span></div><div class="barra ${bom < 35 ? 'perigo' : bom < 60 ? 'alerta' : ''}"><i style="width:${bom}%"></i></div></div>`;
}

function viewSaude() {
  const p = minhaPessoa(), c = p.conhecido;
  const sint = sintomasDe(S, cfg, p.id);
  const diag = CONDS.filter((id) => p.cond[id].diag);
  const r = S.mundo.remedios[p.id];
  const retorno = CONDS.some((id) => p.cond[id].diag && p.cond[id].trat) && S.turno - (p.retornoTurno === undefined ? -99 : p.retornoTurno) >= 1;
  let medidas = '<p class="dica-t">Você ainda não mediu a pressão nem a glicemia. Muita doença não dá sintoma.</p>';
  if (c.medidas) { const q = S.turno - c.medidasTurno; medidas = `<div class="kv"><span>Pressão arterial</span><span>${c.medidas.pas}/${c.medidas.pad} mmHg</span><span>Glicemia</span><span>${c.medidas.glic} mg/dL</span><span>Medido</span><span>${q === 0 ? 'neste mês' : `há ${q} mês(es)`}</span></div>`; }
  const h = p.habitos;
  return `<h2 class="secao">Como me sinto</h2>
    <div class="card">${sint.length ? `<p>🤒 ${esc(sint.join(', '))}</p><p class="dica-t">Sintomas merecem atenção. A unidade atende em dia útil.</p>` : '<p>😊 Sem queixas no momento.</p><p class="dica-t">Atenção: algumas doenças, como a pressão alta, não dão sintoma.</p>'}</div>
    ${retorno ? '<div class="card"><strong>🗓️ Retorno pendente</strong><p class="dica-t">Já faz um mês da última consulta: o médico pediu para voltar.</p></div>' : ''}
    <h2 class="secao">Meu acompanhamento</h2>
    <div class="card">${diag.length ? diag.map((id) => `<div class="rotulo"><strong>${cfg.cond[id].icone} ${esc(cfg.cond[id].nome)}</strong><span>${p.cond[id].trat ? 'em tratamento' : 'sem tratamento'}</span></div>`).join('') + (diag.some((id) => p.cond[id].trat) ? `<p class="dica-t" style="margin-top:8px">💊 Remédio tomado neste mês: <b>${r.dias}</b> dia(s) ${r.hoje ? '· já tomou hoje' : '· ainda não tomou hoje'}. A adesão do mês decide se a doença fica controlada.</p>` : '') : '<p class="dica-t">Nenhum diagnóstico até agora.</p>'}
      ${p.conhecido.suspeitas.length ? `<p class="dica-t">⚠ Valores alterados na última medida: ${p.conhecido.suspeitas.map((id) => esc(cfg.cond[id].nome)).join(', ')}. Vale uma consulta.</p>` : ''}</div>
    <div class="card" style="margin-top:10px">${medidas}</div>
    <h2 class="secao">Meu estilo de vida</h2>
    <div class="card">${p.idade >= 12 ? `${linhaHabito('Atividade física', h.atividade)}${linhaHabito('Alimentação', h.alimentacao)}${linhaHabito('Sono', h.sono)}${linhaHabito('Estresse (menos é melhor)', h.estresse, true)}` : '<p class="dica-t">Cuide da rotina: sono, comida e brincadeira.</p>'}
      <div class="kv" style="margin-top:8px"><span>Fuma</span><span>${p.tabagismo ? 'Sim' : 'Não'}</span>${p.idade >= 18 ? `<span>IMC</span><span>${p.imc}</span>` : ''}</div>
      <p class="dica-t">Os hábitos mudam devagar, conforme o que você faz no dia a dia (comer bem, dormir, se mexer).</p></div>`;
}

function viewDiario() {
  let itens = S.diario;
  if (modo() === 'paciente') { const p = minhaPessoa(); itens = itens.filter((e) => e.pessoaId === p.id || e.familiaId === p.familiaId || e.tipo === 'aprendizado'); }
  if (!itens.length) return '<p class="vazio">Nada por aqui ainda.</p>';
  const lis = [...itens].reverse().slice(0, 150).map((e) => `<div class="entrada ${e.tipo}"><div class="quando">${MESES_ABR[e.mes]}/${e.ano}</div>${esc(e.texto)}</div>`).join('');
  return `<h2 class="secao">${modo() === 'paciente' ? 'Meu diário' : 'Diário da unidade'}</h2>${lis}`;
}

function viewUnidade() {
  const mundo = cfg.cenario.mundo, inf = S.infestacao, r = resumoEquipe(W);
  const aberta = ubsAberta(W, S, cfg), med = ubsAberta(W, S, cfg, true);
  const dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
  const diasMedico = mundo.medicoDias.filter((d) => d < 5).map((d) => dias[d]).join(', ');
  const fila = (tipo, nome) => {
    const l = filaEspera(W, tipo);
    return `<div class="card"><div class="rotulo"><strong>${nome}</strong><span>${l.length} aguardando</span></div>${l.length ? l.map((o) => `<div class="kv" style="font-size:13px"><span>${esc(achaPessoa(S, o.pid).nome)}</span><span>${Math.round((S.mundo.min - o.t0))} min</span></div>`).join('') : '<p class="dica-t">Ninguém na fila.</p>'}</div>`;
  };
  return `<h2 class="secao">Funcionamento</h2>
    <div class="card"><div class="rotulo"><strong>${aberta ? '🟢 Aberta agora' : '🔴 Fechada agora'}</strong><span>${mundo.expediente[0]}h–${mundo.expediente[1]}h, dias úteis</span></div>
      <p class="dica-t">Médico(a): ${diasMedico} ${med ? '· presente hoje' : '· <b>não atende hoje</b>'}.<br>Pessoas chamadas: ${r.chamados} · tarefas de campo: ${r.acs}.</p></div>
    <h2 class="secao">Filas</h2>${fila('triagem', '📏 Triagem (técnico)')}${fila('enfermagem', '🩺 Enfermagem')}${fila('consulta', '🩺 Consulta médica')}
    <h2 class="secao">🤝 Vínculo entre os profissionais</h2>
    <div class="card">${vinculosEquipe(S, cfg).map((x) => barraIndicador(`${EMOJI_PAPEL[x.a]} ${esc(cfg.papeis[x.a].curto || cfg.papeis[x.a].nome)} ↔ ${EMOJI_PAPEL[x.b]} ${esc(cfg.papeis[x.b].curto || cfg.papeis[x.b].nome)}`, x.v / 100)).join('')}
      <p class="dica-t">Equipe afinada atende mais rápido e perde menos encaminhamentos; equipe desencontrada atrasa e se perde (até 30% mais lento). O vínculo esfria sem convivência: converse, discuta casos, faça reuniões e pausas na copa.</p></div>
    <h2 class="secao">Vigilância do território</h2>
    <div class="card"><div class="rotulo"><strong>🦟 Índice de infestação do mosquito</strong><span>${inf}%</span></div>
      <div class="barra ${inf >= 60 ? 'perigo' : inf >= 35 ? 'alerta' : ''}"><i style="width:${inf}%"></i></div>
      <p class="dica-t">De novembro a abril, com calor e chuva, a infestação tende a subir. O agente comunitário organiza os mutirões.</p></div>`;
}

function viewDesempenho() {
  const i = indicadores(S, cfg), c = cfg.cenario, m = S.metricas;
  const espera = m.atendidos + m.triagens ? Math.round(m.esperaTotal / Math.max(1, m.atendidos + m.triagens + m.orientacoes)) : 0;
  return `<h2 class="secao">Cenário</h2>
    <div class="card"><div class="rotulo"><strong>${c.icone} ${esc(c.nome)}</strong></div><ul class="lista">${c.desafios.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>
    <h2 class="secao">Seu trabalho</h2>
    <div class="card"><div class="kv"><span>Consultas feitas</span><span>${m.atendidos}</span><span>Triagens</span><span>${m.triagens}</span><span>Orientações</span><span>${m.orientacoes}</span><span>Visitas domiciliares</span><span>${m.visitas}</span><span>Afazeres concluídos</span><span>${m.afazeres || 0}</span><span>Reuniões de equipe</span><span>${m.reunioes || 0}</span><span>Falhas de comunicação</span><span>${m.falhasComunicacao || 0}</span><span>Espera média</span><span>${espera} min</span></div></div>
    <h2 class="secao">Desempenho da unidade</h2>
    <div class="card"><div class="rotulo"><span>Liga</span><span>pontuação ${Math.round(i.score * 100)}</span></div><div class="liga">🏅 ${i.liga}</div></div>
    <div class="card" style="margin-top:10px">
      ${barraIndicador('Adultos com PA/glicemia medidas (12 meses)', i.rastreamento)}
      ${barraIndicador('Hipertensos diagnosticados e controlados', i.has, ` (${i.hasTotal})`)}
      ${barraIndicador('Diabéticos diagnosticados e controlados', i.dm, ` (${i.dmTotal})`)}
      ${barraIndicador('Depressão diagnosticada e em tratamento', i.dep, ` (${i.depTotal})`)}
      ${barraIndicador('Vínculo médio com as famílias', i.vinculoMedio)}
      <div class="rotulo"><span>Internações nos últimos 12 meses</span><span>${i.internacoesAno}</span></div></div>
    <button class="btn" style="margin-top:14px" data-act="sobre"><span>ℹ️ Sobre o jogo e avisos</span></button>`;
}

function renderVista() {
  const v = $('#vista');
  if (aba === 'mundo') return;
  const scroll = v.scrollTop;
  const corpo = { saude: viewSaude, diario: viewDiario, unidade: viewUnidade, desempenho: viewDesempenho, feedback: viewFeedback }[aba]();
  v.innerHTML = corpo + (modo() === 'paciente' && aba === 'diario' ? '' : '') + (aba === 'saude' ? '<button class="btn" style="margin-top:14px" data-act="sobre"><span>ℹ️ Sobre o jogo e avisos</span></button>' : '');
  v.scrollTop = scroll;
}

/* ---------- Feedback ---------- */
function infoFeedback() {
  let instalado = false;
  try { instalado = !!(window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)); } catch { /* ok */ }
  return contextoTecnico({
    userAgent: navigator.userAgent, graficos: R && R.modo === '3d' ? '3D' : '2D', cenario: cfg && cfg.cenario.id,
    personagem: S && S.jogador ? (modo() === 'paciente' ? 'paciente' : papel()) : '-', mesesJogados: S && S.metricas ? S.mes : undefined,
    instalado, tela: `${window.innerWidth}x${window.innerHeight}`, testador: window.__testador && window.__testador.id,
  });
}

function viewFeedback() {
  if (fbEstado === 'enviado') {
    return `<div class="card"><h2>Obrigado! 💚</h2><p>${esc(fbMsg)}</p><p class="dica-t">Sua opinião ajuda a decidir os próximos passos do jogo.</p></div>
      <button class="btn" style="margin-top:12px" data-act="fb-novo"><span>Enviar outro feedback</span></button>`;
  }
  const blocos = PERGUNTAS.map((p) => {
    const v = fbResp[p.id];
    if (p.tipo === 'estrelas') return `<div class="card fb"><b>${esc(p.rot)}</b><div class="fb-op">${[1, 2, 3, 4, 5].map((n) => `<button data-act="fb-op" data-id="${p.id}" data-v="${n}" aria-pressed="${v === n}">${n <= (v || 0) ? '⭐' : '☆'}</button>`).join('')}</div></div>`;
    if (p.tipo === 'opcoes') return `<div class="card fb"><b>${esc(p.rot)}</b><div class="fb-op">${p.opcoes.map((o) => `<button class="pill" data-act="fb-op" data-id="${p.id}" data-v="${esc(o)}" aria-pressed="${v === o}">${esc(o)}</button>`).join('')}</div></div>`;
    return `<div class="card fb"><label for="fb-${p.id}"><b>${esc(p.rot)}</b></label><${p.curto ? 'input type="text"' : 'textarea rows="3"'} id="fb-${p.id}" data-fb="${p.id}" maxlength="600" ${p.curto ? `value="${esc(v || '')}"` : ''}>${p.curto ? '' : esc(v || '')}${p.curto ? '' : '</textarea>'}${p.curto ? '' : ''}</div>`;
  }).join('');
  const ctx = infoFeedback();
  return `<h2 class="secao">Sua opinião</h2>
    <p class="dica-t">Leva 2 minutos. Responda o que quiser — nada é obrigatório.</p>${blocos}
    <div class="card fb"><b>Informações enviadas junto</b><p class="dica-t">Versão ${esc(ctx.versao)} · gráficos ${esc(ctx.graficos)} · cenário ${esc(ctx.cenario)} · tela ${esc(ctx.tela)}. Nenhum dado de saúde seu é enviado.</p></div>
    <button class="btn primario" style="margin-top:12px" data-act="fb-enviar" ${fbEstado === 'enviando' ? 'disabled' : ''}><span>${fbEstado === 'enviando' ? 'Enviando…' : '📨 Enviar feedback'}</span></button>
    ${fbMsg ? `<p class="aviso" style="margin-top:10px">${esc(fbMsg)}</p>` : ''}`;
}

async function enviaFeedbackAgora() {
  if (!temResposta(fbResp)) { fbMsg = 'Responda ao menos uma pergunta antes de enviar.'; renderVista(); return; }
  fbEstado = 'enviando'; fbMsg = ''; renderVista();
  const r = await enviarFeedback(fbResp, infoFeedback(), base.game.feedback);
  if (r.ok) {
    fbEstado = 'enviado';
    fbMsg = { forms: 'Seu feedback foi enviado.', compartilhar: 'Feedback compartilhado.', copia: 'O texto foi copiado. Cole numa conversa e envie para quem te passou o jogo.' }[r.via] || 'Feedback enviado.';
    fbResp = {}; salvaRascunhoFb();
  } else {
    fbEstado = 'editando';
    fbMsg = r.via === 'cancelado' ? '' : 'Não foi possível enviar agora. Tente de novo com internet.';
  }
  if (aba === 'feedback') renderVista();
}

/* ---------- Folhas (modais) ---------- */
function blocoAfazeres() {
  const af = afazeresDoDia(W, S, cfg);
  if (!af.aberto) return '<p class="dica-t">Fora do expediente: os afazeres do dia aparecem quando a unidade abre.</p>';
  const ocupado = !!meuAgente().tarefa;
  return `<h2 class="secao">📋 Afazeres do dia (${af.feitos}/${af.total})</h2>${af.lista.map((i) => `<button class="btn" data-act="afazer" data-id="${i.uid}" ${i.feito || ocupado ? 'disabled' : ''}><span>${i.feito ? '✅' : i.ic} ${esc(i.rot)}</span>${i.feito ? '<small>feito</small>' : i.andamento ? '<small>em andamento</small>' : i.campo ? '<small>em campo</small>' : ''}</button>`).join('')}`;
}

/** Interações com os outros profissionais: ninguém faz nada sozinho. */
function blocoEquipe() {
  const eu = meuAgente();
  const colegas = W.agentes.filter((a) => a.k === 'staff' && a.id !== eu.id && a.vis);
  const reuniao = opcoesPara(W, S, cfg, colegas.length ? { tipo: 'agente', id: colegas[0].id } : { tipo: 'agente', id: eu.id }).find((o) => o.id === 'equipe_reuniao');
  const lista = colegas.map((b) => {
    const ops = opcoesPara(W, S, cfg, { tipo: 'agente', id: b.id }).filter((o) => o.id === 'colega_conversar' || o.id === 'colega_caso');
    const par = vinculosEquipe(S, cfg).find((x) => (x.a === eu.papel && x.b === b.papel) || (x.b === eu.papel && x.a === b.papel));
    const v = par ? par.v : 100;
    return `<div class="card eq"><div class="rotulo"><strong>${EMOJI_PAPEL[b.papel]} ${esc(cfg.papeis[b.papel].nome)}</strong><span>vínculo ${b.papel === eu.papel ? '—' : v + '%'}</span></div>
      <div class="dica-t">${esc(acaoAtual(W, S, b))}</div>
      <div class="c-btns" style="grid-template-columns:repeat(2,1fr);margin-top:6px">${ops.map((o) => `<button class="btn peq" data-act="equipe-op" data-op="${o.id}" data-id="${b.id}" ${o.desab ? 'disabled' : ''}>${o.ic} ${o.id === 'colega_caso' ? 'Discutir caso' : 'Conversar'}</button>`).join('')}</div>
      ${ops.some((o) => o.desab) ? `<div class="dica-t">${esc(ops.find((o) => o.desab).desab)}</div>` : ''}</div>`;
  }).join('');
  return `<h2 class="secao">🤝 Equipe (ninguém faz nada sozinho)</h2>
    <button class="btn" data-act="equipe-op" data-op="equipe_reuniao" data-id="${eu.id}" ${reuniao && reuniao.desab ? 'disabled' : ''}><span>👥 Convocar reunião de equipe</span>${reuniao && reuniao.desab ? `<small>${esc(reuniao.desab)}</small>` : ''}</button>
    ${lista || '<p class="dica-t">Nenhum colega na unidade agora.</p>'}`;
}

function folhaAcoes() {
  let corpo = '';
  if (modo() === 'paciente') {
    corpo = acoesPaciente(W, S, cfg).map((g) => `<h2 class="secao">${esc(g.nome)}</h2>${g.itens.map((i) => `<button class="btn" data-act="acao-op" data-op="${i.id}" ${i.desab ? 'disabled' : ''}><span>${i.ic} ${esc(i.rot)}</span>${i.desab ? `<small>${esc(i.desab)}</small>` : ''}</button>`).join('')}`).join('');
  } else if (papel() === 'acs') {
    corpo = `${blocoAfazeres()}${blocoEquipe()}<h2 class="secao">Visitas e orientações</h2><button class="btn" data-act="abrir-territorio"><span>🏘️ Visitar uma família</span></button>
      <button class="btn" data-act="abrir-pessoas"><span>🧑 Atender uma pessoa (aferir, orientar, convidar)</span></button>
      <button class="btn" data-act="cartao-mutirao"><span>🧹 Mutirão contra focos do mosquito</span></button>`;
  } else {
    corpo = `${blocoAfazeres()}${blocoEquipe()}<h2 class="secao">Atendimento</h2><button class="btn primario" data-act="prof-chamar-prox"><span>📣 Chamar o próximo da fila</span></button>
      <button class="btn" data-act="abrir-fila"><span>📋 Ver a fila e escolher quem chamar</span></button>
      <button class="btn" data-act="abrir-atend" ${atendimentoAtual(W, S) ? '' : 'disabled'}><span>🩺 Voltar ao atendimento atual</span></button>`;
  }
  return `<div class="folha-topo"><h2>🎬 ${modo() === 'paciente' ? 'O que você quer fazer?' : 'O que fazer agora?'}</h2><button class="fechar" data-act="fechar" aria-label="Fechar">✕</button></div>${corpo}`;
}

function folhaPessoas() {
  const a = meuAgente();
  const lista = W.agentes.filter((x) => x.k === 'res' && x.vis).map((x) => ({ x, d: Math.hypot(x.x - a.x, x.y - a.y) })).sort((p, q) => p.d - q.d);
  const itens = lista.map(({ x, d }) => { const p = achaPessoa(S, x.pid); return `<button class="pessoa" data-act="pessoa-menu" data-id="${x.id}"><span class="emoji">${emojiPessoa(p)}</span><span class="info"><div class="nome">${esc(p.nome)}</div><div class="sub">${p.idade} anos · ${esc(acaoAtual(W, S, x))} · ${Math.round(d)} passos</div></span><span aria-hidden="true">›</span></button>`; }).join('');
  return `<div class="folha-topo"><h2>🧑 Atender uma pessoa</h2><button class="fechar" data-act="fechar">✕</button></div>${itens || '<p class="vazio">Ninguém por perto.</p>'}`;
}

function folhaCenarios() {
  const cards = Object.entries(base.cenarios.cenarios).map(([id, c]) => `
    <div class="card cenario"><div class="rotulo"><strong>${c.icone} ${esc(c.nome)}</strong></div>
      <p class="dica-t" style="margin:2px 0 6px">${esc(c.resumo)}</p>
      <ul class="lista">${c.desafios.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      <button class="btn primario" style="margin-top:10px" data-act="cenario" data-id="${id}"><span>Escolher este cenário</span></button></div>`).join('');
  return `<div class="folha-topo"><h2>Onde será a sua história?</h2>${S && S.jogador ? '<button class="fechar" data-act="fechar" aria-label="Fechar">✕</button>' : ''}</div>
    <p class="dica-t" style="margin:0 0 10px">O mesmo jogo, realidades diferentes. ${S && S.jogador ? '<b>Atenção: começar outra história apaga o progresso atual.</b>' : ''}</p>${cards}`;
}

function folhaPersonagem() {
  const troca0 = !!(folha && folha.troca);
  const atualK = S.jogador ? chaveDe(S.jogador) : null;
  const estadoVida = (k) => (!troca0 ? { t: 'novo' } : k === atualK ? { t: 'atual', dias: diasDeVida(S) } : arquivo.itens[k] ? { t: 'arq', dias: diasDeVida(arquivo.itens[k]) } : { t: 'novo' });
  const selo = (e) => (e.t === 'atual' ? `<div class="vida atual">● Em jogo agora · dia ${e.dias}</div>` : e.t === 'arq' ? `<div class="vida arq">📁 Vida arquivada · dia ${e.dias} (continua de onde parou)</div>` : (troca0 ? '<div class="vida">✨ Vida nova</div>' : ''));
  const botaoReiniciar = (k, e) => (troca0 && e.t !== 'novo' ? `<button class="btn peq" style="margin-top:6px" data-act="pers-reiniciar" data-id="${k}">${confirmaReinicio === k ? '⚠️ Toque de novo para apagar e recomeçar' : '🔄 Recomeçar esta vida do zero'}</button>` : '');
  const rotuloBotao = (e, nome, papelTxt) => (e.t === 'atual' ? 'Continuar com este personagem' : e.t === 'arq' ? `Continuar a vida de ${nome}` : papelTxt);
  const pac = todasPessoas(S).map((p) => { const k = `p:${p.id}`, e = estadoVida(k); return `
    <div class="card pers"><div class="c-topo"><span class="emoji">${emojiPessoa(p)}</span>
      <div class="c-id"><b>${esc(p.nome)}</b> <small>${p.idade} anos</small><div class="tags">${dicasDe(p).map((d) => `<span class="selo">${esc(d)}</span>`).join('')}</div></div></div>
      ${selo(e)}<button class="btn primario" style="margin-top:8px" data-act="pers-paciente" data-id="${p.id}"><span>${esc(rotuloBotao(e, p.nome.split(' ').pop(), `Viver a história de ${p.nome.split(' ').pop()}`))}</span></button>${botaoReiniciar(k, e)}</div>`; }).join('');
  const mundo = cfg.cenario.mundo;
  const dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
  const prof = PAPEIS.map((id) => {
    const r = cfg.papeis[id], k = `f:${id}`, e = estadoVida(k);
    const extra = id === 'medico' && mundo.medicoDias.length < 5 ? `<li>Neste cenário você atende só ${mundo.medicoDias.map((d) => dias[d]).join(' e ')}</li>` : '';
    return `<div class="card pers"><div class="c-topo"><span class="emoji">${r.icone}</span><div class="c-id"><b>${esc(r.nome)}</b></div></div>
      <p class="dica-t" style="margin:6px 0">${esc(r.resumo)}</p><ul class="lista">${r.desafios.map((d) => `<li>${esc(d)}</li>`).join('')}${extra}</ul>
      ${selo(e)}<button class="btn primario" style="margin-top:8px" data-act="pers-prof" data-id="${id}"><span>${esc(rotuloBotao(e, r.nome.toLowerCase(), `Trabalhar como ${r.nome.toLowerCase()}`))}</span></button>${botaoReiniciar(k, e)}</div>`;
  }).join('');
  const troca = !!(folha && folha.troca);
  return `<div class="folha-topo"><h2>${troca ? 'Trocar de personagem' : 'Quem você será?'}</h2>${troca ? '<button class="fechar" data-act="fechar" aria-label="Fechar">✕</button>' : ''}</div>
    <p class="dica-t" style="margin:0 0 8px">${troca ? '<b>Cada personagem é uma vida independente</b>, com o seu próprio mundo, diário e progresso. Ao trocar, a vida atual fica arquivada e só continua se você voltar a ela. ' : ''}Você joga com <b>um único personagem</b> e vive o que ele viver. As doenças de cada pessoa são <b>surpresa</b>.</p>
    <div class="abas-pers"><button class="${abaPers === 'paciente' ? 'on' : ''}" data-act="pers-aba" data-id="paciente">🧑 Paciente</button><button class="${abaPers === 'profissional' ? 'on' : ''}" data-act="pers-aba" data-id="profissional">🩺 Profissional</button></div>
    ${abaPers === 'paciente' ? pac : prof}
    ${troca ? '' : '<button class="btn" style="margin-top:12px" data-act="sortear"><span>🎲 Sortear outro bairro</span></button>'}
    <button class="btn" ${troca ? 'style="margin-top:12px"' : ''} data-act="trocar-cenario"><span>‹ Trocar de cenário ${troca ? '(começa uma nova história)' : ''}</span></button>`;
}

function folhaMenu() {
  const lis = menu.ops.length ? menu.ops.map((o) => `<button class="btn" data-act="menu-op" data-op="${o.id}" ${o.desab ? 'disabled' : ''}><span>${o.ic} ${esc(o.rot)}</span>${o.desab ? `<small>${esc(o.desab)}</small>` : ''}</button>`).join('') : '<p class="vazio">Nada para fazer aqui.</p>';
  return `<div class="folha-topo"><h2>${esc(menu.titulo)}</h2><button class="fechar" data-act="menu-fechar" aria-label="Fechar">✕</button></div>${lis}`;
}

function conhecidoDe(p) {
  const c = p.conhecido;
  let medidas = '<p class="dica-t">Sem medidas ainda.</p>';
  if (c.medidas) { const q = S.turno - c.medidasTurno; medidas = `<div class="kv"><span>Pressão arterial</span><span>${c.medidas.pas}/${c.medidas.pad} mmHg</span><span>Glicemia</span><span>${c.medidas.glic} mg/dL</span><span>Medido</span><span>${q === 0 ? 'neste mês' : `há ${q} mês(es)`}</span></div>`; }
  let hab = '<p class="dica-t">Hábitos ainda não conhecidos.</p>';
  if (c.habitos) { const h = c.habitos; hab = `${linhaHabito('Atividade física', h.atividade)}${linhaHabito('Alimentação', h.alimentacao)}${linhaHabito('Sono', h.sono)}${linhaHabito('Estresse (menos é melhor)', h.estresse, true)}<div class="kv" style="margin-top:6px"><span>Fuma</span><span>${h.tabagismo ? 'Sim' : 'Não'}</span></div>`; }
  return `<div class="tags" style="margin:0 0 8px">${tagsPessoa(p)}${c.risco.map((r) => `<span class="selo warn">${cfg.cond[r].icone} risco: ${esc(cfg.cond[r].nome)}</span>`).join('')}</div>
    <div class="card">${medidas}</div><div class="card" style="margin-top:8px">${hab}</div>`;
}

function folhaAtendimento() {
  const at = atendimentoAtual(W, S);
  if (!at) return '<div class="folha-topo"><h2>Atendimento</h2><button class="fechar" data-act="fechar">✕</button></div><p class="vazio">Nenhum atendimento em andamento.</p>';
  const p = achaPessoa(S, at.pid);
  const nomeServ = { triagem: 'Triagem', enfermagem: 'Consulta de enfermagem', consulta: 'Consulta médica' }[at.tipo];
  let corpo = '';
  if (at.fase === 'chamando') corpo = '<p class="vazio">⏳ Aguardando a pessoa chegar…</p>';
  if (at.fase === 'atendendo') corpo = '<p class="vazio">🩺 Atendendo… (o tempo continua correndo)</p>';
  if (at.fase === 'pronto') {
    if (at.tipo === 'triagem') corpo = '<button class="btn primario" data-act="atender"><span>📏 Aferir PA, glicemia e peso</span><small>10 min</small></button>';
    else if (at.tipo === 'enfermagem') corpo = `<p class="dica-t">Escolha o foco da orientação (ou deixe automático):</p><button class="btn primario" data-act="atender"><span>🩺 Consulta de enfermagem (foco automático)</span><small>25 min</small></button>${Object.entries(FOCOS).filter(([k]) => k !== 'fumo' || p.tabagismo).map(([k, nome]) => `<button class="btn" data-act="atender" data-foco="${k}"><span>Foco: ${esc(nome)}</span></button>`).join('')}`;
    else corpo = '<button class="btn primario" data-act="atender"><span>🩺 Consulta médica</span><small>30 min</small></button>';
  }
  if (at.fase === 'resultado') {
    corpo = `<div class="card"><strong>Resultado</strong><p style="margin-top:4px">${esc(at.resultado || '')}</p></div>`;
    if (at.tipo === 'consulta') {
      corpo += CONDS.filter((id) => p.cond[id].diag).map((id) => `<button class="btn ${p.cond[id].trat ? '' : 'primario'}" data-act="tratar" data-id="${p.id}" data-cond="${id}" data-ligar="${p.cond[id].trat ? 0 : 1}"><span>${cfg.cond[id].icone} ${esc(cfg.cond[id].nome)}: ${p.cond[id].trat ? 'suspender tratamento' : 'iniciar tratamento'}</span><small>💊 1/mês</small></button>`).join('');
      corpo += '<button class="btn primario" style="margin-top:8px" data-act="concluir" data-destino="liberar"><span>✔ Concluir atendimento</span></button>';
    } else {
      corpo += '<p class="dica-t">Para onde encaminhar?</p>';
      if (at.tipo === 'triagem') corpo += '<button class="btn" data-act="concluir" data-destino="enfermagem"><span>🩺 Consulta de enfermagem</span></button>';
      corpo += '<button class="btn" data-act="concluir" data-destino="consulta"><span>🩺 Consulta médica</span></button><button class="btn primario" data-act="concluir" data-destino="liberar"><span>✔ Liberar com orientações</span></button>';
    }
  }
  return `<div class="folha-topo"><h2>${nomeServ}</h2><button class="fechar" data-act="fechar" aria-label="Fechar">✕</button></div>
    <div class="c-topo" style="margin-bottom:8px"><span class="emoji">${emojiPessoa(p)}</span><div class="c-id"><b>${esc(p.nome)}</b> <small>${p.idade} anos</small></div></div>
    ${corpo}<h2 class="secao">O que se sabe</h2>${conhecidoDe(p)}`;
}

function folhaFila() {
  const servico = papel() === 'tecnico' ? 'triagem' : papel() === 'enfermeiro' ? 'enfermagem' : 'consulta';
  const l = filaEspera(W, servico);
  const itens = l.length ? l.map((o) => { const p = achaPessoa(S, o.pid); return `<div class="pessoa"><span class="emoji">${emojiPessoa(p)}</span><span class="info"><div class="nome">${esc(p.nome)}</div><div class="sub">${p.idade} anos · aguarda há ${Math.round(S.mundo.min - o.t0)} min</div></span><button class="btn peq" style="width:auto" data-act="chamar" data-id="${p.id}">Chamar</button></div>`; }).join('') : '<p class="vazio">Ninguém na sua fila.</p>';
  return `<div class="folha-topo"><h2>📋 Fila de espera</h2><button class="fechar" data-act="fechar">✕</button></div>${itens}`;
}

function folhaTerritorio() {
  const itens = S.familias.map((f) => {
    const r = f.pessoas.some((p) => p.conhecido.suspeitas.length || CONDS.some((id) => p.cond[id].diag && !p.cond[id].trat)) ? '<span class="selo warn">⚠ atenção</span>' : '';
    return `<div class="pessoa"><span class="emoji">🏠</span><span class="info"><div class="nome">${esc(f.nome)}</div><div class="sub">vínculo ${Math.round(f.vinculo)}% · ${f.visTurno === S.turno ? 'visitada neste mês' : 'sem visita neste mês'}</div><div class="tags">${r}</div></span><button class="btn peq" style="width:auto" data-act="visitar" data-id="${f.id}" ${f.visTurno === S.turno ? 'disabled' : ''}>Visitar</button></div>`;
  }).join('');
  return `<div class="folha-topo"><h2>🏘️ Minhas famílias</h2><button class="fechar" data-act="fechar">✕</button></div>${itens}
    <p class="dica-t">Tocar numa pessoa no mapa permite aferir a pressão, orientar e convidar para a unidade.</p>`;
}

function folhaRelatorio() {
  let itens = W.relatorio || [];
  let extra = '';
  if (modo() === 'paciente') {
    const p = minhaPessoa();
    itens = itens.filter((e) => e.pessoaId === p.id || e.tipo === 'aprendizado');
    const mes = S.diario.filter((e) => e.mes === ((S.mes + 11) % 12) && (e.pessoaId === p.id || e.familiaId === p.familiaId));
    const h = p.habitos;
    extra = `<div class="card"><strong>Seu estilo de vida agora</strong>${p.idade >= 12 ? `${linhaHabito('Atividade física', h.atividade)}${linhaHabito('Alimentação', h.alimentacao)}${linhaHabito('Sono', h.sono)}${linhaHabito('Estresse (menos é melhor)', h.estresse, true)}` : ''}</div>`;
    itens = [...mes.map((e) => ({ tipo: e.tipo, texto: e.texto })), ...itens];
  } else {
    const i = indicadores(S, cfg);
    extra = `<div class="card"><div class="rotulo"><span>Liga da unidade</span><span>🏅 ${i.liga}</span></div></div>`;
  }
  const lis = itens.length ? itens.map((e) => `<div class="entrada ${e.tipo}">${esc(e.texto)}</div>`).join('') : '<p class="vazio">Mês tranquilo: nada de especial aconteceu.</p>';
  return `<div class="folha-topo"><h2>📋 ${modo() === 'paciente' ? 'Seu mês' : 'Relatório do mês'}</h2><button class="fechar" data-act="fechar" aria-label="Fechar">✕</button></div>
    <p class="dica-t" style="margin:0 0 10px">Começou ${esc(rotuloData(S))}. O jogo está em pausa até você continuar.</p>${extra}${lis}
    <button class="btn primario" style="margin-top:14px" data-act="fechar"><span>Continuar</span></button>`;
}

function folhaIntro() {
  const paciente = modo() === 'paciente';
  const passos = paciente ? `
    <div class="p"><span class="passo">1</span><div><b>Você é ${esc(minhaPessoa().nome)}</b><br>Veja as necessidades (fome, energia, humor…) no painel. Seus hábitos de verdade decidem sua saúde.</div></div>
    <div class="p"><span class="passo">2</span><div><b>Dê ordens</b><br>Toque numa cama, sofá, fogão, chuveiro ou no chão. Com a <i>vontade própria</i> ligada, ele segue a rotina quando você não manda nada.</div></div>
    <div class="p"><span class="passo">3</span><div><b>Cuide da saúde</b><br>Sentiu algo? Procure a unidade (tocando nos móveis dela). Se houver tratamento, tome o remédio todo dia.</div></div>
    <div class="p"><span class="passo">4</span><div><b>Surpresas</b><br>Doenças podem aparecer sem sintoma. Medir a pressão e a glicemia ajuda a descobrir cedo.</div></div>`
    : `
    <div class="p"><span class="passo">1</span><div><b>Você é ${esc(cfg.papeis[papel()].nome.toLowerCase())}</b><br>${esc(cfg.papeis[papel()].resumo)}</div></div>
    <div class="p"><span class="passo">2</span><div><b>${papel() === 'acs' ? 'Percorra o território' : 'Atenda a fila'}</b><br>${papel() === 'acs' ? 'Toque numa pessoa para aferir, orientar ou convidar; toque numa casa para visitar a família.' : 'Toque numa pessoa sentada na espera (⏳) para chamar. Depois escolha o atendimento e o encaminhamento.'}</div></div>
    <div class="p"><span class="passo">3</span><div><b>A equipe trabalha sozinha</b><br>Os outros profissionais agem por conta própria. Você não controla ninguém além do seu personagem.</div></div>
    <div class="p"><span class="passo">4</span><div><b>Resultados</b><br>No fim de cada mês você recebe um relatório. A aba Desempenho mostra a qualidade da unidade.</div></div>`;
  return `<div class="folha-topo"><h2>Como jogar</h2></div>
    <div class="card passos">${passos}</div>
    <p class="dica-t">⏸ 1× 3× 8× controlam o tempo (devagar no expediente, mais rápido à noite). <b>?</b> abre esta ajuda de novo.</p>
    <p class="aviso">Jogo educativo. Não substitui avaliação, diagnóstico ou tratamento por profissionais de saúde.</p>
    <button class="btn primario" style="margin-top:12px" data-act="comecar"><span>Entendi, vamos jogar!</span></button>`;
}

function folhaSobre() {
  return `<div class="folha-topo"><h2>Sobre</h2><button class="fechar" data-act="fechar" aria-label="Fechar">✕</button></div>
    <div class="card"><p>Saudedavida - SV · protótipo v0.8 — simulação simplificada de uma unidade básica de saúde, com mundo em tempo real e um único personagem controlado. As regras ficam em <code>data/*.json</code>; as fontes clínicas estão listadas lá e <b>precisam de validação por consultoria clínica</b>.</p>
    <p class="dica-t">Fora do escopo: óbitos, gestação, puericultura, vacinação, outras doenças e papéis de gestão.</p></div>
    <p class="aviso">Jogo educativo. Não substitui avaliação, diagnóstico ou tratamento por profissionais de saúde.</p>
    <div class="card" style="margin-top:10px"><p>Gráficos: <b>${R && R.modo === '3d' ? '3D' : '2D simples'}</b>${R && R.motivo ? ' <span class="dica-t">(' + R.motivo + ')</span>' : ''}</p>
    <button class="btn" style="margin-top:8px" data-act="trocar-grafico"><span>${R && R.modo === '3d' ? 'Usar modo 2D simples' : 'Tentar o 3D de novo'}</span></button></div>
    <button class="btn" style="margin-top:10px" data-act="trocar-personagem"><span>👥 Trocar de personagem (cada um tem a sua vida)</span></button>
    <button class="btn perigo" style="margin-top:14px" data-act="trocar-cenario"><span>🔁 Nova história / trocar de cenário</span></button>`;
}

function renderFolha() {
  const host = $('#folha-host');
  if (!folha) { host.innerHTML = ''; return; }
  const corpo = { acoes: folhaAcoes, pessoas: folhaPessoas, cenarios: folhaCenarios, personagem: folhaPersonagem, menu: folhaMenu, atendimento: folhaAtendimento, fila: folhaFila, territorio: folhaTerritorio, relatorio: folhaRelatorio, intro: folhaIntro, sobre: folhaSobre }[folha.tipo]();
  const scroll = document.querySelector('.folha')?.scrollTop ?? 0;
  const leve = folha.tipo === 'menu' ? ' leve' : '';
  host.innerHTML = `<div class="fundo${leve}" data-act="fundo"><div class="folha${folha.tipo === 'menu' ? ' menu-op' : ''}" role="dialog" aria-modal="true">${corpo}</div></div>`;
  const nova = document.querySelector('.folha');
  if (nova) nova.scrollTop = scroll;
}
function abrirFolha(f) { folha = f; renderFolha(); atualizaDica(); }
function fecharFolha() {
  const tipo = folha && folha.tipo, troca = !!(folha && folha.troca);
  folha = null; menu = null;
  renderFolha();
  if (tipo === 'relatorio' || tipo === 'intro' || troca) vel = velAntes || 1;
}

function mostraAba(id) {
  aba = id;
  const mundo = id === 'mundo';
  $('#mundo').hidden = !mundo;
  $('#vista').hidden = mundo;
  if (!mundo) renderVista(); else { R.redimensiona(); montaPainel(true); }
  atualizaTopo(); atualizaDica();
}

/* ---------- Jogo ---------- */
function novoCenario(id) {
  cfg = montarCfg(base, id);
  S = newGame(cfg);
  S.tempoReal = true;
  iniciarEstadoMundo(S);
  arquivo = { cen: id, seed: S.seed, itens: {} }; gravaArquivo();
  W = null;
  document.body.classList.add('sem-jogo');
  abaPers = 'paciente';
  abrirFolha({ tipo: 'personagem' });
}
function sortearBairro() { novoCenario(cfg.cenario.id); }

/** Entra numa vida (S2 já pronto): reconstrói o mundo e atualiza a tela. */
function ativaVida(s2, aviso) {
  S = s2; W = criarMundo(S, cfg);
  folha = null; menu = null; renderFolha();
  vel = velAntes || 1; jaDeuOrdem = false; assinaturaCartao = ''; ultimaChaveAtend = ''; confirmaReinicio = null;
  montaTopo(); montaRodape();
  const a = meuAgente();
  R.selecionar(a.id); S.jogador.seguir = true;
  mostraAba('mundo');
  salvar(); gravaArquivo();
  R.enquadrarUBS(); R.seguirAlvo(a.x, a.y, 1);
  if (aviso) toast(aviso, true);
}

/** Troca de personagem: a vida atual fica arquivada (intacta) e só volta se o jogador retornar a ela. */
function trocaPersonagemJogo(escolha) {
  const nova = chaveDe(escolha), atual = S.jogador ? chaveDe(S.jogador) : null;
  if (nova === atual) { fecharFolha(); return; }
  if (atual) arquivo.itens[atual] = S;
  const guardada = arquivo.itens[nova];
  delete arquivo.itens[nova];
  const nome = escolha.modo === 'paciente' ? achaPessoa(S, escolha.pid).nome : cfg.papeis[escolha.papel].nome;
  ativaVida(guardada || novaVida(escolha), guardada ? `Você voltou à vida de ${nome} (dia ${diasDeVida(S)}).` : `Nova vida: ${nome}. A vida anterior ficou arquivada.`);
}

function reiniciarVida(chave) {
  delete arquivo.itens[chave];
  confirmaReinicio = null;
  if (S.jogador && chaveDe(S.jogador) === chave) { const e = S.jogador.modo === 'paciente' ? { modo: 'paciente', pid: S.jogador.pid } : { modo: 'profissional', papel: S.jogador.papel }; ativaVida(novaVida(e), 'Vida recomeçada do zero.'); }
  else { gravaArquivo(); renderFolha(); toast('Vida arquivada apagada.', true); }
}

function comecarComPersonagem(escolha) {
  escolherPersonagem(S, escolha);
  arquivo = { cen: cfg.cenario.id, seed: S.seed, itens: {} }; gravaArquivo();
  W = criarMundo(S, cfg);
  document.body.classList.remove('sem-jogo');
  jaDeuOrdem = false; vel = 1; velAntes = 1; assinaturaCartao = ''; ultimaChaveAtend = '';
  montaTopo(); montaRodape();
  const a = meuAgente();
  R.selecionar(a.id);
  R.enquadrarUBS();
  salvar();
  mostraAba('mundo');
  menu = null;
  if (!jaViuIntro()) { vel = 0; abrirFolha({ tipo: 'intro' }); } else { folha = null; renderFolha(); }
  setTimeout(() => R.seguirAlvo(a.x, a.y, 1), 0);
}

function aoVirarMes() {
  velAntes = vel || 1;
  vel = 0;
  salvar();
  abrirFolha({ tipo: 'relatorio' });
  if (aba !== 'mundo') renderVista();
}

function resultado(r) {
  toast(r.msg, r.ok);
  if (r.ok) jaDeuOrdem = true;
  salvar();
  assinaturaCartao = '';
  montaPainel(true);
  if (aba !== 'mundo') renderVista();
}

function nomeObjeto(o) { return o.t === 'casa' ? 'Casa' : cfg.objetos[o.t] ? cfg.objetos[o.t].nome : 'Objeto'; }

/** Toque no mapa: monta o menu de ações do que foi tocado. */
function aoTocar(alvo) {
  if (!S || !W || folha) return;
  if (!alvo) { return; }
  let titulo = '', a = alvo;
  if (alvo.tipo === 'agente') {
    const ag = W.agentes.find((x) => x.id === alvo.id);
    if (!ag) return;
    if (ag.jogador) { if (modo() === 'paciente') mostraAba('saude'); return; }
    if (ag.k === 'staff') {
      if (modo() === 'paciente') { toast(`${cfg.papeis[ag.papel].nome}: ${acaoAtual(W, S, ag)}`, true); return; }
      titulo = `${EMOJI_PAPEL[ag.papel]} ${cfg.papeis[ag.papel].nome} · ${acaoAtual(W, S, ag).replace(/^[^\s]+\s/, '')}`;
    } else {
      const p = achaPessoa(S, ag.pid);
      titulo = `${emojiPessoa(p)} ${p.nome}`;
      if (modo() === 'paciente') titulo += ` · ${acaoAtual(W, S, ag).replace(/^[^\s]+\s/, '')}`;
    }
  } else if (alvo.tipo === 'obj') {
    titulo = nomeObjeto(alvo.obj);
  } else {
    if (alvo.casa) { a = { tipo: 'obj', obj: { t: 'casa', casa: alvo.casa } }; titulo = 'Casa'; }
    else titulo = alvo.lugar === 'ubs' ? 'Unidade de saúde' : 'Ir até aqui';
  }
  let ops = opcoesPara(W, S, cfg, a);
  if (a.tipo === 'obj' && a.obj.t === 'casa' && modo() === 'paciente' && !ops.length) ops = [{ id: 'ir', rot: 'Ir até aqui', ic: '📍', desab: null }];
  if (!ops.length) { toast(`${titulo}: nada a fazer`, true); return; }
  menu = { titulo, ops, alvo: a, chao: alvo.tipo === 'chao' ? alvo : null };
  abrirFolha({ tipo: 'menu' });
}

function menuUnidade() {
  const obj = (W.porTipo.U || [])[0];
  const alvo = { tipo: 'obj', obj };
  const ops = opcoesPara(W, S, cfg, alvo);
  menu = { titulo: '🏥 Unidade de saúde', ops, alvo };
  abrirFolha({ tipo: 'menu' });
}

/* ---------- Eventos ---------- */
// Navegação livre pelo cenário (computador): setas/WASD movem, +/- zoom, Q/E giram, H oculta a barra de ações.
document.addEventListener('keydown', (ev) => {
  if (!S || !W || aba !== 'mundo' || folha || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const t = ev.target && ev.target.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA') return;
  const k = ev.key.toLowerCase();
  const passo = ev.shiftKey ? 2.4 : 0.9;
  const mexe = (dx, dy) => { S.jogador.seguir = false; R.mover(dx, dy); ev.preventDefault(); };
  if (k === 'arrowleft' || k === 'a') mexe(-passo, 0);
  else if (k === 'arrowright' || k === 'd') mexe(passo, 0);
  else if (k === 'arrowup' || k === 'w') mexe(0, passo);
  else if (k === 'arrowdown' || k === 's') mexe(0, -passo);
  else if (k === '+' || k === '=') R.zoom(1.15);
  else if (k === '-' || k === '_') R.zoom(0.87);
  else if (k === 'q') R.girar(1);
  else if (k === 'e') R.girar(-1);
  else if (k === 'h') document.querySelector('[data-act="painel"]').click();
  else if (k === 'c') document.querySelector('[data-act="centro"]').click();
});
document.addEventListener('input', (ev) => {
  const id = ev.target && ev.target.dataset && ev.target.dataset.fb;
  if (id) { fbResp[id] = ev.target.value; salvaRascunhoFb(); }
});
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  if (act === 'fundo') { if (ev.target === el && folha && ['menu', 'fila', 'territorio', 'atendimento', 'sobre', 'acoes', 'pessoas'].includes(folha.tipo)) fecharFolha(); return; }
  if (!S && !['cenario'].includes(act)) return;
  if (['aba', 'fechar'].includes(act)) limpaToast();
  switch (act) {
    case 'aba': mostraAba(id); break;
    case 'fb-op': { const p = PERGUNTAS.find((q) => q.id === id); const v = p.tipo === 'estrelas' ? Number(el.dataset.v) : el.dataset.v; fbResp[id] = fbResp[id] === v ? undefined : v; salvaRascunhoFb(); renderVista(); break; }
    case 'fb-enviar': enviaFeedbackAgora(); break;
    case 'fb-novo': fbEstado = 'editando'; fbMsg = ''; renderVista(); break;
    case 'vel': vel = Number(el.dataset.v); atualizaTopo(); break;
    case 'pular-dia': { const v0 = vel; if (pularDia(W, S, cfg)) { velAntes = v0 || 1; aoVirarMes(); } atualizaTopo(); break; }
    case 'pular': { const v0 = vel; if (pularMes(W, S, cfg)) { velAntes = v0 || 1; aoVirarMes(); } atualizaTopo(); break; }
    case 'girar-dir': case 'girar-esq':
      if (R.modo !== '3d') { if (window.__sem3d) tentar3DAgora(); else toast('Girar a câmera só funciona no modo 3D.', false); break; }
      R.girar(act === 'girar-dir' ? -1 : 1); break;
    case 'paredes': { const b = R.alternaParedes(); toast(b ? 'Paredes abaixadas' : 'Paredes recortadas', true); break; }
    case 'centro': { S.jogador.seguir = true; const a = meuAgente(); R.seguirAlvo(a.x, a.y, 1); break; }
    case 'fechar': fecharFolha(); break;
    case 'menu-fechar': fecharFolha(); break;
    case 'menu-op': {
      const alvo = menu.alvo, chao = menu.chao;
      const r = comandar(W, S, cfg, el.dataset.op, alvo);
      if (el.dataset.op === 'ir' || el.dataset.op === 'caminhar') { const c = chao || alvo; if (c && c.x !== undefined) R.marcar(c.x, c.y); }
      fecharFolha(); resultado(r); break;
    }
    case 'cartao-cancelar': cancelarFila(W, S); R.marcar(null); assinaturaCartao = ''; montaPainel(true); toast('Ordens canceladas', true); break;
    case 'cartao-vontade': { const v = alternaVontade(S); toast(v ? 'Vontade própria ligada: ele segue a rotina quando está livre' : 'Vontade própria desligada: ele só faz o que você mandar', true); assinaturaCartao = ''; montaPainel(true); break; }
    case 'cartao-unidade': menuUnidade(); break;
    case 'cartao-remedio': { const g = W.objs.find((o) => o.t === 'G' && o.casa === minhaPessoa().familiaId); resultado(comandar(W, S, cfg, 'remedio', { tipo: 'obj', obj: g })); break; }
    case 'cartao-fumar': { const ag = meuAgente(); ag.fila.push({ k: 'acao', acao: 'fumar' }); resultado({ ok: true, msg: 'Ele vai fumar lá fora. (Fumar aumenta o risco de várias doenças.)' }); break; }
    case 'cartao-mutirao': resultado(comandar(W, S, cfg, 'mutirao', { tipo: 'chao', x: 0, y: 0, rua: true })); break;
    case 'abrir-acoes': abrirFolha({ tipo: 'acoes' }); break;
    case 'abrir-pessoas': abrirFolha({ tipo: 'pessoas' }); break;
    case 'pessoa-menu': { const ag = W.agentes.find((x) => x.id === id); const p = achaPessoa(S, ag.pid); menu = { titulo: `${emojiPessoa(p)} ${p.nome}`, ops: opcoesPara(W, S, cfg, { tipo: 'agente', id }), alvo: { tipo: 'agente', id } }; abrirFolha({ tipo: 'menu' }); break; }
    case 'prof-chamar-prox': { const r = comandar(W, S, cfg, 'chamar_proximo', { tipo: 'auto' }); fecharFolha(); resultado(r); break; }
    case 'acao-op': {
      const op = el.dataset.op;
      const r = comandar(W, S, cfg, op, { tipo: 'auto' });
      const a = meuAgente();
      if (r.ok) {
        if (op === 'ir_casa') { const q = W.casas[minhaPessoa().familiaId].porta.dentro; R.marcar(q.x, q.y); }
        else if (op === 'ir_ubs') { R.marcar(W.ubs.porta.fora.x, W.ubs.porta.fora.y); }
        else if (op === 'ir_praca') { const r2 = (W.porTipo.K || W.porTipo.P || [])[0]; if (r2) R.marcar(r2.x, r2.y + 1); }
        S.jogador.seguir = true;
      }
      void a;
      fecharFolha(); resultado(r); break;
    }
    case 'abrir-fila': abrirFolha({ tipo: 'fila' }); break;
    case 'abrir-territorio': abrirFolha({ tipo: 'territorio' }); break;
    case 'abrir-atend': abrirFolha({ tipo: 'atendimento' }); break;
    case 'visitar': resultado(comandar(W, S, cfg, 'acs_visita', { tipo: 'obj', obj: { t: 'casa', casa: id } })); fecharFolha(); break;
    case 'chamar': { const r = comandar(W, S, cfg, 'chamar', { tipo: 'agente', id }); fecharFolha(); resultado(r); break; }
    case 'atender': { const r = iniciarAtendimento(W, S, cfg, { foco: el.dataset.foco }); renderFolha(); resultado(r); break; }
    case 'tratar': { const r = acaoTratamento(S, cfg, id, el.dataset.cond, el.dataset.ligar === '1'); renderFolha(); toast(r.msg, r.ok); break; }
    case 'concluir': { const r = finalizarAtendimento(W, S, cfg, el.dataset.destino); fecharFolha(); resultado(r); break; }
    case 'sobre': abrirFolha({ tipo: 'sobre' }); break;
    case 'trocar-grafico': {
      if (R && R.modo !== '3d' && window.__sem3d) { tentar3DAgora(); break; }
      try { if (R && R.modo === '3d') localStorage.setItem('saude-sim-3d', 'travou'); else localStorage.removeItem('saude-sim-3d'); } catch (e) { /* ok */ }
      salvar(); location.reload(); break;
    }
    case 'ajuda': velAntes = vel || 1; abrirFolha({ tipo: 'intro' }); break;
    case 'comecar': marcaIntro(); fecharFolha(); break;
    case 'trocar-cenario': abrirFolha({ tipo: 'cenarios' }); break;
    case 'cenario': novoCenario(id); break;
    case 'sortear': sortearBairro(); break;
    case 'pers-aba': abaPers = id; renderFolha(); break;
    case 'pers-paciente': (folha && folha.troca ? trocaPersonagemJogo : comecarComPersonagem)({ modo: 'paciente', pid: id }); break;
    case 'pers-prof': (folha && folha.troca ? trocaPersonagemJogo : comecarComPersonagem)({ modo: 'profissional', papel: id }); break;
    case 'pers-reiniciar': if (confirmaReinicio === id) reiniciarVida(id); else { confirmaReinicio = id; renderFolha(); } break;
    case 'trocar-personagem': velAntes = vel || velAntes || 1; vel = 0; abaPers = modo() === 'paciente' ? 'paciente' : 'profissional'; abrirFolha({ tipo: 'personagem', troca: true }); break;
    case 'equipe-op': { const r = comandar(W, S, cfg, el.dataset.op, { tipo: 'agente', id }); fecharFolha(); resultado(r); break; }
    case 'painel': { painelOculto = !painelOculto; const b = $('#b-painel'); if (b) { b.textContent = painelOculto ? '🔼' : '🔽'; b.setAttribute('aria-label', painelOculto ? 'Mostrar a barra de ações' : 'Ocultar a barra de ações'); } assinaturaCartao = ''; montaPainel(true); atualizaDica(); break; }
    case 'zoom-mais': R.zoom(1.25); break;
    case 'zoom-menos': R.zoom(0.8); break;
    case 'afazer': { const r = comandar(W, S, cfg, `afazer:${id}`, { tipo: 'auto' }); fecharFolha(); resultado(r); break; }
    default: break;
  }
});

/* ---------- Laço principal ---------- */
let ultimo = 0, ultimoUI = 0, ultimoSave = 0;
function quadro(t) {
  try {
    const dt = Math.min(0.1, (t - ultimo) / 1000);
    ultimo = t;
    if (S && W && S.jogador) {
      const pausado = folha && ['relatorio', 'intro', 'cenarios', 'personagem'].includes(folha.tipo);
      if (vel > 0 && !pausado) { if (passoMundo(W, S, cfg, dt * vel * minutosPorSegundo(S))) aoVirarMes(); }
      const a = meuAgente();
      if (aba === 'mundo') { if (S.jogador.seguir && a && a.vis) R.seguirAlvo(a.x, a.y, 0.1); R.desenha(t); if (R.modo === '3d' && ++window.__quadros3d === 60) { try { localStorage.setItem('saude-sim-3d', 'ok'); } catch (e) { /* ok */ } } }
      if (t - ultimoUI > 250) {
        ultimoUI = t;
        atualizaTopo(); atualizaPainel(); atualizaDica();
        if (W.msgs.length) { const m = W.msgs[W.msgs.length - 1]; W.msgs.length = 0; toast(m.texto, m.tipo !== 'alerta'); }
        if (aba === 'mundo') montaPainel(false);
        // atendimento do profissional: abre sozinho quando precisa de decisão
        if (clinico()) {
          const at = atendimentoAtual(W, S);
          const chave = at ? `${at.pid}${at.fase}` : '';
          if (chave !== ultimaChaveAtend) {
            ultimaChaveAtend = chave;
            if (at && (at.fase === 'pronto' || at.fase === 'resultado')) abrirFolha({ tipo: 'atendimento' });
            else if (folha && folha.tipo === 'atendimento') { if (at) renderFolha(); else fecharFolha(); }
          }
        }
      }
      if (t - ultimoSave > 8000) { ultimoSave = t; salvar(); }
    }
    errosSeguidos = 0;
  } catch (e) {
    errosSeguidos++;
    if (errosSeguidos === 3) telaErro(`${e && e.stack ? e.stack : e}`);
  }
  requestAnimationFrame(quadro);
}

/* ---------- Inicialização ---------- */
async function carregarBase() {
  const [game, cond, cenarios] = await Promise.all(['game', 'conditions', 'cenarios'].map((n) => fetch(`data/${n}.json`).then((r) => r.json())));
  return { game, cond, cenarios };
}

// Tenta o 3D; se faltar WebGL/Three.js (ou o 3D travou a página na última vez), cai no 2D simples.
// Se a página foi gerada em modo seguro (window.__sem3d), abre direto em 2D e o 3D só entra quando o jogador pedir.
const hooksRenderer = () => ({ aoTocar, aoArrastar: () => { if (S && S.jogador) S.jogador.seguir = false; } });
const estadoRenderer = () => ({ S, W, cfg });
function trocaCanvas() { const antigo = $('#cv'), novo = antigo.cloneNode(false); antigo.parentNode.replaceChild(novo, antigo); return novo; }

function criarRendererSeguro() {
  const chave = 'saude-sim-3d';
  let anterior = null;
  try { anterior = localStorage.getItem(chave); } catch (e) { /* sem armazenamento */ }
  let motivo = '';
  if (window.__sem3d) motivo = 'modo simples (toque em Sobre para tentar o 3D)';
  else if (typeof THREE === 'undefined') motivo = 'Three.js não carregou';
  else if (anterior === 'tentando' || anterior === 'travou') { motivo = 'o 3D travou neste aparelho'; try { localStorage.setItem(chave, 'travou'); } catch (e) { /* ok */ } }
  if (!motivo) {
    try {
      try { localStorage.setItem(chave, 'tentando'); } catch (e) { /* ok */ }
      const r = criarRenderer($('#cv'), estadoRenderer, hooksRenderer());
      window.__quadros3d = 0;
      return r;
    } catch (e) { motivo = '3D indisponível (' + (e && e.message ? e.message : e) + ')'; }
  }
  if (window.__diag && !window.__sem3d) window.__diag('Modo 2D: ' + motivo);
  const r2 = criarRenderer2D(trocaCanvas(), estadoRenderer, hooksRenderer());
  r2.motivo = motivo;
  return r2;
}

/** Troca para o 3D sem recarregar a página (usado no modo seguro, em que nada é gravado no aparelho). */
async function tentar3DAgora() {
  toast('Carregando o 3D…', true);
  if (typeof THREE === 'undefined' && window.__URL3) {
    await new Promise((fim) => {
      const sc = document.createElement('script');
      sc.src = window.__URL3; sc.onload = () => fim(); sc.onerror = () => fim();
      document.head.appendChild(sc);
      setTimeout(fim, 7000);
    });
  }
  if (typeof THREE === 'undefined') { toast('Não foi possível carregar o 3D neste aparelho.', false); return; }
  const antigo = R;
  try {
    const r = criarRenderer(trocaCanvas(), estadoRenderer, hooksRenderer());
    R = r; window.__sem3d = false; window.__quadros3d = 0;
    if (S && S.jogador) { R.selecionar(meuAgente().id); const a = meuAgente(); R.seguirAlvo(a.x, a.y, 1); }
    R.redimensiona();
    folha = null; renderFolha();
    toast('3D ativado. Se a tela ficar branca, feche e abra o jogo de novo: ele volta no modo simples.', true);
  } catch (e) {
    R = antigo;
    toast('Este aparelho não conseguiu iniciar o 3D.', false);
  }
}

async function iniciar() {
  base = await carregarBase();
  carregaRascunhoFb();
  montaTopo();
  let salvo = carregarSalvo();
  R = criarRendererSeguro();
  if (salvo) {
    try {
      cfg = montarCfg(base, salvo.cenario);
      S = salvo; W = criarMundo(S, cfg);
      carregaArquivo();
      document.body.classList.remove('sem-jogo'); // sem isto, ao reabrir com um jogo salvo a tela ficava em branco
      montaRodape();
      R.selecionar(meuAgente().id);
      R.enquadrarUBS();
      mostraAba('mundo');
      jaDeuOrdem = true;
      if (!jaViuIntro()) abrirFolha({ tipo: 'intro' });
    } catch (e) {
      try { localStorage.removeItem(SAVE_KEY); } catch { /* ok */ }
      S = null; W = null; salvo = null;
    }
  }
  if (!salvo) {
    cfg = montarCfg(base, base.cenarios.padrao);
    document.body.classList.add('sem-jogo');
    abrirFolha({ tipo: 'cenarios' });
  }
  requestAnimationFrame(quadro);
  window.__jogoPronto = true;
  const diag = document.getElementById('diag');
  if (diag) diag.remove();
  window.__jogo = { get S() { return S; }, get W() { return W; }, get cfg() { return cfg; }, get vel() { return vel; }, set vel(v) { vel = v; }, get R() { return R; }, comandar: (id, a) => comandar(W, S, cfg, id, a), opcoesPara: (a) => opcoesPara(W, S, cfg, a), avanca: (min) => passoMundo(W, S, cfg, min) };
}

iniciar().catch((e) => telaErro(`${e && e.stack ? e.stack : e}`));
