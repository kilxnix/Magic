/**
 * Slice 2/12 — Look-at/reveal-top dig families as trigger and ETB effect bodies
 *
 * Covers:
 *   matchLookAtTopSelfPowerAnyNumberToHand  — "look at top X where X is creature's power,
 *                                              you may put any number of <type> cards to hand,
 *                                              rest on bottom" (Keldon Flamesage family)
 *   matchLookAtTopCardPlayLandOrGraveyard   — "look at top card; if land you may play it;
 *                                              if not land, put it into your graveyard"
 *                                              (Ziatora's Envoy honest approximation)
 *
 * Niv-Mizzet Reborn ("for each color pair, choose") is honest Unparsed — the per-pair
 * choose subsystem does not exist in the executor.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';

// ── helpers ──────────────────────────────────────────────────────────────────

function parsedAs(
  oracle: string,
  kind: 'Triggered' | 'ETB',
) {
  const result = parseOracleText(oracle);
  expect(result.kind).toBe(kind);
  if (result.kind !== kind) throw new Error(`expected ${kind}, got ${result.kind}`);
  return result.ability;
}

// ── Keldon Flamesage family (self-power dig, any number of <type> to hand) ──

describe('matchLookAtTopSelfPowerAnyNumberToHand', () => {
  it('parses Keldon Flamesage trigger body', () => {
    const oracle =
      "whenever this creature attacks, look at the top x cards of your library, where x is this creature's power. you may put any number of land cards from among them into your hand. put the rest on the bottom of your library in a random order.";
    const ability = parsedAs(oracle, 'Triggered');
    expect(ability.trigger.kind).toBe('Attacks');
    expect(ability.effects).toHaveLength(1);
    const fx = ability.effects[0];
    expect(fx.kind).toBe('ChooseFromTopOfLibrary');
    if (fx.kind !== 'ChooseFromTopOfLibrary') return;
    // Count resolves to source power
    expect(fx.count).toEqual({ kind: 'TargetPower', target: { kind: 'Source' } });
    expect(fx.destination).toBe('hand');
    expect(fx.restDestination).toBe('bottom');
    expect(fx.minSelections).toBe(0);
    expect(fx.maxSelections).toBe(999);
    expect(fx.filter).toEqual({ types: ['land'] });
  });

  it('parses "its power" variant (short form)', () => {
    // Some printings use "its power" instead of "this creature's power"
    const oracle =
      "whenever this creature attacks, look at the top x cards of your library, where x is its power. you may put any number of creature cards from among them into your hand. put the rest on the bottom of your library in a random order.";
    const ability = parsedAs(oracle, 'Triggered');
    expect(ability.trigger.kind).toBe('Attacks');
    const fx = ability.effects[0];
    expect(fx.kind).toBe('ChooseFromTopOfLibrary');
    if (fx.kind !== 'ChooseFromTopOfLibrary') return;
    expect(fx.count).toEqual({ kind: 'TargetPower', target: { kind: 'Source' } });
    expect(fx.filter).toEqual({ types: ['creature'] });
  });

  it('emits ChooseFromTopOfLibrary with correct selectedCardChoiceId', () => {
    const oracle =
      "whenever this creature attacks, look at the top x cards of your library, where x is this creature's power. you may put any number of land cards from among them into your hand. put the rest on the bottom of your library in a random order.";
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const fx = result.ability.effects[0];
    expect(fx.kind).toBe('ChooseFromTopOfLibrary');
    if (fx.kind !== 'ChooseFromTopOfLibrary') return;
    expect(fx.selectedCardChoiceId).toBe('lookTopSelfPowerAnyNumberToHandIds');
  });
});

// ── Ziatora's Envoy family (look at top card; land → hand; non-land → graveyard) ──

describe('matchLookAtTopCardPlayLandOrGraveyard', () => {
  it("parses Ziatora's Envoy trigger body (honest approximation)", () => {
    // The "you may play a land" clause is declined honestly; the effect models
    // land cards going to hand, non-land cards going to graveyard.
    const oracle =
      "whenever this creature deals combat damage to a player, look at the top card of your library. you may play a land from the top of your library this turn. if that card is not a land, put it into your graveyard.";
    const ability = parsedAs(oracle, 'Triggered');
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(ability.effects).toHaveLength(1);
    const fx = ability.effects[0];
    expect(fx.kind).toBe('ChooseFromTopOfLibrary');
    if (fx.kind !== 'ChooseFromTopOfLibrary') return;
    expect(fx.count).toBe(1);
    expect(fx.filter).toEqual({ types: ['land'] });
    expect(fx.destination).toBe('hand');
    expect(fx.restDestination).toBe('graveyard');
    expect(fx.minSelections).toBe(0);
    expect(fx.maxSelections).toBe(1);
  });

  it('emits ChooseFromTopOfLibrary with correct selectedCardChoiceId', () => {
    const oracle =
      "whenever this creature deals combat damage to a player, look at the top card of your library. you may play a land from the top of your library this turn. if that card is not a land, put it into your graveyard.";
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const fx = result.ability.effects[0];
    expect(fx.kind).toBe('ChooseFromTopOfLibrary');
    if (fx.kind !== 'ChooseFromTopOfLibrary') return;
    expect(fx.selectedCardChoiceId).toBe('lookTopCardPlayLandOrGraveyardIds');
  });
});

// ── Niv-Mizzet Reborn (honest Unparsed) ─────────────────────────────────────

describe('Niv-Mizzet Reborn (honest Unparsed)', () => {
  it('returns Unparsed for the per-color-pair choose body', () => {
    const oracle =
      "when niv-mizzet enters, reveal the top ten cards of your library. for each color pair, choose a card of those colors from among them and put it into your hand. put the rest on the bottom of your library in a random order.";
    const result = parseOracleText(oracle);
    // "for each color pair, choose" is not implemented in the executor.
    // Honest Unparsed is the correct outcome.
    expect(result.kind).toBe('Unparsed');
  });
});
