/**
 * Slice 10 — Pump + "gain all creature types" until end of turn
 *
 * Tests cover:
 *   1. Parser: Volatile Claws style — "creatures you control get +2/+0 and gain all creature types until end of turn."
 *   2. Parser: leading-duration form — "until end of turn, creatures you control get +2/+0 and gain all creature types."
 *   3. Parser: Blades of Velis Vel style — "up to two target creatures each get +2/+0 and gain all creature types until end of turn."
 *   4. Parser: single-target form — "target creature gets +2/+0 and gain all creature types until end of turn."
 *   5. Executor: GrantAllCreatureTypes on AllCreaturesYouControl sets grantedAllCreatureTypes flag
 *   6. Executor: subtype filter on matchesCardFilter bypasses when grantedAllCreatureTypes is set
 *   7. Executor: end-of-turn cleanup clears grantedAllCreatureTypes
 *   8. Executor: ModifyPT side also applies alongside the grant
 */

import { describe, it, expect } from 'vitest';
import { executeEffects } from '../effects/executor';
import { parseOracleText } from '../effects/parser';
import { cleanupDamage } from '../state-based';
import type { Effect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';
import { matchesCardFilter } from '../effects/executor';

function makeDef(
  id: string,
  typeLine: string,
  card_types: string[],
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: id,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: card_types as CardDefinition['card_types'],
    power: 2,
    toughness: 2,
    ...opts,
  } as CardDefinition;
}

function makeCard(instanceId: string, definitionId: string, ownerId: string, zone: CardInstance['zone'] = 'battlefield'): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  } as CardInstance;
}

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  // p1 controls a Human Warrior (non-Elf) and an Elf Warrior
  cardDefinitions.set('def-human', makeDef('def-human', 'Creature — Human Warrior', ['creature']));
  cardDefinitions.set('def-elf', makeDef('def-elf', 'Creature — Elf Warrior', ['creature']));
  // p2 controls an Elf
  cardDefinitions.set('def-elf2', makeDef('def-elf2', 'Creature — Elf Scout', ['creature']));

  cards.set('human-1', makeCard('human-1', 'def-human', 'p1'));
  cards.set('elf-1', makeCard('elf-1', 'def-elf', 'p1'));
  cards.set('elf-2', makeCard('elf-2', 'def-elf2', 'p2'));

  const players = ['p1', 'p2'].map((id, idx) => ({
    id,
    name: id,
    life: 40,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    hasPlayedLand: false,
    hasPriority: idx === 0,
    hasLost: false,
  }));

  return {
    players,
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
  } as GameState;
}

describe('slice10-pump-all-creature-types', () => {
  // ── Parser tests ─────────────────────────────────────────────────────────

  it('Volatile Claws: "creatures you control get +2/+0 and gain all creature types until end of turn." parses to two effects', () => {
    const parsed = parseOracleText(
      'Until end of turn, creatures you control get +2/+0 and gain all creature types.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(2);
    const [pump, grant] = parsed.effects;
    expect(pump.kind).toBe('ModifyPT');
    if (pump.kind !== 'ModifyPT') return;
    expect(pump.target.kind).toBe('AllCreaturesYouControl');
    expect(pump.power).toBe(2);
    expect(pump.toughness).toBe(0);
    expect(pump.untilEndOfTurn).toBe(true);
    expect(grant.kind).toBe('GrantAllCreatureTypes');
    if (grant.kind !== 'GrantAllCreatureTypes') return;
    expect(grant.target.kind).toBe('AllCreaturesYouControl');
    expect(grant.untilEndOfTurn).toBe(true);
  });

  it('trailing-duration form: "Creatures you control get +2/+0 and gain all creature types until end of turn." parses correctly', () => {
    const parsed = parseOracleText(
      'Creatures you control get +2/+0 and gain all creature types until end of turn.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(2);
    const [pump, grant] = parsed.effects;
    expect(pump.kind).toBe('ModifyPT');
    if (pump.kind !== 'ModifyPT') return;
    expect(pump.target.kind).toBe('AllCreaturesYouControl');
    expect(grant.kind).toBe('GrantAllCreatureTypes');
  });

  it('Shields of Velis Vel: "+0/+1 and gain all creature types until end of turn" variant parses', () => {
    const parsed = parseOracleText(
      'Creatures you control get +0/+1 and gain all creature types until end of turn.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(2);
    const [pump, grant] = parsed.effects;
    expect(pump.kind).toBe('ModifyPT');
    if (pump.kind !== 'ModifyPT') return;
    expect(pump.power).toBe(0);
    expect(pump.toughness).toBe(1);
    expect(grant.kind).toBe('GrantAllCreatureTypes');
  });

  it('Blades of Velis Vel: "up to two target creatures each get +2/+0 and gain all creature types until end of turn." parses', () => {
    const parsed = parseOracleText(
      'Up to two target creatures each get +2/+0 and gain all creature types until end of turn.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(2);
    const [pump, grant] = parsed.effects;
    expect(pump.kind).toBe('ModifyPT');
    if (pump.kind !== 'ModifyPT') return;
    expect(pump.target.kind).toBe('Chosen');
    expect(pump.power).toBe(2);
    expect(pump.toughness).toBe(0);
    expect(grant.kind).toBe('GrantAllCreatureTypes');
    if (grant.kind !== 'GrantAllCreatureTypes') return;
    expect(grant.target.kind).toBe('Chosen');
    // Should have a multi-target spec (count >= 2)
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(2);
    expect(parsed.targets[0].minCount).toBe(1);
  });

  it('single-target form: "target creature gets +2/+0 and gain all creature types until end of turn." parses', () => {
    const parsed = parseOracleText(
      'Target creature gets +2/+0 and gain all creature types until end of turn.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(2);
    const [pump, grant] = parsed.effects;
    expect(pump.kind).toBe('ModifyPT');
    if (pump.kind !== 'ModifyPT') return;
    expect(pump.target.kind).toBe('Chosen');
    expect(grant.kind).toBe('GrantAllCreatureTypes');
    if (grant.kind !== 'GrantAllCreatureTypes') return;
    expect(grant.target.kind).toBe('Chosen');
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(1);
  });

  // ── Executor tests ────────────────────────────────────────────────────────

  it('GrantAllCreatureTypes (AllCreaturesYouControl) sets grantedAllCreatureTypes on caster creatures only', () => {
    const state = makeState();
    const effects: Effect[] = [
      {
        kind: 'GrantAllCreatureTypes',
        target: { kind: 'AllCreaturesYouControl' },
        untilEndOfTurn: true,
      },
    ];
    const result = executeEffects(state, effects, 'p1', [], []);

    expect(result.cards.get('human-1')?.grantedAllCreatureTypes).toBe(true);
    expect(result.cards.get('elf-1')?.grantedAllCreatureTypes).toBe(true);
    expect(result.cards.get('elf-2')?.grantedAllCreatureTypes).toBeUndefined(); // opponent's creature
  });

  it('matchesCardFilter subtype check passes for a card with grantedAllCreatureTypes set', () => {
    const state = makeState();
    // Set grantedAllCreatureTypes on human-1 (which has no Elf subtype in its def)
    const updatedCards = new Map(state.cards);
    updatedCards.set('human-1', { ...state.cards.get('human-1')!, grantedAllCreatureTypes: true });
    const stateWithGrant = { ...state, cards: updatedCards };

    const humanDef = state.cardDefinitions.get('def-human')!;
    // Without the flag — should NOT match Elf filter
    expect(matchesCardFilter(humanDef, { subtypes: ['elf'] })).toBe(false);

    // With the flag (instance context provided) — should match Elf filter
    expect(
      matchesCardFilter(humanDef, { subtypes: ['elf'] }, { state: stateWithGrant, instanceId: 'human-1' }),
    ).toBe(true);
  });

  it('ModifyPT applies +2/+0 to all controlled creatures on top of the grant', () => {
    const state = makeState();
    const effects: Effect[] = [
      {
        kind: 'ModifyPT',
        target: { kind: 'AllCreaturesYouControl' },
        power: 2,
        toughness: 0,
        untilEndOfTurn: true,
      },
      {
        kind: 'GrantAllCreatureTypes',
        target: { kind: 'AllCreaturesYouControl' },
        untilEndOfTurn: true,
      },
    ];
    const result = executeEffects(state, effects, 'p1', [], []);

    // Pump side: _powerMod counter incremented by +2
    expect(result.cards.get('human-1')?.counters['_powerMod']).toBe(2);
    expect(result.cards.get('elf-1')?.counters['_powerMod']).toBe(2);
    expect(result.cards.get('elf-2')?.counters['_powerMod']).toBeUndefined(); // opponent untouched

    // Grant side
    expect(result.cards.get('human-1')?.grantedAllCreatureTypes).toBe(true);
    expect(result.cards.get('elf-1')?.grantedAllCreatureTypes).toBe(true);
  });

  it('end-of-turn cleanup clears grantedAllCreatureTypes', () => {
    const state = makeState();
    const effects: Effect[] = [
      {
        kind: 'GrantAllCreatureTypes',
        target: { kind: 'AllCreaturesYouControl' },
        untilEndOfTurn: true,
      },
    ];
    const granted = executeEffects(state, effects, 'p1', [], []);
    expect(granted.cards.get('human-1')?.grantedAllCreatureTypes).toBe(true);

    const cleaned = cleanupDamage(granted);
    expect(cleaned.cards.get('human-1')?.grantedAllCreatureTypes).toBeUndefined();
    expect(cleaned.cards.get('elf-1')?.grantedAllCreatureTypes).toBeUndefined();
  });

  it('full parse + execute: Volatile Claws text pumps and grants all creature types to caster creatures', () => {
    const state = makeState();
    const parsed = parseOracleText(
      'Until end of turn, creatures you control get +2/+0 and gain all creature types.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const result = executeEffects(state, parsed.effects, 'p1', [], []);

    // Pump applied
    expect(result.cards.get('human-1')?.counters['_powerMod']).toBe(2);
    expect(result.cards.get('elf-1')?.counters['_powerMod']).toBe(2);

    // Grant applied to caster's creatures only
    expect(result.cards.get('human-1')?.grantedAllCreatureTypes).toBe(true);
    expect(result.cards.get('elf-1')?.grantedAllCreatureTypes).toBe(true);
    expect(result.cards.get('elf-2')?.grantedAllCreatureTypes).toBeUndefined();

    // After cleanup, both clear
    const cleaned = cleanupDamage(result);
    expect(cleaned.cards.get('human-1')?.counters['_powerMod']).toBeUndefined();
    expect(cleaned.cards.get('human-1')?.grantedAllCreatureTypes).toBeUndefined();
  });
});
