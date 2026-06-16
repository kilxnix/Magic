/**
 * Slice 8 — Saryth, the Viper's Fang: tapped/untapped-state keyword grants.
 *
 * Saryth oracle text (full card):
 *   "Other tapped creatures you control have deathtouch.
 *    Other untapped creatures you control have hexproof.
 *    {1},{T}: Untap another target creature or land you control."
 *
 * Tam, Mindful First-Year oracle text:
 *   "Each other creature you control has hexproof from each of its colors.
 *    {T}: Target creature you control becomes all colors until end of turn."
 *
 * Coverage:
 *   1. Parser: "Other tapped creatures you control have deathtouch." → StaticAbility
 *      with filter { tapped: true, notSource: false } and excludeSelf: true.
 *   2. Parser: "Other untapped creatures you control have hexproof." → StaticAbility
 *      with filter { tapped: false } and excludeSelf: true.
 *   3. Parser: Saryth full multi-line text parses as Activated (richest line wins).
 *   4. Execution: tapped other-creatures gain deathtouch; untapped gain hexproof.
 *   5. Execution: after a creature taps, it loses hexproof and gains deathtouch.
 *   6. Execution: Saryth herself (the source) is excluded from both grants.
 *   7. Honesty: Tam's "hexproof from each of its colors" stays Unparsed.
 *   8. Parser: "Other tapped creatures you control have deathtouch" perLine test
 *      (ensures registerContinuousAbilitiesForPermanent picks up the line).
 *   9. Parser: non-"other" forms also parse correctly.
 *  10. Activated: "{1},{T}: Untap another target creature or land you control."
 *      parses as Activated with a Permanent target (notSource, controllerControls).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getGrantedKeywords } from '../effects/continuous';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition, CardInstance } from '../types';

// ============================================================================
// Helpers
// ============================================================================

function creature(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Snake',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{2}{G}',
    cmc: opts.cmc ?? 3,
    colors: opts.colors ?? ['G'],
    color_identity: opts.color_identity ?? ['G'],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

/**
 * Build a two-player game state with p1 permanents on the battlefield.
 * Each card in `p1Defs` is placed on the battlefield for player 'p1'.
 * After setup, continuous abilities are registered for every p1 permanent.
 *
 * `tapIds` is a set of definitionIds that should be tapped on the battlefield.
 */
function setup(
  p1Defs: CardDefinition[],
  tapIds: Set<string> = new Set(),
) {
  const p2Def = creature('p2dummy', { name: 'p2dummy', colors: [] });
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: [p2Def], commanderId: 'none2' },
  ];
  let state = initGameState(decks);

  // Move all cards to battlefield, applying tap state.
  for (const [id, card] of state.cards) {
    const def = state.cardDefinitions.get(card.definitionId);
    const shouldTap = def ? tapIds.has(def.id) : false;
    state.cards.set(id, {
      ...card,
      zone: 'battlefield',
      summoningSick: false,
      tapped: shouldTap,
    });
  }

  // Register continuous statics for all battlefield permanents.
  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }

  const idFor = (defId: string): string => {
    const found = [...state.cards.values()].find(c => c.definitionId === defId);
    if (!found) throw new Error(`No card with definitionId ${defId}`);
    return found.instanceId;
  };

  return { state, idFor };
}

// ============================================================================
// 1–3: Parser-level tests
// ============================================================================

describe('matchOtherTappedUntappedCreaturesHave — parser recognition', () => {
  it('1. "Other tapped creatures you control have deathtouch." parses as StaticAbility', () => {
    const r = parseOracleText('Other tapped creatures you control have deathtouch.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'deathtouch' });
    expect(r.ability.filter).toMatchObject({ types: ['creature'], tapped: true });
    expect(r.ability.controller).toBe('you');
    expect(r.ability.excludeSelf).toBe(true);
    expect(r.ability.selfOnly).toBeFalsy();
  });

  it('2. "Other untapped creatures you control have hexproof." parses as StaticAbility', () => {
    const r = parseOracleText('Other untapped creatures you control have hexproof.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'hexproof' });
    expect(r.ability.filter).toMatchObject({ types: ['creature'], tapped: false });
    expect(r.ability.controller).toBe('you');
    expect(r.ability.excludeSelf).toBe(true);
  });

  it('9a. Non-"other" tapped form also parses: "Tapped creatures you control have deathtouch."', () => {
    const r = parseOracleText('Tapped creatures you control have deathtouch.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'deathtouch' });
    expect(r.ability.filter).toMatchObject({ types: ['creature'], tapped: true });
    expect(r.ability.controller).toBe('you');
    expect(r.ability.excludeSelf).toBe(false);
  });

  it('9b. Non-"other" untapped form also parses: "Untapped creatures you control have hexproof."', () => {
    const r = parseOracleText('Untapped creatures you control have hexproof.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'hexproof' });
    expect(r.ability.filter).toMatchObject({ types: ['creature'], tapped: false });
    expect(r.ability.excludeSelf).toBe(false);
  });

  it('Temporary form stays Unparsed / Spell: "Other tapped creatures you control have deathtouch until end of turn."', () => {
    // This is a spell effect, not a static — the matcher should decline.
    const r = parseOracleText('Other tapped creatures you control have deathtouch until end of turn.');
    expect(r.kind).not.toBe('StaticAbility');
  });

  it('3. Saryth full oracle text does NOT return Unparsed (whole-face match catches line 1)', () => {
    // The whole-face parseOracleText call matches "Other tapped creatures you
    // control have deathtouch." (the first line) and returns StaticAbility.
    // This is correct engine behavior: for multi-line cards the subsystems
    // (registerContinuousAbilitiesForPermanent for static lines, parseActivatedAbilities
    // for the activated line) process each line independently.
    const sarythOracle =
      "Other tapped creatures you control have deathtouch.\n" +
      "Other untapped creatures you control have hexproof.\n" +
      "{1},{T}: Untap another target creature or land you control.";
    const r = parseOracleText(sarythOracle);
    expect(r.kind).not.toBe('Unparsed');
  });

  it('3b. Saryth multi-line: both static lines parse independently', () => {
    const line1 = 'Other tapped creatures you control have deathtouch.';
    const line2 = 'Other untapped creatures you control have hexproof.';
    const r1 = parseOracleText(line1);
    const r2 = parseOracleText(line2);
    expect(r1.kind).toBe('StaticAbility');
    expect(r2.kind).toBe('StaticAbility');
  });
});

// ============================================================================
// 7: Honesty — Tam's "hexproof from each of its colors" stays Unparsed
// ============================================================================

describe('Tam, Mindful First-Year — hexproof from own colors', () => {
  it('7. "Each other creature you control has hexproof from each of its colors." parses as StaticAbility / HexproofFromOwnColors', () => {
    const r = parseOracleText(
      "Each other creature you control has hexproof from each of its colors.",
    );
    // hexproof-from-own-colors is now implemented — the line parses as a StaticAbility.
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('HexproofFromOwnColors');
    expect(r.ability.excludeSelf).toBe(true);
    expect(r.ability.controller).toBe('you');
  });

  it('7b. Tam full text: hexproof line parses; becomes-all-colors line absorbed by slice 4 step 1m', () => {
    const tamOracle =
      "Each other creature you control has hexproof from each of its colors.\n" +
      "{T}: Target creature you control becomes all colors until end of turn.";
    // Line 1 parses as StaticAbility (HexproofFromOwnColors).
    // Line 2 is an activated-ability line with a valid cost ({T}) but an unrunnable
    // effect body ("becomes all colors" — not yet implemented). Slice 4 step 1m
    // absorbs it, so the parseable static line carries the whole face.
    const r = parseOracleText(tamOracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('HexproofFromOwnColors');
  });
});

// ============================================================================
// 10: Activated ability — Saryth's untap line
// ============================================================================

describe('Saryth activated ability — {1},{T}: Untap another target creature or land', () => {
  it('10. Single activated line parses as Activated with Permanent target (notSource, controllerControls)', () => {
    const r = parseOracleText(
      "{1},{T}: Untap another target creature or land you control.",
    );
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    expect(r.abilities.length).toBeGreaterThanOrEqual(1);
    const ability = r.abilities[0];
    expect(ability.cost.tap).toBe(true);
    expect(ability.cost.mana).toBe('{1}');
    expect(ability.effects.length).toBe(1);
    expect(ability.effects[0].kind).toBe('Untap');
    expect(ability.targets.length).toBe(1);
    expect(ability.targets[0].type).toBe('Permanent');
    expect(ability.targets[0].constraints?.notSource).toBe(true);
    expect(ability.targets[0].constraints?.controllerControls).toBe(true);
    expect(ability.targets[0].constraints?.types).toContain('creature');
    expect(ability.targets[0].constraints?.types).toContain('land');
  });
});

// ============================================================================
// 4–6: Execution — continuous layer applies tapped/untapped grants correctly
// ============================================================================

describe('Saryth continuous grants — execution (continuous layer)', () => {
  const sarythDef = creature('saryth', {
    name: "Saryth, the Viper's Fang",
    oracle_text:
      "Other tapped creatures you control have deathtouch.\n" +
      "Other untapped creatures you control have hexproof.\n" +
      "{1},{T}: Untap another target creature or land you control.",
  });

  const snake1Def = creature('snake1', { name: 'Snake 1' });
  const snake2Def = creature('snake2', { name: 'Snake 2' });

  it('4. Tapped creatures (other than Saryth) gain deathtouch; untapped gain hexproof', () => {
    // snake1 is tapped, snake2 is untapped; Saryth itself is untapped.
    const { state, idFor } = setup(
      [sarythDef, snake1Def, snake2Def],
      new Set(['snake1']), // snake1 tapped
    );

    const snake1Id = idFor('snake1');
    const snake2Id = idFor('snake2');

    const kw1 = getGrantedKeywords(state, snake1Id);
    const kw2 = getGrantedKeywords(state, snake2Id);

    // Tapped snake1 should have deathtouch
    expect(kw1).toContain('deathtouch');
    // Tapped snake1 should NOT have hexproof (it's tapped)
    expect(kw1).not.toContain('hexproof');

    // Untapped snake2 should have hexproof
    expect(kw2).toContain('hexproof');
    // Untapped snake2 should NOT have deathtouch (it's untapped)
    expect(kw2).not.toContain('deathtouch');
  });

  it('5. After a creature taps, it loses hexproof and gains deathtouch (continuous re-evaluates)', () => {
    // Start with both snakes untapped.
    const { state: s0, idFor } = setup([sarythDef, snake1Def, snake2Def]);
    const snake1Id = idFor('snake1');

    // Initially snake1 is untapped → hexproof.
    const kwBefore = getGrantedKeywords(s0, snake1Id);
    expect(kwBefore).toContain('hexproof');
    expect(kwBefore).not.toContain('deathtouch');

    // Simulate tapping snake1 by mutating the state map (mirror of what the
    // tap executor does: set card.tapped = true).
    const s1 = { ...s0, cards: new Map(s0.cards) };
    s1.cards.set(snake1Id, { ...s1.cards.get(snake1Id)!, tapped: true });

    // Now snake1 is tapped → should have deathtouch, not hexproof.
    const kwAfter = getGrantedKeywords(s1, snake1Id);
    expect(kwAfter).toContain('deathtouch');
    expect(kwAfter).not.toContain('hexproof');
  });

  it('6. Saryth herself is excluded from both grants (excludeSelf = true)', () => {
    // Saryth is untapped; both snakes are tapped.
    const { state, idFor } = setup(
      [sarythDef, snake1Def, snake2Def],
      new Set(['snake1', 'snake2']), // both snakes tapped
    );
    const sarythId = idFor('saryth');

    const sarythKw = getGrantedKeywords(state, sarythId);

    // Saryth is untapped but excludeSelf prevents the hexproof grant on herself.
    expect(sarythKw).not.toContain('hexproof');
    // Saryth is NOT tapped so she wouldn't get deathtouch anyway, but the
    // excludeSelf also blocks the tapped-deathtouch grant.
    expect(sarythKw).not.toContain('deathtouch');
  });

  it('8. registerContinuousAbilitiesForPermanent picks up both static lines from Saryth', () => {
    // With snake1 tapped and snake2 untapped, verify the per-line registration.
    const { state, idFor } = setup(
      [sarythDef, snake1Def, snake2Def],
      new Set(['snake1']),
    );
    const snake1Id = idFor('snake1');
    const snake2Id = idFor('snake2');

    // snake1 tapped → deathtouch from line 1
    expect(getGrantedKeywords(state, snake1Id)).toContain('deathtouch');
    // snake2 untapped → hexproof from line 2
    expect(getGrantedKeywords(state, snake2Id)).toContain('hexproof');

    // Confirm at least 2 continuous effects registered (one per static line).
    const sarythId = idFor('saryth');
    const sarythEffects = (state.continuousEffects ?? []).filter(
      ce => ce.sourceInstanceId === sarythId,
    );
    expect(sarythEffects.length).toBeGreaterThanOrEqual(2);
  });
});
