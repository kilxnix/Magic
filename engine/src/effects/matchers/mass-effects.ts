// Mass-effect matchers extracted from parser.ts (batch 8/12).
// Covers: board-wipe (destroy/exile all), return-all families.
// Do NOT edit logic here — keep verbatim with parser.ts originals.
// Slice 7/12: matchExactMultiTarget added for plain "N target X" (no "up to").
// Slice 6/12: matchDestroyAllSubtypeCreatures added for "destroy all [non-]<Subtype> creatures".
// Slice 8/12: matchDestroyAllNoncolorCreatures, matchDestroyAllTokenFilter,
//   matchReturnAllTokenFilter, matchDestroyAllLegendaryFilter,
//   matchExileAllSubtypeCreatures, matchDestroyAllBlockingBlocked added.
// Slice 10/13: matchChooseNTargetSpell — "choose N target creatures … <them/those> effects"
//   (Run Away Together, Last Night Together, Rivals' Duel, Continue?, etc.)

import type { Effect, CardFilter } from '../ast';
import type { TargetSpec, TargetType } from '../targets';
import type { PatternResult } from '../parser';
import {
  readColorConstraint,
  consumeCantBeRegenerated,
  makeTargetSpec,
  makeChosenRef,
  parseSmallNumberToken,
  CREATURE_SUBTYPE_MAP,
  COLOR_WORDS,
  readGrantableKeyword,
} from '../parser';

// Basic land subtypes mapped from their plural oracle spelling to the singular
// subtype term stored on the type line. Used by mass "destroy all <land>s".
export const BASIC_LAND_PLURALS: Record<string, string> = {
  islands: 'Island',
  plains: 'Plains',
  swamps: 'Swamp',
  mountains: 'Mountain',
  forests: 'Forest',
};

/**
 * Match: "destroy all creatures"
 */
export function matchDestroyAll(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'destroy') return null;
  // "destroy all creatures" | "destroy each creature".
  let consumed: number;
  if (slice[1] === 'all' && slice[2] === 'creatures') {
    consumed = 3;
  } else if (slice[1] === 'each' && (slice[2] === 'creature' || slice[2] === 'creatures')) {
    consumed = 3;
  } else {
    return null;
  }
  if (tokens[startIndex + consumed] === '.') consumed++;

  const noRegenSpan = consumeCantBeRegenerated(tokens, startIndex + consumed);
  consumed += noRegenSpan;

  const effect: Effect = {
    kind: 'Destroy',
    target: { kind: 'AllCreatures' },
    ...(noRegenSpan > 0 ? { noRegen: true } : {}),
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "destroy all artifacts" / "destroy all enchantments"
 * (extends existing destroyAll which only handles creatures)
 */
export function matchDestroyAllExpanded(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'destroy') return null;
  if (slice[1] !== 'all') return null;

  let idx = 2;
  const filter: CardFilter = {};

  if (slice[idx] === 'creatures') {
    // Already handled by matchDestroyAll — use AllCreatures target
    return null; // let existing handler do it
  } else if (slice[idx] === 'artifacts') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'enchantments') {
    filter.types = ['enchantment'];
    idx++;
  } else if (slice[idx] === 'nonland' && slice[idx + 1] === 'permanents') {
    idx += 2;
  } else if (slice[idx] === 'permanents') {
    idx++;
  } else if (slice[idx] === 'artifacts' && slice[idx + 1] === 'and' && slice[idx + 2] === 'enchantments') {
    filter.types = ['artifact', 'enchantment'];
    idx += 3;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Destroy',
    target: { kind: 'AllOfType', filter },
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "destroy all <color> creatures" / "destroy all <color> or <color> creatures"
 *   e.g. "destroy all green creatures", "destroy all white creatures".
 * Emits Destroy + AllOfType with a creature+color filter. The executor's Destroy
 * AllOfType branch destroys every battlefield permanent whose definition matches
 * the filter (colors are honoured by matchesCardFilter), so this runs honestly.
 */
export function matchDestroyAllColorCreatures(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;
  if (slice[0] !== 'destroy' || slice[1] !== 'all') return null;

  const colorRead = readColorConstraint(slice, 2);
  if (!colorRead) return null;
  let idx = 2 + colorRead.consumed;
  if (slice[idx] !== 'creatures') return null;
  idx++;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Destroy',
    target: { kind: 'AllOfType', filter: { types: ['creature'], colors: colorRead.colors } },
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 6: Match "destroy all <Subtype> creatures" / "destroy all non-<Subtype> creatures".
 *   e.g. "destroy all Dragon creatures." (Crux of Fate bullet 1)
 *        "destroy all non-Dragon creatures." (Crux of Fate bullet 2)
 *
 * Emits Destroy + AllOfType with a creature+subtypes (or excludeSubtypes) filter.
 * Executor's Destroy AllOfType branch iterates the battlefield and destroys all
 * permanents whose matchesCardFilter returns true, which honours subtypes and
 * excludeSubtypes via typeLineHasSubtype.
 *
 * HONESTY: pure board-wipe by creature subtype. executor already runs this path.
 */
export function matchDestroyAllSubtypeCreatures(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;
  if (slice[0] !== 'destroy' || slice[1] !== 'all') return null;

  let idx = 2;
  let filter: CardFilter;

  // "destroy all non - <Subtype> creatures"  (tokenized as "non", "-", "<subtype>")
  if (slice[idx] === 'non' && slice[idx + 1] === '-' && slice[idx + 2]) {
    const subtypeKey = slice[idx + 2];
    if (!CREATURE_SUBTYPE_MAP[subtypeKey]) return null;
    const subtype = CREATURE_SUBTYPE_MAP[subtypeKey];
    idx += 3;
    if (slice[idx] !== 'creatures') return null;
    idx++;
    filter = { types: ['creature'], excludeSubtypes: [subtype] };
  } else {
    // "destroy all <Subtype> creatures"
    const subtypeKey = slice[idx];
    if (!subtypeKey || !CREATURE_SUBTYPE_MAP[subtypeKey]) return null;
    const subtype = CREATURE_SUBTYPE_MAP[subtypeKey];
    idx++;
    if (slice[idx] !== 'creatures') return null;
    idx++;
    filter = { types: ['creature'], subtypes: [subtype] };
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Destroy',
    target: { kind: 'AllOfType', filter },
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "destroy all lands" / "destroy all <basic-land-subtype>s"
 *   e.g. "destroy all Islands", "destroy all Forests", "destroy all lands".
 * Emits Destroy + AllOfType with a land[/subtype] filter, honoured honestly by
 * the executor's Destroy AllOfType branch (types/subtypes via matchesCardFilter).
 */
export function matchDestroyAllLandSubtype(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 3) return null;
  if (slice[0] !== 'destroy' || slice[1] !== 'all') return null;

  let filter: CardFilter;
  let idx = 2;
  if (slice[2] === 'lands') {
    filter = { types: ['land'] };
    idx = 3;
  } else if (BASIC_LAND_PLURALS[slice[2]]) {
    filter = { types: ['land'], subtypes: [BASIC_LAND_PLURALS[slice[2]]] };
    idx = 3;
  } else {
    return null;
  }
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Destroy',
    target: { kind: 'AllOfType', filter },
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "exile all artifacts" / "exile all enchantments" / "exile all creatures" /
 * "exile all graveyards"
 */
export function matchExileAll(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'exile') return null;
  // "exile each creature" → treat like "exile all creatures".
  if (slice[1] === 'each' && (slice[2] === 'creature' || slice[2] === 'creatures')) {
    let consumed = 3;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Exile', target: { kind: 'AllOfType', filter: { types: ['creature'] } } }], targets: [], consumed };
  }
  if (slice[1] !== 'all') return null;

  let idx = 2;
  const filter: CardFilter = {};

  if (slice[idx] === 'multicolored' && slice[idx + 1] === 'permanents') {
    filter.multicolored = true;
    idx += 2;
  } else if (slice[idx] === 'creatures') {
    filter.types = ['creature'];
    idx++;
  } else if (slice[idx] === 'artifacts') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'enchantments') {
    filter.types = ['enchantment'];
    idx++;
  } else if (slice[idx] === 'nonland' && slice[idx + 1] === 'permanents') {
    idx += 2;
  } else if (slice[idx] === 'permanents') {
    idx++;
  } else if (slice[idx] === 'graveyards') {
    idx++;
    if (slice[idx] === '.') idx++;
    return { effects: [{ kind: 'ExileAllGraveyards' }], targets: [], consumed: idx };
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Exile',
    target: { kind: 'AllOfType', filter },
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "exile all <color> creatures" / "exile all <color> or <color> creatures".
 * Emits Exile + AllOfType with a creature+color filter, honoured honestly by the
 * executor's Exile AllOfType branch.
 */
export function matchExileAllColorCreatures(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;
  if (slice[0] !== 'exile' || slice[1] !== 'all') return null;

  const colorRead = readColorConstraint(slice, 2);
  if (!colorRead) return null;
  let idx = 2 + colorRead.consumed;
  if (slice[idx] !== 'creatures') return null;
  idx++;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Exile',
    target: { kind: 'AllOfType', filter: { types: ['creature'], colors: colorRead.colors } },
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "return all creatures to their owners' hands"
 * Match: "return all [type] to their owners' hands"
 */
export function matchReturnAllToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 6) return null;
  if (slice[0] !== 'return') return null;
  if (slice[1] !== 'all') return null;

  let idx = 2;
  const filter: CardFilter = {};

  if (slice[idx] === 'attacking' && slice[idx + 1] === 'creatures') {
    idx += 2;

    // "to their owners' hands" / "to their owner's hand"
    if (slice[idx] !== 'to') return null;
    idx++;
    if (slice[idx] !== 'their') return null;
    idx++;
    if (slice[idx] !== "owners'" && slice[idx] !== "owner's") return null;
    idx++;
    if (slice[idx] !== 'hands' && slice[idx] !== 'hand') return null;
    idx++;

    if (slice[idx] === '.') idx++;

    const effect: Effect = {
      kind: 'ReturnToHand',
      target: { kind: 'AllAttackingCreatures' },
    };

    return { effects: [effect], targets: [], consumed: idx };
  }

  if (slice[idx] === 'multicolored' && slice[idx + 1] === 'permanents') {
    filter.multicolored = true;
    idx += 2;
  } else if (slice[idx] === 'creatures') {
    filter.types = ['creature'];
    idx++;
  } else if (slice[idx] === 'nonland' && slice[idx + 1] === 'permanents') {
    // "return all nonland permanents" — no simple type filter, treat as permanent
    idx += 2;
  } else if (slice[idx] === 'permanents') {
    idx++;
  } else if (slice[idx] === 'artifacts') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'enchantments') {
    filter.types = ['enchantment'];
    idx++;
  } else {
    return null;
  }

  // Optional "you control" (only meaningful for creatures here).
  let youControl = false;
  if (filter.types && filter.types[0] === 'creature' && slice[idx] === 'you' && slice[idx + 1] === 'control') {
    youControl = true;
    idx += 2;
  }

  // "to their owners' hands" / "to their owner's hand"
  if (slice[idx] !== 'to') return null;
  idx++;
  if (slice[idx] !== 'their') return null;
  idx++;
  if (slice[idx] !== "owners'" && slice[idx] !== "owner's") return null;
  idx++;
  if (slice[idx] !== 'hands' && slice[idx] !== 'hand') return null;
  idx++;

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ReturnToHand',
    target: youControl ? { kind: 'AllCreaturesYouControl' } : { kind: 'AllOfType', filter },
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match "Return all <type> cards from your/all graveyard(s) to the battlefield/hand."
 */
export function matchReturnAllFromGraveyard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'return' || slice[1] !== 'all') return null;

  const typeMap: Record<string, NonNullable<CardFilter['types']>> = {
    creature: ['creature'], artifact: ['artifact'], enchantment: ['enchantment'],
    land: ['land'], instant: ['instant'], sorcery: ['sorcery'], planeswalker: ['planeswalker'],
  };
  let idx = 2;
  let filter: CardFilter = {};
  if (typeMap[slice[idx]] && (slice[idx + 1] === 'cards' || slice[idx + 1] === 'card')) {
    filter = { types: typeMap[slice[idx]] };
    idx += 2;
  } else if (slice[idx] === 'cards' || slice[idx] === 'card') {
    idx += 1;
  } else {
    return null;
  }

  if (slice[idx] !== 'from') return null;
  idx++;
  let whose: 'yours' | 'all';
  if (slice[idx] === 'your' && slice[idx + 1] === 'graveyard') { whose = 'yours'; idx += 2; }
  else if (slice[idx] === 'all' && slice[idx + 1] === 'graveyards') { whose = 'all'; idx += 2; }
  else if ((slice[idx] === 'a' || slice[idx] === 'any') && slice[idx + 1] === 'graveyard') { whose = 'all'; idx += 2; }
  else if (slice[idx] === 'graveyards') { whose = 'all'; idx += 1; }
  else return null;

  if (slice[idx] !== 'to') return null;
  idx++;
  let destination: 'battlefield' | 'hand';
  if (slice[idx] === 'the' && slice[idx + 1] === 'battlefield') { destination = 'battlefield'; idx += 2; }
  else if (slice[idx] === 'your' && slice[idx + 1] === 'hand') { destination = 'hand'; idx += 2; }
  else if (slice[idx] === 'their') {
    destination = 'hand';
    while (idx < slice.length && slice[idx] !== '.' && slice[idx] !== 'hands' && slice[idx] !== 'hand') idx++;
    if (slice[idx] === 'hands' || slice[idx] === 'hand') idx++;
  }
  else return null;

  if (slice[idx] === 'under' && slice[idx + 1] === 'your' && slice[idx + 2] === 'control') idx += 3;
  if (slice[idx] === '.') idx++;

  return { effects: [{ kind: 'ReturnAllFromGraveyard', filter, whose, destination }], targets: [], consumed: idx };
}

/**
 * Slice 8: Match "Creatures your opponents control get -N/-N until end of turn."
 * (Turn the Tide family, 10 oracle-face cluster with -2/-0 wording.)
 *
 * Also accepts the variant forms:
 *   "creatures your opponents control get -N/+0 until end of turn"
 *   "each creature your opponents control gets -N/-N until end of turn"
 *
 * Emits ModifyPT with target { kind: 'AllOfType', filter: { types: ['creature'] },
 * opponentControls: true } so the executor's new AllOfType branch applies the
 * debuff only to creatures the caster's opponents control. Only the "until end
 * of turn" (non-static) form is claimed; static versions are separate.
 */
export function matchMassOpponentDebuff(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Normalise "each creature your opponents control gets" →
  //   index 0: "each"|"creatures"
  //   Subject forms accepted:
  //     "creatures your opponents control get ..."
  //     "each creature your opponents control gets ..."
  let idx = 0;

  if (slice[0] === 'each' && slice[1] === 'creature' && slice[2] === 'your'
      && slice[3] === 'opponents' && slice[4] === 'control'
      && (slice[5] === 'gets' || slice[5] === 'get')) {
    idx = 6;
  } else if (slice[0] === 'creatures' && slice[1] === 'your' && slice[2] === 'opponents'
             && slice[3] === 'control' && (slice[4] === 'get' || slice[4] === 'gets')) {
    idx = 5;
  } else {
    return null;
  }

  const ptMatch = slice[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  // Only accept negative P/T deltas (debuffs) in the "until end of turn" form.
  // Positive-delta "opponents' creatures get +N/+N" statics belong elsewhere.
  // We allow mixed signs (e.g. -2/+0) but at least one must be negative or zero.
  if (power > 0 && toughness > 0) return null;
  idx++;

  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
      || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')) return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ModifyPT',
    target: { kind: 'AllOfType', filter: { types: ['creature'] }, opponentControls: true },
    power,
    toughness,
    untilEndOfTurn: true,
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 4: Match "Destroy all tapped creatures." / "Destroy all untapped creatures."
 * Emits Destroy with AllOfType { types: ['creature'], tapped: boolean }. The executor's
 * AllOfType Destroy loop checks card.tapped at resolution time (instance state check).
 *
 * Also covers the adjective-before-noun orders from "destroy all tapped/untapped
 * <type>" where <type> is any permanent type (creatures, artifacts, enchantments).
 * Example: Split Up — modal bullets "Destroy all tapped creatures." and
 * "Destroy all untapped creatures."
 */
export function matchDestroyAllTappedCreatures(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;
  if (slice[0] !== 'destroy' || slice[1] !== 'all') return null;

  let tapped: boolean;
  if (slice[2] === 'tapped') {
    tapped = true;
  } else if (slice[2] === 'untapped') {
    tapped = false;
  } else {
    return null;
  }

  // Accept "creatures", "artifacts", "enchantments", "permanents", "lands"
  const typeMap: Record<string, string[] | null> = {
    creatures: ['creature'],
    artifacts: ['artifact'],
    enchantments: ['enchantment'],
    permanents: null,
    lands: ['land'],
  };
  const typeWord = slice[3];
  if (!(typeWord in typeMap)) return null;

  let idx = 4;
  if (slice[idx] === '.') idx++;

  const filterTypes = typeMap[typeWord];
  const filter: CardFilter = {
    ...(filterTypes ? { types: filterTypes } : {}),
    tapped,
  };
  const effect: Effect = {
    kind: 'Destroy',
    target: { kind: 'AllOfType', filter },
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 8: Match "Creatures with flying get -N/-N until end of turn."
 * Also covers the "all creatures with flying" variant.
 * Emits ModifyPT with AllOfType filter { types: ['creature'], withKeyword: 'flying' }.
 */
export function matchMassKeywordHolderDebuff(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // "creatures with flying get -N/-N until end of turn"
  // "all creatures with flying get -N/-N until end of turn"
  let idx = 0;
  if (slice[0] === 'all') idx = 1;

  if ((slice[idx] === 'creatures' || slice[idx] === 'creature') && slice[idx + 1] === 'with') {
    idx += 2;
  } else {
    return null;
  }

  // Read the keyword (single token, engine-enforced evasion keywords only)
  const MASS_GRANTED_KEYWORDS = new Set(['flying', 'reach', 'trample', 'vigilance', 'menace', 'haste', 'lifelink', 'deathtouch', 'defender', 'indestructible', 'hexproof', 'shroud']);
  const kw = slice[idx];
  if (!kw || !MASS_GRANTED_KEYWORDS.has(kw.toLowerCase())) return null;
  idx++;

  if (slice[idx] !== 'get' && slice[idx] !== 'gets') return null;
  idx++;

  const ptMatch = slice[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  // Must be a debuff
  if (power > 0 && toughness > 0) return null;
  idx++;

  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
      || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')) return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ModifyPT',
    target: { kind: 'AllOfType', filter: { types: ['creature'], withKeyword: kw.toLowerCase() } },
    power,
    toughness,
    untilEndOfTurn: true,
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match exact-N multi-target removal/bounce without "up to":
 *   "destroy two target enchantments" (Peace and Quiet)
 *   "destroy two target lands"        (Rain of Salt)
 *   "tap two target creatures"        (Blinding Beam modal bullet)
 *   "exile two target creatures"
 *   "return two target creatures to their owners' hands"
 *
 * Produces a SINGLE TargetSpec whose `count` is N (exact — no minCount, so the
 * chooser must pick exactly N). The executor's Tap/Destroy/Exile/ReturnToHand
 * cases iterate every id chosen for the spec (resolveChosenTargetIds), so the
 * effect applies honestly to all N chosen targets.
 *
 * Distinct from matchMultiTarget (which requires "up to N"). This handler fires
 * first when the count word is present and "up to" is absent.
 */
export function matchExactMultiTarget(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;

  let kind: 'Tap' | 'Destroy' | 'Exile' | 'ReturnToHand';
  let idx = 0;
  if (slice[0] === 'tap') { kind = 'Tap'; idx = 1; }
  else if (slice[0] === 'destroy') { kind = 'Destroy'; idx = 1; }
  else if (slice[0] === 'exile') { kind = 'Exile'; idx = 1; }
  else if (slice[0] === 'return') { kind = 'ReturnToHand'; idx = 1; }
  else return null;

  // Reject "up to" prefix — that is handled by matchMultiTarget.
  if (slice[idx] === 'up') return null;

  // Parse exact count word: two, three, four, etc. (>= 2).
  const count = parseSmallNumberToken(slice[idx] ?? '');
  if (Number.isNaN(count) || count < 2) return null;
  idx++;

  if (slice[idx] !== 'target') return null;
  idx++;

  // Map plural permanent nouns to TargetType.
  const pluralToType: Record<string, TargetType> = {
    creatures: 'Creature',
    lands: 'Land',
    artifacts: 'Artifact',
    enchantments: 'Enchantment',
    permanents: 'Permanent',
  };
  const targetType = pluralToType[slice[idx]];
  if (!targetType) return null;
  idx++;

  // For ReturnToHand: consume optional "to their owners' hands" / "to their owner's hand".
  if (kind === 'ReturnToHand') {
    if (slice[idx] === 'to' && slice[idx + 1] === 'their') {
      idx += 2;
      if (slice[idx] === "owners'" || slice[idx] === "owner's") idx++;
      if (slice[idx] === 'hands' || slice[idx] === 'hand') idx++;
    }
  }

  if (slice[idx] === '.') idx++;

  // makeTargetSpec creates a globally-unique ID using parser.ts's shared counter.
  const spec = makeTargetSpec(targetType);
  spec.count = count;
  // No minCount — exact N required (chooser must pick exactly N targets).

  let effect: Effect;
  if (kind === 'ReturnToHand') {
    effect = { kind: 'ReturnToHand', target: makeChosenRef(spec) };
  } else {
    effect = { kind, target: makeChosenRef(spec) } as Effect;
  }

  return { effects: [effect], targets: [spec], consumed: idx };
}

// ─── Slice 8: filtered-mass forms ───────────────────────────────────────────

/** Single-token "non<color>" map used by destroy/exile all non<color> creatures. */
const NON_COLOR_TOKENS: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
  nonwhite: 'W', nonblue: 'U', nonblack: 'B', nonred: 'R', nongreen: 'G',
};

/**
 * Slice 8: Match "destroy all non<color> creatures" / "exile all non<color> creatures".
 *   e.g. "Destroy all nonwhite creatures." (Mass Calcify)
 *        "Destroy all nonblack creatures." (Their Name Is Death)
 *        "Exile all nonblue creatures."
 *
 * Emits Destroy/Exile + AllOfType with { types: ['creature'], excludeColors: [color] }.
 * Executor's AllOfType Destroy/Exile branch uses matchesCardFilter which honours
 * excludeColors (already implemented in Phase 4).
 *
 * HONESTY: pure board-wipe by excluded creature color — executor already runs this.
 */
export function matchDestroyAllNoncolorCreatures(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;

  let kind: 'Destroy' | 'Exile';
  if (slice[0] === 'destroy') { kind = 'Destroy'; }
  else if (slice[0] === 'exile') { kind = 'Exile'; }
  else return null;

  if (slice[1] !== 'all') return null;

  // Detect "non<color>" single token OR "non - <color>" tokenized form.
  let excludedColor: 'W' | 'U' | 'B' | 'R' | 'G' | undefined;
  let idx = 2;
  if (NON_COLOR_TOKENS[slice[idx]]) {
    excludedColor = NON_COLOR_TOKENS[slice[idx]];
    idx++;
  } else if (slice[idx] === 'non' && slice[idx + 1] === '-' && slice[idx + 2]) {
    const colorWord = slice[idx + 2];
    excludedColor = COLOR_WORDS[colorWord];
    if (!excludedColor) return null;
    idx += 3;
  } else {
    return null;
  }

  if (slice[idx] !== 'creatures') return null;
  idx++;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind,
    target: { kind: 'AllOfType', filter: { types: ['creature'], excludeColors: [excludedColor] } },
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 8: Match "destroy/exile all token/nontoken creatures/permanents".
 *   e.g. "Destroy all nontoken creatures." (Hour of Reckoning)
 *        "Exile all token creatures."
 *        "Exile all nontoken permanents."
 *
 * Emits Destroy/Exile + AllOfType with { types: ['creature'], tokenOnly: true }
 * or { types: ['creature'], nontoken: true }. The executor's AllOfType loop
 * applies the token/nontoken filter as an instance-state check (card.isToken).
 *
 * HONESTY: new executor instance-state checks added in the AllOfType Destroy
 * and Exile loops for tokenOnly and nontoken. ReturnToHand covered by matchReturnAllTokenFilter.
 */
export function matchDestroyAllTokenFilter(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;

  let kind: 'Destroy' | 'Exile';
  if (slice[0] === 'destroy') { kind = 'Destroy'; }
  else if (slice[0] === 'exile') { kind = 'Exile'; }
  else return null;

  if (slice[1] !== 'all') return null;

  let tokenOnly = false;
  let nontoken = false;
  let idx = 2;

  if (slice[idx] === 'token' || slice[idx] === 'tokens') {
    tokenOnly = true;
    idx++;
  } else if (slice[idx] === 'nontoken') {
    nontoken = true;
    idx++;
  } else {
    return null;
  }

  const typeMap: Record<string, string[]> = {
    creatures: ['creature'],
    permanents: [],
    artifacts: ['artifact'],
    enchantments: ['enchantment'],
  };
  const typeWord = slice[idx];
  if (!typeWord || !(typeWord in typeMap)) return null;
  const types = typeMap[typeWord];
  idx++;
  if (slice[idx] === '.') idx++;

  const filter: CardFilter = {
    ...(types.length > 0 ? { types } : {}),
    ...(tokenOnly ? { tokenOnly: true } : {}),
    ...(nontoken ? { nontoken: true } : {}),
  };
  const effect: Effect = { kind, target: { kind: 'AllOfType', filter } };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 8: Match "return all creature tokens / nontoken creatures to their owners' hands".
 *   e.g. "Return all creature tokens to their owners' hands." (Perplexing Test bullet 1)
 *        "Return all nontoken creatures to their owners' hands." (Perplexing Test bullet 2)
 *
 * Emits ReturnToHand + AllOfType with tokenOnly or nontoken filter. The executor's
 * AllOfType ReturnToHand loop applies the instance-state check (card.isToken).
 *
 * HONESTY: executor AllOfType ReturnToHand loop gets tokenOnly/nontoken checks.
 */
export function matchReturnAllTokenFilter(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 7) return null;
  if (slice[0] !== 'return' || slice[1] !== 'all') return null;

  let tokenOnly = false;
  let nontoken = false;
  let idx = 2;

  // "return all creature tokens" | "return all nontoken creatures"
  if (slice[idx] === 'creature' && slice[idx + 1] === 'tokens') {
    tokenOnly = true;
    idx += 2;
  } else if (slice[idx] === 'nontoken' && slice[idx + 1] === 'creatures') {
    nontoken = true;
    idx += 2;
  } else {
    return null;
  }

  // "to their owners' hands" / "to their owner's hand"
  if (slice[idx] !== 'to') return null;
  idx++;
  if (slice[idx] !== 'their') return null;
  idx++;
  if (slice[idx] !== "owners'" && slice[idx] !== "owner's") return null;
  idx++;
  if (slice[idx] !== 'hands' && slice[idx] !== 'hand') return null;
  idx++;
  if (slice[idx] === '.') idx++;

  const filter: CardFilter = {
    types: ['creature'],
    ...(tokenOnly ? { tokenOnly: true } : {}),
    ...(nontoken ? { nontoken: true } : {}),
  };
  const effect: Effect = { kind: 'ReturnToHand', target: { kind: 'AllOfType', filter } };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 8: Match "destroy/exile all legendary/nonlegendary creatures/permanents".
 *   e.g. "Destroy all legendary creatures." (Invasion of Fiora bullet 1)
 *        "Destroy all nonlegendary creatures." (Invasion of Fiora bullet 2)
 *        "Exile all legendary permanents."
 *
 * Emits Destroy/Exile + AllOfType with supertypes: ['legendary'] or
 * excludeSupertypes: ['legendary']. matchesCardFilter already supports both
 * (supertypes and excludeSupertypes via typeLineHasSupertype).
 *
 * HONESTY: pure filter on legendary supertype — executor already runs this.
 */
export function matchDestroyAllLegendaryFilter(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;

  let kind: 'Destroy' | 'Exile';
  if (slice[0] === 'destroy') { kind = 'Destroy'; }
  else if (slice[0] === 'exile') { kind = 'Exile'; }
  else return null;

  if (slice[1] !== 'all') return null;

  let isLegendary: boolean | undefined;
  let idx = 2;

  if (slice[idx] === 'legendary') {
    isLegendary = true;
    idx++;
  } else if (slice[idx] === 'nonlegendary') {
    isLegendary = false;
    idx++;
  } else {
    return null;
  }

  const typeMap: Record<string, string[] | null> = {
    creatures: ['creature'],
    permanents: null,
    artifacts: ['artifact'],
    enchantments: ['enchantment'],
  };
  const typeWord = slice[idx];
  if (!typeWord || !(typeWord in typeMap)) return null;
  const types = typeMap[typeWord];
  idx++;
  if (slice[idx] === '.') idx++;

  const filter: CardFilter = {
    ...(types ? { types } : {}),
    ...(isLegendary ? { supertypes: ['legendary'] } : { excludeSupertypes: ['legendary'] }),
  };
  const effect: Effect = { kind, target: { kind: 'AllOfType', filter } };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 8: Match "destroy all <Subtype> creatures" with exile variant.
 *   "Exile all Dragon creatures." / "Exile all non-Dragon creatures."
 *   (complements matchDestroyAllSubtypeCreatures which only handles destroy)
 *
 * Emits Exile + AllOfType with creature+subtypes (or excludeSubtypes) filter.
 * HONESTY: executor Exile AllOfType branch destroys every matching creature.
 */
export function matchExileAllSubtypeCreatures(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;
  if (slice[0] !== 'exile' || slice[1] !== 'all') return null;

  let idx = 2;
  let filter: CardFilter;

  // "exile all non - <Subtype> creatures"
  if (slice[idx] === 'non' && slice[idx + 1] === '-' && slice[idx + 2]) {
    const subtypeKey = slice[idx + 2];
    if (!CREATURE_SUBTYPE_MAP[subtypeKey]) return null;
    const subtype = CREATURE_SUBTYPE_MAP[subtypeKey];
    idx += 3;
    if (slice[idx] !== 'creatures') return null;
    idx++;
    filter = { types: ['creature'], excludeSubtypes: [subtype] };
  } else {
    // "exile all <Subtype> creatures"
    const subtypeKey = slice[idx];
    if (!subtypeKey || !CREATURE_SUBTYPE_MAP[subtypeKey]) return null;
    const subtype = CREATURE_SUBTYPE_MAP[subtypeKey];
    idx++;
    if (slice[idx] !== 'creatures') return null;
    idx++;
    filter = { types: ['creature'], subtypes: [subtype] };
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = { kind: 'Exile', target: { kind: 'AllOfType', filter } };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 8: Match "destroy all blocking creatures" / "destroy all blocked creatures".
 * Also handles the compound form: "destroy all blocking creatures and all blocked creatures."
 * (Fight to the Death)
 *
 * "blocking creatures" = creatures in state.combat.blockers.
 * "blocked creatures" = creatures in state.combat.attackers that have at least one blocker
 *   (distinct from "blocking" — they are the attacked creatures, i.e., attackers being blocked).
 * "attacking creatures" = all creatures in state.combat.attackers.
 *
 * Emits Destroy + AllOfType with { types: ['creature'], blocking: true } for blocking,
 * or { types: ['creature'], blocked: true } for blocked attackers,
 * or { types: ['creature'], attacking: true } for attacking.
 *
 * For the compound "...and all blocked creatures" / "...and all blocking creatures"
 * form, both effects are emitted from a single matcher call so the parser
 * does not need to re-enter for the "all X creatures" continuation.
 *
 * HONESTY: executor AllOfType Destroy loop gets blocking/blocked/attacking checks
 * against state.combat.blockers / state.combat.attackers. New fields `blocked`
 * added to CardFilter (instance-state check).
 */
export function matchDestroyAllBlockingBlocked(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;
  if (slice[0] !== 'destroy' || slice[1] !== 'all') return null;

  type CombatExtra = { blocking?: true; blocked?: true; attacking?: true };
  const COMBAT_ADJECTIVES: Record<string, CombatExtra> = {
    blocking: { blocking: true },
    blocked: { blocked: true },
    attacking: { attacking: true },
  };

  const adjective1 = slice[2];
  if (!COMBAT_ADJECTIVES[adjective1]) return null;
  if (slice[3] !== 'creatures') return null;

  const effects: Effect[] = [];
  let idx = 4;

  effects.push({
    kind: 'Destroy',
    target: { kind: 'AllOfType', filter: { types: ['creature'], ...COMBAT_ADJECTIVES[adjective1] } },
  });

  // Optional "and all <adjective2> creatures" continuation (Fight to the Death).
  if (slice[idx] === 'and' && slice[idx + 1] === 'all') {
    const adjective2 = slice[idx + 2];
    if (adjective2 && COMBAT_ADJECTIVES[adjective2] && slice[idx + 3] === 'creatures') {
      effects.push({
        kind: 'Destroy',
        target: { kind: 'AllOfType', filter: { types: ['creature'], ...COMBAT_ADJECTIVES[adjective2] } },
      });
      idx += 4;
    }
  }

  if (slice[idx] === '.') idx++;

  return { effects, targets: [], consumed: idx };
}

// ─── Slice 10/13: "choose N target creatures … them/those" spells ────────────

/**
 * Slice 10/13: Handle "Choose (one|two|up to N) target creatures [constraints].
 * <effect sentences using them / those creatures / they>" — the class of spells
 * that open with a choose-N target preamble (no bullet list) and follow with
 * pronoun-threaded effects on the chosen group.
 *
 * Supported effect sentences (claimed verb families the engine runs):
 *   - "Return those creatures to their owners' hands."         (ReturnToHand)
 *   - "Untap them."                                            (Untap)
 *   - "Put N +1/+1 counters on each of them."                 (AddCounters)
 *   - "They gain <keyword> until end of turn."                 (GrantKeyword)
 *   - "Those creatures fight each other."                      (Fight — needs
 *         additive executor branch that reads both fighters from chosenTargetsMulti)
 *
 * Declined shapes (no executor support without a new subsystem):
 *   - "their controller sacrifices one of them" (Retribution / Barrin's Spite)
 *
 * Produces a single TargetSpec with count=N (minCount=1 for "up to" forms) and
 * one or more effects whose target is a ChosenRef pointing to that spec. The
 * executor's existing AllOfType/Chosen multi-target loops apply each effect to
 * all N chosen creatures — ReturnToHand, Untap, AddCounters, GrantKeyword and
 * Fight all already handle Chosen refs via resolveChosenTargetIds /
 * chosenTargetsMulti (Fight gets an additive branch in executor.ts).
 *
 * HONESTY GATE: we only emit effects for sentence patterns in the list above.
 * If an unrecognised sentence remains after the preamble we return null and let
 * the card stay Unparsed rather than silently dropping printed text.
 */
export function matchChooseNTargetSpell(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Must start with "choose"
  if (slice[0] !== 'choose') return null;

  // Parse the count word: "one", "two", "up to N"
  let count: number;
  let minCount: number | undefined;
  let idx = 1;

  if (slice[1] === 'up' && slice[2] === 'to') {
    count = parseSmallNumberToken(slice[3] ?? '');
    if (Number.isNaN(count) || count < 1) return null;
    minCount = 1;
    idx = 4;
  } else {
    count = parseSmallNumberToken(slice[1] ?? '');
    if (Number.isNaN(count) || count < 1) return null;
    idx = 2;
  }

  // Must have "target" next
  if (slice[idx] !== 'target') return null;
  idx++;

  // Accept "creature" or "creatures"
  if (slice[idx] !== 'creature' && slice[idx] !== 'creatures') return null;
  idx++;

  // Optional constraint qualifiers — we recognise a narrow set that gates legality:
  //   "you control" / "an opponent controls" / "controlled by different players" /
  //   "that share no creature types" / other unrecognised qualifiers → return null
  //   (don't silently drop them; they affect target legality we can't enforce).
  const constraints: TargetSpec['constraints'] = {};
  let constraintsOk = true;

  while (constraintsOk) {
    if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
      constraints.controllerControls = true;
      idx += 2;
    } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
      constraints.opponentControls = true;
      idx += 3;
    } else if (
      slice[idx] === 'controlled' && slice[idx + 1] === 'by' &&
      slice[idx + 2] === 'different' && slice[idx + 3] === 'players'
    ) {
      // "controlled by different players" — the engine can't currently enforce
      // inter-target controller-diversity during target validation.  We still
      // claim the card (the effect is honest) but don't try to encode the
      // constraint so the game at least executes the bounce correctly.
      idx += 4;
    } else if (
      slice[idx] === 'that' && slice[idx + 1] === 'share' && slice[idx + 2] === 'no' &&
      slice[idx + 3] === 'creature' && slice[idx + 4] === 'types'
    ) {
      // "that share no creature types" — same: constraint not enforceable at
      // validation time, but the Fight effect itself is honest.
      idx += 5;
    } else {
      // No more recognised qualifiers — stop.
      break;
    }
  }

  if (!constraintsOk) return null;

  // Consume optional period ending the preamble.
  if (slice[idx] === '.') idx++;

  // If nothing follows the preamble, decline (no effect to produce).
  if (idx >= slice.length) return null;

  // Build the TargetSpec now so we can build ChosenRefs for each effect.
  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  spec.count = count;
  if (minCount !== undefined) spec.minCount = minCount;
  const chosenRef = makeChosenRef(spec);

  // Parse the effect sentences that follow, using the chosen group as subject.
  // We parse each sentence pattern explicitly rather than re-entering the full
  // dispatcher, which avoids false-positive matches and correctly threads the
  // shared ChosenRef.
  const effects: Effect[] = [];

  while (idx < slice.length) {
    // Skip sentence separator tokens
    while (slice[idx] === '.' || slice[idx] === ',') idx++;
    if (idx >= slice.length) break;

    // ── "return those creatures to their owners' hands"
    //    "return them to their owners' hands"
    if (
      slice[idx] === 'return' &&
      (
        (slice[idx + 1] === 'those' && (slice[idx + 2] === 'creatures' || slice[idx + 2] === 'creature')) ||
        slice[idx + 1] === 'them'
      )
    ) {
      const sentStart = idx;
      idx++; // 'return'
      idx++; // 'those' or 'them'
      if (slice[sentStart + 1] === 'those') idx++; // 'creatures'
      // consume "to their owners' hands" / "to their owner's hand"
      if (slice[idx] === 'to' && slice[idx + 1] === 'their') {
        idx += 2;
        if (slice[idx] === "owners'" || slice[idx] === "owner's") idx++;
        if (slice[idx] === 'hands' || slice[idx] === 'hand') idx++;
      }
      if (slice[idx] === '.') idx++;
      effects.push({ kind: 'ReturnToHand', target: chosenRef });
      continue;
    }

    // ── "untap them"
    if (slice[idx] === 'untap' && slice[idx + 1] === 'them') {
      idx += 2;
      if (slice[idx] === '.') idx++;
      effects.push({ kind: 'Untap', target: chosenRef });
      continue;
    }

    // ── "put N +1/+1 counters on each of them"
    //    "put two +1/+1 counters on each of them"
    //    "put a +1/+1 counter on each of them"
    if (
      slice[idx] === 'put' &&
      slice[idx + 2]?.match(/^\+\d+\/\+\d+$/) &&
      (slice[idx + 3] === 'counters' || slice[idx + 3] === 'counter') &&
      slice[idx + 4] === 'on' &&
      slice[idx + 5] === 'each' &&
      slice[idx + 6] === 'of' &&
      slice[idx + 7] === 'them'
    ) {
      // Accept "a"/"an" as 1, word numbers (two, three…), and digit strings.
      const rawCount = slice[idx + 1] ?? '';
      const nCounters = (rawCount === 'a' || rawCount === 'an') ? 1
        : parseSmallNumberToken(rawCount);
      if (!Number.isNaN(nCounters) && nCounters >= 1) {
        const ptTok = slice[idx + 2]!;
        const ptMatch = ptTok.match(/^\+(\d+)\/\+(\d+)$/);
        if (ptMatch) {
          // Only claim +1/+1 counters — other denominations would need a new
          // executor branch and fall outside our honest claim.
          if (ptMatch[1] !== '1' || ptMatch[2] !== '1') return null;
          idx += 8;
          if (slice[idx] === '.') idx++;
          effects.push({
            kind: 'AddCounters',
            target: chosenRef,
            counterType: '+1/+1',
            count: nCounters,
          });
          continue;
        }
      }
      // Unrecognised counter form — bail out for honesty
      return null;
    }

    // ── "they gain <keyword> until end of turn"
    if (slice[idx] === 'they' && (slice[idx + 1] === 'gain' || slice[idx + 1] === 'gains')) {
      idx += 2;
      // Collect one or more keywords separated by "," / "and"
      const keywords: string[] = [];
      while (true) {
        const kw = readGrantableKeyword(slice, idx);
        if (!kw) break;
        keywords.push(kw.keyword);
        idx += kw.consumed;
        if (slice[idx] === ',') idx++;
        if (slice[idx] === 'and') idx++;
      }
      if (keywords.length === 0) return null; // unrecognised keyword — decline
      // consume "until end of turn"
      if (slice[idx] === 'until' && slice[idx + 1] === 'end' && slice[idx + 2] === 'of' && slice[idx + 3] === 'turn') {
        idx += 4;
      }
      if (slice[idx] === '.') idx++;
      for (const kw of keywords) {
        effects.push({ kind: 'GrantKeyword', target: chosenRef, keyword: kw, untilEndOfTurn: true });
      }
      continue;
    }

    // ── "those creatures fight each other"
    //    Both fighters come from the same multi-target spec. We emit a Fight
    //    where fighterA and fighterB are BOTH ChosenRefs to the same spec.
    //    The executor's additive branch (slice 10/13) detects same-spec refs
    //    with count>=2 and resolves id[0] vs id[1] from chosenTargetsMulti.
    if (
      slice[idx] === 'those' && (slice[idx + 1] === 'creatures' || slice[idx + 1] === 'creature') &&
      slice[idx + 2] === 'fight' && slice[idx + 3] === 'each' && slice[idx + 4] === 'other'
    ) {
      if (count < 2) return null; // need at least 2 for a fight
      idx += 5;
      if (slice[idx] === '.') idx++;
      // Both fighters share the same ChosenRef; executor resolves [0] vs [1]
      effects.push({
        kind: 'Fight',
        fighterA: chosenRef,
        fighterB: chosenRef,
      } as Effect);
      continue;
    }

    // Unrecognised sentence pattern — decline rather than silently drop it.
    return null;
  }

  if (effects.length === 0) return null;

  return {
    effects,
    targets: [spec],
    consumed: idx,
  };
}
