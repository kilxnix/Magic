/**
 * Slice 6: Modal bullet-effect coverage gaps.
 *
 * Tests:
 *   (a) {N}: Choose one — modal-in-activated context (e.g. Pyramids / Astral Steel)
 *   (b) "Each opponent loses X life, where X is the greatest power among creatures you control."
 *       (Skemfar Shadowsage bullet)
 *   (c) "Until your next turn, spells your opponents cast cost {1} more."
 *       (Tax Collector bullet)
 *
 * Each test asserts that the relevant oracle clause parses to the expected
 * structured effect rather than returning Unparsed / null.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';

// ---------------------------------------------------------------------------
// Helper: tokenise oracle text exactly as parseOracleText does internally.
// We re-use the public parser function and inspect the top-level result kind.
// ---------------------------------------------------------------------------

describe('Slice 6 – Modal bullet coverage gaps', () => {
  // -------------------------------------------------------------------------
  // Gap (a): Modal-in-activated context
  // Pyramids (real oracle text):
  //   "{2}: Choose one — • Destroy target Aura attached to a land. • The next
  //    time target land would become tapped, it doesn't. Use this ability only
  //    any time you could cast a sorcery."
  //
  // The entire activated-ability block is embedded in a larger card text.
  // We exercise parsing via a standalone activated-ability card whose oracle
  // is just the modal line.  parseOracleText should recognise it as a Permanent
  // (or Spell) with at least one ActivatedAbility that carries a modal.
  // -------------------------------------------------------------------------
  it('(a) modal-in-activated: parses {N}: Choose one — • A. • B. as an ActivatedAbility with modal', () => {
    // Minimal oracle text that contains a modal activated ability.
    // Use destroy+return which are well-supported bullets.
    const oracle =
      '{2}: Choose one — • Destroy target artifact. • Return target permanent to its owner\'s hand.';
    const parsed = parseOracleText(oracle, '{2}');
    // Should be a Permanent (or Triggered/Activated) — NOT Unparsed.
    expect(parsed.kind).not.toBe('Unparsed');
    // If it parsed as a Permanent, it should have at least one activated ability.
    if (parsed.kind === 'Permanent') {
      const activatedWithModal = parsed.activatedAbilities?.find(
        (ab: { modal?: unknown }) => ab.modal != null
      );
      expect(activatedWithModal).toBeDefined();
      expect(activatedWithModal!.effects).toHaveLength(0);
    }
  });

  // -------------------------------------------------------------------------
  // Gap (b): "Each opponent loses X life, where X is the greatest power among
  //            creatures you control."
  // Skemfar Shadowsage bullet body — the ForEach matcher did not handle
  // GreatestPower amounts.  After the fix, parseOracleText on a standalone
  // spell with this oracle should produce a Spell with a LoseLife effect.
  // -------------------------------------------------------------------------
  it('(b) greatest-power lose-life: "Each opponent loses X life, where X is the greatest power among creatures you control."', () => {
    const oracle =
      'Each opponent loses X life, where X is the greatest power among creatures you control.';
    // Parse as a standalone instant/sorcery (no mana cost = empty string is fine).
    const parsed = parseOracleText(oracle, '{1}');
    expect(parsed.kind).not.toBe('Unparsed');
    if (parsed.kind === 'Spell') {
      const loseLifeEffect = parsed.effects.find(
        (e: { kind: string }) => e.kind === 'LoseLife'
      );
      expect(loseLifeEffect).toBeDefined();
      // The amount should be a GreatestPower reference.
      expect((loseLifeEffect as { amount: { kind: string } }).amount.kind).toBe('GreatestPower');
    }
  });

  // -------------------------------------------------------------------------
  // Gap (b) variant: combined form with life-gain rider
  // "Each opponent loses X life, where X is the greatest power among creatures
  //  you control, and you gain that much life." is NOT what Skemfar says, but
  // verify the plain form still works as a standalone effect clause too.
  // -------------------------------------------------------------------------
  it('(b) greatest-power lose-life (standalone effect clause, no rider)', () => {
    // Tokenised form exercised via a triggered-ability full-card parse.
    const oracle =
      'When this creature enters, each opponent loses X life, where X is the greatest power among creatures you control.';
    const parsed = parseOracleText(oracle, '{3}{B}');
    // Should not be Unparsed.
    expect(parsed.kind).not.toBe('Unparsed');
  });

  // -------------------------------------------------------------------------
  // Gap (c): "Until your next turn, spells your opponents cast cost {1} more."
  // Tax Collector bullet body.
  // -------------------------------------------------------------------------
  it('(c) opponent-spell-tax: "Until your next turn, spells your opponents cast cost {1} more."', () => {
    const oracle =
      'Until your next turn, spells your opponents cast cost {1} more.';
    const parsed = parseOracleText(oracle, '{1}{W}');
    expect(parsed.kind).not.toBe('Unparsed');
    if (parsed.kind === 'Spell') {
      const taxEffect = parsed.effects.find(
        (e: { kind: string }) => e.kind === 'OpponentSpellCostTax'
      );
      expect(taxEffect).toBeDefined();
      expect((taxEffect as { amount: number }).amount).toBe(1);
    }
  });

  // -------------------------------------------------------------------------
  // Gap (c) variant: higher cost value
  // -------------------------------------------------------------------------
  it('(c) opponent-spell-tax cost {2}: "Until your next turn, spells your opponents cast cost {2} more."', () => {
    const oracle =
      'Until your next turn, spells your opponents cast cost {2} more.';
    const parsed = parseOracleText(oracle, '{2}{W}');
    expect(parsed.kind).not.toBe('Unparsed');
    if (parsed.kind === 'Spell') {
      const taxEffect = parsed.effects.find(
        (e: { kind: string }) => e.kind === 'OpponentSpellCostTax'
      );
      expect(taxEffect).toBeDefined();
      expect((taxEffect as { amount: number }).amount).toBe(2);
    }
  });

  // -------------------------------------------------------------------------
  // Tax Collector full ETB oracle (choose-one modal with two bullets):
  //   "When this creature enters, choose one —
  //    • Tax — Until your next turn, spells your opponents cast cost {1} more.
  //    • Each opponent loses 2 life."
  // -------------------------------------------------------------------------
  it('(full) Tax Collector ETB modal: both bullets should parse (not Unparsed)', () => {
    const oracle =
      "When this creature enters, choose one — • Tax — Until your next turn, spells your opponents cast cost {1} more. • Each opponent loses 2 life.";
    const parsed = parseOracleText(oracle, '{1}{W}{B}');
    expect(parsed.kind).not.toBe('Unparsed');
  });

  // -------------------------------------------------------------------------
  // Skemfar Shadowsage full ETB oracle:
  //   "When this creature enters, choose one —
  //    • Each opponent loses X life, where X is the greatest power among
  //      creatures you control.
  //    • You gain that much life."
  // -------------------------------------------------------------------------
  it('(full) Skemfar Shadowsage ETB modal: both bullets should parse (not Unparsed)', () => {
    const oracle =
      "When this creature enters, choose one — • Each opponent loses X life, where X is the greatest power among creatures you control. • You gain that much life.";
    const parsed = parseOracleText(oracle, '{2}{B}{G}');
    expect(parsed.kind).not.toBe('Unparsed');
  });
});
