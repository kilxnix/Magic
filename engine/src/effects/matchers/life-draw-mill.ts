// Life/draw/mill matchers extracted from parser.ts (batch 5/12).
// Do NOT edit logic here — keep verbatim with parser.ts originals.

import type { Effect, AmountRef, ForEachAmount, TargetRef, GreatestToughnessAmount } from '../ast';
import type { TargetSpec } from '../targets';
import type { PatternResult } from '../parser';
import {
  makeTargetSpec,
  makeChosenRef,
  parseSmallNumberToken,
  parseEqualToAmount,
  parseEventCreatureStatAmount,
  parseWhereXIsNumberOf,
  parseWhereXIsAnyAmount,
  parseNumberOfYouControlAmount,
  parsePlayerAmountToken,
} from '../parser';

/**
 * Match: "draw a card"
 * Match: "draw N cards"
 * Match: "draw two cards"
 */
export function matchDraw(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  let base = 0;
  if (slice[base] === 'you') base++;
  if (slice[base] !== 'draw' && slice[base] !== 'draws') return null;

  let count: AmountRef;
  let consumed: number;

  // "draw cards equal to <dynamic>"
  if (slice[base + 1] === 'cards' && slice[base + 2] === 'equal' && slice[base + 3] === 'to') {
    const dyn = parseEqualToAmount(slice, base + 4);
    if (!dyn) return null;
    count = dyn.amount;
    consumed = dyn.nextIndex;
  }
  // "draw a card"
  else if (slice[base + 1] === 'a' && slice[base + 2] === 'card') {
    count = 1;
    consumed = base + 3;
  }
  // "draw an additional card" — Immortal Sun draw-step trigger wording.
  else if (slice[base + 1] === 'an' && slice[base + 2] === 'additional' && slice[base + 3] === 'card') {
    count = 1;
    consumed = base + 4;
  }
  // "draw N cards"
  else {
    const n = parseSmallNumberToken(slice[base + 1]);
    if (isNaN(n)) return null;
    if (slice[base + 2] !== 'cards') return null;
    count = n;
    consumed = base + 3;
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
export function matchTargetPlayerDraw(tokens: string[], startIndex: number): PatternResult {
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
 * Match: "that player draws a card" / "that player draws N cards"
 *
 * "That player" resolves via EventPlayer:
 *   — per-player-upkeep triggers: the active player whose upkeep began.
 *   — opponent-cast-spell triggers: the spell's caster (casterId == eventPlayerId for SpellCast).
 *   — combat-damage-to-player triggers: the damaged player.
 *
 * Slice 8/12: changed from EventCaster to EventPlayer so upkeep-trigger bodies
 * ("At the beginning of each player's upkeep, that player draws a card") work correctly.
 * For SpellCast events casterId == eventPlayerId so no behaviour change there.
 */
export function matchThatPlayerDraw(tokens: string[], startIndex: number): PatternResult {
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
      player: { kind: 'EventPlayer' },
      count,
    }],
    targets: [],
    consumed,
  };
}

/**
 * Match: "draw X cards"
 */
export function matchDrawX(tokens: string[], startIndex: number): PatternResult {
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

/** Match: "[you] draw X cards, where X is the number of <filter> <place>". */
export function matchDrawXWhereX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice[off] !== 'draw' && slice[off] !== 'draws') return null;
  off++;
  if (slice[off] !== 'x' || slice[off + 1] !== 'cards') return null;
  const dyn = parseWhereXIsNumberOf(slice, off + 2);
  if (!dyn) return null;
  let consumed = dyn.nextIndex;
  if (slice[consumed] === '.') consumed++;
  return {
    effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: dyn.amount }],
    targets: [],
    consumed,
  };
}

/**
 * Match: "[you] draw cards equal to the number of cards in your hand|graveyard|library"
 *        "[you] draw cards equal to the number of <type/subtype> you control"
 * Controller draws; honest ForEach amount. matchDraw's "equal to" branch only
 * recognizes parseEqualToAmount shapes (power / permanent-type counts), so these
 * zone-count and subtype shapes need this dedicated matcher ordered before it.
 */
export function matchDrawEqualToNumberOf(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice[off] !== 'draw' && slice[off] !== 'draws') return null;
  off++;
  if (slice[off] !== 'cards' || slice[off + 1] !== 'equal' || slice[off + 2] !== 'to') return null;
  const dyn = parseNumberOfYouControlAmount(slice, off + 3);
  if (!dyn) return null;
  let consumed = dyn.nextIndex;
  if (tokens[startIndex + consumed] === '.') consumed++;
  return {
    effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: dyn.amount }],
    targets: [],
    consumed,
  };
}

/**
 * Slice 4/CBC — Draw equal to greatest toughness:
 *   "Draw cards equal to the greatest toughness among creatures you control."
 *   "[,] then draw cards equal to the greatest toughness among creatures
 *    you control[, then put any number of creature cards from your hand
 *    onto the battlefield]."
 *
 * This is the sibling clause in Last March of the Ents after the CBC line is
 * absorbed by absorbSelfCBCLines. The "then put any number of creature cards …"
 * tail is handled separately (it has no executor support and is naturally left
 * unparsed; this matcher only claims the draw portion).
 *
 * HONEST: resolveAmount already resolves GreatestToughnessAmount via
 * resolveGreatestToughness in executor.ts (added in this same slice). The Draw
 * executor branch passes the resolved count directly — no new executor code needed
 * beyond the GreatestToughness amount resolver.
 *
 * Accepted forms:
 *   "draw cards equal to the greatest toughness among creatures you control"
 *   "draw cards equal to the greatest toughness among creatures an opponent controls"
 *   "draw cards equal to the greatest toughness among creatures on the battlefield"
 */
export function matchDrawEqualToGreatestToughness(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let off = 0;

  // Optional leading "you"
  if (slice[off] === 'you') off++;

  if (slice[off] !== 'draw' && slice[off] !== 'draws') return null;
  off++;

  // "cards equal to the greatest toughness among"
  if (
    slice[off] !== 'cards' ||
    slice[off + 1] !== 'equal' ||
    slice[off + 2] !== 'to' ||
    slice[off + 3] !== 'the' ||
    slice[off + 4] !== 'greatest' ||
    slice[off + 5] !== 'toughness' ||
    slice[off + 6] !== 'among'
  ) return null;
  off += 7;

  // Filter words (e.g. "creatures") before the controller phrase.
  const filterWords: string[] = [];
  while (
    off < slice.length &&
    !['you', 'your', 'on', 'an', '.', ',', 'then'].includes(slice[off])
  ) {
    filterWords.push(slice[off]);
    off++;
  }

  // Controller / zone phrase
  let controller: 'you' | 'opponent' | 'each' = 'each';
  if (slice[off] === 'you' && slice[off + 1] === 'control') {
    controller = 'you';
    off += 2;
  } else if (
    slice[off] === 'an' && slice[off + 1] === 'opponent' && slice[off + 2] === 'controls'
  ) {
    controller = 'opponent';
    off += 3;
  } else if (
    slice[off] === 'on' && slice[off + 1] === 'the' && slice[off + 2] === 'battlefield'
  ) {
    controller = 'each';
    off += 3;
  } else {
    return null;
  }

  if (slice[off] === '.') off++;

  // Build a creature filter from any filter words (strip bare "creature(s)").
  const meaningful = filterWords.filter(w => w !== 'creature' && w !== 'creatures');
  const filter: import('../ast').CardFilter = { types: ['creature'] };
  // Only accept bare creature filter for now (no extra qualifiers).
  if (meaningful.length > 0) return null;

  const amount: GreatestToughnessAmount = {
    kind: 'GreatestToughness',
    zone: 'battlefield',
    filter,
    controller,
  };

  return {
    effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: amount }],
    targets: [],
    consumed: off,
  };
}

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
  const filter: import('../ast').CardFilter = {};

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
  // "in target opponent's hand" in a count-only draw pattern.
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

export { matchForEachDraw };

export function matchGainLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Optional "you " / "you gain(s)" lead-in (e.g. "You gain 3 life.").
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice[off] !== 'gain' && slice[off] !== 'gains') return null;
  off++;

  // "gain life equal to <dynamic>" — its power / the number of <type> you control.
  if (slice[off] === 'life' && slice[off + 1] === 'equal' && slice[off + 2] === 'to') {
    // Slice 10: "equal to that creature's toughness/power" — EventCreatureStat
    const creatureStat = parseEventCreatureStatAmount(slice, off + 3);
    if (creatureStat) {
      let consumed = creatureStat.nextIndex;
      if (tokens[startIndex + consumed] === '.') consumed++;
      const effect: Effect = { kind: 'GainLife', player: { kind: 'Controller' }, amount: creatureStat.amount };
      return { effects: [effect], targets: [], consumed };
    }
    const dyn = parseEqualToAmount(slice, off + 3);
    if (!dyn) return null;
    let consumed = dyn.nextIndex;
    if (tokens[startIndex + consumed] === '.') consumed++;
    const effect: Effect = { kind: 'GainLife', player: { kind: 'Controller' }, amount: dyn.amount };
    return { effects: [effect], targets: [], consumed };
  }

  // Slice 6: allow bare 'x' token as {kind:'X'} (resolved from cast-time {X} cost).
  // HONESTY: only accept 'x' when there is NO trailing ', where x is ...' clause —
  // those are handled by matchGainLifeXWhereX (which runs before us in the dispatch
  // order). If a where-clause follows and matchGainLifeXWhereX declined it (unsupported
  // amount source), we must also decline rather than swallowing just the "gain X life"
  // fragment and leaving the where-clause as unrecognized garbage.
  let amount: import('../ast').AmountRef;
  if (slice[off] === 'x') {
    // Reject if next tokens are "life , where" — that is the where-X form.
    if (slice[off + 1] === 'life' && (slice[off + 2] === ',' || slice[off + 2] === 'where')) {
      return null;
    }
    amount = { kind: 'X' };
  } else {
    const parsedInt = parseInt(slice[off], 10);
    const parsedAmount = !isNaN(parsedInt) ? parsedInt : parseSmallNumberToken(slice[off]);
    if (isNaN(parsedAmount)) return null;
    amount = parsedAmount;
  }

  if (slice[off + 1] !== 'life') return null;

  let consumed = off + 2;

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
export function matchLoseLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Optional "you " / "you lose(s)" lead-in (e.g. "You lose 2 life.").
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice[off] !== 'lose' && slice[off] !== 'loses') return null;
  off++;

  // "lose life equal to <dynamic>"
  if (slice[off] === 'life' && slice[off + 1] === 'equal' && slice[off + 2] === 'to') {
    const dyn = parseEqualToAmount(slice, off + 3);
    if (!dyn) return null;
    let consumed = dyn.nextIndex;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects: [{ kind: 'LoseLife', player: { kind: 'Controller' }, amount: dyn.amount }], targets: [], consumed };
  }

  // Slice 6: allow bare 'x' token as {kind:'X'} (resolved from cast-time {X} cost).
  // HONESTY: only accept 'x' when:
  //   - the subject IS 'you' (i.e. the text started with 'you lose X life'), and
  //   - there is NO trailing ', where x is ...' clause (handled by matchLoseLifeXWhereX).
  // Without the 'you' requirement, "each opponent loses x life, where X is..." could be
  // partially matched at the 'loses' position, leaving the where-clause stranded.
  // After consuming optional 'you' and the verb, off == 2 iff 'you' was present
  // (0→1 for 'you', 1→2 for verb), off == 1 iff no 'you' (0→1 for verb only).
  const hadYouSubject = off === 2;
  let amount: import('../ast').AmountRef;
  if (slice[off] === 'x') {
    // Only accept bare X from cost when the subject is explicitly 'you'.
    // Without an explicit 'you', this is likely a fragment of a
    // "each <subject> loses X life, where X is..." sentence; let it stay Unparsed.
    if (!hadYouSubject) return null;
    // Also reject if next tokens are "life , where" or "life where" — the where-X form.
    if (slice[off + 1] === 'life' && (slice[off + 2] === ',' || slice[off + 2] === 'where')) {
      return null;
    }
    amount = { kind: 'X' };
  } else {
    const parsedInt = parseInt(slice[off], 10);
    const parsedAmount = !isNaN(parsedInt) ? parsedInt : parseSmallNumberToken(slice[off]);
    if (isNaN(parsedAmount)) return null;
    amount = parsedAmount;
  }

  if (slice[off + 1] !== 'life') return null;

  let consumed = off + 2;

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

/** Match: "[you] gain X life, where X is the number of <filter> <place>". */
export function matchGainLifeXWhereX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice[off] !== 'gain' && slice[off] !== 'gains') return null;
  off++;
  if (slice[off] !== 'x' || slice[off + 1] !== 'life') return null;
  const dyn = parseWhereXIsNumberOf(slice, off + 2);
  if (!dyn) return null;
  let consumed = dyn.nextIndex;
  if (slice[consumed] === '.') consumed++;
  return {
    effects: [{ kind: 'GainLife', player: { kind: 'Controller' }, amount: dyn.amount }],
    targets: [],
    consumed,
  };
}

/** Match: "[you] lose X life, where X is the number of <filter> <place>". */
export function matchLoseLifeXWhereX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice[off] !== 'lose' && slice[off] !== 'loses') return null;
  off++;
  if (slice[off] !== 'x' || slice[off + 1] !== 'life') return null;
  const dyn = parseWhereXIsNumberOf(slice, off + 2);
  if (!dyn) return null;
  let consumed = dyn.nextIndex;
  if (slice[consumed] === '.') consumed++;
  return {
    effects: [{ kind: 'LoseLife', player: { kind: 'Controller' }, amount: dyn.amount }],
    targets: [],
    consumed,
  };
}

/**
 * Match: "you gain life equal to the number of cards in your hand|graveyard|library"
 *        "you gain life equal to the number of <type/subtype> you control"
 * Controller gains life; the ForEach amount is counted honestly at resolution.
 * Registered BEFORE matchGainLife so these dynamic shapes win over the generic
 * "equal to" handler (which only knows battlefield permanent-type counts).
 */
export function matchGainLifeEqualToNumberOf(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice[off] !== 'gain' && slice[off] !== 'gains') return null;
  off++;
  if (slice[off] !== 'life' || slice[off + 1] !== 'equal' || slice[off + 2] !== 'to') return null;
  const dyn = parseNumberOfYouControlAmount(slice, off + 3);
  if (!dyn) return null;
  let consumed = dyn.nextIndex;
  if (tokens[startIndex + consumed] === '.') consumed++;
  return {
    effects: [{ kind: 'GainLife', player: { kind: 'Controller' }, amount: dyn.amount }],
    targets: [],
    consumed,
  };
}

/**
 * Match: "you lose life equal to the number of cards in your hand|graveyard|library"
 *        "you lose life equal to the number of <type/subtype> you control"
 */
export function matchLoseLifeEqualToNumberOf(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice[off] !== 'lose' && slice[off] !== 'loses') return null;
  off++;
  if (slice[off] !== 'life' || slice[off + 1] !== 'equal' || slice[off + 2] !== 'to') return null;
  const dyn = parseNumberOfYouControlAmount(slice, off + 3);
  if (!dyn) return null;
  let consumed = dyn.nextIndex;
  if (tokens[startIndex + consumed] === '.') consumed++;
  return {
    effects: [{ kind: 'LoseLife', player: { kind: 'Controller' }, amount: dyn.amount }],
    targets: [],
    consumed,
  };
}

/**
 * Slice 4: Match "Target player gains X life." / "Target opponent gains X life."
 * Used by the Alabaster Potion modal bullet. Emits GainLife with amount { kind: 'X' }.
 * The executor's GainLife branch calls resolveAmount which maps { kind: 'X' } to xValue.
 * Must come BEFORE matchTargetPlayerGainLife (which only handles numeric amounts).
 */
export function matchTargetPlayerGainLifeX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 5) return null;
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'player' && slice[1] !== 'opponent') return null;
  if (slice[2] !== 'gains') return null;
  if (slice[3] !== 'x') return null;
  if (slice[4] !== 'life') return null;

  let consumed = 5;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Player');
  const effect: Effect = {
    kind: 'GainLife',
    player: makeChosenRef(spec),
    amount: { kind: 'X' },
  };
  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "target player gains N life" / "target opponent gains N life".
 * The chosen Player gains the life — executed honestly by the GainLife executor.
 */
export function matchTargetPlayerGainLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 5) return null;
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'player' && slice[1] !== 'opponent') return null;
  if (slice[2] !== 'gains') return null;

  const amount = parsePlayerAmountToken(slice[3]);
  if (isNaN(amount)) return null;
  if (slice[4] !== 'life') return null;

  let consumed = 5;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Player');
  const effect: Effect = {
    kind: 'GainLife',
    player: makeChosenRef(spec),
    amount,
  };
  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "target player loses N life" / "target opponent loses N life".
 * The chosen Player target is the one who loses life — executed honestly by
 * the LoseLife executor via resolveTargetRef on the Chosen ref.
 */
export function matchTargetPlayerLoseLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 5) return null;
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'player' && slice[1] !== 'opponent') return null;
  if (slice[2] !== 'loses') return null;

  // Slice 6: allow bare 'x' token as {kind:'X'} (resolved from cast-time {X} cost).
  // HONESTY: reject if followed by ', where x is ...' — that form must stay Unparsed
  // when the where-clause source is unsupported (e.g. 'number of times').
  let amount: import('../ast').AmountRef;
  if (slice[3] === 'x') {
    // Reject if "x life , where" — the where-X form must be handled by where-X matchers.
    if (slice[4] === 'life' && (slice[5] === ',' || slice[5] === 'where')) {
      return null;
    }
    amount = { kind: 'X' };
  } else {
    const parsed = parsePlayerAmountToken(slice[3]);
    if (isNaN(parsed)) return null;
    amount = parsed;
  }
  if (slice[4] !== 'life') return null;

  let consumed = 5;
  if (tokens[startIndex + consumed] === '.') consumed++;

  // "target opponent" is modeled as a Player target; legal-target generation /
  // AI restricts the choice to an opponent at play time.
  const spec = makeTargetSpec('Player');
  const effect: Effect = {
    kind: 'LoseLife',
    player: makeChosenRef(spec),
    amount,
  };
  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "target player|opponent loses life equal to the number of <type/subtype> you control"
 *        "target player|opponent loses life equal to the number of cards in your hand|graveyard|library"
 * The chosen Player loses life; honest LoseLife on a chosen target with a ForEach amount.
 * Covers e.g. Shaman of the Pack ("loses life equal to the number of Elves you control").
 */
export function matchTargetPlayerLoseLifeEqualToNumberOf(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'player' && slice[1] !== 'opponent') return null;
  if (slice[2] !== 'loses') return null;
  if (slice[3] !== 'life' || slice[4] !== 'equal' || slice[5] !== 'to') return null;
  const dyn = parseNumberOfYouControlAmount(slice, 6);
  if (!dyn) return null;
  let consumed = dyn.nextIndex;
  if (tokens[startIndex + consumed] === '.') consumed++;
  const spec = makeTargetSpec('Player');
  return {
    effects: [{ kind: 'LoseLife', player: makeChosenRef(spec), amount: dyn.amount }],
    targets: [spec],
    consumed,
  };
}

/**
 * Match: "each player gains N life".
 * GainLife executor loops every non-lost player for the EachPlayer ref.
 */
export function matchEachPlayerGainLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 5) return null;
  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'player') return null;
  if (slice[2] !== 'gains') return null;

  const amount = parsePlayerAmountToken(slice[3]);
  if (isNaN(amount)) return null;
  if (slice[4] !== 'life') return null;

  let consumed = 5;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'GainLife',
    player: { kind: 'EachPlayer' },
    amount,
  };
  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "each opponent loses N life"
 */
export function matchEachOpponentLosesLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;
  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'opponent') return null;
  if (slice[2] !== 'loses') return null;

  const parsedInt = parseInt(slice[3], 10);
  const amount = !isNaN(parsedInt) ? parsedInt : parseSmallNumberToken(slice[3]);
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
 * Match: "each opponent loses X life [and you gain X life], where X is the
 * number of <filter> <place>" (Malakir Blood-Priest template). The shared X is
 * a single ForEachAmount applied to both the LoseLife and the GainLife.
 *
 * Slice 6 extension: also accepts "where X is the greatest power among
 * creatures you control" (Skemfar Shadowsage template) via parseWhereXIsAnyAmount.
 */
export function matchEachOpponentLosesXLifeWhereX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'each' || slice[1] !== 'opponent' || slice[2] !== 'loses') return null;
  if (slice[3] !== 'x' || slice[4] !== 'life') return null;
  let idx = 5;
  let alsoGain = false;
  if (slice[idx] === 'and' && slice[idx + 1] === 'you' && slice[idx + 2] === 'gain'
    && slice[idx + 3] === 'x' && slice[idx + 4] === 'life') {
    alsoGain = true;
    idx += 5;
  }
  // Try ForEach ("where X is the number of ...") first, then any AmountRef
  // (covers GreatestPower: "where X is the greatest power among creatures you control").
  let amount: AmountRef | null = null;
  let nextIndex: number | null = null;
  const dynForEach = parseWhereXIsNumberOf(slice, idx);
  if (dynForEach) {
    amount = dynForEach.amount;
    nextIndex = dynForEach.nextIndex;
  } else {
    const dynAny = parseWhereXIsAnyAmount(slice, idx);
    if (dynAny) {
      amount = dynAny.amount;
      nextIndex = dynAny.nextIndex;
    }
  }
  if (amount === null || nextIndex === null) return null;
  let consumed = nextIndex;
  if (slice[consumed] === '.') consumed++;

  const effects: Effect[] = [{ kind: 'LoseLife', player: { kind: 'EachOpponent' }, amount }];
  if (alsoGain) {
    effects.push({ kind: 'GainLife', player: { kind: 'Controller' }, amount });
  }
  return { effects, targets: [], consumed };
}

/**
 * Match: "mill N cards" (controller mills)
 */
export function matchMill(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  const parseMillCount = (tok: string): number => {
    if (tok === 'a' || tok === 'an') return 1;
    const n = parseInt(tok, 10);
    return !isNaN(n) ? n : parseSmallNumberToken(tok);
  };

  // "target player mills N cards"
  if (slice.length >= 5 && slice[0] === 'target' && slice[1] === 'player' && slice[2] === 'mills') {
    const amount = parseMillCount(slice[3]);
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

  // "[you] mill N cards" (N may be a word like "three") or
  // "[you] mill cards equal to <dynamic>"
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice.length >= off + 3 && slice[off] === 'mill') {
    // "mill cards equal to <dynamic>"
    if (slice[off + 1] === 'cards' && slice[off + 2] === 'equal' && slice[off + 3] === 'to') {
      const dyn = parseEqualToAmount(slice, off + 4);
      if (!dyn) return null;
      let consumed = dyn.nextIndex;
      if (tokens[startIndex + consumed] === '.') consumed++;
      return { effects: [{ kind: 'Mill', player: { kind: 'Controller' }, count: dyn.amount }], targets: [], consumed };
    }

    const amount = parseMillCount(slice[off + 1]);
    if (isNaN(amount)) return null;
    if (slice[off + 2] !== 'cards' && slice[off + 2] !== 'card') return null;

    let consumed = off + 3;
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

/** Match: "[you] mill X cards, where X is the number of <filter> <place>". */
export function matchMillXWhereX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice[off] !== 'mill' && slice[off] !== 'mills') return null;
  off++;
  if (slice[off] !== 'x' || slice[off + 1] !== 'cards') return null;
  const dyn = parseWhereXIsNumberOf(slice, off + 2);
  if (!dyn) return null;
  let consumed = dyn.nextIndex;
  if (slice[consumed] === '.') consumed++;
  return {
    effects: [{ kind: 'Mill', player: { kind: 'Controller' }, count: dyn.amount }],
    targets: [],
    consumed,
  };
}

/**
 * Match: "[you] mill cards equal to the number of cards in your hand|graveyard|library"
 *        "[you] mill cards equal to the number of <type/subtype> you control"
 * matchMill already covers parseEqualToAmount shapes; this adds the zone-count and
 * subtype-count shapes. Controller mills (the only Mill target the executor resolves).
 */
export function matchMillEqualToNumberOf(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice[off] !== 'mill' && slice[off] !== 'mills') return null;
  off++;
  if (slice[off] !== 'cards' || slice[off + 1] !== 'equal' || slice[off + 2] !== 'to') return null;
  const dyn = parseNumberOfYouControlAmount(slice, off + 3);
  if (!dyn) return null;
  let consumed = dyn.nextIndex;
  if (tokens[startIndex + consumed] === '.') consumed++;
  return {
    effects: [{ kind: 'Mill', player: { kind: 'Controller' }, count: dyn.amount }],
    targets: [],
    consumed,
  };
}

/**
 * Match: "that player mills N cards" / "that player mills two cards" etc.
 * Slice 11: also handles "that player mills X cards, where X is the number of
 * cards in their hand" (Dreamborn Muse). Uses EventPlayerHandCount for the
 * dynamic amount so the executor can count the mill-player's hand at resolution
 * time (the mill player IS the EventPlayer resolved from eventContext.eventPlayerId).
 * Used in "At the beginning of each player's upkeep, that player mills N cards"
 * trigger bodies. The EventPlayer TargetRef resolves to eventContext.eventPlayerId
 * (the active player at the time the upkeep trigger fires).
 */
export function matchThatPlayerMill(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player' || slice[2] !== 'mills') return null;

  // Slice 11: "that player mills X cards, where X is the number of cards in their hand"
  // Tokens: ["that","player","mills","x","cards",",","where","x","is","the","number","of","cards","in","their","hand","."]
  if (slice[3] === 'x' && (slice[4] === 'cards' || slice[4] === 'card')) {
    let i = 5;
    if (slice[i] === ',') i++;
    if (
      slice[i] === 'where' && slice[i + 1] === 'x' && slice[i + 2] === 'is' &&
      slice[i + 3] === 'the' && slice[i + 4] === 'number' && slice[i + 5] === 'of' &&
      slice[i + 6] === 'cards' && slice[i + 7] === 'in' && slice[i + 8] === 'their' &&
      slice[i + 9] === 'hand'
    ) {
      let consumed = i + 10;
      if (slice[consumed] === '.') consumed++;
      return {
        effects: [{ kind: 'Mill', player: { kind: 'EventPlayer' }, count: { kind: 'EventPlayerHandCount' } as AmountRef }],
        targets: [],
        consumed,
      };
    }
    // "x cards" without a recognized where-clause — decline (don't emit ambiguous X)
    return null;
  }

  let count: number;
  if (slice[3] === 'a' || slice[3] === 'an') {
    // "mills a card" — uncommon but possible
    if (slice[4] !== 'card' && slice[4] !== 'cards') return null;
    count = 1;
  } else {
    const n = parseInt(slice[3], 10);
    const w = parseSmallNumberToken(slice[3]);
    count = !isNaN(n) ? n : w;
    if (isNaN(count)) return null;
    if (slice[4] !== 'cards' && slice[4] !== 'card') return null;
  }

  let consumed = 5;
  if (tokens[startIndex + consumed] === '.') consumed++;

  return {
    effects: [{ kind: 'Mill', player: { kind: 'EventPlayer' }, count }],
    targets: [],
    consumed,
  };
}

/**
 * Slice 5 (event-damage triggers): Match "you gain that much life ."
 *
 * Covers the pre-errata lifelink wording on Auras such as Armadillo Cloak and
 * Vampiric Link, and creature enchantments like Mourning Thrull / Doubtless One.
 * "That much" refers to the amount of damage dealt in the triggering DealsDamage
 * event, stored in eventContext.eventDamageAmount and resolved as EventDamageAmount.
 */
export function matchGainLifeThatMuch(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Accept "you gain that much life ." and bare "gain that much life ."
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice[off] !== 'gain' && slice[off] !== 'gains') return null;
  off++;
  if (slice[off] !== 'that' || slice[off + 1] !== 'much' || slice[off + 2] !== 'life') return null;
  off += 3;

  let consumed = off;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'GainLife',
    player: { kind: 'Controller' },
    amount: { kind: 'EventDamageAmount' },
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "each player gains that much life ."
 * (Rarely seen but valid for symmetric lifegain Auras.)
 */
export function matchEachPlayerGainsThatMuchLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'player') return null;
  if (slice[2] !== 'gains') return null;
  if (slice[3] !== 'that' || slice[4] !== 'much' || slice[5] !== 'life') return null;

  let consumed = 6;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'GainLife',
    player: { kind: 'EachPlayer' },
    amount: { kind: 'EventDamageAmount' },
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Slice 5 (event-damage triggers): Match "this Aura deals that much damage to
 * that creature's controller ." — Guilty Conscience pre-errata reflection wording.
 *
 * "that creature's controller" is the controller of the creature that was
 * being damaged, which is the EventPlayer in the DealsDamage event context.
 * "That much" is EventDamageAmount.
 */
export function matchDealsDamageThatMuchToCreatureController(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "~ deals that much damage to that creature's controller"
  // also: "this aura deals that much damage to that creature's controller"
  let idx = 0;
  if (slice[idx] === '~') idx++;
  else if (slice[idx] === 'this' && (slice[idx + 1] === 'aura' || slice[idx + 1] === 'enchantment' || slice[idx + 1] === 'creature')) {
    idx += 2;
  } else return null;

  if (slice[idx] !== 'deals') return null;
  if (slice[idx + 1] !== 'that' || slice[idx + 2] !== 'much' || slice[idx + 3] !== 'damage') return null;
  if (slice[idx + 4] !== 'to') return null;
  idx += 5;

  // Accept "that creature's controller" or "its controller"
  let controllerRef: TargetRef | null = null;
  if (slice[idx] === 'that' && (slice[idx + 1] === "creature's" || slice[idx + 1] === 'creature') && slice[idx + 2] === 'controller') {
    controllerRef = { kind: 'EventPlayer' };
    idx += 3;
  } else if (slice[idx] === 'its' && slice[idx + 1] === 'controller') {
    controllerRef = { kind: 'EventPlayer' };
    idx += 2;
  } else {
    return null;
  }

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'DealDamage',
    target: controllerRef,
    amount: { kind: 'EventDamageAmount' },
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "each player mills N cards" / "each player mills a card"
 * Match: "each opponent mills N cards" / "each opponent mills a card"
 * The Mill executor loops every non-lost player (EachPlayer) or every
 * non-controller non-lost player (EachOpponent) for these refs.
 */
export function matchEachPlayerOrOpponentMill(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;
  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'player' && slice[1] !== 'opponent') return null;
  if (slice[2] !== 'mills') return null;

  let idx = 3;
  let count: number | { kind: 'X' };
  if (slice[idx] === 'a' || slice[idx] === 'an') {
    count = 1;
    idx++;
  } else if (slice[idx] === 'x') {
    // Slice 7: "each player mills X cards" (Fascination style)
    count = { kind: 'X' };
    idx++;
  } else {
    const n = parseInt(slice[idx], 10);
    count = !isNaN(n) ? n : parseSmallNumberToken(slice[idx]);
    if (typeof count === 'number' && isNaN(count)) return null;
    idx++;
  }
  if (slice[idx] !== 'cards' && slice[idx] !== 'card') return null;
  idx++;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Mill',
    player: { kind: slice[1] === 'opponent' ? 'EachOpponent' : 'EachPlayer' },
    count,
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Slice 2 (EventDamageAmount family): Match "draw that many cards ."
 *
 * "That many" refers to the damage dealt in the triggering event
 * (eventContext.eventDamageAmount). Used in saboteur trigger tails like
 * Fear of Failed Tests ("Whenever ~ deals combat damage to a player, draw
 * that many cards.").
 */
export function matchDrawThatManyCards(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Accept "you draw that many cards" and bare "draw that many cards"
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice[off] !== 'draw') return null;
  off++;
  if (slice[off] !== 'that' || slice[off + 1] !== 'many') return null;
  off += 2;
  if (slice[off] !== 'cards' && slice[off] !== 'card') return null;
  off++;

  let consumed = off;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Draw',
    player: { kind: 'Controller' },
    count: { kind: 'EventDamageAmount' },
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Slice 2 (EventDamageAmount family): Match "target player mills that many cards ."
 *
 * "That many" refers to the damage dealt in the triggering event.
 * Used in saboteur trigger tails like Towering-Wave Mystic ("Whenever ~ deals
 * combat damage to a player, that player mills that many cards.") — note: the
 * oracle uses "target player" in the cost-reduction/damage form; this matcher
 * also handles "target opponent mills that many cards".
 *
 * Note: the Towering-Wave Mystic oracle uses "that player mills that many cards"
 * (EventPlayer, not a chosen target). This matcher handles the "target player"
 * form when the caster explicitly names a chosen player target.
 */
export function matchTargetPlayerMillsThatManyCards(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 6) return null;
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'player' && slice[1] !== 'opponent') return null;
  if (slice[2] !== 'mills') return null;
  if (slice[3] !== 'that' || slice[4] !== 'many') return null;
  if (slice[5] !== 'cards' && slice[5] !== 'card') return null;

  let consumed = 6;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Player');
  const effect: Effect = {
    kind: 'Mill',
    player: makeChosenRef(spec),
    count: { kind: 'EventDamageAmount' },
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Slice 2 (EventDamageAmount family): Match "that player mills that many cards ."
 *
 * "That player" is EventPlayer (the player damaged in the triggering event).
 * "That many" is EventDamageAmount.
 * Used in trigger tails like Towering-Wave Mystic.
 */
export function matchThatPlayerMillsThatManyCards(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 6) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player') return null;
  if (slice[2] !== 'mills') return null;
  if (slice[3] !== 'that' || slice[4] !== 'many') return null;
  if (slice[5] !== 'cards' && slice[5] !== 'card') return null;

  let consumed = 6;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Mill',
    player: { kind: 'EventPlayer' },
    count: { kind: 'EventDamageAmount' },
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Slice 2 (EventDamageAmount family): Match "[you] lose that much life ."
 *
 * "That much" refers to the damage dealt in the triggering event. Covers
 * trigger tails like Wall of Frost / Wall of Souls-style symmetric pain
 * ("you lose that much life").
 */
export function matchLoseLifeThatMuch(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Accept "you lose that much life" and bare "lose that much life"
  let off = 0;
  if (slice[off] === 'you') off++;
  if (slice[off] !== 'lose' && slice[off] !== 'loses') return null;
  off++;
  if (slice[off] !== 'that' || slice[off + 1] !== 'much' || slice[off + 2] !== 'life') return null;
  off += 3;

  let consumed = off;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'LoseLife',
    player: { kind: 'Controller' },
    amount: { kind: 'EventDamageAmount' },
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Brion Stoutarm family: "you gain life equal to the sacrificed creature's power."
 *
 * Matches ONLY the "the sacrificed creature's power" wording, which is unambiguous
 * (the creature was sacrificed as part of the activated-ability cost). The
 * "that creature's power" wording is already handled by matchGainLife (EventCreatureStat
 * branch in life-draw-mill.ts / matchGainLifeEqualToNumberOf) and must NOT be claimed here
 * to avoid breaking triggered-ability parses like "you gain life equal to that creature's
 * power" (Aetherborn / ETB lifelink trigger family → EventCreatureStat).
 *
 * The executor reads the power value from namedCardChoices['sacrificedCreaturePower']
 * written during cost payment in activateAbility.
 *
 * Accepted phrasings (all with "sacrificed"):
 *   "you gain life equal to the sacrificed creature's power."
 */
export function matchGainLifeSacrificedCreaturePower(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // "you gain life equal to …"
  if (slice[idx] === 'you') idx++;
  if (slice[idx] !== 'gain') return null;
  idx++;
  if (slice[idx] !== 'life') return null;
  idx++;
  if (slice[idx] !== 'equal' || slice[idx + 1] !== 'to') return null;
  idx += 2;

  // ONLY match "the sacrificed creature's power" — avoids conflict with EventCreatureStat
  const hasSacrificed =
    slice[idx] === 'the'
    && slice[idx + 1] === 'sacrificed'
    && (slice[idx + 2] === "creature's" || slice[idx + 2] === 'creature')
    && slice[idx + 3] === 'power';
  if (!hasSacrificed) return null;
  idx += 4;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'GainLife',
    player: { kind: 'Controller' },
    amount: { kind: 'SacrificedCreaturePower' },
  };

  return { effects: [effect], targets: [], consumed };
}
