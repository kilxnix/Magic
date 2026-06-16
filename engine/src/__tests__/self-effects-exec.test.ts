import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

function makeState(over: Partial<CardInstance> = {}): GameState {
  const def: CardDefinition = {
    id: 'd', name: 'Beast', type_line: 'Creature — Beast', oracle_text: '',
    mana_cost: '{2}', cmc: 2, colors: [], color_identity: [], keywords: [], card_types: ['creature'], power: 2, toughness: 2,
  };
  const inst: CardInstance = {
    instanceId: 'c0', definitionId: 'd', ownerId: 'p0', zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false, ...over,
  };
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([['c0', inst]]), cardDefinitions: new Map([['d', def]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function run(text: string, over: Partial<CardInstance> = {}): GameState {
  const p = parseOracleText(text);
  if (p.kind !== 'Spell') throw new Error(`expected spell for "${text}", got ${p.kind}`);
  return executeEffects(makeState(over), p.effects, 'p0', [], [], 0, { sourceInstanceId: 'c0' });
}

describe('self-reference effects execute (no crash) against the source', () => {
  it('Tap it.', () => { expect(run('Tap it.').cards.get('c0')!.tapped).toBe(true); });
  it('Untap it.', () => { expect(run('Untap it.', { tapped: true }).cards.get('c0')!.tapped).toBe(false); });
  it('Exile it.', () => { expect(run('Exile it.').cards.get('c0')!.zone).toBe('exile'); });
  it('Destroy it.', () => { expect(run('Destroy it.').cards.get('c0')!.zone).toBe('graveyard'); });
  it('Sacrifice it.', () => { expect(run('Sacrifice it.').cards.get('c0')!.zone).toBe('graveyard'); });
  it("Return it to its owner's hand.", () => { expect(run("Return it to its owner's hand.").cards.get('c0')!.zone).toBe('hand'); });
  it('Put a +1/+1 counter on it.', () => { expect(run('Put a +1/+1 counter on it.').cards.get('c0')!.counters['+1/+1']).toBe(1); });
});
