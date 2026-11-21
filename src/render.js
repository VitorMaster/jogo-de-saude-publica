// Renderização 3D (Three.js): cenário em maquete com luz e sombras, paredes finas com recorte conforme a câmera,
// móveis com volume, personagens 3D animados, efeitos (vapor, água, fumaça), dia e noite e câmera giratória por toque.
// Nenhuma regra de jogo mora aqui.
import { achaPessoa } from './engine.js';
import { minutoDoDia, bolhaDe, ubsAberta, ACOES_INFO } from './mundo.js';

/* ---------- utilidades ---------- */
const hashR = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const ruido = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const lim = (x, a, b) => Math.min(b, Math.max(a, x));
const suave = (a, b, x) => { const t = lim((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mixn = (a, b, t) => a + (b - a) * t;

const _hex = new Map();
function rgb(hex) {
  if (Array.isArray(hex)) return hex;
  let c = _hex.get(hex);
  if (!c) { const k = new window.THREE.Color(hex); c = [k.r, k.g, k.b]; _hex.set(hex, c); }
  return c;
}
const escCor = (c, f) => { const [r, g, b] = rgb(c); return [lim(r * f, 0, 1), lim(g * f, 0, 1), lim(b * f, 0, 1)]; };
const mistura = (a, b, t) => { const A = rgb(a), B = rgb(b); return [mixn(A[0], B[0], t), mixn(A[1], B[1], t), mixn(A[2], B[2], t)]; };

const PELES = ['#f6d3b3', '#eab98e', '#cf966a', '#a8714a', '#7b4b2e'];
const CABELOS = ['#2a1b12', '#47301c', '#8a5a2b', '#161616', '#c9a227', '#6b3a1e'];
const CAMISAS = ['#e06c75', '#e5a54b', '#4f9be8', '#7fc47a', '#b57be0', '#4cc3c9', '#e08f5a', '#ee86a8', '#6c7ae0'];
const CALCAS = ['#34425a', '#4a4f5c', '#5a4a3a', '#2f3e46', '#3d3b6b'];
const PAREDES_CASA = ['#f3dcbc', '#d3e6cf', '#d6e0f3', '#f4d3d4', '#ece6b9'];

/* ---------- construtor de malha estática (vértices coloridos) ---------- */
class Malha {
  constructor() { this.p = []; this.n = []; this.c = []; }
  quad(a, b, c, d, n, col) {
    const k = rgb(col);
    for (const v of [a, b, c, a, c, d]) { this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.c.push(k[0], k[1], k[2]); }
  }
  tri(a, b, c, n, col) {
    const k = rgb(col);
    for (const v of [a, b, c]) { this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.c.push(k[0], k[1], k[2]); }
  }
  /** Caixa com base em (cx, y0, cz), tamanhos w (x), h (y), d (z), girada ry em torno de Y. */
  caixa(cx, y0, cz, w, h, d, col, ry = 0, semTopo = false) {
    const hw = w / 2, hd = d / 2, y1 = y0 + h;
    const co = Math.cos(ry), si = Math.sin(ry);
    const T = (x, y, z) => [cx + x * co + z * si, y, cz - x * si + z * co];
    const N = (x, z) => [x * co + z * si, 0, -x * si + z * co];
    if (!semTopo) this.quad(T(-hw, y1, -hd), T(-hw, y1, hd), T(hw, y1, hd), T(hw, y1, -hd), [0, 1, 0], col);
    this.quad(T(hw, y0, -hd), T(hw, y1, -hd), T(hw, y1, hd), T(hw, y0, hd), N(1, 0), col);
    this.quad(T(-hw, y0, hd), T(-hw, y1, hd), T(-hw, y1, -hd), T(-hw, y0, -hd), N(-1, 0), col);
    this.quad(T(hw, y0, hd), T(hw, y1, hd), T(-hw, y1, hd), T(-hw, y0, hd), N(0, 1), col);
    this.quad(T(-hw, y0, -hd), T(-hw, y1, -hd), T(hw, y1, -hd), T(hw, y0, -hd), N(0, -1), col);
  }
  /** Tronco de cone/cilindro (eixo Y). r1 na base, r2 no topo. */
  cilindro(cx, y0, cz, r1, h, col, n = 8, r2 = r1) {
    const y1 = y0 + h;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const k = rgb(col);
      const pts = [[cx + c0 * r1, y0, cz + s0 * r1, c0, s0], [cx + c1 * r1, y0, cz + s1 * r1, c1, s1], [cx + c1 * r2, y1, cz + s1 * r2, c1, s1], [cx + c0 * r2, y1, cz + s0 * r2, c0, s0]];
      for (const j of [0, 2, 1, 0, 3, 2]) { const q = pts[j]; this.p.push(q[0], q[1], q[2]); this.n.push(q[3], 0.2, q[4]); this.c.push(k[0], k[1], k[2]); }
      if (r2 > 0) { const kc = rgb(escCor(col, 1.12)); for (const [x, z] of [[0, 0], [c0, s0], [c1, s1]].reverse()) { this.p.push(cx + x * r2, y1, cz + z * r2); this.n.push(0, 1, 0); this.c.push(kc[0], kc[1], kc[2]); } }
    }
  }
  /** Esfera (ou elipsoide) de baixa resolução. */
  esfera(cx, cy, cz, r, col, n = 8, m = 5, sx = 1, sy = 1, sz = 1) {
    const k = rgb(col);
    const P = (i, j) => {
      const th = (j / m) * Math.PI, ph = (i / n) * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
      return [cx + x * r * sx, cy + y * r * sy, cz + z * r * sz, x, y, z];
    };
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      const tris = j === 0 ? [[a, d, c]] : j === m - 1 ? [[a, d, b]] : [[a, d, c], [a, c, b]];
      for (const t of tris) for (const v of t) { this.p.push(v[0], v[1], v[2]); this.n.push(v[3], v[4], v[5]); this.c.push(k[0], k[1], k[2]); }
    }
  }
  /** Telhado de duas águas: base w×d, altura h, cumeeira ao longo do eixo X (ou Z se eixoZ). */
  telhado(cx, y0, cz, w, h, d, col, eixoZ = false) {
    const hw = w / 2, hd = d / 2;
    const k2 = escCor(col, 0.82);
    if (!eixoZ) {
      const A = [cx - hw, y0, cz - hd], B = [cx + hw, y0, cz - hd], C = [cx + hw, y0, cz + hd], D = [cx - hw, y0, cz + hd], E = [cx - hw, y0 + h, cz], F = [cx + hw, y0 + h, cz];
      const nS = [0, hd, h], nN = [0, hd, -h];
      this.quad(D, C, F, E, nS, col); this.quad(B, A, E, F, nN, k2);
      this.tri(A, D, E, [-1, 0, 0], k2); this.tri(C, B, F, [1, 0, 0], k2);
    } else {
      const A = [cx - hw, y0, cz - hd], B = [cx + hw, y0, cz - hd], C = [cx + hw, y0, cz + hd], D = [cx - hw, y0, cz + hd], E = [cx, y0 + h, cz - hd], F = [cx, y0 + h, cz + hd];
      this.quad(C, B, E, F, [hw, h, 0], col); this.quad(A, D, F, E, [-hw, h, 0], k2);
      this.tri(B, A, E, [0, 0, -1], k2); this.tri(D, C, F, [0, 0, 1], k2);
    }
  }
  pronta(material, sombra = true, recebe = true) {
    const T = window.THREE;
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    const m = new T.Mesh(g, material);
    m.castShadow = sombra; m.receiveShadow = recebe;
    return m;
  }
}

export function criarRenderer(canvas, getEstado, hooks) {
  const THREE = window.THREE;
  const E = () => getEstado();
  const contenedor = canvas.parentElement;

  /* ---------- renderer, cena, câmera ---------- */
  // Celulares da Apple: qualidade leve (sem sombras em tempo real, sem antialias, resolução limitada) para não estourar a memória da GPU.
  const ua = navigator.userAgent || '';
  const leve = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1) || window.__qualidade3d === 'leve';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !leve, powerPreference: 'default' });
  renderer.shadowMap.enabled = !leve;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const cena = new THREE.Scene();
  cena.fog = new THREE.Fog(0xcfe8f7, 70, 210);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 600);
  const cam = { z: 1 };
  const orbita = { yaw: Math.PI / 4, pitch: 0.92, dist: 26, alvo: new THREE.Vector3(30, 0, 14) };
  let largura = 300, altura = 300;

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x7a8f6a, 0.85);
  cena.add(hemi);
  const sol = new THREE.DirectionalLight(0xfff2d8, 0.95);
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  Object.assign(sol.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 140 });
  sol.shadow.bias = -0.0012; sol.shadow.normalBias = 0.07;
  cena.add(sol); cena.add(sol.target);
  const lamposLuz = [new THREE.PointLight(0xffd9a0, 0, 9, 1.6), new THREE.PointLight(0xffd9a0, 0, 9, 1.6), new THREE.PointLight(0xffd9a0, 0, 9, 1.6), new THREE.PointLight(0xffd9a0, 0, 9, 1.6)];
  lamposLuz.forEach((l) => cena.add(l));

  // céu (cúpula com gradiente) e mar
  const domo = (() => {
    const g = new THREE.SphereGeometry(320, 18, 10);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -10;
    return m;
  })();
  cena.add(domo);
  const mar = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: 0x3d8fb8 }));
  mar.rotation.x = -Math.PI / 2; mar.position.y = -1.7; mar.receiveShadow = false;
  cena.add(mar);
  const astro = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff4c2, fog: false }));
  cena.add(astro);

  /* ---------- estado do mundo 3D ---------- */
  let mundo3d = null; // { grupo, ... } reconstruído quando o mapa muda
  let quadranteAtual = -1;
  let paredesBaixas = false;
  const agentes3d = new Map(); // id -> { grupo, partes, juntas, ... }
  const hitAgentes = [], hitMoveis = [];
  let selecionado = null;
  let marcador = null;
  const marcadorMesh = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.46, 24), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
  marcadorMesh.rotation.x = -Math.PI / 2; marcadorMesh.visible = false; marcadorMesh.renderOrder = 20;
  cena.add(marcadorMesh);
  const prumbob = new THREE.Mesh(new THREE.OctahedronGeometry(0.17), new THREE.MeshBasicMaterial({ color: 0x34e07a }));
  prumbob.scale.set(1, 1.7, 1); prumbob.visible = false; prumbob.renderOrder = 21;
  cena.add(prumbob);

  /* ---------- sobreposição HTML (balões, nomes) ---------- */
  const ov = document.createElement('div');
  ov.className = 'ov3d';
  contenedor.appendChild(ov);
  const bolhasDom = new Map();
  const rotulosDom = [];
  let nomeDom = null;

  function redimensiona() {
    largura = Math.max(1, canvas.clientWidth || 300);
    altura = Math.max(1, canvas.clientHeight || 300);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, leve ? 1.5 : 2));
    renderer.setSize(largura, altura, false);
    camera.aspect = largura / altura;
    camera.updateProjectionMatrix();
  }

  /* ---------- geometria compartilhada dos personagens ---------- */
  const matCache = new Map();
  const mat = (hex) => { let m = matCache.get(hex); if (!m) { m = new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) }); matCache.set(hex, m); } return m; };
  const gCaixa = new THREE.BoxGeometry(1, 1, 1), gCil = new THREE.CylinderGeometry(1, 1, 1, 8), gEsf = new THREE.SphereGeometry(1, 10, 8);

  /* ---------- terreno, paredes, móveis, decoração ---------- */
  function alturaPiso(W, rv, x, y) {
    if (x < 0 || y < 0 || x >= W.w || y >= W.h) return 0;
    const k = y * W.w + x;
    if (rv.lugarDe[k] >= 0) return 0.08;
    const c = W.terr[k];
    return c === 'c' ? 0.07 : 0;
  }

  function preparaMapa(W) {
    if (W.rv3) return W.rv3;
    const lugarDe = new Int16Array(W.w * W.h).fill(-1);
    W.lugares.forEach((l, n) => { for (let y = l.y; y < l.y + l.h; y++) for (let x = l.x; x < l.x + l.w; x++) lugarDe[y * W.w + x] = n; });
    W.rv3 = { lugarDe };
    return W.rv3;
  }

  const terr = (W, x, y) => (x >= 0 && y >= 0 && x < W.w && y < W.h ? W.terr[y * W.w + x] : null);

  function construirTerreno(W, cfg, rv) {
    const M = new Malha();
    // ilha: camadas que afunilam
    const camadas = [[0, -0.5, 0.0, '#5d9a48'], [-0.5, -1.8, 0.5, '#8d5d3b'], [-1.8, -3.0, 1.2, '#6c6c76']];
    for (const [ya, yb, enc, cor] of camadas) M.caixa(W.w / 2, yb, W.h / 2, W.w - enc, ya - yb, W.h - enc, cor, 0, true);
    for (let j = 0; j < W.h; j++) for (let i = 0; i < W.w; i++) {
      const k = j * W.w + i, ch = W.terr[k], ln = rv.lugarDe[k], r = ruido(i, j);
      const cx = i + 0.5, cz = j + 0.5;
      if (ln >= 0) {
        const l = W.lugares[ln];
        let cor;
        if (ch === '#') cor = '#cbbfa8';
        else if (l.modelo === 'ubs' || l.modelo === 'escola' || l.modelo === 'lanche') {
          const par = (i + j) % 2 === 0;
          cor = l.modelo === 'ubs' ? (par ? '#eaf4f3' : '#cfe7e5') : l.modelo === 'escola' ? (par ? '#f3e7a9' : '#e6d78c') : (par ? '#fdf1e6' : '#e4572e');
        } else if (l.modelo === 'trabalho') cor = (i + j) % 2 === 0 ? '#93a2b8' : '#889ab1';
        else cor = mistura('#c99a63', '#b78650', (j % 2) * 0.5 + r * 0.25);
        M.caixa(cx, 0, cz, 1, 0.08, 1, cor);
        continue;
      }
      if (ch === '.') { M.caixa(cx, -0.02, cz, 1, 0.02, 1, r > 0.5 ? '#4f565d' : '#535a62'); continue; }
      if (ch === 'c') { M.caixa(cx, 0, cz, 1, 0.07, 1, (i + j) % 2 === 0 ? '#d3d8d4' : '#c9cfca'); continue; }
      if (ch === 'F') {
        M.caixa(cx, 0, cz, 1, 0.04, 1, mistura('#8a5a32', '#6f4526', r * 0.5));
        for (let n = 0; n < 3; n++) M.caixa(cx - 0.33 + n * 0.33, 0.04, cz, 0.12, 0.05, 0.94, '#5d3a1c');
        continue;
      }
      // grama
      M.caixa(cx, 0, cz, 1, 0.02, 1, mistura('#79bd62', '#5ea552', r * 0.8));
      if (r > 0.7) M.caixa(cx + (ruido(i, j, 1) - 0.5) * 0.6, 0.02, cz + (ruido(i, j, 2) - 0.5) * 0.6, 0.05, 0.16, 0.05, '#3f8a3f', ruido(i, j, 3) * 3);
    }
    // faixas das ruas
    for (let j = 0; j < W.h; j++) for (let i = 0; i < W.w; i++) {
      if (terr(W, i, j) !== '.') continue;
      const h = terr(W, i - 1, j) === '.' && terr(W, i + 1, j) === '.', v = terr(W, i, j - 1) === '.' && terr(W, i, j + 1) === '.';
      if (h && !v && i % 2 === 0) {
        const sobe = terr(W, i, j - 1) === '.', desce = terr(W, i, j + 1) === '.';
        let zz = null;
        if (sobe && desce) zz = j + 0.5; else if (!sobe && desce && terr(W, i, j + 2) !== '.') zz = j + 1;
        if (zz !== null) M.caixa(i + 0.5, 0, zz, 0.6, 0.012, 0.09, '#f4d96b');
      }
      if (v && !h && j % 2 === 0) {
        const esq = terr(W, i - 1, j) === '.', dir = terr(W, i + 1, j) === '.';
        let xx = null;
        if (esq && dir) xx = i + 0.5; else if (!esq && dir && terr(W, i + 2, j) !== '.') xx = i + 1;
        if (xx !== null) M.caixa(xx, 0, j + 0.5, 0.09, 0.012, 0.6, '#f4d96b');
      }
    }
    // caminhos de pedra da porta até a rua
    for (const l of W.lugares) {
      if (!l.porta) continue;
      const dx = l.porta.fora.x - l.porta.x, dy = l.porta.fora.y - l.porta.y;
      let x = l.porta.fora.x, y = l.porta.fora.y;
      for (let n = 0; n < 8; n++) {
        const c = terr(W, x, y);
        if (c === null || c === '.' || c === 'c') break;
        if (c === ',') M.caixa(x + 0.5, 0, y + 0.5, 0.96, 0.04, 0.96, (x + y) % 2 === 0 ? '#ddd6c4' : '#d3ccb9');
        x += dx; y += dy;
      }
    }
    // tapetes das casas (área da sala)
    for (const l of W.lugares) {
      if (!l.casa) continue;
      const s = W.objs.find((o) => o.casa === l.casa && o.t === 'S'), v = W.objs.find((o) => o.casa === l.casa && o.t === 'V');
      if (!s || !v) continue;
      const cor = ['#b85450', '#4f7fb5', '#7fae5e', '#c9a14a'][hashR(l.casa) % 4];
      const cx = (s.x + v.x) / 2 + 0.5, cz = (s.y + v.y) / 2 + 0.5;
      M.caixa(cx, 0.08, cz, 2.9, 0.012, Math.abs(s.y - v.y) + 2.2, cor);
      M.caixa(cx, 0.092, cz, 2.5, 0.006, Math.abs(s.y - v.y) + 1.8, escCor(cor, 1.18));
    }
    return M.pronta(new THREE.MeshLambertMaterial({ vertexColors: true }), false, true);
  }

  const corParede = (l) => (l.casa ? PAREDES_CASA[hashR(l.casa) % PAREDES_CASA.length] : { ubs: '#f1f7f7', escola: '#f6d56b', trabalho: '#b3c0d3', lanche: '#f2a96c' }[l.modelo] || '#d1d5db');
  const QUADRANTES_BAIXOS = [['S', 'E'], ['N', 'E'], ['N', 'W'], ['S', 'W']];

  /** Paredes finas: altas no fundo, baixas no lado da câmera (recorte), meias nas divisórias. */
  function construirParedes(W, rv, quad) {
    const M = new Malha();
    const vidrosPorLugar = new Map();
    const baixas = QUADRANTES_BAIXOS[quad];
    const T = 0.26;
    const alt = (l, i, j) => {
      if (paredesBaixas) return 0.5;
      const bordas = []; if (j === l.y) bordas.push('N'); if (j === l.y + l.h - 1) bordas.push('S'); if (i === l.x) bordas.push('W'); if (i === l.x + l.w - 1) bordas.push('E');
      if (!bordas.length) return 1.35;
      return bordas.some((b) => !baixas.includes(b)) ? 2.7 : 0.5;
    };
    const ehPar = (x, y) => { const c = terr(W, x, y); return c === '#' || c === '+'; };
    for (let j = 0; j < W.h; j++) for (let i = 0; i < W.w; i++) {
      const ch = W.terr[j * W.w + i];
      if (ch !== '#' && ch !== '+') continue;
      const ln = rv.lugarDe[j * W.w + i];
      if (ln < 0) continue;
      const l = W.lugares[ln], cor = corParede(l);
      const h = alt(l, i, j);
      const cx = i + 0.5, cz = j + 0.5;
      const L = ehPar(i - 1, j), R = ehPar(i + 1, j), U = ehPar(i, j - 1), D = ehPar(i, j + 1);
      const horiz = (L || R) && !(U || D), vert = (U || D) && !(L || R);
      const trim = escCor(cor, 0.78), topo = '#f6f3ec', rod = l.modelo === 'ubs' ? '#13a79a' : escCor(cor, 0.62);
      const lugVidro = () => { if (!vidrosPorLugar.has(ln)) vidrosPorLugar.set(ln, new Malha()); return vidrosPorLugar.get(ln); };
      if (ch === '+') {
        // porta: batentes, verga e folha aberta (nas paredes altas)
        const largo = horiz || !vert;
        const alto = h > 1;
        const ph = alto ? 2.15 : 0.5;
        if (largo) { M.caixa(i + 0.07, 0, cz, 0.14, ph, T, trim); M.caixa(i + 0.93, 0, cz, 0.14, ph, T, trim); if (alto) M.caixa(cx, 2.15, cz, 1, h - 2.15, T, cor); }
        else { M.caixa(cx, 0, j + 0.07, T, ph, 0.14, trim); M.caixa(cx, 0, j + 0.93, T, ph, 0.14, trim); if (alto) M.caixa(cx, 2.15, cz, T, h - 2.15, 1, cor); }
        if (alto && largo) M.caixa(i + 0.14, 0, cz - 0.28, 0.07, 2.1, 0.78, '#9a6a3a', -0.15);
        if (!alto) M.caixa(cx, 0.08, cz, 0.9, 0.012, 0.9, '#7c5a3a');
        continue;
      }
      // pilar + braços
      M.caixa(cx, 0, cz, T, h, T, cor);
      if (L) M.caixa(i + 0.25, 0, cz, 0.5, h, T, cor);
      if (R) M.caixa(i + 0.75, 0, cz, 0.5, h, T, cor);
      if (U) M.caixa(cx, 0, j + 0.25, T, h, 0.5, cor);
      if (D) M.caixa(cx, 0, j + 0.75, T, h, 0.5, cor);
      // rodapé e acabamento no topo
      M.caixa(cx, 0, cz, T + 0.04, 0.16, T + 0.04, rod);
      if (L) M.caixa(i + 0.25, 0, cz, 0.5, 0.16, T + 0.04, rod);
      if (R) M.caixa(i + 0.75, 0, cz, 0.5, 0.16, T + 0.04, rod);
      if (U) M.caixa(cx, 0, j + 0.25, T + 0.04, 0.16, 0.5, rod);
      if (D) M.caixa(cx, 0, j + 0.75, T + 0.04, 0.16, 0.5, rod);
      M.caixa(cx, h, cz, T + 0.05, 0.05, T + 0.05, topo);
      if (L) M.caixa(i + 0.25, h, cz, 0.5, 0.05, T + 0.05, topo);
      if (R) M.caixa(i + 0.75, h, cz, 0.5, 0.05, T + 0.05, topo);
      if (U) M.caixa(cx, h, j + 0.25, T + 0.05, 0.05, 0.5, topo);
      if (D) M.caixa(cx, h, j + 0.75, T + 0.05, 0.05, 0.5, topo);
      // janelas (paredes altas retas) e quadros
      if (h > 2 && (horiz || vert)) {
        const r = ruido(i, j, 5);
        const comJanela = l.modelo === 'ubs' ? r > 0.45 : r > 0.55;
        if (comJanela) {
          const vg = lugVidro();
          if (horiz) { M.caixa(cx, 1.0, cz, 0.72, 1.0, T + 0.08, '#e8e4da'); vg.caixa(cx, 1.04, cz, 0.62, 0.92, 0.05, '#bfe3f5'); }
          else { M.caixa(cx, 1.0, cz, T + 0.08, 1.0, 0.72, '#e8e4da'); vg.caixa(cx, 1.04, cz, 0.05, 0.92, 0.62, '#bfe3f5'); }
        } else if (r < 0.2 && l.casa) {
          const cor2 = ['#c95f5f', '#5f8fc9', '#c9a95f', '#6fb08a'][Math.floor(r * 20) % 4];
          if (horiz) { const lado = terr(W, i, j + 1) === '_' ? 1 : -1; M.caixa(cx, 1.35, cz + lado * (T / 2 + 0.02), 0.6, 0.45, 0.04, '#6b4a2a'); M.caixa(cx, 1.4, cz + lado * (T / 2 + 0.045), 0.48, 0.35, 0.02, cor2); }
          else { const lado = terr(W, i + 1, j) === '_' ? 1 : -1; M.caixa(cx + lado * (T / 2 + 0.02), 1.35, cz, 0.04, 0.45, 0.6, '#6b4a2a'); M.caixa(cx + lado * (T / 2 + 0.045), 1.4, cz, 0.02, 0.35, 0.48, cor2); }
        }
      }
    }
    const malha = M.pronta(new THREE.MeshLambertMaterial({ vertexColors: true }), true, true);
    const vidros = [];
    for (const [ln, vg] of vidrosPorLugar) {
      const m = vg.pronta(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, emissive: 0x000000 }), false, false);
      m.userData.lugar = ln;
      vidros.push(m);
    }
    return { malha, vidros };
  }

  /* ---------- móveis ---------- */
  function construirMoveis(W, cfg, rv) {
    const M = new Malha();
    const efeitos = { tvs: [], fogoes: [], chuveiros: [], fontes: [], moinhos: [], vidros: [] };
    const dinamicos = [];
    for (const o of W.objs) {
      const i = o.x, j = o.y, cx = i + 0.5, cz = j + 0.5;
      const y0 = alturaPiso(W, rv, i, j);
      const hh = hashR(`${i},${j}`);
      switch (o.t) {
        case 'B': { // cama de casal/solteiro, cabeceira ao norte
          const cob = ['#6aa7e0', '#e07a8a', '#7ac79a', '#e0b45a'][hh % 4];
          M.caixa(cx, y0, cz + 0.15, 0.92, 0.28, 1.3, '#8a5a3b');
          M.caixa(cx, y0 + 0.28, cz + 0.13, 0.84, 0.14, 1.22, '#f3f6fa');
          M.caixa(cx, y0 + 0.42, cz + 0.4, 0.86, 0.1, 0.78, cob);
          M.caixa(cx, y0 + 0.42, cz - 0.3, 0.55, 0.1, 0.24, '#ffffff');
          M.caixa(cx, y0, cz - 0.47, 0.96, 0.78, 0.07, '#7a4e32');
          break;
        }
        case 'S': { // sofá voltado para o norte
          const cor = ['#6b8fb8', '#8b6fb0', '#b0756f', '#6fa38b'][hashR(o.casa || 'x') % 4];
          M.caixa(cx, y0, cz, 0.92, 0.36, 0.86, cor);
          M.caixa(cx, y0 + 0.36, cz - 0.12, 0.7, 0.1, 0.5, escCor(cor, 1.18));
          M.caixa(cx, y0 + 0.36, cz + 0.33, 0.92, 0.46, 0.18, escCor(cor, 0.86));
          M.caixa(cx - 0.42, y0, cz, 0.12, 0.55, 0.86, escCor(cor, 0.82));
          M.caixa(cx + 0.42, y0, cz, 0.12, 0.55, 0.86, escCor(cor, 0.82));
          break;
        }
        case 'V': { // TV sobre móvel, tela para o sul
          M.caixa(cx, y0, cz, 0.92, 0.5, 0.42, '#6a4b34');
          M.caixa(cx, y0 + 0.5, cz, 0.12, 0.04, 0.1, '#2b2f36');
          M.caixa(cx, y0 + 0.54, cz, 0.84, 0.5, 0.06, '#15171c');
          const tela = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.42), new THREE.MeshBasicMaterial({ color: 0x1b2230 }));
          tela.position.set(cx, y0 + 0.79, cz + 0.035);
          dinamicos.push(tela); efeitos.tvs.push({ tela, casa: o.casa });
          break;
        }
        case 'm': { // mesa de jantar
          for (const [dx, dz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) M.caixa(cx + dx, y0, cz + dz, 0.07, 0.7, 0.07, '#6b4a2a');
          M.caixa(cx, y0 + 0.7, cz, 0.98, 0.06, 0.98, '#b08455');
          M.caixa(cx, y0 + 0.76, cz, 0.5, 0.012, 0.5, '#f1e9d9');
          for (const dx of [-0.25, 0.25]) { M.cilindro(cx + dx, y0 + 0.76, cz, 0.12, 0.02, '#ffffff', 10); M.cilindro(cx + dx, y0 + 0.78, cz, 0.07, 0.015, ['#d97a4a', '#9bd17a', '#e9c13b'][hh % 3], 8); }
          M.cilindro(cx, y0 + 0.76, cz - 0.3, 0.05, 0.11, '#e8f0f7', 8);
          break;
        }
        case 'G': { // bancada com fogão e geladeira (junto à parede norte)
          M.caixa(cx - 0.12, y0, cz - 0.15, 0.7, 0.85, 0.64, '#f1ece4');
          M.caixa(cx - 0.12, y0 + 0.85, cz - 0.15, 0.74, 0.05, 0.68, '#9aa3ad');
          for (const [bx, bz] of [[-0.22, -0.3], [0.0, -0.3], [-0.22, -0.05], [0.0, -0.05]]) M.cilindro(cx + bx, y0 + 0.9, cz + bz, 0.07, 0.015, '#2d333b', 8);
          M.caixa(cx - 0.12, y0 + 1.3, cz - 0.4, 0.7, 0.45, 0.28, '#e9e2d6');
          M.caixa(cx + 0.37, y0, cz - 0.2, 0.28, 1.75, 0.55, '#e9eef3');
          M.caixa(cx + 0.37, y0 + 1.0, cz + 0.08, 0.2, 0.05, 0.02, '#9aa3ad');
          efeitos.fogoes.push({ x: cx - 0.12, y: y0 + 0.95, z: cz - 0.15, o });
          break;
        }
        case 'C': { // cabine de chuveiro
          M.caixa(cx, y0, cz, 0.96, 0.03, 0.96, '#bfd9e6');
          M.cilindro(cx + 0.38, y0, cz - 0.38, 0.03, 2.1, '#9aa3ad', 6);
          M.cilindro(cx + 0.3, y0 + 2.05, cz - 0.3, 0.1, 0.03, '#d3d8dc', 8);
          const vid = new THREE.Mesh(new THREE.BoxGeometry(0.96, 1.9, 0.03), new THREE.MeshLambertMaterial({ color: 0xbfe3f5, transparent: true, opacity: 0.35 }));
          vid.position.set(cx, y0 + 0.95, cz + 0.48);
          const vid2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.9, 0.96), vid.material);
          vid2.position.set(cx + 0.48, y0 + 0.95, cz);
          dinamicos.push(vid, vid2);
          efeitos.chuveiros.push({ x: cx + 0.3, y: y0 + 2.0, z: cz - 0.3, o });
          break;
        }
        case 'X': { // estante de livros (encostada na parede oeste, aberta para leste)
          M.caixa(cx - 0.3, y0, cz, 0.34, 1.85, 0.92, '#7a5230');
          for (let n = 0; n < 4; n++) {
            M.caixa(cx - 0.12, y0 + 0.28 + n * 0.45, cz, 0.04, 0.04, 0.86, '#5d3f22');
            for (let b = 0; b < 7; b++) {
              const alturaL = 0.26 + ruido(i, j, b + n * 9) * 0.1;
              M.caixa(cx - 0.17, y0 + 0.32 + n * 0.45, cz - 0.38 + b * 0.125, 0.18, alturaL, 0.09, ['#c94f4f', '#4f7fc9', '#e0b43a', '#4fa36f', '#8a4fc9', '#ffffff'][(b + n + hh) % 6]);
            }
          }
          break;
        }
        case 'N': { // poltrona voltada para leste
          const cor = ['#c97a4f', '#6f8fb8', '#9b6fb0', '#7aa36f'][hh % 4];
          M.caixa(cx, y0, cz, 0.8, 0.34, 0.8, cor);
          M.caixa(cx, y0 + 0.34, cz, 0.6, 0.1, 0.6, escCor(cor, 1.15));
          M.caixa(cx - 0.34, y0 + 0.34, cz, 0.14, 0.5, 0.8, escCor(cor, 0.85));
          M.caixa(cx, y0 + 0.34, cz - 0.36, 0.8, 0.26, 0.12, escCor(cor, 0.82));
          M.caixa(cx, y0 + 0.34, cz + 0.36, 0.8, 0.26, 0.12, escCor(cor, 0.82));
          M.caixa(cx + 0.5, y0, cz - 0.38, 0.06, 0.04, 0.06, '#000000');
          break;
        }
        case 'J': { // vaso de planta
          M.cilindro(cx, y0, cz, 0.17, 0.3, '#b86b45', 8, 0.2);
          for (const [dx, dz, dy, r] of [[0, 0, 0.62, 0.22], [-0.12, 0.05, 0.5, 0.15], [0.12, -0.05, 0.52, 0.16], [0.02, 0.1, 0.74, 0.14]]) M.esfera(cx + dx, y0 + dy, cz + dz, r, ['#3f9a4a', '#58b256', '#2f7d32'][hh % 3], 6, 4);
          break;
        }
        case 'H': { // banco da sala de espera
          M.caixa(cx, y0, cz, 0.86, 0.1, 0.5, '#2f80c9'); M.caixa(cx, y0 + 0.1, cz - 0.21, 0.86, 0.42, 0.08, '#2670b0');
          for (const dx of [-0.38, 0.38]) M.caixa(cx + dx, y0, cz, 0.05, 0.4, 0.46, '#4a5560');
          M.caixa(cx, y0 + 0.4, cz, 0.86, 0.06, 0.5, '#2f80c9');
          break;
        }
        case 'U': { // balcão de triagem com computador e aparelho de pressão
          M.caixa(cx, y0, cz, 0.96, 0.95, 0.5, '#dfe8ee'); M.caixa(cx, y0 + 0.95, cz, 1.0, 0.05, 0.56, '#8fb7c9');
          M.caixa(cx + 0.22, y0 + 1.0, cz - 0.05, 0.36, 0.24, 0.03, '#1f2933'); M.caixa(cx + 0.22, y0 + 1.0, cz - 0.05, 0.06, 0.12, 0.06, '#4a5560');
          M.caixa(cx - 0.18, y0 + 1.0, cz + 0.08, 0.3, 0.12, 0.14, '#f8fafc');
          break;
        }
        case 'Y': { // farmácia
          M.caixa(cx, y0, cz - 0.3, 0.96, 1.95, 0.3, '#e3efe7');
          for (let n = 0; n < 4; n++) for (let b = 0; b < 4; b++) M.caixa(cx - 0.36 + b * 0.24, y0 + 0.2 + n * 0.45, cz - 0.14, 0.18, 0.26, 0.12, ['#f87171', '#34d399', '#60a5fa', '#fbbf24'][(b + n) % 4]);
          M.caixa(cx, y0, cz + 0.2, 0.96, 0.95, 0.4, '#c6dccf'); M.caixa(cx, y0 + 0.95, cz + 0.2, 1.0, 0.05, 0.46, '#7bb394');
          M.caixa(cx, y0 + 2.05, cz - 0.28, 0.5, 0.05, 0.05, '#16a34a'); M.caixa(cx, y0 + 1.82, cz - 0.28, 0.05, 0.5, 0.05, '#16a34a');
          break;
        }
        case 'D': { // maca de exame
          M.caixa(cx, y0, cz, 0.8, 0.55, 1.0, '#c7d2dc'); M.caixa(cx, y0 + 0.55, cz, 0.86, 0.1, 1.06, '#f8fafc');
          M.caixa(cx, y0 + 0.65, cz - 0.38, 0.6, 0.06, 0.2, '#9ec9e8');
          M.caixa(cx + 0.45, y0, cz + 0.3, 0.06, 1.3, 0.06, '#9aa3ad'); M.caixa(cx + 0.45, y0 + 1.3, cz + 0.3, 0.2, 0.1, 0.2, '#e5e7eb');
          break;
        }
        case 'M': { // mesa da sala de reunião (cada tile é um pedaço da mesa)
          for (const [dx, dz] of [[-0.42, -0.4], [0.42, -0.4], [-0.42, 0.4], [0.42, 0.4]]) M.caixa(cx + dx, y0, cz + dz, 0.07, 0.74, 0.07, '#6b4a2f');
          M.caixa(cx, y0 + 0.74, cz, 1.0, 0.07, 0.96, '#a9744a');
          if (hh % 2 === 0) { M.caixa(cx - 0.12, y0 + 0.81, cz + 0.05, 0.3, 0.015, 0.22, '#f8fafc'); M.cilindro(cx + 0.28, y0 + 0.81, cz - 0.2, 0.05, 0.1, '#ffffff', 8); }
          else { M.caixa(cx + 0.1, y0 + 0.81, cz, 0.34, 0.02, 0.24, '#e5e7eb'); M.caixa(cx - 0.25, y0 + 0.81, cz - 0.15, 0.2, 0.015, 0.14, '#fde68a'); }
          break;
        }
        case 'Q': { // cadeira da sala de reunião, com o encosto do lado oposto à mesa
          let mesa = null, melhor = 99;
          for (const t of W.porTipo.M || []) { const dd = Math.abs(t.x - i) + Math.abs(t.y - j); if (dd < melhor) { melhor = dd; mesa = t; } }
          let ux = 0, uz = 1;
          if (mesa) { if (Math.abs(mesa.x - i) >= Math.abs(mesa.y - j)) { ux = Math.sign(mesa.x - i); uz = 0; } else { ux = 0; uz = Math.sign(mesa.y - j); } }
          M.caixa(cx, y0 + 0.42, cz, 0.5, 0.07, 0.5, '#2f6f8f');
          for (const [dx, dz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) M.caixa(cx + dx, y0, cz + dz, 0.05, 0.42, 0.05, '#4a5560');
          M.caixa(cx - ux * 0.23, y0 + 0.49, cz - uz * 0.23, ux ? 0.06 : 0.5, 0.45, uz ? 0.06 : 0.5, '#256079');
          break;
        }
        case 'Z': { // arquivo de prontuários (gaveteiro de aço encostado na parede)
          M.caixa(cx, y0, cz, 0.92, 1.55, 0.6, '#9aa7b2');
          for (let g = 0; g < 4; g++) { M.caixa(cx, y0 + 0.08 + g * 0.38, cz + 0.31, 0.8, 0.32, 0.02, '#b8c3cc'); M.caixa(cx, y0 + 0.2 + g * 0.38, cz + 0.33, 0.2, 0.04, 0.03, '#374151'); }
          break;
        }
        case 'W': { // copa: bancada com cafeteira, garrafa térmica e galão de água
          M.caixa(cx, y0, cz, 0.96, 0.9, 0.56, '#d9c7a7'); M.caixa(cx, y0 + 0.9, cz, 1.0, 0.05, 0.6, '#8b6b4a');
          M.caixa(cx - 0.22, y0 + 0.95, cz, 0.24, 0.3, 0.2, '#1f2933'); M.caixa(cx - 0.22, y0 + 1.0, cz + 0.11, 0.1, 0.12, 0.02, '#f59e0b');
          M.cilindro(cx + 0.12, y0 + 0.95, cz, 0.07, 0.26, '#cbd5e1', 8); M.cilindro(cx + 0.32, y0 + 0.95, cz + 0.12, 0.045, 0.09, '#ffffff', 8);
          M.cilindro(cx + 0.3, y0 + 0.95, cz - 0.15, 0.1, 0.4, '#7dd3fc', 8);
          break;
        }
        case 'E': { // carteira escolar
          for (const [dx, dz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) M.caixa(cx + dx, y0, cz + dz, 0.05, 0.62, 0.05, '#6b7280');
          M.caixa(cx, y0 + 0.62, cz, 0.8, 0.05, 0.56, '#d6a35a');
          M.caixa(cx - 0.1, y0 + 0.67, cz, 0.3, 0.015, 0.22, '#ffffff'); M.caixa(cx + 0.2, y0 + 0.67, cz + 0.1, 0.04, 0.03, 0.22, '#e0553a');
          break;
        }
        case 'O': { // mesa de trabalho
          for (const [dx, dz] of [[-0.42, -0.24], [0.42, -0.24], [-0.42, 0.24], [0.42, 0.24]]) M.caixa(cx + dx, y0, cz + dz, 0.05, 0.7, 0.05, '#6b7280');
          M.caixa(cx, y0 + 0.7, cz, 0.98, 0.05, 0.6, '#b9c3cf');
          M.caixa(cx - 0.05, y0 + 0.75, cz - 0.15, 0.42, 0.28, 0.03, '#111827'); M.caixa(cx - 0.05, y0 + 0.75, cz - 0.15, 0.06, 0.12, 0.06, '#4a5560');
          M.caixa(cx - 0.05, y0 + 0.75, cz + 0.08, 0.36, 0.02, 0.12, '#e5e7eb'); M.cilindro(cx + 0.35, y0 + 0.75, cz + 0.05, 0.04, 0.09, '#d9534f', 6);
          break;
        }
        case 'L': { // balcão da lanchonete
          M.caixa(cx, y0, cz, 0.98, 1.0, 0.56, '#e4572e'); M.caixa(cx, y0 + 1.0, cz, 1.04, 0.05, 0.62, '#fff4e0');
          M.caixa(cx, y0 + 1.3, cz - 0.28, 0.9, 0.5, 0.04, '#2b2f36');
          M.cilindro(cx - 0.2, y0 + 1.05, cz, 0.1, 0.05, '#d9a05b', 8); M.cilindro(cx + 0.2, y0 + 1.05, cz, 0.08, 0.14, '#ffffff', 8);
          break;
        }
        case 'P': { // banco de praça (voltado para o sul)
          M.caixa(cx, y0 + 0.4, cz, 0.95, 0.06, 0.45, '#a97c50'); M.caixa(cx, y0 + 0.5, cz - 0.22, 0.95, 0.4, 0.06, '#8c6239');
          for (const dx of [-0.4, 0.4]) M.caixa(cx + dx, y0, cz, 0.06, 0.4, 0.42, '#374151');
          break;
        }
        case 'A': { // aparelho de academia ao ar livre
          for (const dx of [-0.35, 0.35]) M.caixa(cx + dx, y0, cz, 0.07, 1.5, 0.07, '#6b7280');
          M.caixa(cx, y0 + 1.5, cz, 0.8, 0.07, 0.07, '#ef4444'); M.caixa(cx, y0 + 0.9, cz + 0.2, 0.5, 0.05, 0.3, '#3b82f6');
          M.caixa(cx, y0, cz, 0.7, 0.04, 0.6, '#9ca3af');
          break;
        }
        case 'K': { // fonte
          M.cilindro(cx, y0, cz, 0.95, 0.35, '#b8bec4', 14); M.cilindro(cx, y0 + 0.35, cz, 0.82, 0.04, '#6fc3e6', 14);
          M.cilindro(cx, y0 + 0.35, cz, 0.12, 0.9, '#b8bec4', 8); M.cilindro(cx, y0 + 1.2, cz, 0.42, 0.1, '#b8bec4', 10);
          efeitos.fontes.push({ x: cx, y: y0 + 1.3, z: cz });
          break;
        }
        case 'R': { // roça de milho
          for (let n = 0; n < 6; n++) {
            const px = cx - 0.3 + (n % 3) * 0.3, pz = cz - 0.25 + Math.floor(n / 3) * 0.5;
            M.cilindro(px, y0 + 0.04, pz, 0.035, 1.1, '#5a9a2e', 5);
            M.caixa(px + 0.1, y0 + 0.5, pz, 0.22, 0.03, 0.07, '#6fb23f', 0.3); M.caixa(px - 0.1, y0 + 0.75, pz, 0.22, 0.03, 0.07, '#6fb23f', -0.3);
            M.esfera(px, y0 + 1.0, pz, 0.07, '#e9c13b', 5, 4, 1, 1.7, 1);
          }
          break;
        }
        case 'T': { // árvore
          const v = ruido(i, j, 4);
          M.cilindro(cx, y0, cz, 0.12, 1.3 + v * 0.4, '#7a5230', 6, 0.08);
          const cores = [['#2f7d32', '#3e9142', '#55a84d'], ['#3a8a3a', '#4b9e44', '#62b455'], ['#2c7a4a', '#3b8f55', '#52a566']][hashR(`${i}${j}`) % 3];
          if (v > 0.7) { M.cilindro(cx, y0 + 1.0, cz, 0.85, 1.0, cores[0], 8, 0.05); M.cilindro(cx, y0 + 1.6, cz, 0.65, 0.9, cores[1], 8, 0.05); M.cilindro(cx, y0 + 2.2, cz, 0.45, 0.8, cores[2], 8, 0.02); }
          else { M.esfera(cx, y0 + 1.9, cz, 0.85, cores[0], 8, 6); M.esfera(cx - 0.45, y0 + 1.6, cz + 0.1, 0.55, cores[1], 7, 5); M.esfera(cx + 0.45, y0 + 1.7, cz - 0.1, 0.6, cores[2], 7, 5); M.esfera(cx, y0 + 2.45, cz, 0.5, cores[2], 7, 5); }
          break;
        }
        default: break;
      }
      if (o.decor) continue;
      // volume de seleção do móvel (invisível)
      const pick = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      pick.position.set(cx, y0 + 0.75, cz); pick.userData.obj = o;
      hitMoveis.push(pick); dinamicos.push(pick);
    }
    return { malha: M.pronta(new THREE.MeshLambertMaterial({ vertexColors: true }), true, true), efeitos, dinamicos };
  }

  /* ---------- decoração: sebes, postes, flores, placas, prédios de fundo, igreja, celeiro, lago… ---------- */
  function construirDecoracao(W, cfg, rv) {
    const M = new Malha();
    const extras = { postes: [], moinhos: [], animais: [], lagos: [], texturasPlaca: [], aves: [] };
    const ocupa = new Set(W.objs.map((o) => o.y * W.w + o.x));
    const bloqDecor = new Set();
    for (const d of W.decoracao || []) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) bloqDecor.add(y * W.w + x);
    const pisavel = (x, y) => { const c = terr(W, x, y); return (c === ',' || c === 'c') && !ocupa.has(y * W.w + x) && !bloqDecor.has(y * W.w + x); };
    // sebe contínua na borda; cancelas onde a rua sai do mapa
    for (let j = 0; j < W.h; j++) for (let i = 0; i < W.w; i++) {
      const borda = i === 0 || j === 0 || i === W.w - 1 || j === W.h - 1;
      if (!borda) continue;
      const c = terr(W, i, j);
      if (c === '.') {
        const horizontal = i === 0 || i === W.w - 1;
        const cx = i + 0.5, cz = j + 0.5;
        M.caixa(cx, 0, cz, horizontal ? 0.1 : 0.9, 0.9, horizontal ? 0.9 : 0.1, '#f2f2f2');
        continue;
      }
      if (c === ',' || c === 'c') { if (!ocupa.has(j * W.w + i) && !bloqDecor.has(j * W.w + i)) M.caixa(i + 0.5, 0, j + 0.5, 1, 0.55 + ruido(i, j, 6) * 0.1, 1, mistura('#3f8a43', '#4aa04b', ruido(i, j, 7))); }
    }
    // arbustos e flores junto às fachadas
    for (const l of W.lugares) {
      for (let y = l.y - 1; y <= l.y + l.h; y++) for (let x = l.x - 1; x <= l.x + l.w; x++) {
        if (x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h) continue;
        if (!pisavel(x, y) || terr(W, x, y) !== ',') continue;
        if (l.porta && Math.abs(x - l.porta.fora.x) <= 1 && Math.abs(y - l.porta.fora.y) <= 1) continue;
        const r = ruido(x, y, 7);
        if (r > 0.62) { M.esfera(x + 0.35, 0.3, y + 0.4, 0.3, '#3f9a4a', 7, 5); M.esfera(x + 0.65, 0.28, y + 0.6, 0.26, '#58b256', 7, 5); }
        else if (r > 0.42) for (let n = 0; n < 5; n++) { const fx = x + 0.15 + ruido(x, y, n) * 0.7, fz = y + 0.15 + ruido(x, y, n + 9) * 0.7; M.cilindro(fx, 0.02, fz, 0.012, 0.22, '#3a7d3a', 4); M.esfera(fx, 0.27, fz, 0.06, ['#ff8fb1', '#ffd84d', '#ffffff', '#b99bff'][(x + y + n) % 4], 5, 4); }
      }
    }
    // flores soltas, postes de luz, caixas de correio e placas
    for (let j = 0; j < W.h; j++) for (let i = 0; i < W.w; i++) {
      const c = terr(W, i, j);
      if (c === ',' && pisavel(i, j) && ruido(i, j, 9) > 0.975) for (let n = 0; n < 4; n++) { const fx = i + 0.2 + ruido(i, j, n) * 0.6, fz = j + 0.2 + ruido(i, j, n + 5) * 0.6; M.cilindro(fx, 0.02, fz, 0.012, 0.2, '#3a7d3a', 4); M.esfera(fx, 0.25, fz, 0.055, ['#ff8fb1', '#ffd84d', '#ffffff'][(i + n) % 3], 5, 4); }
      if (c === 'c' && pisavel(i, j) && (i * 3 + j * 5) % 8 === 0 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => terr(W, i + a, j + b) === '.')) {
        const px = i + 0.5, pz = j + 0.5;
        M.cilindro(px, 0.07, pz, 0.045, 3.0, '#3b4350', 6); M.caixa(px + 0.15, 3.0, pz, 0.42, 0.06, 0.08, '#3b4350'); M.caixa(px + 0.32, 2.93, pz, 0.2, 0.08, 0.12, '#f3f3e8');
        extras.postes.push({ x: px + 0.32, y: 2.9, z: pz });
      }
    }
    for (const l of W.lugares) {
      if (!l.porta) continue;
      const dx = l.porta.fora.x - l.porta.x, dy = l.porta.fora.y - l.porta.y;
      const lado = dy !== 0 ? [2, 0] : [0, 2];
      const q = { x: l.porta.fora.x + lado[0], y: l.porta.fora.y + lado[1] };
      const y0 = terr(W, q.x, q.y) === 'c' ? 0.07 : 0;
      if (!pisavel(q.x, q.y)) continue;
      const px = q.x + 0.5, pz = q.y + 0.5;
      if (l.casa) { M.cilindro(px, y0, pz, 0.04, 0.9, '#7a5a3a', 5); M.caixa(px, y0 + 0.9, pz, 0.3, 0.2, 0.2, '#3b82c4'); }
      else {
        const cor = { ubs: '#16a34a', escola: '#e3a70b', lanche: '#e4572e', trabalho: '#3b6fb6' }[l.modelo] || '#16a34a';
        M.cilindro(px, y0, pz, 0.05, 1.7, '#6b7280', 6); M.caixa(px, y0 + 1.45, pz, 0.9, 0.7, 0.08, cor, dy !== 0 ? 0 : Math.PI / 2);
        extras.texturasPlaca.push({ x: px, y: y0 + 1.8, z: pz, modelo: l.modelo, rot: dy !== 0 ? 0 : Math.PI / 2 });
      }
    }
    // construções decorativas
    const grupo = new THREE.Group();
    for (const d of W.decoracao || []) {
      const x0 = d.x, z0 = d.y, w = d.w, h = d.h, cx = x0 + w / 2, cz = z0 + h / 2;
      switch (d.t) {
        case 'predio': { // fundo de cidade: prédio com janelas
          M.caixa(cx, 0, cz, w - 0.3, d.alt, h - 0.3, d.cor);
          M.caixa(cx, d.alt, cz, w - 0.5, 0.4, h - 0.5, escCor(d.cor, 0.8));
          M.caixa(cx + w * 0.2, d.alt + 0.4, cz, 1.0, 0.8, 1.0, '#7d8794');
          for (let andar = 1; andar < d.alt - 0.5; andar += 1.5) for (let k = 0.7; k < w - 0.7; k += 1.1) {
            const acesa = ruido(x0 + k * 10, andar * 10, 3) > 0.7;
            const cj = acesa ? '#ffe9a8' : '#6d8fb0';
            M.caixa(x0 + k + 0.15, andar, z0 + h - 0.12, 0.7, 0.9, 0.06, cj); M.caixa(x0 + w - 0.12, andar, z0 + 0.7 + (k % 1.5), 0.06, 0.9, 0.6, cj);
          }
          break;
        }
        case 'igreja': {
          M.caixa(cx, 0, cz + 0.3, w - 2, 3.2, h - 1.4, '#f0e6d2'); M.telhado(cx, 3.2, cz + 0.3, w - 1.6, 1.6, h - 1.2, '#a34a3a', true);
          M.caixa(cx, 0, z0 + h - 1.1, 2.0, 5.2, 2.0, '#efe3cb'); M.caixa(cx, 5.2, z0 + h - 1.1, 2.2, 0.2, 2.2, '#d9ccb0');
          M.cilindro(cx, 5.4, z0 + h - 1.1, 1.3, 2.2, '#a34a3a', 4, 0.0);
          M.caixa(cx, 7.5, z0 + h - 1.1, 0.12, 0.9, 0.12, '#d4af37'); M.caixa(cx, 7.9, z0 + h - 1.1, 0.5, 0.12, 0.12, '#d4af37');
          M.caixa(cx, 0, z0 + h - 0.05, 0.9, 1.7, 0.1, '#6b4a2a');
          for (const dx of [-1.3, 1.3]) M.caixa(cx + dx, 1.4, z0 + h - 0.45, 0.5, 1.1, 0.08, '#6fa8dc');
          break;
        }
        case 'torre_agua': {
          for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) M.cilindro(cx + dx, 0, cz + dz, 0.12, 4.5, '#8a929c', 6);
          M.cilindro(cx, 4.4, cz, 1.3, 1.9, '#9fb4c7', 14); M.cilindro(cx, 6.3, cz, 1.3, 0.8, '#7f95aa', 14, 0.15);
          break;
        }
        case 'celeiro': {
          M.caixa(cx, 0, cz, w - 0.4, 3.0, h - 0.5, '#b5452f'); M.telhado(cx, 3.0, cz, w, 2.0, h - 0.1, '#6b4a3a', true);
          M.caixa(cx, 0, z0 + h - 0.22, 2.6, 2.4, 0.1, '#f0e6d2');
          M.caixa(cx - 0.7, 0.1, z0 + h - 0.15, 0.1, 2.2, 0.06, '#8a3a28', 0.6); M.caixa(cx + 0.7, 0.1, z0 + h - 0.15, 0.1, 2.2, 0.06, '#8a3a28', -0.6);
          M.caixa(cx, 3.1, z0 + h - 0.2, 0.9, 1.0, 0.08, '#f0e6d2');
          break;
        }
        case 'silo': { M.cilindro(cx, 0, cz, 0.9, 5.0, '#aeb6bf', 12); M.esfera(cx, 5.0, cz, 0.9, '#8a929c', 12, 5, 1, 0.8, 1); break; }
        case 'moinho': {
          M.cilindro(cx, 0, cz, 0.95, 4.3, '#f1ede4', 10, 0.55); M.cilindro(cx, 4.3, cz, 0.7, 1.0, '#7a4a3a', 10, 0.0);
          extras.moinhos.push({ x: cx, y: 3.6, z: z0 + h - 0.1 });
          break;
        }
        case 'feno': { M.esfera(cx, 0.45, cz, 0.55, '#e0c150', 8, 5, 1, 0.8, 1); break; }
        case 'pasto': {
          const cx2 = x0 + w / 2;
          for (let k = 0; k <= w; k += 1) for (const zz of [z0 + 0.1, z0 + h - 0.1]) { M.caixa(x0 + k, 0, zz, 0.07, 0.9, 0.07, '#7a5a3a'); }
          for (let k = 0; k <= h; k += 1) for (const xx of [x0 + 0.1, x0 + w - 0.1]) { M.caixa(xx, 0, z0 + k, 0.07, 0.9, 0.07, '#7a5a3a'); }
          for (const [a, b, c2, dd] of [[cx2, 0.35, z0 + 0.1, [w, 0.06, 0.05]], [cx2, 0.7, z0 + 0.1, [w, 0.06, 0.05]], [cx2, 0.35, z0 + h - 0.1, [w, 0.06, 0.05]], [cx2, 0.7, z0 + h - 0.1, [w, 0.06, 0.05]]]) M.caixa(a, b, c2, dd[0], dd[1], dd[2], '#9a7a52');
          for (const [a, b, c2, dd] of [[x0 + 0.1, 0.35, z0 + h / 2, [0.05, 0.06, h]], [x0 + 0.1, 0.7, z0 + h / 2, [0.05, 0.06, h]], [x0 + w - 0.1, 0.35, z0 + h / 2, [0.05, 0.06, h]], [x0 + w - 0.1, 0.7, z0 + h / 2, [0.05, 0.06, h]]]) M.caixa(a, b, c2, dd[0], dd[1], dd[2], '#9a7a52');
          for (let n = 0; n < (d.vacas || 3); n++) extras.animais.push({ tipo: 'vaca', x: x0 + 1.5 + ruido(n, 1, 2) * (w - 3), z: z0 + 1.2 + ruido(n, 2, 3) * (h - 2.4), area: [x0 + 1, z0 + 1, x0 + w - 1, z0 + h - 1], seed: n });
          break;
        }
        case 'lago': {
          M.caixa(cx, 0, cz, w - 0.2, 0.05, h - 0.2, '#d8c690');
          extras.lagos.push({ x: cx, z: cz, w: w - 1.1, h: h - 1.1 });
          for (let n = 0; n < 9; n++) { const ang = (n / 9) * Math.PI * 2; M.cilindro(cx + Math.cos(ang) * (w / 2 - 0.5), 0.05, cz + Math.sin(ang) * (h / 2 - 0.5), 0.03, 0.8 + ruido(n, 1, 1) * 0.3, '#5a8a3a', 4); }
          for (let n = 0; n < 5; n++) extras.animais.push({ tipo: 'pato', x: cx + (ruido(n, 3, 4) - 0.5) * (w - 3), z: cz + (ruido(n, 4, 5) - 0.5) * (h - 3), area: [cx - (w - 2) / 2, cz - (h - 2) / 2, cx + (w - 2) / 2, cz + (h - 2) / 2], seed: n });
          break;
        }
        default: break;
      }
    }
    const malha = M.pronta(new THREE.MeshLambertMaterial({ vertexColors: true }), true, true);
    grupo.add(malha);
    // lagos (água) e placas com ícone
    for (const lg of extras.lagos) {
      const agua = new THREE.Mesh(new THREE.PlaneGeometry(lg.w, lg.h), new THREE.MeshLambertMaterial({ color: 0x4aa8d8, transparent: true, opacity: 0.92 }));
      agua.rotation.x = -Math.PI / 2; agua.position.set(lg.x, 0.03, lg.z); grupo.add(agua);
    }
    for (const p of extras.texturasPlaca) {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const g = c.getContext('2d'); g.font = '44px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
      g.fillText({ ubs: '✚', escola: '📚', lanche: '🍔', trabalho: '💼' }[p.modelo] || '✚', 32, 36);
      const t = new THREE.CanvasTexture(c);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.55), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
      pl.position.set(p.x, p.y - 0.35, p.z); pl.rotation.y = p.rot; pl.translateZ(0.055); grupo.add(pl);
      const pl2 = pl.clone(); pl2.rotation.y = p.rot + Math.PI; pl2.position.set(p.x, p.y - 0.35, p.z); pl2.translateZ(0.055); grupo.add(pl2);
    }
    // postes de luz (lâmpadas que acendem à noite)
    const lampadas = extras.postes.map((p) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), new THREE.MeshBasicMaterial({ color: 0xfff2c4 })); m.position.set(p.x, p.y + 0.02, p.z); grupo.add(m); return m; });
    return { grupo, extras, lampadas };
  }

  /* ---------- montagem completa do cenário (ao trocar de mapa ou girar a câmera) ---------- */
  function montarMundo(W, S, cfg, quad) {
    const rv = preparaMapa(W);
    if (mundo3d) { cena.remove(mundo3d.grupo); mundo3d.grupo.traverse((o) => { if (o.geometry && !(o.geometry === gCaixa)) if (o.geometry && o.geometry.dispose) o.geometry.dispose(); }); hitMoveis.length = 0; }
    const grupo = new THREE.Group();
    grupo.add(construirTerreno(W, cfg, rv));
    const paredes = construirParedes(W, rv, quad);
    grupo.add(paredes.malha); paredes.vidros.forEach((v) => grupo.add(v));
    const moveis = construirMoveis(W, cfg, rv);
    grupo.add(moveis.malha); moveis.dinamicos.forEach((d) => grupo.add(d));
    const decor = construirDecoracao(W, cfg, rv);
    grupo.add(decor.grupo);
    cena.add(grupo);
    // vida: aves, nuvens, pás do moinho, animais
    const vida = { aves: [], nuvens: [], pas: [], animais: [], vapor: [], agua: [], fumaca: [], jatos: [] };
    for (let n = 0; n < 6; n++) { const ave = new THREE.Group(); const corpo = new THREE.Mesh(gCaixa, mat('#f4f4f4')); corpo.scale.set(0.35, 0.1, 0.12); const asa = new THREE.Mesh(gCaixa, mat('#e6e6e6')); asa.scale.set(0.08, 0.02, 0.6); ave.add(corpo, asa); ave.userData.asa = asa; grupo.add(ave); vida.aves.push({ g: ave, ang: n * 1.1, r: 14 + n * 3, alt: 15 + (n % 3) * 2.5, vel: 0.16 + n * 0.015 }); }
    for (let n = 0; n < 7; n++) {
      const nuv = new THREE.Group();
      for (let k = 0; k < 4; k++) { const e = new THREE.Mesh(gEsf, new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false })); e.scale.set(2.4 - k * 0.3, 1.2 - k * 0.1, 1.6); e.position.set(k * 2.0 - 3, (k % 2) * 0.3, (k % 3) * 0.5); nuv.add(e); }
      nuv.position.set(((n * 37) % 120) - 20, 22 + (n % 3) * 4, ((n * 53) % 90) - 15); grupo.add(nuv); vida.nuvens.push({ g: nuv, v: 0.25 + (n % 4) * 0.08 });
    }
    for (const m of decor.extras.moinhos) { const pas = new THREE.Group(); pas.position.set(m.x, m.y, m.z + 0.2); for (let k = 0; k < 4; k++) { const pa = new THREE.Mesh(gCaixa, mat('#f1ede4')); pa.scale.set(0.35, 2.4, 0.05); pa.position.y = 1.2; const eixo = new THREE.Group(); eixo.rotation.z = (k * Math.PI) / 2; eixo.add(pa); pas.add(eixo); } grupo.add(pas); vida.pas.push(pas); }
    for (const an of decor.extras.animais) {
      const g = new THREE.Group();
      const cor = an.tipo === 'vaca' ? (an.seed % 2 ? '#f4f4f4' : '#8a5a3a') : '#f2d34a';
      const corpo = new THREE.Mesh(gCaixa, mat(cor)); const cab = new THREE.Mesh(gCaixa, mat(an.tipo === 'vaca' ? '#6b4a3a' : '#f2a43a'));
      if (an.tipo === 'vaca') { corpo.scale.set(0.5, 0.5, 1.1); corpo.position.y = 0.75; cab.scale.set(0.28, 0.3, 0.3); cab.position.set(0, 0.9, 0.7); for (const [dx, dz] of [[-0.18, -0.4], [0.18, -0.4], [-0.18, 0.4], [0.18, 0.4]]) { const p = new THREE.Mesh(gCaixa, mat('#3a2a22')); p.scale.set(0.1, 0.55, 0.1); p.position.set(dx, 0.28, dz); g.add(p); } if (an.seed % 2) { const mancha = new THREE.Mesh(gCaixa, mat('#2a2a2a')); mancha.scale.set(0.52, 0.2, 0.4); mancha.position.set(0, 0.85, 0.1); g.add(mancha); } }
      else { corpo.scale.set(0.22, 0.18, 0.34); corpo.position.y = 0.22; cab.scale.set(0.12, 0.12, 0.12); cab.position.set(0, 0.36, 0.2); const bico = new THREE.Mesh(gCaixa, mat('#e8782a')); bico.scale.set(0.08, 0.04, 0.08); bico.position.set(0, 0.34, 0.3); g.add(bico); }
      g.add(corpo, cab); g.position.set(an.x, an.tipo === 'pato' ? 0.05 : 0, an.z);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      grupo.add(g); vida.animais.push({ g, an, alvoX: an.x, alvoZ: an.z, t: 0 });
    }
    // reservas de partículas
    const mkPool = (n, geo, cor) => Array.from({ length: n }, () => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.7 })); m.visible = false; grupo.add(m); return m; });
    vida.vapor = mkPool(24, gEsf, 0xffffff); vida.agua = mkPool(40, gCaixa, 0x8fd0ff); vida.fumaca = mkPool(12, gEsf, 0xd9d9d9); vida.jatos = mkPool(30, gEsf, 0xa6e0ff);
    mundo3d = { grupo, W, cfg, rv, paredes, moveis, decor, vida, quad };
    quadranteAtual = quad;
  }

  /* ---------- personagens ---------- */
  function estiloAgente(a, S) {
    const h = hashR(a.id);
    const e = { h, pele: PELES[h % PELES.length], cabelo: CABELOS[(h >> 4) % CABELOS.length], camisa: CAMISAS[(h >> 8) % CAMISAS.length], calca: CALCAS[(h >> 12) % CALCAS.length], escala: 1, estilo: 0, feminino: false, idoso: false, oculos: false, papel: null, vestido: false };
    if (a.k === 'res') {
      const p = achaPessoa(S, a.pid);
      e.feminino = p.sexo === 'F'; e.idade = p.idade;
      e.escala = p.idade < 3 ? 0.5 : p.idade < 13 ? 0.68 : p.idade < 18 ? 0.88 : 1;
      e.idoso = p.idade >= 62; if (e.idoso) e.cabelo = '#d4d4d8';
      e.estilo = e.feminino ? [1, 2, 4, 1][(h >> 16) % 4] : [0, 3, 0, 4][(h >> 16) % 4];
      e.oculos = e.idoso && (h >> 20) % 2 === 0;
      e.vestido = e.feminino && p.idade >= 12 && (h >> 22) % 3 === 0;
    } else {
      e.papel = a.papel; e.feminino = (h >> 3) % 2 === 0; e.estilo = e.feminino ? 2 : 0;
      e.camisa = { medico: '#f8fafc', tecnico: '#3b8be0', enfermeiro: '#2cb6a4', acs: '#18a058' }[a.papel];
      e.calca = { medico: '#3a4a63', tecnico: '#2d6ab3', enfermeiro: '#1f8f81', acs: '#30424f' }[a.papel];
    }
    return e;
  }

  function criarPessoa(a, S) {
    const e = estiloAgente(a, S);
    const raiz = new THREE.Group();
    const quadril = new THREE.Group(); raiz.add(quadril);
    const corpo = new THREE.Group(); corpo.scale.setScalar(e.escala * 0.86); quadril.add(corpo);
    quadril.userData = {};
    const parte = (geo, hex, sx, sy, sz, x, y, z, pai) => { const m = new THREE.Mesh(geo, mat(hex)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; (pai || corpo).add(m); return m; };
    // pelve e tronco
    parte(gCaixa, e.calca, 0.36, 0.18, 0.22, 0, 0.0, 0);
    if (e.vestido) { const saia = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.3, 0.36, 10), mat(e.camisa)); saia.position.y = -0.14; saia.castShadow = true; corpo.add(saia); }
    parte(gCaixa, e.camisa, 0.38, 0.52, 0.23, 0, 0.35, 0);
    if (e.papel === 'medico') parte(gCaixa, '#f8fafc', 0.4, 0.7, 0.25, 0, 0.22, 0);
    if (e.papel === 'acs') { parte(gCaixa, '#f2c230', 0.4, 0.1, 0.25, 0, 0.5, 0); }
    if (e.papel === 'medico' || e.papel === 'enfermeiro') parte(gCaixa, '#3b82c4', 0.04, 0.2, 0.02, 0.06, 0.52, 0.125);
    // cabeça
    const cabeca = new THREE.Group(); cabeca.position.set(0, 0.64, 0); corpo.add(cabeca);
    const hs = 1 + (1 - e.escala) * 0.7;
    cabeca.scale.setScalar(hs);
    parte(gEsf, e.pele, 0.16, 0.17, 0.16, 0, 0.18, 0, cabeca);
    const cab = e.cabelo;
    if (e.estilo === 0 || e.estilo === 3) { parte(gEsf, cab, 0.17, e.estilo === 3 ? 0.09 : 0.11, 0.17, 0, 0.27, -0.015, cabeca); parte(gCaixa, cab, 0.3, 0.1, 0.1, 0, 0.18, -0.1, cabeca); }
    if (e.estilo === 1) { parte(gEsf, cab, 0.18, 0.14, 0.18, 0, 0.26, -0.02, cabeca); parte(gCaixa, cab, 0.34, 0.4, 0.1, 0, 0.05, -0.11, cabeca); }
    if (e.estilo === 2) { parte(gEsf, cab, 0.17, 0.11, 0.17, 0, 0.27, -0.015, cabeca); parte(gEsf, cab, 0.08, 0.08, 0.08, 0, 0.38, -0.08, cabeca); parte(gCaixa, cab, 0.3, 0.12, 0.1, 0, 0.18, -0.1, cabeca); }
    if (e.estilo === 4) for (let n = 0; n < 7; n++) { const ang = (n / 7) * Math.PI * 2; parte(gEsf, cab, 0.075, 0.075, 0.075, Math.cos(ang) * 0.13, 0.28 + (n % 2) * 0.03, Math.sin(ang) * 0.12 - 0.02, cabeca); }
    if (e.papel === 'acs') { parte(gEsf, '#18a058', 0.18, 0.1, 0.18, 0, 0.27, -0.01, cabeca); parte(gCaixa, '#18a058', 0.26, 0.03, 0.14, 0, 0.24, 0.13, cabeca); }
    // rosto
    parte(gEsf, '#1f2937', 0.025, 0.03, 0.02, -0.065, 0.2, 0.15, cabeca); parte(gEsf, '#1f2937', 0.025, 0.03, 0.02, 0.065, 0.2, 0.15, cabeca);
    const boca = parte(gCaixa, '#8a3a3a', 0.06, 0.015, 0.02, 0, 0.1, 0.16, cabeca);
    if (e.oculos) { parte(gCaixa, '#374151', 0.22, 0.02, 0.01, 0, 0.2, 0.165, cabeca); }
    if (e.papel === 'medico' || e.papel === 'enfermeiro' || e.papel === 'tecnico') parte(gCaixa, '#d6ecf3', 0.14, 0.07, 0.02, 0, 0.1, 0.162, cabeca);
    // braços
    const braco = (lado) => {
      const g = new THREE.Group(); g.position.set(lado * 0.26, 0.58, 0); corpo.add(g);
      parte(gCil, e.papel === 'medico' ? '#f8fafc' : e.camisa, 0.06, 0.28, 0.06, 0, -0.14, 0, g);
      const cot = new THREE.Group(); cot.position.y = -0.28; g.add(cot);
      parte(gCil, e.pele, 0.055, 0.26, 0.055, 0, -0.13, 0, cot);
      const mao = parte(gEsf, e.pele, 0.06, 0.06, 0.06, 0, -0.28, 0, cot);
      return { g, cot, mao };
    };
    const bE = braco(-1), bD = braco(1);
    // pernas
    const perna = (lado) => {
      const g = new THREE.Group(); g.position.set(lado * 0.09, -0.06, 0); corpo.add(g);
      parte(gCil, e.vestido ? e.pele : e.calca, 0.078, 0.43, 0.078, 0, -0.215, 0, g);
      const jo = new THREE.Group(); jo.position.y = -0.43; g.add(jo);
      parte(gCil, e.vestido ? e.pele : e.calca, 0.066, 0.43, 0.066, 0, -0.215, 0, jo);
      parte(gCaixa, '#2b2b33', 0.11, 0.07, 0.24, 0, -0.45, 0.05, jo);
      return { g, jo };
    };
    const pE = perna(-1), pD = perna(1);
    // acessórios (aparecem conforme a ação)
    const livro = parte(gCaixa, '#c0392b', 0.2, 0.03, 0.26, 0, -0.3, 0.05, bD.cot); livro.visible = false;
    const enxada = new THREE.Group(); parte(gCil, '#8a6a3a', 0.02, 1.3, 0.02, 0, -0.1, 0.1, enxada); parte(gCaixa, '#7a808a', 0.22, 0.03, 0.12, 0, -0.75, 0.1, enxada); enxada.position.y = -0.28; enxada.visible = false; bD.cot.add(enxada);
    const cigarro = parte(gCaixa, '#ffffff', 0.015, 0.015, 0.08, 0, -0.28, 0.06, bD.cot); cigarro.visible = false;
    // cadeira dinâmica (aparece quando a pessoa senta numa cadeira comum)
    const cadeira = new THREE.Group();
    const peca = (hex, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(gCaixa, mat(hex)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; cadeira.add(m); };
    peca('#8a6a46', 0.46, 0.05, 0.46, 0, 0.44, 0); peca('#7b5a3a', 0.46, 0.42, 0.05, 0, 0.68, -0.22);
    for (const [dx, dz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) peca('#6b4a2a', 0.05, 0.42, 0.05, dx, 0.21, dz);
    cadeira.visible = false;
    cena.add(cadeira);
    cena.add(raiz);
    raiz.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // volume de seleção
    const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    pick.position.y = 1; pick.userData.agente = a.id; raiz.add(pick); hitAgentes.push(pick);
    const sombra = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    sombra.rotation.x = -Math.PI / 2; sombra.position.y = 0.02; raiz.add(sombra);
    const j = { y: 0.98, hx: 0, cx: 0, aEx: 0, aEz: 0.08, eEx: 0, aDx: 0, aDz: -0.08, eDx: 0, lEx: 0, kEx: 0, lDx: 0, kDx: 0, rotX: 0 };
    return { raiz, quadril, corpo, cabeca, boca, bE, bD, pE, pD, livro, enxada, cigarro, cadeira, pick, sombra, e, j, pos: new THREE.Vector3(), yaw: 0, fase: (hashR(a.id) % 600) / 100, ult: null, dir: new THREE.Vector2(0, 1) };
  }

  /** Poses: ângulos-alvo das juntas (o desenho suaviza a transição). */
  function alvoPose(pose, t, fase) {
    const b = { y: 0.98, hx: 0, cx: 0, aEx: 0.0, aEz: 0.08, eEx: 0, aDx: 0.0, aDz: -0.08, eDx: 0, lEx: 0, kEx: 0, lDx: 0, kDx: 0, rotX: 0, prop: null, boca: 1 };
    const s = Math.sin(fase), c = Math.cos(fase);
    switch (pose) {
      case 'andar': return { ...b, y: 0.98 + Math.abs(c) * 0.035, lEx: s * 0.75, kEx: Math.max(0, -s) * 0.95, lDx: -s * 0.75, kDx: Math.max(0, s) * 0.95, aEx: -s * 0.6, eEx: -0.25, aDx: s * 0.6, eDx: -0.25 };
      case 'sentar': return { ...b, y: 0.54, lEx: -1.52, kEx: 1.5, lDx: -1.52, kDx: 1.5, aEx: -0.35, eEx: -0.5, aDx: -0.35, eDx: -0.5, cx: 0.05 };
      case 'ler': return { ...b, y: 0.54, lEx: -1.52, kEx: 1.5, lDx: -1.52, kDx: 1.5, aEx: -0.9, eEx: -1.35, aDx: -0.9, eDx: -1.35, cx: 0.32, prop: 'livro' };
      case 'deitar': return { ...b, y: 0.32, rotX: -Math.PI / 2, lEx: 0, kEx: 0, lDx: 0, kDx: 0, aEx: 0, aEz: 0.15, aDx: 0, aDz: -0.15, cx: 0 };
      case 'comer': return { ...b, y: 0.54, lEx: -1.52, kEx: 1.5, lDx: -1.52, kDx: 1.5, aEx: -0.5, eEx: -0.9, aDx: -0.7 - (Math.sin(t / 420) + 1) * 0.35, eDx: -1.2 - (Math.sin(t / 420) + 1) * 0.4, cx: 0.1, boca: 1.6 };
      case 'comer_de_pe': return { ...b, aEx: -0.5, eEx: -0.9, aDx: -0.7 - (Math.sin(t / 420) + 1) * 0.35, eDx: -1.2 - (Math.sin(t / 420) + 1) * 0.4, cx: 0.1, boca: 1.6 };
      case 'cozinhar': return { ...b, aEx: -0.9, eEx: -0.6, aDx: -0.95 + Math.sin(t / 150) * 0.12, eDx: -0.7 + Math.cos(t / 150) * 0.2, cx: 0.18 };
      case 'digitar': return { ...b, y: 0.54, lEx: -1.52, kEx: 1.5, lDx: -1.52, kDx: 1.5, aEx: -1.0 + Math.sin(t / 120) * 0.05, eEx: -0.9, aDx: -1.0 - Math.sin(t / 120) * 0.05, eDx: -0.9, cx: 0.28 };
      case 'exercitar': { const q = (Math.sin(t / 280) + 1) / 2; return { ...b, aEx: -2.5 + q * 1.8, aEz: 0.25, eEx: -0.3 - q * 0.9, aDx: -0.7 - q * 1.8, aDz: -0.25, eDx: -1.2 + q * 0.9, lEx: -0.1, lDx: -0.1, y: 0.95 + q * 0.03 }; }
      case 'enxada': { const q = (Math.sin(t / 420) + 1) / 2; return { ...b, aEx: -1.3 - q * 1.2, eEx: -0.5, aDx: -1.3 - q * 1.2, eDx: -0.5, cx: 0.1 + q * 0.3, hx: 0.15 + q * 0.2, prop: 'enxada' }; }
      case 'fumar': { const q = (Math.sin(t / 1200) + 1) / 2; return { ...b, aDx: -0.8 - q * 1.3, eDx: -1.5 - q * 0.3, aEx: -0.1, prop: 'cigarro' }; }
      case 'falar': return { ...b, aDx: -0.8 + Math.sin(t / 260) * 0.35, eDx: -0.8, aEx: -0.1, cx: Math.sin(t / 700) * 0.08, boca: 1.5 + Math.sin(t / 180) * 0.3 };
      case 'banho': return { ...b, aEx: -2.6, eEx: -1.3, aDx: -2.6, eDx: -1.3, cx: -0.1 };
      default: return { ...b, y: 0.98 + Math.sin(t / 700) * 0.004, aEx: Math.sin(t / 900) * 0.04, aDx: -Math.sin(t / 900) * 0.04 };
    }
  }

  const yawDe = (dx, dz) => Math.atan2(dx, dz);
  const lerpAng = (a, b, k) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; };

  /** Decide a pose e a posição de uma pessoa a partir do que ela realmente faz. */
  function situacao(W, rv, a) {
    let pose = a.path.length ? 'andar' : 'parado';
    const base = new THREE.Vector3(a.x + 0.5, alturaPiso(W, rv, Math.round(a.x), Math.round(a.y)), a.y + 0.5);
    const r = { pose, pos: base, yaw: null, cadeira: false, extraY: 0 };
    const virarPara = (ox, oy) => { r.yaw = yawDe(ox - a.x, oy - a.y); };
    if (a.k === 'res' && a.espera && !a.path.length && !a.atend && a.cadeira) {
      const h = a.cadeira; r.pose = 'sentar'; r.pos = new THREE.Vector3(h.x + 0.5, alturaPiso(W, rv, h.x, h.y), h.y + 0.55); r.yaw = 0; r.extraY = -0.05;
    } else if (a.acao && !a.path.length && ACOES_INFO[a.acao.k]) {
      const info = ACOES_INFO[a.acao.k], o = a.acao.obj;
      r.pose = info.pose;
      if (info.onde === 'objeto' && o) {
        const y0 = alturaPiso(W, rv, o.x, o.y);
        r.pos = new THREE.Vector3(o.x + 0.5, y0, o.y + 0.5);
        if (r.pose === 'deitar') { const outros = W.agentes.filter((x) => x !== a && x.vis && x.acao && x.acao.obj === o && x.id < a.id).length; r.yaw = Math.PI; r.pos.y = y0 + 0.5; r.pos.z += outros ? 0.0 : 0; if (outros) r.pos.x += 0.0; }
        else if (a.acao.k === 'tv') { r.yaw = Math.PI; r.pos.z += 0.12; r.extraY = -0.1; }
        else if (a.acao.k === 'ler') { r.yaw = Math.PI / 2; r.extraY = -0.08; }
        else if (a.acao.k === 'praca') { r.yaw = 0; r.pos.z += 0.05; r.extraY = -0.08; }
        else if (a.acao.k === 'banho') { r.yaw = 0; }
      } else if (info.onde === 'frente' && o) {
        virarPara(o.x, o.y);
        if (a.acao.k === 'comer_mesa') { r.pose = 'comer'; r.cadeira = true; }
        else if (info.cadeira) r.cadeira = true;
        else if (a.acao.k === 'lanche' || a.acao.k === 'remedio') r.pose = 'comer_de_pe';
      }
    }
    if (a.k === 'staff' && !a.path.length && !a.tarefa && a.afz && a.afz.reuniao && a.afz.fase === 'presente' && a.afz.seat) {
      const c = a.afz.seat;
      let mesa = null, melhor = 99;
      for (const t of W.porTipo.M || []) { const dd = Math.abs(t.x - c.x) + Math.abs(t.y - c.y); if (dd < melhor) { melhor = dd; mesa = t; } }
      r.pose = 'sentar'; r.pos = new THREE.Vector3(c.x + 0.5, alturaPiso(W, rv, c.x, c.y), c.y + 0.5); r.extraY = -0.05;
      if (mesa) r.yaw = yawDe(mesa.x - c.x, mesa.y - c.y);
    } else if (a.k === 'staff' && !a.path.length && a.tarefa && a.tarefa.fase === 'atendendo') r.pose = 'digitar';
    if (a.k === 'staff' && !a.path.length && !a.tarefa && a.afz && a.afz.fase === 'fazendo' && !a.afz.def.campo) r.pose = 'digitar';
    return r;
  }

  function atualizaPessoa(W, S, rv, a, dt, agora) {
    let p3 = agentes3d.get(a.id);
    if (!p3) { p3 = criarPessoa(a, S); agentes3d.set(a.id, p3); p3.pos.set(a.x + 0.5, 0, a.y + 0.5); }
    const R3 = p3;
    p3.raiz.visible = a.vis;
    p3.pick.visible = a.vis;
    if (!a.vis) { p3.cadeira.visible = false; return; }
    const sit = situacao(W, rv, a);
    const movendo = a.path.length > 0;
    const k = movendo ? 1 : 1 - Math.exp(-dt * 9);
    // posição suavizada
    const alvo = sit.pos;
    R3.pos.x += (alvo.x - R3.pos.x) * k; R3.pos.z += (alvo.z - R3.pos.z) * k; R3.pos.y += (alvo.y - R3.pos.y) * (1 - Math.exp(-dt * 10));
    // direção
    const ult = R3.ult || { x: a.x, y: a.y };
    const dx = a.x - ult.x, dz = a.y - ult.y, dist = Math.hypot(dx, dz);
    if (dist > 1e-4) { R3.fase += dist * 5.2; R3.dir.set(dx, dz); }
    R3.ult = { x: a.x, y: a.y };
    const yawAlvo = sit.yaw !== null && !movendo ? sit.yaw : (R3.dir.lengthSq() > 0 ? yawDe(R3.dir.x, R3.dir.y) : R3.yaw);
    R3.yaw = lerpAng(R3.yaw, yawAlvo, 1 - Math.exp(-dt * 10));
    R3.raiz.position.set(R3.pos.x, R3.pos.y, R3.pos.z);
    R3.raiz.rotation.y = R3.yaw;
    // juntas
    const T = alvoPose(sit.pose, agora, R3.fase);
    const jj = R3.j, kk = 1 - Math.exp(-dt * 14);
    for (const ch of ['y', 'hx', 'cx', 'aEx', 'aEz', 'eEx', 'aDx', 'aDz', 'eDx', 'lEx', 'kEx', 'lDx', 'kDx', 'rotX']) jj[ch] += (T[ch] - jj[ch]) * kk;
    const escala = R3.e.escala * 0.86;
    R3.quadril.position.y = jj.y * escala + sit.extraY;
    R3.quadril.rotation.x = jj.rotX;
    R3.corpo.rotation.x = jj.hx;
    R3.cabeca.rotation.x = jj.cx * 0.5;
    R3.boca.scale.set(0.06 * (T.boca || 1), 0.015 * (T.boca > 1.2 ? 2.2 : 1), 0.02);
    R3.bE.g.rotation.set(jj.aEx, 0, jj.aEz); R3.bE.cot.rotation.x = jj.eEx;
    R3.bD.g.rotation.set(jj.aDx, 0, jj.aDz); R3.bD.cot.rotation.x = jj.eDx;
    R3.pE.g.rotation.x = jj.lEx; R3.pE.jo.rotation.x = jj.kEx;
    R3.pD.g.rotation.x = jj.lDx; R3.pD.jo.rotation.x = jj.kDx;
    R3.livro.visible = T.prop === 'livro'; R3.enxada.visible = T.prop === 'enxada'; R3.cigarro.visible = T.prop === 'cigarro';
    // cadeira dinâmica
    R3.cadeira.visible = sit.cadeira;
    if (sit.cadeira) { R3.cadeira.position.set(a.x + 0.5, alturaPiso(W, rv, Math.round(a.x), Math.round(a.y)), a.y + 0.5); R3.cadeira.rotation.y = R3.yaw + Math.PI; R3.pos.x += (a.x + 0.5 - R3.pos.x) * 0.0; }
    R3.sombra.visible = sit.pose !== 'deitar';
    R3.sombra.position.y = 0.03;
    R3.situacao = sit;
  }

  /* ---------- efeitos e vida ---------- */
  function efeitosVida(W, S, dt, agora, noiteF) {
    const { vida, moveis, decor } = mundo3d;
    // televisores
    for (const tv of moveis.efeitos.tvs) {
      const ligada = W.agentes.some((a) => a.vis && a.acao && a.acao.k === 'tv' && a.acao.obj && a.acao.obj.casa === tv.casa);
      tv.tela.material.color.setHex(ligada ? [0x6fc3ff, 0x8fd5ff, 0x5aa9e6][Math.floor(agora / 180) % 3] : 0x1b2230);
    }
    // vapor dos fogões
    let iv = 0;
    for (const f of moveis.efeitos.fogoes) {
      const usando = W.agentes.some((a) => a.vis && a.acao && a.acao.k === 'cozinhar' && a.acao.obj === f.o);
      if (!usando) continue;
      for (let n = 0; n < 3 && iv < vida.vapor.length; n++, iv++) { const q = ((agora / 1400) + n / 3) % 1; const m = vida.vapor[iv]; m.visible = true; m.position.set(f.x + Math.sin(q * 6 + n) * 0.06, f.y + q * 0.9, f.z); m.scale.setScalar(0.06 + q * 0.1); m.material.opacity = 0.55 * (1 - q); }
    }
    for (let n = iv; n < vida.vapor.length; n++) vida.vapor[n].visible = false;
    // água do chuveiro
    let ia = 0;
    for (const c of moveis.efeitos.chuveiros) {
      const usando = W.agentes.some((a) => a.vis && a.acao && a.acao.k === 'banho' && a.acao.obj === c.o);
      if (!usando) continue;
      for (let n = 0; n < 8 && ia < vida.agua.length; n++, ia++) { const q = ((agora / 600) + n / 8) % 1; const m = vida.agua[ia]; m.visible = true; m.scale.set(0.015, 0.1, 0.015); m.position.set(c.x - 0.1 + (n % 4) * 0.07, c.y - q * 1.9, c.z + (n > 3 ? 0.08 : 0)); }
    }
    for (let n = ia; n < vida.agua.length; n++) vida.agua[n].visible = false;
    // fumaça
    let ifum = 0;
    for (const a of W.agentes) {
      const p3 = agentes3d.get(a.id);
      if (!p3 || !a.vis || !p3.situacao || p3.situacao.pose !== 'fumar') continue;
      for (let n = 0; n < 3 && ifum < vida.fumaca.length; n++, ifum++) { const q = ((agora / 1500) + n / 3) % 1; const m = vida.fumaca[ifum]; m.visible = true; m.position.set(p3.pos.x + 0.15 + Math.sin(q * 7 + n) * 0.08, p3.pos.y + 1.5 + q * 0.8, p3.pos.z + 0.15); m.scale.setScalar(0.05 + q * 0.12); m.material.opacity = 0.5 * (1 - q); }
    }
    for (let n = ifum; n < vida.fumaca.length; n++) vida.fumaca[n].visible = false;
    // jatos das fontes
    let ij = 0;
    for (const f of moveis.efeitos.fontes) for (let n = 0; n < 10 && ij < vida.jatos.length; n++, ij++) {
      const q = ((agora / 1100) + n / 10) % 1, ang = (n / 10) * Math.PI * 2;
      const m = vida.jatos[ij]; m.visible = true; const raio = Math.sin(q * Math.PI) * 0.55;
      m.position.set(f.x + Math.cos(ang) * raio, f.y - 0.1 + Math.sin(q * Math.PI) * 0.6, f.z + Math.sin(ang) * raio); m.scale.setScalar(0.05);
    }
    for (let n = ij; n < vida.jatos.length; n++) vida.jatos[n].visible = false;
    // aves, nuvens, moinhos, animais
    const alvoAves = new THREE.Vector3(W.w / 2, 0, W.h / 2);
    for (const av of vida.aves) { av.ang += av.vel * dt; av.g.position.set(alvoAves.x + Math.cos(av.ang) * av.r * 1.5, av.alt, alvoAves.z + Math.sin(av.ang) * av.r); av.g.rotation.y = -av.ang; av.g.userData.asa.rotation.z = Math.sin(agora / 90 + av.ang * 3) * 0.6; av.g.visible = noiteF < 0.8; }
    for (const n of vida.nuvens) { n.g.position.x += n.v * dt; if (n.g.position.x > W.w + 50) n.g.position.x = -40; n.g.visible = true; }
    for (const p of vida.pas) p.rotation.z -= dt * 0.9;
    for (const an of vida.animais) {
      an.t -= dt;
      const dx = an.alvoX - an.g.position.x, dz = an.alvoZ - an.g.position.z, dist = Math.hypot(dx, dz);
      if (an.t <= 0 || dist < 0.1) { an.alvoX = lim(an.an.area[0] + Math.random() * (an.an.area[2] - an.an.area[0]), an.an.area[0], an.an.area[2]); an.alvoZ = lim(an.an.area[1] + Math.random() * (an.an.area[3] - an.an.area[1]), an.an.area[1], an.an.area[3]); an.t = 3 + Math.random() * 6; }
      else { const v = (an.an.tipo === 'vaca' ? 0.25 : 0.35) * dt; an.g.position.x += (dx / dist) * Math.min(v, dist); an.g.position.z += (dz / dist) * Math.min(v, dist); an.g.rotation.y = lerpAng(an.g.rotation.y, yawDe(dx, dz), 0.1); an.g.position.y = an.an.tipo === 'pato' ? 0.05 + Math.abs(Math.sin(agora / 250)) * 0.02 : 0; }
    }
    // postes de luz
    for (const l of decor.lampadas) l.material.color.setHex(noiteF > 0.3 ? 0xffe9a8 : 0xd8d8cf);
  }

  /* ---------- luz e céu conforme a hora ---------- */
  function atualizaCeuELuz(S, W, cfg, agora) {
    const h = minutoDoDia(S) / 60;
    const dia = suave(5.2, 7.5, h) * (1 - suave(17.8, 20.2, h));
    const quente = suave(5.0, 6.5, h) * (1 - suave(6.5, 8.0, h)) + suave(16.8, 18.3, h) * (1 - suave(18.3, 20.0, h));
    const noite = 1 - dia;
    const corCeuTopo = mistura(mistura('#5aa6e0', '#e6955a', quente * 0.6), '#0b1740', noite);
    const corCeuHor = mistura(mistura('#cfe8f7', '#ffcf9a', quente * 0.85), '#2a3a70', noite);
    const pos = domo.geometry.attributes.position, cor = domo.geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 320, t = lim(y * 1.4 + 0.1, 0, 1);
      cor.setXYZ(i, mixn(corCeuHor[0], corCeuTopo[0], t), mixn(corCeuHor[1], corCeuTopo[1], t), mixn(corCeuHor[2], corCeuTopo[2], t));
    }
    cor.needsUpdate = true;
    cena.fog.color.setRGB(corCeuHor[0], corCeuHor[1], corCeuHor[2]);
    mar.material.color.setRGB(mixn(0.2, 0.05, noite), mixn(0.5, 0.12, noite), mixn(0.68, 0.25, noite));
    // luz principal: sol de dia, lua à noite
    const ang = ((h - 6) / 12) * Math.PI;
    const diurno = h >= 6 && h <= 18;
    const alt = diurno ? Math.sin(ang) : 0.55;
    const az = diurno ? Math.cos(ang) : 0.25;
    sol.color.setRGB(...mistura(mistura('#fff2d8', '#ffb067', quente), '#a7bcff', noite));
    sol.intensity = 0.34 + dia * 0.4;
    hemi.intensity = 0.56 - dia * 0.06;
    hemi.color.setRGB(...mistura('#cfe8ff', '#6f8bd6', noite)); hemi.groundColor.setRGB(...mistura('#7a8f6a', '#35405c', noite));
    const alvo = orbita.alvo;
    sol.position.set(alvo.x + az * -18 - 6, 14 + Math.max(0.35, alt) * 26, alvo.z + 10);
    sol.target.position.copy(alvo);
    // astro no céu
    astro.position.set(alvo.x + az * -150, 40 + Math.max(0.15, alt) * 150, alvo.z - 150);
    astro.material.color.setHex(diurno ? 0xfff4c2 : 0xdfe8ff);
    astro.scale.setScalar(diurno ? 1 : 0.7);
    // luzes pontuais nos prédios acesos mais próximos do alvo
    const acesos = [];
    for (const l of W.lugares) {
      const aberta = l.modelo === 'ubs' && ubsAberta(W, S, cfg);
      const gente = W.agentes.some((a) => a.vis && a.x >= l.x && a.x < l.x + l.w && a.y >= l.y && a.y < l.y + l.h && !(a.acao && a.acao.k === 'dormir'));
      if (gente || aberta) acesos.push(l);
    }
    const prox = acesos.map((l) => ({ l, d: Math.hypot(l.x + l.w / 2 - alvo.x, l.y + l.h / 2 - alvo.z) })).sort((a, b) => a.d - b.d).slice(0, lamposLuz.length);
    lamposLuz.forEach((pl, n) => { const q = prox[n]; if (q && noite > 0.25) { pl.position.set(q.l.x + q.l.w / 2, 2.2, q.l.y + q.l.h / 2); pl.intensity = 1.1 * noite; pl.distance = Math.max(q.l.w, q.l.h) * 0.9; } else pl.intensity = 0; });
    // vidraças acesas
    if (mundo3d) for (const v of mundo3d.paredes.vidros) {
      const l = W.lugares[v.userData.lugar];
      const acesa = acesos.includes(l) && noite > 0.25;
      v.material.emissive.setRGB(acesa ? 0.95 : 0, acesa ? 0.78 : 0, acesa ? 0.4 : 0);
      v.material.opacity = acesa ? 0.9 : 0.55;
    }
    return noite;
  }

  /* ---------- câmera ---------- */
  function limitaAlvo(W) { orbita.alvo.x = lim(orbita.alvo.x, 1, W.w - 1); orbita.alvo.z = lim(orbita.alvo.z, 1, W.h - 1); }
  function aplicaCamera() {
    const d = orbita.dist, cp = Math.cos(orbita.pitch), sp = Math.sin(orbita.pitch);
    camera.position.set(orbita.alvo.x + d * cp * Math.sin(orbita.yaw), orbita.alvo.y + d * sp, orbita.alvo.z + d * cp * Math.cos(orbita.yaw));
    camera.lookAt(orbita.alvo);
  }
  const distDeZoom = (z) => lim(26 / z, 7, 85);
  function centralizar(tx, ty, z) { orbita.alvo.set(tx + 0.5, 0, ty + 0.5); if (z) { cam.z = z; orbita.dist = distDeZoom(z); } }
  function enquadrarUBS() { const { W } = E(); if (!W) return; cam.z = 1; orbita.dist = 24; orbita.yaw = Math.PI / 4; orbita.alvo.set(W.ubs.x + W.ubs.w / 2, 0, W.ubs.y + W.ubs.h / 2); }
  function seguirAlvo(tx, ty, k = 0.12) { orbita.alvo.x += (tx + 0.5 - orbita.alvo.x) * k; orbita.alvo.z += (ty + 0.5 - orbita.alvo.z) * k; }
  function girar(passo) { orbita.yaw += passo * (Math.PI / 2); }
  /** Move a câmera em relação à tela: dx para a direita, dy para frente (em tiles). */
  function mover(dx, dy) {
    const fx = -Math.sin(orbita.yaw), fz = -Math.cos(orbita.yaw); // frente (para onde a câmera olha, no chão)
    const rx = Math.cos(orbita.yaw), rz = -Math.sin(orbita.yaw);
    orbita.alvo.x += fx * dy + rx * dx; orbita.alvo.z += fz * dy + rz * dx;
    const { W } = E(); if (W) limitaAlvo(W);
  }

  /* ---------- sobreposição: balões, nome, rótulos ---------- */
  const proj = new THREE.Vector3();
  function paraTela(tx, ty, alt = 0) { proj.set(tx + 0.5, alt, ty + 0.5).project(camera); return [(proj.x * 0.5 + 0.5) * largura, (-proj.y * 0.5 + 0.5) * altura, proj.z]; }
  function atualizaOverlays(S, W, cfg, agora) {
    const vistos = new Set();
    for (const a of W.agentes) {
      const p3 = agentes3d.get(a.id);
      if (!p3 || !a.vis) continue;
      const b = bolhaDe(W, S, a);
      const sel = selecionado === a.id;
      if (!b) continue;
      proj.set(p3.pos.x, p3.pos.y + (p3.situacao && p3.situacao.pose === 'deitar' ? 1.0 : 2.0) * Math.max(0.7, p3.e.escala), p3.pos.z).project(camera);
      if (proj.z > 1) continue;
      let el = bolhasDom.get(a.id);
      if (!el) { el = document.createElement('div'); el.className = 'bolha3d'; ov.appendChild(el); bolhasDom.set(a.id, el); }
      if (el.textContent !== b) el.textContent = b;
      el.style.transform = `translate(-50%,-100%) translate(${(proj.x * 0.5 + 0.5) * largura + (sel ? 22 : 0)}px,${(-proj.y * 0.5 + 0.5) * altura - (sel ? 24 : 4)}px)`;
      el.classList.toggle('grande', sel);
      el.style.display = '';
      vistos.add(a.id);
    }
    for (const [id, el] of bolhasDom) if (!vistos.has(id)) el.style.display = 'none';
    // nome do personagem selecionado
    const a = selecionado && W.agentes.find((x) => x.id === selecionado);
    const p3 = a && agentes3d.get(a.id);
    if (a && p3 && a.vis) {
      if (!nomeDom) { nomeDom = document.createElement('div'); nomeDom.className = 'nome3d'; ov.appendChild(nomeDom); }
      const nome = a.k === 'res' ? achaPessoa(S, a.pid).nome : { medico: 'Médico(a)', tecnico: 'Técnico(a)', enfermeiro: 'Enfermeiro(a)', acs: 'Agente comunitário' }[a.papel];
      if (nomeDom.textContent !== nome) nomeDom.textContent = nome;
      proj.set(p3.pos.x, p3.pos.y + 2.9 * Math.max(0.75, p3.e.escala), p3.pos.z).project(camera);
      nomeDom.style.display = '';
      nomeDom.style.transform = `translate(-50%,-100%) translate(${(proj.x * 0.5 + 0.5) * largura}px,${(-proj.y * 0.5 + 0.5) * altura - 6}px)`;
      prumbob.visible = true;
      prumbob.position.set(p3.pos.x, p3.pos.y + 2.4 * Math.max(0.75, p3.e.escala) + Math.sin(agora / 380) * 0.06, p3.pos.z);
      prumbob.rotation.y = agora / 600;
    } else { if (nomeDom) nomeDom.style.display = 'none'; prumbob.visible = false; }
    // rótulos dos lugares
    if (!rotulosDom.length) {
      for (const l of W.lugares) {
        let nome = null;
        if (l.casa) nome = S.familias.find((f) => f.id === l.casa).nome.replace('Família ', '').replace('Casal ', '');
        else if (l.modelo === 'ubs') nome = `✚ ${cfg.territorio.nomeUnidade}`;
        else if (l.modelo === 'escola') nome = 'Escola';
        else if (l.modelo === 'trabalho') nome = cfg.cenario.id === 'metropole' ? 'Escritórios' : 'Comércio';
        else if (l.modelo === 'lanche') nome = 'Lanchonete';
        if (!nome) continue;
        const el = document.createElement('div'); el.className = `rotulo3d${l.modelo === 'ubs' ? ' ubs' : ''}`; el.textContent = nome; ov.appendChild(el);
        rotulosDom.push({ el, l });
      }
    }
    const perto = orbita.dist < 46;
    for (const r of rotulosDom) {
      if (!perto) { r.el.style.display = 'none'; continue; }
      proj.set(r.l.x + r.l.w / 2, 3.4, r.l.y + r.l.h / 2).project(camera);
      if (proj.z > 1) { r.el.style.display = 'none'; continue; }
      r.el.style.display = '';
      r.el.style.transform = `translate(-50%,-100%) translate(${(proj.x * 0.5 + 0.5) * largura}px,${(-proj.y * 0.5 + 0.5) * altura}px)`;
    }
    // destino marcado
    if (marcador) { marcadorMesh.visible = true; marcadorMesh.position.set(marcador.x + 0.5, 0.16, marcador.y + 0.5); const s = 1 + Math.sin(agora / 220) * 0.12; marcadorMesh.scale.set(s, s, s); } else marcadorMesh.visible = false;
  }

  /* ---------- quadro ---------- */
  let ultimoAgora = 0;
  function desenha(agora) {
    const { S, W, cfg } = E();
    if (!S || !W) return;
    if (canvas.clientWidth !== largura || canvas.clientHeight !== altura) redimensiona();
    const dt = Math.min(0.1, (agora - (ultimoAgora || agora)) / 1000);
    ultimoAgora = agora;
    const yawN = ((orbita.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const quad = Math.floor(yawN / (Math.PI / 2)) % 4;
    if (!mundo3d || mundo3d.W !== W) { agentes3d.forEach((p) => { cena.remove(p.raiz); cena.remove(p.cadeira); }); agentes3d.clear(); hitAgentes.length = 0; rotulosDom.splice(0).forEach((r) => r.el.remove()); bolhasDom.forEach((el) => el.remove()); bolhasDom.clear(); montarMundo(W, S, cfg, quad); }
    else if (quad !== quadranteAtual) { montarMundo(W, S, cfg, quad); }
    const rv = mundo3d.rv;
    limitaAlvo(W);
    aplicaCamera();
    const noiteF = atualizaCeuELuz(S, W, cfg, agora);
    domo.position.copy(camera.position); astro.position.add(new THREE.Vector3(0, 0, 0));
    for (const a of W.agentes) atualizaPessoa(W, S, rv, a, dt, agora);
    efeitosVida(W, S, dt, agora, noiteF);
    atualizaOverlays(S, W, cfg, agora);
    renderer.render(cena, camera);
  }

  /* ---------- entrada: arrastar, pinça, giro, toques ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ponto = new THREE.Vector3();
  function pontoNoChao(px, py) { ndc.set((px / largura) * 2 - 1, -(py / altura) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.ray.intersectPlane(plano, ponto) ? ponto.clone() : null; }

  function alvoEm(px, py) {
    const { W } = E();
    ndc.set((px / largura) * 2 - 1, -(py / altura) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hs = ray.intersectObjects(hitAgentes.filter((m) => m.visible), false);
    if (hs.length) return { tipo: 'agente', id: hs[0].object.userData.agente };
    const hm = ray.intersectObjects(hitMoveis, false);
    let pm = hm.length ? hm[0] : null;
    const hw = mundo3d ? ray.intersectObject(mundo3d.paredes.malha, false) : [];
    if (pm && hw.length && hw[0].distance < pm.distance - 0.05) pm = null;
    if (pm) { const o = pm.object.userData.obj; if (o.t !== 'T') return { tipo: 'obj', obj: o }; }
    const p = hw.length ? hw[0].point : pontoNoChao(px, py);
    if (!p) return null;
    const ti = Math.floor(p.x), tj = Math.floor(p.z);
    if (ti < 0 || tj < 0 || ti >= W.w || tj >= W.h) return null;
    const rv = preparaMapa(W), ln = rv.lugarDe[tj * W.w + ti], c = W.terr[tj * W.w + ti];
    return { tipo: 'chao', x: ti, y: tj, casa: ln >= 0 ? W.lugares[ln].casa : null, lugar: ln >= 0 ? W.lugares[ln].modelo : null, rua: c === '.' || c === 'c' };
  }

  const ponteiros = new Map();
  let arraste = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    ponteiros.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    arraste = { moveu: false, x0: e.offsetX, y0: e.offsetY, dist0: null, ang0: null, dist: orbita.dist, yaw: orbita.yaw };
    if (ponteiros.size === 2) { const [p, q] = [...ponteiros.values()]; arraste.dist0 = Math.hypot(p.x - q.x, p.y - q.y); arraste.ang0 = Math.atan2(q.y - p.y, q.x - p.x); arraste.moveu = true; if (hooks.aoArrastar) hooks.aoArrastar(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ponteiros.has(e.pointerId)) return;
    const ant = ponteiros.get(e.pointerId);
    ponteiros.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    const { W } = E();
    if (ponteiros.size === 2 && arraste && arraste.dist0) {
      const [p, q] = [...ponteiros.values()];
      const d = Math.hypot(p.x - q.x, p.y - q.y), ang = Math.atan2(q.y - p.y, q.x - p.x);
      orbita.dist = lim(arraste.dist * (arraste.dist0 / Math.max(10, d)), 7, 85);
      cam.z = 26 / orbita.dist;
      orbita.yaw = arraste.yaw - (ang - arraste.ang0);
    } else if (ponteiros.size === 1 && arraste) {
      if (!arraste.moveu && Math.hypot(e.offsetX - arraste.x0, e.offsetY - arraste.y0) > 7) { arraste.moveu = true; if (hooks.aoArrastar) hooks.aoArrastar(); }
      if (arraste.moveu) {
        const a = pontoNoChao(ant.x, ant.y), b = pontoNoChao(e.offsetX, e.offsetY);
        if (a && b) { orbita.alvo.x += a.x - b.x; orbita.alvo.z += a.z - b.z; if (W) limitaAlvo(W); }
      }
    }
  });
  const soltar = (e) => {
    const tinha = ponteiros.has(e.pointerId);
    ponteiros.delete(e.pointerId);
    if (tinha && arraste && !arraste.moveu && ponteiros.size === 0 && e.type === 'pointerup') hooks.aoTocar(alvoEm(e.offsetX, e.offsetY));
    if (ponteiros.size === 0) arraste = null;
  };
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', soltar);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbita.dist = lim(orbita.dist * (e.deltaY < 0 ? 0.9 : 1.1), 7, 85); cam.z = 26 / orbita.dist; }, { passive: false });
  window.addEventListener('resize', redimensiona);
  redimensiona();

  return {
    desenha, redimensiona, enquadrarUBS, centralizar, cam, seguirAlvo, girar, paraTela,
    selecionar(id) { selecionado = id; },
    marcar(x, y) { marcador = x === null ? null : { x, y }; },
    alternaParedes() { paredesBaixas = !paredesBaixas; quadranteAtual = -1; return paredesBaixas; },
    zoom(f) { orbita.dist = lim(orbita.dist / f, 7, 85); cam.z = 26 / orbita.dist; },
    mover,
    estadoVisual(id) { const p = agentes3d.get(id); return p ? { x: p.pos.x, z: p.pos.z, y: p.pos.y, pose: p.situacao && p.situacao.pose, yaw: p.yaw } : null; },
    girar2: null,
    modo: '3d',
    get selecionado() { return selecionado; },
  };
}
