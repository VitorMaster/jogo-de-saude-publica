// Mundo em tempo real (estilo "vida simulada"). O jogador controla UM personagem — um morador (paciente) ou um
// profissional da unidade — e todos os demais agem sozinhos. Sem DOM. Os desfechos de saúde continuam vindo do
// motor (engine.js); aqui nascem o comportamento (hábitos), a rotina, a fila e as ações da equipe.
import { clamp, rnd, rint } from './rng.js';
import {
  avancarMes, achaPessoa, achaFamilia, todasPessoas, adesao, sintomasDengueVisiveis, CONDS,
  acaoVisita, acaoMedir, acaoConsulta, acaoOrientar, acaoMutirao, acaoTratamento,
} from './engine.js';

const CAMINHAVEL = new Set(['.', ',', 'c', 'F', '_', '+']);
export const MIN_DIA = 1440;
export const DIAS_MES = 30;
const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
export const PAPEIS = ['acs', 'tecnico', 'enfermeiro', 'medico'];

/* ---------- Configuração por cenário ---------- */
function mesclar(a, b) {
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) a[k] = mesclar(a[k] && typeof a[k] === 'object' ? a[k] : {}, b[k]);
    else a[k] = b[k];
  }
  return a;
}

/** Junta regras gerais + cenário escolhido. */
export function montarCfg(base, id) {
  const c = base.cenarios.cenarios[id];
  const game = mesclar(JSON.parse(JSON.stringify(base.game)), c.game);
  return {
    game, cond: base.cond, territorio: c.territorio, cenario: { id, ...c },
    modelos: base.cenarios.modelos, objetos: base.cenarios.objetos, terreno: base.cenarios.terreno, pisos: base.cenarios.pisos, papeis: base.cenarios.papeis,
  };
}

/* ---------- Tempo ---------- */
export const diaDoJogo = (s) => Math.floor(s.mundo.min / MIN_DIA);
export const diaSemana = (s) => (diaDoJogo(s) + 1) % 7; // o jogo começa numa terça-feira
export const minutoDoDia = (s) => s.mundo.min % MIN_DIA;
export function rotuloRelogio(s) {
  const m = Math.floor(minutoDoDia(s));
  return `${DIAS_SEMANA[diaSemana(s)]} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export const diaDoMes = (s) => (diaDoJogo(s) % DIAS_MES) + 1;

/** Minutos de jogo por segundo real a 1×: devagar no expediente (7h–17h), mais rápido à noite. */
export function minutosPorSegundo(s) {
  const h = minutoDoDia(s) / 60;
  if (h >= 7 && h < 17) return 3;
  if (h >= 17 && h < 22) return 5;
  return 12;
}

/* ---------- Mapa ---------- */
const ruidoM = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function construirMapa(cfg) {
  const m = cfg.cenario.mapa;
  const { w, h } = m;
  const idx = (x, y) => y * w + x;
  const terr = new Array(w * h).fill(m.base);
  const piso = new Array(w * h).fill(null);
  const objs = [];
  const casas = {};
  let ubs = null;
  const lugares = [];

  for (const r of m.retangulos || []) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (x >= 0 && y >= 0 && x < w && y < h) terr[idx(x, y)] = r.c;
  }
  for (const s of m.carimbos) {
    const mod = cfg.modelos[s.m];
    const linhas = [...mod.linhas];
    if (s.flip) linhas.reverse();
    const info = { modelo: s.m, x: s.x, y: s.y, w: linhas[0].length, h: linhas.length, casa: s.casa || null, porta: null, piso: cfg.pisos[mod.piso] };
    linhas.forEach((ln, j) => {
      for (let i = 0; i < ln.length; i++) {
        const ch = ln[i], x = s.x + i, y = s.y + j, k = idx(x, y);
        if (ch === ' ') continue;
        if (ch === '#') { terr[k] = '#'; continue; }
        piso[k] = cfg.pisos[mod.piso];
        if (ch === '+') {
          terr[k] = '+';
          if (j === 0 || j === linhas.length - 1) {
            const dir = j === 0 ? -1 : 1;
            info.porta = { x, y, fora: { x, y: y + dir }, dentro: { x, y: y - dir } };
          }
        } else if (ch === '_') terr[k] = '_';
        else if (cfg.objetos[ch]) { terr[k] = '_'; objs.push({ t: ch, x, y, casa: s.casa || null, lugar: s.m }); }
      }
    });
    if (s.casa) casas[s.casa] = info;
    if (s.m === 'ubs') ubs = info;
    lugares.push(info);
  }
  for (const o of m.objetos || []) objs.push({ t: o.t, x: o.x, y: o.y, casa: null, lugar: 'publico' });

  // decoração de fundo (prédios, igreja, celeiro, lago…): ocupa terreno e bloqueia a passagem
  const decoracao = (cfg.cenario.decoracao || []).map((d) => ({ ...d }));
  const bloqDecor = new Set();
  for (const d of decoracao) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) bloqDecor.add(idx(x, y));
  // árvores decorativas: moldura do mapa e áreas de grama, sempre longe de ruas, portas e prédios
  const ocupado = new Set([...objs.map((o) => idx(o.x, o.y)), ...bloqDecor]);
  const gramado = (x, y) => x >= 0 && y >= 0 && x < w && y < h && terr[idx(x, y)] === ',' && !bloqDecor.has(idx(x, y));
  const planta = (x, y) => { const k = idx(x, y); if (!ocupado.has(k) && (terr[k] === ',' || terr[k] === 'c')) { ocupado.add(k); objs.push({ t: 'T', x, y, casa: null, lugar: 'decor', decor: true }); } };
  for (let x = 3; x < w - 2; x += 4) { planta(x, 1); planta(x, h - 2); }
  for (let y = 3; y < h - 2; y += 4) { planta(1, y); planta(w - 2, y); }
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    if (!gramado(x, y) || ruidoM(x, y, 3) < 0.9) continue;
    let ok = true;
    for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2; dx++) if (!gramado(x + dx, y + dy)) { ok = false; break; }
    if (ok) planta(x, y);
  }

  const bloq = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) if (!CAMINHAVEL.has(terr[k])) bloq[k] = 1;
  for (const o of objs) bloq[idx(o.x, o.y)] = 1;
  for (const k of bloqDecor) bloq[k] = 1;

  const porTipo = {};
  for (const o of objs) (porTipo[o.t] = porTipo[o.t] || []).push(o);
  return { w, h, terr, piso, objs, casas, ubs, lugares, bloq, porTipo, decoracao };
}

const caminhavel = (W, x, y) => x >= 0 && y >= 0 && x < W.w && y < W.h && !W.bloq[y * W.w + x];

function pontosDeUso(W, o) {
  if (o.pontos) return o.pontos;
  o.pontos = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: o.x + dx, y: o.y + dy })).filter((q) => caminhavel(W, q.x, q.y));
  return o.pontos;
}

function caminhoAte(W, sx, sy, alvos) {
  const { w, h } = W;
  const objetivo = new Set(alvos.map((q) => q.y * w + q.x));
  const ini = Math.round(sy) * w + Math.round(sx);
  if (objetivo.has(ini)) return [];
  const prev = new Int32Array(w * h).fill(-2);
  prev[ini] = -1;
  const fila = [ini];
  for (let qi = 0; qi < fila.length; qi++) {
    const c = fila[qi];
    const cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (prev[k] !== -2 || W.bloq[k]) continue;
      prev[k] = c;
      if (objetivo.has(k)) {
        const rota = [];
        for (let t = k; t !== ini; t = prev[t]) rota.push({ x: t % w, y: (t / w) | 0 });
        return rota.reverse();
      }
      fila.push(k);
    }
  }
  return null;
}

/* ---------- Estado persistente do mundo (S.mundo) ---------- */
const NECESSIDADES = ['fome', 'energia', 'higiene', 'disp', 'humor'];
export const ROTULO_NEC = { fome: ['🍽️', 'Fome'], energia: ['😴', 'Energia'], higiene: ['🚿', 'Higiene'], disp: ['🏃', 'Disposição'], humor: ['😊', 'Humor'] };

function contadoresNovos() {
  return { exMin: 0, sedMin: 0, saudavel: 0, fast: 0, sonoMin: 0, humorSoma: 0, humorN: 0, trabMin: 0, cafe: false, almoco: false, jantar: false };
}

export function iniciarEstadoMundo(S) {
  const M = { v: 2, min: 6 * 60, rng: (S.seed ^ 0x9e3779b9) >>> 0 || 7, needs: {}, dia: {}, intencao: {}, fumar: {}, remedios: {} };
  for (const p of todasPessoas(S)) {
    M.needs[p.id] = { fome: rint(M, 60, 95), energia: rint(M, 70, 100), higiene: rint(M, 60, 95), disp: rint(M, 50, 90), humor: rint(M, 55, 90) };
    M.dia[p.id] = contadoresNovos();
    M.intencao[p.id] = { atividade: 0, alimentacao: 0, sono: 0, estresse: 0 };
    M.fumar[p.id] = 8 * 60 + rint(M, 0, 120);
    M.remedios[p.id] = { dias: 0, hoje: false };
  }
  S.mundo = M;
}

/** Define quem o jogador será: { modo: 'paciente', pid } ou { modo: 'profissional', papel }. */
export function escolherPersonagem(S, escolha) {
  S.jogador = { ...escolha, vontade: true, seguir: true, notas: [] };
}

/* ---------- Criação do mundo em execução (não é salvo; é reconstruído) ---------- */
export function criarMundo(S, cfg) {
  const W = construirMapa(cfg);
  W.agentes = [];
  W.ordens = [];
  W.tarefasACS = [];
  W.agenda = {}; // afazeres do dia de cada profissional (não é salvo)
  W.apoio = {}; // até quando cada profissional trabalha mais rápido após discutir um caso
  W.reuniao = null; W.ultReuniao = null;
  W.vel = cfg.cenario.mundo.velocidade || 1;
  W.msgs = [];
  W.relatorio = null;
  W.sinal = 0;
  for (const f of S.familias) for (const p of f.pessoas) W.agentes.push(novoAgente('res', p.id, { pid: p.id }));
  sincronizarEquipe(W, S);
  const j = S.jogador;
  for (const a of W.agentes) {
    a.jogador = !!j && ((a.k === 'res' && j.modo === 'paciente' && a.pid === j.pid) || (a.k === 'staff' && j.modo === 'profissional' && a.papel === j.papel && a.ind === 0));
    if (a.k === 'res') posicionarEmCasa(W, S, a);
  }
  return W;
}

function novoAgente(k, id, extra) {
  return { k, id, x: 0, y: 0, path: [], acao: null, pend: null, facing: 1, vis: false, espera: null, atend: null, tarefa: null, fila: [], proximos: [], pausa: 0, ocioso: 0, jogador: false, ...extra };
}

export function numACS(S) { return 1 + S.predios.acs; }
const duracaoConsulta = (S) => 30 - 5 * Math.max(0, S.predios.consultorio - 1);

export function sincronizarEquipe(W, S) {
  const quer = [['tecnico', 1], ['enfermeiro', 1], ['medico', 1], ['acs', numACS(S)]];
  for (const [papel, n] of quer) {
    for (let i = 0; i < n; i++) {
      const id = `${papel}-${i}`;
      if (!W.agentes.some((a) => a.id === id)) W.agentes.push(novoAgente('staff', id, { papel, ind: i }));
    }
  }
}

function posicionarEmCasa(W, S, a) {
  const casa = W.casas[achaPessoa(S, a.pid).familiaId];
  const q = casa.porta.dentro;
  a.x = q.x; a.y = q.y; a.path = []; a.acao = null; a.pend = null; a.vis = true; a.proximos = [];
}

/** Troca o personagem controlado sem reiniciar a história (mesmo mundo, mesmo tempo). */
export function trocarPersonagem(W, S, escolha) {
  for (const a of W.agentes) if (a.jogador) { a.jogador = false; a.fila = []; a.proximos = []; a.path = []; a.pend = null; soltaAfazer(W, a); if (a.k === 'res' && a.acao && a.acao.k !== 'dormir') a.acao = null; }
  escolherPersonagem(S, escolha);
  const novo = W.agentes.find((a) => (a.k === 'res' && escolha.modo === 'paciente' && a.pid === escolha.pid) || (a.k === 'staff' && escolha.modo === 'profissional' && a.papel === escolha.papel && a.ind === 0));
  if (novo) { novo.jogador = true; novo.fila = []; novo.ocioso = 0; if (novo.k === 'res') novo.procurou = false; }
  W.sinal++;
  return novo;
}

export const agenteJogador = (W) => W.agentes.find((a) => a.jogador) || null;

/* ---------- Utilidades ---------- */
const hash = (t) => { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return h; };

function objetosDe(W, tipo, casa) {
  return (W.porTipo[tipo] || []).filter((o) => (casa === undefined ? true : casa ? o.casa === casa : o.casa === null));
}
function irPara(W, a, alvos) {
  const rota = caminhoAte(W, a.x, a.y, alvos);
  if (!rota) return false;
  a.path = rota;
  return true;
}
function escolhe(M, opcoes) {
  const total = opcoes.reduce((t, [, w]) => t + w, 0);
  let r = rnd(M) * total;
  for (const [k, w] of opcoes) { r -= w; if (r <= 0) return k; }
  return opcoes[0][0];
}
function vizinhosDe(W, x, y) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: Math.round(x) + dx, y: Math.round(y) + dy })).filter((q) => caminhavel(W, q.x, q.y));
}

export function ubsAberta(W, S, cfg, medico = false) {
  const [ini, fim] = cfg.cenario.mundo.expediente;
  const m = minutoDoDia(S), dow = diaSemana(S);
  if (dow > 4 || m < ini * 60 || m >= fim * 60) return false;
  if (medico && !cfg.cenario.mundo.medicoDias.includes(dow)) return false;
  return true;
}

function avisar(W, S, texto, tipo = 'info', extra = {}) {
  W.msgs.push({ texto, tipo, ...extra });
  S.diario.push({ mes: S.mes, ano: S.ano, tipo, texto, ...extra });
  if (S.diario.length > 600) S.diario.splice(0, S.diario.length - 500); // limita o tamanho do salvamento
}

/* ---------- Ações dos moradores ---------- */
// pose/onde dizem ao desenho como mostrar: 'objeto' = em cima do móvel; 'frente' = de pé/sentado ao lado, olhando para ele.
export const ACOES = {
  dormir: { ic: '💤', rot: 'Dormindo', obj: 'B', casa: true, dur: 720, max: 720, pose: 'deitar', onde: 'objeto', ef: (n, dt) => { n.energia += 0.1 * dt; n.fome -= 0.02 * dt; }, fim: (n) => n.energia >= 97, cont: 'sonoMin' },
  descansar: { ic: '🛏️', rot: 'Descansando na cama', obj: 'B', casa: true, dur: 90, pose: 'deitar', onde: 'objeto', ef: (n, dt) => { n.energia += 0.06 * dt; n.humor += 0.05 * dt; } },
  doente: { ic: '🤒', rot: 'Acamado(a), com febre', obj: 'B', casa: true, dur: 240, pose: 'deitar', onde: 'objeto', ef: (n, dt) => { n.energia += 0.03 * dt; n.humor -= 0.02 * dt; } },
  banho: { ic: '🚿', rot: 'Tomando banho', obj: 'C', casa: true, dur: 15, pose: 'banho', onde: 'objeto', ef: (n, dt) => { n.higiene += 6 * dt; } },
  cozinhar: { ic: '🍳', rot: 'Cozinhando', obj: 'G', casa: true, dur: 14, pose: 'cozinhar', onde: 'frente', ef: (n, dt) => { n.fome += 0.5 * dt; } },
  comer_mesa: { ic: '🍽️', rot: 'Fazendo a refeição', obj: 'm', casa: true, dur: 14, pose: 'comer', onde: 'frente', cadeira: true, ef: (n, dt) => { n.fome += 3.4 * dt; }, fimC: (c, p, int, M, a) => { if (a.refeicao && a.refeicao.saudavel === false) c.fast++; else c.saudavel++; } },
  lanche: { ic: '🍔', rot: 'Comendo um lanche', obj: 'L', dur: 20, pose: 'comer', onde: 'frente', ef: (n, dt) => { n.fome += 4.5 * dt; n.humor += 0.4 * dt; }, fimC: (c) => { c.fast++; } },
  ler: { ic: '📖', rot: 'Lendo', obj: 'N', casa: true, dur: 45, pose: 'ler', onde: 'objeto', ef: (n, dt) => { n.humor += 0.25 * dt; n.disp -= 0.02 * dt; }, cont: 'sedMin' },
  tv: { ic: '📺', rot: 'Assistindo TV', obj: 'S', casa: true, dur: 60, pose: 'sentar', onde: 'objeto', ef: (n, dt) => { n.humor += 0.18 * dt; n.disp -= 0.04 * dt; }, cont: 'sedMin' },
  praca: { ic: '🌳', rot: 'Descansando na praça', obj: 'P', dur: 40, pose: 'sentar', onde: 'objeto', ef: (n, dt) => { n.humor += 0.3 * dt; n.disp += 0.05 * dt; } },
  academia: { ic: '🏋️', rot: 'Exercitando-se', obj: 'A', dur: 40, pose: 'exercitar', onde: 'frente', ef: (n, dt) => { n.disp += 0.8 * dt; n.humor += 0.2 * dt; }, cont: 'exMin' },
  trabalho: { ic: '💼', rot: 'Trabalhando', obj: 'O', dur: 120, pose: 'digitar', onde: 'frente', cadeira: true, ef: (n, dt) => { n.disp -= 0.03 * dt; n.humor -= 0.04 * dt; }, cont: 'trabMin' },
  roca: { ic: '🌽', rot: 'Trabalhando na roça', obj: 'R', dur: 120, pose: 'enxada', onde: 'frente', ef: (n, dt) => { n.disp += 0.1 * dt; n.humor -= 0.03 * dt; n.fome -= 0.02 * dt; }, cont: 'trabMin', exLeve: 0.15 },
  escola: { ic: '📚', rot: 'Estudando', obj: 'E', dur: 120, pose: 'digitar', onde: 'frente', cadeira: true, ef: (n, dt) => { n.humor += 0.02 * dt; }, cont: 'trabMin' },
  fumar: { ic: '🚬', rot: 'Fumando', dur: 6, local: 'porta', pose: 'fumar', onde: 'local', ef: (n, dt) => { n.humor += 0.8 * dt; } },
  conversar: { ic: '💬', rot: 'Conversando', dur: 25, local: 'rua', pose: 'falar', onde: 'local', ef: (n, dt) => { n.humor += 0.3 * dt; n.disp += 0.05 * dt; } },
  caminhar: { ic: '🚶', rot: 'Fazendo uma caminhada', dur: 1, local: 'rua', pose: 'parado', onde: 'local', ef: (n, dt) => { n.disp += 0.5 * dt; n.humor += 0.2 * dt; }, andarExercicio: true },
  remedio: { ic: '💊', rot: 'Tomando o remédio', obj: 'G', casa: true, dur: 2, pose: 'comer', onde: 'frente', fimC: (c, p, int, M) => { const r = M.remedios[p.id]; if (!r.hoje) { r.hoje = true; r.dias += 1; } } },
  esperar: { ic: '⏳', rot: 'Esperando', dur: 5, pose: 'parado', onde: 'local' },
};
export const ACOES_INFO = ACOES;
export const ROTULO_ACAO = Object.fromEntries(Object.entries(ACOES).map(([k, v]) => [k, v.rot]));

/* ---------- Sintomas (o que o paciente sente) ---------- */
export function sintomasDe(S, cfg, pid) {
  const p = achaPessoa(S, pid);
  const dia = diaDoJogo(S);
  const out = [];
  if (p.dengue.ativa) out.push(...cfg.cond.dengue.queixas.slice(0, 3));
  for (const id of ['dm', 'dep']) {
    if (p.cond[id].estagio >= 2 && !p.cond[id].ctrl) { const q = cfg.cond[id].queixas; out.push(q[hash(`${pid}${id}${Math.floor(dia / 4)}`) % q.length]); }
  }
  if (S.mundo.needs[pid].energia < 25) out.push('cansaço');
  return [...new Set(out)];
}

/* ---------- Decisão autônoma ("vontade própria") ---------- */
function decidir(W, S, cfg, a, p, f, n, c, int) {
  const M = S.mundo, m = minutoDoDia(S), dow = diaSemana(S), util = dow < 5;
  const oc = p.ocupacao || 'casa';
  const mundo = cfg.cenario.mundo;
  const temLanche = (W.porTipo.L || []).length > 0;

  // atendimento marcado (convite, retorno ou procura espontânea)
  const ord = W.ordens.find((o) => o.pid === p.id);
  if (ord && ord.estado === 'pendente' && !(a.acao && a.acao.k === 'dormir')) {
    const abre = ubsAberta(W, S, cfg, ord.tipo === 'consulta') && m >= mundo.expediente[0] * 60 + 15 && m < mundo.expediente[1] * 60 - 60;
    if (abre) {
      if (!ord.rolou) {
        ord.rolou = true;
        if (!ord.espontaneo && rnd(M) > adesao(f)) {
          W.ordens.splice(W.ordens.indexOf(ord), 1);
          avisar(W, S, `${p.nome} não compareceu à unidade (vínculo baixo: é mais difícil ir).`, 'info', { pessoaId: p.id });
          return null;
        }
      }
      ord.estado = 'indo';
      return { k: 'ubs', ord };
    }
  }
  if (p.dengue.ativa && f.vinculo >= 50 && !a.procurou && !ord) {
    a.procurou = true;
    W.ordens.push({ pid: p.id, tipo: 'consulta', estado: 'pendente', espontaneo: true, rolou: false, origem: 'sintoma', t0: M.min });
  }
  if (p.dengue.ativa) return { k: 'doente' };

  // sono
  const dormeAs = 22 * 60 + Math.round(((100 - p.habitos.sono) / 100) * 150) - Math.round(60 * int.sono);
  const noite = m >= dormeAs || m < 5 * 60;
  if ((noite && n.energia < 97) || n.energia < 18) return { k: 'dormir' };

  // higiene e refeições
  const refeicao = (forcaRapida) => {
    const ph = clamp(0.3 + 0.65 * p.habitos.alimentacao / 100 + 0.4 * int.alimentacao, 0, 0.98);
    return { k: 'cozinhar', saudavel: forcaRapida ? false : rnd(M) < ph };
  };
  if (n.higiene < 35 || (m >= 6 * 60 && m < 8 * 60 && n.higiene < 80)) return { k: 'banho' };
  if (m >= 6 * 60 && m < 9 * 60 && !c.cafe && n.fome < 85) { c.cafe = true; return refeicao(); }
  if (m >= 12 * 60 && m < 14 * 60 && !c.almoco && n.fome < 92) {
    c.almoco = true;
    const pFast = clamp(((100 - p.habitos.alimentacao) / 100) * 0.9 - int.alimentacao * 0.5, 0, 0.9);
    if (temLanche && mundo.almoco === 'lanchonete' && rnd(M) < Math.max(0.15, pFast)) return { k: 'lanche' };
    return refeicao();
  }
  if (m >= 19 * 60 && m < 21 * 60 && !c.jantar && n.fome < 92) { c.jantar = true; return refeicao(); }
  if (n.fome < 25) return refeicao();

  if (p.tabagismo && m >= M.fumar[p.id] && m < 22 * 60) { M.fumar[p.id] = m + 150 + rint(M, 0, 60); return { k: 'fumar' }; }

  // trabalho e escola
  if (util && oc === 'trabalho' && !p.dengue.ativa) {
    if (m >= 7.5 * 60 && m < 12 * 60) return { k: mundo.trabalho === 'R' ? 'roca' : 'trabalho', fim: 12 * 60 };
    if (m >= 13 * 60 && m < 17 * 60) return { k: mundo.trabalho === 'R' ? 'roca' : 'trabalho', fim: 17 * 60 };
  }
  if (util && oc === 'escola' && m >= 7 * 60 && m < 12 * 60) return { k: 'escola', fim: 12 * 60 };

  // lazer
  if (m < 6 * 60 + 30 || m >= 22 * 60) return { k: 'tv' };
  const temPraca = objetosDe(W, 'P', null).length > 0, temAcad = objetosDe(W, 'A', null).length > 0;
  const ativ = p.habitos.atividade / 100 + int.atividade * 0.8;
  const fresco = (m >= 6.5 * 60 && m < 10 * 60) || (m >= 16 * 60 && m < 20 * 60);
  const fatorEx = (fresco ? 1 : 0.15) * (c.exMin >= 60 ? 0.1 : 1) * (!util ? 1.3 : 1);
  const op = [['tv', 0.9 + (1 - ativ) * 1.6 + (n.humor < 40 ? 0.5 : 0)]];
  op.push(['caminhar', (0.15 + ativ * 0.9) * fatorEx]);
  if (temPraca) op.push(['praca', 0.25 + (1 - ativ) * 0.3]);
  if (temAcad && p.idade >= 14) op.push(['academia', (0.05 + ativ * 0.6 + int.atividade * 0.6) * fatorEx]);
  if (!temPraca) op.push(['conversar', (0.2 + ativ * 0.5) * fatorEx]);
  if (p.idade >= 6 && objetosDe(W, 'N', p.familiaId).length) op.push(['ler', 0.3 + (1 - ativ) * 0.4 + (p.idade >= 60 ? 0.5 : 0) + (p.ocupacao === 'escola' ? 0.2 : 0)]);
  if (temLanche && mundo.almoco === 'lanchonete' && m >= 17 * 60 && p.idade >= 14) op.push(['lanche', 0.1 + ((100 - p.habitos.alimentacao) / 100) * 0.8 - int.alimentacao * 0.4]);
  if (p.idade < 12) return { k: escolhe(M, [['tv', 1], ['praca', temPraca ? 0.9 * fatorEx : 0], ['caminhar', 0.5 * fatorEx], ['conversar', temPraca ? 0 : 0.5 * fatorEx]]) };
  return { k: escolhe(M, op.map(([k, w]) => [k, Math.max(0.02, w)])) };
}

const CAPACIDADE = { B: 2 };
/** Quantas pessoas (além de `a`) estão usando ou indo usar o móvel. */
function ocupantes(W, o, a) {
  let n = 0;
  for (const x of W.agentes) {
    if (x === a || !x.vis) continue;
    if ((x.acao && x.acao.obj === o) || (x.pend && x.pend.obj === o) || x.cadeira === o) n++;
  }
  return n;
}
/** Escolhe um móvel livre da lista, começando por um ponto "preferido" estável para cada pessoa. */
function moveLivre(W, lista, p, a, ini = 0) {
  if (!lista.length) return null;
  const base = hash(p.id) % lista.length;
  for (let k = 0; k < lista.length; k++) {
    const o = lista[(base + ini + k) % lista.length];
    if (ocupantes(W, o, a) < (CAPACIDADE[o.t] || 1)) return o;
  }
  return null;
}
/** Pontos de uso sem ninguém parado em cima (se todos estiverem ocupados, usa todos). */
function pontosLivres(W, pontos, a) {
  const livres = pontos.filter((q) => !W.agentes.some((x) => x !== a && x.vis && !x.path.length && Math.round(x.x) === q.x && Math.round(x.y) === q.y));
  return livres.length ? livres : pontos;
}

function partir(W, S, cfg, a, p, alvos) {
  if (!irPara(W, a, alvos)) return false;
  if (!a.path.length) chegada(W, S, cfg, a, p);
  return true;
}

function pontoAleatorio(W, M, a) {
  for (let t = 0; t < 40; t++) {
    const x = clamp(Math.round(a.x) + rint(M, -9, 9), 0, W.w - 1), y = clamp(Math.round(a.y) + rint(M, -9, 9), 0, W.h - 1);
    const k = y * W.w + x;
    if (!W.bloq[k] && (W.terr[k] === '.' || W.terr[k] === ',' || W.terr[k] === 'c')) return { x, y };
  }
  return null;
}

/** Primeiro ponto caminhável (ao ar livre) perto de (x, y). */
function pontoLivreEm(W, x, y) {
  for (let r = 0; r <= 5; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const nx = Math.round(x) + dx, ny = Math.round(y) + dy;
    if (nx < 1 || ny < 1 || nx >= W.w - 1 || ny >= W.h - 1) continue;
    const k = ny * W.w + nx, c = W.terr[k];
    if (!W.bloq[k] && (c === '.' || c === ',' || c === 'c')) return { x: nx, y: ny };
  }
  return null;
}

/** Percurso de uma caminhada de verdade: um circuito em volta da praça (ou do quarteirão) e de volta para casa. */
function planejarCaminhada(W, a, p) {
  const refs = [...(W.porTipo.P || []), ...(W.porTipo.K || []), ...(W.porTipo.A || [])];
  const centro = refs.length ? { x: refs.reduce((s, o) => s + o.x, 0) / refs.length, y: refs.reduce((s, o) => s + o.y, 0) / refs.length } : { x: a.x, y: a.y };
  const raio = refs.length ? 5 : 7;
  const pontos = [];
  const n = 5;
  const inicio = hash(p.id) % 360;
  for (let i = 0; i < n; i++) {
    const ang = ((inicio + (360 / n) * i) * Math.PI) / 180;
    const q = pontoLivreEm(W, centro.x + Math.cos(ang) * raio, centro.y + Math.sin(ang) * raio * 0.8);
    if (q && !pontos.some((o) => o.x === q.x && o.y === q.y)) pontos.push(q);
  }
  const casa = W.casas[p.familiaId].porta.fora;
  pontos.push({ x: casa.x, y: casa.y });
  return pontos;
}

/** Começa a executar uma decisão (ou comando): escolhe o objeto/local e calcula a rota. */
function iniciarDecisao(W, S, cfg, a, p, d) {
  if (d.k === 'ubs') {
    const livres = objetosDe(W, 'H', null).filter((o) => ocupantes(W, o, a) === 0);
    const lista = livres.length ? livres : objetosDe(W, 'H', null);
    const alvos = lista.flatMap((o) => pontosDeUso(W, o));
    a.pend = { k: 'ubs', ord: d.ord };
    a.cadeira = null;
    if (!partir(W, S, cfg, a, p, alvos)) { a.pend = null; d.ord.estado = 'pendente'; return; }
    return;
  }
  const def = ACOES[d.k];
  const dur = d.dur || def.dur || 30;
  if (!d.continua) {
    a.proximos = d.proximos ? [...d.proximos] : [];
    if (d.k === 'cozinhar') a.proximos.push({ k: 'comer_mesa' });
    if (d.k === 'caminhar') {
      const rota = planejarCaminhada(W, a, p);
      d = { ...d, alvo: rota[0] };
      a.proximos = rota.slice(1).map((q) => ({ k: 'caminhar', alvo: q }));
    }
  }
  if (d.k === 'cozinhar') a.refeicao = { saudavel: d.saudavel !== false };
  const semLocal = () => { a.pend = null; a.proximos = []; a.acao = { k: d.k, restante: Math.min(30, dur), sem: true }; };
  const ocupado = () => {
    a.pend = null; a.proximos = [];
    if (a.jogador && (d.tent || 0) < 40) {
      // o jogador espera a vez: a ordem volta para o início da fila
      a.fila.unshift({ k: 'acao', acao: d.k, obj: d.obj, saudavel: d.saudavel, dur: d.dur, tent: (d.tent || 0) + 1 });
      a.acao = { k: 'esperar', restante: 3, sem: true };
    } else if (a.jogador) avisar(W, S, 'Esse lugar continua ocupado. Tente de novo mais tarde.', 'info');
    else a.acao = { k: 'esperar', restante: 4, sem: true };
  };
  if (def.obj || d.obj) {
    const casa = def.casa ? p.familiaId : null;
    let lista = d.obj ? [d.obj] : objetosDe(W, def.obj, casa);
    if (!lista.length && d.k === 'comer_mesa') lista = objetosDe(W, 'G', casa);
    if (!lista.length) return semLocal();
    const o = d.obj && lista.length === 1 ? (ocupantes(W, d.obj, a) < (CAPACIDADE[d.obj.t] || 1) ? d.obj : null) : moveLivre(W, lista, p, a);
    if (!o) {
      if (!a.jogador && ['tv', 'praca', 'academia'].includes(d.k)) return iniciarDecisao(W, S, cfg, a, p, { k: 'caminhar' });
      return ocupado();
    }
    a.pend = { k: d.k, dur, fim: d.fim, obj: o };
    if (!partir(W, S, cfg, a, p, pontosLivres(W, pontosDeUso(W, o), a))) semLocal();
    return;
  }
  if (def.local === 'porta') {
    a.pend = { k: d.k, dur };
    if (!partir(W, S, cfg, a, p, [W.casas[p.familiaId].porta.fora])) semLocal();
    return;
  }
  if (def.local === 'rua') {
    const q = d.alvo || pontoAleatorio(W, S.mundo, a);
    a.pend = { k: d.k, dur, andar: true };
    if (!q || !partir(W, S, cfg, a, p, [q])) semLocal();
  }
}

/* ---------- Moradores ---------- */
function mover(a, dt, vel) {
  let d = vel * dt;
  while (d > 0 && a.path.length) {
    const t = a.path[0];
    const dx = t.x - a.x, dy = t.y - a.y, dist = Math.hypot(dx, dy);
    if (dx) a.facing = dx > 0 ? 1 : -1;
    if (dist <= d) { a.x = t.x; a.y = t.y; a.path.shift(); d -= dist; } else { a.x += (dx / dist) * d; a.y += (dy / dist) * d; d = 0; }
  }
}

function limparOrdens(W, pid) { W.ordens = W.ordens.filter((o) => o.pid !== pid); }

function passoMorador(W, S, cfg, a, dt) {
  const p = achaPessoa(S, a.pid), f = achaFamilia(S, p.familiaId), M = S.mundo;
  const n = M.needs[a.pid], c = M.dia[a.pid], int = M.intencao[a.pid];
  if (p.internado) { a.vis = false; a.path = []; a.acao = null; a.pend = null; a.espera = null; a.atend = null; a.fila = []; a.proximos = []; limparOrdens(W, p.id); return; }
  if (!a.vis) posicionarEmCasa(W, S, a);

  const dormindo = a.acao && a.acao.k === 'dormir';
  n.fome -= (dormindo ? 0.02 : 0.065) * dt;
  if (!dormindo) n.energia -= 0.05 * dt;
  n.higiene -= 0.03 * dt;
  n.disp -= 0.03 * dt;
  const media = (n.fome + n.energia + n.higiene + n.disp) / 4;
  n.humor += (media - n.humor) * 0.004 * dt;
  if (p.cond.dep.estagio >= 2 && !p.cond.dep.ctrl) n.humor -= 0.02 * dt;

  if (a.pausa > 0) { a.pausa -= dt; } // conversando com um profissional
  else if (a.path.length) {
    mover(a, dt, W.vel);
    c.exMin += dt * 0.25;
    if (a.pend && a.pend.andar) c.exMin += dt * 0.5;
    if (!a.path.length) chegada(W, S, cfg, a, p);
  } else if (a.atend) {
    n.humor -= 0.005 * dt;
  } else if (a.espera) {
    n.humor -= 0.01 * dt;
    a.espera.esperou = (a.espera.esperou || 0) + dt;
    if (a.espera.esperou > 200 && !(a.jogador && S.jogador.modo === 'paciente' && false)) {
      avisar(W, S, `${p.nome} cansou de esperar e foi embora sem ser atendido(a).`, 'alerta', { pessoaId: p.id });
      limparOrdens(W, p.id); a.espera = null; a.cadeira = null; n.humor = clamp(n.humor - 10, 0, 100);
    }
  } else if (a.acao) {
    const def = ACOES[a.acao.k];
    if (def.ef) def.ef(n, dt);
    if (def.cont) c[def.cont] += dt;
    if (def.exLeve) c.exMin += dt * def.exLeve;
    a.acao.restante -= dt;
    const alarme = a.acao.k === 'dormir' && minutoDoDia(S) >= 6 * 60 && minutoDoDia(S) < 12 * 60 && diaSemana(S) < 5 && ['trabalho', 'escola'].includes(p.ocupacao) && !a.jogador;
    const fim = alarme || (def.fim && def.fim(n)) || a.acao.restante <= 0 || (def.max && (a.acao.t = (a.acao.t || 0) + dt) > def.max);
    if (fim) {
      if (def.fimC) def.fimC(c, p, int, M, a);
      const prox = a.proximos.shift();
      a.acao = null;
      a.ocioso = 0;
      if (prox) iniciarDecisao(W, S, cfg, a, p, { ...prox, continua: true });
    }
  } else {
    a.ocioso += dt;
    if (a.jogador) {
      if (a.fila.length) { const cmd = a.fila.shift(); executarComando(W, S, cfg, a, p, cmd); }
      else if (S.jogador.vontade && a.ocioso >= 12) { const d = decidir(W, S, cfg, a, p, f, n, c, int); if (d) iniciarDecisao(W, S, cfg, a, p, d); }
    } else {
      const d = decidir(W, S, cfg, a, p, f, n, c, int);
      if (d) iniciarDecisao(W, S, cfg, a, p, d);
      else a.acao = { k: 'esperar', restante: 5, sem: true };
    }
  }
  for (const k of NECESSIDADES) n[k] = clamp(n[k], 0, 100);
  c.humorSoma += n.humor * dt; c.humorN += dt;
}

function chegada(W, S, cfg, a, p) {
  const pend = a.pend;
  a.pend = null;
  if (!pend) return;
  if (pend.k === 'ubs') {
    const ord = pend.ord;
    ord.estado = 'espera';
    ord.t0 = S.mundo.min; // a espera conta a partir da chegada à unidade
    a.espera = ord;
    a.cadeira = (W.porTipo.H || []).find((o) => Math.abs(o.x - a.x) + Math.abs(o.y - a.y) === 1 && ocupantes(W, o, a) === 0) || null;
    return;
  }
  if (pend.k === 'atendido') { a.atend.pronto = true; return; }
  if (pend.k === 'chegar') return;
  const def = ACOES[pend.k];
  if (!def) return;
  const dur = pend.fim != null ? Math.max(5, pend.fim - minutoDoDia(S)) : (pend.dur || def.dur || 30);
  a.acao = { k: pend.k, restante: dur, obj: pend.obj };
}

/** Executa um comando do jogador (paciente). */
function executarComando(W, S, cfg, a, p, cmd) {
  a.ocioso = 0;
  if (cmd.k === 'ir') {
    a.pend = { k: 'chegar' };
    const alvo = caminhavel(W, cmd.x, cmd.y) ? [{ x: cmd.x, y: cmd.y }] : vizinhosDe(W, cmd.x, cmd.y);
    if (!alvo.length || !irPara(W, a, alvo)) { a.pend = null; avisar(W, S, 'Não consigo chegar até lá.', 'info'); }
    return;
  }
  if (cmd.k === 'ubs') {
    const m = minutoDoDia(S);
    if (!ubsAberta(W, S, cfg, cmd.tipo === 'consulta')) { avisar(W, S, `A unidade não atende agora${cmd.tipo === 'consulta' && !ubsAberta(W, S, cfg) ? '' : ' (sem médico hoje)'}. Veja o horário na aba Unidade.`, 'alerta'); return; }
    if (m >= cfg.cenario.mundo.expediente[1] * 60 - 60) { avisar(W, S, 'Já é tarde: a unidade está quase fechando. Tente amanhã cedo.', 'alerta'); return; }
    limparOrdens(W, p.id);
    const ord = { pid: p.id, tipo: 'triagem', estado: 'indo', espontaneo: true, rolou: true, origem: 'paciente', meta: { consulta: cmd.tipo === 'consulta' }, t0: S.mundo.min };
    W.ordens.push(ord);
    iniciarDecisao(W, S, cfg, a, p, { k: 'ubs', ord });
    return;
  }
  if (cmd.k === 'acao') iniciarDecisao(W, S, cfg, a, p, { k: cmd.acao, obj: cmd.obj, saudavel: cmd.saudavel, dur: cmd.dur, proximos: cmd.proximos, tent: cmd.tent });
}

/* ---------- Equipe da UBS ---------- */
function postoDe(W, papel, ind) {
  if (papel === 'tecnico') { const o = (W.porTipo.U || [])[0]; return o ? pontosDeUso(W, o) : []; }
  if (papel === 'medico') { const o = (W.porTipo.D || [])[0]; return o ? pontosDeUso(W, o) : []; }
  if (papel === 'enfermeiro') { const o = (W.porTipo.D || [])[1] || (W.porTipo.D || [])[0]; return o ? pontosDeUso(W, o) : []; }
  const copa = (W.porTipo.W || []).flatMap((o) => pontosDeUso(W, o));
  if (copa.length) return [copa[ind % copa.length]]; // ACS espera na copa, fora da passagem dos pacientes
  const p = W.ubs.porta.fora;
  return [{ x: p.x + ind - 1, y: p.y }];
}
const servicoDe = (papel) => (papel === 'tecnico' ? 'triagem' : papel === 'enfermeiro' ? 'enfermagem' : 'consulta');
const objetoDoServico = (W, papel) => (papel === 'tecnico' ? (W.porTipo.U || [])[0] : (W.porTipo.D || [])[papel === 'enfermeiro' ? 1 : 0] || (W.porTipo.D || [])[0]);

export function filaEspera(W, tipo) {
  return W.ordens.filter((o) => o.estado === 'espera' && (!tipo || o.tipo === tipo)).sort((x, y) => x.t0 - y.t0);
}

function piorHabito(p) {
  const h = p.habitos;
  const c = [['atividade', h.atividade], ['alimentacao', h.alimentacao], ['sono', h.sono]];
  if (p.tabagismo) c.push(['fumo', 15]);
  if (h.estresse > 60) c.push(['estresse', 100 - h.estresse]);
  return c.sort((x, y) => x[1] - y[1])[0][0];
}

/** O profissional chama o próximo paciente da fila do seu serviço. */
function chamarPaciente(W, S, cfg, a, ord) {
  const pac = W.agentes.find((x) => x.k === 'res' && x.pid === ord.pid);
  if (!pac || !pac.espera) return false;
  const obj = objetoDoServico(W, a.papel);
  const posto = postoDe(W, a.papel, a.ind);
  const pontos = pontosDeUso(W, obj).filter((q) => !posto.length || q.x !== posto[0].x || q.y !== posto[0].y);
  const spot = pontos[0] || posto[0];
  ord.estado = 'atendimento';
  S.metricas.esperaTotal += Math.max(0, S.mundo.min - ord.t0);
  pac.atend = { staff: a.id, spot, pronto: false, tipo: ord.tipo };
  pac.pend = { k: 'atendido' };
  if (!irPara(W, pac, [spot]) || !pac.path.length) { pac.pend = null; pac.atend.pronto = true; }
  a.tarefa = { tipo: ord.tipo, pac: pac.id, ord, fase: 'chamando', restante: 0 };
  return true;
}

const duracaoServico = (W, S, cfg, a, tipo) => Math.max(5, Math.round((tipo === 'triagem' ? 10 : tipo === 'enfermagem' ? 25 : duracaoConsulta(S)) * fatorEquipe(W, S, cfg, a)));

function aplicarServico(W, S, cfg, a, t) {
  const p = achaPessoa(S, t.ord.pid);
  const partes = [];
  if (t.tipo === 'triagem') {
    if (t.ord.meta && t.ord.meta.motivo) partes.push(`(${t.ord.meta.motivo})`);
    const r = p.idade >= 18 ? acaoMedir(S, cfg, p.id) : { ok: true, msg: 'Sinais vitais normais para a idade.' };
    partes.push(r.msg); S.metricas.triagens++;
  } else if (t.tipo === 'enfermagem') {
    if (t.ord.meta && t.ord.meta.motivo) partes.push(`(${t.ord.meta.motivo})`);
    if (p.idade >= 18 && p.conhecido.medidasTurno !== S.turno) partes.push(acaoMedir(S, cfg, p.id).msg);
    const foco = (t.opts && t.opts.foco) || piorHabito(p);
    const r = acaoOrientar(S, cfg, p.id, foco);
    if (r.ok && foco !== 'fumo') { const it = S.mundo.intencao[p.id]; if (foco in it) it[foco] = clamp(it[foco] + 0.5, 0, 1); }
    partes.push(r.msg); S.metricas.orientacoes++;
  } else {
    const leve = t.ord.meta && t.ord.meta.leve && !p.dengue.ativa && !CONDS.some((id) => p.cond[id].estagio >= 2 && !p.cond[id].diag);
    if (leve) partes.push(`Queixa leve (${t.ord.meta.motivo}): examinado(a), orientado(a) e liberado(a).`);
    else partes.push(acaoConsulta(S, cfg, p.id).msg);
    if (!leve) p.retornoTurno = S.turno;
    S.metricas.atendidos++;
  }
  const texto = `${t.tipo === 'triagem' ? '📏 Triagem' : t.tipo === 'enfermagem' ? '🩺 Enfermagem' : '🩺 Consulta'} — ${p.nome}: ${partes.join(' ')}`;
  t.resultado = partes.join(' ');
  avisar(W, S, texto, 'info', { pessoaId: p.id });
}

/** Termina o atendimento: libera a pessoa ou a encaminha ao próximo serviço. */
function concluirAtendimento(W, S, cfg, a, destino) {
  const t = a.tarefa;
  if (!t) return;
  const pac = W.agentes.find((x) => x.id === t.pac);
  const ord = t.ord;
  if (pac) { pac.atend = null; pac.pend = null; pac.espera = null; pac.cadeira = null; pac.ocioso = 0; }
  if (destino === 'liberar' || !pac) {
    W.ordens = W.ordens.filter((o) => o !== ord);
  } else {
    ord.tipo = destino;
    const receptor = destino === 'consulta' ? 'medico' : 'enfermeiro';
    const vinc = vinculoEquipe(S, cfg, a.papel, receptor);
    if (a.papel !== receptor && rnd(S.mundo) < 0.28 * (1 - vinc / 100)) {
      ord.t0 = S.mundo.min + 25; // o encaminhamento se perde: a pessoa volta para o fim da fila
      S.metricas.falhasComunicacao = (S.metricas.falhasComunicacao || 0) + 1;
      if (a.jogador) avisar(W, S, `⚠️ Falha de comunicação: faltou alinhamento com ${nomePapel(cfg, receptor).toLowerCase()} e o encaminhamento de ${achaPessoa(S, ord.pid).nome} se perdeu — ela volta para o fim da fila. Cuide do vínculo com a equipe.`, 'alerta');
    } else mudaEquipe(S, cfg, a.papel, receptor, 0.4);
    if (destino === 'consulta' && !ubsAberta(W, S, cfg, true)) { ord.estado = 'pendente'; ord.rolou = true; ord.espontaneo = true; avisar(W, S, `${achaPessoa(S, ord.pid).nome} precisa de consulta médica, mas o médico não atende hoje: volta no próximo dia de médico.`, 'info', { pessoaId: ord.pid }); }
    else { ord.estado = 'espera'; if (pac) pac.espera = ord; }
  }
  a.tarefa = null;
  W.sinal++;
}

/** Decisão automática dos profissionais não controlados. */
function rotearAuto(W, S, cfg, a, t) {
  const p = achaPessoa(S, t.ord.pid);
  if (t.tipo === 'triagem') {
    const sint = sintomasDe(S, cfg, p.id).length > 0;
    if (p.dengue.ativa || p.conhecido.suspeitas.length || sint || (t.ord.meta && t.ord.meta.consulta) || t.ord.origem === 'retorno') return 'consulta';
    const risco = p.idade >= 18 && (p.conhecido.risco.length || p.habitos.atividade < 40 || p.habitos.alimentacao < 40 || p.tabagismo);
    return risco ? 'enfermagem' : 'liberar';
  }
  if (t.tipo === 'enfermagem') return p.conhecido.suspeitas.length ? 'consulta' : 'liberar';
  for (const id of CONDS) if (p.cond[id].diag && !p.cond[id].trat) acaoTratamento(S, cfg, p.id, id, true);
  return 'liberar';
}

function passoEquipe(W, S, cfg, a, dt) {
  const abertoGeral = ubsAberta(W, S, cfg);
  const deveEstar = abertoGeral; // o médico também está na unidade nos dias sem consultório (visitas, receitas, reuniões)
  if (!a.vis) {
    if (!deveEstar) return;
    a.vis = true;
    const q = W.ubs.porta.fora;
    a.x = q.x; a.y = q.y; a.path = []; a.tarefa = null;
  }
  if (!deveEstar && !a.tarefa && !a.path.length) {
    a.vis = false; a.fila = []; soltaAfazer(W, a);
    if (a.papel !== 'acs') for (const o of W.ordens) if (o.estado === 'espera' && o.tipo === servicoDe(a.papel)) { const pac = W.agentes.find((x) => x.pid === o.pid); o.estado = 'pendente'; o.rolou = true; if (pac) pac.espera = null; }
    return;
  }
  if (a.pausaEquipe > 0) a.pausaEquipe -= dt;
  if (a.path.length) { mover(a, dt, W.vel); return; }
  garanteAgenda(W, S, cfg, a);
  if (a.pausaEquipe > 0 && !a.tarefa && !a.afz && !a.jogador) return; // conversando com um colega
  if (a.afz && !a.tarefa) { passoAfazer(W, S, cfg, a, dt); return; }
  if (a.papel === 'acs') return passoACS(W, S, cfg, a, dt);

  const posto = postoDe(W, a.papel, a.ind);
  const naPos = posto.find((q) => q.x === a.x && q.y === a.y);
  const servico = servicoDe(a.papel);

  if (!a.tarefa) {
    if (a.jogador && a.fila.length) {
      const cmd = a.fila.shift();
      if (cmd.k === 'ir') { const alvo = caminhavel(W, cmd.x, cmd.y) ? [{ x: cmd.x, y: cmd.y }] : vizinhosDe(W, cmd.x, cmd.y); irPara(W, a, alvo); return; }
      if (cmd.k === 'chamar') { const ord = W.ordens.find((o) => o.pid === cmd.pid && o.estado === 'espera' && o.tipo === servico); if (ord) chamarPaciente(W, S, cfg, a, ord); return; }
      if (cmd.k === 'afazer') { const it = cmd.item || itemDaAgenda(W, a, cmd.uid); if (it && !it.feito) iniciarAfazer(W, S, cfg, a, it); return; }
    }
    if (a.jogador) return; // o jogador decide quem chamar e o que fazer
    const prox = filaEspera(W, servico).find((o) => { const pac = W.agentes.find((x) => x.pid === o.pid); return pac && pac.espera && !pac.atend; });
    if (prox) {
      if (!naPos && posto.length) { irPara(W, a, [posto[0]]); return; }
      chamarPaciente(W, S, cfg, a, prox);
      return;
    }
    if (iniciarProximoAfazer(W, S, cfg, a)) return;
    if (!naPos && posto.length) irPara(W, a, [posto[0]]);
    return;
  }

  const t = a.tarefa;
  const pac = W.agentes.find((x) => x.id === t.pac);
  if (!pac || !pac.atend) { a.tarefa = null; return; }
  if (t.fase === 'chamando') {
    if (!naPos && posto.length) { if (!a.path.length) irPara(W, a, [posto[0]]); return; }
    if (!pac.atend.pronto) return;
    t.fase = 'pronto';
    if (!a.jogador) { t.fase = 'atendendo'; t.restante = duracaoServico(W, S, cfg, a, t.tipo); }
    return;
  }
  if (t.fase === 'atendendo') {
    t.restante -= dt;
    if (t.restante > 0) return;
    aplicarServico(W, S, cfg, a, t);
    if (a.jogador) { t.fase = 'resultado'; W.sinal++; return; }
    concluirAtendimento(W, S, cfg, a, rotearAuto(W, S, cfg, a, t));
  }
  // fases 'pronto' e 'resultado' do jogador esperam a decisão pela interface
}

/* ---------- Vínculo entre profissionais ("ninguém faz nada sozinho") ---------- */
const chaveEq = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const PARES_EQUIPE = [];
for (let i = 0; i < PAPEIS.length; i++) for (let j = i + 1; j < PAPEIS.length; j++) PARES_EQUIPE.push(chaveEq(PAPEIS[i], PAPEIS[j]));

function estadoEquipe(S, cfg) {
  const M = S.mundo;
  if (!M.equipe) {
    const ini = cfg.cenario.mundo.equipeVinculo === undefined ? 50 : cfg.cenario.mundo.equipeVinculo;
    M.equipe = {};
    for (const k of PARES_EQUIPE) M.equipe[k] = ini;
  }
  return M.equipe;
}
export function vinculoEquipe(S, cfg, a, b) { return a === b ? 100 : estadoEquipe(S, cfg)[chaveEq(a, b)]; }
function mudaEquipe(S, cfg, a, b, delta) {
  if (a === b) return;
  const e = estadoEquipe(S, cfg), k = chaveEq(a, b);
  e[k] = clamp(e[k] + delta, 5, 100);
}
/** Média do vínculo de um papel com os demais (0–100). */
export function coesaoDe(S, cfg, papel) {
  const outros = PAPEIS.filter((p) => p !== papel);
  return outros.reduce((t, p) => t + vinculoEquipe(S, cfg, papel, p), 0) / outros.length;
}
export function vinculosEquipe(S, cfg) {
  return PARES_EQUIPE.map((k) => { const [a, b] = k.split('|'); return { a, b, v: Math.round(estadoEquipe(S, cfg)[k]) }; });
}
/** Equipe afinada trabalha mais rápido; equipe desencontrada, mais devagar. */
function fatorEquipe(W, S, cfg, a) {
  let f = 1.3 - 0.5 * coesaoDe(S, cfg, a.papel) / 100;
  if ((W.apoio[a.id] || 0) > S.mundo.min) f *= 0.85;
  return f;
}
const nomePapel = (cfg, papel) => cfg.papeis[papel].nome;

/* ---------- Afazeres do dia (trabalho de bastidor e de campo) ---------- */
// local: D consultório · Y farmácia · U triagem · H sala de espera · Z arquivo · W copa · seat (sala de reunião) · ubs (recepção) · campo (casa) · colega
export const AFAZERES = {
  medico: [
    { id: 'prontuarios', rot: 'Revisar prontuários e exames', ic: '🗂️', local: 'Z', dur: 30 },
    { id: 'receitas', rot: 'Renovar receitas de quem está em tratamento', ic: '📝', local: 'D', dur: 25 },
    { id: 'caso', rot: 'Discutir casos com a enfermagem', ic: '🗣️', local: 'seat', dur: 25, equipe: ['medico', 'enfermeiro'] },
    { id: 'visita_med', rot: 'Visita domiciliar (consulta em casa)', ic: '🏠', local: 'campo', dur: 45, campo: true },
  ],
  enfermeiro: [
    { id: 'educacao', rot: 'Roda de conversa na sala de espera', ic: '🗣️', local: 'H', dur: 30 },
    { id: 'estoque', rot: 'Conferir estoque e farmácia', ic: '📦', local: 'Y', dur: 25 },
    { id: 'supervisao', rot: 'Supervisionar o técnico e os registros', ic: '📋', local: 'U', dur: 25 },
    { id: 'cadastro', rot: 'Atualizar cadastros do território', ic: '🗂️', local: 'Z', dur: 30 },
    { id: 'visita_enf', rot: 'Visita domiciliar (acompanhar tratamento)', ic: '🏠', local: 'campo', dur: 40, campo: true },
  ],
  tecnico: [
    { id: 'sala_espera', rot: 'Aferir a pressão de quem aguarda', ic: '📏', local: 'H', dur: 20 },
    { id: 'estoque', rot: 'Organizar farmácia e insumos', ic: '📦', local: 'Y', dur: 25 },
    { id: 'esterilizar', rot: 'Esterilizar e organizar a sala', ic: '🧼', local: 'D', dur: 25 },
    { id: 'registros', rot: 'Digitar registros e fichas', ic: '⌨️', local: 'Z', dur: 25 },
    { id: 'curativos', rot: 'Curativos e procedimentos simples', ic: '🩹', local: 'D', dur: 25 },
  ],
  acs: [
    { id: 'cadastro_acs', rot: 'Atualizar o cadastro de uma família', ic: '📇', local: 'campo', dur: 40, campo: true },
    { id: 'busca_ativa', rot: 'Busca ativa de quem precisa de acompanhamento', ic: '🔎', local: 'campo', dur: 45, campo: true },
    { id: 'repasse', rot: 'Repassar os casos do território para a equipe', ic: '📞', local: 'U', dur: 20 },
  ],
};
const CAFE = { id: 'cafe', rot: 'Pausa para o café e conversa com a equipe', ic: '☕', local: 'W', dur: 15 };
export const REUNIAO = { id: 'reuniao', rot: 'Reunião de equipe', ic: '👥', local: 'seat', dur: 25, equipe: true };
const CONVERSA_COLEGA = { id: 'colega_conversar', rot: 'Conversar com colega', ic: '💬', local: 'colega', dur: 12, ganho: 3 };
const CASO_COLEGA = { id: 'colega_caso', rot: 'Discutir um caso com colega', ic: '🗂️', local: 'colega', dur: 20, ganho: 4, apoio: true };
const DIAS_REUNIAO = [0, 3]; // reunião de equipe fixa: segunda e quinta

const riscoFamilia = (f) => f.pessoas.reduce((n, p) => n + (p.conhecido.suspeitas.length ? 2 : 0) + (CONDS.some((id) => p.cond[id].diag && !p.cond[id].trat) ? 2 : 0) + (CONDS.some((id) => p.cond[id].diag && p.cond[id].trat) ? 1 : 0) + (p.dengue.ativa ? 3 : 0), 0);

function gerarAgenda(W, S, cfg, a) {
  const M = S.mundo, mundo = cfg.cenario.mundo, dow = diaSemana(S);
  const semConsultorio = a.papel === 'medico' && !mundo.medicoDias.includes(dow);
  let n = (mundo.afazeres && mundo.afazeres[a.papel]) || 4;
  if (semConsultorio) n = Math.max(n, 6);
  const campoBase = (mundo.campo || {})[a.papel];
  const campoW = (campoBase === undefined ? 0.3 : campoBase) * (semConsultorio ? 2.5 : 1);
  const pool = [...AFAZERES[a.papel], CAFE];
  const lista = [];
  const poe = (def) => lista.push({ uid: String(lista.length), def, feito: false, falhas: 0 });
  if (DIAS_REUNIAO.includes(dow)) poe(REUNIAO);
  for (let guard = 0; lista.length < n && guard < 80; guard++) {
    const def = escolhe(M, pool.map((d) => [d, d.campo ? campoW : 1]));
    if (!def.campo && lista.some((x) => x.def.id === def.id)) continue;
    poe(def);
  }
  W.agenda[a.id] = { dia: diaDoJogo(S), lista, visitadas: [] };
}
function garanteAgenda(W, S, cfg, a) {
  const ag = W.agenda[a.id];
  if (!ag || ag.dia !== diaDoJogo(S)) gerarAgenda(W, S, cfg, a);
  return W.agenda[a.id];
}
const itemDaAgenda = (W, a, uid) => (W.agenda[a.id] ? W.agenda[a.id].lista.find((i) => i.uid === uid) : null);
const itemPorDef = (W, b, def) => { const ag = W.agenda[b.id]; return ag ? ag.lista.find((i) => i.def.id === def.id && !i.feito) || null : null; };

/** Lista para a interface: o que o profissional controlado tem para fazer hoje. */
export function afazeresDoDia(W, S, cfg) {
  const a = agenteJogador(W);
  if (!a || a.k !== 'staff' || !a.vis) return { lista: [], feitos: 0, total: 0, aberto: false };
  const ag = garanteAgenda(W, S, cfg, a);
  const emCurso = a.afz ? a.afz.item : null;
  const lista = ag.lista.map((i) => ({ uid: i.uid, rot: i.def.rot, ic: i.def.ic, campo: !!i.def.campo, equipe: !!i.def.equipe, feito: i.feito, andamento: i === emCurso }));
  return { lista, feitos: lista.filter((i) => i.feito).length, total: lista.length, aberto: true };
}

function escolheFamiliaCampo(W, S, a, ag) {
  const M = S.mundo;
  const cand = S.familias.filter((f) => !ag.visitadas.includes(f.id) && (a.papel !== 'acs' || f.visTurno !== S.turno))
    .sort((x, y) => riscoFamilia(y) - riscoFamilia(x));
  const pool = cand.length ? cand : S.familias;
  const topo = pool.slice(0, Math.min(3, pool.length));
  return topo[Math.floor(rnd(M) * topo.length)];
}

/** Larga o que está fazendo (e sai da reunião, se estiver nela). */
function soltaAfazer(W, a) {
  if (a.afz && a.afz.reuniao) sairDaReuniao(W, a);
  a.afz = null;
}

/* --- Reuniões de equipe: convocação, presença e quem não pôde comparecer --- */
function motivoIndisponivel(W, S, cfg, b, org) {
  if (!b.vis) return 'fora do expediente';
  if (b.tarefa) return b.papel === 'acs' ? 'em campo (visita ou mutirão)' : 'em atendimento';
  if (b.afz && b.afz.reuniao) return null;
  if (b.afz && b.afz.def.campo) return 'em visita no território';
  if (b.jogador && !org.jogador) return 'é você: participe pelos Afazeres do dia';
  if (rnd(S.mundo) < 0.2 * (1 - vinculoEquipe(S, cfg, org.papel, b.papel) / 100)) return 'agenda cheia (pouco alinhamento com a equipe)';
  return null;
}

function entrarNaReuniao(W, S, cfg, b, item, r) {
  if (b.afz && !b.afz.reuniao) b.afz = null;
  const usadas = Object.values(r.seat);
  const seat = (W.porTipo.Q || []).find((c) => !usadas.includes(c)) || null;
  r.seat[b.id] = seat;
  const pontos = seat ? pontosDeUso(W, seat) : pontosDeUso(W, W.porTipo.M[0]);
  b.afz = { item: item || { uid: 'x', def: r.def, feito: false, falhas: 0 }, def: r.def, fase: 'indo', restante: r.def.dur, fam: null, reuniao: true, seat };
  b.path = caminhoAte(W, b.x, b.y, pontos) || [];
  r.part[b.id] = 'indo';
}

function convocarReuniao(W, S, cfg, a, item) {
  const def = item.def;
  const alvo = def.equipe === true ? PAPEIS : def.equipe;
  if (!(W.porTipo.Q || []).length || !(W.porTipo.M || []).length) { item.feito = true; return false; }
  let r = W.reuniao;
  if (r) {
    if (r.papeis.includes(a.papel) && !r.part[a.id]) {
      entrarNaReuniao(W, S, cfg, a, item, r);
      if (a.jogador) avisar(W, S, `👥 Você foi para a ${r.def.rot.toLowerCase()} que já está acontecendo.`, 'info');
      return true;
    }
    if (a.jogador) avisar(W, S, 'Já há uma reunião acontecendo na sala da equipe. Aguarde terminar.', 'alerta');
    return false;
  }
  r = { org: a.id, def, papeis: alvo, part: {}, seat: {}, restante: def.dur, espera: 0, faltas: [] };
  const vao = [];
  for (const b of W.agentes) {
    if (b.k !== 'staff' || b === a || !alvo.includes(b.papel)) continue;
    const motivo = motivoIndisponivel(W, S, cfg, b, a);
    if (motivo) { r.faltas.push({ papel: b.papel, motivo, jogador: b.jogador }); continue; }
    vao.push(b);
  }
  if (!vao.length) {
    if (a.jogador) avisar(W, S, `👥 Ninguém pôde participar agora: ${r.faltas.map((f) => `${nomePapel(cfg, f.papel)} (${f.motivo})`).join('; ') || 'não há outros profissionais convocados'}. Tente mais tarde.`, 'alerta');
    return false;
  }
  W.reuniao = r;
  entrarNaReuniao(W, S, cfg, a, item, r);
  for (const b of vao) entrarNaReuniao(W, S, cfg, b, itemPorDef(W, b, def), r);
  const lista = (xs) => [...new Set(xs)].join(', ');
  const faltas = r.faltas.filter((f) => !f.jogador);
  if (a.jogador) {
    avisar(W, S, `👥 ${def.rot} convocada. A caminho: ${lista(vao.map((b) => nomePapel(cfg, b.papel)))}.${faltas.length ? ` Não puderam: ${faltas.map((f) => `${nomePapel(cfg, f.papel)} (${f.motivo})`).join('; ')}.` : ''}`, faltas.length ? 'alerta' : 'info');
  } else {
    const eu = r.faltas.find((f) => f.jogador);
    if (eu) avisar(W, S, `👥 ${nomePapel(cfg, a.papel)} convocou a ${def.rot.toLowerCase()}. Vá em Afazeres do dia para participar.`, 'alerta');
  }
  return true;
}

function sairDaReuniao(W, a) {
  const r = W.reuniao;
  if (!r || !r.part[a.id]) return;
  if (a.id === r.org) {
    for (const b of W.agentes) if (b !== a && r.part[b.id] && b.afz && b.afz.reuniao) b.afz = null;
    W.reuniao = null;
  } else {
    delete r.part[a.id]; delete r.seat[a.id];
    if (Object.keys(r.part).length < 2) { for (const b of W.agentes) if (r.part[b.id] && b.afz && b.afz.reuniao) b.afz = null; W.reuniao = null; }
  }
}

function passoReuniao(W, S, cfg, a, dt) {
  const z = a.afz, r = W.reuniao;
  if (!r || !r.part[a.id]) { a.afz = null; return; }
  if (z.fase === 'indo') { z.fase = 'presente'; r.part[a.id] = 'presente'; return; }
  if (a.id !== r.org) return;
  const presentes = Object.values(r.part).filter((v) => v === 'presente').length;
  if (presentes >= Object.keys(r.part).length) r.restante -= dt;
  else { r.espera += dt; if (r.espera >= 20 && presentes >= 2) r.restante -= dt; }
  if (r.restante <= 0) encerrarReuniao(W, S, cfg);
}

function encerrarReuniao(W, S, cfg) {
  const r = W.reuniao;
  if (!r) return;
  const presentes = W.agentes.filter((b) => r.part[b.id] === 'presente');
  const papeis = [...new Set(presentes.map((b) => b.papel))];
  const dia = diaDoJogo(S);
  const repetida = W.ultReuniao && W.ultReuniao.dia === dia;
  const ganho = (r.def.id === 'caso' ? 6 : 4) * (repetida ? 0.25 : 1);
  for (let i = 0; i < papeis.length; i++) for (let j = i + 1; j < papeis.length; j++) mudaEquipe(S, cfg, papeis[i], papeis[j], ganho);
  W.ultReuniao = { dia };
  const jogou = presentes.some((b) => b.jogador);
  for (const b of W.agentes) if (r.part[b.id] && b.afz && b.afz.reuniao) { if (r.part[b.id] === 'presente') { b.afz.item.feito = true; S.metricas.afazeres = (S.metricas.afazeres || 0) + 1; } b.afz = null; }
  S.metricas.reunioes = (S.metricas.reunioes || 0) + 1;
  if (jogou) {
    const faltas = r.faltas.filter((f) => !f.jogador);
    avisar(W, S, `👥 ${r.def.rot} concluída com ${papeis.map((p) => nomePapel(cfg, p)).join(', ')}: vínculo da equipe +${ganho % 1 ? ganho.toFixed(1) : ganho}${repetida ? ' (já houve reunião hoje: ganho menor)' : ''}.${faltas.length ? ` Não participaram: ${faltas.map((f) => `${nomePapel(cfg, f.papel)} (${f.motivo})`).join('; ')}.` : ''}`, 'bom');
  }
  W.reuniao = null;
  W.sinal++;
}

/* --- Execução dos afazeres --- */
function iniciarAfazer(W, S, cfg, a, item) {
  const def = item.def, ag = garanteAgenda(W, S, cfg, a);
  if (def.equipe) return convocarReuniao(W, S, cfg, a, item);
  let pontos, fam = null, alvo = null;
  if (def.local === 'campo') {
    const f = escolheFamiliaCampo(W, S, a, ag);
    if (!f || !W.casas[f.id]) { item.feito = true; return false; }
    fam = f.id; pontos = [W.casas[f.id].porta.dentro];
  } else if (def.local === 'colega') {
    const b = W.agentes.find((x) => x.id === item.alvo);
    if (!b || !b.vis || b.tarefa || (b.afz && (b.afz.reuniao || b.afz.def.campo))) {
      if (a.jogador) avisar(W, S, `${b ? nomePapel(cfg, b.papel) : 'O colega'} não está disponível agora (${!b || !b.vis ? 'fora do expediente' : b.tarefa ? 'em atendimento' : 'em outra atividade'}).`, 'alerta');
      return false;
    }
    alvo = b.id; pontos = vizinhosDe(W, b.x, b.y);
    if (!pontos.length) return false;
  } else if (def.local === 'ubs' || !(W.porTipo[def.local] || []).length) {
    pontos = [W.ubs.porta.dentro];
  } else {
    const objs = W.porTipo[def.local];
    pontos = objs.flatMap((o) => pontosDeUso(W, o));
    if (!pontos.length) pontos = [W.ubs.porta.dentro];
  }
  const rota = caminhoAte(W, a.x, a.y, pontos);
  if (!rota) { item.falhas++; if (item.falhas >= 2) item.feito = true; return false; }
  a.path = rota;
  a.afz = { item, def, fase: 'indo', restante: def.dur, fam, alvo, tent: 0 };
  return true;
}

function iniciarProximoAfazer(W, S, cfg, a) {
  if (a.afz || a.tarefa || a.pausaEquipe > 0) return false;
  const [ini, fim] = cfg.cenario.mundo.expediente;
  const m = minutoDoDia(S);
  if (m >= fim * 60 - 40 || m < ini * 60 + 15) return false; // dá tempo de todos chegarem antes de começar
  if (a.papel === 'acs' && W.tarefasACS.length) return false;
  const ag = garanteAgenda(W, S, cfg, a);
  const item = ag.lista.find((i) => !i.feito);
  return item ? iniciarAfazer(W, S, cfg, a, item) : false;
}

function passoAfazer(W, S, cfg, a, dt) {
  const z = a.afz;
  if (z.reuniao) return passoReuniao(W, S, cfg, a, dt);
  if (z.fase === 'indo') {
    if (z.def.local === 'colega') {
      const b = W.agentes.find((x) => x.id === z.alvo);
      if (!b || !b.vis) { if (a.jogador) avisar(W, S, 'O colega saiu da unidade antes da conversa.', 'alerta'); a.afz = null; return; }
      if (b.tarefa) { // colega ocupado: espera um pouco por perto
        z.espera = (z.espera || 0) + dt;
        if (z.espera > 20) { if (a.jogador) avisar(W, S, `${nomePapel(cfg, b.papel)} continua ocupado(a): a conversa fica para depois.`, 'alerta'); a.afz = null; }
        return;
      }
      if (Math.hypot(b.x - a.x, b.y - a.y) > 2.3) {
        if (++z.tent > 4) { a.afz = null; return; }
        const rota = caminhoAte(W, a.x, a.y, vizinhosDe(W, b.x, b.y));
        if (rota && rota.length) { a.path = rota; return; }
      }
      b.pausaEquipe = z.def.dur + 6;
    }
    z.fase = 'fazendo'; z.restante = z.def.dur;
    return;
  }
  z.restante -= dt;
  if (z.restante > 0) return;
  const msg = efeitoAfazer(W, S, cfg, a, z);
  z.item.feito = true;
  S.metricas.afazeres = (S.metricas.afazeres || 0) + 1;
  if (z.fam && W.agenda[a.id]) W.agenda[a.id].visitadas.push(z.fam);
  if (a.jogador) avisar(W, S, `${z.def.ic} ${msg}`, 'bom');
  a.afz = null;
  W.sinal++;
}

function adultosDaFamilia(f) { return f.pessoas.filter((p) => p.idade >= 18 && !p.internado); }
const colegaLivre = (W, papel) => W.agentes.find((b) => b.k === 'staff' && b.papel === papel && b.vis && !b.tarefa);

function efeitoAfazer(W, S, cfg, a, z) {
  const id = z.def.id;
  const espera = W.agentes.filter((x) => x.k === 'res' && x.espera && !x.atend).map((x) => achaPessoa(S, x.pid));
  if (id === 'colega_conversar' || id === 'colega_caso') {
    const b = W.agentes.find((x) => x.id === z.alvo);
    if (!b) return 'O colega saiu.';
    if (b.papel === a.papel) return `Conversa com ${nomePapel(cfg, b.papel)} (mesma função: boa troca, sem efeito no vínculo).`;
    mudaEquipe(S, cfg, a.papel, b.papel, z.def.ganho);
    if (z.def.apoio) { W.apoio[a.id] = S.mundo.min + 90; W.apoio[b.id] = S.mundo.min + 90; }
    return `${id === 'colega_caso' ? 'Caso discutido' : 'Conversa'} com ${nomePapel(cfg, b.papel)}: vínculo +${z.def.ganho} (agora ${Math.round(vinculoEquipe(S, cfg, a.papel, b.papel))}%).${z.def.apoio ? ' Os dois trabalham mais rápido por 90 min.' : ''}`;
  }
  if (id === 'cafe') {
    let n = 0;
    for (const b of W.agentes) {
      if (b === a || b.k !== 'staff' || !b.vis || b.papel === a.papel) continue;
      const perto = (b.afz && b.afz.def.id === 'cafe') || Math.hypot(b.x - a.x, b.y - a.y) <= 4;
      if (perto) { mudaEquipe(S, cfg, a.papel, b.papel, 1.5); n++; }
    }
    if (!n) { const out = PAPEIS.filter((p) => p !== a.papel); mudaEquipe(S, cfg, a.papel, out[Math.floor(rnd(S.mundo) * out.length)], 0.5); }
    return n ? `Pausa na copa: conversa leve com ${n} colega(s) (vínculo +1.5).` : 'Pausa na copa sozinho(a): quase ninguém por perto (vínculo +0.5).';
  }
  if (id === 'supervisao') {
    const t = colegaLivre(W, 'tecnico');
    if (!t) return 'Registros conferidos, mas o técnico não estava na unidade para o alinhamento.';
    mudaEquipe(S, cfg, 'enfermeiro', 'tecnico', 2.5);
    return 'Supervisão feita junto com o técnico: vínculo +2.5.';
  }
  if (id === 'repasse') {
    const e = colegaLivre(W, 'enfermeiro'), t = colegaLivre(W, 'tecnico');
    if (e) mudaEquipe(S, cfg, 'acs', 'enfermeiro', 3);
    if (t) mudaEquipe(S, cfg, 'acs', 'tecnico', 1.5);
    if (S.metricas) S.metricas.repasses = (S.metricas.repasses || 0) + 1;
    return e || t ? `Casos do território repassados para ${[e && 'o enfermeiro', t && 'o técnico'].filter(Boolean).join(' e ')}: vínculo da equipe aumentou.` : 'Repasse anotado, mas ninguém da equipe estava livre para ouvir (pouco vínculo).';
  }
  if (id === 'estoque') {
    const antes = S.insumos;
    S.insumos = Math.min(cfg.game.economia.insumosCap, S.insumos + 2);
    return `Estoque conferido e reposto: +${S.insumos - antes} insumos para os tratamentos.`;
  }
  if (id === 'receitas') {
    let n = 0;
    for (const f of S.familias) for (const p of f.pessoas) if (CONDS.some((c) => p.cond[c].diag && p.cond[c].trat)) { n++; f.vinculo = clamp(f.vinculo + 1, 0, 100); }
    return n ? `${n} receita(s) renovada(s): quem está em tratamento sente a equipe por perto (vínculo +1).` : 'Nenhuma receita a renovar hoje: ninguém está em tratamento ainda.';
  }
  if (id === 'educacao') {
    let n = 0;
    for (const p of espera) { const foco = piorHabito(p); const r = acaoOrientar(S, cfg, p.id, foco); if (r.ok) { n++; if (foco !== 'fumo' && foco in S.mundo.intencao[p.id]) S.mundo.intencao[p.id][foco] = clamp(S.mundo.intencao[p.id][foco] + 0.4, 0, 1); } }
    S.metricas.orientacoes += n;
    return n ? `Roda de conversa: ${n} pessoa(s) orientada(s) sobre hábitos.` : 'Sala de espera vazia: material educativo preparado para os próximos.';
  }
  if (id === 'sala_espera') {
    let n = 0;
    for (const p of espera) if (p.idade >= 18 && p.conhecido.medidasTurno !== S.turno && acaoMedir(S, cfg, p.id).ok) n++;
    S.metricas.triagens += n;
    return n ? `Pressão e glicemia aferidas em ${n} pessoa(s) que aguardavam.` : 'Ninguém para aferir na sala de espera agora.';
  }
  if (id === 'visita_med' || id === 'visita_enf') {
    const f = achaFamilia(S, z.fam);
    const medidos = [];
    for (const p of adultosDaFamilia(f)) if (p.conhecido.medidasTurno !== S.turno) { const m = acaoMedir(S, cfg, p.id); if (m.ok) medidos.push(p.nome.split(' ')[0]); }
    const prio = f.pessoas.filter((p) => !p.internado).sort((x, y) => (y.conhecido.suspeitas.length + (y.dengue.ativa ? 3 : 0)) - (x.conhecido.suspeitas.length + (x.dengue.ativa ? 3 : 0)))[0];
    let r = { msg: '' };
    if (prio) {
      if (id === 'visita_med') { r = acaoConsulta(S, cfg, prio.id); S.metricas.atendidos++; prio.retornoTurno = S.turno; for (const c of CONDS) if (prio.cond[c].diag && !prio.cond[c].trat) acaoTratamento(S, cfg, prio.id, c, true); }
      else { const foco = piorHabito(prio); r = acaoOrientar(S, cfg, prio.id, foco); S.metricas.orientacoes++; }
    }
    return `${f.nome}: ${id === 'visita_med' ? 'consulta em casa' : 'visita de enfermagem'}${medidos.length ? `, medidas em ${medidos.join(', ')}` : ''}. ${r.msg || ''}`.trim();
  }
  if (id === 'cadastro_acs') {
    const f = achaFamilia(S, z.fam);
    f.vinculo = clamp(f.vinculo + 2, 0, 100);
    return `${f.nome}: cadastro atualizado e conversa com a família (vínculo +2).`;
  }
  if (id === 'busca_ativa') {
    const f = achaFamilia(S, z.fam);
    const chamados = [];
    for (const p of f.pessoas) {
      if (p.internado || W.ordens.some((o) => o.pid === p.id)) continue;
      const precisaMed = p.conhecido.suspeitas.length || CONDS.some((c) => p.cond[c].diag && p.cond[c].trat) || p.dengue.ativa;
      const r = precisaMed ? ordenarUnidade(W, S, cfg, p.id, 'consulta', { origem: 'acs', permiteCrianca: true }) : (p.idade >= 18 && p.conhecido.medidasTurno === null ? ordenarUnidade(W, S, cfg, p.id, 'triagem', { origem: 'acs' }) : { ok: false });
      if (r.ok) chamados.push(p.nome.split(' ')[0]);
    }
    return chamados.length ? `${f.nome}: ${chamados.join(', ')} convidado(s) para a unidade.` : `${f.nome}: ninguém precisa ser chamado agora.`;
  }
  return `${z.def.rot}: concluído.`;
}

/* ---------- Agentes comunitários ---------- */
function passoACS(W, S, cfg, a, dt) {
  if (!a.tarefa) {
    if (a.jogador && a.fila.length) {
      const cmd = a.fila.shift();
      if (cmd.k === 'ir') { const alvo = caminhavel(W, cmd.x, cmd.y) ? [{ x: cmd.x, y: cmd.y }] : vizinhosDe(W, cmd.x, cmd.y); irPara(W, a, alvo); return; }
      if (cmd.k === 'afazer') { const it = cmd.item || itemDaAgenda(W, a, cmd.uid); if (it && !it.feito) iniciarAfazer(W, S, cfg, a, it); return; }
      const t = { ...cmd, fase: 'indo', rep: 0 };
      a.tarefa = t;
      if (t.tipo === 'mutirao') { t.pontos = []; for (let i = 0; i < 3; i++) t.pontos.push(pontoAleatorio(W, S.mundo, { x: a.x, y: a.y }) || W.ubs.porta.fora); t.i = 0; irPara(W, a, [t.pontos[0]]); }
      else if (t.tipo === 'visita') { if (!irPara(W, a, [W.casas[t.fam].porta.dentro])) a.tarefa = null; }
      return;
    }
    if (!a.jogador && W.tarefasACS.length && ubsAberta(W, S, cfg)) {
      const t = W.tarefasACS.shift();
      a.tarefa = t; t.fase = 'indo';
      if (t.tipo === 'mutirao') { t.pontos = []; for (let i = 0; i < 3; i++) t.pontos.push(pontoAleatorio(W, S.mundo, { x: W.ubs.porta.fora.x, y: W.ubs.porta.fora.y }) || W.ubs.porta.fora); t.i = 0; irPara(W, a, [t.pontos[0]]); }
      else { t.fam = t.tipo === 'visita' ? t.fam : achaPessoa(S, t.pid).familiaId; if (!irPara(W, a, [W.casas[t.fam].porta.dentro])) a.tarefa = null; }
      return;
    }
    if (a.jogador) return;
    if (iniciarProximoAfazer(W, S, cfg, a)) return;
    const posto = postoDe(W, 'acs', a.ind)[0];
    if (posto && (a.x !== posto.x || a.y !== posto.y)) irPara(W, a, [posto]);
    return;
  }
  const t = a.tarefa;
  if (t.tipo === 'pessoa') {
    const alvo = W.agentes.find((x) => x.k === 'res' && x.pid === t.pid && x.vis);
    if (!alvo) { avisar(W, S, 'A pessoa não está mais por perto.', 'info'); a.tarefa = null; return; }
    if (t.fase === 'indo') {
      if (Math.hypot(alvo.x - a.x, alvo.y - a.y) <= 1.6) { t.fase = 'fazendo'; t.restante = t.acao === 'convidar' ? 10 : 20; alvo.pausa = t.restante + 2; alvo.path = []; return; }
      if (!a.path.length || (t.rep = (t.rep || 0) - 1) <= 0) { irPara(W, a, vizinhosDe(W, alvo.x, alvo.y)); t.rep = 12; }
      return;
    }
    t.restante -= dt;
    if (t.restante > 0) return;
    const p = achaPessoa(S, t.pid);
    let r;
    if (t.acao === 'medir') { r = p.idade >= 18 ? acaoMedir(S, cfg, p.id) : { ok: false, msg: 'A aferição de rotina é para adultos.' }; }
    else if (t.acao === 'orientar') { r = acaoOrientar(S, cfg, p.id, t.foco); if (r.ok && t.foco !== 'fumo') { const it = S.mundo.intencao[p.id]; if (t.foco in it) it[t.foco] = clamp(it[t.foco] + 0.5, 0, 1); S.metricas.orientacoes++; } }
    else if (t.acao === 'convidar') { r = ordenarUnidade(W, S, cfg, p.id, 'triagem', { origem: 'acs' }); }
    else { const f = achaFamilia(S, p.familiaId); f.vinculo = clamp(f.vinculo + 3, 0, 100); r = { ok: true, msg: 'Conversa amigável (vínculo +3).' }; }
    avisar(W, S, `${t.acao === 'medir' ? '📏' : t.acao === 'orientar' ? '💬' : t.acao === 'convidar' ? '📣' : '🙂'} ${p.nome}: ${r.msg}`, 'info', { pessoaId: p.id });
    alvo.pausa = 0;
    a.tarefa = null; W.sinal++;
    return;
  }
  if (t.fase === 'indo') {
    if (a.path.length) return;
    t.fase = 'fazendo';
    t.restante = t.tipo === 'visita' ? 40 : t.tipo === 'orientar' ? 30 : 45;
  }
  t.restante -= dt;
  if (t.restante > 0) return;
  if (t.tipo === 'mutirao' && t.i < 2) { t.i++; t.restante = 45; irPara(W, a, [t.pontos[t.i]]); t.fase = 'indo'; return; }
  if (t.tipo === 'visita') {
    const r = acaoVisita(S, cfg, t.fam);
    const fam = achaFamilia(S, t.fam);
    const extras = [];
    if (r.ok) {
      S.metricas.visitas++;
      for (const p of fam.pessoas) { // busca ativa: afere os adultos e convida quem estiver com valores alterados
        if (p.idade >= 18 && !p.internado && (p.conhecido.medidasTurno === null || S.turno - p.conhecido.medidasTurno >= 3)) {
          const m = acaoMedir(S, cfg, p.id);
          if (m.ok && p.conhecido.suspeitas.length) { ordenarUnidade(W, S, cfg, p.id, 'consulta', { origem: 'acs' }); extras.push(`${p.nome} está com valores alterados e foi convidado(a) para consulta`); }
        }
      }
    }
    avisar(W, S, `🏠 ${fam.nome}: ${r.msg}${extras.length ? ' ' + extras.join('. ') + '.' : ''}`, 'info', { familiaId: t.fam });
  } else if (t.tipo === 'orientar') {
    const r = acaoOrientar(S, cfg, t.pid, t.foco);
    if (r.ok && t.foco !== 'fumo') { const it = S.mundo.intencao[t.pid]; if (t.foco in it) it[t.foco] = clamp(it[t.foco] + 0.5, 0, 1); }
    avisar(W, S, `💬 ${achaPessoa(S, t.pid).nome}: ${r.msg}`, 'info', { pessoaId: t.pid });
  } else {
    const r = acaoMutirao(S, cfg);
    avisar(W, S, `🧹 ${r.msg}`, r.ok ? 'bom' : 'info');
  }
  a.tarefa = null;
  W.sinal++;
}

/* ---------- Pedidos (usados pelos profissionais autônomos e pelos testes) ---------- */
const jaNaFilaACS = (W, tipo, chave) => W.tarefasACS.some((t) => t.tipo === tipo && (t.fam === chave || t.pid === chave)) || W.agentes.some((a) => a.tarefa && a.tarefa.tipo === tipo && (a.tarefa.fam === chave || a.tarefa.pid === chave));

export function ordenarVisita(W, S, cfg, famId) {
  const f = achaFamilia(S, famId);
  if (f.visTurno === S.turno) return { ok: false, msg: 'Esta família já foi visitada neste mês.' };
  if (jaNaFilaACS(W, 'visita', famId)) return { ok: false, msg: 'O agente comunitário já vai até lá.' };
  W.tarefasACS.push({ tipo: 'visita', fam: famId });
  return { ok: true, msg: `Visita à ${f.nome} na fila do agente comunitário.` };
}
export function ordenarOrientar(W, S, cfg, pid, foco) {
  const p = achaPessoa(S, pid);
  if (p.internado) return { ok: false, msg: `${p.nome} está internado(a).` };
  if (foco === 'fumo' && !p.tabagismo) return { ok: false, msg: 'Esta pessoa não fuma.' };
  if (jaNaFilaACS(W, 'orientar', pid)) return { ok: false, msg: 'Já há uma orientação pedida para esta pessoa.' };
  W.tarefasACS.push({ tipo: 'orientar', pid, foco });
  return { ok: true, msg: `Orientação para ${p.nome} na fila.` };
}
export function ordenarMutirao(W, S) {
  if (S.mutiraoTurno === S.turno) return { ok: false, msg: 'O mutirão já foi realizado neste mês.' };
  if (W.tarefasACS.some((t) => t.tipo === 'mutirao') || W.agentes.some((a) => a.tarefa && a.tarefa.tipo === 'mutirao')) return { ok: false, msg: 'O mutirão já está a caminho.' };
  W.tarefasACS.push({ tipo: 'mutirao' });
  return { ok: true, msg: 'Mutirão contra focos na fila da equipe.' };
}
export function ordenarUnidade(W, S, cfg, pid, tipo, opts = {}) {
  const p = achaPessoa(S, pid);
  if (p.internado) return { ok: false, msg: `${p.nome} está internado(a).` };
  if (tipo === 'triagem' && p.idade < 18 && !opts.permiteCrianca) return { ok: false, msg: 'A triagem de PA e glicemia é para adultos.' };
  if (W.ordens.some((o) => o.pid === pid)) return { ok: false, msg: `${p.nome} já foi chamado(a) à unidade.` };
  W.ordens.push({ pid, tipo, estado: 'pendente', rolou: !!opts.espontaneo, espontaneo: !!opts.espontaneo, origem: opts.origem || 'ordem', meta: opts.meta || (tipo === 'triagem' && opts.origem === 'acs' ? { consulta: true } : null), t0: S.mundo.min });
  const med = tipo === 'consulta' && cfg.cenario.mundo.medicoDias.length < 5 ? ' O médico atende só em alguns dias da semana.' : '';
  return { ok: true, msg: `${p.nome} foi chamado(a) para ${tipo === 'triagem' ? 'a triagem' : 'a consulta'}.${med}` };
}

/* ---------- Demanda e rotinas diárias dos profissionais autônomos ---------- */
const MOTIVOS_LEVES = {
  consulta: ['dor de garganta', 'dor nas costas', 'gripe', 'dor de cabeça', 'tosse', 'renovar um remédio', 'dor no estômago'],
  enfermagem: ['curativo', 'dúvida sobre alimentação', 'orientação sobre sono', 'conversa sobre atividade física', 'retirar pontos'],
  triagem: ['medir a pressão', 'medir a glicemia'],
};
/** Procura espontânea do dia: quanto maior a localidade, mais gente na unidade (parâmetro `procura` do cenário). */
function demandaDeRotina(W, S, cfg) {
  const M = S.mundo, mundo = cfg.cenario.mundo;
  const dow = diaSemana(S);
  if (dow > 4) return;
  const diaMedico = mundo.medicoDias.includes(dow);
  for (const f of S.familias) for (const p of f.pessoas) {
    if (p.internado || W.ordens.some((o) => o.pid === p.id)) continue;
    if (S.jogador && S.jogador.modo === 'paciente' && S.jogador.pid === p.id) continue; // o paciente controlado decide sozinho
    const fator = (p.idade >= 60 || p.idade < 6 ? 1.4 : 1) * (0.55 + 0.9 * (f.vinculo / 100));
    if (rnd(M) >= (mundo.procura || 0.3) * fator) continue;
    const adulto = p.idade >= 18;
    let tipo = escolhe(M, adulto ? [['consulta', 40], ['triagem', 30], ['enfermagem', 30]] : [['consulta', 65], ['enfermagem', 35]]);
    if (tipo === 'consulta' && !diaMedico) tipo = adulto ? 'triagem' : 'enfermagem';
    const lista = MOTIVOS_LEVES[tipo];
    const motivo = lista[Math.floor(rnd(M) * lista.length)];
    ordenarUnidade(W, S, cfg, p.id, tipo, { espontaneo: true, origem: 'rotina', permiteCrianca: true, meta: { leve: true, motivo } });
  }
}

function gerarDemanda(W, S, cfg) {
  const M = S.mundo;
  demandaDeRotina(W, S, cfg);
  for (const f of S.familias) for (const p of f.pessoas) {
    if (p.internado || W.ordens.some((o) => o.pid === p.id)) continue;
    const eu = S.jogador && S.jogador.modo === 'paciente' && S.jogador.pid === p.id;
    // retorno de quem está em tratamento
    const emTrat = CONDS.some((id) => p.cond[id].diag && p.cond[id].trat);
    if (emTrat && S.turno - (p.retornoTurno === undefined ? -99 : p.retornoTurno) >= 1) {
      if (eu) { if (M.lembreteRetorno !== S.turno) { M.lembreteRetorno = S.turno; avisar(W, S, '🗓️ Já faz um mês da sua última consulta: o médico pediu retorno. Vá à unidade em dia de médico.', 'alerta', { pessoaId: p.id }); } continue; }
      if (rnd(M) < 0.12 * (0.4 + adesao(f))) ordenarUnidade(W, S, cfg, p.id, 'consulta', { espontaneo: true, origem: 'retorno', permiteCrianca: true });
      continue;
    }
    if (eu) continue; // o paciente decide por conta própria
    // sintomas que levam a procurar a unidade
    const doente = ['dm', 'dep'].some((id) => p.cond[id].estagio >= 2 && !p.cond[id].diag);
    if (doente && rnd(M) < 0.035 * (0.5 + f.vinculo / 50)) ordenarUnidade(W, S, cfg, p.id, 'triagem', { espontaneo: true, origem: 'sintoma', meta: { consulta: true } });
  }
}

function planejarACS(W, S, cfg) {
  if (diaSemana(S) > 4) return;
  const npc = W.agentes.filter((a) => a.k === 'staff' && a.papel === 'acs' && !a.jogador).length;
  if (!npc) return;
  if (W.tarefasACS.filter((t) => t.tipo === 'visita').length >= 2 * npc) return;
  const risco = (f) => f.pessoas.reduce((n, p) => n + (p.conhecido.suspeitas.length ? 2 : 0) + (CONDS.some((id) => p.cond[id].diag && !p.cond[id].trat) ? 2 : 0) + (p.dengue.ativa ? 3 : 0), 0);
  const cand = S.familias.filter((f) => f.visTurno !== S.turno && !jaNaFilaACS(W, 'visita', f.id)).sort((x, y) => (risco(y) - risco(x)) || (x.visTurno - y.visTurno));
  for (const f of cand.slice(0, npc)) W.tarefasACS.push({ tipo: 'visita', fam: f.id });
  const emTemporada = cfg.game.dengue.estacao.includes(S.mes);
  if (emTemporada && S.infestacao >= 40 && S.mutiraoTurno !== S.turno && !W.tarefasACS.some((t) => t.tipo === 'mutirao') && diaDoMes(S) >= 3) W.tarefasACS.push({ tipo: 'mutirao' });
}

/* ---------- Interações do jogador ---------- */
const FOCOS_ORIENTAR = [['atividade', 'Atividade física'], ['alimentacao', 'Alimentação'], ['sono', 'Sono'], ['estresse', 'Manejo do estresse'], ['fumo', 'Parar de fumar']];

/** Opções que o jogador tem ao tocar em `alvo`: { tipo:'obj'|'agente'|'chao', ... }. */
export function opcoesPara(W, S, cfg, alvo) {
  const j = S.jogador, ag = agenteJogador(W);
  if (!j || !ag) return [];
  const ops = [];
  const op = (id, rot, ic, desab) => ops.push({ id, rot, ic, desab: desab || null });
  if (alvo.tipo === 'chao') { op('ir', 'Ir até aqui', '📍'); if (j.modo === 'paciente') op('caminhar', 'Caminhar por aqui', '🚶'); if (j.modo === 'profissional' && j.papel === 'acs' && alvo.rua) op('mutirao', 'Mutirão contra focos aqui', '🧹', S.mutiraoTurno === S.turno ? 'Já feito neste mês' : null); return ops; }

  if (j.modo === 'paciente') {
    const p = achaPessoa(S, ag.pid);
    if (alvo.tipo === 'agente') {
      const o = W.agentes.find((x) => x.id === alvo.id);
      if (o && o.k === 'staff') op('colega', 'Ver o que está fazendo', '👀');
      else if (o && o.id !== ag.id) op('conversar', 'Conversar', '💬');
      return ops;
    }
    const o = alvo.obj;
    if (o.casa && o.casa !== p.familiaId) { op('nada', 'Casa de outra família', '🚪', 'Você não pode usar'); return ops; }
    const idade = p.idade;
    switch (o.t) {
      case 'B': op('dormir', 'Dormir', '💤'); op('descansar', 'Descansar um pouco', '🛏️'); break;
      case 'S': case 'V': op('tv', 'Assistir TV', '📺'); break;
      case 'G': case 'm': op('cozinhar_saudavel', 'Cozinhar uma refeição saudável', '🥗'); op('cozinhar_rapido', 'Fazer algo rápido (frito/pronto)', '🍟'); { const emTrat = CONDS.some((id) => p.cond[id].diag && p.cond[id].trat); if (emTrat) op('remedio', 'Tomar o remédio', '💊', S.mundo.remedios[p.id].hoje ? 'Já tomou hoje' : null); } break;
      case 'C': op('banho', 'Tomar banho', '🚿'); break;
      case 'P': op('praca', 'Sentar na praça', '🌳'); break;
      case 'A': op('academia', 'Exercitar-se', '🏋️', idade < 14 ? 'Só a partir de 14 anos' : null); break;
      case 'L': op('lanche', 'Comer um lanche', '🍔'); break;
      case 'O': op('trabalho', 'Trabalhar (2h)', '💼', p.ocupacao !== 'trabalho' ? 'Você não trabalha aqui' : null); break;
      case 'R': op('roca', 'Trabalhar na roça (2h)', '🌽', p.ocupacao !== 'trabalho' ? 'Você não trabalha aqui' : null); break;
      case 'E': op('escola', 'Estudar (2h)', '📚', p.ocupacao !== 'escola' ? 'Você não estuda aqui' : null); break;
      case 'casa': op('ir_casa', 'Ir para casa', '🏠'); break;
      case 'H': case 'U': case 'D': case 'Y': {
        const aberta = ubsAberta(W, S, cfg), med = ubsAberta(W, S, cfg, true);
        op('ubs_triagem', 'Pedir triagem (medir pressão/glicemia)', '📏', aberta && idade >= 18 ? null : idade < 18 ? 'Triagem é para adultos' : 'Unidade fechada agora');
        op('ubs_consulta', 'Pedir consulta médica', '🩺', med ? null : aberta ? 'Sem médico hoje' : 'Unidade fechada agora');
        break;
      }
      default: break;
    }
    return ops;
  }

  // profissional
  if (alvo.tipo === 'agente') {
    const o = W.agentes.find((x) => x.id === alvo.id);
    if (o && o.k === 'staff' && o.id !== ag.id) {
      const nome = nomePapel(cfg, o.papel).toLowerCase();
      const indisp = !o.vis ? 'Fora do expediente' : o.tarefa ? (o.papel === 'acs' ? 'Em campo agora' : 'Em atendimento agora') : ag.tarefa ? 'Termine seu atendimento' : null;
      op('colega', 'Ver o que está fazendo', '👀');
      op('colega_conversar', `Conversar com ${nome} (vínculo)`, '💬', indisp);
      op('colega_caso', `Discutir um caso com ${nome}`, '🗂️', indisp);
      op('equipe_reuniao', 'Convocar reunião de equipe', '👥', ag.tarefa ? 'Termine seu atendimento' : null);
      return ops;
    }
    if (!o || o.k !== 'res') return ops;
    const p = achaPessoa(S, o.pid);
    if (j.papel === 'acs') {
      op('acs_medir', 'Aferir PA e glicemia', '📏', p.idade < 18 ? 'Só adultos' : null);
      for (const [k, nome] of FOCOS_ORIENTAR) { if (k === 'fumo' && !p.tabagismo) continue; if (p.idade < 12 && !['atividade', 'alimentacao', 'sono'].includes(k)) continue; op(`acs_orientar:${k}`, `Orientar: ${nome}`, '💬'); }
      op('acs_convidar', 'Convidar para a unidade', '📣', W.ordens.some((x) => x.pid === p.id) ? 'Já foi chamado(a)' : null);
      op('acs_conversar', 'Conversar (criar vínculo)', '🙂');
    } else {
      const ord = W.ordens.find((x) => x.pid === o.pid && x.estado === 'espera' && x.tipo === servicoDe(j.papel));
      op('chamar', 'Chamar para atendimento', '📣', ord ? (ag.tarefa ? 'Você está atendendo' : null) : 'Não está na sua fila');
    }
    return ops;
  }
  const o = alvo.obj;
  if (j.papel === 'acs' && o && o.casa) op('acs_visita', `Visitar a família ${achaFamilia(S, o.casa).nome.replace('Família ', '').replace('Casal ', '')}`, '🏠', achaFamilia(S, o.casa).visTurno === S.turno ? 'Já visitada neste mês' : null);
  return ops;
}

/** Menu de ações do paciente (por indicação: o jogo escolhe o móvel e o caminho). */
export function acoesPaciente(W, S, cfg) {
  const ag = agenteJogador(W);
  if (!ag || ag.k !== 'res') return [];
  const p = achaPessoa(S, ag.pid), casa = p.familiaId;
  const tem = (t, c) => objetosDe(W, t, c).length > 0;
  const emTrat = CONDS.some((id) => p.cond[id].diag && p.cond[id].trat);
  const aberta = ubsAberta(W, S, cfg), med = ubsAberta(W, S, cfg, true);
  const falta = (ok, motivo) => (ok ? null : motivo);
  const grupos = [];
  const g = (nome, itens) => grupos.push({ nome, itens });
  const it = (id, rot, ic, desab) => ({ id, rot, ic, desab: desab || null });
  g('Necessidades', [
    it('dormir', 'Dormir', '💤', falta(tem('B', casa), 'Sem cama em casa')),
    it('descansar', 'Descansar um pouco', '🛏️', falta(tem('B', casa), 'Sem cama em casa')),
    it('banho', 'Tomar banho', '🚿', falta(tem('C', casa), 'Sem chuveiro em casa')),
    it('cozinhar_saudavel', 'Cozinhar e comer (saudável)', '🥗', falta(tem('G', casa), 'Sem cozinha em casa')),
    it('cozinhar_rapido', 'Comer algo rápido (frito/pronto)', '🍟', falta(tem('G', casa), 'Sem cozinha em casa')),
    ...(emTrat ? [it('remedio', 'Tomar o remédio', '💊', S.mundo.remedios[p.id].hoje ? 'Já tomou hoje' : null)] : []),
  ]);
  g('Lazer', [
    it('tv', 'Assistir TV', '📺', falta(tem('S', casa), 'Sem sofá em casa')),
    it('ler', 'Sentar para ler', '📖', falta(tem('N', casa), 'Sem poltrona em casa')),
    it('caminhar', 'Fazer uma caminhada', '🚶'),
    it('praca', 'Sentar na praça', '🌳', falta(tem('P', null), 'Não há praça aqui')),
    it('academia', 'Exercitar-se na academia', '🏋️', p.idade < 14 ? 'Só a partir de 14 anos' : falta(tem('A', null), 'Não há academia aqui')),
    it('lanche', 'Comer um lanche na lanchonete', '🍔', p.idade < 10 ? 'Só a partir de 10 anos' : falta(tem('L', null), 'Não há lanchonete aqui')),
    ...(p.tabagismo ? [it('fumar', 'Fumar um cigarro', '🚬')] : []),
  ]);
  const ob = [];
  if (p.ocupacao === 'trabalho') ob.push(cfg.cenario.mundo.trabalho === 'R' ? it('roca', 'Trabalhar na roça (2h)', '🌽', falta(tem('R', null), 'Sem roça aqui')) : it('trabalho', 'Trabalhar (2h)', '💼', falta(tem('O', null), 'Sem local de trabalho')));
  if (p.ocupacao === 'escola') ob.push(it('escola', 'Estudar na escola (2h)', '📚', falta(tem('E', null), 'Sem escola')));
  if (ob.length) g('Obrigações', ob);
  g('Saúde', [
    it('ubs_triagem', 'Pedir triagem (pressão e glicemia)', '📏', p.idade < 18 ? 'Triagem é para adultos' : aberta ? null : 'Unidade fechada agora'),
    it('ubs_consulta', 'Pedir consulta médica', '🩺', med ? null : aberta ? 'Sem médico hoje' : 'Unidade fechada agora'),
  ]);
  g('Ir para', [it('ir_casa', 'Voltar para casa', '🏠'), it('ir_ubs', 'Ir até a unidade de saúde', '🏥'), ...(tem('P', null) ? [it('ir_praca', 'Ir até a praça', '🌳')] : [])]);
  return grupos;
}

/** Aplica a opção escolhida. Devolve { ok, msg }. */
export function comandar(W, S, cfg, opId, alvo) {
  const j = S.jogador, ag = agenteJogador(W);
  if (!j || !ag) return { ok: false, msg: 'Nenhum personagem.' };
  if (ag.fila.length >= 6) return { ok: false, msg: 'Fila de ordens cheia.' };
  const [id, arg] = opId.split(':');
  if (id === 'colega') {
    const o = W.agentes.find((x) => x.id === alvo.id);
    if (!o || o.k !== 'staff') return { ok: false, msg: 'A pessoa saiu.' };
    return { ok: true, msg: `${cfg.papeis[o.papel].icone} ${cfg.papeis[o.papel].nome}: ${acaoAtual(W, S, o)}` };
  }
  if (id === 'ir') { ag.fila.push({ k: 'ir', x: alvo.x, y: alvo.y }); return { ok: true, msg: 'Indo até lá.' }; }
  if (id === 'ir_casa') { const q = W.casas[achaPessoa(S, ag.pid).familiaId].porta.dentro; ag.fila.push({ k: 'ir', x: q.x, y: q.y }); return { ok: true, msg: 'Indo para casa.' }; }
  if (j.modo === 'paciente') {
    const p = achaPessoa(S, ag.pid);
    const obj = alvo && alvo.obj;
    const objDaCasa = (t) => objetosDe(W, t, p.familiaId)[0];
    const empilha = (cmd) => { ag.fila.push(cmd); return { ok: true, msg: 'Ordem na fila.' }; };
    switch (id) {
      case 'caminhar': return empilha({ k: 'acao', acao: 'caminhar' });
      case 'ler': return empilha({ k: 'acao', acao: 'ler', obj: objDaCasa('N') });
      case 'fumar': return empilha({ k: 'acao', acao: 'fumar' });
      case 'ir_ubs': { const q = W.ubs.porta.fora; return empilha({ k: 'ir', x: q.x, y: q.y }); }
      case 'ir_praca': { const r = (W.porTipo.K || W.porTipo.P || [])[0] || (W.porTipo.P || [])[0]; if (!r) return { ok: false, msg: 'Não há praça aqui.' }; return empilha({ k: 'ir', x: r.x, y: r.y + 1 }); }
      case 'dormir': return empilha({ k: 'acao', acao: 'dormir', obj: obj && obj.t === 'B' ? obj : undefined });
      case 'descansar': return empilha({ k: 'acao', acao: 'descansar', obj: obj && obj.t === 'B' ? obj : undefined });
      case 'tv': return empilha({ k: 'acao', acao: 'tv', obj: objDaCasa('S') });
      case 'cozinhar_saudavel': return empilha({ k: 'acao', acao: 'cozinhar', saudavel: true });
      case 'cozinhar_rapido': return empilha({ k: 'acao', acao: 'cozinhar', saudavel: false, dur: 6 });
      case 'remedio': return empilha({ k: 'acao', acao: 'remedio' });
      case 'banho': return empilha({ k: 'acao', acao: 'banho', obj: objDaCasa('C') });
      case 'praca': case 'academia': case 'lanche': case 'trabalho': case 'roca': case 'escola': return empilha({ k: 'acao', acao: id, obj });
      case 'ubs_triagem': return empilha({ k: 'ubs', tipo: 'triagem' });
      case 'ubs_consulta': return empilha({ k: 'ubs', tipo: 'consulta' });
      case 'conversar': {
        const o = W.agentes.find((x) => x.id === alvo.id);
        if (!o) return { ok: false, msg: 'A pessoa saiu.' };
        o.pausa = 22; o.path = [];
        ag.fila.push({ k: 'ir', x: Math.round(o.x), y: Math.round(o.y) });
        ag.fila.push({ k: 'acao', acao: 'conversar' });
        return { ok: true, msg: 'Indo conversar.' };
      }
      default: return { ok: false, msg: 'Opção indisponível.' };
    }
  }
  // profissional
  if (id === 'mutirao') { if (S.mutiraoTurno === S.turno) return { ok: false, msg: 'Já feito neste mês.' }; ag.fila.push({ k: 'x', tipo: 'mutirao' }); return { ok: true, msg: 'Mutirão na fila.' }; }
  if (id === 'equipe_reuniao') {
    if (ag.tarefa) return { ok: false, msg: 'Termine o atendimento antes.' };
    if (!ag.vis) return { ok: false, msg: 'Fora do expediente.' };
    const it = (W.agenda[ag.id] && W.agenda[ag.id].lista.find((i) => i.def.id === 'reuniao' && !i.feito)) || { uid: 'r', def: REUNIAO, feito: false, falhas: 0 };
    ag.fila.push({ k: 'afazer', item: it });
    return { ok: true, msg: '👥 Convocando a reunião de equipe…' };
  }
  if (id === 'colega_conversar' || id === 'colega_caso') {
    const b = alvo && alvo.id ? W.agentes.find((x) => x.id === alvo.id) : null;
    if (!b || b.k !== 'staff' || b === ag) return { ok: false, msg: 'Colega não encontrado.' };
    if (ag.tarefa) return { ok: false, msg: 'Termine o atendimento antes.' };
    if (!b.vis) return { ok: false, msg: `${nomePapel(cfg, b.papel)} está fora do expediente.` };
    if (b.tarefa) return { ok: false, msg: `${nomePapel(cfg, b.papel)} está ${b.papel === 'acs' ? 'em campo' : 'em atendimento'} agora. Tente depois.` };
    ag.fila.push({ k: 'afazer', item: { uid: `c${S.mundo.min | 0}`, def: id === 'colega_caso' ? CASO_COLEGA : CONVERSA_COLEGA, feito: false, falhas: 0, alvo: b.id } });
    return { ok: true, msg: `Indo falar com ${nomePapel(cfg, b.papel).toLowerCase()}…` };
  }
  if (id === 'afazer') {
    const it = itemDaAgenda(W, ag, arg);
    if (!it) return { ok: false, msg: 'Afazer não encontrado.' };
    if (it.feito) return { ok: false, msg: 'Este afazer já foi concluído hoje.' };
    if (ag.tarefa) return { ok: false, msg: 'Termine o atendimento antes.' };
    ag.fila.push({ k: 'afazer', uid: arg });
    return { ok: true, msg: `${it.def.ic} ${it.def.rot}: na sua fila.` };
  }
  if (id === 'chamar') { if (ag.afz) { soltaAfazer(W, ag); ag.path = []; } ag.fila.push({ k: 'chamar', pid: W.agentes.find((x) => x.id === alvo.id).pid }); return { ok: true, msg: 'Chamando…' }; }
  if (id === 'chamar_proximo') {
    const prox = filaEspera(W, servicoDe(j.papel)).find((o) => { const pac = W.agentes.find((x) => x.pid === o.pid); return pac && pac.espera && !pac.atend; });
    if (!prox) return { ok: false, msg: j.papel === 'medico' && !cfg.cenario.mundo.medicoDias.includes(diaSemana(S)) ? 'Hoje não é dia de consultório neste cenário: faça os afazeres do dia (visitas, receitas, reuniões).' : 'Ninguém na sua fila agora. Que tal um afazer do dia?' };
    if (ag.afz) { soltaAfazer(W, ag); ag.path = []; }
    ag.fila.push({ k: 'chamar', pid: prox.pid });
    return { ok: true, msg: 'Chamando o próximo da fila…' };
  }
  const o = alvo && alvo.id ? W.agentes.find((x) => x.id === alvo.id) : null;
  if (id === 'acs_visita') { ag.fila.push({ k: 'x', tipo: 'visita', fam: alvo.obj.casa }); return { ok: true, msg: 'Indo visitar a família.' }; }
  if (id.startsWith('acs_') && o) {
    const acao = id.replace('acs_', '');
    ag.fila.push({ k: 'x', tipo: 'pessoa', pid: o.pid, acao, foco: arg });
    return { ok: true, msg: 'Indo até a pessoa.' };
  }
  return { ok: false, msg: 'Opção indisponível.' };
}

// "k:'x'" = tarefa de campo do ACS (a fila usa a mesma estrutura de tarefa)
export function cancelarFila(W, S) {
  const ag = agenteJogador(W);
  if (!ag) return;
  ag.fila = []; ag.proximos = [];
  if (ag.k === 'staff' && ag.afz) { soltaAfazer(W, ag); ag.path = []; }
  if (ag.k === 'res' && ag.acao && ag.acao.k !== 'dormir') ag.acao = null;
  if (ag.k === 'res') { ag.path = []; ag.pend = null; }
}
export function alternaVontade(S) { S.jogador.vontade = !S.jogador.vontade; return S.jogador.vontade; }

/** O profissional começa o atendimento (quando o paciente já chegou). */
export function iniciarAtendimento(W, S, cfg, opts = {}) {
  const a = agenteJogador(W);
  if (!a || !a.tarefa || a.tarefa.fase !== 'pronto') return { ok: false, msg: 'Nenhum paciente pronto.' };
  a.tarefa.opts = opts;
  a.tarefa.fase = 'atendendo';
  a.tarefa.restante = duracaoServico(W, S, cfg, a, a.tarefa.tipo);
  return { ok: true, msg: 'Atendimento iniciado.' };
}
export function finalizarAtendimento(W, S, cfg, destino) {
  const a = agenteJogador(W);
  if (!a || !a.tarefa || a.tarefa.fase !== 'resultado') return { ok: false, msg: 'Nada a concluir.' };
  concluirAtendimento(W, S, cfg, a, destino);
  return { ok: true, msg: destino === 'liberar' ? 'Atendimento concluído.' : 'Encaminhado.' };
}
export function atendimentoAtual(W, S) {
  const a = agenteJogador(W);
  if (!a || a.k !== 'staff' || !a.tarefa || !a.tarefa.ord) return null;
  const t = a.tarefa;
  return { tipo: t.tipo, fase: t.fase, pid: t.ord.pid, restante: t.restante, resultado: t.resultado || null };
}

/* ---------- Simulação ---------- */
function fimDoDia(W, S, cfg) {
  const M = S.mundo;
  for (const p of todasPessoas(S)) {
    const c = M.dia[p.id], int = M.intencao[p.id];
    if (p.idade >= 12 && !p.internado) {
      const humorMedio = c.humorN ? c.humorSoma / c.humorN : 70;
      const refeicoes = c.saudavel + c.fast;
      const alvo = {
        atividade: clamp(8 + c.exMin * 1.3, 0, 100),
        alimentacao: refeicoes ? (100 * c.saudavel) / refeicoes : 20,
        sono: clamp((c.sonoMin / 480) * 100, 0, 100),
        estresse: clamp(100 - humorMedio + (c.trabMin > 300 ? 8 : 0) + (cfg.cenario.mundo.estresse || 0), 0, 100),
      };
      for (const k of Object.keys(alvo)) p.habitos[k] = clamp(p.habitos[k] * 0.96 + alvo[k] * 0.04, 0, 100);
    }
    for (const k of Object.keys(int)) int[k] *= 0.96;
    M.remedios[p.id].hoje = false;
    M.dia[p.id] = contadoresNovos();
  }
}

function passoCurto(W, S, cfg, dt) {
  const M = S.mundo;
  const diaAntes = Math.floor(M.min / MIN_DIA);
  M.min += dt;
  for (const a of W.agentes) {
    if (a.k === 'res') passoMorador(W, S, cfg, a, dt);
    else passoEquipe(W, S, cfg, a, dt);
  }
  if (Math.floor(M.min / MIN_DIA) > diaAntes) {
    fimDoDia(W, S, cfg);
    if (diaSemana(S) < 5) { const e = estadoEquipe(S, cfg); for (const k of PARES_EQUIPE) e[k] = clamp(e[k] - 1, 5, 100); } // sem convivência, o vínculo esfria
    for (const a of W.agentes) if (a.k === 'res') a.procurou = false;
    if (diaDoJogo(S) % DIAS_MES === 0) {
      // adesão do paciente controlado = dias em que tomou o remédio
      if (S.jogador && S.jogador.modo === 'paciente') {
        const r = M.remedios[S.jogador.pid], p = achaPessoa(S, S.jogador.pid);
        if (CONDS.some((id) => p.cond[id].diag && p.cond[id].trat)) p.adesaoOverride = clamp(r.dias / (DIAS_MES * 0.85), 0, 1); else delete p.adesaoOverride;
        r.dias = 0;
      }
      W.relatorio = avancarMes(S, cfg);
      sincronizarEquipe(W, S);
      W.sinal++;
      gerarDemanda(W, S, cfg); planejarACS(W, S, cfg);
      return true;
    }
    gerarDemanda(W, S, cfg); planejarACS(W, S, cfg);
  }
  return false;
}

/** Avança o mundo `dtMin` minutos de jogo. Devolve true se um mês terminou (W.relatorio traz o resumo). */
export function passoMundo(W, S, cfg, dtMin) {
  let mes = false;
  let resto = dtMin;
  while (resto > 0) {
    const dt = Math.min(2, resto);
    if (passoCurto(W, S, cfg, dt)) mes = true;
    resto -= dt;
  }
  return mes;
}

export function pularDia(W, S, cfg) {
  const m = minutoDoDia(S);
  let faltam = (7 * 60 - m + MIN_DIA) % MIN_DIA;
  if (faltam < 5) faltam += MIN_DIA;
  let mes = false;
  for (let r = faltam; r > 0; r -= 5) if (passoMundo(W, S, cfg, Math.min(5, r))) mes = true;
  return mes;
}

export function pularMes(W, S, cfg) {
  const alvo = (Math.floor(diaDoJogo(S) / DIAS_MES) + 1) * DIAS_MES * MIN_DIA;
  const faltam = alvo - S.mundo.min;
  let mes = false;
  for (let r = faltam; r > 0; r -= 5) if (passoMundo(W, S, cfg, Math.min(5, r))) mes = true;
  return mes;
}

/* ---------- Consultas para a interface ---------- */
export function acaoAtual(W, S, a) {
  if (a.k === 'staff') {
    if (!a.vis) return 'Fora do expediente';
    if (a.afz && a.afz.reuniao && !a.tarefa) return a.afz.fase === 'indo' ? '🚶 Indo para a reunião de equipe' : '👥 Em reunião de equipe';
    if (a.afz && !a.tarefa) return a.afz.fase === 'indo' ? `🚶 Indo: ${a.afz.def.rot}` : `${a.afz.def.ic} ${a.afz.def.rot}`;
    if (a.tarefa) {
      const t = a.tarefa;
      if (t.ord) return { chamando: '📣 Chamando o paciente', pronto: '🧑 Paciente pronto', atendendo: '🩺 Atendendo', resultado: '📝 Atendimento concluído' }[t.fase];
      return { visita: '🏠 Em visita domiciliar', orientar: '💬 Orientando', mutirao: '🧹 Mutirão contra focos', pessoa: t.fase === 'indo' ? '🚶 Indo até a pessoa' : '🙂 Atendendo a pessoa' }[t.tipo] || 'Trabalhando';
    }
    return a.path.length ? '🚶 Andando' : 'Aguardando';
  }
  const p = achaPessoa(S, a.pid);
  if (!a.vis) return p.internado ? '🏥 Internado(a)' : '—';
  if (a.pausa > 0) return '🙂 Conversando';
  if (a.atend) return a.atend.pronto ? '🩺 Em atendimento' : '🚶 Indo ao atendimento';
  if (a.espera) return '🪑 Aguardando atendimento na unidade';
  if (a.pend && a.pend.k === 'ubs') return '🚶 A caminho da unidade';
  if (a.acao) return `${ACOES[a.acao.k].ic} ${ACOES[a.acao.k].rot}`;
  if (a.path.length) return '🚶 Andando';
  return a.jogador ? '🧍 Aguardando suas ordens' : '…';
}

export function bolhaDe(W, S, a) {
  if (a.k === 'staff' && a.afz && !a.tarefa && a.afz.fase === 'fazendo') return a.afz.def.ic;
  if (a.k === 'staff') return a.tarefa ? (a.tarefa.tipo === 'mutirao' ? '🧹' : a.tarefa.tipo === 'visita' ? '🏠' : a.tarefa.fase === 'atendendo' ? '🩺' : null) : null;
  const p = achaPessoa(S, a.pid);
  if (a.jogador) { if (p.dengue.ativa) return '🤒'; }
  else if (sintomasDengueVisiveis(S, p)) return '🤒';
  if (a.atend && a.atend.pronto) return '🩺';
  if (a.espera) return '⏳';
  if (a.acao && ACOES[a.acao.k]) return ACOES[a.acao.k].ic;
  const n = S.mundo.needs[a.pid];
  if (n.humor < 25) return '😞';
  return null;
}

export function resumoEquipe(W) {
  return { acs: W.tarefasACS.length, triagem: filaEspera(W, 'triagem').length, enfermagem: filaEspera(W, 'enfermagem').length, consulta: filaEspera(W, 'consulta').length, chamados: W.ordens.length };
}
