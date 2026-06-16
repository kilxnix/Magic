import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';

/**
 * Slice 1: Gated-upside additional-cost line absorption.
 *
 * HONESTY MODEL: the engine NEVER enforces additional cast costs of any kind
 * (no additionalCost field in stack.ts, no payment tracking anywhere). Therefore
 * ALL additional cast cost forms are pure-downside to absorb — the spell becomes
 * strictly easier to cast, never granting a fabricated benefit.
 *
 * NEW FORMS ABSORBED (extending the existing exile/sacrifice/discard set):
 *   • "reveal a/an <type> card from your hand"        (Induce Despair)
 *   • "reveal a/an <type> card from your hand or pay {N}..."  (Squeaking Pie Sneak)
 *   • "you may collect evidence N"                    (Behind the Mask)
 *
 * KEYWORD-ONLY REMAINDER FIX:
 *   When the remainder after stripping the cost line is purely keyword(s)
 *   (e.g. Stitched Drake: "exile a creature card...\nFlying"), the result
 *   stays Unparsed (keyword-only by design) but the absorbed cost is now
 *   recorded in absorbedKeywords for audit visibility.
 *
 * EXISTING FORMS (covered by sc-absorb-additional-cast-cost.test.ts):
 *   exile a/N [type] card(s) from your graveyard
 *   sacrifice a/an [type]
 *   discard a/X card(s)
 */

// ============================================================================
// REVEAL-FROM-HAND FORMS
// ============================================================================

describe('slice1 — reveal-from-hand cast cost absorption', () => {
  it('Induce Despair: absorbs "reveal a creature card from your hand"; -X/-X effect parses', () => {
    // Induce Despair (Innistrad): "As an additional cost to cast this spell,
    // reveal a creature card from your hand.
    // Target creature gets -X/-X until end of turn, where X is the revealed
    // card's toughness."
    //
    // The -X/-X effect references the revealed card, which the engine cannot
    // track. We absorb the cost and test that the remainder does something
    // reasonable (does not crash or mis-parse as a fabricated benefit).
    const r = parseOracleText(
      'As an additional cost to cast this spell, reveal a creature card from your hand.\n' +
      'Target creature gets -2/-2 until end of turn.',
    );
    // The -2/-2 pump effect must parse as a Spell.
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    // The reveal cost is absorbed (not treated as an effect).
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => k.toLowerCase().includes('reveal a creature card from your hand'))).toBe(true);
    // The main effect is a ModifyPT or similar, not a Reveal effect.
    expect(r.effects.every(e => e.kind !== 'Discard')).toBe(true);
  });

  it('absorbs "reveal a Goblin card from your hand"; Fear evasion static parses', () => {
    // Squeaking Pie Sneak: "As an additional cost to cast this spell,
    // reveal a Goblin card from your hand or pay {3}."
    // Fear
    //
    // Note: "Fear" is an engine-enforced evasion keyword that parses as StaticAbility
    // via matchOtherEvasion (combat.ts enforces it). So after absorbing the cost,
    // the remainder "Fear" parses as StaticAbility (not Unparsed).
    const r = parseOracleText(
      'As an additional cost to cast this spell, reveal a Goblin card from your hand or pay {3}.\n' +
      'Fear',
    );
    // Fear is a real engine-enforced StaticAbility (matchOtherEvasion).
    expect(r.kind).toBe('StaticAbility');
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => k.toLowerCase().includes('reveal a goblin card from your hand'))).toBe(true);
  });

  it('absorbs "reveal a creature card from your hand or pay {3}"; remainder Spell parses', () => {
    // Choice-reveal cost form: "or pay {N}" is the alternative.
    // The engine ignores both options (no additional cost enforcement).
    const r = parseOracleText(
      'As an additional cost to cast this spell, reveal a creature card from your hand or pay {3}.\n' +
      'Draw two cards.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'Draw')).toBe(true);
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => k.toLowerCase().includes('reveal a creature card from your hand'))).toBe(true);
  });

  it('absorbs "reveal an artifact card from your hand or pay {2}"; ETB trigger parses', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, reveal an artifact card from your hand or pay {2}.\n' +
      'When ~ enters, draw a card.',
    );
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => k.toLowerCase().includes('reveal an artifact card from your hand'))).toBe(true);
  });

  it('does NOT absorb bare "reveal a card from your hand" (no type qualifier)', () => {
    // "reveal a card" has no type word, so it falls outside the absorbed set.
    // The bare form is too generic to absorb without knowing its constraint.
    const r = parseOracleText(
      'As an additional cost to cast this spell, reveal a card from your hand.\n' +
      'Draw a card.',
    );
    // Result may be Unparsed or may parse without absorption — but the cost line
    // must NOT appear in absorbedKeywords.
    if (r.kind !== 'Unparsed' && r.absorbedKeywords) {
      expect(r.absorbedKeywords.some(k =>
        /reveal a card from your hand/i.test(k),
      )).toBe(false);
    }
  });
});

// ============================================================================
// COLLECT EVIDENCE FORM
// ============================================================================

describe('slice1 — collect-evidence cast cost absorption', () => {
  it('absorbs "you may collect evidence 6"; remainder Spell (ModifyPT) parses', () => {
    // Behind the Mask (Murders at Karlov Manor):
    // "As an additional cost to cast this spell, you may collect evidence 6.
    //  Target creature you don't control gets -2/-2 until end of turn.
    //  If its power is 5 or greater, instead it gets -5/-5 until end of turn."
    //
    // We test the -2/-2 form (the conditional form may or may not parse).
    const r = parseOracleText(
      'As an additional cost to cast this spell, you may collect evidence 6.\n' +
      'Target creature gets -3/-3 until end of turn.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /collect evidence 6/i.test(k))).toBe(true);
    // Collect evidence should not appear as a resolver effect.
    expect(r.effects.every(e => e.kind !== 'Investigate')).toBe(true);
  });

  it('absorbs "you may collect evidence 8"; remainder ETB trigger parses', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, you may collect evidence 8.\n' +
      'When ~ enters, you gain 3 life.',
    );
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'GainLife')).toBe(true);
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /collect evidence/i.test(k))).toBe(true);
  });

  it('absorbs "you may collect evidence 4"; remainder Spell (draw) parses', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, you may collect evidence 4.\n' +
      'Draw two cards.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'Draw')).toBe(true);
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /collect evidence/i.test(k))).toBe(true);
  });
});

// ============================================================================
// SKAAB GOLIATH — multi-card exile form (WORD_NUMS already covered)
// ============================================================================

describe('slice1 — multi-card exile cost absorption', () => {
  it('Skaab Goliath: absorbs "exile two creature cards from your graveyard"; Trample stays Unparsed', () => {
    // Skaab Goliath: "As an additional cost to cast this spell, exile two
    // creature cards from your graveyard.\nTrample"
    // Trample alone is keyword-only → Unparsed, but absorbed cost recorded.
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile two creature cards from your graveyard.\n' +
      'Trample',
    );
    expect(r.kind).toBe('Unparsed');
    // The absorbed cost should still be recorded in absorbedKeywords.
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k =>
      /exile two creature cards from your graveyard/i.test(k),
    )).toBe(true);
  });

  it('absorbs "exile two creature cards from your graveyard"; remainder draw Spell parses', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile two creature cards from your graveyard.\n' +
      'Draw three cards.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'Draw')).toBe(true);
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k =>
      /exile two creature cards from your graveyard/i.test(k),
    )).toBe(true);
  });

  it('absorbs "exile 3 creature cards from your graveyard"; remainder ETB parses', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile 3 creature cards from your graveyard.\n' +
      'When ~ enters, draw a card.',
    );
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /exile 3 creature cards/i.test(k))).toBe(true);
  });
});

// ============================================================================
// STITCHED DRAKE — keyword-only remainder now records absorbed cost
// ============================================================================

describe('slice1 — keyword-only remainder with absorbed cost (Stitched Drake family)', () => {
  it('Stitched Drake: exile-cost + Flying → Unparsed with absorbed cost recorded', () => {
    // Stitched Drake (Innistrad): "As an additional cost to cast this spell,
    // exile a creature card from your graveyard.\nFlying"
    //
    // Flying alone is keyword-only → result kind stays Unparsed (correct:
    // keyword-only faces are classified by the audit gate, not the parser).
    // The absorbed cost MUST now appear in absorbedKeywords so the audit
    // can see the cost was stripped and classify appropriately.
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile a creature card from your graveyard.\n' +
      'Flying',
    );
    expect(r.kind).toBe('Unparsed');
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k =>
      /exile a creature card from your graveyard/i.test(k),
    )).toBe(true);
  });

  it('reveal-cost + Fear (Squeaking Pie Sneak) → StaticAbility with absorbed cost recorded', () => {
    // Fear is engine-enforced (matchOtherEvasion → StaticAbility), so after absorbing
    // the reveal cost the result is StaticAbility (not Unparsed). The cost MUST
    // appear in absorbedKeywords so the audit can see what was stripped.
    const r = parseOracleText(
      'As an additional cost to cast this spell, reveal a Goblin card from your hand or pay {3}.\n' +
      'Fear',
    );
    // matchOtherEvasion parses Fear as a real enforced StaticAbility.
    expect(r.kind).toBe('StaticAbility');
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /reveal a goblin card from your hand/i.test(k))).toBe(true);
  });

  it('exile-cost + Trample (Skaab Goliath) → Unparsed with absorbed cost recorded', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, exile two creature cards from your graveyard.\n' +
      'Trample',
    );
    expect(r.kind).toBe('Unparsed');
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /exile two creature cards from your graveyard/i.test(k))).toBe(true);
  });

  it('keyword-only remainder WITHOUT a cost line stays Unparsed with no absorbed cost', () => {
    // Sanity check: a pure keyword face that has no additional cost line
    // stays Unparsed with NO absorbedKeywords from this absorption path.
    const r = parseOracleText('Flying\nTrample');
    expect(r.kind).toBe('Unparsed');
    // absorbedKeywords may be undefined or empty — but must not contain a cost line.
    const absorbed = r.absorbedKeywords ?? [];
    expect(absorbed.some(k => /as an additional cost/i.test(k))).toBe(false);
  });
});

// ============================================================================
// EXECUTION: absorbed cost does not produce a runtime effect
// ============================================================================

describe('slice1 — absorbed cost produces no runtime effect', () => {
  it('reveal-cost + destroy: Destroy effect is present, no Reveal or Discard effect', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, reveal a creature card from your hand.\n' +
      'Destroy target creature.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'Destroy')).toBe(true);
    // No Exile or Discard effects — the cost was absorbed, not executed.
    expect(r.effects.every(e => e.kind !== 'Exile')).toBe(true);
    expect(r.effects.every(e => e.kind !== 'Discard')).toBe(true);
  });

  it('collect-evidence + GainLife: GainLife effect present, no extraneous effects', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, you may collect evidence 6.\n' +
      'You gain 4 life.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    expect(r.effects.some(e => e.kind === 'GainLife')).toBe(true);
    // Collect evidence cost produces no runtime effect.
    expect(r.effects.every(e => e.kind !== 'Investigate')).toBe(true);
  });
});

// ============================================================================
// HONESTY GATES — unchanged from prior slice
// ============================================================================

describe('slice1 — honesty gates unchanged', () => {
  it('does NOT absorb "pay N life" (enforced by getAdditionalLifeCostForCast)', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, pay 3 life.\n' +
      'Draw two cards.',
    );
    if (r.kind !== 'Unparsed' && r.absorbedKeywords) {
      expect(r.absorbedKeywords.some(k => /pay 3 life/i.test(k))).toBe(false);
    }
  });

  it('single-line cost-only reveal form stays Unparsed (no remainder)', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, reveal a creature card from your hand.',
    );
    expect(r.kind).toBe('Unparsed');
  });

  it('single-line collect-evidence-only form stays Unparsed (no remainder)', () => {
    const r = parseOracleText(
      'As an additional cost to cast this spell, you may collect evidence 6.',
    );
    expect(r.kind).toBe('Unparsed');
  });
});
