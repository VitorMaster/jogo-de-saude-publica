// Clima do jogo (determinístico, sem DOM): estações do Sudeste, chuva de verão, calor, vento.
// Valores aproximados para o jogo (a validar): chuva concentrada de novembro a março, inverno mais seco.
const CHUVA_MES = [0.5, 0.42, 0.4, 0.3, 0.2, 0.15, 0.12, 0.12, 0.2, 0.3, 0.45, 0.5];
const TEMP_MES = [30, 31, 30, 28, 26, 24, 24, 25, 26, 27, 28, 29];
const AJUSTE_CENARIO = { metropole: 1, interior: 0, rural: -1 };

function sorteio(chave) { // número estável entre 0 e 1 para uma chave de texto
  let h = 2166136261;
  for (let i = 0; i < chave.length; i++) { h ^= chave.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}

/** Clima do dia: { tipo: 'sol'|'nublado'|'chuva'|'tempestade', temp, vento, ini, fim } (ini/fim: horas em que chove). */
export function climaDoDia(mes, diaJogo, cenario) {
  const r = sorteio(`${mes}|${diaJogo}|${cenario}|a`), r2 = sorteio(`${mes}|${diaJogo}|${cenario}|b`), r3 = sorteio(`${mes}|${diaJogo}|${cenario}|c`);
  const pChuva = CHUVA_MES[mes];
  let tipo = 'sol';
  if (r < pChuva) tipo = r2 < 0.25 && [10, 11, 0, 1, 2].includes(mes) ? 'tempestade' : 'chuva';
  else if (r < pChuva + 0.22) tipo = 'nublado';
  const base = TEMP_MES[mes] + (AJUSTE_CENARIO[cenario] || 0) + (tipo === 'sol' ? 2 : tipo === 'nublado' ? 0 : -3) + Math.round((r3 - 0.5) * 3);
  const dur = tipo === 'tempestade' ? 1 + Math.floor(r3 * 3) : 2 + Math.floor(r3 * 4);
  const ini = 11 + Math.floor(r2 * 8);
  return { tipo, temp: base, vento: tipo === 'tempestade' ? 0.9 : tipo === 'chuva' ? 0.45 : 0.2 + r3 * 0.3, ini, fim: Math.min(23, ini + dur) };
}

/** Estado instantâneo do tempo numa hora do dia (0–24). */
export function climaAgora(c, hora) {
  const chovendo = (c.tipo === 'chuva' || c.tipo === 'tempestade') && hora >= c.ini && hora < c.fim;
  const curva = Math.cos(((hora - 15) / 24) * Math.PI * 2); // mais quente às 15h
  return {
    tipo: c.tipo, chovendo, intensidade: chovendo ? (c.tipo === 'tempestade' ? 1 : 0.55) : 0,
    tempestade: chovendo && c.tipo === 'tempestade',
    nublado: c.tipo !== 'sol' && (chovendo || (hora >= c.ini - 2 && hora < c.fim + 1) || c.tipo === 'nublado'),
    temp: Math.round(c.temp - 4 + curva * 4), vento: c.vento,
  };
}

export function rotuloClima(a) {
  const ic = a.tempestade ? '⛈️' : a.chovendo ? '🌧️' : a.nublado ? '☁️' : a.temp >= 31 ? '🌡️' : '☀️';
  return `${ic} ${a.temp}°`;
}
