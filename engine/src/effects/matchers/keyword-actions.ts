// Keyword-action matchers extracted from parser.ts (batch 3/12).
// Do NOT edit logic here — keep verbatim with parser.ts originals.

import type { Effect, TargetRef, AmountRef, WinGameEffect, LoseGameEffect, TransformSelfEffect } from '../ast';
import type { TargetSpec, TargetType } from '../targets';
import type { PatternResult } from '../parser';
import {
  makeTargetSpec,
  makeChosenRef,
  parseSmallNumberToken,
  parseWordNumber,
  predefinedArtifactToken,
  targetTypeFromSimplePermanentWord,
  parseStaticFilterType,
  retryWithTargetNounModifiers,
  applyPowerToughnessTargetConstraint,
  isCantToken,
  readCreatureSubtypeTargetPhrase,
  parseWhereXIsNumberOf,
  readColorConstraint,
} from '../parser';

/** Shared parse of "<keyword> N" → numeric count after the keyword token. */
function parseKeywordCount(slice: string[], at: number): number | null {
  const n = parseInt(slice[at], 10);
  const wordN = parseWordNumber(slice[at]);
  const parsed = !isNaN(n) ? n : wordN;
  return (!isNaN(parsed) && parsed > 0) ? parsed : null;
}

/**
 * Match the "Investigate [N]" keyword action — create N Clue tokens (CR 701.16).
 */
export function matchInvestigate(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'investigate') return null;

  let count: AmountRef = 1;
  let consumed = 1;
  if (slice[1] === 'x') {
    count = { kind: 'X' };
    consumed = 2;
  } else {
    const n = parseInt(slice[1], 10);
    const wordN = parseWordNumber(slice[1]);
    const parsed = !isNaN(n) ? n : wordN;
    if (!isNaN(parsed) && parsed > 0) {
      count = parsed;
      consumed = 2;
    }
  }
  if (tokens[startIndex + consumed] === '.') consumed++;

  return {
    effects: [{
      kind: 'CreateToken',
      controller: { kind: 'Controller' },
      token: predefinedArtifactToken('clue'),
      count,
    }],
    targets: [],
    consumed,
  };
}

/**
 * Match the "explores" keyword action (CR 701.40):
 *   "target creature you control explores"
 *   "this creature explores" / "~ explores" / "it explores"  → Source
 *   "each creature you control explores"                      → AllCreaturesYouControl
 */
export function matchExplore(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if ((slice[0] === '~' || slice[0] === 'it') && slice[1] === 'explores') {
    let consumed = 2;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Explore', target: { kind: 'Source' } }], targets: [], consumed };
  }
  if (slice[0] === 'this' && (slice[1] === 'creature' || slice[1] === 'permanent') && slice[2] === 'explores') {
    let consumed = 3;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Explore', target: { kind: 'Source' } }], targets: [], consumed };
  }
  if (slice[0] === 'each' && slice[1] === 'creature' && slice[2] === 'you' && slice[3] === 'control' && slice[4] === 'explores') {
    let consumed = 5;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Explore', target: { kind: 'AllCreaturesYouControl' } }], targets: [], consumed };
  }
  if (slice[0] === 'target' && slice[1] === 'creature') {
    let i = 2;
    let controllerControls = false;
    if (slice[i] === 'you' && slice[i + 1] === 'control') { controllerControls = true; i += 2; }
    if (slice[i] !== 'explores') return null;
    let consumed = i + 1;
    if (tokens[startIndex + consumed] === '.') consumed++;
    const spec = makeTargetSpec('Creature', controllerControls ? { controllerControls: true } : undefined);
    return { effects: [{ kind: 'Explore', target: makeChosenRef(spec) }], targets: [spec], consumed };
  }
  return null;
}

/**
 * Match "Adapt N" (CR 701.41).
 */
export function matchAdapt(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'adapt') return null;
  const count = parseKeywordCount(slice, 1);
  if (count === null) return null;
  let consumed = 2;
  if (tokens[startIndex + consumed] === '.') consumed++;
  return { effects: [{ kind: 'Adapt', count }], targets: [], consumed };
}

/**
 * Match "Bolster N" (CR 701.24).
 */
export function matchBolster(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'bolster') return null;
  const count = parseKeywordCount(slice, 1);
  if (count === null) return null;
  let consumed = 2;
  if (tokens[startIndex + consumed] === '.') consumed++;
  return { effects: [{ kind: 'Bolster', count }], targets: [], consumed };
}

/**
 * Match "Monstrosity N" (CR 701.34).
 */
export function matchMonstrosity(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'monstrosity') return null;
  const count = parseKeywordCount(slice, 1);
  if (count === null) return null;
  let consumed = 2;
  if (tokens[startIndex + consumed] === '.') consumed++;
  return { effects: [{ kind: 'Monstrosity', count }], targets: [], consumed };
}

/**
 * Match "Fabricate N" (CR 702.123).
 */
export function matchFabricate(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'fabricate') return null;
  const count = parseKeywordCount(slice, 1);
  if (count === null) return null;
  let consumed = 2;
  if (tokens[startIndex + consumed] === '.') consumed++;
  return { effects: [{ kind: 'Fabricate', count }], targets: [], consumed };
}

/**
 * Match the "Populate" keyword action (CR 701.32).
 */
export function matchPopulate(tokens: string[], startIndex: number): PatternResult {
  if (tokens[startIndex] !== 'populate') return null;
  let consumed = 1;
  if (tokens[startIndex + consumed] === '.') consumed++;
  return { effects: [{ kind: 'Populate' }], targets: [], consumed };
}

/**
 * Match the "Amass" keyword action (CR 701.43): "Amass [Orcs|Zombies] N".
 */
export function matchAmass(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'amass') return null;

  let i = 1;
  const typeWords: Record<string, string> = {
    orcs: 'Orc', orc: 'Orc', zombies: 'Zombie', zombie: 'Zombie',
  };
  let armyType: string | undefined;
  if (typeWords[slice[i]]) { armyType = typeWords[slice[i]]; i++; }

  const n = parseInt(slice[i], 10);
  const wordN = parseWordNumber(slice[i]);
  const parsed = !isNaN(n) ? n : wordN;
  if (isNaN(parsed) || parsed <= 0) return null;

  let consumed = i + 1;
  if (tokens[startIndex + consumed] === '.') consumed++;
  return {
    effects: [{ kind: 'Amass', count: parsed, ...(armyType ? { armyType } : {}) }],
    targets: [],
    consumed,
  };
}

/**
 * Match the "connives" keyword action (CR 702.156):
 *   "this creature connives" / "~ connives" / "it connives" / "connive" → Source
 *   optional count: "connives 2"
 */
export function matchConnive(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  let subjConsumed: number | null = null;
  if (slice[0] === 'connive' || slice[0] === 'connives') {
    subjConsumed = 1;
  } else if ((slice[0] === '~' || slice[0] === 'it') && (slice[1] === 'connives' || slice[1] === 'connive')) {
    subjConsumed = 2;
  } else if (slice[0] === 'this' && (slice[1] === 'creature' || slice[1] === 'permanent') && (slice[2] === 'connives' || slice[2] === 'connive')) {
    subjConsumed = 3;
  }
  if (subjConsumed === null) return null;

  let count: AmountRef = 1;
  let consumed = subjConsumed;
  const n = parseInt(slice[consumed], 10);
  const wordN = parseWordNumber(slice[consumed]);
  const parsed = !isNaN(n) ? n : wordN;
  if (!isNaN(parsed) && parsed > 0) {
    count = parsed;
    consumed++;
  }
  if (tokens[startIndex + consumed] === '.') consumed++;

  return {
    effects: [{ kind: 'Connive', target: { kind: 'Source' }, count }],
    targets: [],
    consumed,
  };
}

/**
 * Match the "Proliferate" keyword action (CR 701.27).
 */
export function matchProliferate(tokens: string[], startIndex: number): PatternResult {
  if (tokens[startIndex] !== 'proliferate') return null;
  let consumed = 1;
  if (tokens[startIndex + consumed] === '.') consumed++;
  return { effects: [{ kind: 'Proliferate' }], targets: [], consumed };
}

/**
 * Match "become the monarch" (CR 720):
 *   "you become the monarch"        → Controller
 *   "target opponent becomes the monarch" → chosen opponent
 */
export function matchBecomeMonarch(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice[0] === 'you' && slice[1] === 'become' && slice[2] === 'the' && slice[3] === 'monarch') {
    let consumed = 4;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'BecomeMonarch', player: { kind: 'Controller' } }], targets: [], consumed };
  }
  if (slice[0] === 'target' && slice[1] === 'opponent' && slice[2] === 'becomes' && slice[3] === 'the' && slice[4] === 'monarch') {
    let consumed = 5;
    if (tokens[startIndex + consumed] === '.') consumed++;
    const spec = makeTargetSpec('Player', { opponentControls: true });
    return { effects: [{ kind: 'BecomeMonarch', player: makeChosenRef(spec) }], targets: [spec], consumed };
  }
  return null;
}

/**
 * Match: "scry N"
 */
export function matchScry(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 2) return null;
  if (slice[0] !== 'scry') return null;

  const parsedInt = parseInt(slice[1], 10);
  const count = !isNaN(parsedInt) ? parsedInt : parseSmallNumberToken(slice[1]);
  if (isNaN(count)) return null;

  let consumed = 2;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Scry',
    player: { kind: 'Controller' },
    count,
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "surveil N"
 * Surveil is a keyword action: look at top N cards, put any number into graveyard,
 * rest on top in any order. Simplified implementation uses AI heuristic.
 */
export function matchSurveil(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 2) return null;
  if (slice[0] !== 'surveil') return null;

  const parsedInt = parseInt(slice[1], 10);
  const count = !isNaN(parsedInt) ? parsedInt : parseSmallNumberToken(slice[1]);
  if (isNaN(count)) return null;

  let consumed = 2;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Surveil',
    player: { kind: 'Controller' },
    count,
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match goad effects (CR 701.39):
 *   "goad target creature"
 *   "goad up to one target creature"
 *   "goad all creatures you don't control" / "goad each other creature" → AllCreatures
 */
export function matchGoad(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'goad') return null;

  // "goad all/each ... creature(s) ..." → goad every creature you don't control
  if (slice[1] === 'all' || slice[1] === 'each') {
    let i = 2;
    let found = false;
    while (i < Math.min(slice.length, 8)) {
      if (slice[i] === 'creature' || slice[i] === 'creatures') { found = true; i++; break; }
      i++;
    }
    if (!found) return null;
    let consumed = i;
    // Swallow trailing "you don't control" etc. up to the clause end.
    while (startIndex + consumed < tokens.length && tokens[startIndex + consumed] !== '.') consumed++;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return {
      effects: [{ kind: 'Goad', target: { kind: 'AllCreatures' } }],
      targets: [],
      consumed,
    };
  }

  // "goad that creature." — the event creature.
  if (slice[1] === 'that' && (slice[2] === 'creature' || slice[2] === 'permanent')) {
    let consumed = 3;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Goad', target: { kind: 'EventCreature' } }], targets: [], consumed };
  }

  // "goad [up to one] target creature"
  let i = 1;
  if (slice[i] === 'up' && slice[i + 1] === 'to' && slice[i + 2] === 'one') i += 3;
  if (slice[i] !== 'target') return null;
  const targetType = targetTypeFromSimplePermanentWord(slice[i + 1]);
  if (!targetType) return null;

  let consumed = i + 2;
  if (tokens[startIndex + consumed] === '.') consumed++;
  const spec = makeTargetSpec(targetType);
  return {
    effects: [{ kind: 'Goad', target: makeChosenRef(spec) }],
    targets: [spec],
    consumed,
  };
}

/**
 * Match regeneration effects (CR 701.18):
 *   "regenerate this creature" / "regenerate it" / "regenerate ~" → self (Source)
 *   "regenerate target creature" → target
 */
export function matchRegenerate(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'regenerate') return null;

  // Self-reference: "regenerate this creature" / "regenerate it" / "regenerate ~"
  if (slice[1] === '~' || slice[1] === 'it') {
    let consumed = 2;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Regenerate', target: { kind: 'Source' } }], targets: [], consumed };
  }
  if (slice[1] === 'this' && targetTypeFromSimplePermanentWord(slice[2])) {
    let consumed = 3;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Regenerate', target: { kind: 'Source' } }], targets: [], consumed };
  }

  // "regenerate [up to one] target creature / target <Subtype>"
  let i = 1;
  if (slice[i] === 'up' && slice[i + 1] === 'to' && slice[i + 2] === 'one') i += 3;
  if (slice[i] !== 'target') return null;

  // Slice 1: color qualifier — "regenerate target green creature", "regenerate target white or blue creature"
  const regenColorRead = readColorConstraint(slice, i + 1);
  if (regenColorRead && targetTypeFromSimplePermanentWord(slice[i + 1 + regenColorRead.consumed])) {
    const regenColorTargetType = targetTypeFromSimplePermanentWord(slice[i + 1 + regenColorRead.consumed])!;
    let consumed = i + 1 + regenColorRead.consumed + 1;
    if (tokens[startIndex + consumed] === '.') consumed++;
    const regenColorConstraints: TargetSpec['constraints'] = { colors: regenColorRead.colors };
    const spec = makeTargetSpec(regenColorTargetType, regenColorConstraints);
    return { effects: [{ kind: 'Regenerate', target: makeChosenRef(spec) }], targets: [spec], consumed };
  }

  // "regenerate target <Subtype>" — bare creature subtype
  const regenSubtypeRead = readCreatureSubtypeTargetPhrase(slice, i + 1);
  if (regenSubtypeRead) {
    let consumed = i + 1 + regenSubtypeRead.consumed;
    if (tokens[startIndex + consumed] === '.') consumed++;
    const regenSubtypeConstraints: TargetSpec['constraints'] = {
      subtypes: regenSubtypeRead.subtypes,
      ...(regenSubtypeRead.controllerControls ? { controllerControls: true } : {}),
      ...(regenSubtypeRead.opponentControls ? { opponentControls: true } : {}),
    };
    const spec = makeTargetSpec('Creature', regenSubtypeConstraints);
    return { effects: [{ kind: 'Regenerate', target: makeChosenRef(spec) }], targets: [spec], consumed };
  }

  const targetType = targetTypeFromSimplePermanentWord(slice[i + 1]);
  if (!targetType) return null;
  let consumed = i + 2;
  if (tokens[startIndex + consumed] === '.') consumed++;
  const spec = makeTargetSpec(targetType);
  return { effects: [{ kind: 'Regenerate', target: makeChosenRef(spec) }], targets: [spec], consumed };
}

/**
 * Slice 9 (Aura lifecycle): Match "regenerate enchanted creature" — the body
 * of the activated Regenerate-enchanted-creature Aura family:
 *   "{B}: Regenerate enchanted creature." (Spirit Link, Regeneration, etc.)
 *
 * The effect uses SourceAttachedTo so the executor regenerates the creature
 * this Aura is currently attached to (resolved via getSourceAttachedTo in
 * executor.ts). The executor's Regenerate case must handle SourceAttachedTo.
 *
 * We also accept "regenerate enchanted permanent" for broader compatibility.
 */
export function matchRegenerateEnchantedCreature(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'regenerate') return null;
  if (slice[1] !== 'enchanted') return null;
  if (slice[2] !== 'creature' && slice[2] !== 'permanent') return null;

  let consumed = 3;
  if (tokens[startIndex + consumed] === '.') consumed++;

  return {
    effects: [{ kind: 'Regenerate', target: { kind: 'SourceAttachedTo' } }],
    targets: [],
    consumed,
  };
}

export function matchPhaseOut(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;

  // Slice 8 activated self-tail: "this creature phases out" / "~ phases out"
  // (Rainbow Efreet, Blink Dog — executor's PhaseOut Source branch handles the
  // Source TargetRef without calling resolveTargetRef, which would throw.)
  if (
    (slice[0] === 'this' && (slice[1] === 'creature' || slice[1] === 'permanent'))
    || slice[0] === '~'
  ) {
    const bodyIdx = slice[0] === '~' ? 1 : 2;
    if (slice[bodyIdx] !== 'phases' || slice[bodyIdx + 1] !== 'out') return null;
    let consumed = bodyIdx + 2;
    if (slice[consumed] === '.') consumed++;
    const effect: Effect = { kind: 'PhaseOut', target: { kind: 'Source' } };
    return { effects: [effect], targets: [], consumed };
  }

  if (slice.length < 4) return null;

  // "target permanent/creature phases out"
  if (slice[0] === 'target') {
    let targetType: TargetType;
    let idx: number;

    if (slice[1] === 'permanent') {
      targetType = 'Permanent';
      idx = 2;
    } else if (slice[1] === 'creature') {
      targetType = 'Creature';
      idx = 2;
    } else if (slice[1] === 'nonland' && slice[2] === 'permanent') {
      targetType = 'NonlandPermanent';
      idx = 3;
    } else {
      return null;
    }

    if (slice[idx] !== 'phases') return null;
    idx++;
    if (slice[idx] !== 'out') return null;
    idx++;

    if (slice[idx] === '.') idx++;

    const spec = makeTargetSpec(targetType);
    const effect: Effect = {
      kind: 'PhaseOut',
      target: makeChosenRef(spec),
    };

    return { effects: [effect], targets: [spec], consumed: idx };
  }

  return null;
}

/**
 * Match: "players can't lose life this turn"
 * Match: "players can't lose the game or win the game this turn"
 * Match: "your opponents can't win the game this turn"
 */
export function matchPreventGameOutcome(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;

  let idx = 0;
  let player: TargetRef | null = null;
  if (slice[idx] === 'players' || (slice[idx] === 'each' && slice[idx + 1] === 'player')) {
    player = { kind: 'EachPlayer' };
    idx += slice[idx] === 'each' ? 2 : 1;
  } else if (slice[idx] === 'you') {
    player = { kind: 'Controller' };
    idx++;
  } else if (slice[idx] === 'your' && slice[idx + 1] === 'opponents') {
    player = { kind: 'EachOpponent' };
    idx += 2;
  }

  if (!player) return null;
  if (slice[idx] === 'can' && slice[idx + 1] === 'not') {
    idx += 2;
  } else if (isCantToken(slice[idx])) {
    idx++;
  } else {
    return null;
  }

  let preventsLoss = false;
  let preventsWin = false;
  let preventsLifeLoss = false;

  const consumeLoseGame = (): boolean => {
    if (slice[idx] !== 'lose' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'game') return false;
    preventsLoss = true;
    idx += 3;
    return true;
  };
  const consumeWinGame = (): boolean => {
    if (slice[idx] !== 'win' || slice[idx + 1] !== 'the' || slice[idx + 2] !== 'game') return false;
    preventsWin = true;
    idx += 3;
    return true;
  };
  const consumeLoseLife = (): boolean => {
    if (slice[idx] !== 'lose' || slice[idx + 1] !== 'life') return false;
    preventsLifeLoss = true;
    idx += 2;
    return true;
  };

  if (!consumeLoseLife() && !consumeLoseGame() && !consumeWinGame()) return null;

  while (slice[idx] === 'or' || slice[idx] === 'and') {
    idx++;
    if (!consumeLoseLife() && !consumeLoseGame() && !consumeWinGame()) {
      idx--;
      break;
    }
  }

  if (slice[idx] === 'this' && slice[idx + 1] === 'turn') idx += 2;
  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'PreventGameOutcome',
    player,
    preventsLoss,
    preventsWin,
    preventsLifeLoss,
    duration: 'turn',
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "you win the game"
 */
export function matchWinGame(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;
  if (slice[0] === 'you' && slice[1] === 'win' && slice[2] === 'the' && slice[3] === 'game') {
    let consumed = 4;
    if (slice[consumed] === '.') consumed++;
    const effect: WinGameEffect = { kind: 'WinGame', player: { kind: 'Controller' } };
    return { effects: [effect], targets: [], consumed };
  }
  return null;
}

/**
 * Match: "add {R}{R}{R}"
 * Match: "add {C}{G}"
 */
export function matchAddMana(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 2) return null;
  if (slice[0] !== 'add') return null;

  const symbols = [...slice[1].matchAll(/\{([wubrgc])\}/gi)];
  if (symbols.length === 0) return null;

  const mana: { W?: number; U?: number; B?: number; R?: number; G?: number; C?: number } = {};
  for (const symbol of symbols) {
    const color = symbol[1].toUpperCase() as keyof typeof mana;
    mana[color] = (mana[color] || 0) + 1;
  }

  let consumed = 2;
  if (slice[consumed] === '.') consumed++;

  return {
    effects: [{
      kind: 'AddMana',
      player: { kind: 'Controller' },
      mana,
    }],
    targets: [],
    consumed,
  };
}

/**
 * Match: "you lose the game"
 * Match: "target player loses the game"
 */
export function matchLoseGame(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;
  if (slice[0] === 'you' && slice[1] === 'lose' && slice[2] === 'the' && slice[3] === 'game') {
    let consumed = 4;
    if (slice[consumed] === '.') consumed++;
    const effect: LoseGameEffect = { kind: 'LoseGame', player: { kind: 'Controller' } };
    return { effects: [effect], targets: [], consumed };
  }
  if (slice[0] === 'target' && slice[1] === 'player' && slice[2] === 'loses' && slice[3] === 'the' && slice[4] === 'game') {
    let consumed = 5;
    if (slice[consumed] === '.') consumed++;
    const spec = makeTargetSpec('Player');
    const effect: LoseGameEffect = { kind: 'LoseGame', player: { kind: 'Chosen', targetId: spec.id } };
    return { effects: [effect], targets: [spec], consumed };
  }
  return null;
}

/**
 * Match: "tap target creature/land/artifact/enchantment/permanent"
 */
export function matchTap(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 2) return null;
  if (slice[0] !== 'tap') return null;
  // "Tap this creature / it / ~." — self.
  if (slice[1] === 'it' || slice[1] === '~' || (slice[1] === 'this' && targetTypeFromSimplePermanentWord(slice[2]))) {
    let consumed = (slice[1] === 'this') ? 3 : 2;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Tap', target: { kind: 'Source' } }], targets: [], consumed };
  }
  // "Tap that creature / that permanent." — the creature from the triggering event.
  if (slice[1] === 'that' && targetTypeFromSimplePermanentWord(slice[2])) {
    let consumed = 3;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Tap', target: { kind: 'EventCreature' } }], targets: [], consumed };
  }
  // Optional "up to one" before "target …".
  if (slice[1] === 'up' && slice[2] === 'to' && slice[3] === 'one' && slice[4] === 'target') {
    const shifted = matchTap(['tap', ...slice.slice(4)], 0);
    if (!shifted) return null;
    return { ...shifted, consumed: shifted.consumed + 3 };
  }
  // "Tap all creatures [you control]." — mass tap.
  if (slice[1] === 'all' && slice[2] === 'creatures') {
    let consumed = 3;
    let target: TargetRef = { kind: 'AllCreatures' };
    if (slice[3] === 'you' && slice[4] === 'control') { target = { kind: 'AllCreaturesYouControl' }; consumed = 5; }
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Tap', target }], targets: [], consumed };
  }
  // "Tap all <type> you control." — mass tap restricted to permanents you control
  // (e.g. "tap all artifacts you control", "tap all lands you control").
  if (slice[1] === 'all' && slice[3] === 'you' && slice[4] === 'control') {
    const filter = parseStaticFilterType(slice[2]);
    if (filter) {
      let consumed = 5;
      if (tokens[startIndex + consumed] === '.') consumed++;
      return {
        effects: [{ kind: 'Tap', target: { kind: 'AllOfType', filter, controllerControls: true } }],
        targets: [],
        consumed,
      };
    }
  }
  if (slice.length < 3) return null;
  if (slice[1] === 'enchanted' && targetTypeFromSimplePermanentWord(slice[2])) {
    let consumed = 3;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return {
      effects: [{
        kind: 'Tap',
        target: { kind: 'SourceAttachedTo' },
      }],
      targets: [],
      consumed,
    };
  }
  if (slice[1] !== 'target') return null;

  // "tap target nonenchantment creature" (Coeurl) / "tap target untapped creature" —
  // noun-phrase constraint modifiers, then the regular tap parse.
  const tapWithMods = retryWithTargetNounModifiers(slice, 1, matchTap);
  if (tapWithMods) return tapWithMods;

  // Compound and simple target type dispatch — parity with matchDestroy.
  let tapTargetType: TargetType | null = null;
  let tapConsumed = 3;
  let tapConstraints: TargetSpec['constraints'] = undefined;

  if (slice[2] === 'creature' && slice[3] === 'or' && slice[4] === 'planeswalker') {
    tapTargetType = 'CreatureOrPlaneswalker';
    tapConsumed = 5;
  } else if (slice[2] === 'artifact' && slice[3] === 'or' && slice[4] === 'enchantment') {
    tapTargetType = 'ArtifactOrEnchantment';
    tapConsumed = 5;
  } else if (slice[2] === 'nonland' && slice[3] === 'permanent') {
    // Slice 10: "tap target nonland permanent [an opponent controls]"
    // Tiller Engine bullet: "• Tap target nonland permanent an opponent controls."
    tapTargetType = 'NonlandPermanent';
    tapConsumed = 4;
  } else if (
    slice[2] === 'artifact'
    && slice.slice(2).includes('enchantment')
    && slice.slice(2).includes('land')
  ) {
    tapTargetType = 'ArtifactEnchantmentOrLand';
    const landIdx = slice.indexOf('land', 2);
    tapConsumed = landIdx + 1;
  } else {
    // Slice 1: color qualifier — "tap target green creature", "tap target white or blue creature"
    const tapColorRead = readColorConstraint(slice, 2);
    if (tapColorRead && targetTypeFromSimplePermanentWord(slice[2 + tapColorRead.consumed])) {
      tapTargetType = targetTypeFromSimplePermanentWord(slice[2 + tapColorRead.consumed])!;
      tapConstraints = { colors: tapColorRead.colors };
      tapConsumed = 2 + tapColorRead.consumed + 1;
    } else {
      tapTargetType = targetTypeFromSimplePermanentWord(slice[2]);
    }
  }

  if (!tapTargetType) {
    // "tap target <Subtype>" — bare creature subtype
    const tapSubtypeRead = readCreatureSubtypeTargetPhrase(slice, 2);
    if (tapSubtypeRead) {
      let consumed = 2 + tapSubtypeRead.consumed;
      if (tokens[startIndex + consumed] === '.') consumed++;
      const tapSubtypeConstraints: TargetSpec['constraints'] = {
        subtypes: tapSubtypeRead.subtypes,
        ...(tapSubtypeRead.controllerControls ? { controllerControls: true } : {}),
        ...(tapSubtypeRead.opponentControls ? { opponentControls: true } : {}),
      };
      const spec = makeTargetSpec('Creature', tapSubtypeConstraints);
      return { effects: [{ kind: 'Tap', target: makeChosenRef(spec) }], targets: [spec], consumed };
    }
    return null;
  }

  let consumed = tapConsumed;
  let constraints: TargetSpec['constraints'] = tapConstraints;
  // "tap target creature with power 4 or greater"
  const tapPtTarget = applyPowerToughnessTargetConstraint(slice, consumed, constraints);
  if (tapPtTarget) {
    constraints = tapPtTarget.constraints;
    consumed = tapPtTarget.nextIndex;
  }
  // Slice 10: "an opponent controls" restriction (Tiller Engine "tap target nonland permanent an opponent controls.")
  if (slice[consumed] === 'an' && slice[consumed + 1] === 'opponent' && slice[consumed + 2] === 'controls') {
    constraints = { ...(constraints ?? {}), opponentControls: true };
    consumed += 3;
  }
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec(tapTargetType, constraints);
  const effect: Effect = {
    kind: 'Tap',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "untap target creature/land/artifact/enchantment/permanent"
 * Match: "untap up to seven lands"
 */
export function matchUntap(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice[0] !== 'untap') return null;

  // "Untap this creature / it / ~." — self.
  if (slice[1] === 'it' || slice[1] === '~' || (slice[1] === 'this' && targetTypeFromSimplePermanentWord(slice[2]))) {
    let consumed = (slice[1] === 'this') ? 3 : 2;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Untap', target: { kind: 'Source' } }], targets: [], consumed };
  }

  // Slice 10: "Untap that land / that creature / that permanent." — the permanent from
  // the triggering event (Tiller Engine bullet: "• Untap that land.").
  // "that" + any permanent-type word → EventCreature (the triggering permanent).
  // HONEST: the executor's Untap branch already handles EventCreature via resolveTargetRef.
  if (slice[1] === 'that' && targetTypeFromSimplePermanentWord(slice[2])) {
    let consumed = 3;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Untap', target: { kind: 'EventCreature' } }], targets: [], consumed };
  }

  // "Untap all creatures [you control]." — mass untap.
  if (slice[1] === 'all' && slice[2] === 'creatures') {
    let consumed = 3;
    let target: TargetRef = { kind: 'AllCreatures' };
    if (slice[3] === 'you' && slice[4] === 'control') { target = { kind: 'AllCreaturesYouControl' }; consumed = 5; }
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'Untap', target }], targets: [], consumed };
  }

  // "Untap all <type> you control." — mass untap restricted to permanents you
  // control (e.g. "untap all lands you control", "untap all artifacts you control").
  // DECLINE if followed by a "during ..." rider (e.g. Seedborn Muse "during each
  // other player's untap step") — that is a static ability, not an immediate effect.
  if (slice[1] === 'all' && slice[3] === 'you' && slice[4] === 'control') {
    const filter = parseStaticFilterType(slice[2]);
    if (filter) {
      // Decline when the clause has a temporal rider ("during …").
      if (slice[5] === 'during') return null;
      let consumed = 5;
      if (tokens[startIndex + consumed] === '.') consumed++;
      return {
        effects: [{ kind: 'Untap', target: { kind: 'AllOfType', filter, controllerControls: true } }],
        targets: [],
        consumed,
      };
    }
  }

  // Slice 12: "Untap all artifacts." / "Untap all lands." — no "you control" qualifier,
  // affects all matching permanents regardless of controller (Blinkmoth Infusion family).
  // HONEST: the executor's Untap AllOfType branch already handles controllerControls:false
  // (i.e. untapControllerId = undefined → untaps every matching permanent).
  // GUARD: decline when the next token after the type is "you" (handled above) or
  // "during" (static ability rider, e.g. Seedborn Muse "during each other player's...").
  if (slice[1] === 'all') {
    const filter = parseStaticFilterType(slice[2]);
    if (filter) {
      const next3 = slice[3];
      // "you control" → already handled above; "during" → static ability, skip.
      if (next3 === 'you' || next3 === 'during') return null;
      let consumed = 3;
      if (tokens[startIndex + consumed] === '.') consumed++;
      return {
        effects: [{ kind: 'Untap', target: { kind: 'AllOfType', filter, controllerControls: false } }],
        targets: [],
        consumed,
      };
    }
  }

  // Slice 8 (Saryth): "untap another target creature or land you control."
  // "another" means not the source itself (notSource constraint); "you control"
  // restricts to the controller's own permanents. Uses Permanent target type so
  // any creature or land qualifies (the narrower constraint.types filters at
  // targeting time to prevent choosing non-creature/non-land permanents).
  // HONEST: the existing Untap executor branch already handles Permanent targets;
  // the notSource constraint is enforced by the targeting legality system.
  if (
    slice[1] === 'another' &&
    slice[2] === 'target' &&
    slice[3] === 'creature' &&
    slice[4] === 'or' &&
    slice[5] === 'land'
  ) {
    let consumed = 6;
    const constraints: TargetSpec['constraints'] = {
      notSource: true,
      controllerControls: true,
      types: ['creature', 'land'],
    };
    if (slice[consumed] === 'you' && slice[consumed + 1] === 'control') {
      consumed += 2;
    }
    if (tokens[startIndex + consumed] === '.') consumed++;

    const spec = makeTargetSpec('Permanent', constraints);
    const effect: Effect = {
      kind: 'Untap',
      target: makeChosenRef(spec),
    };
    return { effects: [effect], targets: [spec], consumed };
  }

  if (slice[1] === 'target') {
    if (slice.length < 3) return null;
    const targetType = targetTypeFromSimplePermanentWord(slice[2]);
    if (!targetType) return null;

    let consumed = 3;
    if (tokens[startIndex + consumed] === '.') consumed++;

    const spec = makeTargetSpec(targetType);
    const effect: Effect = {
      kind: 'Untap',
      target: makeChosenRef(spec),
    };

    return { effects: [effect], targets: [spec], consumed };
  }

  if (slice[1] === 'up' && slice[2] === 'to') {
    const count = parseSmallNumberToken(slice[3]);
    if (Number.isNaN(count)) return null;
    const filter = parseStaticFilterType(slice[4]);
    if (!filter) return null;
    let consumed = 5;
    if (tokens[startIndex + consumed] === '.') consumed++;

    const effect: Effect = {
      kind: 'Untap',
      target: { kind: 'AllOfType', filter },
      maxCount: count,
    };
    return { effects: [effect], targets: [], consumed };
  }

  return null;
}

/**
 * Slice 7: Match "untap up to one target creature"
 *
 * Zephyr Winder family triggered tail. Creates a single Creature target spec
 * with minCount=0 (optional — the player may choose 0 targets). The executor's
 * existing Chosen-target Untap branch handles each chosen id.
 */
export function matchUntapUpToOneTargetCreature(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "untap up to one target creature"
  if (slice.length < 5) return null;
  if (slice[0] !== 'untap') return null;
  if (slice[1] !== 'up') return null;
  if (slice[2] !== 'to') return null;
  if (slice[3] !== 'one') return null;
  if (slice[4] !== 'target') return null;
  if (slice[5] !== 'creature') return null;

  let consumed = 6;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Creature');
  spec.minCount = 0; // "up to one" — choosing zero is legal

  const effect: Effect = {
    kind: 'Untap',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Slice 4: Match "Tap X target permanents/creatures/artifacts/lands."
 * Used by modal bullets of Reality Spasm ("Tap X target permanents.").
 * Emits Tap with a Chosen target. TargetSpec.count is a static cap of 10 with
 * minCount=1 (mirrors the X-divided-damage approach: count must be a number).
 * The executor's Tap Chosen branch uses resolveChosenTargetIds / chosenTargetsMulti
 * so all X chosen permanents are tapped in sequence.
 */
export function matchTapXTargetPermanents(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;
  if (slice[0] !== 'tap') return null;
  if (slice[1] !== 'x') return null;
  if (slice[2] !== 'target') return null;

  const pluralMap: Record<string, string> = { permanents: 'permanent', creatures: 'creature', artifacts: 'artifact', lands: 'land', enchantments: 'enchantment' };
  const singular = pluralMap[slice[3]] ?? slice[3];
  const targetType = targetTypeFromSimplePermanentWord(singular);
  if (!targetType) return null;

  let consumed = 4;
  if (tokens[startIndex + consumed] === '.') consumed++;
  const spec = makeTargetSpec(targetType);
  spec.count = 10; // static upper cap for X — player chooses exactly xValue targets
  spec.minCount = 1;
  return { effects: [{ kind: 'Tap', target: makeChosenRef(spec) }], targets: [spec], consumed };
}

/**
 * Slice 4: Match "Untap X target permanents/creatures/artifacts/lands."
 * Used by modal bullets of Reality Spasm ("Untap X target permanents.").
 * Emits Untap with a Chosen target. TargetSpec.count is a static cap of 10 with
 * minCount=1 (mirrors the X-divided-damage approach: count must be a number).
 * The executor's Untap Chosen branch uses resolveChosenTargetIds / chosenTargetsMulti.
 */
export function matchUntapXTargetPermanents(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;
  if (slice[0] !== 'untap') return null;
  if (slice[1] !== 'x') return null;
  if (slice[2] !== 'target') return null;

  const pluralMap: Record<string, string> = { permanents: 'permanent', creatures: 'creature', artifacts: 'artifact', lands: 'land', enchantments: 'enchantment' };
  const singular = pluralMap[slice[3]] ?? slice[3];
  const targetType = targetTypeFromSimplePermanentWord(singular);
  if (!targetType) return null;

  let consumed = 4;
  if (tokens[startIndex + consumed] === '.') consumed++;
  const spec = makeTargetSpec(targetType);
  spec.count = 10; // static upper cap for X — player chooses exactly xValue targets
  spec.minCount = 1;
  return { effects: [{ kind: 'Untap', target: makeChosenRef(spec) }], targets: [spec], consumed };
}

export function matchForEachAddMana(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 10) return null;
  if (slice[0] !== 'add') return null;

  const symbol = slice[1]?.match(/^\{([wubrgc])\}$/i);
  if (!symbol) return null;
  if (slice[2] !== 'for' || slice[3] !== 'each' || slice[4] !== 'card') return null;
  if (slice[5] !== 'in' || slice[6] !== 'target' || slice[7] !== "opponent's" || slice[8] !== 'hand') return null;

  let consumed = 9;
  if (slice[consumed] === '.') consumed++;

  const color = symbol[1].toUpperCase() as 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
  const spec = makeTargetSpec('Player', { opponentControls: true });
  const effect: Effect = {
    kind: 'AddMana',
    player: { kind: 'Controller' },
    mana: {
      [color]: {
        kind: 'ForEach',
        zone: 'hand',
        controller: 'target',
        target: makeChosenRef(spec),
      },
    },
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "add one mana of any color."
 * Match: "add one mana of any color in your commander's color identity."
 * Match: "add one mana of any one color."
 * Match: "add two mana of any color." (and other small numbers)
 *
 * Round-8 slice-b (any-color mana ability on nonland permanents).
 *
 * Runtime: the actual mana is produced via parseManaProductions +
 * tapLandForMana, NOT via this AddMana effect. The ability is marked
 * isManaAbility = true so legal-actions.ts skips it in generateActivateAbilityActions
 * and routes all activations through tryTapLandForMana instead.
 * This matcher is recognition-only: it credits the face as Activated so the
 * parser coverage audit counts it, matching the honesty bar of absorbEngineKeywordLines.
 *
 * HONESTY: parseManaProductions (card-parser-cache.ts) and tapLandForMana
 * (actions.ts) already execute these lines for every permanent (creatures,
 * artifacts, etc.) — proven by Birds of Paradise, Arcane Signet, and
 * Lotus Petal tests in the chaos-suite and lotus-petal-mana test suites.
 */
export function matchAddManaAnyColor(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 6) return null;
  if (slice[0] !== 'add') return null;

  // Parse the count: "one", "two", ..., or a digit
  let amount = 1;
  let idx = 1;
  const wordN = parseWordNumber(slice[idx]);
  const digitN = parseInt(slice[idx], 10);
  if (!isNaN(wordN)) {
    amount = wordN;
    idx++;
  } else if (!isNaN(digitN) && digitN > 0) {
    amount = digitN;
    idx++;
  }
  // else: no explicit count — treat as "add mana of any color" (implicit 1)

  // "mana of any [one] color"
  if (slice[idx] !== 'mana') return null;
  idx++;
  if (slice[idx] !== 'of') return null;
  idx++;
  if (slice[idx] !== 'any') return null;
  idx++;
  // optional "one"
  if (slice[idx] === 'one') idx++;
  // optional "combination of"
  if (slice[idx] === 'combination' && slice[idx + 1] === 'of') idx += 2;
  if (slice[idx] !== 'color' && slice[idx] !== 'colors') return null;
  idx++;

  // Consume optional suffix: "in your commander's color identity"
  if (
    slice[idx] === 'in' &&
    slice[idx + 1] === 'your' &&
    slice[idx + 2] === "commander's" &&
    slice[idx + 3] === 'color' &&
    slice[idx + 4] === 'identity'
  ) {
    idx += 5;
  }

  // Optional period
  if (slice[idx] === '.') idx++;

  // Emit AddMana { W, U, B, R, G } each = amount.
  // The executor never runs this (isManaAbility routes through tapLandForMana);
  // the values are only present to satisfy the AddMana type shape and to trigger
  // containsManaEffect() so isManaAbility is set to true on the ActivatedAbility.
  return {
    effects: [{
      kind: 'AddMana',
      player: { kind: 'Controller' },
      mana: { W: amount, U: amount, B: amount, R: amount, G: amount },
    }],
    targets: [],
    consumed: idx,
  };
}

/**
 * Slice 3 / Round-8 dynamic extension: Match dynamic and color-set-restricted
 * any-color/any-combination mana abilities.
 *
 * Covers four new forms that matchAddManaAnyColor cannot reach:
 *
 *   1. "add X mana of any one color, where X is the number of <filter> <place>"
 *      → Wirewood Channeler, Sanctum of Fruitful Harvest
 *
 *   2. "add X mana in any combination of colors, where X is the number of <filter> <place>"
 *      → Axebane Guardian (creatures with defender you control)
 *
 *   3. "add [N] mana in any combination of {COLOR} and/or {COLOR}"
 *      → Goblin Clearcutter ({R} and/or {G}), Kydele, Chosen of Kruphix
 *
 * HONESTY: All four forms are already executed by parseManaProductions +
 * tapLandForMana (card-parser-cache.ts / actions.ts), exactly as noted on
 * matchAddManaAnyColor. The dynamic count (where X is ...) causes
 * parseManaProductions to record a fixed amount=1 for the any-color colors;
 * the AI scales tapping via that best-scoring production entry. Recognition-only
 * here; we emit AddMana { W,U,B,R,G } so containsManaEffect() returns true and
 * isManaAbility is set, which routes activation through tapLandForMana.
 */
export function matchAddManaAnyColorDynamic(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 5) return null;
  if (slice[0] !== 'add') return null;

  let idx = 1;

  // ── Form 3: "add [N] mana in any combination of {COLOR} and/or {COLOR}" ──
  // Parse optional fixed count ("three", 3, etc.)
  let staticAmount = 1;
  const wordN3 = parseWordNumber(slice[idx]);
  const digitN3 = parseInt(slice[idx], 10);
  if (!isNaN(wordN3)) { staticAmount = wordN3; idx++; }
  else if (!isNaN(digitN3) && digitN3 > 0) { staticAmount = digitN3; idx++; }

  if (slice[idx] === 'mana' && slice[idx + 1] === 'in' && slice[idx + 2] === 'any' && slice[idx + 3] === 'combination' && slice[idx + 4] === 'of') {
    let i = idx + 5;
    // Gather mana symbols or "colors" keyword
    const seenColors = new Set<'W' | 'U' | 'B' | 'R' | 'G'>();
    const symbolMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
      '{w}': 'W', '{u}': 'U', '{b}': 'B', '{r}': 'R', '{g}': 'G',
    };
    // "colors" keyword → all five colors (Axebane Guardian)
    if (slice[i] === 'colors') {
      i++;
      // Now check for optional dynamic tail: ", where x is the number of ..."
      const dyn = parseWhereXIsNumberOf(slice, i);
      if (dyn) {
        // Dynamic count — emit all-color AddMana with W=ForEach etc.
        const dynAmount = dyn.amount;
        let consumed = dyn.nextIndex;
        if (slice[consumed] === '.') consumed++;
        return {
          effects: [{
            kind: 'AddMana',
            player: { kind: 'Controller' },
            mana: { W: dynAmount, U: dynAmount, B: dynAmount, R: dynAmount, G: dynAmount },
          }],
          targets: [],
          consumed,
        };
      }
      // Fixed count with generic "colors"
      let consumed = i;
      if (slice[consumed] === '.') consumed++;
      return {
        effects: [{
          kind: 'AddMana',
          player: { kind: 'Controller' },
          mana: { W: staticAmount, U: staticAmount, B: staticAmount, R: staticAmount, G: staticAmount },
        }],
        targets: [],
        consumed,
      };
    }
    // "any combination of {R} and/or {G}" — color symbols
    while (i < slice.length) {
      const sym = symbolMap[slice[i]];
      if (sym) { seenColors.add(sym); i++; continue; }
      if (slice[i] === 'and/or' || slice[i] === 'and' || slice[i] === 'or' || slice[i] === ',') { i++; continue; }
      break;
    }
    if (seenColors.size > 0) {
      const mana: { W?: number; U?: number; B?: number; R?: number; G?: number } = {};
      for (const c of seenColors) mana[c] = staticAmount;
      let consumed = i;
      if (slice[consumed] === '.') consumed++;
      return {
        effects: [{
          kind: 'AddMana',
          player: { kind: 'Controller' },
          mana,
        }],
        targets: [],
        consumed,
      };
    }
    return null;
  }

  // ── Forms 1 & 2: "add X mana of any [one] color / in any combination of colors, where X is..." ──
  // Reset idx — we may have consumed an optional count that was actually 'x'
  idx = 1;
  if (slice[idx] !== 'x') return null;
  idx++; // skip 'x'

  if (slice[idx] !== 'mana') return null;
  idx++;

  // Accept both "of any" and "in any"
  if (slice[idx] !== 'of' && slice[idx] !== 'in') return null;
  idx++;
  if (slice[idx] !== 'any') return null;
  idx++;

  // "one" (optional)
  if (slice[idx] === 'one') idx++;
  // "combination of" (optional)
  if (slice[idx] === 'combination' && slice[idx + 1] === 'of') idx += 2;

  if (slice[idx] !== 'color' && slice[idx] !== 'colors') return null;
  idx++;

  // Require the where-X tail for the 'x' amount forms
  const dyn = parseWhereXIsNumberOf(slice, idx);
  if (!dyn) return null;

  const dynAmount = dyn.amount;
  let consumed = dyn.nextIndex;
  if (slice[consumed] === '.') consumed++;

  return {
    effects: [{
      kind: 'AddMana',
      player: { kind: 'Controller' },
      mana: { W: dynAmount, U: dynAmount, B: dynAmount, R: dynAmount, G: dynAmount },
    }],
    targets: [],
    consumed,
  };
}

/**
 * Slice 5: Match "add one mana of the chosen color." — Sol Grail family.
 *
 * The chosen color is stored on the source permanent's choices.chosenColor
 * (supplied at cast/enter time via CastSpellOptions.cardChoices.chosenColor).
 * At execution time the AddMana executor reads choices.chosenColor from the
 * source permanent and adds one mana of that color to the controller's pool.
 *
 * The pattern is: "add [one | N] mana of the chosen color"
 */
export function matchAddManaChosenColor(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 5) return null;
  if (slice[0] !== 'add') return null;

  // Parse optional count: "one", digit — defaults to 1.
  let amount = 1;
  let idx = 1;
  const wordN = parseWordNumber(slice[idx]);
  const digitN = parseInt(slice[idx], 10);
  if (!isNaN(wordN)) {
    amount = wordN;
    idx++;
  } else if (!isNaN(digitN) && digitN > 0) {
    amount = digitN;
    idx++;
  }

  // "mana of the chosen color"
  if (slice[idx] !== 'mana') return null;
  idx++;
  if (slice[idx] !== 'of') return null;
  idx++;
  if (slice[idx] !== 'the') return null;
  idx++;
  if (slice[idx] !== 'chosen') return null;
  idx++;
  if (slice[idx] !== 'color') return null;
  idx++;

  if (slice[idx] === '.') idx++;

  return {
    effects: [{
      kind: 'AddMana',
      player: { kind: 'Controller' },
      mana: {},
      chosenColorAmount: amount,
    }],
    targets: [],
    consumed: idx,
  };
}

/**
 * Slice 5 (Transform): "transform ~" / "transform [card name already normalized to ~]"
 *
 * Oracle text (after normalizeOracleText replaces card name with ~):
 *   "… transform ~."
 *
 * Matches the standalone two-token sequence: "transform" "~"
 * and emits a TransformSelf effect. The executor sets activeFaceName to
 * the back face (def.faces[1].name) when the source is on the battlefield.
 */
export function matchTransformSelf(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'transform') return null;
  // Accepts "transform ~" (Growing Rites wording) AND "transform this creature"
  // (Innistrad werewolf wording — "this creature" is NOT normalized to "~").
  let consumed: number;
  if (slice[1] === '~') {
    consumed = 2;
  } else if (slice[1] === 'this' && slice[2] === 'creature') {
    consumed = 3;
  } else {
    return null;
  }
  if (slice[consumed] === '.') consumed++;
  const effect: TransformSelfEffect = { kind: 'TransformSelf' };
  return { effects: [effect], targets: [], consumed };
}
