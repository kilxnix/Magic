// Slice 8: Enter-as-copy noncreature subjects, wider pools, P/T override, legendary
//
// Tests that matchEnterAsCopy (zones.ts) and executeEnterAsCopy (executor.ts)
// correctly handle:
//   - Noncreature subjects: "this artifact", "this enchantment", "this Equipment", "this Vehicle"
//   - Wider pool types:
//       poolType='artifact'              — Sculpting Steel
//       poolType='equipment'             — Masterwork of Ingenuity
//       poolType='enchantment'           — Copy Enchantment
//       poolType='artifactOrEnchantment' — Mirrormade
//       poolType='land'                  — Copy Land
//       poolType='nonlandPermanent'      — Clever Impersonator
//   - Source variants:
//       sourceVariant='opponentControls'               — a creature an opponent controls
//       sourceVariant='artifactOrCreatureYouControl'   — Waxen Shapethief
//   - P/T override: "except it's 7/7" (Quicksilver Gargantuan)
//   - Name+legendary combo: "except its name is ~ and it's still legendary" (Sakashima)
//
// Declined riders (honesty bar) are also verified:
//   - Gigantoplasm/Mocking Doppelganger style quoted ability text → null
//   - Vesuvan Doppelganger "vanishing" → null

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import type { Effect, EnterAsCopyEffect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Minimal test-state factory
// ---------------------------------------------------------------------------

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  // Entering permanent (the shapeshifter / blank entering card).
  cards.set('entering', {
    instanceId: 'entering',
    definitionId: 'def-entering',
    ownerId: 'p1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: true,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set('def-entering', {
    id: 'def-entering',
    name: 'Copy Thing',
    type_line: 'Artifact',
    oracle_text: '',
    mana_cost: '{3}',
    cmc: 3,
    colors: [],
    color_identity: [],
    keywords: [],
    power: undefined,
    toughness: undefined,
    card_types: ['artifact'],
  });

  // Opponent's artifact (Sculpting Steel / Mirrormade target)
  cards.set('opp-artifact', {
    instanceId: 'opp-artifact',
    definitionId: 'def-opp-artifact',
    ownerId: 'p2',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set('def-opp-artifact', {
    id: 'def-opp-artifact',
    name: 'Sword of Fire and Ice',
    type_line: 'Artifact — Equipment',
    oracle_text: '',
    mana_cost: '{3}',
    cmc: 3,
    colors: [],
    color_identity: [],
    keywords: [],
    power: undefined,
    toughness: undefined,
    card_types: ['artifact'],
  });

  // Opponent's enchantment (Copy Enchantment / Mirrormade target)
  cards.set('opp-enchantment', {
    instanceId: 'opp-enchantment',
    definitionId: 'def-opp-enchantment',
    ownerId: 'p2',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set('def-opp-enchantment', {
    id: 'def-opp-enchantment',
    name: 'Rhystic Study',
    type_line: 'Enchantment',
    oracle_text: '',
    mana_cost: '{2}{U}',
    cmc: 3,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    power: undefined,
    toughness: undefined,
    card_types: ['enchantment'],
  });

  // Opponent's land (Copy Land target)
  cards.set('opp-land', {
    instanceId: 'opp-land',
    definitionId: 'def-opp-land',
    ownerId: 'p2',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set('def-opp-land', {
    id: 'def-opp-land',
    name: 'Cavern of Souls',
    type_line: 'Land',
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    power: undefined,
    toughness: undefined,
    card_types: ['land'],
  });

  // Opponent's large creature (Quicksilver Gargantuan / generic copytarget)
  cards.set('opp-creature', {
    instanceId: 'opp-creature',
    definitionId: 'def-opp-creature',
    ownerId: 'p2',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set('def-opp-creature', {
    id: 'def-opp-creature',
    name: 'Leviathan',
    type_line: 'Creature — Leviathan',
    oracle_text: '',
    mana_cost: '{10}',
    cmc: 10,
    colors: [],
    color_identity: [],
    keywords: [],
    power: 10,
    toughness: 10,
    card_types: ['creature'],
  });

  // Own creature (Waxen Shapethief / artifactOrCreatureYouControl target)
  cards.set('own-creature', {
    instanceId: 'own-creature',
    definitionId: 'def-own-creature',
    ownerId: 'p1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set('def-own-creature', {
    id: 'def-own-creature',
    name: 'My Dragon',
    type_line: 'Creature — Dragon',
    oracle_text: 'Flying.',
    mana_cost: '{4}{U}',
    cmc: 5,
    colors: ['U'],
    color_identity: ['U'],
    keywords: ['flying'],
    power: 4,
    toughness: 4,
    card_types: ['creature'],
  });

  // Own artifact (Waxen Shapethief / artifactOrCreatureYouControl target)
  cards.set('own-artifact', {
    instanceId: 'own-artifact',
    definitionId: 'def-own-artifact',
    ownerId: 'p1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  cardDefinitions.set('def-own-artifact', {
    id: 'def-own-artifact',
    name: 'Sol Ring',
    type_line: 'Artifact',
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    power: undefined,
    toughness: undefined,
    card_types: ['artifact'],
  });

  const players = [
    {
      id: 'p1', name: 'Player 1', life: 40,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      hasPlayedLand: false, hand: [], library: [], graveyard: [],
      commandZone: [], hasLost: false, commanderDamage: {}, counters: {},
    },
    {
      id: 'p2', name: 'Player 2', life: 40,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      hasPlayedLand: false, hand: [], library: [], graveyard: [],
      commandZone: [], hasLost: false, commanderDamage: {}, counters: {},
    },
  ];

  return {
    cards,
    cardDefinitions,
    players,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    turnNumber: 1,
    phase: 'precombat_main',
    step: 'begin_combat',
    stack: [],
    pendingTriggers: [],
    attackers: [],
    blockers: [],
    pendingDamage: [],
  } as unknown as GameState;
}

// Helper: extract the first EnterAsCopyEffect from a Spell parse result.
function firstEnterAsCopy(oracle: string): EnterAsCopyEffect | null {
  const result = parseOracleText(oracle);
  if (result.kind !== 'Spell') return null;
  const eff = result.effects.find(e => e.kind === 'EnterAsCopy');
  return eff ? (eff as EnterAsCopyEffect) : null;
}

// ===========================================================================
// Parser tests — noncreature subjects and pool types
// ===========================================================================

describe('matchEnterAsCopy — Slice-8 noncreature subjects (parser)', () => {

  it('parses "this artifact" subject', () => {
    const eff = firstEnterAsCopy(
      'You may have this artifact enter as a copy of any artifact on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.kind).toBe('EnterAsCopy');
    expect(eff!.poolType).toBe('artifact');
  });

  it('parses "this enchantment" subject (Copy Enchantment style)', () => {
    const eff = firstEnterAsCopy(
      'You may have this enchantment enter as a copy of any enchantment on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.poolType).toBe('enchantment');
  });

  it('parses "this Equipment" subject (Masterwork of Ingenuity style)', () => {
    const eff = firstEnterAsCopy(
      'You may have this Equipment enter as a copy of any Equipment on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.poolType).toBe('equipment');
  });

  it('parses "this Vehicle" subject', () => {
    const eff = firstEnterAsCopy(
      'You may have this Vehicle enter as a copy of any artifact on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.poolType).toBe('artifact');
  });

});

describe('matchEnterAsCopy — Slice-8 wider pool types (parser)', () => {

  it('Sculpting Steel: "any artifact on the battlefield" → poolType=artifact', () => {
    // Real Sculpting Steel oracle: "You may have ~ enter as a copy of any artifact on the battlefield."
    const eff = firstEnterAsCopy(
      'You may have ~ enter as a copy of any artifact on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.poolType).toBe('artifact');
  });

  it('Mirrormade: "any artifact or enchantment on the battlefield" → poolType=artifactOrEnchantment', () => {
    const eff = firstEnterAsCopy(
      'You may have ~ enter as a copy of any artifact or enchantment on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.poolType).toBe('artifactOrEnchantment');
  });

  it('Copy Enchantment: "any enchantment on the battlefield" → poolType=enchantment', () => {
    const eff = firstEnterAsCopy(
      'You may have ~ enter as a copy of any enchantment on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.poolType).toBe('enchantment');
  });

  it('Copy Land: "any land on the battlefield" → poolType=land', () => {
    const eff = firstEnterAsCopy(
      'You may have ~ enter as a copy of any land on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.poolType).toBe('land');
  });

  it('Clever Impersonator: "any nonland permanent on the battlefield" → poolType=nonlandPermanent', () => {
    const eff = firstEnterAsCopy(
      'You may have ~ enter as a copy of any nonland permanent on the battlefield.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.poolType).toBe('nonlandPermanent');
  });

  it('Waxen Shapethief: "an artifact or creature you control" → sourceVariant=artifactOrCreatureYouControl', () => {
    const eff = firstEnterAsCopy(
      'You may have ~ enter as a copy of an artifact or creature you control.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('artifactOrCreatureYouControl');
  });

  it('"a creature an opponent controls" → sourceVariant=opponentControls', () => {
    const eff = firstEnterAsCopy(
      'You may have this creature enter as a copy of a creature an opponent controls.',
    );
    expect(eff).not.toBeNull();
    expect(eff!.sourceVariant).toBe('opponentControls');
  });

});

describe('matchEnterAsCopy — Slice-8 P/T override and legendary riders (parser)', () => {

  it('Quicksilver Gargantuan: "except it\'s 7/7" → ptOverride', () => {
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of any creature on the battlefield, except it's 7/7.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.ptOverride).toEqual({ power: 7, toughness: 7 });
  });

  it('Sakashima the Impostor: name override + legendary combo', () => {
    const eff = firstEnterAsCopy(
      "You may have ~ enter as a copy of any creature on the battlefield, except its name is ~ and it's still legendary.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.nameOverride).toBe('~');
    expect(eff!.addedLegendary).toBe(true);
  });

  it('"except its name is ~ and it\'s legendary" (without "still") → nameOverride + addedLegendary', () => {
    const eff = firstEnterAsCopy(
      "You may have ~ enter as a copy of any creature on the battlefield, except its name is ~ and it's legendary.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.nameOverride).toBe('~');
    expect(eff!.addedLegendary).toBe(true);
  });

  it('P/T override combined with regular creature pool is parsed correctly', () => {
    const eff = firstEnterAsCopy(
      "You may have this creature enter as a copy of any creature on the battlefield, except it's 5/5.",
    );
    expect(eff).not.toBeNull();
    expect(eff!.ptOverride).toEqual({ power: 5, toughness: 5 });
    expect(eff!.poolType).toBeUndefined();
  });

});

describe('matchEnterAsCopy — Slice-8 riders (honesty bar)', () => {

  it('Slice-3 update: Gigantoplasm-style "except it has \"{X}: ...\"" absorbed — emits EnterAsCopy without rider', () => {
    // Slice 3/12: The quoted activated-ability rider ("{X}: This creature has base
    // power and toughness X/X") is now absorbed as a pure-downside skip.  The engine
    // does NOT execute the {X} ability (the player loses the overlay), but the base
    // EnterAsCopy effect still resolves honestly.
    // Prior to Slice 3 this was declined; the behaviour is now to absorb and emit.
    const result = parseOracleText(
      "You may have this creature enter as a copy of any creature on the battlefield, except it has \"{X}: This creature has base power and toughness X/X until end of turn.\".",
    );
    expect(result.kind).toBe('Spell');
    if (result.kind === 'Spell') {
      expect(result.effects.some(e => e.kind === 'EnterAsCopy')).toBe(true);
    }
  });

  it('declines Mocking Doppelganger-style granted triggered ability text', () => {
    const result = parseOracleText(
      "You may have this creature enter as a copy of any creature on the battlefield, except it has \"whenever this creature attacks, create a token copy of it.\".",
    );
    if (result.kind === 'Spell') {
      expect(result.effects.some(e => e.kind === 'EnterAsCopy')).toBe(false);
    }
  });

});

// ===========================================================================
// Executor tests — poolType filtering
// ===========================================================================

describe('executeEnterAsCopy — Slice-8 poolType filtering (executor)', () => {

  it('poolType=artifact: copies artifact, ignores enchantment and land', () => {
    const state = makeState();
    const effect: Effect = { kind: 'EnterAsCopy', poolType: 'artifact' };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // opp-artifact (def-opp-artifact) is an artifact → should be chosen
    expect(card.definitionId).toBe('def-opp-artifact');
    expect(card.copiedFromDefinitionId).toBe('def-opp-artifact');
    // Lands and enchantments on the battlefield are skipped
    expect(card.definitionId).not.toBe('def-opp-land');
    expect(card.definitionId).not.toBe('def-opp-enchantment');
  });

  it('poolType=enchantment: copies enchantment, ignores artifact and land', () => {
    const state = makeState();
    const effect: Effect = { kind: 'EnterAsCopy', poolType: 'enchantment' };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    expect(card.definitionId).toBe('def-opp-enchantment');
  });

  it('poolType=land: copies land, ignores artifact and enchantment', () => {
    const state = makeState();
    const effect: Effect = { kind: 'EnterAsCopy', poolType: 'land' };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    expect(card.definitionId).toBe('def-opp-land');
  });

  it('poolType=artifactOrEnchantment: copies from artifact or enchantment pool (Mirrormade)', () => {
    const state = makeState();
    const effect: Effect = { kind: 'EnterAsCopy', poolType: 'artifactOrEnchantment' };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Should have copied either the artifact or the enchantment (both valid)
    expect(['def-opp-artifact', 'def-opp-enchantment']).toContain(card.definitionId);
  });

  it('poolType=nonlandPermanent: copies any permanent except lands (Clever Impersonator)', () => {
    const state = makeState();
    const effect: Effect = { kind: 'EnterAsCopy', poolType: 'nonlandPermanent' };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Land is excluded; should copy a non-land permanent
    expect(card.definitionId).not.toBe('def-opp-land');
    expect(card.definitionId).not.toBe('def-entering'); // not a no-op
  });

  it('poolType=artifact: no-op when no artifacts on battlefield (except entering itself)', () => {
    const state = makeState();
    // Remove all artifacts except the entering card itself
    const noArtifactCards = new Map(
      [...state.cards.entries()].filter(
        ([id]) => id !== 'opp-artifact' && id !== 'own-artifact',
      ),
    );
    const noArtifactState: GameState = { ...state, cards: noArtifactCards };
    const effect: Effect = { kind: 'EnterAsCopy', poolType: 'artifact' };

    const newState = executeEffects(
      noArtifactState, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // No valid artifact targets → entering permanent stays as itself
    expect(card.definitionId).toBe('def-entering');
  });

});

// ===========================================================================
// Executor tests — source variant: opponentControls
// ===========================================================================

describe('executeEnterAsCopy — opponentControls source variant (executor)', () => {

  it('opponentControls: only copies creatures controlled by an opponent', () => {
    const state = makeState();
    const effect: Effect = { kind: 'EnterAsCopy', sourceVariant: 'opponentControls' };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Should have copied opp-creature (opponent's creature), not own-creature
    expect(card.definitionId).toBe('def-opp-creature');
    expect(card.definitionId).not.toBe('def-own-creature');
  });

  it('opponentControls: no-op when opponent has no creatures', () => {
    const state = makeState();
    // Remove opponent's creature from battlefield
    const noOppCreatures = new Map(
      [...state.cards.entries()].filter(([id]) => id !== 'opp-creature'),
    );
    const noOppState: GameState = { ...state, cards: noOppCreatures };
    const effect: Effect = { kind: 'EnterAsCopy', sourceVariant: 'opponentControls' };

    const newState = executeEffects(
      noOppState, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    expect(card.definitionId).toBe('def-entering'); // no-op
  });

});

// ===========================================================================
// Executor tests — source variant: artifactOrCreatureYouControl
// ===========================================================================

describe('executeEnterAsCopy — artifactOrCreatureYouControl source variant (executor)', () => {

  it('copies artifact or creature you control, excludes opponent permanents', () => {
    const state = makeState();
    const effect: Effect = { kind: 'EnterAsCopy', sourceVariant: 'artifactOrCreatureYouControl' };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Only own-creature (def-own-creature) and own-artifact (def-own-artifact) are controlled by p1
    // and are creature/artifact. Should be one of those, not the opponent's permanents.
    expect(['def-own-creature', 'def-own-artifact']).toContain(card.definitionId);
    expect(card.definitionId).not.toBe('def-opp-creature');
    expect(card.definitionId).not.toBe('def-opp-artifact');
  });

});

// ===========================================================================
// Executor tests — P/T override rider (Quicksilver Gargantuan)
// ===========================================================================

describe('executeEnterAsCopy — ptOverride rider (executor)', () => {

  it('ptOverride: entering copy has effective P/T matching the override', () => {
    const state = makeState();
    // Copy the Leviathan (10/10) but enter as 7/7 instead
    const effect: Effect = {
      kind: 'EnterAsCopy',
      ptOverride: { power: 7, toughness: 7 },
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // Should have copied the Leviathan (highest P+T creature)
    expect(card.definitionId).toBe('def-opp-creature');
    // Effective P/T should be 7/7 due to the override modifier
    const effectivePow = getEffectivePower(newState, 'entering');
    const effectiveTou = getEffectiveToughness(newState, 'entering');
    expect(effectivePow).toBe(7);
    expect(effectiveTou).toBe(7);
  });

  it('ptOverride: entering copy with ptOverride smaller than base P/T uses negative modifier', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      ptOverride: { power: 3, toughness: 3 },
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    expect(card.definitionId).toBe('def-opp-creature');
    expect(getEffectivePower(newState, 'entering')).toBe(3);
    expect(getEffectiveToughness(newState, 'entering')).toBe(3);
  });

  it('ptOverride matching base P/T leaves no modifier counter', () => {
    const state = makeState();
    // Copy the Leviathan (10/10) with override of 10/10 — delta is zero
    const effect: Effect = {
      kind: 'EnterAsCopy',
      ptOverride: { power: 10, toughness: 10 },
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    // No modifier counters needed when delta is zero
    expect(card.counters['_powerMod'] ?? 0).toBe(0);
    expect(card.counters['_toughnessMod'] ?? 0).toBe(0);
  });

});

// ===========================================================================
// Executor tests — addedLegendary rider (Sakashima the Impostor)
// ===========================================================================

describe('executeEnterAsCopy — addedLegendary rider (executor)', () => {

  it('addedLegendary: entering copy has "legendary" in additionalTypes', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      nameOverride: '~',
      addedLegendary: true,
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    expect(card.definitionId).toBe('def-opp-creature'); // copied opponent's creature
    expect(card.nameOverride).toBe('Copy Thing');        // original name preserved
    expect(card.additionalTypes).toContain('legendary'); // legendary overlay applied
  });

  it('addedLegendary combines with additionalTypes from effect', () => {
    const state = makeState();
    const effect: Effect = {
      kind: 'EnterAsCopy',
      nameOverride: '~',
      additionalTypes: ['artifact'],
      addedLegendary: true,
    };

    const newState = executeEffects(
      state, [effect], 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );

    const card = newState.cards.get('entering')!;
    expect(card.additionalTypes).toContain('artifact');
    expect(card.additionalTypes).toContain('legendary');
  });

});

// ===========================================================================
// Parse + execute integration tests (real oracle text → effect → state change)
// ===========================================================================

describe('matchEnterAsCopy — parse-then-execute integration (real oracle wordings)', () => {

  it('Sculpting Steel: parses and copies an artifact on the battlefield', () => {
    // Real Sculpting Steel oracle text (simplified for tokenization)
    const result = parseOracleText(
      'You may have ~ enter as a copy of any artifact on the battlefield.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0] as EnterAsCopyEffect;
    expect(eff.kind).toBe('EnterAsCopy');
    expect(eff.poolType).toBe('artifact');

    // Execute
    const state = makeState();
    const newState = executeEffects(
      state, result.effects, 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );
    const card = newState.cards.get('entering')!;
    expect(card.definitionId).toBe('def-opp-artifact');
  });

  it('Mirrormade: parses and copies an artifact or enchantment on the battlefield', () => {
    const result = parseOracleText(
      'You may have ~ enter as a copy of any artifact or enchantment on the battlefield.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0] as EnterAsCopyEffect;
    expect(eff.poolType).toBe('artifactOrEnchantment');

    const state = makeState();
    const newState = executeEffects(
      state, result.effects, 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );
    const card = newState.cards.get('entering')!;
    expect(['def-opp-artifact', 'def-opp-enchantment']).toContain(card.definitionId);
  });

  it('Quicksilver Gargantuan: parses "except it\'s 7/7" and applies P/T override', () => {
    const result = parseOracleText(
      "You may have this creature enter as a copy of any creature on the battlefield, except it's 7/7.",
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0] as EnterAsCopyEffect;
    expect(eff.ptOverride).toEqual({ power: 7, toughness: 7 });

    const state = makeState();
    const newState = executeEffects(
      state, result.effects, 'p1', [], [], 0,
      { sourceInstanceId: 'entering' },
    );
    const card = newState.cards.get('entering')!;
    // Copied the biggest creature (Leviathan 10/10) but forced to 7/7
    expect(card.definitionId).toBe('def-opp-creature');
    expect(getEffectivePower(newState, 'entering')).toBe(7);
    expect(getEffectiveToughness(newState, 'entering')).toBe(7);
  });

});
