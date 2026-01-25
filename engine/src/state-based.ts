import { GameState, CardInstance } from './types';
import { isIndestructible } from './keywords';

/**
 * Get effective toughness considering +1/+1 and -1/-1 counters.
 */
function getEffectiveToughness(def: { toughness?: number }, card: CardInstance): number {
  const baseToughness = def.toughness ?? 0;
  const plusCounters = card.counters['+1/+1'] ?? 0;
  const minusCounters = card.counters['-1/-1'] ?? 0;
  return baseToughness + plusCounters - minusCounters;
}

/**
 * Cancel +1/+1 and -1/-1 counters on a creature.
 * Returns updated counters or null if no change needed.
 */
function cancelCounters(counters: Record<string, number>): Record<string, number> | null {
  const plus = counters['+1/+1'] ?? 0;
  const minus = counters['-1/-1'] ?? 0;

  if (plus > 0 && minus > 0) {
    const toCancel = Math.min(plus, minus);
    const newCounters = { ...counters };
    newCounters['+1/+1'] = plus - toCancel;
    newCounters['-1/-1'] = minus - toCancel;

    // Clean up zero counters
    if (newCounters['+1/+1'] === 0) delete newCounters['+1/+1'];
    if (newCounters['-1/-1'] === 0) delete newCounters['-1/-1'];

    return newCounters;
  }

  return null;
}

export function checkStateBasedActions(state: GameState): GameState {
  const newCards = new Map(state.cards);
  const newPlayers = state.players.map(p => ({ ...p }));
  let stateChanged = true;

  // SBAs are checked repeatedly until no more changes occur
  while (stateChanged) {
    stateChanged = false;

    // 1. +1/+1 and -1/-1 counters cancel
    for (const [id, card] of newCards) {
      if (card.zone !== 'battlefield') continue;

      const newCounters = cancelCounters(card.counters);
      if (newCounters) {
        newCards.set(id, { ...card, counters: newCounters });
        stateChanged = true;
      }
    }

    // 2. Creatures with 0 or less toughness die (even if indestructible)
    for (const [id, card] of newCards) {
      if (card.zone !== 'battlefield') continue;

      const def = state.cardDefinitions.get(card.definitionId);
      if (!def || !def.card_types.includes('creature')) continue;

      const effectiveToughness = getEffectiveToughness(def, card);
      if (effectiveToughness <= 0) {
        newCards.set(id, { ...card, zone: 'graveyard', damage: 0, tapped: false });
        stateChanged = true;
      }
    }

    // 3. Creatures with lethal damage die (unless indestructible)
    for (const [id, card] of newCards) {
      if (card.zone !== 'battlefield') continue;

      const def = state.cardDefinitions.get(card.definitionId);
      if (!def || !def.card_types.includes('creature')) continue;

      const effectiveToughness = getEffectiveToughness(def, card);

      if (card.damage >= effectiveToughness && effectiveToughness > 0) {
        if (!isIndestructible(state, id)) {
          newCards.set(id, { ...card, zone: 'graveyard', damage: 0, tapped: false });
          stateChanged = true;
        }
      }
    }

    // 4. Legend rule: if a player controls 2+ legendary permanents with same name,
    //    they choose one to keep (deterministic: keep first one found)
    const legendaryByOwner = new Map<string, Map<string, CardInstance[]>>();

    for (const [id, card] of newCards) {
      if (card.zone !== 'battlefield') continue;

      const def = state.cardDefinitions.get(card.definitionId);
      if (!def) continue;

      // Check if legendary (type_line contains "Legendary")
      if (!def.type_line.toLowerCase().includes('legendary')) continue;

      const ownerMap = legendaryByOwner.get(card.ownerId) ?? new Map();
      const sameNameCards = ownerMap.get(def.name) ?? [];
      sameNameCards.push(card);
      ownerMap.set(def.name, sameNameCards);
      legendaryByOwner.set(card.ownerId, ownerMap);
    }

    for (const [, ownerMap] of legendaryByOwner) {
      for (const [, cards] of ownerMap) {
        if (cards.length > 1) {
          // Keep the first, move others to graveyard
          for (let i = 1; i < cards.length; i++) {
            const card = cards[i];
            newCards.set(card.instanceId, { ...card, zone: 'graveyard', damage: 0, tapped: false });
            stateChanged = true;
          }
        }
      }
    }

    // 5. Players at 0 or less life lose
    for (let i = 0; i < newPlayers.length; i++) {
      if (!newPlayers[i].hasLost && newPlayers[i].life <= 0) {
        newPlayers[i].hasLost = true;
        stateChanged = true;
      }
    }

    // 6. Players with 21+ commander damage from any single commander lose
    for (let i = 0; i < newPlayers.length; i++) {
      if (newPlayers[i].hasLost) continue;

      for (const [commanderId, damage] of Object.entries(newPlayers[i].commanderDamage)) {
        if (damage >= 21) {
          newPlayers[i].hasLost = true;
          stateChanged = true;
          break; // Only need to mark lost once
        }
      }
    }
  }

  return { ...state, cards: newCards, players: newPlayers };
}

/**
 * Mark a player as having lost due to drawing from an empty library.
 * Called from executor when a draw would happen with no cards in library.
 */
export function markPlayerLostFromEmptyLibrary(state: GameState, playerId: string): GameState {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return state;

  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, hasLost: true } : p
  );

  return { ...state, players: newPlayers };
}

/**
 * Clean up damage from creatures at end of turn (cleanup step).
 */
export function cleanupDamage(state: GameState): GameState {
  const newCards = new Map(state.cards);

  for (const [id, card] of newCards) {
    if (card.zone === 'battlefield' && card.damage > 0) {
      newCards.set(id, { ...card, damage: 0 });
    }
  }

  return { ...state, cards: newCards };
}
