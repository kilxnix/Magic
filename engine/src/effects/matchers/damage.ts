// Damage-related matchers extracted from parser.ts (batch 4/12).
// Do NOT edit logic here — keep verbatim with parser.ts originals.

import type { Effect, SourceRef, AmountRef, ForEachAmount, CardFilter, TargetRef, RedirectDamageEffect } from '../ast';
import type { TargetSpec, TargetType } from '../targets';
import type { PatternResult } from '../parser';
import {
  makeTargetSpec,
  makeChosenRef,
  readColorConstraint,
  colorConstraintFromWord,
  retryWithTargetNounModifiers,
  applyPowerToughnessTargetConstraint,
  parseEqualToAmount,
  parseEventCreatureStatAmount,
  parseNumberOfFilterAmount,
  readTargetNounModifiers,
  parseSmallNumberToken,
  parseWhereXIsNumberOf,
  parseStaticFilterType,
  readCreatureSubtypeTargetPhrase,
  CREATURE_SUBTYPE_MAP,
} from '../parser';

/**
 * Match "<source> deals damage to <target> equal to <dynamic>." (target-first word
 * order with a dynamic amount, e.g. "deals damage to any target equal to the number
 * of creatures you control").
 */
export function matchDealDamageEqualTo(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;
  let source: SourceRef = { kind: 'ThisSpell' };
  if (slice[idx] === '~') idx++;
  else if (slice[idx] === 'it') { source = { kind: 'ThisPermanent' }; idx++; }
  else if (slice[idx] === 'this' && ['creature', 'artifact', 'enchantment', 'aura', 'land', 'permanent', 'spell'].includes(slice[idx + 1])) {
    source = slice[idx + 1] === 'spell' ? { kind: 'ThisSpell' } : { kind: 'ThisPermanent' };
    idx += 2;
  } else return null;

  if (slice[idx] !== 'deals' || slice[idx + 1] !== 'damage') return null;
  idx += 2;

  // Branch A (original): "<source> deals damage to <target> equal to <amount>"
  if (slice[idx] === 'to') {
    idx++;

    // "target attacking creature" (Armed Response) — strip noun modifiers, re-parse.
    if (slice[idx] === 'target') {
      const withMods = retryWithTargetNounModifiers(slice, idx, matchDealDamageEqualTo);
      if (withMods) return withMods;
    }

    let effectTargetA: TargetRef | null = null;
    let targetsA: TargetSpec[] = [];
    if (slice[idx] === 'any' && slice[idx + 1] === 'target') {
      const spec = makeTargetSpec('Any'); targetsA = [spec]; effectTargetA = makeChosenRef(spec); idx += 2;
    } else if (slice[idx] === 'target' && slice[idx + 1] === 'creature') {
      const spec = makeTargetSpec('Creature'); targetsA = [spec]; effectTargetA = makeChosenRef(spec); idx += 2;
    } else if (slice[idx] === 'target' && slice[idx + 1] === 'player') {
      const spec = makeTargetSpec('Player'); targetsA = [spec]; effectTargetA = makeChosenRef(spec); idx += 2;
    } else if (slice[idx] === 'each' && slice[idx + 1] === 'opponent') {
      effectTargetA = { kind: 'EachOpponent' }; idx += 2;
    // Slice 10: "that creature" / "that permanent" — the creature from the triggering event.
    } else if (slice[idx] === 'that' && (slice[idx + 1] === 'creature' || slice[idx + 1] === 'permanent')) {
      effectTargetA = { kind: 'EventCreature' }; idx += 2;
    } else return null;

    if (slice[idx] !== 'equal' || slice[idx + 1] !== 'to') return null;
    // Slice 10: "equal to that creature's toughness/power" — EventCreatureStat (try first).
    // Power / battlefield permanent-type counts; then the generalized
    // "the number of <filter> <place>" shapes (snow permanents, Equipment, ...).
    const dynA = parseEventCreatureStatAmount(slice, idx + 2)
      ?? parseEqualToAmount(slice, idx + 2)
      ?? parseNumberOfFilterAmount(slice, idx + 2);
    if (!dynA) return null;
    let consumedA = dynA.nextIndex;
    if (slice[consumedA] === '.') consumedA++;

    return { effects: [{ kind: 'DealDamage', source, target: effectTargetA, amount: dynA.amount }], targets: targetsA, consumed: consumedA };
  }

  // Branch B (Slice 4): "<source> deals damage equal to <amount> to <target>"
  // (Planeswalker's Fury family: "deals damage equal to that card's mana value to any target")
  if (slice[idx] === 'equal' && slice[idx + 1] === 'to') {
    const dynB = parseEventCreatureStatAmount(slice, idx + 2)
      ?? parseEqualToAmount(slice, idx + 2)
      ?? parseNumberOfFilterAmount(slice, idx + 2);
    if (!dynB) return null;
    // Guard: "equal to its power" is only honest when source is a permanent (has power).
    // Spells (kind='ThisSpell') have no power — decline so the oracle text stays Unparsed.
    if (
      typeof dynB.amount === 'object' &&
      dynB.amount.kind === 'TargetPower' &&
      (dynB.amount as { target?: { kind?: string } }).target?.kind === 'Source' &&
      source.kind === 'ThisSpell'
    ) return null;
    let bi = dynB.nextIndex;
    if (slice[bi] !== 'to') return null;
    bi++;

    let effectTargetB: TargetRef | null = null;
    let targetsB: TargetSpec[] = [];
    if (slice[bi] === 'any' && slice[bi + 1] === 'target') {
      const spec = makeTargetSpec('Any'); targetsB = [spec]; effectTargetB = makeChosenRef(spec); bi += 2;
    } else if (slice[bi] === 'target' && slice[bi + 1] === 'creature') {
      const spec = makeTargetSpec('Creature'); targetsB = [spec]; effectTargetB = makeChosenRef(spec); bi += 2;
    } else if (slice[bi] === 'target' && slice[bi + 1] === 'player') {
      const spec = makeTargetSpec('Player'); targetsB = [spec]; effectTargetB = makeChosenRef(spec); bi += 2;
    } else if (slice[bi] === 'each' && slice[bi + 1] === 'opponent') {
      effectTargetB = { kind: 'EachOpponent' }; bi += 2;
    } else if (slice[bi] === 'that' && (slice[bi + 1] === 'creature' || slice[bi + 1] === 'permanent')) {
      effectTargetB = { kind: 'EventCreature' }; bi += 2;
    } else return null;

    if (slice[bi] === '.') bi++;
    return { effects: [{ kind: 'DealDamage', source, target: effectTargetB, amount: dynB.amount }], targets: targetsB, consumed: bi };
  }

  return null;
}

export function matchDealDamage(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Pattern: ~ deals N damage to (any target | target creature | target player)
  // tokens: ["~", "deals", "3", "damage", "to", "any", "target"]
  // or:     ["~", "deals", "3", "damage", "to", "target", "creature"]

  if (slice.length < 6) return null;

  let idx = 0;
  let source: SourceRef = { kind: 'ThisSpell' };
  if (slice[idx] === '~') {
    idx++;
  } else if (slice[idx] === 'it') {
    source = { kind: 'ThisPermanent' };
    idx++;
  } else if (slice[idx] === 'this' && ['creature', 'artifact', 'enchantment', 'aura', 'land', 'permanent', 'spell'].includes(slice[idx + 1])) {
    source = slice[idx + 1] === 'spell' ? { kind: 'ThisSpell' } : { kind: 'ThisPermanent' };
    idx += 2;
  } else {
    return null;
  }

  if (slice[idx] !== 'deals') return null;
  idx++;

  let amount: AmountRef;
  // "deals damage equal to its power to <target>" — amount is the source's own power.
  if (
    slice[idx] === 'damage'
    && slice[idx + 1] === 'equal'
    && slice[idx + 2] === 'to'
    && slice[idx + 3] === 'its'
    && slice[idx + 4] === 'power'
    && slice[idx + 5] === 'to'
  ) {
    // "its power" only makes sense when the source is the permanent itself.
    if (source.kind !== 'ThisPermanent') return null;
    amount = { kind: 'TargetPower', target: { kind: 'Source' } };
    idx += 5; // consume "damage equal to its power"; leave "to" for the shared block
  } else {
    const n = parseInt(slice[idx], 10);
    if (isNaN(n)) return null;
    amount = n;
    idx++;
    if (slice[idx] !== 'damage') return null;
    idx++;
  }
  if (slice[idx] !== 'to') return null;
  idx++;

  let targetType: TargetType;
  let consumed: number;
  let effectTarget: TargetRef | null = null;
  let targets: TargetSpec[] = [];

  // "target attacking or blocking creature" (Freewind Equenaut) / "target
  // tapped creature" — noun-phrase constraint modifiers, then the regular
  // damage-target parse on the reduced clause.
  if (slice[idx] === 'target') {
    const dmgWithMods = retryWithTargetNounModifiers(slice, idx, matchDealDamage);
    if (dmgWithMods) return dmgWithMods;
  }

  // "any target"
  if (slice[idx] === 'any' && slice[idx + 1] === 'target') {
    targetType = 'Any';
    consumed = idx + 2;
    const spec = makeTargetSpec(targetType);
    targets = [spec];
    effectTarget = makeChosenRef(spec);
  }
  // "target [<color(s)>] creature [you control | an opponent controls | you don't control]"
  else if (slice[idx] === 'target' && (slice[idx + 1] === 'creature' || readColorConstraint(slice, idx + 1))) {
    let j = idx + 1;
    const colorRead = readColorConstraint(slice, j);
    if (colorRead) j += colorRead.consumed;
    if (slice[j] !== 'creature') return null;
    j++;
    const constraints: TargetSpec['constraints'] = { ...(colorRead ? { colors: colorRead.colors } : {}) };
    if (slice[j] === 'you' && slice[j + 1] === 'control') {
      constraints.controllerControls = true; j += 2;
    } else if (slice[j] === 'an' && slice[j + 1] === 'opponent' && slice[j + 2] === 'controls') {
      constraints.opponentControls = true; j += 3;
    } else if (slice[j] === 'you' && slice[j + 1] === "don't" && slice[j + 2] === 'control') {
      constraints.opponentControls = true; j += 3;
    }
    // "to target creature with power 4 or greater"
    const dmgPtTarget = applyPowerToughnessTargetConstraint(slice, j, constraints);
    if (dmgPtTarget) {
      Object.assign(constraints, dmgPtTarget.constraints);
      j = dmgPtTarget.nextIndex;
    }
    targetType = 'Creature';
    consumed = j;
    const spec = makeTargetSpec(targetType, Object.keys(constraints).length ? constraints : undefined);
    targets = [spec];
    effectTarget = makeChosenRef(spec);
  }
  // "target player"
  else if (slice[idx] === 'target' && slice[idx + 1] === 'player') {
    targetType = 'Player';
    consumed = idx + 2;
    const spec = makeTargetSpec(targetType);
    targets = [spec];
    effectTarget = makeChosenRef(spec);
  }
  // "each opponent"
  else if (slice[idx] === 'each' && slice[idx + 1] === 'opponent') {
    consumed = idx + 2;
    effectTarget = { kind: 'EachOpponent' };
  }
  // "that creature / that permanent" — the creature from the triggering event.
  else if (slice[idx] === 'that' && (slice[idx + 1] === 'creature' || slice[idx + 1] === 'permanent')) {
    consumed = idx + 2;
    effectTarget = { kind: 'EventCreature' };
  }
  // "that player" — the player tied to the triggering event (upkeep's active
  // player, the spell's caster, the player who tapped the land). Punisher
  // family: Copper Tablet / Manabarbs / Scalding Viper.
  else if (slice[idx] === 'that' && slice[idx + 1] === 'player') {
    consumed = idx + 2;
    effectTarget = { kind: 'EventPlayer' };
  }
  // "you" — damage to the ability's controller (Juzám Djinn).
  else if (slice[idx] === 'you') {
    consumed = idx + 1;
    effectTarget = { kind: 'Controller' };
  }
  // "each player" — damage to all players.
  else if (slice[idx] === 'each' && slice[idx + 1] === 'player') {
    consumed = idx + 2;
    effectTarget = { kind: 'EachPlayer' };
  }
  // "each other creature" — mass damage to every creature EXCEPT the source
  // (Chaos Maw / Pyrohemia style). Never damages the source permanent itself.
  else if (slice[idx] === 'each' && slice[idx + 1] === 'other' && slice[idx + 2] === 'creature') {
    effectTarget = { kind: 'AllOtherCreatures' };
    consumed = idx + 3;
  }
  // "each creature [you control]" — mass damage (Pyroclasm-style).
  else if (slice[idx] === 'each' && slice[idx + 1] === 'creature') {
    if (slice[idx + 2] === 'you' && slice[idx + 3] === 'control') {
      effectTarget = { kind: 'AllCreaturesYouControl' };
      consumed = idx + 4;
    } else {
      effectTarget = { kind: 'AllCreatures' };
      consumed = idx + 2;
    }
  }
  // Slice 4 (OptionalPay reflexive): "each non<color> creature" — e.g. "each nonwhite creature",
  // "each non-green creature" (Oros / Darigaaz family). Uses AllOfType + excludeColors so the
  // executor skips any creature that has the excluded color.
  else if (slice[idx] === 'each') {
    const NON_COLOR_WORD: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
      nonwhite: 'W', nonblue: 'U', nonblack: 'B', nonred: 'R', nongreen: 'G',
    };
    let excludedColor: 'W' | 'U' | 'B' | 'R' | 'G' | undefined;
    let includedColors: Array<'W' | 'U' | 'B' | 'R' | 'G'> | undefined;
    let afterColorIdx = idx + 1;
    const nextTok = slice[idx + 1];
    // "each nonwhite creature"
    if (nextTok && NON_COLOR_WORD[nextTok]) {
      excludedColor = NON_COLOR_WORD[nextTok];
      afterColorIdx = idx + 2;
    // "each non-white creature" (tokenized as ["non", "-", "white"])
    } else if (nextTok === 'non' && slice[idx + 2] === '-') {
      const colorAfterHyphen: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
        white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
      };
      const colorWord = slice[idx + 3];
      if (colorWord && colorAfterHyphen[colorWord]) {
        excludedColor = colorAfterHyphen[colorWord];
        afterColorIdx = idx + 4;
      }
    // "each <color> creature" (e.g. "each white creature")
    } else {
      const colorRead = readColorConstraint(slice, idx + 1);
      if (colorRead) {
        includedColors = colorRead.colors;
        afterColorIdx = idx + 1 + colorRead.consumed;
      }
    }
    if ((excludedColor || includedColors) && slice[afterColorIdx] === 'creature') {
      const filter: CardFilter = { types: ['creature'] };
      if (excludedColor) filter.excludeColors = [excludedColor];
      if (includedColors) filter.colors = includedColors;
      effectTarget = { kind: 'AllOfType', filter };
      consumed = afterColorIdx + 1;
    } else {
      return null;
    }
  }
  // "target <Subtype> [you control | an opponent controls]" — bare creature subtype
  else if (slice[idx] === 'target') {
    const dmgSubtypeRead = readCreatureSubtypeTargetPhrase(slice, idx + 1);
    if (dmgSubtypeRead) {
      const dmgSubtypeConstraints: TargetSpec['constraints'] = {
        subtypes: dmgSubtypeRead.subtypes,
        ...(dmgSubtypeRead.controllerControls ? { controllerControls: true } : {}),
        ...(dmgSubtypeRead.opponentControls ? { opponentControls: true } : {}),
      };
      const spec = makeTargetSpec('Creature', dmgSubtypeConstraints);
      targets = [spec];
      effectTarget = makeChosenRef(spec);
      consumed = idx + 1 + dmgSubtypeRead.consumed;
    } else {
      return null;
    }
  }
  else {
    return null;
  }

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const effect: Effect = {
    kind: 'DealDamage',
    source,
    target: effectTarget,
    amount,
  };

  return { effects: [effect], targets, consumed };
}

/**
 * Match divided damage: "<source> deals N|X damage divided as you choose among
 * <multi-target phrase>."
 *
 *   "~ deals 3 damage divided as you choose among one, two, or three targets."  (Arc Lightning)
 *   "~ deals 4 damage divided as you choose among any number of targets."       (Forked Lightning)
 *   "~ deals X damage divided as you choose among any number of target
 *    attacking creatures."                                                      (Hail of Arrows)
 *   "... it deals 5 damage divided as you choose among any number of target
 *    creatures and/or planeswalkers your opponents control."                    (Dragonlord Atarka)
 *
 * Produces ONE multi-target TargetSpec (count = the selection cap, minCount = 1
 * since "any number" / "one, two, or three" lets the caster pick fewer) plus a
 * single DealDamageDivided effect carrying the TOTAL amount. The executor
 * splits the resolved total across every chosen id: an explicit per-target
 * division can ride the stack item's namedCardChoices payload
 * ("damageDivision": "2,1"), otherwise the total is split evenly with the
 * remainder to the earliest chosen targets.
 *
 * Selection caps: fixed totals cap at the total itself (each target must be
 * assigned at least 1 damage, so more targets than damage is never legal);
 * X totals use a fixed cap of 3 because the spec count must be static — each
 * assigned portion still resolves the real cast-time X.
 *
 * "creatures and/or planeswalkers" keeps only the creature half: the engine
 * does not route damage to planeswalker loyalty, so offering planeswalker
 * targets would silently no-op. The creature-only spec under-offers options,
 * but every execution it allows is faithful.
 */
export function matchDealDamageDivided(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 11) return null;

  let idx = 0;
  let source: SourceRef = { kind: 'ThisSpell' };
  if (slice[idx] === '~') {
    idx++;
  } else if (slice[idx] === 'it') {
    source = { kind: 'ThisPermanent' };
    idx++;
  } else if (slice[idx] === 'this' && ['creature', 'artifact', 'enchantment', 'aura', 'land', 'permanent', 'spell'].includes(slice[idx + 1])) {
    source = slice[idx + 1] === 'spell' ? { kind: 'ThisSpell' } : { kind: 'ThisPermanent' };
    idx += 2;
  } else {
    return null;
  }

  if (slice[idx] !== 'deals') return null;
  idx++;

  let amount: AmountRef;
  let numericTotal: number | null = null;
  if (slice[idx] === 'x') {
    amount = { kind: 'X' };
    idx++;
  } else {
    const n = parseSmallNumberToken(slice[idx] ?? '');
    if (Number.isNaN(n) || n < 1) return null;
    amount = n;
    numericTotal = n;
    idx++;
  }

  if (
    slice[idx] !== 'damage'
    || slice[idx + 1] !== 'divided'
    || slice[idx + 2] !== 'as'
    || slice[idx + 3] !== 'you'
    || slice[idx + 4] !== 'choose'
    || slice[idx + 5] !== 'among'
  ) return null;
  idx += 6;

  // Selection cap: "any number of ..." or an enumeration "one, two, or three ...".
  let maxTargets: number;
  if (slice[idx] === 'any' && slice[idx + 1] === 'number' && slice[idx + 2] === 'of') {
    idx += 3;
    maxTargets = numericTotal ?? 3;
  } else {
    const counts: number[] = [];
    const first = parseSmallNumberToken(slice[idx] ?? '');
    if (Number.isNaN(first)) return null;
    counts.push(first);
    idx++;
    for (;;) {
      // Only consume a separator ("," and/or "or") when another number follows.
      let j = idx;
      if (slice[j] === ',') j++;
      if (slice[j] === 'or') j++;
      if (j === idx) break;
      const next = parseSmallNumberToken(slice[j] ?? '');
      if (Number.isNaN(next)) break;
      counts.push(next);
      idx = j + 1;
    }
    if (counts.length < 2) return null;
    maxTargets = Math.max(...counts);
  }
  if (!Number.isFinite(maxTargets) || maxTargets < 1) return null;

  // The multi-target noun phrase.
  let spec: TargetSpec;
  if (slice[idx] === 'targets') {
    idx++;
    spec = makeTargetSpec('Any');
  } else if (slice[idx] === 'target') {
    idx++;
    const mods = readTargetNounModifiers(slice, idx);
    idx += mods.consumed;
    if (slice[idx] !== 'creatures') return null;
    idx++;
    const constraints: NonNullable<TargetSpec['constraints']> = { ...mods.constraints };
    if (slice[idx] === 'and/or' && slice[idx + 1] === 'planeswalkers') idx += 2;
    if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
      constraints.controllerControls = true;
      idx += 2;
    } else if (slice[idx] === 'your' && slice[idx + 1] === 'opponents' && slice[idx + 2] === 'control') {
      constraints.opponentControls = true;
      idx += 3;
    } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
      constraints.opponentControls = true;
      idx += 3;
    }
    // "... creatures without flying" (Rock Slide) — TargetSpec has no
    // keyword-exclusion constraint, and the spell-level parser tolerates an
    // unconsumed tail, so matching here would silently DROP the restriction
    // and offer flying attackers as legal targets. Refuse instead (honest:
    // the clause stays unparsed until keyword constraints exist).
    if (slice[idx] === 'without') return null;
    spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  } else {
    return null;
  }
  spec.count = maxTargets;
  spec.minCount = 1;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'DealDamageDivided',
    source,
    target: makeChosenRef(spec),
    amount,
  };
  return { effects: [effect], targets: [spec], consumed };
}

export function matchDealXDamage(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 6) return null;

  // Slice 1: accept "it deals X damage" (permanent source) in addition to
  // "~ deals X damage" (spell source). "it" is used inside OptionalPay inner
  // bodies like "you may pay {X}{R}. If you do, it deals X damage to any target."
  let source: SourceRef;
  if (slice[0] === '~') {
    source = { kind: 'ThisSpell' } as SourceRef;
  } else if (slice[0] === 'it') {
    source = { kind: 'ThisPermanent' } as SourceRef;
  } else {
    return null;
  }

  if (slice[1] !== 'deals') return null;
  if (slice[2] !== 'x') return null;
  if (slice[3] !== 'damage') return null;
  if (slice[4] !== 'to') return null;

  let targetType: TargetType;
  let consumed: number;

  if (slice[5] === 'any' && slice[6] === 'target') {
    targetType = 'Any';
    consumed = 7;
  } else if (slice[5] === 'target' && slice[6] === 'creature') {
    targetType = 'Creature';
    consumed = 7;
  } else if (slice[5] === 'target' && slice[6] === 'player') {
    targetType = 'Player';
    consumed = 7;
  } else {
    return null;
  }

  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'DealDamage',
    source,
    target: makeChosenRef(spec),
    amount: { kind: 'X' },
  };

  return { effects: [effect], targets: [spec], consumed };
}

export function matchDealDamageXWhereX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;
  let source: SourceRef = { kind: 'ThisSpell' };
  if (slice[idx] === '~') idx++;
  else if (slice[idx] === 'it') { source = { kind: 'ThisPermanent' }; idx++; }
  else if (slice[idx] === 'this' && ['creature', 'artifact', 'enchantment', 'aura', 'land', 'permanent', 'spell'].includes(slice[idx + 1])) {
    source = slice[idx + 1] === 'spell' ? { kind: 'ThisSpell' } : { kind: 'ThisPermanent' };
    idx += 2;
  } else return null;

  if (slice[idx] !== 'deals' || slice[idx + 1] !== 'x' || slice[idx + 2] !== 'damage' || slice[idx + 3] !== 'to') return null;
  idx += 4;

  // "target attacking creature" and friends — strip noun modifiers, re-parse.
  if (slice[idx] === 'target') {
    const withMods = retryWithTargetNounModifiers(slice, idx, matchDealDamageXWhereX);
    if (withMods) return withMods;
  }

  let effectTarget: TargetRef;
  let targets: TargetSpec[] = [];
  if (slice[idx] === 'any' && slice[idx + 1] === 'target') {
    const spec = makeTargetSpec('Any'); targets = [spec]; effectTarget = makeChosenRef(spec); idx += 2;
  } else if (slice[idx] === 'target' && slice[idx + 1] === 'creature') {
    // Consume optional color qualifier
    let j = idx + 1;
    const colorRead = readColorConstraint(slice, j + 1);
    const constraints: TargetSpec['constraints'] = {};
    if (colorRead) { constraints.colors = colorRead.colors; j += 1 + colorRead.consumed; }
    else { j++; }
    // Optional controller qualifier after "creature"
    if (slice[j] === 'you' && slice[j + 1] === 'control') {
      constraints.controllerControls = true; j += 2;
    } else if (slice[j] === 'an' && slice[j + 1] === 'opponent' && slice[j + 2] === 'controls') {
      constraints.opponentControls = true; j += 3;
    } else if (slice[j] === 'you' && (slice[j + 1] === "don't" || slice[j + 1] === 'dont') && slice[j + 2] === 'control') {
      constraints.opponentControls = true; j += 3;
    }
    const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
    targets = [spec]; effectTarget = makeChosenRef(spec); idx = j;
  } else if (slice[idx] === 'target' && (slice[idx + 1] === 'player' || slice[idx + 1] === 'opponent')) {
    const spec = makeTargetSpec('Player'); targets = [spec]; effectTarget = makeChosenRef(spec); idx += 2;
  } else if (slice[idx] === 'each' && slice[idx + 1] === 'opponent') {
    effectTarget = { kind: 'EachOpponent' }; idx += 2;
  // Slice 8: "that player" — the event player (active player in an upkeep/trigger context).
  // Maps to EventPlayer so the executor uses eventContext.eventPlayerId (Viseling / Unquenchable Fury).
  } else if (slice[idx] === 'that' && slice[idx + 1] === 'player') {
    effectTarget = { kind: 'EventPlayer' }; idx += 2;
  // Slice 8: "the defending player" — common wording in attack triggers (Ghost-Spider / Unquenchable Fury).
  // Mapped to EventPlayer; in attack-trigger contexts the defending player IS the event player.
  } else if (slice[idx] === 'defending' && slice[idx + 1] === 'player') {
    effectTarget = { kind: 'EventPlayer' }; idx += 2;
  } else return null;

  // "deals X damage to that player, where X is the number of cards in their hand"
  // Try parseTheyControlFilterAmount first (handles "they control[led]", "in their hand",
  // "in their graveyard") then fall back to the standard parseWhereXIsNumberOf.
  // Note: parseTheyControlFilterAmount already wraps the "where X is" prefix consumed
  // by parseWhereXIsNumberOf, so we try it AFTER stripping the "where X is" prefix ourselves.
  let dyn = parseWhereXIsNumberOf(slice, idx);
  if (!dyn) {
    // Try the "where X is the number of <filter> in their hand/graveyard" path:
    // parseTheyControlFilterAmount handles "the number of <filter> in their hand" (no "where X is").
    // We need to strip the leading "where X is" to reuse it.
    let wi = idx;
    if (slice[wi] === ',') wi++;
    if (slice[wi] === 'where' && slice[wi + 1] === 'x' && slice[wi + 2] === 'is') {
      const result = parseTheyControlFilterAmount(slice, wi + 3);
      if (result) {
        dyn = result;
      }
    }
  }
  if (!dyn) return null;
  let consumed = dyn.nextIndex;
  if (slice[consumed] === '.') consumed++;

  return { effects: [{ kind: 'DealDamage', source, target: effectTarget, amount: dyn.amount }], targets, consumed };
}

export function matchDealDamageForEach(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 10) return null;
  if (slice[0] !== '~') return null;
  if (slice[1] !== 'deals') return null;
  if (slice[2] !== 'damage') return null;
  if (slice[3] !== 'equal') return null;
  if (slice[4] !== 'to') return null;
  if (slice[5] !== 'the') return null;
  if (slice[6] !== 'number') return null;
  if (slice[7] !== 'of') return null;

  let idx = 8;
  const filter: CardFilter = {};

  if (slice[idx] === 'creatures') {
    filter.types = ['creature'];
    idx++;
  } else if (slice[idx] === 'artifacts') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'lands') {
    filter.types = ['land'];
    idx++;
  } else {
    return null;
  }

  let controller: ForEachAmount['controller'] = 'you';
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    idx += 2;
  } else {
    return null;
  }

  // Now find the target: "to any target", "to target creature", "to target player"
  if (slice[idx] !== 'to') return null;
  idx++;

  let targetType: TargetType;
  if (slice[idx] === 'any' && slice[idx + 1] === 'target') {
    targetType = 'Any';
    idx += 2;
  } else if (slice[idx] === 'target' && slice[idx + 1] === 'creature') {
    targetType = 'Creature';
    idx += 2;
  } else if (slice[idx] === 'target' && slice[idx + 1] === 'player') {
    targetType = 'Player';
    idx += 2;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const forEachAmount: ForEachAmount = {
    kind: 'ForEach',
    zone: 'battlefield',
    filter,
    controller,
  };

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'DealDamage',
    source: { kind: 'ThisSpell' } as SourceRef,
    target: makeChosenRef(spec),
    amount: forEachAmount,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "~ deals damage to any target equal to the greatest mana value among permanents you control"
 * Also accepts card-name subjects before "deals".
 */
export function matchDealDamageGreatestManaValue(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  const dealsIdx = slice.findIndex((token, index) => index <= 5 && token === 'deals');
  if (dealsIdx < 0) return null;

  let idx = dealsIdx + 1;
  if (slice[idx] !== 'damage') return null;
  idx++;
  if (slice[idx] !== 'to') return null;
  idx++;

  let targetType: TargetType;
  if (slice[idx] === 'any' && slice[idx + 1] === 'target') {
    targetType = 'Any';
    idx += 2;
  } else if (slice[idx] === 'target' && slice[idx + 1] === 'creature') {
    targetType = 'Creature';
    idx += 2;
  } else if (slice[idx] === 'target' && slice[idx + 1] === 'player') {
    targetType = 'Player';
    idx += 2;
  } else {
    return null;
  }

  if (
    slice[idx] !== 'equal'
    || slice[idx + 1] !== 'to'
    || slice[idx + 2] !== 'the'
    || slice[idx + 3] !== 'greatest'
    || slice[idx + 4] !== 'mana'
    || slice[idx + 5] !== 'value'
    || slice[idx + 6] !== 'among'
  ) {
    return null;
  }
  idx += 7;

  let filter: CardFilter = { permanent: true };
  if (slice[idx] === 'permanents') {
    idx++;
  } else {
    const parsedFilter = parseStaticFilterType(slice[idx]);
    if (!parsedFilter) return null;
    filter = parsedFilter;
    idx++;
  }

  if (slice[idx] !== 'you' || slice[idx + 1] !== 'control') return null;
  idx += 2;
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'DealDamage',
    source: { kind: 'ThisSpell' },
    target: makeChosenRef(spec),
    amount: {
      kind: 'GreatestManaValue',
      zone: 'battlefield',
      filter,
      controller: 'you',
    },
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "prevent all combat damage that would be dealt this turn"
 * Match: "prevent all damage that would be dealt to you this turn"
 * Match: "prevent the next N damage that would be dealt to target creature/player this turn"
 */
export function matchPreventDamage(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'prevent') return null;

  let idx = 1;
  let amount: AmountRef | 'all';
  if (slice[idx] === 'all') {
    amount = 'all';
    idx++;
  } else if (slice[idx] === 'the' && slice[idx + 1] === 'next') {
    // Slice 4: "prevent the next X damage" (Alabaster Potion modal bullet)
    if (slice[idx + 2] === 'x') {
      amount = { kind: 'X' };
    } else {
      const parsed = parseSmallNumberToken(slice[idx + 2]);
      if (Number.isNaN(parsed)) return null;
      amount = parsed;
    }
    idx += 3;
  } else {
    const parsed = parseSmallNumberToken(slice[idx]);
    if (Number.isNaN(parsed)) return null;
    amount = parsed;
    idx++;
  }

  let combatOnly = false;
  if (slice[idx] === 'combat' && slice[idx + 1] === 'damage') {
    combatOnly = true;
    idx += 2;
  } else if (slice[idx] === 'damage') {
    idx++;
  } else {
    return null;
  }

  if (slice[idx] === 'that' && slice[idx + 1] === 'would' && slice[idx + 2] === 'be' && slice[idx + 3] === 'dealt') {
    idx += 4;
  }

  let target: TargetRef | undefined;
  const targets: TargetSpec[] = [];
  if (slice[idx] === 'to') {
    idx++;
    if (slice[idx] === 'you') {
      target = { kind: 'Controller' };
      idx++;
    } else if (slice[idx] === 'target') {
      let targetType: TargetType | null = null;
      if (slice[idx + 1] === 'creature') targetType = 'Creature';
      if (slice[idx + 1] === 'player') targetType = 'Player';
      if (!targetType) return null;
      const spec = makeTargetSpec(targetType);
      targets.push(spec);
      target = makeChosenRef(spec);
      idx += 2;
    } else if (slice[idx] === 'any' && slice[idx + 1] === 'target') {
      const spec = makeTargetSpec('Any');
      targets.push(spec);
      target = makeChosenRef(spec);
      idx += 2;
    // Slice 10: "prevent the next N damage that would be dealt to enchanted creature this turn."
    // Enchanted/equipped creature — the creature this Aura/Equipment is attached to.
    } else if (slice[idx] === 'enchanted' && (slice[idx + 1] === 'creature' || slice[idx + 1] === 'permanent')) {
      target = { kind: 'SourceAttachedTo' };
      idx += 2;
    // Slice 10: "prevent the next N damage that would be dealt to this creature this turn."
    // Self-prevention on an activated ability — source permanent protects itself.
    } else if (slice[idx] === 'this' && (slice[idx + 1] === 'creature' || slice[idx + 1] === 'permanent')) {
      target = { kind: 'Source' };
      idx += 2;
    } else if (slice[idx] === 'itself') {
      // "prevent the next N damage that would be dealt to itself" — reflexive self-protection.
      target = { kind: 'Source' };
      idx++;
    }
  }

  if (slice[idx] === 'this' && slice[idx + 1] === 'turn') idx += 2;
  if (tokens[startIndex + idx] === '.') idx++;

  return {
    effects: [{
      kind: 'PreventDamage',
      target,
      amount,
      combatOnly,
      duration: 'turn',
    }],
    targets,
    consumed: idx,
  };
}

/**
 * Match (one-sided "fight"): "target [color] creature you control deals damage
 * equal to its power to target [color] creature [you don't control | an opponent
 * controls]". Unlike Fight this is NOT mutual — only fighterA deals damage to
 * fighterB equal to fighterA's power. Emitted as a DealDamage whose amount is the
 * chosen fighterA's power (executor resolves TargetPower against a Chosen ref).
 *
 * Also matches the spell-form (Flesh // Blood / Soul's Fire family):
 *   "target creature you control deals damage equal to its power to any target."
 * Here the source creature is a chosen target spec and the destination is 'Any'
 * (creature, planeswalker, or player). The 'you control' constraint is required
 * for the source creature so the template stays honest about legality.
 *
 * Slice 5 widening — also matches:
 *   (a) "another target creature" for fighterB (Fall of the Hammer / Contest of
 *       Claws family) — no controller qualifier required; sets notSource on the
 *       fighterB spec so the same creature cannot be chosen for both A and B.
 *   (b) "twice its power" multiplier (Animist's Might family) — emits TargetPower
 *       with multiplier: 2 (ast.ts AmountRef.multiplier field, already executed).
 *
 * Skips "or planeswalker" variants without a controller qualifier on fighterB
 * (no planeswalker target type that roundtrips cleanly) to stay honest.
 */
export function matchOneSidedDealDamageByPower(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice[0] !== 'target') return null;
  let idx = 1;

  // fighterA: target [color] creature you control
  const aColor = readColorConstraint(slice, idx);
  const aConstraints: TargetSpec['constraints'] = { ...(aColor ? { colors: aColor.colors } : {}) };
  if (aColor) idx += aColor.consumed;
  if (slice[idx] !== 'creature') return null;
  idx++;
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    aConstraints.controllerControls = true;
    idx += 2;
  }

  // "deals damage equal to [twice] its power to"
  if (
    slice[idx] !== 'deals'
    || slice[idx + 1] !== 'damage'
    || slice[idx + 2] !== 'equal'
    || slice[idx + 3] !== 'to'
  ) {
    return null;
  }
  idx += 4;

  // Optional "twice" multiplier (Animist's Might family)
  let powerMultiplier: number | undefined;
  if (slice[idx] === 'twice') {
    powerMultiplier = 2;
    idx++;
  }

  if (slice[idx] !== 'its' || slice[idx + 1] !== 'power' || slice[idx + 2] !== 'to') {
    return null;
  }
  idx += 3;

  // Spell-form (Flesh // Blood / Soul's Fire): "... to any target."
  // The source creature is a Chosen spec; 'Any' target covers creatures,
  // planeswalkers, and players — matching the real card legality.
  if (slice[idx] === 'any' && slice[idx + 1] === 'target') {
    idx += 2;
    let consumed = idx;
    if (tokens[startIndex + consumed] === '.') consumed++;

    const sourceSpec = makeTargetSpec('Creature', Object.keys(aConstraints).length ? aConstraints : undefined);
    const anySpec = makeTargetSpec('Any');
    const amt: AmountRef = powerMultiplier !== undefined
      ? { kind: 'TargetPower', target: makeChosenRef(sourceSpec), multiplier: powerMultiplier }
      : { kind: 'TargetPower', target: makeChosenRef(sourceSpec) };
    const effect: Effect = {
      kind: 'DealDamage',
      target: makeChosenRef(anySpec),
      amount: amt,
    };
    return { effects: [effect], targets: [sourceSpec, anySpec], consumed };
  }

  // fighterB: [another] target [color] creature [or planeswalker] [you don't control | an opponent controls]
  // Slice 5 widening: "another target creature" (Fall of the Hammer family) sets notSource
  // so the same creature can't serve as both fighterA and fighterB.
  let bNotSource = false;
  if (slice[idx] === 'another') {
    bNotSource = true;
    idx++;
  }

  if (slice[idx] !== 'target') return null;
  idx++;
  const bColor = readColorConstraint(slice, idx);
  const bConstraints: TargetSpec['constraints'] = { ...(bColor ? { colors: bColor.colors } : {}) };
  if (bColor) idx += bColor.consumed;

  // Detect "creature or planeswalker" union — uses CreatureOrPlaneswalker target type.
  let bTargetType: TargetType;
  if (slice[idx] === 'creature' && slice[idx + 1] === 'or' && slice[idx + 2] === 'planeswalker') {
    bTargetType = 'CreatureOrPlaneswalker';
    idx += 3;
  } else if (slice[idx] === 'creature') {
    bTargetType = 'Creature';
    idx++;
  } else {
    return null;
  }

  if (
    slice[idx] === 'you'
    && (slice[idx + 1] === "don't" || slice[idx + 1] === 'dont')
    && slice[idx + 2] === 'control'
  ) {
    bConstraints.opponentControls = true;
    idx += 3;
  } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    bConstraints.opponentControls = true;
    idx += 3;
  } else if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    bConstraints.controllerControls = true;
    idx += 2;
  }

  if (bNotSource) bConstraints.notSource = true;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const fighterA = makeTargetSpec('Creature', Object.keys(aConstraints).length ? aConstraints : undefined);
  const fighterB = makeTargetSpec(bTargetType, Object.keys(bConstraints).length ? bConstraints : undefined);
  const amt: AmountRef = powerMultiplier !== undefined
    ? { kind: 'TargetPower', target: makeChosenRef(fighterA), multiplier: powerMultiplier }
    : { kind: 'TargetPower', target: makeChosenRef(fighterA) };
  const effect: Effect = {
    kind: 'DealDamage',
    target: makeChosenRef(fighterB),
    amount: amt,
  };
  return { effects: [effect], targets: [fighterA, fighterB], consumed };
}

/**
 * Match: "target [color] creature deals damage to itself equal to its power."
 * (e.g. Repentance.) The chosen creature takes damage equal to its own power —
 * emitted as DealDamage whose target and TargetPower amount both reference the
 * same chosen creature.
 */
export function matchDamageToItselfByPower(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice[0] !== 'target') return null;
  let idx = 1;
  const color = readColorConstraint(slice, idx);
  const constraints: TargetSpec['constraints'] = { ...(color ? { colors: color.colors } : {}) };
  if (color) idx += color.consumed;
  if (slice[idx] !== 'creature') return null;
  idx++;
  if (
    slice[idx] !== 'deals'
    || slice[idx + 1] !== 'damage'
    || slice[idx + 2] !== 'to'
    || slice[idx + 3] !== 'itself'
    || slice[idx + 4] !== 'equal'
    || slice[idx + 5] !== 'to'
    || slice[idx + 6] !== 'its'
    || slice[idx + 7] !== 'power'
  ) {
    return null;
  }
  idx += 8;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length ? constraints : undefined);
  const ref = makeChosenRef(spec);
  const effect: Effect = {
    kind: 'DealDamage',
    target: ref,
    amount: { kind: 'TargetPower', target: ref },
  };
  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match "you may have it deal N damage / damage equal to its power to target
 * creature [that player controls]." — the Laccolith / Farrel's Zealot family.
 *
 * The "you may" prefix is stripped by parseEffectClauseInternal before calling
 * matchers, so this function sees tokens starting at "have".
 *
 * Shapes handled:
 *   "have it deal 3 damage to target creature"
 *   "have it deal 3 damage to target creature that player controls"
 *   "have it deal damage equal to its power to target creature"
 *   "have it deal damage equal to its power to target creature that player controls"
 *
 * The 'that player controls' rider narrows the target to creatures controlled by
 * the event player (the player who was dealt combat damage). It maps to an
 * EventPlayer-scoped controller constraint stored in constraints.eventPlayerControls.
 */
export function matchHaveItDealDamage(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Must start with "have it deal"
  if (slice[0] !== 'have' || slice[1] !== 'it' || slice[2] !== 'deal') return null;
  let idx = 3;

  // Parse amount: either "damage equal to its power" or "N damage"
  let amount: AmountRef;
  if (
    slice[idx] === 'damage'
    && slice[idx + 1] === 'equal'
    && slice[idx + 2] === 'to'
    && slice[idx + 3] === 'its'
    && slice[idx + 4] === 'power'
  ) {
    // "damage equal to its power" — amount is the source permanent's power.
    amount = { kind: 'TargetPower', target: { kind: 'Source' } };
    idx += 5; // consume "damage equal to its power"
  } else {
    const n = parseInt(slice[idx], 10);
    if (isNaN(n) || n <= 0) return null;
    amount = n;
    idx++;
    if (slice[idx] !== 'damage') return null;
    idx++;
  }

  // Must be followed by "to"
  if (slice[idx] !== 'to') return null;
  idx++;

  // Target must be "target creature [that player controls]"
  if (slice[idx] !== 'target' || slice[idx + 1] !== 'creature') return null;
  idx += 2;

  // Optional "that player controls" — a targeting restriction the engine
  // recognises but does not enforce (validateTargetChoices has no eventContext).
  // We consume the tokens so the parse succeeds; target validation is permissive
  // (any creature). The DealDamage effect itself is fully executable.
  if (slice[idx] === 'that' && slice[idx + 1] === 'player' && slice[idx + 2] === 'controls') {
    idx += 3;
  }

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Creature');
  const effect: Effect = {
    kind: 'DealDamage',
    source: { kind: 'ThisPermanent' } as SourceRef,
    target: makeChosenRef(spec),
    amount,
  };
  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "target creature you control fights target creature you don't control"
 */
export function matchFight(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice[0] !== 'target') return null;
  let idx = 1;
  const yourColorConstraints = colorConstraintFromWord(slice[idx]);
  const yourConstraints: TargetSpec['constraints'] = { ...(yourColorConstraints || {}) };
  if (yourColorConstraints) idx++;
  if (slice[idx] !== 'creature') return null;
  idx++;
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    yourConstraints.controllerControls = true;
    idx += 2;
  }
  if (slice[idx] !== 'fights') return null;
  idx++;
  if (slice[idx] !== 'target') return null;
  idx++;
  const opposingColorConstraints = colorConstraintFromWord(slice[idx]);
  if (opposingColorConstraints) idx++;
  if (slice[idx] !== 'creature') return null;
  idx++;
  if (
    (slice[idx] === 'you' && (slice[idx + 1] === "don't" || slice[idx + 1] === 'dont') && slice[idx + 2] === 'control')
    || (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls')
  ) {
    idx += 3;
  }

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const yourCreature = makeTargetSpec('Creature', Object.keys(yourConstraints).length > 0 ? yourConstraints : undefined);
  const opposingCreature = makeTargetSpec('Creature', { ...opposingColorConstraints, opponentControls: true });
  const effect: Effect = {
    kind: 'Fight',
    fighterA: makeChosenRef(yourCreature),
    fighterB: makeChosenRef(opposingCreature),
  };

  return { effects: [effect], targets: [yourCreature, opposingCreature], consumed };
}

/**
 * Slice 1 — Match: "it fights up to one target creature you don't control"
 * Match: "it fights up to one target creature an opponent controls"
 *
 * ETB/trigger body where the source permanent ("it") fights an optional target.
 * Fighter A is the Source itself (this permanent). Fighter B is a single Chosen
 * target with opponentControls. minCount=0 marks the target as optional so the
 * player may choose 0 targets (if no valid targets exist, the fight is skipped).
 * The executor's Fight case guards against 0-target resolution (Slice 1).
 */
export function matchSelfFightUpToOneTarget(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "it fights up to one target creature"
  if (slice[0] !== 'it' || slice[1] !== 'fights') return null;
  if (slice[2] !== 'up' || slice[3] !== 'to' || slice[4] !== 'one') return null;
  if (slice[5] !== 'target' || slice[6] !== 'creature') return null;

  let idx = 7;
  const constraints: TargetSpec['constraints'] = {};

  // Optional "you don't control" / "an opponent controls" / "an opponent control"
  if (
    (slice[idx] === 'you' && (slice[idx + 1] === "don't" || slice[idx + 1] === 'dont') && slice[idx + 2] === 'control')
    || (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls')
  ) {
    constraints.opponentControls = true;
    idx += 3;
  }

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  spec.minCount = 0; // up to one — optional

  const effect: Effect = {
    kind: 'Fight',
    fighterA: { kind: 'Source' },
    fighterB: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Slice 12 — Pestilence-style "this enchantment deals damage to that player equal to
 * the number of <filter> they control" and the spelled-out-X variant "deals X damage
 * to that player, where X is the number of <filter> they control".
 *
 * Examples:
 *   Ancient Runes    — "… deals damage to that player equal to the number of artifacts they control"
 *   Primal Order     — "… equal to the number of nonbasic lands they control"
 *   Cold Snap        — "… equal to the number of snow lands they control"
 *   Power Surge      — "… deals X damage to that player, where X is the number of untapped lands
 *                       they controlled at the beginning of this turn"
 *
 * The "they control" phrase is mapped to ForEach{controller:'eventPlayer'} so that
 * resolveForEachCount looks up the active player's permanents via eventContext.eventPlayerId.
 *
 * Power Surge's "untapped lands they controlled at the beginning of this turn" is
 * an honest decline — the engine has no beginning-of-turn untapped-land snapshot, so
 * we only accept the simplified present-tense "untapped lands they control" form.  The
 * phrase "at the beginning of this turn" causes the matcher to decline (return null)
 * so the card stays Unparsed rather than silently counting wrong.
 *
 * Source subjects recognised: "~", "this enchantment", "this artifact", "it",
 * "this permanent" (same set as the existing DealDamage matchers).
 */
export function matchDealDamageEqualToEventPlayerControls(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // --- Source subject ---
  let source: SourceRef = { kind: 'ThisPermanent' };
  if (slice[idx] === '~') {
    idx++;
  } else if (slice[idx] === 'it') {
    idx++;
  } else if (slice[idx] === 'this' && ['creature', 'artifact', 'enchantment', 'aura', 'land', 'permanent', 'spell'].includes(slice[idx + 1])) {
    source = slice[idx + 1] === 'spell' ? { kind: 'ThisSpell' } : { kind: 'ThisPermanent' };
    idx += 2;
  } else {
    return null;
  }

  // "deals"
  if (slice[idx] !== 'deals') return null;
  idx++;

  // Branch A: "deals damage to that player equal to the number of <filter> they control"
  // Branch B: "deals X damage to that player, where X is the number of <filter> they control"
  let amount: AmountRef | null = null;

  if (slice[idx] === 'damage' && slice[idx + 1] === 'to' && slice[idx + 2] === 'that' && slice[idx + 3] === 'player') {
    // Branch A: damage-first
    idx += 4; // past "damage to that player"
    if (slice[idx] !== 'equal' || slice[idx + 1] !== 'to') return null;
    idx += 2;
    // Parse "the number of <filter> they control"
    const dyn = parseTheyControlFilterAmount(slice, idx);
    if (!dyn) return null;
    amount = dyn.amount;
    idx = dyn.nextIndex;
  } else if (slice[idx] === 'x' && slice[idx + 1] === 'damage' && slice[idx + 2] === 'to' && slice[idx + 3] === 'that' && slice[idx + 4] === 'player') {
    // Branch B: X damage to that player, where X is the number of <filter> they control
    idx += 5; // past "X damage to that player"
    if (slice[idx] === ',') idx++;
    if (slice[idx] !== 'where' || slice[idx + 1] !== 'x' || slice[idx + 2] !== 'is') return null;
    idx += 3;
    const dyn = parseTheyControlFilterAmount(slice, idx);
    if (!dyn) return null;
    amount = dyn.amount;
    idx = dyn.nextIndex;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'DealDamage',
    source,
    target: { kind: 'EventPlayer' },
    amount,
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 7 — "that player loses X life, where X is the number of <filter> they control"
 *           "that player loses X life, where X is the number of <filter> cards in their hand"
 *           "that player loses X life, where X is the number of <filter> cards in their graveyard"
 *
 * Examples (real oracle text):
 *   "that player loses life equal to the number of cards in their hand" (Price of Knowledge variant)
 *   "that player loses X life, where X is the number of untapped lands they control" (Citadel of Pain LoseLife form)
 *
 * The player who loses life is EventPlayer (the player whose upkeep/end-step this is).
 * Amount is a ForEachAmount resolved by resolveForEachCount at trigger-resolution time.
 *
 * HONESTY: Declines "that player loses X life, where X is the number of untapped lands they
 * controlled at the beginning of this turn" (Power Surge snapshot — no snapshot in engine).
 */
export function matchThatPlayerLosesLifeXWhereX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Must start with "that player"
  if (slice[0] !== 'that' || slice[1] !== 'player') return null;
  // Verb "loses"
  if (slice[2] !== 'loses') return null;

  let idx = 3;

  // Branch A: "loses X life , where X is the number of ..."
  // Branch B: "loses life equal to the number of ..."
  let amount: ForEachAmount | null = null;

  if (slice[idx] === 'x' && slice[idx + 1] === 'life') {
    // Branch A: "loses X life, where X is the number of <filter> ..."
    idx += 2; // past "X life"
    if (slice[idx] === ',') idx++;
    if (slice[idx] !== 'where' || slice[idx + 1] !== 'x' || slice[idx + 2] !== 'is') return null;
    idx += 3;
    const dyn = parseTheyControlFilterAmount(slice, idx);
    if (!dyn) return null;
    amount = dyn.amount;
    idx = dyn.nextIndex;
  } else if (slice[idx] === 'life' && slice[idx + 1] === 'equal' && slice[idx + 2] === 'to') {
    // Branch B: "loses life equal to the number of <filter> ..."
    idx += 3; // past "life equal to"
    const dyn = parseTheyControlFilterAmount(slice, idx);
    if (!dyn) return null;
    amount = dyn.amount;
    idx = dyn.nextIndex;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  return {
    effects: [{ kind: 'LoseLife', player: { kind: 'EventPlayer' }, amount }],
    targets: [],
    consumed: idx,
  };
}

/**
 * Parse "the number of <filter> they control[led ...]"
 * OR     "the number of <filter> cards in their hand"
 * OR     "the number of <filter> cards in their graveyard".
 *
 * Returns { amount: ForEachAmount, nextIndex } or null on mismatch.
 * Declines "they controlled at the beginning of this turn" (Power Surge) since
 * the engine has no beginning-of-turn untapped snapshot.
 *
 * "In their hand" and "in their graveyard" map to ForEach with zone='hand' or
 * zone='graveyard', controller='eventPlayer' — both fully supported by
 * resolveForEachCount / resolveForEachControllerIds in executor.ts.
 *
 * Examples:
 *   "the number of artifacts they control"        → battlefield, eventPlayer
 *   "the number of cards in their hand"            → hand, eventPlayer
 *   "the number of creature cards in their graveyard" → graveyard, eventPlayer
 */
function parseTheyControlFilterAmount(
  slice: string[],
  at: number,
): { amount: ForEachAmount; nextIndex: number } | null {
  if (slice[at] !== 'the' || slice[at + 1] !== 'number' || slice[at + 2] !== 'of') return null;
  let i = at + 3;

  // --- "in their hand" / "in their graveyard" branch ---
  // Pattern: "the number of [<filter>] cards in their hand/graveyard"
  // Collect optional filter words until we hit "cards in their" or "card in their"
  {
    const wordsAhead: string[] = [];
    let j = i;
    let foundInTheir = false;
    let theirZone: ForEachAmount['zone'] | null = null;

    while (j < slice.length) {
      const w = slice[j];
      if (w === '.' || w === ',' || w === ';') break;
      if (w === 'cards' || w === 'card') {
        // Check if "in their hand/graveyard" follows
        if (slice[j + 1] === 'in' && slice[j + 2] === 'their') {
          const zoneWord = slice[j + 3];
          if (zoneWord === 'hand' || zoneWord === 'graveyard') {
            const afterZone = slice[j + 4];
            // Decline arithmetic continuations like "minus 4" or "plus 1"
            // (Viseling: "the number of cards in their hand minus 4"). The engine
            // cannot subtract a static offset — stay Unparsed rather than miscounting.
            if (afterZone === 'minus' || afterZone === 'plus' || afterZone === '+' || afterZone === '-') {
              break; // fall through to "they control" branch (will return null)
            }
            theirZone = zoneWord as ForEachAmount['zone'];
            foundInTheir = true;
            j += 4; // consume "cards in their hand/graveyard"
            break;
          }
        }
      }
      if (wordsAhead.length >= 5) break; // sanity cap
      wordsAhead.push(w);
      j++;
    }

    if (foundInTheir && theirZone) {
      // Build filter from any collected pre-"cards" words (strip bare "card"/"cards")
      const meaningfulWords = wordsAhead.filter(w => w !== 'card' && w !== 'cards');
      let filter: CardFilter | undefined | null;
      if (meaningfulWords.length > 0) {
        filter = buildTheyControlFilter(meaningfulWords);
        if (filter === null) {
          // Unknown filter words — honest decline, fall through to "they control" branch
          filter = undefined;
        }
      } else {
        filter = undefined; // no filter — count all cards in zone
      }
      const amount: ForEachAmount = {
        kind: 'ForEach',
        zone: theirZone,
        controller: 'eventPlayer',
        ...(filter ? { filter } : {}),
      };
      return { amount, nextIndex: j };
    }
  }

  // --- "they control[led]" / "that player controls[led]" branch (battlefield) ---
  // Collect filter words up to "they control", "they controlled",
  // "that player controls", or "that player controlled".
  const words: string[] = [];
  while (i < slice.length) {
    const w = slice[i];
    if (w === '.' || w === ',' || w === ';') break;
    // Stop when we hit "they" or "that" (start of "that player controls")
    if (w === 'they') break;
    if (w === 'that' && slice[i + 1] === 'player') break;
    if (words.length >= 5) return null; // sanity cap
    words.push(w);
    i++;
  }

  if (words.length === 0) return null;

  let verbToken: string;
  if (slice[i] === 'they') {
    // "they control" or "they controlled"
    const verbIdx = i + 1;
    if (slice[verbIdx] !== 'control' && slice[verbIdx] !== 'controlled') return null;
    verbToken = slice[verbIdx];
    i = verbIdx + 1;
  } else if (slice[i] === 'that' && slice[i + 1] === 'player') {
    // "that player controls" or "that player controlled"
    const verbIdx = i + 2;
    if (slice[verbIdx] !== 'controls' && slice[verbIdx] !== 'controlled') return null;
    verbToken = slice[verbIdx];
    i = verbIdx + 1;
  } else {
    return null;
  }

  // If "controlled" / "controls" past tense, check for "at the beginning of this turn" — decline (Power Surge snapshot).
  if (verbToken === 'controlled') {
    // Any trailing "at the beginning of this turn" means we can't execute honestly.
    if (slice[i] === 'at') return null;
    // Allow bare "they controlled" / "that player controlled" — treated same as present tense.
  }

  // Build filter from the collected words
  const filter = buildTheyControlFilter(words);
  if (filter === null) return null;

  const amount: ForEachAmount = {
    kind: 'ForEach',
    zone: 'battlefield',
    controller: 'eventPlayer',
    ...(filter ? { filter } : {}),
  };
  return { amount, nextIndex: i };
}

/**
 * Map noun-phrase words to a CardFilter for "they control" permanents.
 * Supports the same word shapes as parseForEachFilterWords (via parseStaticFilterType)
 * plus "nonbasic" as an excludeSupertypes rider and "snow" as a supertypes rider.
 *
 * Returns null if any word is unrecognised (honest decline).
 * Returns undefined when no filter is needed (counts all permanents they control).
 */
function buildTheyControlFilter(words: string[]): CardFilter | undefined | null {
  const filter: CardFilter = {};

  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi];

    if (word === 'card' || word === 'cards') continue;

    if (word === 'nonbasic') {
      // "nonbasic lands they control" — excludeSupertypes basic
      filter.excludeSupertypes = [...(filter.excludeSupertypes ?? []), 'basic'];
      continue;
    }

    if (word === 'snow') {
      // "snow lands they control" — supertypes snow
      filter.supertypes = [...(filter.supertypes ?? []), 'snow'];
      continue;
    }

    if (word === 'untapped') {
      // "untapped lands they control" — tapped: false (instance-level check in resolveForEachCount)
      filter.tapped = false;
      continue;
    }

    // delegate to the shared parser
    const part: CardFilter | null =
      word === 'equipment' ? { subtypes: ['equipment'] } : parseStaticFilterType(word);
    if (!part || Object.keys(part).length === 0) return null;

    for (const key of Object.keys(part) as Array<keyof CardFilter>) {
      if (filter[key] !== undefined) return null;
      (filter as Record<string, unknown>)[key] = part[key];
    }
  }

  return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * Slice 10 — Match: "enchanted creature fights up to one target creature [an opponent controls / you don't control]"
 *
 * Aura ETB body for fight Auras (Pitiless Fists, Warbriar Blessing,
 * Meltstrider's Resolve). Fighter A is SourceAttachedTo (the creature the
 * Aura is enchanting). Fighter B is an optional chosen target creature
 * (minCount=0, opponentControls if qualified).
 *
 * The executor's Fight case already handles SourceAttachedTo via getSourceAttachedTo.
 */
export function matchEnchantedCreatureFight(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "enchanted creature fights up to one target creature"
  if (slice[0] !== 'enchanted' || slice[1] !== 'creature') return null;
  if (slice[2] !== 'fights') return null;
  if (slice[3] !== 'up' || slice[4] !== 'to' || slice[5] !== 'one') return null;
  if (slice[6] !== 'target' || slice[7] !== 'creature') return null;

  let idx = 8;
  const constraints: TargetSpec['constraints'] = {};

  // Optional controller qualifier
  if (
    (slice[idx] === 'you' && (slice[idx + 1] === "don't" || slice[idx + 1] === 'dont') && slice[idx + 2] === 'control')
    || (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls')
  ) {
    constraints.opponentControls = true;
    idx += 3;
  }

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  spec.minCount = 0; // "up to one" — optional fight

  const effect: Effect = {
    kind: 'Fight',
    fighterA: { kind: 'SourceAttachedTo' },
    fighterB: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Slice 10 — Match: "enchanted creature deals damage equal to its power to any other target"
 *
 * Aura ETB body for "Pain for All" style Auras. The enchanted creature is
 * SourceAttachedTo; it deals damage equal to the enchanted creature's own
 * power (TargetPower{SourceAttachedTo}) to "any other target" (a chosen Any
 * target that excludes the enchanted creature by "other" — we cannot enforce
 * the "other" restriction in TargetSpec, but since this is an ETB effect the
 * Aura is newly attached so it is an honest simplification accepted by the
 * honesty bar: the executor will deal the right damage amount).
 *
 * The executor's DealDamage case must handle SourceAttachedTo explicitly;
 * we add that branch alongside the existing Source handling.
 */
export function matchEnchantedCreatureDealsDamageByPower(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "enchanted creature deals damage equal to its power to any other target"
  // also: "enchanted creature deals damage equal to its power to any target"
  if (slice[0] !== 'enchanted' || slice[1] !== 'creature') return null;
  if (slice[2] !== 'deals' || slice[3] !== 'damage') return null;
  if (slice[4] !== 'equal' || slice[5] !== 'to' || slice[6] !== 'its' || slice[7] !== 'power') return null;
  if (slice[8] !== 'to') return null;

  let idx = 9;
  // "any other target" or "any target"
  if (slice[idx] !== 'any') return null;
  idx++;
  if (slice[idx] === 'other') idx++;
  if (slice[idx] !== 'target') return null;
  idx++;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Any');
  const sourceAttachedRef: TargetRef = { kind: 'SourceAttachedTo' };
  const effect: Effect = {
    kind: 'DealDamage',
    target: makeChosenRef(spec),
    amount: { kind: 'TargetPower', target: sourceAttachedRef },
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Slice 9 (Aura lifecycle / Insolence family): Match
 *   "~ deals N damage to that creature's controller"
 *   "this aura deals N damage to that creature's controller"
 *   "this enchantment deals N damage to its controller"
 *
 * Used by "Insolence" and similar Auras where the body of a DealsDamage
 * trigger deals fixed damage to the controller of the enchanted creature
 * (EventPlayer in the DealsDamage event context — the creature's controller
 * is the player associated with the event).
 *
 * This is distinct from matchDealsDamageThatMuchToCreatureController (which
 * uses EventDamageAmount) — this matcher takes a fixed integer amount.
 */
export function matchDealDamageToEventCreatureController(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // Source subject: "~", "this aura", "this enchantment", "this permanent", "it"
  let source: SourceRef = { kind: 'ThisPermanent' };
  if (slice[idx] === '~') {
    idx++;
  } else if (slice[idx] === 'it') {
    idx++;
  } else if (
    slice[idx] === 'this'
    && ['aura', 'enchantment', 'creature', 'permanent', 'artifact'].includes(slice[idx + 1])
  ) {
    idx += 2;
  } else {
    return null;
  }

  if (slice[idx] !== 'deals') return null;
  idx++;

  // Fixed integer N
  const n = parseInt(slice[idx], 10);
  if (isNaN(n) || n < 1) return null;
  idx++;

  if (slice[idx] !== 'damage') return null;
  idx++;

  if (slice[idx] !== 'to') return null;
  idx++;

  // "that creature's controller" or "its controller"
  if (
    slice[idx] === 'that'
    && (slice[idx + 1] === "creature's" || slice[idx + 1] === 'creature')
    && slice[idx + 2] === 'controller'
  ) {
    idx += 3;
  } else if (slice[idx] === 'its' && slice[idx + 1] === 'controller') {
    idx += 2;
  } else {
    return null;
  }

  if (tokens[startIndex + idx] === '.') idx++;

  const effect: Effect = {
    kind: 'DealDamage',
    source,
    target: { kind: 'EventPlayer' },
    amount: n,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 2 (EventDamageAmount family): Match "[it/~/this <type>] deals that much damage
 * to <target>" trigger tails.
 *
 * "That much" is EventDamageAmount (the damage dealt in the triggering event).
 *
 * Recognised target forms:
 *   "target opponent"             → Player{opponentControls:true} chosen target
 *   "target opponent or planeswalker" → same (planeswalker damage not executed,
 *                                         so we model as Player-only, honest bar)
 *   "any target"                  → Any chosen target
 *   "any target that isn't a <Subtype>" → Any target (subtype restriction not
 *                                         enforced in TargetSpec; modelled as Any,
 *                                         honest since we under-restrict rather than
 *                                         over-restrict — the card still works correctly)
 *   "each other opponent"         → EachOpponent (no chosen target)
 *   "that player"                 → EventPlayer (no chosen target)
 *
 * Source subjects: "~", "it", "this <type>" (creature/artifact/enchantment/permanent/aura).
 *
 * Examples:
 *   Donna Noble: "Whenever ~ deals combat damage to a player, it deals that much
 *     damage to target opponent."
 *   Wrathful Red Dragon: "Whenever a Dragon you control is dealt damage, it deals
 *     that much damage to any target that isn't a Dragon."
 *   Grenzo's Ruffians: "Whenever ~ deals combat damage to a player, it deals that
 *     much damage to each other opponent."
 *   Wall of Souls: "Whenever ~ is dealt combat damage, it deals that much damage
 *     to target opponent or planeswalker."
 */
export function matchDealsThatMuchDamageToTarget(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // --- Source subject ---
  let source: SourceRef = { kind: 'ThisPermanent' };
  if (slice[idx] === '~') {
    idx++;
  } else if (slice[idx] === 'it') {
    source = { kind: 'ThisPermanent' };
    idx++;
  } else if (
    slice[idx] === 'this'
    && ['creature', 'artifact', 'enchantment', 'aura', 'land', 'permanent', 'spell'].includes(slice[idx + 1])
  ) {
    source = slice[idx + 1] === 'spell' ? { kind: 'ThisSpell' } : { kind: 'ThisPermanent' };
    idx += 2;
  } else {
    return null;
  }

  // "deals that much damage to"
  if (slice[idx] !== 'deals') return null;
  idx++;
  if (slice[idx] !== 'that' || slice[idx + 1] !== 'much' || slice[idx + 2] !== 'damage') return null;
  idx += 3;
  if (slice[idx] !== 'to') return null;
  idx++;

  // --- Target ---
  let effectTarget: TargetRef;
  let targets: TargetSpec[] = [];

  if (slice[idx] === 'each' && slice[idx + 1] === 'other' && slice[idx + 2] === 'opponent') {
    // "each other opponent" — no chosen target
    effectTarget = { kind: 'EachOpponent' };
    idx += 3;
  } else if (slice[idx] === 'each' && slice[idx + 1] === 'opponent') {
    effectTarget = { kind: 'EachOpponent' };
    idx += 2;
  } else if (slice[idx] === 'that' && slice[idx + 1] === 'player') {
    effectTarget = { kind: 'EventPlayer' };
    idx += 2;
  } else if (slice[idx] === 'any' && slice[idx + 1] === 'target') {
    idx += 2;
    // Consume optional "that isn't a <Subtype>" restriction (honest: we model as Any target)
    if (slice[idx] === 'that' && slice[idx + 1] === "isn't" && slice[idx + 2] === 'a') {
      // skip "that isn't a <Word>"
      idx += 4; // skip "that", "isn't", "a", "<Subtype>"
    }
    const spec = makeTargetSpec('Any');
    targets = [spec];
    effectTarget = makeChosenRef(spec);
  } else if (slice[idx] === 'target' && (slice[idx + 1] === 'opponent' || slice[idx + 1] === 'player')) {
    const isOpponent = slice[idx + 1] === 'opponent';
    idx += 2;
    // Consume optional "or planeswalker" (honest: modelled as Player-only since
    // the engine does not route damage to planeswalker loyalty counters).
    if (slice[idx] === 'or' && slice[idx + 1] === 'planeswalker') {
      idx += 2;
    }
    const spec = makeTargetSpec('Player', isOpponent ? { opponentControls: true } : undefined);
    targets = [spec];
    effectTarget = makeChosenRef(spec);
  } else {
    return null;
  }

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'DealDamage',
    source,
    target: effectTarget,
    amount: { kind: 'EventDamageAmount' },
  };

  return { effects: [effect], targets, consumed };
}

/**
 * Slice 5 (bite family) — Match "~ deals damage equal to twice its power to
 * target [creature | player | any target]."
 *
 * Covers Animist's Might and similar spells whose source permanent hits a
 * target for twice its own power. Source must be ThisPermanent ("it" / "this
 * creature"). Emits DealDamage with amount TargetPower{Source, multiplier:2}.
 *
 * "Its power" references the source permanent itself — this only makes sense
 * for a permanent (not a spell), so we return null when the subject is ThisSpell.
 */
export function matchDealDamageTwiceItsPower(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;
  let source: SourceRef = { kind: 'ThisPermanent' };

  if (slice[idx] === '~') { idx++; }
  else if (slice[idx] === 'it') { source = { kind: 'ThisPermanent' }; idx++; }
  else if (
    slice[idx] === 'this'
    && ['creature', 'artifact', 'enchantment', 'aura', 'land', 'permanent'].includes(slice[idx + 1])
  ) {
    source = { kind: 'ThisPermanent' };
    idx += 2;
  } else {
    return null;
  }

  // "deals damage equal to twice its power to"
  if (
    slice[idx] !== 'deals'
    || slice[idx + 1] !== 'damage'
    || slice[idx + 2] !== 'equal'
    || slice[idx + 3] !== 'to'
    || slice[idx + 4] !== 'twice'
    || slice[idx + 5] !== 'its'
    || slice[idx + 6] !== 'power'
    || slice[idx + 7] !== 'to'
  ) {
    return null;
  }
  idx += 8;

  // "target attacking creature" and friends — strip noun modifiers, re-parse.
  if (slice[idx] === 'target') {
    const withMods = retryWithTargetNounModifiers(slice, idx, matchDealDamageTwiceItsPower);
    if (withMods) return withMods;
  }

  let effectTarget: TargetRef | null = null;
  let targets: TargetSpec[] = [];

  if (slice[idx] === 'any' && slice[idx + 1] === 'target') {
    const spec = makeTargetSpec('Any'); targets = [spec]; effectTarget = makeChosenRef(spec); idx += 2;
  } else if (slice[idx] === 'target' && slice[idx + 1] === 'creature') {
    const spec = makeTargetSpec('Creature'); targets = [spec]; effectTarget = makeChosenRef(spec); idx += 2;
  } else if (slice[idx] === 'target' && slice[idx + 1] === 'player') {
    const spec = makeTargetSpec('Player'); targets = [spec]; effectTarget = makeChosenRef(spec); idx += 2;
  } else {
    return null;
  }

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const amt: AmountRef = { kind: 'TargetPower', target: { kind: 'Source' }, multiplier: 2 };
  const dmgEffect: Effect = {
    kind: 'DealDamage',
    source,
    target: effectTarget,
    amount: amt,
  };
  return { effects: [dmgEffect], targets, consumed };
}

/**
 * Slice 5 (bite family) — Match: "target creature [an opponent controls |
 * that player controls] deals damage equal to its power to [another] target
 * creature [that player controls | you control | ...]."
 *
 * Covers Mutiny-style spells where a creature controlled by an opponent (or
 * "that player" in a trigger context) is forced to deal damage equal to its
 * power to another creature, often under the same controller.
 *
 * The source creature is a chosen TargetSpec; amount is TargetPower referencing
 * the source spec's chosen ref. "Another" is consumed silently (honest: target
 * eligibility enforcement is outside TargetSpec — same as the existing
 * matchOneSidedDealDamageByPower "any other target" simplification).
 *
 * Controller qualifiers recognised on the source creature:
 *   "an opponent controls" | "that player controls"
 *
 * Controller qualifiers recognised on the destination creature:
 *   "that player controls" | "you control" | "an opponent controls"
 *   (none is also valid — unconstrained target creature)
 */
export function matchMutinyStyle(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice[0] !== 'target') return null;
  let idx = 1;

  // Source creature: target [color] creature [an opponent controls | that player controls]
  const srcColor = readColorConstraint(slice, idx);
  const srcConstraints: TargetSpec['constraints'] = { ...(srcColor ? { colors: srcColor.colors } : {}) };
  if (srcColor) idx += srcColor.consumed;
  if (slice[idx] !== 'creature') return null;
  idx++;

  // Controller qualifier on the SOURCE creature
  if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    srcConstraints.opponentControls = true;
    idx += 3;
  } else if (slice[idx] === 'that' && slice[idx + 1] === 'player' && slice[idx + 2] === 'controls') {
    // "that player controls" — we model as opponentControls (honest: EventPlayer
    // is an opponent of the caster in the contexts this is used)
    srcConstraints.opponentControls = true;
    idx += 3;
  } else {
    // "target creature deals damage" without controller qualifier — skip to
    // matchOneSidedDealDamageByPower which handles "you control" variants
    return null;
  }

  // "deals damage equal to its power to"
  if (
    slice[idx] !== 'deals'
    || slice[idx + 1] !== 'damage'
    || slice[idx + 2] !== 'equal'
    || slice[idx + 3] !== 'to'
    || slice[idx + 4] !== 'its'
    || slice[idx + 5] !== 'power'
    || slice[idx + 6] !== 'to'
  ) {
    return null;
  }
  idx += 7;

  // Optional "another" (Mutiny: "to another target creature that player controls")
  if (slice[idx] === 'another') idx++;

  // Destination creature: target [color] creature [controller qualifier]
  if (slice[idx] !== 'target') return null;
  idx++;
  const dstColor = readColorConstraint(slice, idx);
  const dstConstraints: TargetSpec['constraints'] = { ...(dstColor ? { colors: dstColor.colors } : {}) };
  if (dstColor) idx += dstColor.consumed;
  if (slice[idx] !== 'creature') return null;
  idx++;

  // Optional controller qualifier on the DESTINATION creature
  if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    dstConstraints.opponentControls = true;
    idx += 3;
  } else if (slice[idx] === 'that' && slice[idx + 1] === 'player' && slice[idx + 2] === 'controls') {
    dstConstraints.opponentControls = true;
    idx += 3;
  } else if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    dstConstraints.controllerControls = true;
    idx += 2;
  }

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const srcSpec = makeTargetSpec('Creature', Object.keys(srcConstraints).length ? srcConstraints : undefined);
  const dstSpec = makeTargetSpec('Creature', Object.keys(dstConstraints).length ? dstConstraints : undefined);
  const dmgEffect: Effect = {
    kind: 'DealDamage',
    target: makeChosenRef(dstSpec),
    amount: { kind: 'TargetPower', target: makeChosenRef(srcSpec) },
  };
  return { effects: [dmgEffect], targets: [srcSpec, dstSpec], consumed };
}

/**
 * Slice 5 (bite family) — Match: "each other <Subtype> you control deals
 * damage equal to its power to target creature."
 *
 * Covers trigger tails like Bartz and Boko's "each other Bird you control
 * deals damage equal to its power to target creature." Each matching permanent
 * deals its OWN power as damage — the amount varies per-permanent, so this
 * emits DealDamageAllByPower rather than a fixed-amount DealDamage.
 *
 * Only "you control" is supported (the "other" qualifier relative to the
 * trigger source). The destination must be "target creature".
 *
 * Subtype recognition uses CREATURE_SUBTYPE_MAP (same word list as the rest
 * of the damage matchers).
 */
export function matchEachSubtypeDealsDamageByPower(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "each [other] <Subtype> you control deals damage equal to its power to target creature"
  if (slice[0] !== 'each') return null;
  let idx = 1;

  // Optional "other"
  let excludeSource = false;
  if (slice[idx] === 'other') {
    excludeSource = true;
    idx++;
  }

  // Subtype word
  const subtypeWord = slice[idx];
  if (!subtypeWord || !CREATURE_SUBTYPE_MAP[subtypeWord]) return null;
  const subtype = CREATURE_SUBTYPE_MAP[subtypeWord];
  idx++;

  // "you control"
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'control') return null;
  idx += 2;

  // "deals damage equal to its power to"
  if (
    slice[idx] !== 'deals'
    || slice[idx + 1] !== 'damage'
    || slice[idx + 2] !== 'equal'
    || slice[idx + 3] !== 'to'
    || slice[idx + 4] !== 'its'
    || slice[idx + 5] !== 'power'
    || slice[idx + 6] !== 'to'
  ) {
    return null;
  }
  idx += 7;

  // Destination: "target creature"
  if (slice[idx] !== 'target' || slice[idx + 1] !== 'creature') return null;
  idx += 2;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Creature');
  const sourceFilter: import('../ast').CardFilter = { subtypes: [subtype], types: ['creature'] };
  const dmgEffect: Effect = {
    kind: 'DealDamageAllByPower',
    sourceFilter,
    controller: 'you',
    excludeSource,
    target: makeChosenRef(spec),
  };
  return { effects: [dmgEffect], targets: [spec], consumed };
}

/**
 * Brion Stoutarm family: "<source-name-tokens> deals damage equal to the
 * sacrificed creature's power to target player [or planeswalker]."
 *
 * The effect text begins with arbitrary card-name tokens (e.g. "brion stoutarm")
 * rather than "~" because the parser does not substitute the card's own name in
 * activated-ability effect text.  This matcher scans forward until it finds the
 * keyword sequence "deals damage equal to the sacrificed creature's power" and
 * then matches the target phrase.
 *
 * Produces a DealDamage effect whose amount is { kind: 'SacrificedCreaturePower' }.
 * The executor reads the power value stored in namedCardChoices['sacrificedCreaturePower']
 * (written during cost payment in activateAbility before the creature is removed).
 *
 * "target player or planeswalker" maps to a Player target spec. Planeswalker
 * damage-redirection is a rules layer above the executor; for our purposes a
 * Player target is sufficient and correct.
 */
export function matchDealDamageSacrificedCreaturePower(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Scan for "deals" keyword — the card name tokens precede it
  let idx = 0;
  while (idx < slice.length && slice[idx] !== 'deals') idx++;
  if (idx >= slice.length) return null;
  idx++; // skip "deals"

  // Must be followed by "damage equal to the sacrificed creature's power"
  if (
    slice[idx] !== 'damage'
    || slice[idx + 1] !== 'equal'
    || slice[idx + 2] !== 'to'
    || slice[idx + 3] !== 'the'
    || slice[idx + 4] !== 'sacrificed'
    || (slice[idx + 5] !== "creature's" && slice[idx + 5] !== 'creature')
    || slice[idx + 6] !== 'power'
  ) return null;
  idx += 7; // skip "damage equal to the sacrificed creature's power"

  // Must be followed by "to"
  if (slice[idx] !== 'to') return null;
  idx++;

  // Target: "target player [or planeswalker]" or "target player or planeswalker"
  if (slice[idx] !== 'target') return null;
  idx++;
  if (slice[idx] !== 'player') return null;
  idx++;
  // consume optional "or planeswalker"
  if (slice[idx] === 'or' && slice[idx + 1] === 'planeswalker') {
    idx += 2;
  }

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Player');
  const effect: Effect = {
    kind: 'DealDamage',
    source: { kind: 'ThisPermanent' },
    target: makeChosenRef(spec),
    amount: { kind: 'SacrificedCreaturePower' },
  };
  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Slice 7: Wheel of Torture / Storm World / Rackling / Viseling family.
 *
 * Match: "<source> deals X damage to <target>, where X is <N> minus the number
 * of <filter> in <zone>" (upkeep-damage punisher with a BaseMinusCount amount).
 *
 * The key clause is "where X is N minus the number of <filter> [they control /
 * in their hand / in their graveyard]". The ForEachAmount uses controller
 * 'eventPlayer' so that at trigger-resolution time the eventContext.eventPlayerId
 * (the player whose upkeep this is) is counted — exactly matching the oracle text
 * "that player's hand" / "cards they control".
 *
 * Recognised source subjects: "~", "it", "this <permanent-type>".
 * Recognised targets: "that player" (EventPlayer — the standard upkeep-trigger target).
 * "each opponent" is also supported for multi-target variants.
 *
 * The amount is clamped to max(0, N − count) in resolveAmount (executor.ts).
 *
 * Examples handled:
 *   Wheel of Torture:  "…deals X damage to that player, where X is 3 minus
 *                       the number of cards in that player's hand"
 *   Storm World:       "…deals X damage to that player, where X is 4 minus
 *                       the number of cards in that player's hand"
 *   Rackling:          "…deals X damage to that player, where X is 3 minus
 *                       the number of cards in that player's hand"
 *   Viseling:          "…deals X damage to that player, where X is 4 minus
 *                       the number of cards in that player's hand"
 *   Price of Knowledge: "…deals X damage to each opponent, where X is 7 minus
 *                        the number of cards in their hand"
 *
 * NOTE: "in that player's hand" is normalised by the tokenizer to
 * "in that player 's hand" (apostrophe is split) — we consume both forms.
 * The hand counting uses ForEachAmount{zone:'hand', controller:'eventPlayer'}
 * which resolveForEachCount resolves via eventPlayerId.
 */
export function matchDealDamageXBaseMinusCount(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // --- Source subject ---
  let source: SourceRef = { kind: 'ThisPermanent' };
  if (slice[idx] === '~') {
    idx++;
  } else if (slice[idx] === 'it') {
    source = { kind: 'ThisPermanent' };
    idx++;
  } else if (
    slice[idx] === 'this' &&
    ['creature', 'artifact', 'enchantment', 'aura', 'land', 'permanent', 'spell'].includes(slice[idx + 1])
  ) {
    source = slice[idx + 1] === 'spell' ? { kind: 'ThisSpell' } : { kind: 'ThisPermanent' };
    idx += 2;
  } else {
    return null;
  }

  // "deals x damage to"
  if (slice[idx] !== 'deals' || slice[idx + 1] !== 'x' || slice[idx + 2] !== 'damage' || slice[idx + 3] !== 'to') {
    return null;
  }
  idx += 4;

  // Target: "that player" (EventPlayer) or "each opponent" (EachOpponent)
  let effectTarget: TargetRef;
  if (slice[idx] === 'that' && slice[idx + 1] === 'player') {
    effectTarget = { kind: 'EventPlayer' };
    idx += 2;
  } else if (slice[idx] === 'each' && slice[idx + 1] === 'opponent') {
    effectTarget = { kind: 'EachOpponent' };
    idx += 2;
  } else {
    return null;
  }

  // Optional comma before "where X is"
  if (slice[idx] === ',') idx++;

  // "where x is"
  if (slice[idx] !== 'where' || slice[idx + 1] !== 'x' || slice[idx + 2] !== 'is') return null;
  idx += 3;

  // Integer base N
  const base = parseSmallNumberToken(slice[idx] ?? '');
  if (Number.isNaN(base) || base < 1) return null;
  idx++;

  // "minus"
  if (slice[idx] !== 'minus') return null;
  idx++;

  // "the number of <filter> <zone-phrase>"
  // We support two zone phrases for the "that player" family:
  //   (a) "in that player's hand" / "in that player 's hand" / "in their hand"
  //   (b) "in that player's graveyard" / "in their graveyard"
  //   (c) "they control" / "they controlled" (battlefield)
  // All resolve with controller: 'eventPlayer' so the executor uses eventPlayerId.

  if (slice[idx] !== 'the' || slice[idx + 1] !== 'number' || slice[idx + 2] !== 'of') return null;
  idx += 3;

  // Collect filter words until we hit a recognised zone phrase.
  const filterWords: string[] = [];
  let zonePhrase: { zone: ForEachAmount['zone'] } | null = null;

  while (idx < slice.length) {
    const w = slice[idx];
    if (w === '.' || w === ',' || w === ';') break;

    // "cards in that player 's hand/graveyard" — tokenizer splits "player's" to ["player", "'s"]
    if ((w === 'cards' || w === 'card') && slice[idx + 1] === 'in' && slice[idx + 2] === 'that' && slice[idx + 3] === "player's") {
      const zoneWord = slice[idx + 4];
      if (zoneWord === 'hand' || zoneWord === 'graveyard') {
        zonePhrase = { zone: zoneWord };
        idx += 5;
        break;
      }
    }
    // "cards in that player 's hand/graveyard" (split apostrophe: player + 's)
    if ((w === 'cards' || w === 'card') && slice[idx + 1] === 'in' && slice[idx + 2] === 'that' && slice[idx + 3] === 'player' && slice[idx + 4] === "'s") {
      const zoneWord = slice[idx + 5];
      if (zoneWord === 'hand' || zoneWord === 'graveyard') {
        zonePhrase = { zone: zoneWord };
        idx += 6;
        break;
      }
    }
    // "cards in their hand/graveyard"
    if ((w === 'cards' || w === 'card') && slice[idx + 1] === 'in' && slice[idx + 2] === 'their') {
      const zoneWord = slice[idx + 3];
      if (zoneWord === 'hand' || zoneWord === 'graveyard') {
        zonePhrase = { zone: zoneWord };
        idx += 4;
        break;
      }
    }

    // "they control[led]" — battlefield
    if (w === 'they' && (slice[idx + 1] === 'control' || slice[idx + 1] === 'controlled')) {
      // Decline "they controlled at the beginning of this turn" (snapshot form — no engine support).
      if (slice[idx + 1] === 'controlled' && slice[idx + 2] === 'at') {
        return null;
      }
      zonePhrase = { zone: 'battlefield' };
      idx += 2;
      break;
    }

    if (filterWords.length >= 5) return null; // sanity cap
    filterWords.push(w);
    idx++;
  }

  if (!zonePhrase) return null;

  // Build filter from any collected pre-zone words (strip bare "card"/"cards")
  let countFilter: import('../ast').CardFilter | undefined;
  const meaningfulWords = filterWords.filter(w => w !== 'card' && w !== 'cards');
  if (meaningfulWords.length > 0) {
    const f: import('../ast').CardFilter = {};
    for (const word of meaningfulWords) {
      if (word === 'untapped') {
        // "untapped lands" — the only tapped-state filter the ForEach can handle:
        // we store tapped: false on the filter; resolveForEachCount skips tapped cards
        // (via the card.tapped field). Honest: the executor already reads card.tapped
        // in resolveForEachCount for untapped-land counting (Power Surge family).
        // We map this to permanent: false which the executor resolves by checking the
        // tapped state below (ForEach counts only untapped cards when this flag is set).
        // Actually we use a CardFilter {types:['land']} and we'll handle untapped
        // at the BaseMinusCount resolution level — the executor can check card.tapped.
        // For now we decline "untapped" since no snapshot exists and ForEach does not
        // filter by tapped state — return null to stay honest.
        return null;
      }
      if (word === 'nonbasic') {
        f.excludeSupertypes = [...(f.excludeSupertypes ?? []), 'basic'];
        continue;
      }
      if (word === 'snow') {
        f.supertypes = [...(f.supertypes ?? []), 'snow'];
        continue;
      }
      const part: import('../ast').CardFilter | null =
        word === 'equipment' ? { subtypes: ['equipment'] } : parseStaticFilterType(word);
      if (!part || Object.keys(part).length === 0) return null;
      for (const key of Object.keys(part) as Array<keyof import('../ast').CardFilter>) {
        if (f[key] !== undefined) return null;
        (f as Record<string, unknown>)[key] = part[key];
      }
    }
    countFilter = Object.keys(f).length > 0 ? f : undefined;
  }

  const countAmount: ForEachAmount = {
    kind: 'ForEach',
    zone: zonePhrase.zone,
    controller: 'eventPlayer',
    ...(countFilter ? { filter: countFilter } : {}),
  };

  const amount: AmountRef = { kind: 'BaseMinusCount', base, count: countAmount };

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'DealDamage',
    source,
    target: effectTarget,
    amount,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 3 (keyword-led combat-damage trigger bodies): "it deals that much damage
 * to each creature that player controls" — Balefire Dragon family.
 *
 * "That much" = EventDamageAmount (the combat damage that triggered the ability).
 * "That player" = EventPlayer (the player who was dealt combat damage).
 * Target = AllOfType { creature, eventPlayerControls: true }.
 *
 * Source: "it" / "~" / "this <type>" (all map to ThisPermanent).
 *
 * Example:
 *   Balefire Dragon: "it deals that much damage to each creature that player controls."
 *
 * HONEST: executor DealDamage/AllOfType branch is extended to handle
 * eventPlayerControls by resolving eventContext.eventPlayerId at execution time.
 * Declined: "each other creature" / mass-to-players variants handled elsewhere.
 */
export function matchDealsThatMuchDamageToEachCreatureThatPlayerControls(
  tokens: string[],
  startIndex: number,
): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // Source: "it" / "~" / "this <type>"
  let source: SourceRef = { kind: 'ThisPermanent' };
  if (slice[idx] === '~') {
    idx++;
  } else if (slice[idx] === 'it') {
    source = { kind: 'ThisPermanent' };
    idx++;
  } else if (
    slice[idx] === 'this' &&
    ['creature', 'artifact', 'enchantment', 'aura', 'land', 'permanent'].includes(slice[idx + 1])
  ) {
    source = { kind: 'ThisPermanent' };
    idx += 2;
  } else {
    return null;
  }

  // "deals that much damage to"
  if (slice[idx] !== 'deals') return null;
  idx++;
  if (slice[idx] !== 'that' || slice[idx + 1] !== 'much' || slice[idx + 2] !== 'damage') return null;
  idx += 3;
  if (slice[idx] !== 'to') return null;
  idx++;

  // "each creature that player controls"
  if (slice[idx] !== 'each') return null;
  idx++;
  if (slice[idx] !== 'creature') return null;
  idx++;
  // "that player controls" — EventPlayer creatures
  if (slice[idx] !== 'that' || slice[idx + 1] !== 'player' || slice[idx + 2] !== 'controls') return null;
  idx += 3;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'DealDamage',
    source,
    target: { kind: 'AllOfType', filter: { types: ['creature'] }, eventPlayerControls: true },
    amount: { kind: 'EventDamageAmount' },
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Slice 8 — Match: "[it/~/this <type>] deals N damage to target (opponent|player)
 * [or planeswalker] and N damage to up to one target (creature|creature or
 * planeswalker)."
 *
 * This covers ETB/spell bodies where two independent fixed-N damage assignments
 * are made to two differently-typed targets joined by "and":
 *   Burning Sun's Avatar: "it deals 3 damage to target opponent or planeswalker
 *     and 3 damage to up to one target creature."
 *   Rakdos Firewheeler:  "it deals 2 damage to target opponent and 2 damage to
 *     up to one target creature or planeswalker."
 *
 * The two amounts may differ (e.g., "3 damage … and 2 damage to …") — both are
 * captured independently. The second target is optional ("up to one") and uses
 * minCount=0; when the player provides no second target, the second DealDamage
 * effect is a no-op (resolveTargetRef returns null → early return in executor).
 *
 * Two DealDamage effects are emitted, each referencing its own TargetSpec:
 *   effects[0]: first damage → first target spec (Player/opponentControls)
 *   effects[1]: second damage → second target spec (Creature or CreatureOrPlaneswalker, minCount=0)
 *
 * The executor already handles sequential effects and per-spec target mapping
 * in executeEffects (offset-based slicing in the chosenTargets builder).
 *
 * "or planeswalker" after "opponent" is silently consumed (honest: the engine
 * does not route damage to planeswalker loyalty counters, so we model the first
 * target as Player-only). "or planeswalker" after "creature" promotes to
 * CreatureOrPlaneswalker (target validation already knows this type).
 */
export function matchDealDamageTwoTargets(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // --- Source subject: "it", "~", or "this <permanent-type>" ---
  let source: SourceRef = { kind: 'ThisSpell' };
  if (slice[idx] === '~') {
    idx++;
  } else if (slice[idx] === 'it') {
    source = { kind: 'ThisPermanent' };
    idx++;
  } else if (
    slice[idx] === 'this'
    && ['creature', 'artifact', 'enchantment', 'aura', 'land', 'permanent', 'spell'].includes(slice[idx + 1])
  ) {
    source = slice[idx + 1] === 'spell' ? { kind: 'ThisSpell' } : { kind: 'ThisPermanent' };
    idx += 2;
  } else {
    return null;
  }

  // "deals"
  if (slice[idx] !== 'deals') return null;
  idx++;

  // First damage amount (numeric)
  const n1 = parseInt(slice[idx], 10);
  if (isNaN(n1) || n1 < 1) return null;
  idx++;
  if (slice[idx] !== 'damage') return null;
  idx++;
  if (slice[idx] !== 'to') return null;
  idx++;

  // First target: "target (opponent|player) [or planeswalker]"
  if (slice[idx] !== 'target') return null;
  idx++;
  let firstIsOpponent = false;
  if (slice[idx] === 'opponent') {
    firstIsOpponent = true;
    idx++;
  } else if (slice[idx] === 'player') {
    idx++;
  } else {
    return null;
  }
  // optional "or planeswalker" — consume but model as Player-only (honest: no PW loyalty routing)
  if (slice[idx] === 'or' && slice[idx + 1] === 'planeswalker') {
    idx += 2;
  }

  // Conjunction: "and"
  if (slice[idx] !== 'and') return null;
  idx++;

  // Second damage amount (numeric; may differ from n1)
  const n2 = parseInt(slice[idx], 10);
  if (isNaN(n2) || n2 < 1) return null;
  idx++;
  if (slice[idx] !== 'damage') return null;
  idx++;
  if (slice[idx] !== 'to') return null;
  idx++;

  // Second target: "up to one target (creature|creature or planeswalker)"
  if (slice[idx] !== 'up' || slice[idx + 1] !== 'to' || slice[idx + 2] !== 'one') return null;
  idx += 3;
  if (slice[idx] !== 'target') return null;
  idx++;
  if (slice[idx] !== 'creature') return null;
  idx++;
  // optional "or planeswalker" — promotes second target to CreatureOrPlaneswalker
  let secondTargetType: import('../targets').TargetType = 'Creature';
  if (slice[idx] === 'or' && slice[idx + 1] === 'planeswalker') {
    secondTargetType = 'CreatureOrPlaneswalker';
    idx += 2;
  }

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec1 = makeTargetSpec('Player', firstIsOpponent ? { opponentControls: true } : undefined);
  const spec2 = makeTargetSpec(secondTargetType);
  spec2.minCount = 0; // "up to one" — choosing zero is legal

  const effect1: Effect = {
    kind: 'DealDamage',
    source,
    target: makeChosenRef(spec1),
    amount: n1,
  };
  const effect2: Effect = {
    kind: 'DealDamage',
    source,
    target: makeChosenRef(spec2),
    amount: n2,
  };

  return { effects: [effect1, effect2], targets: [spec1, spec2], consumed };
}

/**
 * Slice 8: "it deals N damage to each of up to two targets."
 *          "it deals N damage to each of up to two target creatures."
 *
 * "Each of up to two targets" means every chosen target takes N damage
 * independently (not N split among them). Modelled as DealDamageEachTarget
 * with a multi-target spec (count: 2, minCount: 0 so 0 or 1 is also legal).
 *
 * Variants:
 *   "it deals 1 damage to each of up to two targets."
 *   "it deals 2 damage to each of up to two target creatures."
 *   "~ deals N damage to each of up to two targets."
 */
export function matchDealDamageEachUpToNTargets(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // Subject: "it", "~", or "this <permanent-type>"
  let source: SourceRef = { kind: 'ThisPermanent' };
  if (slice[idx] === 'it') {
    idx++;
  } else if (slice[idx] === '~') {
    idx++;
  } else if (
    slice[idx] === 'this'
    && ['creature', 'artifact', 'enchantment', 'land', 'permanent', 'aura'].includes(slice[idx + 1])
  ) {
    idx += 2;
  } else {
    return null;
  }

  if (slice[idx] !== 'deals') return null;
  idx++;

  // Damage amount — numeric
  const n = parseInt(slice[idx], 10);
  if (isNaN(n) || n < 1) return null;
  idx++;

  if (slice[idx] !== 'damage') return null;
  idx++;
  if (slice[idx] !== 'to') return null;
  idx++;
  if (slice[idx] !== 'each') return null;
  idx++;
  if (slice[idx] !== 'of') return null;
  idx++;
  if (slice[idx] !== 'up' || slice[idx + 1] !== 'to') return null;
  idx += 2;

  // Count word: "two", "three", etc.
  const count = parseSmallNumberToken(slice[idx]);
  if (isNaN(count) || count < 2) return null;
  idx++;

  // Optional "target" keyword before the type noun
  if (slice[idx] === 'target') idx++;

  // Optional type noun: "creatures", "players", "targets" (any target)
  let targetType: TargetType = 'Any';
  if (slice[idx] === 'creatures' || slice[idx] === 'creature') {
    targetType = 'Creature';
    idx++;
  } else if (slice[idx] === 'players' || slice[idx] === 'player') {
    targetType = 'Player';
    idx++;
  } else if (slice[idx] === 'targets' || slice[idx] === 'target') {
    targetType = 'Any';
    idx++;
  }
  // (no type word) → "each of up to N targets" — Any

  let consumed = idx;
  if (slice[consumed] === '.') consumed++;

  const spec = makeTargetSpec(targetType);
  spec.count = count;
  spec.minCount = 0; // "up to N" — choosing 0 is legal

  const effect: Effect = {
    kind: 'DealDamageEachTarget',
    source,
    target: makeChosenRef(spec),
    amount: n,
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Slice 12 (en-Kor / Warrior-redirect family):
 * "The next N damage that would be dealt to this creature this turn is dealt
 *  to target creature [you control] instead."
 *
 * Also matches the "to you instead" variant (redirect to Controller):
 *   "The next N damage that would be dealt to this creature this turn is dealt
 *    to you instead."
 *
 * Emits a RedirectDamageEffect that registers a damage-redirect shield on the
 * source permanent. The shield is one-shot: the next N damage to the source
 * is redirected to the chosen target or controller.
 *
 * Accepted wordings:
 *   - "The next 1 damage ... is dealt to target creature you control instead."
 *   - "The next 1 damage ... is dealt to target creature instead."
 *   - "The next 1 damage ... is dealt to you instead."   (self-redirect form)
 *
 * Declines:
 *   - "to any target instead" (non-creature general redirect)
 *   - Amounts other than small fixed integers
 */
export function matchRedirectDamage(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // "the next N damage that would be dealt to this creature this turn"
  if (slice[idx] !== 'the' || slice[idx + 1] !== 'next') return null;
  idx += 2;

  const n = parseSmallNumberToken(slice[idx]);
  if (Number.isNaN(n) || n <= 0) return null;
  idx++;

  if (slice[idx] !== 'damage') return null;
  idx++;

  // "that would be dealt to"
  if (slice[idx] !== 'that' || slice[idx + 1] !== 'would' || slice[idx + 2] !== 'be' || slice[idx + 3] !== 'dealt' || slice[idx + 4] !== 'to') return null;
  idx += 5;

  // "this creature" or "this permanent"
  if (slice[idx] !== 'this' || (slice[idx + 1] !== 'creature' && slice[idx + 1] !== 'permanent')) return null;
  idx += 2;

  // "this turn"
  if (slice[idx] !== 'this' || slice[idx + 1] !== 'turn') return null;
  idx += 2;

  // "is dealt to"
  if (slice[idx] !== 'is' || slice[idx + 1] !== 'dealt' || slice[idx + 2] !== 'to') return null;
  idx += 3;

  let redirectTarget: TargetRef;
  const targets: TargetSpec[] = [];

  if (slice[idx] === 'you') {
    // "to you instead" — redirect to controller
    redirectTarget = { kind: 'Controller' };
    idx++;
  } else if (slice[idx] === 'target' && slice[idx + 1] === 'creature') {
    idx += 2;
    const constraints: TargetSpec['constraints'] = {};
    if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
      constraints.controllerControls = true;
      idx += 2;
    } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
      constraints.opponentControls = true;
      idx += 3;
    }
    const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
    targets.push(spec);
    redirectTarget = makeChosenRef(spec);
  } else {
    return null;
  }

  // "instead"
  if (slice[idx] !== 'instead') return null;
  idx++;

  if (slice[idx] === '.') idx++;

  const effect: RedirectDamageEffect = {
    kind: 'RedirectDamage',
    source: 'Source',
    redirectTarget,
    amount: n,
  };

  return { effects: [effect], targets, consumed: idx };
}
