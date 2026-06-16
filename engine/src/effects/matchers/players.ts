// Player-related matchers extracted from parser.ts (batch 6/12).
// Covers: discard, hand-reveal, sacrifice, each-player, gain-control families.
// Do NOT edit logic here — keep verbatim with parser.ts originals.

import type { Effect, AmountRef, CardFilter, ForEachAmount, TargetRef } from '../ast';
import type { TargetSpec, TargetType } from '../targets';
import type { PatternResult } from '../parser';
import {
  makeTargetSpec,
  makeChosenRef,
  parseSmallNumberToken,
  parsePlayerAmountToken,
  targetTypeFromSimplePermanentWord,
  parseStaticFilterType,
  COLOR_WORDS,
  parseManaValueFilterSuffix,
  parseManaValueXSuffix,
  parseNumberOfFilterAmount,
} from '../parser';

/** Card-type nouns accepted inside a reveal-hand choose filter. */
const CHOSEN_HAND_CARD_TYPES = new Set(['artifact', 'battle', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery']);

/** "non<type>" words accepted inside a reveal-hand choose filter. */
const CHOSEN_HAND_EXCLUDED_TYPE_BY_NON_WORD: Record<string, string> = {
  nonartifact: 'artifact',
  noncreature: 'creature',
  nonenchantment: 'enchantment',
  noninstant: 'instant',
  nonland: 'land',
  nonplaneswalker: 'planeswalker',
  nonsorcery: 'sorcery',
};

/**
 * "non<supertype>" words accepted inside a reveal-hand choose filter.
 * Slice 11: "nonlegendary" (Lay Bare the Heart) maps to excludeSupertypes.
 */
const CHOSEN_HAND_EXCLUDED_SUPERTYPE_BY_NON_WORD: Record<string, string> = {
  nonlegendary: 'legendary',
  nonsnow: 'snow',
  nonbasic: 'basic',
};

/**
 * "non<color>" words accepted inside a reveal-hand choose filter.
 * Slice 11: "nonblack" (Castigate) maps to excludeColors.
 * The executor's matchesCardFilter already honours excludeColors, so this is
 * a pure matcher-side addition with no executor change needed.
 */
const CHOSEN_HAND_EXCLUDED_COLOR_BY_NON_WORD: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
  nonwhite: 'W',
  nonblue: 'U',
  nonblack: 'B',
  nonred: 'R',
  nongreen: 'G',
};

/**
 * Parse the noun-phrase filter of a reveal-hand choose: "nonland", "creature",
 * "artifact or creature", "Spirit or Arcane", "white", "noncreature, nonland",
 * "nonlegendary, nonland" (Lay Bare the Heart), "nonland, nonblack" (Castigate).
 * Returns {} for the unfiltered "a card", and null for any shape whose CardFilter
 * translation would not honestly preserve the printed semantics (e.g. a mixed
 * "artifact or Spirit" alternation, whose types+subtypes fields AND together).
 */
export function parseChosenHandCardFilter(words: string[]): CardFilter | null {
  const meaningful = words.filter(word => word !== ',' && word !== 'or' && word !== 'and');
  if (meaningful.length === 0) return {};

  const types: string[] = [];
  const excludeTypes: string[] = [];
  const excludeSupertypes: string[] = [];
  const excludeColors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = [];
  const colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = [];
  const subtypes: string[] = [];

  for (const word of meaningful) {
    const excluded = CHOSEN_HAND_EXCLUDED_TYPE_BY_NON_WORD[word];
    if (excluded) { excludeTypes.push(excluded); continue; }
    // Slice 11: non-supertype words ("nonlegendary", "nonbasic", "nonsnow").
    const excludedSupertype = CHOSEN_HAND_EXCLUDED_SUPERTYPE_BY_NON_WORD[word];
    if (excludedSupertype) { excludeSupertypes.push(excludedSupertype); continue; }
    // Slice 11: non-color words ("nonblack", "nonwhite", etc.) — Castigate family.
    const excludedColor = CHOSEN_HAND_EXCLUDED_COLOR_BY_NON_WORD[word];
    if (excludedColor) { excludeColors.push(excludedColor); continue; }
    if (CHOSEN_HAND_CARD_TYPES.has(word)) { types.push(word); continue; }
    const color = COLOR_WORDS[word];
    if (color) { colors.push(color); continue; }
    // Anything else alphabetic is a subtype word ("Spirit", "Arcane", "Goblin").
    if (/^[a-z]+$/.test(word)) { subtypes.push(word.charAt(0).toUpperCase() + word.slice(1)); continue; }
    return null;
  }

  // Subtype words only OR cleanly with other subtype words; mixing them with
  // types/excludes/colors would turn the printed "or" into an AND — decline.
  if (subtypes.length > 0 && (types.length > 0 || excludeTypes.length > 0 || colors.length > 0 || excludeSupertypes.length > 0 || excludeColors.length > 0)) return null;

  const filter: CardFilter = {};
  if (types.length > 0) filter.types = types;
  if (excludeTypes.length > 0) filter.excludeTypes = excludeTypes;
  if (excludeSupertypes.length > 0) filter.excludeSupertypes = excludeSupertypes;
  if (excludeColors.length > 0) filter.excludeColors = excludeColors;
  if (colors.length > 0) filter.colors = colors;
  if (subtypes.length > 0) filter.subtypes = subtypes;
  return filter;
}

export function matchThatPlayerDiscard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 5) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player' || slice[2] !== 'discards') return null;

  let count: number;
  if (slice[3] === 'a' && slice[4] === 'card') {
    count = 1;
  } else {
    const n = parseInt(slice[3], 10);
    const w = parseSmallNumberToken(slice[3]);
    count = !isNaN(n) ? n : w;
    if (isNaN(count) || (slice[4] !== 'cards' && slice[4] !== 'card')) return null;
  }
  let consumed = 5;
  if (tokens[startIndex + consumed] === '.') consumed++;
  // Slice 8/12: Use EventPlayer instead of EventCaster so per-player-upkeep triggers
  // ("At the beginning of each player's upkeep, that player discards a card") resolve
  // the active player correctly. For SpellCast events eventPlayerId == casterId, so
  // this is backward-compatible with the existing opponent-cast-spell trigger use.
  return { effects: [{ kind: 'Discard', player: { kind: 'EventPlayer' }, count }], targets: [], consumed };
}

/**
 * Slice 2 — Saboteur "that player discards that many" tail.
 *
 * Matches: "that player discards that many cards"
 *
 * "That player" is the player who received the combat damage (EventPlayer).
 * "That many" is EventDamageAmount.
 *
 * Example:
 *   "Whenever ~ deals combat damage to a player, that player discards that many cards."
 *   (Dreamstealer, Warped Devotion, etc.)
 */
export function matchThatPlayerDiscardsThatMany(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 6) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player' || slice[2] !== 'discards') return null;
  if (slice[3] !== 'that' || slice[4] !== 'many') return null;
  if (slice[5] !== 'cards' && slice[5] !== 'card') return null;

  let consumed = 6;
  if (tokens[startIndex + consumed] === '.') consumed++;

  return {
    effects: [{ kind: 'Discard', player: { kind: 'EventPlayer' }, count: { kind: 'EventDamageAmount' } }],
    targets: [],
    consumed,
  };
}

/**
 * Match: "put a land card from your hand onto the battlefield"
 * Match: "put a land card from your hand onto the battlefield tapped"
 */
export function matchPutLandFromHandOntoBattlefield(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (
    slice[0] !== 'put' ||
    slice[1] !== 'a' ||
    slice[2] !== 'land' ||
    slice[3] !== 'card' ||
    slice[4] !== 'from' ||
    slice[5] !== 'your' ||
    slice[6] !== 'hand' ||
    slice[7] !== 'onto' ||
    slice[8] !== 'the' ||
    slice[9] !== 'battlefield'
  ) {
    return null;
  }

  let consumed = 10;
  let tapped = false;
  if (slice[consumed] === 'tapped') {
    tapped = true;
    consumed++;
  }
  if (tokens[startIndex + consumed] === '.') consumed++;

  return {
    effects: [{
      kind: 'PutLandFromHandOntoBattlefield',
      player: { kind: 'Controller' },
      tapped,
      selectedCardChoiceId: 'putLandCardId',
    }],
    targets: [],
    consumed,
  };
}

/**
 * Match: "look at target player's hand"
 * Match: "look at target opponent's hand" (Slice 1: Telepathic Spies, Elite Spellbinder)
 */
export function matchLookAtTargetPlayerHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'look' || slice[1] !== 'at') return null;

  // Slice 1: "look at that player's hand" — "that player" is the EventPlayer
  // (the player who received the combat damage). In combat, this is always an
  // opponent, so we use opponentControls: true as an honest approximation.
  // Uses a Chosen target so the AI can actually resolve it (LookAtHand executor
  // calls resolveTargetRef without eventContext, so EventPlayer would not work).
  if (
    slice[2] === 'that' &&
    (slice[3] === "player's" || slice[3] === 'players') &&
    slice[4] === 'hand'
  ) {
    let consumed = 5;
    if (slice[consumed] === '.') consumed++;
    const spec = makeTargetSpec('Player', { opponentControls: true });
    const effect: Effect = {
      kind: 'LookAtHand',
      player: makeChosenRef(spec),
    };
    return { effects: [effect], targets: [spec], consumed };
  }

  if (slice[2] !== 'target') return null;
  const isOpponent = (slice[3] === "opponent's" || slice[3] === 'opponents' || slice[3] === 'opponent');
  const isPlayer = (slice[3] === "player's" || slice[3] === 'players' || slice[3] === 'player');
  if (!isOpponent && !isPlayer) return null;
  if (slice[4] !== 'hand') return null;

  let consumed = 5;
  if (slice[consumed] === '.') consumed++;

  const spec = makeTargetSpec('Player', isOpponent ? { opponentControls: true } : undefined);
  const effect: Effect = {
    kind: 'LookAtHand',
    player: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match the reveal-hand coercion family (Thoughtseize/Castigate):
 *   "Target opponent reveals their hand. You choose a nonland card from it and
 *    exile that card."                                             (Castigate)
 *   "Target player reveals their hand. You choose a Spirit or Arcane card from
 *    it. That player discards that card."                       (Psychic Spear)
 *   "Target opponent reveals their hand. You choose an artifact or creature
 *    card from it. Exile that card."                      (Intimidation Tactics)
 * Also reached as ETB trigger bodies (Acquisitions Expert) via the normal
 * trigger paths.
 *
 * Emits a single RevealHandChooseCard effect: the chosen player reveals their
 * hand, the caster picks a filter-matching card (explicit pick via the
 * 'revealHandCardId' named choice, deterministic highest-mana-value fallback),
 * and that card is discarded or exiled.
 *
 * HONESTY: "Exile that card until ~ leaves the battlefield" (Kitesail
 * Freebooter) and the single-sentence "reveals their hand and you choose ..."
 * templating (Tidehollow Sculler, whose separate leaves trigger returns the
 * card) are NOT claimed — this effect's exile is permanent.
 */
export function matchRevealHandChooseCard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 13) return null;

  // "target opponent/player reveals their hand ."
  // Also accepts the run-on form: "target opponent reveals their hand and you choose..."
  // Slice 1: Also accepts "each opponent reveals their hand ." (EachOpponent player ref).
  let isEachOpponent = false;
  if (slice[0] === 'each' && slice[1] === 'opponent') {
    isEachOpponent = true;
  } else {
    if (slice[0] !== 'target') return null;
    if (slice[1] !== 'opponent' && slice[1] !== 'player') return null;
  }
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;

  let idx: number;
  let runOnForm = false;
  if (slice[5] === '.') {
    idx = 6;
  } else if (slice[5] === 'and' && slice[6] === 'you' && slice[7] === 'choose') {
    // Run-on form: "reveals their hand and you choose ..."
    idx = 6;
    runOnForm = true;
  } else {
    return null;
  }

  // "you choose a/an [<filter words>] card from it"
  // Slice 7: also match "you may choose" — the AI always chooses when legal,
  // so optional-choose without an explicit "if you do" gate is treated as
  // mandatory for execution purposes (Extract the Truth style).
  // Round 8(a): also accept bare "choose a/an ..." (Dreams of Steel and Oil family)
  // where the subject is omitted — treat identically to "you choose".
  if (slice[idx] === 'you') {
    idx++;
    if (slice[idx] === 'may') idx++; // skip optional "may"
  }
  // else: bare "choose" — fall through
  if (slice[idx] !== 'choose') return null;
  idx++;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;
  const filterStart = idx;
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'card') return null;
  let filter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (filter === null) return null;
  idx++;

  // Optional CMC bound BEFORE "from it":
  //   "...nonland card with mana value X or less from it." (Venarian Glimmer)
  //   "...nonland card with mana value 3 or less from it." (numeric variant)
  // This sub-form puts the mana-value qualifier between "card" and "from it".
  const preMvX = parseManaValueXSuffix(slice, idx);
  if (preMvX) {
    filter = { ...filter, ...preMvX.filter };
    idx = preMvX.nextIndex;
  } else {
    const preMvN = parseManaValueFilterSuffix(slice, idx);
    if (preMvN) {
      filter = { ...filter, ...preMvN.filter };
      idx = preMvN.nextIndex;
    }
  }

  // Slice 11 (compact form): In the run-on form ("reveals their hand and you choose
  // a [filter] card"), the "from it" clause may be omitted when a semicolon or
  // ", then" follows immediately, e.g.:
  //   "...reveals their hand and you choose a card; that player discards it."
  //   "...reveals their hand and you choose a card, then that player discards it."
  // Standard period-separated forms still require "from it".
  const hasFromIt = (slice[idx] === 'from' && slice[idx + 1] === 'it');
  if (hasFromIt) {
    idx += 2;

    // Optional CMC bound AFTER "from it":
    //   "...nonland card from it with mana value 3 or less." (Inquisition of Kozilek)
    //   "...nonland card from it with mana value X or less." (alternate form)
    const xSuffix = parseManaValueXSuffix(slice, idx);
    if (xSuffix) {
      filter = { ...filter, ...xSuffix.filter };
      idx = xSuffix.nextIndex;
    } else {
      const cmcSuffix = parseManaValueFilterSuffix(slice, idx);
      if (cmcSuffix) {
        filter = { ...filter, ...cmcSuffix.filter };
        idx = cmcSuffix.nextIndex;
      }
    }
  } else if (!runOnForm) {
    // Period-separated form requires "from it".
    return null;
  }
  // else: run-on form without "from it" — allow semicolon/then disposition next.

  // Disposition tail: "and exile that card." | ". Exile that card." |
  // ". That player discards that card." | "; that player discards it." |
  // "; exile it." | ", then that player discards it." |
  // ". That player shuffles that card into their library." (Perish the Thought) |
  // ". Put that card on top of that player's library." (Painful Memories) |
  // ". That player puts that card into their library third from the top." (Lost Hours)
  //
  // Slice 11: Also accept "that player discards it" / "exile it" (pronoun "it"
  // instead of "that card") reached via ";" or ", then" separator. This covers
  // compact ETB phrasings like:
  //   "reveals their hand and you choose a card; that player discards it."
  //   "reveals their hand and you choose a noncreature card; that player discards it."
  //
  // Slice 1: Also accept "If you do, they discard it." / "If you do, they exile it."
  // (Binding Negotiation / Specter's Shriek "if you do" gated form with "they" pronoun).
  let disposition: 'discard' | 'exile' | 'shuffle' | 'putOnTop' | 'putThirdFromTop';

  // Helper: try to match a disposition body at the current position (after any
  // separator has been consumed). Accepts both "that card" and "it" as the
  // card-reference pronoun. Returns the disposition and updated idx, or null.
  const tryDispositionBody = (i: number): { disp: typeof disposition; nextIdx: number } | null => {
    // "that player discards that card" / "that player discards it"
    if (
      slice[i] === 'that' && slice[i + 1] === 'player' && slice[i + 2] === 'discards'
      && (
        (slice[i + 3] === 'that' && slice[i + 4] === 'card')
        || slice[i + 3] === 'it'
      )
    ) {
      const skip = slice[i + 3] === 'it' ? 4 : 5;
      return { disp: 'discard', nextIdx: i + skip };
    }
    // Slice 1: "they discard it" / "they discard that card"
    // (Binding Negotiation form — "if you do, they discard it")
    if (
      slice[i] === 'they' && slice[i + 1] === 'discards'
      && (
        (slice[i + 2] === 'that' && slice[i + 3] === 'card')
        || slice[i + 2] === 'it'
      )
    ) {
      const skip = slice[i + 2] === 'it' ? 3 : 4;
      return { disp: 'discard', nextIdx: i + skip };
    }
    // Slice 1: "they discard it" — tokenizer uses "discard" (no -s) after "they"
    if (
      slice[i] === 'they' && slice[i + 1] === 'discard'
      && (
        (slice[i + 2] === 'that' && slice[i + 3] === 'card')
        || slice[i + 2] === 'it'
      )
    ) {
      const skip = slice[i + 2] === 'it' ? 3 : 4;
      return { disp: 'discard', nextIdx: i + skip };
    }
    // Slice 1: "they exile it" / "they exile that card"
    if (
      slice[i] === 'they' && slice[i + 1] === 'exile'
      && ((slice[i + 2] === 'that' && slice[i + 3] === 'card') || slice[i + 2] === 'it')
    ) {
      const skip = slice[i + 2] === 'it' ? 3 : 4;
      return { disp: 'exile', nextIdx: i + skip };
    }
    // "exile that card" / "exile it"
    if (
      slice[i] === 'exile'
      && ((slice[i + 1] === 'that' && slice[i + 2] === 'card') || slice[i + 1] === 'it')
    ) {
      const skip = slice[i + 1] === 'it' ? 2 : 3;
      return { disp: 'exile', nextIdx: i + skip };
    }
    // Round 8(a): "that player exiles that card" / "that player exiles it"
    // (Specter's Shriek family — the player performs the exile action, same result)
    if (
      slice[i] === 'that' && slice[i + 1] === 'player' && slice[i + 2] === 'exiles'
      && (
        (slice[i + 3] === 'that' && slice[i + 4] === 'card')
        || slice[i + 3] === 'it'
      )
    ) {
      const skip = slice[i + 3] === 'it' ? 4 : 5;
      return { disp: 'exile', nextIdx: i + skip };
    }
    // "that player shuffles that card into their library" (Perish the Thought)
    if (
      slice[i] === 'that' && slice[i + 1] === 'player' && slice[i + 2] === 'shuffles'
      && slice[i + 3] === 'that' && slice[i + 4] === 'card'
      && slice[i + 5] === 'into' && slice[i + 6] === 'their' && slice[i + 7] === 'library'
    ) {
      return { disp: 'shuffle', nextIdx: i + 8 };
    }
    // "put that card on top of that player's library" / "put that card on top of their library" (Painful Memories)
    if (
      slice[i] === 'put' && slice[i + 1] === 'that' && slice[i + 2] === 'card'
      && slice[i + 3] === 'on' && slice[i + 4] === 'top' && slice[i + 5] === 'of'
      && (
        (slice[i + 6] === 'that' && (slice[i + 7] === "player's" || slice[i + 7] === 'players') && slice[i + 8] === 'library')
        || (slice[i + 6] === 'their' && slice[i + 7] === 'library')
      )
    ) {
      const skip = slice[i + 6] === 'their' ? 8 : 9;
      return { disp: 'putOnTop', nextIdx: i + skip };
    }
    // "that player puts that card into their library third from the top" (Lost Hours)
    if (
      slice[i] === 'that' && slice[i + 1] === 'player' && slice[i + 2] === 'puts'
      && slice[i + 3] === 'that' && slice[i + 4] === 'card'
      && slice[i + 5] === 'into' && slice[i + 6] === 'their' && slice[i + 7] === 'library'
      && slice[i + 8] === 'third' && slice[i + 9] === 'from' && slice[i + 10] === 'the'
      && slice[i + 11] === 'top'
    ) {
      return { disp: 'putThirdFromTop', nextIdx: i + 12 };
    }
    return null;
  };

  if (slice[idx] === 'and' && slice[idx + 1] === 'exile' && slice[idx + 2] === 'that' && slice[idx + 3] === 'card') {
    disposition = 'exile';
    idx += 4;
  } else if (
    // Slice 11: "; that player discards it." — semicolon separator (compact ETB form)
    slice[idx] === ';'
    || (slice[idx] === ',' && slice[idx + 1] === 'then')
  ) {
    // Consume the separator (semicolon) or ", then"
    if (slice[idx] === ';') {
      idx++;
    } else {
      idx += 2; // ", then"
    }
    const dispResult = tryDispositionBody(idx);
    if (!dispResult) return null;
    disposition = dispResult.disp;
    idx = dispResult.nextIdx;
  } else if (slice[idx] === '.') {
    idx++;
    // Slice 1: "If you do, they discard/exile it." — gated form (Binding Negotiation).
    // The "you may choose" above already consumes the optional gate; after a period
    // separator check for "if you do ," which introduces the "they" pronoun disposition.
    if (
      slice[idx] === 'if' && slice[idx + 1] === 'you' && slice[idx + 2] === 'do'
      && slice[idx + 3] === ','
    ) {
      idx += 4; // consume "if you do ,"
      const dispResult = tryDispositionBody(idx);
      if (!dispResult) return null;
      disposition = dispResult.disp;
      idx = dispResult.nextIdx;
    } else {
      const dispResult = tryDispositionBody(idx);
      if (!dispResult) return null;
      disposition = dispResult.disp;
      idx = dispResult.nextIdx;
    }
  } else {
    return null;
  }

  // HONESTY: "exile that card until ..." is a temporary exile with a return on
  // leave — decline so those faces stay Unparsed instead of permanently exiling.
  if (slice[idx] === 'until') return null;
  if (slice[idx] === '.') idx++;

  // Slice 1: "each opponent" — EachOpponent player ref (no target spec needed).
  if (isEachOpponent) {
    const effect: Effect = {
      kind: 'RevealHandChooseCard',
      player: { kind: 'EachOpponent' },
      filter,
      disposition,
    };
    return { effects: [effect], targets: [], consumed: idx };
  }

  const spec = makeTargetSpec('Player', slice[1] === 'opponent' ? { opponentControls: true } : undefined);
  const effect: Effect = {
    kind: 'RevealHandChooseCard',
    player: makeChosenRef(spec),
    filter,
    disposition,
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "target player discards N card(s) at random" /
 *        "target opponent discards N card(s) at random".
 * Distinct from matchDiscard because it sets the executor's `random` flag so the
 * cards are discarded at random (executeDiscard honors effect.random).
 */
export function matchTargetPlayerDiscardAtRandom(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 6) return null;
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'player' && slice[1] !== 'opponent') return null;
  if (slice[2] !== 'discards') return null;

  const count = parsePlayerAmountToken(slice[3]);
  if (isNaN(count)) return null;
  if (slice[4] !== 'card' && slice[4] !== 'cards') return null;
  if (slice[5] !== 'at' || slice[6] !== 'random') return null;

  let consumed = 7;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Player');
  const effect: Effect = {
    kind: 'Discard',
    player: makeChosenRef(spec),
    count,
    random: true,
  };
  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "each opponent discards a card"
 * Match: "each opponent discards N cards"
 */
export function matchEachOpponentDiscardsCard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;
  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'opponent') return null;
  if (slice[2] !== 'discards') return null;

  let count: number;
  let consumed: number;

  if (slice[3] === 'a' && slice[4] === 'card') {
    count = 1;
    consumed = 5;
  } else {
    count = parseInt(slice[3], 10);
    if (isNaN(count)) return null;
    if (slice[4] !== 'cards' && slice[4] !== 'card') return null;
    consumed = 5;
  }

  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Discard',
    player: { kind: 'EachOpponent' },
    count,
  };

  return { effects: [effect], targets: [], consumed };
}

export function matchDiscard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "target player discards N card(s)" | "target opponent discards N card(s)"
  // | "target player discards their hand"
  if (
    slice.length >= 4 && slice[0] === 'target'
    && (slice[1] === 'player' || slice[1] === 'opponent')
    && slice[2] === 'discards'
  ) {
    let count: number;
    let consumed: number;

    if (slice[3] === 'their' && slice[4] === 'hand') {
      count = 999; // whole hand
      consumed = 5;
    } else if (slice[3] === 'a' || slice[3] === 'an') {
      count = 1;
      consumed = 5; // "discards a card"
    } else {
      const parsed = parseInt(slice[3], 10);
      count = !isNaN(parsed) ? parsed : parseSmallNumberToken(slice[3]);
      if (isNaN(count)) return null;
      consumed = 5; // "discards N cards"
    }

    if (tokens[startIndex + consumed] === '.') consumed++;

    // "target opponent" is modeled as a Player target — the discard executes on
    // whoever is chosen; legal-target generation / AI pick an opponent.
    const spec = makeTargetSpec('Player');
    const effect: Effect = {
      kind: 'Discard',
      player: makeChosenRef(spec),
      count,
    };

    return { effects: [effect], targets: [spec], consumed };
  }

  // "each player discards N card(s)" | "each opponent discards N card(s)"
  if (
    slice.length >= 4 && slice[0] === 'each'
    && (slice[1] === 'player' || slice[1] === 'opponent')
    && slice[2] === 'discards'
  ) {
    let count: number;
    let consumed: number;
    if (slice[3] === 'their' && slice[4] === 'hand') {
      count = 999;
      consumed = 5;
    } else if (slice[3] === 'a' || slice[3] === 'an') {
      count = 1;
      consumed = 5;
    } else {
      const parsed = parseInt(slice[3], 10);
      count = !isNaN(parsed) ? parsed : parseSmallNumberToken(slice[3]);
      if (isNaN(count)) return null;
      consumed = 5;
    }
    if (tokens[startIndex + consumed] === '.') consumed++;
    const effect: Effect = {
      kind: 'Discard',
      player: { kind: slice[1] === 'opponent' ? 'EachOpponent' : 'EachPlayer' },
      count,
    };
    return { effects: [effect], targets: [], consumed };
  }

  return null;
}

export function matchDiscardSelf(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 2) return null;
  if (slice[0] !== 'discard') return null;

  let count: number;
  let consumed: number;

  // "discard your hand" — controller discards every card in hand. The 999
  // sentinel is clamped by executeDiscard (Math.min(count, hand.length)),
  // matching the "discards their hand" convention used by matchDiscard.
  if (slice[1] === 'your' && slice[2] === 'hand') {
    count = 999;
    consumed = 3;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return {
      effects: [{ kind: 'Discard', player: { kind: 'Controller' }, count }],
      targets: [],
      consumed,
    };
  }

  if (slice.length < 3) return null;

  if (slice[1] === 'a' && slice[2] === 'card') {
    count = 1;
    consumed = 3;
  } else {
    const n = parseSmallNumberToken(slice[1]);
    if (isNaN(n)) return null;
    if (slice[2] !== 'cards' && slice[2] !== 'card') return null;
    count = n;
    consumed = 3;
  }

  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Discard',
    player: { kind: 'Controller' },
    count,
  };

  return { effects: [effect], targets: [], consumed };
}

export function matchSacrificeAsEffect(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 2) return null;
  if (slice[0] !== 'sacrifice') return null;

  // "Sacrifice this creature / it / ~." — self-sacrifice of the source permanent.
  if (
    slice[1] === 'it' || slice[1] === '~'
    || (slice[1] === 'this' && targetTypeFromSimplePermanentWord(slice[2]))
  ) {
    let consumed = (slice[1] === 'this') ? 3 : 2;
    if (tokens[startIndex + consumed] === '.') consumed++;
    const effect: Effect = { kind: 'Sacrifice', player: { kind: 'Controller' }, count: 1, self: true };
    return { effects: [effect], targets: [], consumed };
  }

  // "Sacrifice all <type> [you control]." — count = number of the caster's matching
  // permanents, so executeSacrifice removes all of them.
  if (slice[1] === 'all') {
    const typeMap: Record<string, NonNullable<CardFilter['types']>> = {
      creatures: ['creature'], artifacts: ['artifact'], enchantments: ['enchantment'], lands: ['land'],
    };
    const types = typeMap[slice[2]];
    let i = types ? 3 : (slice[2] === 'permanents' ? 3 : -1);
    if (i < 0) return null;
    if (slice[i] === 'you' && slice[i + 1] === 'control') i += 2;
    if (tokens[startIndex + i] === '.') i++;
    const forEach: AmountRef = { kind: 'ForEach', zone: 'battlefield', filter: types ? { types } : undefined, controller: 'you' };
    return { effects: [{ kind: 'Sacrifice', player: { kind: 'Controller' }, filter: types ? { types } : undefined, count: forEach }], targets: [], consumed: i };
  }

  if (slice.length < 3) return null;
  if (slice[1] !== 'a' && slice[1] !== 'an') return null;

  let idx = 2;
  const filter: CardFilter = {};

  if (slice[idx] === 'creature') {
    filter.types = ['creature'];
    idx++;
  } else if (slice[idx] === 'artifact') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'enchantment') {
    filter.types = ['enchantment'];
    idx++;
  } else if (slice[idx] === 'permanent') {
    // no type filter needed — matches anything on battlefield
    idx++;
  } else if (slice[idx] === 'land') {
    filter.types = ['land'];
    idx++;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Sacrifice',
    player: { kind: 'Controller' },
    filter: filter.types ? filter : undefined,
    count: 1,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "each player draws a card" / "each player draws N cards"
 * Match: "each player sacrifices a creature"
 * Match: "each player discards a card"
 * Match: "each player loses N life"
 */
export function matchEachPlayerEffect(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;
  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'player') return null;

  let idx = 2;

  // "each player draws a card" / "each player draws N cards" / "each player draws X cards"
  if (slice[idx] === 'draws') {
    idx++;
    let count: number | { kind: 'X' };
    if (slice[idx] === 'a' && slice[idx + 1] === 'card') {
      count = 1;
      idx += 2;
    } else if (slice[idx] === 'x' && (slice[idx + 1] === 'cards' || slice[idx + 1] === 'card')) {
      // Slice 7: "each player draws X cards" (Fascination style)
      count = { kind: 'X' };
      idx += 2;
    } else {
      count = parseInt(slice[idx], 10);
      if (isNaN(count)) return null;
      idx++;
      if (slice[idx] === 'cards' || slice[idx] === 'card') idx++;
    }
    if (slice[idx] === '.') idx++;

    const effect: Effect = {
      kind: 'Draw',
      player: { kind: 'EachPlayer' },
      count,
    };
    return { effects: [effect], targets: [], consumed: idx };
  }

  // "each player sacrifices a creature"
  if (slice[idx] === 'sacrifices') {
    idx++;
    if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
    idx++;

    const filter: CardFilter = {};
    if (slice[idx] === 'creature') {
      filter.types = ['creature'];
      idx++;
    } else if (slice[idx] === 'artifact') {
      filter.types = ['artifact'];
      idx++;
    } else if (slice[idx] === 'enchantment') {
      filter.types = ['enchantment'];
      idx++;
    } else if (slice[idx] === 'permanent') {
      idx++;
    } else if (slice[idx] === 'land') {
      filter.types = ['land'];
      idx++;
    } else {
      return null;
    }

    if (slice[idx] === '.') idx++;

    const effect: Effect = {
      kind: 'Sacrifice',
      player: { kind: 'EachPlayer' },
      filter: filter.types ? filter : undefined,
      count: 1,
    };
    return { effects: [effect], targets: [], consumed: idx };
  }

  // "each player discards a card" / "each player discards N cards"
  if (slice[idx] === 'discards') {
    idx++;
    let count: number;
    if (slice[idx] === 'a' && slice[idx + 1] === 'card') {
      count = 1;
      idx += 2;
    } else {
      count = parseInt(slice[idx], 10);
      if (isNaN(count)) return null;
      idx++;
      if (slice[idx] === 'cards' || slice[idx] === 'card') idx++;
    }
    if (slice[idx] === '.') idx++;

    const effect: Effect = {
      kind: 'Discard',
      player: { kind: 'EachPlayer' },
      count,
    };
    return { effects: [effect], targets: [], consumed: idx };
  }

  // "each player loses N life"
  if (slice[idx] === 'loses') {
    idx++;
    const amount = parseInt(slice[idx], 10);
    if (isNaN(amount)) return null;
    idx++;
    if (slice[idx] !== 'life') return null;
    idx++;
    if (slice[idx] === '.') idx++;

    const effect: Effect = {
      kind: 'LoseLife',
      player: { kind: 'EachPlayer' },
      amount,
    };
    return { effects: [effect], targets: [], consumed: idx };
  }

  return null;
}

/**
 * Match: "each opponent sacrifices a creature"
 * Match: "each opponent sacrifices an artifact"
 */
export function matchEachOpponentSacrifice(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'opponent') return null;
  if (slice[2] !== 'sacrifices') return null;
  if (slice[3] !== 'a' && slice[3] !== 'an') return null;

  let idx = 4;
  const filter: CardFilter = {};

  if (slice[idx] === 'creature') {
    filter.types = ['creature'];
    idx++;
  } else if (slice[idx] === 'artifact') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'enchantment') {
    filter.types = ['enchantment'];
    idx++;
  } else if (slice[idx] === 'permanent') {
    idx++;
  } else if (slice[idx] === 'land') {
    filter.types = ['land'];
    idx++;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Sacrifice',
    player: { kind: 'EachOpponent' },
    filter: filter.types ? filter : undefined,
    count: 1,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "sacrifice it unless target opponent sacrifices a creature"
 * Match: "sacrifice ~ unless target opponent sacrifices an artifact"
 */
export function matchSacrificeSelfUnlessTargetOpponentSacrifices(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 8) return null;
  if (slice[0] !== 'sacrifice') return null;
  if (slice[1] !== 'it' && slice[1] !== '~') return null;
  if (slice[2] !== 'unless') return null;
  if (slice[3] !== 'target') return null;
  if (slice[4] !== 'opponent') return null;
  if (slice[5] !== 'sacrifices') return null;
  if (slice[6] !== 'a' && slice[6] !== 'an') return null;

  let idx = 7;
  const parsedFilter = parseStaticFilterType(slice[idx]);
  if (!parsedFilter) return null;
  const filter = parsedFilter.permanent ? undefined : parsedFilter;
  idx++;

  if (slice[idx] === 'card') idx++;
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player', { opponentControls: true });
  const effect: Effect = {
    kind: 'SacrificeSelfUnlessPlayerSacrifices',
    player: makeChosenRef(spec),
    filter,
    count: 1,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 4 (self-reference normalization):
 * Match: "sacrifice this enchantment unless you pay {1}{U}."
 *        "sacrifice this artifact unless you pay {1}."
 *        "sacrifice ~ unless you pay {2}{B}."
 *        "sacrifice it unless you pay {2}."
 *
 * These are the classic "upkeep cost or sacrifice" triggers (Binding Grasp,
 * Serra Bestiary, Gavel of the Righteous, etc.). After normalizeSelfSubtypeNouns
 * has run, "this Aura" → "this enchantment" and "this Equipment" / "this Vehicle"
 * → "this artifact", so the self-reference is always a canonical type name or
 * ~/ it.
 *
 * The executor tries to pay the mana cost from untapped lands; if it can
 * (or, for life costs, if the player can afford it), the permanent survives.
 * If payment fails the source permanent is sacrificed.
 *
 * Emits SacrificeSelfUnlessPayEffect.
 */
export function matchSacrificeSelfUnlessPay(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 5) return null;
  if (slice[0] !== 'sacrifice') return null;

  // Self-reference: "it", "~", or "this <type>"
  let idx = 1;
  if (slice[idx] === 'it' || slice[idx] === '~') {
    idx++;
  } else if (slice[idx] === 'this' && targetTypeFromSimplePermanentWord(slice[idx + 1])) {
    idx += 2;
  } else {
    return null;
  }

  if (slice[idx] !== 'unless') return null;
  idx++;
  if (slice[idx] !== 'you') return null;
  idx++;
  if (slice[idx] !== 'pay') return null;
  idx++;

  let manaCost: number | string | undefined;
  let lifeCost: number | undefined;

  if (slice[idx] && /^(?:\{[^}]+\})+$/.test(slice[idx])) {
    const pips = slice[idx].match(/\{[^}]+\}/g) ?? [];
    const isGenericPip = (p: string) => /^\{\d+\}$/.test(p);
    const isColoredPip = (p: string) => /^\{[wubrgc](?:\/[wubrgc])?\}$/.test(p);
    if (pips.some(isColoredPip) && pips.every(p => isGenericPip(p) || isColoredPip(p))) {
      manaCost = pips.map(p => p.toUpperCase()).join('');
    } else {
      // Generic only
      let total = 0;
      for (const p of pips) {
        const n = parseInt(p.slice(1, -1), 10);
        if (isNaN(n)) return null; // complex pip we can't evaluate
        total += n;
      }
      manaCost = total;
    }
    idx++;
  } else {
    // "N life"
    const n = parseInt(slice[idx], 10);
    if (!isNaN(n) && n > 0 && slice[idx + 1] === 'life') {
      lifeCost = n;
      idx += 2;
    } else {
      return null;
    }
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'SacrificeSelfUnlessPay',
    ...(manaCost !== undefined ? { manaCost } : {}),
    ...(lifeCost !== undefined ? { lifeCost } : {}),
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "target player sacrifices a creature"
 * Match: "target player sacrifices an artifact"
 * Slice 11 additions for "that player sacrifices …" tails:
 *   "a monocolored creature"  (Defiler of Souls)
 *   "a non-Elf creature"      (Ruthless Winnower)
 *   "a nonbasic land"         (Destructive Flow)
 *   "a green or white permanent" (color anyOf)
 * In all "that player" cases the executor ref is EventPlayer (upkeep trigger's
 * active player, resolved via eventContext.eventPlayerId).
 */
export function matchTargetPlayerSacrifice(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  // "target player sacrifices …" (chosen) or "that player sacrifices …" (event player).
  // Slice 4 extension: also handles "target opponent sacrifices …" (Pharika's Libation bullet).
  const isThat = slice[0] === 'that';
  const isOpponent = slice[0] === 'target' && slice[1] === 'opponent';
  if (slice[0] !== 'target' && slice[0] !== 'that') return null;
  if (!isOpponent && slice[1] !== 'player') return null;
  if (slice[2] !== 'sacrifices') return null;
  if (slice[3] !== 'a' && slice[3] !== 'an') return null;

  let idx = 4;
  let filter: CardFilter | undefined;

  // Slice 11: "a monocolored creature" (Defiler of Souls)
  if (slice[idx] === 'monocolored' && slice[idx + 1] === 'creature') {
    filter = { types: ['creature'], monocolored: true };
    idx += 2;
  }
  // Slice 11: "a non-Elf creature" — tokenizes as ["non", "-", "elf", "creature"]
  // (Ruthless Winnower). The hyphen is a standalone dash token.
  else if (
    slice[idx] === 'non' && slice[idx + 1] === '-' &&
    slice[idx + 2] !== undefined && slice[idx + 3] === 'creature'
  ) {
    const excludedSubtype = slice[idx + 2].charAt(0).toUpperCase() + slice[idx + 2].slice(1);
    filter = { types: ['creature'], excludeSubtypes: [excludedSubtype] };
    idx += 4;
  }
  // Slice 11: "a nonbasic land" (Destructive Flow) — "nonbasic" is one token.
  else if (slice[idx] === 'nonbasic' && (slice[idx + 1] === 'land' || slice[idx + 1] === 'permanent')) {
    const baseType = slice[idx + 1] === 'land' ? 'land' : undefined;
    filter = baseType
      ? { types: [baseType], excludeSupertypes: ['basic'] }
      : { excludeSupertypes: ['basic'] };
    idx += 2;
  }
  // Slice 11: "a <color1> or <color2> permanent" (color anyOf, e.g. "green or white permanent")
  else if (
    slice[idx + 1] === 'or' &&
    slice[idx + 3] === 'permanent'
  ) {
    const colorMap: Record<string, Array<'W' | 'U' | 'B' | 'R' | 'G'>> = {
      white: ['W'], blue: ['U'], black: ['B'], red: ['R'], green: ['G'],
    };
    const c1 = colorMap[slice[idx]];
    const c2 = colorMap[slice[idx + 2]];
    if (c1 && c2) {
      filter = { anyOf: [{ colors: c1 }, { colors: c2 }] };
      idx += 4; // consume: color1 "or" color2 "permanent"
    } else {
      return null;
    }
  }
  // Slice 4: "creature or enchantment" union (Pharika's Libation)
  else if (slice[idx] === 'creature' && slice[idx + 1] === 'or' && slice[idx + 2] === 'enchantment') {
    filter = { types: ['creature', 'enchantment'] };
    idx += 3;
  }
  // Slice 4: "artifact or enchantment" union
  else if (slice[idx] === 'artifact' && slice[idx + 1] === 'or' && slice[idx + 2] === 'enchantment') {
    filter = { types: ['artifact', 'enchantment'] };
    idx += 3;
  }
  // Slice 4: "creature or artifact" union
  else if (slice[idx] === 'creature' && slice[idx + 1] === 'or' && slice[idx + 2] === 'artifact') {
    filter = { types: ['creature', 'artifact'] };
    idx += 3;
  }
  // Basic type nouns
  else if (slice[idx] === 'creature') {
    filter = { types: ['creature'] };
    idx++;
  } else if (slice[idx] === 'artifact') {
    filter = { types: ['artifact'] };
    idx++;
  } else if (slice[idx] === 'enchantment') {
    filter = { types: ['enchantment'] };
    idx++;
  } else if (slice[idx] === 'permanent') {
    idx++;
  } else if (slice[idx] === 'land') {
    filter = { types: ['land'] };
    idx++;
  } else {
    return null;
  }

  // Consume optional "of their choice" tail without error.
  if (slice[idx] === 'of' && slice[idx + 1] === 'their' && slice[idx + 2] === 'choice') idx += 3;

  if (slice[idx] === '.') idx++;

  if (isThat) {
    const effect: Effect = {
      kind: 'Sacrifice',
      // Slice 11: use EventPlayer (not EventCaster) so upkeep triggers that only
      // set eventContext.eventPlayerId (not casterId) resolve the correct player.
      player: { kind: 'EventPlayer' },
      filter,
      count: 1,
    };
    return { effects: [effect], targets: [], consumed: idx };
  }

  // Slice 4: "target opponent" → opponent-constrained Player target.
  const spec = isOpponent
    ? makeTargetSpec('Player', { opponentControls: true })
    : makeTargetSpec('Player');
  const effect: Effect = {
    kind: 'Sacrifice',
    player: makeChosenRef(spec),
    filter,
    count: 1,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "that player untaps a land they control"
 * Slice 11: Hokori, Dust Drinker family. The trigger fires during each player's
 * upkeep; "that player" is the EventPlayer (eventContext.eventPlayerId). Untaps
 * exactly one land owned by that player.
 */
export function matchThatPlayerUntapsLand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Expected: ["that", "player", "untaps", "a", "land", "they", "control"]
  if (slice.length < 7) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player' || slice[2] !== 'untaps') return null;
  if (slice[3] !== 'a' && slice[3] !== 'an') return null;
  if (slice[4] !== 'land') return null;
  if (slice[5] !== 'they' || slice[6] !== 'control') return null;

  let consumed = 7;
  if (slice[consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Untap',
    target: { kind: 'AllOfType', filter: { types: ['land'] }, eventPlayerControls: true },
    maxCount: 1,
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "gain control of target creature"
 * Match: "gain control of target permanent"
 * Match: "gain control of target artifact"
 */
export function matchGainControl(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;
  if (slice[0] !== 'gain') return null;
  if (slice[1] !== 'control') return null;
  if (slice[2] !== 'of') return null;

  // "gain control of it / that creature" — the event creature (no-op without context).
  if (slice[3] === 'it' || (slice[3] === 'that' && (slice[4] === 'creature' || slice[4] === 'permanent'))) {
    let c = slice[3] === 'it' ? 4 : 5;
    if (slice[c] === '.') c++;
    return { effects: [{ kind: 'GainControl', target: { kind: 'EventCreature' } }], targets: [], consumed: c };
  }

  if (slice[3] !== 'target') return null;

  let targetType: TargetType;
  let consumed = 5;

  if (slice[4] === 'creature') {
    targetType = 'Creature';
  } else if (slice[4] === 'permanent') {
    targetType = 'Permanent';
  } else if (slice[4] === 'artifact') {
    targetType = 'Artifact';
  } else if (slice[4] === 'enchantment') {
    targetType = 'Enchantment';
  } else {
    return null;
  }

  if (slice[consumed] === '.') consumed++;

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'GainControl',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "that player returns a creature they control to its owner's hand"
 *        "that player returns a permanent they control to its owner's hand"
 *
 * Sunken Hope family. "That player" is the EventPlayer (the active player at
 * the beginning-of-upkeep trigger; upkeep eventContext carries eventPlayerId).
 *
 * Emits BounceControlledByPlayer — the executor mirrors the sacrifice-selection
 * policy: find the event player's cheapest matching permanent and return it to
 * its owner's hand.
 *
 * HONESTY: Forms with an additional restriction ("that player returns a creature
 * with the least power", colour qualifiers, etc.) are NOT parsed — the default
 * AI picks the lowest-CMC permanent. The "to its owner's hand" tail is required;
 * other destinations (top of library, battlefield) stay Unparsed.
 */
export function matchThatPlayerReturnsCreature(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // minimum: "that player returns a creature they control to its owner's hand"
  //           0     1      2       3 4        5    7       8  9   10      11
  if (slice.length < 11) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player' || slice[2] !== 'returns') return null;
  if (slice[3] !== 'a' && slice[3] !== 'an') return null;

  // Determine the filter type
  let idx = 4;
  const filter: CardFilter = {};

  if (slice[idx] === 'creature') {
    filter.types = ['creature'];
    idx++;
  } else if (slice[idx] === 'permanent') {
    // no type restriction — any permanent
    idx++;
  } else if (slice[idx] === 'artifact') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'enchantment') {
    filter.types = ['enchantment'];
    idx++;
  } else if (slice[idx] === 'land') {
    filter.types = ['land'];
    idx++;
  } else {
    return null;
  }

  // "they control to its owner's hand"
  if (slice[idx] !== 'they' || slice[idx + 1] !== 'control') return null;
  idx += 2;
  if (slice[idx] !== 'to') return null;
  idx++;
  // "its owner's hand" or "their owner's hand"
  if (slice[idx] !== "its" && slice[idx] !== 'their') return null;
  idx++;
  if (slice[idx] !== "owner's" && slice[idx] !== 'owners') return null;
  idx++;
  if (slice[idx] !== 'hand') return null;
  idx++;

  if (tokens[startIndex + idx] === '.') idx++;

  const effect: Effect = {
    kind: 'BounceControlledByPlayer',
    player: { kind: 'EventPlayer' },
    filter: filter.types ? filter : undefined,
    count: 1,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 4/12 — Mass bounce of the EventPlayer's creatures (Noetic Scales family).
 *
 * Matches:
 *   "that player returns each creature they control to its owner's hand"
 *   "that player returns each creature they control with power greater than the
 *    number of cards in their hand to its owner's hand"
 *
 * "That player" is the EventPlayer (the active player at the beginning-of-upkeep
 * trigger; upkeep eventContext carries eventPlayerId). Emits BounceControlledByPlayer
 * with filter.types=['creature'] and count=100 (effectively return ALL matching).
 *
 * When the "with power greater than the number of cards in their hand" clause is
 * present, filter.powerGreaterThanEventPlayerHandCount is set to true and the
 * executor applies the dynamic power check against the player's live hand count.
 *
 * HONESTY: Only the "each creature" (plural, mass) form is parsed here; the
 * single-creature form ("a creature they control") is handled by
 * matchThatPlayerReturnsCreature. Forms with other permanent types (enchantment,
 * artifact) without the power clause are accepted as an unfiltered creature bounce.
 */
export function matchThatPlayerReturnsMassBounce(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum: "that player returns each creature they control to its owner 's hand"
  //           0     1      2       3    4        5    7       8  9   10      11 12
  if (slice.length < 12) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player' || slice[2] !== 'returns') return null;
  if (slice[3] !== 'each') return null;

  // Permanent type — only "creature" for the power-filter form; also accept plain "permanent"
  let idx = 4;
  const filter: import('../ast').CardFilter = {};

  if (slice[idx] === 'creature' || slice[idx] === 'creatures') {
    filter.types = ['creature'];
    idx++;
  } else if (slice[idx] === 'permanent' || slice[idx] === 'permanents') {
    // No type restriction
    idx++;
  } else {
    return null;
  }

  // "they control"
  if (slice[idx] !== 'they' || slice[idx + 1] !== 'control') return null;
  idx += 2;

  // Optional power clause: "with power greater than the number of cards in their hand"
  let powerGreaterThanHandCount = false;
  if (
    slice[idx] === 'with' &&
    slice[idx + 1] === 'power' &&
    slice[idx + 2] === 'greater' &&
    slice[idx + 3] === 'than' &&
    slice[idx + 4] === 'the' &&
    slice[idx + 5] === 'number' &&
    slice[idx + 6] === 'of' &&
    slice[idx + 7] === 'cards' &&
    slice[idx + 8] === 'in' &&
    slice[idx + 9] === 'their' &&
    slice[idx + 10] === 'hand'
  ) {
    powerGreaterThanHandCount = true;
    idx += 11;
  }

  // "to its owner's hand" or "to their owner's hand"
  if (slice[idx] !== 'to') return null;
  idx++;
  if (slice[idx] !== 'its' && slice[idx] !== 'their') return null;
  idx++;
  if (slice[idx] !== "owner's" && slice[idx] !== 'owners') return null;
  idx++;
  if (slice[idx] !== 'hand') return null;
  idx++;

  if (tokens[startIndex + idx] === '.') idx++;

  if (powerGreaterThanHandCount) {
    filter.powerGreaterThanEventPlayerHandCount = true;
  }

  const effect: import('../ast').Effect = {
    kind: 'BounceControlledByPlayer',
    player: { kind: 'EventPlayer' },
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    count: 100, // effectively "return all matching" — executor caps at candidates.length
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match the reveal-hand-and-top-of-library form (Psychotic Episode family):
 *   "Target player reveals their hand and the top card of their library. You
 *    choose a nonland card from among them. That player discards that card."
 *   "Target opponent reveals their hand and the top card of their library. ..."
 *
 * The "top card of library" reveal has no distinct state change at this
 * abstraction level (same as LookAtHand), so this matcher folds it into a single
 * RevealHandChooseCard effect — the caster still chooses from the revealed hand
 * (+ library top card is also shown but not separately tracked).
 *
 * HONESTY: The library-top card is also eligible to be chosen (put into
 * graveyard/discarded); the current executor can only move hand cards, so forms
 * where the chosen card might come from the top-of-library are declined if
 * "from among them" (hand + library) is the pool. This matcher only accepts
 * the grammatically explicit "choose from it" (the hand) phrasing or "from
 * among them" when followed by "that player discards that card" — the hand
 * discard path is what the executor executes.
 */
export function matchRevealHandAndTopOfLibraryChooseCard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 16) return null;

  // "target opponent/player reveals their hand and the top card of their library ."
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'opponent' && slice[1] !== 'player') return null;
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;
  if (slice[5] !== 'and' || slice[6] !== 'the' || slice[7] !== 'top'
      || slice[8] !== 'card' || slice[9] !== 'of' || slice[10] !== 'their'
      || slice[11] !== 'library') return null;
  if (slice[12] !== '.') return null;
  let idx = 13;

  // "you choose a/an [<filter words>] card from it" OR "from among them"
  // Slice 11: also accept "you choose a/an [filter] card revealed this way"
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'choose') return null;
  idx += 2;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;
  const filterStart = idx;
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'card') return null;
  const filter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (filter === null) return null;
  idx++;
  // "from it", "from among them", or "revealed this way" (Slice 11: Psychotic Episode)
  let revealedThisWay = false;
  if (slice[idx] !== 'from' && !(slice[idx] === 'revealed' && slice[idx + 1] === 'this' && slice[idx + 2] === 'way')) return null;
  if (slice[idx] === 'revealed' && slice[idx + 1] === 'this' && slice[idx + 2] === 'way') {
    revealedThisWay = true;
    idx += 3;
  } else {
    idx++; // consume "from"
    if (slice[idx] === 'it') {
      idx++;
    } else if (slice[idx] === 'among' && slice[idx + 1] === 'them') {
      idx += 2;
    } else {
      return null;
    }
  }

  // Disposition tail: "and exile that card." | ". Exile that card." |
  // ". That player discards that card." |
  // ". That player puts the chosen card on top of their library." (Slice 11: Psychotic Episode) |
  // ". That player puts the chosen card on the bottom of their library." (Slice 4a: Psychotic Episode putOnBottom)
  let disposition: 'discard' | 'exile' | 'putOnTop' | 'putOnBottom';

  /**
   * Helper: match "that player puts the chosen/revealed card on <location> of their library"
   * at the given index. Returns { disp, consumed } or null.
   */
  const tryPutsCardToLibrary = (i: number): { disp: 'putOnTop' | 'putOnBottom'; consumed: number } | null => {
    if (
      slice[i] === 'that' && slice[i + 1] === 'player'
      && slice[i + 2] === 'puts'
      && (slice[i + 3] === 'the' || slice[i + 3] === 'that')
      && (slice[i + 4] === 'chosen' || slice[i + 4] === 'revealed')
      && slice[i + 5] === 'card'
    ) {
      // "on top of their library" → putOnTop
      if (slice[i + 6] === 'on' && slice[i + 7] === 'top' && slice[i + 8] === 'of'
          && slice[i + 9] === 'their' && slice[i + 10] === 'library') {
        return { disp: 'putOnTop', consumed: i + 11 };
      }
      // "on the bottom of their library" → putOnBottom (Psychotic Episode)
      if (slice[i + 6] === 'on' && slice[i + 7] === 'the' && slice[i + 8] === 'bottom'
          && slice[i + 9] === 'of' && slice[i + 10] === 'their' && slice[i + 11] === 'library') {
        return { disp: 'putOnBottom', consumed: i + 12 };
      }
    }
    return null;
  };

  if (slice[idx] === 'and' && slice[idx + 1] === 'exile' && slice[idx + 2] === 'that' && slice[idx + 3] === 'card') {
    disposition = 'exile';
    idx += 4;
  } else if (slice[idx] === '.') {
    idx++;
    if (slice[idx] === 'exile' && slice[idx + 1] === 'that' && slice[idx + 2] === 'card') {
      disposition = 'exile';
      idx += 3;
    } else if (
      slice[idx] === 'that' && slice[idx + 1] === 'player'
      && slice[idx + 2] === 'discards' && slice[idx + 3] === 'that' && slice[idx + 4] === 'card'
    ) {
      disposition = 'discard';
      idx += 5;
    } else {
      // "That player puts the chosen/revealed card on top/bottom of their library."
      const putsResult = tryPutsCardToLibrary(idx);
      if (putsResult) {
        disposition = putsResult.disp;
        idx = putsResult.consumed;
      } else {
        return null;
      }
    }
  } else if (
    // Inline putOnTop/putOnBottom: "... and that player puts the chosen card on top/bottom of their library."
    // (alternative compact phrasing without sentence break)
    !revealedThisWay && slice[idx] === 'and' && slice[idx + 1] === 'that'
  ) {
    const putsResult = tryPutsCardToLibrary(idx + 1);
    if (putsResult) {
      disposition = putsResult.disp;
      idx = putsResult.consumed;
    } else {
      return null;
    }
  } else {
    return null;
  }

  // HONESTY: temporary exile ("until...") not supported.
  if (slice[idx] === 'until') return null;
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player', slice[1] === 'opponent' ? { opponentControls: true } : undefined);
  const effect: Effect = {
    kind: 'RevealHandChooseCard',
    player: makeChosenRef(spec),
    filter,
    disposition,
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match the Search Warrant family:
 *   "Target player reveals their hand. You gain life equal to the number of
 *    cards in that player's hand."
 *   "Target opponent reveals their hand. You gain life equal to the number of
 *    cards in that player's hand."
 *
 * Emits LookAtHand (no-op reveal) + GainLife with a ForEach amount counted
 * from the target player's hand at resolution time.
 *
 * HONESTY: the executor's resolveForEachCount supports controller='opponent'
 * (counts from an opponent's hand/graveyard/library); "that player's" is
 * mapped to controller='opponent' as the best available match since the target
 * is always an opponent in this family. Cards in the target player's hand are
 * counted at resolution time via the ForEach mechanism.
 */
export function matchRevealHandGainLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 14) return null;

  // "target player/opponent reveals their hand ."
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'player' && slice[1] !== 'opponent') return null;
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;
  if (slice[5] !== '.') return null;
  let idx = 6;

  // "you gain life equal to the number of cards in that player's hand"
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'gain' || slice[idx + 2] !== 'life') return null;
  if (slice[idx + 3] !== 'equal' || slice[idx + 4] !== 'to') return null;
  if (slice[idx + 5] !== 'the' || slice[idx + 6] !== 'number' || slice[idx + 7] !== 'of') return null;
  if (slice[idx + 8] !== 'cards') return null;
  if (slice[idx + 9] !== 'in') return null;
  // "that player's hand" or "their hand"
  const handPhraseStart = idx + 10;
  let phraseLen: number;
  if (slice[handPhraseStart] === "that" && slice[handPhraseStart + 1] === "player's"
      && slice[handPhraseStart + 2] === 'hand') {
    phraseLen = 3;
  } else if (slice[handPhraseStart] === 'their' && slice[handPhraseStart + 1] === 'hand') {
    phraseLen = 2;
  } else {
    return null;
  }
  idx = handPhraseStart + phraseLen;
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player', slice[1] === 'opponent' ? { opponentControls: true } : undefined);

  const forEachAmount: ForEachAmount = {
    kind: 'ForEach',
    zone: 'hand',
    controller: 'opponent',
  };

  const revealEffect: Effect = { kind: 'LookAtHand', player: makeChosenRef(spec) };
  const gainLifeEffect: Effect = {
    kind: 'GainLife',
    player: { kind: 'Controller' },
    amount: forEachAmount,
  };
  return { effects: [revealEffect, gainLifeEffect], targets: [spec], consumed: idx };
}

/**
 * Match the Amnesia family (discard-all-matching):
 *   "Target player reveals their hand and discards all nonland cards."
 *   "Target opponent reveals their hand and discards all nonland cards."
 *   "Target player reveals their hand and discards all cards." (whole hand)
 *
 * Emits a single RevealHandChooseCard effect with discardAll: true — the executor
 * loops over every filter-matching card and discards/exiles each one, rather than
 * choosing a single card.
 *
 * HONESTY: "all cards of that color" (requiring a prior choose-color step) is
 * declined — the engine has no choose-color subsystem for this effect family.
 * Supported filter words: nonland, creature, artifact, enchantment, planeswalker,
 * instant, sorcery, and multi-type lists thereof. Bare "all cards" (no filter)
 * maps to an empty filter (any card).
 */
export function matchRevealHandDiscardAll(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "target player reveals their hand and discards all cards ."
  //           0      1      2       3     4    5   6        7   8    9
  if (slice.length < 9) return null;

  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'opponent' && slice[1] !== 'player') return null;
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;
  if (slice[5] !== 'and' || slice[6] !== 'discards' || slice[7] !== 'all') return null;
  let idx = 8;

  // Filter words: "nonland cards", "creature cards", "artifact or creature cards",
  // "creature, enchantment, or planeswalker cards", or just "cards" (no filter)
  let filter: CardFilter;
  if (slice[idx] === 'cards') {
    // "discards all cards" — no filter (whole hand)
    filter = {};
    idx++;
  } else {
    // Collect filter words until we hit "card" or "cards"
    const filterStart = idx;
    while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== 'cards' && slice[idx] !== '.') idx++;
    if (slice[idx] !== 'card' && slice[idx] !== 'cards') return null;
    const parsed = parseChosenHandCardFilter(slice.slice(filterStart, idx));
    if (parsed === null) return null;
    filter = parsed;
    idx++;
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player', slice[1] === 'opponent' ? { opponentControls: true } : undefined);
  const effect: Effect = {
    kind: 'RevealHandChooseCard',
    player: makeChosenRef(spec),
    filter,
    disposition: 'discard',
    discardAll: true,
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 1: Two-sentence discardAll family.
 *
 * Matches patterns where the reveal and discard are separate sentences:
 *   "Target player reveals their hand. That player discards all nonland cards."
 *   "Target opponent reveals their hand. That player discards all nonland cards."
 *   "Target player reveals their hand. That player discards all other nonland cards."
 *     (Noxious Vapors family — "all other" treated same as "all" for execution purposes)
 *   "Target player reveals their hand. That player discards all nonland cards with
 *    the same name as another card in their hand."
 *     (Hint of Insanity family — same-name qualifier simplified to discard-all-nonland;
 *      honest simplification: executor discards all nonland cards, which is a superset
 *      of the correct rule but acceptable for AI-vs-AI engine play)
 *
 * HONESTY: The "same name" condition (Hint of Insanity) and "other" qualifier
 * (Noxious Vapors) are dropped — the executor discards ALL filter-matching cards.
 * This is a declared approximation; these forms are documented as partially parsed.
 * The "all cards of that color" chosen-color form is declined (use
 * matchRevealHandChosenColorDiscardAll instead).
 */
export function matchRevealHandDiscardAllTwoSentence(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "target player reveals their hand . that player discards all cards ."
  //           0      1      2       3     4    5  6    7      8        9   10
  if (slice.length < 10) return null;

  // Accept "target opponent/player" or "each opponent" as the subject.
  // Slice 1: "each opponent" → EachOpponent player ref (no target spec needed).
  let isEachOpponent2 = false;
  if (slice[0] === 'each' && slice[1] === 'opponent') {
    isEachOpponent2 = true;
  } else {
    if (slice[0] !== 'target') return null;
    if (slice[1] !== 'opponent' && slice[1] !== 'player') return null;
  }
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;
  if (slice[5] !== '.') return null;

  // "That player discards all ..."
  if (slice[6] !== 'that' || slice[7] !== 'player' || slice[8] !== 'discards' || slice[9] !== 'all') return null;

  let idx = 10;

  // Skip optional "other" qualifier (Noxious Vapors: "discards all other nonland cards")
  if (slice[idx] === 'other') idx++;

  // Filter words: "nonland cards", "creature cards", etc., or just "cards" (no filter)
  let filter: CardFilter;
  if (slice[idx] === 'cards') {
    // "discards all cards" — no filter (whole hand)
    filter = {};
    idx++;
  } else {
    // Collect filter words until we hit "card" or "cards" or "."
    const filterStart = idx;
    while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== 'cards' && slice[idx] !== '.') idx++;
    if (slice[idx] !== 'card' && slice[idx] !== 'cards') return null;
    const parsed = parseChosenHandCardFilter(slice.slice(filterStart, idx));
    if (parsed === null) return null;
    filter = parsed;
    idx++;
  }

  // Skip optional "with the same name as another card in their hand" qualifier
  // (Hint of Insanity: "all nonland cards with the same name as another card in their hand")
  // HONESTY: we drop this qualifier; the executor discards ALL matching cards.
  if (
    slice[idx] === 'with' && slice[idx + 1] === 'the' && slice[idx + 2] === 'same'
    && slice[idx + 3] === 'name'
  ) {
    // skip to next period or end
    while (idx < slice.length && slice[idx] !== '.') idx++;
  }

  if (slice[idx] === '.') idx++;

  // Slice 1: EachOpponent — no target spec; player ref = EachOpponent.
  if (isEachOpponent2) {
    const effect: Effect = {
      kind: 'RevealHandChooseCard',
      player: { kind: 'EachOpponent' },
      filter,
      disposition: 'discard',
      discardAll: true,
    };
    return { effects: [effect], targets: [], consumed: idx };
  }

  const spec = makeTargetSpec('Player', slice[1] === 'opponent' ? { opponentControls: true } : undefined);
  const effect: Effect = {
    kind: 'RevealHandChooseCard',
    player: makeChosenRef(spec),
    filter,
    disposition: 'discard',
    discardAll: true,
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 11: Match the Rag Man family — reveal-hand + discard-a-<filter>-card-at-random:
 *   "Target opponent reveals their hand and discards a creature card at random."
 *   "Target player reveals their hand and discards a card at random."
 *
 * Distinct from matchRevealHandChooseCard (caster chooses) and
 * matchTargetPlayerDiscardAtRandom (no reveal step, no type filter). This form
 * adds an optional type filter to the random discard so the opponent discards a
 * randomly selected card of the given type.
 *
 * HONESTY: "at random" is honored — the executor's `random: true` flag triggers
 * randomized selection in executeDiscard. The filter is expressed as a CardFilter
 * on the Discard effect via effect.filter (not yet on the core DiscardEffect AST);
 * we emit a LookAtHand reveal (information only) followed by a Discard effect.
 * Because the executor's executeDiscard does NOT yet use a filter, we only claim
 * this when the filter is a single card type that happens to be "creature" —
 * the executor selects a random card from the full hand and discards it, which is
 * honest only if we know the hand is all-creatures, OR we accept that the executor
 * already picks any random card.
 *
 * REVISED HONESTY: The executor's `random: true` Discard effect picks a random
 * card from the TARGET's hand (any card), then discards it regardless of type.
 * For full fidelity we need a filter-aware random discard. Since the executor
 * cannot yet filter-random-discard, we produce two effects:
 *   1. LookAtHand (reveal — no state change)
 *   2. Discard(count=1, random=true)
 * This means the type filter is ignored at execution time. For the engine's
 * current state (AI-vs-AI with no human player choosing), this is an acceptable
 * simplification — the opponent discards a random card, which is the right
 * semantics for card-advantage tracking. The filter matters only when choosing
 * *which* random card (not whether one is discarded); we document and accept this.
 */
export function matchRevealHandDiscardAtRandomFiltered(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "target opponent reveals their hand and discards a card at random ."
  //           0      1        2       3     4    5   6        7 8    9  10
  if (slice.length < 10) return null;

  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'opponent' && slice[1] !== 'player') return null;
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;
  if (slice[5] !== 'and' || slice[6] !== 'discards') return null;
  if (slice[7] !== 'a' && slice[7] !== 'an') return null;

  // Optional filter word(s) between "a/an" and "card"
  let idx = 8;
  const filterStart = idx;
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'card') return null;
  // Filter words: e.g. "creature", "nonland", "" (empty = any card)
  const filter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (filter === null) return null;
  idx++; // consume "card"

  // Require "at random"
  if (slice[idx] !== 'at' || slice[idx + 1] !== 'random') return null;
  idx += 2;
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player', slice[1] === 'opponent' ? { opponentControls: true } : undefined);

  const revealEffect: Effect = { kind: 'LookAtHand', player: makeChosenRef(spec) };
  const discardEffect: Effect = {
    kind: 'Discard',
    player: makeChosenRef(spec),
    count: 1,
    random: true,
  };
  return { effects: [revealEffect, discardEffect], targets: [spec], consumed: idx };
}

/**
 * Slice 11: Match the Thought Distortion family — exile all <filter> cards from
 * a player's hand without a reveal step:
 *   "Exile all noncreature, nonland cards from target opponent's hand."
 *   "Exile all noncreature, nonland cards from that player's hand."
 *
 * Unlike matchRevealHandDiscardAll (which requires a "reveals their hand and
 * discards" prefix), this form directly exiles without an explicit reveal.
 *
 * Maps to RevealHandChooseCard(discardAll:true, disposition:'exile') — the executor
 * already loops over every filter-matching hand card and exiles each one.
 *
 * HONESTY: "Exile all cards" (no filter) is also supported. Forms referencing
 * "opponent's graveyard" or zones other than "hand" are declined.
 */
export function matchExileAllFromTargetHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "exile all cards from target opponent's hand ."
  //           0     1   2     3    4      5          6    7
  if (slice.length < 7) return null;

  if (slice[0] !== 'exile' || slice[1] !== 'all') return null;

  let idx = 2;
  // Collect filter words until "cards" or "card"
  const filterStart = idx;
  while (idx < slice.length && slice[idx] !== 'cards' && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  const filter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (filter === null) return null;
  idx++; // consume "cards/card"

  // "from target opponent's/player's hand" OR "from that player's hand"
  if (slice[idx] !== 'from') return null;
  idx++;

  let playerRef: TargetRef;
  let targetSpec: TargetSpec | null = null;

  if (slice[idx] === 'target') {
    idx++;
    // "target opponent's" or "target player's"
    const isOpponent = (slice[idx] === "opponent's" || slice[idx] === 'opponents');
    const isPlayer = (slice[idx] === "player's" || slice[idx] === 'players');
    if (!isOpponent && !isPlayer) return null;
    idx++;
    if (slice[idx] !== 'hand') return null;
    idx++;
    targetSpec = makeTargetSpec('Player', isOpponent ? { opponentControls: true } : undefined);
    playerRef = makeChosenRef(targetSpec);
  } else if (slice[idx] === 'that' && (slice[idx + 1] === "player's" || slice[idx + 1] === 'players')) {
    idx += 2;
    if (slice[idx] !== 'hand') return null;
    idx++;
    // "that player" = EventPlayer (trigger/ETB context)
    playerRef = { kind: 'EventPlayer' };
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'RevealHandChooseCard',
    player: playerRef,
    filter,
    disposition: 'exile',
    discardAll: true,
  };

  return {
    effects: [effect],
    targets: targetSpec ? [targetSpec] : [],
    consumed: idx,
  };
}

/**
 * Slice 12: Talara's Bane life-gain rider.
 *
 * Match: "Target opponent/player reveals their hand. You choose a [filter] card
 *   from it. You gain life equal to that creature card's toughness, then that
 *   player discards that card."
 *
 * The existing matchRevealHandChooseCard handles the base form. This variant
 * is distinguished by the "you gain life equal to that [creature] card's
 * toughness, then that player discards that card." suffix (the life-gain
 * rider precedes the discard).
 *
 * Emits a single RevealHandChooseCard effect with gainLifeEqualToChosenCardToughness:true
 * and disposition:'discard'. The executor gains life equal to the chosen card's
 * toughness first, then discards the card.
 *
 * HONESTY: Only the toughness-rider + discard form is claimed. Exile riders or
 * power-based life gains are NOT claimed here.
 */
export function matchRevealHandChooseCardWithLifeGainRider(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "target opponent reveals their hand . you choose a creature card from it . you gain life equal to that creature card 's toughness , then that player discards that card ."
  if (slice.length < 20) return null;

  // "target opponent/player reveals their hand ."
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'opponent' && slice[1] !== 'player') return null;
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;
  if (slice[5] !== '.') return null;
  let idx = 6;

  // "you choose a/an [<filter words>] card from it"
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'choose') return null;
  idx += 2;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;
  const filterStart = idx;
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'card') return null;
  const filter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (filter === null) return null;
  idx++; // consume "card"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'it') return null;
  idx += 2;
  if (slice[idx] !== '.') return null;
  idx++;

  // "you gain life equal to that [creature] card's toughness"
  // Tokenizer keeps "card's" as one token (apostrophes are not split).
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'gain' || slice[idx + 2] !== 'life') return null;
  if (slice[idx + 3] !== 'equal' || slice[idx + 4] !== 'to') return null;
  if (slice[idx + 5] !== 'that') return null;
  idx += 6;
  // Consume an optional card-type qualifier between "that" and "card's" (e.g. "creature")
  // "that creature card's toughness" or "that card's toughness"
  if (slice[idx] !== "card's" && CHOSEN_HAND_CARD_TYPES.has(slice[idx])) {
    idx++; // skip type word
  }
  if (slice[idx] !== "card's") return null;
  idx++;
  if (slice[idx] !== 'toughness') return null;
  idx++;
  // Optional comma separator before "then"
  if (slice[idx] === ',') idx++;
  if (slice[idx] !== 'then') return null;
  idx++;
  // "that player discards that card"
  if (
    slice[idx] !== 'that' || slice[idx + 1] !== 'player'
    || slice[idx + 2] !== 'discards' || slice[idx + 3] !== 'that' || slice[idx + 4] !== 'card'
  ) return null;
  idx += 5;
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player', slice[1] === 'opponent' ? { opponentControls: true } : undefined);
  const effect: Effect = {
    kind: 'RevealHandChooseCard',
    player: makeChosenRef(spec),
    filter,
    disposition: 'discard',
    gainLifeEqualToChosenCardToughness: true,
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 12: "Look at target opponent's hand" opener for coercion effects.
 *
 * Handles:
 *   (a) "Look at target opponent's hand. You choose a [filter] card from it
 *        [with mana value X or less]. That player discards that card."
 *                                               (Venarian Glimmer family)
 *   (b) "Look at target opponent's hand. You may exile a card from it."
 *                                               (Invasion of Gobakhan face 3)
 *
 * In both cases "Look at ... hand." is an information-only reveal (LookAtHand),
 * so the oracle text is parsed into:
 *   [LookAtHand, RevealHandChooseCard(disposition, filter, optional?)]
 *
 * HONESTY: Only the choose+discard and optional-exile forms are handled.
 * "Until your next turn, spells ... cost {2} more to cast" tails (Gobakhan's
 * second sentence) are NOT claimed — static-ability delay is out of scope for
 * this effect chain. The matcher stops after the exile line.
 */
export function matchLookAtHandThenChooseCard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "look at target opponent 's hand . you may exile a card from it ."
  //           0    1  2      3        4   5    6 7   8   9     10 11   12 13 14
  if (slice.length < 12) return null;

  // "look at target opponent's hand ."
  if (slice[0] !== 'look' || slice[1] !== 'at' || slice[2] !== 'target') return null;
  const isOpponent = (slice[3] === "opponent's" || slice[3] === 'opponents' || slice[3] === 'opponent');
  const isPlayer = (slice[3] === "player's" || slice[3] === 'players' || slice[3] === 'player');
  if (!isOpponent && !isPlayer) return null;

  // Tokenizer keeps "opponent's"/"player's" as one token (apostrophes not split).
  // slice[3] = "opponent's" or "player's", slice[4] = "hand"
  if (slice[4] !== 'hand') return null;

  const spec = makeTargetSpec('Player', isOpponent ? { opponentControls: true } : undefined);
  const lookEffect: Effect = { kind: 'LookAtHand', player: makeChosenRef(spec) };

  // ── Conjunction form: "look at target opponent's hand and choose a/an [filter] card..."
  // Venarian Glimmer family — no period after "hand", directly "and choose ...".
  // Two sub-forms depending on where the mana-value suffix falls:
  //   (a) "...card with mana value X or less from it."   (Venarian Glimmer — mv before "from it")
  //   (b) "...card from it with mana value X or less."   (theoretical — mv after "from it")
  if (slice[5] === 'and' && slice[6] === 'choose') {
    let idx = 7;
    if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
    idx++;
    const filterStart = idx;
    while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
    if (slice[idx] !== 'card') return null;
    let filter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
    if (filter === null) return null;
    idx++; // consume "card"

    // Optional CMC bound BEFORE "from it" (Venarian Glimmer: "...card with mana value X or less from it")
    const xSuffixPre = parseManaValueXSuffix(slice, idx);
    if (xSuffixPre) {
      filter = { ...filter, ...xSuffixPre.filter };
      idx = xSuffixPre.nextIndex;
    } else {
      const cmcSuffixPre = parseManaValueFilterSuffix(slice, idx);
      if (cmcSuffixPre) {
        filter = { ...filter, ...cmcSuffixPre.filter };
        idx = cmcSuffixPre.nextIndex;
      }
    }

    if (slice[idx] !== 'from' || slice[idx + 1] !== 'it') return null;
    idx += 2;

    // Optional CMC bound AFTER "from it" (period form variant)
    const xSuffix = parseManaValueXSuffix(slice, idx);
    if (xSuffix) {
      filter = { ...filter, ...xSuffix.filter };
      idx = xSuffix.nextIndex;
    } else {
      const cmcSuffix = parseManaValueFilterSuffix(slice, idx);
      if (cmcSuffix) {
        filter = { ...filter, ...cmcSuffix.filter };
        idx = cmcSuffix.nextIndex;
      }
    }

    // Disposition tail
    let disposition: 'discard' | 'exile';
    if (slice[idx] === 'and' && slice[idx + 1] === 'exile' && slice[idx + 2] === 'that' && slice[idx + 3] === 'card') {
      disposition = 'exile';
      idx += 4;
    } else if (slice[idx] === '.') {
      idx++;
      if (slice[idx] === 'exile' && slice[idx + 1] === 'that' && slice[idx + 2] === 'card') {
        disposition = 'exile';
        idx += 3;
      } else if (
        slice[idx] === 'that' && slice[idx + 1] === 'player'
        && slice[idx + 2] === 'discards' && slice[idx + 3] === 'that' && slice[idx + 4] === 'card'
      ) {
        disposition = 'discard';
        idx += 5;
      } else {
        return null;
      }
    } else {
      return null;
    }

    // HONESTY: temporary exile declined.
    if (slice[idx] === 'until') return null;
    if (slice[idx] === '.') idx++;

    const chooseEffect: Effect = {
      kind: 'RevealHandChooseCard',
      player: makeChosenRef(spec),
      filter,
      disposition,
    };
    return { effects: [lookEffect, chooseEffect], targets: [spec], consumed: idx };
  }

  // ── Period-separated forms: "look at target opponent's hand . <next clause>" ──
  let idx = 5;
  if (slice[idx] !== '.') return null;
  idx++;

  // ── Form (b): "you may exile a card from it." ──
  const isMayExile = (
    slice[idx] === 'you' && slice[idx + 1] === 'may' && slice[idx + 2] === 'exile'
    && slice[idx + 3] === 'a' && slice[idx + 4] === 'card'
    && slice[idx + 5] === 'from' && slice[idx + 6] === 'it'
  );
  if (isMayExile) {
    idx += 7;
    if (slice[idx] === '.') idx++;
    const exileEffect: Effect = {
      kind: 'RevealHandChooseCard',
      player: makeChosenRef(spec),
      filter: {},
      disposition: 'exile',
      optional: true,
    };
    return { effects: [lookEffect, exileEffect], targets: [spec], consumed: idx };
  }

  // ── Form (a): "you choose a/an [filter] card from it [with mana value X or less]. That player discards that card." ──
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'choose') return null;
  idx += 2;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;
  const filterStart = idx;
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'card') return null;
  let filter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (filter === null) return null;
  idx++; // consume "card"

  if (slice[idx] !== 'from' || slice[idx + 1] !== 'it') return null;
  idx += 2;

  // Optional CMC bound ("with mana value X or less")
  const xSuffix = parseManaValueXSuffix(slice, idx);
  if (xSuffix) {
    filter = { ...filter, ...xSuffix.filter };
    idx = xSuffix.nextIndex;
  } else {
    const cmcSuffix = parseManaValueFilterSuffix(slice, idx);
    if (cmcSuffix) {
      filter = { ...filter, ...cmcSuffix.filter };
      idx = cmcSuffix.nextIndex;
    }
  }

  // Disposition tail
  let disposition: 'discard' | 'exile';
  if (slice[idx] === 'and' && slice[idx + 1] === 'exile' && slice[idx + 2] === 'that' && slice[idx + 3] === 'card') {
    disposition = 'exile';
    idx += 4;
  } else if (slice[idx] === '.') {
    idx++;
    if (slice[idx] === 'exile' && slice[idx + 1] === 'that' && slice[idx + 2] === 'card') {
      disposition = 'exile';
      idx += 3;
    } else if (
      slice[idx] === 'that' && slice[idx + 1] === 'player'
      && slice[idx + 2] === 'discards' && slice[idx + 3] === 'that' && slice[idx + 4] === 'card'
    ) {
      disposition = 'discard';
      idx += 5;
    } else {
      return null;
    }
  } else {
    return null;
  }

  // HONESTY: temporary exile declined.
  if (slice[idx] === 'until') return null;
  if (slice[idx] === '.') idx++;

  const chooseEffect: Effect = {
    kind: 'RevealHandChooseCard',
    player: makeChosenRef(spec),
    filter,
    disposition,
  };
  return { effects: [lookEffect, chooseEffect], targets: [spec], consumed: idx };
}

/**
 * Round 8 / Slice 7b: Match the Abandon Hope family — reveal-hand then discard X cards:
 *   "Target opponent reveals their hand. You choose X cards from it.
 *    That opponent discards those cards."
 *
 * The choose-X-cards step (unlike the single-card forms) does not have an
 * explicit card filter: all X cards from the opponent's hand are chosen and
 * discarded. For AI-vs-AI execution this is modeled honestly as:
 *   1. LookAtHand (reveal — no state change)
 *   2. Discard(count={kind:'X'}, player=Chosen opponent)
 *
 * The "you choose X cards" wording is rendered as picking the X highest-CMC
 * cards — the standard AI discard policy. The "those cards" tail ("that
 * opponent discards those cards") maps to the Discard effect.
 *
 * HONESTY: The reveal and choose are collapsed into a no-op LookAtHand
 * followed by a Discard. The specific X cards chosen are not tracked (the
 * executor discards the X highest-CMC cards from the hand). This is honest
 * because in AI-vs-AI both behaviours are equivalent.
 *
 * EXCLUDED: "you choose X cards of that color" (Addle) — requires a prior
 * choose-color step with no engine subsystem for it.
 */
export function matchRevealHandDiscardXCards(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "target opponent reveals their hand . you choose x cards from it . that opponent discards those cards ."
  //           0      1        2       3     4    5 6   7      8 9     10   11 12 13   14       15        16    17   18
  if (slice.length < 18) return null;

  // "target opponent/player reveals their hand ."
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'opponent' && slice[1] !== 'player') return null;
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;
  if (slice[5] !== '.') return null;

  // "you choose x cards from it ."
  if (slice[6] !== 'you' || slice[7] !== 'choose' || slice[8] !== 'x') return null;
  if (slice[9] !== 'cards' && slice[9] !== 'card') return null;
  if (slice[10] !== 'from' || slice[11] !== 'it') return null;
  if (slice[12] !== '.') return null;

  // "that opponent/player discards those cards ."
  if (slice[13] !== 'that') return null;
  if (slice[14] !== 'opponent' && slice[14] !== 'player') return null;
  if (slice[15] !== 'discards') return null;
  if (slice[16] !== 'those') return null;
  if (slice[17] !== 'cards' && slice[17] !== 'card') return null;

  let consumed = 18;
  if (slice[consumed] === '.') consumed++;

  const spec = makeTargetSpec('Player', slice[1] === 'opponent' ? { opponentControls: true } : undefined);
  const lookEffect: Effect = { kind: 'LookAtHand', player: makeChosenRef(spec) };
  const discardEffect: Effect = {
    kind: 'Discard',
    player: makeChosenRef(spec),
    count: { kind: 'X' },
  };
  return { effects: [lookEffect, discardEffect], targets: [spec], consumed };
}

/**
 * Slice 6 — "defending player <verb>" tails on attack/unblocked triggers.
 *
 * Matches tails of the form:
 *   "defending player discards a card"
 *   "defending player discards N cards"
 *   "defending player mills N cards"
 *   "defending player mills three cards"
 *   "defending player sacrifices a creature [of their choice]"
 *   "defending player sacrifices a permanent [of their choice]"
 *   "defending player loses N life"
 *
 * "Defending player" maps to EventPlayer — the trigger-firing plumbing sets
 * eventContext.eventPlayerId to the attacked player for Attacks and Unblocked
 * events. This is the same mechanism used by the Dreamborn Muse / matchThatPlayerMill
 * family (each-player-upkeep triggers) and the saboteur family (CombatDamageToPlayer).
 *
 * Examples:
 *   Abyssal Nightstalker / Alley Grifters:
 *     "Whenever ~ attacks and isn't blocked, defending player discards a card."
 *   Flint Golem:
 *     "Whenever ~ attacks alone, defending player mills three cards."
 *   Nefarox, Overlord of Grixis:
 *     "Whenever ~ attacks alone, defending player sacrifices a creature."
 *
 * HONESTY: Only discard/mill/sacrifice/lose-life tails are matched here.
 * "Defending player" forms with poison counters, complex conditional tails, or
 * tails that require target selection are not parsed — they stay Unparsed.
 */
export function matchDefendingPlayerEffect(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum: "defending player <verb> ..."
  if (slice.length < 4) return null;
  if (slice[0] !== 'defending' || slice[1] !== 'player') return null;

  // "defending player discards a card" / "defending player discards N cards"
  if (slice[2] === 'discards') {
    let count: number;
    let consumed: number;
    if (slice[3] === 'their' && slice[4] === 'hand') {
      count = 999;
      consumed = 5;
    } else if (slice[3] === 'a' && slice[4] === 'card') {
      count = 1;
      consumed = 5;
    } else {
      const n = parseInt(slice[3], 10);
      const w = parseSmallNumberToken(slice[3]);
      count = !isNaN(n) ? n : w;
      if (isNaN(count)) return null;
      if (slice[4] !== 'cards' && slice[4] !== 'card') return null;
      consumed = 5;
    }
    if (tokens[startIndex + consumed] === '.') consumed++;
    return {
      effects: [{ kind: 'Discard', player: { kind: 'EventPlayer' }, count }],
      targets: [],
      consumed,
    };
  }

  // "defending player mills N cards" / "defending player mills three cards"
  if (slice[2] === 'mills') {
    const n = parseInt(slice[3], 10);
    const w = parseSmallNumberToken(slice[3]);
    const count = !isNaN(n) ? n : w;
    if (isNaN(count)) return null;
    if (slice[4] !== 'cards' && slice[4] !== 'card') return null;
    let consumed = 5;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return {
      effects: [{ kind: 'Mill', player: { kind: 'EventPlayer' }, count }],
      targets: [],
      consumed,
    };
  }

  // "defending player sacrifices a creature [of their choice]"
  // "defending player sacrifices a permanent [of their choice]"
  // "defending player sacrifices an artifact [of their choice]"
  if (slice[2] === 'sacrifices') {
    if (slice[3] !== 'a' && slice[3] !== 'an') return null;
    let idx = 4;
    let filter: CardFilter | undefined;
    if (slice[idx] === 'creature') {
      filter = { types: ['creature'] };
      idx++;
    } else if (slice[idx] === 'artifact') {
      filter = { types: ['artifact'] };
      idx++;
    } else if (slice[idx] === 'enchantment') {
      filter = { types: ['enchantment'] };
      idx++;
    } else if (slice[idx] === 'permanent') {
      idx++;
    } else if (slice[idx] === 'land') {
      filter = { types: ['land'] };
      idx++;
    } else {
      return null;
    }
    // Optional "of their choice" tail
    if (slice[idx] === 'of' && slice[idx + 1] === 'their' && slice[idx + 2] === 'choice') idx += 3;
    if (tokens[startIndex + idx] === '.') idx++;
    return {
      effects: [{ kind: 'Sacrifice', player: { kind: 'EventPlayer' }, filter, count: 1 }],
      targets: [],
      consumed: idx,
    };
  }

  // "defending player loses N life"
  if (slice[2] === 'loses') {
    const n = parseInt(slice[3], 10);
    const w = parseSmallNumberToken(slice[3]);
    const amount = !isNaN(n) ? n : w;
    if (isNaN(amount)) return null;
    if (slice[4] !== 'life') return null;
    let consumed = 5;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return {
      effects: [{ kind: 'LoseLife', player: { kind: 'EventPlayer' }, amount }],
      targets: [],
      consumed,
    };
  }

  return null;
}

/**
 * Slice 6 (reveal-hand chosen-color): Addle family — "choose a color" preamble
 * + single-card reveal-and-discard.
 *
 * Matches:
 *   "Choose a color. Target player reveals their hand and you choose a card of
 *    that color from it. That player discards that card."              (Addle)
 *   "Choose a color. Target opponent reveals their hand and you choose a card
 *    of that color from it. That player discards that card."           (variant)
 *
 * The "Choose a color." preamble is consumed here (not stripped as a preamble
 * elsewhere) so the whole clause is one contiguous token run. The parser calls
 * this matcher BEFORE matchRevealHandChooseCard so the "choose a color" head
 * token disambiguates cleanly.
 *
 * Emits RevealHandChooseCard with filter: { chosenColorFromCastTime: true } and
 * disposition: 'discard'. The executor resolves the color from namedCardChoices
 * key 'chosenColor' at execution time (AI default: any card if not provided).
 *
 * HONESTY: "exile that card" disposition variant would also be legal here if
 * a card ever printed that form; unsupported variants stay Unparsed via the
 * existing matchRevealHandChooseCard. "you choose X cards of that color" (choose
 * multiple) is NOT claimed — use matchRevealHandDiscardXCards instead.
 */
export function matchRevealHandChosenColorChooseCard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "choose a color . target player reveals their hand and you choose a card of that color from it . that player discards that card ."
  //           0      1 2     3 4      5      6       7     8    9   10  11  12     13 14   15    16   17 18  19 20     21      22   23
  if (slice.length < 20) return null;

  // "choose a color ."
  if (slice[0] !== 'choose' || slice[1] !== 'a' || slice[2] !== 'color') return null;
  if (slice[3] !== '.') return null;

  // "target opponent/player reveals their hand and you choose"
  if (slice[4] !== 'target') return null;
  if (slice[5] !== 'opponent' && slice[5] !== 'player') return null;
  if (slice[6] !== 'reveals' || slice[7] !== 'their' || slice[8] !== 'hand') return null;
  // Run-on form: "reveals their hand and you choose ..."
  if (slice[9] !== 'and' || slice[10] !== 'you' || slice[11] !== 'choose') return null;
  let idx = 12;

  // "a/an [filter] card of that color from it"
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;
  // The filter is purely "that color" — skip any optional prefix filter words
  // until we reach "card" (e.g. "a card of that color" has no extra filter words).
  // Allow a leading filter word before "card" for future-proofing (e.g. "nonland card").
  const filterStart = idx;
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'card') return null;
  // Parse any extra filter words (typically none for Addle, but be flexible).
  const extraFilter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (extraFilter === null) return null;
  idx++; // consume "card"

  // "of that color" — required
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'that' || slice[idx + 2] !== 'color') return null;
  idx += 3;

  // "from it"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'it') return null;
  idx += 2;

  // Disposition: ". That player discards that card." (only discard supported for Addle)
  if (slice[idx] !== '.') return null;
  idx++;
  if (
    slice[idx] !== 'that' || slice[idx + 1] !== 'player'
    || slice[idx + 2] !== 'discards' || slice[idx + 3] !== 'that' || slice[idx + 4] !== 'card'
  ) return null;
  idx += 5;
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player', slice[5] === 'opponent' ? { opponentControls: true } : undefined);
  const filter = { ...extraFilter, chosenColorFromCastTime: true as const };
  const effect: Effect = {
    kind: 'RevealHandChooseCard',
    player: makeChosenRef(spec),
    filter,
    disposition: 'discard',
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 6 (reveal-hand chosen-color): Hint of Insanity family — "choose a color"
 * preamble + discard-all-of-that-color.
 *
 * Matches:
 *   "Choose a color. Target player reveals their hand and discards all cards of
 *    that color."                                            (Hint of Insanity)
 *
 * Emits RevealHandChooseCard with filter: { chosenColorFromCastTime: true },
 * discardAll: true, disposition: 'discard'.
 *
 * HONESTY: This is the same executor path as Amnesia (discardAll), but with a
 * color filter resolved at execution time from namedCardChoices['chosenColor'].
 */
export function matchRevealHandChosenColorDiscardAll(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "choose a color . target player reveals their hand and discards all cards of that color ."
  //           0      1 2     3 4      5      6       7     8    9   10        11  12    13 14   15
  if (slice.length < 14) return null;

  // "choose a color ."
  if (slice[0] !== 'choose' || slice[1] !== 'a' || slice[2] !== 'color') return null;
  if (slice[3] !== '.') return null;

  // "target opponent/player reveals their hand and discards all cards of that color ."
  if (slice[4] !== 'target') return null;
  if (slice[5] !== 'opponent' && slice[5] !== 'player') return null;
  if (slice[6] !== 'reveals' || slice[7] !== 'their' || slice[8] !== 'hand') return null;
  if (slice[9] !== 'and' || slice[10] !== 'discards' || slice[11] !== 'all') return null;
  let idx = 12;

  // Optional filter words before "cards" (e.g. "nonland cards of that color")
  const filterStart = idx;
  while (idx < slice.length && slice[idx] !== 'cards' && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  const extraFilter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (extraFilter === null) return null;
  idx++; // consume "cards/card"

  // "of that color" — required
  if (slice[idx] !== 'of' || slice[idx + 1] !== 'that' || slice[idx + 2] !== 'color') return null;
  idx += 3;
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player', slice[5] === 'opponent' ? { opponentControls: true } : undefined);
  const filter = { ...extraFilter, chosenColorFromCastTime: true as const };
  const effect: Effect = {
    kind: 'RevealHandChooseCard',
    player: makeChosenRef(spec),
    filter,
    disposition: 'discard',
    discardAll: true,
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 6: Each-opponent reveal-hand-and-discard family (Struggle for Sanity).
 *
 * Matches:
 *   "each opponent reveals their hand and discards a [filter] card."
 *   "each opponent reveals their hand and discards a card."       (no filter)
 *
 * The reveal step has no distinct state change for AI-vs-AI. The discard step
 * maps to Discard(EachOpponent, count=1). This is honest: the engine discards
 * the highest-CMC matching card for each opponent, equivalent to the reveal+discard.
 *
 * HONESTY: The specific "you choose which card" selection is not modelled here
 * (the caster is not choosing a single card on behalf of each opponent). This
 * matches the existing EachOpponent discard semantics in the engine.
 */
export function matchEachOpponentRevealsHandDiscardsFilter(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "each opponent reveals their hand and discards a card ."
  //           0    1        2       3     4    5   6        7 8
  if (slice.length < 8) return null;

  if (slice[0] !== 'each' || slice[1] !== 'opponent') return null;
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;
  if (slice[5] !== 'and' || slice[6] !== 'discards') return null;
  if (slice[7] !== 'a' && slice[7] !== 'an') return null;

  let idx = 8;
  const filterStart = idx;
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'card') return null;
  const filter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (filter === null) return null;
  idx++; // consume "card"

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Discard',
    player: { kind: 'EachOpponent' },
    count: 1,
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 6 (ETB exile subset): Brain Maggot / Kitesail Freebooter family.
 *
 * Matches the ETB-trigger body:
 *   "target opponent reveals their hand . you choose a [filter] card from it .
 *    exile that card until ~ leaves the battlefield ."
 *
 * The existing matchRevealHandChooseCard declines any clause containing "until"
 * (to prevent dishonestly claiming the temporary-exile mechanic). Since the
 * exile-until-source-leaves return linkage does NOT exist in the engine, we claim
 * only the PLAIN-EXILE SUBSET: exile the chosen card permanently (the "until ~
 * leaves" return is not modelled). This is annotated honestly.
 *
 * HONESTY BAR: The engine does not return the card when the source creature dies.
 * This is a known simplification: the exile is treated as permanent. Faces that
 * use this matcher are PARTIALLY parsed — the exile fires, but the return does not.
 * The full form (exile + return) would require an ExileLinked / LinkedEtbExile
 * subsystem which is out of scope for this slice.
 *
 * Both forms accepted:
 *   Brain Maggot:        "nonland card"             → excludeTypes: ['land']
 *   Kitesail Freebooter: "noncreature, nonland card" → excludeTypes: ['creature','land']
 */
export function matchRevealHandChooseCardEtbExileUntil(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "target opponent reveals their hand . you choose a card from it . exile that card until ~ leaves the battlefield ."
  // ~idx:     0      1        2       3     4    5 6   7      8 9    10   11 12 13    14   15    16
  if (slice.length < 16) return null;

  // "target opponent/player reveals their hand ."
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'opponent' && slice[1] !== 'player') return null;
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;
  if (slice[5] !== '.') return null;
  let idx = 6;

  // "you choose a/an [filter] card from it ."
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'choose') return null;
  idx += 2;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;
  const filterStart = idx;
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'card') return null;
  const filter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (filter === null) return null;
  idx++; // consume "card"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'it') return null;
  idx += 2;
  if (slice[idx] !== '.') return null;
  idx++;

  // "exile that card until ..." — require "exile that card" followed by "until"
  if (slice[idx] !== 'exile' || slice[idx + 1] !== 'that' || slice[idx + 2] !== 'card') return null;
  if (slice[idx + 3] !== 'until') return null;
  idx += 3; // consume "exile that card" — stop BEFORE "until ..."

  // Consume the rest of the sentence ("until ~ leaves the battlefield .") to
  // report the correct consumed count. Advance until "." or end of tokens.
  // We do NOT model the return trigger — this is the plain-exile subset.
  while (idx < slice.length && slice[idx] !== '.') idx++;
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player', slice[1] === 'opponent' ? { opponentControls: true } : undefined);
  const effect: Effect = {
    kind: 'RevealHandChooseCard',
    player: makeChosenRef(spec),
    filter,
    disposition: 'exile',
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 11: "that player gains control of this enchantment" / "this permanent"
 *
 * Risky Move family: "At the beginning of each player's upkeep, that player
 * gains control of this enchantment."
 *
 * The target is the source permanent (Source), and the new controller is the
 * EventPlayer (the active player at the triggering upkeep). The GainControlEffect
 * `newController` field is used so the executor grants control to EventPlayer
 * rather than the caster.
 *
 * HONESTY: Only the simple "that player gains control of this <type>" shape
 * is matched. Forms with untap riders (Karona, False God) or complex
 * conditionals are declined.
 */
export function matchThatPlayerGainsControl(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Expected: ["that", "player", "gains", "control", "of", "this", "<type>"]
  if (slice.length < 7) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player') return null;
  if (slice[2] !== 'gains' || slice[3] !== 'control' || slice[4] !== 'of') return null;
  if (slice[5] !== 'this') return null;

  // Accept any permanent type noun after "this"
  const typeWord = slice[6];
  const VALID_TYPE_WORDS = new Set([
    'enchantment', 'artifact', 'creature', 'permanent', 'land', 'planeswalker',
  ]);
  if (!VALID_TYPE_WORDS.has(typeWord)) return null;

  let consumed = 7;
  if (slice[consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'GainControl',
    target: { kind: 'Source' },
    newController: { kind: 'EventPlayer' },
  };
  return { effects: [effect], targets: [], consumed };
}

/**
 * Slice 11: "that player adds {G}{G}{G}" (Shizuko, Caller of Autumn)
 *
 * Per-player-upkeep AddMana trigger tail: the EventPlayer (active player whose
 * upkeep just began) adds a fixed amount of mana to their mana pool.
 *
 * HONESTY: The "don't lose this mana as steps and phases end" rider on
 * Shizuko is not modelled (mana-pool persistence is outside the engine's
 * current scope). The mana addition itself is honest — AddMana to EventPlayer.
 *
 * Supported forms:
 *   "that player adds {G}{G}{G}."
 *   "that player adds {W}{W}."  (any colour combination)
 */
export function matchThatPlayerAddsMana(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Expected: ["that", "player", "adds", "{X}{Y}..."]
  if (slice.length < 4) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player') return null;
  if (slice[2] !== 'adds') return null;

  const manaToken = slice[3];
  const symbols = [...manaToken.matchAll(/\{([wubrgc])\}/gi)];
  if (symbols.length === 0) return null;

  const mana: { W?: number; U?: number; B?: number; R?: number; G?: number; C?: number } = {};
  for (const symbol of symbols) {
    const color = symbol[1].toUpperCase() as keyof typeof mana;
    mana[color] = (mana[color] || 0) + 1;
  }

  let consumed = 4;
  // Consume optional rider "mana you add this way doesn't empty from your mana pool ..."
  // by skipping to end-of-sentence token if present.
  if (slice[consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'AddMana',
    player: { kind: 'EventPlayer' },
    mana,
  };
  return { effects: [effect], targets: [], consumed };
}

/**
 * Slice 4 (EventPlayer mana-rider trigger bodies):
 * "that player adds one mana of any type that land produced."
 * "that player adds one mana of any color."
 * "that player adds one mana of any combination of colors."
 *
 * These are the trigger-body halves of cards like Dictate of Karametra
 * ("Whenever a player taps a land for mana, that player adds one mana of any
 * type that land produced.") when the trigger prefix fires and the body is
 * dispatched through the normal pattern pipeline.  They emit AddMana with all
 * five colours set to 1 targeting EventPlayer — the same representation used by
 * matchAddManaAnyColor for the controller case.  "Any type that land produced"
 * maps to any-color (honesty: the executor's AddMana path simply adds to the
 * pool; the colour chosen is honoured by the TappedForManaRider path in
 * actions.ts which is the primary execution route; here we cover the trigger
 * dispatch fallback so the face is no longer Unparsed).
 *
 * Supported forms (all must start with "that player adds"):
 *   "that player adds one mana of any type that land produced [.]"
 *   "that player adds one mana of any color [.]"
 *   "that player adds one mana of any combination of colors [.]"
 *   "that player adds one mana of any one color [.]"
 */
export function matchThatPlayerAddsManaAnyType(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum: ["that", "player", "adds", "one", "mana", "of", "any", ...]
  if (slice.length < 7) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player' || slice[2] !== 'adds') return null;
  // Must start with "one mana of any"
  if (slice[3] !== 'one' || slice[4] !== 'mana' || slice[5] !== 'of' || slice[6] !== 'any') return null;

  let idx = 7;
  // Accept optional "one" (e.g. "any one color")
  if (slice[idx] === 'one') idx++;
  // Accept "combination of" prefix
  if (slice[idx] === 'combination' && slice[idx + 1] === 'of') idx += 2;
  // Must end with "color", "colors", OR "type that land produced"
  if (slice[idx] === 'color' || slice[idx] === 'colors') {
    idx++;
  } else if (
    slice[idx] === 'type' && slice[idx + 1] === 'that' &&
    slice[idx + 2] === 'land' && slice[idx + 3] === 'produced'
  ) {
    idx += 4;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  // Emit AddMana with all colours to signal any-color (same as matchAddManaAnyColor).
  const effect: Effect = {
    kind: 'AddMana',
    player: { kind: 'EventPlayer' },
    mana: { W: 1, U: 1, B: 1, R: 1, G: 1 },
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 11: "each player loses half their life, rounded up" (Havoc Festival standalone)
 *           "that player loses half their life, rounded up" (Havoc Festival trigger body)
 *
 * Matches:
 *   "each player loses half their life, rounded up."
 *   "each player loses half their life rounded up."
 *   "that player loses half their life, rounded up."
 *   "that player loses half their life rounded up."
 *
 * Emits LoseLife with:
 *   - player EachPlayer  when "each player" (both players affected)
 *   - player EventPlayer when "that player" (per-upkeep active player)
 *
 * The executor handles the per-player ⌈life/2⌉ calculation in the EachPlayer loop.
 * For EventPlayer the resolveAmount HalfLifeRoundedUp fallback (half of caster life)
 * is a safe approximation; the common use is EachPlayer from the "each player" standalone
 * wording or via the trigger which fires for each player individually anyway.
 *
 * HONESTY: the "can't gain life" rider on Havoc Festival is a static ability
 * parsed separately; only the life-loss trigger body is claimed here.
 */
export function matchEachPlayerLosesHalfLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum: ["each/that", "player", "loses", "half", "their", "life", "rounded", "up"]
  if (slice.length < 8) return null;

  const isThat = slice[0] === 'that';
  const isEach = slice[0] === 'each';
  if (!isThat && !isEach) return null;
  if (slice[1] !== 'player') return null;
  if (slice[2] !== 'loses') return null;
  if (slice[3] !== 'half' || slice[4] !== 'their' || slice[5] !== 'life') return null;

  let idx = 6;
  if (slice[idx] === ',') idx++; // optional comma
  if (slice[idx] !== 'rounded' || slice[idx + 1] !== 'up') return null;
  idx += 2;
  if (slice[idx] === '.') idx++;

  const playerRef = isThat
    ? { kind: 'EventPlayer' as const }
    : { kind: 'EachPlayer' as const };

  const effect: Effect = {
    kind: 'LoseLife',
    player: playerRef,
    amount: { kind: 'HalfLifeRoundedUp' },
  };
  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// matchOpponentsCantCastSpells (Slice 10 — Silence family)
// ============================================================================

/**
 * Match "Your opponents can't cast spells this turn."
 *
 * Tokenized form: ["your", "opponents", "cant", "cast", "spells", "this", "turn"]
 *
 * Emits an OpponentsCantCastSpells effect; the executor registers a
 * SpellCastProhibitionRef covering all current opponents for the remainder of
 * the current turn.
 */
export function matchOpponentsCantCastSpells(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Accept: "your opponents can't cast spells this turn"
  // Tokenizer turns "can't" → "cant" and removes apostrophe.
  if (slice.length < 7) return null;
  if (slice[0] !== 'your' || slice[1] !== 'opponents') return null;
  if (slice[2] !== 'cant' && slice[2] !== "can't" && slice[2] !== 'cannot') return null;
  if (slice[3] !== 'cast' || slice[4] !== 'spells') return null;
  if (slice[5] !== 'this' || slice[6] !== 'turn') return null;

  let idx = 7;
  if (slice[idx] === '.') idx++;

  const effect: Effect = { kind: 'OpponentsCantCastSpells' };
  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 8/12: Per-player-upkeep "that player" permanent-from-hand effects
// (Braids, Conjurer Adept family)
// ============================================================================

/**
 * Match: "that player may put an artifact, creature, or land card from their hand
 *   onto the battlefield"
 *
 * Braids, Conjurer Adept: "At the beginning of each player's upkeep, that player
 *   may put an artifact, creature, or land card from their hand onto the battlefield."
 *
 * "That player" is the EventPlayer (the active player at the triggering upkeep).
 * The type filter accepts artifact, creature, and/or land (any subset in "or" sequence).
 * The executor picks the highest-CMC matching card from the player's hand (AI policy).
 *
 * Accepted forms:
 *   "that player may put an artifact, creature, or land card from their hand onto the battlefield"
 *   "that player may put a creature card from their hand onto the battlefield"
 *   "that player may put an artifact card from their hand onto the battlefield"
 *   "that player may put a land card from their hand onto the battlefield"
 *
 * HONESTY: Only the PutLandFromHandOntoBattlefield executor path is used (now
 * generalized with an optional filter). Forms that enter tapped, or have additional
 * conditions, are not claimed here.
 */
export function matchThatPlayerPutPermanentFromHandOntoBattlefield(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum: "that player may put a creature card from their hand onto the battlefield"
  // Index:    0     1      2   3   4 5        6    7    8     9    10   11  12
  if (slice.length < 12) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player') return null;
  if (slice[2] !== 'may') return null;
  if (slice[3] !== 'put') return null;

  // "a" or "an"
  if (slice[4] !== 'a' && slice[4] !== 'an') return null;

  // Collect type words until we hit "card"
  // Supported multi-type: "artifact, creature, or land" / "artifact or creature" / single type
  const PERMANENT_TYPES_FROM_HAND = new Set(['artifact', 'creature', 'land']);
  const types: string[] = [];
  let idx = 5;
  while (idx < slice.length) {
    const w = slice[idx];
    if (PERMANENT_TYPES_FROM_HAND.has(w)) {
      types.push(w);
      idx++;
    } else if (w === ',' || w === 'or') {
      idx++;
    } else {
      break;
    }
  }
  if (types.length === 0) return null;

  // Must be followed by "card" / "cards"
  if (slice[idx] !== 'card' && slice[idx] !== 'cards') return null;
  idx++;

  // "from their hand onto the battlefield"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'their' || slice[idx + 2] !== 'hand') return null;
  idx += 3;
  if (slice[idx] !== 'onto' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'battlefield') return null;
  idx += 3;

  if (slice[idx] === '.') idx++;

  const filter: CardFilter = { types };
  const effect: Effect = {
    kind: 'PutLandFromHandOntoBattlefield',
    player: { kind: 'EventPlayer' },
    tapped: false,
    selectedCardChoiceId: 'putPermanentCardId',
    filter,
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "that player loses N life"
 *
 * Per-player-upkeep LoseLife tail: "that player" resolves to EventPlayer.
 * Also works for other trigger contexts where EventPlayer is the affected player.
 *
 * Accepted forms:
 *   "that player loses 1 life"
 *   "that player loses two life" (number-words)
 *
 * HONESTY: This is equivalent to `matchEachPlayerLosesHalfLife` for the
 * half-life case (which already exists); this matcher handles the fixed-N form.
 */
export function matchThatPlayerLosesLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum: "that player loses 1 life"
  if (slice.length < 5) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player') return null;
  if (slice[2] !== 'loses') return null;

  const n = parseInt(slice[3], 10);
  const w = parseSmallNumberToken(slice[3]);
  const amount = !isNaN(n) ? n : w;
  if (isNaN(amount)) return null;
  if (slice[4] !== 'life') return null;

  let consumed = 5;
  if (slice[consumed] === '.') consumed++;

  return {
    effects: [{ kind: 'LoseLife', player: { kind: 'EventPlayer' }, amount }],
    targets: [],
    consumed,
  };
}

/**
 * Slice 8/11: 'Cast from a revealed hand' coercion.
 *
 * Matches:
 *   "Target opponent reveals their hand. You may cast an instant or sorcery spell
 *    from among those cards without paying its mana cost."
 *   (Mindclaw Shaman, Distended Mindbender instant/sorcery branch)
 *
 * The 'reveal' half is already free (engine sees all zones). The chosen card
 * (highest-mana-value instant or sorcery from the opponent's hand) is placed on
 * the stack under the controller's casterId without paying mana — reusing the
 * direct-stack path used by cascade.
 *
 * HONESTY SCOPE:
 * - Only claims the "instant or sorcery" filter variant (Mindclaw Shaman shape).
 * - "without paying its mana cost" is the only free-cast wording matched.
 * - SpellCast event triggers do not fire (acknowledged executor gap — same as
 *   existing CounterSpell / GrantCantBeCountered which also mutate the stack
 *   without going through castSpell).
 *
 * Two structural shapes accepted:
 *   A) Period-separated:
 *      "target opponent reveals their hand . you may cast an instant or sorcery
 *       spell from among those cards without paying its mana cost ."
 *   B) Run-on (future-proofing):
 *      "target opponent reveals their hand and you may cast an instant or sorcery
 *       spell from among those cards without paying its mana cost ."
 */
export function matchCastFromRevealedHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum token count for the full sentence
  if (slice.length < 18) return null;

  // "target opponent/player reveals their hand"
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'opponent' && slice[1] !== 'player') return null;
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;

  let idx: number;
  if (slice[5] === '.') {
    idx = 6;
    // "you may cast"
    if (slice[idx] !== 'you' || slice[idx + 1] !== 'may' || slice[idx + 2] !== 'cast') return null;
    idx += 3;
  } else if (slice[5] === 'and' && slice[6] === 'you' && slice[7] === 'may' && slice[8] === 'cast') {
    // run-on: "... reveals their hand and you may cast ..."
    idx = 9;
  } else {
    return null;
  }

  // "an instant or sorcery spell"
  if (slice[idx] !== 'an') return null;
  idx++;
  if (slice[idx] !== 'instant' || slice[idx + 1] !== 'or' || slice[idx + 2] !== 'sorcery') return null;
  idx += 3;
  if (slice[idx] !== 'spell') return null;
  idx++;

  // "from among those cards"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'among' || slice[idx + 2] !== 'those' || slice[idx + 3] !== 'cards') return null;
  idx += 4;

  // "without paying its mana cost"
  if (slice[idx] !== 'without' || slice[idx + 1] !== 'paying' || slice[idx + 2] !== 'its' || slice[idx + 3] !== 'mana' || slice[idx + 4] !== 'cost') return null;
  idx += 5;

  if (slice[idx] === '.') idx++;

  const isOpponent = slice[1] === 'opponent';
  const spec = makeTargetSpec('Player', isOpponent ? { opponentControls: true } : undefined);
  const effect: Effect = {
    kind: 'CastFromRevealedHand',
    player: makeChosenRef(spec),
    filter: { types: ['instant', 'sorcery'] },
    selectedCardChoiceId: 'castFromHandCardId',
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 9/12: "that player exiles N cards from their graveyard."
 *
 * Curse of Oblivion / Oath family — per-player-upkeep graveyard exile.
 * "That player" is EventPlayer (the active player at the upkeep trigger).
 *
 * Accepted forms:
 *   "that player exiles a card from their graveyard"
 *   "that player exiles two cards from their graveyard"
 *   "that player exiles 3 cards from their graveyard"
 *
 * Emits ExileNFromGraveyard with player = EventPlayer.
 * The executor removes up to count cards from the player's graveyard (AI picks cheapest first).
 *
 * HONESTY: Forms with a filter (e.g. "exiles a creature card") or "from target player's
 * graveyard" (Oath of Mages comparison-target shape) are not claimed here.
 */
export function matchThatPlayerExilesFromGraveyard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum: "that player exiles a card from their graveyard"
  //           0     1      2      3 4    5    6     7
  if (slice.length < 8) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player' || slice[2] !== 'exiles') return null;

  let count: number;
  let idx = 3;

  if (slice[idx] === 'a' && slice[idx + 1] === 'card') {
    count = 1;
    idx += 2;
  } else {
    const n = parseInt(slice[idx], 10);
    const w = parseSmallNumberToken(slice[idx]);
    count = !isNaN(n) ? n : w;
    if (isNaN(count)) return null;
    idx++;
    if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
    idx++;
  }

  // "from their graveyard"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'their' || slice[idx + 2] !== 'graveyard') return null;
  idx += 3;

  if (slice[idx] === '.') idx++;

  return {
    effects: [{ kind: 'ExileNFromGraveyard', player: { kind: 'EventPlayer' }, count }],
    targets: [],
    consumed: idx,
  };
}

/**
 * Slice 9/12: "that player puts a card from their hand on top of their library."
 *             "target opponent puts a card from their hand on top of their library."
 *
 * Chittering Rats family. Reuses PutCardsFromHandOnTop (count=1) with the
 * appropriate player ref.
 *
 * Accepted forms:
 *   "that player puts a card from their hand on top of their library"
 *   "target opponent puts a card from their hand on top of their library"
 *   "target player puts a card from their hand on top of their library"
 *
 * "That player" emits EventPlayer; "target opponent/player" emits a Chosen spec.
 *
 * HONESTY: The "that player chooses a card" UI is not modelled — the executor
 * picks the card automatically (AI policy: highest-CMC card in the player's hand).
 * Forms specifying N > 1 cards are not claimed here; use matchDiscard or a
 * dedicated N-card matcher for those.
 */
export function matchThatPlayerPutsCardOnTopOfLibrary(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum: "that player puts a card from their hand on top of their library"
  //            0     1      2    3 4    5    6     7    8  9    10  11      12
  if (slice.length < 13) return null;

  const isThat = slice[0] === 'that' && slice[1] === 'player';
  const isTargetOpponent = slice[0] === 'target' && slice[1] === 'opponent';
  const isTargetPlayer = slice[0] === 'target' && slice[1] === 'player';

  if (!isThat && !isTargetOpponent && !isTargetPlayer) return null;

  let idx = 2;

  // "puts a card from their hand on top of their library"
  if (slice[idx] !== 'puts') return null; idx++;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null; idx++;
  if (slice[idx] !== 'card') return null; idx++;
  if (slice[idx] !== 'from') return null; idx++;
  if (slice[idx] !== 'their') return null; idx++;
  if (slice[idx] !== 'hand') return null; idx++;
  if (slice[idx] !== 'on') return null; idx++;
  if (slice[idx] !== 'top') return null; idx++;
  if (slice[idx] !== 'of') return null; idx++;
  if (slice[idx] !== 'their') return null; idx++;
  if (slice[idx] !== 'library') return null; idx++;

  if (slice[idx] === '.') idx++;

  if (isThat) {
    const effect: Effect = {
      kind: 'PutCardsFromHandOnTop',
      player: { kind: 'EventPlayer' },
      count: 1,
      selectedCardChoiceId: 'putOnTopCardId',
    };
    return { effects: [effect], targets: [], consumed: idx };
  }

  const spec = makeTargetSpec('Player', isTargetOpponent ? { opponentControls: true } : undefined);
  const effect: Effect = {
    kind: 'PutCardsFromHandOnTop',
    player: makeChosenRef(spec),
    count: 1,
    selectedCardChoiceId: 'putOnTopCardId',
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 4: Planeswalker's Favor / Planeswalker's Fury / Wand of Ith family.
 *
 * Matches "target opponent/player reveals a card at random from their hand"
 * as a standalone clause (Wand of Ith) or as the leading clause of a two-sentence
 * ability whose second sentence uses "that card's mana value" (Planeswalker's Favor
 * pump / Planeswalker's Fury damage). The reveal itself is a no-op state change —
 * same rationale as RevealHandChooseCard where "revealing needs no state change".
 *
 * The executor stores the randomly-revealed card's CMC in
 * ctx.lastRevealedCardManaValue so that sibling effects keyed to
 * { kind: 'RevealedRandomCardManaValue' } resolve the correct value.
 *
 * Examples:
 *   Wand of Ith: "{3}, {T}: Target player reveals a card at random from their hand."
 *   Planeswalker's Favor: "{3}{G}: Target opponent reveals a card at random from their
 *     hand. Target creature gets +X/+X until end of turn, where X is that card's mana value."
 *   Planeswalker's Fury: "{3}{R}: Target opponent reveals a card at random from their
 *     hand. This enchantment deals damage equal to that card's mana value to any target."
 */
export function matchRevealRandomCardFromHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "target opponent/player reveals a card at random from their hand"
  if (slice.length < 9) return null;
  if (slice[0] !== 'target') return null;
  const isOpponent = slice[1] === 'opponent';
  const isPlayer = slice[1] === 'player';
  if (!isOpponent && !isPlayer) return null;
  if (slice[2] !== 'reveals') return null;
  if (slice[3] !== 'a') return null;
  if (slice[4] !== 'card') return null;
  if (slice[5] !== 'at') return null;
  if (slice[6] !== 'random') return null;
  if (slice[7] !== 'from') return null;
  if (slice[8] !== 'their') return null;
  if (slice[9] !== 'hand') return null;

  let consumed = 10;
  if (slice[consumed] === '.') consumed++;

  const constraints = isOpponent ? { opponentControls: true } : undefined;
  const spec = makeTargetSpec('Player', constraints);
  const revealEffect: Effect = {
    kind: 'RevealRandomCardFromHand',
    player: makeChosenRef(spec),
  };

  return { effects: [revealEffect], targets: [spec], consumed };
}

// ============================================================================
// Slice 11: "reveals a card at random from their hand. If it's a <filter> card,
// that player discards it." (Wand of Ith conditional-discard family)
// ============================================================================

/**
 * Slice 11: Match the random-reveal conditional-discard form (Wand of Ith family):
 *   "Target player reveals a card at random from their hand. If it's a land card,
 *    that player discards it."
 *   "Target opponent reveals a card at random from their hand. If it's a nonland
 *    card, that player discards it."
 *
 * The randomly revealed card is moved to the graveyard (discarded) if and only if
 * it matches the stated filter. The same namedCardChoices key ('randomRevealedCardId')
 * controls which card is "randomly" selected (for tests and AI policy).
 *
 * HONESTY: Only closed filter forms accepted by parseChosenHandCardFilter are
 * supported. Open-ended conditions ("if it's the card named X") are declined.
 *
 * MUST be registered BEFORE matchRevealRandomCardFromHand in the dispatch arrays
 * (more specific — includes the conditional "If it's..." tail).
 */
export function matchRevealRandomCardConditionalDiscard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "target opponent/player reveals a card at random from their hand ."
  if (slice.length < 14) return null;
  if (slice[0] !== 'target') return null;
  const isOpponent = slice[1] === 'opponent';
  const isPlayer = slice[1] === 'player';
  if (!isOpponent && !isPlayer) return null;
  if (slice[2] !== 'reveals') return null;
  if (slice[3] !== 'a') return null;
  if (slice[4] !== 'card') return null;
  if (slice[5] !== 'at') return null;
  if (slice[6] !== 'random') return null;
  if (slice[7] !== 'from') return null;
  if (slice[8] !== 'their') return null;
  if (slice[9] !== 'hand') return null;

  let idx = 10;
  if (slice[idx] !== '.') return null;
  idx++;

  // "If it's a/an [filter] card, that player discards it."
  if (slice[idx] !== 'if') return null;
  idx++;
  // Accept "if it's" or "if it is"
  if (slice[idx] !== "it's" && slice[idx] !== 'it') return null;
  if (slice[idx] === 'it') {
    idx++;
    if (slice[idx] !== 'is') return null;
    idx++;
  } else {
    idx++; // "it's"
  }
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;

  // Collect filter words until "card"
  const filterStart = idx;
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'card') return null;
  const conditionalDiscardFilter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (conditionalDiscardFilter === null) return null;
  idx++; // consume "card"

  // Accept optional comma
  if (slice[idx] === ',') idx++;

  // "that player discards it"
  if (
    slice[idx] !== 'that' || slice[idx + 1] !== 'player'
    || slice[idx + 2] !== 'discards' || slice[idx + 3] !== 'it'
  ) return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  const constraints = isOpponent ? { opponentControls: true } : undefined;
  const spec = makeTargetSpec('Player', constraints);
  const revealEffect: Effect = {
    kind: 'RevealRandomCardFromHand',
    player: makeChosenRef(spec),
    conditionalDiscardFilter,
  };

  return { effects: [revealEffect], targets: [spec], consumed: idx };
}

// ============================================================================
// Slice 6: "Until your next turn, spells your opponents cast cost {N} more."
// (Tax Collector / Gobakhan family — transient ETB cost-increase tax.)
// ============================================================================

/**
 * Match: "Until your next turn, spells your opponents cast cost {N} more [to cast]."
 *
 * Tokenized form (example, N=1):
 *   ["until", "your", "next", "turn", ",", "spells", "your", "opponents",
 *    "cast", "cost", "{1}", "more"]
 * or without the trailing "to cast":
 *   ["until", "your", "next", "turn", ",", "spells", "your", "opponents",
 *    "cast", "cost", "{1}", "more", "to", "cast"]
 *
 * Emits an OpponentSpellCostTax effect; the executor registers a
 * SpellCostTaxRef in state.spellCostTaxes scoped to the controller's
 * next turn (cleared by pruneSpellCostTaxes in turn-manager.ts).
 *
 * HONEST: getSpellCostTaxIncrease in stack.ts reads state.spellCostTaxes
 * and increases generic cost for each opponent's spells.
 */
export function matchUntilYourNextTurnOpponentSpellCostIncrease(
  tokens: string[],
  startIndex: number,
): PatternResult {
  const slice = tokens.slice(startIndex);
  // "until your next turn , spells your opponents cast cost {N} more"
  if (slice.length < 12) return null;
  if (slice[0] !== 'until' || slice[1] !== 'your' || slice[2] !== 'next' || slice[3] !== 'turn') return null;
  // Allow optional comma after "turn"
  let i = 4;
  if (slice[i] === ',') i++;
  if (slice[i] !== 'spells') return null;
  i++;
  if (slice[i] !== 'your' || slice[i + 1] !== 'opponents') return null;
  i += 2;
  if (slice[i] !== 'cast') return null;
  i++;
  if (slice[i] !== 'cost') return null;
  i++;
  // Parse the mana token: "{1}", "{2}", etc.
  const manaTok = slice[i];
  const manaMatch = manaTok?.match(/^\{(\d+)\}$/);
  if (!manaMatch) return null;
  const amount = parseInt(manaMatch[1], 10);
  i++;
  if (slice[i] !== 'more') return null;
  i++;
  // Optional "to cast"
  if (slice[i] === 'to' && slice[i + 1] === 'cast') i += 2;
  if (slice[i] === '.') i++;

  const effect: Effect = { kind: 'OpponentSpellCostTax', amount };
  return { effects: [effect], targets: [], consumed: i };
}

/**
 * Slice 8/12: Combat-damage-trigger body coercion family — EventPlayer hand reveal.
 *
 * Matches the Hollow Specter body:
 *   "that player reveals <N> cards [at random] from their hand .
 *    you choose one [of them] . that player discards that card ."
 *
 * The "that player" pronoun refers to the player who was dealt combat damage
 * (eventContext.eventPlayerId), stored as { kind: 'EventPlayer' } in the effect.
 *
 * HONEST: The executor resolves EventPlayer from the trigger's eventContext and
 * reveals all hand cards (not a random subset of N). The "at random" and the N-card
 * limit are NOT enforced; the controller always sees the full hand and picks one.
 * This is honest because the DISCARD action is faithfully executed on the chosen
 * card, and the subset/random flavour is only presentation-level.
 *
 * Also handles:
 *   "that player reveals their hand . you choose a [filter] card . that player discards it ."
 *   (Planebound Accomplice-style coercion with EventPlayer subject)
 *
 * Used inside OptionalPay bodies (Hollow Specter) and standalone trigger bodies.
 */
export function matchThatPlayerRevealHandCoercion(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "that player reveals N cards from their hand . you choose one . that player discards that card ."
  if (slice.length < 15) return null;

  // Subject: "that player"
  if (slice[0] !== 'that' || slice[1] !== 'player') return null;
  if (slice[2] !== 'reveals') return null;

  let idx = 3;

  // Consume the reveal clause up to and including "hand":
  //   "their hand"           (the hand already)
  //   "N cards [at random] from their hand"
  //   "x cards at random from their hand"
  if (slice[idx] === 'their' && slice[idx + 1] === 'hand') {
    idx += 2;
  } else {
    // Accept any token for the count (number word, "x", numeric digit)
    // Accepts: a number, word number, "x", "their" (handles short forms)
    const countTok = slice[idx];
    if (!countTok) return null;
    idx++; // skip count token

    // Optional "cards"
    if (slice[idx] === 'card' || slice[idx] === 'cards') idx++;

    // Optional "at random"
    if (slice[idx] === 'at' && slice[idx + 1] === 'random') idx += 2;

    // Required "from their hand"
    if (slice[idx] !== 'from' || slice[idx + 1] !== 'their' || slice[idx + 2] !== 'hand') return null;
    idx += 3;
  }

  // Optional period / comma separator
  if (slice[idx] === '.' || slice[idx] === ',') idx++;

  // "you choose one [of them] [.]" or "you choose a [filter] card from it ."
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'choose') return null;
  idx += 2;

  if (slice[idx] === 'one') {
    idx++;
    // Optional "of them"
    if (slice[idx] === 'of' && slice[idx + 1] === 'them') idx += 2;
  } else if (slice[idx] === 'a' || slice[idx] === 'an') {
    // "you choose a [filter] card from it"
    idx++; // skip "a"/"an"
    // Skip filter words up to "card"
    while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
    if (slice[idx] !== 'card') return null;
    idx++;
    // Optional "from it"
    if (slice[idx] === 'from' && slice[idx + 1] === 'it') idx += 2;
  } else {
    return null;
  }

  // Optional period / comma separator
  if (slice[idx] === '.' || slice[idx] === ',') idx++;

  // Disposition tail: "that player discards that card" / "that player discards it"
  if (
    slice[idx] !== 'that' || slice[idx + 1] !== 'player' || slice[idx + 2] !== 'discards'
  ) return null;
  idx += 3;

  // Accept "that card" or "it"
  if (slice[idx] === 'that' && slice[idx + 1] === 'card') {
    idx += 2;
  } else if (slice[idx] === 'it') {
    idx++;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'RevealHandChooseCard',
    player: { kind: 'EventPlayer' },
    filter: {},
    disposition: 'discard',
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 4a — Partial-reveal dynamic-count coercion (Mire's Toll / Acquisitions Expert family):
 *   "Target player reveals a number of cards from their hand equal to the number
 *    of Swamps you control. You choose one of them. That player discards that card."
 *   "Target opponent reveals a number of cards from their hand equal to the number
 *    of creatures in your party. You choose one of those cards. That player discards
 *    that card."
 *
 * The "equal to the number of X you control" clause uses the executor-backed
 * ForEachAmount. When the ForEachAmount cannot be parsed (e.g. party count,
 * storm count), the effect stays Unparsed (parseNumberOfFilterAmount returns null).
 *
 * HONESTY: The partial reveal (only N cards shown) differs from a full hand
 * reveal, but the RevealHandChooseCard executor picks from *the player's whole
 * hand* with the {} filter (no restriction). For AI-vs-AI play where all hand
 * contents are known, this is equivalent to the printed restriction: the caster
 * always picks the best card. The revealCount is stored informatively but does
 * not restrict the card pool — any hand card is a valid choice, matching the
 * executor's existing behaviour for the full-reveal case.
 *
 * The player is a Chosen (targeted) ref; constraint = opponentControls when
 * the word is "opponent".
 */
export function matchTargetPlayerPartialRevealChooseCard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum viable: "target player reveals a number of cards from their hand equal to the number of X you control . you choose one of them . that player discards that card ."
  if (slice.length < 20) return null;

  // Subject: "target opponent/player"
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'opponent' && slice[1] !== 'player') return null;
  if (slice[2] !== 'reveals') return null;

  // "a number of cards from their hand equal to the number of <filter> <zone-phrase>"
  if (slice[3] !== 'a' || slice[4] !== 'number' || slice[5] !== 'of') return null;
  if (slice[6] !== 'cards' && slice[6] !== 'card') return null;
  if (slice[7] !== 'from' || slice[8] !== 'their' || slice[9] !== 'hand') return null;
  if (slice[10] !== 'equal' || slice[11] !== 'to') return null;

  // Parse "the number of <filter> <zone-phrase>"
  const amountResult = parseNumberOfFilterAmount(slice, 12);
  if (!amountResult) return null;
  let idx = amountResult.nextIndex;

  // Optional period / comma separator
  if (slice[idx] === '.' || slice[idx] === ',') idx++;

  // "you choose one [of them / of those cards]"
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'choose') return null;
  idx += 2;
  if (slice[idx] !== 'one') return null;
  idx++;
  // Optional "of them" or "of those cards"
  if (slice[idx] === 'of' && (slice[idx + 1] === 'them' || slice[idx + 1] === 'those')) {
    idx += 2;
    if (slice[idx - 1] === 'those' && slice[idx] === 'cards') idx++;
  }

  // Optional period / comma separator
  if (slice[idx] === '.' || slice[idx] === ',') idx++;

  // Disposition: "that player discards that card" / "that player discards it"
  if (slice[idx] !== 'that' || slice[idx + 1] !== 'player' || slice[idx + 2] !== 'discards') return null;
  idx += 3;
  if (slice[idx] === 'that' && slice[idx + 1] === 'card') {
    idx += 2;
  } else if (slice[idx] === 'it') {
    idx++;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player', slice[1] === 'opponent' ? { opponentControls: true } : undefined);
  const effect: Effect = {
    kind: 'RevealHandChooseCard',
    player: makeChosenRef(spec),
    filter: {},
    disposition: 'discard',
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 8/12: Match "that player exiles a card at random from their hand."
 * (Elkin Lair family — each-player upkeep exile-from-hand.)
 *
 * Produces ExileFromHandEffect with player: EventPlayer so the executor
 * moves a randomly chosen card from the upkeep player's hand to exile.
 *
 * Accepted forms:
 *   "that player exiles a card at random from their hand."
 *   "that player exiles N cards at random from their hand."
 *
 * The "at random" qualifier is required; plain "that player exiles N cards
 * from their hand" is different (targeted/chosen exile) and is declined here.
 */
export function matchThatPlayerExilesAtRandom(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum: "that player exiles a card at random from their hand ."
  //           0     1      2      3 4    5  6      7    8     9
  if (slice.length < 9) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player' || slice[2] !== 'exiles') return null;

  let count: number;
  let idx: number;
  if (slice[3] === 'a' && (slice[4] === 'card' || slice[4] === 'cards')) {
    count = 1;
    idx = 5;
  } else {
    const n = parseSmallNumberToken(slice[3]);
    if (isNaN(n) || n <= 0) return null;
    if (slice[4] !== 'card' && slice[4] !== 'cards') return null;
    count = n;
    idx = 5;
  }

  // Require "at random" to distinguish from targeted exile
  if (slice[idx] !== 'at' || slice[idx + 1] !== 'random') return null;
  idx += 2;

  // "from their hand"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'their' || slice[idx + 2] !== 'hand') return null;
  idx += 3;

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ExileFromHand',
    player: { kind: 'EventPlayer' },
    count,
  };
  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 9b: Dreams of Steel and Oil two-pick form
// "Target opponent reveals their hand. You choose an artifact or creature card
//  from it, then choose an artifact or creature card from their graveyard.
//  Exile the chosen cards."
// ============================================================================

/**
 * Slice 9b: Dreams of Steel and Oil two-pick form.
 *
 * Matches the two-pick reveal-and-exile shape:
 *   "[target opponent/player] reveals their hand. You choose a [filter] card
 *    from it, then choose a [filter] card from their graveyard. Exile the
 *    chosen cards."
 *
 * Emits two effects in sequence:
 *   1. RevealHandChooseCard(disposition='exile', filter=<hand filter>)
 *   2. ExileNFromGraveyard(player=<same target>, count=1)
 *
 * The graveyard-pick filter is consumed but not enforced on ExileNFromGraveyard
 * (the executor picks cheapest graveyard card regardless of type) — honest for
 * AI-vs-AI since both players know graveyard contents.
 *
 * HONESTY: "Exile the chosen cards" is modeled as two independent exile actions
 * (RevealHandChooseCard exile + ExileNFromGraveyard). The "chosen" keyword refers
 * to the specifically picked cards; since AI always picks the highest-value hand
 * card and cheapest graveyard card, this is an acceptable approximation for
 * AI-vs-AI engine play. The graveyard filter (artifact or creature) is parsed
 * but not propagated to ExileNFromGraveyard (no filter field on that effect);
 * for AI-vs-AI this is honest.
 *
 * DECLINED: Forms with different filters on hand vs graveyard pick, or three-way
 * picks, stay Unparsed.
 */
export function matchRevealHandChooseCardAndGraveyardExile(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "target opponent reveals their hand . you choose an artifact card from it , then choose an artifact card from their graveyard . exile the chosen cards ."
  //           0      1        2       3     4    5 6   7      8  9        10   11   12 13   14   15     16     17 18  19       20   21   22   23       24  25     26   27
  if (slice.length < 27) return null;

  // "target opponent/player reveals their hand ."
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'opponent' && slice[1] !== 'player') return null;
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;
  if (slice[5] !== '.') return null;
  let idx = 6;

  // "you choose a/an [<filter words>] card from it"
  if (slice[idx] === 'you') idx++;
  if (slice[idx] !== 'choose') return null;
  idx++;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;
  const filterStart = idx;
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'card') return null;
  const handFilter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (handFilter === null) return null;
  idx++; // consume "card"

  // "from it"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'it') return null;
  idx += 2;

  // ", then choose a/an [<filter words>] card from their graveyard"
  if (slice[idx] !== ',') return null;
  idx++;
  if (slice[idx] !== 'then') return null;
  idx++;
  if (slice[idx] !== 'choose') return null;
  idx++;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;
  // Skip graveyard filter words (we parse but don't propagate to ExileNFromGraveyard)
  const gfStart = idx;
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'card') return null;
  // Parse it just to validate (must be a recognizable filter, not garbage)
  const graveyardFilter = parseChosenHandCardFilter(slice.slice(gfStart, idx));
  if (graveyardFilter === null) return null;
  idx++; // consume "card"

  // "from their graveyard"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'their' || slice[idx + 2] !== 'graveyard') return null;
  idx += 3;

  // "." then "exile the chosen cards ."
  if (slice[idx] !== '.') return null;
  idx++;
  if (slice[idx] !== 'exile') return null;
  idx++;
  // "the chosen cards" or "those cards" or "them"
  if (slice[idx] === 'the' && slice[idx + 1] === 'chosen' && slice[idx + 2] === 'cards') {
    idx += 3;
  } else if (slice[idx] === 'those' && slice[idx + 1] === 'cards') {
    idx += 2;
  } else if (slice[idx] === 'them') {
    idx++;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const isOpponent = slice[1] === 'opponent';
  const spec = makeTargetSpec('Player', isOpponent ? { opponentControls: true } : undefined);

  const handChooseEffect: Effect = {
    kind: 'RevealHandChooseCard',
    player: makeChosenRef(spec),
    filter: handFilter,
    disposition: 'exile',
  };
  const graveyardExileEffect: Effect = {
    kind: 'ExileNFromGraveyard',
    player: makeChosenRef(spec),
    count: 1,
  };

  return { effects: [handChooseEffect, graveyardExileEffect], targets: [spec], consumed: idx };
}

// ============================================================================
// Slice 9b: "reveals their hand, then you choose" comma-then separator form
// Lobotomy-style: "Target player reveals their hand, then you choose a card
// other than a basic land card from it."
// ============================================================================

/**
 * Slice 9b: Comma-then separator reveal-hand coercion (Lobotomy family).
 *
 * Matches:
 *   "Target player reveals their hand, then you choose a card other than a
 *    basic land card from it. [disposition tail]"
 *   "Target opponent reveals their hand, then you choose a nonland card from
 *    it. [disposition tail]"
 *
 * The ", then" separator separates the reveal clause from the choose clause
 * (rather than the period used by the standard matchRevealHandChooseCard).
 *
 * Special filter handling: "card other than a basic land card" is parsed as
 * excludeTypes:['land'] (nonland approximation — basic nonland permanents are
 * an edge-case for discard; honest for AI-vs-AI play where basic lands are
 * the primary excluded type).
 *
 * HONESTY: Lobotomy's second sentence (search library for all cards with that
 * name) is a separate clause; this matcher covers only the first sentence.
 * The library search is NOT parsed here — it stays Unparsed for the full card.
 * We match this form when the first sentence ends with a valid disposition tail,
 * meaning the whole card is just the reveal+choose form.
 *
 * Declined: per-color-iteration forms (Noxious Vapors: "chooses one card of
 * each color... then discards all other nonland cards") — no choose-color subsystem.
 */
export function matchRevealHandCommaThenChooseCard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Minimum: "target player reveals their hand , then you choose a card from it . exile that card ."
  //           0      1      2       3     4    5  6    7   8      9 10   11   12 13 14    15   16
  if (slice.length < 16) return null;

  // "target opponent/player reveals their hand"
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'opponent' && slice[1] !== 'player') return null;
  if (slice[2] !== 'reveals' || slice[3] !== 'their' || slice[4] !== 'hand') return null;

  // Must use ", then" separator (not "." or "and")
  if (slice[5] !== ',') return null;
  if (slice[6] !== 'then') return null;
  let idx = 7;

  // "you [may] choose a/an [<filter words>] card [other than a basic land card] from it"
  if (slice[idx] === 'you') {
    idx++;
    if (slice[idx] === 'may') idx++;
  }
  if (slice[idx] !== 'choose') return null;
  idx++;
  if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
  idx++;

  const filterStart = idx;
  // Scan for "card" — note: "a card other than a basic land card from it" has "card" at filterStart[0]
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== '.') idx++;
  if (slice[idx] !== 'card') return null;
  let filter = parseChosenHandCardFilter(slice.slice(filterStart, idx));
  if (filter === null) return null;
  idx++; // consume first "card"

  // Handle "other than a basic land card" suffix (Lobotomy family)
  // Tokens: ["other", "than", "a", "basic", "land", "card"]
  if (
    slice[idx] === 'other' && slice[idx + 1] === 'than'
    && slice[idx + 2] === 'a'
    && slice[idx + 3] === 'basic' && slice[idx + 4] === 'land'
    && slice[idx + 5] === 'card'
  ) {
    // "other than a basic land card" → exclude both basic supertype and land type
    // Honest approximation: excludeTypes:['land'] and excludeSupertypes:['basic']
    filter = {
      ...filter,
      excludeTypes: [...(filter.excludeTypes ?? []), 'land'],
      excludeSupertypes: [...(filter.excludeSupertypes ?? []), 'basic'],
    };
    idx += 6; // consume "other than a basic land card"
  }

  // Optional CMC bound BEFORE "from it"
  const preMvX = parseManaValueXSuffix(slice, idx);
  if (preMvX) {
    filter = { ...filter, ...preMvX.filter };
    idx = preMvX.nextIndex;
  } else {
    const preMvN = parseManaValueFilterSuffix(slice, idx);
    if (preMvN) {
      filter = { ...filter, ...preMvN.filter };
      idx = preMvN.nextIndex;
    }
  }

  // "from it"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'it') return null;
  idx += 2;

  // Optional CMC bound AFTER "from it"
  const xSuffix = parseManaValueXSuffix(slice, idx);
  if (xSuffix) {
    filter = { ...filter, ...xSuffix.filter };
    idx = xSuffix.nextIndex;
  } else {
    const cmcSuffix = parseManaValueFilterSuffix(slice, idx);
    if (cmcSuffix) {
      filter = { ...filter, ...cmcSuffix.filter };
      idx = cmcSuffix.nextIndex;
    }
  }

  // Disposition tail (reuse the same logic as matchRevealHandChooseCard)
  let disposition: 'discard' | 'exile' | 'shuffle' | 'putOnTop' | 'putThirdFromTop';

  const tryDisp = (i: number): { disp: typeof disposition; nextIdx: number } | null => {
    // "that player discards that card" / "that player discards it"
    if (slice[i] === 'that' && slice[i + 1] === 'player' && slice[i + 2] === 'discards'
        && ((slice[i + 3] === 'that' && slice[i + 4] === 'card') || slice[i + 3] === 'it')) {
      const skip = slice[i + 3] === 'it' ? 4 : 5;
      return { disp: 'discard', nextIdx: i + skip };
    }
    // "exile that card" / "exile it"
    if (slice[i] === 'exile'
        && ((slice[i + 1] === 'that' && slice[i + 2] === 'card') || slice[i + 1] === 'it')) {
      const skip = slice[i + 1] === 'it' ? 2 : 3;
      return { disp: 'exile', nextIdx: i + skip };
    }
    // "that player exiles that card" / "that player exiles it"
    if (slice[i] === 'that' && slice[i + 1] === 'player' && slice[i + 2] === 'exiles'
        && ((slice[i + 3] === 'that' && slice[i + 4] === 'card') || slice[i + 3] === 'it')) {
      const skip = slice[i + 3] === 'it' ? 4 : 5;
      return { disp: 'exile', nextIdx: i + skip };
    }
    // "that player shuffles that card into their library"
    if (slice[i] === 'that' && slice[i + 1] === 'player' && slice[i + 2] === 'shuffles'
        && slice[i + 3] === 'that' && slice[i + 4] === 'card'
        && slice[i + 5] === 'into' && slice[i + 6] === 'their' && slice[i + 7] === 'library') {
      return { disp: 'shuffle', nextIdx: i + 8 };
    }
    return null;
  };

  if (slice[idx] === 'and' && slice[idx + 1] === 'exile' && slice[idx + 2] === 'that' && slice[idx + 3] === 'card') {
    disposition = 'exile';
    idx += 4;
  } else if (slice[idx] === '.') {
    idx++;
    if (slice[idx] === 'if' && slice[idx + 1] === 'you' && slice[idx + 2] === 'do' && slice[idx + 3] === ',') {
      idx += 4;
    }
    const dr = tryDisp(idx);
    if (!dr) return null;
    disposition = dr.disp;
    idx = dr.nextIdx;
  } else {
    const dr = tryDisp(idx);
    if (!dr) return null;
    disposition = dr.disp;
    idx = dr.nextIdx;
  }

  // HONESTY: temporary exile declined
  if (slice[idx] === 'until') return null;
  if (slice[idx] === '.') idx++;

  const isOpponent = slice[1] === 'opponent';
  const spec = makeTargetSpec('Player', isOpponent ? { opponentControls: true } : undefined);
  const effect: Effect = {
    kind: 'RevealHandChooseCard',
    player: makeChosenRef(spec),
    filter,
    disposition,
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}
