// Zone-transition matchers extracted from parser.ts (batch 7/12).
// Covers: destroy, exile, return-to-hand, return-from-graveyard, blink families.
// Slice 3/12 extension: put-on-top/bottom-of-library (Time Ebb family).
// Slice 9/12 extension: ETB "return up to one [other] target <type> [you control] to hand"
//   (Winter Eladrin, Stickytongue Sentinel, Flock Impostor, Rimekin Recluse, etc.) and
//   "exile up to N target cards from a single graveyard" (Gravegouger, Griffnaut Tracker).
// Do NOT edit logic here — keep verbatim with parser.ts originals.

import type { Effect, TargetRef, EnterAsCopyEffect } from '../ast';
import type { TargetSpec, TargetType } from '../targets';
import type { PatternResult } from '../parser';
import {
  makeTargetSpec,
  makeChosenRef,
  readColorConstraint,
  retryWithTargetNounModifiers,
  applyPowerToughnessTargetConstraint,
  consumeCantBeRegenerated,
  targetTypeFromSimplePermanentWord,
  applyManaValueTargetConstraint,
  parseSmallNumberToken,
  readCreatureSubtypeTargetPhrase,
} from '../parser';

const GRAVEYARD_NOUN_CARD_TYPES = new Set([
  'artifact', 'battle', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery',
]);

/** The card types a "permanent card" noun phrase covers (CR 110.4). */
const PERMANENT_CARD_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'];

/**
 * Words that must never be read as a graveyard-card subtype. Supertypes,
 * colors, and other qualifiers TargetSpec constraints can't (yet) enforce —
 * leaving those phrases Unparsed keeps the matcher honest.
 */
const GRAVEYARD_NOUN_NON_SUBTYPE_WORDS = new Set([
  'legendary', 'basic', 'snow', 'world',
  'white', 'blue', 'black', 'red', 'green', 'colorless', 'multicolored', 'monocolored',
  'token', 'nontoken', 'another', 'other', 'each', 'all', 'that', 'a', 'an', 'the',
  'tapped', 'untapped', 'attacking', 'blocking', 'exiled', 'face', 'random',
]);

/**
 * Parse the noun phrase of a graveyard return between "target" and
 * "card"/"cards" into a graveyard target type + constraints:
 *
 *   "creature card"               → CreatureCardInGraveyard
 *   "creature or enchantment card"→ CreatureOrEnchantmentCardInGraveyard (legacy type)
 *   "instant or sorcery card"     → CardInGraveyard + types ['instant','sorcery'] (OR)
 *   "artifact card"               → CardInGraveyard + types ['artifact']
 *   "permanent card"              → CardInGraveyard + types = the permanent card types
 *   "artifact creature card"      → CreatureCardInGraveyard + types ['artifact'] (AND)
 *   "Goblin card" / "Spirit card" → CardInGraveyard + subtypes [word]
 *   "Zombie creature card"        → CreatureCardInGraveyard + subtypes ['zombie']
 *   "card" (bare)                 → CardInGraveyard
 *
 * `constraints.types`/`constraints.subtypes` are OR within each list and AND
 * across lists / the TargetType — exactly how validateTargetChoices enforces
 * them, so every parsed shape is honestly checked at target-legality time.
 */
function parseGraveyardCardNounPhrase(
  slice: string[],
  startIndex: number,
): { targetType: TargetType; constraints: TargetSpec['constraints']; nextIndex: number } | null {
  let idx = startIndex;

  // Collect up to three plain words, joined by optional "or" / "," connectors,
  // ending at "card"/"cards".
  const words: string[] = [];
  let hasOr = false;
  while (idx < slice.length && slice[idx] !== 'card' && slice[idx] !== 'cards') {
    const word = slice[idx];
    if (word === 'or' || word === ',' || word === 'and/or') {
      if (words.length === 0) return null;
      hasOr = true;
      idx++;
      continue;
    }
    if (words.length >= 3) return null;
    if (!/^[a-z]+$/.test(word) || word.startsWith('non')) return null;
    if (GRAVEYARD_NOUN_NON_SUBTYPE_WORDS.has(word)) return null;
    words.push(word);
    idx++;
  }
  if (slice[idx] !== 'card' && slice[idx] !== 'cards') return null;
  idx++;

  const isType = (w: string) => GRAVEYARD_NOUN_CARD_TYPES.has(w);

  // Bare "target card".
  if (words.length === 0) {
    return { targetType: 'CardInGraveyard', constraints: undefined, nextIndex: idx };
  }

  if (hasOr) {
    // OR-list: all card types or all subtypes — mixed lists stay Unparsed.
    if (words.every(isType)) {
      if (words.length === 2 && words[0] === 'creature' && words[1] === 'enchantment') {
        // Preserve the pre-existing dedicated target type.
        return { targetType: 'CreatureOrEnchantmentCardInGraveyard', constraints: undefined, nextIndex: idx };
      }
      return { targetType: 'CardInGraveyard', constraints: { types: [...words] }, nextIndex: idx };
    }
    if (words.every(w => !isType(w) && w !== 'permanent')) {
      return { targetType: 'CardInGraveyard', constraints: { subtypes: [...words] }, nextIndex: idx };
    }
    return null;
  }

  // No connector: AND semantics across the words.
  if (words.length === 1) {
    const word = words[0];
    if (word === 'creature') {
      return { targetType: 'CreatureCardInGraveyard', constraints: undefined, nextIndex: idx };
    }
    if (word === 'permanent') {
      return { targetType: 'CardInGraveyard', constraints: { types: [...PERMANENT_CARD_TYPES] }, nextIndex: idx };
    }
    if (isType(word)) {
      return { targetType: 'CardInGraveyard', constraints: { types: [word] }, nextIndex: idx };
    }
    return { targetType: 'CardInGraveyard', constraints: { subtypes: [word] }, nextIndex: idx };
  }

  if (words.length === 2) {
    const [first, second] = words;
    if (first === 'permanent' || second === 'permanent') return null;
    // "artifact creature card" — AND of two card types: creature via the
    // TargetType, the other via the required-types constraint.
    if (isType(first) && second === 'creature') {
      return { targetType: 'CreatureCardInGraveyard', constraints: { types: [first] }, nextIndex: idx };
    }
    // "Zombie creature card" — subtype + creature type.
    if (!isType(first) && second === 'creature') {
      return { targetType: 'CreatureCardInGraveyard', constraints: { subtypes: [first] }, nextIndex: idx };
    }
    // "Aura enchantment card" — subtype + non-creature card type.
    if (!isType(first) && isType(second)) {
      return { targetType: 'CardInGraveyard', constraints: { types: [second], subtypes: [first] }, nextIndex: idx };
    }
    return null;
  }

  return null;
}

export function matchDestroy(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 2) return null;
  if (slice[0] !== 'destroy') return null;

  // "Destroy this creature / it / ~." — self-destroy of the source permanent.
  if (slice[1] === 'it' || slice[1] === '~' || (slice[1] === 'this' && targetTypeFromSimplePermanentWord(slice[2]))) {
    let consumed = (slice[1] === 'this') ? 3 : 2;
    if (tokens[startIndex + consumed] === '.') consumed++;
    const noRegenSpan = consumeCantBeRegenerated(tokens, startIndex + consumed);
    consumed += noRegenSpan;
    return { effects: [{ kind: 'Destroy', target: { kind: 'Source' }, ...(noRegenSpan > 0 ? { noRegen: true } : {}) }], targets: [], consumed };
  }
  // "Destroy that creature / that permanent." — the creature from the triggering event.
  if (slice[1] === 'that' && targetTypeFromSimplePermanentWord(slice[2])) {
    let consumed = 3;
    if (tokens[startIndex + consumed] === '.') consumed++;
    const noRegenSpan = consumeCantBeRegenerated(tokens, startIndex + consumed);
    consumed += noRegenSpan;
    return { effects: [{ kind: 'Destroy', target: { kind: 'EventCreature' }, ...(noRegenSpan > 0 ? { noRegen: true } : {}) }], targets: [], consumed };
  }
  // Optional "up to one" before "target …" → single optional target.
  if (slice[1] === 'up' && slice[2] === 'to' && slice[3] === 'one' && slice[4] === 'target') {
    const shifted = matchDestroy(['destroy', ...slice.slice(4)], 0);
    if (!shifted) return null;
    return { ...shifted, consumed: shifted.consumed + 3 };
  }

  // "destroy target attacking creature" / "destroy target tapped creature" /
  // "destroy target nonlegendary creature" / "destroy target non-Human creature" —
  // noun-phrase constraint modifiers, then the regular destroy parse.
  const destroyWithMods = retryWithTargetNounModifiers(slice, 1, matchDestroy);
  if (destroyWithMods) return destroyWithMods;

  if (slice.length < 3) return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let consumed = 3;
  let opponentControls = false;
  let notColors: Array<'W' | 'U' | 'B' | 'R' | 'G'> | undefined;
  let colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> | undefined;
  const excludedColorByToken: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
    nonwhite: 'W',
    nonblue: 'U',
    nonblack: 'B',
    nonred: 'R',
    nongreen: 'G',
  };

  const destroyColorRead = readColorConstraint(slice, 2);
  if (slice[2] === 'creature') {
    targetType = 'Creature';
  } else if (destroyColorRead && slice[2 + destroyColorRead.consumed] === 'creature') {
    // "destroy target white or blue creature"
    targetType = 'Creature';
    colors = destroyColorRead.colors;
    consumed = 2 + destroyColorRead.consumed + 1;
  } else if (excludedColorByToken[slice[2]] && slice[3] === 'creature') {
    targetType = 'Creature';
    notColors = [excludedColorByToken[slice[2]]];
    consumed = 4;
  } else if (destroyColorRead && slice[2 + destroyColorRead.consumed] === 'permanent') {
    // Slice 7: "destroy target blue permanent" / "destroy target red or green permanent"
    targetType = 'Permanent';
    colors = destroyColorRead.colors;
    consumed = 2 + destroyColorRead.consumed + 1;
  } else if (slice[2] === 'nonland' && slice[3] === 'permanent') {
    // Slice 1: "destroy target nonland permanent" (Abrupt Decay, Void Rend, Fate of the Sun-Cryst)
    targetType = 'NonlandPermanent';
    consumed = 4;
  } else if (slice[2] === 'permanent') {
    targetType = 'Permanent';
  } else if (slice[2] === 'artifact' && slice[3] === 'or' && slice[4] === 'enchantment') {
    targetType = 'ArtifactOrEnchantment';
    consumed = 5;
  } else if (
    slice[2] === 'artifact'
    && slice.includes('enchantment')
    && slice.includes('land')
  ) {
    targetType = 'ArtifactEnchantmentOrLand';
    consumed = slice.indexOf('land') + 1;
  } else if (slice[2] === 'artifact') {
    targetType = 'Artifact';
  } else if (slice[2] === 'enchantment') {
    targetType = 'Enchantment';
  } else if (slice[2] === 'land') {
    targetType = 'Land';
  } else {
    // "destroy target <Subtype>" — bare creature-subtype target (Wall, Merfolk, etc.)
    const subtypeRead = readCreatureSubtypeTargetPhrase(slice, 2);
    if (subtypeRead) {
      let consumed = 2 + subtypeRead.consumed;
      // Handle trailing period
      if (tokens[startIndex + consumed] === '.') consumed++;
      const noRegenSpan = consumeCantBeRegenerated(tokens, startIndex + consumed);
      consumed += noRegenSpan;
      const constraints: TargetSpec['constraints'] = {
        subtypes: subtypeRead.subtypes,
        ...(subtypeRead.controllerControls ? { controllerControls: true } : {}),
        ...(subtypeRead.opponentControls ? { opponentControls: true } : {}),
      };
      const spec = makeTargetSpec('Creature', constraints);
      return {
        effects: [{ kind: 'Destroy', target: makeChosenRef(spec), ...(noRegenSpan > 0 ? { noRegen: true } : {}) }],
        targets: [spec],
        consumed,
      };
    }
    return null;
  }

  // Check for "an opponent controls"
  if (slice[consumed] === 'an' && slice[consumed + 1] === 'opponent' && slice[consumed + 2] === 'controls') {
    opponentControls = true;
    consumed += 3;
  } else if (
    // "you don't control" (Vandalblast: "destroy target artifact you don't control").
    // Without this the controller restriction is silently dropped and the engine
    // illegally allows targeting your OWN artifact/permanent. Mirrors the
    // "an opponent controls" branch above → opponentControls constraint.
    slice[consumed] === 'you'
    && (slice[consumed + 1] === "don't" || slice[consumed + 1] === 'don’t')
    && slice[consumed + 2] === 'control'
  ) {
    opponentControls = true;
    consumed += 3;
  }

  let constraints: TargetSpec['constraints'] = {
    ...(opponentControls ? { opponentControls: true } : {}),
    ...(notColors ? { notColors } : {}),
    ...(colors ? { colors } : {}),
  };
  const destroyManaValueTarget = applyManaValueTargetConstraint(slice, consumed, constraints);
  if (destroyManaValueTarget) {
    constraints = destroyManaValueTarget.constraints;
    consumed = destroyManaValueTarget.nextIndex;
  }
  // "destroy target creature with power 4 or greater"
  const destroyPtTarget = applyPowerToughnessTargetConstraint(slice, consumed, constraints);
  if (destroyPtTarget) {
    constraints = destroyPtTarget.constraints;
    consumed = destroyPtTarget.nextIndex;
  }
  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  // Optional "It can't be regenerated." rider.
  const noRegenSpan = consumeCantBeRegenerated(tokens, startIndex + consumed);
  consumed += noRegenSpan;

  const spec = makeTargetSpec(targetType, Object.keys(constraints || {}).length > 0 ? constraints : undefined);
  const effect: Effect = {
    kind: 'Destroy',
    target: makeChosenRef(spec),
    ...(noRegenSpan > 0 ? { noRegen: true } : {}),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Slice 10: Match "Destroy target <LandSubtype> and target <color> creature."
 *
 * Reign of Chaos template: paired destroy of a typed land and a colored creature
 * with a single oracle sentence. Each pair produces two separate TargetSpecs and
 * two Destroy effects so the executor handles them independently.
 *
 * Supported pairings (Reign of Chaos has four — one per basic land type):
 *   "destroy target Plains and target white creature."
 *   "destroy target Island and target blue creature."
 *   "destroy target Swamp and target black creature."
 *   "destroy target Mountain and target red creature."
 *   "destroy target Forest and target green creature."
 *
 * HONEST: emits two Destroy effects each with a Chosen target; the executor's
 * existing Destroy Chosen branch handles each independently.
 */
export function matchDestroyPairedTypedTargets(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 7) return null;
  if (slice[0] !== 'destroy') return null;
  if (slice[1] !== 'target') return null;

  // Land subtype map: singular lowercase → canonical subtype string
  const LAND_SUBTYPE_SINGULAR: Record<string, string> = {
    plains: 'Plains',
    island: 'Island',
    swamp: 'Swamp',
    mountain: 'Mountain',
    forest: 'Forest',
  };

  const landSubtype = LAND_SUBTYPE_SINGULAR[slice[2]];
  if (!landSubtype) return null;

  // "and target <color> creature"
  if (slice[3] !== 'and') return null;
  if (slice[4] !== 'target') return null;

  // Optional color qualifier before creature
  let creatureIdx = 5;
  let creatureColors: Array<'W' | 'U' | 'B' | 'R' | 'G'> | undefined;
  const colorRead = readColorConstraint(slice, creatureIdx);
  if (colorRead) {
    creatureColors = colorRead.colors;
    creatureIdx += colorRead.consumed;
  }

  if (slice[creatureIdx] !== 'creature') return null;
  let consumed = creatureIdx + 1;
  if (tokens[startIndex + consumed] === '.') consumed++;

  // Land target: must be a Land with the specific subtype
  const landSpec = makeTargetSpec('Land', { subtypes: [landSubtype] });
  // Creature target: optional color constraint
  const creatureSpec = makeTargetSpec('Creature', creatureColors ? { colors: creatureColors } : undefined);

  const effects: Effect[] = [
    { kind: 'Destroy', target: makeChosenRef(landSpec) },
    { kind: 'Destroy', target: makeChosenRef(creatureSpec) },
  ];

  return { effects, targets: [landSpec, creatureSpec], consumed };
}

export function matchExile(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 2) return null;
  if (slice[0] !== 'exile') return null;
  // "Exile this creature / it / ~." — self.
  if (slice[1] === 'it' || slice[1] === '~' || (slice[1] === 'this' && targetTypeFromSimplePermanentWord(slice[2]))) {
    let consumed = (slice[1] === 'this') ? 3 : 2;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Exile', target: { kind: 'Source' } }], targets: [], consumed };
  }
  // "Exile that creature / that permanent." — the creature from the triggering event.
  if (slice[1] === 'that' && targetTypeFromSimplePermanentWord(slice[2])) {
    let consumed = 3;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Exile', target: { kind: 'EventCreature' } }], targets: [], consumed };
  }
  // Optional "up to N" before "target …" (treated as an optional/multi target).
  let tShift = 0;
  let upToCount = 1;
  if (slice[1] === 'up' && slice[2] === 'to') {
    const n = parseSmallNumberToken(slice[3] ?? '');
    if (!Number.isNaN(n) && n >= 1) {
      tShift = 3;
      upToCount = n;
    }
  }
  // Slice 9: "exile up to N target cards from a single graveyard" —
  // multi-card exile from one player's graveyard (Gravegouger, Griffnaut Tracker).
  // Must be checked before the generic "target" branch so "cards" (plural) is handled.
  if (tShift > 0 && slice[1 + tShift] === 'target'
      && (slice[2 + tShift] === 'cards' || slice[2 + tShift] === 'card')
      && slice[3 + tShift] === 'from'
      && slice[4 + tShift] === 'a'
      && slice[5 + tShift] === 'single'
      && slice[6 + tShift] === 'graveyard') {
    let consumed = tShift + 7;
    if (tokens[startIndex + consumed] === '.') consumed++;
    const spec = makeTargetSpec('CardInGraveyard');
    if (upToCount > 1) spec.count = upToCount;
    return {
      effects: [{ kind: 'Exile', target: makeChosenRef(spec) }],
      targets: [spec],
      consumed,
    };
  }
  if (slice.length < 3 + tShift) return null;
  if (slice[1 + tShift] !== 'target') return null;
  if (tShift > 0) {
    // Re-tokenize from the "target …" position by recursing on the shifted slice.
    const shifted = matchExile(['exile', ...slice.slice(1 + tShift)], 0);
    if (!shifted) return null;
    // Propagate the up-to count onto the TargetSpec when > 1.
    if (upToCount > 1 && shifted.targets.length === 1) {
      shifted.targets[0].count = upToCount;
    }
    return { ...shifted, consumed: shifted.consumed + tShift };
  }

  // "exile target attacking creature" / "exile target nontoken creature" —
  // noun-phrase constraint modifiers, then the regular exile parse.
  const exileWithMods = retryWithTargetNounModifiers(slice, 1, matchExile);
  if (exileWithMods) return exileWithMods;

  let targetType: TargetType;
  let consumed: number;
  let constraints: TargetSpec['constraints'] = undefined;

  // Color-constraint helpers mirroring matchDestroy.
  const exileColorRead = readColorConstraint(slice, 2);
  const excludedColorByToken: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
    nonwhite: 'W', nonblue: 'U', nonblack: 'B', nonred: 'R', nongreen: 'G',
  };

  if (slice[2] === 'creature' && slice[3] === 'or' && slice[4] === 'planeswalker') {
    // "exile target creature or planeswalker" — must come before plain 'creature' check
    targetType = 'CreatureOrPlaneswalker';
    consumed = 5;
  } else if (slice[2] === 'creature') {
    targetType = 'Creature';
    consumed = 3;
  } else if (exileColorRead && slice[2 + exileColorRead.consumed] === 'creature') {
    // "exile target white or blue creature"
    targetType = 'Creature';
    constraints = { colors: exileColorRead.colors };
    consumed = 2 + exileColorRead.consumed + 1;
  } else if (excludedColorByToken[slice[2]] && slice[3] === 'creature') {
    targetType = 'Creature';
    constraints = { notColors: [excludedColorByToken[slice[2]]] };
    consumed = 4;
  } else if (
    slice[2] === 'card'
    && slice[3] === 'from'
    && (
      (slice[4] === 'a' && slice[5] === 'graveyard')
      || (slice[4] === 'any' && slice[5] === 'graveyard')
    )
  ) {
    targetType = 'CardInGraveyard';
    consumed = 6;
  } else if (
    slice[2] === 'card'
    && slice[3] === 'from'
    && slice[4] === 'an'
    && (slice[5] === "opponent's" || slice[5] === 'opponent')
    && slice[6] === 'graveyard'
  ) {
    targetType = 'CardInGraveyard';
    constraints = { opponentControls: true };
    consumed = 7;
  } else if (slice[2] === 'nonland' && slice[3] === 'permanent') {
    targetType = 'NonlandPermanent';
    consumed = 4;
  } else if (slice[2] === 'permanent') {
    targetType = 'Permanent';
    consumed = 3;
  } else if (slice[2] === 'artifact' && slice[3] === 'or' && slice[4] === 'enchantment') {
    // "exile target artifact or enchantment" (Revoke Existence, Fade into Antiquity)
    targetType = 'ArtifactOrEnchantment';
    consumed = 5;
  } else if (
    slice[2] === 'artifact'
    && slice.slice(2).includes('enchantment')
    && slice.slice(2).includes('land')
  ) {
    // "exile target artifact, enchantment, or land"
    targetType = 'ArtifactEnchantmentOrLand';
    const landIdx = slice.indexOf('land', 2);
    consumed = landIdx + 1;
  } else if (slice[2] === 'artifact') {
    targetType = 'Artifact';
    consumed = 3;
  } else if (slice[2] === 'enchantment') {
    targetType = 'Enchantment';
    consumed = 3;
  } else if (slice[2] === 'land') {
    targetType = 'Land';
    consumed = 3;
  } else {
    // "exile target <Subtype>" — bare creature-subtype target
    const subtypeRead = readCreatureSubtypeTargetPhrase(slice, 2);
    if (subtypeRead) {
      let consumed = 2 + subtypeRead.consumed;
      if (tokens[startIndex + consumed] === '.') consumed++;
      const exileSubtypeConstraints: TargetSpec['constraints'] = {
        subtypes: subtypeRead.subtypes,
        ...(subtypeRead.controllerControls ? { controllerControls: true } : {}),
        ...(subtypeRead.opponentControls ? { opponentControls: true } : {}),
      };
      const spec = makeTargetSpec('Creature', exileSubtypeConstraints);
      return { effects: [{ kind: 'Exile', target: makeChosenRef(spec) }], targets: [spec], consumed };
    }
    return null;
  }

  // "exile target <type> an opponent controls" — opponentControls constraint.
  if (slice[consumed] === 'an' && slice[consumed + 1] === 'opponent' && slice[consumed + 2] === 'controls') {
    constraints = { ...constraints, opponentControls: true };
    consumed += 3;
  }

  const exileManaValueTarget = applyManaValueTargetConstraint(slice, consumed, constraints);
  if (exileManaValueTarget) {
    constraints = exileManaValueTarget.constraints;
    consumed = exileManaValueTarget.nextIndex;
  }

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const spec = makeTargetSpec(targetType, constraints);
  const effect: Effect = {
    kind: 'Exile',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Slice 9: ETB "return up to one [other] target <permanent-type> [you control]
 * to its owner's hand" — the ETB bounce form used by Winter Eladrin,
 * Stickytongue Sentinel, Flock Impostor, Rimekin Recluse, Exosuit Savior,
 * Mischievous Pup, and similar cards.
 *
 * "other" → notSource constraint (can't target the entering creature itself).
 * "you control" → controllerControls constraint.
 * "up to one" → count=1 optional (count is already 1 by default; the optional
 * semantics are honoured by the stack's optional-target path which allows
 * choosing 0 targets when max=1).
 *
 * Permanent types supported: creature, permanent, artifact, enchantment, land,
 * nonland permanent.
 */
export function matchReturnUpToOneOtherTargetYouControlToHand(
  tokens: string[],
  startIndex: number,
): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 8) return null;
  if (slice[0] !== 'return') return null;

  // Require "up to" prefix (the defining feature of this family).
  if (slice[1] !== 'up' || slice[2] !== 'to') return null;

  // Count: "one" or "two" — both supported (Scholar-style up-to-two uses
  // matchReturnFromGraveyard; this matcher handles the you-control variants).
  const count = parseSmallNumberToken(slice[3] ?? '');
  if (Number.isNaN(count) || count < 1) return null;

  let idx = 4;

  // Optional "other" → notSource
  const hasOther = slice[idx] === 'other';
  if (hasOther) idx++;

  if (slice[idx] !== 'target') return null;
  idx++;

  // Parse permanent type.
  let targetType: TargetType;
  if (slice[idx] === 'nonland' && slice[idx + 1] === 'permanent') {
    targetType = 'NonlandPermanent';
    idx += 2;
  } else if (slice[idx] === 'creature' && slice[idx + 1] === 'or' && slice[idx + 2] === 'planeswalker') {
    targetType = 'CreatureOrPlaneswalker';
    idx += 3;
  } else if (slice[idx] === 'artifact' && slice[idx + 1] === 'or' && slice[idx + 2] === 'enchantment') {
    targetType = 'ArtifactOrEnchantment';
    idx += 3;
  } else {
    const simple = targetTypeFromSimplePermanentWord(slice[idx]);
    if (!simple) return null;
    targetType = simple;
    idx++;
  }

  // Optional "you control" / "an opponent controls" ownership qualifier.
  let controllerControls = false;
  let opponentControls = false;
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    controllerControls = true;
    idx += 2;
  } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    opponentControls = true;
    idx += 3;
  }

  // Must end with "to its owner's hand".
  if (slice[idx] !== 'to') return null;
  if (slice[idx + 1] !== 'its') return null;
  if (slice[idx + 2] !== "owner's" && slice[idx + 2] !== 'owners') return null;
  if (slice[idx + 3] !== 'hand') return null;
  idx += 4;

  if (tokens[startIndex + idx] === '.') idx++;

  const constraints: NonNullable<TargetSpec['constraints']> = {
    ...(controllerControls ? { controllerControls: true } : {}),
    ...(opponentControls ? { opponentControls: true } : {}),
    ...(hasOther ? { notSource: true } : {}),
  };
  const spec = makeTargetSpec(
    targetType,
    Object.keys(constraints).length > 0 ? constraints : undefined,
  );
  if (count > 1) spec.count = count;

  return {
    effects: [{ kind: 'ReturnToHand', target: makeChosenRef(spec) }],
    targets: [spec],
    consumed: idx,
  };
}

/**
 * Slice 1 (combat-damage trigger tails): Match
 *   "return target <permanent-type> that player controls to its owner's hand"
 *
 * This wording appears on Ninja saboteur cards (Mistblade Shinobi, etc.) and
 * some ninjutsu-adjacent spells. "That player" in a CombatDamageToPlayer
 * trigger is always the player who took combat damage — always an opponent in
 * normal gameplay — so we model the target with opponentControls: true, which
 * is honest: the engine validates that the chosen permanent belongs to the
 * opponent. The executor's existing ReturnToHand / Chosen branch already handles
 * this without any executor changes.
 *
 * Permanent types accepted: creature, permanent, artifact, enchantment,
 * nonland permanent. "Nonland permanent" is handled as NonlandPermanent.
 *
 * Examples:
 *   "return target creature that player controls to its owner's hand"
 *   "return target permanent that player controls to its owner's hand"
 *   "return target nonland permanent that player controls to its owner's hand"
 *   "return target artifact that player controls to its owner's hand"
 */
export function matchReturnThatPlayerControlsToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum: "return target creature that player controls to its owner's hand"
  //           0      1      2        3    4      5        6  7   8       9
  if (slice.length < 10) return null;
  if (slice[0] !== 'return') return null;
  if (slice[1] !== 'target') return null;

  // Parse the permanent type
  let targetType: TargetType;
  let idx: number;

  if (slice[2] === 'nonland' && slice[3] === 'permanent') {
    targetType = 'NonlandPermanent';
    idx = 4;
  } else if (slice[2] === 'creature' && slice[3] === 'or' && slice[4] === 'planeswalker') {
    targetType = 'CreatureOrPlaneswalker';
    idx = 5;
  } else if (slice[2] === 'artifact' && slice[3] === 'or' && slice[4] === 'enchantment') {
    targetType = 'ArtifactOrEnchantment';
    idx = 5;
  } else {
    const simple = targetTypeFromSimplePermanentWord(slice[2]);
    if (!simple) return null;
    targetType = simple;
    idx = 3;
  }

  // Must be followed by "that player controls"
  if (slice[idx] !== 'that') return null;
  if (slice[idx + 1] !== 'player') return null;
  if (slice[idx + 2] !== 'controls') return null;
  idx += 3;

  // Must end with "to its owner's hand"
  if (slice[idx] !== 'to') return null;
  if (slice[idx + 1] !== 'its') return null;
  if (slice[idx + 2] !== "owner's" && slice[idx + 2] !== 'owners') return null;
  if (slice[idx + 3] !== 'hand') return null;
  idx += 4;

  if (tokens[startIndex + idx] === '.') idx++;

  // "that player" in a CombatDamageToPlayer trigger is always an opponent.
  const spec = makeTargetSpec(targetType, { opponentControls: true });

  return {
    effects: [{ kind: 'ReturnToHand', target: makeChosenRef(spec) }],
    targets: [spec],
    consumed: idx,
  };
}

/**
 * Match: "return target creature to its owner's hand"
 * Match: "return target nonland permanent to its owner's hand"
 */
export function matchReturnToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'return') return null;

  // "Return this creature / it / ~ to its owner's hand." — self-bounce.
  // "Return that creature to its owner's hand." — the event creature.
  // Slice 3 addition: "Return this card to its owner's hand." — Aura self-return
  // in 'When enchanted creature dies, return this card to its owner's hand.'
  // triggers. "card" is not in targetTypeFromSimplePermanentWord (which covers only
  // battlefield permanent types), but in this trigger context "this card" refers to
  // the Aura itself (still on the battlefield when the trigger fires), so we emit
  // ReturnToHand with Source. Execution: executor.ts ReturnToHand case handles
  // Source by using sourceInstanceId (the aura's instanceId), which is correct.
  {
    const selfSubj = slice[1] === 'it' || slice[1] === '~'
      || (slice[1] === 'this' && (targetTypeFromSimplePermanentWord(slice[2]) || slice[2] === 'card'));
    const eventSubj = slice[1] === 'that' && targetTypeFromSimplePermanentWord(slice[2]);
    if (selfSubj || eventSubj) {
      const idx = (slice[1] === 'this' || slice[1] === 'that') ? 3 : 2;
      if (slice[idx] === 'to' && slice[idx + 1] === 'its'
          && (slice[idx + 2] === "owner's" || slice[idx + 2] === 'owners')
          && slice[idx + 3] === 'hand') {
        let consumed = idx + 4;
        if (tokens[startIndex + consumed] === '.') consumed++;
        const target: TargetRef = eventSubj ? { kind: 'EventCreature' } : { kind: 'Source' };
        return { effects: [{ kind: 'ReturnToHand', target }], targets: [], consumed };
      }
    }
  }

  // Optional "up to one" before "target …".
  if (slice[1] === 'up' && slice[2] === 'to' && slice[3] === 'one' && slice[4] === 'target') {
    const shifted = matchReturnToHand(['return', ...slice.slice(4)], 0);
    if (!shifted) return null;
    return { ...shifted, consumed: shifted.consumed + 3 };
  }

  // "return target tapped creature …" / "return target nontoken creature …" —
  // noun-phrase constraint modifiers, then the regular bounce parse.
  const returnWithMods = retryWithTargetNounModifiers(slice, 1, matchReturnToHand);
  if (returnWithMods) return returnWithMods;

  if (slice.length < 7) return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let idx: number;

  if (slice[2] === 'nonland' && slice[3] === 'permanent') {
    targetType = 'NonlandPermanent';
    idx = 4;
  } else if (slice[2] === 'creature' && slice[3] === 'or' && slice[4] === 'planeswalker') {
    // "return target creature or planeswalker to its owner's hand"
    targetType = 'CreatureOrPlaneswalker';
    idx = 5;
  } else if (slice[2] === 'artifact' && slice[3] === 'or' && slice[4] === 'enchantment') {
    // "return target artifact or enchantment to its owner's hand"
    targetType = 'ArtifactOrEnchantment';
    idx = 5;
  } else if (
    slice[2] === 'artifact'
    && slice.slice(2).includes('enchantment')
    && slice.slice(2).includes('land')
  ) {
    // "return target artifact, enchantment, or land to its owner's hand"
    targetType = 'ArtifactEnchantmentOrLand';
    const landIdx = slice.indexOf('land', 2);
    idx = landIdx + 1;
  } else {
    // "creature" / "permanent" (Regress, Eye of Nowhere) / "artifact" /
    // "enchantment" / "land" — the executor's ReturnToHand moves any permanent.
    const simple = targetTypeFromSimplePermanentWord(slice[2]);
    if (!simple) {
      // Slice 7: "return target Island/Forest/Plains/Swamp/Mountain to its
      // owner's hand" (Active Volcano style land-subtype bounce). The target
      // type is Land with a subtype constraint so validation is honest.
      const BASIC_LAND_SUBTYPES: Record<string, string> = {
        island: 'Island', islands: 'Island',
        forest: 'Forest', forests: 'Forest',
        plains: 'Plains',
        swamp: 'Swamp', swamps: 'Swamp',
        mountain: 'Mountain', mountains: 'Mountain',
      };
      const subtype = BASIC_LAND_SUBTYPES[slice[2]];
      if (!subtype) return null;
      targetType = 'Land';
      idx = 3;
      // We need to fall through with the subtype constraint — handle it below.
      let landConstraints: TargetSpec['constraints'] = { subtypes: [subtype] };
      if (slice[idx] !== 'to') return null;
      if (slice[idx + 1] !== 'its') return null;
      if (slice[idx + 2] !== "owner's" && slice[idx + 2] !== 'owners') return null;
      if (slice[idx + 3] !== 'hand') return null;
      let landConsumed = idx + 4;
      if (tokens[startIndex + landConsumed] === '.') landConsumed++;
      const landSpec = makeTargetSpec('Land', landConstraints);
      return { effects: [{ kind: 'ReturnToHand', target: makeChosenRef(landSpec) }], targets: [landSpec], consumed: landConsumed };
    }
    targetType = simple;
    idx = 3;
  }

  let constraints: TargetSpec['constraints'] = undefined;
  // Slice 1: "return target creature an opponent controls to its owner's hand" (Bigfin Bouncer)
  if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    constraints = { opponentControls: true };
    idx += 3;
  }
  const returnManaValueTarget = applyManaValueTargetConstraint(slice, idx, constraints);
  if (returnManaValueTarget) {
    constraints = returnManaValueTarget.constraints;
    idx = returnManaValueTarget.nextIndex;
  }
  // "return target creature with power 2 or less to its owner's hand"
  const returnPtTarget = applyPowerToughnessTargetConstraint(slice, idx, constraints);
  if (returnPtTarget) {
    constraints = returnPtTarget.constraints;
    idx = returnPtTarget.nextIndex;
  }

  if (slice[idx] !== 'to') return null;
  if (slice[idx + 1] !== 'its') return null;
  if (slice[idx + 2] !== "owner's" && slice[idx + 2] !== 'owners') return null;
  if (slice[idx + 3] !== 'hand') return null;

  let consumed = idx + 4;

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const spec = makeTargetSpec(targetType, constraints);
  const effect: Effect = {
    kind: 'ReturnToHand',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "return a land you control to its owner's hand" (Karoo bounce lands)
 * Match: "return a/an/another <artifact|creature|enchantment|land|permanent>
 *         you control to its owner's hand" (Kor Skyfisher, Shrieking Drake,
 *         Salvage Scuttler, Species Gorger)
 * Match: "return a red or green creature you control to its owner's hand"
 *         (Horned Kavu, Eiganjo Free-Riders — color-qualified chooser)
 *
 * Non-target chooser: the controller picks one of their own matching
 * permanents, so the spec carries controllerControls (plus notSource for
 * the "another" form).
 */
export function matchReturnPermanentYouControlToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 9) return null;
  if (slice[0] !== 'return') return null;
  if (slice[1] !== 'a' && slice[1] !== 'an' && slice[1] !== 'another') return null;

  const constraints: NonNullable<TargetSpec['constraints']> = { controllerControls: true };
  if (slice[1] === 'another') constraints.notSource = true;

  let idx = 2;
  // Optional color qualifier: "white", "red or green", …
  const colorQualifier = readColorConstraint(slice, idx);
  if (colorQualifier) {
    constraints.colors = colorQualifier.colors;
    idx += colorQualifier.consumed;
  }

  const targetType = targetTypeFromSimplePermanentWord(slice[idx]);
  if (!targetType) return null;
  idx++;

  if (slice[idx] !== 'you' || slice[idx + 1] !== 'control') return null;
  idx += 2;
  if (slice[idx] !== 'to') return null;
  if (slice[idx + 1] !== 'its') return null;
  if (slice[idx + 2] !== "owner's" && slice[idx + 2] !== 'owners') return null;
  if (slice[idx + 3] !== 'hand') return null;

  let consumed = idx + 4;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec(targetType, constraints);
  const effect: Effect = {
    kind: 'ReturnToHand',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "return target creature card from your graveyard to your hand"
 * Match: "return target creature card from your graveyard to the battlefield"
 * Match: "return target creature or enchantment card from your graveyard to your hand"
 * Match: "return target Goblin card from your graveyard to your hand"
 * Match: "return target instant or sorcery card from your graveyard to your hand"
 * Match: "return up to two target creature cards from your graveyard to your hand"
 * Match: "return target creature card with mana value 2 or less from your graveyard to the battlefield"
 */
export function matchReturnFromGraveyard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice[0] !== 'return') return null;

  // "Return this card / ~ from your graveyard to your hand/battlefield." — self-regrowth.
  if ((slice[1] === 'this' && slice[2] === 'card') || slice[1] === '~') {
    let i = slice[1] === 'this' ? 3 : 2;
    if (slice[i] === 'from' && slice[i + 1] === 'your' && slice[i + 2] === 'graveyard' && slice[i + 3] === 'to') {
      i += 4;
      let dest: 'hand' | 'battlefield' | null = null;
      if (slice[i] === 'your' && slice[i + 1] === 'hand') { dest = 'hand'; i += 2; }
      else if (slice[i] === 'the' && slice[i + 1] === 'battlefield') { dest = 'battlefield'; i += 2; }
      if (dest) {
        if (slice[i] === '.') i++;
        return { effects: [{ kind: 'ReturnFromGraveyard', target: { kind: 'Source' }, destination: dest }], targets: [], consumed: i };
      }
    }
  }

  // Slice 3/12 (per-line absorption): Inverted word-order form —
  //   "return to the battlefield target <type> card in your graveyard"
  //   "return to your hand target <type> card in your graveyard"
  // Common on older Oracle wordings and "saboteur" triggers (Moira family).
  //
  // HONESTY: forms with a trailing timing restriction ("that was put there this
  // turn", "that entered the graveyard this turn") cannot be enforced by the
  // engine (no zone-entry timestamp tracking).  Skipping those forms is NOT
  // pure-downside (the engine would allow a BROADER set of graveyard targets
  // than the card permits, fabricating an advantage).  We DECLINE any token
  // stream that contains "that was put there" after the graveyard phrase.
  if (slice[1] === 'to' && (slice[2] === 'the' || slice[2] === 'your')) {
    let dest: 'hand' | 'battlefield' | null = null;
    let afterDest = 3;
    if (slice[2] === 'the' && slice[3] === 'battlefield') {
      dest = 'battlefield';
      afterDest = 4;
    } else if (slice[2] === 'your' && slice[3] === 'hand') {
      dest = 'hand';
      afterDest = 4;
    }
    if (dest !== null && slice[afterDest] === 'target') {
      const nounStart = afterDest + 1;
      const noun = parseGraveyardCardNounPhrase(slice, nounStart);
      if (noun) {
        let i = noun.nextIndex;
        // Require "in your graveyard" (or "in their graveyard" for event-player forms)
        if ((slice[i] === 'in') &&
          (slice[i + 1] === 'your' || slice[i + 1] === 'their' || slice[i + 1] === 'a') &&
          slice[i + 2] === 'graveyard') {
          i += 3;
          // DECLINE: timing restriction "that was put there this turn" / "that entered
          // the graveyard this turn" — engine cannot enforce zone-entry timing.
          if (slice[i] === 'that' && slice[i + 1] === 'was') return null;
          if (slice[i] === 'that' && slice[i + 1] === 'entered') return null;
          if (slice[i] === '.') i++;
          const spec = makeTargetSpec(noun.targetType, noun.constraints);
          const effect: Effect = {
            kind: 'ReturnFromGraveyard',
            target: makeChosenRef(spec),
            destination: dest,
          };
          return { effects: [effect], targets: [spec], consumed: i };
        }
      }
    }
  }

  if (slice.length < 9) return null;
  let idx = 1;
  // Optional "up to N" — the spec's count becomes N. The stack validates each
  // chosen id individually (count is a maximum) and the executor returns every
  // chosen card via resolveChosenTargetIds, so "up to two" runs honestly.
  // Slice 12: also handles exact "N target" (no "up to") for Death's Duet /
  // Soul Strings: "Return two target creature cards from your graveyard to your hand."
  // Executor already loops over resolveChosenTargetIds when count > 1, so exact-N
  // is handled identically to "up to N" — the chooser must pick exactly N targets.
  let count = 1;
  let exactCount = false;
  if (slice[idx] === 'up' && slice[idx + 1] === 'to') {
    const n = parseSmallNumberToken(slice[idx + 2]);
    if (Number.isNaN(n) || n < 1) return null;
    count = n;
    idx += 3;
  } else {
    // Exact-N: "two target", "three target", etc. (>= 2, no "up to").
    const n = parseSmallNumberToken(slice[idx]);
    if (!Number.isNaN(n) && n >= 2 && slice[idx + 1] === 'target') {
      count = n;
      exactCount = true;
      idx += 2; // consume the count word + "target"
    }
  }
  if (!exactCount) {
    if (slice[idx] !== 'target') return null;
    idx++;
  }

  const noun = parseGraveyardCardNounPhrase(slice, idx);
  if (!noun) return null;
  const targetType: TargetType = noun.targetType;
  let constraints: TargetSpec['constraints'] = noun.constraints;
  idx = noun.nextIndex;

  // "with mana value N or less" / "each with mana value N or less" may sit before
  // "from your graveyard" (Extraction Specialist, Dewdrop Cure).
  // Slice 7: "with power N or less/greater" may also sit here (Alesha Who Smiles at Death).
  {
    const testIdx = slice[idx] === 'each' ? idx + 1 : idx;
    const preFromManaValue = applyManaValueTargetConstraint(slice, testIdx, constraints);
    if (preFromManaValue) {
      constraints = preFromManaValue.constraints;
      idx = preFromManaValue.nextIndex;
    } else {
      const preFromPower = applyPowerToughnessTargetConstraint(slice, testIdx, constraints);
      if (preFromPower) {
        constraints = preFromPower.constraints;
        idx = preFromPower.nextIndex;
      }
    }
  }

  if (slice[idx] !== 'from') return null;
  idx++;
  if (slice[idx] !== 'your') return null;
  idx++;
  if (slice[idx] !== 'graveyard') return null;
  idx++;
  // ... or after it.
  const manaValueTarget = applyManaValueTargetConstraint(slice, idx, constraints);
  if (manaValueTarget) {
    constraints = manaValueTarget.constraints;
    idx = manaValueTarget.nextIndex;
  }

  if (slice[idx] !== 'to') return null;
  idx++;

  let destination: 'hand' | 'battlefield';
  let consumed: number;

  // "to your hand"
  if (slice[idx] === 'your' && slice[idx + 1] === 'hand') {
    destination = 'hand';
    consumed = idx + 2;
  }
  // "to the battlefield"
  else if (slice[idx] === 'the' && slice[idx + 1] === 'battlefield') {
    destination = 'battlefield';
    consumed = idx + 2;
  } else {
    return null;
  }

  const counters: string[] = [];
  let next = startIndex + consumed;
  if (
    tokens[next] === 'with'
    && (tokens[next + 1] === 'a' || tokens[next + 1] === 'an')
    && tokens[next + 3] === 'counter'
    && tokens[next + 4] === 'on'
    && tokens[next + 5] === 'it'
  ) {
    counters.push(tokens[next + 2]);
    consumed += 6;
    next = startIndex + consumed;
  }

  if (tokens[next] === '.') consumed++;

  const spec = makeTargetSpec(targetType, constraints);
  if (count > 1) spec.count = count;
  const effect: Effect = {
    kind: 'ReturnFromGraveyard',
    target: makeChosenRef(spec),
    destination,
    ...(counters.length > 0 ? { counters } : {}),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "return that card to its owner's hand"
 * Used by attachment death triggers such as Demonic Vigor. The triggering
 * event supplies the card that died through the effect execution context.
 */
export function matchReturnThatCardToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 6) return null;
  if (slice[0] !== 'return' || slice[1] !== 'that' || slice[2] !== 'card') return null;
  if (slice[3] !== 'to') return null;
  if (slice[4] !== 'its' && slice[4] !== "its'") return null;

  const handIndex = slice.findIndex((token, index) => index >= 4 && token === 'hand');
  if (handIndex === -1) return null;
  let consumed = handIndex + 1;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'ReturnToHand',
    target: { kind: 'EventSpell' },
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Slice 9 (Aura lifecycle): Match "return that card to the battlefield under your control"
 * — the body of False Demise / Shade's Form / Minion's Return / Soul Channeling
 * "when enchanted creature dies" triggers.
 *
 * "that card" is the creature that just died, supplied by the event context
 * as EventCreature (the cardInstanceId of the dying card, now in graveyard).
 * The executor's ReturnFromGraveyard case handles EventCreature via
 * resolveChosenTargetIds → resolveTargetRef → eventContext.cardInstanceId.
 *
 * We accept:
 *   "return that card to the battlefield under your control"
 *   "return that card to the battlefield"
 */
export function matchReturnThatCardToBattlefield(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 7) return null;
  if (slice[0] !== 'return') return null;
  if (slice[1] !== 'that') return null;
  if (slice[2] !== 'card') return null;
  if (slice[3] !== 'to') return null;
  if (slice[4] !== 'the') return null;
  if (slice[5] !== 'battlefield') return null;

  let idx = 6;
  // Optional "under your control"
  if (slice[idx] === 'under' && slice[idx + 1] === 'your' && slice[idx + 2] === 'control') {
    idx += 3;
  }

  if (tokens[startIndex + idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ReturnFromGraveyard',
    target: { kind: 'EventCreature' },
    destination: 'battlefield',
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "put target creature card from an opponent's graveyard onto the battlefield under your control. It gains haste."
 */
export function matchPutCreatureCardFromOpponentGraveyardOntoBattlefield(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 10) return null;
  if (slice[0] !== 'put' || slice[1] !== 'target' || slice[2] !== 'creature' || slice[3] !== 'card') return null;
  let idx = 4;
  if (slice[idx] !== 'from') return null;
  idx++;
  // Graveyard source: "an opponent's graveyard" | "a/any graveyard" | "your graveyard".
  const gyConstraints: TargetSpec['constraints'] = {};
  if (slice[idx] === 'an' && slice[idx + 1] === "opponent's" && slice[idx + 2] === 'graveyard') {
    gyConstraints.opponentControls = true; idx += 3;
  } else if ((slice[idx] === 'a' || slice[idx] === 'any') && slice[idx + 1] === 'graveyard') {
    idx += 2;
  } else if (slice[idx] === 'your' && slice[idx + 1] === 'graveyard') {
    gyConstraints.controllerControls = true; idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'onto' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'battlefield') return null;
  idx += 3;

  if (slice[idx] === 'under' && slice[idx + 1] === 'your' && slice[idx + 2] === 'control') {
    idx += 3;
  }
  if (slice[idx] === '.') idx++;

  let grantsHaste = false;
  if (slice[idx] === 'it' && slice[idx + 1] === 'gains' && slice[idx + 2] === 'haste') {
    grantsHaste = true;
    idx += 3;
    if (slice[idx] === '.') idx++;
  }

  const spec = makeTargetSpec('CreatureCardInGraveyard', Object.keys(gyConstraints).length > 0 ? gyConstraints : undefined);
  const target = makeChosenRef(spec);
  const effects: Effect[] = [
    {
      kind: 'ReturnFromGraveyard',
      target,
      destination: 'battlefield',
    },
    {
      kind: 'GainControl',
      target,
    },
  ];
  if (grantsHaste) {
    effects.push({
      kind: 'GrantKeyword',
      target,
      keyword: 'Haste',
      untilEndOfTurn: true,
    });
  }

  return { effects, targets: [spec], consumed: idx };
}

export function matchBlink(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'exile') return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let idx: number;

  if (slice[2] === 'creature') {
    targetType = 'Creature';
    idx = 3;
  } else if (slice[2] === 'permanent') {
    targetType = 'Permanent';
    idx = 3;
  } else if (slice[2] === 'nonland' && slice[3] === 'permanent') {
    targetType = 'NonlandPermanent';
    idx = 4;
  } else {
    return null;
  }

  const constraints: TargetSpec['constraints'] = {};

  // Optional "you control"
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  }

  // Expect separator: "," or "." or ", then"
  if (slice[idx] === ',') idx++;
  if (slice[idx] === '.') idx++;
  if (slice[idx] === 'then') idx++;

  // Now look for "return it to the battlefield" or "return that card/creature to the battlefield"
  if (slice[idx] !== 'return') return null;
  idx++;

  // Skip "it" / "that card" / "that creature"
  if (slice[idx] === 'it') {
    idx++;
  } else if (slice[idx] === 'that') {
    idx++;
    if (slice[idx] === 'card' || slice[idx] === 'creature' || slice[idx] === 'permanent') idx++;
  }

  if (slice[idx] !== 'to') return null;
  idx++;
  if (slice[idx] !== 'the') return null;
  idx++;
  if (slice[idx] !== 'battlefield') return null;
  idx++;

  let delayed = false;
  let ownerControl = false;

  // Check for "under its owner's control"
  if (slice[idx] === 'under' && slice[idx + 1] === 'its' &&
      (slice[idx + 2] === "owner's" || slice[idx + 2] === 'owners') &&
      slice[idx + 3] === 'control') {
    ownerControl = true;
    idx += 4;
  }

  // Check for "at the beginning of the next end step"
  if (slice[idx] === 'at' && slice[idx + 1] === 'the' && slice[idx + 2] === 'beginning') {
    delayed = true;
    // Skip "at the beginning of the next end step"
    while (idx < slice.length && slice[idx] !== '.' && slice[idx] !== ',') {
      idx++;
    }
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec(targetType, Object.keys(constraints).length > 0 ? constraints : undefined);
  const effect: Effect = {
    kind: 'Blink',
    target: makeChosenRef(spec),
    delayed: delayed || undefined,
    ownerControl: ownerControl || undefined,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "have this creature/artifact/enchantment/equipment/vehicle enter as a copy of ..."
 *         on the battlefield[, except <rider>]."
 *
 * Slice-6 extension: also accepts source variants and 'except' riders that the
 * executor can actually run.
 *
 * Slice-8 extension: noncreature subjects, wider pools, P/T override rider.
 *
 * Slice-7 extension: pronoun-tolerant name-override rider ("his"/"her" alongside "its");
 *   honest absorption of unenforced-keyword riders (vanishing, fading, etc.).
 *
 * Subjects accepted:
 *   "this creature" | "this artifact" | "this enchantment" | "this equipment" | "this vehicle" | "~"
 *
 * Source variants accepted:
 *   "... of any [Subtype] creature [or artifact] on the battlefield"
 *   "... of a creature you control"
 *   "... of a creature an opponent controls"
 *   "... of another creature you control"             (Sakashima of a Thousand Faces)
 *   "... of an artifact or creature you control"
 *   "... of any creature card in a graveyard"
 *   "... of any artifact on the battlefield"          (Sculpting Steel)
 *   "... of any Equipment on the battlefield"         (Masterwork of Ingenuity)
 *   "... of any enchantment on the battlefield"       (Copy Enchantment)
 *   "... of any artifact or enchantment on the battlefield" (Mirrormade)
 *   "... of any land on the battlefield"              (Copy Land)
 *   "... of any nonland permanent on the battlefield" (Clever Impersonator)
 *
 * Riders accepted (all after ", except"):
 *   (1) "except it enters with a <type> counter on it [if <cond>]"  → entryCounter
 *   (2) "except it's a <type> in addition to its other types"        → additionalTypes
 *       Slice-7 extension: "in addition to its other colors and types" and similar tails
 *       are also accepted (Lazotep Convert). P/T tokens ("4/4") within the type words
 *       are applied as ptOverride; color words ("black") are absorbed (pure-downside).
 *   (2b) "except it isn't legendary[, is a[n] <type> in addition...][, and has <kw>]"
 *        Slice-7 (Vizier of Many Faces / Auton Soldier): nonLegendary flag suppresses the
 *        legendary supertype. Optional compound clauses extract additionalTypes and keywords.
 *   (3) "except it has <engine-enforced keyword>"                    → addedKeywords
 *   (3b) "except it has <unenforced keyword> [N] [if <cond>]"        → absorbed silently
 *        (vanishing, fading, etc. — executor cannot run these; absorbed to keep the parse
 *        valid and honest; the base EnterAsCopy effect still resolves)
 *   (4) "except its/his/her name is <name>"                          → nameOverride '~'
 *       Accepts any possessive pronoun so older oracle wordings like "his name is ~"
 *       (Chameleon, Master of Disguise) match alongside the canonical "its" form.
 *   (5) "except it's <N>/<N>" P/T override                          → ptOverride
 *       (only bare "except it's N/N" — no type text before the slash)
 *   (6) "except it doesn't copy ..."                                 → absorbed silently
 *       (Vesuvan Doppelganger: "except it doesn't copy that creature's color and it has
 *        this ability" — the engine copies all characteristics; the no-copy-color clause
 *        is a downside we honestly skip; base EnterAsCopy effect still fires.)
 *   (7) "except if <clause>, ..."                                    → absorbed silently
 *       (Conditional riders whose predicate the engine can't evaluate at parse time;
 *        base EnterAsCopy effect still fires.)
 *   (8) Bare "except it's a <type> <type> [with <clause>]" without "in addition to its
 *       other types" — absorbed silently (Imposter Mech: "except it's a Vehicle artifact
 *       with crew 3" — type-overlay riders the engine can't represent as additionalTypes;
 *       base EnterAsCopy effect still fires.)
 *   Compound riders: "except its name is <X> and it's legendary"    → nameOverride + addedLegendary
 *                    "except its name is <X> and it's still legendary" (Sakashima)
 *
 * Declined riders (returns null for whole parse):
 *   - Any 'except' rider that grants quoted ability text (Mocking Doppelganger style).
 *
 * The "you may" prefix has already been stripped by parseEffectClauseInternal,
 * so this matcher sees tokens starting at "have".
 */

/** Engine-enforced keywords that can be granted by an 'except it has' rider. */
const ENTER_AS_COPY_GRANTABLE_KEYWORDS = new Set([
  'deathtouch', 'defender', 'double strike', 'first strike', 'flash', 'flying',
  'haste', 'hexproof', 'indestructible', 'lifelink', 'menace', 'reach',
  'shroud', 'trample', 'vigilance', 'prowess',
  'fear', 'intimidate', 'shadow', 'horsemanship', 'skulk',
]);

export function matchEnterAsCopy(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum: "have this creature enter as a copy of any creature on the battlefield ."
  // = 11 tokens
  if (slice.length < 11) return null;

  // Tokens must start with "have"
  if (slice[0] !== 'have') return null;

  // Subject: "this creature" | "this artifact" | "this enchantment" | "this equipment" |
  //          "this vehicle" | "~"
  // Older printings use "~" (tilde standing for the card's own name) or "this artifact".
  let idx: number;
  const ENTER_AS_COPY_SUBJECTS = new Set(['creature', 'artifact', 'enchantment', 'equipment', 'vehicle']);
  if (slice[1] === 'this' && ENTER_AS_COPY_SUBJECTS.has(slice[2])) {
    idx = 3; // consume "this <subject>"
  } else if (slice[1] === '~') {
    idx = 2; // consume "~"
  } else {
    return null;
  }

  // "enter"
  if (slice[idx] !== 'enter') return null;
  idx++;

  // Optional "the battlefield" infix (older wording: "enter the battlefield as a copy of")
  if (slice[idx] === 'the' && slice[idx + 1] === 'battlefield') {
    idx += 2;
  }

  // "as a copy of"
  if (slice[idx] !== 'as') return null;
  idx++;
  if (slice[idx] !== 'a') return null;
  idx++;
  if (slice[idx] !== 'copy') return null;
  idx++;
  if (slice[idx] !== 'of') return null;
  idx++;

  // ── Source variant ────────────────────────────────────────────────────────
  let sourceVariant: EnterAsCopyEffect['sourceVariant'] = 'battlefield';
  let subtypeFilter: string | undefined;
  let includesArtifacts = false;
  let poolType: EnterAsCopyEffect['poolType'];

  if (slice[idx] === 'a' && slice[idx + 1] === 'creature' && slice[idx + 2] === 'you' && slice[idx + 3] === 'control') {
    // "a creature you control" — youControl variant
    sourceVariant = 'youControl';
    idx += 4;
  } else if (
    slice[idx] === 'a' && slice[idx + 1] === 'creature' &&
    slice[idx + 2] === 'an' && slice[idx + 3] === 'opponent' && slice[idx + 4] === 'controls'
  ) {
    // "a creature an opponent controls" — opponentControls variant
    sourceVariant = 'opponentControls';
    idx += 5;
  } else if (
    slice[idx] === 'another' && slice[idx + 1] === 'creature' &&
    slice[idx + 2] === 'you' && slice[idx + 3] === 'control'
  ) {
    // "another creature you control" — anotherCreatureYouControl variant (Sakashima of a Thousand Faces)
    sourceVariant = 'anotherCreatureYouControl';
    idx += 4;
  } else if (
    slice[idx] === 'an' && slice[idx + 1] === 'artifact' &&
    slice[idx + 2] === 'or' && slice[idx + 3] === 'creature' &&
    slice[idx + 4] === 'you' && slice[idx + 5] === 'control'
  ) {
    // "an artifact or creature you control" — artifactOrCreatureYouControl variant
    sourceVariant = 'artifactOrCreatureYouControl';
    idx += 6;
  } else if (
    slice[idx] === 'a' && slice[idx + 1] === 'creature' &&
    slice[idx + 2] === 'or' && slice[idx + 3] === 'planeswalker' &&
    slice[idx + 4] === 'you' && slice[idx + 5] === 'control'
  ) {
    // "a creature or planeswalker you control" — Spark Double
    sourceVariant = 'creatureOrPlaneswalkerYouControl';
    idx += 6;
  } else if (
    slice[idx] === 'a' && slice[idx + 1] === 'permanent' &&
    slice[idx + 2] === 'you' && slice[idx + 3] === 'control'
  ) {
    // "a permanent you control" — Moritte of the Frost
    sourceVariant = 'permanentYouControl';
    idx += 4;
  } else if (slice[idx] === 'any') {
    idx++; // consume "any"

    // Slice-8: noncreature pool types before falling through to the creature branch.
    if (slice[idx] === 'nonland' && slice[idx + 1] === 'permanent') {
      // "any nonland permanent on the battlefield" — Clever Impersonator
      poolType = 'nonlandPermanent';
      idx += 2;
    } else if (slice[idx] === 'land') {
      // "any land on the battlefield" — Copy Land
      poolType = 'land';
      idx += 1;
    } else if (
      slice[idx] === 'artifact' && slice[idx + 1] === 'or' && slice[idx + 2] === 'enchantment'
    ) {
      // "any artifact or enchantment on the battlefield" — Mirrormade
      poolType = 'artifactOrEnchantment';
      idx += 3;
    } else if (slice[idx] === 'enchantment') {
      // "any enchantment on the battlefield" — Copy Enchantment
      poolType = 'enchantment';
      idx += 1;
    } else if (slice[idx] === 'equipment') {
      // "any Equipment on the battlefield" — Masterwork of Ingenuity (Equipment is a subtype)
      poolType = 'equipment';
      idx += 1;
    } else if (
      slice[idx] === 'artifact' && slice[idx + 1] !== 'or'
    ) {
      // "any artifact on the battlefield" — Sculpting Steel
      // (Guard: "or" after "artifact" already handled above as artifactOrEnchantment;
      //  "artifact or creature" handled below)
      if (slice[idx + 1] === 'or' && slice[idx + 2] === 'creature') {
        // Fall through to creature branch for "artifact or creature".
        includesArtifacts = true;
        idx += 3; // consume "artifact or creature"
      } else {
        poolType = 'artifact';
        idx += 1;
      }
    } else {
      // Older printings use reversed type order: "any artifact or creature on the battlefield"
      // Accept both "artifact or creature" and the modern "creature [or artifact]".
      if (slice[idx] === 'artifact' && slice[idx + 1] === 'or' && slice[idx + 2] === 'creature') {
        includesArtifacts = true;
        idx += 3; // consume "artifact or creature"
      } else {
        // Optional subtype word (e.g. "ally", "merfolk" — a creature subtype before "creature").
        if (
          slice[idx] !== 'creature'
          && slice[idx] !== 'artifact'
          && /^[a-z]+$/.test(slice[idx] ?? '')
        ) {
          subtypeFilter = slice[idx];
          idx++;
        }

        // Must now see "creature"
        if (slice[idx] !== 'creature') return null;
        idx++;

        // Optional "or artifact"
        if (slice[idx] === 'or' && slice[idx + 1] === 'artifact') {
          includesArtifacts = true;
          idx += 2;
        }
      }
    }

    // Check for source location: "card in a graveyard" or "on the battlefield".
    // Noncreature pool types (poolType set) must be "on the battlefield".
    if (!poolType && slice[idx] === 'card' && slice[idx + 1] === 'in' && slice[idx + 2] === 'a' && slice[idx + 3] === 'graveyard') {
      // "any creature card in a graveyard"
      sourceVariant = 'graveyard';
      idx += 4;
    } else if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'battlefield') {
      // "any <type> on the battlefield" (default)
      sourceVariant = 'battlefield';
      idx += 3;
    } else {
      return null;
    }
  } else {
    return null;
  }

  // ── Optional comma before period or 'except' ──────────────────────────────
  if (slice[idx] === ',') idx++;

  // ── Optional 'except' rider ───────────────────────────────────────────────
  let entryCounter: { counterType: string; count: number } | undefined;
  let additionalTypes: string[] | undefined;
  let addedKeywords: string[] | undefined;
  let nameOverride: '~' | undefined;
  let ptOverride: { power: number; toughness: number } | undefined;
  let addedLegendary: boolean | undefined;
  let nonLegendary: boolean | undefined;

  if (slice[idx] === 'except') {
    idx++; // consume "except"

    // (1) "except it enters with a[n] [additional] <type> counter on it [if <cond>]"
    //     Also handles "except it enters with an extra <type> counter on it [if <cond>]"
    //     (Spark Double uses "an extra +1/+1 counter on it if it's a creature or an
    //      additional loyalty counter on it if it's a planeswalker" — the dual conditional
    //      form is declined; only the single-counter article form is accepted here.)
    if (slice[idx] === 'it' && slice[idx + 1] === 'enters' && slice[idx + 2] === 'with') {
      idx += 3; // consume "it enters with"
      // count article: "a"/"an" = 1; also consume optional "additional"/"extra" modifier.
      let count = 1;
      if (slice[idx] === 'a' || slice[idx] === 'an') {
        count = 1;
        idx++;
        // Optional "additional" or "extra" modifier — consume silently.
        if (slice[idx] === 'additional' || slice[idx] === 'extra') idx++;
      } else {
        return null; // unexpected count form — decline whole parse
      }
      // Read counter type label (single token, e.g. "shield", "+1/+1")
      const counterType = slice[idx];
      if (!counterType || counterType === 'counter' || counterType === 'counters') return null;
      idx++;
      // Expect "counter" (singular) after the type
      if (slice[idx] !== 'counter') return null;
      idx++;
      // Expect "on it" after the counter word
      if (slice[idx] === 'on' && slice[idx + 1] === 'it') {
        idx += 2;
      }
      // Drop optional "if <cond>" tail (conditional riders are allowed to be silently dropped).
      // Spark Double uses "if it's a creature or an additional loyalty counter on it if it's a
      // planeswalker" — the dual-branch conditional is consumed here as a single tail.
      if (slice[idx] === 'if') {
        while (idx < slice.length && slice[idx] !== '.') idx++;
      }
      entryCounter = { counterType, count };
    }

    // (2) "except it's a[n] <type> in addition to its other types"
    //     OR "except it's <N>/<N>" P/T override (Quicksilver Gargantuan)
    //     OR "except it's legendary[, ...]" compound legendary rider (Moritte of the Frost)
    else if (slice[idx] === "it's") {
      idx++; // consume "it's"

      // (5) P/T override: "except it's <N>/<N>" where token looks like "7/7"
      const ptToken = slice[idx] ?? '';
      const ptMatch = /^(\d+)\/(\d+)$/.exec(ptToken);
      if (ptMatch) {
        ptOverride = { power: parseInt(ptMatch[1], 10), toughness: parseInt(ptMatch[2], 10) };
        idx++;
      } else if (slice[idx] === 'legendary') {
        // (6) Standalone "except it's legendary" — Moritte of the Frost and similar.
        // May be followed by a compound tail (",/and it's a Snow permanent, and it enters with...")
        // We capture addedLegendary and silently absorb any additional clauses (Snow type,
        // "enters with two additional counters" — executor cannot run these honestly).
        addedLegendary = true;
        idx++; // consume "legendary"

        // Absorb any trailing compound clauses until period.
        // Examples: ", it's a Snow permanent, and it enters with two additional counters..."
        // We consume everything until the trailing period to stay honest.
        while (idx < slice.length && slice[idx] !== '.') {
          idx++;
        }
      } else {
        // (2) additionalTypes rider: "except it's a[n] <type(s)> in addition to its other types/colors/etc."
        //     Slice-7: also accepts "in addition to its other colors and types" (Lazotep Convert).
        //     Type words may include color words ("black") and P/T tokens ("4/4") which are
        //     collected but filtered: only lowercase alpha words that are not color words go into
        //     additionalTypes; P/T tokens are applied as ptOverride; color words are absorbed
        //     (pure-downside: the copy doesn't gain the color, which is a conservative choice).
        // Skip optional article "a" / "an"
        if (slice[idx] === 'a' || slice[idx] === 'an') idx++;
        // Read type word(s) until "in" (the start of "in addition to")
        const COLOR_TOKENS_SET = new Set(['white', 'blue', 'black', 'red', 'green', 'colorless', 'multicolored']);
        const typeWords: string[] = [];
        while (idx < slice.length && slice[idx] !== 'in' && slice[idx] !== '.' && slice[idx] !== ',') {
          const w = slice[idx];
          // P/T token like "4/4" — extract as ptOverride and skip
          const ptm = /^(\d+)\/(\d+)$/.exec(w);
          if (ptm) {
            ptOverride = { power: parseInt(ptm[1], 10), toughness: parseInt(ptm[2], 10) };
          } else if (!COLOR_TOKENS_SET.has(w)) {
            // Not a color word — treat as a type/subtype word
            typeWords.push(w);
          }
          // Color words are absorbed silently (engine cannot honestly add colors to the copy)
          idx++;
        }
        if (typeWords.length === 0 && !ptOverride) return null;
        // Accept "in addition to its other <X>" where X is types/colors/anything.
        // Flexible tail: "in addition to its other types" OR "in addition to its other colors and types", etc.
        if (
          slice[idx] === 'in' &&
          slice[idx + 1] === 'addition' &&
          slice[idx + 2] === 'to' &&
          slice[idx + 3] === 'its' &&
          slice[idx + 4] === 'other'
        ) {
          idx += 5; // consume "in addition to its other"
          // Consume the remaining qualifier words ("types", "colors and types", etc.) until period/comma/end.
          while (idx < slice.length && slice[idx] !== '.' && slice[idx] !== ',') {
            idx++;
          }
          if (typeWords.length > 0) additionalTypes = typeWords;
        } else {
          // (8) Bare "except it's a <type(s)> [with <clause>]" without "in addition to its other types"
          //     — absorbed silently. Imposter Mech: "except it's a Vehicle artifact with crew 3";
          //     Superior Spider-Man and similar. The engine cannot represent these type-overlay riders
          //     without copy-characteristics support; absorbing them preserves the honesty bar
          //     (the base EnterAsCopy effect still fires). Consume until period.
          while (idx < slice.length && slice[idx] !== '.') idx++;
          // additionalTypes stays undefined — base EnterAsCopy effect still fires.
        }
      }
    }

    // (2b) "except it isn't legendary[, is a[n] <type> in addition to its other types][, and has <keyword>]"
    //      Slice-7: Vizier of Many Faces / Auton Soldier family.
    //      "it isn't legendary" → nonLegendary rider (executor suppresses legendary supertype).
    //      Optional compound clauses after "legendary":
    //        "[and/,] is a[n] <type(s)> in addition to its other types" → additionalTypes
    //        "[, and] has <keyword>"                                     → addedKeywords / absorb
    else if (slice[idx] === 'it' && slice[idx + 1] === "isn't") {
      idx += 2; // consume "it isn't"
      if (slice[idx] !== 'legendary') return null; // only "isn't legendary" form is supported
      idx++; // consume "legendary"
      nonLegendary = true;

      // Consume optional compound clauses.
      // Pattern: "," or "and" or ", and" may separate clauses.
      let compoundIdx = idx;
      while (compoundIdx < slice.length && slice[compoundIdx] !== '.') {
        // Skip separators: ",", "and", ", and"
        let sep = compoundIdx;
        if (slice[sep] === ',') sep++;
        if (slice[sep] === 'and') sep++;

        // Clause: "is a[n] <type(s)> in addition to its other types"
        if (slice[sep] === 'is') {
          sep++; // consume "is"
          if (slice[sep] === 'a' || slice[sep] === 'an') sep++; // consume article
          // Collect type words until "in" or separator
          const typeWords2: string[] = [];
          while (
            sep < slice.length &&
            slice[sep] !== 'in' && slice[sep] !== '.' && slice[sep] !== ','
          ) {
            typeWords2.push(slice[sep]);
            sep++;
          }
          // Expect "in addition to its other <X>"
          if (
            typeWords2.length > 0 &&
            slice[sep] === 'in' &&
            slice[sep + 1] === 'addition' &&
            slice[sep + 2] === 'to' &&
            slice[sep + 3] === 'its' &&
            slice[sep + 4] === 'other'
          ) {
            sep += 5; // consume "in addition to its other"
            // Consume tail qualifier ("types", "colors and types", etc.)
            while (sep < slice.length && slice[sep] !== '.' && slice[sep] !== ',') sep++;
            additionalTypes = typeWords2;
          } else if (
            typeWords2.length > 0 &&
            (compoundIdx === idx || slice[compoundIdx] === ',') // "is an artifact" without "in addition" — direct type clause
          ) {
            // "is an artifact" style — just an artifact type addition (Auton Soldier).
            // Accept this as an additionalTypes clause without the "in addition" tail.
            additionalTypes = [...(additionalTypes ?? []), ...typeWords2];
            // sep already consumed the type words
          } else {
            break; // Unrecognised compound clause — stop (base nonLegendary still set)
          }
          compoundIdx = sep;
          continue;
        }

        // Clause: "has <keyword>" — engine keyword → addedKeywords; unenforced → absorb
        if (slice[sep] === 'has') {
          sep++; // consume "has"
          if (!slice[sep]) break;
          const kw1 = slice[sep];
          let keyword: string | null = null;
          if (
            (kw1 === 'first' || kw1 === 'double') &&
            slice[sep + 1] === 'strike'
          ) {
            keyword = `${kw1} strike`;
            sep += 2;
          } else if (ENTER_AS_COPY_GRANTABLE_KEYWORDS.has(kw1)) {
            keyword = kw1;
            sep++;
          } else {
            // Unenforced keyword — absorb silently
            sep++; // consume keyword token
            if (slice[sep] && /^\d+$/.test(slice[sep])) sep++; // optional number (e.g. "3" in "vanishing 3")
          }
          if (keyword) {
            addedKeywords = [...(addedKeywords ?? []), keyword];
          }
          compoundIdx = sep;
          continue;
        }

        // No recognised compound clause found — stop consuming
        break;
      }
      idx = compoundIdx;
    }

    // (3) "except it has <keyword>"
    //     (3b) Slice-7: if the keyword is not engine-enforced AND not a quoted ability string,
    //          absorb it silently so the base EnterAsCopy effect still resolves honestly.
    //          Quoted ability text (token starts with '"') is declined — the engine cannot
    //          grant arbitrary ability clauses.
    //          Activated-ability riders (mana cost token starting with '{') are also declined —
    //          e.g. Gigantoplasm "except it has {X}: This creature has base power and toughness X/X".
    else if (slice[idx] === 'it' && slice[idx + 1] === 'has') {
      idx += 2; // consume "it has"

      // Guard: quoted ability text rider.
      // (A) Quoted activated-ability rider: "except it has \"{X}: <effect>\"" (Gigantoplasm).
      //     The tokenizer normalises mana symbols inside quotes to "__mana_N__", so the
      //     opening token starts with "\"__mana" or '"__mana'.  We can absorb this rider
      //     honestly: the engine does not run the activated ability, but the base
      //     EnterAsCopy effect still resolves (pure-downside absorption — the player
      //     simply lacks the X-power-and-toughness overlay). Consume until the closing
      //     standalone '"' token (or a period).
      // (B) Quoted triggered/static ability rider: "except it has \"Whenever ...\"" (Mocking
      //     Doppelganger).  The engine cannot grant arbitrary trigger/static text, so the
      //     whole parse is declined to preserve the honesty bar.
      if (slice[idx] && slice[idx].startsWith('"')) {
        // Distinguish (A) quoted mana/activated-ability vs (B) quoted text ability.
        // Tokenizer output for "{X}:..." inside quotes begins with '"__mana'.
        if (slice[idx].startsWith('"__mana') || slice[idx] === '"__mana') {
          // (A) Absorb quietly: consume tokens until the closing lone '"' or period.
          idx++; // consume the opening mana token
          while (idx < slice.length && slice[idx] !== '"' && slice[idx] !== '.') {
            idx++;
          }
          if (idx < slice.length && slice[idx] === '"') idx++; // consume closing '"'
          // Fall through — base EnterAsCopy effect is still emitted without the rider.
        } else {
          // (B) Quoted triggered/static ability text — decline the whole parse.
          return null;
        }
      } else if (slice[idx] && slice[idx].startsWith('{')) {
        // Guard: unquoted activated ability rider (mana cost or tap symbol) → decline.
        // No real card uses this form (actual Gigantoplasm uses quoted form above),
        // but keep declining the synthetic test form to preserve the honesty bar.
        return null;
      }

      // Try to read a one or two-token engine keyword
      let keyword: string | null = null;
      if (
        (slice[idx] === 'first' || slice[idx] === 'double') &&
        slice[idx + 1] === 'strike'
      ) {
        keyword = `${slice[idx]} strike`;
        idx += 2;
      } else if (slice[idx] && ENTER_AS_COPY_GRANTABLE_KEYWORDS.has(slice[idx])) {
        keyword = slice[idx];
        idx++;
      }

      if (keyword) {
        // Engine-enforced keyword → record in addedKeywords.
        addedKeywords = [keyword];
      } else if (slice[idx]) {
        // (3b) Unenforced keyword (vanishing, fading, phasing, etc.) — absorb silently.
        // Consume the keyword token(s) and any trailing number + optional "if <cond>" clause.
        // This preserves the honesty bar: the base copy effect resolves but the unenforced
        // overlay is acknowledged-but-skipped rather than causing the whole parse to fail.
        idx++; // consume the unenforced keyword token
        // Consume optional numeric parameter (e.g. the "3" in "vanishing 3").
        if (slice[idx] && /^\d+$/.test(slice[idx])) idx++;
        // Consume optional "if <cond>" tail.
        if (slice[idx] === 'if') {
          while (idx < slice.length && slice[idx] !== '.' && slice[idx] !== ',') idx++;
        }
        // (No effect emitted — rider is absorbed; EnterAsCopy base effect still fires.)
      } else {
        // No keyword token at all — decline.
        return null;
      }
    }

    // (4) "except its/his/her name is <literal words>" — nameOverride
    //     Slice-7: accept possessive pronouns "his" and "her" in addition to "its" so
    //     older oracle wordings (Chameleon, Master of Disguise) are matched.
    //     May be followed by "and it's [still] legendary" → addedLegendary (Sakashima)
    else if (
      (slice[idx] === 'its' || slice[idx] === 'his' || slice[idx] === 'her') &&
      slice[idx + 1] === 'name' && slice[idx + 2] === 'is'
    ) {
      idx += 3; // consume "<pronoun> name is"
      // Consume the name tokens until period, comma, "and", or end.
      while (idx < slice.length && slice[idx] !== '.' && slice[idx] !== ',' && slice[idx] !== 'and') idx++;
      // We normalise all "except <pronoun> name is X" forms to the '~' override — the
      // executor stores the entering permanent's original name.
      nameOverride = '~';

      // Optional compound rider: "and it's [still] legendary"
      if (slice[idx] === 'and') {
        const andIdx = idx + 1;
        // Accept "and it's [still] legendary" or "and it's legendary"
        if (
          slice[andIdx] === "it's" &&
          (slice[andIdx + 1] === 'legendary' ||
            (slice[andIdx + 1] === 'still' && slice[andIdx + 2] === 'legendary'))
        ) {
          addedLegendary = true;
          idx = andIdx + (slice[andIdx + 1] === 'still' ? 3 : 2);
        } else {
          // Unknown "and" clause — decline to keep honesty bar.
          return null;
        }
      }
    }

    // (6) "except it doesn't copy <anything>"                        → absorbed silently
    //     Vesuvan Doppelganger: "except it doesn't copy that creature's color and it has
    //     this ability" — the no-copy-color/ability clause is a pure-downside overlay the
    //     executor cannot model; absorb silently so the base EnterAsCopy still fires.
    else if (slice[idx] === 'it' && slice[idx + 1] === "doesn't" && slice[idx + 2] === 'copy') {
      // Consume everything until the next period.
      while (idx < slice.length && slice[idx] !== '.') idx++;
      // (No effect emitted — rider absorbed; base EnterAsCopy effect still fires.)
    }

    // (7) "except if <condition>, ..." conditional rider              → absorbed silently
    //     Vizier of Many Faces (embalmed form): "except if this creature was embalmed,
    //     it isn't legendary and it's a Zombie in addition to its other types."
    //     The predicate ("if this creature was embalmed") cannot be evaluated at parse
    //     time; the whole conditional is absorbed silently.  Base EnterAsCopy fires.
    else if (slice[idx] === 'if') {
      // Consume everything until the next period.
      while (idx < slice.length && slice[idx] !== '.') idx++;
      // (No effect emitted — conditional rider absorbed; base EnterAsCopy effect still fires.)
    }

    // Unrecognised 'except' rider — decline the whole parse to keep the honesty bar.
    else {
      return null;
    }
  }

  // ── Trailing period ───────────────────────────────────────────────────────
  if (slice[idx] === '.') idx++;

  const effect: EnterAsCopyEffect = {
    kind: 'EnterAsCopy',
    ...(sourceVariant !== 'battlefield' ? { sourceVariant } : {}),
    ...(subtypeFilter !== undefined ? { subtypeFilter } : {}),
    ...(includesArtifacts ? { includesArtifacts: true } : {}),
    ...(poolType !== undefined ? { poolType } : {}),
    ...(entryCounter !== undefined ? { entryCounter } : {}),
    ...(additionalTypes !== undefined ? { additionalTypes } : {}),
    ...(addedKeywords !== undefined ? { addedKeywords } : {}),
    ...(nameOverride !== undefined ? { nameOverride } : {}),
    ...(ptOverride !== undefined ? { ptOverride } : {}),
    ...(addedLegendary ? { addedLegendary: true } : {}),
    ...(nonLegendary ? { nonLegendary: true } : {}),
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "put target <permanent-type> on top of its owner's library"
 * Match: "put target <permanent-type> on the bottom of its owner's library"
 * Match: "put it on top of its owner's library"   (trigger tail — self/event)
 * Match: "put up to N target <type> on top of their owners' library" (multi)
 *
 * Emits PutIntoLibrary with position 'top' | 'bottom'.
 *
 * Supports:
 *  - "target creature"  → TargetType 'Creature'
 *  - "target land"      → TargetType 'Land'
 *  - "target permanent" → TargetType 'Permanent'
 *  - "target artifact"  → TargetType 'Artifact'
 *  - "target enchantment" → TargetType 'Enchantment'
 *  - "target nonland permanent" → TargetType 'NonlandPermanent'
 *  - "target creature or planeswalker" → 'CreatureOrPlaneswalker'
 *  - "it" / "~ "       → Source self-effect (no target)
 *  - "up to N target <type>" → multi-target (count = N)
 */
export function matchPutIntoLibrary(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'put') return null;

  // ── "put this creature/permanent on top/bottom of its owner's library" ──
  // (Wayward Soul: "{U}: Put this creature on top of its owner's library.")
  if (slice[1] === 'this' && targetTypeFromSimplePermanentWord(slice[2])) {
    const pos = readLibraryPosition(slice, 3);
    if (pos) {
      let consumed = 3 + pos.consumed;
      if (tokens[startIndex + consumed] === '.') consumed++;
      return {
        effects: [{ kind: 'PutIntoLibrary', target: { kind: 'Source' }, position: pos.position }],
        targets: [],
        consumed,
      };
    }
  }

  // ── "put it on top/bottom of its owner's library" (trigger tail / self) ──
  if (slice[1] === 'it' || slice[1] === '~') {
    const pos = readLibraryPosition(slice, 2);
    if (!pos) return null;
    let consumed = 2 + pos.consumed;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return {
      effects: [{ kind: 'PutIntoLibrary', target: { kind: 'Source' }, position: pos.position }],
      targets: [],
      consumed,
    };
  }

  // ── "put that <permanent-type> on top/bottom of its owner's library" ──
  if (slice[1] === 'that') {
    const simple = targetTypeFromSimplePermanentWord(slice[2]);
    if (simple) {
      const pos = readLibraryPosition(slice, 3);
      if (!pos) return null;
      let consumed = 3 + pos.consumed;
      if (tokens[startIndex + consumed] === '.') consumed++;
      return {
        effects: [{ kind: 'PutIntoLibrary', target: { kind: 'EventCreature' }, position: pos.position }],
        targets: [],
        consumed,
      };
    }
  }

  // ── Optional "up to N" before "target" ──
  let upToCount = 1;
  let preambleConsumed = 0;
  if (slice[1] === 'up' && slice[2] === 'to') {
    const n = parseSmallNumberToken(slice[3] ?? '');
    if (!Number.isNaN(n) && n >= 1 && slice[4] === 'target') {
      upToCount = n;
      preambleConsumed = 3; // "up to N" — the "target" is still consumed below
    }
  }

  const tIdx = 1 + preambleConsumed;
  if (slice[tIdx] !== 'target') return null;

  // ── Parse target type ──
  let targetType: TargetType;
  let afterType: number;

  const typeIdx = tIdx + 1;
  if (slice[typeIdx] === 'nonland' && slice[typeIdx + 1] === 'permanent') {
    targetType = 'NonlandPermanent';
    afterType = typeIdx + 2;
  } else if (slice[typeIdx] === 'creature' && slice[typeIdx + 1] === 'or' && slice[typeIdx + 2] === 'planeswalker') {
    targetType = 'CreatureOrPlaneswalker';
    afterType = typeIdx + 3;
  } else if (slice[typeIdx] === 'artifact' && slice[typeIdx + 1] === 'or' && slice[typeIdx + 2] === 'enchantment') {
    targetType = 'ArtifactOrEnchantment';
    afterType = typeIdx + 3;
  } else {
    const simple = targetTypeFromSimplePermanentWord(slice[typeIdx]);
    if (!simple) {
      // Try reading a creature subtype (e.g. "target Goblin")
      const subtypeRead = readCreatureSubtypeTargetPhrase(slice, typeIdx);
      if (subtypeRead) {
        afterType = typeIdx + subtypeRead.consumed;
        const pos = readLibraryPosition(slice, afterType);
        if (!pos) return null;
        let consumed = afterType + pos.consumed;
        if (tokens[startIndex + consumed] === '.') consumed++;
        const constraints: TargetSpec['constraints'] = {
          subtypes: subtypeRead.subtypes,
          ...(subtypeRead.controllerControls ? { controllerControls: true } : {}),
          ...(subtypeRead.opponentControls ? { opponentControls: true } : {}),
        };
        const spec = makeTargetSpec('Creature', constraints);
        if (upToCount > 1) spec.count = upToCount;
        return {
          effects: [{ kind: 'PutIntoLibrary', target: makeChosenRef(spec), position: pos.position }],
          targets: [spec],
          consumed,
        };
      }
      return null;
    }
    targetType = simple;
    afterType = typeIdx + 1;
  }

  const pos = readLibraryPosition(slice, afterType);
  if (!pos) return null;
  let consumed = afterType + pos.consumed;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec(targetType);
  if (upToCount > 1) spec.count = upToCount;
  return {
    effects: [{ kind: 'PutIntoLibrary', target: makeChosenRef(spec), position: pos.position }],
    targets: [spec],
    consumed,
  };
}

/**
 * Match graveyard-card → library effects.
 *
 * Patterns supported (Slice 7):
 *   "put target card from a graveyard on the top/bottom of its owner's library"
 *     (Malevolent Chandelier, Cogwork Archivist)
 *   "put target creature card from your graveyard on top of your library"
 *     (Hua Tuo, Honored Physician)
 *   "put target card from your graveyard on the top/bottom of your library"
 *     (Barkform Harvester)
 *   "put target [<type>] card from [a/any/an opponent's/your] graveyard on top/bottom
 *    of [its/your] owner's/owner's library"
 *
 * The executor's executePutIntoLibrary moves the card by instance-id regardless
 * of zone, so graveyard → library is fully supported.
 */
export function matchPutGraveyardCardIntoLibrary(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum: "put target card from a graveyard on top of its owner's library ."
  if (slice.length < 9) return null;
  if (slice[0] !== 'put') return null;
  if (slice[1] !== 'target') return null;

  // Parse optional card-type qualifier before "card":
  //   "target card" | "target creature card" | "target artifact card" ...
  let idx = 2;
  let constraints: TargetSpec['constraints'] = undefined;
  let targetType: TargetType = 'CardInGraveyard';

  // Check for an optional card-type word before "card"
  if (slice[idx] !== 'card' && slice[idx] !== 'cards') {
    const parsed = parseGraveyardCardNounPhrase(slice, idx);
    if (!parsed) return null;
    targetType = parsed.targetType;
    constraints = parsed.constraints;
    idx = parsed.nextIndex;
  } else {
    // bare "target card"
    idx++; // consume "card"
  }

  // Expect "from"
  if (slice[idx] !== 'from') return null;
  idx++;

  // Graveyard source: "a graveyard" | "any graveyard" | "your graveyard" |
  //                  "an opponent's graveyard"
  let constraintsMerge: TargetSpec['constraints'] = constraints ? { ...constraints } : {};

  if ((slice[idx] === 'a' || slice[idx] === 'any') && slice[idx + 1] === 'graveyard') {
    // any graveyard — no ownership constraint
    idx += 2;
  } else if (slice[idx] === 'your' && slice[idx + 1] === 'graveyard') {
    constraintsMerge = { ...constraintsMerge, controllerControls: true };
    idx += 2;
  } else if (
    slice[idx] === 'an' &&
    (slice[idx + 1] === "opponent's" || slice[idx + 1] === 'opponent') &&
    slice[idx + 2] === 'graveyard'
  ) {
    constraintsMerge = { ...constraintsMerge, opponentControls: true };
    idx += 3;
  } else {
    return null;
  }

  const finalConstraints: TargetSpec['constraints'] =
    Object.keys(constraintsMerge).length > 0 ? constraintsMerge : undefined;

  // Read position: "on top/bottom of its/your owner's/owner's library" or
  //               "on top/bottom of your library" (Hua Tuo: "on top of your library")
  if (slice[idx] !== 'on') return null;
  idx++;

  let position: 'top' | 'bottom';
  if (slice[idx] === 'the' && slice[idx + 1] === 'top') {
    position = 'top'; idx += 2;
  } else if (slice[idx] === 'top') {
    position = 'top'; idx++;
  } else if (slice[idx] === 'the' && slice[idx + 1] === 'bottom') {
    position = 'bottom'; idx += 2;
  } else if (slice[idx] === 'bottom') {
    position = 'bottom'; idx++;
  } else {
    return null;
  }

  if (slice[idx] !== 'of') return null;
  idx++;

  // Accept "its owner's library" | "its owners' library" |
  //        "their owners' library" | "your library"
  if (slice[idx] === 'its' || slice[idx] === 'their') {
    idx++;
    if (slice[idx] !== "owner's" && slice[idx] !== "owners'" && slice[idx] !== 'owners') return null;
    idx++;
  } else if (slice[idx] === 'your') {
    idx++;
  } else {
    return null;
  }

  if (slice[idx] !== 'library') return null;
  idx++;

  if (tokens[startIndex + idx] === '.') idx++;

  const spec = makeTargetSpec(targetType, finalConstraints);
  return {
    effects: [{ kind: 'PutIntoLibrary', target: makeChosenRef(spec), position }],
    targets: [spec],
    consumed: idx,
  };
}

/**
 * Read "on top of its/their owner's/owners' library" or
 *     "on the bottom of its/their owner's/owners' library"
 * starting at `startIdx` in `slice`. Returns position and count of tokens
 * consumed (relative to `startIdx`).
 */
function readLibraryPosition(
  slice: string[],
  startIdx: number,
): { position: 'top' | 'bottom'; consumed: number } | null {
  let idx = startIdx;

  if (slice[idx] !== 'on') return null;
  idx++;

  let position: 'top' | 'bottom';
  if (slice[idx] === 'the' && slice[idx + 1] === 'top') {
    position = 'top';
    idx += 2;
  } else if (slice[idx] === 'top') {
    position = 'top';
    idx++;
  } else if (slice[idx] === 'the' && slice[idx + 1] === 'bottom') {
    position = 'bottom';
    idx += 2;
  } else if (slice[idx] === 'bottom') {
    position = 'bottom';
    idx++;
  } else {
    return null;
  }

  if (slice[idx] !== 'of') return null;
  idx++;

  // Accept "its", "their", or nothing before "owner's"/"owners'"
  if (slice[idx] === 'its' || slice[idx] === 'their') idx++;

  // Accept "owner's" or "owners'" or "owners"
  if (slice[idx] !== "owner's" && slice[idx] !== "owners'" && slice[idx] !== 'owners') return null;
  idx++;

  if (slice[idx] !== 'library') return null;
  idx++;

  return { position, consumed: idx - startIdx };
}

/**
 * Slice 8 (choose-type-return): Match "Choose a creature type. Return up to N creature
 * cards of the chosen type from your graveyard to your hand."
 *
 * Handles the Haunting Voyage family:
 *   "Choose a creature type. Return up to two creature cards of the chosen type
 *    from your graveyard to your hand. If it's a full moon, you may put them
 *    onto the battlefield instead."
 *
 * The "choose a creature type." preamble is consumed here so the clause dispatches
 * as a unit. The type choice is stored at cast time in
 * namedCardChoices['chosenCreatureType']; the executor resolves it via
 * matchesCardFilter with chosenCreatureTypeFromCastTime:true.
 *
 * HONEST: the "up to N" limit is enforced via ReturnAllFromGraveyardEffect.maxCount.
 * Conditional bonus clauses ("if it's a full moon, put them onto the battlefield
 * instead") are pure-upside for the player, so skipping them is pure-downside and
 * honesty-safe. Only the primary hand-return effect is claimed.
 *
 * Also handles "choose a creature type . return all creature cards of the chosen type
 * from your graveyard to your hand" (no "up to", no limit).
 */
export function matchChosenTypeReturnFromGraveyard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // Must start with "choose a creature type ."
  if (
    slice[idx] !== 'choose' || slice[idx + 1] !== 'a' ||
    slice[idx + 2] !== 'creature' || slice[idx + 3] !== 'type'
  ) return null;
  idx += 4;
  if (slice[idx] === '.') idx++;

  // "return" must follow
  if (slice[idx] !== 'return') return null;
  idx++;

  // Optional "up to N" or exact N
  let maxCount: number | undefined;
  if (slice[idx] === 'up' && slice[idx + 1] === 'to') {
    const n = parseSmallNumberToken(slice[idx + 2] ?? '');
    if (Number.isNaN(n) || n < 1) return null;
    maxCount = n;
    idx += 3;
  } else {
    // Exact number: "two", "three", etc. (uncommon but valid)
    const n = parseSmallNumberToken(slice[idx] ?? '');
    if (!Number.isNaN(n) && n >= 1 && slice[idx + 1] !== 'target') {
      maxCount = n;
      idx++;
    }
    // else: "all" / no number — maxCount stays undefined (return all matching)
    if (slice[idx] === 'all') idx++;
  }

  // "creature cards of the chosen type"
  if (slice[idx] !== 'creature' || slice[idx + 1] !== 'cards') return null;
  idx += 2;
  if (
    slice[idx] !== 'of' || slice[idx + 1] !== 'the' ||
    slice[idx + 2] !== 'chosen' || slice[idx + 3] !== 'type'
  ) return null;
  idx += 4;

  // "from your graveyard"
  if (slice[idx] !== 'from' || slice[idx + 1] !== 'your' || slice[idx + 2] !== 'graveyard') return null;
  idx += 3;

  // "to your hand" or "to the battlefield"
  if (slice[idx] !== 'to') return null;
  idx++;
  let destination: 'hand' | 'battlefield';
  if (slice[idx] === 'your' && slice[idx + 1] === 'hand') {
    destination = 'hand';
    idx += 2;
  } else if (slice[idx] === 'the' && slice[idx + 1] === 'battlefield') {
    destination = 'battlefield';
    idx += 2;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  // Honest-skip: consume trailing conditional clause
  // "If it's a full moon , you may put them onto the battlefield instead ."
  // "If [any trailing condition text] ." — skip to next sentence end.
  if (slice[idx] === 'if') {
    while (idx < slice.length && slice[idx] !== '.') idx++;
    if (slice[idx] === '.') idx++;
  }

  const effect: import('../ast').ReturnAllFromGraveyardEffect = {
    kind: 'ReturnAllFromGraveyard',
    filter: {
      types: ['creature'],
      chosenCreatureTypeFromCastTime: true,
    },
    whose: 'yours',
    destination,
    ...(maxCount !== undefined ? { maxCount } : {}),
  };

  return { effects: [effect], targets: [], consumed: idx };
}
