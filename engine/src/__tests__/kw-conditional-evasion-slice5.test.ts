/**
 * Slice 5: conditional landwalk-style evasion tests.
 *
 * Covers three families of "can't be blocked as long as defending player
 * controls X" oracle text:
 *   1. Hazy Homunculus family — "This creature can't be blocked as long as
 *      defending player controls an untapped land."
 *   2. Tanglewalker family — "Each creature you control can't be blocked as
 *      long as defending player controls an artifact land."
 *   3. Rime Dryad / snow-walk family — "Snow forestwalk (This creature can't
 *      be blocked as long as defending player controls a snow Forest.)"
 *      parsed via extended LANDWALK_SENTENCE_RE as a snow-walk keyword.
 *
 * Each family:
 *   a) Parser: the face is recognized as StaticAbility (not Unparsed).
 *   b) Execution: canBlock / declareBlockers enforces the condition against
 *      the defending player's board.
 */

import { describe, it, expect } from 'vitest';
import { canBlock, hasActiveLandwalk } from '../keywords';
import { canDeclareBlocker, declareAttackers, declareBlockers } from '../combat';
import { getCardsInZone, initGameState } from '../game-state';
import { parseOracleText } from '../effects/parser';
import type { CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function creature(
  id: string,
  opts: {
    colors?: CardDefinition['colors'];
    oracle?: string;
    keywords?: string[];
    typeLine?: string;
    power?: number;
    toughness?: number;
    cardTypes?: CardDefinition['card_types'];
  } = {},
): CardDefinition {
  return {
    id,
    name: id,
    type_line: opts.typeLine ?? 'Creature — Test',
    oracle_text: opts.oracle ?? '',
    mana_cost: '{1}',
    cmc: 1,
    colors: opts.colors ?? [],
    color_identity: opts.colors ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.cardTypes ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function land(
  id: string,
  typeLine: string,
  opts: { tapped?: boolean } = {},
): CardDefinition {
  return {
    id,
    name: id,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['land'],
    _tappedForTest: opts.tapped,
  } as CardDefinition & { _tappedForTest?: boolean };
}

function artifactLand(id: string): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Artifact Land',
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact', 'land'],
  };
}

/**
 * Build state with:
 *   p1: attackerDef (on battlefield, non-sick)
 *   p2: blockerDef + any number of p2Permanents (all on battlefield)
 * The optional tapped flag on a land def is applied to the instance.
 */
function setup(
  attackerDef: CardDefinition,
  blockerDef: CardDefinition,
  p2Permanents: (CardDefinition & { _tappedForTest?: boolean })[] = [],
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: [attackerDef], commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [blockerDef, ...p2Permanents], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);

  for (const [instanceId, card] of state.cards) {
    const def = p2Permanents.find(d => d.id === card.definitionId) as (CardDefinition & { _tappedForTest?: boolean }) | undefined;
    const tapped = def?._tappedForTest ?? false;
    state.cards.set(instanceId, { ...card, zone: 'battlefield', summoningSick: false, tapped });
  }
  state = { ...state, phase: 'combat', step: 'declare_attackers' };

  const attackerId = getCardsInZone(state, 'p1', 'battlefield')
    .find(c => state.cards.get(c.instanceId)!.definitionId === attackerDef.id)!.instanceId;
  const blockerId = getCardsInZone(state, 'p2', 'battlefield')
    .find(c => state.cards.get(c.instanceId)!.definitionId === blockerDef.id)!.instanceId;
  return { state, attackerId, blockerId };
}

const vanillaBlocker = creature('blocker');

// ---------------------------------------------------------------------------
// 1. Parser recognition
// ---------------------------------------------------------------------------

describe('matchConditionalEvasion — parser recognition', () => {
  it('recognizes Hazy Homunculus form as StaticAbility', () => {
    const result = parseOracleText(
      "This creature can't be blocked as long as defending player controls an untapped land.",
    );
    expect(result.kind).toBe('StaticAbility');
  });

  it('recognizes Tanglewalker form as StaticAbility', () => {
    const result = parseOracleText(
      "Each creature you control can't be blocked as long as defending player controls an artifact land.",
    );
    expect(result.kind).toBe('StaticAbility');
  });

  it('recognizes island-conditioned form as StaticAbility', () => {
    const result = parseOracleText(
      "This creature can't be blocked as long as defending player controls an Island.",
    );
    expect(result.kind).toBe('StaticAbility');
  });

  it('recognizes forest-conditioned form as StaticAbility', () => {
    const result = parseOracleText(
      "This creature can't be blocked as long as defending player controls a Forest.",
    );
    expect(result.kind).toBe('StaticAbility');
  });

  it('recognizes snow-forest-conditioned form as StaticAbility', () => {
    const result = parseOracleText(
      "This creature can't be blocked as long as defending player controls a snow Forest.",
    );
    expect(result.kind).toBe('StaticAbility');
  });

  it('recognizes conditional evasion alongside other engine keywords', () => {
    const result = parseOracleText(
      "Flying\nThis creature can't be blocked as long as defending player controls an untapped land.",
    );
    expect(result.kind).toBe('StaticAbility');
  });

  it('does NOT claim a face with an unrelated non-keyword ability beside the conditional evasion', () => {
    // The ETB trigger is a real non-keyword ability — whole face must stay Unparsed
    // or parse as the richer ETB form (but never as the bare conditional-evasion marker).
    const result = parseOracleText(
      "When this creature enters, draw a card.\nThis creature can't be blocked as long as defending player controls an untapped land.",
    );
    // Either parses as an ETB trigger (the richer parse) or stays Unparsed —
    // in no case should it parse as StaticAbility (the conditional-evasion marker).
    expect(result.kind).not.toBe('StaticAbility');
  });

  it('does NOT claim an unsupported filter predicate', () => {
    // "defending player controls a Faerie" is an exotic predicate we cannot evaluate.
    const result = parseOracleText(
      "This creature can't be blocked as long as defending player controls a Faerie.",
    );
    expect(result.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// 2. Snow-walk parser recognition (via extended LANDWALK_SENTENCE_RE)
// ---------------------------------------------------------------------------

describe('snow-walk parser recognition (matchLandwalk extension)', () => {
  it('recognizes "Snow forestwalk" keyword with reminder text as StaticAbility', () => {
    const result = parseOracleText(
      "Snow forestwalk (This creature can't be blocked as long as defending player controls a snow Forest.)",
    );
    expect(result.kind).toBe('StaticAbility');
  });

  it('recognizes bare "Snow forestwalk" keyword as StaticAbility', () => {
    expect(parseOracleText('Snow forestwalk').kind).toBe('StaticAbility');
  });

  it('recognizes "Snow islandwalk" keyword as StaticAbility', () => {
    expect(parseOracleText('Snow islandwalk').kind).toBe('StaticAbility');
  });

  it('recognizes "Snow swampwalk" keyword as StaticAbility', () => {
    expect(parseOracleText('Snow swampwalk').kind).toBe('StaticAbility');
  });
});

// ---------------------------------------------------------------------------
// 3. Execution: untapped-land conditional (Hazy Homunculus)
// ---------------------------------------------------------------------------

describe('untapped-land conditional evasion — canBlock enforcement', () => {
  const hazyText = "This creature can't be blocked as long as defending player controls an untapped land.";
  const hazyAttacker = creature('hazy', { oracle: hazyText });

  it('cannot be blocked when defending player controls an untapped land', () => {
    const untappedLand = land('plains', 'Basic Land — Plains', { tapped: false });
    const { state, attackerId, blockerId } = setup(hazyAttacker, vanillaBlocker, [untappedLand]);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('can be blocked when defending player controls only TAPPED lands', () => {
    const tappedLand = land('plains', 'Basic Land — Plains', { tapped: true });
    const { state, attackerId, blockerId } = setup(hazyAttacker, vanillaBlocker, [tappedLand]);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);
  });

  it('can be blocked when defending player controls no lands at all', () => {
    const { state, attackerId, blockerId } = setup(hazyAttacker, vanillaBlocker, []);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);
  });

  it('declareBlockers throws when evasion fires (untapped land present)', () => {
    const untappedLand = land('island', 'Basic Land — Island', { tapped: false });
    const { state, attackerId, blockerId } = setup(hazyAttacker, vanillaBlocker, [untappedLand]);
    const declared = declareAttackers(state, 'p1', [{ cardInstanceId: attackerId, defendingPlayerId: 'p2' }]);
    expect(canDeclareBlocker(declared, 'p2', blockerId, attackerId)).toBe(false);
    expect(() => declareBlockers(declared, 'p2', [{ cardInstanceId: blockerId, blockingAttackerId: attackerId }]))
      .toThrow();
  });

  it('declareBlockers succeeds when all lands are tapped', () => {
    const tappedLand = land('island', 'Basic Land — Island', { tapped: true });
    const { state, attackerId, blockerId } = setup(hazyAttacker, vanillaBlocker, [tappedLand]);
    const declared = declareAttackers(state, 'p1', [{ cardInstanceId: attackerId, defendingPlayerId: 'p2' }]);
    expect(canDeclareBlocker(declared, 'p2', blockerId, attackerId)).toBe(true);
    const blocked = declareBlockers(declared, 'p2', [{ cardInstanceId: blockerId, blockingAttackerId: attackerId }]);
    expect(blocked.combat!.blockers).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Execution: artifact-land conditional (Tanglewalker)
// ---------------------------------------------------------------------------

describe('artifact-land conditional evasion — canBlock enforcement', () => {
  const tangleText = "Each creature you control can't be blocked as long as defending player controls an artifact land.";
  const tangleAttacker = creature('tanglewalker', { oracle: tangleText });

  it('cannot be blocked when defending player controls an artifact land', () => {
    const { state, attackerId, blockerId } = setup(tangleAttacker, vanillaBlocker, [artifactLand('seat')]);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('can be blocked when defending player controls no artifact lands (only basics)', () => {
    const basicLand = land('forest', 'Basic Land — Forest');
    const { state, attackerId, blockerId } = setup(tangleAttacker, vanillaBlocker, [basicLand]);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);
  });

  it('can be blocked when defending player controls no lands at all', () => {
    const { state, attackerId, blockerId } = setup(tangleAttacker, vanillaBlocker, []);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);
  });

  it('declareBlockers throws when evasion fires (artifact land present)', () => {
    const { state, attackerId, blockerId } = setup(tangleAttacker, vanillaBlocker, [artifactLand('vault')]);
    const declared = declareAttackers(state, 'p1', [{ cardInstanceId: attackerId, defendingPlayerId: 'p2' }]);
    expect(canDeclareBlocker(declared, 'p2', blockerId, attackerId)).toBe(false);
    expect(() => declareBlockers(declared, 'p2', [{ cardInstanceId: blockerId, blockingAttackerId: attackerId }]))
      .toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Execution: snow forestwalk (Rime Dryad) — via hasActiveLandwalk
// ---------------------------------------------------------------------------

describe('snow forestwalk enforcement (Rime Dryad family)', () => {
  // Rime Dryad's oracle text includes the "Snow forestwalk" keyword.
  // keywords.ts reads the keyword from the oracle text and enforces it via
  // hasActiveLandwalk → controlsSnowLandOfType.
  const rimeDryadText =
    "Snow forestwalk (This creature can't be blocked as long as defending player controls a snow Forest.)";
  const rimeDryad = creature('rimedryad', { oracle: rimeDryadText });

  it('hasActiveLandwalk returns true when defender controls a snow Forest', () => {
    const snowForest = land('snowforest', 'Basic Snow Land — Forest');
    const { state, attackerId } = setup(rimeDryad, vanillaBlocker, [snowForest]);
    expect(hasActiveLandwalk(state, attackerId, 'p2')).toBe(true);
  });

  it('cannot be blocked when defending player controls a snow Forest', () => {
    const snowForest = land('snowforest', 'Basic Snow Land — Forest');
    const { state, attackerId, blockerId } = setup(rimeDryad, vanillaBlocker, [snowForest]);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('can be blocked when defending player controls only a non-snow Forest', () => {
    // A regular Forest is NOT a snow land — snow forestwalk does not apply.
    const normalForest = land('forest', 'Basic Land — Forest');
    const { state, attackerId, blockerId } = setup(rimeDryad, vanillaBlocker, [normalForest]);
    expect(hasActiveLandwalk(state, attackerId, 'p2')).toBe(false);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);
  });

  it('can be blocked when defending player controls a snow Island (wrong subtype)', () => {
    const snowIsland = land('snowisland', 'Basic Snow Land — Island');
    const { state, attackerId, blockerId } = setup(rimeDryad, vanillaBlocker, [snowIsland]);
    expect(hasActiveLandwalk(state, attackerId, 'p2')).toBe(false);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);
  });

  it('snow forestwalk keyword in keywords array also works', () => {
    // When the card database lists the keyword explicitly (rather than inline text).
    const rimeFromKeywords = creature('rime2', { keywords: ['Snow forestwalk'] });
    const snowForest = land('snowf2', 'Basic Snow Land — Forest');
    const { state, attackerId, blockerId } = setup(rimeFromKeywords, vanillaBlocker, [snowForest]);
    expect(hasActiveLandwalk(state, attackerId, 'p2')).toBe(true);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('declareBlockers throws when snow forestwalk fires', () => {
    const snowForest = land('snowf3', 'Basic Snow Land — Forest');
    const { state, attackerId, blockerId } = setup(rimeDryad, vanillaBlocker, [snowForest]);
    const declared = declareAttackers(state, 'p1', [{ cardInstanceId: attackerId, defendingPlayerId: 'p2' }]);
    expect(canDeclareBlocker(declared, 'p2', blockerId, attackerId)).toBe(false);
    expect(() => declareBlockers(declared, 'p2', [{ cardInstanceId: blockerId, blockingAttackerId: attackerId }]))
      .toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. Non-regression: standard (non-snow) landwalk still works
// ---------------------------------------------------------------------------

describe('standard landwalk still works after snow-walk extension', () => {
  it('islandwalk: cannot be blocked when defender controls an Island', () => {
    const walker = creature('iwalker', { keywords: ['Islandwalk'] });
    const island = land('island1', 'Basic Land — Island');
    const { state, attackerId, blockerId } = setup(walker, vanillaBlocker, [island]);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('islandwalk: can be blocked when defender controls only a Forest', () => {
    const walker = creature('iwalker2', { keywords: ['Islandwalk'] });
    const forest = land('forest1', 'Basic Land — Forest');
    const { state, attackerId, blockerId } = setup(walker, vanillaBlocker, [forest]);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);
  });
});
