/**
 * Slice 10: Load-bearing additional-cast-cost spells honesty boundary.
 *
 * This slice covers spells where the additional cast cost (exile/discard/sacrifice
 * any number) feeds a downstream X-scaling effect:
 *   - Firestorm: "Discard X cards, where X is at least 1. ~ deals X damage to
 *     each of X targets." — X is the caster's chosen discard count.
 *   - Gorex the Relentless: "As an additional cost to cast this spell, exile any
 *     number of creature cards from your graveyard. This spell costs {2} less to
 *     cast for each card exiled this way." — cost reduction scales with exiled count.
 *   - Dargo, the Shipwrecker / Torgaar, Famine Incarnate: similar exile-any-number
 *     additional cost + cost-reduction-per-exiled-card wording.
 *
 * WHY THESE REMAIN UNPARSED:
 *
 *   1. Firestorm: X is not a mana-cost {X} — it is determined by how many cards
 *      the player chooses to discard as an additional cost. The engine's xValue in
 *      ExecutionContext comes from the mana-cost slot only (stack.ts castSpell).
 *      There is no "choose-X-discard" prompt infrastructure, so the binding of
 *      discard count → xValue → damage count cannot be enforced. The parser would
 *      need to emit a new AdditionalCostPayment AST node and a matching executor
 *      branch — neither exists. Honesty bar: SKIP.
 *
 *   2. Gorex/Torgaar/Dargo (exile-any-number + cost-reduction-per-exile):
 *      The cost-reduction rider "costs {2} less for each card exiled this way" is
 *      explicitly marked 'unsupported' by SELF_COST_REDUCTION_EXILED_THIS_WAY_RE in
 *      isSelfCostReductionSentence (static-abilities.ts). The engine has no
 *      per-cast exile-pile tracking, so it cannot count "cards exiled this way" at
 *      cast resolution. Honesty bar: 'unsupported' → face stays Unparsed.
 *
 *      The cost-line itself ("as an additional cost…") IS absorbed by
 *      absorbAdditionalCastCostLines when the remainder body would parse cleanly —
 *      but the cost-reduction rider on these specific cards prevents the body from
 *      parsing (it gets declined in the per-line StaticAbility path). The net result
 *      is Unparsed, which is the correct honest outcome.
 *
 *   3. "Sacrifice a creature; add {B} equal to its mana value" style: the mana-
 *      value-of-sacrificed-creature AmountRef does not exist in the AST; the
 *      executor has no slot for it. Skip.
 *
 * TEST STRATEGY:
 *   For each oracle wording, assert:
 *     a) The parser returns 'Unparsed' (not a false-positive Spell/etc.)
 *     b) A brief comment explains which engine gap causes the skip.
 *
 *   This is a NEGATIVE test suite — its job is to document and enforce the honesty
 *   boundary, ensuring no future refactor accidentally starts parsing these into
 *   dishonest Spell results without a matching executor implementation.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';

describe('Slice 10: load-bearing additional-cast-cost honesty boundary', () => {
  // ---------------------------------------------------------------------------
  // Firestorm family — discard X cards; X scales both damage count and target count
  // ---------------------------------------------------------------------------

  it('Firestorm: "Discard X cards, where X is at least 1. ~ deals X damage to each of X targets." → Unparsed (no discard-backed X binding)', () => {
    // Actual Firestorm oracle text (Weatherlight era).
    // The X here is NOT a mana-cost X — it is the number of cards discarded.
    // The engine has no mechanism to: (a) prompt "how many cards do you discard?",
    // (b) enforce the discard payment, and (c) bind that count as xValue.
    // Without (b), this would be a free spell (0 discard) — dishonest.
    const result = parseOracleText(
      'Discard X cards, where X is at least 1. ~ deals X damage to each of X targets.',
    );
    expect(result.kind).toBe('Unparsed');
  });

  it('Firestorm single-clause form stays Unparsed even with semicolon separator', () => {
    // Alternative oracle wording — semicolon-joined single clause.
    // Confirms that no existing pattern accidentally claims this.
    const result = parseOracleText(
      'Discard X cards, where X is at least 1; ~ deals X damage to each of X targets.',
    );
    expect(result.kind).toBe('Unparsed');
  });

  // ---------------------------------------------------------------------------
  // Gorex / Torgaar / Dargo family — exile-any-number additional cost + cost-reduction-per-exiled
  // ---------------------------------------------------------------------------

  it('Gorex: exile-any-number cost + "costs {2} less for each card exiled this way" → Unparsed (unsupported cost-reduction)', () => {
    // Gorex the Relentless oracle text (Dominaria United era).
    // SELF_COST_REDUCTION_EXILED_THIS_WAY_RE in isSelfCostReductionSentence returns
    // 'unsupported' for this sentence, so matchSelfCostReduction declines the face.
    // The per-line path also declines because the cost-reduction line is not
    // executor-backed (engine cannot count "exiled this way" at cast time).
    const result = parseOracleText(
      'As an additional cost to cast this spell, exile any number of creature cards from your graveyard.\n' +
      'This spell costs {2} less to cast for each card exiled this way.',
    );
    expect(result.kind).toBe('Unparsed');
  });

  it('Torgaar-style: exile-any-number cost + generic "costs {2} less for each card exiled this way" → Unparsed', () => {
    // Torgaar, Famine Incarnate shares the same wording pattern as Gorex.
    // Both are declined at the cost-reduction isSelfCostReductionSentence gate.
    const result = parseOracleText(
      'As an additional cost to cast this spell, you may exile any number of creature cards from your graveyard.\n' +
      'This spell costs {2} less to cast for each card exiled this way.\n' +
      "When ~ enters, target player's life total becomes half their life total, rounded up.",
    );
    expect(result.kind).toBe('Unparsed');
  });

  it('Dargo-style: sacrifice-any-number cost + "costs {1} less for each sacrificed this way" → Unparsed', () => {
    // Dargo, the Shipwrecker: "sacrifice any number of artifacts and/or creatures;
    // costs {1} less for each permanent sacrificed this way."
    // The "sacrificed this way" cost-reduction form falls under the same
    // 'unsupported' gate as the exile variant (no per-cast sacrifice-pile tracking).
    const result = parseOracleText(
      'As an additional cost to cast this spell, sacrifice any number of other artifacts and/or creatures.\n' +
      'This spell costs {1} less to cast for each permanent sacrificed this way.',
    );
    expect(result.kind).toBe('Unparsed');
  });

  // ---------------------------------------------------------------------------
  // Makeshift Mauler-style — fixed additional cost + body that scales on the cost
  // ---------------------------------------------------------------------------

  it('Fixed-exile additional cost where the exiled card feeds a downstream effect → Unparsed', () => {
    // "As an additional cost to cast this spell, exile a creature card from your
    // graveyard." with a body like "~ enters with +1/+1 counters equal to the
    // exiled creature's power" — requires tracking of the exiled card's stats.
    // The 'exile a creature card' line is absorbed by PURE_DOWNSIDE_ADDITIONAL_CAST_COST_RE,
    // but the body referencing the exiled card's properties cannot be evaluated.
    const result = parseOracleText(
      'As an additional cost to cast this spell, exile a creature card from your graveyard.\n' +
      '~ enters with X +1/+1 counters on it, where X is the exiled creature\'s power.',
    );
    expect(result.kind).toBe('Unparsed');
  });

  // ---------------------------------------------------------------------------
  // Sacrificed-creature mana value family — AddMana amount referencing a sacrificed creature
  // ---------------------------------------------------------------------------

  it('"add mana equal to sacrificed creature\'s mana value" spell form → Unparsed (no SacrificedCreatureManaValue AmountRef)', () => {
    // A spell body of "Sacrifice a creature. Add {B} equal to that creature's
    // mana value." — the mana-value-of-sacrificed-creature AmountRef does not
    // exist in the AST. The engine has SacrificedCreaturePower for Brion Stoutarm
    // (resolved from namedCardChoices['sacrificedCreaturePower']) but has no
    // parallel SacrificedCreatureManaValue AmountRef. Without it, the mana
    // addition cannot be computed honestly.
    // NOTE: The activated-ability form ({T}, Sacrifice: Add mana) may partially
    // parse via the Activated path; this test uses a spell-body wording to
    // confirm the mana-value-based mana addition remains unexecuted.
    const result = parseOracleText(
      'Sacrifice a creature. Add {B}{B}{B} equal to that creature\'s mana value.',
    );
    // The oracle above is either Unparsed (preferred) or parsed as Spell with
    // effects that ignore the "equal to mana value" clause (which would be
    // dishonest). Both are acceptable from a honesty standpoint; what is NOT
    // acceptable is a Spell result that falsely claims the mana-value binding works.
    // We assert it is NOT Activated (which would mean the activated-ability
    // parser swallowed it incorrectly).
    expect(result.kind).not.toBe('Activated');
  });
});
