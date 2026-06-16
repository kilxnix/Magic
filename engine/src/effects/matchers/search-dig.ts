// Library search/dig/reveal matchers extracted from parser.ts (batch 9/12).
// Covers: SearchLibrary, ExileFromLibrary, ChooseFromTopOfLibrary, RevealTopMatch families.
// Do NOT edit logic here — keep verbatim with parser.ts originals.

import type { Effect, AmountRef, CardFilter, ForEachAmount } from '../ast';
import type { TargetSpec } from '../targets';
import type { PatternResult } from '../parser';
import {
  parseSmallNumberToken,
  parseWordNumber,
  titleCaseCardName,
  singularizeSubtypeWord,
  parseRevealCardFilter,
  parseStaticFilterType,
  parseManaValueFilterSuffix,
  parseManaValueXSuffix,
  mergeStaticFilters,
  SEARCH_PHRASE_STOPWORDS,
  makeTargetSpec,
  makeChosenRef,
  parseWhereXIsNumberOf,
  parseNumberOfFilterAmount,
  COLOR_WORDS,
} from '../parser';

/**
 * Match filtering spells like:
 * "look at the top three cards of your library. You may reveal a Human card
 * from among them and put it into your hand..."
 */
export function matchLookAtTopPutOneIntoHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 14) return null;
  if (slice[0] !== 'look' || slice[1] !== 'at' || slice[2] !== 'the' || slice[3] !== 'top') return null;

  const lookedAt = parseSmallNumberToken(slice[4]);
  if (isNaN(lookedAt) || lookedAt < 1) return null;
  if (slice[5] !== 'cards' || slice[6] !== 'of' || slice[7] !== 'your' || slice[8] !== 'library') return null;

  let idx = 9;
  let filter: CardFilter = {};

  const revealIdx = slice.indexOf('reveal', idx);
  if (revealIdx >= 0) {
    let filterStart = revealIdx + 1;
    if (slice[filterStart] === 'a' || slice[filterStart] === 'an') filterStart++;
    let filterEnd = filterStart;
    while (filterEnd < slice.length && slice[filterEnd] !== 'card' && slice[filterEnd] !== 'cards') {
      filterEnd++;
    }
    if (filterEnd < slice.length) {
      filter = parseRevealCardFilter(slice.slice(filterStart, filterEnd));
    }
    idx = filterEnd;
  }

  while (idx < slice.length) {
    if (slice[idx] === 'put' && slice[idx + 1] === 'one' && (slice[idx + 2] === 'of' || slice[idx + 2] === 'into')) break;
    if (slice[idx] === 'put' && slice[idx + 1] === 'it' && slice[idx + 2] === 'into') break;
    idx++;
  }
  if (idx >= slice.length) return null;

  const handIdx = slice.indexOf('hand', idx);
  if (handIdx === -1) return null;

  let consumed = handIdx + 1;
  if (slice[consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'SearchLibrary',
    player: { kind: 'Controller' },
    filter,
    destination: 'hand',
    shuffle: false,
    topCount: lookedAt,
    putUnselectedTopCardsOnBottom: true,
    selectedCardChoiceId: 'lookTopCardId',
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match the "reveal-top-take" family (filtered takes from a fixed-size dig):
 *   "Reveal the top N cards of your library. Put any number of <type> cards
 *    from among them into your hand. Put the rest on the bottom of your library
 *    [in a random order]."
 *   "Reveal the top N cards of your library. Put all <type> cards revealed this
 *    way into your hand and the rest into your graveyard."          (Beast Hunt)
 *   "Reveal the top N cards of your library. You may put a <typeA> card and/or
 *    a <typeB> card from among them into your hand. Put the rest into your
 *    graveyard."                                        (Benefaction of Rhonas)
 *   "Look at the top N cards of your library. You may put a <typeA> or <typeB>
 *    card from among them into your hand. Put the rest into your graveyard."
 *                                                    (Commune with the Gods)
 *
 * Emits a ChooseFromTopOfLibrary effect with a type filter, minSelections 0
 * (so it auto-resolves) and restDestination 'bottom' or 'graveyard'. The
 * executor reveals exactly N, takes the revealed cards matching the filter
 * (capped at maxSelections; "and/or" multi-type takes additionally cap at one
 * card per type via maxPerAnyOfBranch) into hand, and bottoms/binns the rest —
 * honestly modeling the printed behavior.
 */
export function matchRevealTopTake(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "reveal the top N cards of your library" / "look at the top N cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  const revealN = parseSmallNumberToken(slice[idx]);
  if (isNaN(revealN) || revealN < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  // "[you may] put [any number of | the | all | a/an] <type> card(s) ..."
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;

  const typeMap: Record<string, NonNullable<CardFilter['types']>> = {
    land: ['land'], lands: ['land'],
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    instant: ['instant'], instants: ['instant'],
    sorcery: ['sorcery'], sorceries: ['sorcery'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };

  let filter: CardFilter;
  let maxSelections = revealN;
  let maxPerAnyOfBranch: number | undefined;

  if (slice[idx] === 'a' || slice[idx] === 'an') {
    // Counted take: "a <type> [or <type2>] card" (one card of either type) or
    // "a <typeA> card and/or a/an <typeB> card" (at most one of EACH type).
    idx++;
    const firstTypes = typeMap[slice[idx]];
    if (!firstTypes) return null;
    idx++;
    if (slice[idx] === 'or' && typeMap[slice[idx + 1]]) {
      // "a creature or enchantment card" — ONE card of either type.
      const secondTypes = typeMap[slice[idx + 1]];
      idx += 2;
      if (slice[idx] !== 'card' && slice[idx] !== 'cards') return null;
      idx++;
      filter = { anyOf: [{ types: firstTypes }, { types: secondTypes }] };
      maxSelections = 1;
    } else {
      if (slice[idx] !== 'card' && slice[idx] !== 'cards') return null;
      idx++;
      const branches: CardFilter[] = [{ types: firstTypes }];
      // "and/or a/an <type> card" repetitions — one take allowed per type.
      while (slice[idx] === 'and/or' && (slice[idx + 1] === 'a' || slice[idx + 1] === 'an')) {
        const moreTypes = typeMap[slice[idx + 2]];
        if (!moreTypes) return null;
        if (slice[idx + 3] !== 'card' && slice[idx + 3] !== 'cards') return null;
        branches.push({ types: moreTypes });
        idx += 4;
      }
      if (branches.length === 1) {
        filter = branches[0];
        maxSelections = 1;
      } else {
        filter = { anyOf: branches };
        maxSelections = branches.length;
        maxPerAnyOfBranch = 1;
      }
    }
  } else {
    if (slice[idx] === 'any' && slice[idx + 1] === 'number' && slice[idx + 2] === 'of') {
      idx += 3;
    } else if (slice[idx] === 'the') {
      idx++;
    } else if (slice[idx] === 'all') {
      idx++;
    } else {
      return null;
    }
    // Single card-type word restricting the take.
    const types = typeMap[slice[idx]];
    if (!types) return null;
    filter = { types };
    idx++;
    if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;
  }

  // "from among them" / "revealed this way" / "among them" (Slice 3/13: some cards omit "from")
  if (slice[idx] === 'from' && slice[idx + 1] === 'among' && slice[idx + 2] === 'them') {
    idx += 3;
  } else if (slice[idx] === 'revealed' && slice[idx + 1] === 'this' && slice[idx + 2] === 'way') {
    idx += 3;
  } else if (slice[idx] === 'among' && slice[idx + 1] === 'them') {
    idx += 2;
  } else {
    return null;
  }

  // "into your hand"
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // Rest tail: "[and] [put] the rest" then "on the bottom of your library
  // [in a random/any order]" or "into your graveyard".
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard' | 'top';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else if (slice[idx] === 'on' && slice[idx + 1] === 'top') {
    // Slice 3: "on top of your library [in any order]" / "on top of your library in a random order"
    restDestination = 'top';
    idx += 2;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: revealN,
    destination: 'hand',
    restDestination,
    minSelections: 0,
    maxSelections,
    filter,
    ...(maxPerAnyOfBranch !== undefined ? { maxPerAnyOfBranch } : {}),
    selectedCardChoiceId: 'revealTopTakeIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the "dig-top-take-rest" family (unfiltered counted takes with an
 * EXPLICIT rest placement):
 *   "Look at the top three cards of your library. Put one of them into your
 *    hand and the rest into your graveyard."           (Strategic Planning)
 *   "Look at the top six cards of your library. Put up to one of them into
 *    your hand and the rest on the bottom of your library in a random order."
 *   "Domain — Look at the top X cards of your library, where X is the number
 *    of basic land types among lands you control. Put one of those cards into
 *    your hand and the rest on the bottom of your library in any order."
 *                                                        (Worldly Counsel)
 *
 * Emits a ChooseFromTopOfLibrary effect with minSelections 0 and a
 * fallbackSelectionCount equal to the take count, so it auto-resolves (taking
 * the first revealed card(s)) while still honoring an explicitly submitted
 * selection — honestly modeling reveal-N / take-M / rest-placement.
 *
 * The "look at ... put ONE of them ... rest on the BOTTOM" combination with a
 * plain numeric count is deliberately DECLINED so the pre-existing
 * matchLookAtTopPutOneIntoHand SearchLibrary parse (and its choice plumbing)
 * keeps claiming those faces unchanged; this matcher only claims the variants
 * that previously failed (rest to graveyard, "up to N" takes, X-based counts).
 */
export function matchDigTopTakeRest(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "look at the top <count> card(s) of your library" / "reveal the top ..."
  let idx = 0;
  let verb: 'look' | 'reveal';
  if (slice[idx] === 'reveal') {
    verb = 'reveal';
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    verb = 'look';
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  let count: AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;

  // Optional X definition. Only the engine-resolvable domain wording is
  // claimed; any other "where X is ..." definition stays Unparsed (honest).
  if (slice[idx] === ',') idx++;
  if (slice[idx] === 'where') {
    const isDomainX = slice[idx + 1] === 'x' && slice[idx + 2] === 'is'
      && slice[idx + 3] === 'the' && slice[idx + 4] === 'number' && slice[idx + 5] === 'of'
      && slice[idx + 6] === 'basic' && slice[idx + 7] === 'land' && slice[idx + 8] === 'types'
      && slice[idx + 9] === 'among' && slice[idx + 10] === 'lands'
      && slice[idx + 11] === 'you' && slice[idx + 12] === 'control';
    if (!isDomainX || typeof count === 'number') return null;
    count = { kind: 'DomainCount' };
    idx += 13;
  }
  if (slice[idx] === '.') idx++;

  // "[you may] put [up to] M of (them | those cards) into your hand"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;
  let upTo = false;
  if (slice[idx] === 'up' && slice[idx + 1] === 'to') {
    upTo = true;
    idx += 2;
  }
  const takeM = parseSmallNumberToken(slice[idx]);
  if (isNaN(takeM) || takeM < 1) return null;
  idx++;
  if (slice[idx] !== 'of') return null;
  idx++;
  if (slice[idx] === 'them') {
    idx++;
  } else if (slice[idx] === 'those' && (slice[idx + 1] === 'cards' || slice[idx + 1] === 'card')) {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // Rest tail: "[and] [put] the rest" then placement.
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard' | 'top';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else if (slice[idx] === 'on' && slice[idx + 1] === 'top') {
    // Slice 3: "on top of your library [in any order]" / "on top of your library in a random order"
    restDestination = 'top';
    idx += 2;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  // Defer the exact shape matchLookAtTopPutOneIntoHand already claims (see doc).
  if (verb === 'look' && typeof count === 'number' && !upTo && takeM === 1 && restDestination === 'bottom') {
    return null;
  }

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'hand',
    restDestination,
    minSelections: 0,
    maxSelections: takeM,
    fallbackSelectionCount: takeM,
    selectedCardChoiceId: 'digTopTakeIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the "reveal-top-multi onto the battlefield" family (Collected Company):
 *   "Look at the top N cards of your library. Put up to M <type> card(s) with
 *    mana value K or less from among them onto the battlefield[,] and the rest on
 *    the bottom of your library in a random order."
 *
 * Emits a ChooseFromTopOfLibrary effect with destination 'battlefield', a card
 * filter (type + optional mana-value cap), minSelections 0 and maxSelections M,
 * restDestination 'bottom'. The executor reveals exactly N, puts up to M revealed
 * cards matching the filter onto the battlefield (full ETB plumbing), and bottoms
 * the rest — an honest model of the printed effect.
 *
 * Supports the "Look at"/"Reveal" verbs and the "and the rest"/"Put the rest"
 * tail phrasings. Without a recognized card-type restriction it returns null
 * rather than shipping a trivial "put anything onto the battlefield".
 */
export function matchRevealTopOntoBattlefield(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 18) return null;

  // "look at the top N cards of your library" / "reveal the top N cards ..."
  if (slice[0] !== 'look' && slice[0] !== 'reveal') return null;
  let idx = 1;
  if (slice[0] === 'look') {
    if (slice[idx] !== 'at') return null;
    idx++;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  const revealN = parseSmallNumberToken(slice[idx]);
  if (isNaN(revealN) || revealN < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  // Optional "you may" prefix — Storm the Festival: "You may put up to two permanent cards..."
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;

  // "put up to M ..."
  if (slice[idx] !== 'put' || slice[idx + 1] !== 'up' || slice[idx + 2] !== 'to') return null;
  idx += 3;
  const takeM = parseSmallNumberToken(slice[idx]);
  if (isNaN(takeM) || takeM < 1) return null;
  idx++;

  // Single card-type word restricting the take (no honest "anything" fetch). A
  // bare "permanent" restriction (which has no card_types entry) maps to the
  // permanent boolean filter instead — and only permanents can legally go onto
  // the battlefield, so it stays honest.
  // Slice 2: also handles compound "noncreature <type>" (e.g. Smelting Vat:
  // "up to two noncreature artifact cards from among them onto the battlefield").
  const typeMap: Record<string, NonNullable<CardFilter['types']>> = {
    land: ['land'], lands: ['land'],
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };
  const CARD_TYPE_WORDS_BF = new Set(['land', 'lands', 'creature', 'creatures', 'artifact', 'artifacts', 'enchantment', 'enchantments', 'planeswalker', 'planeswalkers']);
  let filter: CardFilter;
  if (slice[idx] === 'permanent' || slice[idx] === 'permanents') {
    filter = { permanent: true };
    idx++;
  } else if (slice[idx] && slice[idx].startsWith('non') && CARD_TYPE_WORDS_BF.has(slice[idx].slice(3))) {
    // "noncreature <type>" compound — excludeTypes + types
    const excludedType = slice[idx].slice(3);
    filter = { excludeTypes: [excludedType] };
    idx++;
    const mainTypes = typeMap[slice[idx]];
    if (!mainTypes) return null;
    filter = { ...filter, types: mainTypes };
    idx++;
  } else {
    const types = typeMap[slice[idx]];
    if (!types) return null;
    filter = { types };
    idx++;
  }
  if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;

  // Optional "with mana value K or less".
  if (slice[idx] === 'with' && slice[idx + 1] === 'mana' && slice[idx + 2] === 'value') {
    const k = parseInt(slice[idx + 3], 10);
    if (Number.isNaN(k)) return null;
    idx += 4;
    if (slice[idx] === 'or' && slice[idx + 1] === 'less') {
      filter.cmc = { op: 'lte', value: k };
      idx += 2;
    } else {
      filter.cmc = { op: 'eq', value: k };
    }
  }

  // "from among them"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;

  // "onto the battlefield"
  if (slice[idx] !== 'onto' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'battlefield') return null;
  idx += 3;
  if (slice[idx] === ',') idx++;
  if (slice[idx] === '.') idx++;

  // Tail: "and the rest ..." OR "put the rest ..." on the bottom.
  if (slice[idx] === 'and') {
    idx++;
  } else if (slice[idx] === 'put') {
    idx++;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
  if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: revealN,
    destination: 'battlefield',
    restDestination: 'bottom',
    minSelections: 0,
    maxSelections: takeM,
    filter,
    selectedCardChoiceId: 'revealTopBattlefieldIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 8/12: "up to M filtered" dig family leftovers
// ============================================================================

/**
 * Slice 8: Match the "you may put a creature card with power N or greater"
 * onto the battlefield family (Mayael the Anima):
 *   "Look at the top N cards of your library. You may put a creature card
 *    with power M or greater from among them onto the battlefield. Put the
 *    rest on the bottom of your library in a random order."
 *
 * Emits ChooseFromTopOfLibrary with destination='battlefield', filter
 * {types:['creature'], power:{op:'gte',value:M}}, maxSelections=1,
 * restDestination='bottom'. The executor reveals N, puts at most one revealed
 * creature with the required power onto the battlefield (ETB plumbing), and
 * bottoms the rest — honestly modeling the printed effect.
 */
export function matchLookAtTopPowerFilterOntoBattlefield(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 18) return null;

  // "look at the top N cards of your library"
  let idx = 0;
  if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else if (slice[idx] === 'reveal') {
    idx++;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  const revealN = parseSmallNumberToken(slice[idx]);
  if (isNaN(revealN) || revealN < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "you may put a creature card with power M or greater from among them onto the battlefield"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;
  // "a" or "an"
  if (slice[idx] === 'a' || slice[idx] === 'an') idx++;
  // Must be "creature" — only creature cards have meaningful power
  if (slice[idx] !== 'creature') return null;
  idx++;
  if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;

  // "with power M or greater" / "with power M or more"
  if (slice[idx] !== 'with' || slice[idx + 1] !== 'power') return null;
  idx += 2;
  const powerThreshold = parseInt(slice[idx], 10);
  if (isNaN(powerThreshold)) return null;
  idx++;
  // "or greater" / "or more"
  if ((slice[idx] === 'or') && (slice[idx + 1] === 'greater' || slice[idx + 1] === 'more')) {
    idx += 2;
  } else {
    return null;
  }

  // "from among them"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;

  // "onto the battlefield"
  if (slice[idx] !== 'onto' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'battlefield') return null;
  idx += 3;
  if (slice[idx] === ',') idx++;
  if (slice[idx] === '.') idx++;

  // "[put] the rest on the bottom of your library [in a random order]"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
  if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
  else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: revealN,
    destination: 'battlefield',
    restDestination: 'bottom',
    minSelections: 0,
    maxSelections: 1,
    filter: { types: ['creature'], power: { op: 'gte', value: powerThreshold } },
    selectedCardChoiceId: 'lookTopPowerFilterBfIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 8: Match the "any number of land cards and/or legendary permanent
 * cards from among them onto the battlefield" family (Kamahl's Druidic Vow):
 *   "Look at the top X cards of your library, where X is the number of
 *    legendary permanents you control. You may put any number of land cards
 *    and/or legendary permanent cards from among them onto the battlefield.
 *    Put the rest on the bottom of your library in a random order."
 *
 * The multi-type "land and/or legendary permanent" filter is modeled as
 * anyOf: [{types:['land']}, {supertypes:['legendary'], permanent:true}].
 * maxSelections=999 (any number). The executor auto-selects every revealed
 * card matching either branch.
 *
 * The where-X count is optional; if present it uses parseWhereXIsNumberOf.
 * The "you may" prefix is optional.
 */
export function matchLookAtTopAnyNumberMultiTypeOntoBattlefield(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 20) return null;

  // "look at the top X/N cards of your library"
  let idx = 0;
  if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else if (slice[idx] === 'reveal') {
    idx++;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  let count: import('../ast').AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;

  // Optional ", where X is the number of <filter> <zone>"
  if (slice[idx] === ',') {
    const whereResult = parseWhereXIsNumberOf(slice, idx);
    if (whereResult && typeof count !== 'number' && (count as {kind:string}).kind === 'X') {
      count = whereResult.amount;
      idx = whereResult.nextIndex;
    }
  }
  if (slice[idx] === '.') idx++;

  // "you may put any number of"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] !== 'any' || slice[idx + 1] !== 'number' || slice[idx + 2] !== 'of') return null;
  idx += 3;

  // Parse multi-type: "land cards and/or legendary permanent cards"
  // Must have at least two types joined by "and/or" or "and ... or"
  // Supported pattern: "<typeA> cards and/or <typeB> [<typeC>] cards"
  const TYPE_MAP: Record<string, {types?: NonNullable<CardFilter['types']>; permanent?: boolean; supertypes?: string[]}> = {
    land: { types: ['land'] },
    creature: { types: ['creature'] },
    artifact: { types: ['artifact'] },
    enchantment: { types: ['enchantment'] },
    planeswalker: { types: ['planeswalker'] },
  };

  const parseBranchFilter = (startI: number): { filter: CardFilter; nextI: number } | null => {
    let i = startI;
    let f: CardFilter = {};
    // Optional "legendary" supertype qualifier
    if (slice[i] === 'legendary') {
      f.supertypes = ['legendary'];
      f.permanent = true;
      i++;
      // "permanent" after "legendary" is a type-qualifier, not a separate word — consume it
      if (slice[i] === 'permanent' || slice[i] === 'permanents') i++;
    }
    // Optional type word (e.g. "land", "creature", "artifact")
    if (TYPE_MAP[slice[i]]) {
      const entry = TYPE_MAP[slice[i]];
      if (entry.types) f = { ...f, types: entry.types };
      i++;
    } else if (!f.supertypes) {
      // No legendary supertype and no recognized type word — this branch is unparseable
      return null;
    }
    // "card(s)"
    if (slice[i] === 'card' || slice[i] === 'cards') i++;
    return { filter: f, nextI: i };
  };

  const branches: CardFilter[] = [];
  const first = parseBranchFilter(idx);
  if (!first) return null;
  branches.push(first.filter);
  idx = first.nextI;

  // "and/or" / "," continuing branches
  while (slice[idx] === 'and/or' || (slice[idx] === ',' && slice[idx + 1] === 'and/or')) {
    if (slice[idx] === ',') idx++;
    idx++; // skip "and/or"
    const next = parseBranchFilter(idx);
    if (!next) break;
    branches.push(next.filter);
    idx = next.nextI;
  }

  if (branches.length < 2) return null; // Must be multi-type for this matcher

  // "from among them onto the battlefield"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;
  if (slice[idx] !== 'onto' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'battlefield') return null;
  idx += 3;
  if (slice[idx] === ',') idx++;
  if (slice[idx] === '.') idx++;

  // "[and] [put] the rest on the bottom [of your library] [in a random order]"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard' = 'bottom';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const filter: CardFilter = branches.length === 1 ? branches[0] : { anyOf: branches };

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'battlefield',
    restDestination,
    minSelections: 0,
    maxSelections: 999,
    filter,
    selectedCardChoiceId: 'lookTopMultiTypeOntoBfIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match "Reveal/Look at the top card of your library. If it's a/an <type>
 * card, [you may] put it into your hand/graveyard." and the battlefield
 * variant "... [you may] put it onto the battlefield [tapped]." (permanent
 * types only). Unmatched cards stay on top.
 */
export function matchRevealTopIfMatch(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;
  if (slice[idx] === 'reveal') idx++;
  else if (slice[idx] === 'look' && slice[idx + 1] === 'at') idx += 2;
  else return null;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top' || slice[idx + 2] !== 'card') return null;
  idx += 3;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "if it's a/an <type> card,"
  if (slice[idx] !== 'if') return null;
  idx++;
  if (slice[idx] === "it's" || slice[idx] === 'its') idx++;
  else if (slice[idx] === 'it' && slice[idx + 1] === 'is') idx += 2;
  else return null;
  if (slice[idx] === 'a' || slice[idx] === 'an') idx++;

  const typeMap: Record<string, CardFilter> = {
    land: { types: ['land'] }, creature: { types: ['creature'] }, artifact: { types: ['artifact'] },
    enchantment: { types: ['enchantment'] }, instant: { types: ['instant'] }, sorcery: { types: ['sorcery'] },
    planeswalker: { types: ['planeswalker'] },
  };
  const matchedType = slice[idx];
  const filter = typeMap[matchedType];
  if (!filter) return null;
  idx++;
  if (slice[idx] === 'card') idx++;
  if (slice[idx] === ',') idx++;

  // "[you may] [reveal it and] put it into your hand/graveyard" or
  // "[you may] put it onto the battlefield [tapped]"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  // Domri Rade style: "you may reveal it and put it into your hand"
  if (slice[idx] === 'reveal' && slice[idx + 1] === 'it' && slice[idx + 2] === 'and') idx += 3;
  if (slice[idx] !== 'put' || slice[idx + 1] !== 'it') return null;
  idx += 2;
  let matchDestination: 'hand' | 'graveyard' | 'battlefield';
  let tapped = false;
  if (slice[idx] === 'into' && slice[idx + 1] === 'your') {
    idx += 2;
    if (slice[idx] === 'hand') matchDestination = 'hand';
    else if (slice[idx] === 'graveyard') matchDestination = 'graveyard';
    else return null;
    idx++;
  } else if (slice[idx] === 'onto' && slice[idx + 1] === 'the' && slice[idx + 2] === 'battlefield') {
    // Honest: only permanent types can be put onto the battlefield.
    if (matchedType === 'instant' || matchedType === 'sorcery') return null;
    matchDestination = 'battlefield';
    idx += 3;
    if (slice[idx] === 'tapped') {
      tapped = true;
      idx++;
    }
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  return {
    effects: [{ kind: 'RevealTopMatch', filter, matchDestination, ...(tapped ? { tapped: true } : {}) }],
    targets: [],
    consumed: idx,
  };
}

/**
 * Match: "exile the top N cards of your library"
 * Match: "exile the top card of your library"
 * Optionally followed by ". you may play them this turn" / ". you may play them until end of turn"
 */
export function matchExileFromLibraryTop(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 7) return null;
  if (slice[0] !== 'exile') return null;
  if (slice[1] !== 'the') return null;
  if (slice[2] !== 'top') return null;

  let count: AmountRef;
  let idx: number;

  // "the top card" (singular)
  if (slice[3] === 'card') {
    count = 1;
    idx = 4;
  }
  // "the top X cards ... where X is the number of creatures you control with power 4 or greater"
  else if (slice[3] === 'x') {
    if (slice[4] !== 'cards' && slice[4] !== 'card') return null;
    count = {
      kind: 'ForEach',
      zone: 'battlefield',
      filter: { types: ['creature'], power: { op: 'gte', value: 4 } },
      controller: 'you',
    };
    idx = 5;
  }
  // "the top N cards" or "the top three cards"
  else {
    count = parseInt(slice[3], 10);
    if (isNaN(count)) {
      count = parseWordNumber(slice[3]);
    }
    if (isNaN(count)) return null;
    if (slice[4] !== 'cards' && slice[4] !== 'card') return null;
    idx = 5;
  }

  if (slice[idx] !== 'of') return null;
  if (slice[idx + 1] !== 'your') return null;
  if (slice[idx + 2] !== 'library') return null;
  idx += 3;

  if (slice[idx] === ',' && slice[idx + 1] === 'where' && slice[idx + 2] === 'x') {
    while (idx < slice.length && slice[idx] !== '.') idx++;
  }
  if (slice[idx] === '.') idx++;

  // Check for "you may play them/it this turn" / "until end of turn"
  let mayPlay = false;
  let delayedDamageEachOpponentPerCard: number | undefined;
  if (slice[idx] === 'you' && slice[idx + 1] === 'may' && slice[idx + 2] === 'play') {
    mayPlay = true;
    idx += 3;
    // skip "them", "it", or "those cards"
    if (slice[idx] === 'them' || slice[idx] === 'it') idx++;
    if (slice[idx] === 'those' && slice[idx + 1] === 'cards') idx += 2;
    // skip "this turn", "until end of turn", or "until your next end step"
    if (slice[idx] === 'this' && slice[idx + 1] === 'turn') {
      idx += 2;
    } else if (slice[idx] === 'until' && slice[idx + 1] === 'end' && slice[idx + 2] === 'of' && slice[idx + 3] === 'turn') {
      idx += 4;
    } else if (slice[idx] === 'until' && slice[idx + 1] === 'your' && slice[idx + 2] === 'next' && slice[idx + 3] === 'end' && slice[idx + 4] === 'step') {
      idx += 5;
    }
    if (slice[idx] === '.') idx++;
  }

  if (
    slice[idx] === 'at' &&
    slice[idx + 1] === 'the' &&
    slice[idx + 2] === 'beginning' &&
    slice[idx + 3] === 'of' &&
    slice[idx + 4] === 'your' &&
    slice[idx + 5] === 'next' &&
    slice[idx + 6] === 'end' &&
    slice[idx + 7] === 'step'
  ) {
    const damageIndex = slice.indexOf('damage', idx);
    const opponentIndex = slice.indexOf('opponent', idx);
    if (damageIndex > idx && opponentIndex > idx) {
      const amountToken = slice[damageIndex - 1];
      const parsedAmount = parseInt(amountToken, 10);
      const wordAmount = parseWordNumber(amountToken);
      delayedDamageEachOpponentPerCard = Number.isFinite(parsedAmount)
        ? parsedAmount
        : Number.isFinite(wordAmount)
          ? wordAmount
          : undefined;
    }
  }

  const effect: Effect = {
    kind: 'ExileFromLibrary',
    player: { kind: 'Controller' },
    count,
    mayPlay,
    delayedDamageEachOpponentPerCard,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 7: Match "that player exiles the top N cards of their library"
 *          Match "that player exiles the top card of their library"
 *
 * Raven Guild Master / Wheel of Fortune family triggered tails. "That player"
 * is the player who was dealt combat damage (EventPlayer). The effect reuses
 * the existing ExileFromLibrary path; the executor resolves EventPlayer from
 * eventContext.eventPlayerId, which is set by the CombatDamageToPlayer trigger.
 */
export function matchThatPlayerExilesTopN(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "that player exiles the top N cards of their library"
  if (slice.length < 8) return null;
  if (slice[0] !== 'that') return null;
  if (slice[1] !== 'player') return null;
  if (slice[2] !== 'exiles') return null;
  if (slice[3] !== 'the') return null;
  if (slice[4] !== 'top') return null;

  let count: import('../ast').AmountRef;
  let idx: number;

  if (slice[5] === 'card') {
    // "the top card"
    count = 1;
    idx = 6;
  } else {
    const parsed = parseInt(slice[5], 10);
    if (!isNaN(parsed) && parsed > 0) {
      count = parsed;
    } else {
      const word = parseWordNumber(slice[5]);
      if (isNaN(word)) return null;
      count = word;
    }
    if (slice[6] !== 'cards' && slice[6] !== 'card') return null;
    idx = 7;
  }

  if (slice[idx] !== 'of') return null;
  // "their library" (that player's library)
  if (slice[idx + 1] !== 'their' && slice[idx + 1] !== 'his' && slice[idx + 1] !== 'her') return null;
  if (slice[idx + 2] !== 'library') return null;
  idx += 3;

  if (slice[idx] === '.') idx++;

  const effect: import('../ast').Effect = {
    kind: 'ExileFromLibrary',
    player: { kind: 'EventPlayer' },
    count,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Words that can never be tutor-filter nouns/adjectives. Hitting one inside a
 * search noun phrase means the phrase is a shape this parser does not honestly
 * support, so the matcher declines instead of guessing a bogus subtype.
 * Re-exported so parser.ts can keep SEARCH_PHRASE_STOPWORDS in the same location.
 */
// (SEARCH_PHRASE_STOPWORDS is imported from parser.ts above)

/**
 * Generalized tutor noun phrase: a sequence of filter words ending in
 * "card"/"cards" — "green creature", "Rebel permanent", "legendary Spirit
 * permanent", "artifact, creature, and/or land", "Aura or Equipment".
 *
 * HONESTY RULES (mirroring executeSearchLibrary's matchesCardFilter, which ORs
 * WITHIN a filter category via `.some` and ANDs ACROSS categories):
 * - Adjacent words (no connector) must be DIFFERENT categories — they AND
 *   ("green creature" = green AND creature). Two same-category adjacent words
 *   ("artifact creature") would need an AND the executor cannot express → null.
 * - Connector-joined words (",", "or", "and/or") must be the SAME category —
 *   they OR ("artifact, creature, and/or land" = any of those types). A
 *   cross-category OR ("an artifact or Aura card") would be ANDed by the
 *   executor → null. `permanent` is a boolean, so it can never be OR-joined.
 * - Unknown words are subtype guesses (the same convention as the single-word
 *   "a <word> card" branch below); matchesCardFilter checks them against the
 *   real type line via typeLineHasSubtype, so the search genuinely filters.
 */
function parseSearchFilterNounPhrase(
  slice: string[],
  startIndex: number,
): { filter: CardFilter; nextIndex: number } | null {
  const COLOR_WORDS = new Set(['white', 'blue', 'black', 'red', 'green']);
  const TYPE_WORDS = new Set(['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'land', 'planeswalker', 'battle']);
  const SUPERTYPE_WORDS: Record<string, string> = { legendary: 'Legendary', basic: 'basic', snow: 'snow' };

  let filter: CardFilter = {};
  const usedCategories = new Set<string>();
  let lastCategory: string | null = null;
  let pendingConnector = false;
  let words = 0;
  let guessWords = 0;
  let idx = startIndex;

  while (idx < slice.length && words < 6) {
    const token = slice[idx];
    if (token === 'card' || token === 'cards') {
      if (words === 0 || pendingConnector) return null;
      // A LONE unknown-word guess is junk-prone ("up to two qwerty cards" must
      // stay Unparsed — pinned by the multiselect honesty-guard test). Guesses
      // are only trusted alongside known structure: a known filter word
      // ("Rebel permanent") or a connector list ("Aura or Equipment").
      if (words === 1 && guessWords === 1) return null;
      return { filter, nextIndex: idx + 1 };
    }
    if (token === ',' || token === 'or' || token === 'and/or') {
      if (words === 0) return null;
      pendingConnector = true;
      idx++;
      continue;
    }
    if (SEARCH_PHRASE_STOPWORDS.has(token) || token.startsWith('non') || !/^[a-z][a-z'']*$/.test(token)) {
      return null;
    }

    let category: string;
    let wordFilter: CardFilter;
    if (SUPERTYPE_WORDS[token]) {
      category = 'supertype';
      wordFilter = { supertypes: [SUPERTYPE_WORDS[token]] };
    } else if (COLOR_WORDS.has(token)) {
      category = 'color';
      wordFilter = parseStaticFilterType(token) ?? {};
    } else if (TYPE_WORDS.has(token)) {
      category = 'type';
      wordFilter = { types: [token] };
    } else if (token === 'permanent') {
      category = 'permanent';
      wordFilter = { permanent: true };
    } else {
      // Subtype guess — no implied card type ("Spirit permanent" must match
      // ANY permanent with the Spirit subtype, not only creatures).
      const subtype = singularizeSubtypeWord(token);
      category = 'subtype';
      wordFilter = { subtypes: [subtype.charAt(0).toUpperCase() + subtype.slice(1)] };
      guessWords++;
    }

    if (pendingConnector) {
      // OR-join: only honest within the same category (executor ORs there).
      if (category !== lastCategory || category === 'permanent') return null;
      pendingConnector = false;
    } else if (usedCategories.has(category)) {
      // AND-join of two same-category words is not expressible — decline.
      return null;
    }
    usedCategories.add(category);
    lastCategory = category;
    filter = mergeStaticFilters(filter, wordFilter);
    words++;
    idx++;
  }
  return null;
}

/**
 * Match: "search your library for a card" (generic tutor — any card type)
 * Match: "search your library for a card, put it into your hand, then shuffle"
 * Match: "search your library for a card and put that card on top"
 * Uses namedCardChoices.tutorCard / namedCard to choose a real library card when provided.
 */
export function matchSearchLibraryGeneric(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 6) return null;
  if (slice[0] !== 'search') return null;
  if (slice[1] !== 'your') return null;
  if (slice[2] !== 'library') return null;
  if (slice[3] !== 'for') return null;

  let idx = 4;
  let filter: CardFilter = {};

  let minSelections: number | undefined;
  let maxSelections: number | undefined;
  let anyNumberOf = false;
  if (slice[idx] === 'up' && slice[idx + 1] === 'to') {
    const count = parseSmallNumberToken(slice[idx + 2]);
    if (Number.isNaN(count) || count < 1) return null;
    if (slice[idx + 3] === 'card' || slice[idx + 3] === 'cards') {
      // "up to N card(s) named X" — a single named card, up to N copies.
      if (slice[idx + 4] !== 'named') return null;
      let nameEnd = idx + 5;
      while (nameEnd < slice.length && slice[nameEnd] !== ',' && slice[nameEnd] !== '.' && slice[nameEnd] !== 'reveal' && slice[nameEnd] !== 'put') {
        nameEnd++;
      }
      const name = titleCaseCardName(slice.slice(idx + 5, nameEnd));
      if (!name) return null;
      filter = { names: [name] };
      minSelections = 0;
      maxSelections = count;
      idx = nameEnd;
    } else {
      // "up to N <type/subtype> cards" (Cultivate, Explosive Vegetation,
      // Circuitous Route, etc.). Set the cap and fall through to the shared
      // type-parsing block below, which now also accepts the plural "cards".
      minSelections = 0;
      maxSelections = count;
      idx += 3;
    }
  } else if (slice[idx] === 'any' && slice[idx + 1] === 'number' && slice[idx + 2] === 'of') {
    // "any number of <filter> cards" — unbounded selection (Iname, Death Aspect;
    // Goblin Recruiter). minSelections=0, maxSelections left undefined so the
    // executor treats this as an unbounded search.
    minSelections = 0;
    anyNumberOf = true;
    idx += 3;
  } else {
    if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
    idx++;
  }

  const BASIC_LAND_SUBTYPES = new Set(['plains', 'island', 'swamp', 'mountain', 'forest']);

  // Leading "legendary" supertype: "a legendary creature card" / "a legendary
  // card". executeSearchLibrary's matchesCardFilter checks the supertype via
  // typeLineHasSupertype (AND with any following type), so the search runs
  // honestly. ("basic"/"snow" supertypes are handled by the land branch below.)
  if (slice[idx] === 'legendary' && slice[idx + 1] !== 'card') {
    filter = mergeStaticFilters(filter, { supertypes: ['Legendary'] });
    idx++;
  }

  // "card" (singular) or "cards" (plural, for the "up to N ... cards" wording).
  const isCardWord = (t: string | undefined): boolean => t === 'card' || t === 'cards';

  if (isCardWord(slice[idx])) {
    idx++;
  } else if ((slice[idx] === 'basic' || slice[idx] === 'snow') && slice[idx + 1] === 'land') {
    // "a basic land card" / "a snow land card". The single supertype is matched
    // by executeSearchLibrary's matchesCardFilter (typeLineHasSupertype), so the
    // search runs honestly. Only one supertype is emitted (the executor's
    // supertype check is an OR), so "snow basic land" is intentionally not parsed.
    filter = mergeStaticFilters(filter, { supertypes: [slice[idx]], types: ['land'] });
    idx += 2;
    if (isCardWord(slice[idx])) idx++;
  } else if (
    (slice[idx] === 'basic' || slice[idx] === 'snow')
    && BASIC_LAND_SUBTYPES.has(slice[idx + 1])
  ) {
    // "up to two basic Plains cards" / "basic Forest cards": supertype AND
    // basic-land subtype. matchesCardFilter ANDs the supertype with the subtype
    // (typeLineHasSupertype + typeLineHasSubtype), so the search runs honestly.
    const supertype = slice[idx];
    idx++;
    const subtypes: string[] = [];
    while (idx < slice.length) {
      const token = slice[idx];
      if (token === 'or' || token === ',') { idx++; continue; }
      if (BASIC_LAND_SUBTYPES.has(token)) {
        const cap = token.charAt(0).toUpperCase() + token.slice(1);
        if (!subtypes.includes(cap)) subtypes.push(cap);
        idx++;
        continue;
      }
      break;
    }
    if (subtypes.length === 0) return null;
    filter = mergeStaticFilters(filter, { supertypes: [supertype], types: ['land'], subtypes });
    if (isCardWord(slice[idx])) idx++;
  } else if (slice[idx] === 'land' && isCardWord(slice[idx + 1])) {
    // "up to N land cards" (any land, e.g. Circuitous Route's land mode).
    filter = mergeStaticFilters(filter, { types: ['land'] });
    idx += 2;
  } else if (BASIC_LAND_SUBTYPES.has(slice[idx])) {
    // "a Mountain card" / "a Mountain or Plains card" / "an Island or Swamp card"
    // / "up to two Forest cards".
    const subtypes: string[] = [];
    while (idx < slice.length) {
      const token = slice[idx];
      if (token === 'or' || token === ',') { idx++; continue; }
      if (BASIC_LAND_SUBTYPES.has(token)) {
        const cap = token.charAt(0).toUpperCase() + token.slice(1);
        if (!subtypes.includes(cap)) subtypes.push(cap);
        idx++;
        continue;
      }
      break;
    }
    if (subtypes.length === 0) return null;
    filter = mergeStaticFilters(filter, { types: ['land'], subtypes });
    if (isCardWord(slice[idx])) idx++;
  } else if (
    slice[idx + 1] === 'or'
    && (() => {
      // "an instant or sorcery card" / "an artifact or enchantment card":
      // a card-type OR-list. Only accept when EVERY listed word resolves to a
      // pure card-type filter (no subtype/color guesswork) and the list ends in
      // "card". matchesCardFilter ORs filter.types via .some, so the multi-type
      // filter is matched honestly.
      const first = parseStaticFilterType(slice[idx]);
      if (!first || !first.types || first.types.length !== 1) return false;
      let j = idx + 1;
      while (slice[j] === 'or' || slice[j] === ',') {
        const t = parseStaticFilterType(slice[j + 1]);
        if (!t || !t.types || t.types.length !== 1) return false;
        j += 2;
      }
      return slice[j] === 'card';
    })()
  ) {
    const types: string[] = [];
    let j = idx;
    for (;;) {
      const t = parseStaticFilterType(slice[j]);
      if (t?.types) for (const ty of t.types) if (!types.includes(ty)) types.push(ty);
      j++;
      if (slice[j] === 'or' || slice[j] === ',') { j++; continue; }
      break;
    }
    filter = mergeStaticFilters(filter, { types });
    idx = j;
    if (slice[idx] === 'card') idx++;
  } else if (slice[idx + 1] === 'card' || slice[idx + 1] === 'cards') {
    const filterWord = slice[idx];
    const parsedFilter = parseStaticFilterType(filterWord);
    if (parsedFilter) {
      // Known type/subtype word ("Spirit card", "Goblin cards", "creature card").
      filter = mergeStaticFilters(filter, parsedFilter);
    } else if (maxSelections === undefined && !anyNumberOf) {
      // Single-card "a/an <word> card" — unknown words are almost always subtype
      // searches (Shrine, Gate, Aura, Equipment, Background, etc.). Do not force
      // them through creature-only filtering; the authority prompt validates.
      const subtype = singularizeSubtypeWord(filterWord);
      filter = mergeStaticFilters(filter, {
        subtypes: [subtype.charAt(0).toUpperCase() + subtype.slice(1)],
      });
    } else {
      // "up to N <unknown> cards" / "any number of <unknown> cards" — no known
      // type or subtype. Don't guess; let the honesty guard block it.
      // (Intentional fall-through: filter stays as-is, guard rejects empty filter.)
    }
    idx += 2;
  } else {
    // Multi-word noun phrases: "a green creature card", "a Rebel permanent
    // card", "a legendary Spirit permanent card", "up to two artifact,
    // creature, and/or land cards", "an Aura or Equipment card".
    const phrase = parseSearchFilterNounPhrase(slice, idx);
    if (phrase) {
      filter = mergeStaticFilters(filter, phrase.filter);
      idx = phrase.nextIndex;
    } else if (!maxSelections && !anyNumberOf) {
      return null;
    }
  }

  // Honesty guard: never emit an unrestricted "search for up to N cards" or
  // "search for any number of cards" that would let the engine fetch ANY card.
  // The single-card generic tutor ("search your library for a card") is
  // legitimately unrestricted — the controller names the real card at resolution
  // — so only the multi-select ("up to N" or "any number of") path needs this.
  // If the type-parsing above produced no real restriction for a multi-select
  // search, bail so the card stays Unparsed rather than shipping a trivial effect.
  if (maxSelections !== undefined || anyNumberOf) {
    const hasRealFilter = Boolean(
      filter.names?.length
      || filter.types?.length
      || filter.subtypes?.length
      || filter.supertypes?.length
      || filter.colors?.length
      || filter.cmc,
    );
    if (!hasRealFilter) return null;
  }

  const manaValueFilter = parseManaValueXSuffix(slice, idx) ?? parseManaValueFilterSuffix(slice, idx);
  if (manaValueFilter) {
    filter = mergeStaticFilters(filter, manaValueFilter.filter);
    idx = manaValueFilter.nextIndex;
  }

  // Skip optional destination clauses and shuffle
  // "put it into your hand" / "put that card on top" etc.
  // We consume everything until end of tokens or next sentence
  let shuffle = false;
  let destination: 'hand' | 'battlefield' | 'top' | 'graveyard' = 'hand';
  let tapped = false;

  if (slice[idx] === ',') idx++;
  // "and put them into your graveyard" / "and put them into your hand" (Iname-style)
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'reveal') {
    while (idx < slice.length && slice[idx] !== ',' && slice[idx] !== '.' && slice[idx] !== 'then') {
      idx++;
    }
    if (slice[idx] === ',') idx++;
  }
  if (slice[idx] === 'put') {
    // Skip "put it into your hand" / "put it onto the battlefield [tapped]" / "put that card on top"
    // / "put them into your graveyard" (any-number-of family)
    while (idx < slice.length && slice[idx] !== ',' && slice[idx] !== '.' && slice[idx] !== 'then') {
      if (slice[idx] === 'battlefield') {
        destination = 'battlefield';
      } else if (slice[idx] === 'tapped') {
        tapped = true;
      } else if (slice[idx] === 'top') {
        destination = 'top';
      } else if (slice[idx] === 'graveyard') {
        destination = 'graveyard';
      }
      idx++;
    }
  }
  if (slice[idx] === ',') idx++;
  if (slice[idx] === 'then' && slice[idx + 1] === 'shuffle') {
    shuffle = true;
    idx += 2;
  } else if (slice[idx] === 'shuffle') {
    shuffle = true;
    idx++;
  }
  // "then shuffle your library"
  if (slice[idx] === 'your' && slice[idx + 1] === 'library') {
    idx += 2;
  }
  if (slice[idx] === '.') idx++;

  const effects: Effect[] = [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter,
      destination,
      tapped,
      shuffle,
      ...(minSelections !== undefined ? { minSelections } : {}),
      ...(maxSelections !== undefined ? { maxSelections } : {}),
      namedCardChoiceId: 'tutorCard',
      selectedCardChoiceId: 'tutorCardId',
    },
  ];

  if (shuffle && destination !== 'top') {
    effects.push({
      kind: 'ShuffleLibrary',
      player: { kind: 'Controller' },
    });
  }

  return { effects, targets: [], consumed: idx };
}

/**
 * Match the modern tutor tail sentence: "If you search your library this way,
 * shuffle." (also "... shuffle your library." / "... shuffle it."). It follows
 * reveal/put tutors as a standalone sentence, so it must parse on its own for
 * the face to stay covered. Mapping it to ShuffleLibrary is honest: whenever
 * the effect list runs, the preceding search in the same list ran too, and per
 * CR 701.19b the library is shuffled even when the search found nothing.
 */
export function matchSearchThisWayShuffleTail(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 8) return null;
  if (slice[0] !== 'if' || slice[1] !== 'you' || slice[2] !== 'search') return null;
  if (slice[3] !== 'your' || slice[4] !== 'library') return null;
  if (slice[5] !== 'this' || slice[6] !== 'way') return null;
  let idx = 7;
  if (slice[idx] === ',') idx++;
  if (slice[idx] !== 'shuffle') return null;
  idx++;
  if (slice[idx] === 'your' && slice[idx + 1] === 'library') idx += 2;
  else if (slice[idx] === 'it') idx++;
  if (slice[idx] === '.') idx++;
  const effect: Effect = { kind: 'ShuffleLibrary', player: { kind: 'Controller' } };
  return { effects: [effect], targets: [], consumed: idx }; // matchSearchThisWayShuffleTail end
}

/**
 * Match: "search your library for a basic land card"
 * Match: "search your library for a Mountain or Plains card"
 * Match: "search your library for an Island or Mountain card"
 * Legacy matcher called only by parseActivatedAbilities in parser.ts.
 */
export function matchSearchLibrary(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "search your library for a basic land card"
  // "search your library for a Mountain or Plains card"
  // "search your library for an Island or Mountain card"
  if (slice.length < 7) return null;
  if (slice[0] !== 'search') return null;
  if (slice[1] !== 'your') return null;
  if (slice[2] !== 'library') return null;
  if (slice[3] !== 'for') return null;

  let idx = 4;

  // Optional "up to N" quantifier (Cultivate / Explosive Vegetation: "up to two
  // basic land cards", "up to two Forest cards"). The executor honors this via
  // SearchLibrary.maxSelections and genuinely moves up to N cards.
  let maxSelections: number | undefined;
  if (slice[idx] === 'up' && slice[idx + 1] === 'to') {
    const count = parseSmallNumberToken(slice[idx + 2]);
    if (Number.isNaN(count) || count < 1) return null;
    maxSelections = count;
    idx += 3;
    // After "up to N" the article is dropped; the type words follow directly.
  } else {
    if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
    idx++;
  }

  const supertypes: string[] = [];
  const types: string[] = [];
  const subtypes: string[] = [];
  const BASIC_LAND_SUBTYPES = new Set(['plains', 'island', 'swamp', 'mountain', 'forest']);

  // Leading land supertype: "basic" or "snow" ("a basic land card" /
  // "a snow land card"). executeSearchLibrary's matchesCardFilter checks the
  // supertype via typeLineHasSupertype, so the search genuinely runs. Only a
  // single supertype is emitted: the executor's supertype check is an OR
  // (`.some`), so a combined "snow basic" filter would not honestly AND-match
  // — we therefore do not parse that rarely-printed combination.
  if (slice[idx] === 'basic' || slice[idx] === 'snow') {
    supertypes.push(slice[idx]);
    idx++;
  }

  if (slice[idx] === 'land') {
    types.push('land');
    idx++;
  } else {
    while (idx < slice.length) {
      const token = slice[idx];
      if (token === 'or' || token === ',') {
        idx++;
        continue;
      }
      if (BASIC_LAND_SUBTYPES.has(token)) {
        subtypes.push(token.charAt(0).toUpperCase() + token.slice(1));
        if (!types.includes('land')) types.push('land');
        idx++;
        continue;
      }
      break;
    }
    if (subtypes.length === 0) return null;
  }

  // Skip "card" / "cards" (plural for "up to N ... cards")
  if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;
  // Skip comma
  if (slice[idx] === ',') idx++;

  // Parse destination: "put it/them onto the battlefield [tapped]" or "...into your hand"
  let destination: 'battlefield' | 'hand' | 'top' | 'graveyard' = 'battlefield';
  let tapped = false;

  if (slice[idx] === 'put' && (slice[idx + 1] === 'it' || slice[idx + 1] === 'them')) {
    idx += 2;
    if (slice[idx] === 'onto' && slice[idx + 1] === 'the' && slice[idx + 2] === 'battlefield') {
      destination = 'battlefield';
      idx += 3;
      if (slice[idx] === 'tapped') {
        tapped = true;
        idx++;
      }
    } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'hand') {
      destination = 'hand';
      idx += 3;
    } else if (slice[idx] === 'on' && slice[idx + 1] === 'top' && slice[idx + 2] === 'of' && slice[idx + 3] === 'your' && slice[idx + 4] === 'library') {
      destination = 'top';
      idx += 5;
    }
  }

  // Skip comma
  if (slice[idx] === ',') idx++;

  // Parse shuffle
  let shuffle = false;
  if (slice[idx] === 'then' && slice[idx + 1] === 'shuffle') {
    shuffle = true;
    idx += 2;
  } else if (slice[idx] === 'shuffle') {
    shuffle = true;
    idx++;
  }

  // Skip trailing period
  if (slice[idx] === '.') idx++;

  const filter: CardFilter = {
    types: types.length > 0 ? types : undefined,
    subtypes: subtypes.length > 0 ? subtypes : undefined,
    supertypes: supertypes.length > 0 ? supertypes : undefined,
  };

  const effects: Effect[] = [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter,
      destination,
      tapped,
      shuffle,
      ...(maxSelections !== undefined
        ? {
            minSelections: 0,
            maxSelections,
            namedCardChoiceId: 'tutorCard',
            selectedCardChoiceId: 'tutorCardIds',
          }
        : {}),
    },
  ];

  if (shuffle && destination !== 'top') {
    effects.push({
      kind: 'ShuffleLibrary',
      player: { kind: 'Controller' },
    });
  }

  return { effects, targets: [], consumed: idx };
} // end matchSearchLibrary (legacy)

// ============================================================================
// Slice 3 additions: reorder-top, plural/up-to-N filter, Dark Confidant family
// ============================================================================

// ============================================================================
// Slice 1 additions: dynamic-count reorder, up-to-M filter reveal,
// put-N-to-graveyard, put-one-on-top-rest-bottom
// ============================================================================

/**
 * Match the dynamic-count reorder family (Descendant of Soramaro, ~9 faces):
 *   "Look at the top X cards of your library, where X is the number of cards
 *    in your hand. Put them back in any order."
 *   "Look at the top X cards of your library, where X is its power.
 *    Then put them back in any order."
 *   "Look at the top X cards of your library, where X is this creature's power.
 *    Put them back in any order."
 *
 * Emits ChooseFromTopOfLibrary with maxSelections=0, restDestination='top'
 * and a ForEach or TargetPower count. Honest: no cards change zones.
 */
export function matchLookAtTopDynamicCountReorderBack(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 12) return null;

  // "look at the top x cards of your library"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at' || slice[idx + 2] !== 'the' || slice[idx + 3] !== 'top') return null;
  idx += 4;
  if (slice[idx] !== 'x') return null;
  idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;

  // ", where x is <dynamic count>"
  if (slice[idx] === ',') idx++;
  if (slice[idx] !== 'where' || slice[idx + 1] !== 'x' || slice[idx + 2] !== 'is') return null;
  idx += 3;

  let count: import('../ast').AmountRef;

  // "its power" or "this creature's power" → TargetPower Source
  if (slice[idx] === 'its' && slice[idx + 1] === 'power') {
    count = { kind: 'TargetPower', target: { kind: 'Source' } };
    idx += 2;
  } else if (slice[idx] === 'this' && slice[idx + 2] === 'power') {
    // "this creature's power" / "this permanent's power"
    count = { kind: 'TargetPower', target: { kind: 'Source' } };
    idx += 3;
  } else {
    // "the number of <filter> <zone>"
    const whereResult = parseWhereXIsNumberOf(slice, idx - 3);
    if (!whereResult) return null;
    count = whereResult.amount;
    idx = whereResult.nextIndex;
  }

  // Optional comma before period or "then" (e.g. "..., then put them back")
  if (slice[idx] === ',') idx++;
  if (slice[idx] === '.') idx++;
  if (slice[idx] === 'then') idx++;

  // "put them back in any order" (required)
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] !== 'them') return null;
  idx++;
  if (slice[idx] !== 'back') return null;
  idx++;
  if (slice[idx] !== 'in') return null;
  idx++;
  if (slice[idx] !== 'any') return null;
  idx++;
  if (slice[idx] !== 'order') return null;
  idx++;
  if (slice[idx] === '.') idx++;

  const effect: import('../ast').Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'hand',        // unused (maxSelections=0)
    restDestination: 'top',     // all N cards go back on top
    minSelections: 0,
    maxSelections: 0,
    fallbackSelectionCount: 0,
    selectedCardChoiceId: 'dynamicReorderTopIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 9/12: Match the bare-X reorder family (Soothsaying):
 *   "{X}: Look at the top X cards of your library, then put them back in any order."
 *
 * This handles activated-ability bodies where X is the mana-cost variable and
 * there is NO "where X is ..." qualifier. The body is literally:
 *   "Look at the top X cards of your library, then put them back in any order."
 *
 * Distinguished from matchLookAtTopDynamicCountReorderBack (which requires
 * ", where X is <dynamic-count>") and matchLookAtTopReorderBack (which
 * requires a fixed small-number N like "four" or "3").
 *
 * Emits ChooseFromTopOfLibrary with count={kind:'X'} (resolves to xValue at
 * execution time), maxSelections=0 and restDestination='top' — all cards go
 * back on top. Honest: no cards change zones; the engine cannot interactively
 * reorder, so cards remain in their current order.
 */
export function matchLookAtTopXReorderBack(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 10) return null;
  let idx = 0;

  // "look at the top"
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at' || slice[idx + 2] !== 'the' || slice[idx + 3] !== 'top') return null;
  idx += 4;

  // Must be bare "x" (not a word-number or digit)
  if (slice[idx] !== 'x') return null;
  idx++;

  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;

  // "of your library" only (not "of target player's")
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;

  // Must NOT be followed by ", where" — that form is handled by
  // matchLookAtTopDynamicCountReorderBack.
  if (slice[idx] === ',' && slice[idx + 1] === 'where') return null;
  if (slice[idx] === 'where') return null;

  // Optional comma and/or period before "then"
  if (slice[idx] === ',') idx++;
  if (slice[idx] === '.') idx++;

  // "then put them back in any order"
  if (slice[idx] === 'then') idx++;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] !== 'them') return null;
  idx++;
  if (slice[idx] !== 'back') return null;
  idx++;
  if (slice[idx] !== 'in') return null;
  idx++;
  if (slice[idx] !== 'any') return null;
  idx++;
  if (slice[idx] !== 'order') return null;
  idx++;
  if (slice[idx] === '.') idx++;

  const effect: import('../ast').Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: { kind: 'X' },
    destination: 'hand',        // unused (maxSelections=0)
    restDestination: 'top',     // all X cards go back on top
    minSelections: 0,
    maxSelections: 0,
    fallbackSelectionCount: 0,
    selectedCardChoiceId: 'xReorderTopIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the "reveal up to M filter cards from among them" family
 * (Knight-Errant of Eos, Nessian Wanderer, Vivien's Talent, For the Ancestors):
 *   "Look at the top N cards of your library. You may reveal up to M <filter>
 *    cards from among them and put them into your hand. Put the rest on the
 *    bottom [in a random order]." / "into your graveyard."
 *
 *   Also handles the X-count variant:
 *   "Look at the top X cards of your library, where X is the number of <filter>
 *    <zone>. You may reveal up to M <filter> cards from among them and put them
 *    into your hand. Put the rest on the bottom of your library in a random order."
 *
 * Emits ChooseFromTopOfLibrary with destination='hand', a type/subtype filter,
 * minSelections=0, maxSelections=M, restDestination='bottom' or 'graveyard'.
 */
export function matchRevealTopUpToMFilter(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 16) return null;

  // "look at the top N cards ..." / "reveal the top N cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  // Count: fixed number or X
  let count: import('../ast').AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const revealN = parseSmallNumberToken(slice[idx]);
    if (isNaN(revealN) || revealN < 1) return null;
    count = revealN;
    idx++;
  }
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;

  // Optional ", where X is the number of <filter> <zone>"
  if (slice[idx] === ',') {
    const whereResult = parseWhereXIsNumberOf(slice, idx);
    if (whereResult && typeof count !== 'number' && count.kind === 'X') {
      count = whereResult.amount;
      idx = whereResult.nextIndex;
    }
  }
  if (slice[idx] === '.') idx++;

  // "[you may] reveal up to M <filter> cards from among them [and] [put them into your hand]"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'reveal') return null;
  idx++;
  if (slice[idx] !== 'up' || slice[idx + 1] !== 'to') return null;
  idx += 2;

  // M: small number
  const maxSel = parseSmallNumberToken(slice[idx]);
  if (isNaN(maxSel) || maxSel < 1) return null;
  idx++;

  // <filter>: type word(s) - support simple single type or "snow <type>"
  const typeMap: Record<string, NonNullable<import('../ast').CardFilter['types']>> = {
    land: ['land'], lands: ['land'],
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    instant: ['instant'], instants: ['instant'],
    sorcery: ['sorcery'], sorceries: ['sorcery'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };

  let filter: import('../ast').CardFilter = {};

  // Optional "snow" supertype
  if (slice[idx] === 'snow') {
    filter = { supertypes: ['snow'] };
    idx++;
  }

  // "permanent" or type word
  if (slice[idx] === 'permanent' || slice[idx] === 'permanents') {
    filter = { ...filter, permanent: true };
    idx++;
  } else {
    const types = typeMap[slice[idx]];
    if (!types) {
      // Could be a subtype word — handle simple single-word subtype
      const subtypeToken = slice[idx];
      if (!subtypeToken || !/^[a-z][a-z']+$/.test(subtypeToken)) return null;
      const CARD_TYPE_WORDS = new Set([
        'land', 'lands', 'creature', 'creatures', 'artifact', 'artifacts',
        'enchantment', 'enchantments', 'instant', 'instants', 'sorcery', 'sorceries',
        'planeswalker', 'planeswalkers', 'permanent', 'permanents',
        'the', 'of', 'your', 'from', 'into', 'onto', 'on', 'this', 'them',
        'any', 'all', 'number', 'up', 'to', 'with', 'mana', 'value', 'put', 'rest',
      ]);
      if (CARD_TYPE_WORDS.has(subtypeToken)) return null;
      const subtype = singularizeSubtypeWord(subtypeToken);
      filter = { ...filter, subtypes: [subtype.charAt(0).toUpperCase() + subtype.slice(1)] };
      idx++;
    } else {
      filter = { ...filter, types };
      idx++;
    }
  }

  // "card" / "cards"
  if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;

  // Optional "with mana value K or less"
  if (slice[idx] === 'with' && slice[idx + 1] === 'mana' && slice[idx + 2] === 'value') {
    const k = parseInt(slice[idx + 3], 10);
    if (!Number.isNaN(k)) {
      idx += 4;
      if (slice[idx] === 'or' && slice[idx + 1] === 'less') {
        filter = { ...filter, cmc: { op: 'lte', value: k } };
        idx += 2;
      } else {
        filter = { ...filter, cmc: { op: 'eq', value: k } };
      }
    }
  }

  // "from among them [and put them into your hand]" or "from among them and put them into your hand"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;

  // "and put them into your hand" (optional inline — may be separate sentence)
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') {
    idx++;
    if (slice[idx] === 'them' || slice[idx] === 'it') idx++;
    if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
    idx += 3;
    if (slice[idx] === '.') idx++;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'hand') {
    idx += 3;
    if (slice[idx] === '.') idx++;
  } else {
    // "put them" must appear soon in the next sentence
    if (slice[idx] === '.') idx++;
    if (slice[idx] === 'put' && (slice[idx + 1] === 'them' || slice[idx + 1] === 'it')) {
      idx++;
      if (slice[idx] === 'them' || slice[idx] === 'it') idx++;
      if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
      idx += 3;
      if (slice[idx] === '.') idx++;
    } else {
      return null;
    }
  }

  // "[and] [put] the rest on the bottom / into your graveyard"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const effect: import('../ast').Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'hand',
    restDestination,
    minSelections: 0,
    maxSelections: maxSel,
    filter,
    selectedCardChoiceId: 'revealTopUpToMFilterIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the "put N of them into your graveyard" family (Celestus Sanctifier):
 *   "Look at the top N cards of your library. You may put [up to] M of them
 *    into your graveyard. Put the rest on top of your library in any order."
 *
 * Emits ChooseFromTopOfLibrary with destination='graveyard', restDestination='top'.
 * The executor puts selected cards in the graveyard and returns unselected to top.
 */
export function matchLookAtTopPutNToGraveyard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 12) return null;

  // "look at the top N cards of your library"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at' || slice[idx + 2] !== 'the' || slice[idx + 3] !== 'top') return null;
  idx += 4;

  let count: import('../ast').AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "[you may] put [up to] M of them into your graveyard"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;
  let upTo = false;
  if (slice[idx] === 'up' && slice[idx + 1] === 'to') {
    upTo = true;
    idx += 2;
  }
  const takeM = parseSmallNumberToken(slice[idx]);
  if (isNaN(takeM) || takeM < 1) return null;
  idx++;
  if (slice[idx] !== 'of') return null;
  idx++;
  if (slice[idx] === 'them') {
    idx++;
  } else if (slice[idx] === 'those' && (slice[idx + 1] === 'cards' || slice[idx + 1] === 'card')) {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'graveyard') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "put the rest on top of your library [in any order]"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  if (slice[idx] !== 'on' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
  if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  else if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
  if (slice[idx] === '.') idx++;

  const effect: import('../ast').Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'graveyard',
    restDestination: 'top',
    minSelections: upTo ? 0 : takeM,
    maxSelections: takeM,
    fallbackSelectionCount: takeM,
    selectedCardChoiceId: 'lookTopPutNGraveyardIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the "put one on top, rest on bottom" family (Gutless Plunderer):
 *   "Look at the top N cards of your library. Put one of them back on top of
 *    your library and the rest on the bottom of your library in any order."
 *
 * Emits ChooseFromTopOfLibrary with destination='top', restDestination='bottom',
 * maxSelections=1. The executor puts the selected card on top and the rest on bottom.
 */
export function matchLookAtTopOneOnTopRestBottom(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "look at the top N cards of your library"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at' || slice[idx + 2] !== 'the' || slice[idx + 3] !== 'top') return null;
  idx += 4;

  const n = parseSmallNumberToken(slice[idx]);
  if (isNaN(n) || n < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "put [up to] one of them [back] on top of your library"
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] === 'up' && slice[idx + 1] === 'to') idx += 2;
  if (slice[idx] !== 'one') return null;
  idx++;
  if (slice[idx] === 'of') {
    idx++;
    if (slice[idx] === 'them') idx++;
    else if (slice[idx] === 'those' && (slice[idx + 1] === 'cards' || slice[idx + 1] === 'card')) idx += 2;
  }
  if (slice[idx] === 'back') idx++;
  if (slice[idx] !== 'on' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
  if (slice[idx] === '.') idx++;

  // "and the rest on the bottom [of your library] [in a random/any order]"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  if (slice[idx] !== 'on' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'bottom') return null;
  idx += 3;
  if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
  if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
  else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  if (slice[idx] === '.') idx++;

  const effect: import('../ast').Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: n,
    destination: 'top',
    restDestination: 'bottom',
    minSelections: 0,
    maxSelections: 1,
    fallbackSelectionCount: 1,
    selectedCardChoiceId: 'lookTopOneOnTopIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the reorder-top family (Sage Owl, Elemental Augury):
 *   "Look at the top N cards of your library, then put them back in any order."
 *   "Look at the top N cards of target player's library, then put them back in
 *    any order."
 *
 * Emits a ChooseFromTopOfLibrary effect with maxSelections=0 and
 * restDestination='top' so the executor puts all N cards back on top of the
 * library. The engine cannot interactively reorder, so cards stay in their
 * current order — the effect is honest (no cards change zones).
 */
export function matchLookAtTopReorderBack(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 10) return null;
  let idx = 0;

  // "look at the top"
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at' || slice[idx + 2] !== 'the' || slice[idx + 3] !== 'top') return null;
  idx += 4;

  // N cards
  const n = parseSmallNumberToken(slice[idx]);
  if (isNaN(n) || n < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;

  // "of your library" OR "of target player's library" / "of target opponent's library"
  if (slice[idx] !== 'of') return null;
  idx++;

  const targets: TargetSpec[] = [];
  let playerRef: import('../ast').TargetRef;

  if (slice[idx] === 'your') {
    playerRef = { kind: 'Controller' };
    idx++;
  } else if (slice[idx] === 'target' && (slice[idx + 1] === "player's" || slice[idx + 1] === "opponent's")) {
    const spec = makeTargetSpec('Player', slice[idx + 1] === "opponent's" ? { opponentControls: true } : undefined);
    targets.push(spec);
    playerRef = makeChosenRef(spec);
    idx += 2;
  } else {
    return null;
  }

  if (slice[idx] !== 'library') return null;
  idx++;
  if (slice[idx] === ',') idx++;
  if (slice[idx] === '.') idx++;

  // "then put them back in any order" — the required phrase
  if (slice[idx] === 'then') idx++;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] !== 'them') return null;
  idx++;
  if (slice[idx] !== 'back') return null;
  idx++;
  if (slice[idx] !== 'in') return null;
  idx++;
  if (slice[idx] !== 'any') return null;
  idx++;
  if (slice[idx] !== 'order') return null;
  idx++;
  if (slice[idx] === '.') idx++;

  const effect: import('../ast').Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: playerRef,
    count: n,
    destination: 'hand',        // unused (maxSelections=0)
    restDestination: 'top',     // all N cards go back on top
    minSelections: 0,
    maxSelections: 0,
    fallbackSelectionCount: 0,
    selectedCardChoiceId: 'reorderTopIds',
  };

  return { effects: [effect], targets, consumed: idx };
}

/**
 * Match the plural/up-to-N filter take from top-of-library family with extended
 * filter support:
 *   "Look at the top N cards of your library. Reveal any number of <type> cards
 *    from among them and put them into your hand. Put the rest on the bottom ..."
 *                                                           (Forging the Anchor)
 *   "Look at the top N cards of your library. Put any number of snow permanent
 *    cards from among them into your hand. Put the rest on the bottom ..."
 *                                                         (Glacial Revelation)
 *   "Look at the top X cards of your library ... You may put any number of
 *    creature cards with mana value 2 or less from among them into your hand."
 *                                                       (Knight-Errant of Eos)
 *
 * Extends matchRevealTopTake to cover:
 * - Snow-typed filters: "snow permanent cards", "snow creature cards", etc.
 * - Mana-value capped takes: "with mana value N or less"
 * - "reveal any number ... and put them into your hand" alternate phrasing
 *
 * Returns null for wordings already handled by matchRevealTopTake.
 */
export function matchRevealTopTakeExtended(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "reveal the top N cards ..." / "look at the top N cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  let count: import('../ast').AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const revealN = parseSmallNumberToken(slice[idx]);
    if (isNaN(revealN) || revealN < 1) return null;
    count = revealN;
    idx++;
  }
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  // "reveal any number of <type> cards ... and put them into your hand" variant
  let isRevealThenPut = false;
  if (slice[idx] === 'reveal') {
    isRevealThenPut = true;
    idx++;
  } else {
    if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
    if (slice[idx] !== 'put') return null;
    idx++;
  }

  // "any number of" or "up to N"
  let maxSelections = typeof count === 'number' ? count : 99;
  let hasMvcCap = false;
  if (slice[idx] === 'any' && slice[idx + 1] === 'number' && slice[idx + 2] === 'of') {
    idx += 3;
  } else if (slice[idx] === 'up' && slice[idx + 1] === 'to') {
    idx += 2;
    const capN = parseSmallNumberToken(slice[idx]);
    if (!isNaN(capN) && capN >= 1) {
      maxSelections = capN;
      hasMvcCap = true;
      idx++;
    }
  } else if (!isRevealThenPut) {
    return null;
  }

  // Snow supertype prefix
  let filter: import('../ast').CardFilter = {};
  let isSnow = false;
  if (slice[idx] === 'snow') {
    isSnow = true;
    filter = { supertypes: ['snow'] };
    idx++;
  }

  // Type/permanent word
  const typeMap: Record<string, NonNullable<import('../ast').CardFilter['types']>> = {
    land: ['land'], lands: ['land'],
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    instant: ['instant'], instants: ['instant'],
    sorcery: ['sorcery'], sorceries: ['sorcery'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };
  let isMultiTypeOr = false;
  if (slice[idx] === 'permanent' || slice[idx] === 'permanents') {
    filter = isSnow ? { ...filter, permanent: true } : { permanent: true };
    idx++;
  } else {
    const firstTypes = typeMap[slice[idx]];
    if (!firstTypes) return null;
    idx++;
    // "instant and/or sorcery" multi-type OR (Pieces of the Puzzle)
    // Collect all "and/or <type>" or "or <type>" continuations before "card/cards"
    const orBranches: import('../ast').CardFilter[] = [{ types: firstTypes }];
    while ((slice[idx] === 'and/or' || slice[idx] === 'or') && typeMap[slice[idx + 1]]) {
      const moreTypes = typeMap[slice[idx + 1]];
      orBranches.push({ types: moreTypes! });
      idx += 2;
    }
    if (orBranches.length > 1) {
      // Multi-type OR: use anyOf so the executor ORs across types (honest)
      const anyOfFilter: import('../ast').CardFilter = { anyOf: orBranches };
      filter = isSnow ? { ...filter, ...anyOfFilter } : anyOfFilter;
      isMultiTypeOr = true;
    } else {
      filter = isSnow ? { ...filter, types: firstTypes } : { types: firstTypes };
    }
  }
  if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;

  // Optional mana-value constraint (Knight-Errant of Eos)
  let hasMvFilter = false;
  if (slice[idx] === 'with' && slice[idx + 1] === 'mana' && slice[idx + 2] === 'value') {
    const k = parseInt(slice[idx + 3], 10);
    if (!Number.isNaN(k)) {
      idx += 4;
      if (slice[idx] === 'or' && slice[idx + 1] === 'less') {
        filter = { ...filter, cmc: { op: 'lte', value: k } };
        idx += 2;
      } else {
        filter = { ...filter, cmc: { op: 'eq', value: k } };
      }
      hasMvFilter = true;
    }
  }

  // "from among them"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;

  // "reveal ... and put them" variant continuation
  if (isRevealThenPut) {
    if (slice[idx] === 'and') idx++;
    if (slice[idx] !== 'put') return null;
    idx++;
    if (slice[idx] !== 'them') return null;
    idx++;
  }

  // "into your hand"
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // Rest tail
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  // Decline cases already fully handled by matchRevealTopTake (base single-type
  // non-snow non-capped any-number "put" wordings) to avoid duplicate parsing.
  const hasOnlyBaseType = !isSnow && !hasMvFilter && !hasMvcCap && !isMultiTypeOr
    && filter.types && Object.keys(filter).length === 1;
  if (hasOnlyBaseType && !isRevealThenPut) return null;

  const effectMaxSelections = maxSelections === 99
    ? (typeof count === 'number' ? count : 999)
    : maxSelections;

  const effect: import('../ast').Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'hand',
    restDestination,
    minSelections: 0,
    maxSelections: effectMaxSelections,
    filter,
    selectedCardChoiceId: 'revealTopTakeExtIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 2 additions: subtype filters, battlefield+tapped rider, multi-type up-to-N
// ============================================================================

/**
 * Match the subtype-filter reveal family:
 *   "Reveal the top N cards of your library. Put all Goblin cards revealed this
 *    way into your hand and the rest on the bottom of your library in any order."
 *   "reveal the top three cards of your library. Put all Island cards revealed
 *    this way into your hand and the rest on the bottom."
 *   "Reveal the top N cards of your library. Put all Kavu cards revealed this
 *    way into your hand and the rest on the bottom of your library."
 *
 * Emits a ChooseFromTopOfLibrary effect with a subtypes filter. The executor
 * auto-takes every revealed card whose type line contains the named subtype
 * (via typeLineHasSubtype), bottoming or graveyarding the rest — an honest
 * model that the existing matchRevealTopTake card-type-only typeMap declines.
 *
 * Accepted sources:
 *  - verb: "reveal" | "look at"
 *  - take quantifier: "all" | "any number of"
 *  - subtype: any lowercase (basic land subtype or creature subtype) word that
 *    is NOT a recognized card-type word (those are already claimed by matchRevealTopTake)
 *  - take clause: "<subtype> cards revealed this way" | "<subtype> cards from among them"
 *  - rest clause: "on the bottom of your library [in any/a random order]" |
 *               "into your graveyard"
 *
 * Returns null for known card-type words (creature, land, instant, …) — those
 * are already handled by matchRevealTopTake / matchRevealTopTakeExtended.
 */
export function matchRevealTopSubtypeFilter(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "reveal the top N cards ..." / "look at the top N cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  const revealN = parseSmallNumberToken(slice[idx]);
  if (isNaN(revealN) || revealN < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  // "[you may] put [all | any number of] <SubtypeWord> card(s) ..."
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;

  // Quantifier: "all" or "any number of"
  if (slice[idx] === 'all') {
    idx++;
  } else if (slice[idx] === 'any' && slice[idx + 1] === 'number' && slice[idx + 2] === 'of') {
    idx += 3;
  } else {
    return null;
  }

  // Subtype word — must NOT be a known card-type word (those are claimed by
  // matchRevealTopTake). We accept creature subtypes and land subtypes here.
  const CARD_TYPE_WORDS = new Set([
    'land', 'lands', 'creature', 'creatures', 'artifact', 'artifacts',
    'enchantment', 'enchantments', 'instant', 'instants', 'sorcery', 'sorceries',
    'planeswalker', 'planeswalkers', 'permanent', 'permanents',
  ]);
  const subtypeToken = slice[idx];
  if (!subtypeToken || CARD_TYPE_WORDS.has(subtypeToken)) return null;
  // Must look like a plausible subtype word (alphabetic, not a function word)
  if (!/^[a-z][a-z']+$/.test(subtypeToken)) return null;
  const STOPWORDS = new Set([
    'the', 'of', 'your', 'a', 'an', 'or', 'and', 'from', 'into', 'onto', 'in',
    'on', 'this', 'way', 'them', 'that', 'put', 'rest', 'bottom', 'top', 'hand',
    'library', 'graveyard', 'revealed', 'order', 'random', 'may', 'you',
    'up', 'to', 'with', 'mana', 'value', 'any', 'all', 'number',
  ]);
  if (STOPWORDS.has(subtypeToken)) return null;
  // Capitalize for the filter value (MTG subtypes are title-case)
  const subtype = singularizeSubtypeWord(subtypeToken);
  const subtypeCapitalized = subtype.charAt(0).toUpperCase() + subtype.slice(1);
  idx++;

  // "card" / "cards"
  if (slice[idx] !== 'card' && slice[idx] !== 'cards') return null;
  idx++;

  // "revealed this way" | "from among them"
  if (slice[idx] === 'revealed' && slice[idx + 1] === 'this' && slice[idx + 2] === 'way') {
    idx += 3;
  } else if (slice[idx] === 'from' && slice[idx + 1] === 'among' && slice[idx + 2] === 'them') {
    idx += 3;
  } else {
    return null;
  }

  // "into your hand"
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "[and] [put] the rest" then rest destination
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: revealN,
    destination: 'hand',
    restDestination,
    minSelections: 0,
    maxSelections: revealN,
    filter: { subtypes: [subtypeCapitalized] },
    selectedCardChoiceId: 'revealTopSubtypeIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match "look at / reveal the top N cards ... you may put a/an <type> [with mana
 * value K or less] card from among them onto the battlefield [tapped].
 * [Put the rest on the bottom [in a random order].]"
 *
 * This covers:
 *   "look at the top six cards of your library. You may put a land card from
 *    among them onto the battlefield tapped. Put the rest on the bottom in a
 *    random order."                                         (Kaslem's Stonetree)
 *   "look at the top five cards of your library. You may put a creature card
 *    with mana value 4 or less from among them onto the battlefield."
 *                                                         (Aang, at the Crossroads)
 *
 * Unlike matchRevealTopOntoBattlefield this matcher:
 *  - handles the "you may put a/an" (one card, no "up to M") prefix
 *  - supports the tapped rider
 *  - accepts an optional rest-placement tail (omitted when no rest sentence follows)
 *    — when absent, unselected cards stay on the bottom (conservative default)
 *
 * Declines instants and sorceries as battlefield destinations (honest).
 * Emits ChooseFromTopOfLibrary with destination='battlefield', maxSelections=1.
 */
export function matchLookAtTopPutOneToBattlefield(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "look at the top N cards ..." / "reveal the top N cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  const revealN = parseSmallNumberToken(slice[idx]);
  if (isNaN(revealN) || revealN < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  // "you may put a/an <type> [with mana value K or less] card from among them
  //  onto the battlefield [tapped]."
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'may' || slice[idx + 2] !== 'put') return null;
  idx += 3;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;

  // Type filter (card types that can enter the battlefield — no instants/sorceries)
  const PERMANENT_TYPES: Record<string, NonNullable<CardFilter['types']>> = {
    land: ['land'], lands: ['land'],
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };
  const typeToken = slice[idx];
  if (!typeToken) return null;
  let filter: CardFilter;
  if (typeToken === 'permanent' || typeToken === 'permanents') {
    filter = { permanent: true };
  } else {
    const types = PERMANENT_TYPES[typeToken];
    if (!types) return null;
    filter = { types };
  }
  idx++;
  if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;

  // Optional "with mana value K or less"
  if (slice[idx] === 'with' && slice[idx + 1] === 'mana' && slice[idx + 2] === 'value') {
    const k = parseInt(slice[idx + 3], 10);
    if (Number.isNaN(k)) return null;
    idx += 4;
    if (slice[idx] === 'or' && slice[idx + 1] === 'less') {
      filter = { ...filter, cmc: { op: 'lte', value: k } };
      idx += 2;
    } else {
      filter = { ...filter, cmc: { op: 'eq', value: k } };
    }
  }

  // "from among them"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;

  // "onto the battlefield [tapped]"
  if (slice[idx] !== 'onto' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'battlefield') return null;
  idx += 3;
  let tapped = false;
  if (slice[idx] === 'tapped') {
    tapped = true;
    idx++;
  }
  if (slice[idx] === '.') idx++;

  // Optional rest tail: "[Put the rest on the bottom [in a random order].]"
  let restDestination: 'bottom' | 'graveyard' = 'bottom'; // default when omitted
  if (slice[idx] === 'put' || (slice[idx] === 'the' && slice[idx + 1] === 'rest')) {
    if (slice[idx] === 'put') idx++;
    if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
    idx += 2;
    if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
      restDestination = 'bottom';
      idx += 3;
      if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
      if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
      else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
    } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
      restDestination = 'graveyard';
      idx += 3;
    } else {
      return null;
    }
    if (slice[idx] === '.') idx++;
  }

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: revealN,
    destination: 'battlefield',
    restDestination,
    minSelections: 0,
    maxSelections: 1,
    filter,
    ...(tapped ? { tapped: true } : {}),
    selectedCardChoiceId: 'lookTopPutOneBfIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the Dark Confidant / Pain Seer upkeep-reveal family body clause:
 *   "reveal the top card of your library and put that card into your hand.
 *    you lose life equal to its mana value."
 *   (also "its converted mana value" for older printings)
 *
 * This matcher handles the BODY of the trigger (after the upkeep prefix is
 * parsed). It emits two effects in sequence:
 * 1. RevealTopMatch with empty filter (matches any card) → hand
 * 2. LoseLife with { kind: 'RevealedTopCardManaValue' }
 *
 * The executor stores the top card's CMC when RevealTopMatch fires, so the
 * sibling LoseLife reads the correct value from ctx.lastRevealedCardManaValue.
 * Falls back to 0 when the library is empty (no card revealed = no life lost).
 */
export function matchDarkConfidantReveal(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 12) return null;
  let idx = 0;

  // "reveal the top card of your library"
  if (slice[idx] !== 'reveal' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'top' || slice[idx + 3] !== 'card') return null;
  idx += 4;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;

  // "and put that card into your hand" / "and put it into your hand"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] === 'that' && slice[idx + 1] === 'card') idx += 2;
  else if (slice[idx] === 'it') idx++;
  else return null;
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "you lose life equal to its [converted] mana value"
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'lose' || slice[idx + 2] !== 'life') return null;
  idx += 3;
  if (slice[idx] !== 'equal' || slice[idx + 1] !== 'to') return null;
  idx += 2;
  if (slice[idx] !== 'its') return null;
  idx++;
  if (slice[idx] === 'converted') idx++;
  if (slice[idx] !== 'mana' || slice[idx + 1] !== 'value') return null;
  idx += 2;
  if (slice[idx] === '.') idx++;

  const revealEffect: import('../ast').Effect = {
    kind: 'RevealTopMatch',
    filter: {},
    matchDestination: 'hand',
  };
  const loseLifeEffect: import('../ast').Effect = {
    kind: 'LoseLife',
    player: { kind: 'Controller' },
    amount: { kind: 'RevealedTopCardManaValue' },
  };

  return { effects: [revealEffect, loseLifeEffect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 2 (oracle round 2): Reveal-until-match library loop
// (Treasure Hunt / Hermit Druid / Clifftop Lookout family)
// ============================================================================

/**
 * Match the "reveal-until-match" library loop family:
 *   "Reveal cards from the top of your library until you reveal a nonland card,
 *    then put all cards revealed this way into your hand."    (Treasure Hunt)
 *   "Reveal cards from the top of your library until you reveal a land card.
 *    Put that card onto the battlefield tapped and the rest on the bottom of
 *    your library in a random order."                         (Clifftop Lookout)
 *   "Reveal cards from the top of your library until you reveal a basic land
 *    card. Put that card into your hand and all other cards revealed this way
 *    into your graveyard."                                    (Hermit Druid)
 *   "Reveal cards from the top of your library until you reveal a creature
 *    card. Put that card into your hand and the rest on the bottom of your
 *    library in a random order."                              (Yuna's Whistle)
 *
 * Emits a RevealUntilMatch effect.
 *
 * Declined shapes:
 * - "until you reveal X <filter> cards" (multi-match count, needs subsystem)
 * - "you may cast it" variants (needs casting subsystem)
 */
export function matchRevealUntilMatch(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // "reveal cards from the top of your library"
  if (slice[idx] !== 'reveal' || slice[idx + 1] !== 'cards' || slice[idx + 2] !== 'from'
    || slice[idx + 3] !== 'the' || slice[idx + 4] !== 'top' || slice[idx + 5] !== 'of'
    || slice[idx + 6] !== 'your' || slice[idx + 7] !== 'library') return null;
  idx += 8;

  // "until you reveal a/an <filter> card"
  if (slice[idx] === ',') idx++;
  if (slice[idx] !== 'until') return null;
  idx++;
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'reveal') return null;
  idx += 2;
  if (slice[idx] === 'a' || slice[idx] === 'an') idx++;

  // Parse the card filter — one or two words before "card".
  // Supported: "nonland", "land", "basic land", "creature", "artifact",
  //            "enchantment", "instant", "sorcery", "planeswalker", etc.
  const CARD_TYPE_MAP: Record<string, import('../ast').CardFilter> = {
    land: { types: ['land'] },
    lands: { types: ['land'] },
    creature: { types: ['creature'] },
    creatures: { types: ['creature'] },
    artifact: { types: ['artifact'] },
    artifacts: { types: ['artifact'] },
    enchantment: { types: ['enchantment'] },
    enchantments: { types: ['enchantment'] },
    instant: { types: ['instant'] },
    instants: { types: ['instant'] },
    sorcery: { types: ['sorcery'] },
    sorceries: { types: ['sorcery'] },
    planeswalker: { types: ['planeswalker'] },
    planeswalkers: { types: ['planeswalker'] },
    nonland: { excludeTypes: ['land'] },
    nonlands: { excludeTypes: ['land'] },
    noncreature: { excludeTypes: ['creature'] },
    noncreatures: { excludeTypes: ['creature'] },
  };

  let filter: import('../ast').CardFilter;

  // "basic land card" — supertype + type
  if (slice[idx] === 'basic' && slice[idx + 1] === 'land') {
    filter = { supertypes: ['Basic'], types: ['land'] };
    idx += 2;
  } else {
    const typeToken = slice[idx];
    const mapped = CARD_TYPE_MAP[typeToken];
    if (!mapped) return null;
    filter = mapped;
    idx++;
  }

  // "card" (required)
  if (slice[idx] !== 'card') return null;
  idx++;

  // Optional comma or period between the reveal clause and the placement clause
  if (slice[idx] === ',') idx++;
  if (slice[idx] === '.') idx++;

  // Parse placement clauses. All known shapes:
  //   A) "then put all cards revealed this way into your hand"
  //      (Treasure Hunt — matched card also goes to hand, rest to hand)
  //   B) "put that card into your hand and [all] [the] [other] [rest] [cards
  //      revealed this way] into your graveyard"
  //      (Hermit Druid — matched to hand, rest to graveyard)
  //   C) "put that card onto the battlefield tapped and the rest on the bottom
  //      of your library [in a random order]"
  //      (Clifftop Lookout — matched to battlefield-tapped, rest to bottom)
  //   D) "put that card into your hand and the rest on the bottom of your
  //      library [in a random order]"
  //      (Yuna's Whistle — matched to hand, rest to bottom)

  if (slice[idx] === 'then') idx++;

  if (slice[idx] !== 'put') return null;
  idx++;

  let matchedDestination: 'hand' | 'battlefield' | 'battlefieldTapped' | 'graveyard';
  let restDestination: 'hand' | 'bottom' | 'graveyard';

  if (slice[idx] === 'all' && slice[idx + 1] === 'cards' && slice[idx + 2] === 'revealed'
    && slice[idx + 3] === 'this' && slice[idx + 4] === 'way') {
    // Shape A: "put all cards revealed this way into your hand"
    idx += 5;
    if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
    idx += 3;
    matchedDestination = 'hand';
    restDestination = 'hand';
  } else if (slice[idx] === 'that' && slice[idx + 1] === 'card') {
    // Shapes B, C, D: "put that card [into your hand | onto the battlefield tapped]"
    idx += 2;

    if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'hand') {
      matchedDestination = 'hand';
      idx += 3;
    } else if (slice[idx] === 'onto' && slice[idx + 1] === 'the' && slice[idx + 2] === 'battlefield') {
      idx += 3;
      if (slice[idx] === 'tapped') {
        matchedDestination = 'battlefieldTapped';
        idx++;
      } else {
        matchedDestination = 'battlefield';
      }
    } else {
      return null;
    }

    // "and [all] [other] [cards revealed this way | the rest]"
    if (slice[idx] === 'and') idx++;

    // Consume optional qualifiers before the placement of the rest
    if (slice[idx] === 'all') idx++;
    if (slice[idx] === 'other') idx++;
    if (slice[idx] === 'cards' && slice[idx + 1] === 'revealed' && slice[idx + 2] === 'this' && slice[idx + 3] === 'way') {
      idx += 4;
    } else if (slice[idx] === 'the' && slice[idx + 1] === 'rest') {
      idx += 2;
    } else {
      return null;
    }

    // Where the rest goes
    if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
      restDestination = 'graveyard';
      idx += 3;
    } else if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
      restDestination = 'bottom';
      idx += 3;
      if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
      if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
      else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'RevealUntilMatch',
    filter,
    matchedDestination,
    restDestination,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 3: Reveal-until-match, other-player and multi-count extensions
// (Mirko Vosk, Bismuth Mindrender, Territorial Bruntar families)
// ============================================================================

// Shared type-filter map reused across both reveal-until-match matchers.
const REVEAL_UNTIL_CARD_TYPE_MAP: Record<string, import('../ast').CardFilter> = {
  land: { types: ['land'] },
  lands: { types: ['land'] },
  creature: { types: ['creature'] },
  creatures: { types: ['creature'] },
  artifact: { types: ['artifact'] },
  artifacts: { types: ['artifact'] },
  enchantment: { types: ['enchantment'] },
  enchantments: { types: ['enchantment'] },
  instant: { types: ['instant'] },
  instants: { types: ['instant'] },
  sorcery: { types: ['sorcery'] },
  sorceries: { types: ['sorcery'] },
  planeswalker: { types: ['planeswalker'] },
  planeswalkers: { types: ['planeswalker'] },
  nonland: { excludeTypes: ['land'] },
  nonlands: { excludeTypes: ['land'] },
  noncreature: { excludeTypes: ['creature'] },
  noncreatures: { excludeTypes: ['creature'] },
};

/**
 * Parse a card-type filter and return the filter plus how many tokens consumed.
 * Handles "basic land", single type tokens (land, creature, nonland, …).
 * Returns null if unrecognised.
 */
function parseRevealUntilFilter(
  slice: string[],
  idx: number,
): { filter: import('../ast').CardFilter; next: number } | null {
  if (slice[idx] === 'basic' && slice[idx + 1] === 'land') {
    return { filter: { supertypes: ['Basic'], types: ['land'] }, next: idx + 2 };
  }
  const mapped = REVEAL_UNTIL_CARD_TYPE_MAP[slice[idx]];
  if (!mapped) return null;
  return { filter: mapped, next: idx + 1 };
}

/**
 * Parse the placement clause for the other-player reveal-until-match shape.
 *
 * Handles inline (same clause) and cross-sentence (". that player puts...") variants:
 *
 * Inline forms (after the "until … card[s]" part):
 *   ", then puts those cards into their graveyard"               (Mirko Vosk multi-count)
 *   "then put those cards into their graveyard"
 *   ", then put all other cards revealed this way into their graveyard"
 *
 * Cross-sentence forms (consumed across the "." boundary):
 *   ". that player puts that card into their hand and the rest into their graveyard."
 *   ". that player puts that card onto the battlefield tapped and the rest on the bottom
 *    of their library in any order."
 *   ". [they put / that player puts] that card into their hand and the rest on the bottom
 *    of their library in a random order."
 *
 * Returns { matchedDestination, restDestination, advance } or null if unrecognised.
 */
function parseOtherPlayerPlacementClause(
  slice: string[],
  idxIn: number,
): {
  matchedDestination: 'hand' | 'battlefield' | 'battlefieldTapped' | 'graveyard';
  restDestination: 'hand' | 'bottom' | 'graveyard';
  advance: number;
} | null {
  let idx = idxIn;

  // Optional "."/","
  if (slice[idx] === '.') idx++;
  if (slice[idx] === ',') idx++;

  // Optional "then"
  if (slice[idx] === 'then') idx++;

  // Determine subject: inline "puts" (implicit that player) or "that player puts" / "they put"
  if (slice[idx] === 'that' && slice[idx + 1] === 'player' && (slice[idx + 2] === 'puts' || slice[idx + 2] === 'put')) {
    idx += 3;
  } else if (slice[idx] === 'they' && (slice[idx + 1] === 'put' || slice[idx + 1] === 'puts')) {
    idx += 2;
  } else if (slice[idx] === 'puts' || slice[idx] === 'put') {
    // inline "then puts" or "then put" (implicit subject = that player)
    idx += 1;
  } else {
    return null;
  }

  let matchedDestination: 'hand' | 'battlefield' | 'battlefieldTapped' | 'graveyard';
  let restDestination: 'hand' | 'bottom' | 'graveyard';

  // Shape A: "all [other] cards revealed this way into their graveyard"
  //   (Mirko Vosk — no separate matched/rest distinction; everything goes to graveyard)
  if (
    (slice[idx] === 'all' || slice[idx] === 'those') &&
    (slice[idx + 1] === 'cards' || (slice[idx + 1] === 'other' && slice[idx + 2] === 'cards'))
  ) {
    // "all cards", "all other cards", "those cards"
    if (slice[idx + 1] === 'other' && slice[idx + 2] === 'cards') {
      idx += 3;
    } else {
      idx += 2;
    }
    // Optional "revealed this way"
    if (slice[idx] === 'revealed' && slice[idx + 1] === 'this' && slice[idx + 2] === 'way') idx += 3;
    // "into their graveyard"
    if (slice[idx] !== 'into') return null;
    if (slice[idx + 1] !== 'their' && slice[idx + 1] !== 'your') return null;
    if (slice[idx + 2] !== 'graveyard') return null;
    idx += 3;
    matchedDestination = 'graveyard';
    restDestination = 'graveyard';
  } else if (slice[idx] === 'that' && slice[idx + 1] === 'card') {
    // Shape B/C/D: "that card into their hand / onto the battlefield"
    idx += 2;

    if (slice[idx] === 'into' && (slice[idx + 1] === 'their' || slice[idx + 1] === 'your') && slice[idx + 2] === 'hand') {
      matchedDestination = 'hand';
      idx += 3;
    } else if (slice[idx] === 'onto' && slice[idx + 1] === 'the' && slice[idx + 2] === 'battlefield') {
      idx += 3;
      if (slice[idx] === 'tapped') {
        matchedDestination = 'battlefieldTapped';
        idx++;
      } else {
        matchedDestination = 'battlefield';
      }
    } else {
      return null;
    }

    // "and the rest into their graveyard / on the bottom of their library"
    if (slice[idx] === 'and') idx++;

    // Consume optional qualifiers
    if (slice[idx] === 'all') idx++;
    if (slice[idx] === 'other') idx++;
    if (slice[idx] === 'cards' && slice[idx + 1] === 'revealed' && slice[idx + 2] === 'this' && slice[idx + 3] === 'way') {
      idx += 4;
    } else if (slice[idx] === 'the' && slice[idx + 1] === 'rest') {
      idx += 2;
    } else {
      return null;
    }

    if (slice[idx] === 'into' && (slice[idx + 1] === 'their' || slice[idx + 1] === 'your') && slice[idx + 2] === 'graveyard') {
      restDestination = 'graveyard';
      idx += 3;
    } else if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
      restDestination = 'bottom';
      idx += 3;
      if (slice[idx] === 'of' && (slice[idx + 1] === 'their' || slice[idx + 1] === 'your') && slice[idx + 2] === 'library') idx += 3;
      if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
      else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  return { matchedDestination, restDestination, advance: idx };
}

/**
 * Slice 3: Match "that player reveals cards from the top of their library until
 * they reveal [N] <filter> card[s]" trigger-tail family.
 *
 * Covers:
 *   "that player reveals cards from the top of their library until they reveal
 *    four land cards, then puts those cards into their graveyard."
 *                                                          (Mirko Vosk, count=4)
 *   "that player reveals cards from the top of their library until they reveal
 *    a nonland card. that player puts that card into their hand and the rest
 *    into their graveyard."                                (Bismuth Mindrender)
 *   "that player reveals cards from the top of their library until they reveal
 *    a land card. that player puts that card onto the battlefield tapped and
 *    the rest on the bottom of their library in any order."
 *                                                          (Territorial Bruntar)
 *
 * Emits a RevealUntilMatch effect with player=EventPlayer (resolved from the
 * triggering combat-damage event) and count>=1.
 *
 * Declined:
 * - "you may cast it" variants (free-cast-from-reveal subsystem)
 * - "target player reveals" (named-card filter, e.g. Tunnel Vision)
 */
export function matchRevealUntilMatchOtherPlayer(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // "that player reveals cards from the top of their library"
  if (slice[idx] !== 'that') return null;
  if (slice[idx + 1] !== 'player') return null;
  if (slice[idx + 2] !== 'reveals') return null;
  if (slice[idx + 3] !== 'cards') return null;
  if (slice[idx + 4] !== 'from') return null;
  if (slice[idx + 5] !== 'the') return null;
  if (slice[idx + 6] !== 'top') return null;
  if (slice[idx + 7] !== 'of') return null;
  if (slice[idx + 8] !== 'their') return null;
  if (slice[idx + 9] !== 'library') return null;
  idx += 10;

  // "until they reveal [N] <filter> card[s]"
  if (slice[idx] === ',') idx++;
  if (slice[idx] !== 'until') return null;
  idx++;
  if (slice[idx] !== 'they') return null;
  idx++;
  if (slice[idx] !== 'reveal') return null;
  idx++;

  // Optional article "a/an" (single-match forms)
  let count = 1;
  if (slice[idx] === 'a' || slice[idx] === 'an') {
    idx++;
  } else {
    // Try a numeric word count ("four", "three", …) or digit
    const wordCount = parseWordNumber(slice[idx]);
    if (!isNaN(wordCount) && wordCount > 0) {
      count = wordCount;
      idx++;
    } else {
      const numCount = parseInt(slice[idx], 10);
      if (!isNaN(numCount) && numCount > 0) {
        count = numCount;
        idx++;
      }
      // else: no article, no count — fall through to filter parse (may still work
      // for some phrasings; fail at filter if token is unrecognised)
    }
  }

  // Parse the card filter
  const filterResult = parseRevealUntilFilter(slice, idx);
  if (!filterResult) return null;
  const { filter, next: filterNext } = filterResult;
  idx = filterNext;

  // "card" (singular) or "cards" (plural for multi-count)
  if (slice[idx] !== 'card' && slice[idx] !== 'cards') return null;
  idx++;

  // Now parse the placement clause — either inline or after a sentence boundary.
  const placement = parseOtherPlayerPlacementClause(slice, idx);
  if (!placement) return null;

  const effect: Effect = {
    kind: 'RevealUntilMatch',
    filter,
    matchedDestination: placement.matchedDestination,
    restDestination: placement.restDestination,
    player: { kind: 'EventPlayer' },
    ...(count > 1 ? { count } : {}),
  };

  return { effects: [effect], targets: [], consumed: placement.advance };
}

// ============================================================================
// Slice 5 additions: "put the revealed cards", "and/or" multi-type reveals,
// ForEach-count "where X is the number of <filter> you control" dig forms.
// ============================================================================

/**
 * Match the "reveal-any-number-put-revealed" family:
 *   "Look at the top N cards of your library. You may reveal any number of
 *    artifact cards from among them and put the revealed cards into your hand.
 *    Put the rest on the bottom of your library in any order."
 *                                                      (Forging the Anchor)
 *   "Look at the top four cards of your library. You may reveal a creature card
 *    and/or a land card from among them and put the revealed cards into your
 *    hand. Put the rest on the bottom of your library."
 *                                                      (Gift of the Gargantuan)
 *
 * This extends matchRevealTopTakeExtended to cover the "put the revealed cards"
 * phrasing (vs "put them") and the "you may reveal a <typeA> card and/or a
 * <typeB> card from among them" variant.
 *
 * Emits ChooseFromTopOfLibrary with destination='hand' and the appropriate
 * filter. For "any number of" → maxSelections=count; for "and/or" pairs →
 * maxSelections=branches.length with maxPerAnyOfBranch=1.
 * The rest goes to 'bottom'.
 */
export function matchRevealTopPutRevealedToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 16) return null;

  // "look at the top N cards ..." / "reveal the top N cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  // Count: fixed number only (X is handled by matchLookAtTopWhereXForEach)
  const revealN = parseSmallNumberToken(slice[idx]);
  if (isNaN(revealN) || revealN < 1) return null;
  const count: AmountRef = revealN;
  idx++;
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  const typeMap: Record<string, NonNullable<CardFilter['types']>> = {
    land: ['land'], lands: ['land'],
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    instant: ['instant'], instants: ['instant'],
    sorcery: ['sorcery'], sorceries: ['sorcery'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };

  // "[you may] reveal [any number of | a/an <type> card [and/or a/an <type> card]] ..."
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'reveal') return null;
  idx++;

  let filter: CardFilter;
  let maxSelections: number;
  let maxPerAnyOfBranch: number | undefined;

  if (slice[idx] === 'any' && slice[idx + 1] === 'number' && slice[idx + 2] === 'of') {
    // "reveal any number of <type> cards from among them and put the revealed cards into your hand"
    idx += 3;
    // Type word
    if (slice[idx] === 'permanent' || slice[idx] === 'permanents') {
      filter = { permanent: true };
      idx++;
    } else {
      const firstTypes = typeMap[slice[idx]];
      if (!firstTypes) return null;
      idx++;
      // Optional "and/or <type>" continuations
      const orBranches: CardFilter[] = [{ types: firstTypes }];
      while ((slice[idx] === 'and/or' || slice[idx] === 'or') && typeMap[slice[idx + 1]]) {
        orBranches.push({ types: typeMap[slice[idx + 1]]! });
        idx += 2;
      }
      if (orBranches.length > 1) {
        filter = { anyOf: orBranches };
      } else {
        filter = { types: firstTypes };
      }
    }
    maxSelections = revealN; // unlimited within the revealed set
    if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;
  } else if (slice[idx] === 'a' || slice[idx] === 'an') {
    // "reveal a <typeA> card and/or a/an <typeB> card from among them and put the revealed cards"
    idx++;
    const firstTypes = typeMap[slice[idx]];
    if (!firstTypes) return null;
    idx++;
    if (slice[idx] !== 'card' && slice[idx] !== 'cards') return null;
    idx++;
    const branches: CardFilter[] = [{ types: firstTypes }];
    while (slice[idx] === 'and/or' && (slice[idx + 1] === 'a' || slice[idx + 1] === 'an')) {
      const moreTypes = typeMap[slice[idx + 2]];
      if (!moreTypes) return null;
      if (slice[idx + 3] !== 'card' && slice[idx + 3] !== 'cards') return null;
      branches.push({ types: moreTypes });
      idx += 4;
    }
    if (branches.length === 1) {
      // Single "a <type> card" then "put the revealed cards" — differs from
      // matchRevealTopTake's "put it into your hand" form, so claim it.
      filter = branches[0];
      maxSelections = 1;
    } else {
      filter = { anyOf: branches };
      maxSelections = branches.length;
      maxPerAnyOfBranch = 1;
    }
  } else {
    return null;
  }

  // "from among them"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;

  // "and put the revealed cards into your hand"
  // OR "and put them into your hand" (for the single-type "you may reveal a <type> card" branch)
  if (slice[idx] === 'and') idx++;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] === 'the' && slice[idx + 1] === 'revealed' && slice[idx + 2] === 'cards') {
    idx += 3;
  } else if (slice[idx] === 'them') {
    idx++;
  } else {
    return null;
  }
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // Rest tail: "[and] [put] the rest on the bottom / into your graveyard"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'hand',
    restDestination,
    minSelections: 0,
    maxSelections,
    filter,
    ...(maxPerAnyOfBranch !== undefined ? { maxPerAnyOfBranch } : {}),
    selectedCardChoiceId: 'revealTopPutRevealedIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the "look at top X where X is the number of <filter> you control" dig
 * family, covering two destination shapes:
 *
 *   INTO HAND (Machinate, Stirring Honormancer):
 *     "Look at the top X cards of your library, where X is the number of
 *      artifacts you control. Put one into your hand and the rest on the
 *      bottom of your library in any order."
 *     "Look at the top X cards of your library, where X is the number of
 *      creatures you control. Put up to two into your hand and the rest on
 *      the bottom of your library in any order."
 *
 *   ONTO BATTLEFIELD (Kayla's Reconstruction):
 *     "Look at the top X cards of your library, where X is the number of
 *      artifacts you control. Put up to X artifact cards with mana value 3
 *      or less from among them onto the battlefield."
 *     (with optional rest tail)
 *
 * The "where X is" clause is parsed via parseWhereXIsNumberOf → ForEachAmount,
 * so resolveAmount correctly counts the cards at resolution time.
 *
 * This matcher only claims the `where X is the number of <filter> you control`
 * form; the Domain `where X is the number of basic land types among lands you
 * control` stays with matchDigTopTakeRest.
 */
export function matchLookAtTopWhereXForEach(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 18) return null;

  // "look at the top X cards ..." or "reveal the top X cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  if (slice[idx] !== 'x') return null;
  idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;

  // ", where X is the number of <filter> you control" (mandatory for this matcher)
  const whereResult = parseWhereXIsNumberOf(slice, idx);
  if (!whereResult) return null;
  const count: AmountRef = whereResult.amount;
  // Decline Domain (handled by matchDigTopTakeRest) to avoid duplication
  if (count.kind === 'ForEach' && (count as ForEachAmount).zone === 'battlefield'
    && (count as ForEachAmount).controller === 'you'
    && (count as ForEachAmount).filter
    && (count as ForEachAmount).filter!.types?.includes('land')
    && (count as ForEachAmount).filter!.supertypes?.includes('basic')) {
    return null;
  }
  idx = whereResult.nextIndex;
  if (slice[idx] === '.') idx++;

  const typeMap: Record<string, NonNullable<CardFilter['types']>> = {
    land: ['land'], lands: ['land'],
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    instant: ['instant'], instants: ['instant'],
    sorcery: ['sorcery'], sorceries: ['sorcery'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };

  // "[you may] put [up to M] [one] of [them | those cards] into your hand"
  // OR "put up to X <filter> card(s) from among them onto the battlefield"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;

  // Check for battlefield destination first ("put up to X <filter> cards from among them onto the battlefield")
  if (slice[idx] === 'up' && slice[idx + 1] === 'to') {
    idx += 2;
    // "X <filter> cards from among them onto the battlefield"
    if (slice[idx] === 'x') {
      idx++;
      // Must have a type filter for honest battlefield placement.
      // Slice 2: also handles multi-type "artifact and/or creature" form (Kayla's Reconstruction).
      let battleFilter: CardFilter | null = null;
      if (slice[idx] === 'permanent' || slice[idx] === 'permanents') {
        battleFilter = { permanent: true };
        idx++;
      } else {
        // Parse first type
        const firstTypes = typeMap[slice[idx]];
        if (firstTypes) {
          idx++;
          // "and/or <type>" repetitions — multi-type anyOf filter (Kayla's Reconstruction)
          if (slice[idx] === 'and/or' && typeMap[slice[idx + 1]]) {
            const branches: CardFilter[] = [{ types: firstTypes }];
            while (slice[idx] === 'and/or' && typeMap[slice[idx + 1]]) {
              branches.push({ types: typeMap[slice[idx + 1]]! });
              idx += 2;
            }
            battleFilter = { anyOf: branches };
          } else {
            battleFilter = { types: firstTypes };
          }
        }
      }
      if (!battleFilter) return null;
      if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;

      // Optional mana-value constraint (applies to all branches of anyOf)
      if (slice[idx] === 'with' && slice[idx + 1] === 'mana' && slice[idx + 2] === 'value') {
        const k = parseInt(slice[idx + 3], 10);
        if (!Number.isNaN(k)) {
          idx += 4;
          const cmcFilter: CardFilter['cmc'] = (slice[idx] === 'or' && slice[idx + 1] === 'less')
            ? { op: 'lte', value: k }
            : { op: 'eq', value: k };
          if (slice[idx] === 'or' && slice[idx + 1] === 'less') idx += 2;
          battleFilter = { ...battleFilter, cmc: cmcFilter };
        }
      }

      // "from among them onto the battlefield"
      if (slice[idx] === 'from' && slice[idx + 1] === 'among' && slice[idx + 2] === 'them') {
        idx += 3;
      }
      if (slice[idx] !== 'onto' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'battlefield') return null;
      idx += 3;
      if (slice[idx] === '.') idx++;

      // Optional rest tail
      let restDestination: 'bottom' | 'graveyard' = 'bottom';
      if (slice[idx] === 'put' || (slice[idx] === 'and' && slice[idx + 1] === 'put') || slice[idx] === 'the') {
        if (slice[idx] === 'and') idx++;
        if (slice[idx] === 'put') idx++;
        if (slice[idx] === 'the' && slice[idx + 1] === 'rest') {
          idx += 2;
          if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
            restDestination = 'bottom';
            idx += 3;
            if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
            if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
            else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
          } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
            restDestination = 'graveyard';
            idx += 3;
          }
          if (slice[idx] === '.') idx++;
        }
      }

      const battleEffect: Effect = {
        kind: 'ChooseFromTopOfLibrary',
        player: { kind: 'Controller' },
        count,
        destination: 'battlefield',
        restDestination,
        minSelections: 0,
        maxSelections: 999, // up to X where X = count (resolved at runtime)
        filter: battleFilter,
        selectedCardChoiceId: 'lookTopWhereXBfIds',
      };
      return { effects: [battleEffect], targets: [], consumed: idx };
    } else {
      // "put up to M of them into your hand" (fixed M)
      const takeM = parseSmallNumberToken(slice[idx]);
      if (isNaN(takeM) || takeM < 1) return null;
      idx++;
      if (slice[idx] !== 'of') return null;
      idx++;
      if (slice[idx] === 'them') {
        idx++;
      } else if (slice[idx] === 'those' && (slice[idx + 1] === 'cards' || slice[idx + 1] === 'card')) {
        idx += 2;
      } else {
        return null;
      }
      if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
      idx += 3;
      if (slice[idx] === '.') idx++;

      // Rest tail
      if (slice[idx] === 'and') idx++;
      if (slice[idx] === 'put') idx++;
      if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
      idx += 2;
      let restDestination: 'bottom' | 'graveyard' = 'bottom';
      if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
        restDestination = 'bottom';
        idx += 3;
        if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
        if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
        else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
      } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
        restDestination = 'graveyard';
        idx += 3;
      } else {
        return null;
      }
      if (slice[idx] === '.') idx++;

      const handEffect: Effect = {
        kind: 'ChooseFromTopOfLibrary',
        player: { kind: 'Controller' },
        count,
        destination: 'hand',
        restDestination,
        minSelections: 0,
        maxSelections: takeM,
        fallbackSelectionCount: takeM,
        selectedCardChoiceId: 'lookTopWhereXHandIds',
      };
      return { effects: [handEffect], targets: [], consumed: idx };
    }
  }

  // "put one of them into your hand" / "put one into your hand"
  if (slice[idx] === 'one') {
    idx++;
    // "of them" or "of those cards" (optional)
    if (slice[idx] === 'of') {
      idx++;
      if (slice[idx] === 'them') idx++;
      else if (slice[idx] === 'those' && (slice[idx + 1] === 'cards' || slice[idx + 1] === 'card')) idx += 2;
    }
    // "into your hand"
    if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
    idx += 3;
    if (slice[idx] === '.') idx++;

    // Rest tail
    if (slice[idx] === 'and') idx++;
    if (slice[idx] === 'put') idx++;
    if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
    idx += 2;
    let restDestination: 'bottom' | 'graveyard' = 'bottom';
    if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
      restDestination = 'bottom';
      idx += 3;
      if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
      if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
      else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
    } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
      restDestination = 'graveyard';
      idx += 3;
    } else {
      return null;
    }
    if (slice[idx] === '.') idx++;

    const oneEffect: Effect = {
      kind: 'ChooseFromTopOfLibrary',
      player: { kind: 'Controller' },
      count,
      destination: 'hand',
      restDestination,
      minSelections: 0,
      maxSelections: 1,
      fallbackSelectionCount: 1,
      selectedCardChoiceId: 'lookTopWhereXOneIds',
    };
    return { effects: [oneEffect], targets: [], consumed: idx };
  }

  return null;
}

// ============================================================================
// Slice 4: Target-player/opponent library digs and peeks
// ============================================================================

/**
 * Match the pure-look family (Orcish Spy / Merfolk Observer / Dewdrop Spy /
 * Saheeli's Silverwing):
 *   "{T}: Look at the top three cards of target player's library."
 *   "Look at the top card of target opponent's library."
 *   "Look at the top three cards of target opponent's library."
 *
 * Emits a LookAtTopOfLibrary effect — information-only, no state change.
 * The target player spec uses makeTargetSpec('Player', ...) so the executor
 * resolves the chosen player at cast-time.
 */
export function matchLookAtTopOfTargetLibrary(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 8) return null;

  // "look at the top"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at' || slice[idx + 2] !== 'the' || slice[idx + 3] !== 'top') return null;
  idx += 4;

  // Count: N cards / "card" (singular = 1)
  let count: import('../ast').AmountRef;
  if (slice[idx] === 'card') {
    // singular: "the top card of …"
    count = 1;
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
    if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
    idx++;
  }

  // "of target player's / target opponent's library"
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'target') return null;
  idx += 2;
  if (slice[idx] !== "player's" && slice[idx] !== "opponent's") return null;
  const isOpponent = slice[idx] === "opponent's";
  idx++;
  if (slice[idx] !== 'library') return null;
  idx++;
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player', isOpponent ? { opponentControls: true } : undefined);
  const effect: import('../ast').Effect = {
    kind: 'LookAtTopOfLibrary',
    player: makeChosenRef(spec),
    count,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match the look-then-may-mill family (Draugr Thought-Thief / Eye Spy / Wu Spy /
 * Lurking Informant):
 *   "Look at the top card of target opponent's library. You may put that card
 *    into their graveyard."
 *   "Look at the top two cards of target opponent's library. You may put one of
 *    them into their graveyard."
 *   "Look at the top card of target player's library. You may put that card into
 *    that player's graveyard."
 *
 * Emits two effects:
 *   1. LookAtTopOfLibrary (information reveal)
 *   2. ChooseFromTopOfLibrary with destination='graveyard', restDestination='top',
 *      minSelections=0, maxSelections=1 — the "may" is the optional take.
 *
 * The "may" is represented by minSelections=0 (no forced mill). The executor
 * honestly moves 0 or 1 card to the graveyard with the rest returned to top.
 */
export function matchLookAtTopTargetMayMill(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 12) return null;

  // "look at the top"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at' || slice[idx + 2] !== 'the' || slice[idx + 3] !== 'top') return null;
  idx += 4;

  // Count: "card" (1) or N cards
  let count: import('../ast').AmountRef;
  if (slice[idx] === 'card') {
    count = 1;
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
    if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
    idx++;
  }

  // "of target player's / target opponent's library"
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'target') return null;
  idx += 2;
  if (slice[idx] !== "player's" && slice[idx] !== "opponent's") return null;
  const isOpponent = slice[idx] === "opponent's";
  idx++;
  if (slice[idx] !== 'library') return null;
  idx++;
  if (slice[idx] === '.') idx++;

  // "you may put [that card | one of them] into [their | that player's] graveyard"
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'may' || slice[idx + 2] !== 'put') return null;
  idx += 3;

  // Accept "that card", "one of them", "it"
  if (slice[idx] === 'that' && slice[idx + 1] === 'card') {
    idx += 2;
  } else if (slice[idx] === 'one' && slice[idx + 1] === 'of' && slice[idx + 2] === 'them') {
    idx += 3;
  } else if (slice[idx] === 'it') {
    idx++;
  } else {
    return null;
  }

  // "into their graveyard" / "into that player's graveyard"
  if (slice[idx] !== 'into') return null;
  idx++;
  if (slice[idx] === 'their') {
    idx++;
  } else if (slice[idx] === 'that' && slice[idx + 1] === "player's") {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'graveyard') return null;
  idx++;
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player', isOpponent ? { opponentControls: true } : undefined);
  const playerRef = makeChosenRef(spec);

  const lookEffect: import('../ast').Effect = {
    kind: 'LookAtTopOfLibrary',
    player: playerRef,
    count,
  };
  const millEffect: import('../ast').Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: playerRef,
    count,
    destination: 'graveyard',
    restDestination: 'top',
    minSelections: 0,
    maxSelections: 1,
    fallbackSelectionCount: 0,
    selectedCardChoiceId: 'lookTopTargetMayMillIds',
  };

  return { effects: [lookEffect, millEffect], targets: [spec], consumed: idx };
}

/**
 * Match the exile-one-rest-back family (Sealed Fate / Cruel Fate / Ransack):
 *   "Look at the top X cards of target opponent's library. Exile one of those
 *    cards face down and put the rest back on top of that library in any order."
 *   "Look at the top five cards of target opponent's library. Put one of those
 *    cards into their graveyard and the rest on top of that library in any order."
 *   "Look at the top four cards of target opponent's library. Put one of those
 *    cards into their graveyard and the rest back on top of that library in any
 *    order."
 *
 * Emits ChooseFromTopOfLibrary with:
 *   - player: Chosen (target opponent)
 *   - count: N (or X for Sealed Fate)
 *   - destination: 'exile' (Sealed Fate) or 'graveyard' (Cruel Fate, Ransack)
 *   - restDestination: 'top'
 *   - minSelections: 1, maxSelections: 1 (forced: exile/bin one)
 *   - fallbackSelectionCount: 1
 *
 * The executor already handles any player ref for ChooseFromTopOfLibrary.
 */
export function matchLookAtTopTargetExileOneRestBack(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "look at the top"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at' || slice[idx + 2] !== 'the' || slice[idx + 3] !== 'top') return null;
  idx += 4;

  // Count: X or N cards
  let count: import('../ast').AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;

  // "of target opponent's library"
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'target') return null;
  idx += 2;
  if (slice[idx] !== "opponent's" && slice[idx] !== "player's") return null;
  const isOpponent = slice[idx] === "opponent's";
  idx++;
  if (slice[idx] !== 'library') return null;
  idx++;
  if (slice[idx] === '.') idx++;

  // Now: "exile one of those cards ..." OR "put one of those cards into their graveyard ..."
  let destination: 'exile' | 'graveyard';

  if (slice[idx] === 'exile') {
    destination = 'exile';
    idx++;
    // "one of those cards [face down]"
    if (slice[idx] !== 'one' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'those') return null;
    idx += 3;
    if (slice[idx] === 'cards' || slice[idx] === 'card') idx++;
    // optional "face down"
    if (slice[idx] === 'face' && slice[idx + 1] === 'down') idx += 2;
  } else if (slice[idx] === 'put') {
    destination = 'graveyard';
    idx++;
    // "one of those cards"
    if (slice[idx] !== 'one' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'those') return null;
    idx += 3;
    if (slice[idx] === 'cards' || slice[idx] === 'card') idx++;
    // "into their graveyard" / "into that player's graveyard"
    if (slice[idx] !== 'into') return null;
    idx++;
    if (slice[idx] === 'their') {
      idx++;
    } else if (slice[idx] === 'that' && slice[idx + 1] === "player's") {
      idx += 2;
    } else {
      return null;
    }
    if (slice[idx] !== 'graveyard') return null;
    idx++;
  } else {
    return null;
  }

  // "[and] [put] the rest [back] on top of that library [in any order]"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  if (slice[idx] === 'back') idx++;
  if (slice[idx] !== 'on' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  // "of that library" / "of your library" / just continue
  if (slice[idx] === 'of' && (slice[idx + 1] === 'that' || slice[idx + 1] === 'your') && slice[idx + 2] === 'library') {
    idx += 3;
  } else if (slice[idx] === 'of' && slice[idx + 1] === 'the' && slice[idx + 2] === 'library') {
    idx += 3;
  }
  if (slice[idx] === 'in' && (slice[idx + 1] === 'any' || slice[idx + 1] === 'a') && slice[idx + 2] === 'order') idx += 3;
  else if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player', isOpponent ? { opponentControls: true } : undefined);
  const effect: import('../ast').Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: makeChosenRef(spec),
    count,
    destination,
    restDestination: 'top',
    minSelections: 1,
    maxSelections: 1,
    fallbackSelectionCount: 1,
    selectedCardChoiceId: 'lookTopTargetExileOneIds',
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

// ============================================================================
// Round-8 carryover: Old Stickfingers / "all revealed go to graveyard"
// RevealUntilMatch variant where the matched card AND all other revealed cards
// both go to the graveyard. Two phrasings:
//   A) "That card and all noncreature cards revealed this way go to your graveyard."
//      (Old Stickfingers exact oracle)
//   B) "Put that card and all [noncreature/other] cards revealed this way into your
//      graveyard." (older variant phrasing)
// ============================================================================

/**
 * Match the "reveal-until, all revealed to graveyard" family (Old Stickfingers):
 *   "Reveal cards from the top of your library until you reveal a creature card.
 *    That card and all noncreature cards revealed this way go to your graveyard."
 *
 *   "Reveal cards from the top of your library until you reveal a creature card.
 *    Put that card and all noncreature cards revealed this way into your graveyard."
 *
 *   "Reveal cards from the top of your library until you reveal a land card.
 *    That card and all other cards revealed this way go to your graveyard."
 *
 * Both the matched card and all non-matched cards go to the graveyard.
 * Emits RevealUntilMatch with matchedDestination='graveyard', restDestination='graveyard'.
 *
 * Honest: RevealUntilMatch executor already handles graveyard for both matched
 * and rest destinations (case 'RevealUntilMatch' in executor.ts, restZone branch +
 * matchedZoneName branch both accept 'graveyard').
 */
export function matchRevealUntilAllToGraveyard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // "reveal cards from the top of your library"
  if (slice[idx] !== 'reveal' || slice[idx + 1] !== 'cards' || slice[idx + 2] !== 'from'
    || slice[idx + 3] !== 'the' || slice[idx + 4] !== 'top' || slice[idx + 5] !== 'of'
    || slice[idx + 6] !== 'your' || slice[idx + 7] !== 'library') return null;
  idx += 8;

  // "until you reveal a/an <filter> card"
  if (slice[idx] === ',') idx++;
  if (slice[idx] !== 'until') return null;
  idx++;
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'reveal') return null;
  idx += 2;
  if (slice[idx] === 'a' || slice[idx] === 'an') idx++;

  // Parse the card filter — same map as matchRevealUntilMatch
  const CARD_TYPE_MAP: Record<string, import('../ast').CardFilter> = {
    land: { types: ['land'] },
    creature: { types: ['creature'] },
    artifact: { types: ['artifact'] },
    enchantment: { types: ['enchantment'] },
    instant: { types: ['instant'] },
    sorcery: { types: ['sorcery'] },
    planeswalker: { types: ['planeswalker'] },
    nonland: { excludeTypes: ['land'] },
    noncreature: { excludeTypes: ['creature'] },
  };

  let filter: import('../ast').CardFilter;

  // "basic land card" — supertype + type
  if (slice[idx] === 'basic' && slice[idx + 1] === 'land') {
    filter = { supertypes: ['Basic'], types: ['land'] };
    idx += 2;
  } else {
    const typeToken = slice[idx];
    const mapped = CARD_TYPE_MAP[typeToken];
    if (!mapped) return null;
    filter = mapped;
    idx++;
  }

  // "card" (required)
  if (slice[idx] !== 'card') return null;
  idx++;

  // Period or comma between reveal clause and placement clause
  if (slice[idx] === ',') idx++;
  if (slice[idx] === '.') idx++;

  // Two placement shapes:
  //   A) "That card and all [noncreature/other] cards revealed this way go to your graveyard."
  //   B) "Put that card and all [noncreature/other] cards revealed this way into your graveyard."

  let usedPut = false;
  if (slice[idx] === 'put') {
    usedPut = true;
    idx++;
  }

  // "that card" (required)
  if (slice[idx] !== 'that' || slice[idx + 1] !== 'card') return null;
  idx += 2;

  // "and all [noncreature/other] cards revealed this way"
  if (slice[idx] !== 'and') return null;
  idx++;
  if (slice[idx] !== 'all') return null;
  idx++;
  // Skip optional qualifier word (noncreature, other, nonland, etc.) before "cards"
  if (slice[idx] !== 'cards') {
    // Accept any single alphabetic qualifier word before "cards"
    if (!slice[idx] || !/^[a-z]/.test(slice[idx])) return null;
    idx++; // consume qualifier (noncreature, other, etc.)
  }
  if (slice[idx] !== 'cards') return null;
  idx++;
  if (slice[idx] !== 'revealed' || slice[idx + 1] !== 'this' || slice[idx + 2] !== 'way') return null;
  idx += 3;

  // Shape A: "go to your graveyard" (no leading "put")
  // Shape B: "into your graveyard" (after "put")
  if (!usedPut && slice[idx] === 'go' && slice[idx + 1] === 'to'
    && slice[idx + 2] === 'your' && slice[idx + 3] === 'graveyard') {
    idx += 4;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'RevealUntilMatch',
    filter,
    matchedDestination: 'graveyard',
    restDestination: 'graveyard',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice (trigger-wrapped dig leftovers): exile-from-among-them and
// graveyard/bottom destinations for dig families.
// ============================================================================

/**
 * Match the "exile one from among them" family:
 *   "Look at the top N cards of your library. [You may] exile a [filter] card
 *    from among them. Put the rest on the bottom of your library [in a random/
 *    any order]." (Feral Encounter, Durnan of the Yawning Portal, Djeru and
 *    Hazoret, Make Your Own Luck, …)
 *   Also "you may exile [an/a] [filter] card from among them. put the rest into
 *    your graveyard." variant.
 *
 * Emits ChooseFromTopOfLibrary with destination='exile', restDestination='bottom'
 * or 'graveyard', minSelections=0, maxSelections=1. The executor exile-moves the
 * chosen card (via moveLibraryChoiceCard → commander replacement rule) and puts
 * the rest on the bottom/graveyard — honest execution; no free-cast path needed.
 *
 * EXCLUDED: "you may cast that card/it without paying its mana cost" — those
 * require a free-cast executor path that doesn't exist yet.
 */
export function matchLookAtTopExileOneFromAmong(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "look at the top N cards of your library" / "reveal the top N cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  let count: import('../ast').AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "[you may] exile a/an [filter] card from among them"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'exile') return null;
  idx++;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;

  // Optional filter words before "card"
  const TYPE_MAP: Record<string, NonNullable<CardFilter['types']>> = {
    land: ['land'], creature: ['creature'], artifact: ['artifact'],
    enchantment: ['enchantment'], instant: ['instant'], sorcery: ['sorcery'],
    planeswalker: ['planeswalker'],
  };
  const CARD_TYPE_WORDS = new Set([
    'land', 'creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker',
  ]);

  let filter: CardFilter = {};

  // Parse optional filter: may be 0-2 words before "card"/"cards"/"from"
  // Supports: creature, land, "creature card", "nonland card", "Warrior or
  // Wizard creature card", "creature with mana value 3 or less", etc.

  // Optional "non-" prefix exclusion types (nonland, noncreature, etc.)
  if (slice[idx] && slice[idx].startsWith('non') && CARD_TYPE_WORDS.has(slice[idx].slice(3))) {
    const excludedType = slice[idx].slice(3);
    filter = { excludeTypes: [excludedType] };
    idx++;
  } else {
    // Optional first type word (creature, land, etc.) - can handle "Warrior or Wizard creature"
    // by collecting anyOf branches if we see "or"
    const firstTypeWord = slice[idx];
    const firstTypes = firstTypeWord ? TYPE_MAP[firstTypeWord] : undefined;

    if (firstTypes) {
      const branches: CardFilter[] = [{ types: firstTypes }];
      idx++;

      // "or <type>" continuations before the optional leading type word
      while (slice[idx] === 'or' && TYPE_MAP[slice[idx + 1]]) {
        branches.push({ types: TYPE_MAP[slice[idx + 1]]! });
        idx += 2;
      }

      if (branches.length > 1) {
        filter = { anyOf: branches };
      } else {
        filter = { types: firstTypes };
      }

      // Second type word: "creature card" (already consumed creature → this would be "card")
      // But could be e.g. "Warrior creature" where Warrior is a subtype — skip for now,
      // only card types are handled here for honesty.
    } else if (firstTypeWord && firstTypeWord !== 'card' && firstTypeWord !== 'cards'
      && firstTypeWord !== 'from' && /^[a-z][a-z']+$/.test(firstTypeWord)
      && !['the', 'of', 'your', 'a', 'an', 'or', 'and', 'from', 'into', 'onto', 'in',
        'on', 'this', 'way', 'them', 'that', 'put', 'rest', 'bottom', 'top', 'hand',
        'library', 'graveyard', 'revealed', 'order', 'random', 'may', 'you', 'up',
        'to', 'with', 'mana', 'value', 'any', 'all', 'number'].includes(firstTypeWord)) {
      // Subtype guess (Warrior, Wizard, Goblin, etc.)
      const subtype = singularizeSubtypeWord(firstTypeWord);
      const subtypeCap = subtype.charAt(0).toUpperCase() + subtype.slice(1);

      // "or <subtype>" continuations
      const subtypeBranches: string[] = [subtypeCap];
      idx++;
      while (slice[idx] === 'or' && slice[idx + 1] && /^[a-z][a-z']+$/.test(slice[idx + 1])
        && !TYPE_MAP[slice[idx + 1]] && slice[idx + 1] !== 'card') {
        const moreSub = singularizeSubtypeWord(slice[idx + 1]);
        subtypeBranches.push(moreSub.charAt(0).toUpperCase() + moreSub.slice(1));
        idx += 2;
      }

      // After subtype(s), there may be a type word: "Warrior creature card"
      if (slice[idx] && TYPE_MAP[slice[idx]]) {
        const trailingTypes = TYPE_MAP[slice[idx]]!;
        filter = subtypeBranches.length > 1
          ? { anyOf: subtypeBranches.map(s => ({ subtypes: [s] })), types: trailingTypes }
          : { subtypes: [subtypeCap], types: trailingTypes };
        idx++;
      } else {
        filter = subtypeBranches.length > 1
          ? { anyOf: subtypeBranches.map(s => ({ subtypes: [s] })) }
          : { subtypes: [subtypeCap] };
      }
    }
  }

  // "card" or "cards" — consume before mana-value check so "creature card with
  // mana value N or less from among them" is parsed in the right order.
  if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;

  // Optional mana-value filter: "with mana value N or less"
  if (slice[idx] === 'with' && slice[idx + 1] === 'mana' && slice[idx + 2] === 'value') {
    const k = parseInt(slice[idx + 3], 10);
    if (!Number.isNaN(k)) {
      idx += 4;
      if (slice[idx] === 'or' && slice[idx + 1] === 'less') {
        filter = { ...filter, cmc: { op: 'lte', value: k } };
        idx += 2;
      } else {
        filter = { ...filter, cmc: { op: 'eq', value: k } };
      }
    }
  }

  // "from among them"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;

  // EXCLUDE: "you may cast that card/it without paying its mana cost" (no executor path)
  if (slice[idx] === 'you' && slice[idx + 1] === 'may' && slice[idx + 2] === 'cast') return null;
  if (slice[idx] === '.' && slice[idx + 1] === 'you' && slice[idx + 2] === 'may' && slice[idx + 3] === 'cast') return null;

  if (slice[idx] === '.') idx++;

  // "put the rest on the bottom [of your library] [in a random/any order]"
  //  or "put the rest into your graveyard"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;

  let restDestination: 'bottom' | 'graveyard';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'exile',
    restDestination,
    minSelections: 0,
    maxSelections: 1,
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    selectedCardChoiceId: 'lookTopExileOneFromAmongIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 3/12: "Look at top N; you may exile a [filter] card; put the rest into your hand."
 *
 * Covers the high-frequency combo where the exile-from-top variant disposes of
 * the remaining (non-exiled) cards into the controller's HAND rather than onto
 * the bottom or into the graveyard — e.g.:
 *   "Look at the top three cards of your library. You may exile a nonland card
 *    from among them. Put the rest into your hand."   (Make Your Own Luck, etc.)
 *
 * The existing matchLookAtTopExileOneFromAmong handles restDestination 'bottom'
 * and 'graveyard'. This matcher handles the missing 'hand' rest-destination.
 * Both forms (rest-to-hand and rest-to-bottom) are covered here so a single
 * function can handle all "exile one, rest to X" variants with X in
 * {hand, bottom, graveyard}.
 *
 * Note: the "If you do, it becomes plotted" or similar rider clauses are out of
 * scope (honesty bar) and cause this matcher to return null.
 *
 * Emits a ChooseFromTopOfLibrary effect:
 *   destination='exile', restDestination='hand'|'bottom'|'graveyard',
 *   minSelections=0, maxSelections=1, with an optional CardFilter.
 */
export function matchLookAtTopExileFilterRestToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "look at the top N cards of your library" / "reveal the top N cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  let count: import('../ast').AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "[you may] exile a/an [filter] card from among them"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'exile') return null;
  idx++;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;

  // Optional filter words before "card" — same logic as matchLookAtTopExileOneFromAmong
  const TYPE_MAP: Record<string, NonNullable<CardFilter['types']>> = {
    land: ['land'], creature: ['creature'], artifact: ['artifact'],
    enchantment: ['enchantment'], instant: ['instant'], sorcery: ['sorcery'],
    planeswalker: ['planeswalker'],
  };
  const CARD_TYPE_WORDS = new Set([
    'land', 'creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker',
  ]);

  let filter: CardFilter = {};

  // Optional "non-" prefix exclusion types (nonland, noncreature, etc.)
  if (slice[idx] && slice[idx].startsWith('non') && CARD_TYPE_WORDS.has(slice[idx].slice(3))) {
    const excludedType = slice[idx].slice(3);
    filter = { excludeTypes: [excludedType] };
    idx++;
  } else {
    const firstTypeWord = slice[idx];
    const firstTypes = firstTypeWord ? TYPE_MAP[firstTypeWord] : undefined;
    if (firstTypes) {
      const branches: CardFilter[] = [{ types: firstTypes }];
      idx++;
      while (slice[idx] === 'or' && TYPE_MAP[slice[idx + 1]]) {
        branches.push({ types: TYPE_MAP[slice[idx + 1]]! });
        idx += 2;
      }
      if (branches.length > 1) {
        filter = { anyOf: branches };
      } else {
        filter = { types: firstTypes };
      }
    } else if (firstTypeWord && firstTypeWord !== 'card' && firstTypeWord !== 'cards'
      && firstTypeWord !== 'from' && /^[a-z][a-z']+$/.test(firstTypeWord)
      && !['the', 'of', 'your', 'a', 'an', 'or', 'and', 'from', 'into', 'onto', 'in',
        'on', 'this', 'way', 'them', 'that', 'put', 'rest', 'bottom', 'top', 'hand',
        'library', 'graveyard', 'revealed', 'order', 'random', 'may', 'you', 'up',
        'to', 'with', 'mana', 'value', 'any', 'all', 'number'].includes(firstTypeWord)) {
      const subtype = singularizeSubtypeWord(firstTypeWord);
      const subtypeCap = subtype.charAt(0).toUpperCase() + subtype.slice(1);
      const subtypeBranches: string[] = [subtypeCap];
      idx++;
      while (slice[idx] === 'or' && slice[idx + 1] && /^[a-z][a-z']+$/.test(slice[idx + 1])
        && !TYPE_MAP[slice[idx + 1]] && slice[idx + 1] !== 'card') {
        const moreSub = singularizeSubtypeWord(slice[idx + 1]);
        subtypeBranches.push(moreSub.charAt(0).toUpperCase() + moreSub.slice(1));
        idx += 2;
      }
      if (slice[idx] && TYPE_MAP[slice[idx]]) {
        const trailingTypes = TYPE_MAP[slice[idx]]!;
        filter = subtypeBranches.length > 1
          ? { anyOf: subtypeBranches.map(s => ({ subtypes: [s] })), types: trailingTypes }
          : { subtypes: [subtypeCap], types: trailingTypes };
        idx++;
      } else {
        filter = subtypeBranches.length > 1
          ? { anyOf: subtypeBranches.map(s => ({ subtypes: [s] })) }
          : { subtypes: [subtypeCap] };
      }
    }
  }

  if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;

  // Optional mana-value filter: "with mana value N or less"
  if (slice[idx] === 'with' && slice[idx + 1] === 'mana' && slice[idx + 2] === 'value') {
    const k = parseInt(slice[idx + 3], 10);
    if (!Number.isNaN(k)) {
      idx += 4;
      if (slice[idx] === 'or' && slice[idx + 1] === 'less') {
        filter = { ...filter, cmc: { op: 'lte', value: k } };
        idx += 2;
      } else {
        filter = { ...filter, cmc: { op: 'eq', value: k } };
      }
    }
  }

  // "from among them"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;

  // EXCLUDE: "you may cast that card/it without paying its mana cost" (no executor path)
  if (slice[idx] === 'you' && slice[idx + 1] === 'may' && slice[idx + 2] === 'cast') return null;
  if (slice[idx] === '.' && slice[idx + 1] === 'you' && slice[idx + 2] === 'may' && slice[idx + 3] === 'cast') return null;

  // EXCLUDE: rider clauses like "if you do, it becomes plotted" (out of scope)
  if (slice[idx] === '.' && slice[idx + 1] === 'if' && slice[idx + 2] === 'you' && slice[idx + 3] === 'do') return null;
  if (slice[idx] === 'if' && slice[idx + 1] === 'you' && slice[idx + 2] === 'do') return null;

  if (slice[idx] === '.') idx++;

  // "put the rest into your hand" OR "put the rest on the bottom [of your library] [in any/random order]"
  // OR "put the rest into your graveyard"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;

  let restDestination: 'hand' | 'bottom' | 'graveyard';
  if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'hand') {
    restDestination = 'hand';
    idx += 3;
  } else if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  // Only claim rest-to-hand here (the 'bottom' and 'graveyard' variants are
  // already owned by matchLookAtTopExileOneFromAmong; if that matcher fires
  // first, this one never sees them — but defend against ordering changes by
  // limiting this function to the 'hand' case only).
  if (restDestination !== 'hand') return null;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'exile',
    restDestination: 'hand',
    minSelections: 0,
    maxSelections: 1,
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    selectedCardChoiceId: 'lookTopExileFilterRestToHandIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the "look at top N, you may put it into your graveyard" family:
 *   "Look at the top N cards of your library. You may put [one of] them into
 *    your graveyard. Put the rest on top of your library in any order."
 *   (Keldon Flamesage-adjacent wordings where the destination is 'graveyard'
 *    but the verb structure is "put it/them" rather than "exile a card".)
 *
 *   Also covers:
 *   "Look at the top card of your library. You may put it into your graveyard."
 *    (single-card look, no filter, optional rest-on-top tail.)
 *
 * This differs from matchLookAtTopPutNToGraveyard (which requires an explicit
 * count M, "put M of them"), handling the pronoun "it/them" forms.
 *
 * Emits ChooseFromTopOfLibrary with destination='graveyard', restDestination='top'.
 * minSelections=0 (the "may" makes it optional), maxSelections=1.
 *
 * EXCLUDED: "you may cast that card without paying its mana cost" tail.
 * EXCLUDED: wordings already handled by matchLookAtTopPutNToGraveyard (explicit
 * "put M of them") to avoid ambiguity.
 */
export function matchLookAtTopPutItToGraveyard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 10) return null;

  // "look at the top" / "reveal the top"
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  // Count: card/cards (singular) or N
  let count: import('../ast').AmountRef;
  if (slice[idx] === 'card') {
    // "the top card of your library" → count=1
    count = 1;
    idx++;
  } else if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
    if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
    if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
    idx++;
  }
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "you may put it/them into your graveyard"
  // Require the "you may" modal to distinguish from mandatory discard/mill effects.
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'may' || slice[idx + 2] !== 'put') return null;
  idx += 3;

  // "it" or "them" — NOT "N of them" (that's matchLookAtTopPutNToGraveyard)
  if (slice[idx] === 'it') {
    idx++;
  } else if (slice[idx] === 'them') {
    idx++;
  } else if (slice[idx] === 'one' && slice[idx + 1] === 'of' && (slice[idx + 2] === 'them' || slice[idx + 2] === 'those')) {
    // "one of them" is fine (single card to graveyard)
    idx += 3;
    if (slice[idx] === 'cards' || slice[idx] === 'card') idx++;
  } else {
    return null;
  }

  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'graveyard') return null;
  idx += 3;

  // EXCLUDE "you may cast it without paying" (should never appear here, but guard)
  if (slice[idx] === 'you' && slice[idx + 1] === 'may' && slice[idx + 2] === 'cast') return null;

  if (slice[idx] === '.') idx++;

  // Optional rest tail: "put the rest on top [of your library] [in any order]"
  // or "put the rest on the bottom [of your library] [in any/a random order]"
  let restDestination: 'top' | 'bottom' = 'top'; // default when omitted
  if ((slice[idx] === 'put' || slice[idx] === 'the') && slice.indexOf('rest', idx) >= 0) {
    if (slice[idx] === 'put') idx++;
    if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
    idx += 2;
    if (slice[idx] === 'on' && slice[idx + 1] === 'top') {
      restDestination = 'top';
      idx += 2;
      if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
      if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
      else if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    } else if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
      restDestination = 'bottom';
      idx += 3;
      if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
      if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
      else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
    } else {
      return null;
    }
    if (slice[idx] === '.') idx++;
  }

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'graveyard',
    restDestination,
    minSelections: 0,
    maxSelections: 1,
    fallbackSelectionCount: 0,
    selectedCardChoiceId: 'lookTopPutItGraveyardIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 2 — Saboteur "look at that many cards from the top" tail.
 *
 * Matches: "look at that many cards from the top of your library [. ...]"
 *
 * The count is EventDamageAmount (combat damage dealt to a player).
 * Emits a ChooseFromTopOfLibrary(Controller, EventDamageAmount) with
 * destination:'hand', restDestination:'bottom', filter:any, maxSelections=all.
 * This mirrors the "dig and take creature/green" wording on Garruk's Harbinger
 * and simpler "look at that many, put any into hand, rest on bottom" variants.
 *
 * The second sentence ("You may reveal ... put into your hand, rest on bottom")
 * is parsed as a ChooseFromTopOfLibrary with all-or-nothing selection.
 *
 * Examples:
 *   "look at that many cards from the top of your library. You may reveal any
 *    number of creature cards and/or green cards from among them. Put the revealed
 *    cards into your hand and the rest on the bottom of your library in any order."
 *   (Garruk's Harbinger)
 *
 *   "look at that many cards from the top of your library. Put any number of them
 *    into your hand and the rest on the bottom of your library in any order."
 */
export function matchLookAtTopThatMany(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "look at that many cards from the top of your library"
  if (slice[0] !== 'look') return null;
  if (slice[1] !== 'at') return null;
  if (slice[2] !== 'that' || slice[3] !== 'many') return null;
  if (slice[4] !== 'cards') return null;
  if (slice[5] !== 'from') return null;
  if (slice[6] !== 'the') return null;
  if (slice[7] !== 'top') return null;
  if (slice[8] !== 'of') return null;
  if (slice[9] !== 'your') return null;
  if (slice[10] !== 'library') return null;

  let idx = 11;
  if (slice[idx] === '.') idx++;

  // Consume the rest of the clause (the "put ... into hand, rest on bottom" part)
  // by scanning forward to the next period or end of tokens.
  // We accept and skip the optional clause that follows — the effect is
  // modelled as "look at EventDamageAmount, put any into hand, rest on bottom"
  // with full filter (any card type).
  while (idx < slice.length && slice[idx] !== '.') idx++;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: { kind: 'EventDamageAmount' },
    destination: 'hand',
    restDestination: 'bottom',
    minSelections: 0,
    selectedCardChoiceId: 'lookTopThatManyIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 2 (EventDamageAmount family): Match "exile that many cards from the top of
 * [their/your/target player's] library ."
 *
 * "That many" is EventDamageAmount. Emits ExileFromLibrary without a mayPlay
 * rider (variants with "you may play them" are declined here — they are handled
 * by matchExileFromLibraryTop which requires explicit "you may play").
 *
 * Recognised subject forms:
 *   "exile that many cards from the top of their library"  → EventPlayer
 *   "exile that many cards from the top of your library"   → Controller
 *
 * Examples:
 *   Raven Guild Master follow-up: "exile that many cards from the top of their library"
 *   Generic self-exile tail:      "exile that many cards from the top of your library"
 *
 * Declines any form that includes "you may play" (play-from-exile rider) so
 * those fall through to the dedicated matchExileFromLibraryTop handler.
 */
export function matchExileThatManyFromTopOfLibrary(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "exile that many cards from the top of their/your library"
  if (slice[0] !== 'exile') return null;
  if (slice[1] !== 'that' || slice[2] !== 'many') return null;
  if (slice[3] !== 'cards' && slice[3] !== 'card') return null;
  if (slice[4] !== 'from') return null;
  if (slice[5] !== 'the') return null;
  if (slice[6] !== 'top') return null;
  if (slice[7] !== 'of') return null;

  let idx = 8;
  let playerRef: import('../ast').TargetRef;

  if (slice[idx] === 'their') {
    playerRef = { kind: 'EventPlayer' };
    idx++;
  } else if (slice[idx] === 'your') {
    playerRef = { kind: 'Controller' };
    idx++;
  } else {
    return null;
  }

  if (slice[idx] !== 'library') return null;
  idx++;

  // Decline play-from-exile riders — let matchExileFromLibraryTop handle those.
  if (slice[idx] === 'you' && slice[idx + 1] === 'may' && slice[idx + 2] === 'play') {
    return null;
  }

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'ExileFromLibrary',
    player: playerRef,
    count: { kind: 'EventDamageAmount' },
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Slice 6 (combat-damage trigger bodies): "exile the top X cards of their library,
 * where X is the amount of damage dealt." (Kotis, the Fangkeeper family.)
 *
 * "Their library" → EventPlayer (the player who was dealt combat damage).
 * "X is the amount of damage dealt" → EventDamageAmount.
 *
 * Recognised form:
 *   "exile the top x cards of their library , where x is the amount of damage dealt ."
 *
 * Distinct from matchExileFromLibraryTop (self-exile, explicit number, "your library")
 * and matchExileThatManyFromTopOfLibrary ("that many", "from the top of").
 *
 * HONESTY: both ExileFromLibrary{EventPlayer} and EventDamageAmount are fully
 * executed by the existing executor path (case 'ExileFromLibrary').
 */
export function matchExileTopXDamageAmountTheirLibrary(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "exile the top x cards of their library"
  if (slice[0] !== 'exile') return null;
  if (slice[1] !== 'the') return null;
  if (slice[2] !== 'top') return null;
  if (slice[3] !== 'x') return null;
  if (slice[4] !== 'cards' && slice[4] !== 'card') return null;
  if (slice[5] !== 'of') return null;
  if (slice[6] !== 'their') return null;
  if (slice[7] !== 'library') return null;

  let idx = 8;

  // Optional: ", where x is the amount of damage dealt"
  // Consume any trailing ", where x is ..." clause up to the next '.'
  if (slice[idx] === ',') {
    idx++;
    if (slice[idx] === 'where' && slice[idx + 1] === 'x') {
      while (idx < slice.length && slice[idx] !== '.') idx++;
    } else {
      // unknown clause — decline
      return null;
    }
  }

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'ExileFromLibrary',
    player: { kind: 'EventPlayer' },
    count: { kind: 'EventDamageAmount' },
  };

  return { effects: [effect], targets: [], consumed };
}

// ============================================================================
// Slice 3 (trigger-tail dig family): three new variant matchers
// ============================================================================

/**
 * Match the "reveal-top-if-match-with-else" family:
 *   "Reveal the top card of your library. If it's a land card, you may reveal
 *    it and put it into your hand. If you don't, put it on the bottom of your
 *    library."                                             (Traveling Botanist)
 *   "Reveal the top card of your library. If it's a permanent card, you may put
 *    it onto the battlefield. If you don't, put it on the bottom of your library."
 *                                                          (Gate to the Aether)
 *
 * Extends matchRevealTopIfMatch to handle the "otherwise / if you don't /
 * if it isn't" secondary-destination clause. Modelled as a ChooseFromTopOfLibrary
 * with count=1, filter, matched destination, and restDestination for the
 * "otherwise" case. The executor auto-resolves: if the top card matches the
 * filter it takes it (maxSelections=1); the rest (non-matching top card) goes
 * to restDestination.
 *
 * Honest: ChooseFromTopOfLibrary is fully executed by the existing executor.
 * Supported secondary destinations: "bottom of your library", "graveyard".
 */
export function matchRevealTopIfMatchWithElse(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // "reveal the top card of your library" / "look at the top card of your library"
  if (slice[idx] === 'reveal') idx++;
  else if (slice[idx] === 'look' && slice[idx + 1] === 'at') idx += 2;
  else return null;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top' || slice[idx + 2] !== 'card') return null;
  idx += 3;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "if it's a/an <type> card,"
  if (slice[idx] !== 'if') return null;
  idx++;
  if (slice[idx] === "it's" || slice[idx] === 'its') idx++;
  else if (slice[idx] === 'it' && slice[idx + 1] === 'is') idx += 2;
  else return null;
  if (slice[idx] === 'a' || slice[idx] === 'an') idx++;

  const typeMap: Record<string, import('../ast').CardFilter> = {
    land: { types: ['land'] }, creature: { types: ['creature'] }, artifact: { types: ['artifact'] },
    enchantment: { types: ['enchantment'] }, instant: { types: ['instant'] }, sorcery: { types: ['sorcery'] },
    planeswalker: { types: ['planeswalker'] }, permanent: { permanent: true },
  };

  const matchedType = slice[idx];
  const filter = typeMap[matchedType];
  if (!filter) return null;
  idx++;
  if (slice[idx] === 'card') idx++;
  if (slice[idx] === ',') idx++;

  // "[you may] [reveal it and] put it into your hand/graveyard" or "onto the battlefield [tapped]"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  // Optional "reveal it and" (Traveling Botanist phrasing) — consume silently
  if (slice[idx] === 'reveal' && slice[idx + 1] === 'it' && slice[idx + 2] === 'and') idx += 3;
  if (slice[idx] !== 'put' || slice[idx + 1] !== 'it') return null;
  idx += 2;

  let matchDestination: 'hand' | 'graveyard' | 'battlefield';
  let tapped = false;
  if (slice[idx] === 'into' && slice[idx + 1] === 'your') {
    idx += 2;
    if (slice[idx] === 'hand') matchDestination = 'hand';
    else if (slice[idx] === 'graveyard') matchDestination = 'graveyard';
    else return null;
    idx++;
  } else if (slice[idx] === 'onto' && slice[idx + 1] === 'the' && slice[idx + 2] === 'battlefield') {
    if (matchedType === 'instant' || matchedType === 'sorcery') return null;
    matchDestination = 'battlefield';
    idx += 3;
    if (slice[idx] === 'tapped') { tapped = true; idx++; }
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  // "if you don't[,]" / "if it isn't[,]" / "otherwise[,]" — required
  let hasElse = false;
  if (slice[idx] === 'if' && slice[idx + 1] === 'you' && slice[idx + 2] === "don't") {
    idx += 3;
    hasElse = true;
  } else if (slice[idx] === 'if' && slice[idx + 1] === 'it' && slice[idx + 2] === "isn't") {
    idx += 3;
    hasElse = true;
  } else if (slice[idx] === 'if' && slice[idx + 1] === 'it' && slice[idx + 2] === 'is' && slice[idx + 3] === 'not') {
    idx += 4;
    hasElse = true;
  } else if (slice[idx] === 'otherwise') {
    idx++;
    hasElse = true;
  }
  if (!hasElse) return null;
  if (slice[idx] === ',') idx++;

  // "put it on the bottom of your library" / "put it into your graveyard" /
  // "on the bottom of your library" / "into your graveyard"
  if (slice[idx] === 'put') idx++;
  if (slice[idx] === 'it') idx++;

  let restDestination: 'bottom' | 'graveyard';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const effect: import('../ast').Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: 1,
    destination: matchDestination,
    restDestination,
    minSelections: 0,
    maxSelections: 1,
    filter,
    ...(tapped ? { tapped: true } : {}),
    selectedCardChoiceId: 'revealTopIfMatchElseIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the "look at top X where X is the greatest power" dig family
 * (Keldon Flamesage):
 *   "Look at the top X cards of your library, where X is the greatest power
 *    among creatures you control. You may reveal a [filter] card from among
 *    them and put it into your hand. Put the rest on the bottom of your library
 *    in a random order."
 *
 * Emits ChooseFromTopOfLibrary with:
 *   count = { kind: 'GreatestPower', zone: 'battlefield', controller: 'you',
 *              filter: { types: ['creature'] } }
 *   destination = 'hand', restDestination = 'bottom',
 *   minSelections = 0, maxSelections = 1.
 *
 * Honest: GreatestPower is resolved by resolveGreatestPower in executor.ts.
 * Only "creatures you control" is accepted as the filter (most common + tested);
 * other groupings stay Unparsed to preserve honesty.
 */
export function matchLookAtTopGreatestPower(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 18) return null;

  // "look at the top x cards of your library" / "reveal the top x cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') { idx++; }
  else if (slice[idx] === 'look' && slice[idx + 1] === 'at') { idx += 2; }
  else return null;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  if (slice[idx] !== 'x') return null;
  idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;

  // ", where X is the greatest power among <creatures> you control"
  if (slice[idx] === ',') idx++;
  if (slice[idx] !== 'where' || slice[idx + 1] !== 'x' || slice[idx + 2] !== 'is') return null;
  idx += 3;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'greatest' || slice[idx + 2] !== 'power'
    || slice[idx + 3] !== 'among') return null;
  idx += 4;

  // Only "creatures you control" accepted for honesty
  if (slice[idx] !== 'creatures' && slice[idx] !== 'creature') return null;
  idx++;
  if (slice[idx] === 'cards') idx++;
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'control') return null;
  idx += 2;
  if (slice[idx] === '.') idx++;

  const count: import('../ast').AmountRef = {
    kind: 'GreatestPower',
    zone: 'battlefield',
    controller: 'you',
    filter: { types: ['creature'] },
  };

  // Parse the "take" clause — flexible (one card of optional type, rest on bottom)
  const typeMap: Record<string, NonNullable<import('../ast').CardFilter['types']>> = {
    land: ['land'], lands: ['land'],
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    instant: ['instant'], instants: ['instant'],
    sorcery: ['sorcery'], sorceries: ['sorcery'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };

  let filter: import('../ast').CardFilter = {};
  let maxSelections = 1;

  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;

  let skipFromAmongThem = false;
  if (slice[idx] === 'reveal' || slice[idx] === 'put') {
    const verb = slice[idx];
    idx++;
    if (slice[idx] === 'any' && slice[idx + 1] === 'number' && slice[idx + 2] === 'of') {
      idx += 3;
      maxSelections = 999;
      // "any number of them" (no type filter) — skip "from among them" check
      if (slice[idx] === 'them') {
        skipFromAmongThem = true;
        idx++;
      }
    } else {
      if (slice[idx] === 'a' || slice[idx] === 'an') idx++;
      maxSelections = 1;
    }
    if (!skipFromAmongThem) {
      const types = typeMap[slice[idx]];
      if (types) { filter = { types }; idx++; }
      if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;
    }
    if (verb === 'reveal') {
      if (slice[idx] === 'and') idx++;
      if (slice[idx] === 'put') idx++;
      if (slice[idx] === 'it' || slice[idx] === 'them') idx++;
    }
  } else {
    // No recognized take verb — must at least reach "from among them"
    return null;
  }

  // "from among them" — may be skipped when "any number of them" was consumed inline
  if (!skipFromAmongThem) {
    if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
    idx += 3;
  }

  // "into your hand" (optional inline or separate sentence)
  if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'hand') {
    idx += 3;
  }
  if (slice[idx] === '.') idx++;

  // "put the rest on the bottom [of your library] [in a random/any order]"
  if (slice[idx] === 'put') idx++;
  if (slice[idx] === 'the' && slice[idx + 1] === 'rest') idx += 2;
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  }
  if (slice[idx] === '.') idx++;

  const effect: import('../ast').Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'hand',
    restDestination: 'bottom',
    minSelections: 0,
    maxSelections,
    ...(Object.keys(filter).length > 0 ? { filter } : {}),
    selectedCardChoiceId: 'lookTopGreatestPowerIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the "all <type1> and all <type2> cards" multi-type reveal family:
 *   "Reveal the top N cards of your library. Put all creature cards and all land
 *    cards revealed this way into your hand and the rest on the bottom of your
 *    library in any order."                                        (Lair Delve)
 *
 * Extends matchRevealTopTakeExtended to cover the "all <typeA> [cards] and [all]
 * <typeB> cards revealed this way" multi-type AND conjunction (anyOf semantics —
 * the executor ORs within filter.anyOf). Single-type "all <type>" forms are
 * already handled by matchRevealTopTake and matchRevealTopTakeExtended.
 *
 * Requires at least 2 branches — a single branch falls through to existing matchers.
 * Emits ChooseFromTopOfLibrary with anyOf filter, destination='hand', maxSelections=N.
 */
export function matchRevealTopAllTypesAndAll(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "reveal the top N cards ..." / "look at the top N cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') { idx++; }
  else if (slice[idx] === 'look' && slice[idx + 1] === 'at') { idx += 2; }
  else return null;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  let count: import('../ast').AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const revealN = parseSmallNumberToken(slice[idx]);
    if (isNaN(revealN) || revealN < 1) return null;
    count = revealN;
    idx++;
  }
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  const typeMap: Record<string, NonNullable<import('../ast').CardFilter['types']>> = {
    land: ['land'], lands: ['land'],
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    instant: ['instant'], instants: ['instant'],
    sorcery: ['sorcery'], sorceries: ['sorcery'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };

  // "[you may] put [all <type> cards]+ ..."
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;

  // Collect "all <type> [cards]" branches, separated by "and [all]"
  const branches: import('../ast').CardFilter[] = [];
  while (true) {
    if (slice[idx] !== 'all') break;
    idx++;
    const types = typeMap[slice[idx]];
    if (!types) { idx--; break; } // backtrack the "all" consumption
    branches.push({ types });
    idx++;
    if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;
    // Continue if "and [all]" follows with another type
    if (slice[idx] === 'and') {
      const peekAll = slice[idx + 1] === 'all' ? idx + 2 : idx + 1;
      if (typeMap[slice[peekAll]]) {
        idx++; // consume "and"
        // keep "all" for next iteration
        continue;
      }
    }
    break;
  }

  // Must have at least 2 branches (single-type handled by matchRevealTopTake)
  if (branches.length < 2) return null;

  // "revealed this way" / "from among them"
  if (slice[idx] === 'revealed' && slice[idx + 1] === 'this' && slice[idx + 2] === 'way') {
    idx += 3;
  } else if (slice[idx] === 'from' && slice[idx + 1] === 'among' && slice[idx + 2] === 'them') {
    idx += 3;
  } else {
    return null;
  }

  // "into your hand"
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "and [put] the rest on the bottom / into your graveyard"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const filter: import('../ast').CardFilter = { anyOf: branches };
  const countNum = typeof count === 'number' ? count : 999;

  const effect: import('../ast').Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'hand',
    restDestination,
    minSelections: 0,
    maxSelections: countNum,
    filter,
    selectedCardChoiceId: 'revealTopAllTypesAndAllIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 4 (round-8 cut c): Look/reveal-top-N spell-face leftovers
// ============================================================================

/**
 * Match "Discover the Impossible" family:
 *   "Look at the top N cards of your library. Exile one of them face down.
 *    Put the rest on the bottom of your library in a random order."
 *
 * Emits ChooseFromTopOfLibrary with destination='exile', maxSelections=1,
 * restDestination='bottom'. The "face down" rider is discarded — the executor
 * moves the card to exile (an honest approximation; face-down exile tracking
 * is not yet modeled, but the zone transition is correct).
 */
export function matchLookAtTopExileFaceDown(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 16) return null;

  // "look at the top N cards of your library"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at' || slice[idx + 2] !== 'the' || slice[idx + 3] !== 'top') return null;
  idx += 4;

  const revealN = parseSmallNumberToken(slice[idx]);
  if (isNaN(revealN) || revealN < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  // "exile one of them [face down]."
  if (slice[idx] !== 'exile') return null;
  idx++;
  if (slice[idx] !== 'one') return null;
  idx++;
  if (slice[idx] !== 'of') return null;
  idx++;
  if (slice[idx] !== 'them') return null;
  idx++;
  // Optional "face down"
  if (slice[idx] === 'face' && slice[idx + 1] === 'down') idx += 2;
  if (slice[idx] === '.') idx++;

  // "and put the rest on the bottom ..." OR "put the rest on the bottom ..."
  // (single-sentence form uses "and" before "put"; two-sentence form omits it)
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  if (slice[idx] !== 'on' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'bottom') return null;
  idx += 3;
  if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
  if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
  else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: revealN,
    destination: 'exile',
    restDestination: 'bottom',
    minSelections: 1,
    maxSelections: 1,
    fallbackSelectionCount: 1,
    selectedCardChoiceId: 'lookTopExileFaceDownIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match "Make Your Own Luck" family:
 *   "Look at the top N cards of your library. Put M of them on the bottom of
 *    your library in a random order and the rest into your hand."
 *
 * The card says "put M on bottom, rest to hand" which is equivalent to
 * "take (N-M) cards into your hand, put M on the bottom". We model this as
 * ChooseFromTopOfLibrary with destination='hand', maxSelections=N-M (take the
 * non-bottom cards) and restDestination='bottom'.
 *
 * This wording is the INVERSE of matchDigTopTakeRest ("put M into hand, rest
 * on bottom") — the selection here is "which M go to the bottom" rather than
 * "which M go to hand". We flip it: take (N-M) to hand, rest on bottom.
 */
export function matchLookAtTopPutMOnBottomRestToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 16) return null;

  // "look at the top N cards of your library"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at' || slice[idx + 2] !== 'the' || slice[idx + 3] !== 'top') return null;
  idx += 4;

  const revealN = parseSmallNumberToken(slice[idx]);
  if (isNaN(revealN) || revealN < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  // "put M of them on the bottom of your library [in a random order]"
  if (slice[idx] !== 'put') return null;
  idx++;
  const bottomM = parseSmallNumberToken(slice[idx]);
  if (isNaN(bottomM) || bottomM < 1 || bottomM >= revealN) return null;
  idx++;
  if (slice[idx] !== 'of') return null;
  idx++;
  if (slice[idx] !== 'them') return null;
  idx++;
  if (slice[idx] !== 'on' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'bottom') return null;
  idx += 3;
  if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
  if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
  else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;

  // "and the rest into your hand"
  if (slice[idx] !== 'and') return null;
  idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  const takeToHand = revealN - bottomM;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: revealN,
    destination: 'hand',
    restDestination: 'bottom',
    minSelections: 0,
    maxSelections: takeToHand,
    fallbackSelectionCount: takeToHand,
    selectedCardChoiceId: 'lookTopPutMBottomRestHandIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match "Saheeli's Directive" family:
 *   "Reveal the top X cards of your library. [You may] put any number of
 *    <type> cards from among them onto the battlefield. Put the rest into
 *    your graveyard."
 *   Also handles fixed-N variant and "onto the battlefield tapped" rider.
 *
 * Emits ChooseFromTopOfLibrary with destination='battlefield',
 * restDestination='graveyard', maxSelections=large (up to count), and a type
 * filter. The executor puts matching cards onto the battlefield with full ETB
 * plumbing. Honest: only permanent card types are accepted.
 */
export function matchRevealTopAnyNumberOntoBattlefield(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 16) return null;

  // "reveal the top N/X cards of your library" / "look at the top ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  let count: AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  // "[you may] put any number of <type> cards from among them onto the battlefield [tapped]."
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] !== 'any' || slice[idx + 1] !== 'number' || slice[idx + 2] !== 'of') return null;
  idx += 3;

  // Type filter — only permanent types (honest: non-permanents can't enter battlefield)
  const PERMANENT_TYPE_MAP: Record<string, NonNullable<CardFilter['types']>> = {
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    land: ['land'], lands: ['land'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };
  let filter: CardFilter;
  if (slice[idx] === 'permanent' || slice[idx] === 'permanents') {
    filter = { permanent: true };
    idx++;
  } else {
    const types = PERMANENT_TYPE_MAP[slice[idx]];
    if (!types) return null;
    filter = { types };
    idx++;
  }
  if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;

  // "from among them"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;

  // "onto the battlefield [tapped]"
  if (slice[idx] !== 'onto' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'battlefield') return null;
  idx += 3;
  let tapped = false;
  if (slice[idx] === 'tapped') { tapped = true; idx++; }
  if (slice[idx] === '.') idx++;

  // "put the rest into your graveyard [or on the bottom]."
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard' = 'graveyard';
  if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const maxSel = typeof count === 'number' ? count : 999;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'battlefield',
    restDestination,
    minSelections: 0,
    maxSelections: maxSel,
    filter,
    ...(tapped ? { tapped: true } : {}),
    selectedCardChoiceId: 'revealTopAnyNumBfIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match "Lair Delve" / "Portent of Calamity" extended multi-type family:
 *
 * Form A — single "all" with multi-type "and" list (Lair Delve):
 *   "Reveal the top N cards of your library. Put all creature and land cards
 *    revealed this way into your hand. Put the rest on the bottom of your
 *    library in any order."
 *
 * Form B — repeated ", then put all <type>" branches (Portent of Calamity):
 *   "Reveal the top five cards of your library. Put all creature cards
 *    revealed this way into your hand, then put all land cards revealed this
 *    way into your hand, then put all artifact cards revealed this way into
 *    your hand. Put the rest into your graveyard."
 *
 * Both emit a ChooseFromTopOfLibrary with anyOf filter covering all named
 * types, destination='hand', and appropriate restDestination.
 *
 * Requires at least 2 distinct types (single-type falls through to existing
 * matchRevealTopTake / matchRevealTopSubtypeFilter matchers).
 */
export function matchRevealTopMultiTypeThenBranch(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "reveal the top N/X cards ..." / "look at the top N cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  let count: AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  const TYPE_MAP: Record<string, NonNullable<CardFilter['types']>> = {
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    land: ['land'], lands: ['land'],
    instant: ['instant'], instants: ['instant'],
    sorcery: ['sorcery'], sorceries: ['sorcery'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };

  /**
   * Try to parse one "put all <typeA> [and <typeB>]* cards <source> into your hand"
   * branch starting at slice index `startIdx`.
   * Returns { types: string[][], endIdx } or null.
   */
  function parsePutAllTypeBranch(startIdx: number): { typesList: NonNullable<CardFilter['types']>[]; endIdx: number } | null {
    let i = startIdx;
    if (slice[i] !== 'put') return null;
    i++;
    if (slice[i] !== 'all') return null;
    i++;

    // Collect one or more type words joined by "and" — all before "cards"
    const typesList: NonNullable<CardFilter['types']>[] = [];
    while (true) {
      const typeToken = slice[i];
      const types = TYPE_MAP[typeToken];
      if (!types) return null;
      typesList.push(types);
      i++;
      // Optionally followed by "and <type>" continuations (before "cards")
      if (slice[i] === 'and' && TYPE_MAP[slice[i + 1]]) {
        i++; // consume "and"
        continue;
      }
      break;
    }
    if (typesList.length === 0) return null;

    // "card" / "cards"
    if (slice[i] === 'card' || slice[i] === 'cards') i++;

    // "revealed this way" | "from among them"
    if (slice[i] === 'revealed' && slice[i + 1] === 'this' && slice[i + 2] === 'way') {
      i += 3;
    } else if (slice[i] === 'from' && slice[i + 1] === 'among' && slice[i + 2] === 'them') {
      i += 3;
    } else {
      return null;
    }

    // "into your hand"
    if (slice[i] !== 'into' || slice[i + 1] !== 'your' || slice[i + 2] !== 'hand') return null;
    i += 3;
    if (slice[i] === '.') i++;

    return { typesList, endIdx: i };
  }

  // Parse the FIRST "put all <type[s]> cards ... into your hand" branch
  const firstBranch = parsePutAllTypeBranch(idx);
  if (!firstBranch) return null;

  const allTypesList: NonNullable<CardFilter['types']>[] = [...firstBranch.typesList];
  idx = firstBranch.endIdx;

  // Collect additional ", then put all <type> cards ... into your hand" branches (Form B)
  while (true) {
    let peekIdx = idx;
    if (slice[peekIdx] === ',') peekIdx++;
    if (slice[peekIdx] === 'then') peekIdx++;
    if (peekIdx === idx) break; // need at least one separator consumed
    const nextBranch = parsePutAllTypeBranch(peekIdx);
    if (!nextBranch) break;
    allTypesList.push(...nextBranch.typesList);
    idx = nextBranch.endIdx;
  }

  // Require at least 2 distinct type entries (single-type falls through)
  if (allTypesList.length < 2) return null;

  // Build unique type list for the anyOf filter
  const seenTypes = new Set<string>();
  const branches: CardFilter[] = [];
  for (const types of allTypesList) {
    for (const t of types) {
      if (!seenTypes.has(t)) {
        seenTypes.add(t);
        branches.push({ types: [t] });
      }
    }
  }
  if (branches.length < 2) return null;

  // "[and] [put] the rest [on the bottom | into your graveyard]"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const maxSel = typeof count === 'number' ? count : 999;
  const filter: CardFilter = { anyOf: branches };

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'hand',
    restDestination,
    minSelections: 0,
    maxSelections: maxSel,
    filter,
    selectedCardChoiceId: 'revealTopMultiTypeThenIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the "put any number of them into your hand" unfiltered dig family:
 *   "Look at the top N cards of your library. Put any number of them into
 *    your hand and the rest on the bottom of your library in a random order."
 *
 * Different from matchDigTopTakeRest (which requires "put M of them") —
 * this uses "any number of them" (unbounded, unfiltered). Emits
 * ChooseFromTopOfLibrary with no filter and maxSelections=count.
 */
export function matchLookAtTopAnyNumberToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "look at the top N cards of your library"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at' || slice[idx + 2] !== 'the' || slice[idx + 3] !== 'top') return null;
  idx += 4;

  let count: AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  // "[you may] put any number of them into your hand"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] !== 'any' || slice[idx + 1] !== 'number' || slice[idx + 2] !== 'of') return null;
  idx += 3;
  // "them" or "those cards" (unfiltered)
  if (slice[idx] === 'them') {
    idx++;
  } else if (slice[idx] === 'those' && (slice[idx + 1] === 'cards' || slice[idx + 1] === 'card')) {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "and the rest on the bottom [of your library] [in a random order]."
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard' = 'bottom';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const maxSel = typeof count === 'number' ? count : 999;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'hand',
    restDestination,
    minSelections: 0,
    maxSelections: maxSel,
    fallbackSelectionCount: maxSel,
    selectedCardChoiceId: 'lookTopAnyNumToHandIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 2/13 additions: "any number to graveyard" and "reveal a <filter> card
// and put it into hand" dig shapes (Gutless Plunderer / Nessian Wanderer /
// Seismic Sense families).
// ============================================================================

/**
 * Match the "put any number of them into your graveyard" dig family
 * (Gutless Plunderer, Gonti's Aether Heart, etc.):
 *   "Look at the top N cards of your library. You may put any number of them
 *    into your graveyard. Put the rest on top of your library in any order."
 *
 * This is the graveyard-destination analogue of matchLookAtTopAnyNumberToHand.
 * minSelections=0 (optional "may"), destination='graveyard', restDestination='top'.
 *
 * Honest: ChooseFromTopOfLibrary already supports graveyard destination and
 * top restDestination — verified in matchLookAtTopPutNToGraveyard execution.
 */
export function matchLookAtTopAnyNumberToGraveyard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 12) return null;

  // "look at the top N/X cards of your library"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at' || slice[idx + 2] !== 'the' || slice[idx + 3] !== 'top') return null;
  idx += 4;

  let count: AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  // "[you may] put any number of them/those cards into your graveyard"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] !== 'any' || slice[idx + 1] !== 'number' || slice[idx + 2] !== 'of') return null;
  idx += 3;
  if (slice[idx] === 'them') {
    idx++;
  } else if (slice[idx] === 'those' && (slice[idx + 1] === 'cards' || slice[idx + 1] === 'card')) {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'graveyard') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "put the rest on top [of your library] [in any/a random order]."
  // Also accept "on the bottom" for variants where graveyard is the main take zone
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'top' | 'bottom' = 'top';
  if (slice[idx] === 'on' && slice[idx + 1] === 'top') {
    restDestination = 'top';
    idx += 2;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
  } else if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const maxSel = typeof count === 'number' ? count : 999;

  const gravEffect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'graveyard',
    restDestination,
    minSelections: 0,
    maxSelections: maxSel,
    fallbackSelectionCount: 0,
    selectedCardChoiceId: 'lookTopAnyNumToGraveyardIds',
  };

  return { effects: [gravEffect], targets: [], consumed: idx };
}

/**
 * Match the "reveal a <filter> card from among them and put it into your hand"
 * single-card filtered dig family (Nessian Wanderer, Seismic Sense, etc.):
 *
 *   "Look at the top N cards of your library. You may reveal a land card from
 *    among them and put it into your hand. Put the rest on the bottom of your
 *    library in any order."                                   (Nessian Wanderer)
 *
 *   "Look at the top X cards of your library, where X is the number of lands
 *    you control. You may reveal a land card from among them and put it into
 *    your hand. Put the rest on the bottom of your library in any order."
 *                                                              (Seismic Sense)
 *
 * Handles:
 *  - Fixed N or X count (with optional ", where X is the number of <filter>
 *    <zone>" definition via parseWhereXIsNumberOf)
 *  - Any single card-type or subtype filter word before "card"
 *  - "from among them and put it into your hand" — the "reveal" + "put it" form
 *  - Rest placement on bottom, top, or graveyard
 *
 * Emits ChooseFromTopOfLibrary with destination='hand', minSelections=0,
 * maxSelections=1 (the single "a <filter> card" is optional via "you may").
 *
 * Does NOT claim "reveal a <typeA> card and/or a <typeB> card" (multi-branch
 * forms — those are handled by matchRevealTopPutRevealedToHand) or "reveal up
 * to M <filter> cards" (handled by matchRevealTopUpToMFilter).
 *
 * Declined: manifest / cast-without-paying riders.
 */
export function matchLookAtTopRevealOneFilterToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 16) return null;

  // "look at the top N/X cards of your library" / "reveal the top N/X cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  let count: AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;

  // Optional ", where X is the number of <filter> <zone>" for X-count variants (Seismic Sense)
  if (slice[idx] === ',') {
    const whereResult = parseWhereXIsNumberOf(slice, idx);
    if (whereResult && typeof count !== 'number' && (count as { kind: string }).kind === 'X') {
      count = whereResult.amount;
      idx = whereResult.nextIndex;
    }
  }
  if (slice[idx] === '.') idx++;

  // "[you may] reveal a/an <filter> card from among them and put it into your hand"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'reveal') return null;
  idx++;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;

  // Decline "and/or" multi-branch — those are handled by matchRevealTopPutRevealedToHand
  // (we only handle the single-card "a <filter> card" form here)

  // Parse filter: type map for card types + subtype guess
  const TYPE_MAP: Record<string, NonNullable<CardFilter['types']>> = {
    land: ['land'], lands: ['land'],
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    instant: ['instant'], instants: ['instant'],
    sorcery: ['sorcery'], sorceries: ['sorcery'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };

  const STOPWORDS = new Set([
    'card', 'cards', 'from', 'among', 'them', 'into', 'your', 'hand', 'graveyard',
    'the', 'of', 'on', 'top', 'bottom', 'library', 'rest', 'put', 'and', 'it',
    'or', 'and/or',
  ]);

  const typeToken = slice[idx];
  if (!typeToken || STOPWORDS.has(typeToken)) return null;

  // Only handle plain card-type tokens (land, creature, artifact, enchantment, etc.)
  // Subtype tokens (Human, Goblin, Elf, Dragon, etc.) fall through to matchLookAtTopPutOneIntoHand,
  // which uses SearchLibrary with the richer anyOf: [{subtypes:...},{nameIncludes:...}] filter.
  let filter: CardFilter = {};
  const types = TYPE_MAP[typeToken];
  if (types) {
    filter = { types };
    idx++;
  } else {
    // Not a plain card type — decline so the SearchLibrary-based matcher handles it
    return null;
  }

  // Decline "and/or" after type — those are the multi-branch form
  if (slice[idx] === 'and/or') return null;

  // "card" or "cards" (required)
  if (slice[idx] !== 'card' && slice[idx] !== 'cards') return null;
  idx++;

  // "from among them"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;

  // "and put it into your hand" / "and put that card into your hand"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] === 'it') {
    idx++;
  } else if (slice[idx] === 'that' && slice[idx + 1] === 'card') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "put the rest on the bottom / on top [of your library] [in any/a random order]"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  let restDestination: 'bottom' | 'top' | 'graveyard' = 'bottom';
  if (slice[idx] === 'the' && slice[idx + 1] === 'rest') {
    idx += 2;
    if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
      restDestination = 'bottom';
      idx += 3;
      if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
      if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
      else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
    } else if (slice[idx] === 'on' && slice[idx + 1] === 'top') {
      restDestination = 'top';
      idx += 2;
      if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
      if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
      else if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
      restDestination = 'graveyard';
      idx += 3;
    }
    // else: no explicit rest clause — default 'bottom' stays
  }
  // else: no rest clause at all — default 'bottom' stays
  if (slice[idx] === '.') idx++;

  const revealOneEffect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'hand',
    restDestination,
    minSelections: 0,
    maxSelections: 1,
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    selectedCardChoiceId: 'lookTopRevealOneFilterHandIds',
  };

  return { effects: [revealOneEffect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 3/13: Reveal-top-N leftovers — unconditional reveal+put and chosen-type
// ============================================================================

/**
 * Match the unconditional "reveal the top card and put it into your hand" form.
 * Appears as a trigger-embedded body or spell clause WITHOUT a conditional type check:
 *   "Reveal the top card of your library and put it into your hand."
 *   "Reveal the top card of your library. Put it into your hand."
 *
 * This is distinct from the Dark Confidant family (which requires a life-loss rider)
 * and from matchRevealTopIfMatch (which requires an "if it's a <type>" condition).
 *
 * Emits RevealTopMatch with an empty filter (matches any card) and
 * matchDestination='hand'. Executor moves the top card to hand unconditionally.
 *
 * Honest: the RevealTopMatch executor already handles empty filters (moves any top card).
 * Declines if there is NO "put it into your hand" phrase (not a zonal move at all).
 */
export function matchRevealTopUnconditioned(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 7) return null;

  // "reveal the top card of your library"
  let idx = 0;
  if (slice[idx] !== 'reveal') return null;
  idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top' || slice[idx + 2] !== 'card') return null;
  idx += 3;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;

  // Optional "and" connector
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === '.') idx++;
  // Optional "then"
  if (slice[idx] === 'then') idx++;

  // Must be followed by "put it into your hand" — NOT an "if it's" conditional
  // (those are claimed by matchRevealTopIfMatch / matchRevealTopIfMatchWithElse).
  if (slice[idx] === 'if') return null;

  // "put it into your hand" / "put that card into your hand"
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] === 'it') {
    idx++;
  } else if (slice[idx] === 'that' && slice[idx + 1] === 'card') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // Decline if followed by "you lose life" (that's the Dark Confidant form, handled separately).
  if (slice[idx] === 'you' && slice[idx + 1] === 'lose' && slice[idx + 2] === 'life') return null;

  const effect: Effect = {
    kind: 'RevealTopMatch',
    filter: {},              // empty filter → any top card matches
    matchDestination: 'hand',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the "reveal top N cards, put all cards of the chosen type into hand,
 * rest on the bottom / into graveyard" family (Vigean Intuition / Spectral Arcanist):
 *   "Reveal the top N cards of your library. Put all cards of the chosen type
 *    into your hand and the rest on the bottom of your library in any order."
 *   "Reveal the top N cards of your library. Put all cards of the chosen type
 *    into your hand and the rest into your graveyard."
 *
 * Emits ChooseFromTopOfLibrary with filter: { chosenCreatureTypeFromSource: true },
 * so the executor auto-takes every revealed card whose type matches the source
 * permanent's choices.chosenCreatureType at resolution time.
 *
 * Declined:
 * - "choose a card name" variants (chosenName filter not yet in executor)
 * - Opponent-chooses variants (no executor support)
 * - Pile-split / cast-without-paying shapes
 *
 * HONESTY NOTE: The executor passes sourceInstanceId to matchesCardFilter for this
 * filter to resolve correctly (see executor.ts executeChooseFromTopOfLibrary).
 */
export function matchRevealTopChosenType(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 12) return null;

  // "reveal the top N cards of your library" (N >= 1)
  let idx = 0;
  if (slice[idx] !== 'reveal') return null;
  idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  const revealN = parseSmallNumberToken(slice[idx]);
  if (isNaN(revealN) || revealN < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' || slice[idx + 1] !== 'of' || slice[idx + 2] !== 'your' || slice[idx + 3] !== 'library') return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  // "put all cards of the chosen type into your hand"
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] !== 'all') return null;
  idx++;
  if (slice[idx] !== 'cards') return null;
  idx++;
  if (slice[idx] !== 'of') return null;
  idx++;
  if (slice[idx] !== 'the') return null;
  idx++;
  if (slice[idx] !== 'chosen') return null;
  idx++;
  // "type" / "card type" — accept either wording
  if (slice[idx] === 'card' && slice[idx + 1] === 'type') {
    idx += 2;
  } else if (slice[idx] === 'type') {
    idx++;
  } else {
    return null;
  }
  // Optional "revealed this way" qualifier (Vigean Intuition modern oracle wording)
  if (slice[idx] === 'revealed' && slice[idx + 1] === 'this' && slice[idx + 2] === 'way') {
    idx += 3;
  }
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "and the rest on the bottom of your library [in any/a random order]"
  // or "and the rest into your graveyard"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: revealN,
    destination: 'hand',
    restDestination,
    minSelections: 0,
    maxSelections: revealN,
    filter: { chosenCardTypeFromSource: true },
    selectedCardChoiceId: 'revealTopChosenTypeIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 12: "Look at the top N cards. You may put one back on top. Put the rest
 * into your graveyard." (Sage of Days family)
 *
 * This is the graveyard-rest variant of matchLookAtTopOneOnTopRestBottom.
 * Emits ChooseFromTopOfLibrary with destination='top', restDestination='graveyard',
 * maxSelections=1, fallbackSelectionCount=1 (auto-keeps top card).
 *
 * HONESTY: the executor supports restDestination='graveyard' and destination='top'
 * for ChooseFromTopOfLibrary (see executor.ts ~2864–2908). The "you may" makes
 * the keep optional (minSelections=0).
 *
 * DECLINED: "Reveal the top N cards. An opponent chooses one. Put that into your
 * graveyard and the rest into your hand." (Murmurs from Beyond) — the executor's
 * executeChooseFromTopOfLibrary does not support restDestination='hand'; only
 * 'bottom' | 'graveyard' | 'exile' | 'top' are implemented. Parsing this honestly
 * would require a new executor subsystem (opponent-makes-choice + rest-to-hand).
 */
export function matchLookAtTopOneOnTopRestGraveyard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "look at the top N cards [of your library]"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at' || slice[idx + 2] !== 'the' || slice[idx + 3] !== 'top') return null;
  idx += 4;

  const n = parseSmallNumberToken(slice[idx]);
  if (isNaN(n) || n < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
  if (slice[idx] === '.') idx++;

  // "[you may] put [up to] one [of them] [back] on top [of your library]"
  const mandatory = !(slice[idx] === 'you' && slice[idx + 1] === 'may');
  if (!mandatory) idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] === 'up' && slice[idx + 1] === 'to') idx += 2;
  if (slice[idx] !== 'one') return null;
  idx++;
  if (slice[idx] === 'of' && (slice[idx + 1] === 'them' || slice[idx + 1] === 'those')) {
    idx += 2;
    if (slice[idx - 1] === 'those' && (slice[idx] === 'cards' || slice[idx] === 'card')) idx++;
  }
  if (slice[idx] === 'back') idx++;
  if (slice[idx] !== 'on' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
  if (slice[idx] === '.') idx++;

  // "[and] [put] the rest into your graveyard [.]"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'graveyard') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: n,
    destination: 'top',
    restDestination: 'graveyard',
    minSelections: mandatory ? 1 : 0,
    maxSelections: 1,
    fallbackSelectionCount: 1,
    selectedCardChoiceId: 'lookTopOneOnTopRestGraveyardIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 4 (round-8 dig leftovers): "Look at the top card of your library.
 * You may exile that card."  (Puresight Merrow family)
 *
 * Oracle pattern:
 *   "Look at the top card of your library. You may exile that card."
 *
 * Emits ChooseFromTopOfLibrary with count=1, destination='exile',
 * restDestination='bottom', minSelections=0 (optional), maxSelections=1.
 *
 * Honest: the executor already supports exile-from-top for ChooseFromTopOfLibrary.
 * The "(Q is the untap symbol)" reminder is tokenized separately and not
 * consumed here — it will appear as unconsumed tokens after the match.
 *
 * EXCLUDED: "you may cast that card without paying its mana cost" tail — no
 * executor path for free-cast.
 */
export function matchLookAtTopCardMayExile(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 10) return null;

  // "look at the top card of your library" (singular card, no count number)
  if (slice[0] !== 'look' || slice[1] !== 'at' || slice[2] !== 'the' || slice[3] !== 'top') return null;
  if (slice[4] !== 'card') return null;
  if (slice[5] !== 'of' || slice[6] !== 'your' || slice[7] !== 'library') return null;
  let idx = 8;
  if (slice[idx] === '.') idx++;

  // "you may exile that card" or "you may exile it"
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'may' || slice[idx + 2] !== 'exile') return null;
  idx += 3;
  // Accept "that card" or "it"
  if (slice[idx] === 'that' && slice[idx + 1] === 'card') {
    idx += 2;
  } else if (slice[idx] === 'it') {
    idx++;
  } else {
    return null;
  }

  // EXCLUDE: "you may cast..." free-cast rider is present right after
  if (slice[idx] === '.' && slice[idx + 1] === 'you' && slice[idx + 2] === 'may' && slice[idx + 3] === 'cast') return null;
  if (slice[idx] === 'and' && slice[idx + 1] === 'you' && slice[idx + 2] === 'may' && slice[idx + 3] === 'cast') return null;
  if (slice[idx] === 'without') return null; // "without paying" inline continuation

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: 1,
    destination: 'exile',
    restDestination: 'bottom',
    minSelections: 0,
    maxSelections: 1,
    selectedCardChoiceId: 'lookTopCardMayExileIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 4 (round-8 dig leftovers): "Look at the top X cards of your library,
 * where X is this creature's power. You may exile a [filter] card from among
 * them. Put the rest on the bottom of your library [in a random order]."
 * (Enlist attack-trigger family — without the free-cast tail)
 *
 * This extends the exile-from-among family to handle the dynamic count form
 * "where X is this creature's power" (TargetPower Source). The executor resolves
 * TargetPower{Source} correctly for ChooseFromTopOfLibrary (sourceInstanceId is
 * passed as the targetId override in the ChooseFromTopOfLibrary executor case,
 * bypassing the resolveTargetRef throw for Source targets).
 *
 * EXPLICITLY DECLINED: If the next clause is "you may cast the exiled card
 * without paying its mana cost" we return null (no executor path for free-cast).
 * This matcher only claims forms where the exile action is terminal (Keldon
 * Flamesage itself is therefore still Unparsed, preserving honesty).
 *
 * Emits ChooseFromTopOfLibrary with:
 *   count = { kind: 'TargetPower', target: { kind: 'Source' } }
 *   destination = 'exile', restDestination = 'bottom' or 'graveyard',
 *   minSelections = 0, maxSelections = 1.
 */
export function matchLookAtTopWhereXSelfPowerExile(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 16) return null;

  // "look at the top x cards of your library" / "reveal the top x cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') { idx++; }
  else if (slice[idx] === 'look' && slice[idx + 1] === 'at') { idx += 2; }
  else return null;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  if (slice[idx] !== 'x') return null;
  idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;

  // ", where X is [this creature's power | this permanent's power | its power]"
  if (slice[idx] === ',') idx++;
  if (slice[idx] !== 'where' || slice[idx + 1] !== 'x' || slice[idx + 2] !== 'is') return null;
  idx += 3;

  // "this creature's power" / "this permanent's power" / "its power"
  if (slice[idx] === 'its' && slice[idx + 1] === 'power') {
    idx += 2;
  } else if (slice[idx] === 'this' && slice[idx + 2] === 'power') {
    // "this creature's power" / "this permanent's power"
    idx += 3;
  } else {
    return null; // Only self-power forms; ForEach / GreatestPower handled elsewhere
  }

  if (slice[idx] === '.') idx++;

  // "[you may] exile a/an [filter] card from among them"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'exile') return null;
  idx++;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;

  // Optional filter words before "card" — same logic as matchLookAtTopExileOneFromAmong
  const TYPE_MAP: Record<string, NonNullable<CardFilter['types']>> = {
    land: ['land'], creature: ['creature'], artifact: ['artifact'],
    enchantment: ['enchantment'], instant: ['instant'], sorcery: ['sorcery'],
    planeswalker: ['planeswalker'],
  };
  const CARD_TYPE_WORDS = new Set([
    'land', 'creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker',
  ]);

  let filter: CardFilter = {};

  // "non-" prefix exclusion (nonland, noncreature)
  if (slice[idx] && slice[idx].startsWith('non') && CARD_TYPE_WORDS.has(slice[idx].slice(3))) {
    const excludedType = slice[idx].slice(3);
    filter = { excludeTypes: [excludedType] };
    idx++;
  } else {
    // Optional first type word
    const firstTypes = slice[idx] ? TYPE_MAP[slice[idx]] : undefined;
    if (firstTypes) {
      const branches: CardFilter[] = [{ types: firstTypes }];
      idx++;
      while (slice[idx] === 'or' && TYPE_MAP[slice[idx + 1]]) {
        branches.push({ types: TYPE_MAP[slice[idx + 1]]! });
        idx += 2;
      }
      filter = branches.length > 1 ? { anyOf: branches } : { types: firstTypes };
    }
  }

  // "card" or "cards"
  if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;

  // Optional mana-value filter: "with mana value N or less" or "with mana value X or less"
  if (slice[idx] === 'with' && slice[idx + 1] === 'mana' && slice[idx + 2] === 'value') {
    const k = parseInt(slice[idx + 3], 10);
    if (!Number.isNaN(k)) {
      idx += 4;
      if (slice[idx] === 'or' && slice[idx + 1] === 'less') {
        filter = { ...filter, cmc: { op: 'lte', value: k } };
        idx += 2;
      } else {
        filter = { ...filter, cmc: { op: 'eq', value: k } };
      }
    } else if (slice[idx + 3] === 'x') {
      // "mana value X or less" — dynamic constraint; skip the clause (honest: we don't enforce it)
      idx += 4;
      if (slice[idx] === 'or' && slice[idx + 1] === 'less') idx += 2;
    }
  }

  // "from among them"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;

  // EXCLUDE: "you may cast that/it without paying its mana cost" (no executor path)
  if (slice[idx] === 'you' && slice[idx + 1] === 'may' && slice[idx + 2] === 'cast') return null;
  if (slice[idx] === '.' && slice[idx + 1] === 'you' && slice[idx + 2] === 'may' && slice[idx + 3] === 'cast') return null;

  if (slice[idx] === '.') idx++;

  // "[and] [put] the rest on the bottom ..." (optional tail; default to 'bottom')
  let restDestination: 'bottom' | 'graveyard' = 'bottom';
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] === 'the' && slice[idx + 1] === 'rest') {
    idx += 2;
    if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
      restDestination = 'bottom';
      idx += 3;
      if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
      if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
      else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
    } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
      restDestination = 'graveyard';
      idx += 3;
    }
    if (slice[idx] === '.') idx++;
  }

  // Re-check for free-cast tail AFTER rest placement
  if (slice[idx] === 'you' && slice[idx + 1] === 'may' && slice[idx + 2] === 'cast') return null;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: { kind: 'TargetPower', target: { kind: 'Source' } },
    destination: 'exile',
    restDestination,
    minSelections: 0,
    maxSelections: 1,
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    selectedCardChoiceId: 'lookTopSelfPowerExileIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 9/12: Reveal-top-N, opponent chooses one (RevealTopDistribute family)
// ============================================================================

/**
 * Slice 9: Match the "reveal-top-N → opponent chooses one" distribute family:
 *
 *   "Reveal the top N cards of your library. An opponent chooses one.
 *    Put that card into your <graveyard|hand> and the rest into your <hand|graveyard>."
 *   (Murmurs from Beyond — graveyard/hand variant)
 *
 *   "Reveal the top N cards of your library. An opponent chooses one of them.
 *    Put that card into your <graveyard|hand> and the rest into your <hand|graveyard>."
 *   (phrasing variant with "of them")
 *
 * Emits a RevealTopDistribute effect with `chosenDestination` (where the
 * opponent's pick goes) and `restDestination` (where the rest go).  The executor
 * reveals exactly N, uses `namedCardChoices['opponentChosenCardId']` if present
 * (so the UI can supply a real opponent decision), or falls back to the AI policy
 * (highest-MV card).
 *
 * DECLINED forms (kept Unparsed for honesty):
 *  - "… separate them into two piles …" (Steam Augury / Fact-or-Fiction): the
 *    pile-split primitive does not exist in the executor.
 *  - Allure-of-the-Unknown exile form ("an opponent exiles a nonland card"): the
 *    chosen card goes to exile; left for a later slice.
 */
export function matchRevealTopDistribute(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 16) return null;

  // "reveal the top N cards of your library"
  let idx = 0;
  if (slice[idx] !== 'reveal') return null;
  idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  const n = parseSmallNumberToken(slice[idx]);
  if (isNaN(n) || n < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "An opponent chooses one [of them]." — must be exactly this pattern
  // (NOT "separate them into two piles" or "exiles a nonland card")
  if (slice[idx] !== 'an' || slice[idx + 1] !== 'opponent') return null;
  idx += 2;
  if (slice[idx] !== 'chooses') return null;
  idx++;
  if (slice[idx] !== 'one') return null;
  idx++;
  // optional "of them"
  if (slice[idx] === 'of' && slice[idx + 1] === 'them') idx += 2;
  if (slice[idx] === '.') idx++;

  // "Put that card into your <graveyard|hand>"
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] !== 'that') return null;
  idx++;
  if (slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your') return null;
  idx += 2;

  let chosenDestination: 'graveyard' | 'hand';
  if (slice[idx] === 'graveyard') {
    chosenDestination = 'graveyard';
  } else if (slice[idx] === 'hand') {
    chosenDestination = 'hand';
  } else {
    return null;
  }
  idx++;

  // "and the rest into your <hand|graveyard>"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your') return null;
  idx += 2;

  let restDestination: 'hand' | 'graveyard';
  if (slice[idx] === 'hand') {
    restDestination = 'hand';
  } else if (slice[idx] === 'graveyard') {
    restDestination = 'graveyard';
  } else {
    return null;
  }
  idx++;

  // chosenDestination and restDestination must be distinct
  if ((chosenDestination as string) === (restDestination as string)) return null;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'RevealTopDistribute',
    player: { kind: 'Controller' },
    count: n,
    chosenDestination,
    restDestination,
    chosenCardChoiceId: 'opponentChosenCardId',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 9: Two-pile opponent-chooses reveal (Steam Augury / Fact-or-Fiction family)
// ============================================================================

/**
 * Match the Steam Augury / Fact-or-Fiction two-pile reveal family:
 *
 *   "Reveal the top N cards of your library and separate them into two piles.
 *    An opponent chooses one of those piles. Put that pile into your hand and
 *    the other into your graveyard."
 *
 *   Also handles the two-sentence form:
 *   "Reveal the top N cards of your library. Separate them into two piles.
 *    An opponent chooses one of those piles. Put that pile into your hand and
 *    the other into your graveyard."
 *
 * Gate:
 *  - Must see "separate them into two piles" (inline after "and" or as its own sentence).
 *  - Must see "an opponent chooses one of those piles" — distinct from the single-card
 *    matchRevealTopDistribute ("an opponent chooses one [of them]").
 *  - Put sentence must reference "that pile" (not "that card").
 *
 * Emits RevealTopSplitTwoPiles with pileChosenDestination and pileOtherDestination.
 * The executor splits revealed cards using namedCardChoices['pileSplitIds'] (pile A),
 * and reads opponent choice from namedCardChoices['opponentChosenPile'] ('A' or 'B').
 * AI fallback: lower-MV cards in pile A; opponent always picks pile B (higher-MV).
 *
 * DECLINED variants:
 *  - "Put a card from that pile into your hand and the rest into your graveyard."
 *    (Truth or Tale) — only one card from chosen pile goes to hand; requires a
 *    nested per-card choice within the chosen pile that the executor cannot run.
 */
export function matchRevealTopSplitTwoPiles(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 18) return null;

  // ── sentence 1: "reveal the top N cards of your library" ──
  let idx = 0;
  if (slice[idx] !== 'reveal') return null;
  idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  const n = parseSmallNumberToken(slice[idx]);
  if (isNaN(n) || n < 1) return null;
  idx++;

  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;

  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;

  // ── "and separate them into two piles" (inline) or "." + "separate them..." ──
  // Accept either inline ("… library and separate them into two piles .") or
  // separate sentence ("… library . separate them into two piles .").
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === '.') idx++;
  // "separate them into two piles"
  if (slice[idx] !== 'separate' || slice[idx + 1] !== 'them' || slice[idx + 2] !== 'into' ||
      slice[idx + 3] !== 'two' || slice[idx + 4] !== 'piles') return null;
  idx += 5;
  if (slice[idx] === '.') idx++;

  // ── "an opponent chooses one of those piles" ──
  // GATE: must say "those piles" (not "one of them" which is matchRevealTopDistribute).
  if (slice[idx] !== 'an' || slice[idx + 1] !== 'opponent') return null;
  idx += 2;
  if (slice[idx] !== 'chooses') return null;
  idx++;
  if (slice[idx] !== 'one') return null;
  idx++;
  // Require "of those piles" to distinguish from single-card form.
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'those' || slice[idx + 2] !== 'piles') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // ── "put that pile into your <hand|graveyard> and the other into your <graveyard|hand>" ──
  if (slice[idx] !== 'put') return null;
  idx++;
  // "that pile" — gate on "pile" (not "card", which belongs to Truth or Tale's variant)
  if (slice[idx] !== 'that' || slice[idx + 1] !== 'pile') return null;
  idx += 2;
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your') return null;
  idx += 2;

  let pileChosenDestination: 'hand' | 'graveyard';
  if (slice[idx] === 'hand') {
    pileChosenDestination = 'hand';
  } else if (slice[idx] === 'graveyard') {
    pileChosenDestination = 'graveyard';
  } else {
    return null;
  }
  idx++;

  // "and the other into your <graveyard|hand>"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'other') return null;
  idx += 2;
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your') return null;
  idx += 2;

  let pileOtherDestination: 'hand' | 'graveyard';
  if (slice[idx] === 'hand') {
    pileOtherDestination = 'hand';
  } else if (slice[idx] === 'graveyard') {
    pileOtherDestination = 'graveyard';
  } else {
    return null;
  }
  idx++;

  // Destinations must differ.
  if ((pileChosenDestination as string) === (pileOtherDestination as string)) return null;

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'RevealTopSplitTwoPiles',
    player: { kind: 'Controller' },
    count: n,
    pileChosenDestination,
    pileOtherDestination,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 12: ETB tutor filter extensions
// Handles three filter/zone variants not covered by matchSearchLibraryGeneric:
//   1. "nonlegendary" negation prefix  (Woodland Bellower style)
//   2. Hyphenated subtype tokens       (Assembly-Worker via Self-Assembler)
//   3. "library and/or graveyard"      (Sun-Blessed Mount named-card dual-zone)
// ============================================================================

/**
 * ETB tutor filter extensions (Slice 12).
 *
 * Handles search clauses whose filter vocabulary falls outside
 * matchSearchLibraryGeneric's existing coverage:
 *
 *   (A) "nonlegendary" negation prefix:
 *       "search your library for a nonlegendary green creature card with mana
 *        value 3 or less, reveal it, put it into your hand, then shuffle."
 *       → excludeSupertypes: ['Legendary'] ANDed with any following color/type
 *         and mana-value bound.
 *
 *   (B) Hyphenated subtype (tokenised as word "-" word):
 *       "search your library for an Assembly-Worker card, reveal it, put it
 *        into your hand, then shuffle."
 *       → subtypes: ['Assembly-Worker']  (joined back at emit time)
 *
 *   (C) "library and/or graveyard" dual-zone with named-card filter:
 *       "search your library and/or graveyard for a card named <X>, reveal it,
 *        put it into your hand, then shuffle."
 *       → names: ['<X>'], searchGraveyard: true
 *
 * Executor: all three variants emit SearchLibrary (+ optional ShuffleLibrary).
 * Case C additionally sets SearchLibraryEffect.searchGraveyard = true so the
 * executor includes graveyard candidates in its search candidates loop.
 * Honesty: every path maps to a CardFilter that matchesCardFilter actually
 * evaluates; no filter is emitted without executor support.
 */
export function matchETBTutorFilterExtensions(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Must start with "search your library"
  if (slice[0] !== 'search' || slice[1] !== 'your' || slice[2] !== 'library') return null;

  let idx = 3;
  let searchGraveyard = false;

  // --- Case C: "library and/or graveyard" dual-zone ---
  if (slice[idx] === 'and/or' && slice[idx + 1] === 'graveyard') {
    searchGraveyard = true;
    idx += 2;
  }

  // Must continue with "for"
  if (slice[idx] !== 'for') return null;
  idx++;

  // Article: "a" or "an"
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;

  let filter: CardFilter = {};

  // -------------------------------------------------------------------------
  // Case C (named card): "a card named <Name>"
  // -------------------------------------------------------------------------
  if (searchGraveyard) {
    // Only the named-card variant is supported for graveyard search.
    if (slice[idx] !== 'card' || slice[idx + 1] !== 'named') return null;
    idx += 2; // past "card named"
    // Collect name tokens until punctuation / action verbs
    const STOP = new Set([',', '.', 'reveal', 'put', 'then', 'shuffle']);
    let nameEnd = idx;
    while (nameEnd < slice.length && !STOP.has(slice[nameEnd])) nameEnd++;
    const name = titleCaseCardName(slice.slice(idx, nameEnd));
    if (!name) return null;
    filter = { names: [name] };
    idx = nameEnd;
  } else {
    // -----------------------------------------------------------------------
    // Cases A and B: standard library-only search with extended filter vocab
    // -----------------------------------------------------------------------

    // Case A: "nonlegendary" negation prefix
    if (slice[idx] === 'nonlegendary') {
      filter = mergeStaticFilters(filter, { excludeSupertypes: ['Legendary'] });
      idx++;
    } else if (slice[idx] === 'legendary') {
      // Pass through to generic — matchSearchLibraryGeneric already handles this.
      return null;
    }

    // If no nonlegendary prefix and not heading toward a hyphenated subtype,
    // we need to detect Case B early to know we should claim this clause.
    const hasNonLegendaryPrefix = filter.excludeSupertypes?.includes('Legendary') ?? false;

    // Optional color qualifier: "green", "red", etc.
    if (COLOR_WORDS[slice[idx]]) {
      const colorCode = COLOR_WORDS[slice[idx]] as 'W' | 'U' | 'B' | 'R' | 'G';
      filter = mergeStaticFilters(filter, { colors: [colorCode] });
      idx++;
    }

    // Optional type word: "creature", "artifact", "enchantment", "instant",
    // "sorcery", "land", "planeswalker"
    const TYPE_WORDS: Record<string, string> = {
      creature: 'creature', artifact: 'artifact', enchantment: 'enchantment',
      instant: 'instant', sorcery: 'sorcery', land: 'land', planeswalker: 'planeswalker',
    };
    if (TYPE_WORDS[slice[idx]]) {
      filter = mergeStaticFilters(filter, { types: [TYPE_WORDS[slice[idx]]] });
      idx++;
    }

    // -----------------------------------------------------------------------
    // Detect Case B: hyphenated subtype "Word - Word" → "Word-Word"
    // e.g. ["assembly", "-", "worker"] → subtypes: ["Assembly-Worker"]
    // -----------------------------------------------------------------------
    const isHyphenSubtype = (
      slice[idx] !== undefined
      && slice[idx + 1] === '-'
      && slice[idx + 2] !== undefined
      && /^[a-z]+$/.test(slice[idx])
      && /^[a-z]+$/.test(slice[idx + 2])
    );

    if (isHyphenSubtype) {
      const part1 = slice[idx].charAt(0).toUpperCase() + slice[idx].slice(1);
      const part2 = slice[idx + 2].charAt(0).toUpperCase() + slice[idx + 2].slice(1);
      filter = mergeStaticFilters(filter, { subtypes: [`${part1}-${part2}`] });
      idx += 3; // consume "word", "-", "word"
    } else if (!hasNonLegendaryPrefix) {
      // No nonlegendary prefix AND no hyphenated subtype → not our clause.
      return null;
    }

    // "card" or "cards" keyword
    if (slice[idx] !== 'card' && slice[idx] !== 'cards') return null;
    idx++;
  }

  // Optional mana-value suffix: "with mana value N or less" / "with mana value X or less"
  const mvResult = parseManaValueXSuffix(slice, idx) ?? parseManaValueFilterSuffix(slice, idx);
  if (mvResult) {
    filter = mergeStaticFilters(filter, mvResult.filter);
    idx = mvResult.nextIndex;
  }

  // Optional comma then reveal clause: "reveal it" / ", reveal it,"
  if (slice[idx] === ',') idx++;
  if (slice[idx] === 'reveal') {
    idx++;
    if (slice[idx] === 'it') idx++;
    if (slice[idx] === ',') idx++;
  }

  // Destination clause: "put it into your hand" / "put it onto the battlefield [tapped]"
  let destination: 'hand' | 'battlefield' | 'top' | 'graveyard' = 'hand';
  let tapped = false;

  if (slice[idx] === 'put') {
    idx++;
    if (slice[idx] === 'it' || slice[idx] === 'them') idx++;
    if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'hand') {
      destination = 'hand';
      idx += 3;
    } else if (slice[idx] === 'onto' && slice[idx + 1] === 'the' && slice[idx + 2] === 'battlefield') {
      destination = 'battlefield';
      idx += 3;
      if (slice[idx] === 'tapped') { tapped = true; idx++; }
    }
  }

  if (slice[idx] === ',') idx++;

  // Shuffle: "then shuffle" / "shuffle" (with optional "your library")
  let shuffle = false;
  if (slice[idx] === 'then' && slice[idx + 1] === 'shuffle') {
    shuffle = true;
    idx += 2;
  } else if (slice[idx] === 'shuffle') {
    shuffle = true;
    idx++;
  }
  if (shuffle && slice[idx] === 'your' && slice[idx + 1] === 'library') idx += 2;
  if (slice[idx] === '.') idx++;

  const searchEffect: Effect = {
    kind: 'SearchLibrary',
    player: { kind: 'Controller' },
    filter,
    destination,
    tapped,
    shuffle,
    namedCardChoiceId: 'tutorCard',
    selectedCardChoiceId: 'tutorCardId',
    ...(searchGraveyard ? { searchGraveyard: true } : {}),
  };

  const effects: Effect[] = [searchEffect];
  // Graveyard destination from tutor effects is not "top" — shuffle always applies
  // when the tutor puts a card into hand or onto the battlefield.
  const effectiveDest: string = destination;
  if (shuffle && effectiveDest !== 'top') {
    effects.push({ kind: 'ShuffleLibrary', player: { kind: 'Controller' } });
  }

  return { effects, targets: [], consumed: idx };
}

// ============================================================================
// Slice 2/12 (trigger/ETB dig sub-shapes)
// Covers two new body shapes that appear as trigger/ETB tails:
//   A) look-top-X-where-X-is-self-power + any-number-of-<type>-cards-to-hand
//      (Keldon Flamesage)
//   B) look-top-card + you-may-play-a-land-from-top-this-turn + if-not-land-graveyard
//      (Ziatora's Envoy) — honest no-grant: land goes to hand, non-land to graveyard
// ============================================================================

/**
 * Slice 2/12 (trigger/ETB dig sub-shape A): Keldon Flamesage family.
 *
 * Matches:
 *   "Look at the top X cards of your library, where X is this creature's power
 *    [/ its power]. You may put any number of <type> cards from among them into
 *    your hand. Put the rest on the bottom of your library [in a random order]."
 *
 * Also handles "any number of them" (no type filter).
 *
 * Emits ChooseFromTopOfLibrary with:
 *   count  = { kind: 'TargetPower', target: { kind: 'Source' } }
 *   filter = { types: [<type>] }   (omitted when "any number of them")
 *   maxSelections = 999
 *   restDestination = 'bottom'
 *
 * The executor resolves TargetPower{Source} via sourceInstanceId (already
 * plumbed in executeChooseFromTopOfLibrary via resolveAmount).
 */
export function matchLookAtTopSelfPowerAnyNumberToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 18) return null;

  // "look at the top x cards of your library" / "reveal the top x cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  if (slice[idx] !== 'x') return null;
  idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;

  // ", where X is [this creature's power | this permanent's power | its power]"
  if (slice[idx] === ',') idx++;
  if (slice[idx] !== 'where' || slice[idx + 1] !== 'x' || slice[idx + 2] !== 'is') return null;
  idx += 3;

  // "its power" or "this creature's/permanent's power"
  if (slice[idx] === 'its' && slice[idx + 1] === 'power') {
    idx += 2;
  } else if (slice[idx] === 'this' && slice[idx + 2] === 'power') {
    // "this creature's power" / "this permanent's power"
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  // "[you may] put any number of [<type> cards | them] [from among them] into your hand"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] !== 'any' || slice[idx + 1] !== 'number' || slice[idx + 2] !== 'of') return null;
  idx += 3;

  // Optional type filter word(s)
  const TYPE_MAP: Record<string, NonNullable<CardFilter['types']>> = {
    land: ['land'], lands: ['land'],
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    instant: ['instant'], instants: ['instant'],
    sorcery: ['sorcery'], sorceries: ['sorcery'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };

  let filter: CardFilter | undefined;
  let skipFromAmongThem = false;

  if (slice[idx] === 'them') {
    // "any number of them" — no type filter
    skipFromAmongThem = true;
    idx++;
  } else {
    const types = TYPE_MAP[slice[idx]];
    if (types) {
      filter = { types };
      idx++;
    }
    // "card" / "cards"
    if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;
  }

  // "from among them" (optional when "of them" was consumed)
  if (!skipFromAmongThem) {
    if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
    idx += 3;
  }

  // "into your hand"
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "[and] [put] the rest on the bottom [of your library] [in a random/any order]"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  if (slice[idx] !== 'on' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'bottom') return null;
  idx += 3;
  if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
  if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
  else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: { kind: 'TargetPower', target: { kind: 'Source' } },
    destination: 'hand',
    restDestination: 'bottom',
    minSelections: 0,
    maxSelections: 999,
    ...(filter ? { filter } : {}),
    selectedCardChoiceId: 'lookTopSelfPowerAnyNumberToHandIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 2/12 (trigger/ETB dig sub-shape B): Ziatora's Envoy family.
 *
 * Matches:
 *   "Look at the top card of your library. You may play a land from the top of
 *    your library this turn. If that card is not a land, put it into your graveyard."
 *
 * HONESTY: "you may play a land from the top this turn" is a temporary permission
 * grant that would require a new enforcement subsystem. Per slice-2 instructions,
 * this rider is absorbed as an honest no-grant tail: the land is moved to hand
 * instead of being played directly (a visible simplification). The conditional
 * graveyard for non-lands IS modeled honestly via ChooseFromTopOfLibrary with
 * filter={types:['land']}, destination='hand', restDestination='graveyard'.
 *
 * Emits ChooseFromTopOfLibrary with:
 *   count  = 1
 *   filter = { types: ['land'] }
 *   destination = 'hand'   (honest no-grant: land to hand rather than played)
 *   restDestination = 'graveyard'
 *   minSelections = 0
 *   maxSelections = 1
 */
export function matchLookAtTopCardPlayLandOrGraveyard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "look at the top card of your library"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at') return null;
  idx += 2;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top' || slice[idx + 2] !== 'card') return null;
  idx += 3;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "you may play a land from the top of your library this turn"
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'may' || slice[idx + 2] !== 'play') return null;
  idx += 3;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;
  if (slice[idx] !== 'land') return null;
  idx++;
  // "from the top of your library this turn"
  if (slice[idx] === 'from' && slice[idx + 1] === 'the' && slice[idx + 2] === 'top') {
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
  }
  if (slice[idx] === 'this' && slice[idx + 1] === 'turn') idx += 2;
  if (slice[idx] === '.') idx++;

  // "if that card is not a land, put it into your graveyard."
  if (slice[idx] !== 'if') return null;
  idx++;
  if (slice[idx] === 'that') idx++;
  if (slice[idx] === 'card') idx++;
  if (slice[idx] === 'is') idx++;
  if (slice[idx] === 'not') idx++;
  if (slice[idx] === 'a' || slice[idx] === 'an') idx++;
  if (slice[idx] !== 'land') return null;
  idx++;
  if (slice[idx] === ',') idx++;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] === 'it') idx++;
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'graveyard') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: 1,
    filter: { types: ['land'] },
    destination: 'hand',
    restDestination: 'graveyard',
    minSelections: 0,
    maxSelections: 1,
    selectedCardChoiceId: 'lookTopCardPlayLandOrGraveyardIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 6/12: Library-dig leftovers — "Look at top N … put one into hand,
// rest on bottom/top" homogeneous sub-family.
// ============================================================================

/**
 * Slice 6/12: Match the "twice the number of <filter>" X-definition family:
 *   "Look at the top X cards of your library, where X is twice the number of
 *    lands you control. Put one of them into your hand and the rest on the
 *    bottom of your library in any order."   (Pillage the Bog)
 *
 * The "twice" multiplier is modelled via ForEachAmount.multiplier=2, which
 * resolveForEachCount applies at resolution time.  The take is exactly one
 * card (minSelections=1, maxSelections=1), rest goes on bottom.
 *
 * Only claims the specific "where X is twice the number of <filter> you
 * control" form; any other "twice" wording returns null (honest gate).
 */
export function matchLookAtTopTwiceNumberOfToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 22) return null;

  // "look at the top x cards of your library"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at') return null;
  idx += 2;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;
  if (slice[idx] !== 'x') return null;
  idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;

  // ", where x is twice the number of <filter> you control"
  if (slice[idx] === ',') idx++;
  if (slice[idx] !== 'where' || slice[idx + 1] !== 'x' || slice[idx + 2] !== 'is') return null;
  idx += 3;
  if (slice[idx] !== 'twice') return null;
  idx++;
  // "the number of <filter> you control" — delegate to parseNumberOfFilterAmount
  const countResult = parseNumberOfFilterAmount(slice, idx);
  if (!countResult) return null;
  const baseCount: ForEachAmount = { ...countResult.amount, multiplier: 2 };
  idx = countResult.nextIndex;
  if (slice[idx] === '.') idx++;

  // "put [up to] one of them into your hand"
  if (slice[idx] === 'put') idx++;
  else return null;
  let upTo = false;
  if (slice[idx] === 'up' && slice[idx + 1] === 'to') { upTo = true; idx += 2; }
  if (slice[idx] !== 'one') return null;
  idx++;
  // "of them" / "of those cards"
  if (slice[idx] === 'of') {
    idx++;
    if (slice[idx] === 'them') idx++;
    else if (slice[idx] === 'those' && (slice[idx + 1] === 'cards' || slice[idx + 1] === 'card')) idx += 2;
    else return null;
  }
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "and the rest on the bottom [of your library] [in any order / in a random order]"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard' = 'bottom';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const minSel = upTo ? 0 : 1;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: baseCount,
    destination: 'hand',
    restDestination,
    minSelections: minSel,
    maxSelections: 1,
    fallbackSelectionCount: 1,
    selectedCardChoiceId: 'lookTopTwiceNumberOfToHandIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 6/12: Match "Look at the top N cards of your library. Put those cards /
 * all of them on the bottom of your library in any order."  (Lim-Dûl's Vault
 * style — look then bottom ALL revealed cards in any order; no card is kept.)
 *
 * This is the "reorder to bottom" analogue of matchLookAtTopReorderBack (which
 * puts all cards back ON TOP).  Emits ChooseFromTopOfLibrary with
 * maxSelections=0 and restDestination='bottom', so all N cards go to the
 * bottom of the library in any order.
 *
 * Supported wording variants:
 *   "Put those cards on the bottom of your library in any order."
 *   "Put them on the bottom of your library in any order."
 *   "Put all of them on the bottom of your library in any order."
 *   "Put the top N cards on the bottom of your library in any order."
 *
 * NOTE: Does NOT claim "put them back in any order" (handled by
 * matchLookAtTopReorderBack which targets the top-of-library destination),
 * nor does it claim "put them in a random order" (handled by that same family).
 */
export function matchLookAtTopAllOnBottom(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 12) return null;

  // "look at the top N cards of your library"
  let idx = 0;
  if (slice[idx] !== 'look' || slice[idx + 1] !== 'at') return null;
  idx += 2;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  let count: AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;

  // Optional ", where X is ..." X-definition for X-based look
  if (slice[idx] === ',') {
    const whereResult = parseWhereXIsNumberOf(slice, idx);
    if (whereResult && (count as {kind?:string}).kind === 'X') {
      count = whereResult.amount;
      idx = whereResult.nextIndex;
    }
  }
  if (slice[idx] === '.') idx++;

  // "put those cards / them / all of them / the top N cards on the bottom of your library in any order"
  if (slice[idx] !== 'put') return null;
  idx++;

  // Accept: "those cards", "them", "all of them", "all those cards"
  let foundSubject = false;
  if (slice[idx] === 'those' && (slice[idx + 1] === 'cards' || slice[idx + 1] === 'card')) {
    idx += 2; foundSubject = true;
  } else if (slice[idx] === 'them') {
    idx++; foundSubject = true;
  } else if (slice[idx] === 'all' && slice[idx + 1] === 'of' && slice[idx + 2] === 'them') {
    idx += 3; foundSubject = true;
  } else if (slice[idx] === 'all' && slice[idx + 1] === 'those' && (slice[idx + 2] === 'cards' || slice[idx + 2] === 'card')) {
    idx += 3; foundSubject = true;
  }
  if (!foundSubject) return null;

  // "on the bottom of your library in any order"
  if (slice[idx] !== 'on' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'bottom') return null;
  idx += 3;
  if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
  // Must have "in any order" (distinguishes from "in a random order" which means shuffle-like)
  if (slice[idx] !== 'in' || slice[idx + 1] !== 'any' || slice[idx + 2] !== 'order') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'hand',      // unused (maxSelections=0 — no card goes to hand)
    restDestination: 'bottom', // all N cards go to bottom
    minSelections: 0,
    maxSelections: 0,
    fallbackSelectionCount: 0,
    selectedCardChoiceId: 'lookTopAllOnBottomIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 2/12: "put all <type> cards from among them onto the battlefield [tapped]"
// Covers: Animist's Awakening ("put all land cards from among them onto the
// battlefield tapped and the rest on the bottom of your library in a random order.")
// and similar "all <type> onto battlefield" forms with rest on bottom/graveyard.
//
// DISTINCT from matchRevealTopAnyNumberOntoBattlefield ("any number of <type>"):
//  - this matcher requires the "all" keyword (auto-selects every matching card)
//  - handles the "onto the battlefield tapped and the rest on the bottom" phrasing
//    where "and" appears between "tapped" and "the rest"
//
// DISTINCT from matchLookAtTopAnyNumberMultiTypeOntoBattlefield (multi-type anyOf):
//  - this matcher handles single-type "all <type>" and also a compound
//    "noncreature <type>" form (e.g. "noncreature artifact") via excludeTypes.
//
// HONESTY GUARD: manifest-dread wordings are not claimed here.
// ============================================================================

/**
 * Slice 2: Match "reveal/look at top N/X ... put all <type> [noncreature]
 * cards from among them onto the battlefield [tapped] and the rest on the
 * bottom/into your graveyard" family.
 *
 * Examples:
 *   Animist's Awakening:
 *     "Reveal the top X cards of your library. Put all land cards from among
 *      them onto the battlefield tapped and the rest on the bottom of your
 *      library in a random order."
 *
 *   (Future form, same structure, graveyard rest):
 *     "Reveal the top N cards of your library. Put all creature cards from
 *      among them onto the battlefield and the rest into your graveyard."
 *
 * Emits ChooseFromTopOfLibrary with destination='battlefield', filter, tapped,
 * maxSelections=999 (all matching), restDestination='bottom'|'graveyard'.
 * Executor: auto-selects every revealed card matching the filter (full ETB).
 * Honest: only permanent types accepted (instants/sorceries never enter the bf).
 */
export function matchDigTopPutAllOntoBattlefield(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "reveal the top N/X cards of your library" / "look at the top N/X cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  let count: AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "[you may] put all <type> [card(s)] from among them onto the battlefield"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] !== 'all') return null;
  idx++;

  // Honest: only permanent types can enter the battlefield.
  const PERMANENT_TYPES: Record<string, NonNullable<CardFilter['types']>> = {
    land: ['land'], lands: ['land'],
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };
  const CARD_TYPE_WORDS = new Set(['land', 'lands', 'creature', 'creatures', 'artifact', 'artifacts', 'enchantment', 'enchantments', 'planeswalker', 'planeswalkers']);

  let filter: CardFilter;

  // Optional "noncreature" (or other non<type>) prefix — compound filter
  if (slice[idx] && slice[idx].startsWith('non') && CARD_TYPE_WORDS.has(slice[idx].slice(3))) {
    const excludedType = slice[idx].slice(3);
    filter = { excludeTypes: [excludedType] };
    idx++;
    // The following type word (e.g. "artifact" in "noncreature artifact") is the main type
    const mainTypes = PERMANENT_TYPES[slice[idx]];
    if (!mainTypes) return null; // require a recognized permanent type
    filter = { ...filter, types: mainTypes };
    idx++;
  } else if (slice[idx] === 'permanent' || slice[idx] === 'permanents') {
    filter = { permanent: true };
    idx++;
  } else {
    const types = PERMANENT_TYPES[slice[idx]];
    if (!types) return null; // must be a recognized permanent type (no instants/sorceries)
    filter = { types };
    idx++;
  }

  // "card(s)"
  if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;

  // "from among them"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;

  // "onto the battlefield [tapped]"
  if (slice[idx] !== 'onto' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'battlefield') return null;
  idx += 3;
  let tapped = false;
  if (slice[idx] === 'tapped') { tapped = true; idx++; }
  if (slice[idx] === ',') idx++;
  if (slice[idx] === '.') idx++;

  // "and the rest on the bottom ..." / "and the rest into your graveyard"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;
  let restDestination: 'bottom' | 'graveyard' = 'bottom';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const maxSel = typeof count === 'number' ? count : 999;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'battlefield',
    restDestination,
    minSelections: 0,
    maxSelections: maxSel,
    filter,
    ...(tapped ? { tapped: true } : {}),
    selectedCardChoiceId: 'digTopPutAllBfIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 6/12: Impulse/look dig family additions
// ============================================================================

/**
 * Slice 6: Match the "reveal the top N cards ... put one of them into your hand"
 * NO-REST family (Memories Returning, Impulse-without-rest-clause style):
 *   "Reveal the top five cards of your library. Put one of them into your hand."
 *   (No explicit "put the rest" clause — the rest disposition is left implicit.)
 *
 * This extends matchLookAtTopPutOneIntoHand (which handles "look at the top N")
 * to also cover the "reveal the top N" form when there is NO explicit rest-clause.
 * When a rest clause IS present ("put one ... put the rest into graveyard/bottom"),
 * matchDigTopTakeRest already handles those; this matcher defers to it (the rest
 * clause would be in the same token stream).
 *
 * Uses SearchLibrary (same as matchLookAtTopPutOneIntoHand) with topCount=N and
 * putUnselectedTopCardsOnBottom=true — an honest "take one, rest on bottom" model
 * for the no-rest-clause form.
 *
 * DEFERRED: clauses with an explicit "put the rest" tail are NOT claimed here
 * (matchDigTopTakeRest fires first for those via dispatch order).
 */
export function matchRevealTopPutOneNoRest(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 10) return null;

  // Must start with "reveal the top N cards of your library"
  let idx = 0;
  if (slice[idx] !== 'reveal') return null;
  idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  const revealN = parseSmallNumberToken(slice[idx]);
  if (isNaN(revealN) || revealN < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // Optional filter: "you may reveal a/an [filter] card from among them and"
  let filter: CardFilter = {};

  // Skip optional "you may" before "put"
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;

  // "put one of them into your hand" / "put one into your hand"
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] !== 'one') return null;
  idx++;
  // "of them" is optional
  if (slice[idx] === 'of' && slice[idx + 1] === 'them') idx += 2;
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // DECLINE if a "the rest" rest-clause follows — matchDigTopTakeRest handles those
  if (slice[idx] === 'put' && slice[idx + 1] === 'the' && slice[idx + 2] === 'rest') return null;
  if (slice[idx] === 'the' && slice[idx + 1] === 'rest') return null;
  if (slice[idx] === 'and' && slice[idx + 1] === 'the' && slice[idx + 2] === 'rest') return null;

  const effect: Effect = {
    kind: 'SearchLibrary',
    player: { kind: 'Controller' },
    filter,
    destination: 'hand',
    shuffle: false,
    topCount: revealN,
    putUnselectedTopCardsOnBottom: true,
    selectedCardChoiceId: 'revealTopPutOneNoRestId',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 6: Match the "reveal up to K [filter] cards from among them, then put
 * them into your hand and the rest on the bottom/graveyard" family
 * (Zimone's Experiment, etc.):
 *
 *   "Look at the top five cards of your library. You may reveal up to two
 *    creature and/or land cards from among them, then put them into your hand
 *    and the rest on the bottom of your library in any order."
 *                                                     (Zimone's Experiment)
 *
 *   "Look at the top five cards of your library. You may reveal up to two
 *    creature and/or land cards from among them and put them into your hand.
 *    Put the rest on the bottom of your library in any order."
 *                                                      (alternative phrasing)
 *
 * The "then put them into your hand" / "and put them into your hand" variant
 * differs from matchRevealTopTakeExtended (which handles "put ... from among
 * them into your hand") because the put-into-hand is phrased as a consequence
 * of the reveal ("reveal ... then put them"). matchRevealTopTakeExtended's
 * isRevealThenPut path only fires when the CLAUSE itself starts with "reveal",
 * but here "look at the top N" starts the clause and the inner "reveal up to K"
 * is a nested action after a sentence separator.
 *
 * Emits ChooseFromTopOfLibrary with destination='hand', filter (supporting
 * single-type or and/or multi-type), maxSelections=K, restDestination='bottom'
 * or 'graveyard'. The executor auto-selects revealed cards matching the filter
 * up to maxSelections.
 */
export function matchLookAtTopRevealUpToKFilterToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 20) return null;

  // "look at the top N cards of your library" / "reveal the top N cards ..."
  let idx = 0;
  if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else if (slice[idx] === 'reveal') {
    idx++;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  const revealN = parseSmallNumberToken(slice[idx]);
  if (isNaN(revealN) || revealN < 1) return null;
  idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  // Accept "." separator (could be comma too)
  if (slice[idx] === '.') idx++;
  if (slice[idx] === ',') idx++;

  // "[you may] reveal up to K ..."
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') idx += 2;
  if (slice[idx] !== 'reveal') return null;
  idx++;
  if (slice[idx] !== 'up' || slice[idx + 1] !== 'to') return null;
  idx += 2;

  const takeK = parseSmallNumberToken(slice[idx]);
  if (isNaN(takeK) || takeK < 1) return null;
  idx++;

  // Type filter — one or more types joined by "and/or" or "or"
  const typeMap: Record<string, NonNullable<CardFilter['types']>> = {
    land: ['land'], lands: ['land'],
    creature: ['creature'], creatures: ['creature'],
    artifact: ['artifact'], artifacts: ['artifact'],
    enchantment: ['enchantment'], enchantments: ['enchantment'],
    instant: ['instant'], instants: ['instant'],
    sorcery: ['sorcery'], sorceries: ['sorcery'],
    planeswalker: ['planeswalker'], planeswalkers: ['planeswalker'],
  };

  let filter: CardFilter;
  const firstTypes = typeMap[slice[idx]];
  if (firstTypes) {
    idx++;
    const branches: CardFilter[] = [{ types: firstTypes }];
    // Collect "and/or <type>" or "or <type>" continuations
    while ((slice[idx] === 'and/or' || slice[idx] === 'or') && typeMap[slice[idx + 1]]) {
      branches.push({ types: typeMap[slice[idx + 1]]! });
      idx += 2;
    }
    if (branches.length > 1) {
      filter = { anyOf: branches };
    } else {
      filter = { types: firstTypes };
    }
  } else {
    // No recognized type filter — decline
    return null;
  }

  // "card(s)" word
  if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;

  // "from among them" (required)
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'them') return null;
  idx += 3;

  // Accept optional ",", "." separators
  if (slice[idx] === ',') idx++;
  if (slice[idx] === '.') idx++;

  // "then put them into your hand" OR "and put them into your hand" (both valid phrasings)
  if (slice[idx] === 'then' || slice[idx] === 'and') idx++;
  if (slice[idx] !== 'put') return null;
  idx++;
  if (slice[idx] !== 'them') return null;
  idx++;
  if (slice[idx] !== 'into' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // Rest tail: "[and] [put] the rest on the bottom ..." / "into your graveyard"
  if (slice[idx] === 'and') idx++;
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;

  let restDestination: 'bottom' | 'graveyard';
  if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count: revealN,
    destination: 'hand',
    restDestination,
    minSelections: 0,
    maxSelections: takeK,
    filter,
    selectedCardChoiceId: 'lookTopRevealUpToKFilterToHandIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 11/12 (impulse-from-each-library): Etali / Lidless Gaze / Brainstealer Dragon family
// ============================================================================

/**
 * Match "exile the top card of each player's library" (Lidless Gaze / Etali family)
 * Match "exile the top card of each opponent's library" (Brainstealer Dragon family)
 *
 * This is an HONEST PARTIAL:
 *   - The exile step is fully executed (ExileFromLibrary with EachPlayer / EachOpponent).
 *   - The "you may play those cards" rider is consumed but NOT modeled, because the
 *     engine's play-from-exile permission requires card.ownerId === playerId. Cards
 *     exiled from opponents' libraries are opponent-owned, so the cast-from-exile
 *     check in canCastSpell / canPlayLandDetailed rejects them regardless. Granting
 *     the permission would be a no-op in practice and misleading in coverage metrics.
 *     TODO: model cross-ownership play permission when the engine supports it.
 *
 * Recognised forms (case-insensitive after tokenisation):
 *   "exile the top card of each player's library"
 *   "exile the top card of each opponent's library"
 * Optionally followed by a play-permission rider that is silently consumed:
 *   ". [then] you may [cast/play] [any number of spells from among them | those cards]
 *      [without paying their mana costs] [this turn / until end of turn / until your
 *      next turn / for as long as they remain exiled] [, and mana of any type can be
 *      spent to cast them]"
 *
 * The "then you may cast any number of spells ... without paying their mana costs"
 * (Etali) and "for as long as they remain exiled" (Brainstealer Dragon) variants
 * are all consumed the same way: the rider text is skipped without emitting any
 * effect, so the parse succeeds without fabricating executor support.
 */
export function matchExileTopOfEachLibrary(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "exile the top card of each player's / opponent's library"
  if (slice[0] !== 'exile') return null;
  if (slice[1] !== 'the') return null;
  if (slice[2] !== 'top') return null;
  if (slice[3] !== 'card') return null;
  if (slice[4] !== 'of') return null;
  if (slice[5] !== 'each') return null;

  let playerRef: import('../ast').TargetRef;
  let idx = 7; // after "player's" or "opponent's"

  if (slice[6] === "player's") {
    playerRef = { kind: 'EachPlayer' };
  } else if (slice[6] === "opponent's") {
    playerRef = { kind: 'EachOpponent' };
  } else {
    return null;
  }

  if (slice[idx] !== 'library') return null;
  idx++;

  // Optional "." or "," after "library"
  if (slice[idx] === '.' || slice[idx] === ',') idx++;

  // Silently consume the play-permission rider:
  //   "[then] you may [cast|play] ..." up to the next sentence end or end of tokens.
  // We match "then" (optional) + "you" + "may" as the start of the rider.
  if (slice[idx] === 'then') idx++;
  if (slice[idx] === 'you' && slice[idx + 1] === 'may') {
    // Skip to the next "." (end of rider sentence) or end of token stream.
    while (idx < slice.length && slice[idx] !== '.') idx++;
    if (slice[idx] === '.') idx++;
    // Skip any secondary clause that follows (e.g. ", and mana of any type can be spent to cast them.")
    if (slice[idx] === 'and' || (slice[idx] === ',' && slice[idx + 1] === 'and')) {
      if (slice[idx] === ',') idx++;
      // skip "and ... ."
      while (idx < slice.length && slice[idx] !== '.') idx++;
      if (slice[idx] === '.') idx++;
    }
  }

  const effect: Effect = {
    kind: 'ExileFromLibrary',
    player: playerRef,
    count: 1,
    // mayPlay intentionally NOT set — cross-ownership play permission not supported.
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 3/12: "exile N of them at random, then put the rest on top of your
// library in any order" — Orcish Librarian activated-ability shape.
//
// Also covers:
//   destination='exile', restDestination='top' — the exile-N-at-random tail
// for the broader look-top family.
// ============================================================================

/**
 * Slice 3/12: Match the "exile N of them at random" family:
 *   "Look at the top N cards of your library. Exile M of them at random, then
 *    put the rest on top of your library in any order."       (Orcish Librarian)
 *
 * "at random" means the engine auto-selects exactly M cards (no player choice).
 * Models this via ChooseFromTopOfLibrary with:
 *   destination    = 'exile'
 *   restDestination = 'top'
 *   minSelections  = M   (mandatory auto-selection)
 *   maxSelections  = M
 *   fallbackSelectionCount = M   (auto-picks first M revealed)
 *
 * The executor reveals N cards, exiles the first M, and returns the rest on top.
 * This is honest: "at random" → engine chooses deterministically from the revealed
 * order (same as the fallback path used for other mandatory-selection effects).
 *
 * Works in both Spell context AND activated-ability context because
 * parseMultipleEffects → parseEffectClause reaches this matcher regardless of
 * parse entry point.
 *
 * DECLINED patterns (no executor path):
 *   - "exile ... then you may cast a card exiled this way without paying its mana cost"
 *   - "exile ... becomes plotted" / "manifest" tails
 */
export function matchLookAtTopExileNRestTop(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 16) return null;

  // "look at the top N cards of your library" / "reveal the top N cards ..."
  let idx = 0;
  if (slice[idx] === 'reveal') {
    idx++;
  } else if (slice[idx] === 'look' && slice[idx + 1] === 'at') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'top') return null;
  idx += 2;

  let count: AmountRef;
  if (slice[idx] === 'x') {
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx]);
    if (isNaN(n) || n < 1) return null;
    count = n;
    idx++;
  }
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'library') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  // "exile M of them at random" / "exile M of them at random , then"
  if (slice[idx] !== 'exile') return null;
  idx++;
  const exileM = parseSmallNumberToken(slice[idx]);
  if (isNaN(exileM) || exileM < 1) return null;
  idx++;
  if (slice[idx] !== 'of') return null;
  idx++;
  if (slice[idx] !== 'them') return null;
  idx++;
  // "at random" is required to qualify for this matcher (distinguishes from
  // matchLookAtTopExileOneFromAmong which handles chosen "exile a <filter> card")
  if (slice[idx] !== 'at' || slice[idx + 1] !== 'random') return null;
  idx += 2;
  if (slice[idx] === ',') idx++;
  if (slice[idx] === 'then') idx++;
  if (slice[idx] === '.') idx++;

  // Decline free-cast riders (no executor path)
  if (slice[idx] === 'you' && slice[idx + 1] === 'may' && slice[idx + 2] === 'cast') return null;

  // "[put] the rest on top of your library [in any order] / [in a random order]"
  if (slice[idx] === 'put') idx++;
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'rest') return null;
  idx += 2;

  let restDestination: 'top' | 'bottom' | 'graveyard' = 'top';
  if (slice[idx] === 'on' && slice[idx + 1] === 'top') {
    restDestination = 'top';
    idx += 2;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
  } else if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'bottom') {
    restDestination = 'bottom';
    idx += 3;
    if (slice[idx] === 'of' && slice[idx + 1] === 'your' && slice[idx + 2] === 'library') idx += 3;
    if (slice[idx] === 'in' && slice[idx + 1] === 'any' && slice[idx + 2] === 'order') idx += 3;
    else if (slice[idx] === 'in' && slice[idx + 1] === 'a' && slice[idx + 2] === 'random' && slice[idx + 3] === 'order') idx += 4;
  } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    restDestination = 'graveyard';
    idx += 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ChooseFromTopOfLibrary',
    player: { kind: 'Controller' },
    count,
    destination: 'exile',
    restDestination,
    minSelections: exileM,   // mandatory: "at random" → auto-select exactly exileM
    maxSelections: exileM,
    fallbackSelectionCount: exileM,
    selectedCardChoiceId: 'lookTopExileNAtRandomIds',
  };

  return { effects: [effect], targets: [], consumed: idx };
}
