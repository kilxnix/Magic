// Trigger-prefix matchers extracted from parser.ts (batch 11/12).
// Do NOT edit logic here — keep verbatim with parser.ts originals.

import type { Trigger } from '../ast';

// ---------------------------------------------------------------------------
// Local helpers (only used by this module's matchers)
// ---------------------------------------------------------------------------

type CreatureETBPrefixMatch = {
  effectStart: number;
  controller?: 'yours' | 'any';
  nontoken?: boolean;
  tokenOnly?: boolean;
};

const SELF_ETB_SUBJECT_TYPES = new Set([
  'creature',
  'artifact',
  'aura',
  'enchantment',
  'permanent',
  'planeswalker',
  'battle',
  'land',
  'equipment', // Slice 7: "this Equipment enters"
]);

function consumeOptionalBattlefield(tokens: string[], idx: number): number {
  if (tokens[idx] === 'the' && tokens[idx + 1] === 'battlefield') return idx + 2;
  return idx;
}

function consumeOptionalComma(tokens: string[], idx: number): number {
  return tokens[idx] === ',' ? idx + 1 : idx;
}

function consumeSelfETBSubject(tokens: string[], idx: number): number {
  if (tokens[idx] === '~') return idx + 1;
  if (tokens[idx] === 'this') {
    if (SELF_ETB_SUBJECT_TYPES.has(tokens[idx + 1])) return idx + 2;
    return idx + 1;
  }
  if (!['a', 'an', 'another', 'one', 'each', 'target'].includes(tokens[idx])) {
    for (let scan = idx + 1; scan < Math.min(tokens.length, idx + 8); scan++) {
      if (tokens[scan] === 'enters') return scan;
    }
  }
  return -1;
}

/**
 * Read an optional "with mana value N or less" rider on cast-trigger heads
 * (Scalding Viper). Returns the constraint and the index after the rider,
 * or null when the tokens at idx are not the rider.
 */
function readMaxManaValueRider(tokens: string[], idx: number): { maxManaValue: number; nextIndex: number } | null {
  if (tokens[idx] !== 'with' || tokens[idx + 1] !== 'mana' || tokens[idx + 2] !== 'value') return null;
  const n = parseInt(tokens[idx + 3], 10);
  if (isNaN(n)) return null;
  if (tokens[idx + 4] !== 'or' || tokens[idx + 5] !== 'less') return null;
  return { maxManaValue: n, nextIndex: idx + 6 };
}

// ---------------------------------------------------------------------------
// Trigger-prefix matchers
// ---------------------------------------------------------------------------

/**
 * Check if tokens start with ETB trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchETBPrefix(tokens: string[]): number {
  // "when ~ enters the battlefield ,"
  // "whenever ~ enters the battlefield ,"
  // "when this creature enters ,"
  // "whenever ~ enters or attacks ,"

  if (tokens.length < 4) return -1;

  const first = tokens[0];
  if (first !== 'when' && first !== 'whenever') return -1;
  let idx = consumeSelfETBSubject(tokens, 1);
  if (idx < 0) return -1;
  if (tokens[idx] !== 'enters') return -1;
  idx++;

  if (tokens[idx] === 'or' && tokens[idx + 1] === 'attacks') {
    idx += 2;
    if (tokens[idx] === ',') idx++;
    return idx;
  }

  idx = consumeOptionalBattlefield(tokens, idx);
  idx = consumeOptionalComma(tokens, idx);

  return idx;
}

// "put into a graveyard from the battlefield" subject types that are
// recognised as self-referential in the Dies-trigger context.
const GRAVEYARD_SELF_SUBJECTS = new Set([
  'creature', 'enchantment', 'artifact', 'land', 'permanent',
  'aura', 'equipment', 'vehicle',
]);

/**
 * Check if tokens start with dies trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 *
 * In addition to the canonical "when ~ dies" wording, also handles the
 * older "is put into a graveyard from the battlefield" phrasing used by
 * cards like Strong Back:
 *   "When ~ is put into a graveyard from the battlefield ,"
 *   "When this <subtype> is put into a graveyard from the battlefield ,"
 *   "When enchanted creature is put into a graveyard from the battlefield ,"
 * These are semantically equivalent to the Dies trigger and fire via the
 * same state-based-action path (state-based.ts creature-death check).
 */
export function matchDiesPrefix(tokens: string[]): number {
  // "when ~ dies ,"
  // "whenever ~ dies ,"
  // "when enchanted creature dies ,"

  if (tokens.length < 4) return -1;

  const first = tokens[0];
  if (first !== 'when' && first !== 'whenever') return -1;
  if (tokens[1] === 'enchanted' && tokens[2] === 'creature' && tokens[3] === 'dies') {
    let idx = 4;
    if (tokens[idx] === ',') idx++;
    return idx;
  }
  // Modern self-reference wording: "when this creature dies ,"
  if (tokens[1] === 'this' && tokens[2] === 'creature' && tokens[3] === 'dies') {
    let idx = 4;
    if (tokens[idx] === ',') idx++;
    return idx;
  }

  // Older "is put into a graveyard from the battlefield" wording.
  // Patterns:
  //   "when ~   is put into a graveyard from the battlefield ,"
  //   "when this <subtype> is put into a graveyard from the battlefield ,"
  //   "when enchanted creature is put into a graveyard from the battlefield ,"
  // Tokens after consuming the subject must start with:
  //   is put into a graveyard from the battlefield [,]
  {
    let subjEnd = -1;
    if (tokens[1] === '~') {
      subjEnd = 2;
    } else if (tokens[1] === 'this' && tokens[2] && GRAVEYARD_SELF_SUBJECTS.has(tokens[2])) {
      subjEnd = 3;
    } else if (tokens[1] === 'enchanted' && tokens[2] === 'creature') {
      subjEnd = 3;
    }
    if (subjEnd > 0) {
      // Expect: is put into a graveyard from the battlefield
      const rest = tokens.slice(subjEnd);
      if (
        rest[0] === 'is' &&
        rest[1] === 'put' &&
        rest[2] === 'into' &&
        rest[3] === 'a' &&
        rest[4] === 'graveyard' &&
        rest[5] === 'from' &&
        rest[6] === 'the' &&
        rest[7] === 'battlefield'
      ) {
        let idx = subjEnd + 8;
        if (tokens[idx] === ',') idx++;
        return idx;
      }
    }
  }

  if (tokens[1] !== '~') return -1;
  if (tokens[2] !== 'dies') return -1;

  // Optional comma
  let idx = 3;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever ~ attacks ," trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 *
 * Handles three self-attack phrasings:
 *   "Whenever ~ attacks ,"                    (self-reference tilde)
 *   "Whenever this creature attacks ,"         (modern self wording)
 *   "Whenever [CardName] attacks ,"            (named-card form, up to 5 name words)
 *
 * Named-card forms appear when a card uses its own printed name as the trigger
 * subject (e.g. "Whenever Traveling Botanist attacks,"). The tokenizer lowercases
 * the text, so the name words are plain alphabetic tokens. We scan forward up to
 * MAX_NAME_TOKENS positions, accepting only plain word tokens (alphabetic or
 * hyphenated), and require the subject to be followed immediately by "attacks".
 */
export function matchAttacksPrefix(tokens: string[]): number {
  if (tokens.length < 4) return -1;

  const first = tokens[0];
  if (first !== 'when' && first !== 'whenever') return -1;
  let idx = 1;
  if (tokens[idx] === '~') {
    idx++;
  } else if (tokens[idx] === 'this' && tokens[idx + 1] === 'creature') {
    idx += 2;
  } else {
    // Named-card form: scan forward for "attacks" within up to 5 name tokens.
    // Only accept tokens that look like name words (alphabetic/hyphenated) —
    // stop at punctuation, numbers, or functional words that could not be part
    // of a card name subject.
    const NAME_WORD_RE = /^[a-z][a-z'-]*$/;
    const FUNCTIONAL_WORDS = new Set([
      'the', 'a', 'an', 'of', 'to', 'in', 'on', 'or', 'and', 'if', 'with',
      'from', 'that', 'this', 'your', 'my', 'its', 'their', 'you', 'they',
    ]);
    const MAX_NAME_TOKENS = 5;
    let nameEnd = idx;
    while (
      nameEnd < tokens.length &&
      nameEnd - idx < MAX_NAME_TOKENS &&
      NAME_WORD_RE.test(tokens[nameEnd]) &&
      !FUNCTIONAL_WORDS.has(tokens[nameEnd]) &&
      tokens[nameEnd] !== 'attacks'
    ) {
      nameEnd++;
    }
    // Must have consumed at least one name word before "attacks".
    if (nameEnd === idx || tokens[nameEnd] !== 'attacks') return -1;
    idx = nameEnd;
  }
  if (tokens[idx] !== 'attacks') return -1;

  idx++;
  if (tokens[idx] === ',') idx++;

  return idx;
}

export function matchSelfAttacksAlonePrefix(tokens: string[]): number {
  if (tokens.length < 4) return -1;

  const first = tokens[0];
  if (first !== 'when' && first !== 'whenever') return -1;
  let idx = 1;
  if (tokens[idx] === '~') {
    idx++;
  } else if (tokens[idx] === 'this' && tokens[idx + 1] === 'creature') {
    idx += 2;
  } else {
    return -1;
  }
  if (tokens[idx] !== 'attacks') return -1;
  if (tokens[idx + 1] !== 'alone') return -1;

  idx += 2;
  if (tokens[idx] === ',') idx++;

  return idx;
}

export function matchSelfAttacksAndIsntBlockedPrefix(tokens: string[]): number {
  if (tokens.length < 8) return -1;

  const first = tokens[0];
  if (first !== 'when' && first !== 'whenever') return -1;
  let idx = 1;
  if (tokens[idx] === '~') {
    idx++;
  } else if (tokens[idx] === 'this' && tokens[idx + 1] === 'creature') {
    idx += 2;
  } else {
    return -1;
  }

  if (tokens[idx] !== 'attacks') return -1;
  if (tokens[idx + 1] !== 'and') return -1;
  if (tokens[idx + 2] !== "isn't" && tokens[idx + 2] !== 'isnt' && tokens[idx + 2] !== 'is') return -1;
  const notOffset = tokens[idx + 2] === 'is' ? 3 : 2;
  if (tokens[idx + notOffset] !== 'not' && notOffset === 3) return -1;
  if (tokens[idx + notOffset + 1] !== 'blocked') return -1;

  idx += notOffset + 2;
  if (tokens[idx] === ',') idx++;

  return idx;
}

export function matchSelfBecomesTappedPrefix(tokens: string[]): number {
  if (tokens.length < 5) return -1;

  const first = tokens[0];
  if (first !== 'when' && first !== 'whenever') return -1;

  let idx = 1;
  if (tokens[idx] === '~') {
    idx++;
  } else if (tokens[idx] === 'this') {
    idx++;
    if (SELF_ETB_SUBJECT_TYPES.has(tokens[idx])) idx++;
  } else {
    return -1;
  }

  if (tokens[idx] !== 'becomes') return -1;
  if (tokens[idx + 1] !== 'tapped') return -1;

  idx += 2;
  if (tokens[idx] === ',') idx++;

  return idx;
}

export function matchCreatureYouControlAttacksPrefix(tokens: string[]): number {
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'a') return -1;
  if (tokens[2] !== 'creature') return -1;
  if (tokens[3] !== 'you') return -1;
  if (tokens[4] !== 'control') return -1;
  if (tokens[5] !== 'attacks') return -1;

  let idx = 6;
  if (tokens[idx] === ',') idx++;

  return idx;
}

// Subject words accepted in addition to '~' for self-combat-damage triggers.
// Matches "this creature", "this Vehicle", "this permanent" — modern templating.
// Slice 4 (self-reference normalization): 'this Vehicle' is normalised to
// 'this artifact' before tokenisation, so 'artifact' must be accepted here.
const SELF_COMBAT_DAMAGE_SUBJECT_TYPES = new Set([
  'creature',
  'artifact',
  'vehicle',
  'permanent',
]);

export function matchSelfCombatDamageToPlayerPrefix(tokens: string[]): number {
  if (tokens.length < 9) return -1;
  if (tokens[0] !== 'whenever') return -1;

  let idx = 1;
  if (tokens[idx] === '~') {
    idx++;
  } else if (tokens[idx] === 'this' && SELF_COMBAT_DAMAGE_SUBJECT_TYPES.has(tokens[idx + 1])) {
    idx += 2;
  } else {
    // Slice 3: Named-card form — "Whenever Balefire Dragon deals combat damage ..."
    // Scan forward up to MAX_NAME_TOKENS plain word tokens looking for 'deals'.
    // Mirrors the named-card logic in matchAttacksPrefix.
    const NAME_WORD_RE = /^[a-z][a-z'-]*$/;
    const FUNCTIONAL_WORDS = new Set([
      'the', 'a', 'an', 'of', 'to', 'in', 'on', 'or', 'and', 'if', 'with',
      'from', 'that', 'this', 'your', 'my', 'its', 'their', 'you', 'they',
    ]);
    const MAX_NAME_TOKENS = 5;
    let nameEnd = idx;
    while (
      nameEnd < tokens.length &&
      nameEnd - idx < MAX_NAME_TOKENS &&
      NAME_WORD_RE.test(tokens[nameEnd]) &&
      !FUNCTIONAL_WORDS.has(tokens[nameEnd]) &&
      tokens[nameEnd] !== 'deals'
    ) {
      nameEnd++;
    }
    if (nameEnd === idx || tokens[nameEnd] !== 'deals') return -1;
    idx = nameEnd;
  }

  if (tokens[idx] !== 'deals') return -1;
  if (tokens[idx + 1] !== 'combat') return -1;
  if (tokens[idx + 2] !== 'damage') return -1;
  if (tokens[idx + 3] !== 'to') return -1;
  if (tokens[idx + 4] !== 'a') return -1;
  if (tokens[idx + 5] !== 'player') return -1;

  idx += 6;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * "Whenever a creature you control with deathtouch deals combat damage to a player ,"
 * (Fynn, the Fangbearer). Must be checked BEFORE the plain creatureYouControl variant.
 * Returns the index after the comma, or -1 if no match.
 */
export function matchCreatureYouControlWithDeathtouchCombatDamageToPlayerPrefix(tokens: string[]): number {
  // whenever a creature you control with deathtouch deals combat damage to a player ,
  // 0       1 2       3   4       5    6     7           8     9      10    11 12      13
  if (tokens.length < 14) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'a') return -1;
  if (tokens[2] !== 'creature') return -1;
  if (tokens[3] !== 'you') return -1;
  if (tokens[4] !== 'control') return -1;
  if (tokens[5] !== 'with') return -1;
  if (tokens[6] !== 'deathtouch') return -1;
  if (tokens[7] !== 'deals') return -1;
  if (tokens[8] !== 'combat') return -1;
  if (tokens[9] !== 'damage') return -1;
  if (tokens[10] !== 'to') return -1;
  if (tokens[11] !== 'a') return -1;
  if (tokens[12] !== 'player') return -1;

  let idx = 13;
  if (tokens[idx] === ',') idx++;

  return idx;
}

export function matchCreatureYouControlCombatDamageToPlayerPrefix(tokens: string[]): number {
  if (tokens.length < 12) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'a') return -1;
  if (tokens[2] !== 'creature') return -1;
  if (tokens[3] !== 'you') return -1;
  if (tokens[4] !== 'control') return -1;
  if (tokens[5] !== 'deals') return -1;
  if (tokens[6] !== 'combat') return -1;
  if (tokens[7] !== 'damage') return -1;
  if (tokens[8] !== 'to') return -1;
  if (tokens[9] !== 'a') return -1;
  if (tokens[10] !== 'player') return -1;

  let idx = 11;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * "Whenever ~ deals combat damage to one or more players ,"
 * "Whenever this creature deals combat damage to one or more players ,"
 * Modern (2023+) templating equivalent to "...to a player". The engine emits a
 * separate CombatDamageToPlayer event per player damaged, so this fires once per
 * damaged player just like the single-player wording.
 */
export function matchSelfCombatDamageToPlayersPrefix(tokens: string[]): number {
  if (tokens.length < 11) return -1;
  if (tokens[0] !== 'whenever') return -1;

  let idx = 1;
  if (tokens[idx] === '~') {
    idx++;
  } else if (tokens[idx] === 'this' && SELF_COMBAT_DAMAGE_SUBJECT_TYPES.has(tokens[idx + 1])) {
    idx += 2;
  } else {
    return -1;
  }

  if (tokens[idx] !== 'deals') return -1;
  if (tokens[idx + 1] !== 'combat') return -1;
  if (tokens[idx + 2] !== 'damage') return -1;
  if (tokens[idx + 3] !== 'to') return -1;
  if (tokens[idx + 4] !== 'one') return -1;
  if (tokens[idx + 5] !== 'or') return -1;
  if (tokens[idx + 6] !== 'more') return -1;
  if (tokens[idx + 7] !== 'players') return -1;

  idx += 8;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * "Whenever a creature you control deals combat damage to one or more players ,"
 */
export function matchCreatureYouControlCombatDamageToPlayersPrefix(tokens: string[]): number {
  if (tokens.length < 14) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'a') return -1;
  if (tokens[2] !== 'creature') return -1;
  if (tokens[3] !== 'you') return -1;
  if (tokens[4] !== 'control') return -1;
  if (tokens[5] !== 'deals') return -1;
  if (tokens[6] !== 'combat') return -1;
  if (tokens[7] !== 'damage') return -1;
  if (tokens[8] !== 'to') return -1;
  if (tokens[9] !== 'one') return -1;
  if (tokens[10] !== 'or') return -1;
  if (tokens[11] !== 'more') return -1;
  if (tokens[12] !== 'players') return -1;

  let idx = 13;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "At the beginning of your draw step ," trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 * Used by the Immortal Sun family ("At the beginning of your draw step, draw an additional card.").
 */
export function matchDrawStepPrefix(tokens: string[]): number {
  // "at the beginning of your draw step ,"
  if (tokens.length < 8) return -1;
  if (tokens[0] !== 'at') return -1;
  if (tokens[1] !== 'the') return -1;
  if (tokens[2] !== 'beginning') return -1;
  if (tokens[3] !== 'of') return -1;
  if (tokens[4] !== 'your') return -1;
  if (tokens[5] !== 'draw') return -1;
  if (tokens[6] !== 'step') return -1;

  let idx = 7;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "At the beginning of your upkeep ," trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchUpkeepPrefix(tokens: string[]): number {
  // "at the beginning of your upkeep ,"
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'at') return -1;
  if (tokens[1] !== 'the') return -1;
  if (tokens[2] !== 'beginning') return -1;
  if (tokens[3] !== 'of') return -1;
  if (tokens[4] !== 'your') return -1;
  if (tokens[5] !== 'upkeep') return -1;

  let idx = 6;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "At the beginning of combat on your turn ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchBeginningCombatPrefix(tokens: string[]): number {
  if (tokens.length < 9) return -1;
  if (tokens[0] !== 'at') return -1;
  if (tokens[1] !== 'the') return -1;
  if (tokens[2] !== 'beginning') return -1;
  if (tokens[3] !== 'of') return -1;
  if (tokens[4] !== 'combat') return -1;
  if (tokens[5] !== 'on') return -1;
  if (tokens[6] !== 'your') return -1;
  if (tokens[7] !== 'turn') return -1;

  let idx = 8;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "At the beginning of your end step ," trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchEndStepPrefix(tokens: string[]): number {
  // "at the beginning of your end step ,"
  if (tokens.length < 8) return -1;
  if (tokens[0] !== 'at') return -1;
  if (tokens[1] !== 'the') return -1;
  if (tokens[2] !== 'beginning') return -1;
  if (tokens[3] !== 'of') return -1;
  if (tokens[4] !== 'your') return -1;
  if (tokens[5] !== 'end') return -1;
  if (tokens[6] !== 'step') return -1;

  let idx = 7;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "At the beginning of each opponent's end step ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchEachOpponentEndStepPrefix(tokens: string[]): number {
  if (tokens.length < 9) return -1;
  if (tokens[0] !== 'at') return -1;
  if (tokens[1] !== 'the') return -1;
  if (tokens[2] !== 'beginning') return -1;
  if (tokens[3] !== 'of') return -1;
  if (tokens[4] !== 'each') return -1;
  if (tokens[5] !== "opponent's" && tokens[5] !== 'opponents') return -1;
  if (tokens[6] !== 'end') return -1;
  if (tokens[7] !== 'step') return -1;

  let idx = 8;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever another creature enters the battlefield under your control ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchAnotherCreatureETBPrefix(tokens: string[]): CreatureETBPrefixMatch | null {
  // "whenever another creature enters the battlefield under your control ,"
  // "whenever another creature you control enters ,"
  // "whenever another nontoken creature enters under your control ,"
  if (tokens.length < 6) return null;
  if (tokens[0] !== 'whenever' && tokens[0] !== 'when') return null;
  if (tokens[1] !== 'another') return null;

  let idx = 2;
  let nontoken = false;
  if (tokens[idx] === 'nontoken' || (tokens[idx] === 'non' && tokens[idx + 1] === 'token')) {
    nontoken = true;
    idx += tokens[idx] === 'non' ? 2 : 1;
  }

  if (tokens[idx] !== 'creature' && tokens[idx] !== 'creatures') return null;
  idx++;

  if (tokens[idx] === 'you' && tokens[idx + 1] === 'control') {
    idx += 2;
    if (tokens[idx] !== 'enters' && tokens[idx] !== 'enter') return null;
    idx++;
    idx = consumeOptionalBattlefield(tokens, idx);
    idx = consumeOptionalComma(tokens, idx);
    return { effectStart: idx, nontoken: nontoken || undefined };
  }

  if (tokens[idx] !== 'enters' && tokens[idx] !== 'enter') return null;
  idx++;
  idx = consumeOptionalBattlefield(tokens, idx);

  if (tokens[idx] !== 'under' || tokens[idx + 1] !== 'your' || tokens[idx + 2] !== 'control') {
    return null;
  }
  idx += 3;
  idx = consumeOptionalComma(tokens, idx);

  return { effectStart: idx, nontoken: nontoken || undefined };
}

/**
 * Slice 7: Match "Whenever this creature or another <Subtype> you control enters"
 * (Ally / Mutant / Phyrexian / Dinosaur / Equipment / plain-creature family).
 *
 * Accepted subject forms:
 *   "whenever ~ or another <Subtype> you control enters"
 *   "whenever this creature or another <Subtype> you control enters"
 *   "whenever this Equipment or another Equipment enters"
 *   "whenever this creature or another creature you control enters"
 *
 * Returns { effectStart, subtype } where `subtype` is the lowercase subtype
 * string (e.g. "ally", "dinosaur", "equipment", "creature"), or null if no match.
 * An empty subtype string is used for plain "creature" with no subtype restriction.
 */

// Subtypes recognised in this trigger prefix. Includes Equipment (artifact subtype)
// and the plain "creature" fall-through (empty string key).
const SELF_OR_ANOTHER_SUBTYPE_WORDS = new Set([
  'ally', 'allies',
  'mutant', 'mutants',
  'phyrexian', 'phyrexians',
  'dinosaur', 'dinosaurs',
  'equipment',
  'creature', 'creatures',
]);

export function matchSelfOrAnotherSubtypeETBPrefix(
  tokens: string[],
): { effectStart: number; subtype: string } | null {
  // Min: "whenever ~ or another creature enters ," = 7 tokens
  if (tokens.length < 7) return null;
  if (tokens[0] !== 'whenever' && tokens[0] !== 'when') return null;

  // Consume self-reference: "~" or "this creature" or "this Equipment"
  let idx = 1;
  if (tokens[idx] === '~') {
    idx++;
  } else if (tokens[idx] === 'this') {
    idx++;
    // Optional subject type word: creature, Equipment, etc.
    if (SELF_ETB_SUBJECT_TYPES.has(tokens[idx])) idx++;
  } else {
    return null;
  }

  // Must be followed by "or"
  if (tokens[idx] !== 'or') return null;
  idx++;

  // Must be followed by "another"
  if (tokens[idx] !== 'another') return null;
  idx++;

  // Subtype or "creature"
  if (!tokens[idx] || !SELF_OR_ANOTHER_SUBTYPE_WORDS.has(tokens[idx])) return null;
  const subtypeRaw = tokens[idx];
  idx++;

  // Normalise plural forms → singular
  const SUBTYPE_CANONICAL: Record<string, string> = {
    allies: 'ally',
    mutants: 'mutant',
    phyrexians: 'phyrexian',
    dinosaurs: 'dinosaur',
    creatures: 'creature',
    // singular forms pass through unchanged
  };
  const subtype = SUBTYPE_CANONICAL[subtypeRaw] ?? subtypeRaw;

  // Optional "you control"
  if (tokens[idx] === 'you' && tokens[idx + 1] === 'control') {
    idx += 2;
  }

  // Must be followed by "enters"
  if (tokens[idx] !== 'enters' && tokens[idx] !== 'enter') return null;
  idx++;

  idx = consumeOptionalBattlefield(tokens, idx);
  idx = consumeOptionalComma(tokens, idx);

  return { effectStart: idx, subtype };
}

/**
 * Check if tokens start with "Whenever a creature you control dies ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchCreatureYouControlDiesPrefix(tokens: string[]): number {
  // "whenever a creature you control dies ,"
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'a') return -1;
  if (tokens[2] !== 'creature') return -1;
  if (tokens[3] !== 'you') return -1;
  if (tokens[4] !== 'control') return -1;
  if (tokens[5] !== 'dies') return -1;

  let idx = 6;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Match dies triggers scoped to OTHER creatures (not the source itself):
 *   "Whenever another creature you control dies, ..."  -> { who: 'youControl', other: true }
 *   "Whenever another creature dies, ..."              -> { who: 'youControl', other: true }
 *     (engine scopes by owner == source owner; "another creature" with no
 *      controller clause is the controller's own-creature variant)
 *   "Whenever a creature an opponent controls dies, ..." -> { who: 'opponentControl' }
 *   "Whenever a creature an opponent controls dies, ..." (synonym: "an opponent controls")
 * Returns { who, other, effectStart } or null.
 */
export function matchOtherCreatureDiesPrefix(
  tokens: string[],
): { who: 'youControl' | 'opponentControl'; other: boolean; effectStart: number } | null {
  if (tokens.length < 5) return null;
  if (tokens[0] !== 'whenever' && tokens[0] !== 'when') return null;

  // "another creature you control dies" / "another creature dies"
  if (tokens[1] === 'another') {
    let idx = 2;
    if (tokens[idx] !== 'creature' && tokens[idx] !== 'creatures') return null;
    idx++;
    if (tokens[idx] === 'you' && tokens[idx + 1] === 'control') {
      idx += 2;
    }
    if (tokens[idx] !== 'dies') return null;
    idx++;
    if (tokens[idx] === ',') idx++;
    return { who: 'youControl', other: true, effectStart: idx };
  }

  // "a creature an opponent controls dies"
  if ((tokens[1] === 'a' || tokens[1] === 'an') && tokens[2] === 'creature') {
    let idx = 3;
    if (
      (tokens[idx] === 'an' || tokens[idx] === 'a') &&
      tokens[idx + 1] === 'opponent' &&
      (tokens[idx + 2] === 'controls' || tokens[idx + 2] === 'control')
    ) {
      idx += 3;
      if (tokens[idx] !== 'dies') return null;
      idx++;
      if (tokens[idx] === ',') idx++;
      return { who: 'opponentControl', other: false, effectStart: idx };
    }
  }

  return null;
}

/**
 * Check if tokens start with "Whenever you cast a spell ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchYouCastSpellPrefix(tokens: string[]): number {
  // "whenever you cast a spell ,"
  if (tokens.length < 6) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'you') return -1;
  if (tokens[2] !== 'cast') return -1;
  if (tokens[3] !== 'a') return -1;
  if (tokens[4] !== 'spell') return -1;

  let idx = 5;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever you cast a noncreature spell ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchYouCastNoncreatureSpellPrefix(tokens: string[]): number {
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'you') return -1;
  if (tokens[2] !== 'cast') return -1;
  if (tokens[3] !== 'a') return -1;
  if (tokens[4] !== 'noncreature') return -1;
  if (tokens[5] !== 'spell') return -1;

  let idx = 6;
  if (tokens[idx] === ',') idx++;

  return idx;
}

// ============================================================================
// Phase 17: Additional trigger prefix matchers
// ============================================================================

/**
 * Check if tokens start with "Whenever you gain life ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchLifeGainPrefix(tokens: string[]): number {
  // "whenever you gain life ,"
  if (tokens.length < 5) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'you') return -1;
  if (tokens[2] !== 'gain') return -1;
  if (tokens[3] !== 'life') return -1;

  let idx = 4;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever you lose life ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchLifeLossPrefix(tokens: string[]): number {
  // "whenever you lose life ,"
  if (tokens.length < 5) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'you') return -1;
  if (tokens[2] !== 'lose') return -1;
  if (tokens[3] !== 'life') return -1;

  let idx = 4;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever you draw a card ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchCardDrawnPrefix(tokens: string[]): number {
  // "whenever you draw a card ,"
  if (tokens.length < 6) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'you') return -1;
  if (tokens[2] !== 'draw') return -1;
  if (tokens[3] !== 'a') return -1;
  if (tokens[4] !== 'card') return -1;

  let idx = 5;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever an opponent casts a spell [with mana
 * value N or less] ,". Returns the effect-start index plus the optional mana
 * value cap, or null if no match.
 */
export function matchOpponentCastSpellPrefix(tokens: string[]): { effectStart: number; maxManaValue?: number } | null {
  // "whenever an opponent casts a spell [with mana value N or less] ,"
  if (tokens.length < 7) return null;
  if (tokens[0] !== 'whenever') return null;
  if (tokens[1] !== 'an') return null;
  if (tokens[2] !== 'opponent') return null;
  if (tokens[3] !== 'casts') return null;
  if (tokens[4] !== 'a') return null;
  if (tokens[5] !== 'spell') return null;

  let idx = 6;
  const rider = readMaxManaValueRider(tokens, idx);
  if (rider) idx = rider.nextIndex;
  if (tokens[idx] === ',') idx++;

  return { effectStart: idx, ...(rider ? { maxManaValue: rider.maxManaValue } : {}) };
}

/**
 * Check if tokens start with "Whenever a player casts a spell [with mana value
 * N or less] ," (Manabarbs-style — fires for EVERY caster). Returns the
 * effect-start index plus the optional mana value cap, or null if no match.
 */
export function matchAnyPlayerCastSpellPrefix(tokens: string[]): { effectStart: number; maxManaValue?: number } | null {
  // "whenever a player casts a spell [with mana value N or less] ,"
  if (tokens.length < 7) return null;
  if (tokens[0] !== 'whenever') return null;
  if (tokens[1] !== 'a') return null;
  if (tokens[2] !== 'player') return null;
  if (tokens[3] !== 'casts') return null;
  if (tokens[4] !== 'a') return null;
  if (tokens[5] !== 'spell') return null;

  let idx = 6;
  const rider = readMaxManaValueRider(tokens, idx);
  if (rider) idx = rider.nextIndex;
  if (tokens[idx] === ',') idx++;

  return { effectStart: idx, ...(rider ? { maxManaValue: rider.maxManaValue } : {}) };
}

/**
 * Check if tokens start with "Whenever a player taps a land for mana ," or the
 * restricted variants "… taps an Island for mana ," (basic-land subtype) and
 * "… taps a nonbasic land for mana ," (Manabarbs/Scald punisher subfamily).
 * Returns the effect-start index plus the parsed restriction, or null.
 */
export function matchPlayerTapsLandForManaPrefix(
  tokens: string[],
): { effectStart: number; subtype?: string; nonbasic?: boolean } | null {
  // "whenever a player taps a/an <land> for mana ,"
  if (tokens.length < 9) return null;
  if (tokens[0] !== 'whenever') return null;
  if (tokens[1] !== 'a') return null;
  if (tokens[2] !== 'player') return null;
  if (tokens[3] !== 'taps') return null;
  if (tokens[4] !== 'a' && tokens[4] !== 'an') return null;

  let idx = 5;
  let subtype: string | undefined;
  let nonbasic = false;
  const basicLandTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
  if (basicLandTypes.includes(tokens[idx])) {
    subtype = tokens[idx];
    idx++;
  } else {
    if (tokens[idx] === 'nonbasic') {
      nonbasic = true;
      idx++;
    }
    if (tokens[idx] !== 'land') return null;
    idx++;
  }
  if (tokens[idx] !== 'for' || tokens[idx + 1] !== 'mana') return null;
  idx += 2;
  if (tokens[idx] === ',') idx++;

  return { effectStart: idx, ...(subtype ? { subtype } : {}), ...(nonbasic ? { nonbasic: true } : {}) };
}

/**
 * Check if tokens start with "Whenever a creature enters the battlefield ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchAnyCreatureETBPrefix(tokens: string[]): CreatureETBPrefixMatch | null {
  // "whenever a creature enters the battlefield ,"
  // "whenever a nontoken creature enters ,"
  // "whenever one or more creatures enter the battlefield ,"
  if (tokens.length < 5) return null;
  if (tokens[0] !== 'whenever' && tokens[0] !== 'when') return null;

  let idx = 1;
  if (tokens[idx] === 'one' && tokens[idx + 1] === 'or' && tokens[idx + 2] === 'more') {
    idx += 3;
  } else if (tokens[idx] === 'a' || tokens[idx] === 'an') {
    idx++;
  } else {
    return null;
  }

  let nontoken = false;
  if (tokens[idx] === 'nontoken' || (tokens[idx] === 'non' && tokens[idx + 1] === 'token')) {
    nontoken = true;
    idx += tokens[idx] === 'non' ? 2 : 1;
  }

  if (tokens[idx] !== 'creature' && tokens[idx] !== 'creatures') return null;
  idx++;
  if (tokens[idx] !== 'enters' && tokens[idx] !== 'enter') return null;
  idx++;
  idx = consumeOptionalBattlefield(tokens, idx);
  idx = consumeOptionalComma(tokens, idx);

  return { effectStart: idx, nontoken: nontoken || undefined };
}

/**
 * Check creature-enter triggers restricted to creatures you control.
 * Handles:
 *   "Whenever a creature enters the battlefield under your control, ..."
 *   "Whenever a creature you control enters, ..."
 */
export function matchCreatureYouControlETBPrefix(tokens: string[]): CreatureETBPrefixMatch | null {
  if (tokens.length < 6) return null;
  if (tokens[0] !== 'whenever' && tokens[0] !== 'when') return null;

  let idx = 1;
  if (tokens[idx] === 'one' && tokens[idx + 1] === 'or' && tokens[idx + 2] === 'more') {
    idx += 3;
  } else if (tokens[idx] === 'a' || tokens[idx] === 'an') {
    idx++;
  } else {
    return null;
  }

  let nontoken = false;
  if (tokens[idx] === 'nontoken' || (tokens[idx] === 'non' && tokens[idx + 1] === 'token')) {
    nontoken = true;
    idx += tokens[idx] === 'non' ? 2 : 1;
  }

  if (tokens[idx] !== 'creature' && tokens[idx] !== 'creatures') return null;
  idx++;

  if (
    (tokens[idx] === 'enters' || tokens[idx] === 'enter')
  ) {
    idx++;
    idx = consumeOptionalBattlefield(tokens, idx);
    if (tokens[idx] === 'under' && tokens[idx + 1] === 'your' && tokens[idx + 2] === 'control') {
      idx += 3;
      idx = consumeOptionalComma(tokens, idx);
      return { effectStart: idx, controller: 'yours', nontoken: nontoken || undefined };
    }
    return null;
  }

  if (
    tokens[idx] === 'you' &&
    tokens[idx + 1] === 'control' &&
    (tokens[idx + 2] === 'enters' || tokens[idx + 2] === 'enter')
  ) {
    idx += 3;
    idx = consumeOptionalBattlefield(tokens, idx);
    idx = consumeOptionalComma(tokens, idx);
    return { effectStart: idx, controller: 'yours', nontoken: nontoken || undefined };
  }

  return null;
}

/**
 * Check if tokens start with "Whenever you cast an instant or sorcery spell ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchCastInstantOrSorceryPrefix(tokens: string[]): number {
  // "whenever you cast an instant or sorcery spell ,"
  if (tokens.length < 9) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'you') return -1;
  if (tokens[2] !== 'cast') return -1;
  if (tokens[3] !== 'an') return -1;
  if (tokens[4] !== 'instant') return -1;
  if (tokens[5] !== 'or') return -1;
  if (tokens[6] !== 'sorcery') return -1;
  if (tokens[7] !== 'spell') return -1;

  let idx = 8;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever you cast or copy an instant or sorcery spell ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchCastOrCopyInstantOrSorceryPrefix(tokens: string[]): number {
  if (tokens.length < 11) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'you') return -1;
  if (tokens[2] !== 'cast') return -1;
  if (tokens[3] !== 'or') return -1;
  if (tokens[4] !== 'copy') return -1;
  if (tokens[5] !== 'an') return -1;
  if (tokens[6] !== 'instant') return -1;
  if (tokens[7] !== 'or') return -1;
  if (tokens[8] !== 'sorcery') return -1;
  if (tokens[9] !== 'spell') return -1;

  let idx = 10;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "At the beginning of each player's upkeep ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchEachPlayerUpkeepPrefix(tokens: string[]): number {
  // "at the beginning of each player's upkeep ,"
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'at') return -1;
  if (tokens[1] !== 'the') return -1;
  if (tokens[2] !== 'beginning') return -1;
  if (tokens[3] !== 'of') return -1;
  if (tokens[4] !== 'each') return -1;
  if (tokens[5] !== "player's") return -1;
  if (tokens[6] !== 'upkeep') return -1;

  let idx = 7;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "At the beginning of each opponent's upkeep ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchEachOpponentUpkeepPrefix(tokens: string[]): number {
  // "at the beginning of each opponent's upkeep ,"
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'at') return -1;
  if (tokens[1] !== 'the') return -1;
  if (tokens[2] !== 'beginning') return -1;
  if (tokens[3] !== 'of') return -1;
  if (tokens[4] !== 'each') return -1;
  if (tokens[5] !== "opponent's") return -1;
  if (tokens[6] !== 'upkeep') return -1;

  let idx = 7;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "At the beginning of each upkeep ," trigger prefix.
 * (Distinct from "each player's upkeep" — some cards omit the possessive.)
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchEachUpkeepPrefix(tokens: string[]): number {
  // "at the beginning of each upkeep ,"
  if (tokens.length < 6) return -1;
  if (tokens[0] !== 'at') return -1;
  if (tokens[1] !== 'the') return -1;
  if (tokens[2] !== 'beginning') return -1;
  if (tokens[3] !== 'of') return -1;
  if (tokens[4] !== 'each') return -1;
  if (tokens[5] !== 'upkeep') return -1;

  let idx = 6;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "At the beginning of each end step ,"
 * or "At the beginning of each player's end step ," trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchEachEndStepPrefix(tokens: string[]): number {
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'at') return -1;
  if (tokens[1] !== 'the') return -1;
  if (tokens[2] !== 'beginning') return -1;
  if (tokens[3] !== 'of') return -1;
  if (tokens[4] !== 'each') return -1;

  let idx = 5;
  // Optional possessive "player's"
  if (tokens[idx] === "player's" || tokens[idx] === 'players') idx++;
  if (tokens[idx] !== 'end') return -1;
  idx++;
  if (tokens[idx] !== 'step') return -1;
  idx++;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "At the beginning of combat on each player's turn ,"
 * or "At the beginning of each combat ," trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchBeginningCombatEachPrefix(tokens: string[]): number {
  if (tokens.length < 5) return -1;
  if (tokens[0] !== 'at') return -1;
  if (tokens[1] !== 'the') return -1;
  if (tokens[2] !== 'beginning') return -1;
  if (tokens[3] !== 'of') return -1;

  // "at the beginning of combat on each player's turn ,"
  if (
    tokens[4] === 'combat' &&
    tokens[5] === 'on' &&
    tokens[6] === 'each' &&
    (tokens[7] === "player's" || tokens[7] === 'players') &&
    tokens[8] === 'turn'
  ) {
    let idx = 9;
    if (tokens[idx] === ',') idx++;
    return idx;
  }

  // "at the beginning of each combat ,"
  if (tokens[4] === 'each' && tokens[5] === 'combat') {
    let idx = 6;
    if (tokens[idx] === ',') idx++;
    return idx;
  }

  return -1;
}

/**
 * Check if tokens start with a landfall trigger prefix.
 * Handles both the verbose phrasing
 *   "whenever a land enters the battlefield under your control ,"
 * and the modern concise phrasing
 *   "whenever a land you control enters ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchLandfallPrefix(tokens: string[]): number {
  if (tokens.length < 6) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'a') return -1;
  if (tokens[2] !== 'land') return -1;

  // Verbose: "whenever a land enters the battlefield under your control ,"
  if (
    tokens[3] === 'enters' &&
    tokens[4] === 'the' &&
    tokens[5] === 'battlefield' &&
    tokens[6] === 'under' &&
    tokens[7] === 'your' &&
    tokens[8] === 'control'
  ) {
    let idx = 9;
    if (tokens[idx] === ',') idx++;
    return idx;
  }

  // Concise: "whenever a land you control enters ,"
  if (
    tokens[3] === 'you' &&
    tokens[4] === 'control' &&
    tokens[5] === 'enters'
  ) {
    let idx = 6;
    if (tokens[idx] === ',') idx++;
    return idx;
  }

  return -1;
}

// Subject types accepted in the "Whenever <subject> deals damage" pattern.
// "this creature", "this permanent" and "~" are self-references for permanents
// (Mourning Thrull / Doubtless One family).
// Slice 4 (self-reference normalization): 'this Vehicle' is normalised to
// 'this artifact' before tokenisation, so 'artifact' must be accepted here.
const SELF_DEALS_DAMAGE_SUBJECT_TYPES = new Set([
  'creature',
  'artifact',
  'permanent',
  'vehicle',
]);

/**
 * Match: "Whenever this creature/permanent/~ deals damage ,"
 * Pre-errata lifelink/Vampiric Link family (Mourning Thrull, Doubtless One,
 * Armadillo Cloak, Vampiric Link). Fires on ANY damage, not just combat damage
 * to a player.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchSelfDealsDamagePrefix(tokens: string[]): number {
  if (tokens.length < 5) return -1;

  const first = tokens[0];
  if (first !== 'whenever') return -1;

  let idx = 1;
  if (tokens[idx] === '~') {
    idx++;
  } else if (tokens[idx] === 'this' && SELF_DEALS_DAMAGE_SUBJECT_TYPES.has(tokens[idx + 1])) {
    idx += 2;
  } else {
    return -1;
  }

  if (tokens[idx] !== 'deals') return -1;
  // We specifically do NOT require "combat" before "damage" — this is the broad
  // "deals any damage" wording, distinct from the CombatDamageToPlayer trigger.
  if (tokens[idx + 1] !== 'damage') return -1;
  idx += 2;

  // Optional trailing comma.
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Match: "Whenever enchanted creature deals damage ,"
 * Used by Aura-based reflection effects (Guilty Conscience pre-errata wording).
 * Returns the index after the trigger prefix, or -1 if no match.
 */
export function matchEnchantedCreatureDealsDamagePrefix(tokens: string[]): number {
  if (tokens.length < 6) return -1;

  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'enchanted') return -1;
  if (tokens[2] !== 'creature') return -1;
  if (tokens[3] !== 'deals') return -1;
  if (tokens[4] !== 'damage') return -1;

  let idx = 5;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Slice 2: "Whenever another legendary permanent you control enters [the battlefield] ,"
 * — Yoshimaru, Ever Faithful family. Fires when any legendary permanent (other
 * than the source itself) enters under the same controller.
 *
 * Accepted forms:
 *   "whenever another legendary permanent you control enters ,"
 *   "whenever another legendary permanent you control enters the battlefield ,"
 *
 * Returns the effect-start index or -1 if no match.
 */
export function matchAnotherLegendaryPermanentETBPrefix(tokens: string[]): number {
  // Minimum: "whenever another legendary permanent you control enters ," = 7 tokens
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'whenever' && tokens[0] !== 'when') return -1;
  if (tokens[1] !== 'another') return -1;
  if (tokens[2] !== 'legendary') return -1;
  if (tokens[3] !== 'permanent') return -1;
  if (tokens[4] !== 'you') return -1;
  if (tokens[5] !== 'control') return -1;
  if (tokens[6] !== 'enters' && tokens[6] !== 'enter') return -1;

  let idx = 7;
  idx = consumeOptionalBattlefield(tokens, idx);
  idx = consumeOptionalComma(tokens, idx);

  return idx;
}

/**
 * Slice 8/11: "Whenever this creature blocks or becomes blocked by a creature, ..."
 * (Witherscale Wurm / Dwarven Nomad / Lim-Dûl's Cohort family.)
 *
 * Accepted forms:
 *   "whenever ~ blocks or becomes blocked by a creature ,"
 *   "whenever this creature blocks or becomes blocked by a creature ,"
 *
 * Returns the index after the trigger prefix, or -1 if no match.
 *
 * NOTE: The trigger body refers to the opposing creature as "that creature", which
 * resolves to { kind: 'EventCreature' } via the eventContext.cardInstanceId set to
 * the opposing creature's instanceId when the event fires.
 */
export function matchBlocksOrBlockedByPrefix(tokens: string[]): number {
  // Min: "whenever ~ blocks or becomes blocked by a creature ," = 10 tokens
  if (tokens.length < 10) return -1;
  if (tokens[0] !== 'whenever' && tokens[0] !== 'when') return -1;

  // Subject: "~" or "this creature"
  let idx = 1;
  if (tokens[idx] === '~') {
    idx++;
  } else if (tokens[idx] === 'this' && tokens[idx + 1] === 'creature') {
    idx += 2;
  } else {
    return -1;
  }

  // "blocks or becomes blocked by a creature"
  if (tokens[idx] !== 'blocks') return -1;
  if (tokens[idx + 1] !== 'or') return -1;
  if (tokens[idx + 2] !== 'becomes') return -1;
  if (tokens[idx + 3] !== 'blocked') return -1;
  if (tokens[idx + 4] !== 'by') return -1;
  if (tokens[idx + 5] !== 'a') return -1;
  if (tokens[idx + 6] !== 'creature') return -1;

  idx += 7;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Slice 1 (Morph/Megamorph): "When this creature is turned face up, <effect>."
 * Returns the index of the first effect token (after the comma), or -1.
 *
 * Pattern: when this creature is turned face up ,
 * Indices:   0    1    2       3  4      5    6  7
 */
export function matchTurnedFaceUpPrefix(tokens: string[]): number {
  // Min tokens: "when this creature is turned face up ," = 8 tokens before effect
  if (tokens.length < 9) return -1;
  if (tokens[0] !== 'when' && tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'this') return -1;
  if (tokens[2] !== 'creature') return -1;
  if (tokens[3] !== 'is') return -1;
  if (tokens[4] !== 'turned') return -1;
  if (tokens[5] !== 'face') return -1;
  if (tokens[6] !== 'up') return -1;
  let idx = 7;
  if (tokens[idx] === ',') idx++;
  return idx;
}

/**
 * Try all new trigger prefixes and return [Trigger, effectStartIndex] or null.
 */
export function matchTriggerPrefix(tokens: string[]): { trigger: Trigger; effectStart: number } | null {
  let idx: number;

  // Slice 1 (Morph/Megamorph): "When this creature is turned face up, <effect>."
  // Must be checked before matchETBPrefix and other "when/whenever" prefixes.
  idx = matchTurnedFaceUpPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'TurnedFaceUp', who: 'self' }, effectStart: idx };

  // Slice 8/11: "Whenever ~ blocks or becomes blocked by a creature" —
  // must be checked before matchAttacksPrefix (both start with "whenever ~ ...").
  idx = matchBlocksOrBlockedByPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'BlocksOrBlockedBy', who: 'self' }, effectStart: idx };

  idx = matchSelfAttacksAndIsntBlockedPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Unblocked', who: 'self' }, effectStart: idx };

  // "Whenever ~ attacks alone" — must be checked before the plain attacks prefix.
  idx = matchSelfAttacksAlonePrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Attacks', who: 'self', alone: true }, effectStart: idx };

  idx = matchAttacksPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Attacks', who: 'self' }, effectStart: idx };

  idx = matchSelfBecomesTappedPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'BecomesTapped', who: 'self' }, effectStart: idx };

  idx = matchCreatureYouControlAttacksPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CreatureYouControlAttacks' }, effectStart: idx };

  idx = matchSelfCombatDamageToPlayerPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CombatDamageToPlayer', who: 'self' }, effectStart: idx };

  // Fynn family: "a creature you control WITH DEATHTOUCH deals combat damage to a player"
  // must be checked before the plain creatureYouControl variant.
  idx = matchCreatureYouControlWithDeathtouchCombatDamageToPlayerPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CombatDamageToPlayer', who: 'creatureYouControl', requiresDeathtouch: true }, effectStart: idx };

  idx = matchCreatureYouControlCombatDamageToPlayerPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CombatDamageToPlayer', who: 'creatureYouControl' }, effectStart: idx };

  idx = matchSelfCombatDamageToPlayersPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CombatDamageToPlayer', who: 'self' }, effectStart: idx };

  idx = matchCreatureYouControlCombatDamageToPlayersPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CombatDamageToPlayer', who: 'creatureYouControl' }, effectStart: idx };

  // Slice 11: "At the beginning of your draw step" — must be checked before
  // matchUpkeepPrefix because both share the "at the beginning of your" prefix.
  idx = matchDrawStepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'DrawStep', whose: 'yours' }, effectStart: idx };

  idx = matchUpkeepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Upkeep', whose: 'yours' }, effectStart: idx };

  // "beginning of combat on each player's turn" / "each combat" — check before the
  // "your turn" variant since both share the "at the beginning of combat" prefix.
  idx = matchBeginningCombatEachPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'BeginningCombat', whose: 'each' }, effectStart: idx };

  idx = matchBeginningCombatPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'BeginningCombat', whose: 'yours' }, effectStart: idx };

  idx = matchEndStepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'EndStep', whose: 'yours' }, effectStart: idx };

  idx = matchEachOpponentEndStepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'EndStep', whose: 'opponents' }, effectStart: idx };

  // "each end step" / "each player's end step" — after the more-specific opponent variant.
  idx = matchEachEndStepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'EndStep', whose: 'each' }, effectStart: idx };

  // Slice 7: "Whenever this creature or another <Subtype> you control enters" —
  // must be checked before AnotherCreatureETB / AnyCreatureETB (more specific).
  const selfOrAnotherSubtypeEtb = matchSelfOrAnotherSubtypeETBPrefix(tokens);
  if (selfOrAnotherSubtypeEtb) {
    return {
      trigger: { kind: 'SelfOrAnotherSubtypeETB', subtype: selfOrAnotherSubtypeEtb.subtype },
      effectStart: selfOrAnotherSubtypeEtb.effectStart,
    };
  }

  // Slice 2: "another legendary permanent you control enters" — must be checked
  // before AnotherCreatureETB so a legendary creature match goes to the right trigger.
  idx = matchAnotherLegendaryPermanentETBPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'AnotherLegendaryPermanentETB' }, effectStart: idx };

  // Phase 17: Must check AnotherCreatureETB before AnyCreatureETB (more specific first)
  const anotherCreatureEtb = matchAnotherCreatureETBPrefix(tokens);
  if (anotherCreatureEtb) {
    return {
      trigger: {
        kind: 'AnotherCreatureETB',
        controller: 'yours',
        ...(anotherCreatureEtb.nontoken ? { nontoken: true } : {}),
        ...(anotherCreatureEtb.tokenOnly ? { tokenOnly: true } : {}),
      },
      effectStart: anotherCreatureEtb.effectStart,
    };
  }

  // "another creature [you control] dies" / "a creature an opponent controls dies"
  // (more specific than the plain "a creature you control dies" below).
  const otherDies = matchOtherCreatureDiesPrefix(tokens);
  if (otherDies) {
    return {
      trigger: {
        kind: 'OtherCreatureDies',
        who: otherDies.who,
        ...(otherDies.other ? { other: true } : {}),
      },
      effectStart: otherDies.effectStart,
    };
  }

  idx = matchCreatureYouControlDiesPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CreatureYouControlDies' }, effectStart: idx };

  // Phase 17: Must check cast/copy and CastInstantOrSorcery before YouCastSpell (more specific first)
  idx = matchCastOrCopyInstantOrSorceryPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CastOrCopyInstantOrSorcery' }, effectStart: idx };

  idx = matchCastInstantOrSorceryPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CastInstantOrSorcery' }, effectStart: idx };

  idx = matchYouCastNoncreatureSpellPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CastNoncreatureSpell' }, effectStart: idx };

  idx = matchYouCastSpellPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'YouCastSpell' }, effectStart: idx };

  // Phase 17: Additional trigger types
  idx = matchLifeGainPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'LifeGain' }, effectStart: idx };

  idx = matchLifeLossPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'LifeLoss' }, effectStart: idx };

  idx = matchCardDrawnPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CardDrawn' }, effectStart: idx };

  const opponentCast = matchOpponentCastSpellPrefix(tokens);
  if (opponentCast) {
    return {
      trigger: {
        kind: 'OpponentCastSpell',
        ...(opponentCast.maxManaValue !== undefined ? { maxManaValue: opponentCast.maxManaValue } : {}),
      },
      effectStart: opponentCast.effectStart,
    };
  }

  // "Whenever a player casts a spell" — fires for every caster (Manabarbs).
  const anyPlayerCast = matchAnyPlayerCastSpellPrefix(tokens);
  if (anyPlayerCast) {
    return {
      trigger: {
        kind: 'AnyPlayerCastSpell',
        ...(anyPlayerCast.maxManaValue !== undefined ? { maxManaValue: anyPlayerCast.maxManaValue } : {}),
      },
      effectStart: anyPlayerCast.effectStart,
    };
  }

  // "Whenever a player taps a land for mana" (Manabarbs/Scald punisher subfamily).
  const tapsLand = matchPlayerTapsLandForManaPrefix(tokens);
  if (tapsLand) {
    return {
      trigger: {
        kind: 'PlayerTapsLandForMana',
        ...(tapsLand.subtype ? { subtype: tapsLand.subtype } : {}),
        ...(tapsLand.nonbasic ? { nonbasic: true } : {}),
      },
      effectStart: tapsLand.effectStart,
    };
  }

  const controlledCreatureEtb = matchCreatureYouControlETBPrefix(tokens);
  if (controlledCreatureEtb) {
    return {
      trigger: {
        kind: 'AnyCreatureETB',
        controller: 'yours',
        ...(controlledCreatureEtb.nontoken ? { nontoken: true } : {}),
        ...(controlledCreatureEtb.tokenOnly ? { tokenOnly: true } : {}),
      },
      effectStart: controlledCreatureEtb.effectStart,
    };
  }

  const anyCreatureEtb = matchAnyCreatureETBPrefix(tokens);
  if (anyCreatureEtb) {
    return {
      trigger: {
        kind: 'AnyCreatureETB',
        ...(anyCreatureEtb.controller ? { controller: anyCreatureEtb.controller } : {}),
        ...(anyCreatureEtb.nontoken ? { nontoken: true } : {}),
        ...(anyCreatureEtb.tokenOnly ? { tokenOnly: true } : {}),
      },
      effectStart: anyCreatureEtb.effectStart,
    };
  }

  // "each opponent's upkeep" — more specific than the "each player's" form.
  idx = matchEachOpponentUpkeepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Upkeep', whose: 'opponents' }, effectStart: idx };

  idx = matchEachPlayerUpkeepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Upkeep', whose: 'each' }, effectStart: idx };

  idx = matchEachUpkeepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Upkeep', whose: 'each' }, effectStart: idx };

  idx = matchLandfallPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Landfall' }, effectStart: idx };

  // Slice 5: deals-damage trigger family (pre-errata lifelink / Guilty Conscience).
  // These must be checked AFTER the combat-damage-to-player triggers above because
  // "deals combat damage to a player" is a separate, more specific wording — these
  // matchers only fire for "deals damage" (without "combat" qualifier).
  idx = matchEnchantedCreatureDealsDamagePrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'DealsDamage', who: 'enchantedCreature' }, effectStart: idx };

  idx = matchSelfDealsDamagePrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'DealsDamage', who: 'self' }, effectStart: idx };

  return null;
}
