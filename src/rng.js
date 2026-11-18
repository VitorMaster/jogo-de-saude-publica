// Gerador pseudo-aleatório com estado serializável (mulberry32) — permite salvar/carregar e testar de forma determinística.
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const sig = (x) => 1 / (1 + Math.exp(-x));

export function rnd(s) {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rint = (s, a, b) => a + Math.floor(rnd(s) * (b - a + 1));
export const rfloat = (s, a, b) => a + rnd(s) * (b - a);
export const pick = (s, arr) => arr[Math.floor(rnd(s) * arr.length)];
