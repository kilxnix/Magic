import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

const forest: CardDefinition = { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [], card_types: ['land'] };
const bear: CardDefinition = { id: 'bear', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'], power: 2, toughness: 2 };

function state(topDefId: string): GameState {
  const top: CardInstance = { instanceId: 'top', definitionId: topDefId, ownerId: 'p0', zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false };
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([['top', top]]), cardDefinitions: new Map([['forest', forest], ['bear', bear]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

describe('RevealTopMatch', () => {
  const text = "Reveal the top card of your library. If it's a land card, put it into your hand.";

  it('puts the top card into hand when it matches the filter (land)', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(state('forest'), p.effects, 'p0', [], []);
    expect(s.cards.get('top')!.zone).toBe('hand');
  });

  it('leaves the top card on the library when it does not match', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(state('bear'), p.effects, 'p0', [], []);
    expect(s.cards.get('top')!.zone).toBe('library');
  });
});
