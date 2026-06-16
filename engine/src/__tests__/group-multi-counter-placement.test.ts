import { describe, it, expect } from 'vitest';
import { executeEffects } from '../effects/executor';
import { parseOracleText } from '../effects/parser';
import type { GameState, CardInstance, CardDefinition } from '../types';

/**
 * Capability: group and multi-target counter placement
 *
 * Parser recognises two AddCounters phrasings it previously missed:
 *   (a) "put a <type> counter on each (other) [<subtype>] creature you control"
 *       -> AddCounters with AllCreaturesYouControl / AllCreaturesYouControlMatching
 *          (excludeSelf for "each other ...", which the executor's All* expansion
 *          honours by skipping the source permanent).
 *   (b) "put a <type> counter on each of up to N (other) target creatures
 *       (you control)" -> AddCounters against a SINGLE multi-target spec
 *       (count=N); the executor's AddCounters case applies the counters to
 *       EVERY chosen id via resolveChosenTargetIds.
 *
 * "Honest": the executor places real counters on exactly the right creatures —
 * every chosen/matching one, never the wrong permanent, never the source on an
 * "each other" wording.
 */

function makeDef(id: string, typeLine: string): CardDefinition {
  return {
    id,
    name: id,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: 2,
    toughness: 2,
    card_types: ['creature'],
  } as CardDefinition;
}

function makeCreature(instanceId: string, ownerId: string, definitionId = 'def-bear'): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone: 'battlefield',
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
  cardDefinitions.set('def-bear', makeDef('def-bear', 'Creature — Bear'));
  cardDefinitions.set('def-dragon', makeDef('def-dragon', 'Creature — Dragon'));

  // player-1 controls src (a Dragon), d1 (a Dragon), c1, c2 (Bears);
  // player-2 controls e1 (a Dragon) and e2 (a Bear).
  cards.set('src', makeCreature('src', 'player-1', 'def-dragon'));
  cards.set('d1', makeCreature('d1', 'player-1', 'def-dragon'));
  cards.set('c1', makeCreature('c1', 'player-1'));
  cards.set('c2', makeCreature('c2', 'player-1'));
  cards.set('e1', makeCreature('e1', 'player-2', 'def-dragon'));
  cards.set('e2', makeCreature('e2', 'player-2'));

  const players = ['player-1', 'player-2'].map((id, idx) => ({
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

const counters = (s: GameState, id: string, type: string) => s.cards.get(id)?.counters[type] ?? 0;

describe('group-multi-counter-placement', () => {
  // ----- (b) "each of up to N target creatures" — multi-target spec -----

  it('parses and executes "Put a shield counter on each of up to three target creatures." (Protection Magic)', () => {
    const parsed = parseOracleText('Put a shield counter on each of up to three target creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].count).toBe(3);
    expect(parsed.effects).toHaveLength(1);
    expect(parsed.effects[0]).toMatchObject({
      kind: 'AddCounters',
      counterType: 'shield',
      count: 1,
      target: { kind: 'Chosen', targetId: parsed.targets[0].id },
    });

    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['c1', 'e1', 'e2'], parsed.targets);
    expect(counters(r, 'c1', 'shield')).toBe(1);
    expect(counters(r, 'e1', 'shield')).toBe(1);
    expect(counters(r, 'e2', 'shield')).toBe(1);
    // Unchosen creatures untouched.
    expect(counters(r, 'c2', 'shield')).toBe(0);
    expect(counters(r, 'src', 'shield')).toBe(0);
  });

  it('parses and executes "Put a +1/+1 counter on each of up to two target creatures you control." (Earth Kingdom Soldier)', () => {
    const parsed = parseOracleText('Put a +1/+1 counter on each of up to two target creatures you control.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0]).toMatchObject({
      type: 'Creature',
      count: 2,
      constraints: { controllerControls: true },
    });
    expect(parsed.effects[0]).toMatchObject({ kind: 'AddCounters', counterType: '+1/+1', count: 1 });

    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['c1', 'c2'], parsed.targets);
    expect(counters(r, 'c1', '+1/+1')).toBe(1);
    expect(counters(r, 'c2', '+1/+1')).toBe(1);
    expect(counters(r, 'd1', '+1/+1')).toBe(0);
    expect(counters(r, 'e1', '+1/+1')).toBe(0);
  });

  it('parses ETB "put a +1/+1 counter on each of up to two other target creatures." (Angelic Quartermaster) and runs on both chosen', () => {
    const parsed = parseOracleText('When this creature enters, put a +1/+1 counter on each of up to two other target creatures.');
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'ETB', who: 'self' });
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0]).toMatchObject({
      type: 'Creature',
      count: 2,
      constraints: { notSource: true },
    });
    expect(parsed.ability.effects[0]).toMatchObject({
      kind: 'AddCounters',
      counterType: '+1/+1',
      count: 1,
      target: { kind: 'Chosen', targetId: parsed.targets[0].id },
    });

    const r = executeEffects(makeState(), parsed.ability.effects, 'player-1', ['c1', 'd1'], parsed.targets, 0, { sourceInstanceId: 'src' });
    expect(counters(r, 'c1', '+1/+1')).toBe(1);
    expect(counters(r, 'd1', '+1/+1')).toBe(1);
    expect(counters(r, 'src', '+1/+1')).toBe(0);
    expect(counters(r, 'c2', '+1/+1')).toBe(0);
  });

  it('"up to" with fewer chosen ids only places counters on the ids actually chosen', () => {
    const parsed = parseOracleText('Put a shield counter on each of up to three target creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['c2'], parsed.targets);
    expect(counters(r, 'c2', 'shield')).toBe(1);
    expect(counters(r, 'c1', 'shield')).toBe(0);
    expect(counters(r, 'e1', 'shield')).toBe(0);
  });

  // ----- (a) "each (other) [<subtype>] creature you control" — group placement -----

  it('parses "Whenever ~ enters or attacks, put a +1/+1 counter on each other creature you control." (Spider-Man, Miles Morales) and skips the source', () => {
    const parsed = parseOracleText('Whenever ~ enters or attacks, put a +1/+1 counter on each other creature you control.');
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    expect(parsed.targets).toHaveLength(0);
    expect(parsed.ability.effects[0]).toMatchObject({
      kind: 'AddCounters',
      target: { kind: 'AllCreaturesYouControl' },
      counterType: '+1/+1',
      count: 1,
      excludeSelf: true,
    });

    const r = executeEffects(makeState(), parsed.ability.effects, 'player-1', [], [], 0, { sourceInstanceId: 'src' });
    // Every OTHER creature player-1 controls gets a counter; the source does not.
    expect(counters(r, 'src', '+1/+1')).toBe(0);
    expect(counters(r, 'd1', '+1/+1')).toBe(1);
    expect(counters(r, 'c1', '+1/+1')).toBe(1);
    expect(counters(r, 'c2', '+1/+1')).toBe(1);
    // Opponent creatures untouched.
    expect(counters(r, 'e1', '+1/+1')).toBe(0);
    expect(counters(r, 'e2', '+1/+1')).toBe(0);
  });

  it('parses ETB "put a +1/+1 counter on each other Dragon creature you control." (Shieldhide Dragon) and only hits your other Dragons', () => {
    const parsed = parseOracleText('When this creature enters, put a +1/+1 counter on each other Dragon creature you control.');
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    expect(parsed.targets).toHaveLength(0);
    expect(parsed.ability.effects[0]).toMatchObject({
      kind: 'AddCounters',
      target: { kind: 'AllCreaturesYouControlMatching', filter: { types: ['creature'], subtypes: ['dragon'] } },
      counterType: '+1/+1',
      count: 1,
      excludeSelf: true,
    });

    const r = executeEffects(makeState(), parsed.ability.effects, 'player-1', [], [], 0, { sourceInstanceId: 'src' });
    expect(counters(r, 'd1', '+1/+1')).toBe(1); // your other Dragon
    expect(counters(r, 'src', '+1/+1')).toBe(0); // not the source itself
    expect(counters(r, 'c1', '+1/+1')).toBe(0); // not your non-Dragons
    expect(counters(r, 'c2', '+1/+1')).toBe(0);
    expect(counters(r, 'e1', '+1/+1')).toBe(0); // not the opponent's Dragon
  });

  // ----- regressions: existing single/group wordings unchanged -----

  it('regression: "Put a +1/+1 counter on each creature you control." still includes the source (no excludeSelf)', () => {
    const parsed = parseOracleText('Put a +1/+1 counter on each creature you control.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0]).toMatchObject({
      kind: 'AddCounters',
      target: { kind: 'AllCreaturesYouControl' },
      counterType: '+1/+1',
      count: 1,
    });
    expect('excludeSelf' in parsed.effects[0] && (parsed.effects[0] as { excludeSelf?: boolean }).excludeSelf).toBeFalsy();

    const r = executeEffects(makeState(), parsed.effects, 'player-1', [], [], 0, { sourceInstanceId: 'src' });
    expect(counters(r, 'src', '+1/+1')).toBe(1);
    expect(counters(r, 'd1', '+1/+1')).toBe(1);
    expect(counters(r, 'c1', '+1/+1')).toBe(1);
    expect(counters(r, 'e1', '+1/+1')).toBe(0);
  });

  it('regression: "Put a +1/+1 counter on target creature." still resolves a single chosen target', () => {
    const parsed = parseOracleText('Put a +1/+1 counter on target creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(1);

    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['e2'], parsed.targets);
    expect(counters(r, 'e2', '+1/+1')).toBe(1);
    expect(counters(r, 'c1', '+1/+1')).toBe(0);
  });
});
