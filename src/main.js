// Interface (mobile-first). O jogador escolhe UM personagem (paciente ou profissional) e joga só com ele: toca em
// móveis, pessoas e no chão para dar ordens. Nenhuma regra de jogo mora aqui.
import {
  CONDS, FOCOS, newGame, todasPessoas, achaPessoa, achaFamilia, indicadores, acaoTratamento, rotuloData, sintomasDengueVisiveis,
} from './engine.js';
import {
  montarCfg, iniciarEstadoMundo, escolherPersonagem, criarMundo, passoMundo, pularMes, pularDia, minutosPorSegundo,
  rotuloRelogio, diaDoMes, ubsAberta, agenteJogador, acaoAtual, opcoesPara, comandar, cancelarFila, alternaVontade,
  iniciarAtendimento, finalizarAtendimento, atendimentoAtual, filaEspera, resumoEquipe, sintomasDe, ROTULO_NEC, PAPEIS, diaSemana,
} from './mundo.js';
import { criarRenderer } from './render.js';

const SAVE_KEY = 'saude-sim-save-v3';
const INTRO_KEY = 'saude-sim-intro-v3';

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
function jaViuIntro() { try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return true; } }
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
    ? [['mundo', '🗺️', 'Mundo'], ['saude', '🩺', 'Minha saúde'], ['diario', '📓', 'Diário']]
    : [['mundo', '🗺️', 'Mundo'], ['unidade', '🏥', 'Unidade'], ['diario', '📓', 'Diário'], ['desempenho', '📊', 'Desempenho']];
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
  if (!S || aba !== 'mundo') { el.hidden = true; return; }
  const ag = meuAgente();
  let assin = `${modo()}|${papel()}|${ag.id}`;
  if (modo() === 'paciente') { const p = minhaPessoa(); assin += `|${p.tabagismo}|${CONDS.some((id) => p.cond[id].diag && p.cond[id].trat)}|${S.jogador.vontade}|${ag.fila.length}|${sintomasDe(S, cfg, p.id).length}`; }
  else assin += `|${ag.fila.length}|${atendimentoAtual(W, S) ? 1 : 0}`;
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
      <div class="c-btns" style="grid-template-columns:repeat(${papel() === 'acs' ? 2 : 2},1fr)">
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
    if (!jaDeuOrdem) return 'Toque num <b>móvel</b> (cama, sofá, fogão…) ou no <b>chão</b> para dar ordens ao seu personagem. Com a <b>vontade própria</b> ligada, ele segue a rotina sozinho.';
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
  return null;
}
function atualizaDica() {
  const el = $('#dica');
  const txt = aba === 'mundo' && !folha && !menu ? dicaDoMomento() : null;
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
    <div class="card"><div class="kv"><span>Consultas feitas</span><span>${m.atendidos}</span><span>Triagens</span><span>${m.triagens}</span><span>Orientações</span><span>${m.orientacoes}</span><span>Visitas domiciliares</span><span>${m.visitas}</span><span>Espera média</span><span>${espera} min</span></div></div>
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
  const corpo = { saude: viewSaude, diario: viewDiario, unidade: viewUnidade, desempenho: viewDesempenho }[aba]();
  v.innerHTML = corpo + (modo() === 'paciente' && aba === 'diario' ? '' : '') + (aba === 'saude' ? '<button class="btn" style="margin-top:14px" data-act="sobre"><span>ℹ️ Sobre o jogo e avisos</span></button>' : '');
  v.scrollTop = scroll;
}

/* ---------- Folhas (modais) ---------- */
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
  const pac = todasPessoas(S).map((p) => `
    <div class="card pers"><div class="c-topo"><span class="emoji">${emojiPessoa(p)}</span>
      <div class="c-id"><b>${esc(p.nome)}</b> <small>${p.idade} anos</small><div class="tags">${dicasDe(p).map((d) => `<span class="selo">${esc(d)}</span>`).join('')}</div></div></div>
      <button class="btn primario" style="margin-top:8px" data-act="pers-paciente" data-id="${p.id}"><span>Viver a história de ${esc(p.nome.split(' ').pop())}</span></button></div>`).join('');
  const mundo = cfg.cenario.mundo;
  const dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
  const prof = PAPEIS.map((id) => {
    const r = cfg.papeis[id];
    const extra = id === 'medico' && mundo.medicoDias.length < 5 ? `<li>Neste cenário você atende só ${mundo.medicoDias.map((d) => dias[d]).join(' e ')}</li>` : '';
    return `<div class="card pers"><div class="c-topo"><span class="emoji">${r.icone}</span><div class="c-id"><b>${esc(r.nome)}</b></div></div>
      <p class="dica-t" style="margin:6px 0">${esc(r.resumo)}</p><ul class="lista">${r.desafios.map((d) => `<li>${esc(d)}</li>`).join('')}${extra}</ul>
      <button class="btn primario" style="margin-top:8px" data-act="pers-prof" data-id="${id}"><span>Trabalhar como ${esc(r.nome.toLowerCase())}</span></button></div>`;
  }).join('');
  return `<div class="folha-topo"><h2>Quem você será?</h2></div>
    <p class="dica-t" style="margin:0 0 8px">Você joga com <b>um único personagem</b> e vive o que ele viver. As doenças de cada pessoa são <b>surpresa</b>.</p>
    <div class="abas-pers"><button class="${abaPers === 'paciente' ? 'on' : ''}" data-act="pers-aba" data-id="paciente">🧑 Paciente</button><button class="${abaPers === 'profissional' ? 'on' : ''}" data-act="pers-aba" data-id="profissional">🩺 Profissional</button></div>
    ${abaPers === 'paciente' ? pac : prof}
    <button class="btn" style="margin-top:12px" data-act="sortear"><span>🎲 Sortear outro bairro</span></button>
    <button class="btn" data-act="trocar-cenario"><span>‹ Trocar de cenário</span></button>`;
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
    <div class="card"><p>Protótipo v0.4 — simulação simplificada de uma unidade básica de saúde, com mundo em tempo real e um único personagem controlado. As regras ficam em <code>data/*.json</code>; as fontes clínicas estão listadas lá e <b>precisam de validação por consultoria clínica</b>.</p>
    <p class="dica-t">Fora do escopo: óbitos, gestação, puericultura, vacinação, outras doenças e papéis de gestão.</p></div>
    <p class="aviso">Jogo educativo. Não substitui avaliação, diagnóstico ou tratamento por profissionais de saúde.</p>
    <button class="btn perigo" style="margin-top:14px" data-act="trocar-cenario"><span>🔁 Nova história / trocar de cenário</span></button>`;
}

function renderFolha() {
  const host = $('#folha-host');
  if (!folha) { host.innerHTML = ''; return; }
  const corpo = { cenarios: folhaCenarios, personagem: folhaPersonagem, menu: folhaMenu, atendimento: folhaAtendimento, fila: folhaFila, territorio: folhaTerritorio, relatorio: folhaRelatorio, intro: folhaIntro, sobre: folhaSobre }[folha.tipo]();
  const scroll = document.querySelector('.folha')?.scrollTop ?? 0;
  const leve = folha.tipo === 'menu' ? ' leve' : '';
  host.innerHTML = `<div class="fundo${leve}" data-act="fundo"><div class="folha${folha.tipo === 'menu' ? ' menu-op' : ''}" role="dialog" aria-modal="true">${corpo}</div></div>`;
  const nova = document.querySelector('.folha');
  if (nova) nova.scrollTop = scroll;
}
function abrirFolha(f) { folha = f; renderFolha(); atualizaDica(); }
function fecharFolha() {
  const tipo = folha && folha.tipo;
  folha = null; menu = null;
  renderFolha();
  if (tipo === 'relatorio' || tipo === 'intro') vel = velAntes || 1;
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
  W = null;
  document.body.classList.add('sem-jogo');
  abaPers = 'paciente';
  abrirFolha({ tipo: 'personagem' });
}
function sortearBairro() { novoCenario(cfg.cenario.id); }

function comecarComPersonagem(escolha) {
  escolherPersonagem(S, escolha);
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
    if (ag.k === 'staff') { toast(`${cfg.papeis[ag.papel].nome}: ${acaoAtual(W, S, ag)}`, true); return; }
    const p = achaPessoa(S, ag.pid);
    titulo = `${emojiPessoa(p)} ${p.nome}`;
    if (modo() === 'paciente') titulo += ` · ${acaoAtual(W, S, ag).replace(/^[^\s]+\s/, '')}`;
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
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  if (act === 'fundo') { if (ev.target === el && folha && ['menu', 'fila', 'territorio', 'atendimento', 'sobre'].includes(folha.tipo)) fecharFolha(); return; }
  if (!S && !['cenario'].includes(act)) return;
  if (['aba', 'fechar'].includes(act)) limpaToast();
  switch (act) {
    case 'aba': mostraAba(id); break;
    case 'vel': vel = Number(el.dataset.v); atualizaTopo(); break;
    case 'pular-dia': { const v0 = vel; if (pularDia(W, S, cfg)) { velAntes = v0 || 1; aoVirarMes(); } atualizaTopo(); break; }
    case 'pular': { const v0 = vel; if (pularMes(W, S, cfg)) { velAntes = v0 || 1; aoVirarMes(); } atualizaTopo(); break; }
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
    case 'abrir-fila': abrirFolha({ tipo: 'fila' }); break;
    case 'abrir-territorio': abrirFolha({ tipo: 'territorio' }); break;
    case 'abrir-atend': abrirFolha({ tipo: 'atendimento' }); break;
    case 'visitar': resultado(comandar(W, S, cfg, 'acs_visita', { tipo: 'obj', obj: { t: 'casa', casa: id } })); fecharFolha(); break;
    case 'chamar': { const r = comandar(W, S, cfg, 'chamar', { tipo: 'agente', id }); fecharFolha(); resultado(r); break; }
    case 'atender': { const r = iniciarAtendimento(W, S, cfg, { foco: el.dataset.foco }); renderFolha(); resultado(r); break; }
    case 'tratar': { const r = acaoTratamento(S, cfg, id, el.dataset.cond, el.dataset.ligar === '1'); renderFolha(); toast(r.msg, r.ok); break; }
    case 'concluir': { const r = finalizarAtendimento(W, S, cfg, el.dataset.destino); fecharFolha(); resultado(r); break; }
    case 'sobre': abrirFolha({ tipo: 'sobre' }); break;
    case 'ajuda': velAntes = vel || 1; abrirFolha({ tipo: 'intro' }); break;
    case 'comecar': marcaIntro(); fecharFolha(); break;
    case 'trocar-cenario': abrirFolha({ tipo: 'cenarios' }); break;
    case 'cenario': novoCenario(id); break;
    case 'sortear': sortearBairro(); break;
    case 'pers-aba': abaPers = id; renderFolha(); break;
    case 'pers-paciente': comecarComPersonagem({ modo: 'paciente', pid: id }); break;
    case 'pers-prof': comecarComPersonagem({ modo: 'profissional', papel: id }); break;
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
      if (aba === 'mundo') { if (S.jogador.seguir && a && a.vis) R.seguirAlvo(a.x, a.y, 0.1); R.desenha(t); }
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

async function iniciar() {
  base = await carregarBase();
  montaTopo();
  let salvo = carregarSalvo();
  R = criarRenderer($('#cv'), () => ({ S, W, cfg }), { aoTocar, aoArrastar: () => { if (S && S.jogador) S.jogador.seguir = false; } });
  if (salvo) {
    try {
      cfg = montarCfg(base, salvo.cenario);
      S = salvo; W = criarMundo(S, cfg);
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
  window.__jogo = { get S() { return S; }, get W() { return W; }, get cfg() { return cfg; }, get vel() { return vel; }, set vel(v) { vel = v; }, get R() { return R; }, comandar: (id, a) => comandar(W, S, cfg, id, a), opcoesPara: (a) => opcoesPara(W, S, cfg, a) };
}

iniciar().catch((e) => telaErro(`${e && e.stack ? e.stack : e}`));
