/**
 * Card utility functions
 */

import type { CardDefinition, CardInstance, ManaColor } from '@/types';

/**
 * Parse mana cost string into symbols.
 * e.g., "{2}{W}{U}" -> ["2", "W", "U"]
 */
export function parseManaCost(manaCost: string): string[] {
  const matches = manaCost.match(/\{([^}]+)\}/g) || [];
  return matches.map(m => m.replace(/[{}]/g, ''));
}

/**
 * Get the primary color of a card.
 */
export function getPrimaryColor(colors: ManaColor[]): ManaColor | null {
  if (colors.length === 0) return null;
  return colors[0];
}

/**
 * Check if a card is a specific type.
 */
export function isCardType(def: CardDefinition, type: string): boolean {
  return def.card_types.includes(type as any) ||
    def.type_line.toLowerCase().includes(type.toLowerCase());
}

/**
 * Get display power/toughness accounting for counters.
 */
export function getDisplayPT(
  card: CardInstance,
  def: CardDefinition
): { power: number; toughness: number } | null {
  if (def.power === undefined || def.toughness === undefined) {
    return null;
  }

  const plusCounters = card.counters['+1/+1'] || 0;
  const minusCounters = card.counters['-1/-1'] || 0;

  return {
    power: def.power + plusCounters - minusCounters,
    toughness: def.toughness + plusCounters - minusCounters,
  };
}

/**
 * Get card's effective toughness after damage.
 */
export function getEffectiveToughness(
  card: CardInstance,
  def: CardDefinition
): number {
  const pt = getDisplayPT(card, def);
  if (!pt) return 0;
  return pt.toughness - card.damage;
}

/**
 * Format card name for display (handle split cards, etc.)
 */
export function formatCardName(name: string): string {
  // Handle split cards: "Fire // Ice" -> "Fire"
  if (name.includes(' // ')) {
    return name.split(' // ')[0];
  }
  return name;
}
