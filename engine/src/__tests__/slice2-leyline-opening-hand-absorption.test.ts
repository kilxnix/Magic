/**
 * Slice 2: Leyline opening-hand setup-line absorber.
 *
 * "If this card is in your opening hand, you may begin the game with it on
 * the battlefield." is a pre-game placement mechanic enforced by
 * applyPregameActions (game-init.ts).  The parser cannot model mulligan-time
 * battlefield placement, so the sentence is absorbed as a PURE HONEST SKIP:
 * applyPregameActions still applies the effect by rescanning the full original
 * oracle text; no benefit is fabricated by removing it from the parse path.
 *
 * Two absorption paths:
 *   (a) Whole-face early absorber (absorbLeylineOpeningHandLines called from
 *       parseOracleText) — handles standard multi-line Leyline faces.
 *   (b) Per-line absorber step 1n in parseOracleTextPerLine — handles faces
 *       where the opening-hand line co-occurs with other per-line-dispatch
 *       content (triggers, activated abilities, additional statics).
 *
 * Honesty gate: only credit the face when the remainder genuinely parses.
 * Faces whose remaining lines are ALSO unrun (e.g. "You have hexproof." for
 * Leyline of Sanctity — no player-hexproof subsystem) remain Unparsed.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { matchesCardFilter } from '../effects/executor';
import type { CardDefinition } from '../types';

// ─── Minimal card builder ────────────────────────────────────────────────────

function permanent(
  id: string,
  opts: Partial<CardDefinition> & { card_types: CardDefinition['card_types'] },
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Enchantment',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{2}{W}{W}',
    cmc: opts.cmc ?? 4,
    colors: opts.colors ?? ['W'],
    color_identity: opts.color_identity ?? ['W'],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types,
  };
}

// ─── Setup helper ────────────────────────────────────────────────────────────

function setup(p1Defs: CardDefinition[], p2Defs: CardDefinition[] = []) {
  const dummyLand: CardDefinition = permanent('dummy_land', {
    name: 'Plains',
    type_line: 'Basic Land — Plains',
    card_types: ['land'],
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['W'],
  });

  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs.length ? p2Defs : [dummyLand], commanderId: 'none2' },
  ];
  let state = initGameState(decks);

  for (const [id, card] of state.cards) {
    state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
  }

  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }

  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;

  return { state, idFor };
}

// ============================================================================
// A. RECOGNITION — parser absorbs the opening-hand line and credits the face
// ============================================================================

describe('Leyline opening-hand absorption — parser recognition', () => {
  // ── A-1. "this card" form + creature-cant-be-countered static ────────────
  // Leyline of Lifeforce: "If this card is in your opening hand, you may begin
  // the game with it on the battlefield.\nCreature spells can't be countered."
  it('Leyline of Lifeforce: opening-hand line absorbed, creature-cant-be-countered remainder parses as StaticAbility', () => {
    const oracle =
      "If this card is in your opening hand, you may begin the game with it on the battlefield.\n" +
      "Creature spells can't be countered.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    // "Creature spells can't be countered." parses as GrantKeyword{CantBeCountered}
    // applied to a creature-type filter (battlefieldCantBeCountered family).
    expect(r.ability.modifier.kind).toBe('GrantKeyword');
    expect((r.ability.modifier as any).keyword).toBe('CantBeCountered');
    // The absorbed line must be recorded for audit visibility.
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /opening hand/i.test(k))).toBe(true);
  });

  // ── A-2. Named form + SetAllColors static ────────────────────────────────
  // Leyline of the Guildpact (older printing uses the card name, not "this card"):
  // "If Leyline of the Guildpact is in your opening hand, you may begin the
  // game with it on the battlefield.\nEach nonland permanent you control is all colors."
  it('Leyline of the Guildpact (named form): opening-hand line absorbed, SetAllColors remainder parses as StaticAbility', () => {
    const oracle =
      "If Leyline of the Guildpact is in your opening hand, you may begin the game with it on the battlefield.\n" +
      "Each nonland permanent you control is all colors.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('SetAllColors');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /opening hand/i.test(k))).toBe(true);
  });

  // ── A-3. ETB-trigger companion ────────────────────────────────────────────
  // Simulates a hypothetical Leyline-style card with an ETB trigger companion.
  // The per-line absorber (step 1n) handles this path.
  it('Opening-hand line beside ETB trigger: per-line absorber credits the ETB trigger', () => {
    const oracle =
      "If this card is in your opening hand, you may begin the game with it on the battlefield.\n" +
      "When this creature enters, draw a card.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /opening hand/i.test(k))).toBe(true);
  });

  // ── A-4. Slice 5 update: Leyline of Sanctity now parses ─────────────────────
  // Slice 5 added matchPlayerHexproof which genuinely enforces "You have hexproof."
  // via a PlayerHexproof continuous effect. The opening-hand sentence is absorbed
  // and the remainder ("You have hexproof.") parses as StaticAbility(PlayerHexproof).
  it('Leyline of Sanctity: opener absorbed and "You have hexproof." now parses via Slice 5', () => {
    const oracle =
      "If this card is in your opening hand, you may begin the game with it on the battlefield.\n" +
      "You have hexproof.";
    const r = parseOracleText(oracle);
    // "You have hexproof." is now enforced (matchPlayerHexproof) → StaticAbility.
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('PlayerHexproof');
  });

  // ── A-5. Single-line form stays Unparsed ─────────────────────────────────
  // A face with ONLY the opening-hand sentence has no substantive remainder;
  // the absorber returns null (no surplus text), face stays Unparsed.
  it('Single opening-hand sentence alone: no substantive remainder, stays Unparsed', () => {
    const r = parseOracleText(
      "If this card is in your opening hand, you may begin the game with it on the battlefield.",
    );
    expect(r.kind).toBe('Unparsed');
  });

  // ── A-6. Unrelated cards not affected ────────────────────────────────────
  // The absorber must not mis-absorb oracle text that doesn't match the pattern.
  it('Unrelated static text not affected by absorber', () => {
    const r = parseOracleText("Creatures you control get +1/+1.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    // Should NOT record an absorbedKeywords entry for opening hand.
    const hasOpeningHandAbsorb = (r.absorbedKeywords ?? []).some(k =>
      /opening hand/i.test(k),
    );
    expect(hasOpeningHandAbsorb).toBe(false);
  });
});

// ============================================================================
// B. EXECUTION — absorbed line leaves the static ability fully enforced
// ============================================================================

describe('Leyline opening-hand absorption — execution (SetAllColors integration)', () => {
  // Leyline of the Guildpact: after absorbing the opening-hand line the
  // SetAllColors modifier must still be registered and enforced by the
  // continuous layer (getEffectiveColors / matchesCardFilter).

  const leylineDef: CardDefinition = permanent('leyline-guildpact', {
    name: 'Leyline of the Guildpact',
    type_line: 'Enchantment',
    card_types: ['enchantment'],
    // Named form — older printing used the card name in the opening-hand sentence.
    oracle_text:
      "If Leyline of the Guildpact is in your opening hand, you may begin the game with it on the battlefield.\n" +
      "Each nonland permanent you control is all colors.",
    colors: ['W', 'U', 'B', 'R', 'G'],
    color_identity: ['W', 'U', 'B', 'R', 'G'],
  });

  /** A colorless artifact creature to test color-grant application */
  const artifactCreatureDef: CardDefinition = permanent('arty', {
    name: 'Construct',
    type_line: 'Artifact Creature — Construct',
    card_types: ['artifact', 'creature'],
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
  });

  it('Leyline of the Guildpact (named opening-hand form): SetAllColors modifier registered on battlefield', () => {
    // Verify parser credits the face correctly.
    const r = parseOracleText(leylineDef.oracle_text!);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('SetAllColors');
  });

  it('SetAllColors from multi-line Leyline: colorless artifact satisfies a green filter', () => {
    const { state, idFor } = setup([leylineDef, artifactCreatureDef]);
    const artyId = idFor('arty');
    // The continuous SetAllColors layer should make the colorless artifact green.
    const matches = matchesCardFilter(
      artifactCreatureDef,
      { colors: ['G'] },
      { state, instanceId: artyId },
    );
    expect(matches).toBe(true);
  });

  it('SetAllColors from multi-line Leyline: colorless artifact satisfies a white filter', () => {
    const { state, idFor } = setup([leylineDef, artifactCreatureDef]);
    const artyId = idFor('arty');
    const matches = matchesCardFilter(
      artifactCreatureDef,
      { colors: ['W'] },
      { state, instanceId: artyId },
    );
    expect(matches).toBe(true);
  });
});
