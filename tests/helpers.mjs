import { readFileSync } from 'node:fs';
const ler = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
export const cfg = { game: ler('game.json'), cond: ler('conditions.json'), territorio: ler('territorio.json') };
