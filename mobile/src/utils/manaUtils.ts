/**
 * Mana utility functions
 */

import type { ManaPool, ManaColor, ManaCost } from '@/types';

/**
 * Check if mana pool has enough mana to pay a cost.
 */
export function canPayCost(pool: ManaPool, cost: ManaCost): boolean {
  // Check colored mana first
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
    if (pool[color] < cost[color]) {
      return false;
    }
  }

  // Check generic mana
  const availableAfterColored =
    pool.W - cost.W +
    pool.U - cost.U +
    pool.B - cost.B +
    pool.R - cost.R +
    pool.G - cost.G +
    pool.C - cost.C;

  return availableAfterColored >= cost.generic;
}

/**
 * Get total mana in pool.
 */
export function getTotalMana(pool: ManaPool): number {
  return pool.W + pool.U + pool.B + pool.R + pool.G + pool.C;
}

/**
 * Check if mana pool is empty.
 */
export function isManaPoolEmpty(pool: ManaPool): boolean {
  return getTotalMana(pool) === 0;
}

/**
 * Format mana pool for display.
 */
export function formatManaPool(pool: ManaPool): string {
  const parts: string[] = [];

  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
    if (pool[color] > 0) {
      parts.push(`${pool[color]}${color}`);
    }
  }

  return parts.length > 0 ? parts.join(' ') : 'Empty';
}

/**
 * Parse mana cost string into ManaCost object.
 */
export function parseManaCostString(costStr: string): ManaCost {
  const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };

  const matches = costStr.match(/\{([^}]+)\}/g) || [];

  for (const match of matches) {
    const symbol = match.replace(/[{}]/g, '');

    if (/^\d+$/.test(symbol)) {
      cost.generic += parseInt(symbol);
    } else if (symbol === 'W' || symbol === 'U' || symbol === 'B' ||
               symbol === 'R' || symbol === 'G' || symbol === 'C') {
      cost[symbol]++;
    }
    // Ignore hybrid and phyrexian for now
  }

  return cost;
}
