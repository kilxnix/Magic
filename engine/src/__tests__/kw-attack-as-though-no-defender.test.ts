// Slice 6: Tests for "can attack as though it didn't have defender" parsing
// and execution — covers static (Felothar), conditional-static (Ogre Jailbreaker,
// Bristlepack Sentry), and activated/triggered (Wakestone Gargoyle, Krotiq
// Nestguard, Skyclave Squid) forms.

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { canDeclareAttacker, declareAttackers } from '../combat';
import { canAttackThisTurn, instanceHasKeyword } from '../keywords';
import { getCardsInZone, initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition, GameState, CardInstance } from '../types';
import type { Effect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function creatureDef(
  id: string,
  opts: {
    oracle?: string;
    keywords?: string[];
    power?: number;
    toughness?: number;
  } = {},
): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Test',
    oracle_text: opts.oracle ?? '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: opts.keywords ?? [],
    card_types: ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

/**
 * Build a minimal two-player game where p1 controls the given defs.
 * All of p1's creatures are on the battlefield and summoning-sick (entered
 * this turn). Continuous statics are registered as the real ETB pipeline does.
 */
function setup(defs: CardDefinition[]) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: defs, commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [creatureDef('dummy')], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);
  for (const [, card] of state.cards) {
    if (card.ownerId === 'p1') {
      // summoningSick: false so tests focus on Defender logic, not summoning sickness
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });
    }
  }
  state = { ...state, phase: 'combat', step: 'declare_attackers' };

  for (const c of getCardsInZone(state, 'p1', 'battlefield')) {
    state = registerContinuousAbilitiesForPermanent(state, c.instanceId);
  }

  const idFor = (defId: string) =>
    getCardsInZone(state, 'p1', 'battlefield')
      .find(c => state.cards.get(c.instanceId)!.definitionId === defId)!.instanceId;

  return { state, idFor };
}

// ---------------------------------------------------------------------------
// Minimal state for executor-only tests (no full game init needed)
// ---------------------------------------------------------------------------

function makeMinimalState(): GameState {
  const defId = 'def-defender';
  const instanceId = 'inst-defender';
  const cardDef: CardDefinition = {
    id: defId,
    name: 'DefenderCreature',
    type_line: 'Creature — Wall',
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: ['Defender'],
    card_types: ['creature'],
    power: 0,
    toughness: 4,
  };
  const cardInstance: CardInstance = {
    instanceId,
    definitionId: defId,
    ownerId: 'p1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
  const cards = new Map<string, CardInstance>();
  cards.set(instanceId, cardInstance);
  const cardDefinitions = new Map<string, CardDefinition>();
  cardDefinitions.set(defId, cardDef);

  return {
    players: [
      { id: 'p1', name: 'Alice', life: 40, handSize: 7, maxHandSize: 7,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasLost: false, isMonarch: false },
      { id: 'p2', name: 'Bob', life: 40, handSize: 7, maxHandSize: 7,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasLost: false, isMonarch: false },
    ],
    cards,
    cardDefinitions,
    stack: [],
    phase: 'combat',
    step: 'declare_attackers',
    activePlayerIndex: 0,
    turn: 1,
    combat: undefined,
    continuousEffects: [],
    pendingTriggers: [],
    exileZone: new Map(),
    creaturesDiedThisTurn: 0,
    commanderZoneChanges: new Map(),
  } as unknown as GameState;
}

// ===========================================================================
// 1. Parser recognition tests
// ===========================================================================

describe('Slice 6 — parser recognition: plain static (Felothar family)', () => {
  it('parses "Creatures you control can attack as though they didn\'t have defender." (Felothar)', () => {
    const r = parseOracleText("Creatures you control can attack as though they didn't have defender.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'IgnoreDefender' });
    expect(r.ability.controller).toBe('you');
    expect(r.ability.filter).toMatchObject({ types: ['creature'] });
  });

  it('parses self-only "~ can attack as though it didn\'t have defender."', () => {
    const r = parseOracleText("~ can attack as though it didn't have defender.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'IgnoreDefender' });
    expect(r.ability.selfOnly).toBe(true);
  });
});

describe('Slice 6 — parser recognition: conditional static (Ogre Jailbreaker family)', () => {
  it('parses "~ can attack as though it didn\'t have defender as long as you control a Wall." (Ogre Jailbreaker)', () => {
    const r = parseOracleText("~ can attack as though it didn't have defender as long as you control a Wall.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'IgnoreDefender' });
    // Condition: ControlsType with subtypes:['wall']
    expect(r.ability.condition).toBeDefined();
    expect(r.ability.condition?.kind).toBe('ControlsType');
  });

  it('parses "~ can attack as though it didn\'t have defender as long as you control a Forest." (Bristlepack Sentry)', () => {
    const r = parseOracleText("~ can attack as though it didn't have defender as long as you control a Forest.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'IgnoreDefender' });
    expect(r.ability.condition).toBeDefined();
    expect(r.ability.condition?.kind).toBe('ControlsType');
    if (r.ability.condition?.kind !== 'ControlsType') return;
    expect(r.ability.condition.filter).toMatchObject({ types: ['land'], subtypes: ['forest'] });
  });
});

describe('Slice 6 — parser recognition: activated/triggered form', () => {
  it('parses "This creature can attack this turn as though it didn\'t have defender." (Wakestone Gargoyle / Krotiq Nestguard body)', () => {
    const r = parseOracleText("{2}{G}: This creature can attack this turn as though it didn't have defender.");
    // The activated ability body should contain a GrantKeyword(IgnoreDefender) effect.
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];
    expect(ability).toBeDefined();
    const gkEffect = ability.effects.find(e => e.kind === 'GrantKeyword');
    expect(gkEffect).toBeDefined();
    if (!gkEffect || gkEffect.kind !== 'GrantKeyword') return;
    expect(gkEffect.keyword).toBe('IgnoreDefender');
    expect(gkEffect.untilEndOfTurn).toBe(true);
  });

  it('parses the trigger body "~ can attack this turn as though it didn\'t have defender." (Skyclave Squid landfall body)', () => {
    // Tests that the effect clause in a landfall-style trigger body is recognized.
    // The "Landfall — " ability-word prefix is stripped at the card-definition
    // level (normalizeOracleText / registerContinuousAbilitiesForPermanent), so
    // we pass the already-normalized "Whenever …" form here.
    const r = parseOracleText(
      "Whenever a land enters the battlefield under your control, ~ can attack this turn as though it didn't have defender."
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    const gkEffect = r.ability.effects.find(e => e.kind === 'GrantKeyword');
    expect(gkEffect).toBeDefined();
    if (!gkEffect || gkEffect.kind !== 'GrantKeyword') return;
    expect(gkEffect.keyword).toBe('IgnoreDefender');
    expect(gkEffect.untilEndOfTurn).toBe(true);
  });
});

// ===========================================================================
// 2. Execution tests — IgnoreDefender in grantedKeywords bypasses Defender
// ===========================================================================

describe('Slice 6 — execution: GrantKeyword(IgnoreDefender) enables Defender creatures to attack', () => {
  it('executeEffects writes IgnoreDefender into grantedKeywords of the Source creature', () => {
    const state = makeMinimalState();
    const instanceId = 'inst-defender';

    // Confirm the creature has Defender before the grant.
    expect(instanceHasKeyword(state, instanceId, 'Defender')).toBe(true);
    expect(canAttackThisTurn(state, instanceId)).toBe(false);

    const effects: Effect[] = [
      {
        kind: 'GrantKeyword',
        target: { kind: 'Source' },
        keyword: 'IgnoreDefender',
        untilEndOfTurn: true,
      },
    ];

    const newState = executeEffects(state, effects, 'p1', [], [], 0, { sourceInstanceId: instanceId });
    const card = newState.cards.get(instanceId)!;
    expect(card.grantedKeywords).toContain('IgnoreDefender');

    // With IgnoreDefender granted, Defender should no longer block attacking.
    expect(instanceHasKeyword(newState, instanceId, 'IgnoreDefender')).toBe(true);
    expect(canAttackThisTurn(newState, instanceId)).toBe(true);
  });
});

// ===========================================================================
// 3. Engine enforcement — static form lets Defender creatures attack
// ===========================================================================

describe('Slice 6 — engine enforcement: static "Creatures you control can attack as though they didn\'t have defender"', () => {
  it('a Defender creature without the static CANNOT attack (control)', () => {
    const { state, idFor } = setup([
      creatureDef('vanilla-wall', { keywords: ['Defender'] }),
    ]);
    const id = idFor('vanilla-wall');
    expect(instanceHasKeyword(state, id, 'Defender')).toBe(true);
    expect(canAttackThisTurn(state, id)).toBe(false);
    expect(canDeclareAttacker(state, 'p1', id)).toBe(false);
  });

  it('Felothar-style lord lets Defender creatures you control attack', () => {
    const { state, idFor } = setup([
      creatureDef('felothar-lord', {
        oracle: "Creatures you control can attack as though they didn't have defender.",
      }),
      creatureDef('wall-soldier', { keywords: ['Defender'] }),
    ]);
    const wallId = idFor('wall-soldier');

    // The lord's continuous static grants IgnoreDefender to all your creatures.
    expect(instanceHasKeyword(state, wallId, 'IgnoreDefender')).toBe(true);
    expect(canAttackThisTurn(state, wallId)).toBe(true);
    expect(canDeclareAttacker(state, 'p1', wallId)).toBe(true);

    const after = declareAttackers(state, 'p1', [
      { cardInstanceId: wallId, defendingPlayerId: 'p2' },
    ]);
    expect(after.combat!.attackers.map(a => a.cardInstanceId)).toContain(wallId);
  });

  it('self-static "~ can attack as though it didn\'t have defender" lets the source itself attack', () => {
    const { state, idFor } = setup([
      creatureDef('self-wall', {
        keywords: ['Defender'],
        oracle: "~ can attack as though it didn't have defender.",
      }),
    ]);
    const id = idFor('self-wall');

    expect(instanceHasKeyword(state, id, 'Defender')).toBe(true);
    expect(instanceHasKeyword(state, id, 'IgnoreDefender')).toBe(true);
    expect(canAttackThisTurn(state, id)).toBe(true);
    expect(canDeclareAttacker(state, 'p1', id)).toBe(true);
  });
});
