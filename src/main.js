// Interface (mobile-first). O mundo é desenhado em canvas (render.js); aqui ficam o HUD, o cartão do personagem,
// as ordens à equipe e as demais telas. Nenhuma regra de jogo mora aqui.
import {
  CONDS, FOCOS, newGame, todasPessoas, achaPessoa, achaFamilia, familiaDe, rotuloData,
  sintomasDengueVisiveis, indicadores, adesao, acaoTratamento,
} from './engine.js';
import {
  montarCfg, iniciarEstadoMundo, criarMundo, passoMundo, pularMes, rotuloRelogio, diaDoMes, ubsAberta,
  ordenarVisita, ordenarUnidade, ordenarOrientar, ordenarMutirao, acaoAtual, resumoEquipe, numMedicos, numACS,
  ROTULO_NEC, ROTULO_ACAO,
} from './mundo.js';
import { criarRenderer } from './render.js';

const SAVE_KEY = 'saude-sim-save-v2';
const INTRO_KEY = 'saude-sim-intro-v2';
const MIN_POR_SEG = 15; // a 1×, um dia de jogo dura 96 s

let base, cfg, S, W, R;
let aba = 'mundo';
let folha = null; // { tipo }
let sel = null;
let jaSelecionou = false;
let vel = 1, velAntes = 1;
let confirmaReset = false;
let assinaturaCartao = '';

const $ = (sel_) => document.querySelector(sel_);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => (v === null ? '—' : `${Math.round(v * 100)}%`);

/* ---------- Persistência ---------- */
function salvar() { try { if (S) localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch { /* sem armazenamento: segue o jogo */ } }
function carregarSalvo() {
  try { const t = localStorage.getItem(SAVE_KEY); if (t) { const s = JSON.parse(t); if (s.v === 2 && s.tempoReal && s.mundo) return s; } } catch { /* ignora */ }
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

let toastTimer;
function toast(msg, ok = true) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `on ${ok ? '' : 'erro'}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 4800);
}
function limpaToast() { clearTimeout(toastTimer); $('#toast').className = ''; }

function tagsPessoa(p) {
  const t = [];
  if (p.internado) t.push('<span class="selo bad">🏥 internado(a)</span>');
  if (sintomasDengueVisiveis(S, p)) t.push('<span class="selo bad">🦟 febre / dengue?</span>');
  for (const id of CONDS) {
    const st = p.cond[id];
    if (st.diag) t.push(`<span class="selo ${st.trat ? 'ok' : 'warn'}">${cfg.cond[id].icone} ${esc(cfg.cond[id].nome)}${st.trat ? ' · em tratamento' : ''}</span>`);
    else if (p.conhecido.suspeitas.includes(id)) t.push(`<span class="selo warn">⚠ suspeita: ${esc(cfg.cond[id].nome)}</span>`);
  }
  return t.join('');
}

function selosFamilia(f) {
  const t = [];
  if (f.pessoas.some((p) => sintomasDengueVisiveis(S, p))) t.push('<span class="selo bad">🦟 febre</span>');
  if (f.pessoas.some((p) => p.internado)) t.push('<span class="selo bad">🏥</span>');
  if (f.visTurno === S.turno) t.push('<span class="selo ok">✔ visitada</span>');
  else if (S.turno - f.visTurno > 2) t.push('<span class="selo warn">sem visita</span>');
  return t.join('');
}

function proximoPasso() {
  const pess = todasPessoas(S);
  const adultos = pess.filter((p) => p.idade >= 18);
  const equipeOcupada = W.tarefasACS.length || W.agentes.some((a) => a.tarefa);
  if (!jaSelecionou) return 'Toque em um morador no mapa para ver as necessidades dele e dar ordens.';
  if (!S.familias.some((f) => f.visTurno >= 0) && !equipeOcupada) return 'Peça uma <b>🚶 Visita</b>: o agente comunitário (de verde) vai até a casa e cria vínculo.';
  if (!adultos.some((p) => p.conhecido.medidasTurno !== null) && !W.ordens.length) return 'Chame um adulto para <b>📏 Triagem</b>: ele vai à unidade em dia útil, no horário de funcionamento.';
  if (pess.some((p) => p.conhecido.suspeitas.length) && !W.ordens.length) return 'Alguém está com <b>⚠ suspeita</b>. Chame para uma <b>🩺 Consulta</b> para confirmar.';
  if (pess.some((p) => CONDS.some((id) => p.cond[id].diag && !p.cond[id].trat))) return 'Há um diagnóstico <b>sem tratamento</b>. Abra o <b>📋 Prontuário</b> e inicie o tratamento (1 insumo por mês).';
  return null;
}

/* ---------- Topo, abas e cartão (estrutura criada uma vez; só os textos mudam) ---------- */
function montaTopo() {
  $('#topo').innerHTML = `
    <div class="linha"><h1 id="t-nome"></h1><span class="data" id="t-data"></span><button class="ajuda" data-act="ajuda" aria-label="Como jogar">?</button></div>
    <div class="linha2">
      <div class="vel" role="group" aria-label="Velocidade do tempo">
        <button data-act="vel" data-v="0" title="Pausar">⏸</button><button data-act="vel" data-v="1">1×</button><button data-act="vel" data-v="3">3×</button><button data-act="vel" data-v="8">8×</button><button data-act="pular" title="Pular até o fim do mês">⏭ mês</button>
      </div>
      <div class="chips"><span class="chip" id="t-insumos"></span><span class="chip" id="t-verba"></span></div>
    </div>`;
  $('#rodape').innerHTML = `<div class="abas">${[['mundo', '🗺️', 'Mundo'], ['unidade', '🏥', 'Unidade'], ['diario', '📓', 'Diário'], ['indicadores', '📊', 'Desempenho']]
    .map(([id, ic, nome]) => `<button class="aba" data-act="aba" data-id="${id}"><span class="ic">${ic}</span>${nome}</button>`).join('')}</div>`;
}

function atualizaTopo() {
  $('#t-nome').textContent = `🏥 ${cfg.territorio.nomeUnidade}`;
  const mesAbr = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][S.mes];
  $('#t-data').textContent = `${mesAbr}/${String(S.ano).slice(2)} · dia ${diaDoMes(S)} · ${rotuloRelogio(S)}`;
  $('#t-insumos').textContent = `💊 ${S.insumos}`;
  $('#t-verba').textContent = `💰 ${S.verba}`;
  document.querySelectorAll('#topo [data-act=vel]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === vel)));
  document.querySelectorAll('#rodape .aba').forEach((b) => (b.dataset.id === aba ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
}

const NOMES_PAPEL = { medico: 'Médico(a)', tecnico: 'Técnico(a) de enfermagem', acs: 'Agente comunitário de saúde' };

function montaCartao(forcar = false) {
  const el = $('#cartao');
  if (!sel || aba !== 'mundo') { el.hidden = true; assinaturaCartao = ''; return; }
  const a = W.agentes.find((x) => x.id === sel);
  if (!a) { el.hidden = true; return; }
  let assin;
  if (a.k === 'res') { const p = achaPessoa(S, a.pid); assin = `r|${a.id}|${tagsPessoa(p)}|${W.ordens.some((o) => o.pid === p.id)}`; } else assin = `s|${a.id}`;
  if (!forcar && assin === assinaturaCartao) return;
  assinaturaCartao = assin;
  el.hidden = false;
  if (a.k === 'staff') {
    el.innerHTML = `<div class="c-topo"><span class="emoji">${a.papel === 'medico' ? '🧑‍⚕️' : a.papel === 'acs' ? '🧑‍🌾' : '🧑‍🔬'}</span>
      <div class="c-id"><b>${NOMES_PAPEL[a.papel]}</b><div class="c-acao" id="c-acao"></div></div>
      <button class="fechar peq" data-act="cartao-fechar" aria-label="Fechar">✕</button></div>`;
    return;
  }
  const p = achaPessoa(S, a.pid);
  const chamado = W.ordens.some((o) => o.pid === p.id);
  const nec = Object.entries(ROTULO_NEC).map(([k, [ic, nome]]) => `<div class="nec" title="${nome}"><span>${ic}</span><span class="barra mini"><i id="n-${k}"></i></span></div>`).join('');
  el.innerHTML = `<div class="c-topo"><span class="emoji">${emojiPessoa(p)}</span>
      <div class="c-id"><b>${esc(p.nome)}</b> <small>${p.idade} anos</small><div class="c-acao" id="c-acao"></div></div>
      <button class="fechar peq" data-act="cartao-fechar" aria-label="Fechar">✕</button></div>
    <div class="tags">${tagsPessoa(p)}</div>
    <div class="necs">${nec}</div>
    <div class="c-btns">
      <button class="btn peq" data-act="abrir-pessoa" data-id="${p.id}">📋 Prontuário</button>
      <button class="btn peq" data-act="visita" data-id="${p.familiaId}">🚶 Visita</button>
      <button class="btn peq" data-act="triagem" data-id="${p.id}" ${p.idade < 18 || chamado ? 'disabled' : ''}>📏 Triagem</button>
      <button class="btn peq" data-act="consulta" data-id="${p.id}" ${chamado ? 'disabled' : ''}>🩺 Consulta</button>
    </div>`;
}

function atualizaCartao() {
  if (!sel || aba !== 'mundo') return;
  const a = W.agentes.find((x) => x.id === sel);
  if (!a) return;
  const acao = $('#c-acao');
  if (a.k === 'res') {
    if (acao) acao.textContent = acaoAtual(W, S, a);
    const n = S.mundo.needs[a.pid];
    for (const k of Object.keys(ROTULO_NEC)) {
      const barra = $(`#n-${k}`);
      if (barra) { barra.style.width = `${n[k]}%`; barra.className = n[k] < 25 ? 'ruim' : n[k] < 50 ? 'medio' : ''; }
    }
  } else if (acao) {
    acao.textContent = a.tarefa ? { visita: '🏠 Em visita domiciliar', orientar: '💬 Orientando um morador', mutirao: '🧹 Mutirão contra focos', consulta: '🩺 Atendendo', triagem: '📏 Fazendo triagem' }[a.tarefa.tipo] : a.vis ? 'Aguardando' : 'Fora de expediente';
  }
}

function atualizaDica() {
  const el = $('#dica');
  const txt = aba === 'mundo' && !folha ? proximoPasso() : null;
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

function viewUnidade() {
  const G = cfg.game, mundo = cfg.cenario.mundo, inf = S.infestacao;
  const r = resumoEquipe(W, S);
  const aberta = ubsAberta(W, S, cfg), medico = ubsAberta(W, S, cfg, true);
  const dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
  const diasMedico = mundo.medicoDias.filter((d) => d < 5).map((d) => dias[d]).join(', ');
  const predios = Object.entries(G.predios).map(([id, b]) => {
    const nivel = S.predios[id], max = b.custo.length, emObra = S.obra && S.obra.id === id;
    let acao;
    if (nivel >= max) acao = '<span class="selo ok">Nível máximo</span>';
    else if (emObra) acao = `<span class="selo warn">🔨 em obra: ${S.obra.meses} mês(es)</span>`;
    else acao = `<button class="btn" data-act="obra" data-id="${id}" ${S.obra || S.verba < b.custo[nivel] ? 'disabled' : ''}><span>Melhorar para nível ${nivel + 1}</span><small>💰 ${b.custo[nivel]} · ${b.meses[nivel]} mês(es)</small></button>`;
    return `<div class="card"><div class="rotulo"><strong>${b.icone} ${esc(b.nome)}</strong><span>nível ${nivel}/${max}</span></div>
      <p class="dica-t" style="margin:0 0 8px">${esc(b.efeito)}</p>${acao}</div>`;
  }).join('');
  const mutiraoFeito = S.mutiraoTurno === S.turno || W.tarefasACS.some((t) => t.tipo === 'mutirao') || W.agentes.some((a) => a.tarefa && a.tarefa.tipo === 'mutirao');
  return `<h2 class="secao">Funcionamento</h2>
    <div class="card">
      <div class="rotulo"><strong>${aberta ? '🟢 Aberta agora' : '🔴 Fechada agora'}</strong><span>${mundo.expediente[0]}h–${mundo.expediente[1]}h, dias úteis</span></div>
      <p class="dica-t">Médico(a): ${diasMedico} ${medico ? '· presente hoje' : '· <b>não atende hoje</b>'} (${numMedicos(S)} consultório${numMedicos(S) > 1 ? 's' : ''}).<br>
      Agentes comunitários: ${numACS(S)}. Fila: ${r.acs} tarefa(s) de campo, ${r.triagem} em triagem, ${r.consulta} em consulta, ${r.chamados} chamado(s).</p>
    </div>
    <h2 class="secao">Vigilância do território</h2>
    <div class="card">
      <div class="rotulo"><strong>🦟 Índice de infestação do mosquito</strong><span>${inf}%</span></div>
      <div class="barra ${inf >= 60 ? 'perigo' : inf >= 35 ? 'alerta' : ''}"><i style="width:${inf}%"></i></div>
      <p class="dica-t">De novembro a abril, com calor e chuva, a infestação tende a subir. Prepare-se antes.</p>
      <button class="btn" style="margin-top:8px" data-act="mutirao" ${mutiraoFeito ? 'disabled' : ''}><span>🧹 Mutirão contra focos</span><small>${mutiraoFeito ? 'já pedido / feito' : 'agente comunitário'}</small></button>
    </div>
    <h2 class="secao">Melhorias da unidade</h2>${predios}
    <p class="dica-t">Só uma obra por vez. Mantenha a verba: internações custam caro.</p>`;
}

function viewDiario() {
  if (!S.diario.length) return '<p class="vazio">Nada por aqui ainda.</p>';
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const itens = [...S.diario].reverse().slice(0, 150).map((e) => `<div class="entrada ${e.tipo}"><div class="quando">${meses[e.mes]}/${e.ano}</div>${esc(e.texto)}</div>`).join('');
  return `<h2 class="secao">Diário da unidade</h2>${itens}`;
}

function viewIndicadores() {
  const i = indicadores(S, cfg);
  const c = cfg.cenario;
  return `<h2 class="secao">Cenário</h2>
    <div class="card"><div class="rotulo"><strong>${c.icone} ${esc(c.nome)}</strong></div>
      <ul class="lista">${c.desafios.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>
    <h2 class="secao">Desempenho</h2>
    <div class="card"><div class="rotulo"><span>Liga da unidade</span><span>pontuação ${Math.round(i.score * 100)}</span></div><div class="liga">🏅 ${i.liga}</div>
      <p class="dica-t">Combina rastreamento, controle das doenças crônicas, internações e vínculo. Boa pontuação rende mais verba todo mês.</p></div>
    <h2 class="secao">Indicadores</h2>
    <div class="card">
      ${barraIndicador('Adultos com PA/glicemia medidas (12 meses)', i.rastreamento)}
      ${barraIndicador('Hipertensos diagnosticados e controlados', i.has, ` (${i.hasTotal})`)}
      ${barraIndicador('Diabéticos diagnosticados e controlados', i.dm, ` (${i.dmTotal})`)}
      ${barraIndicador('Depressão diagnosticada e em tratamento', i.dep, ` (${i.depTotal})`)}
      ${barraIndicador('Vínculo médio com as famílias', i.vinculoMedio)}
      <div class="rotulo"><span>Internações nos últimos 12 meses</span><span>${i.internacoesAno}</span></div>
    </div>
    <button class="btn" style="margin-top:14px" data-act="sobre"><span>ℹ️ Sobre o jogo e avisos</span></button>`;
}

function renderVista() {
  const v = $('#vista');
  if (aba === 'mundo') return;
  const scroll = v.scrollTop;
  v.innerHTML = { unidade: viewUnidade, diario: viewDiario, indicadores: viewIndicadores }[aba]();
  v.scrollTop = scroll;
}

/* ---------- Folhas (modais) ---------- */
function folhaFamilias() {
  const itens = S.familias.map((f) => `
    <button class="pessoa" data-act="abrir-familia" data-id="${f.id}">
      <span class="emoji">🏠</span>
      <span class="info"><div class="nome">${esc(f.nome)}</div><div class="sub">${f.pessoas.map(emojiPessoa).join(' ')} · vínculo ${Math.round(f.vinculo)}%</div><div class="tags">${selosFamilia(f)}</div></span>
      <span aria-hidden="true">›</span></button>`).join('');
  return `<div class="folha-topo"><h2>👥 Famílias do território</h2><button class="fechar" data-act="fechar" aria-label="Fechar">✕</button></div>${itens}`;
}

function folhaFamilia(id) {
  const f = achaFamilia(S, id);
  const jaVisitou = f.visTurno === S.turno;
  const pessoas = f.pessoas.map((p) => `
    <button class="pessoa" data-act="abrir-pessoa" data-id="${p.id}">
      <span class="emoji">${emojiPessoa(p)}</span>
      <span class="info"><div class="nome">${esc(p.nome)}</div><div class="sub">${p.idade} anos</div><div class="tags">${tagsPessoa(p)}</div></span>
      <span aria-hidden="true">›</span></button>`).join('');
  return `<div class="folha-topo"><h2>🏠 ${esc(f.nome)}</h2><button class="fechar" data-act="fechar" aria-label="Fechar">✕</button></div>
    <div class="card"><div class="rotulo"><span>Vínculo com a unidade</span><span>${Math.round(f.vinculo)}%</span></div>
      <div class="barra"><i style="width:${f.vinculo}%"></i></div>
      <p class="dica-t">Adesão estimada ao tratamento: ${Math.round(adesao(f) * 100)}%. Com mais vínculo, a família procura a unidade mais cedo e segue melhor o tratamento.</p>
      <button class="btn" style="margin-top:8px" data-act="visita" data-id="${f.id}" ${jaVisitou ? 'disabled' : ''}>
        <span>🚶 Visita domiciliar</span><small>${jaVisitou ? 'já feita neste mês' : 'agente comunitário'}</small></button></div>
    <h2 class="secao">Moradores</h2>${pessoas}`;
}

function linhaHabito(rotulo, v, inverso = false) {
  const bom = inverso ? 100 - v : v;
  return `<div class="hab"><div class="rotulo"><span>${rotulo}</span><span>${Math.round(v)}</span></div><div class="barra ${bom < 35 ? 'perigo' : bom < 60 ? 'alerta' : ''}"><i style="width:${bom}%"></i></div></div>`;
}

function folhaPessoa(id) {
  const p = achaPessoa(S, id);
  const f = familiaDe(S, p);
  const c = p.conhecido;
  const adulto = p.idade >= 18;
  const chamado = W.ordens.find((o) => o.pid === p.id);

  let medidas = '<p class="dica-t">Ainda sem medidas. Chame para a triagem para medir PA e glicemia.</p>';
  if (c.medidas) {
    const quando = S.turno - c.medidasTurno;
    medidas = `<div class="kv"><span>Pressão arterial</span><span>${c.medidas.pas}/${c.medidas.pad} mmHg</span><span>Glicemia</span><span>${c.medidas.glic} mg/dL</span><span>Medido</span><span>${quando === 0 ? 'neste mês' : `há ${quando} mês(es)`}</span></div>`;
  }
  let habitos = '<p class="dica-t">Você ainda não conhece os hábitos desta pessoa. Peça uma visita domiciliar ou uma consulta.</p>';
  if (c.habitos) {
    const h = c.habitos;
    habitos = `${linhaHabito('Atividade física', h.atividade)}${linhaHabito('Alimentação', h.alimentacao)}${linhaHabito('Sono', h.sono)}${linhaHabito('Estresse', h.estresse, true)}
      <div class="kv" style="margin-top:8px"><span>Fuma</span><span>${h.tabagismo ? 'Sim' : 'Não'}</span>${adulto ? `<span>IMC</span><span>${h.imc}</span>` : ''}</div>
      <p class="dica-t">Informação da última visita/consulta (pode ter mudado).</p>`;
  }
  const riscos = c.risco.map((r) => `<span class="selo warn">${cfg.cond[r].icone} risco: ${esc(cfg.cond[r].nome)}</span>`).join('');
  const tratamentos = CONDS.filter((cid) => p.cond[cid].diag).map((cid) => {
    const st = p.cond[cid];
    return `<button class="btn ${st.trat ? '' : 'primario'}" data-act="tratar" data-id="${p.id}" data-cond="${cid}" data-ligar="${st.trat ? 0 : 1}">
      <span>${cfg.cond[cid].icone} ${esc(cfg.cond[cid].nome)}: ${st.trat ? 'suspender tratamento' : 'iniciar tratamento'}</span><small>💊 1/mês</small></button>`;
  }).join('');
  const focos = Object.entries(FOCOS).filter(([k]) => k !== 'fumo' || p.tabagismo)
    .filter(([k]) => adulto || p.idade >= 12 || ['alimentacao', 'atividade', 'sono'].includes(k))
    .map(([k, nome]) => `<button class="btn" data-act="orientar" data-id="${p.id}" data-foco="${k}" ${p.internado ? 'disabled' : ''}><span>${esc(nome)}</span><small>agente comunitário</small></button>`).join('');

  return `<button class="voltar" data-act="abrir-familia" data-id="${f.id}">‹ ${esc(f.nome)}</button>
    <div class="folha-topo"><h2>${emojiPessoa(p)} ${esc(p.nome)} <small style="font-weight:500;color:var(--muted)">· ${p.idade} anos</small></h2><button class="fechar" data-act="fechar" aria-label="Fechar">✕</button></div>
    <div class="tags" style="margin:0 0 10px">${tagsPessoa(p)}${riscos}</div>
    ${p.internado ? '<div class="card"><strong>🏥 Internado(a) neste mês.</strong><p class="dica-t">Na alta, a pessoa volta para acompanhamento na unidade.</p></div>' : ''}
    <h2 class="secao">Avaliar na unidade</h2>
    ${chamado ? `<div class="card"><strong>⏳ Chamado(a) para ${chamado.tipo === 'triagem' ? 'a triagem' : 'a consulta'}</strong><p class="dica-t">Vai quando a unidade estiver aberta. Moradores com pouco vínculo podem não comparecer.</p></div>` : `
    <div class="linha-btn">
      <button class="btn" data-act="triagem" data-id="${p.id}" ${adulto && !p.internado ? '' : 'disabled'}><span>📏 Triagem</span><small>PA e glicemia</small></button>
      <button class="btn" data-act="consulta" data-id="${p.id}" ${p.internado ? 'disabled' : ''}><span>🩺 Consulta</span><small>médico(a)</small></button>
    </div>`}
    <div class="card" style="margin-top:10px">${medidas}</div>
    ${tratamentos ? `<h2 class="secao">Tratamento</h2>${tratamentos}<p class="dica-t">Tratar consome insumos todo mês; se faltar, o controle se perde.</p>` : ''}
    <h2 class="secao">Orientar hábitos em casa</h2>${focos}
    <p class="dica-t">A orientação muda a vontade da pessoa de escolher hábitos saudáveis nos próximos dias.</p>
    <h2 class="secao">O que você sabe sobre os hábitos</h2><div class="card">${habitos}</div>`;
}

function folhaRelatorio() {
  const itens = (W.relatorio && W.relatorio.length)
    ? W.relatorio.map((e) => `<div class="entrada ${e.tipo}">${esc(e.texto)}</div>`).join('')
    : '<p class="vazio">Mês tranquilo: nada de especial aconteceu.</p>';
  return `<div class="folha-topo"><h2>📋 Relatório do mês</h2><button class="fechar" data-act="fechar" aria-label="Fechar">✕</button></div>
    <p class="dica-t" style="margin:0 0 10px">Começou ${esc(rotuloData(S))}. O jogo está em pausa até você continuar.</p>${itens}
    <button class="btn primario" style="margin-top:14px" data-act="fechar"><span>Continuar</span></button>`;
}

function folhaIntro() {
  return `<div class="folha-topo"><h2>Como jogar</h2></div>
    <div class="card"><p>Você é a equipe da <b>${esc(cfg.territorio.nomeUnidade)}</b>. As pessoas do bairro <b>vivem sua rotina sozinhas</b>: dormem, trabalham, comem, passeiam. Seus cuidados e os hábitos delas decidem quem adoece. <b>Objetivo:</b> manter todos saudáveis, evitar internações e se preparar para a dengue no verão.</p></div>
    <div class="card passos">
      <div class="p"><span class="passo">1</span><div><b>Toque num morador</b><br>Veja as necessidades (fome, energia, humor…) e o que ele está fazendo. Arraste o mapa e use dois dedos para dar zoom.</div></div>
      <div class="p"><span class="passo">2</span><div><b>Dê ordens à equipe</b><br><i>🚶 Visita</i>: o agente comunitário (verde) caminha até a casa. <i>📏 Triagem</i> e <i>🩺 Consulta</i>: o morador vai à unidade em dia útil.</div></div>
      <div class="p"><span class="passo">3</span><div><b>Trate e oriente</b><br>No <i>📋 Prontuário</i>, inicie o tratamento de quem tiver diagnóstico e oriente hábitos.</div></div>
      <div class="p"><span class="passo">4</span><div><b>Controle o tempo</b><br>⏸ 1× 3× 8× no topo. A cada 30 dias o mês vira e você recebe um relatório. <i>⏭ mês</i> pula direto.</div></div>
    </div>
    <p class="dica-t">Cada cenário tem desafios próprios: distâncias, dias de médico, recursos e hábitos locais. O botão <b>?</b> abre esta ajuda de novo.</p>
    <p class="aviso">Jogo educativo. Não substitui avaliação, diagnóstico ou tratamento por profissionais de saúde.</p>
    <button class="btn primario" style="margin-top:12px" data-act="comecar"><span>Entendi, vamos jogar!</span></button>`;
}

function folhaCenarios() {
  const cards = Object.entries(base.cenarios.cenarios).map(([id, c]) => `
    <div class="card cenario">
      <div class="rotulo"><strong>${c.icone} ${esc(c.nome)}</strong></div>
      <p class="dica-t" style="margin:2px 0 6px">${esc(c.resumo)}</p>
      <ul class="lista">${c.desafios.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      <button class="btn primario" style="margin-top:10px" data-act="cenario" data-id="${id}"><span>Jogar neste cenário</span></button>
    </div>`).join('');
  return `<div class="folha-topo"><h2>Escolha o cenário</h2>${S ? '<button class="fechar" data-act="fechar" aria-label="Fechar">✕</button>' : ''}</div>
    <p class="dica-t" style="margin:0 0 10px">O mesmo jogo, realidades diferentes. ${S ? '<b>Atenção: começar um cenário apaga o progresso atual.</b>' : ''}</p>${cards}`;
}

function folhaSobre() {
  return `<div class="folha-topo"><h2>Sobre</h2><button class="fechar" data-act="fechar" aria-label="Fechar">✕</button></div>
    <div class="card"><p>Protótipo v0.2 — simulação simplificada de uma unidade básica de saúde, com mundo em tempo real. As regras ficam em <code>data/*.json</code> e as fontes de cada condição estão listadas lá, <b>a validar com consultoria clínica</b>.</p>
    <p class="dica-t">Fora do escopo desta versão: óbitos, gestação, puericultura, vacinação, outras doenças e os modos de profissional individuais.</p></div>
    <p class="aviso">Jogo educativo. Não substitui avaliação, diagnóstico ou tratamento por profissionais de saúde.</p>
    <button class="btn perigo" style="margin-top:14px" data-act="trocar-cenario"><span>🔁 Novo jogo / trocar de cenário</span></button>`;
}

function renderFolha() {
  const host = $('#folha-host');
  if (!folha) { host.innerHTML = ''; return; }
  const corpo = { familias: folhaFamilias, familia: () => folhaFamilia(folha.id), pessoa: () => folhaPessoa(folha.id), relatorio: folhaRelatorio, intro: folhaIntro, cenarios: folhaCenarios, sobre: folhaSobre }[folha.tipo]();
  const scroll = document.querySelector('.folha')?.scrollTop ?? 0;
  host.innerHTML = `<div class="fundo" data-act="fundo"><div class="folha" role="dialog" aria-modal="true">${corpo}</div></div>`;
  const nova = document.querySelector('.folha');
  if (nova) nova.scrollTop = scroll;
}

function abrirFolha(f) { folha = f; renderFolha(); atualizaDica(); }
function fecharFolha() {
  const tipo = folha && folha.tipo;
  folha = null; confirmaReset = false;
  renderFolha();
  if (tipo === 'relatorio' || tipo === 'intro') vel = velAntes || 1;
}

function mostraAba(id) {
  aba = id;
  const mundo = id === 'mundo';
  $('#mundo').hidden = !mundo;
  $('#vista').hidden = mundo;
  if (!mundo) renderVista(); else { R.redimensiona(); montaCartao(true); }
  atualizaTopo(); atualizaDica();
}

/* ---------- Jogo ---------- */
function iniciarJogo(cenarioId) {
  cfg = montarCfg(base, cenarioId);
  S = newGame(cfg);
  S.tempoReal = true;
  iniciarEstadoMundo(S);
  W = criarMundo(S, cfg);
  document.body.classList.remove('sem-jogo');
  sel = null; jaSelecionou = false; vel = 1; velAntes = 1;
  R.selecionar(null);
  R.enquadrarUBS();
  salvar();
  mostraAba('mundo');
  montaCartao(true);
  atualizaTopo();
  folha = null;
  if (!jaViuIntro()) abrirFolha({ tipo: 'intro' }); else renderFolha();
  if (!jaViuIntro()) { velAntes = 1; vel = 0; }
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
  salvar();
  assinaturaCartao = '';
  montaCartao(true);
  if (folha && folha.tipo !== 'relatorio') renderFolha();
  if (aba !== 'mundo') renderVista();
}

function selecionar(id) {
  sel = id; jaSelecionou = jaSelecionou || !!id;
  R.selecionar(id);
  montaCartao(true);
  atualizaCartao();
  atualizaDica();
}

/* ---------- Eventos ---------- */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || !S && !['cenario'].includes(el.dataset.act)) return;
  const { act, id } = el.dataset;
  if (act === 'fundo') { if (ev.target === el && folha && !['intro', 'cenarios', 'relatorio'].includes(folha.tipo)) fecharFolha(); return; }
  if (['aba', 'fechar', 'abrir-familia', 'abrir-pessoa'].includes(act)) limpaToast();
  switch (act) {
    case 'aba': mostraAba(id); break;
    case 'vel': vel = Number(el.dataset.v); atualizaTopo(); break;
    case 'pular': { const v0 = vel; const mes = pularMes(W, S, cfg); if (mes) { velAntes = v0 || 1; aoVirarMes(); } atualizaTopo(); break; }
    case 'abrir-familia': abrirFolha({ tipo: 'familia', id }); break;
    case 'abrir-pessoa': abrirFolha({ tipo: 'pessoa', id }); break;
    case 'familias': abrirFolha({ tipo: 'familias' }); break;
    case 'centro': { const a = sel && W.agentes.find((x) => x.id === sel && x.vis); if (a) R.centralizar(a.x, a.y, Math.max(R.cam.z, 1)); else R.enquadrarUBS(); break; }
    case 'cartao-fechar': selecionar(null); break;
    case 'fechar': fecharFolha(); break;
    case 'sobre': abrirFolha({ tipo: 'sobre' }); break;
    case 'ajuda': velAntes = vel || 1; abrirFolha({ tipo: 'intro' }); break;
    case 'comecar': marcaIntro(); fecharFolha(); break;
    case 'trocar-cenario': abrirFolha({ tipo: 'cenarios' }); break;
    case 'cenario': iniciarJogo(id); break;
    case 'visita': resultado(ordenarVisita(W, S, cfg, id)); break;
    case 'triagem': resultado(ordenarUnidade(W, S, cfg, id, 'triagem')); break;
    case 'consulta': resultado(ordenarUnidade(W, S, cfg, id, 'consulta')); break;
    case 'orientar': resultado(ordenarOrientar(W, S, cfg, id, el.dataset.foco)); break;
    case 'mutirao': resultado(ordenarMutirao(W, S, cfg)); break;
    case 'tratar': resultado(acaoTratamento(S, cfg, id, el.dataset.cond, el.dataset.ligar === '1')); break;
    case 'obra': {
      const b = cfg.game.predios[id], nivel = S.predios[id];
      if (S.obra) { resultado({ ok: false, msg: 'Já existe uma obra em andamento — só uma por vez.' }); break; }
      if (S.verba < b.custo[nivel]) { resultado({ ok: false, msg: 'Verba insuficiente.' }); break; }
      S.verba -= b.custo[nivel]; S.obra = { id, meses: b.meses[nivel] };
      resultado({ ok: true, msg: `Obra iniciada: ${b.nome} (nível ${nivel + 1}) — ${b.meses[nivel]} mês(es).` });
      break;
    }
    default: break;
  }
});

/* ---------- Laço principal ---------- */
let ultimo = 0, ultimoUI = 0, ultimoSave = 0;
function quadro(t) {
  const dt = Math.min(0.1, (t - ultimo) / 1000);
  ultimo = t;
  if (S && W) {
    const pausado = folha && ['relatorio', 'intro', 'cenarios'].includes(folha.tipo);
    if (vel > 0 && !pausado) {
      if (passoMundo(W, S, cfg, dt * vel * MIN_POR_SEG)) aoVirarMes();
    }
    if (aba === 'mundo') R.desenha(t);
    if (t - ultimoUI > 250) {
      ultimoUI = t;
      atualizaTopo(); atualizaCartao(); atualizaDica();
      if (W.msgs.length) { const m = W.msgs[W.msgs.length - 1]; W.msgs.length = 0; toast(m.texto, true); }
      if (aba === 'mundo') montaCartao(false);
    }
    if (t - ultimoSave > 8000) { ultimoSave = t; salvar(); }
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
  const salvo = carregarSalvo();
  const cfgInicial = montarCfg(base, salvo ? salvo.cenario : base.cenarios.padrao);
  if (salvo) { cfg = cfgInicial; S = salvo; W = criarMundo(S, cfg); }
  R = criarRenderer($('#cv'), () => ({ S, W, cfg }), { aoTocar: (id) => selecionar(id) });
  if (salvo) {
    R.enquadrarUBS();
    mostraAba('mundo');
    if (!jaViuIntro()) abrirFolha({ tipo: 'intro' });
  } else {
    // primeiro acesso: escolher cenário
    cfg = cfgInicial;
    document.body.classList.add('sem-jogo');
    abrirFolha({ tipo: 'cenarios' });
  }
  requestAnimationFrame(quadro);
  window.__jogo = { get S() { return S; }, get W() { return W; }, get cfg() { return cfg; }, get vel() { return vel; }, set vel(v) { vel = v; }, get R() { return R; }, selecionar };
}

iniciar();
