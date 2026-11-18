// Desenho do mundo em canvas 2D: mapa, personagens animados, balões, ciclo dia/noite e câmera por toque.
import { achaPessoa, achaFamilia } from './engine.js';
import { minutoDoDia, bolhaDe } from './mundo.js';

const T = 32; // tamanho do tile em pixels "do mundo"
const FONTE_EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const PELES = ['#f5cfa0', '#e8b98a', '#c68d5d', '#a56b43', '#7a4a2b'];
const CABELOS = ['#2b1d12', '#4a2f1b', '#8a5a2b', '#1c1c1c', '#c9a227'];
const CAMISAS = ['#e06c75', '#e5a54b', '#61afef', '#98c379', '#c678dd', '#56b6c2', '#d19a66', '#f28fad'];

const hashR = (t) => { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return h; };
const ajusta = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
};

export function criarRenderer(canvas, getEstado, hooks) {
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, z: 1 };
  let largura = 300, altura = 300, dpr = 1;
  let selecionado = null;
  const ponteiros = new Map();
  let arraste = null;

  const E = () => getEstado(); // { S, W, cfg }

  function limites() {
    const { W } = E();
    if (!W) return { zMin: 0.2, zMax: 2.4 };
    const zMin = Math.min(largura / (W.w * T), altura / (W.h * T)) * 0.95;
    return { zMin: Math.max(0.2, zMin), zMax: 2.4 };
  }
  function limitaCamera() {
    const { W } = E();
    if (!W) return;
    const { zMin, zMax } = limites();
    cam.z = Math.max(zMin, Math.min(zMax, cam.z));
    const mx = W.w * T, my = W.h * T;
    const meioL = largura / cam.z / 2, meioA = altura / cam.z / 2;
    cam.x = mx < meioL * 2 ? mx / 2 : Math.max(meioL - 40, Math.min(mx - meioL + 40, cam.x));
    cam.y = my < meioA * 2 ? my / 2 : Math.max(meioA - 40, Math.min(my - meioA + 40, cam.y));
  }
  function redimensiona() {
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    largura = canvas.clientWidth || 300;
    altura = canvas.clientHeight || 300;
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
    limitaCamera();
  }
  const paraMundo = (px, py) => ({ x: (px - largura / 2) / cam.z + cam.x, y: (py - altura / 2) / cam.z + cam.y });

  function centralizar(tx, ty, z) {
    cam.x = (tx + 0.5) * T; cam.y = (ty + 0.5) * T;
    if (z) cam.z = z;
    limitaCamera();
  }
  function enquadrarUBS() {
    const { W } = E();
    if (!W) return;
    cam.z = Math.min(1.1, largura / (15 * T));
    centralizar(W.ubs.x + W.ubs.w / 2 - 0.5, W.ubs.y + W.ubs.h / 2 - 0.5);
  }

  /* ---------- Desenho ---------- */
  function desenhaTerreno(S, W, cfg) {
    const x0 = Math.max(0, Math.floor((cam.x - largura / cam.z / 2) / T)), x1 = Math.min(W.w - 1, Math.ceil((cam.x + largura / cam.z / 2) / T));
    const y0 = Math.max(0, Math.floor((cam.y - altura / cam.z / 2) / T)), y1 = Math.min(W.h - 1, Math.ceil((cam.y + altura / cam.z / 2) / T));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = y * W.w + x, ch = W.terr[k];
      let cor;
      if (ch === '#') cor = '#4b5563';
      else if (W.piso[k]) cor = (x + y) % 2 ? W.piso[k] : ajusta(W.piso[k], 0.96);
      else {
        cor = (cfg.terreno[ch] || cfg.terreno[',']).cor;
        if (ch === ',' && (x * 7 + y * 13) % 5 === 0) cor = ajusta(cor, 0.985);
        if (ch === 'c' && (x + y) % 2) cor = ajusta(cor, 0.97);
      }
      ctx.fillStyle = cor;
      ctx.fillRect(x * T, y * T, T + 0.5, T + 0.5);
      if (ch === '#') {
        ctx.fillStyle = '#6b7280'; ctx.fillRect(x * T, y * T, T, 5);
        ctx.fillStyle = '#374151'; ctx.fillRect(x * T, y * T + T - 4, T, 4);
      } else if (ch === '+') {
        ctx.fillStyle = '#a16207'; ctx.fillRect(x * T + 4, y * T + 2, T - 8, T - 4);
        ctx.fillStyle = '#facc15'; ctx.fillRect(x * T + T - 10, y * T + T / 2 - 1, 3, 3);
      } else if (ch === 'F') {
        ctx.strokeStyle = 'rgba(90,55,20,.35)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x * T, y * T + 10); ctx.lineTo(x * T + T, y * T + 10); ctx.moveTo(x * T, y * T + 22); ctx.lineTo(x * T + T, y * T + 22); ctx.stroke();
      }
    }
  }

  function desenhaRotulos(S, W, cfg) {
    if (cam.z < 0.42) return;
    ctx.font = `600 11px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const l of W.lugares) {
      let nome = null;
      if (l.casa) nome = achaFamilia(S, l.casa).nome.replace('Família ', '');
      else if (l.modelo === 'ubs') nome = `✚ ${cfg.territorio.nomeUnidade}`;
      else if (l.modelo === 'escola') nome = 'Escola';
      else if (l.modelo === 'trabalho') nome = cfg.cenario.id === 'metropole' ? 'Escritórios' : 'Comércio';
      else if (l.modelo === 'lanche') nome = 'Lanchonete';
      if (!nome) continue;
      const cx = (l.x + l.w / 2) * T, topo = l.y * T;
      const flip = l.porta && l.porta.y === l.y; // porta em cima: rótulo embaixo
      const cy = flip ? (l.y + l.h) * T + 9 : topo - 9;
      const larg = ctx.measureText(nome).width + 12;
      ctx.fillStyle = l.modelo === 'ubs' ? '#0f766e' : 'rgba(255,255,255,.88)';
      ctx.beginPath(); ctx.roundRect(cx - larg / 2, cy - 9, larg, 18, 9); ctx.fill();
      ctx.fillStyle = l.modelo === 'ubs' ? '#fff' : '#1f2937';
      ctx.fillText(nome, cx, cy + 0.5);
    }
  }

  function desenhaObjetos(W, cfg) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const o of W.objs) {
      const info = cfg.objetos[o.t];
      if (o.t === 'T') { ctx.font = `${T * 1.05}px ${FONTE_EMOJI}`; ctx.fillText(info.icone, o.x * T + T / 2, o.y * T + T / 2 - 2); continue; }
      if (o.t === 'R') { ctx.font = `${T * 0.85}px ${FONTE_EMOJI}`; ctx.fillText(info.icone, o.x * T + T / 2, o.y * T + T / 2); continue; }
      if (o.t === 'B') { // cama
        ctx.fillStyle = '#7c5a3a'; ctx.beginPath(); ctx.roundRect(o.x * T + 2, o.y * T + 3, T - 4, T - 6, 5); ctx.fill();
        ctx.fillStyle = '#e8eef7'; ctx.beginPath(); ctx.roundRect(o.x * T + 4, o.y * T + 5, T - 8, T - 10, 4); ctx.fill();
        ctx.fillStyle = '#93c5fd'; ctx.fillRect(o.x * T + 4, o.y * T + T / 2, T - 8, T / 2 - 5); continue;
      }
      if (o.t === 'm') { ctx.fillStyle = '#92643c'; ctx.beginPath(); ctx.roundRect(o.x * T + 3, o.y * T + 6, T - 6, T - 12, 5); ctx.fill(); continue; }
      ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.beginPath(); ctx.roundRect(o.x * T + 2, o.y * T + 4, T - 4, T - 6, 6); ctx.fill();
      ctx.fillStyle = '#fff9'; ctx.beginPath(); ctx.roundRect(o.x * T + 2, o.y * T + 2, T - 4, T - 6, 6); ctx.fill();
      ctx.font = `${T * 0.62}px ${FONTE_EMOJI}`;
      ctx.fillStyle = '#000';
      ctx.fillText(info.icone, o.x * T + T / 2, o.y * T + T / 2 - 1);
    }
  }

  function escalaIdade(idade) { return idade < 3 ? 0.58 : idade < 13 ? 0.72 : idade < 18 ? 0.88 : 1; }

  function desenhaPessoa(a, S, W, agora) {
    const esq = a.facing < 0;
    let px = (a.x + 0.5) * T, py = (a.y + 0.5) * T;
    let escala = 1, pele, cabelo, camisa, calca = '#334155', papel = null;
    const h = hashR(a.id);
    if (a.k === 'res') {
      const p = achaPessoa(S, a.pid);
      escala = escalaIdade(p.idade);
      pele = PELES[h % PELES.length];
      cabelo = p.idade >= 62 ? '#d1d5db' : CABELOS[(h >> 3) % CABELOS.length];
      camisa = CAMISAS[(h >> 5) % CAMISAS.length];
    } else {
      papel = a.papel;
      pele = PELES[h % PELES.length]; cabelo = CABELOS[(h >> 3) % CABELOS.length];
      camisa = papel === 'medico' ? '#f8fafc' : papel === 'tecnico' ? '#3b82f6' : '#16a34a';
    }
    let deitado = false;
    if (a.acao && a.acao.obj && (a.acao.k === 'dormir' || a.acao.k === 'descansar')) { px = (a.acao.obj.x + 0.5) * T; py = (a.acao.obj.y + 0.5) * T; deitado = true; }
    const andando = a.path.length > 0 && !deitado;
    const fase = agora / 120 + (h % 7);
    const balanco = andando ? Math.sin(fase) : 0;
    const salto = andando ? Math.abs(Math.sin(fase)) * 2 : 0;
    ctx.save();
    ctx.translate(px, py);
    if (deitado) {
      ctx.rotate(Math.PI / 2 * 0.0);
      ctx.fillStyle = camisa; ctx.beginPath(); ctx.roundRect(-9, -3, 18, 9, 4); ctx.fill();
      ctx.fillStyle = pele; ctx.beginPath(); ctx.arc(-9, 1, 5.5, 0, 7); ctx.fill();
      ctx.fillStyle = cabelo; ctx.beginPath(); ctx.arc(-9, -0.5, 5.5, Math.PI, 0); ctx.fill();
      ctx.restore();
      return;
    }
    ctx.scale(escala, escala);
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(0, 10, 8, 3, 0, 0, 7); ctx.fill();
    // pernas
    ctx.strokeStyle = calca; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-2.5, 3 - salto); ctx.lineTo(-2.5 + balanco * 3.2, 10 - salto); ctx.moveTo(2.5, 3 - salto); ctx.lineTo(2.5 - balanco * 3.2, 10 - salto); ctx.stroke();
    // corpo
    ctx.fillStyle = camisa; ctx.beginPath(); ctx.roundRect(-5.5, -7 - salto, 11, 12, 4); ctx.fill();
    if (papel === 'medico') { ctx.fillStyle = '#dc2626'; ctx.fillRect(-1, -4 - salto, 2, 6); ctx.fillRect(-3, -2 - salto, 6, 2); }
    if (papel === 'acs') { ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.roundRect(esq ? 3 : -8, -2 - salto, 5, 6, 2); ctx.fill(); }
    // braços
    ctx.strokeStyle = pele; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(-5, -4 - salto); ctx.lineTo(-6.5 - balanco * 2, 2 - salto); ctx.moveTo(5, -4 - salto); ctx.lineTo(6.5 + balanco * 2, 2 - salto); ctx.stroke();
    // cabeça
    ctx.fillStyle = pele; ctx.beginPath(); ctx.arc(0, -12 - salto, 6, 0, 7); ctx.fill();
    ctx.fillStyle = cabelo; ctx.beginPath(); ctx.arc(0, -13 - salto, 6.2, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
    if (a.k === 'res' && achaPessoa(S, a.pid).idade >= 62) { ctx.fillStyle = '#e5e7eb'; ctx.beginPath(); ctx.arc(0, -14 - salto, 5, Math.PI, 0); ctx.fill(); }
    ctx.fillStyle = '#111827'; ctx.fillRect(esq ? -3.2 : 1.2, -12.5 - salto, 1.8, 1.8); ctx.fillRect(esq ? -0.2 : 4.2 - 2.4, -12.5 - salto, 1.8, 1.8);
    if (papel === 'medico') { ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(0, -1 - salto, 4, 0.2, Math.PI - 0.2); ctx.stroke(); }
    ctx.restore();
  }

  function desenhaBolha(a, S, W, texto, agora) {
    const esc = a.k === 'res' ? escalaIdade(achaPessoa(S, a.pid).idade) : 1;
    let px = (a.x + 0.5) * T, py = (a.y + 0.5) * T;
    if (a.acao && a.acao.obj && (a.acao.k === 'dormir' || a.acao.k === 'descansar')) { px = (a.acao.obj.x + 0.5) * T; py = (a.acao.obj.y + 0.5) * T + 8; }
    const y = py - 20 * esc - 12 + Math.sin(agora / 400 + hashR(a.id)) * 1.2;
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(px - 10, y - 9, 20, 18, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px - 3, y + 9); ctx.lineTo(px, y + 13); ctx.lineTo(px + 3, y + 9); ctx.fill();
    ctx.font = `12px ${FONTE_EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
    ctx.fillText(texto, px, y + 0.5);
  }

  function desenhaSelecao(a, S, agora) {
    const px = (a.x + 0.5) * T, py = (a.y + 0.5) * T + 9;
    const r = 13 + Math.sin(agora / 250) * 1.5;
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.5, 0, 0, 7); ctx.stroke();
    const nome = a.k === 'res' ? achaPessoa(S, a.pid).nome : { medico: 'Médico(a)', tecnico: 'Técnico(a)', acs: 'Agente comunitário' }[a.papel];
    ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const larg = ctx.measureText(nome).width + 12;
    ctx.fillStyle = '#0891b2'; ctx.beginPath(); ctx.roundRect(px - larg / 2, py + 12, larg, 16, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(nome, px, py + 20.5);
  }

  function desenhaNoite(S) {
    const h = minutoDoDia(S) / 60;
    let alfa = 0;
    if (h >= 19.5 || h < 5.5) alfa = 0.5;
    else if (h >= 17.5) alfa = ((h - 17.5) / 2) * 0.5;
    else if (h < 7.5) alfa = ((7.5 - h) / 2) * 0.5;
    if (alfa <= 0.01) return;
    ctx.fillStyle = `rgba(12,18,60,${alfa})`;
    ctx.fillRect(0, 0, largura, altura);
  }

  function desenha(agora) {
    const { S, W, cfg } = E();
    if (!S || !W) return;
    if (canvas.clientWidth !== largura || canvas.clientHeight !== altura) redimensiona();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#8cc17a'; ctx.fillRect(0, 0, largura, altura);
    ctx.save();
    ctx.translate(largura / 2, altura / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
    desenhaTerreno(S, W, cfg);
    desenhaObjetos(W, cfg);
    const vis = W.agentes.filter((a) => a.vis).sort((a, b) => a.y - b.y);
    for (const a of vis) desenhaPessoa(a, S, W, agora);
    desenhaRotulos(S, W, cfg);
    for (const a of vis) { const b = bolhaDe(W, S, a); if (b) desenhaBolha(a, S, W, b, agora); }
    if (selecionado) { const a = W.agentes.find((x) => x.id === selecionado && x.vis); if (a) desenhaSelecao(a, S, agora); }
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    desenhaNoite(S);
  }

  /* ---------- Entrada (toque / mouse) ---------- */
  function agenteEm(px, py) {
    const { W } = E();
    const m = paraMundo(px, py);
    const mx = m.x / T - 0.5, my = m.y / T - 0.5;
    let melhor = null, dMin = 1.1;
    for (const a of W.agentes) {
      if (!a.vis) continue;
      let ax = a.x, ay = a.y;
      if (a.acao && a.acao.obj && (a.acao.k === 'dormir' || a.acao.k === 'descansar')) { ax = a.acao.obj.x; ay = a.acao.obj.y; }
      const d = Math.hypot(ax - mx, ay - 0.35 - my);
      if (d < dMin) { dMin = d; melhor = a; }
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
    if (tinha && arraste && !arraste.moveu && ponteiros.size === 0 && e.type === 'pointerup') {
      const a = agenteEm(e.offsetX, e.offsetY);
      hooks.aoTocar(a ? a.id : null);
    }
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
    zoom(f) { cam.z *= f; limitaCamera(); },
    get selecionado() { return selecionado; },
  };
}
