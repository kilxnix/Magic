/**
 * Slice 9: Type-filtered "as though they had flash" battlefield statics.
 *
 * Covers:
 *  1. Parser recognition — all supported oracle shapes.
 *  2. Honesty — declined shapes.
 *  3. Engine enforcement — canCastSpell grants instant-speed via a registered
 *     battlefield permanent (Vivien / Prophet-of-Kruphix style).
 *  4. Type filter specificity — only spells of the matching type get the grant.
 *  5. Subtype forms — Aura and Equipment / Dragon-plus-artifact.
 *  6. Color-qualified form — "green creature spells" (Yeva).
 *  7. Noncreature form (Valley Floodcaller style).
 *  8. Any-player caster scope — Vernal Equinox / Quick Sliver style.
 *  9. Sorcery-type filter — Najal / Gandalf style.
 * 10. Sorcery-speed baseline still works.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { canCastSpell, registerContinuousAbilitiesForPermanent } from '../stack';
import { GameState, CardDefinition, emptyManaPool, createPlayer, Phase, Step } from '../types';
import { populateParsedCache } from '../cards/card-parser-cache';

// ---------------------------------------------------------------------------
// Minimal test helpers (mirrored from legal-actions.test.ts pattern)
// ---------------------------------------------------------------------------

function createTestState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [
      { ...createPlayer('p1', 'Player 1'), hasPriority: true },
      { ...createPlayer('p2', 'Player 2'), hasPriority: false },
    ],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as Phase,
    step: 'main' as Step,
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    ...overrides,
  };
}

function addCard(
  state: GameState,
  instanceId: string,
  ownerId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard' | 'command',
  def: Partial<CardDefinition>,
): void {
  const baseDef: CardDefinition = {
    id: def.id ?? instanceId,
    name: def.name ?? 'Test Card',
    type_line: def.type_line ?? 'Creature',
    oracle_text: def.oracle_text ?? '',
    mana_cost: def.mana_cost ?? '',
    cmc: def.cmc ?? 0,
    colors: def.colors ?? [],
    color_identity: def.color_identity ?? [],
    keywords: def.keywords ?? [],
    card_types: def.card_types ?? ['creature'],
    power: def.power,
    toughness: def.toughness,
  };
  const fullDef = populateParsedCache(baseDef);
  state.cardDefinitions.set(fullDef.id, fullDef);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: fullDef.id,
    ownerId,
    zone,
    tapped: false,
    summoningSick: zone === 'battlefield',
    counters: {},
    damage: 0,
    isCommander: false,
  });
}

// ---------------------------------------------------------------------------
// 1. Parser recognition
// ---------------------------------------------------------------------------

describe('matchTypeFilteredAsThoughFlash — parser recognition', () => {
  // --- Vivien / Prophet of Kruphix / Sally Sparrow ---
  it('SHAPE: "You may cast creature spells as though they had flash."', () => {
    const r = parseOracleText('You may cast creature spells as though they had flash.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter).toBeDefined();
    expect(mod.typeFilter?.types).toContain('creature');
    expect(r.ability.selfOnly).toBe(false);
    expect(r.ability.controller).toBe('you');
  });

  // --- Najal / Gandalf, Friend of the Shire ---
  it('SHAPE: "You may cast sorcery spells as though they had flash."', () => {
    const r = parseOracleText('You may cast sorcery spells as though they had flash.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter?.types).toContain('sorcery');
  });

  // --- Sigarda's Aid ---
  it('SHAPE: "You may cast Aura and Equipment spells as though they had flash."', () => {
    const r = parseOracleText('You may cast Aura and Equipment spells as though they had flash.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter).toBeDefined();
    // Combined subtypes: aura and equipment
    const filter = mod.typeFilter!;
    const subtypes = filter.subtypes ?? filter.anyOf?.flatMap(f => f.subtypes ?? []);
    expect(subtypes).toContain('aura');
    expect(subtypes).toContain('equipment');
  });

  // --- Renari, Merchant of Marvels ---
  it('SHAPE: "You may cast Dragon spells and artifact spells as though they had flash."', () => {
    const r = parseOracleText('You may cast Dragon spells and artifact spells as though they had flash.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter).toBeDefined();
    // anyOf (mixed subtype + type) or combined
    const filter = mod.typeFilter!;
    const allSubtypes = filter.subtypes ?? filter.anyOf?.flatMap(f => f.subtypes ?? []) ?? [];
    const allTypes = filter.types ?? filter.anyOf?.flatMap(f => f.types ?? []) ?? [];
    expect(allSubtypes).toContain('dragon');
    expect(allTypes).toContain('artifact');
  });

  // --- Yeva, Nature's Herald ---
  it('SHAPE: "You may cast green creature spells as though they had flash."', () => {
    const r = parseOracleText('You may cast green creature spells as though they had flash.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter).toBeDefined();
    const filter = mod.typeFilter!;
    expect(filter.types).toContain('creature');
    expect(filter.colors).toContain('G');
  });

  // --- Quick Sliver (any player) ---
  it('SHAPE: "Any player may cast Sliver spells as though they had flash."', () => {
    const r = parseOracleText('Any player may cast Sliver spells as though they had flash.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter?.subtypes).toContain('sliver');
    expect(r.ability.controller).toBe('any');
  });

  // --- Vernal Equinox (any player, two types) ---
  it('SHAPE: "Any player may cast creature and enchantment spells as though they had flash."', () => {
    const r = parseOracleText('Any player may cast creature and enchantment spells as though they had flash.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter).toBeDefined();
    const allTypes = (mod.typeFilter?.types ?? []).concat(
      mod.typeFilter?.anyOf?.flatMap(f => f.types ?? []) ?? [],
    );
    expect(allTypes).toContain('creature');
    expect(allTypes).toContain('enchantment');
    expect(r.ability.controller).toBe('any');
  });

  // --- Valley Floodcaller (noncreature) ---
  it('SHAPE: "You may cast noncreature spells as though they had flash."', () => {
    const r = parseOracleText('You may cast noncreature spells as though they had flash.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter?.excludeTypes).toContain('creature');
  });

  // --- Gandalf the White (legendary + artifact) ---
  it('SHAPE: "You may cast legendary spells and artifact spells as though they had flash."', () => {
    const r = parseOracleText('You may cast legendary spells and artifact spells as though they had flash.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter).toBeDefined();
    const allSupertypes = (mod.typeFilter?.supertypes ?? []).concat(
      mod.typeFilter?.anyOf?.flatMap(f => f.supertypes ?? []) ?? [],
    );
    expect(allSupertypes).toContain('legendary');
  });
});

// ---------------------------------------------------------------------------
// 2. Honesty — declined shapes
// ---------------------------------------------------------------------------

describe('matchTypeFilteredAsThoughFlash — honesty gate', () => {
  it('declines "this turn" temporal qualifier (Alchemist\'s Refuge style)', () => {
    const r = parseOracleText('You may cast spells this turn as though they had flash.');
    expect(r.kind).not.toBe('StaticAbility');
  });

  // Slice 12: "historic" is now SUPPORTED as anyOf[legendary|artifact|Saga].
  // The old "decline" was lifted in Slice 12. Raff Capashen parses successfully.
  it('accepts "historic" category (Raff Capashen) — Slice 12 extension', () => {
    const r = parseOracleText('You may cast historic spells as though they had flash.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter).toBeDefined();
    // Historic = legendary | artifact | Saga — represented as anyOf
    const filter = mod.typeFilter!;
    expect(filter.anyOf).toBeDefined();
    const allSupertypes = filter.anyOf?.flatMap(f => f.supertypes ?? []) ?? [];
    const allTypes = filter.anyOf?.flatMap(f => f.types ?? []) ?? [];
    const allSubtypes = filter.anyOf?.flatMap(f => f.subtypes ?? []) ?? [];
    expect(allSupertypes).toContain('legendary');
    expect(allTypes).toContain('artifact');
    expect(allSubtypes).toContain('saga');
  });

  it('declines "colorless" (Skittering Cicada)', () => {
    const r = parseOracleText('You may cast colorless spells as though they had flash.');
    expect(r.kind).not.toBe('StaticAbility');
  });

  it('declines "with mana value 3 or less" form (Aluren)', () => {
    const r = parseOracleText('Any player may cast creature spells with mana value 3 or less without paying their mana costs and as though they had flash.');
    expect(r.kind).not.toBe('StaticAbility');
  });

  it('declines "with enchant creature" qualifier (Rootwater Shaman)', () => {
    const r = parseOracleText('You may cast Aura spells with enchant creature as though they had flash.');
    expect(r.kind).not.toBe('StaticAbility');
  });

  it('does NOT match "cast this spell as though it had flash" — that is matchAsThoughFlash territory', () => {
    // The self-spell form should still parse as AsThoughFlash (selfOnly: true).
    const r = parseOracleText('You may cast this spell as though it had flash.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    // It should be selfOnly (self-oracle form), NOT the type-filtered form.
    expect(r.ability.selfOnly).toBe(true);
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Engine enforcement — canCastSpell via registered battlefield permanent
// ---------------------------------------------------------------------------

/**
 * Build a minimal two-player state where:
 *   - p1 has a permanent on the battlefield whose oracle text grants type-filtered flash
 *   - p1 has a sorcery spell in hand
 *   - p2 is the active player (so p1 is NOT in the sorcery window)
 */
function setupBattlefieldFlash(
  grantOracle: string,
  spellDef: { oracle: string; types: string[]; typeLine: string; colors: string[]; cardTypes: string[] },
): { state: GameState; spellId: string } {
  let state = createTestState({
    activePlayerIndex: 1, // p2 is active — p1 is outside sorcery window
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as Phase,
  });

  // Give p1 plenty of mana
  state.players[0].manaPool = { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 };

  // Add the flash-granting permanent to p1's battlefield
  addCard(state, 'vivien_1', 'p1', 'battlefield', {
    id: 'vivien_def',
    name: 'Flash Granter',
    type_line: 'Creature',
    oracle_text: grantOracle,
    mana_cost: '{3}{G}',
    cmc: 4,
    colors: ['G'],
    card_types: ['creature'],
  });

  // Register its continuous abilities
  state = registerContinuousAbilitiesForPermanent(state, 'vivien_1');

  // Add the spell to p1's hand
  addCard(state, 'spell_1', 'p1', 'hand', {
    id: 'spell_def',
    name: 'Test Spell',
    type_line: spellDef.typeLine,
    oracle_text: spellDef.oracle,
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: spellDef.colors as any,
    card_types: spellDef.cardTypes as any,
  });

  return { state, spellId: 'spell_1' };
}

describe('matchTypeFilteredAsThoughFlash — canCastSpell enforcement', () => {
  it('Vivien-style: creature spells get flash from permanent; can cast at instant speed', () => {
    const { state, spellId } = setupBattlefieldFlash(
      'You may cast creature spells as though they had flash.',
      { oracle: '', types: ['creature'], typeLine: 'Creature — Elf', colors: ['G'], cardTypes: ['creature'] },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(true);
  });

  it('Vivien-style: non-creature spell does NOT get the creature-flash grant', () => {
    const { state, spellId } = setupBattlefieldFlash(
      'You may cast creature spells as though they had flash.',
      { oracle: '', types: ['sorcery'], typeLine: 'Sorcery', colors: ['G'], cardTypes: ['sorcery'] },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(false);
  });

  it('Najal-style: sorcery spells get flash from permanent', () => {
    const { state, spellId } = setupBattlefieldFlash(
      'You may cast sorcery spells as though they had flash.',
      { oracle: '', types: ['sorcery'], typeLine: 'Sorcery', colors: [], cardTypes: ['sorcery'] },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(true);
  });

  it('Najal-style: creature spell does NOT get the sorcery-flash grant', () => {
    const { state, spellId } = setupBattlefieldFlash(
      'You may cast sorcery spells as though they had flash.',
      { oracle: '', types: ['creature'], typeLine: 'Creature — Bird', colors: [], cardTypes: ['creature'] },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(false);
  });

  it('flash grant only applies to the permanent controller, not p2', () => {
    const { state, spellId } = setupBattlefieldFlash(
      'You may cast creature spells as though they had flash.',
      { oracle: '', types: ['creature'], typeLine: 'Creature — Beast', colors: ['G'], cardTypes: ['creature'] },
    );
    // Move spell_1 to p2's hand — p2 should NOT benefit from p1's flash grant
    const cardInst = state.cards.get(spellId)!;
    state.cards.set(spellId, { ...cardInst, ownerId: 'p2' });
    expect(canCastSpell(state, 'p2', spellId)).toBe(false);
  });

  it('artifact-type filter grants flash to artifact spells', () => {
    const { state, spellId } = setupBattlefieldFlash(
      'You may cast artifact spells as though they had flash.',
      { oracle: '', types: ['artifact'], typeLine: 'Artifact', colors: [], cardTypes: ['artifact'] },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(true);
  });

  it('artifact-type filter does not grant flash to non-artifact spells', () => {
    const { state, spellId } = setupBattlefieldFlash(
      'You may cast artifact spells as though they had flash.',
      { oracle: '', types: ['sorcery'], typeLine: 'Sorcery', colors: [], cardTypes: ['sorcery'] },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(false);
  });

  it('source off the battlefield does not grant flash', () => {
    const { state, spellId } = setupBattlefieldFlash(
      'You may cast creature spells as though they had flash.',
      { oracle: '', types: ['creature'], typeLine: 'Creature — Elf', colors: ['G'], cardTypes: ['creature'] },
    );
    // Remove the permanent from the battlefield
    const src = state.cards.get('vivien_1')!;
    state.cards.set('vivien_1', { ...src, zone: 'graveyard' });
    expect(canCastSpell(state, 'p1', spellId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Yeva-style: color-qualified type filter
// ---------------------------------------------------------------------------

describe('matchTypeFilteredAsThoughFlash — color-qualified filter (Yeva)', () => {
  it('green creature spell gets flash from "green creature spells" grant', () => {
    const { state, spellId } = setupBattlefieldFlash(
      'You may cast green creature spells as though they had flash.',
      { oracle: '', types: ['creature'], typeLine: 'Creature — Elf', colors: ['G'], cardTypes: ['creature'] },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(true);
  });

  it('non-green creature spell does NOT get flash from "green creature spells" grant', () => {
    const { state, spellId } = setupBattlefieldFlash(
      'You may cast green creature spells as though they had flash.',
      { oracle: '', types: ['creature'], typeLine: 'Creature — Bird', colors: ['W'], cardTypes: ['creature'] },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Quick Sliver style: any-player scope
// ---------------------------------------------------------------------------

describe('matchTypeFilteredAsThoughFlash — any-player scope (Quick Sliver)', () => {
  it('Quick Sliver oracle: any player (p2) gets flash for Sliver spells', () => {
    let state = createTestState({
      activePlayerIndex: 0, // p1 is active — p2 is outside sorcery window
      priorityPlayerIndex: 1,
      phase: 'precombat_main' as Phase,
    });
    state.players[1].manaPool = { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 };

    // p1 controls Quick Sliver on the battlefield
    addCard(state, 'qsliver_1', 'p1', 'battlefield', {
      id: 'qsliver_def',
      name: 'Quick Sliver',
      type_line: 'Creature — Sliver',
      oracle_text: 'Any player may cast Sliver spells as though they had flash.',
      mana_cost: '{1}{G}',
      cmc: 2,
      colors: ['G'],
      card_types: ['creature'],
    });
    state = registerContinuousAbilitiesForPermanent(state, 'qsliver_1');

    // p2 has a Sliver spell in hand
    addCard(state, 'sliver_spell_1', 'p2', 'hand', {
      id: 'sliver_spell_def',
      name: 'Some Sliver',
      type_line: 'Creature — Sliver',
      oracle_text: '',
      mana_cost: '{2}{G}',
      cmc: 3,
      colors: ['G'],
      card_types: ['creature'],
    });

    // p2 is NOT in the sorcery window (p1 is active), but should still be
    // able to cast a Sliver thanks to Quick Sliver's any-player grant.
    expect(canCastSpell(state, 'p2', 'sliver_spell_1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Sorcery-speed baseline still works
// ---------------------------------------------------------------------------

describe('matchTypeFilteredAsThoughFlash — sorcery-speed baseline', () => {
  it('creature spell can still be cast at sorcery speed even with flash grant active', () => {
    let state = createTestState({
      activePlayerIndex: 0, // p1 is active — in sorcery window
      priorityPlayerIndex: 0,
      phase: 'precombat_main' as Phase,
    });
    state.players[0].manaPool = { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 };

    addCard(state, 'vivien_1', 'p1', 'battlefield', {
      id: 'vivien_def2',
      name: 'Flash Granter',
      type_line: 'Creature',
      oracle_text: 'You may cast creature spells as though they had flash.',
      mana_cost: '{3}{G}',
      cmc: 4,
      colors: ['G'],
      card_types: ['creature'],
    });
    state = registerContinuousAbilitiesForPermanent(state, 'vivien_1');

    addCard(state, 'bear_1', 'p1', 'hand', {
      id: 'bear_def',
      name: 'Grizzly Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      mana_cost: '{1}{G}',
      cmc: 2,
      colors: ['G'],
      card_types: ['creature'],
    });

    // Should be castable at sorcery speed too
    expect(canCastSpell(state, 'p1', 'bear_1')).toBe(true);
  });
});
