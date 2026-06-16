import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

function state(): GameState {
  const def: CardDefinition = {
    id: 'd', name: 'Thopter', type_line: 'Artifact Creature — Thopter', oracle_text: '',
    mana_cost: '{2}', cmc: 2, colors: [], color_identity: [], keywords: [], card_types: ['artifact', 'creature'], power: 1, toughness: 1,
  };
  const inst: CardInstance = {
    instanceId: 'c0', definitionId: 'd', ownerId: 'p0', zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([['c0', inst]]), cardDefinitions: new Map([['d', def]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

describe('self-sacrifice', () => {
  it('parses "Sacrifice this creature." with self flag', () => {
    const p = parseOracleText('Sacrifice this creature.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const sac = p.effects.find(e => e.kind === 'Sacrifice');
    expect(sac && (sac as { self?: boolean }).self).toBe(true);
  });

  it('sacrifices the source permanent', () => {
    const p = parseOracleText('Sacrifice this creature.');
    if (p.kind !== 'Spell') throw new Error('expected spell');
    let s = state();
    s = executeEffects(s, p.effects, 'p0', [], [], 0, { sourceInstanceId: 'c0' });
    expect(s.cards.get('c0')!.zone).toBe('graveyard');
  });
});
