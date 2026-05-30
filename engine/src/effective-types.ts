import type { CardDefinition, CardType, GameState, ManaColor } from './types';
import { getCardDefinition } from './game-state';

const COLOR_WORDS: Record<string, ManaColor> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export function parseDevotionCreatureSuppression(
  def: CardDefinition,
): { colors: ManaColor[]; threshold: number } | null {
  if (!def.card_types.includes('creature')) return null;
  const oracle = def.oracle_text.toLowerCase();
  if (!/\bisn'?t a creature\b/.test(oracle)) return null;

  const match = oracle.match(/devotion to ([a-z\s]+?) is less than ([a-z]+|\d+)/);
  if (!match) return null;

  const colors = Object.entries(COLOR_WORDS)
    .filter(([word]) => new RegExp(`\\b${word}\\b`).test(match[1]))
    .map(([, color]) => color);
  if (colors.length === 0) return null;

  const threshold = Number(match[2]) || NUMBER_WORDS[match[2]];
  if (!threshold) return null;

  return { colors, threshold };
}

export function countDevotionToColors(
  state: GameState,
  playerId: string,
  colors: ManaColor[],
): number {
  const colorSet = new Set(colors);
  let devotion = 0;

  for (const card of state.cards.values()) {
    if (card.ownerId !== playerId || card.zone !== 'battlefield') continue;
    const def = getCardDefinition(state, card);
    if (!def.mana_cost) continue;

    for (const symbol of def.mana_cost.match(/\{([^}]+)\}/g) || []) {
      const inner = symbol.slice(1, -1).toUpperCase();
      const parts = inner.split('/');
      if (parts.some(part => colorSet.has(part as ManaColor))) {
        devotion += 1;
      }
    }
  }

  return devotion;
}

export function getEffectiveCardTypes(state: GameState, instanceId: string): CardType[] {
  const card = state.cards.get(instanceId);
  if (!card) return [];
  const def = getCardDefinition(state, card);

  let types = [...def.card_types];
  const suppression = parseDevotionCreatureSuppression(def);
  if (card.zone === 'battlefield' && suppression) {
    const devotion = countDevotionToColors(state, card.ownerId, suppression.colors);
    if (devotion < suppression.threshold) {
      types = types.filter(type => type !== 'creature');
    }
  }

  return types;
}

export function hasEffectiveCardType(
  state: GameState,
  instanceId: string,
  type: CardType,
): boolean {
  return getEffectiveCardTypes(state, instanceId).includes(type);
}

export function isEffectiveCreature(state: GameState, instanceId: string): boolean {
  return hasEffectiveCardType(state, instanceId, 'creature');
}
