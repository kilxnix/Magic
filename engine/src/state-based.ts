import { GameState, CardInstance, TriggeredAbilityRef, Zone } from './types';
import { isIndestructible } from './keywords';
import { getCommanderDestinationZone } from './commander';
import { getCardDefinition, pruneDetachedEffects } from './game-state';
import { isEffectiveCreature } from './effective-types';
import { applyReplacements } from './effects/replacement';
import { getEffectiveToughness as getLayeredEffectiveToughness } from './effects/continuous';

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

  // Track creatures that die during SBAs (for dies triggers)
  const creaturesDied: { instanceId: string; ownerId: string }[] = [];

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

    // Helper: get destination zone applying commander replacement rule
    const tempState = { ...state, cards: newCards, players: newPlayers };
    const graveyardDest = (cardId: string) =>
      getCommanderDestinationZone(tempState, cardId, 'graveyard');
    const creatureDeathDest = (cardId: string, card: CardInstance): Zone | null => {
      const commanderDest = graveyardDest(cardId);
      if (commanderDest !== 'graveyard') return commanderDest;
      const { event } = applyReplacements(tempState, {
        type: 'CreatureDies',
        cardInstanceId: cardId,
        targetId: card.ownerId,
        destinationZone: 'graveyard',
      });
      if (!event) return null;
      return event.destinationZone || 'graveyard';
    };

    // 2. Creatures with 0 or less toughness die (even if indestructible)
    for (const [id, card] of newCards) {
      if (card.zone !== 'battlefield') continue;

      if (!isEffectiveCreature(tempState, id)) continue;

      const effectiveToughness = getLayeredEffectiveToughness(tempState, id);
      if (effectiveToughness <= 0) {
        const destination = creatureDeathDest(id, card);
        if (destination) {
          newCards.set(id, { ...card, zone: destination, damage: 0, deathtouchDamage: undefined, tapped: false });
          creaturesDied.push({ instanceId: id, ownerId: card.ownerId });
          stateChanged = true;
        }
      }
    }

    // 2b. Planeswalkers with 0 loyalty go to the graveyard
    for (const [id, card] of newCards) {
      if (card.zone !== 'battlefield') continue;
      const def = getCardDefinition(tempState, card);
      if (!def.card_types.includes('planeswalker')) continue;
      const loyalty = card.counters['loyalty'] ?? 0;
      if (loyalty <= 0) {
        newCards.set(id, { ...card, zone: graveyardDest(id), counters: {}, tapped: false });
        stateChanged = true;
      }
    }

    // 3. Creatures with lethal damage die (unless indestructible)
    for (const [id, card] of newCards) {
      if (card.zone !== 'battlefield') continue;

      if (!isEffectiveCreature(tempState, id)) continue;

      const effectiveToughness = getLayeredEffectiveToughness(tempState, id);
      const hasLethalDeathtouchDamage = card.damage > 0 && Boolean(card.deathtouchDamage);

      if ((card.damage >= effectiveToughness || hasLethalDeathtouchDamage) && effectiveToughness > 0) {
        if (!isIndestructible(state, id)) {
          const destination = creatureDeathDest(id, card);
          if (destination) {
            newCards.set(id, { ...card, zone: destination, damage: 0, deathtouchDamage: undefined, tapped: false });
            creaturesDied.push({ instanceId: id, ownerId: card.ownerId });
            stateChanged = true;
          }
        }
      }
    }

    // 4. Legend rule: if a player controls 2+ legendary permanents with same name,
    //    they choose one to keep (deterministic: keep first one found)
    const legendaryByOwner = new Map<string, Map<string, CardInstance[]>>();

    for (const [id, card] of newCards) {
      if (card.zone !== 'battlefield') continue;

      const def = getCardDefinition(tempState, card);

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
          // Keep the first, move others to graveyard (or command zone for commanders)
          for (let i = 1; i < cards.length; i++) {
            const card = cards[i];
            const destination = isEffectiveCreature(tempState, card.instanceId)
              ? creatureDeathDest(card.instanceId, card)
              : graveyardDest(card.instanceId);
            if (destination) {
              newCards.set(card.instanceId, { ...card, zone: destination, damage: 0, deathtouchDamage: undefined, tapped: false });
              stateChanged = true;
            }
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

    // 6b. Tokens in non-battlefield zones cease to exist (MTG rule 704.5d).
    // Tokens that die, are exiled, are countered, or end up in any zone other than the
    // battlefield should be removed from the game state. This prevents stale token
    // entries from lingering in graveyards/exile and re-appearing in lookups.
    const tokensToRemove: string[] = [];
    for (const [id, card] of newCards) {
      if (!card.isToken) continue;
      if (card.zone === 'battlefield' || card.zone === 'stack') continue;
      tokensToRemove.push(id);
    }
    if (tokensToRemove.length > 0) {
      for (const id of tokensToRemove) newCards.delete(id);
      stateChanged = true;
    }

    // 7. Players with 10+ poison counters lose
    for (let i = 0; i < newPlayers.length; i++) {
      if (newPlayers[i].hasLost) continue;
      if (newPlayers[i].poisonCounters >= 10) {
        newPlayers[i].hasLost = true;
        stateChanged = true;
      }
    }
  }

  // Create pending triggers for creatures that died with dies abilities
  let newPendingTriggers = [...(state.pendingTriggers || [])];
  for (const died of creaturesDied) {
    const abilities = state.battlefieldAbilities?.get(died.instanceId);
    if (!abilities) continue;

    for (const ability of abilities) {
      if (ability.trigger.kind === 'Dies' && ability.trigger.who === 'self') {
        newPendingTriggers.push({
          id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          sourceInstanceId: died.instanceId,
          controllerId: died.ownerId,
          ability,
          requiredTargets: [],
        });
      }
    }
  }

  for (const died of creaturesDied) {
    for (const [sourceInstanceId, abilities] of state.battlefieldAbilities || new Map()) {
      const source = state.cards.get(sourceInstanceId);
      if (!source) continue;

      for (const ability of abilities) {
        if (ability.trigger.kind === 'CreatureYouControlDies' && died.ownerId === source.ownerId) {
          newPendingTriggers.push({
            id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            sourceInstanceId,
            controllerId: source.ownerId,
            ability,
            requiredTargets: [],
            eventContext: { cardInstanceId: died.instanceId },
          });
        }
        if (ability.trigger.kind === 'AttachedCreatureDies' && source.attachedTo === died.instanceId) {
          newPendingTriggers.push({
            id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            sourceInstanceId,
            controllerId: source.ownerId,
            ability,
            requiredTargets: [],
            eventContext: { cardInstanceId: died.instanceId },
          });
        }
      }
    }
  }

  // Clean up battlefieldAbilities for creatures that died
  let newBattlefieldAbilities = state.battlefieldAbilities || new Map();
  if (creaturesDied.length > 0) {
    newBattlefieldAbilities = new Map(state.battlefieldAbilities || new Map());
    for (const died of creaturesDied) {
      newBattlefieldAbilities.delete(died.instanceId);
    }
  }

  // Unattach equipment from creatures that left the battlefield
  const attachmentsMovedToGraveyard: string[] = [];
  for (const [id, card] of newCards) {
    if (card.attachedTo) {
      const attachedToCard = newCards.get(card.attachedTo);
      if (!attachedToCard || attachedToCard.zone !== 'battlefield') {
        const def = getCardDefinition(state, card);
        const isAura = def.type_line.toLowerCase().includes('aura');
        if (isAura) attachmentsMovedToGraveyard.push(id);
        newCards.set(id, {
          ...card,
          attachedTo: undefined,
          ...(isAura ? { zone: getCommanderDestinationZone(state, id, 'graveyard') as Zone } : {}),
        });
      }
    }
  }
  if (attachmentsMovedToGraveyard.length > 0) {
    if (newBattlefieldAbilities === state.battlefieldAbilities) {
      newBattlefieldAbilities = new Map(state.battlefieldAbilities || new Map());
    }
    for (const id of attachmentsMovedToGraveyard) {
      newBattlefieldAbilities.delete(id);
    }
  }

  return pruneDetachedEffects({ ...state, cards: newCards, players: newPlayers, pendingTriggers: newPendingTriggers, battlefieldAbilities: newBattlefieldAbilities });
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
    if (card.zone === 'battlefield') {
      const counters = { ...card.counters };
      delete counters['_powerMod'];
      delete counters['_toughnessMod'];

      newCards.set(id, {
        ...card,
        damage: 0,
        deathtouchDamage: undefined,
        counters,
        grantedKeywords: undefined,
        lostKeywords: undefined,
      });
    }
  }

  return { ...state, cards: newCards };
}
