// Phase 4: Oracle text parser
// Phase 10: Extended with modal, X costs, tokens, and more patterns
// Phase 14: Expanded with ForEach, ExileFromLibrary, GainControl, sacrifice-as-effect, and more
// Phase 16: Blink/flicker, copy effects, keyword granting, phasing
// Phase 17: Planeswalker loyalty abilities and additional trigger types
// Converts tokenized oracle text into Effect AST + required TargetSpecs

import { tokenizeOracleText } from './tokens';
import type { Effect, TriggeredAbility, Trigger, TargetRef, SourceRef, TokenDefinition, AmountRef, ModalSpell, ModalChoice, ActivatedAbility, ActivatedAbilityCost, CardFilter, ForEachAmount, BlinkEffect, CopyEffect, CopySpellEffect, GrantKeywordEffect, PhaseOutEffect, LoyaltyAbility, StaticAbilityEffect, StaticModifier, Condition, ConditionalEffect, WinGameEffect, LoseGameEffect, RollD20Outcome } from './ast';
import type { TargetSpec, TargetType } from './targets';

export type ParsedOracle =
  | { kind: 'Spell'; effects: Effect[]; targets: TargetSpec[]; xCost?: boolean }
  | { kind: 'ETB'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Modal'; modal: ModalSpell; xCost?: boolean }
  | { kind: 'Dies'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Triggered'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Activated'; abilities: ActivatedAbility[] }
  | { kind: 'StaticAbility'; ability: StaticAbilityEffect }
  | { kind: 'Unparsed'; reason: string };

let targetSpecCounter = 0;

function makeTargetSpec(type: TargetType, constraints?: TargetSpec['constraints']): TargetSpec {
  return {
    id: `target_${++targetSpecCounter}`,
    type,
    count: 1,
    constraints,
  };
}

const COLOR_WORDS: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

function colorConstraintFromWord(word: string | undefined): TargetSpec['constraints'] | undefined {
  const color = word ? COLOR_WORDS[word] : undefined;
  return color ? { colors: [color] } : undefined;
}

function makeChosenRef(spec: TargetSpec): TargetRef {
  return { kind: 'Chosen', targetId: spec.id };
}

function parseSmallNumberToken(token: string): number {
  const numeric = parseInt(token, 10);
  return Number.isNaN(numeric) ? parseWordNumber(token) : numeric;
}

function parsePowerToughnessToken(token: string): { fixed: number; amount?: AmountRef } | null {
  if (token === 'x') {
    return { fixed: 0, amount: { kind: 'EventSpellManaValue' } };
  }
  const fixed = parseInt(token, 10);
  if (Number.isNaN(fixed)) return null;
  return { fixed };
}

const LEADING_PREAMBLE_STARTS = new Set([
  'deathtouch',
  'defender',
  'double',
  'enchant',
  'equip',
  'first',
  'flash',
  'flying',
  'haste',
  'hexproof',
  'indestructible',
  'lifelink',
  'menace',
  'protection',
  'prowess',
  'reach',
  'trample',
  'vigilance',
  'ward',
]);

function startsWithTriggeredAbility(tokens: string[], idx: number): boolean {
  return tokens[idx] === 'when'
    || tokens[idx] === 'whenever'
    || (tokens[idx] === 'at' && tokens[idx + 1] === 'the' && tokens[idx + 2] === 'beginning');
}

function trimLeadingKeywordOrEnchantPreamble(tokens: string[]): string[] {
  if (tokens.length === 0 || startsWithTriggeredAbility(tokens, 0)) return tokens;
  if (!LEADING_PREAMBLE_STARTS.has(tokens[0])) return tokens;

  for (let idx = 1; idx < Math.min(tokens.length, 80); idx++) {
    if (startsWithTriggeredAbility(tokens, idx)) {
      return tokens.slice(idx);
    }
  }

  return tokens;
}

// Pattern matchers return [Effect[], TargetSpec[], tokensConsumed] or null

type PatternResult = { effects: Effect[]; targets: TargetSpec[]; consumed: number } | null;
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
 * Match: "~ deals N damage to any target"
 * Match: "~ deals N damage to target creature"
 * Match: "~ deals N damage to target player"
 */
function matchDealDamage(tokens: string[], startIndex: number): PatternResult {
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
  } else if (slice[idx] === 'this' && ['creature', 'artifact', 'enchantment', 'permanent', 'spell'].includes(slice[idx + 1])) {
    source = slice[idx + 1] === 'spell' ? { kind: 'ThisSpell' } : { kind: 'ThisPermanent' };
    idx += 2;
  } else {
    return null;
  }

  if (slice[idx] !== 'deals') return null;
  idx++;

  const amount = parseInt(slice[idx], 10);
  if (isNaN(amount)) return null;
  idx++;

  if (slice[idx] !== 'damage') return null;
  idx++;
  if (slice[idx] !== 'to') return null;
  idx++;

  let targetType: TargetType;
  let consumed: number;
  let effectTarget: TargetRef | null = null;
  let targets: TargetSpec[] = [];

  // "any target"
  if (slice[idx] === 'any' && slice[idx + 1] === 'target') {
    targetType = 'Any';
    consumed = idx + 2;
    const spec = makeTargetSpec(targetType);
    targets = [spec];
    effectTarget = makeChosenRef(spec);
  }
  // "target creature"
  else if (slice[idx] === 'target' && slice[idx + 1] === 'creature') {
    targetType = 'Creature';
    consumed = idx + 2;
    const spec = makeTargetSpec(targetType);
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
 * Match: "prevent all combat damage that would be dealt this turn"
 * Match: "prevent all damage that would be dealt to you this turn"
 * Match: "prevent the next N damage that would be dealt to target creature/player this turn"
 */
function matchPreventDamage(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'prevent') return null;

  let idx = 1;
  let amount: AmountRef | 'all';
  if (slice[idx] === 'all') {
    amount = 'all';
    idx++;
  } else if (slice[idx] === 'the' && slice[idx + 1] === 'next') {
    const parsed = parseSmallNumberToken(slice[idx + 2]);
    if (Number.isNaN(parsed)) return null;
    amount = parsed;
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
 * Match: "destroy target creature"
 * Match: "destroy target creature an opponent controls"
 * Match: "destroy target permanent"
 * Match: "destroy target artifact"
 * Match: "destroy target enchantment"
 * Match: "destroy target land"
 * Match: "destroy target artifact or enchantment"
 * Match: "destroy target artifact, enchantment, or land"
 */
function matchDestroy(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'destroy') return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let consumed = 3;
  let opponentControls = false;
  let notColors: Array<'W' | 'U' | 'B' | 'R' | 'G'> | undefined;
  const excludedColorByToken: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
    nonwhite: 'W',
    nonblue: 'U',
    nonblack: 'B',
    nonred: 'R',
    nongreen: 'G',
  };

  if (slice[2] === 'creature') {
    targetType = 'Creature';
  } else if (excludedColorByToken[slice[2]] && slice[3] === 'creature') {
    targetType = 'Creature';
    notColors = [excludedColorByToken[slice[2]]];
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
    return null;
  }

  // Check for "an opponent controls"
  if (slice[consumed] === 'an' && slice[consumed + 1] === 'opponent' && slice[consumed + 2] === 'controls') {
    opponentControls = true;
    consumed += 3;
  }

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const constraints: TargetSpec['constraints'] = {
    ...(opponentControls ? { opponentControls: true } : {}),
    ...(notColors ? { notColors } : {}),
  };
  const spec = makeTargetSpec(targetType, Object.keys(constraints).length > 0 ? constraints : undefined);
  const effect: Effect = {
    kind: 'Destroy',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "draw a card"
 * Match: "draw N cards"
 * Match: "draw two cards"
 */
function matchDraw(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'draw') return null;

  let count: number;
  let consumed: number;

  // "draw a card"
  if (slice[1] === 'a' && slice[2] === 'card') {
    count = 1;
    consumed = 3;
  }
  // "draw N cards"
  else {
    const n = parseSmallNumberToken(slice[1]);
    if (isNaN(n)) return null;
    if (slice[2] !== 'cards') return null;
    count = n;
    consumed = 3;
  }

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const effect: Effect = {
    kind: 'Draw',
    player: { kind: 'Controller' },
    count,
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "target player draws N cards"
 * Match: "target player draws three cards"
 */
function matchTargetPlayerDraw(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'target' || slice[1] !== 'player' || slice[2] !== 'draws') return null;

  let count: AmountRef;
  let consumed: number;

  if (slice[3] === 'a' && slice[4] === 'card') {
    count = 1;
    consumed = 5;
  } else {
    count = slice[3] === 'x' ? { kind: 'X' } : parseSmallNumberToken(slice[3]);
    if (typeof count === 'number' && isNaN(count)) return null;
    if (slice[4] !== 'cards') return null;
    consumed = 5;
  }

  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Player');
  const effect: Effect = {
    kind: 'Draw',
    player: makeChosenRef(spec),
    count,
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "that player draws seven cards"
 * In an opponent-cast trigger, "that player" is the spell's caster.
 */
function matchThatPlayerDraw(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player' || slice[2] !== 'draws') return null;

  let count: AmountRef;
  let consumed: number;
  if (slice[3] === 'a' && slice[4] === 'card') {
    count = 1;
    consumed = 5;
  } else {
    count = parseSmallNumberToken(slice[3]);
    if (typeof count === 'number' && isNaN(count)) return null;
    if (slice[4] !== 'cards') return null;
    consumed = 5;
  }

  if (tokens[startIndex + consumed] === '.') consumed++;

  return {
    effects: [{
      kind: 'Draw',
      player: { kind: 'EventCaster' },
      count,
    }],
    targets: [],
    consumed,
  };
}

/**
 * Match: "put a land card from your hand onto the battlefield"
 * Match: "put a land card from your hand onto the battlefield tapped"
 */
function matchPutLandFromHandOntoBattlefield(tokens: string[], startIndex: number): PatternResult {
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
 */
function matchLookAtTargetPlayerHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'look' || slice[1] !== 'at' || slice[2] !== 'target') return null;
  if (slice[3] !== "player's" && slice[3] !== 'players') return null;
  if (slice[4] !== 'hand') return null;

  let consumed = 5;
  if (slice[consumed] === '.') consumed++;

  const spec = makeTargetSpec('Player');
  const effect: Effect = {
    kind: 'LookAtHand',
    player: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

function parseRevealCardFilter(tokens: string[]): CardFilter {
  const meaningful = tokens.filter(token =>
    token !== ',' && token !== 'and' && token !== 'or' && token !== 'a' && token !== 'an'
  );
  if (meaningful.length === 0) return {};

  const cardTypes = new Set(['artifact', 'battle', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery']);
  const subfilters: CardFilter[] = [];

  for (const token of meaningful) {
    if (cardTypes.has(token)) {
      subfilters.push({ types: [token] });
    } else {
      const label = token.charAt(0).toUpperCase() + token.slice(1);
      subfilters.push({ subtypes: [label] });
      subfilters.push({ nameIncludes: [label] });
    }
  }

  return subfilters.length === 1 ? subfilters[0] : { anyOf: subfilters };
}

function titleCaseCardName(tokens: string[]): string {
  return tokens
    .filter(token => token !== ',' && token !== '.' && token !== 'then')
    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
    .trim();
}

/**
 * Match filtering spells like:
 * "look at the top three cards of your library. You may reveal a Human card
 * from among them and put it into your hand..."
 */
function matchLookAtTopPutOneIntoHand(tokens: string[], startIndex: number): PatternResult {
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
    if (slice[idx] === 'put' && slice[idx + 1] === 'one' && slice[idx + 2] === 'of') break;
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
 * Match: "gain N life"
 */
function matchGainLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'gain') return null;

  const amount = parseInt(slice[1], 10);
  if (isNaN(amount)) return null;

  if (slice[2] !== 'life') return null;

  let consumed = 3;

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const effect: Effect = {
    kind: 'GainLife',
    player: { kind: 'Controller' },
    amount,
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "lose N life"
 */
function matchLoseLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'lose') return null;

  const amount = parseInt(slice[1], 10);
  if (isNaN(amount)) return null;

  if (slice[2] !== 'life') return null;

  let consumed = 3;

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const effect: Effect = {
    kind: 'LoseLife',
    player: { kind: 'Controller' },
    amount,
  };

  return { effects: [effect], targets: [], consumed };
}


/**
 * Match: "each opponent loses N life"
 */
function matchEachOpponentLosesLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;
  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'opponent') return null;
  if (slice[2] !== 'loses') return null;

  const amount = parseInt(slice[3], 10);
  if (isNaN(amount)) return null;

  if (slice[4] !== 'life') return null;

  let consumed = 5;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'LoseLife',
    player: { kind: 'EachOpponent' },
    amount,
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "each opponent discards a card"
 * Match: "each opponent discards N cards"
 */
function matchEachOpponentDiscardsCard(tokens: string[], startIndex: number): PatternResult {
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

/**
 * Match: "destroy all creatures"
 */
function matchDestroyAll(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'destroy') return null;
  if (slice[1] !== 'all') return null;
  if (slice[2] !== 'creatures') return null;

  let consumed = 3;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Destroy',
    target: { kind: 'AllCreatures' },
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "exile target creature"
 * Match: "exile target permanent"
 * Match: "exile target nonland permanent"
 * Match: "exile target card from a graveyard"
 * Match: "exile target card from an opponent's graveyard"
 */
function matchExile(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'exile') return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let consumed: number;
  let constraints: { opponentControls?: boolean } | undefined;

  if (slice[2] === 'creature') {
    targetType = 'Creature';
    consumed = 3;
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
  } else {
    return null;
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
 * Match: "return target creature to its owner's hand"
 * Match: "return target nonland permanent to its owner's hand"
 */
function matchReturnToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 7) return null;
  if (slice[0] !== 'return') return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let idx: number;

  if (slice[2] === 'nonland' && slice[3] === 'permanent') {
    targetType = 'NonlandPermanent';
    idx = 4;
  } else if (slice[2] === 'creature') {
    targetType = 'Creature';
    idx = 3;
  } else {
    return null;
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

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'ReturnToHand',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "return a land you control to its owner's hand"
 */
function matchReturnLandYouControlToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 9) return null;
  if (slice[0] !== 'return') return null;
  if (slice[1] !== 'a' || slice[2] !== 'land' || slice[3] !== 'you' || slice[4] !== 'control') return null;
  if (slice[5] !== 'to') return null;
  if (slice[6] !== 'its') return null;
  if (slice[7] !== "owner's" && slice[7] !== 'owners') return null;
  if (slice[8] !== 'hand') return null;

  let consumed = 9;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Land');
  const effect: Effect = {
    kind: 'ReturnToHand',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "target player mills N cards"
 * Match: "mill N cards" (controller mills)
 */
function matchMill(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "target player mills N cards"
  if (slice.length >= 5 && slice[0] === 'target' && slice[1] === 'player' && slice[2] === 'mills') {
    const amount = parseInt(slice[3], 10);
    if (isNaN(amount)) return null;
    if (slice[4] !== 'cards' && slice[4] !== 'card') return null;

    let consumed = 5;
    if (tokens[startIndex + consumed] === '.') consumed++;

    const spec = makeTargetSpec('Player');
    const effect: Effect = {
      kind: 'Mill',
      player: makeChosenRef(spec),
      count: amount,
    };

    return { effects: [effect], targets: [spec], consumed };
  }

  // "mill N cards"
  if (slice.length >= 3 && slice[0] === 'mill') {
    const amount = parseInt(slice[1], 10);
    if (isNaN(amount)) return null;
    if (slice[2] !== 'cards' && slice[2] !== 'card') return null;

    let consumed = 3;
    if (tokens[startIndex + consumed] === '.') consumed++;

    const effect: Effect = {
      kind: 'Mill',
      player: { kind: 'Controller' },
      count: amount,
    };

    return { effects: [effect], targets: [], consumed };
  }

  return null;
}

/**
 * Match: "put a +1/+1 counter on target creature"
 * Match: "put N +1/+1 counters on target creature"
 */
function matchAddCounters(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // ── Pattern A: "put a/N <type> counter(s) on <target>" ──────────────────────
  if (slice[0] === 'put' && slice.length >= 6) {
    let count: number;
    let counterStartIdx: number;

    if (slice[1] === 'a') {
      count = 1;
      counterStartIdx = 2;
    } else {
      const n = parseInt(slice[1], 10);
      if (isNaN(n)) return null;
      count = n;
      counterStartIdx = 2;
    }

    // Parse counter type — can be multi-token (e.g. "first strike", "double strike")
    let counterType: string | null = null;
    let typeEndIdx = counterStartIdx;

    if (
      (slice[counterStartIdx] === 'first' || slice[counterStartIdx] === 'double') &&
      slice[counterStartIdx + 1] === 'strike'
    ) {
      counterType = `${slice[counterStartIdx]} strike`;
      typeEndIdx = counterStartIdx + 2;
    } else if (slice[counterStartIdx]) {
      counterType = slice[counterStartIdx];
      typeEndIdx = counterStartIdx + 1;
    } else {
      return null;
    }

    // "counter" or "counters"
    const counterWord = slice[typeEndIdx];
    if (counterWord !== 'counter' && counterWord !== 'counters') return null;

    if (slice[typeEndIdx + 1] !== 'on') return null;

    const afterOn = typeEndIdx + 2;

    // Sub-case A1: "put a +1/+1 counter on ~" (self-target)
    if (slice[afterOn] === '~' || (slice[afterOn] === 'this' && targetTypeFromSimplePermanentWord(slice[afterOn + 1]))) {
      let consumed = slice[afterOn] === 'this' ? afterOn + 2 : afterOn + 1;
      if (tokens[startIndex + consumed] === '.') consumed++;

      const effect: Effect = {
        kind: 'AddCounters',
        target: { kind: 'Source' },
        counterType,
        count,
      };
      return { effects: [effect], targets: [], consumed };
    }

    // Sub-case A2: "put a X counter on target <type>"
    if (slice[afterOn] === 'target' && slice[afterOn + 1]) {
      const typeWord = slice[afterOn + 1];
      const targetType: TargetType =
        typeWord === 'creature' ? 'Creature' :
        typeWord === 'permanent' ? 'Permanent' :
        typeWord === 'player' ? 'Player' :
        typeWord === 'artifact' ? 'Artifact' :
        typeWord === 'enchantment' ? 'Enchantment' : null as unknown as TargetType;

      if (!targetType) return null;

      let consumed = afterOn + 2;
      if (tokens[startIndex + consumed] === '.') consumed++;

      const spec = makeTargetSpec(targetType);
      const effect: Effect = {
        kind: 'AddCounters',
        target: makeChosenRef(spec),
        counterType,
        count,
      };
      return { effects: [effect], targets: [spec], consumed };
    }

    return null;
  }

  // ── Pattern B: "target player gets N/a poison counter(s)" ────────────────────
  if (
    slice[0] === 'target' &&
    slice[1] === 'player' &&
    slice[2] === 'gets' &&
    slice.length >= 5
  ) {
    let idx = 3;
    let count = 1;

    if (/^\d+$/.test(slice[idx])) {
      count = parseInt(slice[idx], 10);
      idx++;
    } else if (slice[idx] === 'a') {
      idx++;
    } else {
      return null;
    }

    const counterType = slice[idx];
    if (!counterType) return null;
    idx++;

    if (slice[idx] !== 'counter' && slice[idx] !== 'counters') return null;
    idx++;

    if (tokens[startIndex + idx] === '.') idx++;

    const spec = makeTargetSpec('Player');
    const effect: Effect = {
      kind: 'AddCounters',
      target: makeChosenRef(spec),
      counterType,
      count,
    };
    return { effects: [effect], targets: [spec], consumed: idx };
  }

  return null;
}

/**
 * Match: "you get {E}{E}" / "you get {E}" for energy counters.
 */
function matchGainEnergy(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'you' || slice[1] !== 'get') return null;
  const energyToken = slice[2];
  if (!energyToken || !/^(?:\{e\})+$/i.test(energyToken)) return null;

  let consumed = 3;
  if (slice[consumed] === '.') consumed++;

  const count = (energyToken.match(/\{e\}/gi) || []).length;
  const effect: Effect = {
    kind: 'AddCounters',
    target: { kind: 'Controller' },
    counterType: 'energy',
    count,
  };
  return { effects: [effect], targets: [], consumed };
}

function targetTypeFromSimplePermanentWord(word: string): TargetType | null {
  if (word === 'creature') return 'Creature';
  if (word === 'land') return 'Land';
  if (word === 'artifact') return 'Artifact';
  if (word === 'enchantment') return 'Enchantment';
  if (word === 'permanent') return 'Permanent';
  return null;
}

/**
 * Match: "tap target creature/land/artifact/enchantment/permanent"
 */
function matchTap(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'tap') return null;
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
  const targetType = targetTypeFromSimplePermanentWord(slice[2]);
  if (!targetType) return null;

  let consumed = 3;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec(targetType);
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
function matchUntap(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice[0] !== 'untap') return null;

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
 * Match: "create a N/N [color] [type] creature token"
 * Match: "create N N/N [color] [type] creature tokens"
 */
function matchCreateToken(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'create' && slice[0] !== 'creates') return null;

  let tokenCount: AmountRef;
  let idx: number;

  // "create a" or "create N"
  if (slice[1] === 'a' || slice[1] === 'an') {
    tokenCount = 1;
    idx = 2;
  } else if (slice[1] === 'x') {
    tokenCount = { kind: 'X' };
    idx = 2;
  } else {
    const n = parseInt(slice[1], 10);
    const wordNumber = parseWordNumber(slice[1]);
    const parsedCount = !isNaN(n) ? n : wordNumber;
    if (isNaN(parsedCount)) return null;
    tokenCount = parsedCount;
    idx = 2;
  }

  const artifactTokenNames = new Set(['blood', 'clue', 'food', 'gold', 'lander', 'map', 'powerstone', 'treasure']);
  const artifactName = slice[idx];
  if (artifactTokenNames.has(artifactName) && (slice[idx + 1] === 'token' || slice[idx + 1] === 'tokens')) {
    idx += 2;
    if (slice[idx] === '.') idx++;

    const subtype = artifactName.charAt(0).toUpperCase() + artifactName.slice(1);
    const abilities = artifactName === 'lander'
      ? ['{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.']
      : artifactName === 'powerstone'
        ? ['{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.']
        : undefined;
    const token: TokenDefinition = {
      name: subtype,
      colors: [],
      types: ['artifact'],
      subtypes: [subtype],
      power: 0,
      toughness: 0,
      ...(abilities ? { abilities } : {}),
    };

    const effect: Effect = {
      kind: 'CreateToken',
      controller: { kind: 'Controller' },
      token,
      count: tokenCount,
    };

    return { effects: [effect], targets: [], consumed: idx };
  }

  // Parse P/T (e.g., "1/1", "2/2", "x/x")
  const ptMatch = slice[idx]?.match(/^(\d+|x)\/(\d+|x)$/);
  if (!ptMatch) return null;
  const parsedPower = parsePowerToughnessToken(ptMatch[1]);
  const parsedToughness = parsePowerToughnessToken(ptMatch[2]);
  if (!parsedPower || !parsedToughness) return null;
  const power = parsedPower.fixed;
  const toughness = parsedToughness.fixed;
  const powerAmount = parsedPower.amount;
  const toughnessAmount = parsedToughness.amount;
  idx++;

  // Parse optional color
  const colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = [];
  const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
    white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  };
  while (colorMap[slice[idx]] || (slice[idx] === 'and' && colorMap[slice[idx + 1]])) {
    if (slice[idx] === 'and') idx++;
    colors.push(colorMap[slice[idx]]);
    idx++;
  }

  // Parse type (e.g., "goblin", "soldier", "spirit")
  const subtypes: string[] = [];
  while (slice[idx] && slice[idx] !== 'creature' && slice[idx] !== 'token' && slice[idx] !== 'tokens') {
    subtypes.push(slice[idx]);
    idx++;
  }

  // "creature token" or "creature tokens"
  if (slice[idx] !== 'creature') return null;
  idx++;
  if (slice[idx] !== 'token' && slice[idx] !== 'tokens') return null;
  idx++;

  const keywords: string[] = [];
  if (slice[idx] === 'with') {
    idx++;
    while (slice[idx] && slice[idx] !== ',' && slice[idx] !== '.') {
      if (slice[idx] !== 'and') {
        keywords.push(slice[idx].charAt(0).toUpperCase() + slice[idx].slice(1));
      }
      idx++;
    }
  }

  if (slice[idx] === ',' && slice[idx + 1] === 'where' && slice[idx + 2] === 'x') {
    if (
      slice[idx + 3] === 'is' &&
      slice[idx + 4] === 'that' &&
      (slice[idx + 5] === "spell's" || slice[idx + 5] === 'spells') &&
      slice[idx + 6] === 'mana' &&
      slice[idx + 7] === 'value'
    ) {
      idx += 8;
    }
  }

  // Handle trailing period
  if (slice[idx] === '.') idx++;
  const dynamicXCount = parseCreateTokenWhereXCount(slice, idx);
  if (dynamicXCount && typeof tokenCount !== 'number' && tokenCount.kind === 'X') {
    tokenCount = dynamicXCount.count;
    idx = dynamicXCount.consumed;
  }

  const token: TokenDefinition = {
    name: subtypes.length > 0 ? subtypes.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ') : 'Creature',
    colors,
    types: ['creature'],
    subtypes: subtypes.length > 0 ? subtypes : undefined,
    power,
    toughness,
    ...(powerAmount ? { powerAmount } : {}),
    ...(toughnessAmount ? { toughnessAmount } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
  };

  if (
    slice[idx] === 'put' &&
    slice[idx + 1] === 'x' &&
    slice[idx + 2] === '+1/+1' &&
    slice[idx + 3] === 'counters' &&
    slice[idx + 4] === 'on' &&
    slice[idx + 5] === 'it'
  ) {
    token.counters = { '+1/+1': { kind: 'EventSpellManaValue' } };
    idx += 6;
    if (
      slice[idx] === ',' &&
      slice[idx + 1] === 'where' &&
      slice[idx + 2] === 'x' &&
      slice[idx + 3] === 'is' &&
      slice[idx + 4] === 'that' &&
      (slice[idx + 5] === "spell's" || slice[idx + 5] === 'spells') &&
      slice[idx + 6] === 'mana' &&
      slice[idx + 7] === 'value'
    ) {
      idx += 8;
    }
    if (slice[idx] === '.') idx++;
  }

  const effect: Effect = {
    kind: 'CreateToken',
    controller: { kind: 'Controller' },
    token,
    count: tokenCount,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "that player creates a 1/1 red Goblin creature token"
 *
 * In beginning/end-step triggers, "that player" refers to the active player
 * whose step caused the trigger to fire.
 */
function matchThatPlayerCreatesToken(tokens: string[], startIndex: number): PatternResult {
  if (tokens[startIndex] !== 'that' || tokens[startIndex + 1] !== 'player') {
    return null;
  }

  const tokenResult = matchCreateToken(tokens, startIndex + 2);
  if (!tokenResult) return null;

  return {
    ...tokenResult,
    effects: tokenResult.effects.map(effect => (
      effect.kind === 'CreateToken'
        ? { ...effect, controller: { kind: 'ActivePlayer' as const } }
        : effect
    )),
    consumed: tokenResult.consumed + 2,
  };
}

function parseD20Range(tokens: string[], startIndex: number): { min: number; max: number; nextIndex: number } | null {
  const min = parseInt(tokens[startIndex], 10);
  if (isNaN(min)) return null;
  const dash = tokens[startIndex + 1];
  if (dash !== '-' && dash !== 'â€“' && dash !== 'â€”') return null;
  const max = parseInt(tokens[startIndex + 2], 10);
  if (isNaN(max)) return null;

  let nextIndex = startIndex + 3;
  if (tokens[nextIndex] === '|') nextIndex++;
  return { min, max, nextIndex };
}

function findNextD20Outcome(tokens: string[], startIndex: number): number {
  for (let i = startIndex; i < tokens.length - 3; i++) {
    if (parseD20Range(tokens, i)) return i;
  }
  return -1;
}

function attachSourceToCreatedIfRequested(effects: Effect[], outcomeTokens: string[]): Effect[] {
  const attachIndex = outcomeTokens.indexOf('attach');
  const attachesToIt = attachIndex >= 0 && outcomeTokens.some((token, index) =>
    index > attachIndex && token === 'to' && outcomeTokens[index + 1] === 'it'
  );
  if (!attachesToIt) return effects;

  let attachedFirstToken = false;
  return effects.map(effect => {
    if (!attachedFirstToken && effect.kind === 'CreateToken') {
      attachedFirstToken = true;
      return { ...effect, attachSourceToCreated: true };
    }
    return effect;
  });
}

/**
 * Match dice-table text like:
 * "roll a d20. 1-9 | create a 1/1 red Goblin creature token.
 *  10-20 | create a 1/1 red Goblin creature token, then attach CARD to it."
 */
function matchRollD20(tokens: string[], startIndex: number): PatternResult {
  if (tokens[startIndex] !== 'roll' || tokens[startIndex + 1] !== 'a' || tokens[startIndex + 2] !== 'd20') {
    return null;
  }

  let idx = startIndex + 3;
  while (tokens[idx] === '.' || tokens[idx] === ',') idx++;

  const outcomes: RollD20Outcome[] = [];
  while (idx < tokens.length) {
    while (tokens[idx] === '.' || tokens[idx] === ',') idx++;

    const range = parseD20Range(tokens, idx);
    if (!range) break;

    const outcomeStart = range.nextIndex;
    const nextOutcome = findNextD20Outcome(tokens, outcomeStart);
    const outcomeEnd = nextOutcome === -1 ? tokens.length : nextOutcome;
    const outcomeTokens = tokens.slice(outcomeStart, outcomeEnd);
    const parsed = parseMultipleEffects(outcomeTokens, 0);
    if (parsed && parsed.effects.length > 0) {
      outcomes.push({
        min: range.min,
        max: range.max,
        effects: attachSourceToCreatedIfRequested(parsed.effects, outcomeTokens),
      });
    }

    idx = outcomeEnd;
  }

  if (outcomes.length === 0) return null;

  return {
    effects: [{ kind: 'RollD20', outcomes }],
    targets: [],
    consumed: Math.max(idx - startIndex, 3),
  };
}

function singularizeSubtypeWord(word: string): string {
  const subtypeMap: Record<string, string> = {
    elf: 'elf', elves: 'elf',
    goblin: 'goblin', goblins: 'goblin',
    zombie: 'zombie', zombies: 'zombie',
    dragon: 'dragon', dragons: 'dragon',
    angel: 'angel', angels: 'angel',
    demon: 'demon', demons: 'demon',
    merfolk: 'merfolk',
    soldier: 'soldier', soldiers: 'soldier',
    wizard: 'wizard', wizards: 'wizard',
    knight: 'knight', knights: 'knight',
    warrior: 'warrior', warriors: 'warrior',
    cleric: 'cleric', clerics: 'cleric',
    rogue: 'rogue', rogues: 'rogue',
    shaman: 'shaman', shamans: 'shaman',
    beast: 'beast', beasts: 'beast',
    elemental: 'elemental', elementals: 'elemental',
    vampire: 'vampire', vampires: 'vampire',
    sliver: 'sliver', slivers: 'sliver',
    human: 'human', humans: 'human',
    spirit: 'spirit', spirits: 'spirit',
    bird: 'bird', birds: 'bird',
    cat: 'cat', cats: 'cat',
    dinosaur: 'dinosaur', dinosaurs: 'dinosaur',
    pirate: 'pirate', pirates: 'pirate',
    dwarf: 'dwarf', dwarves: 'dwarf',
    wolf: 'wolf', wolves: 'wolf',
  };
  return subtypeMap[word] || word.replace(/s$/, '');
}

function parseCreateTokenWhereXCount(
  slice: string[],
  startIndex: number,
): { count: ForEachAmount; consumed: number } | null {
  let idx = startIndex;
  if (slice[idx] === ',') idx++;

  if (
    slice[idx] !== 'where' ||
    slice[idx + 1] !== 'x' ||
    slice[idx + 2] !== 'is' ||
    slice[idx + 3] !== 'the' ||
    slice[idx + 4] !== 'number' ||
    slice[idx + 5] !== 'of'
  ) {
    return null;
  }

  idx += 6;
  const countedWords: string[] = [];
  while (idx < slice.length && !(slice[idx] === 'you' && slice[idx + 1] === 'control')) {
    if (slice[idx] !== ',' && slice[idx] !== '.') countedWords.push(slice[idx]);
    idx++;
  }
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'control' || countedWords.length === 0) {
    return null;
  }
  idx += 2;
  if (slice[idx] === '.') idx++;

  const countedType = countedWords[countedWords.length - 1];
  let filter: CardFilter | undefined;
  if (countedType === 'creatures' || countedType === 'creature') {
    filter = { types: ['creature'] };
  } else if (countedType === 'artifacts' || countedType === 'artifact') {
    filter = { types: ['artifact'] };
  } else if (countedType === 'enchantments' || countedType === 'enchantment') {
    filter = { types: ['enchantment'] };
  } else if (countedType === 'lands' || countedType === 'land') {
    filter = { types: ['land'] };
  } else {
    const subtype = singularizeSubtypeWord(countedType);
    filter = {
      types: ['creature'],
      subtypes: [subtype.charAt(0).toUpperCase() + subtype.slice(1)],
    };
  }

  return {
    count: {
      kind: 'ForEach',
      zone: 'battlefield',
      filter,
      controller: 'you',
    },
    consumed: idx,
  };
}

/**
 * Match: "each opponent discards a card"
 * Match: "target player discards N cards"
 */
function matchDiscard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "target player discards N cards"
  if (slice.length >= 4 && slice[0] === 'target' && slice[1] === 'player' && slice[2] === 'discards') {
    let count: number;
    let consumed: number;

    if (slice[3] === 'a') {
      count = 1;
      consumed = 5; // "target player discards a card"
    } else {
      count = parseInt(slice[3], 10);
      if (isNaN(count)) return null;
      consumed = 5; // "target player discards N cards"
    }

    if (tokens[startIndex + consumed] === '.') consumed++;

    const spec = makeTargetSpec('Player');
    const effect: Effect = {
      kind: 'Discard',
      player: makeChosenRef(spec),
      count,
    };

    return { effects: [effect], targets: [spec], consumed };
  }

  return null;
}

/**
 * Match: "scry N"
 */
function matchScry(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 2) return null;
  if (slice[0] !== 'scry') return null;

  const count = parseInt(slice[1], 10);
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
function matchSurveil(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 2) return null;
  if (slice[0] !== 'surveil') return null;

  const count = parseInt(slice[1], 10);
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
 * Match: "~ deals X damage to any target"
 */
function matchDealXDamage(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 6) return null;
  if (slice[0] !== '~') return null;
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
    source: { kind: 'ThisSpell' } as SourceRef,
    target: makeChosenRef(spec),
    amount: { kind: 'X' },
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "draw X cards"
 */
function matchDrawX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'draw') return null;
  if (slice[1] !== 'x') return null;
  if (slice[2] !== 'cards') return null;

  let consumed = 3;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Draw',
    player: { kind: 'Controller' },
    count: { kind: 'X' },
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "counter target spell"
 * Match: "counter target noncreature spell"
 * Match: "counter target creature spell"
 * Match: "counter target creature or enchantment spell. If that spell is countered this way, exile it instead..."
 */
function matchCounterSpell(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'counter') return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let consumed: number;
  let filter: 'noncreature' | 'creature' | 'creatureOrEnchantment' | 'artifactOrCreature' | 'instantOrSorcery' | undefined;

  if (slice[2] === 'noncreature' && slice[3] === 'spell') {
    targetType = 'NoncreatureSpell';
    filter = 'noncreature';
    consumed = 4;
  } else if (slice[2] === 'creature' && slice[3] === 'spell') {
    targetType = 'CreatureSpell';
    filter = 'creature';
    consumed = 4;
  } else if (slice[2] === 'creature' && slice[3] === 'or' && slice[4] === 'enchantment' && slice[5] === 'spell') {
    targetType = 'CreatureOrEnchantmentSpell';
    filter = 'creatureOrEnchantment';
    consumed = 6;
  } else if (slice[2] === 'artifact' && slice[3] === 'or' && slice[4] === 'creature' && slice[5] === 'spell') {
    targetType = 'ArtifactOrCreatureSpell';
    filter = 'artifactOrCreature';
    consumed = 6;
  } else if (slice[2] === 'instant' && slice[3] === 'or' && slice[4] === 'sorcery' && slice[5] === 'spell') {
    targetType = 'InstantOrSorcerySpell';
    filter = 'instantOrSorcery';
    consumed = 6;
  } else if (slice[2] === 'spell') {
    targetType = 'Spell';
    consumed = 3;
  } else {
    return null;
  }

  let exileInstead = false;
  if (tokens[startIndex + consumed] === '.') consumed++;
  const rider = tokens.slice(startIndex + consumed);
  if (
    rider[0] === 'if'
    && rider[1] === 'that'
    && rider[2] === 'spell'
    && rider[3] === 'is'
    && rider[4] === 'countered'
    && rider[5] === 'this'
    && rider[6] === 'way'
  ) {
    const exileIndex = rider.indexOf('exile');
    const insteadIndex = rider.indexOf('instead');
    if (exileIndex >= 0 && insteadIndex > exileIndex) {
      exileInstead = true;
      consumed += insteadIndex + 1;
      while (tokens[startIndex + consumed] && tokens[startIndex + consumed] !== '.') consumed++;
      if (tokens[startIndex + consumed] === '.') consumed++;
    }
  }

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'CounterSpell',
    target: makeChosenRef(spec),
    filter,
    ...(exileInstead ? { exileInstead: true } : {}),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "target creature you control fights target creature you don't control"
 */
function matchFight(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice[0] !== 'target') return null;
  let idx = 1;
  const yourConstraints = colorConstraintFromWord(slice[idx]);
  if (yourConstraints) idx++;
  if (slice[idx] !== 'creature') return null;
  idx++;
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
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

  const yourCreature = makeTargetSpec('Creature', yourConstraints);
  const opposingCreature = makeTargetSpec('Creature', { ...opposingColorConstraints, opponentControls: true });
  const effect: Effect = {
    kind: 'Fight',
    fighterA: makeChosenRef(yourCreature),
    fighterB: makeChosenRef(opposingCreature),
  };

  return { effects: [effect], targets: [yourCreature, opposingCreature], consumed };
}

/**
 * Match: "return target creature card from your graveyard to your hand"
 * Match: "return target creature card from your graveyard to the battlefield"
 * Match: "return target creature or enchantment card from your graveyard to your hand"
 */
function matchReturnFromGraveyard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 9) return null;
  if (slice[0] !== 'return') return null;
  let idx = 1;
  if (slice[idx] === 'up' && slice[idx + 1] === 'to' && slice[idx + 2] === 'one') {
    idx += 3;
  }
  if (slice[idx] !== 'target') return null;
  idx++;
  let targetType: TargetType = 'CreatureCardInGraveyard';
  if (slice[idx] === 'creature' && slice[idx + 1] === 'card') {
    idx += 2;
  } else if (
    slice[idx] === 'creature'
    && slice[idx + 1] === 'or'
    && slice[idx + 2] === 'enchantment'
    && slice[idx + 3] === 'card'
  ) {
    targetType = 'CreatureOrEnchantmentCardInGraveyard';
    idx += 4;
  } else {
    return null;
  }
  if (slice[idx] !== 'from') return null;
  idx++;
  if (slice[idx] !== 'your') return null;
  idx++;
  if (slice[idx] !== 'graveyard') return null;
  idx++;
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

  const spec = makeTargetSpec(targetType);
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
function matchReturnThatCardToHand(tokens: string[], startIndex: number): PatternResult {
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
 * Match: "put target creature card from an opponent's graveyard onto the battlefield under your control. It gains haste."
 */
function matchPutCreatureCardFromOpponentGraveyardOntoBattlefield(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 12) return null;
  if (slice[0] !== 'put' || slice[1] !== 'target' || slice[2] !== 'creature' || slice[3] !== 'card') return null;
  let idx = 4;
  if (slice[idx] !== 'from') return null;
  idx++;
  if (slice[idx] !== 'an' || slice[idx + 1] !== "opponent's" || slice[idx + 2] !== 'graveyard') return null;
  idx += 3;
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

  const spec = makeTargetSpec('CreatureCardInGraveyard', { opponentControls: true });
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

/**
 * Match: "target creature gets +N/+N until end of turn"
 * Match: "target creature gets -N/-N until end of turn"
 * Match: "creatures you control get +N/+N until end of turn"
 */
function matchModifyPT(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "~ gets +N/+N until end of turn"
  // "it gets +N/+N until end of turn"
  // "this creature gets +N/+N until end of turn"
  if (
    slice.length >= 7 &&
    (
      ((slice[0] === '~' || slice[0] === 'it') && slice[1] === 'gets')
      || (slice[0] === 'this' && ['creature', 'permanent', 'card'].includes(slice[1]) && slice[2] === 'gets')
    )
  ) {
    const ptIndex = slice[0] === 'this' ? 3 : 2;
    const ptMatch = slice[ptIndex]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    const power = parseInt(ptMatch[1], 10);
    const toughness = parseInt(ptMatch[2], 10);
    if (slice[ptIndex + 1] !== 'until' || slice[ptIndex + 2] !== 'end' || slice[ptIndex + 3] !== 'of'
      || (slice[ptIndex + 4] !== 'turn' && slice[ptIndex + 4] !== 'combat')) return null;

    let consumed = ptIndex + 5;
    if (tokens[startIndex + consumed] === '.') consumed++;

    const effect: Effect = {
      kind: 'ModifyPT',
      target: { kind: 'Source' },
      power,
      toughness,
      untilEndOfTurn: true,
    };

    return { effects: [effect], targets: [], consumed };
  }

  // "creatures you control get +N/+N until end of turn"
  if (slice.length >= 8 &&
      slice[0] === 'creatures' && slice[1] === 'you' && slice[2] === 'control' &&
      slice[3] === 'get') {
    const ptMatch = slice[4]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    const power = parseInt(ptMatch[1], 10);
    const toughness = parseInt(ptMatch[2], 10);

    if (slice[5] === 'and' && slice[6] === 'gain') {
      const keyword = slice[7];
      if (!keyword) return null;
      if (slice[8] !== 'until' || slice[9] !== 'end' || slice[10] !== 'of' || slice[11] !== 'turn') return null;

      let consumed = 12;
      if (tokens[startIndex + consumed] === '.') consumed++;

      const effects: Effect[] = [{
        kind: 'ModifyPT',
        target: { kind: 'AllCreaturesYouControl' },
        power,
        toughness,
        untilEndOfTurn: true,
      }, {
        kind: 'GrantKeyword',
        target: { kind: 'AllCreaturesYouControl' },
        keyword: keyword.charAt(0).toUpperCase() + keyword.slice(1),
        untilEndOfTurn: true,
      }];

      return { effects, targets: [], consumed };
    }

    if (slice[5] !== 'until' || slice[6] !== 'end' || slice[7] !== 'of'
      || (slice[8] !== 'turn' && slice[8] !== 'combat')) return null;

    let consumed = 9;
    if (tokens[startIndex + consumed] === '.') consumed++;

    const effect: Effect = {
      kind: 'ModifyPT',
      target: { kind: 'AllCreaturesYouControl' },
      power,
      toughness,
      untilEndOfTurn: true,
    };

    return { effects: [effect], targets: [], consumed };
  }

  // "target creature gets +N/+N until end of turn"
  // "target green creature you control gets +N/+N until end of turn"
  if (slice.length < 8) return null;
  if (slice[0] !== 'target') return null;
  let idx = 1;
  const colorConstraints = colorConstraintFromWord(slice[idx]);
  if (colorConstraints) idx++;
  if (slice[idx] !== 'creature') return null;
  idx++;
  const constraints: TargetSpec['constraints'] = { ...(colorConstraints || {}) };
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    idx += 2;
  } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    constraints.opponentControls = true;
    idx += 3;
  }
  if (slice[idx] !== 'gets') return null;
  idx++;

  const ptMatch = slice[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  idx++;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);

  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
    || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')) return null;
  idx += 4;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  const effect: Effect = {
    kind: 'ModifyPT',
    target: makeChosenRef(spec),
    power,
    toughness,
    untilEndOfTurn: true,
  };

  let consumed = idx;
  const next = tokens.slice(startIndex + consumed);
  if (next[0] === '.' && next[1] === 'it' && next[2] === 'fights' && next[3] === 'target') {
    let fightIdx = 4;
    const opposingColorConstraints = colorConstraintFromWord(next[fightIdx]);
    if (opposingColorConstraints) fightIdx++;
    if (next[fightIdx] === 'creature') {
      fightIdx++;
      const opposingConstraints: TargetSpec['constraints'] = { ...opposingColorConstraints };
      if (
        (next[fightIdx] === 'you' && (next[fightIdx + 1] === "don't" || next[fightIdx + 1] === 'dont') && next[fightIdx + 2] === 'control')
        || (next[fightIdx] === 'an' && next[fightIdx + 1] === 'opponent' && next[fightIdx + 2] === 'controls')
      ) {
        opposingConstraints.opponentControls = true;
        fightIdx += 3;
      }
      if (next[fightIdx] === '.') fightIdx++;
      const opponentCreature = makeTargetSpec('Creature', Object.keys(opposingConstraints).length > 0 ? opposingConstraints : undefined);
      const fightEffect: Effect = {
        kind: 'Fight',
        fighterA: makeChosenRef(spec),
        fighterB: makeChosenRef(opponentCreature),
      };
      return {
        effects: [effect, fightEffect],
        targets: [spec, opponentCreature],
        consumed: consumed + fightIdx,
      };
    }
  }

  if (tokens[startIndex + consumed] === '.') consumed++;

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "discard a card"
 * (controller discards, used in multi-effect parsing like "draw a card, then discard a card")
 */
function matchDiscardSelf(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'discard') return null;

  let count: number;
  let consumed: number;

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

// ============================================================================
// Phase 14: New pattern matchers
// ============================================================================

/**
 * Parse a word number like "one", "two", "three", etc. Returns the number or NaN.
 */
function parseWordNumber(word: string): number {
  const map: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  return map[word] ?? NaN;
}

/**
 * Match: "draw a card for each creature you control"
 * Match: "add {R} for each card in target opponent's hand" (simplified: gain life = N)
 * Match: "create a 1/1 ... token for each creature that died this turn"
 *
 * This detects "for each" trailing an effect and wraps the amount in ForEachAmount.
 */
function matchForEachDraw(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "draw a card for each [type] you control"
  // "draw a card for each [type] [player] controls"
  if (slice.length < 7) return null;
  if (slice[0] !== 'draw') return null;
  if (slice[1] !== 'a' || slice[2] !== 'card') return null;
  if (slice[3] !== 'for') return null;
  if (slice[4] !== 'each') return null;

  // Parse the counted thing: "creature you control", "card in your hand", etc.
  let idx = 5;
  const filter: CardFilter = {};

  // Parse type: creature, artifact, enchantment, permanent, card, etc.
  const typeWord = slice[idx];
  if (typeWord === 'creature') {
    filter.types = ['creature'];
    idx++;
  } else if (typeWord === 'artifact') {
    filter.types = ['artifact'];
    idx++;
  } else if (typeWord === 'enchantment') {
    filter.types = ['enchantment'];
    idx++;
  } else if (typeWord === 'permanent') {
    filter.types = ['permanent'];
    idx++;
  } else if (typeWord === 'card') {
    idx++;
  } else if (typeWord === 'land') {
    filter.types = ['land'];
    idx++;
  } else {
    return null;
  }

  // Determine the zone and controller
  let zone: ForEachAmount['zone'] = 'battlefield';
  let controller: ForEachAmount['controller'] = 'you';

  // "you control"
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    controller = 'you';
    zone = 'battlefield';
    idx += 2;
  }
  // "in your hand"
  else if (slice[idx] === 'in' && slice[idx + 1] === 'your' && slice[idx + 2] === 'hand') {
    zone = 'hand';
    controller = 'you';
    idx += 3;
  }
  // "in your graveyard"
  else if (slice[idx] === 'in' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    zone = 'graveyard';
    controller = 'you';
    idx += 3;
  }
  // "an opponent controls"
  else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    controller = 'opponent';
    zone = 'battlefield';
    idx += 3;
  }
  // "in target opponent's hand" — simplified, treat as opponent
  else if (slice[idx] === 'in' && slice[idx + 1] === 'target' && slice[idx + 2] === "opponent's" && slice[idx + 3] === 'hand') {
    zone = 'hand';
    controller = 'opponent';
    idx += 4;
  }
  else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const forEachAmount: ForEachAmount = {
    kind: 'ForEach',
    zone,
    filter: filter.types ? filter : undefined,
    controller,
  };

  const effect: Effect = {
    kind: 'Draw',
    player: { kind: 'Controller' },
    count: forEachAmount,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "create a 1/1 ... token for each creature you control"
 * General pattern: any create token followed by "for each"
 */
function matchCreateTokenForEach(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 8) return null;
  if (slice[0] !== 'create') return null;

  // Find "for each" in the token stream
  let forEachIdx = -1;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i] === 'for' && slice[i + 1] === 'each') {
      forEachIdx = i;
      break;
    }
  }
  if (forEachIdx === -1) return null;

  // Parse the token definition part (everything between "create" and "for each")
  // We'll use matchCreateToken on a sub-slice that ends with a period
  const tokenSubSlice = [...slice.slice(0, forEachIdx), '.'];
  const tokenResult = matchCreateToken(tokenSubSlice, 0);
  if (!tokenResult) return null;

  // Now parse the "for each" part
  let idx = forEachIdx + 2; // skip "for each"
  const filter: CardFilter = {};

  const typeWord = slice[idx];
  if (typeWord === 'creature') {
    filter.types = ['creature'];
    idx++;
  } else if (typeWord === 'artifact') {
    filter.types = ['artifact'];
    idx++;
  } else if (typeWord === 'opponent') {
    // "for each opponent" — count opponents
    idx++;
    if (slice[idx] === '.') idx++;
    const createEffect = tokenResult.effects[0];
    if (createEffect.kind !== 'CreateToken') return null;
    const forEachAmount: ForEachAmount = {
      kind: 'ForEach',
      zone: 'battlefield',
      controller: 'opponent',
    };
    const effect: Effect = {
      ...createEffect,
      count: forEachAmount,
    };
    return { effects: [effect], targets: [], consumed: idx };
  } else {
    return null;
  }

  let zone: ForEachAmount['zone'] = 'battlefield';
  let controller: ForEachAmount['controller'] = 'you';

  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    idx += 2;
  } else if (slice[idx] === 'that' && slice[idx + 1] === 'died' && slice[idx + 2] === 'this' && slice[idx + 3] === 'turn') {
    zone = 'graveyard';
    idx += 4;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const forEachAmount: ForEachAmount = {
    kind: 'ForEach',
    zone,
    filter: filter.types ? filter : undefined,
    controller,
  };

  const createEffect = tokenResult.effects[0];
  if (createEffect.kind !== 'CreateToken') return null;
  const effect: Effect = {
    ...createEffect,
    count: forEachAmount,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "exile the top N cards of your library"
 * Match: "exile the top card of your library"
 * Optionally followed by ". you may play them this turn" / ". you may play them until end of turn"
 */
function matchExileFromLibraryTop(tokens: string[], startIndex: number): PatternResult {
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
 * Match: "search your library for a card" (generic tutor — any card type)
 * Match: "search your library for a card, put it into your hand, then shuffle"
 * Match: "search your library for a card and put that card on top"
 * Uses namedCardChoices.tutorCard / namedCard to choose a real library card when provided.
 */
function matchSearchLibraryGeneric(tokens: string[], startIndex: number): PatternResult {
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
  if (slice[idx] === 'up' && slice[idx + 1] === 'to') {
    const count = parseSmallNumberToken(slice[idx + 2]);
    if (Number.isNaN(count) || (slice[idx + 3] !== 'card' && slice[idx + 3] !== 'cards')) return null;
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
    if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
    idx++;
  }

  if (slice[idx] === 'card') {
    idx++;
  } else if (slice[idx + 1] === 'card') {
    const filterWord = slice[idx];
    const parsedFilter = parseStaticFilterType(filterWord);
    const subtype = singularizeSubtypeWord(filterWord);
    // Unknown "a/an <word> card" searches are almost always subtype searches
    // (Shrine, Gate, Aura, Equipment, Background, etc.). Do not force them
    // through creature-only filtering; the authority prompt validates against
    // the card type line at response time.
    filter = parsedFilter ?? {
      subtypes: [subtype.charAt(0).toUpperCase() + subtype.slice(1)],
    };
    idx += 2;
  } else if (!maxSelections) {
    return null;
  }

  // Skip optional destination clauses and shuffle
  // "put it into your hand" / "put that card on top" etc.
  // We consume everything until end of tokens or next sentence
  let shuffle = false;
  let destination: 'hand' | 'battlefield' | 'top' | 'graveyard' = 'hand';

  if (slice[idx] === ',') idx++;
  if (slice[idx] === 'reveal') {
    while (idx < slice.length && slice[idx] !== ',' && slice[idx] !== '.' && slice[idx] !== 'then') {
      idx++;
    }
    if (slice[idx] === ',') idx++;
  }
  if (slice[idx] === 'put') {
    // Skip "put it into your hand" or "put that card on top"
    while (idx < slice.length && slice[idx] !== ',' && slice[idx] !== '.' && slice[idx] !== 'then') {
      if (slice[idx] === 'top') {
        destination = 'top';
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
 * Match: "sacrifice a creature" / "sacrifice an artifact" (as effect, not cost)
 * Match: "sacrifice a permanent"
 */
function matchSacrificeAsEffect(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'sacrifice') return null;
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
function matchEachPlayerEffect(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;
  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'player') return null;

  let idx = 2;

  // "each player draws a card" / "each player draws N cards"
  if (slice[idx] === 'draws') {
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
function matchEachOpponentSacrifice(tokens: string[], startIndex: number): PatternResult {
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
function matchSacrificeSelfUnlessTargetOpponentSacrifices(tokens: string[], startIndex: number): PatternResult {
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
 * Match: "target player sacrifices a creature"
 * Match: "target player sacrifices an artifact"
 */
function matchTargetPlayerSacrifice(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'player') return null;
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
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player');
  const effect: Effect = {
    kind: 'Sacrifice',
    player: makeChosenRef(spec),
    filter: filter.types ? filter : undefined,
    count: 1,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "gain control of target creature"
 * Match: "gain control of target permanent"
 * Match: "gain control of target artifact"
 */
function matchGainControl(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'gain') return null;
  if (slice[1] !== 'control') return null;
  if (slice[2] !== 'of') return null;
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
 * Match: "return all creatures to their owners' hands"
 * Match: "return all [type] to their owners' hands"
 */
function matchReturnAllToHand(tokens: string[], startIndex: number): PatternResult {
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
    target: { kind: 'AllOfType', filter },
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "exile all artifacts" / "exile all enchantments" / "exile all creatures"
 */
function matchExileAll(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'exile') return null;
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
 * Match: "destroy all artifacts" / "destroy all enchantments"
 * (extends existing destroyAll which only handles creatures)
 */
function matchDestroyAllExpanded(tokens: string[], startIndex: number): PatternResult {
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
 * Match: "~ deals damage equal to the number of creatures you control to any target"
 * Match: "~ deals damage to target creature equal to the number of creatures you control"
 * Simplified: recognizes "damage equal to the number of [type] you control"
 */
function matchDealDamageForEach(tokens: string[], startIndex: number): PatternResult {
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
function matchDealDamageGreatestManaValue(tokens: string[], startIndex: number): PatternResult {
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

// ============================================================================
// Phase 16: Blink/flicker, copy, keyword granting, phasing patterns
// ============================================================================

/**
 * Known keywords for "target creature gains [keyword] until end of turn"
 */
const GRANTABLE_KEYWORDS: Record<string, string> = {
  'hexproof': 'Hexproof',
  'indestructible': 'Indestructible',
  'flying': 'Flying',
  'trample': 'Trample',
  'lifelink': 'Lifelink',
  'deathtouch': 'Deathtouch',
  'vigilance': 'Vigilance',
  'reach': 'Reach',
  'menace': 'Menace',
  'haste': 'Haste',
  'defender': 'Defender',
  'shroud': 'Shroud',
  'flash': 'Flash',
  'double strike': 'Double Strike',
  'first strike': 'First Strike',
};

function readGrantableKeyword(tokens: string[], index: number): { keyword: string; consumed: number } | null {
  const twoWordKey = tokens[index] + ' ' + tokens[index + 1];
  if (GRANTABLE_KEYWORDS[twoWordKey]) {
    return { keyword: GRANTABLE_KEYWORDS[twoWordKey], consumed: 2 };
  }
  if (GRANTABLE_KEYWORDS[tokens[index]]) {
    return { keyword: GRANTABLE_KEYWORDS[tokens[index]], consumed: 1 };
  }
  return null;
}

/**
 * Match: "target creature gets -2/-0 and loses flying until end of turn"
 * Match: "target creature defending player controls gets -2/-0 and loses flying until your next turn"
 */
function matchModifyPTAndLoseKeyword(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 10) return null;
  if (slice[0] !== 'target' || slice[1] !== 'creature') return null;

  let idx = 2;
  if (slice[idx] === 'defending' && slice[idx + 1] === 'player' && slice[idx + 2] === 'controls') {
    idx += 3;
  } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    idx += 3;
  } else if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    idx += 2;
  }

  if (slice[idx] !== 'gets') return null;
  const ptMatch = slice[idx + 1]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  idx += 2;

  if (slice[idx] !== 'and' || slice[idx + 1] !== 'loses') return null;
  idx += 2;

  const keywordResult = readGrantableKeyword(slice, idx);
  if (!keywordResult) return null;
  idx += keywordResult.consumed;

  let untilEndOfTurn = false;
  if (slice[idx] === 'until') {
    if (slice[idx + 1] === 'end' && slice[idx + 2] === 'of' && slice[idx + 3] === 'turn') {
      untilEndOfTurn = true;
      idx += 4;
    } else if (slice[idx + 1] === 'your' && slice[idx + 2] === 'next' && slice[idx + 3] === 'turn') {
      untilEndOfTurn = true;
      idx += 4;
    } else {
      return null;
    }
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Creature');
  return {
    effects: [
      {
        kind: 'ModifyPT',
        target: makeChosenRef(spec),
        power: parseInt(ptMatch[1], 10),
        toughness: parseInt(ptMatch[2], 10),
        untilEndOfTurn,
      },
      {
        kind: 'LoseKeyword',
        target: makeChosenRef(spec),
        keyword: keywordResult.keyword,
        untilEndOfTurn,
      },
    ],
    targets: [spec],
    consumed: idx,
  };
}

/**
 * Match: "exile target creature, then return it to the battlefield under its owner's control"
 * Match: "exile target creature you control, then return it to the battlefield"
 * Match: "exile target permanent, return it to the battlefield at the beginning of the next end step"
 * Match: "exile target creature. return it to the battlefield under its owner's control"
 */
function matchBlink(tokens: string[], startIndex: number): PatternResult {
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

  // Optional "you control"
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
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

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'Blink',
    target: makeChosenRef(spec),
    delayed: delayed || undefined,
    ownerControl: ownerControl || undefined,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "copy target instant or sorcery spell"
 * Match: "copy target instant or sorcery spell with mana value 4 or less"
 */
function matchCopySpell(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 6) return null;
  if (slice[0] !== 'copy') return null;
  if (slice[1] !== 'target') return null;
  if (slice[2] !== 'instant' || slice[3] !== 'or' || slice[4] !== 'sorcery' || slice[5] !== 'spell') return null;

  let idx = 6;
  let maxManaValue: number | undefined;

  if (slice[idx] === 'with' && slice[idx + 1] === 'mana' && slice[idx + 2] === 'value') {
    const value = parseInt(slice[idx + 3], 10);
    if (Number.isNaN(value)) return null;
    maxManaValue = value;
    idx += 4;
    if (slice[idx] === 'or' && slice[idx + 1] === 'less') idx += 2;
  }

  while (idx < slice.length && slice[idx] !== '.') {
    // "You may choose new targets for the copy" is represented by the copy's target list.
    idx++;
  }
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('InstantOrSorcerySpell');
  const effect: CopySpellEffect = {
    kind: 'CopySpell',
    target: makeChosenRef(spec),
    ...(maxManaValue !== undefined ? { maxManaValue } : {}),
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "copy that spell"
 * Used by triggered abilities such as Swarm Intelligence where the target is
 * the spell that caused the trigger.
 */
function matchCopyThatSpell(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'copy' || slice[1] !== 'that' || slice[2] !== 'spell') return null;

  let idx = 3;
  while (idx < slice.length && slice[idx] !== '.') {
    idx++;
  }
  if (slice[idx] === '.') idx++;

  return {
    effects: [{
      kind: 'CopySpell',
      target: { kind: 'EventSpell' },
    }],
    targets: [],
    consumed: idx,
  };
}

/**
 * Match: "create a token that's a copy of target creature"
 * Match: "create a copy of target creature"
 * Match: "create a token that is a copy of target creature"
 */
function matchCopyCreature(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 7) return null;
  if (slice[0] !== 'create') return null;
  if (slice[1] !== 'a') return null;

  let idx = 2;

  // "create a token that's a copy of ..."
  if (slice[idx] === 'token') {
    idx++;
    // "that's" or "that is"
    if (slice[idx] === "that's") {
      idx++;
    } else if (slice[idx] === 'that' && slice[idx + 1] === 'is') {
      idx += 2;
    } else {
      return null;
    }
    if (slice[idx] !== 'a') return null;
    idx++;
    if (slice[idx] !== 'copy') return null;
    idx++;
    if (slice[idx] !== 'of') return null;
    idx++;
  }
  // "create a copy of ..."
  else if (slice[idx] === 'copy') {
    idx++;
    if (slice[idx] !== 'of') return null;
    idx++;
  } else {
    return null;
  }

  // Now parse target type
  if (slice[idx] !== 'target') return null;
  idx++;

  let targetType: TargetType;
  if (slice[idx] === 'creature') {
    targetType = 'Creature';
    idx++;
  } else if (slice[idx] === 'permanent') {
    targetType = 'Permanent';
    idx++;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'Copy',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "target creature gains [keyword] until end of turn"
 * Match: "target creature you control gains [keyword] until end of turn"
 * Match: "target creature gains [keyword]"
 * Match: "target creature you control gains [keyword]"
 * Match: "target creature gains double strike until end of turn" (two-word keyword)
 * Match: "target creature gains first strike until end of turn" (two-word keyword)
 */
function matchGrantKeyword(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'creature') return null;

  let idx = 2;

  // Optional "you control"
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    idx += 2;
  }

  if (slice[idx] !== 'gains') return null;
  idx++;

  // Try two-word keywords first: "double strike", "first strike"
  let keyword: string | null = null;
  const twoWordKey = slice[idx] + ' ' + slice[idx + 1];
  if (GRANTABLE_KEYWORDS[twoWordKey]) {
    keyword = GRANTABLE_KEYWORDS[twoWordKey];
    idx += 2;
  } else if (GRANTABLE_KEYWORDS[slice[idx]]) {
    keyword = GRANTABLE_KEYWORDS[slice[idx]];
    idx++;
  }

  if (!keyword) return null;

  // Check for "until end of turn"
  let untilEndOfTurn = false;
  if (slice[idx] === 'until' && slice[idx + 1] === 'end' &&
      slice[idx + 2] === 'of' && slice[idx + 3] === 'turn') {
    untilEndOfTurn = true;
    idx += 4;
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Creature');
  const effect: Effect = {
    kind: 'GrantKeyword',
    target: makeChosenRef(spec),
    keyword,
    untilEndOfTurn,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "target creature can't block this turn"
 * Match: "target creature can't attack this turn"
 * Match: "target creature can't attack or block this turn"
 * Match: "target creature can't be blocked this turn"
 */
function matchTargetCombatRestriction(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 6) return null;
  if (slice[0] !== 'target') return null;

  let idx = 1;
  const colorConstraints = colorConstraintFromWord(slice[idx]);
  if (colorConstraints) idx++;
  if (slice[idx] !== 'creature') return null;
  idx++;

  const constraints: TargetSpec['constraints'] = { ...(colorConstraints || {}) };
  if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    constraints.opponentControls = true;
    idx += 3;
  } else if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    idx += 2;
  }

  const consumeNegation = (): boolean => {
    if (slice[idx] === "can't" || slice[idx] === 'cant' || slice[idx] === 'cannot') {
      idx++;
      return true;
    }
    if (slice[idx] === 'can' && slice[idx + 1] === 'not') {
      idx += 2;
      return true;
    }
    return false;
  };
  if (!consumeNegation()) return null;

  const keywords: string[] = [];
  while (idx < slice.length) {
    if (slice[idx] === 'attack') {
      keywords.push('CannotAttack');
      idx++;
    } else if (slice[idx] === 'block') {
      keywords.push('CannotBlock');
      idx++;
    } else if (slice[idx] === 'be' && slice[idx + 1] === 'blocked') {
      keywords.push('Unblockable');
      idx += 2;
    } else {
      break;
    }

    if ((slice[idx] === 'or' || slice[idx] === 'and') && !['this', 'until'].includes(slice[idx + 1])) {
      idx++;
      consumeNegation();
      continue;
    }
    break;
  }
  if (keywords.length === 0) return null;

  let hasDuration = false;
  if (slice[idx] === 'this' && (slice[idx + 1] === 'turn' || slice[idx + 1] === 'combat')) {
    hasDuration = true;
    idx += 2;
  } else if (
    slice[idx] === 'until'
    && slice[idx + 1] === 'end'
    && slice[idx + 2] === 'of'
    && (slice[idx + 3] === 'turn' || slice[idx + 3] === 'combat')
  ) {
    hasDuration = true;
    idx += 4;
  }
  if (!hasDuration) return null;

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  const target = makeChosenRef(spec);
  const effects: Effect[] = [...new Set(keywords)].map(keyword => ({
    kind: 'GrantKeyword',
    target,
    keyword,
    untilEndOfTurn: true,
  }));

  return { effects, targets: [spec], consumed: idx };
}

/**
 * Match: "another target creature you control gains haste until end of turn and gets +X/+X until end of turn, where X is that creature's power"
 * Also handles the same pattern without "another" or "you control".
 */
function matchGrantKeywordAndDynamicPT(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 15) return null;

  let idx = 0;
  if (slice[idx] === 'another') idx++;
  if (slice[idx] !== 'target') return null;
  idx++;
  if (slice[idx] !== 'creature') return null;
  idx++;
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') idx += 2;
  if (slice[idx] !== 'gains') return null;
  idx++;

  const twoWordKey = slice[idx] + ' ' + slice[idx + 1];
  let keyword: string | null = null;
  if (GRANTABLE_KEYWORDS[twoWordKey]) {
    keyword = GRANTABLE_KEYWORDS[twoWordKey];
    idx += 2;
  } else if (GRANTABLE_KEYWORDS[slice[idx]]) {
    keyword = GRANTABLE_KEYWORDS[slice[idx]];
    idx++;
  }
  if (!keyword) return null;

  let keywordUntilEndOfTurn = false;
  if (slice[idx] === 'until' && slice[idx + 1] === 'end' && slice[idx + 2] === 'of' && slice[idx + 3] === 'turn') {
    keywordUntilEndOfTurn = true;
    idx += 4;
  }

  if (slice[idx] !== 'and' || slice[idx + 1] !== 'gets') return null;
  idx += 2;

  const ptMatch = slice[idx]?.match(/^\+x\/\+x$/);
  if (!ptMatch) return null;
  idx++;

  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of' || slice[idx + 3] !== 'turn') return null;
  idx += 4;

  if (slice[idx] === ',') idx++;
  if (slice[idx] !== 'where' || slice[idx + 1] !== 'x' || slice[idx + 2] !== 'is') return null;
  idx += 3;

  const refersToTargetPower =
    (slice[idx] === 'that' && slice[idx + 1] === "creature's" && slice[idx + 2] === 'power')
    || (slice[idx] === 'its' && slice[idx + 1] === 'power');
  if (!refersToTargetPower) return null;
  idx += slice[idx] === 'that' ? 3 : 2;

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Creature');
  const target = makeChosenRef(spec);
  const effects: Effect[] = [
    {
      kind: 'GrantKeyword',
      target,
      keyword,
      untilEndOfTurn: keywordUntilEndOfTurn,
    },
    {
      kind: 'ModifyPT',
      target,
      power: { kind: 'TargetPower', target },
      toughness: { kind: 'TargetPower', target },
      untilEndOfTurn: true,
    },
  ];

  return { effects, targets: [spec], consumed: idx };
}

/**
 * Match: "target permanent phases out"
 * Match: "target creature phases out"
 */
function matchPhaseOut(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

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
 * Match: "you win the game"
 */
function matchWinGame(tokens: string[], startIndex: number): PatternResult {
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
function matchAddMana(tokens: string[], startIndex: number): PatternResult {
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
function matchLoseGame(tokens: string[], startIndex: number): PatternResult {
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

// ============================================================================
// Phase 15: Static ability and conditional effect pattern matchers
// ============================================================================

function parseStaticFilterType(word: string): CardFilter | null {
  const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
  };
  // Map of plural → singular for creature subtypes
  const subtypeMap: Record<string, string> = {
    'elf': 'elf', 'elves': 'elf',
    'goblin': 'goblin', 'goblins': 'goblin',
    'zombie': 'zombie', 'zombies': 'zombie',
    'dragon': 'dragon', 'dragons': 'dragon',
    'angel': 'angel', 'angels': 'angel',
    'demon': 'demon', 'demons': 'demon',
    'merfolk': 'merfolk',
    'soldier': 'soldier', 'soldiers': 'soldier',
    'wizard': 'wizard', 'wizards': 'wizard',
    'knight': 'knight', 'knights': 'knight',
    'warrior': 'warrior', 'warriors': 'warrior',
    'cleric': 'cleric', 'clerics': 'cleric',
    'rogue': 'rogue', 'rogues': 'rogue',
    'shaman': 'shaman', 'shamans': 'shaman',
    'beast': 'beast', 'beasts': 'beast',
    'elemental': 'elemental', 'elementals': 'elemental',
    'vampire': 'vampire', 'vampires': 'vampire',
    'sliver': 'sliver', 'slivers': 'sliver',
    'human': 'human', 'humans': 'human',
    'spirit': 'spirit', 'spirits': 'spirit',
    'bird': 'bird', 'birds': 'bird',
    'cat': 'cat', 'cats': 'cat',
    'dinosaur': 'dinosaur', 'dinosaurs': 'dinosaur',
    'pirate': 'pirate', 'pirates': 'pirate',
    'dwarf': 'dwarf', 'dwarves': 'dwarf',
    'wolf': 'wolf', 'wolves': 'wolf',
  };
  const creatureSubtypes = Object.keys(subtypeMap);
  const singular = subtypeMap[word] || word.replace(/s$/, '');
  if (word === 'creatures' || word === 'creature') return { types: ['creature'] };
  if (word === 'artifacts' || word === 'artifact') return { types: ['artifact'] };
  if (word === 'enchantments' || word === 'enchantment') return { types: ['enchantment'] };
  if (word === 'instants' || word === 'instant') return { types: ['instant'] };
  if (word === 'sorceries' || word === 'sorcery') return { types: ['sorcery'] };
  if (word === 'lands' || word === 'land') return { types: ['land'] };
  if (word === 'planeswalkers' || word === 'planeswalker') return { types: ['planeswalker'] };
  if (word === 'battles' || word === 'battle') return { types: ['battle'] };
  if (word === 'permanents' || word === 'permanent') return { permanent: true };
  if (word === 'spells' || word === 'spell') return {};
  if (word === 'legendary') return { supertypes: ['Legendary'] };
  if (word === 'basic') return { supertypes: ['Basic'] };
  if (word === 'snow') return { supertypes: ['Snow'] };
  if (word === 'multicolored') return { multicolored: true };
  if (colorMap[word]) return { colors: [colorMap[word]] };
  if (creatureSubtypes.includes(word)) return { types: ['creature'], subtypes: [singular] };
  return null;
}

function mergeStaticFilters(a: CardFilter, b: CardFilter): CardFilter {
  const merge = <T,>(left?: T[], right?: T[]): T[] | undefined => {
    const values = [...(left || []), ...(right || [])];
    return values.length > 0 ? [...new Set(values)] : undefined;
  };
  return {
    types: merge(a.types, b.types),
    subtypes: merge(a.subtypes, b.subtypes),
    excludeSubtypes: merge(a.excludeSubtypes, b.excludeSubtypes),
    supertypes: merge(a.supertypes, b.supertypes),
    colors: merge(a.colors, b.colors),
    multicolored: a.multicolored || b.multicolored || undefined,
    cmc: b.cmc || a.cmc,
    power: b.power || a.power,
    permanent: a.permanent || b.permanent || undefined,
    manaValueLessThanSourcePower: a.manaValueLessThanSourcePower || b.manaValueLessThanSourcePower || undefined,
    chosenCreatureTypeFromSource: a.chosenCreatureTypeFromSource || b.chosenCreatureTypeFromSource || undefined,
  };
}

function parseStaticSubject(tokens: string[], startIndex: number): { filter: CardFilter; nextIndex: number } | null {
  let idx = startIndex;
  const first = parseStaticFilterType(tokens[idx]);
  if (!first) return null;
  let filter = first;
  idx++;

  while (idx < tokens.length) {
    if (tokens[idx] === 'and') {
      const nextFilter = parseStaticFilterType(tokens[idx + 1]);
      if (!nextFilter) break;
      filter = mergeStaticFilters(filter, nextFilter);
      idx += 2;
      continue;
    }

    const nextFilter = parseStaticFilterType(tokens[idx]);
    const currentIsOnlyColor = !!filter.colors?.length
      && !filter.types?.length
      && !filter.subtypes?.length
      && !filter.supertypes?.length;
    if (nextFilter && currentIsOnlyColor) {
      filter = mergeStaticFilters(filter, nextFilter);
      idx++;
      continue;
    }
    break;
  }

  if (['creature', 'creatures', 'spell', 'spells'].includes(tokens[idx])) {
    idx++;
  }

  return { filter, nextIndex: idx };
}

function staticKeywordModifier(keywords: string[]): StaticModifier {
  const uniqueKeywords = [...new Set(keywords)];
  return uniqueKeywords.length === 1
    ? { kind: 'GrantKeyword', keyword: uniqueKeywords[0] }
    : { kind: 'GrantKeywords', keywords: uniqueKeywords };
}

function readStaticCombatRestrictions(tokens: string[], startIndex: number): { keywords: string[]; consumed: number } | null {
  let idx = startIndex;
  const keywords: string[] = [];

  while (idx < tokens.length) {
    if (tokens[idx] === '.') {
      idx++;
      break;
    }
    if (tokens[idx] === 'and') {
      idx++;
      continue;
    }

    const negationConsumed = (
      tokens[idx] === 'can' && tokens[idx + 1] === 'not'
    ) ? 2 : (
      tokens[idx] === "can't" || tokens[idx] === 'cant' || tokens[idx] === 'cannot'
    ) ? 1 : 0;
    if (!negationConsumed) break;
    idx += negationConsumed;

    if (tokens[idx] === 'block') {
      keywords.push('CannotBlock');
      idx++;
      continue;
    }
    if (tokens[idx] === 'attack') {
      keywords.push('CannotAttack');
      idx++;
      continue;
    }
    if (tokens[idx] === 'be' && tokens[idx + 1] === 'blocked') {
      keywords.push('unblockable');
      idx += 2;
      continue;
    }
    break;
  }

  return keywords.length > 0 ? { keywords, consumed: idx - startIndex } : null;
}

function matchStaticAbility(tokens: string[]): StaticAbilityEffect | null {
  let idx = 0;
  let excludeSelf = false;
  let selfOnly = false;
  let filter: CardFilter = {};
  let controller: 'you' | 'opponent' | 'any' = 'you';

  if (tokens[idx] === 'other') { excludeSelf = true; idx++; }
  if (tokens[idx] === '~') {
    selfOnly = true;
    controller = 'any';
    idx++;
  } else if (tokens[idx] === 'this' && tokens[idx + 1] === 'creature') {
    selfOnly = true;
    controller = 'any';
    filter = { types: ['creature'] };
    idx += 2;
  } else {
    const subject = parseStaticSubject(tokens, idx);
    if (!subject) return null;
    filter = subject.filter;
    idx = subject.nextIndex;

    if (tokens[idx] === 'you' && tokens[idx + 1] === 'control') { controller = 'you'; idx += 2; }
    else if (tokens[idx] === 'an' && tokens[idx + 1] === 'opponent' && tokens[idx + 2] === 'controls') { controller = 'opponent'; idx += 3; }
    else if (tokens[idx] === 'you' && tokens[idx + 1] === 'cast') { controller = 'you'; idx += 2; }
    else return null;
  }

  if (tokens[idx] === 'with' && tokens[idx + 1] === 'power') {
    const power = parseInt(tokens[idx + 2], 10);
    if (isNaN(power)) return null;
    if (tokens[idx + 3] === 'or' && tokens[idx + 4] === 'greater') {
      filter.power = { op: 'gte', value: power };
      idx += 5;
    } else if (tokens[idx + 3] === 'or' && tokens[idx + 4] === 'less') {
      filter.power = { op: 'lte', value: power };
      idx += 5;
    } else {
      return null;
    }
  }

  if ((tokens[idx] === 'with' && tokens[idx + 1] === 'power')) return null;

  if (tokens[idx] === 'of' && tokens[idx + 1] === 'the' && tokens[idx + 2] === 'chosen' && tokens[idx + 3] === 'type') {
    filter.chosenCreatureTypeFromSource = true;
    idx += 4;
  }

  const combatRestrictions = readStaticCombatRestrictions(tokens, idx);
  if (combatRestrictions) {
    idx += combatRestrictions.consumed;
    return { kind: 'StaticAbility', modifier: staticKeywordModifier(combatRestrictions.keywords), filter, controller, excludeSelf, selfOnly };
  }

  if (tokens[idx] === 'get' || tokens[idx] === 'gets') {
    idx++;
    const ptMatch = tokens[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    idx++;
    // "until end of turn" means this is a temporary effect, NOT a static ability
    if (tokens[idx] === 'until') return null;
    if (
      tokens[idx] === 'for'
      && tokens[idx + 1] === 'each'
      && tokens[idx + 2] === 'color'
      && tokens[idx + 3] === 'among'
      && tokens[idx + 4] === 'other'
      && tokens[idx + 5] === 'legendary'
      && tokens[idx + 6] === 'permanents'
      && tokens[idx + 7] === 'you'
      && tokens[idx + 8] === 'control'
    ) {
      idx += 9;
      if (tokens[idx] === '.') idx++;
      return {
        kind: 'StaticAbility',
        modifier: {
          kind: 'ModifyPTByUniqueColorsAmongOtherLegendaryPermanentsYouControl',
          powerPerColor: parseInt(ptMatch[1], 10),
          toughnessPerColor: parseInt(ptMatch[2], 10),
        },
        filter,
        controller,
        excludeSelf,
        selfOnly,
      };
    }
    if (tokens[idx] === '.') idx++;
    return { kind: 'StaticAbility', modifier: { kind: 'ModifyPT', power: parseInt(ptMatch[1], 10), toughness: parseInt(ptMatch[2], 10) }, filter, controller, excludeSelf, selfOnly };
  }
  if (tokens[idx] === 'have' || tokens[idx] === 'has') {
    idx++;
    let keyword = tokens[idx];
    if (!keyword) return null;
    if ((keyword === 'first' || keyword === 'double') && tokens[idx + 1] === 'strike') {
      keyword = `${keyword} strike`;
      idx += 2;
    } else {
      idx++;
    }
    if (tokens[idx] === '.') idx++;
    return { kind: 'StaticAbility', modifier: { kind: 'GrantKeyword', keyword }, filter, controller, excludeSelf, selfOnly };
  }
  if (tokens[idx] === 'cost') {
    idx++;
    const costMatch = tokens[idx]?.match(/^\{(\d+)\}$/);
    if (!costMatch) return null;
    idx++;
    if (tokens[idx] !== 'less') return null;
    idx++;
    if (tokens[idx] === 'to' && tokens[idx + 1] === 'cast') idx += 2;
    if (tokens[idx] === '.') idx++;
    return { kind: 'StaticAbility', modifier: { kind: 'ReduceCost', amount: parseInt(costMatch[1], 10) }, filter, controller, excludeSelf, selfOnly };
  }
  return null;
}

function matchConditionalEffect(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 6) return null;

  if (slice[0] === 'if' && slice[1] === 'you' && slice[2] === 'control' && slice[3] === 'a') {
    let idx = 4;
    const typeWord = slice[idx];
    if (!typeWord) return null;
    let filter = parseStaticFilterType(typeWord);
    if (!filter) { filter = { types: ['creature'], subtypes: [typeWord.replace(/s$/, '')] }; }
    idx++;
    if (slice[idx] === ',') idx++;
    const effectResult = parseEffectClauseInternal(tokens, startIndex + idx);
    if (!effectResult) return null;
    const condEffect: ConditionalEffect = { kind: 'Conditional', condition: { kind: 'ControlsType', controller: 'you', filter }, effect: effectResult.effects[0] };
    return { effects: [condEffect], targets: effectResult.targets, consumed: idx + effectResult.consumed };
  }

  if (slice[0] === 'if' && slice[1] === 'an' && slice[2] === 'opponent' && slice[3] === 'controls' && slice[4] === 'more') {
    let idx = 5;
    const typeWord = slice[idx];
    if (!typeWord) return null;
    const filter = parseStaticFilterType(typeWord);
    if (!filter) return null;
    idx++;
    if (slice[idx] !== 'than' || slice[idx + 1] !== 'you') return null;
    idx += 2;
    if (slice[idx] === ',') idx++;
    const effectResult = parseEffectClauseInternal(tokens, startIndex + idx);
    if (!effectResult) return null;
    const condEffect: ConditionalEffect = { kind: 'Conditional', condition: { kind: 'ControlsMoreThan', who: 'opponent', what: filter, thanWho: 'you' }, effect: effectResult.effects[0] };
    return { effects: [condEffect], targets: effectResult.targets, consumed: idx + effectResult.consumed };
  }

  return null;
}

function parseEffectClauseInternal(tokens: string[], startIndex: number): PatternResult {
  let actualStartIndex = startIndex;
  if (tokens[actualStartIndex] === 'you' && tokens[actualStartIndex + 1] === 'may') {
    actualStartIndex += 2;
  }

  const patterns = [
    matchWinGame, matchLoseGame, matchAddMana,
    matchBlink, matchCopyThatSpell, matchCopySpell, matchCopyCreature, matchModifyPTAndLoseKeyword, matchGrantKeywordAndDynamicPT, matchTargetCombatRestriction, matchGrantKeyword, matchPhaseOut,
    matchPreventDamage, matchDealDamageGreatestManaValue, matchDealDamageForEach, matchForEachDraw, matchCreateTokenForEach,
    matchExileFromLibraryTop, matchSearchLibraryGeneric, matchSacrificeSelfUnlessTargetOpponentSacrifices, matchEachOpponentSacrifice,
    matchEachPlayerEffect, matchTargetPlayerSacrifice, matchSacrificeAsEffect,
    matchGainControl, matchReturnAllToHand, matchExileAll, matchDestroyAllExpanded,
    matchDealXDamage, matchDrawX, matchEachOpponentLosesLife,
    matchEachOpponentDiscardsCard, matchDestroyAll, matchDealDamage, matchDestroy,
    matchLookAtTargetPlayerHand, matchLookAtTopPutOneIntoHand, matchPutLandFromHandOntoBattlefield, matchThatPlayerDraw, matchTargetPlayerDraw, matchDraw,
    matchGainLife, matchLoseLife, matchExile, matchPutCreatureCardFromOpponentGraveyardOntoBattlefield, matchReturnFromGraveyard, matchReturnThatCardToHand,
    matchReturnLandYouControlToHand, matchReturnToHand, matchMill, matchGainEnergy, matchAddCounters, matchModifyPT, matchTap,
    matchUntap, matchRollD20, matchThatPlayerCreatesToken, matchCreateToken, matchDiscard, matchDiscardSelf, matchScry,
    matchSurveil, matchCounterSpell, matchFight,
  ];
  for (const pattern of patterns) {
    const result = pattern(tokens, actualStartIndex);
    if (result) {
      return {
        ...result,
        consumed: result.consumed + (actualStartIndex - startIndex),
      };
    }
  }
  return null;
}

/**
 * Try to parse an effect clause starting at the given index.
 * Returns the first matching pattern.
 */
function parseEffectClause(tokens: string[], startIndex: number): PatternResult {
  let actualStartIndex = startIndex;
  if (tokens[actualStartIndex] === 'you' && tokens[actualStartIndex + 1] === 'may') {
    actualStartIndex += 2;
  }

  // Try patterns in priority order (specific/complex before general, X patterns first)
  const patterns = [
    // Win/lose game effects (simple patterns, high priority)
    matchWinGame,                 // "you win the game"
    matchLoseGame,                // "you lose the game" / "target player loses the game"
    matchAddMana,                 // "add {R}{R}{R}"

    // Phase 15: Conditional effects (before other patterns)
    matchConditionalEffect,       // "if you control a [type], [effect]"

    // Phase 16: Blink, copy, keyword granting, phasing (must come before simpler exile/target patterns)
    matchBlink,                   // "exile target creature, then return it to the battlefield..."
    matchCopyThatSpell,           // "copy that spell"
    matchCopySpell,               // "copy target instant or sorcery spell"
    matchCopyCreature,            // "create a token that's a copy of target creature"
    matchModifyPTAndLoseKeyword,
    matchGrantKeywordAndDynamicPT,
    matchTargetCombatRestriction, // "target creature can't block this turn"
    matchGrantKeyword,            // "target creature gains hexproof until end of turn"
    matchPhaseOut,                // "target permanent phases out"

    // Phase 14: New complex patterns (must come before simpler versions)
    matchPreventDamage,           // "prevent all combat damage that would be dealt this turn"
    matchDealDamageGreatestManaValue, // "~ deals damage to any target equal to the greatest mana value..."
    matchDealDamageForEach,       // "~ deals damage equal to the number of..."
    matchForEachDraw,             // "draw a card for each creature you control"
    matchCreateTokenForEach,      // "create a 1/1 ... token for each ..."
    matchExileFromLibraryTop,     // "exile the top N cards of your library"
    matchSearchLibraryGeneric,    // "search your library for a card" (generic tutor)
    matchSacrificeSelfUnlessTargetOpponentSacrifices, // "sacrifice it unless target opponent sacrifices a creature"
    matchEachOpponentSacrifice,   // "each opponent sacrifices a creature"
    matchEachPlayerEffect,        // "each player draws/sacrifices/discards"
    matchTargetPlayerSacrifice,   // "target player sacrifices a creature"
    matchSacrificeAsEffect,       // "sacrifice a creature" (as effect)
    matchGainControl,             // "gain control of target creature"
    matchReturnAllToHand,         // "return all creatures to their owners' hands"
    matchExileAll,                // "exile all artifacts"
    matchDestroyAllExpanded,      // "destroy all artifacts/enchantments"

    // Phase 10: X patterns
    matchDealXDamage,
    matchDrawX,

    // Phase 10: Each opponent patterns
    matchEachOpponentLosesLife,
    matchEachOpponentDiscardsCard,
    matchDestroyAll,

    // Core patterns
    matchDealDamage,
    matchDestroy,
    matchLookAtTargetPlayerHand,
    matchLookAtTopPutOneIntoHand,
    matchPutLandFromHandOntoBattlefield,
    matchThatPlayerDraw,
    matchTargetPlayerDraw,
    matchDraw,
    matchGainLife,
    matchLoseLife,
    matchExile,
    matchPutCreatureCardFromOpponentGraveyardOntoBattlefield,
    matchReturnFromGraveyard, // before ReturnToHand — "return target creature card from..."
    matchReturnThatCardToHand,
    matchReturnLandYouControlToHand,
    matchReturnToHand,
    matchMill,
    matchGainEnergy,
    matchAddCounters,
    matchModifyPT,
    matchTap,
    matchUntap,
    matchRollD20,
    matchThatPlayerCreatesToken,
    matchCreateToken,
    matchDiscard,
    matchDiscardSelf,
    matchScry,
    matchSurveil,
    matchCounterSpell,
    matchFight,
  ];

  for (const pattern of patterns) {
    const result = pattern(tokens, actualStartIndex);
    if (result) {
      return {
        ...result,
        consumed: result.consumed + (actualStartIndex - startIndex),
      };
    }
  }

  return null;
}

/**
 * Check if tokens start with ETB trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchETBPrefix(tokens: string[]): number {
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

/**
 * Check if tokens start with dies trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchDiesPrefix(tokens: string[]): number {
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
 */
function matchAttacksPrefix(tokens: string[]): number {
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

  idx++;
  if (tokens[idx] === ',') idx++;

  return idx;
}

function matchSelfAttacksAndIsntBlockedPrefix(tokens: string[]): number {
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

function matchSelfBecomesTappedPrefix(tokens: string[]): number {
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

function matchCreatureYouControlAttacksPrefix(tokens: string[]): number {
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

function matchSelfCombatDamageToPlayerPrefix(tokens: string[]): number {
  if (tokens.length < 9) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== '~') return -1;
  if (tokens[2] !== 'deals') return -1;
  if (tokens[3] !== 'combat') return -1;
  if (tokens[4] !== 'damage') return -1;
  if (tokens[5] !== 'to') return -1;
  if (tokens[6] !== 'a') return -1;
  if (tokens[7] !== 'player') return -1;

  let idx = 8;
  if (tokens[idx] === ',') idx++;

  return idx;
}

function matchCreatureYouControlCombatDamageToPlayerPrefix(tokens: string[]): number {
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
 * Check if tokens start with "At the beginning of your upkeep ," trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchUpkeepPrefix(tokens: string[]): number {
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
function matchBeginningCombatPrefix(tokens: string[]): number {
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
function matchEndStepPrefix(tokens: string[]): number {
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
function matchEachOpponentEndStepPrefix(tokens: string[]): number {
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
function matchAnotherCreatureETBPrefix(tokens: string[]): CreatureETBPrefixMatch | null {
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
 * Check if tokens start with "Whenever a creature you control dies ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchCreatureYouControlDiesPrefix(tokens: string[]): number {
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
 * Check if tokens start with "Whenever you cast a spell ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchYouCastSpellPrefix(tokens: string[]): number {
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
function matchYouCastNoncreatureSpellPrefix(tokens: string[]): number {
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
function matchLifeGainPrefix(tokens: string[]): number {
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
 * Check if tokens start with "Whenever you draw a card ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchCardDrawnPrefix(tokens: string[]): number {
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
 * Check if tokens start with "Whenever an opponent casts a spell ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchOpponentCastSpellPrefix(tokens: string[]): number {
  // "whenever an opponent casts a spell ,"
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'an') return -1;
  if (tokens[2] !== 'opponent') return -1;
  if (tokens[3] !== 'casts') return -1;
  if (tokens[4] !== 'a') return -1;
  if (tokens[5] !== 'spell') return -1;

  let idx = 6;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever a creature enters the battlefield ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchAnyCreatureETBPrefix(tokens: string[]): CreatureETBPrefixMatch | null {
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
function matchCreatureYouControlETBPrefix(tokens: string[]): CreatureETBPrefixMatch | null {
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
function matchCastInstantOrSorceryPrefix(tokens: string[]): number {
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
function matchCastOrCopyInstantOrSorceryPrefix(tokens: string[]): number {
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
function matchEachPlayerUpkeepPrefix(tokens: string[]): number {
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
 * Check if tokens start with a landfall trigger prefix.
 * Handles both the verbose phrasing
 *   "whenever a land enters the battlefield under your control ,"
 * and the modern concise phrasing
 *   "whenever a land you control enters ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchLandfallPrefix(tokens: string[]): number {
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

/**
 * Try all new trigger prefixes and return [Trigger, effectStartIndex] or null.
 */
function matchTriggerPrefix(tokens: string[]): { trigger: Trigger; effectStart: number } | null {
  let idx: number;

  idx = matchSelfAttacksAndIsntBlockedPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Unblocked', who: 'self' }, effectStart: idx };

  idx = matchAttacksPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Attacks', who: 'self' }, effectStart: idx };

  idx = matchSelfBecomesTappedPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'BecomesTapped', who: 'self' }, effectStart: idx };

  idx = matchCreatureYouControlAttacksPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CreatureYouControlAttacks' }, effectStart: idx };

  idx = matchSelfCombatDamageToPlayerPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CombatDamageToPlayer', who: 'self' }, effectStart: idx };

  idx = matchCreatureYouControlCombatDamageToPlayerPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CombatDamageToPlayer', who: 'creatureYouControl' }, effectStart: idx };

  idx = matchUpkeepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Upkeep', whose: 'yours' }, effectStart: idx };

  idx = matchBeginningCombatPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'BeginningCombat', whose: 'yours' }, effectStart: idx };

  idx = matchEndStepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'EndStep', whose: 'yours' }, effectStart: idx };

  idx = matchEachOpponentEndStepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'EndStep', whose: 'opponents' }, effectStart: idx };

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

  idx = matchCardDrawnPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CardDrawn' }, effectStart: idx };

  idx = matchOpponentCastSpellPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'OpponentCastSpell' }, effectStart: idx };

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

  idx = matchEachPlayerUpkeepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Upkeep', whose: 'each' }, effectStart: idx };

  idx = matchLandfallPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Landfall' }, effectStart: idx };

  return null;
}

/**
 * Parse multiple effect clauses from tokens, splitting on "then", "and", and ". " boundaries.
 * Returns combined effects and targets, or null if nothing parsed.
 */
function parseMultipleEffects(tokens: string[], startIndex: number): PatternResult {
  const allEffects: Effect[] = [];
  const allTargets: TargetSpec[] = [];

  // Split tokens into clauses by "then", "and", or sentence boundaries
  // We process greedily: try to match at current position, then look for separators
  let pos = startIndex;

  while (pos < tokens.length) {
    // Skip separators: "then", "and", ",", "."
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t === 'then' || t === ',' || t === '.') {
        pos++;
      } else if (t === 'and' && allEffects.length > 0) {
        // Only skip "and" if we already parsed at least one effect
        pos++;
      } else {
        break;
      }
    }

    if (pos >= tokens.length) break;

    if (
      allEffects.length > 0 &&
      tokens[pos] === 'at' &&
      tokens[pos + 1] === 'the' &&
      tokens[pos + 2] === 'beginning'
    ) {
      break;
    }

    const result = parseEffectClause(tokens, pos);
    if (result) {
      allEffects.push(...result.effects);
      allTargets.push(...result.targets);
      pos += result.consumed;
    } else {
      // Can't parse remaining tokens — skip to next separator
      pos++;
    }
  }

  if (allEffects.length === 0) return null;

  return {
    effects: allEffects,
    targets: allTargets,
    consumed: tokens.length - startIndex, // consumed everything we could
  };
}

function isOptionalEffectClause(tokens: string[], startIndex: number): boolean {
  let pos = startIndex;
  while (pos < tokens.length && (tokens[pos] === ',' || tokens[pos] === '.')) {
    pos += 1;
  }
  return tokens[pos] === 'you' && tokens[pos + 1] === 'may';
}

/**
 * Check if mana cost contains X.
 */
export function hasXInCost(manaCost: string): boolean {
  return manaCost.includes('{X}');
}

/**
 * Parse modal spell text.
 * "Choose one —" or "Choose two —"
 */
function formatModalChoiceLabel(tokens: string[], fallback: string): string {
  const text = tokens
    .filter(token => token !== '.' && token !== ',' && token !== ';')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  const normalized = text.length > 80 ? `${text.slice(0, 77)}...` : text;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function parseModalSpell(tokens: string[]): ModalSpell | null {
  if (tokens.length < 3) return null;
  if (tokens[0] !== 'choose') return null;

  let chooseCount: number;
  let upTo = false;

  if (tokens[1] === 'one' && tokens[2] === 'or' && tokens[3] === 'both') {
    // "choose one or both"
    chooseCount = 2;
    upTo = true;
  } else if (tokens[1] === 'one') {
    chooseCount = 1;
  } else if (tokens[1] === 'two') {
    chooseCount = 2;
  } else {
    return null;
  }

  // Find the dash (—)
  let dashIdx = -1;
  for (let i = 2; i < tokens.length; i++) {
    if (tokens[i] === '—' || tokens[i] === '-' || tokens[i] === '–') {
      dashIdx = i;
      break;
    }
  }
  if (dashIdx === -1) return null;

  // Parse choices (each starts with •)
  const choices: ModalChoice[] = [];
  let currentChoice: { tokens: string[]; label: string } | null = null;

  for (let i = dashIdx + 1; i < tokens.length; i++) {
    if (tokens[i] === '•') {
      // Start new choice
      if (currentChoice && currentChoice.tokens.length > 0) {
        const result = parseEffectClause(currentChoice.tokens, 0);
        if (result) {
          choices.push({
            label: formatModalChoiceLabel(currentChoice.tokens, currentChoice.label),
            effects: result.effects,
            targets: result.targets.map(t => ({ id: t.id, type: t.type })),
          });
        }
      }
      currentChoice = { tokens: [], label: `Choice ${choices.length + 1}` };
    } else if (currentChoice) {
      currentChoice.tokens.push(tokens[i]);
    }
  }

  // Handle last choice
  if (currentChoice && currentChoice.tokens.length > 0) {
    const result = parseEffectClause(currentChoice.tokens, 0);
    if (result) {
      choices.push({
        label: formatModalChoiceLabel(currentChoice.tokens, currentChoice.label),
        effects: result.effects,
        targets: result.targets.map(t => ({ id: t.id, type: t.type })),
      });
    }
  }

  if (choices.length === 0) return null;

  return {
    kind: 'Modal',
    chooseCount,
    upTo: upTo || undefined,
    choices,
  };
}

/**
 * Parse oracle text into a ParsedOracle result.
 */
export function parseOracleText(oracleText: string, manaCost?: string): ParsedOracle {
  // Reset counter for deterministic IDs in tests
  targetSpecCounter = 0;

  const tokens = trimLeadingKeywordOrEnchantPreamble(tokenizeOracleText(oracleText));
  const xCost = manaCost ? hasXInCost(manaCost) : false;

  if (tokens.length === 0) {
    return { kind: 'Unparsed', reason: 'Empty oracle text' };
  }

  // Phase 15: Check for static ability ("Creatures you control get +1/+1", etc.)
  const staticAbility = matchStaticAbility(tokens);
  if (staticAbility) {
    return { kind: 'StaticAbility', ability: staticAbility };
  }

  // Check for modal spell ("Choose one —" or "Choose two —")
  if (tokens[0] === 'choose') {
    const modal = parseModalSpell(tokens);
    if (modal) {
      return { kind: 'Modal', modal, xCost };
    }
  }

  // Check for ETB trigger.
  const etbIndex = matchETBPrefix(tokens);
  if (etbIndex > 0) {
    const optional = isOptionalEffectClause(tokens, etbIndex);
    const effectResult = parseMultipleEffects(tokens, etbIndex);
    if (effectResult) {
      const ability: TriggeredAbility = {
        kind: 'TriggeredAbility',
        trigger: { kind: 'ETB', who: 'self' },
        effects: effectResult.effects,
        ...(optional ? { optional: true } : {}),
      };
      return {
        kind: 'ETB',
        ability,
        targets: effectResult.targets,
      };
    }
    return { kind: 'Unparsed', reason: 'Could not parse ETB effect clause' };
  }

  // Some permanents carry non-trigger entry text before the ETB sentence, e.g.
  // "This land enters tapped. When this land enters...". Only claim ETB if the
  // nested trigger's effect clause is parseable; otherwise let later matchers
  // keep any simpler first-clause coverage instead of downgrading the card.
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] !== 'when' && tokens[i] !== 'whenever') continue;
    const nestedIndex = matchETBPrefix(tokens.slice(i));
    if (nestedIndex <= 0) continue;
    const effectIndex = i + nestedIndex;
    const optional = isOptionalEffectClause(tokens, effectIndex);
    const effectResult = parseMultipleEffects(tokens, effectIndex);
    if (!effectResult) continue;
    const ability: TriggeredAbility = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'ETB', who: 'self' },
      effects: effectResult.effects,
      ...(optional ? { optional: true } : {}),
    };
    return {
      kind: 'ETB',
      ability,
      targets: effectResult.targets,
    };
  }

  // Check for dies trigger
  const diesIndex = matchDiesPrefix(tokens);
  if (diesIndex > 0) {
    const optional = isOptionalEffectClause(tokens, diesIndex);
    const effectResult = parseMultipleEffects(tokens, diesIndex);
    if (effectResult) {
      const trigger: Trigger = tokens[1] === 'enchanted' && tokens[2] === 'creature'
        ? { kind: 'AttachedCreatureDies' }
        : { kind: 'Dies', who: 'self' };
      const ability: TriggeredAbility = {
        kind: 'TriggeredAbility',
        trigger,
        effects: effectResult.effects,
        ...(optional ? { optional: true } : {}),
      };
      return {
        kind: 'Dies',
        ability,
        targets: effectResult.targets,
      };
    }
    return { kind: 'Unparsed', reason: 'Could not parse dies effect clause' };
  }

  // Check for new trigger types (attacks, upkeep, end step, etc.)
  const triggerMatch = matchTriggerPrefix(tokens);
  if (triggerMatch) {
    const optional = isOptionalEffectClause(tokens, triggerMatch.effectStart);
    const effectResult = parseMultipleEffects(tokens, triggerMatch.effectStart);
    if (effectResult) {
      const ability: TriggeredAbility = {
        kind: 'TriggeredAbility',
        trigger: triggerMatch.trigger,
        effects: effectResult.effects,
        ...(optional ? { optional: true } : {}),
      };
      return {
        kind: 'Triggered',
        ability,
        targets: effectResult.targets,
      };
    }
    return { kind: 'Unparsed', reason: 'Could not parse trigger effect clause' };
  }

  const activatedAbilities = parseActivatedAbilities(oracleText);
  if (activatedAbilities.length > 0) {
    return { kind: 'Activated', abilities: activatedAbilities };
  }

  // Try to parse as a spell effect (with multi-effect support)
  const effectResult = parseMultipleEffects(tokens, 0);
  if (effectResult) {
    return {
      kind: 'Spell',
      effects: effectResult.effects,
      targets: effectResult.targets,
      xCost,
    };
  }

  return { kind: 'Unparsed', reason: 'No recognized pattern' };
}

/**
 * Convenience: check if oracle text is parseable.
 */
export function canParseOracleText(oracleText: string): boolean {
  const result = parseOracleText(oracleText);
  return result.kind !== 'Unparsed';
}

// ============================================================================
// Activated ability parsing
// ============================================================================

const MANA_SYMBOL_RE = /^\{[^}]+\}(?:\{[^}]+\})*$/;

/**
 * Parse the cost portion of an activated ability (tokens before the colon).
 * Recognizes: {T}, "sacrifice ~", mana symbols like {2}{B}
 */
function parseCostTokens(tokens: string[]): ActivatedAbilityCost | null {
  const cost: ActivatedAbilityCost = {};
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];

    // {t} = tap symbol
    if (tok === '{t}') {
      cost.tap = true;
      i++;
      // skip comma
      if (tokens[i] === ',') i++;
      continue;
    }

    // "sacrifice ~", "sacrifice this", or "sacrifice <card name>"
    if (tok === 'sacrifice') {
      cost.sacrifice = 'self';
      i++; // skip "sacrifice"
      // Consume the sacrifice target (could be "~", "this", or a card name)
      while (i < tokens.length && tokens[i] !== ',' && !tokens[i].startsWith('{')) {
        i++;
      }
      if (tokens[i] === ',') i++;
      continue;
    }

    // "pay 1 life"
    if (tok === 'pay') {
      const amount = parseInt(tokens[i + 1], 10);
      if (isNaN(amount) || tokens[i + 2] !== 'life') return null;
      cost.payLife = (cost.payLife || 0) + amount;
      i += 3;
      if (tokens[i] === ',') i++;
      continue;
    }

    // Mana symbol(s) like {2}{b}
    if (tok.startsWith('{') && tok.endsWith('}')) {
      cost.mana = tok;
      i++;
      if (tokens[i] === ',') i++;
      continue;
    }

    // Unknown cost token — bail
    return null;
  }

  // Must have at least one cost component
  if (!cost.tap && !cost.sacrifice && !cost.mana && !cost.payLife) return null;

  return cost;
}

/**
 * Match "search your library for a basic land card, put it onto the battlefield tapped, then shuffle"
 * and variations. Returns SearchLibrary + optional Shuffle effects.
 */
function matchSearchLibrary(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "search your library for a basic land card"
  // "search your library for a Mountain or Plains card"
  if (slice.length < 7) return null;
  if (slice[0] !== 'search') return null;
  if (slice[1] !== 'your') return null;
  if (slice[2] !== 'library') return null;
  if (slice[3] !== 'for') return null;
  if (slice[4] !== 'a') return null;

  let idx = 5;

  const supertypes: string[] = [];
  const types: string[] = [];
  const subtypes: string[] = [];
  const BASIC_LAND_SUBTYPES = new Set(['plains', 'island', 'swamp', 'mountain', 'forest']);

  if (slice[idx] === 'basic') {
    supertypes.push('basic');
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

  // Skip "card"
  if (slice[idx] === 'card') idx++;
  // Skip comma
  if (slice[idx] === ',') idx++;

  // Parse destination: "put it onto the battlefield [tapped]" or "put it into your hand"
  let destination: 'battlefield' | 'hand' | 'top' | 'graveyard' = 'battlefield';
  let tapped = false;

  if (slice[idx] === 'put' && slice[idx + 1] === 'it') {
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
 * Check if a set of effects contains any mana-producing effect.
 */
function containsManaEffect(effects: Effect[]): boolean {
  return effects.some(effect => effect.kind === 'AddMana');
}

/**
 * Parse activated abilities from oracle text.
 * Does NOT modify parseOracleText(). This is a separate function.
 *
 * Splits on newlines, looks for ":" colon separator, parses cost and effect.
 */
export function parseActivatedAbilities(oracleText: string): ActivatedAbility[] {
  if (!oracleText) return [];

  const abilities: ActivatedAbility[] = [];
  const lines = oracleText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip lines that are clearly not activated abilities
    // (triggered abilities start with "when", "whenever", "at")
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('when ') || lower.startsWith('whenever ') || lower.startsWith('at ')) continue;

    // Skip loyalty abilities (handled by parseLoyaltyAbilities)
    if (/^[+\-−–]?\d+\s*:/.test(trimmed)) continue;

    // Look for colon separator (but not inside mana symbols like {T})
    // An activated ability has the form: <cost> : <effect>
    const colonIdx = findAbilityColon(trimmed);
    if (colonIdx === -1) continue;

    const costPart = trimmed.slice(0, colonIdx).trim();
    const effectPart = trimmed.slice(colonIdx + 1).trim();

    if (!costPart || !effectPart) continue;

    // Tokenize cost and effect parts
    const costTokens = tokenizeOracleText(costPart);
    const effectTokens = tokenizeOracleText(effectPart);

    // Parse cost
    const cost = parseCostTokens(costTokens);
    if (!cost) continue;

    // Try to parse effects (SearchLibrary first, then standard patterns)
    let result = matchSearchLibrary(effectTokens, 0);
    if (!result) {
      result = parseEffectClause(effectTokens, 0);
    }

    if (!result) continue;

    const isManaAbility = containsManaEffect(result.effects);

    abilities.push({
      kind: 'ActivatedAbility',
      cost,
      effects: result.effects,
      isManaAbility,
      targets: result.targets,
    });
  }

  return abilities;
}

/**
 * Find the colon that separates cost from effect in an activated ability line.
 * Skips colons inside braces like {T}.
 */
function findAbilityColon(text: string): number {
  let inBrace = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') inBrace = true;
    else if (text[i] === '}') inBrace = false;
    else if (text[i] === ':' && !inBrace) return i;
  }
  return -1;
}

// ============================================================================
// Phase 17: Planeswalker loyalty ability parsing
// ============================================================================

/** Regex to match loyalty ability cost prefix: "+1:", "-3:", "0:", "+2:" */
const LOYALTY_COST_RE = /^([+\-−–]?\d+)\s*:/;

/**
 * Parse planeswalker loyalty abilities from oracle text.
 * Each line starting with "+N:", "-N:", or "0:" is a loyalty ability.
 *
 * Returns an array of LoyaltyAbility AST nodes.
 */
export function parseLoyaltyAbilities(oracleText: string): LoyaltyAbility[] {
  if (!oracleText) return [];

  // Reset counter for deterministic IDs in tests
  targetSpecCounter = 0;

  const abilities: LoyaltyAbility[] = [];
  const lines = oracleText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = LOYALTY_COST_RE.exec(trimmed);
    if (!match) continue;

    const loyaltyCost = parseInt(match[1], 10);
    const effectPart = trimmed.slice(match[0].length).trim();

    if (!effectPart) continue;

    // Tokenize and parse the effect portion using existing patterns
    const effectTokens = tokenizeOracleText(effectPart);
    const result = parseMultipleEffects(effectTokens, 0);

    if (!result) continue;

    abilities.push({
      kind: 'LoyaltyAbility',
      loyaltyCost,
      effects: result.effects,
      targets: result.targets.map(t => ({ id: t.id, type: t.type })),
    });
  }

  return abilities;
}
