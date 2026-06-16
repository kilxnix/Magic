/**
 * Slice 12/12: Extended "as though they had flash" battlefield-grant variants.
 *
 * Covers the new Slice 12 additions to matchTypeFilteredAsThoughFlash:
 *
 *  1. Unqualified form: "You may cast spells as though they had flash."
 *     (Vedalken Orrery, High Fae Trickster family) — typeFilter: {} (all spells)
 *
 *  2. Historic form: "You may cast historic spells as though they had flash."
 *     (Raff Capashen, Ship's Mage) — typeFilter: anyOf[{supertypes:['legendary']},
 *     {types:['artifact']},{subtypes:['saga']}]
 *
 *  3. Engine enforcement for both forms via registerContinuousAbilitiesForPermanent
 *     + canCastSpell — confirms the battlefield grant actually allows instant-speed casting.
 *
 * Tests use real or representative oracle wordings from the example card set.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { canCastSpell, registerContinuousAbilitiesForPermanent } from '../stack';
import { GameState, CardDefinition, emptyManaPool, createPlayer, Phase, Step } from '../types';
import { populateParsedCache } from '../cards/card-parser-cache';

// ---------------------------------------------------------------------------
// Minimal test helpers (mirrored from kw-type-filtered-as-though-flash.test.ts)
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

/**
 * Build a two-player state where p1 has a flash-granting permanent on the
 * battlefield and p2 is the active player (so p1 is outside the sorcery window).
 */
function setupBattlefieldFlash(
  grantOracle: string,
  spellDef: { id?: string; oracle: string; types: string[]; typeLine: string; colors: string[]; cardTypes: string[] },
): { state: GameState; spellId: string } {
  let state = createTestState({
    activePlayerIndex: 1, // p2 is active — p1 is outside sorcery window
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as Phase,
  });

  state.players[0].manaPool = { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 };

  // Add the flash-granting permanent to p1's battlefield
  addCard(state, 'granter_1', 'p1', 'battlefield', {
    id: 'granter_def',
    name: 'Flash Granter',
    type_line: 'Artifact',
    oracle_text: grantOracle,
    mana_cost: '{4}',
    cmc: 4,
    colors: [],
    card_types: ['artifact'],
  });

  // Register its continuous abilities
  state = registerContinuousAbilitiesForPermanent(state, 'granter_1');

  // Add the spell to p1's hand
  const spellId = spellDef.id ?? 'spell_1';
  addCard(state, spellId, 'p1', 'hand', {
    id: spellDef.id ? `${spellDef.id}_def` : 'spell_def',
    name: 'Test Spell',
    type_line: spellDef.typeLine,
    oracle_text: spellDef.oracle,
    mana_cost: '{2}{U}',
    cmc: 3,
    colors: spellDef.colors as any,
    card_types: spellDef.cardTypes as any,
  });

  return { state, spellId };
}

// ===========================================================================
// 1. Parser recognition — unqualified form (Vedalken Orrery)
// ===========================================================================

describe('Slice 12 — unqualified "spells" flash grant (Vedalken Orrery)', () => {
  // Vedalken Orrery oracle: "You may cast spells as though they had flash."
  const VEDALKEN_ORRERY_ORACLE = 'You may cast spells as though they had flash.';

  it('parser: "You may cast spells as though they had flash." → StaticAbility(AsThoughFlash, empty typeFilter)', () => {
    const r = parseOracleText(VEDALKEN_ORRERY_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    // typeFilter must be defined (not undefined — that's the selfOnly form)
    expect(mod.typeFilter).toBeDefined();
    // Empty filter {} — no type restriction
    const f = mod.typeFilter!;
    expect(f.types).toBeUndefined();
    expect(f.subtypes).toBeUndefined();
    expect(f.supertypes).toBeUndefined();
    expect(f.anyOf).toBeUndefined();
    // selfOnly must be false (battlefield grant, not self-spell)
    expect(r.ability.selfOnly).toBe(false);
    // controller scope: 'you'
    expect(r.ability.controller).toBe('you');
  });

  it('parser: multi-sentence oracle with allowed keywords parses correctly (High Fae Trickster)', () => {
    // High Fae Trickster: "Flash\nYou may cast spells as though they had flash."
    const HIGH_FAE_ORACLE = 'Flash\nYou may cast spells as though they had flash.';
    const r = parseOracleText(HIGH_FAE_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter).toBeDefined();
    expect(mod.typeFilter!.types).toBeUndefined(); // all-spells filter
    expect(r.ability.selfOnly).toBe(false);
  });

  it('engine: creature spell can be cast at instant speed via Vedalken Orrery', () => {
    const { state, spellId } = setupBattlefieldFlash(
      VEDALKEN_ORRERY_ORACLE,
      { oracle: '', types: ['creature'], typeLine: 'Creature — Elf', colors: ['G'], cardTypes: ['creature'] },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(true);
  });

  it('engine: sorcery spell can be cast at instant speed via Vedalken Orrery', () => {
    const { state, spellId } = setupBattlefieldFlash(
      VEDALKEN_ORRERY_ORACLE,
      { oracle: '', types: ['sorcery'], typeLine: 'Sorcery', colors: [], cardTypes: ['sorcery'] },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(true);
  });

  it('engine: enchantment spell can be cast at instant speed via Vedalken Orrery', () => {
    const { state, spellId } = setupBattlefieldFlash(
      VEDALKEN_ORRERY_ORACLE,
      { oracle: '', types: ['enchantment'], typeLine: 'Enchantment', colors: [], cardTypes: ['enchantment'] },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(true);
  });

  it('engine: source off the battlefield removes the grant', () => {
    const { state, spellId } = setupBattlefieldFlash(
      VEDALKEN_ORRERY_ORACLE,
      { oracle: '', types: ['creature'], typeLine: 'Creature — Beast', colors: ['G'], cardTypes: ['creature'] },
    );
    // Move granter off the battlefield
    const src = state.cards.get('granter_1')!;
    state.cards.set('granter_1', { ...src, zone: 'graveyard' });
    expect(canCastSpell(state, 'p1', spellId)).toBe(false);
  });
});

// ===========================================================================
// 2. Parser recognition — historic form (Raff Capashen)
// ===========================================================================

describe('Slice 12 — historic "spells" flash grant (Raff Capashen)', () => {
  // Raff Capashen, Ship's Mage: Flash, Flying. You may cast historic spells as though they had flash.
  const RAFF_CAPASHEN_ORACLE = 'Flash\nFlying\nYou may cast historic spells as though they had flash.';
  const BARE_HISTORIC_ORACLE = 'You may cast historic spells as though they had flash.';

  it('parser: "You may cast historic spells as though they had flash." → StaticAbility with anyOf[legendary,artifact,saga]', () => {
    const r = parseOracleText(BARE_HISTORIC_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter).toBeDefined();
    const f = mod.typeFilter!;
    // Must use anyOf (since historic is a disjunction of three categories)
    expect(f.anyOf).toBeDefined();
    const supertypes = f.anyOf!.flatMap(x => x.supertypes ?? []);
    const types = f.anyOf!.flatMap(x => x.types ?? []);
    const subtypes = f.anyOf!.flatMap(x => x.subtypes ?? []);
    expect(supertypes).toContain('legendary');
    expect(types).toContain('artifact');
    expect(subtypes).toContain('saga');
    // selfOnly must be false (battlefield grant)
    expect(r.ability.selfOnly).toBe(false);
  });

  it('parser: Raff Capashen full oracle (Flash, Flying preamble) parses correctly', () => {
    const r = parseOracleText(RAFF_CAPASHEN_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    expect(mod.typeFilter).toBeDefined();
    const f = mod.typeFilter!;
    expect(f.anyOf).toBeDefined();
  });

  it('engine: legendary spell gets flash from historic grant', () => {
    const { state, spellId } = setupBattlefieldFlash(
      BARE_HISTORIC_ORACLE,
      {
        oracle: '',
        types: ['creature'],
        typeLine: 'Legendary Creature — Human',
        colors: ['U'],
        cardTypes: ['creature'],
      },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(true);
  });

  it('engine: artifact spell gets flash from historic grant', () => {
    const { state, spellId } = setupBattlefieldFlash(
      BARE_HISTORIC_ORACLE,
      {
        oracle: '',
        types: ['artifact'],
        typeLine: 'Artifact',
        colors: [],
        cardTypes: ['artifact'],
      },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(true);
  });

  it('engine: Saga spell gets flash from historic grant', () => {
    const { state, spellId } = setupBattlefieldFlash(
      BARE_HISTORIC_ORACLE,
      {
        oracle: '',
        types: ['enchantment'],
        typeLine: 'Enchantment — Saga',
        colors: ['U'],
        cardTypes: ['enchantment'],
      },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(true);
  });

  it('engine: non-historic sorcery does NOT get flash from historic grant', () => {
    const { state, spellId } = setupBattlefieldFlash(
      BARE_HISTORIC_ORACLE,
      {
        oracle: '',
        types: ['sorcery'],
        typeLine: 'Sorcery',
        colors: ['U'],
        cardTypes: ['sorcery'],
      },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(false);
  });

  it('engine: non-historic creature (no Legendary supertype) does NOT get flash', () => {
    const { state, spellId } = setupBattlefieldFlash(
      BARE_HISTORIC_ORACLE,
      {
        oracle: '',
        types: ['creature'],
        typeLine: 'Creature — Elf',
        colors: ['G'],
        cardTypes: ['creature'],
      },
    );
    expect(canCastSpell(state, 'p1', spellId)).toBe(false);
  });
});

// ===========================================================================
// 3. Honesty — forms still correctly declined
// ===========================================================================

describe('Slice 12 — honesty: forms still declined after extension', () => {
  it('still declines "with enchant creature" qualifier (Rootwater Shaman)', () => {
    const r = parseOracleText('You may cast Aura spells with enchant creature as though they had flash.');
    expect(r.kind).not.toBe('StaticAbility');
  });

  it('still declines "this turn" temporal qualifier', () => {
    const r = parseOracleText('You may cast spells this turn as though they had flash.');
    expect(r.kind).not.toBe('StaticAbility');
  });

  it('still declines "colorless" category', () => {
    const r = parseOracleText('You may cast colorless spells as though they had flash.');
    expect(r.kind).not.toBe('StaticAbility');
  });

  it('still treats "cast this spell" as self-oracle (selfOnly: true), not type-filtered', () => {
    const r = parseOracleText('You may cast this spell as though it had flash.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.selfOnly).toBe(true);
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('AsThoughFlash');
    if (mod.kind !== 'AsThoughFlash') return;
    // Self-oracle form has no typeFilter
    expect(mod.typeFilter).toBeUndefined();
  });
});
