/**
 * Slice 11 (engine-gap) — The Immortal Sun, Reflecting Pool, Bloom Tender
 *
 * Implemented subsystems:
 *   1. DrawStep trigger (Immortal Sun line 1):
 *        "At the beginning of your draw step, draw an additional card."
 *        Parses as Triggered { kind: 'DrawStep', whose: 'yours' }.
 *        DrawStepStart game event fires from advanceStepWithTurnActions when
 *        entering the draw step; the trigger queues a Draw effect.
 *   2. ReduceCost static (Immortal Sun line 2):
 *        "Spells you cast cost {1} less to cast."
 *        Parses as StaticAbility ReduceCost; getCostReduction returns 1.
 *   3. ModifyPT anthem (Immortal Sun line 3):
 *        "Creatures you control get +1/+1."
 *        Parses as StaticAbility ModifyPT; getContinuousPTModification returns +1/+1.
 *   4. Planeswalker loyalty restriction is honestly absorbed (no loyalty system).
 *   5. Reflecting Pool mana:
 *        "{T}: Add one mana of any type that a land you control could produce."
 *        getAvailableManaColors returns the union of OTHER lands' colors;
 *        tapLandForMana adds the chosen color.
 *   6. Bloom Tender mana:
 *        "{T}: For each color among permanents you control, add one mana of that color."
 *        getAvailableManaColors returns all colors present among your permanents;
 *        tapLandForMana adds ALL those colors simultaneously (one each).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { CardDefinition, CardInstance, GameState, Player } from '../types';
import { emptyManaPool } from '../types';
import { parseOracleText } from '../effects/parser';
import {
  registerContinuousAbilitiesForPermanent,
  registerBattlefieldAbilities,
  checkTriggersForEvent,
  putTriggersOnStack,
  resolveTopOfStack,
} from '../stack';
import {
  getCostReduction,
  getContinuousPTModification,
  resetContinuousTimestamp,
} from '../effects/continuous';
import { getAvailableManaColors, tapLandForMana } from '../actions';
import { advanceStepWithTurnActions } from '../turn-actions';

// ============================================================================
// Oracle text constants (exact Scryfall wording)
// ============================================================================

const IMMORTAL_SUN_ORACLE =
  'At the beginning of your draw step, draw an additional card.\n' +
  'Spells you cast cost {1} less to cast.\n' +
  'Creatures you control get +1/+1.\n' +
  "Players can't activate planeswalkers' loyalty abilities.";

const REFLECTING_POOL_ORACLE =
  '{T}: Add one mana of any type that a land you control could produce.';

const BLOOM_TENDER_ORACLE =
  '{T}: For each color among permanents you control, add one mana of that color.';

// ============================================================================
// Test helpers
// ============================================================================

function makePlayer(id: string): Player {
  return {
    id, name: id, life: 40,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    manaPool: emptyManaPool(),
    snowManaPool: emptyManaPool(),
    restrictedMana: [], conditionalMana: [],
    hasPlayedLand: false, landsPlayedThisTurn: 0,
    hasPriority: false, hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  opts: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId, definitionId, ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...opts,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Artifact',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{6}',
    cmc: opts.cmc ?? 6,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['artifact'],
    power: opts.power,
    toughness: opts.toughness,
  };
}

function makeState(
  cards: [string, CardInstance][],
  defs: [string, CardDefinition][],
  overrides: Partial<GameState> = {},
): GameState {
  return {
    players: overrides.players ?? [makePlayer('p1'), makePlayer('p2')],
    cards: new Map(cards),
    cardDefinitions: new Map(defs),
    activePlayerIndex: overrides.activePlayerIndex ?? 0,
    priorityPlayerIndex: overrides.priorityPlayerIndex ?? 0,
    phase: overrides.phase ?? 'beginning',
    step: overrides.step ?? 'upkeep',
    turnNumber: overrides.turnNumber ?? 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: [],
    spellsCastThisTurn: 0,
    creaturesDiedThisTurn: 0,
    playersWhoAttackedThisTurn: [],
    damagePreventionEffects: [],
    gameOutcomePreventionEffects: [],
    spellCastProhibitions: [],
  } as GameState;
}

function handCount(state: GameState, playerId: string): number {
  let n = 0;
  for (const card of state.cards.values()) {
    if (card.ownerId === playerId && card.zone === 'hand') n++;
  }
  return n;
}

// ============================================================================
// 1. DrawStep trigger parse
// ============================================================================

describe('Immortal Sun — DrawStep trigger parse', () => {
  it('parses the draw-step line as Triggered with DrawStep trigger', () => {
    const line = 'At the beginning of your draw step, draw an additional card.';
    const result = parseOracleText(line);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'DrawStep', whose: 'yours' });
    expect(result.ability.effects).toHaveLength(1);
    const eff = result.ability.effects[0] as { kind: string; count: number };
    expect(eff.kind).toBe('Draw');
    expect(eff.count).toBe(1);
  });

  it('does NOT parse the draw-step line as an upkeep trigger', () => {
    const line = 'At the beginning of your draw step, draw an additional card.';
    const result = parseOracleText(line);
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger.kind).not.toBe('Upkeep');
  });
});

// ============================================================================
// 2. ReduceCost static parse
// ============================================================================

describe('Immortal Sun — ReduceCost static parse', () => {
  it('parses "Spells you cast cost {1} less to cast." as StaticAbility ReduceCost', () => {
    const line = 'Spells you cast cost {1} less to cast.';
    const result = parseOracleText(line);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('ReduceCost');
    if (result.ability.modifier.kind !== 'ReduceCost') return;
    expect(result.ability.modifier.amount).toBe(1);
    expect(result.ability.controller).toBe('you');
  });
});

// ============================================================================
// 3. +1/+1 anthem static parse
// ============================================================================

describe('Immortal Sun — ModifyPT anthem parse', () => {
  it('parses "Creatures you control get +1/+1." as StaticAbility ModifyPT', () => {
    const line = 'Creatures you control get +1/+1.';
    const result = parseOracleText(line);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('ModifyPT');
    if (result.ability.modifier.kind !== 'ModifyPT') return;
    expect(result.ability.modifier.power).toBe(1);
    expect(result.ability.modifier.toughness).toBe(1);
  });
});

// ============================================================================
// 4. Full multi-line Immortal Sun oracle text parses (per-line dispatch)
// ============================================================================

describe('Immortal Sun — multi-line oracle registers statics + trigger', () => {
  beforeEach(() => resetContinuousTimestamp());

  it('registers ReduceCost continuous effect per registerContinuousAbilitiesForPermanent', () => {
    const sunDef = makeDef('immortal-sun', {
      name: 'The Immortal Sun',
      type_line: 'Legendary Artifact',
      oracle_text: IMMORTAL_SUN_ORACLE,
      card_types: ['artifact'],
    });
    const sunInst = makeCard('sun1', 'immortal-sun', 'p1');
    let state = makeState(
      [['sun1', sunInst]],
      [['immortal-sun', sunDef]],
    );
    state = registerContinuousAbilitiesForPermanent(state, 'sun1');
    // cost reduction of 1
    const reduction = getCostReduction(state, 'p1');
    expect(reduction).toBe(1);
    // opponents are NOT reduced
    const opponentReduction = getCostReduction(state, 'p2');
    expect(opponentReduction).toBe(0);
  });

  it('registers +1/+1 continuous effect and applies it to a creature', () => {
    const sunDef = makeDef('immortal-sun', {
      name: 'The Immortal Sun',
      type_line: 'Legendary Artifact',
      oracle_text: IMMORTAL_SUN_ORACLE,
      card_types: ['artifact'],
    });
    const creatureDef = makeDef('bear', {
      name: 'Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });
    const sunInst = makeCard('sun1', 'immortal-sun', 'p1');
    const bearInst = makeCard('bear1', 'bear', 'p1');
    let state = makeState(
      [['sun1', sunInst], ['bear1', bearInst]],
      [['immortal-sun', sunDef], ['bear', creatureDef]],
    );
    state = registerContinuousAbilitiesForPermanent(state, 'sun1');
    const ptMod = getContinuousPTModification(state, 'bear1');
    expect(ptMod.power).toBe(1);
    expect(ptMod.toughness).toBe(1);
  });

  it('registers the DrawStep triggered ability via registerBattlefieldAbilities', () => {
    const sunDef = makeDef('immortal-sun', {
      name: 'The Immortal Sun',
      type_line: 'Legendary Artifact',
      oracle_text: IMMORTAL_SUN_ORACLE,
      card_types: ['artifact'],
    });
    const sunInst = makeCard('sun1', 'immortal-sun', 'p1');
    let state = makeState(
      [['sun1', sunInst]],
      [['immortal-sun', sunDef]],
    );
    state = registerBattlefieldAbilities(state, 'sun1');
    const abilities = state.battlefieldAbilities.get('sun1');
    expect(abilities).toBeDefined();
    const drawStepAbility = abilities?.find(a => a.trigger.kind === 'DrawStep');
    expect(drawStepAbility).toBeDefined();
  });
});

// ============================================================================
// 5. DrawStep trigger EXECUTION — fires on draw step, player draws extra card
// ============================================================================

describe('Immortal Sun — DrawStepStart event fires trigger → extra draw', () => {
  it('queues a pending trigger when DrawStepStart fires for the controller', () => {
    const sunDef = makeDef('immortal-sun', {
      name: 'The Immortal Sun',
      type_line: 'Legendary Artifact',
      oracle_text: IMMORTAL_SUN_ORACLE,
      card_types: ['artifact'],
    });
    const sunInst = makeCard('sun1', 'immortal-sun', 'p1');
    let state = makeState(
      [['sun1', sunInst]],
      [['immortal-sun', sunDef]],
    );
    state = registerBattlefieldAbilities(state, 'sun1');
    state = checkTriggersForEvent(state, { kind: 'DrawStepStart', activePlayerId: 'p1' });
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0].controllerId).toBe('p1');
    expect(state.pendingTriggers[0].ability.trigger.kind).toBe('DrawStep');
  });

  it('does NOT fire the trigger on the draw step of an opponent', () => {
    const sunDef = makeDef('immortal-sun', {
      name: 'The Immortal Sun',
      type_line: 'Legendary Artifact',
      oracle_text: IMMORTAL_SUN_ORACLE,
      card_types: ['artifact'],
    });
    const sunInst = makeCard('sun1', 'immortal-sun', 'p1');
    let state = makeState(
      [['sun1', sunInst]],
      [['immortal-sun', sunDef]],
    );
    state = registerBattlefieldAbilities(state, 'sun1');
    state = checkTriggersForEvent(state, { kind: 'DrawStepStart', activePlayerId: 'p2' });
    expect(state.pendingTriggers).toHaveLength(0);
  });

  it('resolving the trigger draws an extra card for p1', () => {
    const sunDef = makeDef('immortal-sun', {
      name: 'The Immortal Sun',
      type_line: 'Legendary Artifact',
      oracle_text: IMMORTAL_SUN_ORACLE,
      card_types: ['artifact'],
    });
    const libraryDef = makeDef('dummy-card', {
      name: 'Dummy Card',
      oracle_text: '',
      card_types: ['instant'],
    });
    const sunInst = makeCard('sun1', 'immortal-sun', 'p1');
    // Add some library cards for p1 to draw
    const lib1 = makeCard('lib1', 'dummy-card', 'p1', { zone: 'library' });
    const lib2 = makeCard('lib2', 'dummy-card', 'p1', { zone: 'library' });

    let state = makeState(
      [['sun1', sunInst], ['lib1', lib1], ['lib2', lib2]],
      [['immortal-sun', sunDef], ['dummy-card', libraryDef]],
    );
    state = registerBattlefieldAbilities(state, 'sun1');

    const baseHandCount = handCount(state, 'p1');

    // Fire the draw-step trigger
    state = checkTriggersForEvent(state, { kind: 'DrawStepStart', activePlayerId: 'p1' });
    expect(state.pendingTriggers).toHaveLength(1);

    // Put on stack and resolve
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    // p1 should have drawn 1 extra card
    expect(handCount(state, 'p1')).toBe(baseHandCount + 1);
  });

  it('advanceStepWithTurnActions into draw step fires DrawStepStart and yields +1 draw', () => {
    const sunDef = makeDef('immortal-sun', {
      name: 'The Immortal Sun',
      type_line: 'Legendary Artifact',
      oracle_text: IMMORTAL_SUN_ORACLE,
      card_types: ['artifact'],
    });
    const libraryDef = makeDef('dummy-card', {
      name: 'Dummy Card',
      oracle_text: '',
      card_types: ['instant'],
    });
    const sunInst = makeCard('sun1', 'immortal-sun', 'p1');
    const lib1 = makeCard('lib1', 'dummy-card', 'p1', { zone: 'library' });
    const lib2 = makeCard('lib2', 'dummy-card', 'p1', { zone: 'library' });
    const lib3 = makeCard('lib3', 'dummy-card', 'p1', { zone: 'library' });

    let state = makeState(
      [['sun1', sunInst], ['lib1', lib1], ['lib2', lib2], ['lib3', lib3]],
      [['immortal-sun', sunDef], ['dummy-card', libraryDef]],
      { phase: 'beginning', step: 'upkeep', turnNumber: 2 },
    );
    state = registerBattlefieldAbilities(state, 'sun1');

    const baseHandCount = handCount(state, 'p1');

    // Advance from upkeep to draw step: mandatory draw (1 card) + trigger queued
    state = advanceStepWithTurnActions(state);
    expect(state.step).toBe('draw');
    // The mandatory draw happens inline; the trigger is pending
    expect(handCount(state, 'p1')).toBe(baseHandCount + 1);
    expect(state.pendingTriggers).toHaveLength(1);

    // Resolve the pending trigger (draws 1 more)
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(handCount(state, 'p1')).toBe(baseHandCount + 2);
  });
});

// ============================================================================
// 6. Reflecting Pool — mana colors and tap
// ============================================================================

describe('Reflecting Pool — getAvailableManaColors and tapLandForMana', () => {
  it('returns the union of other lands colors (forest + island → G + U)', () => {
    const rpDef = makeDef('reflecting-pool', {
      name: 'Reflecting Pool',
      type_line: 'Land',
      oracle_text: REFLECTING_POOL_ORACLE,
      card_types: ['land'],
      mana_cost: '',
      cmc: 0,
    });
    const forestDef = makeDef('forest', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
      card_types: ['land'],
      mana_cost: '',
      cmc: 0,
    });
    const islandDef = makeDef('island', {
      name: 'Island',
      type_line: 'Basic Land — Island',
      oracle_text: '{T}: Add {U}.',
      card_types: ['land'],
      mana_cost: '',
      cmc: 0,
    });
    const rpInst = makeCard('rp1', 'reflecting-pool', 'p1');
    const forInst = makeCard('for1', 'forest', 'p1');
    const islInst = makeCard('isl1', 'island', 'p1');

    const state = makeState(
      [['rp1', rpInst], ['for1', forInst], ['isl1', islInst]],
      [['reflecting-pool', rpDef], ['forest', forestDef], ['island', islandDef]],
    );
    const colors = getAvailableManaColors(state, 'rp1');
    expect(colors).toContain('G');
    expect(colors).toContain('U');
    expect(colors).not.toContain('W');
    expect(colors).not.toContain('R');
    expect(colors).not.toContain('B');
  });

  it('returns empty when controller has no other lands', () => {
    const rpDef = makeDef('reflecting-pool', {
      name: 'Reflecting Pool',
      type_line: 'Land',
      oracle_text: REFLECTING_POOL_ORACLE,
      card_types: ['land'],
      mana_cost: '',
      cmc: 0,
    });
    const rpInst = makeCard('rp1', 'reflecting-pool', 'p1');
    const state = makeState([['rp1', rpInst]], [['reflecting-pool', rpDef]]);
    const colors = getAvailableManaColors(state, 'rp1');
    expect(colors).toHaveLength(0);
  });

  it('tapLandForMana adds Green mana when Forest is controlled', () => {
    const rpDef = makeDef('reflecting-pool', {
      name: 'Reflecting Pool',
      type_line: 'Land',
      oracle_text: REFLECTING_POOL_ORACLE,
      card_types: ['land'],
      mana_cost: '',
      cmc: 0,
    });
    const forestDef = makeDef('forest', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
      card_types: ['land'],
      mana_cost: '',
      cmc: 0,
    });
    const rpInst = makeCard('rp1', 'reflecting-pool', 'p1');
    const forInst = makeCard('for1', 'forest', 'p1');

    let state = makeState(
      [['rp1', rpInst], ['for1', forInst]],
      [['reflecting-pool', rpDef], ['forest', forestDef]],
    );
    state = tapLandForMana(state, 'p1', 'rp1', 'G');
    const p1 = state.players.find(p => p.id === 'p1')!;
    expect(p1.manaPool.G).toBe(1);
    expect(state.cards.get('rp1')?.tapped).toBe(true);
  });

  it('tapLandForMana throws when the requested color is not available', () => {
    const rpDef = makeDef('reflecting-pool', {
      name: 'Reflecting Pool',
      type_line: 'Land',
      oracle_text: REFLECTING_POOL_ORACLE,
      card_types: ['land'],
      mana_cost: '',
      cmc: 0,
    });
    const forestDef = makeDef('forest', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
      card_types: ['land'],
      mana_cost: '',
      cmc: 0,
    });
    const rpInst = makeCard('rp1', 'reflecting-pool', 'p1');
    const forInst = makeCard('for1', 'forest', 'p1');

    const state = makeState(
      [['rp1', rpInst], ['for1', forInst]],
      [['reflecting-pool', rpDef], ['forest', forestDef]],
    );
    // Forest only produces G, so W is not available
    expect(() => tapLandForMana(state, 'p1', 'rp1', 'W')).toThrow();
  });
});

// ============================================================================
// 7. Bloom Tender — mana colors and tap
// ============================================================================

describe('Bloom Tender — getAvailableManaColors and tapLandForMana', () => {
  it('returns colors present among all permanents you control (W + G from elf + plains)', () => {
    const btDef = makeDef('bloom-tender', {
      name: 'Bloom Tender',
      type_line: 'Creature — Elf Druid',
      oracle_text: BLOOM_TENDER_ORACLE,
      card_types: ['creature'],
      colors: ['G'],
      power: 1,
      toughness: 1,
      mana_cost: '{1}{G}',
      cmc: 2,
    });
    const plainsDef = makeDef('plains', {
      name: 'Plains',
      type_line: 'Basic Land — Plains',
      oracle_text: '{T}: Add {W}.',
      card_types: ['land'],
      colors: ['W'],
      mana_cost: '',
      cmc: 0,
    });
    const btInst = makeCard('bt1', 'bloom-tender', 'p1');
    const plainsInst = makeCard('plains1', 'plains', 'p1');

    const state = makeState(
      [['bt1', btInst], ['plains1', plainsInst]],
      [['bloom-tender', btDef], ['plains', plainsDef]],
    );
    const colors = getAvailableManaColors(state, 'bt1');
    // Bloom Tender itself is G, Plains is W
    expect(colors).toContain('G');
    expect(colors).toContain('W');
    expect(colors).not.toContain('U');
    expect(colors).not.toContain('B');
    expect(colors).not.toContain('R');
  });

  it('returns empty when no colored permanents are controlled', () => {
    const btDef = makeDef('bloom-tender', {
      name: 'Bloom Tender',
      type_line: 'Creature — Elf Druid',
      oracle_text: BLOOM_TENDER_ORACLE,
      card_types: ['creature'],
      colors: [],  // artificially colorless for this test
      power: 1,
      toughness: 1,
      mana_cost: '{1}{G}',
      cmc: 2,
    });
    const btInst = makeCard('bt1', 'bloom-tender', 'p1');
    const state = makeState([['bt1', btInst]], [['bloom-tender', btDef]]);
    const colors = getAvailableManaColors(state, 'bt1');
    expect(colors).toHaveLength(0);
  });

  it('tapLandForMana adds ALL colors simultaneously (G + W when controlling G creature + W land)', () => {
    const btDef = makeDef('bloom-tender', {
      name: 'Bloom Tender',
      type_line: 'Creature — Elf Druid',
      oracle_text: BLOOM_TENDER_ORACLE,
      card_types: ['creature'],
      colors: ['G'],
      power: 1,
      toughness: 1,
      mana_cost: '{1}{G}',
      cmc: 2,
    });
    const plainsDef = makeDef('plains', {
      name: 'Plains',
      type_line: 'Basic Land — Plains',
      oracle_text: '{T}: Add {W}.',
      card_types: ['land'],
      colors: ['W'],
      mana_cost: '',
      cmc: 0,
    });
    const btInst = makeCard('bt1', 'bloom-tender', 'p1');
    const plainsInst = makeCard('plains1', 'plains', 'p1');

    let state = makeState(
      [['bt1', btInst], ['plains1', plainsInst]],
      [['bloom-tender', btDef], ['plains', plainsDef]],
    );
    // Tap bloom tender for G (it adds ALL colors simultaneously)
    state = tapLandForMana(state, 'p1', 'bt1', 'G');
    const p1 = state.players.find(p => p.id === 'p1')!;
    expect(p1.manaPool.G).toBe(1);
    expect(p1.manaPool.W).toBe(1);
    expect(state.cards.get('bt1')?.tapped).toBe(true);
  });

  it('tapLandForMana is blocked by summoning sickness', () => {
    const btDef = makeDef('bloom-tender', {
      name: 'Bloom Tender',
      type_line: 'Creature — Elf Druid',
      oracle_text: BLOOM_TENDER_ORACLE,
      card_types: ['creature'],
      colors: ['G'],
      power: 1,
      toughness: 1,
      mana_cost: '{1}{G}',
      cmc: 2,
    });
    const btInst = makeCard('bt1', 'bloom-tender', 'p1', { summoningSick: true });
    const state = makeState([['bt1', btInst]], [['bloom-tender', btDef]]);
    expect(() => tapLandForMana(state, 'p1', 'bt1', 'G')).toThrow();
  });
});

// ============================================================================
// 8. Leyline of the Guildpact — line 2 "Each nonland permanent you control is all colors."
//    IMPLEMENTED: the engine now has a Layer 5 color-override (SetAllColors
//    modifier + getEffectiveColors). The oracle text parses as StaticAbility
//    and is enforced end-to-end. See leyline-guildpact-set-all-colors.test.ts.
// ============================================================================

const LEYLINE_ORACLE =
  'If Leyline of the Guildpact is in your opening hand, you may begin the game with it on the battlefield.\n' +
  'Each nonland permanent you control is all colors.';

describe('Leyline of the Guildpact — color override line now parses as StaticAbility', () => {
  it('parses "Each nonland permanent you control is all colors." as a StaticAbility with SetAllColors modifier', () => {
    const line = 'Each nonland permanent you control is all colors.';
    const result = parseOracleText(line);
    // The engine now has a Layer 5 color-override layer (SetAllColors +
    // getEffectiveColors in continuous.ts + matchesCardFilter integration).
    // The parse is honest — the executor enforces this effect.
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('SetAllColors');
  });
});
