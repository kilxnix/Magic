/**
 * slice4-ability-word-strip: Tests for ability-word em-dash prefix stripping
 * integrated into parseOracleTextPerLine (Slice 4).
 *
 * Ability words (Domain, Landfall, Magecraft, Constellation, Pack tactics,
 * Hellbent, Threshold, Rally, Stagger, Vivid, Sorcerous Elixir) are pure
 * flavor labels with no rules meaning (CR 207.2c).  In per-line dispatch
 * they blocked the trigger/static matchers because the tokens started with
 * the ability word rather than "when"/"whenever".  Step 2c in
 * parseOracleTextPerLine strips the prefix before steps 3/3a so existing
 * matchers handle the body unchanged.
 *
 * The per-line dispatch (parseOracleTextPerLine) is entered when the full-face
 * greedy scan (parseMultipleEffects) cannot find any parseable spell effects.
 * This happens for static-ability bodies (CDAs like "for each basic land type")
 * and for cases where the trimLeadingKeywordOrEnchantPreamble path doesn't apply
 * because the companion keyword is not in LEADING_PREAMBLE_STARTS.
 *
 * For trigger bodies where trimLeadingKeywordOrEnchantPreamble DOES apply (e.g.
 * "Flying\nLandfall — Whenever..."), the per-line fix is a backup — those cases
 * already work via the keyword-preamble-scan path.
 *
 * Tests cover:
 *   (A) Parse-level: multi-line oracle text with an ability-word-prefixed line
 *       correctly yields Triggered/StaticAbility, not Unparsed/Spell.
 *   (B) Execution-level: the trigger fires in a live game scenario.
 *   (C) Honesty: ability-word lines whose body still fails to parse remain
 *       Unparsed at step 5 (no dishonest fabrication).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState, getCardsInZone } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  registerBattlefieldAbilities,
} from '../stack';
import { playLand } from '../actions';
import type { CardDefinition, GameState, CardInstance } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCreature(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature — Test',
    oracle_text: oracleText,
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: 2,
    toughness: 2,
    card_types: ['creature'],
  };
}

function makeEnchantment(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Enchantment',
    oracle_text: oracleText,
    mana_cost: '{1}{U}',
    cmc: 2,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['enchantment'],
  };
}

function makeLand(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function createTestGame(p1Cards: CardDefinition[], p2Cards: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-cmd-1' },
    { playerId: 'p2', name: 'Player 2', cards: p2Cards, commanderId: 'nonexistent-cmd-2' },
  ]);
}

function moveToZone(
  state: GameState,
  instanceId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard',
): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone, summoningSick: false });
  return { ...state, cards: newCards };
}

function findCard(state: GameState, defId: string): CardInstance | undefined {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  return undefined;
}

function countCardsInZone(state: GameState, playerId: string, zone: string): number {
  return getCardsInZone(state, playerId, zone as any).length;
}

// ---------------------------------------------------------------------------
// (A) Parse-level tests: per-line dispatch on multi-line oracle text
// ---------------------------------------------------------------------------

describe('slice4-ability-word-strip parsing', () => {
  /**
   * Domain CDA (Kavu Scout family): "Domain — This creature gets +1/+0 for
   * each basic land type among lands you control."
   *
   * Multi-line face: "Flying" (absorbed in step 1) + domain static line.
   *
   * The domain body is a StaticAbility (CDA matched by matchDynamicCDA /
   * matchStaticAbility).  parseMultipleEffects cannot find any parseable spell
   * effect in the joined token stream, so the per-line dispatch IS entered.
   * Step 2c strips "Domain — " from the second line, then step 3 runs
   * parseOracleText("This creature gets +1/+0 for each basic land type...")
   * which returns StaticAbility.
   *
   * This is the canonical per-line-fix scenario: the ability-word prefix is the
   * SOLE blocker; after stripping, the body parses as StaticAbility.
   */
  it('Domain — static CDA line strips prefix and parses as StaticAbility (per-line fix)', () => {
    const result = parseOracleText(
      'Flying\n' +
      'Domain — This creature gets +1/+0 for each basic land type among lands you control.',
    );
    expect(result.kind).not.toBe('Unparsed');
    expect(result.kind).toBe('StaticAbility');
  });

  /**
   * Magecraft trigger (Symmetry Sage family): "Magecraft — Whenever you cast
   * or copy an instant or sorcery spell, you gain 1 life."
   *
   * Multi-line: "Flying" (in LEADING_PREAMBLE_STARTS) + Magecraft trigger.
   * trimLeadingKeywordOrEnchantPreamble scans past "flying magecraft —" to
   * find "whenever", then matchCastOrCopyInstantOrSorceryPrefix fires.
   * The per-line step 2c is a backup that also handles this correctly.
   *
   * Key assertion: the face is Triggered (not Spell, not Unparsed).
   */
  it('Magecraft — whenever-cast trigger parses as Triggered (multi-line)', () => {
    const result = parseOracleText(
      'Flying\n' +
      'Magecraft — Whenever you cast or copy an instant or sorcery spell, you gain 1 life.',
    );
    expect(result.kind).not.toBe('Unparsed');
    expect(result.kind).toBe('Triggered');
    if (result.kind === 'Triggered') {
      expect(result.ability.trigger.kind).toBe('CastOrCopyInstantOrSorcery');
      expect(result.ability.effects[0].kind).toBe('GainLife');
    }
  });

  /**
   * Landfall trigger (Scute Swarm / Omnath family): "Landfall — Whenever a
   * land you control enters, draw a card."
   *
   * Multi-line: "Flying" (LEADING_PREAMBLE_STARTS) + Landfall trigger.
   * trimLeadingKeywordOrEnchantPreamble scans to "whenever", then
   * matchLandfallPrefix fires.
   *
   * Key assertion: the face is Triggered with Landfall trigger.
   */
  it('Landfall — trigger line parses as Triggered with Landfall trigger (multi-line)', () => {
    const result = parseOracleText(
      'Flying\n' +
      'Landfall — Whenever a land you control enters, draw a card.',
    );
    expect(result.kind).not.toBe('Unparsed');
    expect(result.kind).toBe('Triggered');
    if (result.kind === 'Triggered') {
      expect(result.ability.trigger.kind).toBe('Landfall');
    }
  });

  /**
   * Pack tactics (attacks trigger): "Pack tactics — Whenever ~ attacks, target
   * player loses 1 life."
   *
   * Multi-line: "Haste" (LEADING_PREAMBLE_STARTS) + Pack tactics trigger.
   * After stripping "Pack tactics — " (either via trimLeadingKeyword or per-line
   * step 2c), matchAttacksPrefix fires on "whenever ~ attacks".
   *
   * Key assertion: Triggered with Attacks trigger.
   */
  it('Pack tactics — whenever-attacks trigger parses as Triggered (multi-line)', () => {
    const result = parseOracleText(
      'Haste\n' +
      'Pack tactics — Whenever ~ attacks, target player loses 1 life.',
    );
    expect(result.kind).not.toBe('Unparsed');
    expect(result.kind).toBe('Triggered');
    if (result.kind === 'Triggered') {
      expect(result.ability.trigger.kind).toBe('Attacks');
    }
  });

  /**
   * Hellbent attacks trigger: "Hellbent — Whenever ~ attacks, if you have no
   * cards in hand, ~ gets +2/+0 until end of turn."
   *
   * Multi-line: "Deathtouch" + Hellbent trigger.
   * Expected: Triggered with Attacks trigger (the "if you have no cards in hand"
   * condition is parsed as a modifier on the trigger body).
   */
  it('Hellbent — conditional attacks trigger parses as Triggered (multi-line)', () => {
    const result = parseOracleText(
      'Deathtouch\n' +
      'Hellbent — Whenever ~ attacks, if you have no cards in hand, ~ gets +2/+0 until end of turn.',
    );
    expect(result.kind).not.toBe('Unparsed');
    expect(result.kind).toBe('Triggered');
    if (result.kind === 'Triggered') {
      expect(result.ability.trigger.kind).toBe('Attacks');
    }
  });

  /**
   * Rally — all-ally ETB trigger (Akoum Stonewaker family): "Rally — Whenever
   * ~ or another Ally enters the battlefield under your control, ..."
   *
   * This uses the SelfOrAnotherSubtypeETB trigger prefix. After stripping
   * "Rally — ", the body starts with "Whenever ~ or another Ally enters..."
   * which matchSelfOrAnotherSubtypeETBPrefix handles.
   *
   * We use a simplified body (draw a card) that is parseable.
   */
  it('Rally — ETB trigger parses as Triggered (multi-line with keyword companion)', () => {
    const result = parseOracleText(
      'Flying\n' +
      'Rally — Whenever ~ or another Ally enters the battlefield under your control, you gain 1 life.',
    );
    // After trimLeadingKeywordOrEnchantPreamble scans past "flying rally —",
    // the remaining tokens start with "whenever" and should parse as a trigger.
    expect(result.kind).not.toBe('Unparsed');
  });

  /**
   * Honesty gate: ability-word prefix where the body is genuinely unparseable
   * should NOT be accepted — the face must stay Unparsed at step 5.
   *
   * "Sorcerous Elixir — Exchange control of two target permanents." is
   * an effect the engine cannot execute (no exchange-control family).
   * After stripping "Sorcerous Elixir — " the body still fails → Unparsed.
   */
  it('ability-word prefix with genuinely unparseable body stays Unparsed', () => {
    // Face: "Flying" (absorbed) + unparseable ability-word body
    // After stripping "Sorcerous Elixir — ", the body is:
    // "Exchange control of two target permanents." — not a parseable effect.
    const result = parseOracleText(
      'Flying\n' +
      'Sorcerous Elixir — Exchange control of two target permanents.',
    );
    // The face should be Unparsed (step 5 rejected the body line).
    expect(result.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// (B) Execution-level tests: triggers fire in a live game
// ---------------------------------------------------------------------------

describe('slice4-ability-word-strip execution', () => {
  /**
   * Verify that a "Landfall — Whenever a land you control enters, draw a card."
   * ability on a multi-line face (keyword + landfall) is correctly registered
   * and fires when a land enters under the controller's control.
   */
  it('Landfall trigger from multi-line face fires when a land enters', () => {
    const landfaller = makeCreature(
      'aw-landfaller',
      'Landfall Creature',
      'Vigilance\n' +
      'Landfall — Whenever a land you control enters, draw a card.',
    );
    const forest = makeLand('forest-a', 'Forest');
    const extraForest = makeLand('forest-b', 'Forest');
    const land2 = makeLand('land-p2', 'Forest');

    let state = createTestGame([landfaller, forest, extraForest], [land2]);

    // Place the Landfall creature on the battlefield and register its abilities.
    const landfallerInst = findCard(state, 'aw-landfaller')!;
    state = moveToZone(state, landfallerInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, landfallerInst.instanceId);

    // Confirm the Landfall trigger was registered.
    const abilities = state.battlefieldAbilities.get(landfallerInst.instanceId);
    expect(abilities, 'Landfall creature should have registered abilities').toBeDefined();
    expect(
      abilities!.some(a => a.trigger.kind === 'Landfall'),
      'Landfall trigger must be registered',
    ).toBe(true);

    // Prepare for land play: set phase to precombat main.
    state = {
      ...state,
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main' as any,
      step: 'main' as any,
      landsPlayedThisTurn: 0,
    };

    const handBefore = countCardsInZone(state, 'p1', 'hand');

    // Play a Forest from hand.
    const forestInst = findCard(state, 'forest-a')!;
    state = moveToZone(state, forestInst.instanceId, 'hand');
    state = playLand(state, 'p1', forestInst.instanceId);

    // A Landfall pending trigger should be queued.
    expect(
      state.pendingTriggers.some(t => t.ability.trigger.kind === 'Landfall'),
      'Landfall trigger should be pending after land enters',
    ).toBe(true);

    // Resolve the trigger — it should draw a card.
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);

    expect(countCardsInZone(state, 'p1', 'hand')).toBe(handBefore + 1);
  });

  /**
   * Verify that a "Magecraft — Whenever you cast or copy an instant or sorcery
   * spell, you gain 1 life." trigger on a multi-line face is correctly
   * registered via the ability-word strip (trimLeadingKeyword or per-line step 2c).
   */
  it('Magecraft trigger registers on multi-line face with keyword line', () => {
    const sage = makeEnchantment(
      'aw-sage',
      'Magecraft Enchantment',
      'Flying\n' +
      'Magecraft — Whenever you cast or copy an instant or sorcery spell, you gain 1 life.',
    );
    const land = makeLand('land-p1', 'Forest');
    const land2 = makeLand('land-p2', 'Forest');

    let state = createTestGame([sage, land], [land2]);
    const sageInst = findCard(state, 'aw-sage')!;
    state = moveToZone(state, sageInst.instanceId, 'battlefield');
    state = registerBattlefieldAbilities(state, sageInst.instanceId);

    const abilities = state.battlefieldAbilities.get(sageInst.instanceId);
    expect(abilities, 'Magecraft enchantment should have registered abilities').toBeDefined();
    expect(
      abilities!.some(a => a.trigger.kind === 'CastOrCopyInstantOrSorcery'),
      'Magecraft (CastOrCopyInstantOrSorcery) trigger must be registered',
    ).toBe(true);
  });
});
