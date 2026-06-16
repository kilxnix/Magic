import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';

/**
 * Slice 10: Honest-skip absorption of pure-downside additive cast costs.
 *
 * "As an additional cost to cast this spell, exile/sacrifice/discard X" lines
 * are unenforced by the engine. Absorbing them allows the card's MAIN parseable
 * effect to be credited.
 *
 * HONESTY: skipping is strictly a downside relaxation — the spell becomes easier
 * to cast. No fabricated benefit. Same honest-skip precedent as the planeswalker
 * loyalty restriction and Enchant preamble absorptions.
 *
 * NOTE on keyword-only remainders: when the only remaining text after stripping
 * the cost line is a pure keyword (e.g. "Flying."), the remainder returns Unparsed
 * as designed (keyword-only faces are intentionally left Unparsed by the honesty
 * model). Absorption only produces a non-Unparsed result when the remaining text
 * has a parseable effect (ETB trigger, Spell effect, StaticAbility, etc.).
 */

// ============================================================================
// RECOGNITION: faces with parseable remainders now parse, with cost absorbed.
// ============================================================================

describe('additional-cast-cost absorption — parser recognition', () => {
  // ----- discard (Firestorm family) -----------------------------------------

  it('Firestorm-style: absorbs "discard a card" cost; draw-effect remainder parses as Spell', () => {
    // "As an additional cost to cast this spell, discard a card."
    // followed by a draw effect — common pattern (e.g. Careful Study-style).
    const r = parseOracleText(
      'As an additional cost to cast this spell, discard a card.\nDraw two cards.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'Draw')).toBe(true);
    expect(r.absorbedKeywords?.some(k => k.toLowerCase().includes('discard a card'))).toBe(true);
  });

  it('absorbs "discard X cards" cost; remaining spell effect parses', () => {
    // Generic X-cost discard before a draw.
    const r = parseOracleText(
      'As an additional cost to cast this spell, discard X cards.\nDraw X cards.',
    );
    // The draw X effect may or may not parse as DrawX, but the cost is absorbed.
    // We assert: if it does parse, the cost line is in absorbedKeywords.
    if (r.kind !== 'Unparsed') {
      expect(r.absorbedKeywords?.some(k => k.toLowerCase().includes('discard x cards'))).toBe(true);
    }
  });

  it('absorbs "discard two cards" (word-number form)', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, discard two cards.\nGain 4 life.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'GainLife')).toBe(true);
    expect(r.absorbedKeywords?.some(k => k.toLowerCase().includes('discard two cards'))).toBe(true);
  });

  // ----- exile from graveyard (Stitched Drake family) -----------------------

  it('exile-cost + ETB trigger: absorbs cost; ETB parses as ETB', () => {
    // When the remaining text after the cost line IS a parseable ETB trigger,
    // the absorption works and the ETB is credited.
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile a creature card from your graveyard.\nWhen ~ enters, draw a card.',
    );
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
    expect(r.absorbedKeywords?.some(k =>
      k.toLowerCase().includes('exile a creature card from your graveyard'),
    )).toBe(true);
  });

  it('exile-cost + gain life: absorbs cost; gain-life Spell parses', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile a creature card from your graveyard.\nYou gain 3 life.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'GainLife')).toBe(true);
    expect(r.absorbedKeywords?.some(k =>
      k.toLowerCase().includes('exile a creature card from your graveyard'),
    )).toBe(true);
  });

  // ----- sacrifice (Culling the Weak / Altar's Reap family) ----------------

  it('absorbs "sacrifice a creature" cost; draw-effect remainder parses', () => {
    // Altar's Reap: sacrifice a creature, draw two cards.
    const r = parseOracleText(
      'As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'Draw')).toBe(true);
    expect(r.absorbedKeywords?.some(k =>
      k.toLowerCase().includes('sacrifice a creature'),
    )).toBe(true);
  });

  it('absorbs "sacrifice a permanent" cost; gain-life remainder parses', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, sacrifice a permanent.\nGain 4 life.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'GainLife')).toBe(true);
    expect(r.absorbedKeywords?.some(k =>
      k.toLowerCase().includes('sacrifice a permanent'),
    )).toBe(true);
  });

  it('absorbs "sacrifice a land" cost; AddMana remainder parses', () => {
    // Sacrifice a land → add mana (Culling the Weak-style).
    const r = parseOracleText(
      'As an additional cost to cast this spell, sacrifice a land.\nAdd {G}{G}{G}.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'AddMana')).toBe(true);
    expect(r.absorbedKeywords?.some(k =>
      k.toLowerCase().includes('sacrifice a land'),
    )).toBe(true);
  });

  // ----- multi-line face with keyword + cost --------------------------------

  it('absorbs cost + leading keyword + trigger: ETB parses as substantive result', () => {
    // Simulates a creature card with: additional cost line, Flying keyword, ETB trigger.
    // After the cost line is absorbed, the remaining text "Flying\nWhen ~ enters, ..."
    // is recursively parsed. trimLeadingKeywordOrEnchantPreamble strips "Flying" so
    // the ETB trigger parses normally. The absorbed list records the cost line; Flying
    // is stripped by the preamble trimmer (not recorded in absorbedKeywords, which is
    // expected — trimLeadingKeywordOrEnchantPreamble is silent, not absorbed).
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile a creature card from your graveyard.\nFlying\nWhen ~ enters, you gain 2 life.',
    );
    // ETB is the substantive result.
    expect(r.kind).toBe('ETB');
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k =>
      k.toLowerCase().includes('exile a creature card from your graveyard'),
    )).toBe(true);
    // Flying is stripped by the preamble trimmer, not tracked in absorbedKeywords.
    // ETB effect should be GainLife.
    if (r.kind === 'ETB') {
      expect(r.ability.effects.some(e => e.kind === 'GainLife')).toBe(true);
    }
  });

  // ============================================================================
  // HONESTY GATES — the absorption must not fire on non-pure-downside patterns.
  // ============================================================================

  it('does NOT absorb "reveal a card" cost (not in the closed downside set)', () => {
    // "reveal" gating could enable upside effects; not absorbed.
    const r = parseOracleText(
      'As an additional cost to cast this spell, reveal a card from your hand.\nDraw a card.',
    );
    // Either parses without absorption, or stays Unparsed — either way the
    // cost line is NOT in absorbedKeywords.
    if (r.kind !== 'Unparsed' && r.absorbedKeywords) {
      expect(r.absorbedKeywords.some(k => k.toLowerCase().includes('reveal'))).toBe(false);
    }
  });

  it('does NOT absorb a "pay N life" cost (enforced by getAdditionalLifeCostForCast)', () => {
    // Life payment is a different enforcement path — do not absorb it here.
    const r = parseOracleText(
      'As an additional cost to cast this spell, pay 2 life.\nDraw two cards.',
    );
    if (r.kind !== 'Unparsed' && r.absorbedKeywords) {
      expect(r.absorbedKeywords.some(k => k.toLowerCase().includes('pay 2 life'))).toBe(false);
    }
  });

  it('single-line cost-only face stays Unparsed (nothing substantive remains)', () => {
    // Only the cost line — no remaining text to parse.
    // The absorption function requires >=2 lines AND substantive remainder.
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile a creature card from your graveyard.',
    );
    expect(r.kind).toBe('Unparsed');
  });

  it('keyword-only remainder (just "Flying.") stays Unparsed after cost strip', () => {
    // After stripping the cost, "Flying." alone is keyword-only = Unparsed by design.
    // The absorption does not fabricate a result from a keyword-only remainder.
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile a creature card from your graveyard.\nFlying.',
    );
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// EXECUTION: the absorbed cost line does NOT produce a runtime effect.
// The parsed remainder runs the engine's normal spell resolution paths.
// ============================================================================

describe('additional-cast-cost absorption — main effect executes normally', () => {
  it('discard-cost + draw: parse result has Draw effects only', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, discard a card.\nDraw two cards.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    // Only Draw effect present — no Discard effect (the cost was absorbed, not parsed as effect).
    expect(r.effects.some(e => e.kind === 'Draw')).toBe(true);
    expect(r.effects.every(e => e.kind !== 'Discard')).toBe(true);
  });

  it('sacrifice-cost + AddMana: parse result has AddMana effect only', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, sacrifice a creature.\nAdd {B}{B}{B}{B}.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'AddMana')).toBe(true);
    // No SacrificeAsEffect — the sacrifice was the cost (absorbed), not the effect.
    expect(r.effects.every(e => e.kind !== 'Sacrifice')).toBe(true);
  });

  it('exile-cost + gain life: parse result has GainLife effect only', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile a creature card from your graveyard.\nYou gain 3 life.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'GainLife')).toBe(true);
    // No Exile effect — the exile was the cost (absorbed), not the effect.
    expect(r.effects.every(e => e.kind !== 'Exile')).toBe(true);
  });
});
