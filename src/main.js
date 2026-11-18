// Interface (mobile-first). Renderiza a partir do estado do motor; nenhuma regra de jogo mora aqui.
import {
  CONDS, FOCOS, newGame, avancarMes, todasPessoas, achaPessoa, achaFamilia, familiaDe, rotuloData,
  sintomasDengueVisiveis, indicadores, adesao,
  acaoVisita, acaoMedir, acaoConsulta, acaoTratamento, acaoOrientar, acaoMutirao, acaoObra,
} from './engine.js';

const SAVE_KEY = 'saude-sim-save-v1';
const INTRO_KEY = 'saude-sim-intro-v1';

let cfg, S;
let aba = 'territorio';
let confirmaReset = false;
let folha = null; // { tipo: 'familia'|'pessoa'|'relatorio'|'intro'|'sobre', id? }

const $ = (sel) => document.querySelector(sel);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => (v === null ? '—' : `${Math.round(v * 100)}%`);

/* ---------- Persistência ---------- */
function salvar() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch { /* sem armazenamento: segue o jogo */ } }
function carregar() {
  try { const t = localStorage.getItem(SAVE_KEY); if (t) { const s = JSON.parse(t); if (s.v === 1) return s; } } catch { /* ignora */ }
  return null;
}
function jaViuIntro() { try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return true; } }
function marcaIntro() { try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* ok */ } }

/* ---------- Pequenos auxiliares de apresentação ---------- */
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
  toastTimer = setTimeout(() => (el.className = ''), 4200);
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

/* ---------- Telas ---------- */
function viewTopo() {
  return `<header class="topo">
    <div class="linha"><h1>🏥 ${esc(cfg.territorio.nomeUnidade)}</h1><span class="data">${esc(rotuloData(S))} <button class="ajuda" data-act="ajuda" aria-label="Como jogar">?</button></span></div>
    <div class="chips">
      <span class="chip">⏱ Equipe ${S.tempo}/${S.tempoMax}</span>
      <span class="chip">💊 Insumos ${S.insumos}</span>
      <span class="chip">💰 Verba ${S.verba}</span>
    </div></header>`;
}

function proximoPasso() {
  const pess = todasPessoas(S);
  const adultos = pess.filter((p) => p.idade >= 18);
  if (S.tempo <= 0) return { n: '▶', txt: 'Suas horas deste mês acabaram. Toque em <b>Avançar para o próximo mês</b> e veja o que aconteceu.' };
  if (!S.familias.some((f) => f.visTurno >= 0)) return { n: 1, txt: 'Toque em uma <b>casa</b> abaixo e faça uma <b>Visita domiciliar</b>. Isso cria vínculo com a família.' };
  if (!adultos.some((p) => p.conhecido.medidasTurno !== null)) return { n: 2, txt: 'Abra uma <b>pessoa adulta</b> (dentro da casa) e toque em <b>Medir PA e glicemia</b>. Muita doença não dá sintoma.' };
  if (pess.some((p) => p.conhecido.suspeitas.length)) return { n: 3, txt: 'Alguém está com <b>⚠ suspeita</b> (valores alterados). Abra a pessoa e faça uma <b>Consulta</b> para confirmar.' };
  if (pess.some((p) => CONDS.some((id) => p.cond[id].diag && !p.cond[id].trat))) return { n: 4, txt: 'Há um diagnóstico <b>sem tratamento</b>. Abra a pessoa e toque em <b>Iniciar tratamento</b> (gasta 1 insumo por mês).' };
  if (S.turno === 0) return { n: 5, txt: 'Continue medindo os outros adultos. Quando acabar as horas ⏱, avance o mês.' };
  return null;
}

function viewTerritorio() {
  const casas = S.familias.map((f) => `
    <button class="casa" data-act="abrir-familia" data-id="${f.id}" aria-label="Abrir ${esc(f.nome)}">
      <span class="nome">🏠 ${esc(f.nome)}</span>
      <span class="moradores">${f.pessoas.map(emojiPessoa).join('')}</span>
      <span class="selos">${selosFamilia(f)}</span>
      <span><span class="rotulo"><span>Vínculo</span><span>${Math.round(f.vinculo)}%</span></span>
      <span class="barra ${f.vinculo < 30 ? 'perigo' : f.vinculo < 50 ? 'alerta' : ''}"><i style="width:${f.vinculo}%"></i></span></span>
    </button>`).join('');
  const passo = proximoPasso();
  const guia = passo ? `<div class="card guia"><span class="passo">${passo.n}</span><div>${passo.txt}</div></div>` : '';
  return `${guia}<h2 class="secao">Seu território</h2><div class="grade">${casas}</div>
    <p class="dica">Toque numa casa para visitar a família e cuidar de cada pessoa. Você tem horas de equipe limitadas por mês.</p>`;
}

function viewUnidade() {
  const G = cfg.game;
  const inf = S.infestacao;
  const predios = Object.entries(G.predios).map(([id, b]) => {
    const nivel = S.predios[id];
    const max = b.custo.length;
    const emObra = S.obra && S.obra.id === id;
    let acao;
    if (nivel >= max) acao = '<span class="selo ok">Nível máximo</span>';
    else if (emObra) acao = `<span class="selo warn">🔨 em obra: ${S.obra.meses} mês(es)</span>`;
    else acao = `<button class="btn" data-act="obra" data-id="${id}" ${S.obra || S.verba < b.custo[nivel] ? 'disabled' : ''}><span>Melhorar para nível ${nivel + 1}</span><small>💰 ${b.custo[nivel]} · ${b.meses[nivel]} mês(es)</small></button>`;
    return `<div class="card"><div class="rotulo"><strong>${b.icone} ${esc(b.nome)}</strong><span>nível ${nivel}/${max}</span></div>
      <p class="dica" style="margin:0 0 8px">${esc(b.efeito)}</p>${acao}</div>`;
  }).join('');
  const mutiraoFeito = S.mutiraoTurno === S.turno;
  return `<h2 class="secao">Vigilância do território</h2>
    <div class="card">
      <div class="rotulo"><strong>🦟 Índice de infestação do mosquito</strong><span>${inf}%</span></div>
      <div class="barra ${inf >= 60 ? 'perigo' : inf >= 35 ? 'alerta' : ''}"><i style="width:${inf}%"></i></div>
      <p class="dica">De novembro a abril, com calor e chuva, a infestação tende a subir. Prepare-se antes.</p>
      <button class="btn" style="margin-top:8px" data-act="mutirao" ${mutiraoFeito || S.tempo < cfg.game.custos.mutirao ? 'disabled' : ''}>
        <span>🧹 Mutirão contra focos</span><small>⏱ ${cfg.game.custos.mutirao}${mutiraoFeito ? ' · já feito' : ''}</small></button>
    </div>
    <h2 class="secao">Melhorias da unidade</h2>${predios}
    <p class="dica">Só uma obra por vez. Mantenha a verba: internações custam caro.</p>`;
}

function viewDiario() {
  if (!S.diario.length) return '<p class="vazio">Nada por aqui ainda.</p>';
  const itens = [...S.diario].reverse().map((e) => `<div class="entrada ${e.tipo}"><div class="quando">${esc(['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][e.mes])}/${e.ano}</div>${esc(e.texto)}</div>`).join('');
  return `<h2 class="secao">Diário da unidade</h2>${itens}`;
}

function barraIndicador(rotulo, valor, detalhe = '') {
  const v = valor === null ? 0 : valor * 100;
  return `<div style="margin-bottom:12px"><div class="rotulo"><span>${rotulo}</span><span>${pct(valor)}${detalhe}</span></div>
    <div class="barra ${valor !== null && valor < 0.3 ? 'perigo' : valor !== null && valor < 0.6 ? 'alerta' : ''}"><i style="width:${v}%"></i></div></div>`;
}

function viewIndicadores() {
  const i = indicadores(S, cfg);
  return `<h2 class="secao">Desempenho</h2>
    <div class="card"><div class="rotulo"><span>Liga da unidade</span><span>pontuação ${Math.round(i.score * 100)}</span></div><div class="liga">🏅 ${i.liga}</div>
      <p class="dica">Combina rastreamento, controle das doenças crônicas, internações e vínculo. Boa pontuação rende mais verba todo mês.</p></div>
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

/* ---------- Folhas (modais) ---------- */
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
      <p class="dica">Adesão estimada ao tratamento: ${Math.round(adesao(f) * 100)}%. Famílias com mais vínculo procuram a unidade mais cedo e seguem melhor o tratamento.</p>
      <button class="btn" style="margin-top:8px" data-act="visita" data-id="${f.id}" ${jaVisitou || S.tempo < cfg.game.custos.visita ? 'disabled' : ''}>
        <span>🚶 Visita domiciliar</span><small>⏱ ${cfg.game.custos.visita}${jaVisitou ? ' · já feita' : ''}</small></button></div>
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
  const custos = cfg.game.custos;
  const desab = (custo) => (p.internado || S.tempo < custo ? 'disabled' : '');

  let medidas = '<p class="dica">Ainda sem medidas. Meça a PA e a glicemia para rastrear.</p>';
  if (c.medidas) {
    const quando = S.turno - c.medidasTurno;
    medidas = `<div class="kv"><span>Pressão arterial</span><span>${c.medidas.pas}/${c.medidas.pad} mmHg</span><span>Glicemia</span><span>${c.medidas.glic} mg/dL</span><span>Medido</span><span>${quando === 0 ? 'neste mês' : `há ${quando} mês(es)`}</span></div>`;
  }
  let habitos = '<p class="dica">Você ainda não conhece os hábitos desta pessoa. Faça uma visita domiciliar ou uma consulta.</p>';
  if (c.habitos) {
    const h = c.habitos;
    habitos = `${linhaHabito('Atividade física', h.atividade)}${linhaHabito('Alimentação', h.alimentacao)}${linhaHabito('Sono', h.sono)}${linhaHabito('Estresse', h.estresse, true)}
      <div class="kv" style="margin-top:8px"><span>Fuma</span><span>${h.tabagismo ? 'Sim' : 'Não'}</span>${p.idade >= 18 ? `<span>IMC</span><span>${h.imc}</span>` : ''}</div>
      <p class="dica">Informação da última visita/consulta (pode ter mudado).</p>`;
  }
  const riscos = c.risco.map((r) => `<span class="selo warn">${cfg.cond[r].icone} risco: ${esc(cfg.cond[r].nome)}</span>`).join('');

  const tratamentos = CONDS.filter((id) => p.cond[id].diag).map((cid) => {
    const st = p.cond[cid];
    return `<button class="btn ${st.trat ? '' : 'primario'}" data-act="tratar" data-id="${p.id}" data-cond="${cid}" data-ligar="${st.trat ? 0 : 1}">
      <span>${cfg.cond[cid].icone} ${esc(cfg.cond[cid].nome)}: ${st.trat ? 'suspender tratamento' : 'iniciar tratamento'}</span><small>💊 1/mês</small></button>`;
  }).join('');

  const focos = Object.entries(FOCOS).filter(([k]) => k !== 'fumo' || p.tabagismo)
    .filter(([k]) => adulto || p.idade >= 12 || k === 'alimentacao' || k === 'atividade' || k === 'sono')
    .map(([k, nome]) => `<button class="btn" data-act="orientar" data-id="${p.id}" data-foco="${k}" ${desab(custos.orientar)}><span>${esc(nome)}</span><small>⏱ ${custos.orientar}</small></button>`).join('');

  return `<button class="voltar" data-act="abrir-familia" data-id="${f.id}">‹ ${esc(f.nome)}</button>
    <div class="folha-topo"><h2>${emojiPessoa(p)} ${esc(p.nome)} <small style="font-weight:500;color:var(--muted)">· ${p.idade} anos</small></h2><button class="fechar" data-act="fechar" aria-label="Fechar">✕</button></div>
    <div class="tags" style="margin:0 0 10px">${tagsPessoa(p)}${riscos}</div>
    ${p.internado ? '<div class="card"><strong>🏥 Internado(a) neste mês.</strong><p class="dica">Na alta, a pessoa volta para acompanhamento na unidade.</p></div>' : ''}
    <h2 class="secao">Avaliar</h2>
    <div class="linha-btn">
      <button class="btn" data-act="medir" data-id="${p.id}" ${adulto ? desab(custos.medir) : 'disabled'}><span>📏 Medir PA e glicemia</span><small>⏱ ${custos.medir}</small></button>
      <button class="btn" data-act="consulta" data-id="${p.id}" ${desab(custos.consulta)}><span>🩺 Consulta</span><small>⏱ ${custos.consulta}</small></button>
    </div>
    <div class="card" style="margin-top:10px">${medidas}</div>
    ${tratamentos ? `<h2 class="secao">Tratamento</h2>${tratamentos}<p class="dica">Tratar consome insumos todo mês; se faltar, o controle se perde.</p>` : ''}
    <h2 class="secao">Orientar hábitos</h2>${focos}
    <h2 class="secao">O que você sabe sobre os hábitos</h2><div class="card">${habitos}</div>`;
}

function folhaRelatorio() {
  const itens = S.ultimoRelatorio.length
    ? S.ultimoRelatorio.map((e) => `<div class="entrada ${e.tipo}">${esc(e.texto)}</div>`).join('')
    : '<p class="vazio">Mês tranquilo: nada de especial aconteceu.</p>';
  return `<div class="folha-topo"><h2>📋 Relatório do mês</h2><button class="fechar" data-act="fechar" aria-label="Fechar">✕</button></div>
    <p class="dica" style="margin:0 0 10px">Agora é ${esc(rotuloData(S))}. Sua equipe voltou a ter ${S.tempoMax} horas.</p>${itens}
    <button class="btn primario" style="margin-top:14px" data-act="fechar"><span>Continuar</span></button>`;
}

function folhaIntro() {
  return `<div class="folha-topo"><h2>Como jogar</h2></div>
    <div class="card"><p>Você é a equipe da <b>${esc(cfg.territorio.nomeUnidade)}</b> e cuida das famílias do bairro. <b>Seu objetivo:</b> manter todos saudáveis ao longo dos meses, evitar internações e se preparar para a dengue no verão.</p></div>
    <div class="card passos">
      <div class="p"><span class="passo">1</span><div><b>Visite uma casa</b><br>Toque numa família e depois em <i>Visita domiciliar</i>. Cria vínculo e mostra os hábitos.</div></div>
      <div class="p"><span class="passo">2</span><div><b>Meça os adultos</b><br>Abra uma pessoa e toque em <i>Medir PA e glicemia</i>. Muita doença é silenciosa.</div></div>
      <div class="p"><span class="passo">3</span><div><b>Confirme e trate</b><br>Se aparecer <i>⚠ suspeita</i>, faça uma <i>Consulta</i>; com diagnóstico, <i>Iniciar tratamento</i>.</div></div>
      <div class="p"><span class="passo">4</span><div><b>Avance o mês</b><br>Suas horas de equipe (⏱) são limitadas por mês. Gastou? Toque em <i>▶ Avançar</i> e leia o relatório.</div></div>
    </div>
    <p class="dica">💊 Faltou remédio? 💰 Use a verba para melhorar a unidade. 🦟 No calor, faça mutirões contra o mosquito. O botão <b>?</b> no topo abre esta ajuda de novo.</p>
    <p class="aviso">Jogo educativo. Não substitui avaliação, diagnóstico ou tratamento por profissionais de saúde.</p>
    <button class="btn primario" style="margin-top:12px" data-act="comecar"><span>Entendi, vamos jogar!</span></button>`;
}

function folhaSobre() {
  return `<div class="folha-topo"><h2>Sobre</h2><button class="fechar" data-act="fechar" aria-label="Fechar">✕</button></div>
    <div class="card"><p>Protótipo v0.1 — simulação simplificada de uma unidade básica de saúde. As regras ficam em <code>data/*.json</code> e as fontes de cada condição estão listadas lá, <b>a validar com consultoria clínica</b>.</p>
    <p class="dica">Fora do escopo desta versão: óbitos, gestação, puericultura, vacinação, outras doenças e os modos de profissional individuais.</p></div>
    <p class="aviso">Jogo educativo. Não substitui avaliação, diagnóstico ou tratamento por profissionais de saúde.</p>
    <button class="btn perigo" style="margin-top:14px" data-act="reiniciar"><span>${confirmaReset ? '⚠ Toque de novo para confirmar: o progresso será perdido' : '🗑 Começar um novo território'}</span></button>`;
}

function viewFolha() {
  if (!folha) return '';
  const corpo = { familia: () => folhaFamilia(folha.id), pessoa: () => folhaPessoa(folha.id), relatorio: folhaRelatorio, intro: folhaIntro, sobre: folhaSobre }[folha.tipo]();
  return `<div class="fundo" data-act="fundo"><div class="folha" role="dialog" aria-modal="true">${corpo}</div></div>`;
}

/* ---------- Renderização ---------- */
function render() {
  const abas = [['territorio', '🏘️', 'Território'], ['unidade', '🏥', 'Unidade'], ['diario', '📓', 'Diário'], ['indicadores', '📊', 'Desempenho']];
  const conteudo = { territorio: viewTerritorio, unidade: viewUnidade, diario: viewDiario, indicadores: viewIndicadores }[aba]();
  const scroll = document.querySelector('.folha')?.scrollTop ?? 0;
  $('#app').innerHTML = `${viewTopo()}<main>${conteudo}</main>
    <nav class="rodape"><div class="rodape-in">
      <div class="avancar"><button class="btn primario" data-act="avancar"><span>▶ Avançar para o próximo mês</span><small>${S.tempo} h restantes</small></button></div>
      <div class="abas">${abas.map(([id, ic, nome]) => `<button class="aba" data-act="aba" data-id="${id}" ${aba === id ? 'aria-current="page"' : ''}><span class="ic">${ic}</span>${nome}</button>`).join('')}</div>
    </div></nav>${viewFolha()}`;
  const nova = document.querySelector('.folha');
  if (nova) nova.scrollTop = scroll;
}

function resultado(r) { toast(r.msg, r.ok); salvar(); render(); }

/* ---------- Eventos ---------- */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || !S) return;
  const { act, id } = el.dataset;
  if (['aba', 'avancar', 'fechar', 'abrir-familia', 'abrir-pessoa'].includes(act)) limpaToast();
  if (act === 'fundo') { if (ev.target === el && folha && folha.tipo !== 'intro') { folha = null; render(); } return; }
  switch (act) {
    case 'aba': aba = id; render(); window.scrollTo(0, 0); break;
    case 'abrir-familia': folha = { tipo: 'familia', id }; render(); break;
    case 'abrir-pessoa': folha = { tipo: 'pessoa', id }; render(); break;
    case 'fechar': folha = null; confirmaReset = false; render(); break;
    case 'ajuda': folha = { tipo: 'intro', reaberta: true }; render(); break;
    case 'sobre': folha = { tipo: 'sobre' }; render(); break;
    case 'comecar': marcaIntro(); folha = null; render(); break;
    case 'visita': resultado(acaoVisita(S, cfg, id)); break;
    case 'medir': resultado(acaoMedir(S, cfg, id)); break;
    case 'consulta': resultado(acaoConsulta(S, cfg, id)); break;
    case 'tratar': resultado(acaoTratamento(S, cfg, id, el.dataset.cond, el.dataset.ligar === '1')); break;
    case 'orientar': resultado(acaoOrientar(S, cfg, id, el.dataset.foco)); break;
    case 'mutirao': resultado(acaoMutirao(S, cfg)); break;
    case 'obra': resultado(acaoObra(S, cfg, id)); break;
    case 'avancar': avancarMes(S, cfg); folha = { tipo: 'relatorio' }; salvar(); render(); break;
    case 'reiniciar':
      if (!confirmaReset) { confirmaReset = true; render(); break; }
      confirmaReset = false; S = newGame(cfg); folha = null; aba = 'territorio'; salvar(); render();
      break;
    default: break;
  }
});

/* ---------- Inicialização ---------- */
async function carregarConfig() {
  const [game, cond, territorio] = await Promise.all(['game', 'conditions', 'territorio'].map((n) => fetch(`data/${n}.json`).then((r) => r.json())));
  return { game, cond, territorio };
}

async function iniciar() {
  cfg = await carregarConfig();
  S = carregar() || newGame(cfg);
  if (!jaViuIntro()) folha = { tipo: 'intro' };
  salvar();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

iniciar();

// Expõe para depuração/testes manuais no navegador.
window.__jogo = { get estado() { return S; }, get cfg() { return cfg; }, todasPessoas: () => todasPessoas(S) };
