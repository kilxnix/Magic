/**
 * Tam, Mindful First-Year — "hexproof from each of its colors" subsystem tests.
 *
 * Tests:
 *   1. Parser: exact oracle wording produces StaticAbility / HexproofFromOwnColors.
 *   2. Execution: opponent's red spell can't target a red creature under Tam.
 *   3. Execution: opponent's green spell can't target a green creature under Tam.
 *   4. Execution: opponent's colorless/non-matching spell CAN target (no hexproof block).
 *   5. Execution: your OWN spell can always target your creature (hexproof never blocks self).
 *   6. Execution: Tam does not protect itself (excludeSelf).
 *   7. Execution: colorless creature is not protected (no colors to be hexproof from).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { validateTargetChoices } from '../effects/targets';
import { getCardsInZone, initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition, GameState } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCreatureDef(
  id: string,
  colors: CardDefinition['colors'],
  oracle = '',
): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Legendary Creature — Human Wizard',
    oracle_text: oracle,
    mana_cost: '{1}{U}{G}',
    cmc: 3,
    colors,
    color_identity: colors,
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
}

function makeSpellDef(
  id: string,
  colors: CardDefinition['colors'],
): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Instant',
    oracle_text: 'Deal 2 damage to target creature.',
    mana_cost: '{R}',
    cmc: 1,
    colors,
    color_identity: colors,
    keywords: [],
    card_types: ['instant'],
    power: undefined,
    toughness: undefined,
  };
}

/** Oracle text for Tam's relevant ability line. */
const TAM_ORACLE = 'Each other creature you control has hexproof from each of its colors.';

/**
 * Set up a two-player game:
 *   p1 controls: tam + any extra p1 cards
 *   p2 controls: any p2 cards
 * All cards land on the battlefield; continuous statics are registered.
 * Returns {state, idFor(defId)}.
 */
function setup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[] = [],
) {
  // Need at least one card per player for initGameState to work
  const p2Defs2 = p2Defs.length > 0 ? p2Defs : [makeCreatureDef('dummy-p2', [])];
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs2, commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);
  // Move all cards to battlefield (non-sick)
  for (const [id, card] of state.cards) {
    state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
  }
  // Register continuous effects for every battlefield permanent
  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }
  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;
  return { state, idFor };
}

/**
 * Simulate an opponent's spell targeting a permanent:
 *  - casterId = the casting player (opponent of target's controller)
 *  - sourceInstanceId = the spell's card instanceId (carries source colors)
 *  - targetId = the card being targeted
 */
function tryTarget(
  state: GameState,
  casterId: string,
  sourceInstanceId: string | undefined,
  targetId: string,
): { ok: boolean; err?: string } {
  try {
    validateTargetChoices(
      state,
      casterId,
      [{ id: 'spec1', type: 'Creature', count: 1 }],
      [targetId],
      sourceInstanceId,
    );
    return { ok: true };
  } catch (e: any) {
    return { ok: false, err: e.message };
  }
}

// ---------------------------------------------------------------------------
// 1. Parser tests
// ---------------------------------------------------------------------------

describe('Tam — parser', () => {
  it('parses exact Tam oracle line as StaticAbility / HexproofFromOwnColors', () => {
    const r = parseOracleText(TAM_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('HexproofFromOwnColors');
    expect(r.ability.excludeSelf).toBe(true);
    expect(r.ability.controller).toBe('you');
    expect(r.ability.filter.types).toContain('creature');
  });

  it('also parses the ability embedded in a larger oracle text block (multi-line face)', () => {
    const multiLine = [
      'Flying',
      TAM_ORACLE,
    ].join('\n');
    const r = parseOracleText(multiLine);
    // Multi-line: one line is a keyword (absorbed), the other is a StaticAbility.
    // parseOracleTextPerLine should yield StaticAbility.
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('HexproofFromOwnColors');
  });
});

// ---------------------------------------------------------------------------
// 2-7. Execution tests
// ---------------------------------------------------------------------------

describe('Tam — execution (target legality)', () => {
  it('opponent red spell CANNOT target red creature protected by Tam', () => {
    const tam = makeCreatureDef('tam', ['U', 'G'], TAM_ORACLE);
    const redCreature = makeCreatureDef('red-creature', ['R']);
    const redSpell = makeSpellDef('lightning-bolt', ['R']);

    const { state, idFor } = setup([tam, redCreature], [redSpell]);
    const redCreatureId = idFor('red-creature');
    const redSpellId = idFor('lightning-bolt');

    // p2 controls red spell; p1 controls red creature under Tam's protection
    const result = tryTarget(state, 'p2', redSpellId, redCreatureId);
    expect(result.ok).toBe(false);
    expect(result.err).toMatch(/hexproof from that color/i);
  });

  it('opponent green spell CANNOT target green creature protected by Tam', () => {
    const tam = makeCreatureDef('tam', ['U', 'G'], TAM_ORACLE);
    const greenCreature = makeCreatureDef('green-creature', ['G']);
    const greenSpell = makeSpellDef('naturalize', ['G']);

    const { state, idFor } = setup([tam, greenCreature], [greenSpell]);
    const greenCreatureId = idFor('green-creature');
    const greenSpellId = idFor('naturalize');

    const result = tryTarget(state, 'p2', greenSpellId, greenCreatureId);
    expect(result.ok).toBe(false);
    expect(result.err).toMatch(/hexproof from that color/i);
  });

  it('opponent colorless (no-color) spell CAN target a red creature under Tam', () => {
    const tam = makeCreatureDef('tam', ['U', 'G'], TAM_ORACLE);
    const redCreature = makeCreatureDef('red-creature', ['R']);
    const colorlessSpell = makeSpellDef('colorless-removal', []);

    const { state, idFor } = setup([tam, redCreature], [colorlessSpell]);
    const redCreatureId = idFor('red-creature');
    const colorlessSpellId = idFor('colorless-removal');

    // Colorless source has no color overlap — targeting is allowed
    const result = tryTarget(state, 'p2', colorlessSpellId, redCreatureId);
    expect(result.ok).toBe(true);
  });

  it('opponent blue spell CAN target red creature (blue vs red = no overlap)', () => {
    const tam = makeCreatureDef('tam', ['U', 'G'], TAM_ORACLE);
    const redCreature = makeCreatureDef('red-creature', ['R']);
    const blueSpell = makeSpellDef('counterspell', ['U']);

    const { state, idFor } = setup([tam, redCreature], [blueSpell]);
    const redCreatureId = idFor('red-creature');
    const blueSpellId = idFor('counterspell');

    // Blue spell vs red creature — blue ≠ red, so no hexproof block
    const result = tryTarget(state, 'p2', blueSpellId, redCreatureId);
    expect(result.ok).toBe(true);
  });

  it('YOUR OWN spell can always target your creature (hexproof only blocks opponents)', () => {
    const tam = makeCreatureDef('tam', ['U', 'G'], TAM_ORACLE);
    const redCreature = makeCreatureDef('red-creature', ['R']);
    const redSpell = makeSpellDef('red-pump', ['R']);

    const { state, idFor } = setup([tam, redCreature, redSpell]);
    const redCreatureId = idFor('red-creature');
    const redSpellId = idFor('red-pump');

    // casterId = 'p1' (same controller) — hexproof never blocks own targeting
    const result = tryTarget(state, 'p1', redSpellId, redCreatureId);
    expect(result.ok).toBe(true);
  });

  it('Tam itself is NOT protected (excludeSelf — "other" creatures only)', () => {
    const tam = makeCreatureDef('tam', ['U', 'G'], TAM_ORACLE);
    // Tam is blue/green; opponent's blue/green spell should be able to target Tam
    const bgSpell = makeSpellDef('simic-spell', ['U', 'G']);

    const { state, idFor } = setup([tam], [bgSpell]);
    const tamId = idFor('tam');
    const bgSpellId = idFor('simic-spell');

    // Tam is excluded from its own static (excludeSelf: true)
    // so HexproofFromOwnColors does NOT apply to Tam itself
    const result = tryTarget(state, 'p2', bgSpellId, tamId);
    expect(result.ok).toBe(true);
  });

  it('colorless creature is NOT protected (no own colors to be hexproof from)', () => {
    const tam = makeCreatureDef('tam', ['U', 'G'], TAM_ORACLE);
    const colorlessCreature = makeCreatureDef('eldrazi', []);
    const redSpell = makeSpellDef('lightning-bolt', ['R']);

    const { state, idFor } = setup([tam, colorlessCreature], [redSpell]);
    const colorlessCreatureId = idFor('eldrazi');
    const redSpellId = idFor('lightning-bolt');

    // Colorless creature has no colors → no hexproof-from-anything
    const result = tryTarget(state, 'p2', redSpellId, colorlessCreatureId);
    expect(result.ok).toBe(true);
  });
});
