import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { declareAttackers, getRequiredAttackers, mustAttackIfAble } from '../combat';

// A vanilla-ish beater whose ONLY ability is the must-attack static, using the
// card's real name as the self-reference (parseOracleText does not normalize
// names to `~`).
function beaterDef(oracle: string, name = 'Bloodrock Cyclops'): CardDefinition {
  return {
    id: 'beater', name, type_line: 'Creature — Cyclops Warrior',
    oracle_text: oracle, mana_cost: '{2}{R}', cmc: 3, colors: ['R'], color_identity: ['R'],
    keywords: [], card_types: ['creature'], power: 4, toughness: 1,
  };
}

function makeCard(instanceId: string, definitionId: string, ownerId: string, over: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false, ...over,
  };
}

function stateWith(def: CardDefinition): GameState {
  const defs = new Map<string, CardDefinition>([[def.id, def]]);
  const cards = new Map<string, CardInstance>([
    ['atk', makeCard('atk', def.id, 'p0', { summoningSick: false })],
  ]);
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards,
    cardDefinitions: defs,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'combat',
    step: 'declare_attackers',
    turnNumber: 5,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    playersWhoAttackedThisTurn: [],
  };
}

describe('must-attack: parser recognition', () => {
  it('parses "<name> attacks each combat if able." as a self StaticAbility', () => {
    const parsed = parseOracleText('Bloodrock Cyclops attacks each combat if able.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.selfOnly).toBe(true);
  });

  it('parses the "attacks each turn if able" variant too', () => {
    const parsed = parseOracleText('Juggernaut attacks each turn if able.');
    expect(parsed.kind).toBe('StaticAbility');
  });

  it('does NOT claim a face it cannot run (leaves unrelated text Unparsed)', () => {
    const parsed = parseOracleText('Whenever Foo does something inscrutable, glorp the wibble.');
    expect(parsed.kind).toBe('Unparsed');
  });
});

describe('must-attack: honest combat enforcement', () => {
  it('forces the creature to be declared as an attacker (engine executes it)', () => {
    const state = stateWith(beaterDef('Bloodrock Cyclops attacks each combat if able.'));

    // Engine recognizes the requirement directly from oracle text.
    expect(mustAttackIfAble(state, 'atk')).toBe(true);
    expect(getRequiredAttackers(state, 'p0')).toContain('atk');

    // Declaring an empty attack set is illegal: the creature MUST attack.
    expect(() => declareAttackers(state, 'p0', [])).toThrow(/attacks each combat if able/i);

    // Declaring the creature as an attacker is legal and produces combat.
    const after = declareAttackers(state, 'p0', [{ cardInstanceId: 'atk', defendingPlayerId: 'p1' }]);
    expect(after.combat?.attackers.map(a => a.cardInstanceId)).toContain('atk');
  });

  it('does not force an attack when the creature cannot attack (tapped)', () => {
    const state = stateWith(beaterDef('Bloodrock Cyclops attacks each combat if able.'));
    state.cards.set('atk', makeCard('atk', 'beater', 'p0', { tapped: true }));

    // A tapped creature cannot attack, so it is not a required attacker and an
    // empty declaration is legal (CR "if able").
    expect(getRequiredAttackers(state, 'p0')).not.toContain('atk');
    expect(() => declareAttackers(state, 'p0', [])).not.toThrow();
  });
});
