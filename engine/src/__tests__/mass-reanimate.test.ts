import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

const beast: CardDefinition = { id: 'beast', name: 'Beast', type_line: 'Creature — Beast', oracle_text: '', mana_cost: '{3}', cmc: 3, colors: [], color_identity: [], keywords: [], card_types: ['creature'], power: 3, toughness: 3 };
const relic: CardDefinition = { id: 'relic', name: 'Relic', type_line: 'Artifact', oracle_text: '', mana_cost: '{2}', cmc: 2, colors: [], color_identity: [], keywords: [], card_types: ['artifact'] };

function gyState(): GameState {
  const mk = (id: string, defId: string, owner: string): CardInstance => ({ instanceId: id, definitionId: defId, ownerId: owner, zone: 'graveyard', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([
      ['c1', mk('c1', 'beast', 'p0')],
      ['c2', mk('c2', 'beast', 'p0')],
      ['a1', mk('a1', 'relic', 'p0')],   // artifact, should NOT come back for "creature cards"
      ['e1', mk('e1', 'beast', 'p1')],   // opponent's creature
    ]),
    cardDefinitions: new Map([['beast', beast], ['relic', relic]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 5,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

describe('ReturnAllFromGraveyard (mass reanimation)', () => {
  it('returns only your creature cards to the battlefield', () => {
    const p = parseOracleText('Return all creature cards from your graveyard to the battlefield.');
    if (p.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(gyState(), p.effects, 'p0', [], []);
    expect(s.cards.get('c1')!.zone).toBe('battlefield');
    expect(s.cards.get('c2')!.zone).toBe('battlefield');
    expect(s.cards.get('a1')!.zone).toBe('graveyard'); // artifact not returned
    expect(s.cards.get('e1')!.zone).toBe('graveyard'); // opponent's not returned (whose=yours)
  });

  it('"all graveyards" returns every creature card', () => {
    const p = parseOracleText('Return all creature cards from all graveyards to the battlefield.');
    if (p.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(gyState(), p.effects, 'p0', [], []);
    expect(s.cards.get('c1')!.zone).toBe('battlefield');
    expect(s.cards.get('e1')!.zone).toBe('battlefield'); // opponent's too
    expect(s.cards.get('a1')!.zone).toBe('graveyard');
  });
});
