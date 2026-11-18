// Mundo em tempo real (estilo "vida simulada"): mapa, personagens que andam, necessidades, rotina e equipe da UBS.
// Sem DOM. Os desfechos de saúde continuam sendo calculados pelo motor (engine.js); aqui nasce o comportamento
// (hábitos) e acontecem as ações da equipe (deslocamento, fila, atendimento) que antes eram instantâneas.
import { clamp, rnd, rint, rfloat } from './rng.js';
import {
  avancarMes, achaPessoa, achaFamilia, todasPessoas, adesao, sintomasDengueVisiveis,
  acaoVisita, acaoMedir, acaoConsulta, acaoOrientar, acaoMutirao,
} from './engine.js';

const CAMINHAVEL = new Set(['.', ',', 'c', 'F', '_', '+']);
export const MIN_DIA = 1440;
export const DIAS_MES = 30;
const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

/* ---------- Configuração por cenário ---------- */

function mesclar(a, b) {
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) a[k] = mesclar(a[k] && typeof a[k] === 'object' ? a[k] : {}, b[k]);
    else a[k] = b[k];
  }
  return a;
}

/** Junta regras gerais + cenário escolhido: { game, cond, territorio, cenario, modelos, objetos, ... } */
export function montarCfg(base, id) {
  const c = base.cenarios.cenarios[id];
  const game = mesclar(JSON.parse(JSON.stringify(base.game)), c.game);
  return {
    game, cond: base.cond, territorio: c.territorio, cenario: { id, ...c },
    modelos: base.cenarios.modelos, objetos: base.cenarios.objetos, terreno: base.cenarios.terreno, pisos: base.cenarios.pisos,
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

  const bloq = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) if (!CAMINHAVEL.has(terr[k])) bloq[k] = 1;
  for (const o of objs) bloq[idx(o.x, o.y)] = 1;

  const porTipo = {};
  for (const o of objs) (porTipo[o.t] ||= []).push(o);
  return { w, h, terr, piso, objs, casas, ubs, lugares, bloq, porTipo };
}

const caminhavel = (W, x, y) => x >= 0 && y >= 0 && x < W.w && y < W.h && !W.bloq[y * W.w + x];

/** Tiles caminháveis vizinhos de um objeto (de onde ele pode ser usado). */
function pontosDeUso(W, o) {
  if (o.pontos) return o.pontos;
  o.pontos = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: o.x + dx, y: o.y + dy })).filter((q) => caminhavel(W, q.x, q.y));
  return o.pontos;
}

/** Busca em largura até o alvo mais próximo. Devolve a lista de tiles (sem o ponto de partida) ou null. */
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

/* ---------- Estado persistente do mundo (dentro de S.mundo) ---------- */

const NECESSIDADES = ['fome', 'energia', 'higiene', 'disp', 'humor'];
export const ROTULO_NEC = { fome: ['🍽️', 'Fome'], energia: ['😴', 'Energia'], higiene: ['🚿', 'Higiene'], disp: ['🏃', 'Disposição'], humor: ['😊', 'Humor'] };

function contadoresNovos() {
  return { exMin: 0, sedMin: 0, saudavel: 0, fast: 0, sonoMin: 0, humorSoma: 0, humorN: 0, trabMin: 0, cafe: false, almoco: false, jantar: false };
}

export function iniciarEstadoMundo(S) {
  const M = { v: 1, min: 6 * 60, rng: (S.seed ^ 0x9e3779b9) >>> 0 || 7, needs: {}, dia: {}, intencao: {}, fumar: {} };
  for (const p of todasPessoas(S)) {
    M.needs[p.id] = { fome: rint(M, 60, 95), energia: rint(M, 70, 100), higiene: rint(M, 60, 95), disp: rint(M, 50, 90), humor: rint(M, 55, 90) };
    M.dia[p.id] = contadoresNovos();
    M.intencao[p.id] = { atividade: 0, alimentacao: 0, sono: 0, estresse: 0 };
    M.fumar[p.id] = 8 * 60 + rint(M, 0, 120);
  }
  S.mundo = M;
}

/* ---------- Criação do mundo em execução (não é salvo; é reconstruído) ---------- */

export function criarMundo(S, cfg) {
  const W = construirMapa(cfg);
  W.agentes = [];
  W.ordens = [];
  W.tarefasACS = [];
  W.ubsFila = { triagem: [], consulta: [] };
  W.vel = cfg.cenario.mundo.velocidade || 1;
  W.msgs = [];
  W.relatorio = null;
  W.sinal = 0;
  for (const f of S.familias) for (const p of f.pessoas) W.agentes.push(novoAgente('res', p.id, { pid: p.id }));
  sincronizarEquipe(W, S);
  for (const a of W.agentes) if (a.k === 'res') posicionarEmCasa(W, S, a);
  return W;
}

function novoAgente(k, id, extra) {
  return { k, id, x: 0, y: 0, path: [], acao: null, pend: null, facing: 1, vis: false, espera: null, atend: null, tarefa: null, ...extra };
}

export function numMedicos(S) { return 1 + (S.predios.consultorio >= 1 ? 1 : 0); }
export function numACS(S) { return 1 + S.predios.acs; }
const duracaoConsulta = (S) => 30 - 5 * Math.max(0, S.predios.consultorio - 1);

export function sincronizarEquipe(W, S) {
  const quer = [['tecnico', 1], ['medico', numMedicos(S)], ['acs', numACS(S)]];
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
  a.x = q.x; a.y = q.y; a.path = []; a.acao = null; a.pend = null; a.vis = true;
}

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

export function ubsAberta(W, S, cfg, medico = false) {
  const [ini, fim] = cfg.cenario.mundo.expediente;
  const m = minutoDoDia(S), dow = diaSemana(S);
  if (dow > 4 || m < ini * 60 || m >= fim * 60) return false;
  if (medico && !cfg.cenario.mundo.medicoDias.includes(dow)) return false;
  return true;
}

const ACOES = {
  dormir: { ic: '💤', rot: 'Dormindo', obj: 'B', casa: true, dur: 720, max: 720, ef: (n, dt) => { n.energia += 0.1 * dt; n.fome -= 0.02 * dt; }, fim: (n) => n.energia >= 97, cont: 'sonoMin' },
  descansar: { ic: '🤒', rot: 'Acamado(a), com febre', obj: 'B', casa: true, dur: 240, ef: (n, dt) => { n.energia += 0.03 * dt; n.humor -= 0.02 * dt; } },
  banho: { ic: '🚿', rot: 'Tomando banho', obj: 'C', casa: true, dur: 15, ef: (n, dt) => { n.higiene += 6 * dt; } },
  comer: { ic: '🍳', rot: 'Refeição caseira', obj: 'G', casa: true, dur: 25, ef: (n, dt) => { n.fome += 3.6 * dt; }, fimC: (c, p, int, M) => { if (rnd(M) < clamp(0.3 + 0.65 * p.habitos.alimentacao / 100 + 0.4 * int.alimentacao, 0, 0.98)) c.saudavel++; else c.fast++; } },
  lanche: { ic: '🍔', rot: 'Comendo na lanchonete', obj: 'L', dur: 20, ef: (n, dt) => { n.fome += 4.5 * dt; n.humor += 0.4 * dt; }, fimC: (c) => { c.fast++; } },
  tv: { ic: '📺', rot: 'Descansando na TV', obj: 'S', casa: true, dur: 60, ef: (n, dt) => { n.humor += 0.18 * dt; n.disp -= 0.04 * dt; }, cont: 'sedMin' },
  praca: { ic: '🚶', rot: 'Passeando na praça', obj: 'P', dur: 45, ef: (n, dt) => { n.disp += 0.5 * dt; n.humor += 0.25 * dt; }, cont: 'exMin' },
  academia: { ic: '🏋️', rot: 'Exercitando-se', obj: 'A', dur: 40, ef: (n, dt) => { n.disp += 0.8 * dt; n.humor += 0.2 * dt; }, cont: 'exMin' },
  trabalho: { ic: '💼', rot: 'Trabalhando', obj: 'O', dur: 0, ef: (n, dt) => { n.disp -= 0.03 * dt; n.humor -= 0.04 * dt; }, cont: 'trabMin' },
  roca: { ic: '🌽', rot: 'Trabalhando na roça', obj: 'R', dur: 0, ef: (n, dt) => { n.disp += 0.1 * dt; n.humor -= 0.03 * dt; n.fome -= 0.02 * dt; }, cont: 'trabMin', exLeve: 0.15 },
  escola: { ic: '📚', rot: 'Na escola', obj: 'E', dur: 0, ef: (n, dt) => { n.humor += 0.02 * dt; }, cont: 'trabMin' },
  fumar: { ic: '🚬', rot: 'Fumando', dur: 6, local: 'porta', ef: (n, dt) => { n.humor += 0.8 * dt; } },
  conversar: { ic: '💬', rot: 'Conversando', dur: 30, local: 'rua', ef: (n, dt) => { n.humor += 0.3 * dt; n.disp += 0.12 * dt; }, cont: 'exMin', exLeve: 0.3 },
};
export const ROTULO_ACAO = Object.fromEntries(Object.entries(ACOES).map(([k, v]) => [k, v.rot]));

/* ---------- Decisão dos moradores ---------- */

function decidir(W, S, cfg, a, p, f, n, c, int) {
  const M = S.mundo, m = minutoDoDia(S), dow = diaSemana(S), util = dow < 5;
  const oc = p.ocupacao || 'casa';
  const mundo = cfg.cenario.mundo;
  const temLanche = (W.porTipo.L || []).length > 0;

  // 1) atendimento marcado pelo jogador (ou procura espontânea)
  const ord = W.ordens.find((o) => o.pid === p.id);
  if (ord && ord.estado === 'pendente' && !(a.acao && a.acao.k === 'dormir')) {
    const abre = ubsAberta(W, S, cfg, ord.tipo === 'consulta') && m >= mundo.expediente[0] * 60 + 15 && m < mundo.expediente[1] * 60 - 60;
    if (abre) {
      if (!ord.rolou) {
        ord.rolou = true;
        if (!ord.espontaneo && rnd(M) > adesao(f)) {
          W.ordens.splice(W.ordens.indexOf(ord), 1);
          avisar(W, S, `${p.nome} não compareceu à unidade (vínculo baixo: é mais difícil ir). Uma visita ajuda.`, 'info');
          return null;
        }
      }
      ord.estado = 'indo';
      return { k: 'ubs', ord };
    }
  }
  if (p.dengue.ativa && f.vinculo >= 50 && !a.procurou && !ord) {
    a.procurou = true;
    W.ordens.push({ pid: p.id, tipo: 'consulta', estado: 'pendente', espontaneo: true, rolou: false });
  }

  // 2) doente: repouso em casa
  if (p.dengue.ativa) return { k: 'descansar' };

  // 3) sono
  const dormeAs = 22 * 60 + Math.round(((100 - p.habitos.sono) / 100) * 150) - Math.round(60 * int.sono);
  const noite = m >= dormeAs || m < 5 * 60;
  if ((noite && n.energia < 97) || n.energia < 18) return { k: 'dormir' };

  // 4) higiene e refeições
  if (n.higiene < 35 || (m >= 6 * 60 && m < 8 * 60 && n.higiene < 80)) return { k: 'banho' };
  if (m >= 6 * 60 && m < 9 * 60 && !c.cafe && n.fome < 85) { c.cafe = true; return { k: 'comer' }; }
  if (m >= 12 * 60 && m < 14 * 60 && !c.almoco && n.fome < 92) {
    c.almoco = true;
    const pFast = clamp(((100 - p.habitos.alimentacao) / 100) * 0.9 - int.alimentacao * 0.5, 0, 0.9);
    if (temLanche && mundo.almoco === 'lanchonete' && rnd(M) < Math.max(0.15, pFast)) return { k: 'lanche' };
    return { k: 'comer' };
  }
  if (m >= 19 * 60 && m < 21 * 60 && !c.jantar && n.fome < 92) { c.jantar = true; return { k: 'comer' }; }
  if (n.fome < 25) return { k: 'comer' };

  // 5) cigarro
  if (p.tabagismo && m >= M.fumar[p.id] && m < 22 * 60) { M.fumar[p.id] = m + 150 + rint(M, 0, 60); return { k: 'fumar' }; }

  // 6) trabalho e escola
  if (util && oc === 'trabalho' && !p.dengue.ativa) {
    if (m >= 7.5 * 60 && m < 12 * 60) return { k: mundo.trabalho === 'R' ? 'roca' : 'trabalho', fim: 12 * 60 };
    if (m >= 13 * 60 && m < 17 * 60) return { k: mundo.trabalho === 'R' ? 'roca' : 'trabalho', fim: 17 * 60 };
  }
  if (util && oc === 'escola' && m >= 7 * 60 && m < 12 * 60) return { k: 'escola', fim: 12 * 60 };

  // 7) lazer
  if (m < 6 * 60 + 30 || m >= 22 * 60) return { k: 'tv' };
  const temPraca = objetosDe(W, 'P', null).length > 0, temAcad = objetosDe(W, 'A', null).length > 0;
  const ativ = p.habitos.atividade / 100 + int.atividade * 0.8;
  // exercício ao ar livre: horários mais frescos e teto diário (ninguém passa o dia inteiro na praça)
  const fresco = (m >= 6.5 * 60 && m < 10 * 60) || (m >= 16 * 60 && m < 20 * 60);
  const fatorEx = (fresco ? 1 : 0.15) * (c.exMin >= 60 ? 0.1 : 1) * (!util ? 1.3 : 1);
  const op = [['tv', 0.9 + (1 - ativ) * 1.6 + (n.humor < 40 ? 0.5 : 0)]];
  if (temPraca) op.push(['praca', (0.15 + ativ * 0.9) * fatorEx]);
  if (temAcad && p.idade >= 14) op.push(['academia', (0.05 + ativ * 0.6 + int.atividade * 0.6) * fatorEx]);
  if (!temPraca) op.push(['conversar', (0.2 + ativ * 0.9) * fatorEx]);
  if (temLanche && mundo.almoco === 'lanchonete' && m >= 17 * 60 && p.idade >= 14) op.push(['lanche', 0.1 + ((100 - p.habitos.alimentacao) / 100) * 0.8 - int.alimentacao * 0.4]);
  if (p.idade < 12) return { k: escolhe(M, [['tv', 1], ['praca', temPraca ? 0.9 * fatorEx : 0], ['conversar', temPraca ? 0 : 0.8 * fatorEx]]) };
  return { k: escolhe(M, op.map(([k, w]) => [k, Math.max(0.02, w)])) };
}

function avisar(W, S, texto, tipo = 'info', extra = {}) {
  W.msgs.push({ texto, tipo });
  S.diario.push({ mes: S.mes, ano: S.ano, tipo, texto, ...extra });
}

/** Define a rota até um dos alvos; se já está lá, "chega" na hora. */
function partir(W, S, cfg, a, p, alvos) {
  if (!irPara(W, a, alvos)) return false;
  if (!a.path.length) chegada(W, S, cfg, a, p);
  return true;
}

/** Começa a executar uma decisão: escolhe o objeto/local, calcula a rota. */
function iniciarDecisao(W, S, cfg, a, p, d) {
  if (d.k === 'ubs') {
    const alvos = objetosDe(W, 'H', null).flatMap((o) => pontosDeUso(W, o));
    a.pend = { k: 'ubs', ord: d.ord };
    if (!partir(W, S, cfg, a, p, alvos)) { a.pend = null; d.ord.estado = 'pendente'; }
    return;
  }
  const def = ACOES[d.k];
  const dur = d.dur || def.dur || 30;
  const semLocal = () => { a.pend = null; a.acao = { k: d.k, restante: Math.min(30, dur), sem: true }; };
  if (def.obj) {
    const casa = def.casa ? p.familiaId : null;
    let lista = objetosDe(W, def.obj, casa);
    if (!lista.length && def.obj === 'S') lista = objetosDe(W, 'B', casa);
    if (!lista.length) return semLocal();
    const o = def.casa ? lista[hash(p.id + d.k) % lista.length] : lista[hash(p.id) % lista.length];
    a.pend = { k: d.k, dur, fim: d.fim, obj: o };
    if (!partir(W, S, cfg, a, p, pontosDeUso(W, o))) semLocal();
    return;
  }
  if (def.local === 'porta') {
    a.pend = { k: d.k, dur };
    if (!partir(W, S, cfg, a, p, [W.casas[p.familiaId].porta.fora])) semLocal();
    return;
  }
  if (def.local === 'rua') {
    const q = pontoAleatorio(W, S.mundo, a);
    a.pend = { k: d.k, dur, andar: true };
    if (!q || !partir(W, S, cfg, a, p, [q])) semLocal();
  }
}

function pontoAleatorio(W, M, a) {
  for (let t = 0; t < 40; t++) {
    const x = clamp(Math.round(a.x) + rint(M, -9, 9), 0, W.w - 1), y = clamp(Math.round(a.y) + rint(M, -9, 9), 0, W.h - 1);
    const k = y * W.w + x;
    if (!W.bloq[k] && (W.terr[k] === '.' || W.terr[k] === ',' || W.terr[k] === 'c')) return { x, y };
  }
  return null;
}

/* ---------- Passo de cada tipo de agente ---------- */

function mover(a, dt, vel) {
  let d = vel * dt;
  while (d > 0 && a.path.length) {
    const t = a.path[0];
    const dx = t.x - a.x, dy = t.y - a.y, dist = Math.hypot(dx, dy);
    if (dx) a.facing = dx > 0 ? 1 : -1;
    if (dist <= d) { a.x = t.x; a.y = t.y; a.path.shift(); d -= dist; } else { a.x += (dx / dist) * d; a.y += (dy / dist) * d; d = 0; }
  }
}

function passoMorador(W, S, cfg, a, dt) {
  const p = achaPessoa(S, a.pid), f = achaFamilia(S, p.familiaId), M = S.mundo;
  const n = M.needs[a.pid], c = M.dia[a.pid], int = M.intencao[a.pid];
  if (p.internado) { a.vis = false; a.path = []; a.acao = null; a.pend = null; a.espera = null; a.atend = null; limparOrdens(W, p.id); return; }
  if (!a.vis) { posicionarEmCasa(W, S, a); }

  // necessidades
  const dormindo = a.acao && (a.acao.k === 'dormir');
  n.fome -= (dormindo ? 0.02 : 0.065) * dt;
  if (!dormindo) n.energia -= 0.05 * dt;
  n.higiene -= 0.03 * dt;
  n.disp -= 0.03 * dt;
  const media = (n.fome + n.energia + n.higiene + n.disp) / 4;
  n.humor += (media - n.humor) * 0.004 * dt;
  if (p.cond.dep.estagio >= 2 && !p.cond.dep.ctrl) n.humor -= 0.02 * dt;
  if (!dormindo) c.sedMin += (a.path.length ? 0 : dt);

  if (a.path.length) {
    mover(a, dt, W.vel);
    c.exMin += dt * 0.25; // deslocamento a pé conta como atividade leve
    if (a.pend && a.pend.andar) c.exMin += dt * 0.5;
    if (!a.path.length) chegada(W, S, cfg, a, p);
  } else if (a.atend) {
    // esperando o profissional (a lógica da UBS controla o tempo)
    n.humor -= 0.005 * dt;
  } else if (a.espera) {
    n.humor -= 0.01 * dt; // ficar na fila cansa
  } else if (a.acao) {
    const def = ACOES[a.acao.k];
    if (def.ef) def.ef(n, dt);
    if (def.cont) c[def.cont] += dt * (def.cont === 'exMin' ? 1 : 1);
    if (def.exLeve) c.exMin += dt * def.exLeve;
    a.acao.restante -= dt;
    const alarme = a.acao.k === 'dormir' && minutoDoDia(S) >= 6 * 60 && minutoDoDia(S) < 12 * 60 && diaSemana(S) < 5 && ['trabalho', 'escola'].includes(p.ocupacao);
    const fim = alarme || (def.fim && def.fim(n)) || a.acao.restante <= 0 || (def.max && (a.acao.t = (a.acao.t || 0) + dt) > def.max);
    if (fim) {
      if (def.fimC) def.fimC(c, p, int, M);
      if (a.acao.k === 'dormir' && minutoDoDia(S) < 5 * 60) { /* acordou cedo: segue o dia */ }
      a.acao = null;
    }
  } else {
    const d = decidir(W, S, cfg, a, p, f, n, c, int);
    if (d) iniciarDecisao(W, S, cfg, a, p, d);
    else a.acao = { k: 'tv', restante: 5, sem: true };
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
    a.espera = ord;
    (W.ubsFila[ord.tipo] ||= []).push(a.id);
    return;
  }
  if (pend.k === 'atendido') { a.atend.pronto = true; return; }
  const def = ACOES[pend.k];
  const dur = pend.fim != null ? Math.max(5, pend.fim - minutoDoDia(S)) : (pend.dur || def.dur || 30);
  a.acao = { k: pend.k, restante: dur, obj: pend.obj };
}

function limparOrdens(W, pid) {
  W.ordens = W.ordens.filter((o) => o.pid !== pid);
  for (const k of Object.keys(W.ubsFila)) W.ubsFila[k] = W.ubsFila[k].filter((id) => id !== pid);
}

/* ---------- Equipe da UBS ---------- */

function postoDe(W, papel, ind) {
  if (papel === 'tecnico') {
    const o = (W.porTipo.U || [])[0];
    return o ? pontosDeUso(W, o) : [];
  }
  if (papel === 'medico') {
    const o = (W.porTipo.D || [])[ind] || (W.porTipo.D || [])[0];
    return o ? pontosDeUso(W, o) : [];
  }
  const p = W.ubs.porta.fora;
  return [{ x: p.x + ind - 1, y: p.y }];
}

function passoEquipe(W, S, cfg, a, dt) {
  const abertoGeral = ubsAberta(W, S, cfg);
  const deveEstar = a.papel === 'medico' ? ubsAberta(W, S, cfg, true) : abertoGeral;
  if (!a.vis) {
    if (!deveEstar) return;
    a.vis = true;
    const q = W.ubs.porta.fora;
    a.x = q.x; a.y = q.y; a.path = []; a.tarefa = null;
  }
  if (!deveEstar && !a.tarefa && !a.path.length) { a.vis = false; liberarFila(W, a); return; }
  if (a.path.length) { mover(a, dt, W.vel); return; }

  if (a.papel === 'acs') return passoACS(W, S, cfg, a, dt);

  const posto = postoDe(W, a.papel, a.ind);
  const naPosicao = posto.find((q) => q.x === a.x && q.y === a.y);
  if (!a.tarefa) {
    if (!naPosicao && posto.length) { irPara(W, a, [posto[0]]); return; }
    // próximo paciente
    const tipo = a.papel === 'tecnico' ? 'triagem' : 'consulta';
    const fila = W.ubsFila[tipo];
    for (let i = 0; i < fila.length; i++) {
      const pac = W.agentes.find((x) => x.id === fila[i]);
      if (!pac || !pac.espera || pac.atend) continue;
      fila.splice(i, 1);
      const oposto = pontosDeUso(W, a.papel === 'tecnico' ? W.porTipo.U[0] : (W.porTipo.D[a.ind] || W.porTipo.D[0])).filter((q) => !posto.length || q.x !== posto[0].x || q.y !== posto[0].y);
      const spot = oposto[0] || posto[0];
      pac.atend = { staff: a.id, spot, pronto: false, tipo };
      pac.pend = { k: 'atendido' };
      if (!irPara(W, pac, [spot]) || !pac.path.length) { pac.pend = null; pac.atend.pronto = true; }
      a.tarefa = { tipo, pac: pac.id, restante: tipo === 'triagem' ? 10 : duracaoConsulta(S), fase: 'chamando' };
      break;
    }
    return;
  }
  const t = a.tarefa;
  const pac = W.agentes.find((x) => x.id === t.pac);
  if (!pac || !pac.atend) { a.tarefa = null; return; }
  if (!naPosicao && posto.length) { if (!a.path.length) irPara(W, a, [posto[0]]); return; }
  if (!pac.atend.pronto) return;
  t.fase = 'atendendo';
  t.restante -= dt;
  if (t.restante > 0) return;
  const p = achaPessoa(S, pac.pid);
  const r = t.tipo === 'triagem' ? acaoMedir(S, cfg, p.id) : acaoConsulta(S, cfg, p.id);
  avisar(W, S, `${t.tipo === 'triagem' ? '📏' : '🩺'} ${p.nome}: ${r.msg}`, 'info', { pessoaId: p.id });
  W.ordens = W.ordens.filter((o) => o.pid !== p.id);
  pac.espera = null; pac.atend = null; pac.pend = null;
  a.tarefa = null;
  W.sinal++;
}

function liberarFila(W) {
  for (const a of W.agentes) if (a.k === 'res' && a.espera && !a.atend) {
    a.espera.estado = 'pendente';
    a.espera = null;
  }
  W.ubsFila = { triagem: [], consulta: [] };
}

function passoACS(W, S, cfg, a, dt) {
  if (!a.tarefa) {
    if (W.tarefasACS.length && ubsAberta(W, S, cfg)) {
      a.tarefa = W.tarefasACS.shift();
      const t = a.tarefa;
      t.fase = 'indo';
      if (t.tipo === 'mutirao') {
        t.pontos = []; for (let i = 0; i < 3; i++) t.pontos.push(pontoAleatorio(W, S.mundo, { x: W.ubs.porta.fora.x, y: W.ubs.porta.fora.y }) || W.ubs.porta.fora);
        t.i = 0; irPara(W, a, [t.pontos[0]]);
      } else {
        const fam = t.tipo === 'visita' ? t.fam : achaPessoa(S, t.pid).familiaId;
        t.fam = fam;
        if (!irPara(W, a, [W.casas[fam].porta.dentro])) { a.tarefa = null; }
      }
      return;
    }
    const posto = postoDe(W, 'acs', a.ind)[0];
    if (posto && (a.x !== posto.x || a.y !== posto.y)) irPara(W, a, [posto]);
    return;
  }
  const t = a.tarefa;
  if (t.fase === 'indo') {
    t.fase = 'fazendo';
    t.restante = t.tipo === 'visita' ? 40 : t.tipo === 'orientar' ? 30 : 45;
  }
  t.restante -= dt;
  if (t.restante > 0) return;
  if (t.tipo === 'mutirao' && t.i < 2) { t.i++; t.restante = 45; irPara(W, a, [t.pontos[t.i]]); t.fase = 'indo'; return; }
  let r;
  if (t.tipo === 'visita') {
    r = acaoVisita(S, cfg, t.fam);
    avisar(W, S, `🚶 ${achaFamilia(S, t.fam).nome}: ${r.msg}`, r.ok ? 'info' : 'info');
  } else if (t.tipo === 'orientar') {
    r = acaoOrientar(S, cfg, t.pid, t.foco);
    if (r.ok && t.foco !== 'fumo') {
      const it = S.mundo.intencao[t.pid]; const k = t.foco === 'estresse' ? 'estresse' : t.foco;
      if (k in it) it[k] = clamp(it[k] + 0.5, 0, 1);
    }
    avisar(W, S, `💬 ${achaPessoa(S, t.pid).nome}: ${r.msg}`, 'info', { pessoaId: t.pid });
  } else {
    r = acaoMutirao(S, cfg);
    avisar(W, S, `🧹 ${r.msg}`, r.ok ? 'bom' : 'info');
  }
  a.tarefa = null;
  W.sinal++;
}

/* ---------- Ordens do jogador ---------- */

const jaNaFilaACS = (W, tipo, chave) => W.tarefasACS.some((t) => t.tipo === tipo && (t.fam === chave || t.pid === chave)) || W.agentes.some((a) => a.tarefa && a.tarefa.tipo === tipo && (a.tarefa.fam === chave || a.tarefa.pid === chave));

export function ordenarVisita(W, S, cfg, famId) {
  const f = achaFamilia(S, famId);
  if (f.visTurno === S.turno) return { ok: false, msg: 'Esta família já foi visitada neste mês.' };
  if (jaNaFilaACS(W, 'visita', famId)) return { ok: false, msg: 'O agente comunitário já vai até lá.' };
  W.tarefasACS.push({ tipo: 'visita', fam: famId });
  return { ok: true, msg: `Visita à ${f.nome} na fila do agente comunitário (${W.tarefasACS.length}).` };
}

export function ordenarOrientar(W, S, cfg, pid, foco) {
  const p = achaPessoa(S, pid);
  if (p.internado) return { ok: false, msg: `${p.nome} está internado(a).` };
  if (foco === 'fumo' && !p.tabagismo) return { ok: false, msg: 'Esta pessoa não fuma.' };
  if (jaNaFilaACS(W, 'orientar', pid)) return { ok: false, msg: 'Já há uma orientação pedida para esta pessoa.' };
  W.tarefasACS.push({ tipo: 'orientar', pid, foco });
  return { ok: true, msg: `Orientação para ${p.nome} na fila do agente comunitário (${W.tarefasACS.length}).` };
}

export function ordenarMutirao(W, S, cfg) {
  if (S.mutiraoTurno === S.turno) return { ok: false, msg: 'O mutirão já foi realizado neste mês.' };
  if (W.tarefasACS.some((t) => t.tipo === 'mutirao') || W.agentes.some((a) => a.tarefa && a.tarefa.tipo === 'mutirao')) return { ok: false, msg: 'O mutirão já está a caminho.' };
  W.tarefasACS.push({ tipo: 'mutirao' });
  return { ok: true, msg: 'Mutirão contra focos na fila da equipe.' };
}

export function ordenarUnidade(W, S, cfg, pid, tipo) {
  const p = achaPessoa(S, pid);
  if (p.internado) return { ok: false, msg: `${p.nome} está internado(a).` };
  if (tipo === 'triagem' && p.idade < 18) return { ok: false, msg: 'A triagem de PA e glicemia é para adultos.' };
  if (W.ordens.some((o) => o.pid === pid)) return { ok: false, msg: `${p.nome} já foi chamado(a) à unidade.` };
  W.ordens.push({ pid, tipo, estado: 'pendente', rolou: false });
  const med = tipo === 'consulta' && cfg.cenario.mundo.medicoDias.length < 5 ? ' O médico atende só em alguns dias da semana.' : '';
  return { ok: true, msg: `${p.nome} foi chamado(a) para ${tipo === 'triagem' ? 'a triagem' : 'a consulta'}. Vai quando a unidade estiver aberta.${med}` };
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
    for (const a of W.agentes) if (a.k === 'res') a.procurou = false;
    if (diaDoJogo(S) % DIAS_MES === 0) {
      W.relatorio = avancarMes(S, cfg);
      sincronizarEquipe(W, S);
      W.sinal++;
      return true;
    }
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

/** Avança direto até as 7h do próximo dia (sem animação). Devolve true se um mês terminou. */
export function pularDia(W, S, cfg) {
  const m = minutoDoDia(S);
  let faltam = (7 * 60 - m + MIN_DIA) % MIN_DIA;
  if (faltam < 5) faltam += MIN_DIA;
  let mes = false;
  for (let r = faltam; r > 0; r -= 5) if (passoMundo(W, S, cfg, Math.min(5, r))) mes = true;
  return mes;
}

/** Avança direto até o fim do mês corrente (sem animação). */
export function pularMes(W, S, cfg) {
  const alvo = (Math.floor(diaDoJogo(S) / DIAS_MES) + 1) * DIAS_MES * MIN_DIA;
  const faltam = alvo - S.mundo.min;
  let mes = false;
  for (let r = faltam; r > 0; r -= 5) if (passoMundo(W, S, cfg, Math.min(5, r))) mes = true;
  return mes;
}

/* ---------- Consultas para a interface ---------- */

export function acaoAtual(W, S, a) {
  const p = achaPessoa(S, a.pid);
  if (!a.vis) return p.internado ? '🏥 Internado(a)' : '—';
  if (a.atend) return a.atend.pronto ? '🩺 Em atendimento' : '🚶 Indo ao atendimento';
  if (a.espera) return '🪑 Aguardando atendimento na unidade';
  if (a.pend && a.pend.k === 'ubs') return '🚶 A caminho da unidade';
  if (a.acao) return `${ACOES[a.acao.k].ic} ${ACOES[a.acao.k].rot}`;
  if (a.path.length) return '🚶 Andando';
  return '…';
}

export function bolhaDe(W, S, a) {
  if (a.k === 'staff') return a.tarefa ? (a.tarefa.tipo === 'mutirao' ? '🧹' : a.tarefa.tipo === 'visita' ? '🏠' : a.tarefa.fase === 'atendendo' ? '🩺' : null) : null;
  const p = achaPessoa(S, a.pid);
  if (sintomasDengueVisiveis(S, p)) return '🤒';
  if (a.atend && a.atend.pronto) return '🩺';
  if (a.espera) return '⏳';
  if (a.acao && ACOES[a.acao.k]) return ACOES[a.acao.k].ic;
  const n = S.mundo.needs[a.pid];
  if (n.humor < 25) return '😞';
  return null;
}

export function resumoEquipe(W, S) {
  return { acs: W.tarefasACS.length, triagem: W.ubsFila.triagem.length, consulta: W.ubsFila.consulta.length, chamados: W.ordens.length };
}

export const ACOES_INFO = ACOES;
