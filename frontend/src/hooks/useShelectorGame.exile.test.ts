import { describe, expect, it } from 'vitest';
import {
  createPlayer, type CardDefinition, type CardInstance, type GameState,
} from 'commander-engine';
import { deriveSimpleState } from './useShelectorGame';

// Minimal engine state with one card in the human's exile zone.
function stateWithExiledCard(): { state: GameState; humanId: string } {
  const human = createPlayer('p1', 'You');
  const ai = createPlayer('p2', 'Rival');
  const def: CardDefinition = {
    id: 'd1', name: 'Banisher Priest', type_line: 'Creature — Human Cleric',
    oracle_text: '', mana_cost: '{1}{W}{W}', cmc: 3, colors: ['W'],
    color_identity: ['W'], keywords: [], card_types: ['creature'], power: 2, toughness: 2,
  } as CardDefinition;
  const inst: CardInstance = {
    instanceId: 'i1', definitionId: 'd1', ownerId: 'p1', zone: 'exile',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  } as CardInstance;
  const state = {
    players: [human, ai], cards: new Map([['i1', inst]]),
    cardDefinitions: new Map([['d1', def]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'precombat_main', turnNumber: 1,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  } as unknown as GameState;
  return { state, humanId: 'p1' };
}

describe('deriveSimpleState exile surfacing', () => {
  it('projects the human exile zone contents', () => {
    const { state, humanId } = stateWithExiledCard();
    const simple = deriveSimpleState(state, humanId, ['p2'], 'You', { p2: 'Rival' });
    expect(simple.humanExile.map(c => c.name)).toEqual(['Banisher Priest']);
    expect(simple.aiExiles.p2).toEqual([]);
    expect(simple.aiExile).toEqual([]);
  });
});
