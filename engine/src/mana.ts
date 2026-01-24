import { ManaCost, ManaColor, ManaPool, emptyManaPool } from './types';

const COLOR_SYMBOLS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export function parseManaString(manaString: string): ManaCost {
  const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };
  if (!manaString) return cost;

  const symbols = manaString.match(/\{[^}]+\}/g) || [];
  for (const sym of symbols) {
    const inner = sym.slice(1, -1);
    if (COLOR_SYMBOLS.includes(inner as ManaColor)) {
      cost[inner as ManaColor]++;
    } else {
      const num = parseInt(inner, 10);
      if (!isNaN(num)) {
        cost.generic += num;
      }
    }
  }
  return cost;
}

export function addMana(pool: ManaPool, color: ManaColor, amount: number): ManaPool {
  return { ...pool, [color]: pool[color] + amount };
}

export function totalMana(pool: ManaPool): number {
  return pool.W + pool.U + pool.B + pool.R + pool.G + pool.C;
}

export function canPayCost(pool: ManaPool, cost: ManaCost): boolean {
  let remaining = 0;
  for (const color of COLOR_SYMBOLS) {
    if (pool[color] < cost[color]) return false;
    remaining += pool[color] - cost[color];
  }
  return remaining >= cost.generic;
}

export function payManaCost(pool: ManaPool, cost: ManaCost): ManaPool {
  if (!canPayCost(pool, cost)) {
    throw new Error('Cannot pay mana cost');
  }

  const result: ManaPool = { ...pool };

  // Pay colored costs first
  for (const color of COLOR_SYMBOLS) {
    result[color] -= cost[color];
  }

  // Pay generic from remaining (largest pools first to preserve options)
  let genericLeft = cost.generic;
  const colorsByPool = [...COLOR_SYMBOLS].sort((a, b) => result[b] - result[a]);
  for (const color of colorsByPool) {
    const take = Math.min(result[color], genericLeft);
    result[color] -= take;
    genericLeft -= take;
    if (genericLeft === 0) break;
  }

  return result;
}
