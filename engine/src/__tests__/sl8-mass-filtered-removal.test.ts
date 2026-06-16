import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';

/**
 * Slice 8: filtered mass-removal matchers.
 *
 * Covers new matchers in mass-effects.ts:
 *   matchDestroyAllNoncolorCreatures  — "Destroy all nonwhite creatures." (Mass Calcify)
 *   matchDestroyAllTokenFilter        — "Destroy all nontoken creatures." (Hour of Reckoning)
 *                                       "Exile all nontoken creatures."
 *   matchReturnAllTokenFilter         — "Return all creature tokens to their owners' hands." (Perplexing Test)
 *                                       "Return all nontoken creatures to their owners' hands."
 *   matchDestroyAllLegendaryFilter    — "Destroy all legendary creatures." (Invasion of Fiora)
 *                                       "Destroy all nonlegendary creatures."
 *   matchExileAllSubtypeCreatures     — "Exile all Dragon creatures." / "Exile all non-Dragon creatures."
 *   matchDestroyAllBlockingBlocked    — "Destroy all blocking creatures and all blocked creatures." (Fight to the Death)
 *
 * Each test verifies the parser emits the correct Effect AST, and the executor
 * correctly applies the filter (honesty check).
 */

// ── Shared card definitions ──────────────────────────────────────────────────

const defs: Record<string, CardDefinition> = {
  whiteSoldier: {
    id: 'whiteSoldier', name: 'White Soldier',
    type_line: 'Creature — Human Soldier',
    oracle_text: '', mana_cost: '{W}', cmc: 1,
    colors: ['W'], color_identity: ['W'],
    keywords: [], card_types: ['creature'], power: 1, toughness: 1,
  },
  blackZombie: {
    id: 'blackZombie', name: 'Black Zombie',
    type_line: 'Creature — Zombie',
    oracle_text: '', mana_cost: '{B}', cmc: 1,
    colors: ['B'], color_identity: ['B'],
    keywords: [], card_types: ['creature'], power: 1, toughness: 1,
  },
  greenDragon: {
    id: 'greenDragon', name: 'Shivan Dragon',
    type_line: 'Creature — Dragon',
    oracle_text: '', mana_cost: '{4}{R}{R}', cmc: 6,
    colors: ['R'], color_identity: ['R'],
    keywords: ['flying'], card_types: ['creature'], power: 5, toughness: 5,
  },
  legendaryCreature: {
    id: 'legendaryCreature', name: 'Mox Ruby',
    type_line: 'Legendary Creature — Human',
    oracle_text: '', mana_cost: '{3}', cmc: 3,
    colors: [], color_identity: [],
    keywords: [], card_types: ['creature'], power: 2, toughness: 2,
  },
  nonLegendaryCreature: {
    id: 'nonLegendaryCreature', name: 'Grizzly Bears',
    type_line: 'Creature — Bear',
    oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
    colors: ['G'], color_identity: ['G'],
    keywords: [], card_types: ['creature'], power: 2, toughness: 2,
  },
  tokenDef: {
    id: 'tokenDef', name: '1/1 Soldier Token',
    type_line: 'Token Creature — Soldier',
    oracle_text: '', mana_cost: '', cmc: 0,
    colors: ['W'], color_identity: ['W'],
    keywords: [], card_types: ['creature'], power: 1, toughness: 1,
  },
};

// ── State builder ─────────────────────────────────────────────────────────────

function mkCard(id: string, defId: string, owner = 'p0', extra: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId: id, definitionId: defId, ownerId: owner,
    zone: 'battlefield', tapped: false, summoningSick: false,
    counters: {}, damage: 0, isCommander: false,
    ...extra,
  };
}

function mkState(cards: CardInstance[], combat?: CombatState): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(Object.entries(defs)),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'combat', step: 'declare_blockers', turnNumber: 1,
    hasPriorityPassed: [false, false], stack: [],
    combat: combat ?? null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zone(state: GameState, id: string): string | undefined {
  return state.cards.get(id)?.zone;
}

function effects(text: string): Effect[] {
  const parsed = parseOracleText(text);
  expect(parsed.kind).toBe('Spell');
  if (parsed.kind !== 'Spell') throw new Error('not a spell');
  return parsed.effects;
}

// ── Parse tests ───────────────────────────────────────────────────────────────

describe('sl8-mass-filtered-removal: parse correctness', () => {

  it('Mass Calcify: "Destroy all nonwhite creatures." → Destroy AllOfType excludeColors W', () => {
    const fx = effects('Destroy all nonwhite creatures.');
    expect(fx).toHaveLength(1);
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.kind).toBe('Destroy');
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], excludeColors: ['W'] },
    });
  });

  it('Their Name Is Death: "Destroy all nonblack creatures." → excludeColors B', () => {
    const fx = effects('Destroy all nonblack creatures.');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], excludeColors: ['B'] },
    });
  });

  it('"Exile all nonred creatures." → Exile AllOfType excludeColors R', () => {
    const fx = effects('Exile all nonred creatures.');
    expect(fx[0].kind).toBe('Exile');
    const e = fx[0] as Extract<Effect, { kind: 'Exile' }>;
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], excludeColors: ['R'] },
    });
  });

  it('Hour of Reckoning: "Destroy all nontoken creatures." → Destroy AllOfType nontoken', () => {
    const fx = effects('Destroy all nontoken creatures.');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], nontoken: true },
    });
  });

  it('"Exile all nontoken creatures." → Exile AllOfType nontoken', () => {
    const fx = effects('Exile all nontoken creatures.');
    expect(fx[0].kind).toBe('Exile');
    const e = fx[0] as Extract<Effect, { kind: 'Exile' }>;
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], nontoken: true },
    });
  });

  it('Perplexing Test bullet 1: "Return all creature tokens to their owners\' hands." → tokenOnly', () => {
    const fx = effects("Return all creature tokens to their owners' hands.");
    const e = fx[0] as Extract<Effect, { kind: 'ReturnToHand' }>;
    expect(e.kind).toBe('ReturnToHand');
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], tokenOnly: true },
    });
  });

  it('Perplexing Test bullet 2: "Return all nontoken creatures to their owners\' hands." → nontoken', () => {
    const fx = effects("Return all nontoken creatures to their owners' hands.");
    const e = fx[0] as Extract<Effect, { kind: 'ReturnToHand' }>;
    expect(e.kind).toBe('ReturnToHand');
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], nontoken: true },
    });
  });

  it('Invasion of Fiora: "Destroy all legendary creatures." → Destroy supertypes legendary', () => {
    const fx = effects('Destroy all legendary creatures.');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], supertypes: ['legendary'] },
    });
  });

  it('Invasion of Fiora: "Destroy all nonlegendary creatures." → excludeSupertypes legendary', () => {
    const fx = effects('Destroy all nonlegendary creatures.');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], excludeSupertypes: ['legendary'] },
    });
  });

  it('"Exile all Dragon creatures." → Exile AllOfType subtypes dragon', () => {
    const fx = effects('Exile all Dragon creatures.');
    expect(fx[0].kind).toBe('Exile');
    const e = fx[0] as Extract<Effect, { kind: 'Exile' }>;
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], subtypes: ['dragon'] },
    });
  });

  it('"Exile all non-Dragon creatures." → Exile AllOfType excludeSubtypes dragon', () => {
    const fx = effects('Exile all non-Dragon creatures.');
    const e = fx[0] as Extract<Effect, { kind: 'Exile' }>;
    expect(e.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['creature'], excludeSubtypes: ['dragon'] },
    });
  });

  it('Fight to the Death: "Destroy all blocking creatures and all blocked creatures." → two effects', () => {
    const fx = effects('Destroy all blocking creatures and all blocked creatures.');
    expect(fx).toHaveLength(2);
    const [e1, e2] = fx as [Extract<Effect, { kind: 'Destroy' }>, Extract<Effect, { kind: 'Destroy' }>];
    expect(e1.kind).toBe('Destroy');
    expect(e1.target).toEqual({ kind: 'AllOfType', filter: { types: ['creature'], blocking: true } });
    expect(e2.kind).toBe('Destroy');
    expect(e2.target).toEqual({ kind: 'AllOfType', filter: { types: ['creature'], blocked: true } });
  });

  it('"Destroy all blocking creatures." → single effect blocking: true', () => {
    const fx = effects('Destroy all blocking creatures.');
    expect(fx).toHaveLength(1);
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.target).toEqual({ kind: 'AllOfType', filter: { types: ['creature'], blocking: true } });
  });

  it('no regression: "Destroy all creatures." still maps to AllCreatures', () => {
    const fx = effects('Destroy all creatures.');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.target).toEqual({ kind: 'AllCreatures' });
  });

  it('no regression: "Destroy all Dragon creatures." still maps via subtype matcher', () => {
    const fx = effects('Destroy all Dragon creatures.');
    const e = fx[0] as Extract<Effect, { kind: 'Destroy' }>;
    expect(e.target).toEqual({ kind: 'AllOfType', filter: { types: ['creature'], subtypes: ['dragon'] } });
  });
});

// ── Executor tests ────────────────────────────────────────────────────────────

describe('sl8-mass-filtered-removal: executor honesty', () => {

  it('Destroy all nonwhite creatures: destroys black, spares white', () => {
    const state = mkState([
      mkCard('ws1', 'whiteSoldier'), // white — should survive
      mkCard('bz1', 'blackZombie'),  // black — should die
    ]);
    const parsed = parseOracleText('Destroy all nonwhite creatures.');
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const result = executeEffects(state, parsed.effects, 'p0', [], []);
    expect(zone(result, 'ws1')).toBe('battlefield'); // white spared
    expect(zone(result, 'bz1')).toBe('graveyard');   // nonwhite destroyed
  });

  it('Destroy all nontoken creatures: destroys nontoken, spares token', () => {
    const state = mkState([
      mkCard('bz1', 'blackZombie', 'p0', { isToken: false }), // nontoken — dies
      mkCard('tok1', 'tokenDef', 'p0', { isToken: true }),     // token — survives
    ]);
    const parsed = parseOracleText('Destroy all nontoken creatures.');
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const result = executeEffects(state, parsed.effects, 'p0', [], []);
    expect(zone(result, 'bz1')).toBe('graveyard');   // nontoken dies
    expect(zone(result, 'tok1')).toBe('battlefield'); // token lives
  });

  it('Return all creature tokens: bounces tokens, leaves nontokens', () => {
    const state = mkState([
      mkCard('bz1', 'blackZombie', 'p0', { isToken: false }), // nontoken — stays
      mkCard('tok1', 'tokenDef', 'p0', { isToken: true }),     // token — bounced
    ]);
    const parsed = parseOracleText("Return all creature tokens to their owners' hands.");
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const result = executeEffects(state, parsed.effects, 'p0', [], []);
    expect(zone(result, 'bz1')).toBe('battlefield'); // nontoken stays
    expect(zone(result, 'tok1')).toBe('hand');        // token bounced
  });

  it('Return all nontoken creatures: bounces nontokens, leaves tokens', () => {
    const state = mkState([
      mkCard('bz1', 'blackZombie', 'p0', { isToken: false }), // nontoken — bounced
      mkCard('tok1', 'tokenDef', 'p0', { isToken: true }),     // token — stays
    ]);
    const parsed = parseOracleText("Return all nontoken creatures to their owners' hands.");
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const result = executeEffects(state, parsed.effects, 'p0', [], []);
    expect(zone(result, 'bz1')).toBe('hand');         // nontoken bounced
    expect(zone(result, 'tok1')).toBe('battlefield'); // token stays
  });

  it('Destroy all legendary creatures: destroys legendary, spares nonlegendary', () => {
    const state = mkState([
      mkCard('leg1', 'legendaryCreature'),    // legendary — dies
      mkCard('bear1', 'nonLegendaryCreature'), // nonlegendary — survives
    ]);
    const parsed = parseOracleText('Destroy all legendary creatures.');
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const result = executeEffects(state, parsed.effects, 'p0', [], []);
    expect(zone(result, 'leg1')).toBe('graveyard');   // legendary dies
    expect(zone(result, 'bear1')).toBe('battlefield'); // nonlegendary survives
  });

  it('Destroy all nonlegendary creatures: destroys nonlegendary, spares legendary', () => {
    const state = mkState([
      mkCard('leg1', 'legendaryCreature'),    // legendary — survives
      mkCard('bear1', 'nonLegendaryCreature'), // nonlegendary — dies
    ]);
    const parsed = parseOracleText('Destroy all nonlegendary creatures.');
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const result = executeEffects(state, parsed.effects, 'p0', [], []);
    expect(zone(result, 'leg1')).toBe('battlefield'); // legendary survives
    expect(zone(result, 'bear1')).toBe('graveyard');  // nonlegendary dies
  });

  it('Exile all Dragon creatures: exiles dragons, spares non-dragons', () => {
    const state = mkState([
      mkCard('drag1', 'greenDragon'),   // Dragon — exiled
      mkCard('bear1', 'nonLegendaryCreature'), // Bear — survives
    ]);
    const parsed = parseOracleText('Exile all Dragon creatures.');
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const result = executeEffects(state, parsed.effects, 'p0', [], []);
    expect(zone(result, 'drag1')).toBe('exile');       // Dragon exiled
    expect(zone(result, 'bear1')).toBe('battlefield'); // Bear spared
  });

  it('Destroy all blocking creatures: only destroys creatures in combat.blockers', () => {
    const state = mkState(
      [
        mkCard('attacker1', 'whiteSoldier'),  // attacker — not a blocker, survives
        mkCard('blocker1', 'blackZombie'),    // blocker — dies
        mkCard('bystander1', 'nonLegendaryCreature'), // not in combat — survives
      ],
      {
        attackers: [{ cardInstanceId: 'attacker1', defendingPlayerId: 'p1' }],
        blockers: [{ cardInstanceId: 'blocker1', blockingAttackerId: 'attacker1' }],
        damageAssignment: new Map(),
      },
    );
    const parsed = parseOracleText('Destroy all blocking creatures.');
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const result = executeEffects(state, parsed.effects, 'p0', [], []);
    expect(zone(result, 'attacker1')).toBe('battlefield');   // attacker survives
    expect(zone(result, 'blocker1')).toBe('graveyard');      // blocker dies
    expect(zone(result, 'bystander1')).toBe('battlefield');  // bystander survives
  });

  it('Fight to the Death: "Destroy all blocking and all blocked creatures." — both sets destroyed', () => {
    const state = mkState(
      [
        mkCard('attacker1', 'whiteSoldier'),  // blocked attacker — dies
        mkCard('blocker1', 'blackZombie'),    // blocker — dies
        mkCard('unblockedAttacker', 'nonLegendaryCreature'), // unblocked — survives (attacker but not blocked)
        mkCard('bystander1', 'legendaryCreature'), // bystander — survives
      ],
      {
        attackers: [
          { cardInstanceId: 'attacker1', defendingPlayerId: 'p1' },
          { cardInstanceId: 'unblockedAttacker', defendingPlayerId: 'p1' },
        ],
        blockers: [{ cardInstanceId: 'blocker1', blockingAttackerId: 'attacker1' }],
        damageAssignment: new Map(),
      },
    );
    const parsed = parseOracleText('Destroy all blocking creatures and all blocked creatures.');
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const result = executeEffects(state, parsed.effects, 'p0', [], []);
    expect(zone(result, 'attacker1')).toBe('graveyard');          // blocked attacker dies
    expect(zone(result, 'blocker1')).toBe('graveyard');           // blocker dies
    expect(zone(result, 'unblockedAttacker')).toBe('battlefield'); // unblocked attacker survives
    expect(zone(result, 'bystander1')).toBe('battlefield');        // bystander survives
  });
});
