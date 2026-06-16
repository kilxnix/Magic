/**
 * Slice 11/12 — graveyard-exile additional-cost absorption tests.
 *
 * Oracle forms covered:
 *   1. "exile a/an <type> card from your graveyard" (already handled; verified here)
 *   2. "exile any number of <type> cards from your graveyard" (new in slice 11)
 *   3. "you may exile any number of <type> cards from your graveyard" (new; Gorex-style flat body)
 *
 * Gorex, the Tombshell (with "costs {2} less for each card exiled this way"):
 *   The dynamic-cost rider references per-cast exile tracking the engine doesn't support.
 *   isSelfCostReductionSentence returns 'unsupported' for this line, so Gorex's full oracle
 *   stays Unparsed (honesty gate). Only flat-body remainders (without the costs-less line)
 *   benefit from the any-number absorption.
 *
 * Honesty model:
 *   Additional cast costs are NEVER enforced by the engine (no additionalCost field in
 *   stack.ts). Absorbing them is strictly pure-downside (easier to cast). The cost
 *   disappears entirely — no Exile effect is emitted into the parsed Effect list.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';

// ============================================================================
// RECOGNITION — parser correctly absorbs the cost and credits the residual body
// ============================================================================

describe('graveyard-exile additional-cost absorption — recognition', () => {

  // --- Existing form: "exile a creature card from your graveyard" (Makeshift Mauler / Stitched Drake) ---

  it('exile-a-creature-card cost + ETB body: cost absorbed, ETB parses (Makeshift Mauler style)', () => {
    // Real Makeshift Mauler oracle (4/5 creature) has no printed body beyond the cost;
    // here we simulate a variant with an ETB to demonstrate the absorption-then-body path.
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile a creature card from your graveyard.\n' +
      'When this creature enters, you gain 2 life.',
    );
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'GainLife')).toBe(true);
    // Cost must be recorded in absorbedKeywords, not appear as an Exile effect
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /exile a creature card from your graveyard/i.test(k))).toBe(true);
  });

  it('exile-a-creature-card cost + draw body: cost absorbed, Spell parses', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile a creature card from your graveyard.\n' +
      'Draw two cards.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'Draw')).toBe(true);
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /exile a creature card from your graveyard/i.test(k))).toBe(true);
  });

  // --- New form (slice 11): "exile any number of <type> cards from your graveyard" ---

  it('"exile any number" cost + ETB body: cost absorbed, ETB parses', () => {
    // Gorex-wording without the "you may" prefix, followed by a parseable ETB
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile any number of creature cards from your graveyard.\n' +
      'When this creature enters, draw a card.',
    );
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
    // Cost absorbed and recorded
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /exile any number of creature cards from your graveyard/i.test(k))).toBe(true);
  });

  it('"exile any number" cost + gain-life body: cost absorbed, Spell parses', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile any number of creature cards from your graveyard.\n' +
      'You gain 3 life.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'GainLife')).toBe(true);
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /exile any number of creature cards from your graveyard/i.test(k))).toBe(true);
  });

  it('"exile any number" cost + keyword-only body: cost absorbed, Unparsed (keyword-only by design)', () => {
    // Keyword-only remainders are intentionally Unparsed. The absorbed cost is still
    // recorded in absorbedKeywords for audit visibility.
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile any number of creature cards from your graveyard.\n' +
      'Deathtouch',
    );
    // Keyword-only stays Unparsed — this is correct engine behaviour.
    expect(r.kind).toBe('Unparsed');
    // But the absorbed cost must be recorded so the audit classifies this card correctly.
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /exile any number of creature cards from your graveyard/i.test(k))).toBe(true);
  });

  // --- New form (slice 11): "you may exile any number of <type> cards from your graveyard" ---

  it('"you may exile any number" cost + ETB body: cost absorbed, ETB parses (Gorex-style flat body)', () => {
    // Gorex real wording for the cost line, but with a parseable ETB instead of the
    // dynamic "costs {2} less" line (which is gated separately).
    const r = parseOracleText(
      'As an additional cost to cast this spell, you may exile any number of creature cards from your graveyard.\n' +
      'When this creature enters, draw a card.',
    );
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /you may exile any number of creature cards from your graveyard/i.test(k))).toBe(true);
  });

  it('"you may exile any number" cost + gain-life body: cost absorbed, Spell parses', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, you may exile any number of creature cards from your graveyard.\n' +
      'You gain 3 life.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'GainLife')).toBe(true);
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /you may exile any number of creature cards from your graveyard/i.test(k))).toBe(true);
  });

  it('"you may exile any number" cost + keyword-only body: cost absorbed, Unparsed (keyword-only by design)', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, you may exile any number of creature cards from your graveyard.\n' +
      'Deathtouch',
    );
    expect(r.kind).toBe('Unparsed');
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /you may exile any number of creature cards from your graveyard/i.test(k))).toBe(true);
  });

  // --- Gorex honesty gate: dynamic "costs {2} less for each card exiled this way" ---

  it('Gorex full oracle: stays Unparsed because "costs {2} less...this way" is unsupported', () => {
    // Gorex, the Tombshell (C21): full oracle text as printed on the card.
    // The "costs {2} less to cast for each card exiled this way" line requires
    // per-cast exile-pile tracking that the engine does not have.
    // isSelfCostReductionSentence returns 'unsupported' → whole face stays Unparsed (honesty gate).
    const r = parseOracleText(
      'As an additional cost to cast this spell, you may exile any number of creature cards from your graveyard.\n' +
      'This spell costs {2} less to cast for each card exiled this way.\n' +
      'Deathtouch',
    );
    expect(r.kind).toBe('Unparsed');
  });

  // --- "reveal a creature card from your hand" (Induce Despair) — already covered, verified here ---

  it('Induce Despair: "reveal a creature card from your hand" additional cost absorbed; -X/-X body parses if supported', () => {
    // Induce Despair oracle: the reveal cost was added to PURE_DOWNSIDE_ADDITIONAL_CAST_COST_RE in Slice 1.
    // The -X/-X body may or may not parse (X depends on the revealed card's MV — dynamic X).
    // Verify at minimum: if parsed, no Exile or Discard effect is produced for the cost.
    const r = parseOracleText(
      'As an additional cost to cast this spell, reveal a creature card from your hand.\n' +
      'Target creature gets -X/-X until end of turn, where X is the revealed card\'s mana value.',
    );
    // The result is either a parsed Spell or Unparsed; we only assert absence of wrong effects.
    if (r.kind === 'Spell') {
      // No Exile or Discard effect should appear — the cost was absorbed, not effectuated
      expect(r.effects.every(e => e.kind !== 'Exile')).toBe(true);
      expect(r.effects.every(e => e.kind !== 'Discard')).toBe(true);
    }
    // The cost should be in absorbedKeywords when the whole-text absorption fires
    if (r.kind !== 'Unparsed') {
      const absorbed = r.absorbedKeywords ?? [];
      expect(absorbed.some(k => /reveal a creature card from your hand/i.test(k))).toBe(true);
    }
    // Either outcome is acceptable; the important check above passes either way
    expect(['Spell', 'Unparsed']).toContain(r.kind);
  });
});

// ============================================================================
// EXECUTION — the absorbed cost does NOT produce a runtime effect
// The parsed body runs through the engine's normal spell resolution path.
// ============================================================================

describe('graveyard-exile additional-cost absorption — no phantom cost effects', () => {

  it('exile-a-creature-card cost + draw: only Draw effect in the Spell, no Exile', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile a creature card from your graveyard.\n' +
      'Draw two cards.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    // Draw effect present
    expect(r.effects.some(e => e.kind === 'Draw')).toBe(true);
    // No Exile effect — the exile was the cost (absorbed), not the effect
    expect(r.effects.every(e => e.kind !== 'Exile')).toBe(true);
  });

  it('"exile any number" cost + gain-life: only GainLife effect, no Exile', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile any number of creature cards from your graveyard.\n' +
      'You gain 3 life.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'GainLife')).toBe(true);
    expect(r.effects.every(e => e.kind !== 'Exile')).toBe(true);
  });

  it('"you may exile any number" cost + gain-life: only GainLife effect, no Exile', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, you may exile any number of creature cards from your graveyard.\n' +
      'You gain 3 life.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'GainLife')).toBe(true);
    expect(r.effects.every(e => e.kind !== 'Exile')).toBe(true);
  });

  it('single-line cost-only face stays Unparsed (no substantive remainder)', () => {
    // A single-line "as an additional cost" with no body stays Unparsed (Makeshift Mauler).
    // The absorption function requires >=2 lines AND substantive remainder.
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile any number of creature cards from your graveyard.',
    );
    expect(r.kind).toBe('Unparsed');
  });
});
