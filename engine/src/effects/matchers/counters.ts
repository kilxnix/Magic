// Counter-related matchers extracted from parser.ts (batch 2/12).
// Do NOT edit logic here — keep verbatim with parser.ts originals.

import type { Effect, AmountRef, CardFilter, TargetRef, StaticAbilityEffect, ForEachAmount } from '../ast';
import type { TargetSpec, TargetType } from '../targets';
import type { PatternResult } from '../parser';
import {
  makeTargetSpec,
  makeChosenRef,
  parseSmallNumberToken,
  targetTypeFromSimplePermanentWord,
  parseStaticFilterType,
  parseNumberOfFilterAmount,
  parseWhereXIsNumberOf,
  parseWhereXIsAnyAmount,
  readCreatureSubtypeTargetPhrase,
  parseDevotionAmount,
} from '../parser';

/**
 * Read a counter-type label that may span two tokens ("first strike",
 * "double strike") or be a single token ("+1/+1", "-1/-1", "stun", "loyalty").
 * Returns the joined label and the number of tokens it consumed, or null.
 */
function readCounterTypeLabel(slice: string[], idx: number): { type: string; consumed: number } | null {
  if ((slice[idx] === 'first' || slice[idx] === 'double') && slice[idx + 1] === 'strike') {
    return { type: `${slice[idx]} strike`, consumed: 2 };
  }
  if (slice[idx]) return { type: slice[idx], consumed: 1 };
  return null;
}

/**
 * Read a leading count for counter clauses: "a"/"an" => 1, else a small number
 * word or numeral. Returns the count and tokens consumed, or null when the token
 * is neither an article nor a parseable number (e.g. "X", "any").
 */
function readCounterCount(token: string | undefined): { count: number; consumed: number } | null {
  if (token === 'a' || token === 'an') return { count: 1, consumed: 1 };
  if (token === undefined) return null;
  const n = Number.isNaN(parseInt(token, 10)) ? parseSmallNumberToken(token) : parseInt(token, 10);
  if (isNaN(n)) return null;
  return { count: n, consumed: 1 };
}

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
      const n = Number.isNaN(parseInt(slice[1], 10)) ? parseSmallNumberToken(slice[1]) : parseInt(slice[1], 10);
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

    // Sub-case A1: "put a +1/+1 counter on ~/it" (self-target). In ETB/triggered
    // contexts "it" refers to the source permanent.
    if (slice[afterOn] === '~' || slice[afterOn] === 'it' || (slice[afterOn] === 'this' && targetTypeFromSimplePermanentWord(slice[afterOn + 1]))) {
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

    // Sub-case A1b: "put a +1/+1 counter on that creature" — the event creature.
    if (slice[afterOn] === 'that' && targetTypeFromSimplePermanentWord(slice[afterOn + 1])) {
      let consumed = afterOn + 2;
      if (tokens[startIndex + consumed] === '.') consumed++;
      const effect: Effect = { kind: 'AddCounters', target: { kind: 'EventCreature' }, counterType, count };
      return { effects: [effect], targets: [], consumed };
    }

    // Sub-case A3b: "put a X counter on each of up to N [other] target
    // creatures [you control]" (Angelic Quartermaster, Protection Magic,
    // Earth Kingdom Soldier). A SINGLE multi-target spec with count=N; the
    // executor's AddCounters case applies the counters to EVERY chosen id via
    // resolveChosenTargetIds, so "up to" runs honestly with fewer choices too.
    if (slice[afterOn] === 'each' && slice[afterOn + 1] === 'of' && slice[afterOn + 2] === 'up' && slice[afterOn + 3] === 'to') {
      const n = parseSmallNumberToken(slice[afterOn + 4]);
      if (Number.isNaN(n) || n < 1) return null;
      let idx = afterOn + 5;
      const constraints: TargetSpec['constraints'] = {};
      if (slice[idx] === 'other') { constraints.notSource = true; idx++; }
      if (slice[idx] !== 'target') return null;
      idx++;
      if (slice[idx] !== 'creatures' && slice[idx] !== 'creature') return null;
      idx++;
      if (slice[idx] === 'you' && slice[idx + 1] === 'control') { constraints.controllerControls = true; idx += 2; }
      if (tokens[startIndex + idx] === '.') idx++;
      const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
      spec.count = n;
      const effect: Effect = { kind: 'AddCounters', target: makeChosenRef(spec), counterType, count };
      return { effects: [effect], targets: [spec], consumed: idx };
    }

    // Sub-case A3c (Strive / Nature's Panoply): "put N <type> counters on any number
    // of target creatures [you control]". Each chosen creature gets the full counter
    // count (unlike distribute which splits the total). count=10 (unbounded), minCount=0.
    // HONEST: executor AddCounters iterates all chosen ids via resolveChosenTargetIds.
    if (slice[afterOn] === 'any' && slice[afterOn + 1] === 'number' && slice[afterOn + 2] === 'of') {
      let idx = afterOn + 3;
      const constraints: TargetSpec['constraints'] = {};
      if (slice[idx] !== 'target') return null;
      idx++;
      if (slice[idx] !== 'creatures' && slice[idx] !== 'creature') return null;
      idx++;
      if (slice[idx] === 'you' && slice[idx + 1] === 'control') { constraints.controllerControls = true; idx += 2; }
      if (tokens[startIndex + idx] === '.') idx++;
      const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
      spec.count = 10; // effectively unbounded
      spec.minCount = 0; // "any number" allows choosing zero
      const effect: Effect = { kind: 'AddCounters', target: makeChosenRef(spec), counterType, count };
      return { effects: [effect], targets: [spec], consumed: idx };
    }

    // Sub-case A3: "put a X counter on each creature [you control]"
    //              "put a X counter on each OTHER creature you control" (excludeSelf)
    //              "put a X counter on each [other] <subtype> creature you control"
    if (slice[afterOn] === 'each') {
      let idx = afterOn + 1;
      let excludeSelf = false;
      if (slice[idx] === 'other') { excludeSelf = true; idx++; }

      // Sub-case A3-attacking: "put a +1/+1 counter on each attacking creature you control"
      // Slice 6 (combat-damage trigger bodies). Uses AllAttackingCreaturesYouControl target.
      if (slice[idx] === 'attacking' && slice[idx + 1] === 'creature' && slice[idx + 2] === 'you' && slice[idx + 3] === 'control') {
        let consumed = idx + 4;
        if (tokens[startIndex + consumed] === '.') consumed++;
        const effect: Effect = { kind: 'AddCounters', target: { kind: 'AllAttackingCreaturesYouControl' }, counterType, count };
        return { effects: [effect], targets: [], consumed };
      }

      // Optional creature-subtype word before "creature" ("each other Dragon
      // creature you control"). Only known creature subtypes are accepted, so
      // unsupported modifiers ("each attacking creature") stay unparsed.
      let filter: CardFilter | undefined;
      if (slice[idx] !== 'creature' && slice[idx]) {
        const subtypeFilter = parseStaticFilterType(slice[idx]);
        if (!subtypeFilter?.subtypes?.length) return null;
        filter = { types: ['creature'], subtypes: subtypeFilter.subtypes };
        idx++;
      }
      if (slice[idx] !== 'creature') return null;
      idx++;

      let youControl = false;
      if (slice[idx] === 'you' && slice[idx + 1] === 'control') { youControl = true; idx += 2; }
      if (tokens[startIndex + idx] === '.') idx++;

      // The subtype form only has a you-control expansion
      // (AllCreaturesYouControlMatching) — leave other controllers unparsed.
      if (filter && !youControl) return null;
      const target: TargetRef = filter
        ? { kind: 'AllCreaturesYouControlMatching', filter }
        : youControl ? { kind: 'AllCreaturesYouControl' } : { kind: 'AllCreatures' };
      const effect: Effect = {
        kind: 'AddCounters', target, counterType, count,
        ...(excludeSelf ? { excludeSelf: true } : {}),
      };
      return { effects: [effect], targets: [], consumed: idx };
    }

    // Sub-case A2: "put a X counter on [up to one|another] target <type>"
    {
      let tIdx = afterOn;
      const constraints: TargetSpec['constraints'] = {};
      if (slice[tIdx] === 'up' && slice[tIdx + 1] === 'to' && slice[tIdx + 2] === 'one') tIdx += 3;
      if (slice[tIdx] === 'another') { constraints.notSource = true; tIdx++; }
      if (slice[tIdx] === 'target' && slice[tIdx + 1]) {
        const typeWord = slice[tIdx + 1];
        const targetType: TargetType | null =
          typeWord === 'creature' ? 'Creature' :
          typeWord === 'permanent' ? 'Permanent' :
          typeWord === 'player' ? 'Player' :
          typeWord === 'artifact' ? 'Artifact' :
          typeWord === 'enchantment' ? 'Enchantment' :
          typeWord === 'land' ? 'Land' : null;
        if (targetType) {
          let consumed = tIdx + 2;
          if (slice[consumed] === 'you' && slice[consumed + 1] === 'control') { constraints.controllerControls = true; consumed += 2; }
          if (tokens[startIndex + consumed] === '.') consumed++;
          const spec = makeTargetSpec(targetType, Object.keys(constraints).length > 0 ? constraints : undefined);
          const effect: Effect = { kind: 'AddCounters', target: makeChosenRef(spec), counterType, count };
          return { effects: [effect], targets: [spec], consumed };
        }
        // "put N counters on [up to one] target <Subtype> [you control]"
        const counterSubtypeRead = readCreatureSubtypeTargetPhrase(slice, tIdx + 1);
        if (counterSubtypeRead) {
          let consumed = tIdx + 1 + counterSubtypeRead.consumed;
          if (tokens[startIndex + consumed] === '.') consumed++;
          const counterSubtypeConstraints: TargetSpec['constraints'] = {
            ...(Object.keys(constraints).length > 0 ? constraints : {}),
            subtypes: counterSubtypeRead.subtypes,
            ...(counterSubtypeRead.controllerControls ? { controllerControls: true } : {}),
            ...(counterSubtypeRead.opponentControls ? { opponentControls: true } : {}),
          };
          const spec = makeTargetSpec('Creature', counterSubtypeConstraints);
          const effect: Effect = { kind: 'AddCounters', target: makeChosenRef(spec), counterType, count };
          return { effects: [effect], targets: [spec], consumed };
        }
      }
    }

    // Sub-case A2-legacy: "put a X counter on target <type>"
    if (slice[afterOn] === 'target' && slice[afterOn + 1]) {
      const typeWord = slice[afterOn + 1];
      const targetType: TargetType =
        typeWord === 'creature' ? 'Creature' :
        typeWord === 'permanent' ? 'Permanent' :
        typeWord === 'player' ? 'Player' :
        typeWord === 'artifact' ? 'Artifact' :
        typeWord === 'enchantment' ? 'Enchantment' :
        typeWord === 'land' ? 'Land' : null as unknown as TargetType;

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

function matchAddCountersWhereX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'put' || slice[1] !== 'x') return null;

  // Locate the "where x is" tail before the sentence ends.
  let whereIdx = -1;
  for (let i = 2; i < slice.length; i++) {
    if (slice[i] === '.') break;
    if (slice[i] === 'where' && slice[i + 1] === 'x' && slice[i + 2] === 'is') { whereIdx = i; break; }
  }
  if (whereIdx === -1) return null;

  const dyn = parseNumberOfFilterAmount(slice, whereIdx + 3);
  if (!dyn) return null;

  const bodyEnd = slice[whereIdx - 1] === ',' ? whereIdx - 1 : whereIdx;
  const sub = ['put', '1', ...slice.slice(2, bodyEnd), '.'];
  const base = matchAddCounters(sub, 0);
  // Require the rebuilt clause to be matched in full so no body words are dropped.
  if (!base || base.consumed !== sub.length) return null;
  const eff = base.effects[0];
  if (eff.kind !== 'AddCounters') return null;

  let consumed = dyn.nextIndex;
  if (slice[consumed] === '.') consumed++;
  return {
    effects: [{ ...eff, count: dyn.amount }],
    targets: base.targets,
    consumed,
  };
}

function matchRemoveCounters(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 3) return null;
  if (slice[0] !== 'remove') return null;

  let count: number;
  let idx: number;
  if (slice[1] === 'a' || slice[1] === 'an') {
    count = 1;
    idx = 2;
  } else {
    const n = Number.isNaN(parseInt(slice[1], 10)) ? parseSmallNumberToken(slice[1]) : parseInt(slice[1], 10);
    if (isNaN(n)) return null;
    count = n;
    idx = 2;
  }

  const counterType = slice[idx];
  if (!counterType) return null;
  idx++;

  if (slice[idx] !== 'counter' && slice[idx] !== 'counters') return null;
  idx++;

  // Optional self-reference suffix: "from it" | "from ~" | "from this <permanent>".
  if (slice[idx] === 'from') {
    if (slice[idx + 1] === 'it' || slice[idx + 1] === '~') {
      idx += 2;
    } else if (slice[idx + 1] === 'this' && targetTypeFromSimplePermanentWord(slice[idx + 2])) {
      idx += 3;
    } else {
      // "from <another permanent>" — not self; bail to be safe.
      return null;
    }
  }

  if (tokens[startIndex + idx] === '.') idx++;

  const effect: Effect = {
    kind: 'RemoveCounters',
    target: { kind: 'Source' },
    counterType,
    count,
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "remove N <type> counter(s) from target creature/permanent/artifact/..."
 *
 * The base matchRemoveCounters only handles self-references ("from it/~/this
 * <perm>"); this adds the targeted form (e.g. Chainbreaker "Remove a -1/-1
 * counter from target creature."). The executor's RemoveCounters case resolves
 * a Chosen target via resolveTargetRef, so this is executed honestly.
 */
function matchRemoveCountersTarget(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'remove') return null;

  const cnt = readCounterCount(slice[1]);
  if (!cnt) return null;
  let idx = 1 + cnt.consumed;

  const label = readCounterTypeLabel(slice, idx);
  if (!label) return null;
  idx += label.consumed;

  if (slice[idx] !== 'counter' && slice[idx] !== 'counters') return null;
  idx++;

  if (slice[idx] !== 'from') return null;
  idx++;
  if (slice[idx] !== 'target') return null;
  idx++;

  const targetType = targetTypeFromSimplePermanentWord(slice[idx]);
  if (!targetType) return null;
  idx++;

  const constraints: TargetSpec['constraints'] = {};
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') { constraints.controllerControls = true; idx += 2; }

  if (tokens[startIndex + idx] === '.') idx++;

  const spec = makeTargetSpec(targetType, Object.keys(constraints).length > 0 ? constraints : undefined);
  const effect: Effect = {
    kind: 'RemoveCounters',
    target: makeChosenRef(spec),
    counterType: label.type,
    count: cnt.count,
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 10: Match "Remove all counters from target creature/permanent/artifact/…"
 *
 * Suncleanser / similar cards: removes every counter type from the target in one
 * effect. The AST carries allCounters=true on the RemoveCountersEffect; the
 * executor iterates every counter type on the chosen permanent and removes them.
 * counterType is set to '*' as a sentinel (ignored by the allCounters executor branch).
 *
 * HONESTY: the executor's RemoveCounters case already handles allCounters=true
 * (see executor.ts Slice 10 branch) — no new subsystem needed.
 */
export function matchRemoveAllCountersFromTarget(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 5) return null;
  if (slice[0] !== 'remove') return null;
  if (slice[1] !== 'all') return null;
  if (slice[2] !== 'counters') return null;
  if (slice[3] !== 'from') return null;
  if (slice[4] !== 'target') return null;

  let idx = 5;
  const targetType = targetTypeFromSimplePermanentWord(slice[idx]);
  if (!targetType) return null;
  idx++;

  const constraints: TargetSpec['constraints'] = {};
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') { constraints.controllerControls = true; idx += 2; }
  if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') { constraints.opponentControls = true; idx += 3; }

  if (tokens[startIndex + idx] === '.') idx++;

  const spec = makeTargetSpec(targetType, Object.keys(constraints).length > 0 ? constraints : undefined);
  const effect: Effect = {
    kind: 'RemoveCounters',
    target: makeChosenRef(spec),
    counterType: '*',
    count: 0,
    allCounters: true,
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "put N <type> counter(s) on enchanted/equipped creature."
 *
 * Aura/Equipment counter placement on the attached permanent (e.g. Forced
 * Adaptation, Ring of Valkas, Hydra's Growth). Emits a SourceAttachedTo target,
 * which the executor's AddCounters case resolves via getSourceAttachedTo.
 */
function matchAddCountersAttached(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'put') return null;

  const cnt = readCounterCount(slice[1]);
  if (!cnt) return null;
  let idx = 1 + cnt.consumed;

  const label = readCounterTypeLabel(slice, idx);
  if (!label) return null;
  idx += label.consumed;

  if (slice[idx] !== 'counter' && slice[idx] !== 'counters') return null;
  idx++;

  if (slice[idx] !== 'on') return null;
  idx++;

  if (slice[idx] !== 'enchanted' && slice[idx] !== 'equipped') return null;
  idx++;
  if (slice[idx] !== 'creature') return null;
  idx++;

  // Conservative: only the bare "enchanted/equipped creature." form. Trailing
  // conditionals ("if it's red", "if it attacked...") would change semantics,
  // so bail unless the clause ends here.
  if (tokens[startIndex + idx] === '.') idx++;
  else if (slice[idx] !== undefined) return null;

  const effect: Effect = {
    kind: 'AddCounters',
    target: { kind: 'SourceAttachedTo' },
    counterType: label.type,
    count: cnt.count,
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "you get N poison counter(s)." / "you get a poison counter."
 *
 * Self counters on the controller (poison/experience/energy, etc.). Emits a
 * Controller-targeted AddCounters; the executor resolves Controller to the
 * caster and applies the player counter. Mirrors matchGainEnergy.
 */
function matchYouGetCounters(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'you' || slice[1] !== 'get') return null;

  const cnt = readCounterCount(slice[2]);
  if (!cnt) return null;
  let idx = 2 + cnt.consumed;

  const counterType = slice[idx];
  if (!counterType || !/^[a-z]+$/.test(counterType)) return null;
  idx++;

  if (slice[idx] !== 'counter' && slice[idx] !== 'counters') return null;
  idx++;

  if (tokens[startIndex + idx] === '.') idx++;

  const effect: Effect = {
    kind: 'AddCounters',
    target: { kind: 'Controller' },
    counterType,
    count: cnt.count,
  };
  return { effects: [effect], targets: [], consumed: idx };
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

/**
 * Match ETB clauses that enter with X counters where X is an evaluable amount.
 *
 * Patterns (slice-6 extended + slice-11 dynamic where-X ETB family):
 *   "This creature enters with X +1/+1 counters on it, where X is the number of creatures you control."
 *   "~ enters with X +1/+1 counters on it, where X is the number of creature cards in all graveyards."
 *   "It enters with X +1/+1 counters on it, where X is the number of creature cards in exile."
 *   "~ enters with X charge counters on it, where X is your life total."
 *   "~ enters with X +1/+1 counters on it, where X is the greatest mana value among cards in exile."
 *
 * Emits AddCounters(Source, counterType, AmountRef). Declined for:
 *   - life-gained-this-turn (no tracker exists in the evaluator)
 *   - "your choice of counter" forms (indeterminate counter type)
 *   - any "where X" tail that parseWhereXIsAnyAmount cannot resolve
 *
 * The executor's AddCounters(Source) path is already honest; the AmountRef is
 * evaluated at resolution time by resolveAmount.
 */
function matchEntersWithCountersWhereX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Accept optional leading subject words: "this creature", "it", "~"
  // then the core "enters [the battlefield] with x <type> counter[s] on it"
  // followed by the mandatory "where x is <amount>" tail.
  //
  // We scan the slice for the "enters" keyword, skip a short subject prefix,
  // then look for "with x <type> counter[s] on it" and a where-clause.

  let i = 0;

  // Optional short subject prefix (up to 3 tokens: "this creature", "it", "~",
  // "that creature", etc.). We stop at "enters" or give up after 3 tokens.
  const MAX_SUBJECT_PREFIX = 3;
  while (i < MAX_SUBJECT_PREFIX && slice[i] && slice[i] !== 'enters') {
    i++;
  }

  if (slice[i] !== 'enters') return null;
  i++; // skip "enters"

  // Optional "the battlefield"
  if (slice[i] === 'the' && slice[i + 1] === 'battlefield') i += 2;

  if (slice[i] !== 'with') return null;
  i++; // skip "with"

  // Optional "an additional" — accept but skip (we parse the X part separately)
  if (slice[i] === 'an' && slice[i + 1] === 'additional') i += 2;

  // Must be "x" for the dynamic form
  if (slice[i] !== 'x') return null;
  i++; // skip "x"

  // Read counter type label ("+1/+1", "loyalty", etc.)
  const label = readCounterTypeLabel(slice, i);
  if (!label) return null;
  i += label.consumed;

  // "counter" or "counters"
  if (slice[i] !== 'counter' && slice[i] !== 'counters') return null;
  i++; // skip "counter[s]"

  // Optional "on it" / "on ~ " / "on this creature" — consume but don't require
  if (slice[i] === 'on') {
    i++; // skip "on"
    if (slice[i] === 'it' || slice[i] === '~') {
      i++;
    } else if (slice[i] === 'this') {
      i++; // skip "this"
      if (slice[i]) i++; // skip creature/permanent word
    }
  }

  // Now expect the where-clause: "[,] where x is <amount>"
  // parseWhereXIsAnyAmount handles ForEach (number of ...), LifeTotal, and GreatestManaValue(exile).
  const whereResult = parseWhereXIsAnyAmount(slice, i);
  if (!whereResult) return null;

  let consumed = whereResult.nextIndex;
  if (slice[consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'AddCounters',
    target: { kind: 'Source' },
    counterType: label.type,
    count: whereResult.amount,
  };
  return { effects: [effect], targets: [], consumed };
}

/**
 * Slice 2 — Saboteur "that many" counter tail.
 *
 * Matches: "put that many <type> counters on it/~/this creature"
 *
 * Used in CombatDamageToPlayer trigger bodies where the count is the
 * combat damage dealt (EventDamageAmount).
 *
 * Examples:
 *   "Whenever ~ deals combat damage to a player, put that many +1/+1 counters on ~."
 *   (Westgate Regent, Scavenging Ooze variants, etc.)
 */
export function matchAddCountersThatMany(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "put that many <type> counter[s] on it/~/this creature"
  if (slice[0] !== 'put') return null;
  if (slice[1] !== 'that' || slice[2] !== 'many') return null;

  // Read counter type (may be multi-token like "+1/+1")
  let idx = 3;
  const label = readCounterTypeLabel(slice, idx);
  if (!label) return null;
  idx += label.consumed;

  if (slice[idx] !== 'counter' && slice[idx] !== 'counters') return null;
  idx++;

  if (slice[idx] !== 'on') return null;
  idx++;

  // Target: "it", "~", or "this creature/permanent/artifact"
  if (slice[idx] === 'it' || slice[idx] === '~') {
    idx++;
  } else if (slice[idx] === 'this' && targetTypeFromSimplePermanentWord(slice[idx + 1])) {
    idx += 2;
  } else {
    return null;
  }

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'AddCounters',
    target: { kind: 'Source' },
    counterType: label.type,
    count: { kind: 'EventDamageAmount' },
  };
  return { effects: [effect], targets: [], consumed };
}

/**
 * Slice 11: Match ETB clauses of the form:
 *   "[subject] enters [the battlefield] with a/N <type> counter[s] on it for each <filter> <zone>"
 *
 * Unlike matchEntersWithCountersWhereX (which handles "with X ... where X is the number of ..."),
 * this matcher handles the for-each form where the counter count per iteration is a fixed small
 * number (usually 1, written as "a"/"an") and the total count is the number of entities matching
 * a ForEach filter/zone. The "for each <filter> <zone>" tail is normalized to the where-X token
 * stream by calling parseNumberOfFilterAmount directly.
 *
 * Examples:
 *   "This creature enters with a +1/+1 counter on it for each creature you control."
 *   "~ enters with a +1/+1 counter on it for each creature in all graveyards."
 *   "It enters with two +1/+1 counters on it for each land you control."
 *
 * Declined for:
 *   - "for each opponent you have" (no zone phrase — player count, not permanent count)
 *   - "for each creature that died under your control this turn" (turn-scoped died tracker
 *     is not per-controller in the engine)
 *   - any "for each" tail that parseNumberOfFilterAmount cannot resolve
 *
 * The executor's AddCounters(Source) path is already honest; the count is multiplied at
 * resolution time: countPerIteration × resolveForEachCount(amount, state, controller).
 */
function matchEntersWithCountersForEach(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  let i = 0;

  // Optional short subject prefix (up to 3 tokens before "enters")
  const MAX_SUBJECT_PREFIX = 3;
  while (i < MAX_SUBJECT_PREFIX && slice[i] && slice[i] !== 'enters') {
    i++;
  }

  if (slice[i] !== 'enters') return null;
  i++; // skip "enters"

  // Optional "the battlefield"
  if (slice[i] === 'the' && slice[i + 1] === 'battlefield') i += 2;

  if (slice[i] !== 'with') return null;
  i++; // skip "with"

  // Optional "an additional" — accept but skip
  if (slice[i] === 'an' && slice[i + 1] === 'additional') i += 2;

  // Must be a fixed count (a/an/N) — NOT "x" (that's the where-X form)
  const cnt = readCounterCount(slice[i]);
  if (!cnt) return null;
  i += cnt.consumed;

  // Read counter type label ("+1/+1", "loyalty", etc.)
  const label = readCounterTypeLabel(slice, i);
  if (!label) return null;
  i += label.consumed;

  // "counter" or "counters"
  if (slice[i] !== 'counter' && slice[i] !== 'counters') return null;
  i++; // skip "counter[s]"

  // Optional "on it" / "on ~" / "on this <permanent>"
  if (slice[i] === 'on') {
    i++;
    if (slice[i] === 'it' || slice[i] === '~') {
      i++;
    } else if (slice[i] === 'this' && slice[i + 1]) {
      i += 2;
    }
  }

  // Optional leading comma before "for each"
  if (slice[i] === ',') i++;

  // Must be "for each"
  if (slice[i] !== 'for' || slice[i + 1] !== 'each') return null;
  i += 2; // skip "for each"

  // ── Slice 4 extension: "for each [other] spell cast this turn" ──────────────
  // Storm Entity and similar. "other" means exclude the spell that brought this
  // creature onto the battlefield (excludeSelf=true). "cast this turn" is the
  // turn-scoped spellsCastThisTurn state counter, which is already tracked.
  // Declined for "spell cast last turn" and any other temporal qualifier.
  {
    let si = i;
    const excludeSelf = slice[si] === 'other';
    if (excludeSelf) si++;
    // Accept "spell cast this turn" or "spells cast this turn"
    if (
      (slice[si] === 'spell' || slice[si] === 'spells') &&
      slice[si + 1] === 'cast' &&
      slice[si + 2] === 'this' &&
      slice[si + 3] === 'turn'
    ) {
      si += 4;
      if (slice[si] === '.') si++;
      // Only "a"/"an" (count=1) per iteration is accepted for this form.
      if (cnt.count !== 1) return null;
      const countAmount: import('../ast').AmountRef = { kind: 'SpellsCastThisTurn', excludeSelf };
      const effect: Effect = {
        kind: 'AddCounters',
        target: { kind: 'Source' },
        counterType: label.type,
        count: countAmount,
      };
      return { effects: [effect], targets: [], consumed: si };
    }
  }

  // ── Default: normalize "for each <filter> <zone>" via parseNumberOfFilterAmount ─
  const syntheticTokens = ['the', 'number', 'of', ...slice.slice(i)];
  const forEachResult = parseNumberOfFilterAmount(syntheticTokens, 0);
  if (!forEachResult) return null;

  // Advance i by how many tokens parseNumberOfFilterAmount consumed minus the 3-token header
  const tokensConsumed = forEachResult.nextIndex - 3;
  if (tokensConsumed < 0) return null;
  i += tokensConsumed;

  // Optional trailing period
  if (slice[i] === '.') i++;

  // The total count = countPerIteration * forEachAmount; since the executor resolves
  // ForEachAmount at runtime, we emit count = forEachAmount when countPerIteration = 1
  // (the overwhelmingly common case) or wrap in a multiplied amount for N > 1.
  let countAmount: import('../ast').AmountRef;
  if (cnt.count === 1) {
    countAmount = forEachResult.amount;
  } else {
    // For N > 1 per iteration, we need a multiplied ForEach. The engine currently
    // has no ForEachMultiplied AmountRef; fall back to ForEach with a scaled count.
    // Since resolveAmount only calls resolveForEachCount for ForEach amounts and the
    // executor multiplies ForEach count by the static multiplier, we store the amount
    // as-is (count=1 mode) and note the per-iteration count in count for callers.
    // For simplicity: only accept count=1 (the "a/an" form) — N>1 per iteration is
    // rare and would need a ForEachMultiplied kind we don't have.
    return null;
  }

  const effect: Effect = {
    kind: 'AddCounters',
    target: { kind: 'Source' },
    counterType: label.type,
    count: countAmount,
  };
  return { effects: [effect], targets: [], consumed: i };
}

/**
 * Slice 4 — Match the "Support N" keyword action:
 *   "Support 2" = put a +1/+1 counter on each of up to N other target creatures.
 *
 * Support is a keyword shorthand for a multi-target counter placement. The oracle
 * text for a card with Support N reads "Support N" (capitalized, keyword) or
 * expands to "put a +1/+1 counter on each of up to N other target creatures."
 * The latter is already handled by matchAddCounters (sub-case A3b); this matcher
 * handles the compact keyword form ("support 2", "support 3").
 *
 * Produces a SINGLE TargetSpec with count=N and minCount=0 (0 to N other target
 * creatures — choosing 0 is legal when fewer creatures exist). The executor's
 * AddCounters multi-target branch (resolveChosenTargetIds) applies the +1/+1
 * counter to every chosen id.
 */
function matchSupport(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'support') return null;
  const n = parseSmallNumberToken(slice[1] ?? '');
  if (Number.isNaN(n) || n < 1) return null;

  let consumed = 2;
  if (slice[consumed] === '.') consumed++;

  const spec = makeTargetSpec('Creature', { notSource: true });
  spec.count = n;
  spec.minCount = 0; // "up to N" — choosing zero is legal

  const effect = {
    kind: 'AddCounters' as const,
    target: makeChosenRef(spec),
    counterType: '+1/+1',
    count: 1,
  };
  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Slice 4: Match "Remove X counters from target permanent, where X is the number
 * of <type> counters on it." (Thornmantle Striker family).
 *
 * The where-clause specifies what X means (the counter type on the target), but
 * since the spell has {X} in its mana cost the player declares X at cast time.
 * We therefore emit count: { kind: 'X' } and extract the counter type from the
 * where-clause filter words ("+1/+1" etc.). The executor's RemoveCounters case
 * resolves xValue via resolveAmount — which is honest for X spells.
 *
 * If the where-clause is absent or unparseable we still try a bare
 * "remove x <type> counters from target <perm>" form below, emitting { kind: 'X' }.
 */
function matchRemoveCountersWhereX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'remove') return null;
  if (slice[1] !== 'x') return null;

  // "remove x <type> counters from target <permanent>"
  // where <type> may be absent when the oracle text just says "remove x counters"
  let idx = 2;
  let counterType = '';

  if (slice[idx] !== 'counter' && slice[idx] !== 'counters') {
    // Optional counter-type label (may be multi-token like "+1/+1", "ki", etc.)
    const label = readCounterTypeLabel(slice, idx);
    if (!label) return null;
    counterType = label.type;
    idx += label.consumed;
  }

  if (slice[idx] !== 'counter' && slice[idx] !== 'counters') return null;
  idx++;

  if (slice[idx] !== 'from') return null;
  idx++;
  if (slice[idx] !== 'target') return null;
  idx++;

  const targetType = targetTypeFromSimplePermanentWord(slice[idx]);
  if (!targetType) return null;
  idx++;

  const constraints: TargetSpec['constraints'] = {};
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') { constraints.controllerControls = true; idx += 2; }

  // Consume optional trailing comma before "where"
  if (slice[idx] === ',') idx++;

  // Optional "where X is the number of <type> counters on it" tail
  if (slice[idx] === 'where' && slice[idx + 1] === 'x' && slice[idx + 2] === 'is') {
    const afterIs = idx + 3;
    // "the number of <type> counters on it"
    if (
      slice[afterIs] === 'the' &&
      slice[afterIs + 1] === 'number' &&
      slice[afterIs + 2] === 'of'
    ) {
      let wi = afterIs + 3;
      // Collect counter type words until we hit "counters"/"counter"/"on"
      const ctWords: string[] = [];
      while (wi < slice.length && slice[wi] !== 'counter' && slice[wi] !== 'counters' && slice[wi] !== 'on' && slice[wi] !== '.') {
        ctWords.push(slice[wi]);
        wi++;
      }
      // If we found a counter type from the where-clause and none was given before, use it
      if (ctWords.length > 0 && counterType === '') {
        counterType = ctWords.join(' ');
      }
      // Skip to end of "counters on it"
      if (slice[wi] === 'counter' || slice[wi] === 'counters') wi++;
      if (slice[wi] === 'on' && (slice[wi + 1] === 'it' || slice[wi + 1] === '~')) wi += 2;
      idx = wi;
    } else {
      idx += 3; // skip "where x is" at minimum
    }
  }

  if (tokens[startIndex + idx] === '.') idx++;

  // Must have a counter type to remove
  if (counterType === '') counterType = '+1/+1'; // safe fallback

  const spec = makeTargetSpec(targetType, Object.keys(constraints).length > 0 ? constraints : undefined);
  const effect: Effect = {
    kind: 'RemoveCounters',
    target: makeChosenRef(spec),
    counterType,
    count: { kind: 'X' },
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 10: Match "Distribute N +1/+1 counters among one, two, or three target
 * creatures [you control]." (Armament Dragon ETB, Vastwood Animist pump family,
 * Bloodhall Priest-adjacent ETB distributors.)
 *
 * Wording patterns accepted:
 *   "Distribute three +1/+1 counters among one, two, or three target creatures."
 *   "Distribute three +1/+1 counters among one, two, or three target creatures you control."
 *   "Distribute N +1/+1 counters among any number of target creatures you control."
 *
 * Produces a SINGLE multi-target TargetSpec (count = the enumerated max,
 * minCount = 1 — at least one creature must be chosen) and a DistributeCounters
 * effect carrying the TOTAL counter budget. The executor splits the budget across
 * the chosen ids.
 */
function matchDistributeCounters(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'distribute') return null;

  // Count: small number word ("three", "five") or numeral
  const total = parseSmallNumberToken(slice[1] ?? '');
  if (Number.isNaN(total) || total < 1) return null;
  let idx = 2;

  // Counter type (e.g. "+1/+1", "loyalty", etc.) — may be multi-token
  const label = readCounterTypeLabel(slice, idx);
  if (!label) return null;
  idx += label.consumed;

  // "counter" or "counters"
  if (slice[idx] !== 'counter' && slice[idx] !== 'counters') return null;
  idx++;

  // "among"
  if (slice[idx] !== 'among') return null;
  idx++;

  // Selection cap: "any number of ..." or enumeration "one, two, or three ..."
  let maxTargets: number;
  if (slice[idx] === 'any' && slice[idx + 1] === 'number' && slice[idx + 2] === 'of') {
    idx += 3;
    maxTargets = total; // cap at total since each target must get ≥ 1
  } else {
    const counts: number[] = [];
    const first = parseSmallNumberToken(slice[idx] ?? '');
    if (Number.isNaN(first)) return null;
    counts.push(first);
    idx++;
    for (;;) {
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

  // "target"
  if (slice[idx] !== 'target') return null;
  idx++;

  // Target noun: "creatures" (plural) or "creature" (singular)
  if (slice[idx] !== 'creatures' && slice[idx] !== 'creature') return null;
  idx++;

  // Optional "you control"
  const constraints: TargetSpec['constraints'] = {};
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  }

  if (tokens[startIndex + idx] === '.') idx++;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  spec.count = maxTargets;
  spec.minCount = 1;

  const effect: Effect = {
    kind: 'DistributeCounters',
    target: makeChosenRef(spec),
    counterType: label.type,
    total,
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 12: Quicksilver Fountain family —
 *   "that player puts a <type> counter on target [non-<Subtype>] land they control [of their choice]"
 *
 * "That player" is the EventPlayer (the active player at the start of the upkeep trigger).
 * The target is ANY land (optionally excluding one subtype) controlled by that player.
 * Since the executor's AI selects the best permanent for AllOfType effects, we model
 * this as AllOfType { filter, eventPlayerControls: true } with maxCount: 1.
 *
 * Patterns accepted:
 *   "that player puts a flood counter on target non-Island land they control of their choice"
 *   "that player puts a +1/+1 counter on target land they control"
 *   "that player puts a -1/-1 counter on target non-Forest land they control of their choice"
 */
export function matchThatPlayerPutsCounterOnLandTheyControl(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Minimum: "that player puts a <type> counter on target land they control"
  //           0    1      2    3 4      5       6  7      8    9    10
  if (slice.length < 11) return null;
  if (slice[0] !== 'that' || slice[1] !== 'player' || slice[2] !== 'puts') return null;
  if (slice[3] !== 'a' && slice[3] !== 'an') return null;

  let idx = 4;

  // Read counter type (single token; +1/+1, flood, -1/-1, etc.)
  const label = readCounterTypeLabel(slice, idx);
  if (!label) return null;
  idx += label.consumed;

  // "counter" or "counters"
  if (slice[idx] !== 'counter' && slice[idx] !== 'counters') return null;
  idx++;

  // "on"
  if (slice[idx] !== 'on') return null;
  idx++;

  // "target"
  if (slice[idx] !== 'target') return null;
  idx++;

  // Optional "non-<Subtype>" — tokenizes as ["non", "-", "<subtype>"]
  let excludedSubtype: string | undefined;
  if (slice[idx] === 'non' && slice[idx + 1] === '-' && slice[idx + 2] !== undefined && slice[idx + 2] !== 'land') {
    excludedSubtype = slice[idx + 2].charAt(0).toUpperCase() + slice[idx + 2].slice(1);
    idx += 3;
  }

  // "land" — required
  if (slice[idx] !== 'land') return null;
  idx++;

  // "they control" — required (distinguishes "that player" EventPlayer scoping)
  if (slice[idx] !== 'they' || slice[idx + 1] !== 'control') return null;
  idx += 2;

  // Optional "of their choice" tail
  if (slice[idx] === 'of' && slice[idx + 1] === 'their' && slice[idx + 2] === 'choice') idx += 3;

  if (tokens[startIndex + idx] === '.') idx++;

  const filter: import('../ast').CardFilter = {
    types: ['land'],
    ...(excludedSubtype ? { excludeSubtypes: [excludedSubtype] } : {}),
  };

  const effect: Effect = {
    kind: 'AddCounters',
    target: { kind: 'AllOfType', filter, eventPlayerControls: true },
    counterType: label.type,
    count: 1,
    maxCount: 1,
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 5: Recognition-only StaticAbility marker for unconditional
 * "enters with <N|X> <type> counter(s) on it" sentences.
 *
 * HONEST: stack.ts entersWithCounters already applies fixed and {X}-cost counter
 * counts at entry (reading the oracle text directly), so recognizing the clause
 * here is genuine — the engine really places the counters. We only emit a parsed
 * StaticAbility so the face stops being Unparsed.
 *
 * IMPORTANT honesty gate — we claim ONLY the unconditional sentence. We DECLINE:
 *  - "... if a creature died this turn" (conditional form — Morbid)
 *  - "... for each ..." (for-each form — handled by matchEntersWithCountersForEach)
 *  - "... where X is ..." (where-X form — handled by matchEntersWithCountersWhereX)
 *
 * The regex must match each line individually (oracle text is split by newlines).
 *
 * Forms recognized:
 *   "This creature enters with a shield counter on it."
 *   "This creature enters with X +1/+1 counters on it."
 *   "This artifact enters with two charge counters on it."
 *   "~ enters the battlefield with a +1/+1 counter on it."
 *   "This equipment enters with a +1/+1 counter on it."
 *
 * IMPORTANT — tested forms that MUST be declined:
 *   "This creature enters with four +1/+1 counters on it if a creature died this turn."
 *   "This creature enters with a +1/+1 counter on it for each creature you control."
 *   "This creature enters with X +1/+1 counters on it, where X is the number of ..."
 */

// Regex matching unconditional enters-with-counters sentences only:
// - subject: optional "this <type>", "~", or bare "it"/"that <type>"
// - count: "a"/"an"/"x" or number word or numeral
// - optional "additional"
// - counter type: +/-N/+/-N or one or two lowercase word tokens
// - "counter"/"counters"
// - optional "on it"/"on ~"/"on this <word>"
// - MUST end here — no trailing "if", "for each", "where", etc.
const ENTERS_WITH_COUNTERS_RE =
  /\benters?(?:\s+the\s+battlefield)?\s+with\s+(?:a|an|x|one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s+additional)?\s+(?:[+\-]\d+\/[+\-]\d+|[a-z]+(?:\s+[a-z]+)?)\s+counters?\s*(?:on\s+(?:it|~|this\s+\w+))?\s*\.?\s*$/i;

// Disqualify patterns — reject any trailing condition/modifier
const ENTERS_WITH_COUNTERS_DISQUALIFY_RE =
  /\b(?:if|unless|for\s+each|where\s+x\s+is|as\s+long\s+as)\b/i;

export function matchEntersWithCounters(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  // Test per-line — multi-line faces may have this as one of several lines.
  // The caller (parseOracleText / parseOracleTextPerLine) already manages
  // the absorption of this line alongside other lines.
  const lines = oracleText.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // Must contain the enters-with-counters pattern
    if (!ENTERS_WITH_COUNTERS_RE.test(line)) continue;
    // Must NOT have trailing conditions that change the semantics
    if (ENTERS_WITH_COUNTERS_DISQUALIFY_RE.test(line)) continue;
    // Found an unconditional enters-with-counters sentence
    return {
      kind: 'StaticAbility',
      modifier: { kind: 'GrantKeyword', keyword: 'EntersWithCounters' },
      filter: { permanent: true },
      controller: 'any',
      excludeSelf: false,
      selfOnly: true,
    };
  }
  return null;
}

/**
 * Check whether a single cleaned line (reminder text already stripped)
 * is an unconditional enters-with-counters sentence. Used by
 * parseOracleTextPerLine to absorb this line so other lines of a
 * multi-line face can parse normally.
 */
export function isEntersWithCountersLine(line: string): boolean {
  if (!ENTERS_WITH_COUNTERS_RE.test(line)) return false;
  if (ENTERS_WITH_COUNTERS_DISQUALIFY_RE.test(line)) return false;
  return true;
}

// ============================================================================
// Slice 2: Conditional enters-with-counters (Morbid / Raid ability-word forms)
// ============================================================================
//
// Handles: "[AbilityWord —] <subject> enters with <N> <type> counter[s] [on it]
//            if <this-turn-condition>."
//
// Conditions that the executor can evaluate honestly (tracked in game state):
//   • "a creature died this turn"  →  state.creaturesDiedThisTurn > 0  (Morbid)
//   • "you attacked this turn"     →  state.playersWhoAttackedThisTurn  (Raid)
//
// Declined (no tracker in game state):
//   • "a permanent left the battlefield" (Revolt)
//   • "an opponent lost life this turn"
//   • "you control a modified creature"
//   • "an opponent was dealt damage" (Bloodthirst)
//
// EXECUTION: stack.ts entersWithCountersConditional re-reads the oracle text at
// ETB time, checks the condition, and places the counters when true.  This
// matcher is a recognition-only marker (selfOnly StaticAbility / GrantKeyword
// 'EntersWithCountersConditional') — exactly the same pattern as the
// unconditional matchEntersWithCounters.

// The base pattern — same as ENTERS_WITH_COUNTERS_RE but without the $-anchor,
// because we need room for the trailing "if <cond>" clause.
const COND_ENTERS_BASE_RE =
  /\benters?(?:\s+the\s+battlefield)?\s+with\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s+additional)?\s+(?:[+\-]\d+\/[+\-]\d+|[a-z]+(?:\s+[a-z]+)?)\s+counters?(?:\s+on\s+(?:it|~|this\s+\w+))?\s+if\s+/i;

// Allowed trailing conditions — only those the executor can evaluate.
const COND_ENTERS_CONDITION_RE =
  /if\s+(?:a\s+creature\s+died\s+this\s+turn|you\s+attacked\s+this\s+turn)\s*\.?\s*$/i;

// Optional leading ability-word prefix: "Morbid —", "Raid —", "Bloodthirst N —"
// (We match but do not restrict to specific words; the condition check below
//  is the honesty gate.)
const ABILITY_WORD_PREFIX_RE = /^[A-Za-z][A-Za-z0-9\s]*[—–]\s*/;

/**
 * Slice 2: Match "... enters with N <type> counter[s] [on it] if <tracked-cond>."
 *
 * Emits a recognition-only StaticAbilityEffect (GrantKeyword
 * 'EntersWithCountersConditional') so the face is not Unparsed.
 * Actual counter placement is handled by stack.ts entersWithCountersConditional,
 * which re-reads the oracle text at ETB time and checks the condition.
 *
 * Accepts optional leading ability-word prefix (Morbid —, Raid —, etc.).
 * Only the two conditions that have state trackers are accepted; all others
 * are declined to uphold the honesty bar.
 */
export function matchEntersWithCountersConditional(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  const lines = oracleText.split('\n');
  for (const rawLine of lines) {
    const rawTrimmed = rawLine.trim();
    if (!rawTrimmed) continue;
    // Strip optional ability-word prefix for matching purposes.
    const line = rawTrimmed.replace(ABILITY_WORD_PREFIX_RE, '');
    // Must contain the base ETB-counter pattern with an "if" clause.
    if (!COND_ENTERS_BASE_RE.test(line)) continue;
    // Must end with one of the tracked conditions.
    if (!COND_ENTERS_CONDITION_RE.test(line)) continue;
    // Must NOT also have "for each" or "where X is" (those are different matchers).
    if (/\bfor\s+each\b|\bwhere\s+x\s+is\b/i.test(line)) continue;
    return {
      kind: 'StaticAbility',
      modifier: { kind: 'GrantKeyword', keyword: 'EntersWithCountersConditional' },
      filter: { permanent: true },
      controller: 'any',
      excludeSelf: false,
      selfOnly: true,
    };
  }
  return null;
}

/**
 * Check whether a single cleaned line is a conditional enters-with-counters
 * sentence with a tracked condition. Used by parseOracleTextPerLine to absorb
 * this line so other lines of a multi-line face can parse normally.
 */
export function isEntersWithCountersConditionalLine(line: string): boolean {
  const stripped = line.replace(ABILITY_WORD_PREFIX_RE, '');
  if (!COND_ENTERS_BASE_RE.test(stripped)) return false;
  if (!COND_ENTERS_CONDITION_RE.test(stripped)) return false;
  if (/\bfor\s+each\b|\bwhere\s+x\s+is\b/i.test(stripped)) return false;
  return true;
}

// ============================================================================
// Slice 5/12: Dynamic "equal to" enters-with-counters (Undergrowth Scavenger /
// Rhizome Lurcher family)
// ============================================================================
//
// Handles the wording:
//   "[Subject] enters [the battlefield] with a number of [additional] <type>
//    counter[s] on it equal to the number of <filter> <zone>."
//
// This is semantically identical to the "for each" form (count = number of
// matching permanents/cards in the specified zone) but spelled as "equal to
// the number of" rather than "for each". The executor path is Path C added
// to stack.ts entersWithCountersDynamic, which forwards to parseNumberOfFilterAmount
// exactly as Path B does for the "for each" wording.
//
// HONESTY GATES:
//  - Only "equal to the number of <filter> <zone>" tails accepted; anything
//    that parseNumberOfFilterAmount cannot resolve stays Unparsed.
//  - "equal to this creature's power" (Master Biomancer) is NOT handled —
//    there is no executor path for cross-card power tracking in
//    entersWithCountersDynamic. Decline to keep the honesty bar.
//  - "twice/three times that many" multiplier forms (Devour) are NOT handled
//    for the same reason.

/**
 * Slice 5/12: Match ETB clauses of the form:
 *   "[subject] enters [the battlefield] with a number of [additional] <type>
 *    counter[s] on it equal to the number of <filter> <zone>"
 *
 * Examples (Undergrowth Scavenger, Rhizome Lurcher):
 *   "This creature enters with a number of +1/+1 counters on it equal to the
 *    number of creature cards in all graveyards."
 *   "Undergrowth — This creature enters with a number of +1/+1 counters on it
 *    equal to the number of creature cards in your graveyard."
 *
 * Emits AddCounters(Source, counterType, ForEachAmount). Declined for:
 *   - "equal to this creature's power" (no cross-card executor in dynamic path)
 *   - any "equal to the number of" tail parseNumberOfFilterAmount cannot resolve
 *
 * EXECUTION: stack.ts entersWithCountersDynamic Path C recognizes the "equal to"
 * form and forwards to parseNumberOfFilterAmount exactly as Path B does for "for each".
 */
function matchEntersWithCountersEqualTo(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  let i = 0;

  // Optional short subject prefix (up to 3 tokens before "enters")
  const MAX_SUBJECT_PREFIX = 3;
  while (i < MAX_SUBJECT_PREFIX && slice[i] && slice[i] !== 'enters') {
    i++;
  }

  if (slice[i] !== 'enters') return null;
  i++; // skip "enters"

  // Optional "the battlefield"
  if (slice[i] === 'the' && slice[i + 1] === 'battlefield') i += 2;

  if (slice[i] !== 'with') return null;
  i++; // skip "with"

  // Optional "an additional" — accept but skip
  if (slice[i] === 'an' && slice[i + 1] === 'additional') i += 2;

  // Must be "a number of" — the distinctive head of this form.
  // "a" followed by "number" and "of" means this is NOT the fixed-count form.
  if (slice[i] !== 'a' || slice[i + 1] !== 'number' || slice[i + 2] !== 'of') return null;
  i += 3; // skip "a number of"

  // Optional "additional" after "a number of"
  if (slice[i] === 'additional') i++;

  // Read counter type label ("+1/+1", "loyalty", etc.)
  const label = readCounterTypeLabel(slice, i);
  if (!label) return null;
  i += label.consumed;

  // "counter" or "counters"
  if (slice[i] !== 'counter' && slice[i] !== 'counters') return null;
  i++; // skip "counter[s]"

  // Optional "on it" / "on ~" / "on this <permanent>"
  if (slice[i] === 'on') {
    i++;
    if (slice[i] === 'it' || slice[i] === '~') {
      i++;
    } else if (slice[i] === 'this') {
      i++;
      if (slice[i]) i++;
    }
  }

  // Now must be "equal to the number of <filter> <zone>"
  if (slice[i] !== 'equal' || slice[i + 1] !== 'to') return null;
  i += 2; // skip "equal to"

  // Parse "the number of <filter> <zone>" via parseNumberOfFilterAmount
  const filterResult = parseNumberOfFilterAmount(slice, i);
  if (!filterResult) return null;

  let consumed = filterResult.nextIndex;
  if (slice[consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'AddCounters',
    target: { kind: 'Source' },
    counterType: label.type,
    count: filterResult.amount,
  };
  return { effects: [effect], targets: [], consumed };
}

/**
 * Regex matching the "a number of <type> counters on it equal to the number of"
 * pattern (Undergrowth Scavenger / Rhizome Lurcher family). Used for:
 *  1. The per-line absorber in parseOracleTextPerLine (so the line does not block
 *     other lines of a multi-line face from parsing).
 *  2. Path C detection in stack.ts entersWithCountersDynamic.
 */
const ENTERS_WITH_COUNTERS_EQUAL_TO_RE =
  /\benters?(?:\s+the\s+battlefield)?\s+with\s+a\s+number\s+of(?:\s+additional)?\s+(?:[+\-]\d+\/[+\-]\d+|[a-z]+(?:\s+[a-z]+)?)\s+counters?\s*(?:on\s+(?:it|~|this\s+\w+))?\s+equal\s+to\s+the\s+number\s+of\b/i;

/**
 * Check whether a single cleaned line is a dynamic "equal to the number of"
 * enters-with-counters sentence. Used by parseOracleTextPerLine to absorb
 * this line so other lines of a multi-line face can parse normally, and by
 * stack.ts entersWithCountersDynamic (Path C) for runtime detection.
 *
 * Strips optional ability-word prefixes (e.g. "Undergrowth — ") before
 * matching, consistent with isEntersWithCountersConditionalLine.
 */
export function isEntersWithCountersDynamicLine(line: string): boolean {
  // Strip optional ability-word prefix ("Undergrowth — ", etc.)
  const stripped = line.replace(ABILITY_WORD_PREFIX_RE, '');
  return ENTERS_WITH_COUNTERS_EQUAL_TO_RE.test(stripped);
}

/**
 * Slice 9: Counter-migration matchers.
 *
 * Two wording families:
 *
 * A) "put its counters on [up to one] target creature you control"
 *    Star Pupil / Host of the Hereafter dies-trigger form.
 *    Moves ALL counters of every type from the source permanent onto the target.
 *    "up to one" makes the target optional (minCount=0).
 *
 * B) "move a +1/+1 counter from this artifact onto target creature"
 *    Weapon Rack activated form.
 *    Moves exactly one counter of the specified type.
 *
 * Both emit a MoveCounters effect.
 */
function matchMoveCounters(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // ── Pattern A: "put its counters on [up to one] target creature [you control]" ──
  // Tokens: put its counters on [up to one] target creature [you control] [.]
  if (
    slice[0] === 'put' &&
    slice[1] === 'its' &&
    slice[2] === 'counters' &&
    slice[3] === 'on'
  ) {
    let idx = 4;
    let optional = false;

    // Optional "up to one" — makes target optional (minCount=0)
    if (slice[idx] === 'up' && slice[idx + 1] === 'to' && slice[idx + 2] === 'one') {
      optional = true;
      idx += 3;
    }

    // Required "target"
    if (slice[idx] !== 'target') return null;
    idx++;

    // Target noun — only "creature" is accepted for this family
    if (slice[idx] !== 'creature') return null;
    idx++;

    const constraints: import('../targets').TargetSpec['constraints'] = {};

    // Optional "you control"
    if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
      constraints.controllerControls = true;
      idx += 2;
    }

    if (tokens[startIndex + idx] === '.') idx++;

    const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
    if (optional) {
      spec.minCount = 0; // "up to one" — choosing zero is legal
    }

    const effect: import('../ast').Effect = {
      kind: 'MoveCounters',
      source: { kind: 'Source' },
      target: makeChosenRef(spec),
      allCounters: true,
    };
    return { effects: [effect], targets: [spec], consumed: idx };
  }

  // ── Pattern B: "move a <type> counter from this artifact onto target creature" ──
  // Tokens: move a <type> counter[s] from this <permanent-word> onto target creature [.]
  if (slice[0] === 'move' && (slice[1] === 'a' || slice[1] === 'an')) {
    let idx = 2;

    const label = readCounterTypeLabel(slice, idx);
    if (!label) return null;
    idx += label.consumed;

    if (slice[idx] !== 'counter' && slice[idx] !== 'counters') return null;
    idx++;

    if (slice[idx] !== 'from') return null;
    idx++;

    // "this <permanent-word>" — self reference
    if (slice[idx] !== 'this') return null;
    idx++;
    if (!targetTypeFromSimplePermanentWord(slice[idx])) return null;
    idx++;

    if (slice[idx] !== 'onto') return null;
    idx++;

    if (slice[idx] !== 'target') return null;
    idx++;

    // Target noun — "creature", "permanent", "artifact"
    const targetType = targetTypeFromSimplePermanentWord(slice[idx]);
    if (!targetType) return null;
    idx++;

    const constraints: import('../targets').TargetSpec['constraints'] = {};
    if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
      constraints.controllerControls = true;
      idx += 2;
    }

    if (tokens[startIndex + idx] === '.') idx++;

    const spec = makeTargetSpec(targetType, Object.keys(constraints).length > 0 ? constraints : undefined);

    const effect: import('../ast').Effect = {
      kind: 'MoveCounters',
      source: { kind: 'Source' },
      target: makeChosenRef(spec),
      allCounters: false,
      counterType: label.type,
      count: 1,
    };
    return { effects: [effect], targets: [spec], consumed: idx };
  }

  return null;
}

/**
 * Match: "that player gets N <type> counters." (Fynn, the Fangbearer body)
 *
 * "That player" is the event player (e.g. the player who took combat damage).
 * Emits AddCounters with EventPlayer target. Used in CombatDamageToPlayer
 * trigger bodies.
 */
export function matchThatPlayerGetsCounters(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'that' || slice[1] !== 'player' || slice[2] !== 'gets') return null;

  const cnt = readCounterCount(slice[3]);
  if (!cnt) return null;
  let idx = 3 + cnt.consumed;

  const counterType = slice[idx];
  if (!counterType || !/^[a-z]+$/.test(counterType)) return null;
  idx++;

  if (slice[idx] !== 'counter' && slice[idx] !== 'counters') return null;
  idx++;

  if (tokens[startIndex + idx] === '.') idx++;

  const effect: Effect = {
    kind: 'AddCounters',
    target: { kind: 'EventPlayer' },
    counterType,
    count: cnt.count,
  };
  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 2: "they get that many <type> counters."
 *
 * Combat-damage-to-player trigger tail where "they" is the EventPlayer who
 * was dealt combat damage and "that many" is EventDamageAmount (the number of
 * damage dealt). Used by Infesting Radroach ("they get that many rad counters"),
 * Hazmat Suit and similar Fallout-set cards.
 *
 * Emits AddCounters with target=EventPlayer and count=EventDamageAmount.
 */
export function matchTheyGetThatManyCounters(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // "they get that many <type> counter[s]"
  if (slice[0] !== 'they') return null;
  if (slice[1] !== 'get') return null;
  if (slice[2] !== 'that' || slice[3] !== 'many') return null;

  let idx = 4;
  const label = readCounterTypeLabel(slice, idx);
  if (!label) return null;
  idx += label.consumed;

  if (slice[idx] !== 'counter' && slice[idx] !== 'counters') return null;
  idx++;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'AddCounters',
    target: { kind: 'EventPlayer' },
    counterType: label.type,
    count: { kind: 'EventDamageAmount' },
  };
  return { effects: [effect], targets: [], consumed };
}

/**
 * Slice 4 (devotion): "put a number of <type> counters on <target> equal to
 * your devotion to <color(s)>."
 * Examples:
 *   "put a number of +1/+1 counters on it equal to your devotion to green."
 *   "put a number of loyalty counters on ~ equal to your devotion to white."
 * Pattern: put a number of <counterType> counter(s) on <target> equal to your devotion to <color>.
 */
export function matchAddCountersEqualToDevotion(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // "put a number of <type> counter(s) on <target> equal to your devotion to <color>"
  if (slice[0] !== 'put') return null;
  if (slice[1] !== 'a' || slice[2] !== 'number' || slice[3] !== 'of') return null;

  // Find "equal to your devotion to" after "put a number of"
  let eqIdx = -1;
  for (let i = 4; i < slice.length - 4; i++) {
    if (slice[i] === 'equal' && slice[i + 1] === 'to' && slice[i + 2] === 'your' && slice[i + 3] === 'devotion' && slice[i + 4] === 'to') {
      eqIdx = i;
      break;
    }
  }
  if (eqIdx === -1) return null;

  // Parse the devotion amount
  const dev = parseDevotionAmount(slice, eqIdx + 2);
  if (!dev) return null;

  // Tokens between "put a number of" (idx 4) and "equal to" (eqIdx):
  // e.g. "+1/+1 counter(s) on it" or "+1/+1 counters on ~"
  const bodySlice = slice.slice(4, eqIdx);
  // bodySlice[0] = counterType, bodySlice[1] = "counter"/"counters", bodySlice[2] = "on", bodySlice[3] = target
  if (bodySlice.length < 4) return null;
  if (bodySlice[1] !== 'counter' && bodySlice[1] !== 'counters') return null;
  if (bodySlice[2] !== 'on') return null;

  const counterType = bodySlice[0];
  const targetWord = bodySlice[3];
  const count: AmountRef = dev.amount;
  let consumed = dev.nextIndex;
  if (slice[consumed] === '.') consumed++;

  if (targetWord === 'it' || targetWord === '~') {
    const target: TargetRef = { kind: 'Source' };
    const effect: Effect = { kind: 'AddCounters', target, counterType, count };
    return { effects: [effect], targets: [], consumed };
  }

  if (targetWord === 'target') {
    // "put a number of ... on target creature equal to your devotion to X"
    const spec = makeTargetSpec('Creature');
    const effect: Effect = { kind: 'AddCounters', target: makeChosenRef(spec), counterType, count };
    return { effects: [effect], targets: [spec], consumed };
  }

  return null;
}

/**
 * Slice 1: Match "put a/N <type> counter(s) on target <Subtype|type> for each
 * <Subtype|type> [you control | an opponent controls | on the battlefield]."
 *
 * Examples:
 *   "put a +1/+1 counter on target Shrine for each Shrine you control"
 *   "put a +1/+1 counter on target creature for each creature you control"
 *
 * The for-each amount is a ForEachAmount so the executor resolves it at runtime
 * by counting matching permanents. The executor's AddCounters Chosen branch
 * calls resolveAmount which handles ForEachAmount correctly.
 *
 * Honesty: only handles controller='you' and controller='opponent'; omits
 * "on the battlefield" (any-player) until an executor ForEach branch exists.
 */
export function matchAddCountersForEach(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Must start with "put"
  if (slice[0] !== 'put') return null;

  // Count: "a" => 1 or a numeric token
  let count = 1;
  let idx = 1;
  if (slice[idx] === 'a' || slice[idx] === 'an') {
    count = 1;
    idx++;
  } else {
    const n = parseInt(slice[idx], 10);
    if (!isNaN(n) && n > 0) { count = n; idx++; }
    else return null;
  }

  // Counter type token
  const counterType = slice[idx];
  if (!counterType || counterType === 'counter' || counterType === 'counters') return null;
  idx++;

  // "counter" or "counters"
  if (slice[idx] !== 'counter' && slice[idx] !== 'counters') return null;
  idx++;

  // "on"
  if (slice[idx] !== 'on') return null;
  idx++;

  // Target: "target <subtype|type>"
  if (slice[idx] !== 'target') return null;
  idx++;

  // Parse the target type/subtype word
  const targetWord = slice[idx];
  if (!targetWord) return null;

  // Determine TargetSpec type and ForEach filter from the target word.
  // Supported: creature subtypes (Shrine is enchantment type), card types.
  let specType: TargetType;
  let forEachFilter: CardFilter;

  // Special handling for "shrine" — enchantment subtype
  if (targetWord === 'shrine' || targetWord === 'shrines') {
    specType = 'Enchantment';
    forEachFilter = { types: ['enchantment'], subtypes: ['shrine'] };
  } else {
    // Try to resolve via parseStaticFilterType for type words (creature, enchantment, etc.)
    const parsed = parseStaticFilterType(targetWord);
    if (!parsed) return null;
    if (parsed.types?.includes('creature')) { specType = 'Creature'; forEachFilter = parsed; }
    else if (parsed.types?.includes('enchantment')) { specType = 'Enchantment'; forEachFilter = parsed; }
    else if (parsed.types?.includes('artifact')) { specType = 'Artifact'; forEachFilter = parsed; }
    else if (parsed.types?.includes('land')) { specType = 'Land'; forEachFilter = parsed; }
    else if (parsed.subtypes?.length) {
      // Creature subtype word
      specType = 'Creature';
      forEachFilter = { types: ['creature'], ...parsed };
    }
    else return null;
  }
  idx++;

  // "for each"
  if (slice[idx] !== 'for' || slice[idx + 1] !== 'each') return null;
  idx += 2;

  // ForEach subject: the same type/subtype as the target (or a different word)
  // Accept matching or any recognized static filter type for "each X"
  const eachWord = slice[idx];
  if (!eachWord) return null;

  let forEachFilterEach: CardFilter;
  if (eachWord === 'shrine' || eachWord === 'shrines') {
    forEachFilterEach = { types: ['enchantment'], subtypes: ['shrine'] };
  } else {
    const parsedEach = parseStaticFilterType(eachWord);
    if (!parsedEach) return null;
    forEachFilterEach = parsedEach;
  }
  idx++;

  // Controller phrase: "you control" / "an opponent controls" / "on the battlefield"
  let controller: ForEachAmount['controller'] = 'you';
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    controller = 'you'; idx += 2;
  } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    controller = 'opponent'; idx += 3;
  } else if (slice[idx] === 'on' && slice[idx + 1] === 'the' && slice[idx + 2] === 'battlefield') {
    controller = 'each'; idx += 3;
  } else {
    return null;
  }

  if (tokens[startIndex + idx] === '.') idx++;

  const forEachAmount: ForEachAmount = {
    kind: 'ForEach',
    zone: 'battlefield',
    filter: forEachFilterEach,
    controller,
  };

  const spec = makeTargetSpec(specType);
  const effect: Effect = {
    kind: 'AddCounters',
    target: makeChosenRef(spec),
    counterType,
    count: forEachAmount,
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

export {
  matchAddCounters,
  matchAddCountersWhereX,
  matchEntersWithCountersWhereX,
  matchEntersWithCountersForEach,
  matchEntersWithCountersEqualTo,
  matchRemoveCounters,
  matchRemoveCountersTarget,
  matchRemoveCountersWhereX,
  matchAddCountersAttached,
  matchYouGetCounters,
  matchGainEnergy,
  matchSupport,
  matchDistributeCounters,
  matchMoveCounters,
};
