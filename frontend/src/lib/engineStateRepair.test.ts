import { describe, expect, it } from 'vitest';
import {
  createPlayer,
  emptyManaPool,
  putTriggersOnStack,
  resolveTopOfStack,
  tryCastSpell,
  type CardDefinition,
  type CardInstance,
  type GameState,
  type ManaCost,
} from 'commander-engine';
import { restoreMissingBattlefieldAbilities } from './engineStateRepair';

const NO_PAYMENT: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };

function cardDef(def: Partial<CardDefinition> & Pick<CardDefinition, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'cmc' | 'card_types'>): CardDefinition {
  return {
    colors: [],
    color_identity: [],
    keywords: [],
    ...def,
  };
}

function card(instanceId: string, definitionId: string, zone: CardInstance['zone']): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId: 'p1',
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
}

function resumedTalrandStateWithoutAbilityMap(): GameState {
  const talrand = cardDef({
    id: 'talrand',
    name: 'Talrand, Sky Summoner',
    type_line: 'Legendary Creature - Merfolk Wizard',
    oracle_text: 'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',
    mana_cost: '{2}{U}{U}',
    cmc: 4,
    card_types: ['creature'],
    colors: ['U'],
    color_identity: ['U'],
    power: 2,
    toughness: 2,
  });
  const inspiration = cardDef({
    id: 'inspiration',
    name: 'Inspiration',
    type_line: 'Instant',
    oracle_text: 'Target player draws two cards.',
    mana_cost: '{3}{U}',
    cmc: 4,
    card_types: ['instant'],
    colors: ['U'],
    color_identity: ['U'],
  });
  const island = cardDef({
    id: 'island',
    name: 'Island',
    type_line: 'Basic Land - Island',
    oracle_text: '({T}: Add {U}.)',
    mana_cost: '',
    cmc: 0,
    card_types: ['land'],
    colors: [],
    color_identity: ['U'],
  });

  return {
    players: [
      { ...createPlayer('p1', 'Player'), manaPool: { ...emptyManaPool(), U: 4 } },
      createPlayer('p2', 'Opponent'),
    ],
    cards: new Map<string, CardInstance>([
      ['talrand_1', card('talrand_1', talrand.id, 'battlefield')],
      ['inspiration_1', card('inspiration_1', inspiration.id, 'hand')],
      ['island_1', card('island_1', island.id, 'library')],
      ['island_2', card('island_2', island.id, 'library')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [talrand.id, talrand],
      [inspiration.id, inspiration],
      [island.id, island],
    ]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 3,
    spellsCastThisTurn: 0,
    playersWhoAttackedThisTurn: [],
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map([['talrand_1', []]]),
    pendingTriggers: [],
  };
}

function countDrakes(state: GameState): number {
  return [...state.cards.values()].filter(candidate => {
    if (!candidate.isToken || candidate.ownerId !== 'p1' || candidate.zone !== 'battlefield') return false;
    return state.cardDefinitions.get(candidate.definitionId)?.name === 'Drake';
  }).length;
}

describe('restoreMissingBattlefieldAbilities', () => {
  it('rehydrates stale resumed battlefield triggers so targeted instants still trigger Talrand', () => {
    let state = restoreMissingBattlefieldAbilities(resumedTalrandStateWithoutAbilityMap());
    expect(state.battlefieldAbilities.get('talrand_1')?.some(ability =>
      ability.trigger.kind === 'CastInstantOrSorcery',
    )).toBe(true);

    const cast = tryCastSpell(state, 'p1', 'inspiration_1', ['p1'], NO_PAYMENT);
    expect(cast.ok, cast.ok ? undefined : cast.message).toBe(true);
    if (!cast.ok) throw new Error(cast.message);
    state = putTriggersOnStack(cast.state);
    state = resolveTopOfStack(state);

    expect(countDrakes(state)).toBe(1);
  });
});
