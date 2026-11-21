// Sons e vibração (4D sensorial). Tudo gerado por código com a Web Audio API: sem arquivos de áudio.
// O áudio só liga depois de um toque do jogador (regra dos navegadores de celular). Sem suporte, tudo vira no-op.
export function criarSom() {
  let ctx = null, mestre = null, chuva = null, vento = null, grilo = null, ruido = null;
  let ligado = true, pronto = false, timerAve = null;
  try { ligado = localStorage.getItem('saude-sim-som') !== '0'; } catch (e) { /* ok */ }

  function criaRuido() {
    const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function camadaRuido(tipo, freq, q) {
    const src = ctx.createBufferSource(); src.buffer = ruido; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = tipo; f.frequency.value = freq; f.Q.value = q || 0.7;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(mestre); src.start();
    return g;
  }
  function iniciar() {
    if (pronto) { if (ctx && ctx.state === 'suspended') ctx.resume(); return; }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    try {
      ctx = new AC();
      mestre = ctx.createGain(); mestre.gain.value = ligado ? 0.7 : 0; mestre.connect(ctx.destination);
      ruido = criaRuido();
      chuva = camadaRuido('highpass', 1800, 0.5);
      vento = camadaRuido('lowpass', 500, 0.8);
      const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
      o.frequency.value = 4300; lfo.frequency.value = 11; lg.gain.value = 0.5; g.gain.value = 0;
      lfo.connect(lg); lg.connect(g.gain); o.connect(g); g.connect(mestre); o.start(); lfo.start();
      grilo = g;
      pronto = true;
      if (ctx.state === 'suspended') ctx.resume();
      agendaAve();
    } catch (e) { pronto = false; }
  }
  let amb = { dia: 1, chuva: 0, vento: 0.2 };
  function agendaAve() {
    clearTimeout(timerAve);
    timerAve = setTimeout(() => { if (pronto && ligado && amb.dia > 0.5 && amb.chuva < 0.1) trino(); agendaAve(); }, 2500 + Math.random() * 5000);
  }
  function trino() {
    const t = ctx.currentTime, n = 2 + Math.floor(Math.random() * 3), base = 2800 + Math.random() * 1600;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), ini = t + i * 0.13;
      o.type = 'sine'; o.frequency.setValueAtTime(base, ini); o.frequency.exponentialRampToValueAtTime(base * 1.5, ini + 0.08);
      g.gain.setValueAtTime(0, ini); g.gain.linearRampToValueAtTime(0.05, ini + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, ini + 0.1);
      o.connect(g); g.connect(mestre); o.start(ini); o.stop(ini + 0.12);
    }
  }
  /** a: { dia 0–1, chuva 0–1, vento 0–1 } — o ambiente muda com a hora e o tempo. */
  function atualiza(a) {
    amb = a;
    if (!pronto || !ligado) return;
    const t = ctx.currentTime;
    chuva.gain.setTargetAtTime(a.chuva * 0.16, t, 0.8);
    vento.gain.setTargetAtTime((0.015 + a.vento * 0.07) * (1 + a.chuva), t, 1.2);
    grilo.gain.setTargetAtTime((1 - a.dia) * (1 - a.chuva) * 0.012, t, 1.5);
  }
  function tom(freq, ini, dur, tipo, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = tipo || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, ini); g.gain.linearRampToValueAtTime(vol || 0.12, ini + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, ini + dur);
    o.connect(g); g.connect(mestre); o.start(ini); o.stop(ini + dur + 0.02);
  }
  function efeito(nome) {
    if (!pronto || !ligado) return;
    const t = ctx.currentTime;
    if (nome === 'sino') { tom(880, t, 0.9, 'sine', 0.1); tom(1320, t, 0.7, 'sine', 0.05); tom(660, t + 0.18, 0.9, 'sine', 0.07); }
    else if (nome === 'alerta') { tom(520, t, 0.14, 'square', 0.06); tom(380, t + 0.18, 0.2, 'square', 0.06); }
    else if (nome === 'sucesso') { tom(523, t, 0.15, 'triangle', 0.09); tom(659, t + 0.09, 0.15, 'triangle', 0.09); tom(784, t + 0.18, 0.3, 'triangle', 0.09); }
    else if (nome === 'trovao') {
      const src = ctx.createBufferSource(); src.buffer = ruido;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.05); g.gain.exponentialRampToValueAtTime(0.002, t + 2.6);
      src.connect(f); f.connect(g); g.connect(mestre); src.start(t); src.stop(t + 2.7);
    }
  }
  function vibra(padrao) { // Android vibra; o iPhone não permite vibração pela web
    if (!ligado) return;
    try { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(padrao); } catch (e) { /* ok */ }
  }
  function alterna() {
    ligado = !ligado;
    try { localStorage.setItem('saude-sim-som', ligado ? '1' : '0'); } catch (e) { /* ok */ }
    if (pronto) mestre.gain.setTargetAtTime(ligado ? 0.7 : 0, ctx.currentTime, 0.1);
    return ligado;
  }
  return { iniciar, atualiza, efeito, vibra, alterna, get ligado() { return ligado; }, get pronto() { return pronto; } };
}
