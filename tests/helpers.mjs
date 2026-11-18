import { readFileSync } from 'node:fs';
import { montarCfg } from '../src/mundo.js';
const ler = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
export const base = { game: ler('game.json'), cond: ler('conditions.json'), cenarios: ler('cenarios.json') };
export const cfgDe = (id) => montarCfg(base, id);
export const cfg = cfgDe('interior');
