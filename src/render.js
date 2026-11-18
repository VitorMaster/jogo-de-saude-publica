// Desenho isométrico do mundo (canvas 2D): terreno, paredes recortadas, móveis com volume, personagens animados,
// partículas, iluminação de dia/noite e câmera por toque. Nenhuma regra de jogo mora aqui.
import { achaPessoa } from './engine.js';
import { minutoDoDia, bolhaDe, ubsAberta } from './mundo.js';

const HW = 32, HH = 16; // meia-largura e meia-altura do losango do tile
const FONTE_EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const proj = (x, y, z = 0) => [(x - y) * HW, (x + y) * HH - z];

/* ---------- Cores ---------- */
function rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function mistura(a, b, t) { const A = rgb(a), B = rgb(b); return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`; }
const claro = (h, t) => mistura(h, '#ffffff', t);
const escuro = (h, t) => mistura(h, '#000000', t);
const hashR = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const ruido = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

const PELES = ['#f6d3b3', '#eab98e', '#cf966a', '#a8714a', '#7b4b2e'];
const CABELOS = ['#2a1b12', '#47301c', '#8a5a2b', '#161616', '#c9a227', '#6b3a1e'];
const CAMISAS = ['#e06c75', '#e5a54b', '#4f9be8', '#7fc47a', '#b57be0', '#4cc3c9', '#e08f5a', '#ee86a8', '#6c7ae0'];
const CALCAS = ['#34425a', '#4a4f5c', '#5a4a3a', '#2f3e46', '#3d3b6b'];
const PAREDES_CASA = ['#f3dcbc', '#d3e6cf', '#d6e0f3', '#f4d3d4', '#ece6b9'];

function poli(ctx, pts, fill, borda) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (borda) { ctx.strokeStyle = borda; ctx.lineWidth = 1; ctx.stroke(); }
}

/** Caixa isométrica entre (x0,y0) e (x1,y1) em coordenadas de tile, de altura z0 a z1 (px). */
function caixa(ctx, x0, y0, x1, y1, z0, z1, cor, o = {}) {
  const topo = o.topo || claro(cor, 0.2), esq = o.esq || cor, dir = o.dir || escuro(cor, 0.25);
  const borda = o.borda === undefined ? 'rgba(0,0,0,.16)' : o.borda;
  const D = proj(x0, y1, z1), C = proj(x1, y1, z1), B = proj(x1, y0, z1), A = proj(x0, y0, z1);
  const Cb = proj(x1, y1, z0), Db = proj(x0, y1, z0), Bb = proj(x1, y0, z0);
  poli(ctx, [D, C, Cb, Db], esq, borda);
  poli(ctx, [B, C, Cb, Bb], dir, borda);
  poli(ctx, [A, B, C, D], topo, borda);
}
function losango(ctx, i, j, cor, borda) { poli(ctx, [proj(i, j), proj(i + 1, j), proj(i + 1, j + 1), proj(i, j + 1)], cor, borda); }
function elipse(ctx, x, y, rx, ry, cor) { ctx.fillStyle = cor; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill(); }
function rr(ctx, x, y, w, h, r, cor) { ctx.fillStyle = cor; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }

/* ---------- Preparação do mapa ---------- */
function preparaMapa(W) {
  if (W.rv) return W.rv;
  const lugarDe = new Int16Array(W.w * W.h).fill(-1);
  W.lugares.forEach((l, n) => { for (let y = l.y; y < l.y + l.h; y++) for (let x = l.x; x < l.x + l.w; x++) lugarDe[y * W.w + x] = n; });
  W.rv = { lugarDe };
  return W.rv;
}
const ehTerreno = (W, x, y, ch) => x >= 0 && y >= 0 && x < W.w && y < W.h && W.terr[y * W.w + x] === ch;

export function criarRenderer(canvas, getEstado, hooks) {
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, z: 1 };
  let largura = 300, altura = 300, dpr = 1;
  let selecionado = null;
  let paredesBaixas = false;
  const ponteiros = new Map();
  let arraste = null;
  const rs = new Map(); // estado visual de cada agente (posição suavizada, fase da caminhada, direção)
  const noite = document.createElement('canvas');
  const nctx = noite.getContext('2d');

  const E = () => getEstado();

  /* ---------- Câmera ---------- */
  function limitesMundo(W) { return { x0: -W.h * HW, x1: W.w * HW, y0: -90, y1: (W.w + W.h) * HH + 30 }; }
  function limitaCamera() {
    const { W } = E();
    if (!W) return;
    const L = limitesMundo(W);
    const zMin = Math.max(0.18, Math.min(largura / (L.x1 - L.x0), altura / (L.y1 - L.y0)) * 0.98);
    cam.z = Math.max(zMin, Math.min(2.2, cam.z));
    const mL = largura / cam.z / 2, mA = altura / cam.z / 2;
    cam.x = L.x1 - L.x0 < mL * 2 ? (L.x0 + L.x1) / 2 : Math.max(L.x0 + mL - 60, Math.min(L.x1 - mL + 60, cam.x));
    cam.y = L.y1 - L.y0 < mA * 2 ? (L.y0 + L.y1) / 2 : Math.max(L.y0 + mA - 60, Math.min(L.y1 - mA + 60, cam.y));
  }
  function redimensiona() {
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    largura = canvas.clientWidth || 300;
    altura = canvas.clientHeight || 300;
    canvas.width = Math.round(largura * dpr); canvas.height = Math.round(altura * dpr);
    noite.width = canvas.width; noite.height = canvas.height;
    limitaCamera();
  }
  const paraMundo = (px, py) => ({ x: (px - largura / 2) / cam.z + cam.x, y: (py - altura / 2) / cam.z + cam.y });
  function centralizar(tx, ty, z) {
    const [sx, sy] = proj(tx + 0.5, ty + 0.5);
    cam.x = sx; cam.y = sy - 10;
    if (z) cam.z = z;
    limitaCamera();
  }
  function enquadrarUBS() {
    const { W } = E();
    if (!W) return;
    cam.z = Math.min(1, largura / 640);
    centralizar(W.ubs.x + W.ubs.w / 2 - 0.5, W.ubs.y + W.ubs.h / 2 - 0.5);
  }

  /* ---------- Terreno ---------- */
  function desenhaChao(S, W, cfg, i0, i1, j0, j1) {
    const rv = preparaMapa(W);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * W.w + i, ch = W.terr[k], ln = rv.lugarDe[k];
      const r = ruido(i, j);
      if (ln >= 0) { // piso interno
        const l = W.lugares[ln], base = l.piso;
        if (l.modelo === 'lanche') losango(ctx, i, j, (i + j) % 2 ? '#f4d4c0' : '#d9604f', 'rgba(0,0,0,.05)');
        else if (l.modelo === 'ubs' || l.modelo === 'escola') losango(ctx, i, j, (i + j) % 2 ? base : claro(base, 0.35), 'rgba(0,0,0,.05)');
        else if (l.modelo === 'trabalho') losango(ctx, i, j, (i + j) % 2 ? '#c5cfdd' : '#bcc7d8');
        else { // madeira
          losango(ctx, i, j, mistura(base, '#a9794a', 0.12 + r * 0.1));
          ctx.strokeStyle = 'rgba(90,55,25,.22)'; ctx.lineWidth = 1; ctx.beginPath();
          for (let t = 1; t < 4; t++) { const a = proj(i + t / 4, j), b = proj(i + t / 4, j + 1); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
          ctx.stroke();
        }
        continue;
      }
      if (ch === '.') {
        losango(ctx, i, j, r > 0.5 ? '#59636b' : '#5d6770');
        ctx.strokeStyle = 'rgba(235,235,225,.55)'; ctx.lineWidth = 2; ctx.beginPath();
        if (!ehTerreno(W, i, j - 1, '.')) { const a = proj(i, j), b = proj(i + 1, j); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        if (!ehTerreno(W, i - 1, j, '.')) { const a = proj(i, j), b = proj(i, j + 1); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        if (!ehTerreno(W, i, j + 1, '.')) { const a = proj(i, j + 1), b = proj(i + 1, j + 1); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        if (!ehTerreno(W, i + 1, j, '.')) { const a = proj(i + 1, j), b = proj(i + 1, j + 1); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        ctx.stroke();
        const h = ehTerreno(W, i - 1, j, '.') && ehTerreno(W, i + 1, j, '.');
        const v = ehTerreno(W, i, j - 1, '.') && ehTerreno(W, i, j + 1, '.');
        ctx.strokeStyle = 'rgba(250,224,120,.8)'; ctx.lineWidth = 2;
        if (h && !v && i % 2 === 0) {
          const sobe = ehTerreno(W, i, j - 1, '.'), desce = ehTerreno(W, i, j + 1, '.');
          let yy = null;
          if (sobe && desce) yy = j + 0.5; else if (!sobe && desce && !ehTerreno(W, i, j + 2, '.')) yy = j + 1;
          if (yy !== null) { const a = proj(i + 0.15, yy), b = proj(i + 0.85, yy); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        }
        if (v && !h && j % 2 === 0) {
          const esq = ehTerreno(W, i - 1, j, '.'), dir = ehTerreno(W, i + 1, j, '.');
          let xx = null;
          if (esq && dir) xx = i + 0.5; else if (!esq && dir && !ehTerreno(W, i + 2, j, '.')) xx = i + 1;
          if (xx !== null) { const a = proj(xx, j + 0.15), b = proj(xx, j + 0.85); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        }
      } else if (ch === 'c') {
        losango(ctx, i, j, (i + j) % 2 ? '#cfd6d2' : '#c4ccc8', 'rgba(0,0,0,.07)');
      } else if (ch === 'F') {
        losango(ctx, i, j, mistura('#8a5a32', '#6f4526', r * 0.5));
        ctx.strokeStyle = 'rgba(40,22,8,.35)'; ctx.lineWidth = 2; ctx.beginPath();
        for (let t = 1; t < 4; t++) { const a = proj(i + t / 4, j + 0.04), b = proj(i + t / 4, j + 0.96); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        ctx.stroke();
      } else if (ch === '#' || ch === '+' || ch === '_') {
        losango(ctx, i, j, '#d9c7a8');
      } else { // grama
        losango(ctx, i, j, mistura('#7fbf6a', '#5fa653', r * 0.7));
        if (r > 0.55) {
          const [sx, sy] = proj(i + 0.2 + ruido(i, j, 1) * 0.6, j + 0.2 + ruido(i, j, 2) * 0.6);
          ctx.strokeStyle = 'rgba(40,100,40,.55)'; ctx.lineWidth = 1.5; ctx.beginPath();
          ctx.moveTo(sx - 3, sy); ctx.lineTo(sx - 4, sy - 5); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - 6); ctx.moveTo(sx + 3, sy); ctx.lineTo(sx + 4, sy - 5); ctx.stroke();
          if (r > 0.93) { ctx.fillStyle = ['#ffd84d', '#ff8fb1', '#ffffff'][((r * 100) | 0) % 3]; ctx.beginPath(); ctx.arc(sx + 5, sy - 2, 2, 0, 7); ctx.fill(); }
        }
      }
    }
  }

  /* ---------- Paredes e portas ---------- */
  function paredeInfo(W, i, j) {
    const rv = preparaMapa(W), ln = rv.lugarDe[j * W.w + i];
    if (ln < 0) return { alt: 40, cor: '#cbd5e1', l: null };
    const l = W.lugares[ln];
    let cor;
    if (l.casa) cor = PAREDES_CASA[hashR(l.casa) % PAREDES_CASA.length];
    else cor = { ubs: '#eef6f6', escola: '#f6d56b', trabalho: '#b9c5d6', lanche: '#f2a96c' }[l.modelo] || '#d1d5db';
    const topo = j === l.y || i === l.x, frente = j === l.y + l.h - 1 || i === l.x + l.w - 1;
    return { alt: paredesBaixas ? 8 : topo ? 62 : frente ? 8 : 26, cor, l };
  }

  function desenhaParede(W, i, j) {
    const { alt, cor, l } = paredeInfo(W, i, j);
    caixa(ctx, i, j, i + 1, j + 1, 0, alt, cor, { esq: claro(cor, 0.05), dir: escuro(cor, 0.2), topo: alt > 20 ? '#f8fafc' : claro(cor, 0.3) });
    if (alt <= 40 || !l) return;
    const rodape = l.modelo === 'ubs' ? '#0f9f94' : escuro(cor, 0.3);
    poli(ctx, [proj(i, j + 1, 0), proj(i + 1, j + 1, 0), proj(i + 1, j + 1, 5), proj(i, j + 1, 5)], rodape);
    poli(ctx, [proj(i + 1, j, 0), proj(i + 1, j + 1, 0), proj(i + 1, j + 1, 5), proj(i + 1, j, 5)], escuro(rodape, 0.2));
    const temJanela = l.modelo === 'ubs' ? ruido(i, j, 5) > 0.5 : ruido(i, j, 5) > 0.55;
    if (!temJanela) return;
    if (j === l.y) {
      poli(ctx, [proj(i + 0.2, j + 1, 28), proj(i + 0.8, j + 1, 28), proj(i + 0.8, j + 1, 50), proj(i + 0.2, j + 1, 50)], '#bfe3f5', '#ffffff');
      const m1 = proj(i + 0.5, j + 1, 28), m2 = proj(i + 0.5, j + 1, 50);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(m1[0], m1[1]); ctx.lineTo(m2[0], m2[1]); ctx.stroke();
    } else if (i === l.x) {
      poli(ctx, [proj(i + 1, j + 0.2, 28), proj(i + 1, j + 0.8, 28), proj(i + 1, j + 0.8, 50), proj(i + 1, j + 0.2, 50)], '#a9d4ea', '#ffffff');
    }
  }

  function desenhaPorta(W, i, j) {
    const { alt, cor } = paredeInfo(W, i, j);
    if (alt > 40) { // porta numa parede alta
      caixa(ctx, i, j, i + 1, j + 1, 0, alt, cor, { esq: claro(cor, 0.05), dir: escuro(cor, 0.2), topo: '#f8fafc' });
      poli(ctx, [proj(i + 0.2, j + 1, 0), proj(i + 0.8, j + 1, 0), proj(i + 0.8, j + 1, 46), proj(i + 0.2, j + 1, 46)], '#9a6a3a', '#5b3a1c');
      const kn = proj(i + 0.7, j + 1, 22); elipse(ctx, kn[0], kn[1], 1.6, 1.6, '#f5d36b');
    } else { // soleira e capacho
      losango(ctx, i, j, '#c9a77a');
      poli(ctx, [proj(i + 0.2, j + 0.3), proj(i + 0.8, j + 0.3), proj(i + 0.8, j + 0.7), proj(i + 0.2, j + 0.7)], '#7c5a3a');
    }
  }

  /* ---------- Móveis ---------- */
  const emUso = (W, o) => W.agentes.some((a) => a.vis && a.acao && a.acao.obj === o);

  function desenhaObjeto(S, W, o, agora) {
    const i = o.x, j = o.y, uso = emUso(W, o);
    switch (o.t) {
      case 'B': {
        const cobertor = ['#6aa7e0', '#e07a8a', '#7ac79a', '#e0b45a'][hashR(`${o.x},${o.y}`) % 4];
        caixa(ctx, i + 0.05, j + 0.02, i + 0.95, j + 0.98, 0, 7, '#8a5a3b');
        caixa(ctx, i + 0.1, j + 0.02, i + 0.9, j + 0.14, 7, 26, '#7a4e32');
        caixa(ctx, i + 0.1, j + 0.14, i + 0.9, j + 0.95, 7, 13, '#f3f6fa');
        if (!uso) caixa(ctx, i + 0.1, j + 0.5, i + 0.9, j + 0.95, 13, 16, cobertor);
        caixa(ctx, i + 0.2, j + 0.18, i + 0.8, j + 0.4, 13, 17, '#ffffff');
        break;
      }
      case 'S': {
        caixa(ctx, i + 0.15, j + 0.05, i + 0.85, j + 0.3, 0, 12, '#5b4636');
        const brilho = uso ? 0.5 + 0.5 * Math.sin(agora / 140) : 0;
        caixa(ctx, i + 0.2, j + 0.08, i + 0.8, j + 0.2, 12, 30, '#1b1f27', { esq: uso ? mistura('#8fd3ff', '#ffffff', brilho * 0.5) : '#232a35', topo: '#2a3140' });
        if (uso) poli(ctx, [proj(i, j + 0.4), proj(i + 1, j + 0.4), proj(i + 1, j + 1.2), proj(i, j + 1.2)], `rgba(140,210,255,${0.1 + brilho * 0.08})`);
        caixa(ctx, i + 0.1, j + 0.48, i + 0.9, j + 0.95, 0, 9, '#5f86ad');
        caixa(ctx, i + 0.1, j + 0.82, i + 0.9, j + 0.95, 9, 17, '#4f7399');
        caixa(ctx, i + 0.06, j + 0.48, i + 0.16, j + 0.95, 0, 15, '#4f7399');
        caixa(ctx, i + 0.84, j + 0.48, i + 0.94, j + 0.95, 0, 15, '#4f7399');
        break;
      }
      case 'm': {
        for (const [dx, dy] of [[0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]]) caixa(ctx, i + dx - 0.04, j + dy - 0.04, i + dx + 0.04, j + dy + 0.04, 0, 12, '#6b4a2a', { borda: null });
        caixa(ctx, i + 0.08, j + 0.1, i + 0.92, j + 0.9, 12, 15, '#a97c50');
        const [px, py] = proj(i + 0.5, j + 0.5, 17); elipse(ctx, px, py, 7, 3, '#ffffff'); elipse(ctx, px, py - 1, 4, 1.8, '#ef8d6a');
        break;
      }
      case 'G': {
        caixa(ctx, i + 0.08, j + 0.3, i + 0.95, j + 0.95, 0, 17, '#f1ece4');
        caixa(ctx, i + 0.08, j + 0.3, i + 0.95, j + 0.95, 17, 19, '#9aa3ad', { esq: '#b6bec7', topo: '#c9d0d7' });
        for (const [bx, by] of [[0.35, 0.5], [0.65, 0.5], [0.35, 0.78], [0.65, 0.78]]) { const [px, py] = proj(i + bx, j + by, 19); elipse(ctx, px, py, 4.2, 2, '#2d333b'); }
        caixa(ctx, i + 0.1, j + 0.04, i + 0.4, j + 0.3, 0, 38, '#e9eef3');
        if (uso) {
          const [px, py] = proj(i + 0.5, j + 0.64, 19); elipse(ctx, px, py - 2, 6, 3, '#6b7280'); elipse(ctx, px, py - 3, 4.5, 2, '#d97706');
          for (let n = 0; n < 3; n++) { const f = ((agora / 1400) + n / 3) % 1; ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - f)})`; ctx.beginPath(); ctx.arc(px + Math.sin(f * 6 + n) * 3, py - 8 - f * 22, 3 + f * 3, 0, 7); ctx.fill(); }
        }
        break;
      }
      case 'C': {
        losango(ctx, i, j, '#bfd9e6', 'rgba(0,0,0,.1)');
        caixa(ctx, i + 0.8, j + 0.1, i + 0.9, j + 0.2, 0, 44, '#9aa3ad', { borda: null });
        const [hx, hy] = proj(i + 0.78, j + 0.2, 44); elipse(ctx, hx, hy, 5, 2.4, '#c9d0d7');
        if (uso) for (let n = 0; n < 7; n++) { const f = ((agora / 520) + n / 7) % 1; ctx.strokeStyle = 'rgba(120,190,255,.8)'; ctx.lineWidth = 1.4; const px = hx - 5 + n * 1.6; ctx.beginPath(); ctx.moveTo(px, hy + f * 36); ctx.lineTo(px, hy + f * 36 + 5); ctx.stroke(); }
        break;
      }
      case 'H':
        caixa(ctx, i + 0.15, j + 0.25, i + 0.85, j + 0.85, 0, 10, '#2f80c9');
        caixa(ctx, i + 0.15, j + 0.15, i + 0.85, j + 0.3, 10, 24, '#2670b0');
        break;
      case 'U':
        caixa(ctx, i + 0.05, j + 0.2, i + 0.95, j + 0.8, 0, 17, '#dfe8ee');
        caixa(ctx, i + 0.05, j + 0.2, i + 0.95, j + 0.8, 17, 19, '#8fb7c9', { topo: '#a9cbd9' });
        caixa(ctx, i + 0.55, j + 0.35, i + 0.85, j + 0.45, 19, 32, '#1f2933', { esq: '#3b82f6' });
        caixa(ctx, i + 0.15, j + 0.4, i + 0.4, j + 0.65, 19, 24, '#f8fafc');
        break;
      case 'Y': {
        caixa(ctx, i + 0.05, j + 0.1, i + 0.95, j + 0.35, 0, 44, '#e3efe7');
        for (let n = 0; n < 3; n++) for (let r = 0; r < 2; r++) caixa(ctx, i + 0.12 + n * 0.27, j + 0.12, i + 0.3 + n * 0.27, j + 0.3, 12 + r * 14, 22 + r * 14, ['#f87171', '#34d399', '#60a5fa', '#fbbf24'][(n + r) % 4], { borda: null });
        caixa(ctx, i + 0.05, j + 0.45, i + 0.95, j + 0.9, 0, 16, '#c6dccf');
        caixa(ctx, i + 0.05, j + 0.45, i + 0.95, j + 0.9, 16, 18, '#7bb394');
        const [cx, cy] = proj(i + 0.5, j + 0.1, 52); ctx.fillStyle = '#16a34a'; ctx.fillRect(cx - 7, cy - 2, 14, 4); ctx.fillRect(cx - 2, cy - 7, 4, 14);
        break;
      }
      case 'D': {
        caixa(ctx, i + 0.1, j + 0.1, i + 0.9, j + 0.9, 0, 12, '#c7d2dc');
        caixa(ctx, i + 0.12, j + 0.12, i + 0.88, j + 0.88, 12, 16, '#f8fafc');
        caixa(ctx, i + 0.12, j + 0.12, i + 0.88, j + 0.3, 16, 20, '#9ec9e8');
        break;
      }
      case 'E':
        caixa(ctx, i + 0.15, j + 0.3, i + 0.85, j + 0.85, 12, 15, '#d6a35a');
        for (const [dx, dy] of [[0.2, 0.35], [0.8, 0.35], [0.2, 0.8], [0.8, 0.8]]) caixa(ctx, i + dx - 0.03, j + dy - 0.03, i + dx + 0.03, j + dy + 0.03, 0, 12, '#7a5a35', { borda: null });
        caixa(ctx, i + 0.3, j + 0.45, i + 0.7, j + 0.7, 15, 16, '#ffffff');
        break;
      case 'O':
        caixa(ctx, i + 0.05, j + 0.25, i + 0.95, j + 0.85, 11, 14, '#b9c3cf');
        for (const [dx, dy] of [[0.1, 0.3], [0.9, 0.3], [0.1, 0.8], [0.9, 0.8]]) caixa(ctx, i + dx - 0.03, j + dy - 0.03, i + dx + 0.03, j + dy + 0.03, 0, 11, '#6b7280', { borda: null });
        caixa(ctx, i + 0.35, j + 0.35, i + 0.7, j + 0.42, 14, 30, '#111827', { esq: '#60a5fa' });
        caixa(ctx, i + 0.3, j + 0.55, i + 0.75, j + 0.75, 14, 16, '#e5e7eb');
        break;
      case 'L': {
        caixa(ctx, i + 0.05, j + 0.25, i + 0.95, j + 0.85, 0, 17, '#e4572e');
        caixa(ctx, i + 0.05, j + 0.25, i + 0.95, j + 0.85, 17, 19, '#fff4e0', { topo: '#fff9ef' });
        const [px, py] = proj(i + 0.5, j + 0.55, 30); ctx.font = `15px ${FONTE_EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000'; ctx.fillText('🍔', px, py);
        break;
      }
      case 'P':
        caixa(ctx, i + 0.1, j + 0.3, i + 0.9, j + 0.75, 8, 11, '#a97c50');
        caixa(ctx, i + 0.1, j + 0.25, i + 0.9, j + 0.35, 11, 25, '#8c6239');
        for (const dx of [0.15, 0.85]) caixa(ctx, i + dx - 0.04, j + 0.3, i + dx + 0.04, j + 0.72, 0, 8, '#374151', { borda: null });
        break;
      case 'A':
        for (const dx of [0.2, 0.8]) caixa(ctx, i + dx - 0.05, j + 0.45, i + dx + 0.05, j + 0.55, 0, 40, '#6b7280', { borda: null });
        caixa(ctx, i + 0.15, j + 0.45, i + 0.85, j + 0.55, 36, 41, '#ef4444');
        caixa(ctx, i + 0.3, j + 0.3, i + 0.7, j + 0.7, 0, 6, '#9ca3af');
        break;
      case 'R': {
        const bal = Math.sin(agora / 700 + i + j) * 1.2;
        for (let n = 0; n < 5; n++) {
          const [px, py] = proj(i + 0.15 + (n % 3) * 0.3, j + 0.25 + Math.floor(n / 3) * 0.45);
          ctx.fillStyle = '#4c8a2b'; ctx.beginPath(); ctx.moveTo(px - 4, py); ctx.lineTo(px + bal, py - 18); ctx.lineTo(px + 4, py); ctx.fill();
          ctx.fillStyle = '#6fb23f'; ctx.beginPath(); ctx.moveTo(px - 6, py - 2); ctx.lineTo(px + bal - 3, py - 12); ctx.lineTo(px, py - 2); ctx.fill();
          ctx.fillStyle = '#e9c13b'; ctx.beginPath(); ctx.ellipse(px + bal * 0.5, py - 12, 1.8, 4, 0, 0, 7); ctx.fill();
        }
        break;
      }
      case 'T': {
        const [bx, by] = proj(i + 0.5, j + 0.6);
        elipse(ctx, bx + 6, by + 2, 20, 8, 'rgba(0,0,0,.18)');
        caixa(ctx, i + 0.42, j + 0.5, i + 0.58, j + 0.66, 0, 24, '#7a5230', { borda: null });
        const balanco = Math.sin(agora / 1200 + i * 2 + j) * 1.2;
        const cores = ['#2f7d32', '#3e9142', '#55a84d'];
        [[0, -30, 22], [-9, -42, 17], [9, -42, 17], [0, -54, 15]].forEach(([dx, dy, r], n) => elipse(ctx, bx + dx + balanco * (n / 2), by + dy, r, r * 0.9, cores[n % 3]));
        elipse(ctx, bx - 5 + balanco, by - 56, 7, 5, 'rgba(255,255,255,.18)');
        break;
      }
      default: break;
    }
  }

  /* ---------- Pessoas ---------- */
  function dirDe(dx, dy) { // 0 = SE (frente, direita), 1 = SW (frente, esquerda), 2 = NE (costas, direita), 3 = NW (costas, esquerda)
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 3;
    return dy >= 0 ? 1 : 2;
  }

  function estiloAgente(a, S) {
    const h = hashR(a.id);
    const e = { h, pele: PELES[h % PELES.length], cabelo: CABELOS[(h >> 4) % CABELOS.length], camisa: CAMISAS[(h >> 8) % CAMISAS.length], calca: CALCAS[(h >> 12) % CALCAS.length], escala: 1, estilo: 0, feminino: false, idoso: false, oculos: false, papel: null, humor: 70, idade: 30 };
    if (a.k === 'res') {
      const p = achaPessoa(S, a.pid);
      e.feminino = p.sexo === 'F'; e.idade = p.idade;
      e.escala = p.idade < 3 ? 0.55 : p.idade < 13 ? 0.7 : p.idade < 18 ? 0.88 : 1;
      e.idoso = p.idade >= 62;
      if (e.idoso) e.cabelo = '#d4d4d8';
      e.estilo = e.feminino ? [1, 2, 4, 1][(h >> 16) % 4] : [0, 3, 0, 4][(h >> 16) % 4];
      e.oculos = e.idoso && (h >> 20) % 2 === 0;
      e.vestido = e.feminino && p.idade >= 12 && (h >> 22) % 3 === 0;
    } else {
      e.papel = a.papel;
      e.feminino = (h >> 3) % 2 === 0;
      e.estilo = e.feminino ? 2 : 0;
      e.camisa = a.papel === 'medico' ? '#f8fafc' : a.papel === 'tecnico' ? '#3b8be0' : '#18a058';
      e.calca = a.papel === 'medico' ? '#3a4a63' : a.papel === 'tecnico' ? '#2d6ab3' : '#30424f';
    }
    return e;
  }

  /** Desenha uma pessoa com origem nos pés. `o`: { dir, fase, pose, t } */
  function desenhaPessoa(e, o, x, y) {
    const flip = o.dir === 1 || o.dir === 3, costas = o.dir >= 2;
    const s = e.escala;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(flip ? -s : s, s);
    const pose = o.pose, t = o.t;
    const andando = pose === 'andar';
    const bal = andando ? Math.sin(o.fase) : 0;
    const bob = andando ? Math.abs(Math.cos(o.fase)) * 2 : pose === 'parado' ? Math.sin(t / 700 + e.h) * 0.4 : 0;

    if (pose === 'deitar') { // deitado ao longo da cama
      ctx.translate(0, -16);
      ctx.rotate(-0.4636);
      rr(ctx, -16, -9, 30, 11, 5, e.camisa);
      rr(ctx, -22, -9, 22, 12, 5, 'rgba(110,160,220,.92)');
      ctx.fillStyle = e.pele; ctx.beginPath(); ctx.arc(15, -4, 7, 0, 7); ctx.fill();
      ctx.fillStyle = e.cabelo; ctx.beginPath(); ctx.arc(16, -6, 7, Math.PI * 0.6, Math.PI * 2.2); ctx.fill();
      ctx.restore();
      return;
    }
    elipse(ctx, 0, 1, 12, 5, 'rgba(0,0,0,.25)');
    const sentado = pose === 'sentar' || pose === 'digitar';
    const quadril = sentado ? -11 : -17;
    // pernas
    ctx.lineCap = 'round';
    if (sentado) {
      ctx.strokeStyle = e.calca; ctx.lineWidth = 5.6;
      ctx.beginPath(); ctx.moveTo(-2, quadril); ctx.lineTo(10, quadril + 1); ctx.lineTo(10, -1); ctx.moveTo(2, quadril); ctx.lineTo(13, quadril + 2); ctx.lineTo(13, -1); ctx.stroke();
      ctx.fillStyle = '#2b2b33'; ctx.fillRect(8, -3, 6, 3); ctx.fillRect(11, -3, 5, 3);
    } else if (e.vestido) {
      ctx.strokeStyle = e.pele; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-2.5, -11 - bob); ctx.lineTo(-2.5 + bal * 5, -2); ctx.moveTo(2.5, -11 - bob); ctx.lineTo(2.5 - bal * 5, -2); ctx.stroke();
      ctx.fillStyle = '#2b2b33'; ctx.fillRect(-5 + bal * 5, -3, 5, 3); ctx.fillRect(1 - bal * 5, -3, 5, 3);
    } else {
      ctx.strokeStyle = e.calca; ctx.lineWidth = 5.4;
      ctx.beginPath(); ctx.moveTo(-2.6, quadril - bob); ctx.lineTo(-2.6 + bal * 7, -2); ctx.moveTo(2.6, quadril - bob); ctx.lineTo(2.6 - bal * 7, -2); ctx.stroke();
      ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = 5.8;
      ctx.beginPath(); ctx.moveTo(-2.6 + bal * 7, -2); ctx.lineTo(-2.6 + bal * 7 + 1.5, -0.5); ctx.moveTo(2.6 - bal * 7, -2); ctx.lineTo(2.6 - bal * 7 + 1.5, -0.5); ctx.stroke();
    }
    // tronco
    const topo = -33 - bob + (sentado ? 6 : 0), base = quadril - 1 - bob;
    if (e.vestido) { ctx.fillStyle = e.camisa; ctx.beginPath(); ctx.moveTo(-6, topo + 2); ctx.lineTo(6, topo + 2); ctx.lineTo(9, -10 - bob); ctx.lineTo(-9, -10 - bob); ctx.closePath(); ctx.fill(); }
    else rr(ctx, -6.5, topo, 13, base - topo + 1, 4.5, e.camisa);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(-5, topo + 1, 4, Math.max(2, base - topo - 3));
    if (e.papel === 'medico') { ctx.fillStyle = '#e5e7eb'; ctx.fillRect(-0.5, topo + 2, 1, base - topo - 2); ctx.strokeStyle = '#334155'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(2, topo + 6, 3, 0, 3.14); ctx.stroke(); }
    if (e.papel === 'acs') { ctx.fillStyle = '#facc15'; ctx.fillRect(-6.5, topo + 4, 13, 2); }
    // braços
    ctx.strokeStyle = e.papel === 'medico' ? '#f8fafc' : e.camisa; ctx.lineWidth = 4.2;
    const ombro = topo + 3;
    let b1x = -7, b1y = ombro + 10, b2x = 7, b2y = ombro + 10;
    if (andando) { b1x = -7 - bal * 3; b1y = ombro + 11; b2x = 7 + bal * 3; b2y = ombro + 11; }
    if (pose === 'cozinhar') { const f = Math.sin(t / 160); b2x = 8 + f * 3; b2y = ombro + 7 + Math.cos(t / 160) * 2; b1x = 5; b1y = ombro + 8; }
    if (pose === 'comer') { const f = (Math.sin(t / 420) + 1) / 2; b2x = 5 + f * 2; b2y = ombro + 11 - f * 9; }
    if (pose === 'digitar') { const f = Math.sin(t / 110); b1x = 9; b1y = ombro + 8 + f; b2x = 11; b2y = ombro + 8 - f; }
    if (pose === 'exercitar') { const f = Math.sin(t / 260); b1x = -8; b1y = ombro - 6 - f * 6; b2x = 8; b2y = ombro - 6 + f * 6; }
    if (pose === 'enxada') { const f = Math.sin(t / 380); b1x = 9 + f * 4; b1y = ombro - 5 + Math.abs(f) * 12; b2x = 11 + f * 4; b2y = ombro - 3 + Math.abs(f) * 12; }
    if (pose === 'fumar') { const f = (Math.sin(t / 900) + 1) / 2; b2x = 5; b2y = ombro + 12 - f * 10; b1x = -6; b1y = ombro + 11; }
    if (pose === 'banho') { b1x = -6; b1y = ombro - 8; b2x = 6; b2y = ombro - 8; }
    if (pose === 'falar') { const f = Math.sin(t / 250); b2x = 9; b2y = ombro + 4 + f * 3; b1x = -7; b1y = ombro + 11; }
    ctx.beginPath(); ctx.moveTo(-6, ombro); ctx.lineTo(b1x, b1y); ctx.moveTo(6, ombro); ctx.lineTo(b2x, b2y); ctx.stroke();
    ctx.fillStyle = e.pele; ctx.beginPath(); ctx.arc(b1x, b1y, 2.4, 0, 7); ctx.arc(b2x, b2y, 2.4, 0, 7); ctx.fill();
    if (pose === 'enxada') { ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(b2x, b2y); ctx.lineTo(b2x + 8, b2y - 14); ctx.stroke(); }
    // cabeça
    const hr = 7.6 + (1 - s) * 5;
    const cy = topo - hr * 0.8 - 1;
    ctx.fillStyle = e.pele; ctx.beginPath(); ctx.arc(0, cy, hr, 0, 7); ctx.fill();
    ctx.fillStyle = e.cabelo;
    const nuca = () => { if (costas) { ctx.beginPath(); ctx.arc(0, cy, hr + 0.8, 0, 7); ctx.fill(); } };
    if (e.estilo === 3) { ctx.beginPath(); ctx.arc(0, cy - 1.5, hr + 0.6, Math.PI * 1.05, Math.PI * 1.95); ctx.fill(); nuca(); }
    else if (e.estilo === 1) { ctx.beginPath(); ctx.arc(0, cy - 1, hr + 1, Math.PI * 0.95, Math.PI * 2.05); ctx.fill(); ctx.fillRect(-hr - 1, cy - 1, 4, hr + 5); ctx.fillRect(hr - 3, cy - 1, 4, hr + 5); if (costas) { nuca(); ctx.fillRect(-hr - 1, cy, hr * 2 + 2, hr + 4); } }
    else if (e.estilo === 2) { ctx.beginPath(); ctx.arc(0, cy - 1, hr + 0.8, Math.PI, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(0, cy - hr - 2, 4, 0, 7); ctx.fill(); nuca(); }
    else if (e.estilo === 4) { for (let n = 0; n < 7; n++) { const ang = Math.PI * (1.0 + n / 6); ctx.beginPath(); ctx.arc(Math.cos(ang) * hr * 0.95, cy - 1 + Math.sin(ang) * hr * 0.95, 3.6, 0, 7); ctx.fill(); } nuca(); }
    else { ctx.beginPath(); ctx.arc(0, cy - 1.2, hr + 0.8, Math.PI * 0.98, Math.PI * 2.02); ctx.fill(); nuca(); }
    if (e.papel === 'acs') { ctx.fillStyle = '#18a058'; ctx.beginPath(); ctx.arc(0, cy - 2, hr + 1.2, Math.PI, Math.PI * 2); ctx.fill(); ctx.fillRect(-hr - 1, cy - 2.5, hr * 2 + 6, 2.5); }
    if (!costas) {
      const ex = 2.6 + (1 - s) * 1.2;
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(-ex + 1.8, cy + 0.5, 2.1, 2.5, 0, 0, 7); ctx.ellipse(ex + 1.8, cy + 0.5, 2.1, 2.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#1f2937'; ctx.beginPath(); ctx.arc(-ex + 2.3, cy + 0.8, 1.2, 0, 7); ctx.arc(ex + 2.3, cy + 0.8, 1.2, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(60,35,20,.8)'; ctx.lineWidth = 1.2; ctx.beginPath();
      if (e.humor < 30) ctx.arc(2, cy + hr * 0.78, 2.4, Math.PI * 1.15, Math.PI * 1.85);
      else if (pose === 'comer' || pose === 'falar') ctx.ellipse(2, cy + hr * 0.55, 2, 1.6, 0, 0, 7);
      else ctx.arc(2, cy + hr * 0.3, 3, 0.25, Math.PI - 0.25);
      ctx.stroke();
      if (e.oculos) { ctx.strokeStyle = '#374151'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(-ex + 2, cy + 0.5, 3, 0, 7); ctx.arc(ex + 2, cy + 0.5, 3, 0, 7); ctx.stroke(); }
      if (e.papel === 'medico' || e.papel === 'tecnico') { ctx.fillStyle = e.papel === 'medico' ? '#e5f2f2' : '#bfdbfe'; ctx.fillRect(-1, cy + 2.5, 7, 4.5); }
    }
    ctx.restore();
  }

  function desenhaCadeira(x, y, flip) {
    ctx.save(); ctx.translate(x, y);
    rr(ctx, -9, -13, 18, 5, 2, '#8a6a46');
    ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-8, -9, 3, 9); ctx.fillRect(5, -9, 3, 9);
    rr(ctx, flip ? 4 : -9, -26, 5, 14, 2, '#7b5a3a');
    ctx.restore();
  }

  function bolha(x, y, texto, grande) {
    const w = grande ? 28 : 22, h = grande ? 24 : 19;
    ctx.fillStyle = 'rgba(255,255,255,.96)'; ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - h, w, h, 8); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x, y + 5); ctx.lineTo(x + 4, y); ctx.fill();
    ctx.font = `${grande ? 16 : 13}px ${FONTE_EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
    ctx.fillText(texto, x, y - h / 2 + 1);
  }

  function plumbob(x, y, agora) {
    const f = Math.cos(agora / 450), yy = y + Math.sin(agora / 380) * 2.5;
    poli(ctx, [[x, yy - 12], [x + 6 * f, yy], [x, yy + 8], [x - 6 * f, yy]], '#34e07a', '#16a34a');
    poli(ctx, [[x, yy - 12], [x + 6 * f, yy], [x, yy - 2]], 'rgba(255,255,255,.4)');
  }

  /** Decide pose, posição visual e direção para o agente. */
  function poseDe(W, a) {
    let pose = a.path.length ? 'andar' : 'parado';
    let alvoX = a.x, alvoY = a.y, dirFixa = null, cadeira = null, ordem = 0;
    const virar = (ox, oy) => { dirFixa = dirDe(ox - a.x, oy - a.y); };
    if (a.k === 'res' && a.espera && !a.path.length) {
      const h = (W.porTipo.H || []).find((o) => Math.abs(o.x - a.x) + Math.abs(o.y - a.y) === 1);
      if (h) { pose = 'sentar'; alvoX = h.x; alvoY = h.y; dirFixa = 1; ordem = 0.35; }
    } else if (a.acao && !a.path.length) {
      const k = a.acao.k, o = a.acao.obj;
      if (o) {
        if (k === 'dormir' || k === 'descansar') { pose = 'deitar'; alvoX = o.x; alvoY = o.y; dirFixa = 0; ordem = 0.4; }
        else if (k === 'tv') { pose = 'sentar'; alvoX = o.x; alvoY = o.y + 0.28; dirFixa = 2; ordem = 0.45; }
        else if (k === 'praca') { pose = 'sentar'; alvoX = o.x; alvoY = o.y + 0.1; dirFixa = 1; ordem = 0.45; }
        else if (k === 'banho') { pose = 'banho'; alvoX = o.x; alvoY = o.y; dirFixa = 1; ordem = 0.5; }
        else if (k === 'comer') { pose = a.acao.restante > 10 ? 'cozinhar' : 'comer'; virar(o.x, o.y); }
        else if (k === 'lanche') { pose = 'comer'; virar(o.x, o.y); }
        else if (k === 'trabalho' || k === 'escola') { pose = 'digitar'; virar(o.x, o.y); cadeira = { x: a.x, y: a.y }; }
        else if (k === 'roca') { pose = 'enxada'; virar(o.x, o.y); }
        else if (k === 'academia') { pose = 'exercitar'; virar(o.x, o.y); }
      } else if (k === 'fumar') pose = 'fumar';
      else if (k === 'conversar') pose = 'falar';
    }
    if (a.k === 'staff' && !a.path.length && a.tarefa && a.tarefa.fase === 'atendendo') pose = 'digitar';
    return { pose, alvoX, alvoY, dirFixa, cadeira, ordem };
  }

  /* ---------- Iluminação ---------- */
  function desenhaNoite(S, W, cfg) {
    const h = minutoDoDia(S) / 60;
    let alfa = 0;
    if (h >= 20 || h < 5) alfa = 0.58;
    else if (h >= 18.2) alfa = ((h - 18.2) / 1.8) * 0.58;
    else if (h < 7) alfa = ((7 - h) / 2) * 0.58;
    if (alfa < 0.02) return;
    nctx.setTransform(1, 0, 0, 1, 0, 0);
    nctx.globalCompositeOperation = 'source-over';
    nctx.clearRect(0, 0, noite.width, noite.height);
    nctx.fillStyle = `rgba(12,20,70,${alfa})`;
    nctx.fillRect(0, 0, noite.width, noite.height);
    nctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, (largura / 2 - cam.x * cam.z) * dpr, (altura / 2 - cam.y * cam.z) * dpr);
    nctx.globalCompositeOperation = 'destination-out';
    const abertaUBS = ubsAberta(W, S, cfg);
    for (const l of W.lugares) {
      const acordados = W.agentes.some((a) => a.vis && a.x >= l.x && a.x < l.x + l.w && a.y >= l.y && a.y < l.y + l.h && !(a.acao && a.acao.k === 'dormir'));
      if (!(acordados || (l.modelo === 'ubs' && abertaUBS))) continue;
      const [cx, cy] = proj(l.x + l.w / 2, l.y + l.h / 2, 20);
      const r = (l.w + l.h) * HW * 0.5;
      const g = nctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      g.addColorStop(0, 'rgba(0,0,0,.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      nctx.fillStyle = g; nctx.beginPath(); nctx.arc(cx, cy, r, 0, 7); nctx.fill();
    }
    nctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(noite, 0, 0);
  }

  function desenhaRotulos(S, W, cfg) {
    if (cam.z < 0.4) return;
    ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const l of W.lugares) {
      let nome = null;
      if (l.casa) nome = S.familias.find((f) => f.id === l.casa).nome.replace('Família ', '').replace('Casal ', '');
      else if (l.modelo === 'ubs') nome = `✚ ${cfg.territorio.nomeUnidade}`;
      else if (l.modelo === 'escola') nome = 'Escola';
      else if (l.modelo === 'trabalho') nome = cfg.cenario.id === 'metropole' ? 'Escritórios' : 'Comércio';
      else if (l.modelo === 'lanche') nome = 'Lanchonete';
      if (!nome) continue;
      const [cx, cy] = proj(l.x + l.w / 2, l.y + l.h / 2, 100);
      const larg = ctx.measureText(nome).width + 14;
      rr(ctx, cx - larg / 2, cy - 9, larg, 18, 9, l.modelo === 'ubs' ? '#0f766e' : 'rgba(255,255,255,.9)');
      ctx.fillStyle = l.modelo === 'ubs' ? '#fff' : '#1f2937';
      ctx.fillText(nome, cx, cy + 0.5);
    }
  }

  /* ---------- Quadro ---------- */
  function desenha(agora) {
    const { S, W, cfg } = E();
    if (!S || !W) return;
    if (canvas.clientWidth !== largura || canvas.clientHeight !== altura) redimensiona();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#6fae60'; ctx.fillRect(0, 0, largura, altura);
    ctx.save();
    ctx.translate(largura / 2, altura / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);

    const xa = cam.x - largura / cam.z / 2 - 80, xb = cam.x + largura / cam.z / 2 + 80;
    const ya = cam.y - altura / cam.z / 2 - 140, yb = cam.y + altura / cam.z / 2 + 60;
    let i0 = 1e9, i1 = -1e9, j0 = 1e9, j1 = -1e9;
    for (const [sx, sy] of [[xa, ya], [xb, ya], [xa, yb], [xb, yb]]) {
      const ti = (sy / HH + sx / HW) / 2, tj = (sy / HH - sx / HW) / 2;
      i0 = Math.min(i0, ti); i1 = Math.max(i1, ti); j0 = Math.min(j0, tj); j1 = Math.max(j1, tj);
    }
    i0 = Math.max(0, Math.floor(i0) - 1); i1 = Math.min(W.w - 1, Math.ceil(i1) + 1); j0 = Math.max(0, Math.floor(j0) - 1); j1 = Math.min(W.h - 1, Math.ceil(j1) + 1);

    desenhaChao(S, W, cfg, i0, i1, j0, j1);

    const els = [];
    const vivos = new Set();
    for (const a of W.agentes) {
      if (!a.vis) continue;
      vivos.add(a.id);
      let st = rs.get(a.id);
      if (!st) { st = { px: a.x, py: a.y, fase: (hashR(a.id) % 600) / 100, dir: 1, ox: a.x, oy: a.y, estilo: estiloAgente(a, S) }; rs.set(a.id, st); }
      const dx = a.x - st.ox, dy = a.y - st.oy, dist = Math.hypot(dx, dy);
      if (dist > 1e-4) { st.fase += dist * 4.6; st.dir = dirDe(dx, dy); }
      st.ox = a.x; st.oy = a.y;
      const pz = poseDe(W, a);
      const k = pz.pose === 'andar' ? 1 : 0.18;
      st.px += (pz.alvoX - st.px) * k; st.py += (pz.alvoY - st.py) * k;
      if (Math.abs(st.px - pz.alvoX) < 0.01) st.px = pz.alvoX;
      if (Math.abs(st.py - pz.alvoY) < 0.01) st.py = pz.alvoY;
      const dirUsar = pz.dirFixa !== null ? pz.dirFixa : st.dir;
      st.pz = pz;
      const [sx, sy] = proj(st.px + 0.5, st.py + 0.5);
      st.sx = sx; st.sy = sy;
      if (a.k === 'res') st.estilo.humor = S.mundo.needs[a.pid].humor;
      els.push({ k: st.px + st.py + 1 + (pz.ordem || 0) + 0.02, f: () => {
        if (pz.cadeira) { const [cx, cy] = proj(pz.cadeira.x + 0.5, pz.cadeira.y + 0.5); desenhaCadeira(cx, cy + 3, dirUsar === 1 || dirUsar === 3); }
        const yy = sy + (pz.pose === 'sentar' ? -5 : pz.pose === 'digitar' ? 2 : 6);
        desenhaPessoa(st.estilo, { dir: dirUsar, fase: st.fase, pose: pz.pose, t: agora }, sx, yy);
        if (pz.pose === 'fumar') for (let n = 0; n < 3; n++) { const f = ((agora / 1500) + n / 3) % 1; ctx.fillStyle = `rgba(220,220,220,${0.55 * (1 - f)})`; ctx.beginPath(); ctx.arc(sx + 6 + Math.sin(f * 7 + n) * 3, yy - 38 - f * 22, 2 + f * 3, 0, 7); ctx.fill(); }
        if (pz.pose === 'deitar') for (let n = 0; n < 3; n++) { const f = ((agora / 2200) + n / 3) % 1; ctx.fillStyle = `rgba(80,120,200,${1 - f})`; ctx.font = `bold ${9 + n * 2}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('z', sx + 12 + f * 14, yy - 30 - f * 26); }
      } });
      if (pz.pose === 'banho' && a.acao && a.acao.obj) {
        const o = a.acao.obj;
        els.push({ k: o.x + o.y + 1.6, f: () => {
          poli(ctx, [proj(o.x + 1, o.y, 0), proj(o.x + 1, o.y + 1, 0), proj(o.x + 1, o.y + 1, 44), proj(o.x + 1, o.y, 44)], 'rgba(190,225,245,.35)', 'rgba(255,255,255,.7)');
          poli(ctx, [proj(o.x, o.y + 1, 0), proj(o.x + 1, o.y + 1, 0), proj(o.x + 1, o.y + 1, 44), proj(o.x, o.y + 1, 44)], 'rgba(190,225,245,.35)', 'rgba(255,255,255,.7)');
        } });
      }
    }
    for (const id of [...rs.keys()]) if (!vivos.has(id)) rs.delete(id);
    // paredes e portas (translúcidas quando escondem alguém)
    const pessoas = [];
    for (const a of W.agentes) { const st = rs.get(a.id); if (a.vis && st && st.sx !== undefined) pessoas.push({ k: st.px + st.py + 1, sx: st.sx, sy: st.sy }); }
    const comTransparencia = (i, j, alt, kk, fn) => ({ k: kk, f: () => {
      let oculta = false;
      if (alt > 20) { const [cx, cy] = proj(i + 0.5, j + 0.5); oculta = pessoas.some((p) => p.k < kk && Math.abs(p.sx - cx) < HW + 6 && p.sy <= cy + HH + 2 && p.sy >= cy - alt - HH); }
      if (oculta) ctx.globalAlpha = 0.25;
      fn();
      ctx.globalAlpha = 1;
    } });
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const ch = W.terr[j * W.w + i];
      if (ch === '#') els.push(comTransparencia(i, j, paredeInfo(W, i, j).alt, i + j + 1, () => desenhaParede(W, i, j)));
      else if (ch === '+') els.push(comTransparencia(i, j, paredeInfo(W, i, j).alt, i + j + 0.9, () => desenhaPorta(W, i, j)));
    }
    els.sort((p, q) => p.k - q.k);
    for (const e of els) e.f();

    desenhaRotulos(S, W, cfg);

    for (const a of W.agentes) {
      const st = rs.get(a.id);
      if (!st || !a.vis) continue;
      const pose = st.pz && st.pz.pose;
      const topo = st.sy - 62 * st.estilo.escala - (pose === 'sentar' ? 4 : 0) + (pose === 'deitar' ? 24 : 0);
      const b = bolhaDe(W, S, a);
      if (selecionado === a.id) {
        plumbob(st.sx, topo - 10, agora);
        const nome = a.k === 'res' ? achaPessoa(S, a.pid).nome : { medico: 'Médico(a)', tecnico: 'Técnico(a)', acs: 'Agente comunitário' }[a.papel];
        ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const larg = ctx.measureText(nome).width + 14;
        rr(ctx, st.sx - larg / 2, topo - 42, larg, 17, 8.5, '#0f766e'); ctx.fillStyle = '#fff'; ctx.fillText(nome, st.sx, topo - 33);
        if (b) bolha(st.sx + larg / 2 + 18, topo - 28, b, true);
      } else if (b) bolha(st.sx, topo - 2, b, false);
    }
    ctx.restore();
    desenhaNoite(S, W, cfg);
  }

  /* ---------- Entrada (toque / mouse) ---------- */
  function agenteEm(px, py) {
    const m = paraMundo(px, py);
    let melhor = null, dMin = 1e9;
    for (const [id, st] of rs) {
      if (st.sx === undefined) continue;
      const esc = st.estilo.escala;
      const d = Math.hypot(st.sx - m.x, (st.sy - 22 * esc - m.y) * 0.8);
      if (d < 26 * Math.max(0.8, esc) && d < dMin) { dMin = d; melhor = id; }
    }
    return melhor;
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    ponteiros.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    arraste = { moveu: false, x0: e.offsetX, y0: e.offsetY, dist0: null, z0: cam.z };
    if (ponteiros.size === 2) { const [p, q] = [...ponteiros.values()]; arraste.dist0 = Math.hypot(p.x - q.x, p.y - q.y); arraste.moveu = true; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ponteiros.has(e.pointerId)) return;
    const ant = ponteiros.get(e.pointerId);
    ponteiros.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (ponteiros.size === 2 && arraste && arraste.dist0) {
      const [p, q] = [...ponteiros.values()];
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      const meio = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const antes = paraMundo(meio.x, meio.y);
      cam.z = arraste.z0 * (d / arraste.dist0);
      limitaCamera();
      const depois = paraMundo(meio.x, meio.y);
      cam.x += antes.x - depois.x; cam.y += antes.y - depois.y;
      limitaCamera();
    } else if (ponteiros.size === 1 && arraste) {
      if (!arraste.moveu && Math.hypot(e.offsetX - arraste.x0, e.offsetY - arraste.y0) > 7) arraste.moveu = true;
      if (arraste.moveu) { cam.x -= (e.offsetX - ant.x) / cam.z; cam.y -= (e.offsetY - ant.y) / cam.z; limitaCamera(); }
    }
  });
  const soltar = (e) => {
    const tinha = ponteiros.has(e.pointerId);
    ponteiros.delete(e.pointerId);
    if (tinha && arraste && !arraste.moveu && ponteiros.size === 0 && e.type === 'pointerup') hooks.aoTocar(agenteEm(e.offsetX, e.offsetY));
    if (ponteiros.size === 0) arraste = null;
  };
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', soltar);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const antes = paraMundo(e.offsetX, e.offsetY);
    cam.z *= e.deltaY < 0 ? 1.12 : 1 / 1.12;
    limitaCamera();
    const depois = paraMundo(e.offsetX, e.offsetY);
    cam.x += antes.x - depois.x; cam.y += antes.y - depois.y;
    limitaCamera();
  }, { passive: false });
  window.addEventListener('resize', redimensiona);

  return {
    desenha, redimensiona, enquadrarUBS, centralizar, cam,
    selecionar(id) { selecionado = id; },
    alternaParedes() { paredesBaixas = !paredesBaixas; return paredesBaixas; },
    zoom(f) { cam.z *= f; limitaCamera(); },
    get selecionado() { return selecionado; },
  };
}
