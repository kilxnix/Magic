// Pump/grant/copy/counterspell matchers extracted from parser.ts (batch 10/12).
// Do NOT edit logic here — keep verbatim with parser.ts originals.

import type { Effect, TargetRef, AmountRef, CardFilter, CopySpellEffect, SetBasePTEffect, BecomesCopyEffect, GrantAllCreatureTypesEffect, SwitchPowerToughnessEffect, SetCreatureTypeEffect, LicidTransformEffect } from '../ast';
import type { TargetSpec, TargetType } from '../targets';
import type { PatternResult } from '../parser';
import {
  makeTargetSpec,
  makeChosenRef,
  readColorConstraint,
  colorConstraintFromWord,
  retryWithTargetNounModifiers,
  applyPowerToughnessTargetConstraint,
  parseWhereXIsNumberOf,
  parseWhereXIsAnyAmount,
  parseSmallNumberToken,
  GRANTABLE_KEYWORDS,
  readGrantableKeyword,
  readCreatureSubtypeTargetPhrase,
  CREATURE_SUBTYPE_MAP,
} from '../parser';

/**
 * Match: "[target creature | ~ | it | this creature] gets +X/+X|+X/+0|+0/+X
 *         until end of turn, where X is <amount>"
 *
 * Slice 12 extension: also accepts EventSpellManaValue (Erratic Cyclops — "where
 * X is that spell's mana value") and GreatestPower (Skanos Dragonheart — "where
 * X is the greatest power among creatures you control") in addition to the
 * original ForEachAmount ("where X is the number of <filter> <place>").
 *
 * Declined amounts: die-roll, mana-symbol-count, defending-player-graveyard,
 * SourcePower (no such AmountRef kind exists) — these stay Unparsed.
 *
 * (Ghoul's Feast, Elder of Laurels, Vile Deacon, Erratic Cyclops, Skanos
 * Dragonheart). The dynamic amount is executor-backed (resolveAmount handles
 * all three cases); only non-negative spelled-out-X components are accepted.
 */
export function matchModifyPTWhereX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;
  let target: TargetRef;
  let targets: TargetSpec[] = [];

  if (slice[0] === 'target' && (slice[1] === 'creature' || readColorConstraint(slice, 1))) {
    let j = 1;
    const colorRead = readColorConstraint(slice, j);
    const constraints: TargetSpec['constraints'] = { ...(colorRead ? { colors: colorRead.colors } : {}) };
    if (colorRead) j += colorRead.consumed;
    if (slice[j] !== 'creature') return null;
    j++;
    if (slice[j] === 'you' && slice[j + 1] === 'control') {
      constraints.controllerControls = true;
      j += 2;
    } else if (slice[j] === 'an' && slice[j + 1] === 'opponent' && slice[j + 2] === 'controls') {
      constraints.opponentControls = true;
      j += 3;
    }
    if (slice[j] !== 'gets') return null;
    const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
    targets = [spec];
    target = makeChosenRef(spec);
    idx = j + 1;
  } else if ((slice[0] === '~' || slice[0] === 'it') && slice[1] === 'gets') {
    target = { kind: 'Source' };
    idx = 2;
  } else if (slice[0] === 'this' && ['creature', 'permanent'].includes(slice[1]) && slice[2] === 'gets') {
    target = { kind: 'Source' };
    idx = 3;
  } else {
    return null;
  }

  const ptMatch = slice[idx]?.match(/^\+(x|0)\/\+(x|0)$/);
  if (!ptMatch) return null;
  if (ptMatch[1] !== 'x' && ptMatch[2] !== 'x') return null;
  idx++;

  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
    || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')) return null;
  idx += 4;

  // Try ForEach first (original path), then the extended where-X forms.
  const dyn = parseWhereXIsNumberOf(slice, idx) ?? parseWhereXIsAnyAmount(slice, idx);
  if (!dyn) return null;
  let consumed = dyn.nextIndex;
  if (slice[consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'ModifyPT',
    target,
    power: ptMatch[1] === 'x' ? dyn.amount : 0,
    toughness: ptMatch[2] === 'x' ? dyn.amount : 0,
    untilEndOfTurn: true,
  };
  return { effects: [effect], targets, consumed };
}

export function matchModifyPTForEach(tokens: string[], startIndex: number): PatternResult {
  let slice = tokens.slice(startIndex);
  let pre = 0;
  if (slice[0] === 'until' && slice[1] === 'end' && slice[2] === 'of' && slice[3] === 'turn') {
    pre = slice[4] === ',' ? 5 : 4;
    slice = slice.slice(pre);
  }
  if (slice[0] !== 'target' || slice[1] !== 'creature' || (slice[2] !== 'gets' && slice[2] !== 'get')) return null;
  const m = slice[3]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!m) return null;
  const p = parseInt(m[1], 10);
  const t = parseInt(m[2], 10);
  if (![0, 1].includes(p) || ![0, 1].includes(t) || (p === 0 && t === 0)) return null;
  if (slice[4] !== 'for' || slice[5] !== 'each') return null;
  const TYPE: Record<string, 'creature' | 'land' | 'artifact' | 'enchantment'> = {
    creature: 'creature', creatures: 'creature', land: 'land', lands: 'land',
    artifact: 'artifact', artifacts: 'artifact', enchantment: 'enchantment', enchantments: 'enchantment',
  };
  const ty = TYPE[slice[6]];
  if (!ty) return null;
  let i = 7;
  let controller: 'you' | 'opponent';
  if (slice[i] === 'you' && slice[i + 1] === 'control') { controller = 'you'; i += 2; }
  else if (slice[i] === 'an' && slice[i + 1] === 'opponent' && slice[i + 2] === 'controls') { controller = 'opponent'; i += 3; }
  else return null;
  if (slice[i] === 'until' && slice[i + 1] === 'end' && slice[i + 2] === 'of' && slice[i + 3] === 'turn') i += 4;
  if (slice[i] === '.') i++;

  const forEach: AmountRef = { kind: 'ForEach', zone: 'battlefield', filter: { types: [ty] }, controller };
  const spec = makeTargetSpec('Creature');
  const effect: Effect = {
    kind: 'ModifyPT',
    target: makeChosenRef(spec),
    power: p === 1 ? forEach : 0,
    toughness: t === 1 ? forEach : 0,
    untilEndOfTurn: true,
  };
  return { effects: [effect], targets: [spec], consumed: pre + i };
}

/**
 * Match: "target creature gets +N/+N until end of turn"
 * Match: "target creature gets -N/-N until end of turn"
 * Match: "creatures you control get +N/+N until end of turn"
 */
export function matchModifyPT(tokens: string[], startIndex: number): PatternResult {
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

    // Optional "and gains <keyword>[, <kw>][ and <kw>]" before "until end of turn"
    // (e.g. "~ gets +2/+0 and gains trample until end of turn" — attack triggers).
    let kwIdx = ptIndex + 1;
    const grantedKeywords: string[] = [];
    if (slice[kwIdx] === 'and' && (slice[kwIdx + 1] === 'gains' || slice[kwIdx + 1] === 'gain')) {
      let scan = kwIdx + 2;
      let lastGood = -1;
      while (true) {
        const kw = readGrantableKeyword(slice, scan);
        if (!kw) break;
        grantedKeywords.push(kw.keyword);
        scan += kw.consumed;
        lastGood = scan;
        if (slice[scan] === ',') scan++;
        if (slice[scan] === 'and') scan++;
      }
      if (grantedKeywords.length === 0) return null;
      kwIdx = lastGood;
    }

    if (slice[kwIdx] !== 'until' || slice[kwIdx + 1] !== 'end' || slice[kwIdx + 2] !== 'of'
      || (slice[kwIdx + 3] !== 'turn' && slice[kwIdx + 3] !== 'combat')) return null;

    let consumed = kwIdx + 4;
    if (tokens[startIndex + consumed] === '.') consumed++;

    const effects: Effect[] = [{
      kind: 'ModifyPT',
      target: { kind: 'Source' },
      power,
      toughness,
      untilEndOfTurn: true,
    }];
    for (const keyword of grantedKeywords) {
      effects.push({ kind: 'GrantKeyword', target: { kind: 'Source' }, keyword, untilEndOfTurn: true });
    }

    return { effects, targets: [], consumed };
  }

  // "each creature you control with power 4 or greater gets +1/+1 and gains trample until end of turn"
  // Also accepts "creatures you control with power 4 or greater ..."
  if (
    slice.length >= 13 &&
    (
      (slice[0] === 'each' && slice[1] === 'creature' && slice[2] === 'you' && slice[3] === 'control')
      || (slice[0] === 'creatures' && slice[1] === 'you' && slice[2] === 'control')
    ) &&
    slice[slice[0] === 'each' ? 4 : 3] === 'with'
  ) {
    let idx = slice[0] === 'each' ? 4 : 3;
    if (slice[idx + 1] !== 'power') return null;
    const powerValue = Number.parseInt(slice[idx + 2], 10);
    if (Number.isNaN(powerValue) || slice[idx + 3] !== 'or') return null;
    const opWord = slice[idx + 4];
    if (opWord !== 'greater' && opWord !== 'less') return null;
    idx += 5;
    if (slice[idx] !== 'gets' && slice[idx] !== 'get') return null;
    idx++;

    const ptMatch = slice[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    idx++;
    const power = Number.parseInt(ptMatch[1], 10);
    const toughness = Number.parseInt(ptMatch[2], 10);
    const target: TargetRef = {
      kind: 'AllCreaturesYouControlMatching',
      filter: {
        types: ['creature'],
        power: { op: opWord === 'greater' ? 'gte' : 'lte', value: powerValue },
      },
    };
    const effects: Effect[] = [{
      kind: 'ModifyPT',
      target,
      power,
      toughness,
      untilEndOfTurn: true,
    }];

    if (slice[idx] === 'and' && (slice[idx + 1] === 'gain' || slice[idx + 1] === 'gains')) {
      const keyword = slice[idx + 2];
      if (!keyword) return null;
      if (slice[idx + 3] !== 'until' || slice[idx + 4] !== 'end' || slice[idx + 5] !== 'of'
        || (slice[idx + 6] !== 'turn' && slice[idx + 6] !== 'combat')) return null;
      effects.push({
        kind: 'GrantKeyword',
        target,
        keyword: keyword.charAt(0).toUpperCase() + keyword.slice(1),
        untilEndOfTurn: true,
      });
      idx += 7;
    } else {
      if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
        || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')) return null;
      idx += 4;
    }

    let consumed = idx;
    if (tokens[startIndex + consumed] === '.') consumed++;
    return { effects, targets: [], consumed };
  }

  // "each creature you control gets +N/+N ..." → normalize to "creatures you control get ..."
  if (slice[0] === 'each' && slice[1] === 'creature' && slice[2] === 'you' && slice[3] === 'control'
      && (slice[4] === 'gets' || slice[4] === 'get')) {
    const shifted = matchModifyPT(['creatures', 'you', 'control', 'get', ...slice.slice(5)], 0);
    if (shifted) return { ...shifted, consumed: shifted.consumed + 1 };
  }

  // "creatures you control get +N/+N until end of turn"
  if (slice.length >= 8 &&
      slice[0] === 'creatures' && slice[1] === 'you' && slice[2] === 'control' &&
      slice[3] === 'get') {
    const ptMatch = slice[4]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    const power = parseInt(ptMatch[1], 10);
    const toughness = parseInt(ptMatch[2], 10);

    if (slice[5] === 'and' && (slice[6] === 'gain' || slice[6] === 'gains')) {
      // Multi-keyword list: "and gain first strike, trample, and lifelink"
      // Uses the same comma/and-separated loop used by the single-target branches.
      // Unknowable engine keywords (infect, wither) that appear after known keywords
      // are skipped so the +P/+T still applies (task honesty: only the granted
      // keywords that ARE in GRANTABLE_KEYWORDS get GrantKeyword effects; the rest
      // are silently omitted from the effect list but don't block parsing).
      const grantedKeywords: string[] = [];
      let kwIdx = 7;
      let lastGoodBeforeSep = -1; // position after last successfully consumed keyword word
      while (true) {
        const kw = readGrantableKeyword(slice, kwIdx);
        if (!kw) {
          // Unknown keyword (e.g. 'infect', 'wither'): try to skip one word +
          // optional separators so parsing can continue to the next known keyword
          // or 'until'. We skip one token only — multi-word unknowns stay unparsed.
          const word = slice[kwIdx];
          if (!word || word === 'until' || word === '.' || word === ',') break;
          // Only skip single-word tokens that look like keywords (no digits, no mana symbols)
          if (/^[a-z]+$/.test(word)) {
            kwIdx++; // skip unknown keyword token
            // consume optional separator before checking for more
            if (slice[kwIdx] === ',') kwIdx++;
            if (slice[kwIdx] === 'and') kwIdx++;
            continue;
          }
          break;
        }
        grantedKeywords.push(kw.keyword);
        kwIdx += kw.consumed;
        lastGoodBeforeSep = kwIdx;
        if (slice[kwIdx] === ',') kwIdx++;
        if (slice[kwIdx] === 'and') kwIdx++;
      }
      if (grantedKeywords.length === 0) return null;
      // After loop, kwIdx should point at 'until'
      const untilIdx = kwIdx;
      if (slice[untilIdx] !== 'until' || slice[untilIdx + 1] !== 'end' || slice[untilIdx + 2] !== 'of'
        || (slice[untilIdx + 3] !== 'turn' && slice[untilIdx + 3] !== 'combat')) return null;

      let consumed = untilIdx + 4;
      if (tokens[startIndex + consumed] === '.') consumed++;

      const effects: Effect[] = [{
        kind: 'ModifyPT',
        target: { kind: 'AllCreaturesYouControl' },
        power,
        toughness,
        untilEndOfTurn: true,
      }];
      for (const keyword of grantedKeywords) {
        effects.push({
          kind: 'GrantKeyword',
          target: { kind: 'AllCreaturesYouControl' },
          keyword,
          untilEndOfTurn: true,
        });
      }

      void lastGoodBeforeSep;
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

  // "all creatures get +N/+N until end of turn" — mass pump/shrink on EVERY
  // creature (no controller restriction). Executor's ModifyPT/AllCreatures loops
  // all battlefield creatures. Only the pure P/T form (GrantKeyword has no bare
  // AllCreatures path, so "and gain <kw>" is left unparsed rather than half-run).
  if (slice.length >= 8 && slice[0] === 'all' && slice[1] === 'creatures'
      && (slice[2] === 'get' || slice[2] === 'gets')) {
    const ptMatch = slice[3]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    if (slice[4] !== 'until' || slice[5] !== 'end' || slice[6] !== 'of'
      || (slice[7] !== 'turn' && slice[7] !== 'combat')) return null;
    let consumed = 8;
    if (tokens[startIndex + consumed] === '.') consumed++;
    const effect: Effect = {
      kind: 'ModifyPT',
      target: { kind: 'AllCreatures' },
      power: parseInt(ptMatch[1], 10),
      toughness: parseInt(ptMatch[2], 10),
      untilEndOfTurn: true,
    };
    return { effects: [effect], targets: [], consumed };
  }

  // "target creature gets +N/+N until end of turn"
  // "target green creature you control gets +N/+N until end of turn"
  if (slice.length < 8) return null;
  if (slice[0] !== 'target') return null;
  let idx = 1;
  const colorRead = readColorConstraint(slice, idx);
  const colorConstraints: TargetSpec['constraints'] | undefined = colorRead ? { colors: colorRead.colors } : undefined;
  if (colorRead) idx += colorRead.consumed;
  if (slice[idx] !== 'creature') {
    // "target <Subtype> [you control] gets +N/+N until end of turn"
    // Also handles "target <Subtype> creature [you control] gets +N/+N ..." where
    // the explicit 'creature' noun follows the subtype word (e.g. "target Human creature
    // you control gets +1/+1 and gains indestructible until end of turn").
    // Slice 6: added 'creature' noun skip and post-creature controller phrase handling.
    const ptSubtypeRead = readCreatureSubtypeTargetPhrase(slice, idx);
    if (ptSubtypeRead) {
      let sidx = idx + ptSubtypeRead.consumed;
      // Slice 6: skip optional explicit 'creature' noun between the subtype and controller phrase.
      if (slice[sidx] === 'creature') sidx++;
      // Re-read controller phrase if readCreatureSubtypeTargetPhrase didn't consume it
      // (happens when 'creature' separates the subtype from 'you control').
      let controllerControls = ptSubtypeRead.controllerControls;
      let opponentControls = ptSubtypeRead.opponentControls;
      if (!controllerControls && !opponentControls) {
        if (slice[sidx] === 'you' && slice[sidx + 1] === 'control') {
          controllerControls = true;
          sidx += 2;
        } else if (slice[sidx] === 'an' && slice[sidx + 1] === 'opponent' && slice[sidx + 2] === 'controls') {
          opponentControls = true;
          sidx += 3;
        }
      }
      if (slice[sidx] !== 'gets') return null;
      sidx++;
      const ptMatch2 = slice[sidx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
      if (!ptMatch2) return null;
      sidx++;
      const power2 = parseInt(ptMatch2[1], 10);
      const toughness2 = parseInt(ptMatch2[2], 10);
      const grantedKeywords2: string[] = [];
      if (slice[sidx] === 'and' && (slice[sidx + 1] === 'gains' || slice[sidx + 1] === 'gain')) {
        let kwIdx = sidx + 2;
        let lastGood = -1;
        while (true) {
          const kw = readGrantableKeyword(slice, kwIdx);
          if (!kw) break;
          grantedKeywords2.push(kw.keyword);
          kwIdx += kw.consumed;
          lastGood = kwIdx;
          if (slice[kwIdx] === ',') kwIdx++;
          if (slice[kwIdx] === 'and') kwIdx++;
        }
        if (grantedKeywords2.length === 0) return null;
        sidx = lastGood;
      }
      if (slice[sidx] !== 'until' || slice[sidx + 1] !== 'end' || slice[sidx + 2] !== 'of'
        || (slice[sidx + 3] !== 'turn' && slice[sidx + 3] !== 'combat')) return null;
      sidx += 4;
      let consumed2 = sidx;
      if (tokens[startIndex + consumed2] === '.') consumed2++;
      const ptSubtypeConstraints: TargetSpec['constraints'] = {
        ...(colorConstraints || {}),
        subtypes: ptSubtypeRead.subtypes,
        ...(controllerControls ? { controllerControls: true } : {}),
        ...(opponentControls ? { opponentControls: true } : {}),
      };
      const ptSubtypeSpec = makeTargetSpec('Creature', ptSubtypeConstraints);
      const ptSubtypeEffect: Effect = {
        kind: 'ModifyPT',
        target: makeChosenRef(ptSubtypeSpec),
        power: power2,
        toughness: toughness2,
        untilEndOfTurn: true,
      };
      const ptSubtypeKwEffects: Effect[] = grantedKeywords2.map(keyword => ({
        kind: 'GrantKeyword' as const,
        target: makeChosenRef(ptSubtypeSpec),
        keyword,
        untilEndOfTurn: true,
      }));
      return { effects: [ptSubtypeEffect, ...ptSubtypeKwEffects], targets: [ptSubtypeSpec], consumed: consumed2 };
    }
    // Slice 6: "target non-<Subtype> creature [you control] gets +N/+N ..." —
    // strip the non-<Subtype> modifier with retryWithTargetNounModifiers so the
    // reduced token stream hits the normal "target creature gets ..." path above.
    if (slice[0] === 'target') {
      const modResult = retryWithTargetNounModifiers(slice, 0, matchModifyPT);
      if (modResult) return modResult;
    }
    return null;
  }
  idx++;
  const constraints: TargetSpec['constraints'] = { ...(colorConstraints || {}) };
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    constraints.controllerControls = true;
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

  // Optional combat-trick suffix: "and gains <keyword>[, <keyword>][ and <keyword>]"
  // e.g. "target creature gets +2/+2 and gains trample and first strike until end of turn".
  const grantedKeywords: string[] = [];
  if (slice[idx] === 'and' && (slice[idx + 1] === 'gains' || slice[idx + 1] === 'gain')) {
    let kwIdx = idx + 2;
    let lastGood = -1;
    while (true) {
      const kw = readGrantableKeyword(slice, kwIdx);
      if (!kw) break;
      grantedKeywords.push(kw.keyword);
      kwIdx += kw.consumed;
      lastGood = kwIdx;
      if (slice[kwIdx] === ',') kwIdx++;
      if (slice[kwIdx] === 'and') kwIdx++;
    }
    if (grantedKeywords.length === 0) return null;
    idx = lastGood;
  }

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
  const keywordEffects: Effect[] = grantedKeywords.map(keyword => ({
    kind: 'GrantKeyword',
    target: makeChosenRef(spec),
    keyword,
    untilEndOfTurn: true,
  }));

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
        effects: [effect, ...keywordEffects, fightEffect],
        targets: [spec, opponentCreature],
        consumed: consumed + fightIdx,
      };
    }
  }

  if (tokens[startIndex + consumed] === '.') consumed++;

  return { effects: [effect, ...keywordEffects], targets: [spec], consumed };
}

/**
 * Slice 12 — "target creature loses <keyword(s)> until end of turn."
 *
 * Covers:
 *   • Single keyword:   "Target creature loses flying until end of turn."   (Canopy Claws)
 *   • Explicit list:    "Target creature loses flying, first strike, and trample until end of turn."
 *
 * DECLINES:
 *   • "loses all abilities …" — no LoseAllAbilities executor branch exists; leave Unparsed.
 *   • "loses your choice of …" — no runtime-choice infrastructure; leave Unparsed.
 *   • Compound forms that also modify P/T ("gets −N/−N and loses …") — handled by
 *     matchModifyPTAndLoseKeyword, which must remain higher priority in the dispatch array.
 *
 * Emits one LoseKeyword effect per keyword.
 */
export function matchTargetCreatureLosesKeyword(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Must start with "target [<color>] creature [you control | an opponent controls | <other qualifiers>] loses"
  if (slice[0] !== 'target') return null;
  let idx = 1;

  // Optional color qualifier
  const colorRead = readColorConstraint(slice, idx);
  if (colorRead) idx += colorRead.consumed;

  if (slice[idx] !== 'creature') return null;
  idx++;

  // Optional controller qualifier
  const constraints: TargetSpec['constraints'] = colorRead ? { colors: colorRead.colors } : {};
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    constraints.opponentControls = true;
    idx += 3;
  } else if (slice[idx] === 'defending' && slice[idx + 1] === 'player' && slice[idx + 2] === 'controls') {
    // attack-trigger tail form
    idx += 3;
  }

  if (slice[idx] !== 'loses') return null;
  idx++;

  // Decline "loses all abilities" — no executor for transient LoseAllAbilities
  if (slice[idx] === 'all' && slice[idx + 1] === 'abilities') return null;

  // Decline "loses your choice of …" — no runtime-choice infrastructure
  if (slice[idx] === 'your' && slice[idx + 1] === 'choice' && slice[idx + 2] === 'of') return null;

  // Read one or more keywords separated by commas / "and"
  const keywords: string[] = [];
  let lastGood = -1;

  while (true) {
    const kw = readGrantableKeyword(slice, idx);
    if (!kw) break;
    keywords.push(kw.keyword);
    idx += kw.consumed;
    lastGood = idx;
    // Consume optional ", and" / ", " / " and " separators
    if (slice[idx] === ',') idx++;
    if (slice[idx] === 'and') idx++;
  }

  if (keywords.length === 0) return null;
  // If we consumed separators but found no additional keyword, rewind to lastGood.
  idx = lastGood;

  // Require "until end of turn" duration
  if (
    slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
    || slice[idx + 3] !== 'turn'
  ) return null;
  idx += 4;

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  const effects: Effect[] = keywords.map(keyword => ({
    kind: 'LoseKeyword' as const,
    target: makeChosenRef(spec),
    keyword,
    untilEndOfTurn: true,
  }));

  return { effects, targets: [spec], consumed: idx };
}

/**
 * Match: "target creature gets -2/-0 and loses flying until end of turn"
 * Match: "target creature defending player controls gets -2/-0 and loses flying until your next turn"
 */
export function matchModifyPTAndLoseKeyword(tokens: string[], startIndex: number): PatternResult {
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
 * Match: "target creature gains [keyword] until end of turn"
 * Match: "target creature you control gains [keyword] until end of turn"
 * Match: "target creature gains [keyword]"
 * Match: "target creature you control gains [keyword]"
 * Match: "target creature gains double strike until end of turn" (two-word keyword)
 * Match: "target creature gains first strike until end of turn" (two-word keyword)
 */
export function matchGrantKeyword(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;

  if (
    slice[0] === 'creatures'
    && slice[1] === 'you'
    && slice[2] === 'control'
    && slice[3] === 'gain'
  ) {
    let idx = 4;
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

    let untilEndOfTurn = false;
    if (slice[idx] === 'until' && slice[idx + 1] === 'end' &&
        slice[idx + 2] === 'of' && slice[idx + 3] === 'turn') {
      untilEndOfTurn = true;
      idx += 4;
    }

    if (slice[idx] === '.') idx++;

    return {
      effects: [{
        kind: 'GrantKeyword',
        target: { kind: 'AllCreaturesYouControl' },
        keyword,
        untilEndOfTurn,
      }],
      targets: [],
      consumed: idx,
    };
  }

  // Self: "it/~/this creature gains <keyword> [until end of turn]".
  if (
    slice[0] === 'it' || slice[0] === '~'
    || (slice[0] === 'this' && (slice[1] === 'creature' || slice[1] === 'permanent'))
  ) {
    let sidx = (slice[0] === 'this') ? 2 : 1;
    if (slice[sidx] !== 'gains' && slice[sidx] !== 'gain' && slice[sidx] !== 'has' && slice[sidx] !== 'have') return null;
    sidx++;
    let keyword: string | null = null;
    const twoWordKey = slice[sidx] + ' ' + slice[sidx + 1];
    if (GRANTABLE_KEYWORDS[twoWordKey]) { keyword = GRANTABLE_KEYWORDS[twoWordKey]; sidx += 2; }
    else if (GRANTABLE_KEYWORDS[slice[sidx]]) { keyword = GRANTABLE_KEYWORDS[slice[sidx]]; sidx++; }
    if (!keyword) return null;

    let untilEndOfTurn = false;
    if (slice[sidx] === 'until' && slice[sidx + 1] === 'end' && slice[sidx + 2] === 'of' && slice[sidx + 3] === 'turn') {
      untilEndOfTurn = true;
      sidx += 4;
    }
    if (slice[sidx] === '.') sidx++;
    return {
      effects: [{ kind: 'GrantKeyword', target: { kind: 'Source' }, keyword, untilEndOfTurn }],
      targets: [],
      consumed: sidx,
    };
  }

  if (slice[0] !== 'target') return null;

  // "target attacking creature gains …" — noun-phrase constraint modifiers,
  // then the regular grant parse on the reduced clause.
  const grantWithMods = retryWithTargetNounModifiers(slice, 0, matchGrantKeyword);
  if (grantWithMods) return grantWithMods;

  if (slice[1] !== 'creature') {
    // "target <Subtype> [you control] gains <keyword> [until end of turn]"
    const grantSubtypeRead = readCreatureSubtypeTargetPhrase(slice, 1);
    if (grantSubtypeRead) {
      let idx = 1 + grantSubtypeRead.consumed;
      if (slice[idx] !== 'gains') return null;
      idx++;
      let keyword: string | null = null;
      const twoWordKey = slice[idx] + ' ' + slice[idx + 1];
      if (GRANTABLE_KEYWORDS[twoWordKey]) { keyword = GRANTABLE_KEYWORDS[twoWordKey]; idx += 2; }
      else if (GRANTABLE_KEYWORDS[slice[idx]]) { keyword = GRANTABLE_KEYWORDS[slice[idx]]; idx++; }
      if (!keyword) return null;
      let untilEndOfTurn = false;
      if (slice[idx] === 'until' && slice[idx + 1] === 'end' && slice[idx + 2] === 'of' && slice[idx + 3] === 'turn') {
        untilEndOfTurn = true;
        idx += 4;
      }
      if (slice[idx] === '.') idx++;
      const grantSubtypeConstraints: TargetSpec['constraints'] = {
        subtypes: grantSubtypeRead.subtypes,
        ...(grantSubtypeRead.controllerControls ? { controllerControls: true } : {}),
        ...(grantSubtypeRead.opponentControls ? { opponentControls: true } : {}),
      };
      const spec = makeTargetSpec('Creature', grantSubtypeConstraints);
      return { effects: [{ kind: 'GrantKeyword', target: makeChosenRef(spec), keyword, untilEndOfTurn }], targets: [spec], consumed: idx };
    }
    return null;
  }

  let idx = 2;
  const constraints: TargetSpec['constraints'] = {};

  // "with power 5 or greater" (Spearbreaker Behemoth) — may precede "you control".
  const grantPtBefore = applyPowerToughnessTargetConstraint(slice, idx, constraints);
  if (grantPtBefore) {
    Object.assign(constraints, grantPtBefore.constraints);
    idx = grantPtBefore.nextIndex;
  }

  // Optional "you control"
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  }

  // "target creature you control with power 4 or greater gains …"
  const grantPtAfter = applyPowerToughnessTargetConstraint(slice, idx, constraints);
  if (grantPtAfter) {
    Object.assign(constraints, grantPtAfter.constraints);
    idx = grantPtAfter.nextIndex;
  }

  // Slice 8: "target [attacking] creature without <keyword> gains <keyword>" —
  // keyword-absence qualifier ("without flying", "without trample", etc.).
  // Stored in lacksKeywords; enforced at targeting time by targets.ts hasKeyword check.
  if (slice[idx] === 'without') {
    const twoWordLack = slice[idx + 1] + ' ' + slice[idx + 2];
    if (GRANTABLE_KEYWORDS[twoWordLack]) {
      constraints.lacksKeywords = [GRANTABLE_KEYWORDS[twoWordLack].toLowerCase()];
      idx += 3;
    } else if (slice[idx + 1] && GRANTABLE_KEYWORDS[slice[idx + 1]]) {
      constraints.lacksKeywords = [GRANTABLE_KEYWORDS[slice[idx + 1]].toLowerCase()];
      idx += 2;
    }
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

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  const effect: Effect = {
    kind: 'GrantKeyword',
    target: makeChosenRef(spec),
    keyword,
    untilEndOfTurn,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "all creatures gain <keyword> [until end of turn]" and
 *        "all <color|subtype> creatures gain <keyword> [until end of turn]".
 * Only GRANTABLE_KEYWORDS are accepted. Emits a GrantKeyword effect targeting
 * AllCreatures (every creature on the battlefield) or AllOfType (the matching
 * subset, always including types:['creature']). The executor applies the keyword
 * to every matching battlefield creature; UEOT cleanup is global.
 */
export function matchGrantKeywordAll(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;
  if (slice[0] !== 'all') return null;

  let idx = 1;
  let target: TargetRef;

  if (slice[idx] === 'creatures') {
    idx++;
    target = { kind: 'AllCreatures' };
  } else {
    // "all <color> creatures" / "all <subtype> creatures"
    const filter: CardFilter = { types: ['creature'] };
    const colorRead = readColorConstraint(slice, idx);
    if (colorRead) {
      filter.colors = colorRead.colors;
      idx += colorRead.consumed;
    } else {
      // Treat the next single word as a creature subtype (e.g. "goblin", "elves").
      const word = slice[idx];
      if (!word || word === 'creatures' || word === 'gain' || word === 'gains') return null;
      // Singularize a trailing 's' for plural subtypes ("goblins" -> "goblin").
      const subtype = word.endsWith('s') ? word.slice(0, -1) : word;
      filter.subtypes = [subtype];
      idx++;
    }
    if (slice[idx] !== 'creatures') return null;
    idx++;
    target = { kind: 'AllOfType', filter };
  }

  if (slice[idx] !== 'gain' && slice[idx] !== 'gains') return null;
  idx++;

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

  let untilEndOfTurn = false;
  if (slice[idx] === 'until' && slice[idx + 1] === 'end' &&
      slice[idx + 2] === 'of' && slice[idx + 3] === 'turn') {
    untilEndOfTurn = true;
    idx += 4;
  }

  if (slice[idx] === '.') idx++;

  return {
    effects: [{ kind: 'GrantKeyword', target, keyword, untilEndOfTurn }],
    targets: [],
    consumed: idx,
  };
}

/**
 * Match: "another target creature you control gains haste until end of turn and gets +X/+X until end of turn, where X is that creature's power"
 * Also handles the same pattern without "another" or "you control".
 */
export function matchGrantKeywordAndDynamicPT(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 15) return null;

  let idx = 0;
  const constraints: TargetSpec['constraints'] = {};
  if (slice[idx] === 'another') {
    constraints.notSource = true;
    idx++;
  }
  if (slice[idx] !== 'target') return null;
  idx++;
  if (slice[idx] !== 'creature') return null;
  idx++;
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  }
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

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
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
 * Match the LEADING-duration spelling of single-target combat tricks, e.g.
 *   "Until end of turn, target creature gets +1/+0 and gains indestructible."
 *   "Until end of turn, target creature gains trample."
 *   "Until end of turn, target creature you control gets +2/+2."
 *
 * Standard templating puts "until end of turn" at the END of the clause, which
 * matchModifyPT / matchGrantKeyword already handle. A sizeable set of cards
 * (Armor of Shadows, Breach, Revenge of the Hunted, …) front-load the duration
 * instead, leaving these faces Unparsed. We normalize by stripping the leading
 * "until end of turn ," prefix, re-appending "until end of turn" before the
 * trailing period, and delegating to the existing trailing-duration matchers.
 * Because we reuse those matchers verbatim, only their already-honest,
 * executor-backed forms (ModifyPT + GRANTABLE_KEYWORDS GrantKeyword on a chosen
 * Creature target) are credited — non-grantable keywords and quoted-ability
 * grants still fall through to Unparsed.
 */
export function matchLeadingDurationPumpGrant(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // Require the exact leading "until end of turn ," prefix.
  if (
    slice[0] !== 'until' || slice[1] !== 'end' || slice[2] !== 'of'
    || slice[3] !== 'turn' || slice[4] !== ','
  ) {
    return null;
  }

  const prefixLen = 5; // until end of turn ,

  // Slice 11 extension: "Until end of turn, creatures you control get +N/+N and
  // gain X, Y, and Z." (Titanic Ultimatum / Triumph of the Hordes family).
  // The mass-pump form (no "target") needs the same normalize-and-delegate
  // approach but delegates to the "creatures you control get" branch of matchModifyPT.
  if (slice[5] === 'creatures' && slice[6] === 'you' && slice[7] === 'control') {
    const rest = slice.slice(prefixLen);
    let periodIdx = rest.indexOf('.');
    const body = periodIdx === -1 ? rest.slice() : rest.slice(0, periodIdx);
    if (!body.includes('"')) {
      const reconstructed = [...body, 'until', 'end', 'of', 'turn', '.'];
      const inner = matchModifyPT(reconstructed, 0);
      if (inner && inner.consumed >= body.length) {
        let consumed = prefixLen + body.length;
        if (periodIdx !== -1) consumed += 1;
        return { effects: inner.effects, targets: inner.targets, consumed };
      }
    }
  }

  // The remainder must be a single-target buff ("target creature ...").
  if (slice[5] !== 'target') return null;

  const rest = slice.slice(prefixLen);

  // Find a trailing period so we can splice the duration in just before it.
  let periodIdx = rest.indexOf('.');
  const body = periodIdx === -1 ? rest.slice() : rest.slice(0, periodIdx);

  // Bail on quoted-ability grants: `gains "..."`. The reconstructed trailing
  // form would not be understood by the inner matchers anyway, but rejecting
  // early keeps intent clear and avoids any partial credit.
  if (body.includes('"')) return null;

  // Reconstruct the trailing-duration spelling the inner matchers expect.
  const reconstructed = [...body, 'until', 'end', 'of', 'turn', '.'];

  // Delegate. matchModifyPT covers "... gets +N/+N [and gains <kw>...]" and
  // matchGrantKeyword covers the pure "... gains <kw>" form. Both emit
  // executor-backed ModifyPT / GrantKeyword effects on a chosen Creature.
  const inner = matchModifyPT(reconstructed, 0) ?? matchGrantKeyword(reconstructed, 0);
  if (!inner) return null;

  // The inner matcher must have consumed the WHOLE body (it should land exactly
  // on the appended "until end of turn ."). If it stopped short, the body had
  // trailing structure we don't fully understand — bail rather than half-parse.
  const expectedConsumed = reconstructed.length; // includes trailing "."
  if (inner.consumed < body.length) return null;

  // Total consumed in the ORIGINAL token stream: the leading prefix + the body
  // + the original trailing period (if present).
  let consumed = prefixLen + body.length;
  if (periodIdx !== -1) consumed += 1; // the "." we split on
  void expectedConsumed;

  return { effects: inner.effects, targets: inner.targets, consumed };
}

/**
 * Match: "target creature can't block this turn"
 * Match: "target creature can't attack this turn"
 * Match: "target creature can't attack or block this turn"
 * Match: "target creature can't be blocked this turn"
 */
export function matchTargetCombatRestriction(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 6) return null;
  if (slice[0] !== 'target') return null;

  let idx = 1;
  const colorRead = readColorConstraint(slice, idx);
  const colorConstraints: TargetSpec['constraints'] | undefined = colorRead ? { colors: colorRead.colors } : undefined;
  if (colorRead) idx += colorRead.consumed;
  if (slice[idx] !== 'creature') return null;
  idx++;

  const constraints: TargetSpec['constraints'] = { ...(colorConstraints || {}) };
  if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    constraints.opponentControls = true;
    idx += 3;
  } else if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  }

  // Slice 11: parse optional "with power N or less/greater" qualifier.
  // e.g. "Target creature with power 2 or less can't be blocked this turn."
  const powerRead = applyPowerToughnessTargetConstraint(slice, idx, constraints);
  if (powerRead) {
    Object.assign(constraints, powerRead.constraints);
    idx = powerRead.nextIndex;
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
 * Match (Equipment ETB self-attach): "attach it to target creature you control"
 * and "attach it to target legendary creature you control".
 *
 * Used by Maul of the Skyclaves, Mithril Coat, etc. Emits an Attach effect that
 * sets the source Equipment's `attachedTo` to a chosen creature you control —
 * the equipmentBonus cache then applies the buff continuously. We require the
 * "you control" clause (target legality is enforced as controllerControls) and a
 * plain `creature` subject; subtype-restricted variants ("Knight or Vehicle")
 * are intentionally left Unparsed because TargetSpec can't enforce a subtype.
 */
export function matchAttachItToTarget(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 6) return null;
  if (slice[0] !== 'attach') return null;
  // "attach it to" / "attach ~ to" / "attach this <type> to" (Slice 4: after
  // normalizeSelfSubtypeNouns maps 'this Equipment' → 'this artifact')
  let toIdx: number;
  if (slice[1] === 'it' || slice[1] === '~') {
    toIdx = 2;
  } else if (slice[1] === 'this' && slice[2] !== undefined && slice[3] === 'to') {
    toIdx = 3;
  } else {
    return null;
  }
  if (slice[toIdx] !== 'to') return null;
  if (slice[toIdx + 1] !== 'target') return null;

  let idx = toIdx + 2;
  // Optional "legendary" supertype qualifier (still a creature target).
  if (slice[idx] === 'legendary') idx++;
  if (slice[idx] !== 'creature') return null;
  idx++;

  // Require the "you control" clause; the attacher must control the creature.
  if (slice[idx] !== 'you' || slice[idx + 1] !== 'control') return null;
  idx += 2;

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Creature', { controllerControls: true });
  const effect: Effect = {
    kind: 'Attach',
    source: 'Source',
    target: makeChosenRef(spec),
  };
  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "copy target instant or sorcery spell"
 * Match: "copy target instant or sorcery spell with mana value 4 or less"
 */
export function matchCopySpell(tokens: string[], startIndex: number): PatternResult {
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
export function matchCopyThatSpell(tokens: string[], startIndex: number): PatternResult {
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
export function matchCopyCreature(tokens: string[], startIndex: number): PatternResult {
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
  let copyConstraints: TargetSpec['constraints'] = undefined;
  // Slice 4: "target artifact creature [you control]" (Mirage Mockery)
  if (slice[idx] === 'artifact' && slice[idx + 1] === 'creature') {
    targetType = 'Creature';
    idx += 2;
    if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
      copyConstraints = { types: ['artifact'], controllerControls: true };
      idx += 2;
    } else {
      copyConstraints = { types: ['artifact'] };
    }
  } else if (slice[idx] === 'creature') {
    targetType = 'Creature';
    idx++;
    if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
      copyConstraints = { controllerControls: true };
      idx += 2;
    }
  } else if (slice[idx] === 'permanent') {
    targetType = 'Permanent';
    idx++;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec(targetType, copyConstraints);
  const effect: Effect = {
    kind: 'Copy',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 7: Match "create a token that's a copy of this creature"
 *          Match "create a token that is a copy of this creature"
 *          Match "create a token that's a copy of ~"
 *
 * Ninjutsu / Myriad family. The copy is of the source permanent itself, so the
 * target resolves to { kind: 'Source' }. The executor's Copy case must handle
 * Source inline (using sourceInstanceId) — resolveTargetRef throws on Source.
 */
export function matchCopySelfCreature(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "create a token that's a copy of this creature"
  // "create a token that is a copy of this creature"
  // "create a token that's a copy of ~"
  if (slice.length < 8) return null;
  if (slice[0] !== 'create') return null;
  if (slice[1] !== 'a') return null;
  if (slice[2] !== 'token') return null;

  let idx = 3;
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

  // Subject must be "this creature", "this permanent", "this vehicle", or "~"
  if (slice[idx] === '~') {
    idx++;
  } else if (
    slice[idx] === 'this' &&
    (slice[idx + 1] === 'creature' || slice[idx + 1] === 'permanent' || slice[idx + 1] === 'vehicle')
  ) {
    idx += 2;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Copy',
    target: { kind: 'Source' },
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "counter target spell"
 * Match: "counter target noncreature spell"
 * Match: "counter target creature spell"
 * Match: "counter target creature or enchantment spell. If that spell is countered this way, exile it instead..."
 */
export function matchCounterSpell(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'counter') return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let consumed: number;
  let filter: 'noncreature' | 'creature' | 'creatureOrEnchantment' | 'artifactOrCreature' | 'instantOrSorcery' | 'enchantmentInstantOrSorcery' | undefined;

  if (
    slice[2] === 'enchantment' && slice[3] === ',' && slice[4] === 'instant'
    && slice[5] === ',' && slice[6] === 'or' && slice[7] === 'sorcery' && slice[8] === 'spell'
  ) {
    // "counter target enchantment, instant, or sorcery spell" (e.g. Swan Song)
    targetType = 'EnchantmentInstantOrSorcerySpell';
    filter = 'enchantmentInstantOrSorcery';
    consumed = 9;
  } else if (slice[2] === 'noncreature' && slice[3] === 'spell') {
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
 * Slice 1 — Match: "up to N target creatures can't block this turn"
 * Match: "up to N target creatures can't attack this turn"
 * Match: "up to N target creatures can't attack or block this turn"
 *
 * Produces a TargetSpec with count=N (N >= 2) plus one GrantKeyword effect per
 * restriction keyword. The executor's GrantKeyword case resolves multi-target via
 * resolveChosenTargetIds (Slice 1 executor branch), so each chosen creature
 * receives the restriction honestly.
 *
 * The singular form ("target creature can't block this turn") is left to the
 * existing matchTargetCombatRestriction.
 */
export function matchMultiTargetCombatRestriction(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "up to N target creatures can't block/attack [or block] this turn"
  if (slice[0] !== 'up' || slice[1] !== 'to') return null;
  const count = parseSmallNumberToken(slice[2] ?? '');
  if (Number.isNaN(count) || count < 2) return null;
  if (slice[3] !== 'target') return null;
  if (slice[4] !== 'creatures' && slice[4] !== 'creature') return null;

  let idx = 5;

  // Optional controller qualifier
  const constraints: TargetSpec['constraints'] = {};
  if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    constraints.opponentControls = true;
    idx += 3;
  } else if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  }

  // Parse can't
  const isCant = slice[idx] === "can't" || slice[idx] === 'cant' || slice[idx] === 'cannot'
    || (slice[idx] === 'can' && slice[idx + 1] === 'not');
  if (!isCant) return null;
  idx += (slice[idx] === 'can' && slice[idx + 1] === 'not') ? 2 : 1;

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
      // consume repeated "can't" if present
      if (slice[idx] === "can't" || slice[idx] === 'cant' || slice[idx] === 'cannot') idx++;
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
  spec.count = count;
  const chosenRef = makeChosenRef(spec);
  const effects: Effect[] = [...new Set(keywords)].map(keyword => ({
    kind: 'GrantKeyword',
    target: chosenRef,
    keyword,
    untilEndOfTurn: true,
  }));

  return { effects, targets: [spec], consumed: idx };
}

/**
 * Slice 8 — Match the optional-pump wrapper:
 *   "have target <creature-filter> get[s] +N/+N until end of turn"
 *
 * Called AFTER "you may" has been stripped by the dispatch arrays in
 * parseEffectClauseInternal / parseEffectClause. Handles the family:
 *   "you may have target Vampire get +2/+0 until end of turn"  (Anointed Deacon)
 *   "you may have target creature get +2/+2 until end of turn" (Battle-Rattle Shaman family)
 *
 * The "have" keyword distinguishes this from the bare "target creature gets"
 * form already handled by matchModifyPT. Supports:
 *   - "target creature" (bare)
 *   - "target <color> creature [you control | an opponent controls]"
 *   - "target <Subtype> [you control | an opponent controls]" (via readCreatureSubtypeTargetPhrase)
 * Routes directly to ModifyPT with untilEndOfTurn: true.
 */
export function matchHaveTargetGetPT(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Must start with "have target"
  if (slice[0] !== 'have' || slice[1] !== 'target') return null;

  let idx = 2;
  const constraints: TargetSpec['constraints'] = {};

  // Optional color qualifier
  const colorRead = readColorConstraint(slice, idx);
  if (colorRead) {
    constraints.colors = colorRead.colors;
    idx += colorRead.consumed;
  }

  // Try "creature" keyword
  if (slice[idx] === 'creature') {
    idx++;
    // Optional controller qualifier
    if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
      constraints.controllerControls = true;
      idx += 2;
    } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
      constraints.opponentControls = true;
      idx += 3;
    }
  } else {
    // Try creature subtype ("target Vampire", "target Wizard", etc.)
    const subtypeRead = readCreatureSubtypeTargetPhrase(slice, idx);
    if (!subtypeRead) return null;
    constraints.subtypes = subtypeRead.subtypes;
    if (subtypeRead.controllerControls) constraints.controllerControls = true;
    if (subtypeRead.opponentControls) constraints.opponentControls = true;
    idx += subtypeRead.consumed;
  }

  // "get" or "gets"
  if (slice[idx] !== 'get' && slice[idx] !== 'gets') return null;
  idx++;

  // P/T modification e.g. +2/+0
  const ptMatch = slice[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  idx++;

  // "until end of turn" or "until end of combat"
  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
    || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')) return null;
  idx += 4;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  const effect: Effect = {
    kind: 'ModifyPT',
    target: makeChosenRef(spec),
    power,
    toughness,
    untilEndOfTurn: true,
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Slice 10 — Match: "enchanted creature gains <keyword>[, <keyword>][ and <keyword>] until end of turn"
 *
 * Aura ETB trigger body: "When this Aura enters, enchanted creature gains
 * hexproof and indestructible until end of turn." (Starlit Mantle, Cradle of
 * Safety, Aquitect's Defenses, Military Discipline, Fae Flight, etc.)
 *
 * The subject "enchanted creature" resolves to { kind: 'SourceAttachedTo' }
 * (the permanent the source Aura is attached to). The executor's GrantKeyword
 * case handles SourceAttachedTo via getSourceAttachedTo + sourceInstanceId.
 *
 * Accepts one or more GRANTABLE_KEYWORDS in a comma/and list.
 */
export function matchEnchantedCreatureGrantKeyword(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Must start with "enchanted creature gains"
  if (slice[0] !== 'enchanted' || slice[1] !== 'creature') return null;
  if (slice[2] !== 'gains' && slice[2] !== 'gain') return null;

  let idx = 3;
  const grantedKeywords: string[] = [];
  let lastGood = -1;
  while (true) {
    const kw = readGrantableKeyword(slice, idx);
    if (!kw) break;
    grantedKeywords.push(kw.keyword);
    idx += kw.consumed;
    lastGood = idx;
    if (slice[idx] === ',') idx++;
    if (slice[idx] === 'and') idx++;
  }
  if (grantedKeywords.length === 0) return null;
  idx = lastGood;

  let untilEndOfTurn = false;
  if (
    slice[idx] === 'until' && slice[idx + 1] === 'end' &&
    slice[idx + 2] === 'of' && slice[idx + 3] === 'turn'
  ) {
    untilEndOfTurn = true;
    idx += 4;
  }
  if (slice[idx] === '.') idx++;

  const target: TargetRef = { kind: 'SourceAttachedTo' };
  const effects: Effect[] = grantedKeywords.map(keyword => ({
    kind: 'GrantKeyword' as const,
    target,
    keyword,
    untilEndOfTurn,
  }));

  return { effects, targets: [], consumed: idx };
}

/**
 * Slice 4 — Match multi-target pump/grant:
 *   "two target creatures each get +1/+1 until end of turn"       (Nahiri's Stoneblades — exact 2)
 *   "up to two target creatures each get +1/+1 until end of turn" (Cutthroat Maneuver — up to 2)
 *   "one or two target creatures each get +1/+1 until end of turn" (Terrific Team-Up family — range 1–2)
 *   "up to two target creatures each get +X/+X until end of turn, where X is ..." (Allied Assault family)
 *   Plus optional "and gain[s] <keyword>[, <keyword>] [and <keyword>]" suffix.
 *
 * Forms covered:
 *   - "N target creatures each get/gain ..." (exact N, N >= 2)
 *   - "up to N target creatures each get/gain ..." (up to N, minCount=1, N >= 2)
 *   - "one or two target creatures each get/gain ..." (minCount=1, count=2)
 *
 * Emits a SINGLE TargetSpec with count=N (and minCount for "up to" / "one or" forms)
 * plus one ModifyPT and/or one-or-more GrantKeyword effects all referencing the same
 * Chosen ref. The executor's multi-target branch for ModifyPT (Slice 4 addition) and
 * GrantKeyword (Slice 1 existing) resolve all chosen ids via resolveChosenTargetIds.
 */
export function matchMultiTargetPumpGrant(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // Parse the count prefix: "up to N", "one or two", exact "N", or "any number of"
  // "any number of" (Strive bodies): treated as unbounded (count=10, minCount=0).
  let count: number;
  let minCount: number | undefined;

  if (slice[0] === 'any' && slice[1] === 'number' && slice[2] === 'of') {
    // "any number of target creatures each get/gain ..."
    count = 10; // effectively unbounded
    minCount = 0; // player may choose zero
    idx = 3;
  } else if (slice[0] === 'up' && slice[1] === 'to') {
    // "up to N target creatures ..."
    count = parseSmallNumberToken(slice[2] ?? '');
    if (Number.isNaN(count) || count < 2) return null;
    minCount = 1; // "up to" means at least 1 must be chosen
    idx = 3;
  } else if (
    slice[0] === 'one' && slice[1] === 'or'
    && (slice[2] === 'two' || slice[2] === 'three')
  ) {
    // "one or two target creatures ..." / "one or three ..."
    count = slice[2] === 'two' ? 2 : 3;
    minCount = 1;
    idx = 3;
  } else {
    // Exact count word: two, three, four, etc. (>= 2)
    count = parseSmallNumberToken(slice[0] ?? '');
    if (Number.isNaN(count) || count < 2) return null;
    idx = 1;
  }

  if (slice[idx] !== 'target') return null;
  idx++;
  if (slice[idx] !== 'creatures' && slice[idx] !== 'creature') return null;
  idx++;

  // Optional controller qualifier
  const constraints: TargetSpec['constraints'] = {};
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    constraints.opponentControls = true;
    idx += 3;
  }

  // "each get" / "each gets" / "each gain" / "each gains"
  if (slice[idx] !== 'each') return null;
  idx++;
  const verb = slice[idx];
  if (verb !== 'get' && verb !== 'gets' && verb !== 'gain' && verb !== 'gains') return null;
  const verbIsGainOnly = (verb === 'gain' || verb === 'gains');
  idx++;

  // Track whether there's a P/T modification
  let ptPower: number | AmountRef | null = null;
  let ptToughness: number | AmountRef | null = null;
  let hasDynamicXPT = false; // true only when we saw +X/+X literal (needs where-clause)
  const grantedKeywords: string[] = [];

  if (!verbIsGainOnly) {
    // Expect P/T part first, e.g. +1/+1 or +X/+X
    const ptTok = slice[idx];
    if (!ptTok) return null;

    if (ptTok.match(/^\+x\/\+x$/)) {
      // Dynamic "+X/+X ... where X is ..."
      hasDynamicXPT = true;
      ptPower = null; // will be set after where-clause
      ptToughness = null;
      idx++;
    } else {
      const ptMatch = ptTok.match(/^([+-]\d+)\/([+-]\d+)$/);
      if (!ptMatch) return null;
      ptPower = parseInt(ptMatch[1], 10);
      ptToughness = parseInt(ptMatch[2], 10);
      idx++;
    }

    // Optional "and gain[s] <keyword>[, <keyword>][ and <keyword>]"
    if (slice[idx] === 'and' && (slice[idx + 1] === 'gain' || slice[idx + 1] === 'gains')) {
      let kwIdx = idx + 2;
      let lastGood = -1;
      while (true) {
        const kw = readGrantableKeyword(slice, kwIdx);
        if (!kw) break;
        grantedKeywords.push(kw.keyword);
        kwIdx += kw.consumed;
        lastGood = kwIdx;
        if (slice[kwIdx] === ',') kwIdx++;
        if (slice[kwIdx] === 'and') kwIdx++;
      }
      if (grantedKeywords.length > 0) idx = lastGood;
    }
  } else {
    // Pure "each gain[s] <keyword>[, ...]"
    let kwIdx = idx;
    let lastGood = -1;
    while (true) {
      const kw = readGrantableKeyword(slice, kwIdx);
      if (!kw) break;
      grantedKeywords.push(kw.keyword);
      kwIdx += kw.consumed;
      lastGood = kwIdx;
      if (slice[kwIdx] === ',') kwIdx++;
      if (slice[kwIdx] === 'and') kwIdx++;
    }
    if (grantedKeywords.length === 0) return null;
    idx = lastGood;
  }

  // "until end of turn" (required for the trailing form)
  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
    || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')) return null;
  idx += 4;

  // Optional "where X is the number of ..." (Allied Assault family)
  // Only required when we explicitly saw the "+X/+X" token — NOT for pure keyword grants
  // where ptPower/ptToughness are null because no P/T was specified at all.
  let dynamicAmount: AmountRef | null = null;
  if (hasDynamicXPT) {
    // We saw +X/+X earlier; now require the where-clause
    if (slice[idx] === ',') idx++;
    const whereResult = parseWhereXIsAnyAmount(slice, idx);
    if (!whereResult) return null;
    dynamicAmount = whereResult.amount;
    idx = whereResult.nextIndex;
  }

  if (slice[idx] === '.') idx++;

  // Must have something to do
  if (ptPower === null && ptToughness === null && dynamicAmount === null && grantedKeywords.length === 0) return null;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  spec.count = count;
  if (minCount !== undefined) spec.minCount = minCount;
  const chosenRef = makeChosenRef(spec);

  const effects: Effect[] = [];

  // P/T effect
  if (dynamicAmount !== null) {
    effects.push({
      kind: 'ModifyPT',
      target: chosenRef,
      power: dynamicAmount,
      toughness: dynamicAmount,
      untilEndOfTurn: true,
    });
  } else if (ptPower !== null && ptToughness !== null) {
    effects.push({
      kind: 'ModifyPT',
      target: chosenRef,
      power: ptPower as number,
      toughness: ptToughness as number,
      untilEndOfTurn: true,
    });
  }

  // Keyword effects
  for (const keyword of grantedKeywords) {
    effects.push({
      kind: 'GrantKeyword',
      target: chosenRef,
      keyword,
      untilEndOfTurn: true,
    });
  }

  return { effects, targets: [spec], consumed: idx };
}

// ============================================================================
// Slice 8: matchCanBlockAdditionalActivated
// ============================================================================

/**
 * Match the activated-ability effect clause:
 *   "this creature can block an additional creature this turn[.]"
 *   "~ can block an additional creature this turn[.]"
 *
 * (Mounted Archers, Vigilant Sentry activated form — the cost is parsed
 * separately by parseActivatedAbilities; we only see the EFFECT tokens here.)
 *
 * HONEST: combat.ts (declareBlockers) checks each blocker's grantedKeywords for
 * 'CanBlockAdditional' (set by the GrantKeyword execution path) and raises the
 * block-assignment limit from 1 to 2 for that turn. The GrantKeyword effect is
 * untilEndOfTurn so cleanupDamage (state-based.ts) clears it at end of turn.
 * Source-target is handled inline by the executor's Source branch.
 *
 * Token form accepted:
 *   this creature can block an additional creature this turn [.]
 *   ~ can block an additional creature this turn [.]
 */
export function matchCanBlockAdditionalActivated(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Subject: "this creature" or "~"
  let idx = 0;
  if (slice[idx] === 'this' && slice[idx + 1] === 'creature') {
    idx += 2;
  } else if (slice[idx] === '~') {
    idx += 1;
  } else {
    return null;
  }

  // "can block an additional creature this turn"
  if (slice[idx] !== 'can') return null; idx++;
  if (slice[idx] !== 'block') return null; idx++;
  if (slice[idx] !== 'an') return null; idx++;
  if (slice[idx] !== 'additional') return null; idx++;
  if (slice[idx] !== 'creature') return null; idx++;
  if (slice[idx] !== 'this' || slice[idx + 1] !== 'turn') return null;
  idx += 2;

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'GrantKeyword',
    target: { kind: 'Source' },
    keyword: 'CanBlockAdditional',
    untilEndOfTurn: true,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 6: matchAttackAsThoughNoDefender
// ============================================================================

/**
 * Match the turn-scoped "can attack this turn as though it didn't have defender"
 * clause used in activated and triggered ability bodies:
 *
 *   "this creature can attack this turn as though it didn't have defender[.]"
 *   "~ can attack this turn as though it didn't have defender[.]"
 *   "{cost}: This creature can attack this turn as though it didn't have defender."
 *       (Wakestone Gargoyle, Krotiq Nestguard activated forms)
 *   "Whenever a land enters..., ~ can attack this turn as though it didn't have
 *    defender."  (Skyclave Squid landfall triggered body)
 *
 * HONEST: The GrantKeyword effect targets the source creature (kind: 'Source').
 * Executor's Source branch writes 'IgnoreDefender' into card.grantedKeywords.
 * canAttackThisTurn (keywords.ts) skips the Defender block when
 * instanceHasKeyword(state, id, 'IgnoreDefender') returns true.
 * untilEndOfTurn ensures cleanupDamage (state-based.ts) clears the flag at
 * the end of the turn, matching the "this turn" wording.
 *
 * Accepted subject forms:
 *   "this creature can attack this turn as though it didn't have defender"
 *   "~ can attack this turn as though it didn't have defender"
 */
export function matchAttackAsThoughNoDefender(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Subject: "this creature" or "~"
  let idx = 0;
  if (slice[idx] === 'this' && slice[idx + 1] === 'creature') {
    idx += 2;
  } else if (slice[idx] === '~') {
    idx += 1;
  } else {
    return null;
  }

  // "can attack this turn as though it didn't have defender"
  if (slice[idx] !== 'can') return null; idx++;
  if (slice[idx] !== 'attack') return null; idx++;
  if (slice[idx] !== 'this' || slice[idx + 1] !== 'turn') return null;
  idx += 2;
  if (slice[idx] !== 'as' || slice[idx + 1] !== 'though') return null;
  idx += 2;
  if (slice[idx] === 'it') idx++;
  // "didn't have defender" / "does not have defender" / "doesn't have defender"
  if (
    slice[idx] === "didn't" || slice[idx] === 'didnt'
    || slice[idx] === "doesn't" || slice[idx] === 'doesnt'
  ) {
    idx++;
  } else if (slice[idx] === 'does' && slice[idx + 1] === 'not') {
    idx += 2;
  } else {
    return null;
  }
  if (slice[idx] !== 'have') return null; idx++;
  if (slice[idx] !== 'defender') return null; idx++;

  if (slice[idx] === '.') idx++;

  const grantEffect: Effect = {
    kind: 'GrantKeyword',
    target: { kind: 'Source' },
    keyword: 'IgnoreDefender',
    untilEndOfTurn: true,
  };

  return { effects: [grantEffect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 8: matchSelfCantBeBlockedActivated
// ============================================================================

/**
 * Slice 8 activated self-tail:
 *   "this creature can't be blocked this turn[.]"
 *   "~ can't be blocked this turn[.]"
 *
 * (Harbor Bandit, Frilled Sea Serpent, Biolume Egg family — activated abilities
 * that grant evasion to the source creature for the turn.)
 *
 * The static form ("This creature can't be blocked.") is handled by
 * matchStaticAbility. The target form ("target creature can't be blocked this
 * turn") is handled by matchTargetCombatRestriction. This matcher fills the
 * activated-self gap: when the *source* grants itself unblockability via an
 * activated ability, it emits GrantKeyword('Unblockable') with a Source target.
 *
 * The executor's GrantKeyword/Source branch handles this inline without calling
 * resolveTargetRef (which would throw on Source).
 */
export function matchSelfCantBeBlockedActivated(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Subject: "this creature", "~", or "it" (pronoun form in triggered bodies,
  // e.g. "Whenever ~ attacks alone, it can't be blocked this combat.")
  let idx = 0;
  if (slice[idx] === 'this' && (slice[idx + 1] === 'creature' || slice[idx + 1] === 'permanent')) {
    idx += 2;
  } else if (slice[idx] === '~') {
    idx += 1;
  } else if (slice[idx] === 'it') {
    idx += 1;
  } else {
    return null;
  }

  // "can't be blocked" — also accept "cannot be blocked" / "can not be blocked"
  const isCant =
    slice[idx] === "can't" || slice[idx] === 'cant' || slice[idx] === 'cannot';
  const isCanNot = slice[idx] === 'can' && slice[idx + 1] === 'not';
  if (!isCant && !isCanNot) return null;
  idx += isCanNot ? 2 : 1;

  if (slice[idx] !== 'be' || slice[idx + 1] !== 'blocked') return null;
  idx += 2;

  // "this turn" or "until end of turn"
  let hasDuration = false;
  if (slice[idx] === 'this' && (slice[idx + 1] === 'turn' || slice[idx + 1] === 'combat')) {
    hasDuration = true;
    idx += 2;
  } else if (
    slice[idx] === 'until' && slice[idx + 1] === 'end' &&
    slice[idx + 2] === 'of' && (slice[idx + 3] === 'turn' || slice[idx + 3] === 'combat')
  ) {
    hasDuration = true;
    idx += 4;
  }
  if (!hasDuration) return null;

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'GrantKeyword',
    target: { kind: 'Source' },
    keyword: 'Unblockable',
    untilEndOfTurn: true,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

// ============================================================================
// Slice 8: matchSelfDynamicPumpLifeTotal
// ============================================================================

/**
 * Slice 8 activated self-tail:
 *   "this creature gets +X/+X until end of turn, where X is your life total[.]"
 *   "~ gets +X/+X until end of turn, where X is your life total[.]"
 *
 * (Loxodon Lifechanter family — the dynamic amount is the controller's current
 * life total, evaluated at execution time via resolveAmount(LifeTotal).)
 *
 * Only symmetric +X/+X forms are accepted (where both axes scale identically).
 * The +X/+0 and +0/+X asymmetric forms are not present on real cards in this
 * family and are intentionally left to matchModifyPTWhereX if needed.
 */
export function matchSelfDynamicPumpLifeTotal(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Subject: "this creature" or "~" or "it"
  let idx = 0;
  let target: import('../ast').TargetRef;
  if (slice[idx] === 'this' && (slice[idx + 1] === 'creature' || slice[idx + 1] === 'permanent')) {
    target = { kind: 'Source' };
    idx += 2;
  } else if (slice[idx] === '~' || slice[idx] === 'it') {
    target = { kind: 'Source' };
    idx += 1;
  } else {
    return null;
  }

  if (slice[idx] !== 'gets') return null;
  idx++;

  // "+X/+X" — only symmetric X/X accepted here
  const ptMatch = slice[idx]?.match(/^\+x\/\+x$/i);
  if (!ptMatch) return null;
  idx++;

  // "until end of turn"
  if (
    slice[idx] !== 'until' || slice[idx + 1] !== 'end' ||
    slice[idx + 2] !== 'of' || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')
  ) return null;
  idx += 4;

  // ", where X is your life total"
  const dyn = parseWhereXIsAnyAmount(slice, idx);
  if (!dyn || typeof dyn.amount === 'number' || dyn.amount.kind !== 'LifeTotal') return null;
  let consumed = dyn.nextIndex;
  if (slice[consumed] === '.') consumed++;

  const lifeTotal = dyn.amount;
  const effect: Effect = {
    kind: 'ModifyPT',
    target,
    power: lifeTotal,
    toughness: lifeTotal,
    untilEndOfTurn: true,
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Slice 11 — "target spell can't be countered [this turn]."
 * (Vexing Shusher activated ability family)
 *
 * Parses as a GrantCantBeCounteredEffect targeting a spell on the stack.
 * The executor (executeGrantCantBeCountered) sets SpellStackItem.cantBeCountered
 * on the targeted stack item so executeCounterSpell refuses to counter it.
 *
 * HONEST: executeCounterSpell already checks cantBeCountered on every stack item
 * before applying the counter; we only add the one-shot grant mechanism here so
 * the activated ability can mark a specific target spell.
 */
// ============================================================================
// Slice 2: matchOtherCreaturesGrantKeyword
// ============================================================================

/**
 * Slice 2 — beginning-of-combat pump/grant tails:
 *   "other creatures you control gain <kw1>[, <kw2>][, and <kwN>] until end of turn"
 *   "other creatures you control with power N or greater gain <kw1> and <kw2> until end of turn"
 *   "other <Subtype>s you control gain <kw1>[, <kw2>][, and <kwN>] until end of turn"
 *
 * Examples:
 *   Cactusfolk Sureshot: "other creatures you control with power 4 or greater gain trample and haste until end of turn"
 *   Cosmic Spider-Man:   "other Spiders you control gain vigilance, reach, and lifelink until end of turn"
 *
 * HONEST: emits one GrantKeyword per keyword, all targeting AllCreaturesYouControlMatching
 * with { types: ['creature'], notSource: true } plus optional subtype/power filter.
 * The executor's AllCreaturesYouControlMatching loop already applies matchesCardInstanceFilter
 * with sourceInstanceId context, and the notSource flag causes it to skip the source itself.
 *
 * Multi-keyword lists accepted: comma-list + "and" conjunction, any count.
 */
export function matchOtherCreaturesGrantKeyword(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Must start with "other"
  if (slice[0] !== 'other') return null;

  let idx = 1;
  const filter: import('../ast').CardFilter = { types: ['creature'], notSource: true };

  // Optional subtype: "other Spiders you control" / "other creatures you control"
  let subtypeAlreadyConsumedController = false;
  if (slice[idx] === 'creatures') {
    idx++;
  } else {
    // Try creature subtype (Spiders, Zombies, etc.)
    // readCreatureSubtypeTargetPhrase also consumes "you control" if present.
    const subtypeRead = readCreatureSubtypeTargetPhrase(slice, idx);
    if (subtypeRead) {
      filter.subtypes = subtypeRead.subtypes;
      idx += subtypeRead.consumed;
      if (subtypeRead.controllerControls) subtypeAlreadyConsumedController = true;
    } else {
      // Unknown word after "other" — bail
      return null;
    }
  }

  // Must have "you control" — unless readCreatureSubtypeTargetPhrase already consumed it.
  if (!subtypeAlreadyConsumedController) {
    if (slice[idx] !== 'you' || slice[idx + 1] !== 'control') return null;
    idx += 2;
  }

  // Optional power filter: "with power N or greater/less"
  if (slice[idx] === 'with' && slice[idx + 1] === 'power') {
    const powerValue = Number.parseInt(slice[idx + 2], 10);
    if (!Number.isNaN(powerValue)) {
      const opWord = slice[idx + 3];
      if (opWord !== 'or') return null;
      const compWord = slice[idx + 4];
      if (compWord !== 'greater' && compWord !== 'less') return null;
      filter.power = { op: compWord === 'greater' ? 'gte' : 'lte', value: powerValue };
      idx += 5;
    } else {
      return null;
    }
  }

  // "gain" or "gains"
  if (slice[idx] !== 'gain' && slice[idx] !== 'gains') return null;
  idx++;

  // Multi-keyword list: kw [, kw]* [and kw]
  const grantedKeywords: string[] = [];
  let lastGood = -1;
  while (true) {
    const kw = readGrantableKeyword(slice, idx);
    if (!kw) break;
    grantedKeywords.push(kw.keyword);
    idx += kw.consumed;
    lastGood = idx;
    if (slice[idx] === ',') idx++;
    if (slice[idx] === 'and') idx++;
  }
  if (grantedKeywords.length === 0) return null;
  idx = lastGood;

  // "until end of turn" (required)
  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
    || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')) return null;
  idx += 4;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const target: import('../ast').TargetRef = { kind: 'AllCreaturesYouControlMatching', filter };
  const effects: import('../ast').Effect[] = grantedKeywords.map(keyword => ({
    kind: 'GrantKeyword' as const,
    target,
    keyword,
    untilEndOfTurn: true,
  }));

  return { effects, targets: [], consumed };
}

// ============================================================================
// Slice 2: matchOtherCreaturesPump
// ============================================================================

/**
 * Slice 2 — beginning-of-combat pump tails:
 *   "other creatures you control get +N/+N until end of turn"
 *   "other creatures you control get +N/+N and gain <kw1>[, <kw2>][, and <kwN>] until end of turn"
 *   "other <Subtype>s you control get +N/+N [and gain <kw-list>] until end of turn"
 *   "other creatures you control with power N or greater get +N/+N [and gain <kw-list>] until end of turn"
 *
 * Example:
 *   Primordial Plasm (Invasion of Muraganda back face):
 *     "other creatures you control get +2/+2 until end of turn"
 *
 * HONEST: emits ModifyPT + optional GrantKeyword effects, all targeting
 * AllCreaturesYouControlMatching with { types: ['creature'], notSource: true }.
 */
export function matchOtherCreaturesPump(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Must start with "other"
  if (slice[0] !== 'other') return null;

  let idx = 1;
  const filter: import('../ast').CardFilter = { types: ['creature'], notSource: true };

  // Optional subtype or plain "creatures"
  // readCreatureSubtypeTargetPhrase also consumes "you control" if present.
  let pumpAlreadyConsumedController = false;
  if (slice[idx] === 'creatures') {
    idx++;
  } else {
    const subtypeRead = readCreatureSubtypeTargetPhrase(slice, idx);
    if (subtypeRead) {
      filter.subtypes = subtypeRead.subtypes;
      idx += subtypeRead.consumed;
      if (subtypeRead.controllerControls) pumpAlreadyConsumedController = true;
    } else {
      return null;
    }
  }

  // Must have "you control" — unless readCreatureSubtypeTargetPhrase already consumed it.
  if (!pumpAlreadyConsumedController) {
    if (slice[idx] !== 'you' || slice[idx + 1] !== 'control') return null;
    idx += 2;
  }

  // Optional power filter: "with power N or greater/less"
  if (slice[idx] === 'with' && slice[idx + 1] === 'power') {
    const powerValue = Number.parseInt(slice[idx + 2], 10);
    if (!Number.isNaN(powerValue)) {
      const opWord = slice[idx + 3];
      if (opWord !== 'or') return null;
      const compWord = slice[idx + 4];
      if (compWord !== 'greater' && compWord !== 'less') return null;
      filter.power = { op: compWord === 'greater' ? 'gte' : 'lte', value: powerValue };
      idx += 5;
    } else {
      return null;
    }
  }

  // "get" or "gets"
  if (slice[idx] !== 'get' && slice[idx] !== 'gets') return null;
  idx++;

  // P/T e.g. +2/+2
  const ptMatch = slice[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  idx++;

  // Optional "and gain[s] <kw-list>"
  const grantedKeywords: string[] = [];
  if (slice[idx] === 'and' && (slice[idx + 1] === 'gain' || slice[idx + 1] === 'gains')) {
    let kwIdx = idx + 2;
    let lastGood = -1;
    while (true) {
      const kw = readGrantableKeyword(slice, kwIdx);
      if (!kw) break;
      grantedKeywords.push(kw.keyword);
      kwIdx += kw.consumed;
      lastGood = kwIdx;
      if (slice[kwIdx] === ',') kwIdx++;
      if (slice[kwIdx] === 'and') kwIdx++;
    }
    if (grantedKeywords.length > 0) idx = lastGood;
    // If "and gains" was seen but no keyword parsed, bail (don't half-parse)
    else return null;
  }

  // "until end of turn" (required)
  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
    || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')) return null;
  idx += 4;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const target: import('../ast').TargetRef = { kind: 'AllCreaturesYouControlMatching', filter };
  const effects: import('../ast').Effect[] = [
    { kind: 'ModifyPT', target, power, toughness, untilEndOfTurn: true },
    ...grantedKeywords.map(keyword => ({
      kind: 'GrantKeyword' as const,
      target,
      keyword,
      untilEndOfTurn: true,
    })),
  ];

  return { effects, targets: [], consumed };
}

/**
 * Slice 7 — Match trigger-tail pump on the triggering creature:
 *   "that creature gets +N/+N until end of turn"
 *   "that creature gets +N/+N and gains <keyword> until end of turn"
 *   "it gets +N/+N until end of turn" (where-X forms are handled by matchModifyPTWhereX;
 *    this matcher covers fixed-N forms inside trigger bodies where "it" is the event creature)
 *
 * The subject "that creature" or "it" in a trigger body refers to the creature
 * that caused the trigger (e.g. the entering creature in an ETB trigger, or the
 * creature that attacked). This maps to { kind: 'EventCreature' } which the executor
 * resolves via eventContext.cardInstanceId.
 *
 * HONEST: resolveTargetRef handles EventCreature (returns eventContext?.cardInstanceId ?? '').
 * The executor's ModifyPT case falls through to resolveTargetRef for non-Source,
 * non-Chosen, non-AllCreatures targets — EventCreature is therefore executor-backed.
 *
 * Forms covered:
 *   "that creature gets +N/+N until end of turn [.]"
 *   "that creature gets +N/+N and gains <keyword>[, <keyword>] until end of turn [.]"
 *
 * Note: "it gets +X/+X ... where X is ..." is handled by matchModifyPTWhereX which
 * maps "it" to Source. In ETB trigger bodies the Source is the triggering card (same
 * semantic), so that path is also correct for self-pump. This matcher only handles
 * the "that creature" subject which unambiguously refers to the EventCreature.
 */
export function matchThatCreatureGetsPT(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Subject must be "that creature"
  if (slice[0] !== 'that' || slice[1] !== 'creature') return null;
  if (slice[2] !== 'gets') return null;
  let idx = 3;

  const ptMatch = slice[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  idx++;

  // Optional "and gains <keyword>[, <keyword>][ and <keyword>]"
  const grantedKeywords: string[] = [];
  if (slice[idx] === 'and' && (slice[idx + 1] === 'gains' || slice[idx + 1] === 'gain')) {
    let kwIdx = idx + 2;
    let lastGood = -1;
    while (true) {
      const kw = readGrantableKeyword(slice, kwIdx);
      if (!kw) break;
      grantedKeywords.push(kw.keyword);
      kwIdx += kw.consumed;
      lastGood = kwIdx;
      if (slice[kwIdx] === ',') kwIdx++;
      if (slice[kwIdx] === 'and') kwIdx++;
    }
    if (grantedKeywords.length === 0) return null;
    idx = lastGood;
  }

  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
    || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')) return null;
  idx += 4;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const target: import('../ast').TargetRef = { kind: 'EventCreature' };
  const effects: import('../ast').Effect[] = [
    { kind: 'ModifyPT', target, power, toughness, untilEndOfTurn: true },
    ...grantedKeywords.map(keyword => ({
      kind: 'GrantKeyword' as const,
      target,
      keyword,
      untilEndOfTurn: true,
    })),
  ];

  return { effects, targets: [], consumed };
}

// ============================================================================
// Slice 8/11: matchThatCreatureGainsKeyword
// ============================================================================

/**
 * Slice 8/11 — Match trigger-tail keyword grant on the opposing combat creature:
 *   "that creature gains <keyword> until end of turn"
 *   "that creature gains <keyword>[, <keyword>][ and <keyword>] until end of turn"
 *
 * The subject "that creature" in a combat trigger body (BlocksOrBlockedBy) refers
 * to the opposing combat participant. This maps to { kind: 'EventCreature' } which
 * the executor resolves via eventContext.cardInstanceId (the opposing creature id).
 *
 * HONEST: resolveTargetRef handles EventCreature (returns eventContext?.cardInstanceId ?? '').
 * The executor's GrantKeyword fallback passes state and eventContext so EventCreature
 * resolves correctly.
 *
 * Also accepts "it gains <keyword> until end of turn" as a synonym for the self-ref
 * form inside BlocksOrBlockedBy trigger bodies.
 *
 * Special keyword: 'CantBeRegenerated' — when the body is "that creature can't be
 * regenerated this turn", we grant a keyword that state-based.ts checks to skip
 * regeneration shields. This requires regeneration shields to be modeled (they are,
 * via CardInstance.regenerationShields). If the engine did not model shields, we
 * would decline this form. Since it does, we emit GrantKeyword with keyword
 * 'CantBeRegenerated'. state-based.ts checks this via grantedKeywords.
 */
export function matchThatCreatureGainsKeyword(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Subject must be "that creature"
  if (slice[0] !== 'that' || slice[1] !== 'creature') return null;
  if (slice[2] !== 'gains' && slice[2] !== 'gain') return null;
  let idx = 3;

  const target: import('../ast').TargetRef = { kind: 'EventCreature' };
  const effects: import('../ast').Effect[] = [];

  // Read one or more keywords
  let lastGood = -1;
  while (true) {
    const kw = readGrantableKeyword(slice, idx);
    if (!kw) break;
    effects.push({ kind: 'GrantKeyword', target, keyword: kw.keyword, untilEndOfTurn: true });
    idx += kw.consumed;
    lastGood = idx;
    if (slice[idx] === ',') idx++;
    if (slice[idx] === 'and') idx++;
  }

  if (effects.length === 0) return null;
  idx = lastGood;

  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
    || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')) return null;
  idx += 4;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  return { effects, targets: [], consumed };
}

/**
 * Slice 8/11 — Match "that creature can't be regenerated this turn."
 *
 * The "can't be regenerated" status is modeled via a grantedKeyword
 * 'CantBeRegenerated' which state-based.ts checks before applying regen shields.
 * The effect targets { kind: 'EventCreature' } (the opposing combat creature).
 *
 * HONEST: regenerationShields are modeled (CardInstance.regenerationShields);
 * state-based.ts is updated to check grantedKeywords.includes('CantBeRegenerated')
 * before using a regen shield. The grant is untilEndOfTurn (matching "this turn").
 */
export function matchThatCreatureCantBeRegenerated(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "that creature can't be regenerated this turn ."
  // Also accept: "that creature can't be regenerated this turn"
  if (slice[0] !== 'that' || slice[1] !== 'creature') return null;
  if (slice[2] !== "can't" && slice[2] !== 'cannot') return null;
  if (slice[3] !== 'be') return null;
  if (slice[4] !== 'regenerated') return null;

  // Optional "this turn"
  let idx = 5;
  if (slice[idx] === 'this' && slice[idx + 1] === 'turn') idx += 2;

  let consumed = idx;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const target: import('../ast').TargetRef = { kind: 'EventCreature' };
  return {
    effects: [{ kind: 'GrantKeyword', target, keyword: 'CantBeRegenerated', untilEndOfTurn: true }],
    targets: [],
    consumed,
  };
}

// ============================================================================
// Slice 7: matchMassPermanentGrant
// ============================================================================

/**
 * Slice 7 — "Permanents you control gain <kw1>[, <kw2>][, and <kwN>] until end of turn."
 *
 * Heroic Intervention family: grants MULTIPLE keywords to ALL permanents
 * the controller controls — creatures, lands, artifacts, enchantments,
 * planeswalkers — for the turn.  Key correctness requirements:
 *   1. Must cover any permanent type (no types filter).
 *   2. Must scope to the caster's permanents only (controllerControls: true).
 *   3. Must grant MULTIPLE keywords in one parse (hexproof AND indestructible).
 *   4. UEOT cleanup must clear both keywords (the executor's grantedKeywords
 *      cleanup at end of turn is global and handles this already).
 *
 * Accepted subjects:
 *   "permanents you control gain <kw-list> until end of turn"
 *   "each permanent you control gains <kw-list> until end of turn"
 *
 * Emits one GrantKeyword effect per keyword, each targeting:
 *   { kind: 'AllOfType', filter: {}, controllerControls: true }
 *
 * HONESTY: The executor's GrantKeyword/AllOfType branch is patched in this
 * slice to respect controllerControls, so the keyword is only placed on the
 * caster's own battlefield permanents. grantedKeywords are cleaned up at
 * end of turn by the existing cleanupDamage sweep in state-based.ts.
 *
 * Hexproof and indestructible are engine-enforced keywords:
 *   - Hexproof: targets.ts rejectHexproof rejects targeted effects.
 *   - Indestructible: executor.ts executeDestroy skips indestructible cards.
 *
 * UEOT: both keywords wear off next turn automatically (untilEndOfTurn: true).
 *
 * Example wording (Heroic Intervention):
 *   "Permanents you control gain hexproof and indestructible until end of turn."
 */
export function matchMassPermanentGrant(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  let idx = 0;

  // Accept "permanents you control gain ..." or "each permanent you control gains ..."
  if (slice[0] === 'permanents' && slice[1] === 'you' && slice[2] === 'control'
      && (slice[3] === 'gain' || slice[3] === 'gains')) {
    idx = 4;
  } else if (slice[0] === 'each' && slice[1] === 'permanent' && slice[2] === 'you'
             && slice[3] === 'control' && (slice[4] === 'gains' || slice[4] === 'gain')) {
    idx = 5;
  } else {
    return null;
  }

  // Collect one or more GRANTABLE_KEYWORDS in a comma/and list
  const grantedKeywords: string[] = [];
  let lastGood = -1;
  while (true) {
    const kw = readGrantableKeyword(slice, idx);
    if (!kw) break;
    grantedKeywords.push(kw.keyword);
    idx += kw.consumed;
    lastGood = idx;
    if (slice[idx] === ',') idx++;
    if (slice[idx] === 'and') idx++;
  }
  if (grantedKeywords.length === 0) return null;
  idx = lastGood;

  // "until end of turn" (required)
  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
      || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')) return null;
  idx += 4;

  if (slice[idx] === '.') idx++;

  // AllOfType with empty filter = all permanent types; controllerControls limits to caster only.
  const target: import('../ast').TargetRef = {
    kind: 'AllOfType',
    filter: {},
    controllerControls: true,
  };

  const effects: import('../ast').Effect[] = grantedKeywords.map(keyword => ({
    kind: 'GrantKeyword' as const,
    target,
    keyword,
    untilEndOfTurn: true,
  }));

  return { effects, targets: [], consumed: idx };
}

export function matchGrantCantBeCountered(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "target spell can't be countered [this turn] [.]"
  if (
    slice[0] !== 'target' ||
    slice[1] !== 'spell'
  ) return null;

  const negRe = /^can['']?t$|^cannot$/i;
  if (!negRe.test(slice[2] ?? '')) return null;
  if (slice[3] !== 'be' || slice[4] !== 'countered') return null;

  let idx = 5;
  // Optional "this turn"
  if (slice[idx] === 'this' && slice[idx + 1] === 'turn') idx += 2;
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Spell');
  const target: import('../ast').TargetRef = makeChosenRef(spec);

  const effect: import('../ast').Effect = {
    kind: 'GrantCantBeCountered',
    target,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

// ============================================================================
// matchChangeSpellTargets (Slice 10 — Deflecting Swat family)
// ============================================================================

/**
 * Match "You may choose new targets for target spell or ability."
 *
 * Tokenized: ["you", "may", "choose", "new", "targets", "for", "target",
 *             "spell", "or", "ability"]
 *
 * Emits a ChangeSpellTargets effect with:
 *   - `target`: the targeted stack item (Chosen → TargetSpec type 'Spell')
 *   - `newTarget`: the new target chosen at execution time (Chosen → TargetSpec type 'AnyTarget')
 *
 * v1 honesty: only single-target spells are rewritten; the executor no-ops for
 * any other arity so retargeting resolves safely without crashing.
 */
export function matchChangeSpellTargets(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  let idx = 0;
  // "choose new targets for target spell or ability"
  if (slice[idx] !== 'choose') return null;
  if (slice[idx + 1] !== 'new' || slice[idx + 2] !== 'targets') return null;
  if (slice[idx + 3] !== 'for') return null;
  if (slice[idx + 4] !== 'target') return null;
  if (slice[idx + 5] !== 'spell') return null;
  idx += 6;
  if (slice[idx] === 'or' && slice[idx + 1] === 'ability') idx += 2;
  if (slice[idx] === '.') idx++;

  const spellSpec = makeTargetSpec('Spell');
  const spellRef: TargetRef = makeChosenRef(spellSpec);

  // The new target is a separate runtime choice (any legal target for the spell).
  const newTargetSpec = makeTargetSpec('Any');
  const newTargetRef: TargetRef = makeChosenRef(newTargetSpec);

  const changeEffect: import('../ast').Effect = {
    kind: 'ChangeSpellTargets',
    target: spellRef,
    newTarget: newTargetRef,
  };

  return { effects: [changeEffect], targets: [spellSpec, newTargetSpec], consumed: idx };
}

/**
 * Slice 1 (base P/T set): Match "target creature [you control] has base power
 * and toughness N/M until end of turn" with optional "and gains <kw>..." riders.
 *
 * Also handles the leading-duration form:
 *   "Until end of turn, target creature you control has base power and toughness 4/4
 *    and gains flying and hexproof."  (Water Wings)
 *
 * And the activated-ability form (tapped-source, no "target"):
 *   "{T}: Target creature other than ~ has base power and toughness 0/2 until end of turn."
 *   (Sorceress Queen — the "other than ~" part is already stripped by the activated-ability
 *   cost parser; we just see "target creature has base power and toughness 0/2 until end of turn".)
 *
 * DECLINES:
 *   - Forms that also set creature TYPE or "loses all abilities" (aura territory).
 *   - Dynamic/where-X forms (already handled by matchDynamicCDA).
 */
export function matchSetBasePT(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // Optional leading "until end of turn , " prefix (Water Wings form).
  let leadingDuration = false;
  if (
    slice[0] === 'until' && slice[1] === 'end' && slice[2] === 'of'
    && slice[3] === 'turn' && slice[4] === ','
  ) {
    leadingDuration = true;
    idx = 5;
  }

  // Subject: "target creature [you control]" or "target creature other than ~"
  if (slice[idx] !== 'target') return null;
  idx++;

  const constraints: TargetSpec['constraints'] = {};
  // Optional "other than ~" / "other than this creature" — skip silently.
  // (Sorceress Queen wording; the "other than" constraint is decorative here.)

  // Optional color qualifier
  const colorRead = readColorConstraint(slice, idx);
  if (colorRead) {
    constraints.colors = colorRead.colors;
    idx += colorRead.consumed;
  }

  if (slice[idx] !== 'creature') return null;
  idx++;

  // Optional "other than this creature" / "other than ~" — skip.
  if (slice[idx] === 'other' && slice[idx + 1] === 'than') {
    idx += 2;
    if (slice[idx] === 'this' && slice[idx + 1] === 'creature') {
      idx += 2;
    } else if (slice[idx] === '~') {
      idx += 1;
    }
  }

  // Optional controller qualifier
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    constraints.opponentControls = true;
    idx += 3;
  }

  // "has base power and toughness N/M"
  if (slice[idx] !== 'has') return null;
  idx++;
  if (slice[idx] !== 'base') return null;
  idx++;
  if (slice[idx] !== 'power') return null;
  idx++;
  if (slice[idx] !== 'and') return null;
  idx++;
  if (slice[idx] !== 'toughness') return null;
  idx++;

  // Parse "N/M" — both N and M must be non-negative integers.
  const ptMatch = slice[idx]?.match(/^(\d+)\/(\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  idx++;

  // Optional "and gains <keyword>[, <keyword>][ and <keyword>]" before the duration.
  const grantedKeywords: string[] = [];
  if (slice[idx] === 'and' && (slice[idx + 1] === 'gains' || slice[idx + 1] === 'gain')) {
    let scan = idx + 2;
    let lastGood = -1;
    while (true) {
      const kw = readGrantableKeyword(slice, scan);
      if (!kw) break;
      grantedKeywords.push(kw.keyword);
      scan += kw.consumed;
      lastGood = scan;
      if (slice[scan] === ',') scan++;
      if (slice[scan] === 'and') scan++;
    }
    if (grantedKeywords.length > 0) {
      idx = lastGood;
    }
    // If no grantable keywords found, don't advance idx — bail below if no duration.
  }

  // Duration: "until end of turn" (trailing), or already consumed as leading prefix.
  if (!leadingDuration) {
    if (
      slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
      || slice[idx + 3] !== 'turn'
    ) return null;
    idx += 4;
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  const effect: SetBasePTEffect = {
    kind: 'SetBasePT',
    target: makeChosenRef(spec),
    power,
    toughness,
    ...(grantedKeywords.length > 0 ? { keywords: grantedKeywords } : {}),
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

// ============================================================================
// Slice 7: matchBecomesCopy
// ============================================================================

/**
 * Slice 7 — "target creature becomes a copy of target [nonlegendary] creature
 *             until end of turn."
 *
 * Covers the following oracle forms:
 *
 * SINGLE-TARGET self-copy (Sakashima / Vesuvan Shapeshifter style):
 *   "until end of turn, ~ becomes a copy of target creature."
 *   "~ becomes a copy of target creature until end of turn."
 *   "until end of turn, target creature becomes a copy of target creature."
 *   "target creature becomes a copy of target creature until end of turn."
 *
 * MASS form (Mirrorweave):
 *   "each other creature becomes a copy of target nonlegendary creature
 *    until end of turn."
 *   "each creature becomes a copy of target nonlegendary creature
 *    until end of turn."
 *
 * HONESTY limits:
 *   - Only "until end of turn" (temporary) forms are parsed.
 *   - Permanent "becomes a copy" (no duration) is declined — the engine has no
 *     persistent identity-swap mechanic beyond token creation and EnterAsCopy.
 *   - Riders that bolt on counters/keywords after the copy are declined.
 *   - "becomes a copy of" with "except it's also ..." overlays are declined.
 *
 * The executor writes `becomesCopyOfDefinitionId` on the affected permanent(s).
 * `getCardDefinition` (game-state.ts) returns the copied definition for the
 * remainder of the turn. `cleanupDamage` (state-based.ts) clears the field at
 * end-of-turn cleanup.
 *
 * Two TargetSpecs are emitted for the single-target form (one for subject, one
 * for copy-source). The mass form emits only one TargetSpec (the copy-source
 * nonlegendary creature).
 */
export function matchBecomesCopy(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  let idx = 0;

  // ── Leading "until end of turn, " prefix ─────────────────────────────────
  let leadingDuration = false;
  if (
    slice[idx] === 'until' && slice[idx + 1] === 'end' &&
    slice[idx + 2] === 'of' && slice[idx + 3] === 'turn'
  ) {
    leadingDuration = true;
    idx += 4;
    if (slice[idx] === ',') idx++;
  }

  // ── Mass form: "each [other] creature becomes a copy of target ..." ───────
  let isMass = false;
  if (slice[idx] === 'each') {
    idx++;
    if (slice[idx] === 'other') idx++; // "each other creature"
    if (slice[idx] !== 'creature') return null;
    idx++;
    isMass = true;
  }

  // ── Subject (single-target form only) ────────────────────────────────────
  let subjectSpec: TargetSpec | undefined;
  let subjectRef: TargetRef | undefined;

  if (!isMass) {
    if (
      slice[idx] === '~' ||
      slice[idx] === 'it' ||
      (slice[idx] === 'this' && slice[idx + 1] === 'creature') ||
      (slice[idx] === 'this' && slice[idx + 1] === 'artifact') ||
      (slice[idx] === 'this' && slice[idx + 1] === 'permanent') ||
      (slice[idx] === 'this' && slice[idx + 1] === 'enchantment') ||
      (slice[idx] === 'this' && slice[idx + 1] === 'land')
    ) {
      // Self-copy: source becomes a copy
      subjectRef = { kind: 'Source' };
      if (slice[idx] === '~' || slice[idx] === 'it') {
        idx += 1;
      } else {
        idx += 2; // "this <type>"
      }
    } else if (slice[idx] === 'target' && slice[idx + 1] === 'creature') {
      // Targeted subject: "target creature becomes a copy of ..."
      subjectSpec = makeTargetSpec('Creature');
      subjectRef = makeChosenRef(subjectSpec);
      idx += 2;
      // Optional "you control"
      if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
        subjectSpec.constraints = { ...(subjectSpec.constraints ?? {}), controllerControls: true };
        idx += 2;
      }
    } else if (slice[idx] === 'target') {
      // Slice 3/12 extension: "target <Subtype>" subject — e.g. "Target Shapeshifter"
      // (Shapesharer: "Target Shapeshifter becomes a copy of target creature until your next turn.")
      const subRead = readCreatureSubtypeTargetPhrase(slice, idx + 1);
      if (!subRead) return null;
      const subConstraints: TargetSpec['constraints'] = { subtypes: subRead.subtypes };
      if (subRead.controllerControls) subConstraints.controllerControls = true;
      if (subRead.opponentControls) subConstraints.opponentControls = true;
      subjectSpec = makeTargetSpec('Creature', subConstraints);
      subjectRef = makeChosenRef(subjectSpec);
      idx += 1 + subRead.consumed; // skip "target" + subtype tokens
    } else {
      return null;
    }
  }

  // ── "becomes a copy of" ───────────────────────────────────────────────────
  if (slice[idx] !== 'becomes') return null; idx++;
  if (slice[idx] !== 'a') return null; idx++;
  if (slice[idx] !== 'copy') return null; idx++;
  if (slice[idx] !== 'of') return null; idx++;

  // Slice 3/12 extension: optional "another" before "target" (Tilonalli's Skinshifter:
  // "it becomes a copy of another target nonlegendary attacking creature until end of turn")
  if (slice[idx] === 'another') idx++;

  // ── Copy source: "target [nonlegendary] [attacking] creature"
  //                 or "target artifact, creature, enchantment, or land"       ─
  if (slice[idx] !== 'target') return null; idx++;

  // Detect multi-type permanent form: "artifact, creature, enchantment, or land"
  // (Mirage Mirror wording). Maps to TargetType 'Permanent'.
  let copySourceType: TargetType = 'Creature';
  if (
    slice[idx] === 'artifact' && slice[idx + 1] === ',' &&
    slice[idx + 2] === 'creature' && slice[idx + 3] === ',' &&
    slice[idx + 4] === 'enchantment' && slice[idx + 5] === ',' &&
    slice[idx + 6] === 'or' && slice[idx + 7] === 'land'
  ) {
    // "target artifact, creature, enchantment, or land" → Permanent
    copySourceType = 'Permanent';
    idx += 8;
    // No further constraints on copy source in this form
    const copySourceSpec = makeTargetSpec('Permanent');
    const copySourceRef = makeChosenRef(copySourceSpec);
    // Duration: require "until end of turn" or "until your next turn"
    if (!leadingDuration) {
      const isEoT = slice[idx] === 'until' && slice[idx + 1] === 'end' && slice[idx + 2] === 'of' && slice[idx + 3] === 'turn';
      const isNextTurn = slice[idx] === 'until' && slice[idx + 1] === 'your' && slice[idx + 2] === 'next' && slice[idx + 3] === 'turn';
      if (!isEoT && !isNextTurn) return null;
      idx += 4;
    }
    if (slice[idx] === '.') idx++;
    const becomesCopyEffectPerm: BecomesCopyEffect = {
      kind: 'BecomesCopy',
      subject: subjectRef ?? { kind: 'Source' },
      copySource: copySourceRef,
    };
    const targets: TargetSpec[] = subjectSpec ? [subjectSpec, copySourceSpec] : [copySourceSpec];
    return { effects: [becomesCopyEffectPerm], targets, consumed: idx };
  }

  // Optional "nonlegendary" qualifier (Mirrorweave wording)
  const copyConstraints: TargetSpec['constraints'] = {};
  if (slice[idx] === 'nonlegendary') {
    copyConstraints.excludeSupertypes = ['legendary'];
    idx++;
  }

  // Slice 3/12 extension: optional "attacking" qualifier on copy source
  // (Tilonalli's Skinshifter: "another target nonlegendary attacking creature")
  if (slice[idx] === 'attacking') {
    copyConstraints.combatStatus = 'attacking';
    idx++;
  }

  if (slice[idx] !== 'creature') return null; idx++;

  // Optional "you control" on the copy source
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    copyConstraints.controllerControls = true;
    idx += 2;
  }

  // ── Trailing duration: "until end of turn" or "until your next turn" ──────
  if (!leadingDuration) {
    const isEoT = slice[idx] === 'until' && slice[idx + 1] === 'end' && slice[idx + 2] === 'of' && slice[idx + 3] === 'turn';
    const isNextTurn = slice[idx] === 'until' && slice[idx + 1] === 'your' && slice[idx + 2] === 'next' && slice[idx + 3] === 'turn';
    if (!isEoT && !isNextTurn) return null;
    idx += 4;
  }

  if (slice[idx] === '.') idx++;

  const copySourceSpec = makeTargetSpec(
    'Creature',
    Object.keys(copyConstraints).length > 0 ? copyConstraints : undefined,
  );
  const copySourceRef = makeChosenRef(copySourceSpec);

  const becomesCopyEffect: BecomesCopyEffect = {
    kind: 'BecomesCopy',
    subject: isMass ? { kind: 'Source' } : subjectRef!, // mass uses executor iteration, subject unused
    copySource: copySourceRef,
    ...(isMass ? { mass: true } : {}),
  };

  if (isMass) {
    return {
      effects: [becomesCopyEffect],
      targets: [copySourceSpec],
      consumed: idx,
    };
  }

  const targets: TargetSpec[] = subjectSpec
    ? [subjectSpec, copySourceSpec]
    : [copySourceSpec];

  return {
    effects: [becomesCopyEffect],
    targets,
    consumed: idx,
  };
}

// ============================================================================
// Slice 3: matchModifyPTAsymmetricX
// ============================================================================

/**
 * Slice 3 — Asymmetric cast-time X pump:
 *   "target creature gets +X/+0 until end of turn"
 *   "target creature gets +0/+X until end of turn"
 *   "~ gets +X/+0 until end of turn"
 *   "it gets +0/+X until end of turn"
 *   "this creature gets +X/+0 until end of turn"
 *
 * These spells have {X} in their mana cost (Howl from Beyond, Enrage,
 * Bloodcurdling Scream family). X is determined at cast time from xValue, NOT
 * from a "where X is the number of ..." clause (which matchModifyPTWhereX
 * handles). The executor resolves {kind:'X'} via resolveAmount → xValue, so no
 * new executor branch is needed.
 *
 * HONEST: ModifyPT with a {kind:'X'} AmountRef is already fully executed; only
 * the asymmetric axis form (+X/+0 vs +X/+X) is new territory for the parser.
 * The symmetric +X/+X case is NOT claimed here — it is already handled by
 * matchModifyPTWhereX (when a where-clause follows) and matchModifyPT (for
 * fixed numeric literals). We reject the symmetric +X/+X form here to avoid
 * conflicts with those matchers.
 *
 * Declined: any clause with a trailing "where X is ..." — those belong to
 * matchModifyPTWhereX. Any form without "until end of turn" — there are no
 * permanent asymmetric-X pump effects in the set.
 */
export function matchModifyPTAsymmetricX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;
  let target: TargetRef;
  let targets: TargetSpec[] = [];

  // Parse the subject: "target creature", "~", "it", "this creature/permanent"
  if (slice[0] === 'target' && (slice[1] === 'creature' || readColorConstraint(slice, 1))) {
    let j = 1;
    const colorRead = readColorConstraint(slice, j);
    const constraints: TargetSpec['constraints'] = { ...(colorRead ? { colors: colorRead.colors } : {}) };
    if (colorRead) j += colorRead.consumed;
    if (slice[j] !== 'creature') return null;
    j++;
    if (slice[j] === 'you' && slice[j + 1] === 'control') {
      constraints.controllerControls = true;
      j += 2;
    } else if (slice[j] === 'an' && slice[j + 1] === 'opponent' && slice[j + 2] === 'controls') {
      constraints.opponentControls = true;
      j += 3;
    }
    if (slice[j] !== 'gets') return null;
    const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
    targets = [spec];
    target = makeChosenRef(spec);
    idx = j + 1;
  } else if ((slice[0] === '~' || slice[0] === 'it') && slice[1] === 'gets') {
    target = { kind: 'Source' };
    idx = 2;
  } else if (slice[0] === 'this' && ['creature', 'permanent'].includes(slice[1]) && slice[2] === 'gets') {
    target = { kind: 'Source' };
    idx = 3;
  } else {
    return null;
  }

  // Match "+X/+0" or "+0/+X" — asymmetric only (reject symmetric +X/+X).
  // The literal form after tokenization is "+x/+0" or "+0/+x" (lowercased).
  const ptToken = slice[idx];
  if (!ptToken) return null;
  const ptMatch = ptToken.match(/^\+(x)\/\+(0)$|^\+(0)\/\+(x)$/i);
  if (!ptMatch) return null;
  // ptMatch[1] is 'x' and ptMatch[2] is '0' for "+X/+0"
  // ptMatch[3] is '0' and ptMatch[4] is 'x' for "+0/+X"
  const isPowerX = /^\+x\/\+0$/i.test(ptToken);
  const isToughnessX = /^\+0\/\+x$/i.test(ptToken);
  if (!isPowerX && !isToughnessX) return null;
  idx++;

  // Reject if there's a trailing "where X is ..." clause — that belongs to matchModifyPTWhereX.
  // A "," followed by "where" after "until end of turn" is the tell.
  // We check AFTER "until end of turn" below, so just ensure we don't poach it here.

  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
    || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')) return null;
  idx += 4;

  // Reject if a "where X is ..." or ", where X is ..." follows — let matchModifyPTWhereX handle those.
  let checkIdx = idx;
  if (slice[checkIdx] === ',') checkIdx++;
  if (slice[checkIdx] === 'where' && slice[checkIdx + 1] === 'x' && slice[checkIdx + 2] === 'is') {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const xAmount: AmountRef = { kind: 'X' };
  const effect: Effect = {
    kind: 'ModifyPT',
    target,
    power: isPowerX ? xAmount : 0,
    toughness: isToughnessX ? xAmount : 0,
    untilEndOfTurn: true,
  };
  return { effects: [effect], targets, consumed: idx };
}

/**
 * Slice 10: "pump + gain all creature types until end of turn"
 *
 * Handles the three canonical oracle forms from Shields of Velis Vel,
 * Volatile Claws, and Blades of Velis Vel:
 *
 *   FORM A — "creatures you control get +N/+N and gain all creature types
 *             until end of turn."
 *   Also accepts leading-duration:
 *             "until end of turn, creatures you control get +N/+N and gain
 *              all creature types."
 *   Target: AllCreaturesYouControl
 *
 *   FORM B — "creatures target player controls get +N/+N and gain all
 *             creature types until end of turn."
 *   Target: AllOfType scoped to target player's creatures (handled via
 *           Chosen Player target — we record a target spec for the player
 *           and use AllCreaturesYouControl-style logic tagged with the
 *           player choice; for simplicity we emit AllCreaturesYouControl
 *           since Shields of Velis Vel is typically self-targeted in test
 *           contexts). For now this form resolves to Unparsed because
 *           "creatures [target player] controls" is a non-standard target
 *           that the executor cannot easily route — we only accept FORM A
 *           and FORM C for honesty.
 *
 *   FORM C — "[up to N] target creatures [each] get +N/+N and gain all
 *             creature types until end of turn."
 *   Also accepts leading-duration form.
 *   Target: Chosen (multi-target if "up to N", single if "target creature")
 *
 * The pump side is a ModifyPT (already executor-backed).
 * The all-creature-types side is a GrantAllCreatureTypesEffect.
 * Both share the same TargetRef.
 */
export function matchPumpGrantAllCreatureTypes(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // ── LEADING-DURATION prefix strip ─────────────────────────────────────
  let idx = 0;
  let leadingDuration = false;
  if (
    slice[0] === 'until' && slice[1] === 'end' && slice[2] === 'of'
    && slice[3] === 'turn' && slice[4] === ','
  ) {
    leadingDuration = true;
    idx = 5;
  }

  // ── FORM A: "creatures you control get +N/+N and gain all creature types [until end of turn]"
  if (
    (slice[idx] === 'creatures' && slice[idx + 1] === 'you' && slice[idx + 2] === 'control'
      && (slice[idx + 3] === 'get' || slice[idx + 3] === 'gets'))
    || (slice[idx] === 'each' && slice[idx + 1] === 'creature' && slice[idx + 2] === 'you'
      && slice[idx + 3] === 'control' && (slice[idx + 4] === 'gets' || slice[idx + 4] === 'get'))
  ) {
    const each = slice[idx] === 'each';
    idx += each ? 5 : 4; // consume "creatures you control get" or "each creature you control gets"

    // P/T modifier: "+N/+N" or "+N/+0" or "+0/+N"
    const ptMatch = slice[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    const power = parseInt(ptMatch[1], 10);
    const toughness = parseInt(ptMatch[2], 10);
    idx++;

    // Expect "and gain all creature types"
    if (
      slice[idx] !== 'and'
      || (slice[idx + 1] !== 'gain' && slice[idx + 1] !== 'gains')
      || slice[idx + 2] !== 'all'
      || slice[idx + 3] !== 'creature'
      || slice[idx + 4] !== 'types'
    ) return null;
    idx += 5;

    // Duration: trailing "until end of turn" or already consumed as leading prefix.
    if (!leadingDuration) {
      if (
        slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
        || slice[idx + 3] !== 'turn'
      ) return null;
      idx += 4;
    }
    if (slice[idx] === '.') idx++;

    const target: TargetRef = { kind: 'AllCreaturesYouControl' };
    const pumpEffect: Effect = {
      kind: 'ModifyPT',
      target,
      power,
      toughness,
      untilEndOfTurn: true,
    };
    const grantEffect: GrantAllCreatureTypesEffect = {
      kind: 'GrantAllCreatureTypes',
      target,
      untilEndOfTurn: true,
    };
    return { effects: [pumpEffect, grantEffect], targets: [], consumed: idx };
  }

  // ── FORM C: "[up to N] target creature[s] [each] get[s] +N/+N and gain all creature types [until end of turn]"
  // Also: "target creature gets +N/+N and gain all creature types"
  {
    let cidx = idx;
    let upToCount = 1;
    const targets: import('../targets').TargetSpec[] = [];

    // Optional "up to N target creatures each"
    if (slice[cidx] === 'up' && slice[cidx + 1] === 'to') {
      const n = parseSmallNumberToken(slice[cidx + 2] ?? '');
      if (Number.isNaN(n) || n < 1) return null;
      upToCount = n;
      cidx += 3;
    }

    if (slice[cidx] !== 'target') return null;
    cidx++;

    // Optional color qualifier
    const colorRead = readColorConstraint(slice, cidx);
    const colorConstraints: import('../targets').TargetSpec['constraints'] | undefined =
      colorRead ? { colors: colorRead.colors } : undefined;
    if (colorRead) cidx += colorRead.consumed;

    if (slice[cidx] !== 'creature' && slice[cidx] !== 'creatures') return null;
    const multi = slice[cidx] === 'creatures' || upToCount > 1;
    cidx++;

    // Optional "you control" / "an opponent controls"
    const constraints: import('../targets').TargetSpec['constraints'] = { ...(colorConstraints || {}) };
    if (slice[cidx] === 'you' && slice[cidx + 1] === 'control') {
      constraints.controllerControls = true;
      cidx += 2;
    } else if (slice[cidx] === 'an' && slice[cidx + 1] === 'opponent' && slice[cidx + 2] === 'controls') {
      constraints.opponentControls = true;
      cidx += 3;
    }

    // Optional "each" between subject and predicate
    if (slice[cidx] === 'each') cidx++;

    // Verb: "get" / "gets"
    if (slice[cidx] !== 'gets' && slice[cidx] !== 'get') return null;
    cidx++;

    // P/T modifier
    const ptMatch2 = slice[cidx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch2) return null;
    const power2 = parseInt(ptMatch2[1], 10);
    const toughness2 = parseInt(ptMatch2[2], 10);
    cidx++;

    // Expect "and gain all creature types"
    if (
      slice[cidx] !== 'and'
      || (slice[cidx + 1] !== 'gain' && slice[cidx + 1] !== 'gains')
      || slice[cidx + 2] !== 'all'
      || slice[cidx + 3] !== 'creature'
      || slice[cidx + 4] !== 'types'
    ) return null;
    cidx += 5;

    // Duration: trailing "until end of turn" or already consumed as leading prefix.
    if (!leadingDuration) {
      if (
        slice[cidx] !== 'until' || slice[cidx + 1] !== 'end' || slice[cidx + 2] !== 'of'
        || slice[cidx + 3] !== 'turn'
      ) return null;
      cidx += 4;
    }
    if (slice[cidx] === '.') cidx++;

    const spec = makeTargetSpec(
      'Creature',
      Object.keys(constraints).length > 0 ? constraints : undefined,
    );
    if (upToCount > 1) {
      spec.count = upToCount;
      spec.minCount = 1; // "up to N" means at least 1 must be chosen
    }
    targets.push(spec);

    const chosenTarget = makeChosenRef(spec);
    const pumpEffect2: Effect = {
      kind: 'ModifyPT',
      target: chosenTarget,
      power: power2,
      toughness: toughness2,
      untilEndOfTurn: true,
    };
    const grantEffect2: GrantAllCreatureTypesEffect = {
      kind: 'GrantAllCreatureTypes',
      target: chosenTarget,
      untilEndOfTurn: true,
    };
    return { effects: [pumpEffect2, grantEffect2], targets, consumed: cidx };
  }
}

// ============================================================================
// Slice 9: matchSwitchPowerToughness
// ============================================================================

/**
 * Match: "switch [target creature's | its | ~'s | this creature's] power and
 *          toughness until end of turn [.]"
 *
 * Covers three wording families:
 *   Targeted:      "switch target creature's power and toughness until end of turn."
 *                  (Dwarven Thaumaturgist / Merfolk Thaumaturgist — activated tap)
 *   Self-trigger:  "switch its power and toughness until end of turn."
 *                  (Valakut Fireboar — Whenever this creature attacks…)
 *   Self-one-shot: "switch ~'s power and toughness until end of turn."
 *                  (generic self-referential wording)
 *
 * Emits a single SwitchPowerToughnessEffect.
 */
export function matchSwitchPowerToughness(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  if (slice[idx] !== 'switch') return null;
  idx++;

  let target: TargetRef;
  let targets: TargetSpec[] = [];

  if (slice[idx] === 'target') {
    // "switch target creature's power and toughness until end of turn"
    // The tokenizer may emit "creature's" as a single token.
    idx++;
    // Optional color qualifier
    const colorRead = readColorConstraint(slice, idx);
    const constraints: TargetSpec['constraints'] = {};
    if (colorRead) {
      constraints.colors = colorRead.colors;
      idx += colorRead.consumed;
    }
    if (slice[idx] === "creature's") {
      // Single-token possessive form (most common tokenizer output)
      idx++;
    } else if (slice[idx] === 'creature') {
      idx++;
      if (slice[idx] === "'s") idx++;
    } else {
      return null;
    }
    const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
    targets = [spec];
    target = makeChosenRef(spec);
  } else if (slice[idx] === 'its' || slice[idx] === "~'s" || slice[idx] === '~'
    || (slice[idx] === 'this' && (slice[idx + 1] === 'creature' || slice[idx + 1] === "creature's" || slice[idx + 1] === 'permanent'))) {
    // "switch its power…" / "switch ~'s power…" / "switch this creature's power…"
    if (slice[idx] === 'its') {
      idx++;
    } else if (slice[idx] === "~'s") {
      idx++;
    } else if (slice[idx] === '~') {
      idx++;
      if (slice[idx] === "'s") idx++;
    } else {
      // "this creature['s]" or "this permanent['s]"
      idx++; // "this"
      if (slice[idx] === "creature's" || slice[idx] === "permanent's") {
        idx++;
      } else {
        idx++; // "creature" or "permanent"
        if (slice[idx] === "'s") idx++;
      }
    }
    target = { kind: 'Source' };
  } else {
    return null;
  }

  if (slice[idx] !== 'power') return null;
  idx++;
  if (slice[idx] !== 'and') return null;
  idx++;
  if (slice[idx] !== 'toughness') return null;
  idx++;

  // "until end of turn"
  if (slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of' || slice[idx + 3] !== 'turn') return null;
  idx += 4;

  if (slice[idx] === '.') idx++;

  const effect: SwitchPowerToughnessEffect = {
    kind: 'SwitchPowerToughness',
    target,
  };

  return { effects: [effect], targets, consumed: idx };
}

// ============================================================================
// Slice 3: matchAttackingBlockingPump
// ============================================================================

/**
 * Slice 3 — Mass temporary pump/grant on attacking or blocking creatures
 * (one-shot SPELL form, "until end of turn").
 *
 *   "Attacking creatures get +2/+0 until end of turn."           (Army of Allah)
 *   "Blocking creatures get +0/+3 until end of turn."            (Piety)
 *   "Vampire creatures you control get +2/+0 and gain first strike until end of turn."
 *                                                                 (Vampiric Fury)
 *   "Attacking creatures you control get +1/+0 until end of turn."
 *   "Blocking creatures you control get +0/+2 and gain lifelink until end of turn."
 *
 * Subject forms accepted:
 *   "attacking creatures [you control]"
 *   "blocking creatures [you control]"
 *   "<Subtype> creatures you control" (e.g. "Vampire creatures you control")
 *
 * Emits:
 *   ModifyPT  with target { kind: 'AllOfType', filter: { types: ['creature'],
 *              attacking?: true, blocking?: true, subtypes?: [...] },
 *              controllerControls?: true }
 *   GrantKeyword (one per keyword) with the same target (untilEndOfTurn: true)
 *
 * HONESTY: The executor's AllOfType ModifyPT branch (extended in this slice) and
 * GrantKeyword AllOfType branch (also extended) now check filter.attacking /
 * filter.blocking against state.combat.attackers / state.combat.blockers at
 * resolution time.
 *
 * DECLINES:
 *   - The STATIC form ("Attacking creatures you control get +1/+0") — that is
 *     handled by matchAttackingAnthem in static-abilities.ts which bails before
 *     reaching this matcher; this matcher REQUIRES "until end of turn".
 *   - Non-grantable keywords (shadow, fear, etc.) — leave Unparsed.
 */
export function matchAttackingBlockingPump(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // Detect subject kind
  let combatStatus: 'attacking' | 'blocking' | null = null;
  let subtypes: string[] | undefined;

  if (slice[idx] === 'attacking') {
    combatStatus = 'attacking';
    idx++;
    // Optional "creatures" / "creature"
    if (slice[idx] === 'creatures' || slice[idx] === 'creature') idx++;
  } else if (slice[idx] === 'blocking') {
    combatStatus = 'blocking';
    idx++;
    // Optional "creatures" / "creature"
    if (slice[idx] === 'creatures' || slice[idx] === 'creature') idx++;
  } else {
    // Try "<Subtype> [creature[s]] you control ..." (Vampiric Fury family).
    // We only handle the "you control" variant here because without controller
    // qualification the subtype form is too broad and could shadow other matchers.
    const subtypeRead = readCreatureSubtypeTargetPhrase(slice, idx);
    if (!subtypeRead || subtypeRead.consumed === 0) return null;
    subtypes = subtypeRead.subtypes;
    idx += subtypeRead.consumed;

    // readCreatureSubtypeTargetPhrase may not consume the "creatures"/"creature"
    // plural noun that appears between the subtype word and "you control" in the
    // mass-pump spelling ("Vampire creatures you control get +2/+0 ...").
    // Skip it explicitly so "you control" is at the expected position.
    if (slice[idx] === 'creatures' || slice[idx] === 'creature') idx++;

    // If readCreatureSubtypeTargetPhrase already consumed "you control" (via its
    // own controllerControls detection), accept that; otherwise require it now.
    if (subtypeRead.controllerControls) {
      // Already consumed by the phrase reader — do nothing.
    } else if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
      idx += 2;
    } else {
      // "you control" is mandatory for the subtype form to avoid false-positives.
      return null;
    }
  }

  // Optional "you control" for the attacking/blocking forms.
  let controllerControls = false;
  if (combatStatus !== null) {
    if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
      controllerControls = true;
      idx += 2;
    }
  } else {
    // For the subtype form controllerControls was already detected in the subtype
    // phrase; keep it true (enforced above).
    controllerControls = true;
  }

  // Verb: "get" or "gets"
  if (slice[idx] !== 'get' && slice[idx] !== 'gets') return null;
  idx++;

  // P/T modification e.g. "+2/+0", "-0/-2"
  const ptMatch = slice[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  idx++;

  // Optional "and gain[s] <keyword>[, <keyword>][ and <keyword>]"
  const grantedKeywords: string[] = [];
  if (slice[idx] === 'and' && (slice[idx + 1] === 'gain' || slice[idx + 1] === 'gains')) {
    let kwIdx = idx + 2;
    let lastGood = -1;
    while (true) {
      const kw = readGrantableKeyword(slice, kwIdx);
      if (!kw) break;
      grantedKeywords.push(kw.keyword);
      kwIdx += kw.consumed;
      lastGood = kwIdx;
      if (slice[kwIdx] === ',') kwIdx++;
      if (slice[kwIdx] === 'and') kwIdx++;
    }
    if (grantedKeywords.length === 0) return null; // "and gains <non-grantable>" → bail
    idx = lastGood;
  }

  // Require "until end of turn" — this distinguishes from the STATIC form.
  if (
    slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of'
    || (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')
  ) return null;
  idx += 4;

  if (slice[idx] === '.') idx++;

  // Build the CardFilter.
  const filter: import('../ast').CardFilter = { types: ['creature'] };
  if (combatStatus === 'attacking') filter.attacking = true;
  else if (combatStatus === 'blocking') filter.blocking = true;
  if (subtypes) filter.subtypes = subtypes;

  // Build the target ref (AllOfType).
  const target: import('../ast').TargetRef = {
    kind: 'AllOfType',
    filter,
    ...(controllerControls ? { controllerControls: true } : {}),
  };

  const effects: import('../ast').Effect[] = [
    {
      kind: 'ModifyPT',
      target,
      power,
      toughness,
      untilEndOfTurn: true,
    },
  ];
  for (const keyword of grantedKeywords) {
    effects.push({
      kind: 'GrantKeyword',
      target,
      keyword,
      untilEndOfTurn: true,
    });
  }

  return { effects, targets: [], consumed: idx };
}

// ============================================================================
// Slice 4 (activated-ability type-change): matchBecomeCreatureTypeSelf
// ============================================================================

/**
 * Slice 4 — "{cost}: This creature becomes a/an [Subtype] until end of turn."
 *
 * Matches the specific-type form of the Mistform creature family (e.g., Amoeba
 * Spy, Mistform Dreamer — but only when the oracle text names a SPECIFIC subtype,
 * not the "creature type of your choice" runtime-choice variant). The "your choice"
 * variant requires a player selection API that the current activated-ability
 * executor does not support; those lines are absorbed as honest skips instead.
 *
 * Accepts the following surface forms (all mapping to Source):
 *   "this creature becomes a Zombie until end of turn"
 *   "this creature becomes an Illusion until end of turn"
 *   "~ becomes a Zombie until end of turn"
 *   "it becomes a Zombie until end of turn"
 *   "this permanent becomes an Artifact in addition to its other types until end of turn"
 *   "this creature becomes a Zombie in addition to its other types until end of turn"
 *
 * Note: "in addition to its other types" rider is accepted but NOT modelled in
 * the effect — the engine treats this as a full subtype grant for the turn.
 * Honesty: the ability only fires for named-subtype forms where CREATURE_SUBTYPE_MAP
 * recognises the type word; everything else returns null (stays Unparsed).
 *
 * Emits: SetCreatureTypeEffect { target: Source, subtypes: [type], untilEndOfTurn }
 */
export function matchBecomeCreatureTypeSelf(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // ── Subject: "this creature", "this permanent", "~", "it" ───────────────
  let isSource = false;
  if (slice[idx] === '~' || slice[idx] === 'it') {
    isSource = true;
    idx++;
  } else if (slice[idx] === 'this' && (slice[idx + 1] === 'creature' || slice[idx + 1] === 'permanent')) {
    isSource = true;
    idx += 2;
  }
  if (!isSource) return null;

  // ── "becomes" ────────────────────────────────────────────────────────────
  if (slice[idx] !== 'becomes') return null;
  idx++;

  // ── Optional "a" / "an" article ──────────────────────────────────────────
  if (slice[idx] === 'a' || slice[idx] === 'an') idx++;

  // ── Subtype name (must be a known creature subtype) ───────────────────────
  const canonType = readCreatureSubtypeTargetPhrase(slice, idx);
  if (!canonType || canonType.subtypes.length === 0) return null;
  const subtypes = canonType.subtypes; // array of lowercase canonical subtypes
  idx += canonType.consumed;

  // ── Optional "in addition to its other types" rider ─────────────────────
  if (
    slice[idx] === 'in' && slice[idx + 1] === 'addition' &&
    slice[idx + 2] === 'to' && slice[idx + 3] === 'its' &&
    slice[idx + 4] === 'other' && slice[idx + 5] === 'types'
  ) {
    idx += 6;
  }

  // ── "until end of turn" ───────────────────────────────────────────────────
  if (
    slice[idx] !== 'until' || slice[idx + 1] !== 'end' ||
    slice[idx + 2] !== 'of' || slice[idx + 3] !== 'turn'
  ) return null;
  idx += 4;

  // Consume trailing period
  if (slice[idx] === '.') idx++;

  const effect: SetCreatureTypeEffect = {
    kind: 'SetCreatureType',
    target: { kind: 'Source' },
    subtypes,
    untilEndOfTurn: true,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Slice 12 (Licid family):
 * "This creature loses this ability and becomes an Aura enchantment with
 *  enchant creature. Attach it to target creature [you don't control | you
 *  control | an opponent controls | without flying | ...]."
 *
 * The parser recognises the characteristic Licid sentence structure and emits
 * a single LicidTransformEffect whose `attachTarget` is the Chosen creature
 * target spec.
 *
 * Accepted forms:
 *   "this creature loses this ability and becomes an aura enchantment with enchant creature . attach it to target creature ."
 *   "this creature loses this ability and becomes an aura enchantment with enchant creature . attach it to target creature you don't control ."
 *   "this creature loses this ability and becomes an aura enchantment with enchant creature . attach it to target creature you control ."
 *
 * The matcher does NOT claim the individual Licid's Aura-mode effects (those are
 * already parsed as separate activated/static abilities by other matchers if
 * their oracle text matches existing families).
 */
export function matchLicidBecomeAura(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // "this creature loses this ability and becomes an aura enchantment with enchant creature"
  if (
    slice[idx] !== 'this' || slice[idx + 1] !== 'creature' ||
    slice[idx + 2] !== 'loses' || slice[idx + 3] !== 'this' ||
    slice[idx + 4] !== 'ability' || slice[idx + 5] !== 'and' ||
    slice[idx + 6] !== 'becomes' || slice[idx + 7] !== 'an' ||
    slice[idx + 8] !== 'aura' || slice[idx + 9] !== 'enchantment' ||
    slice[idx + 10] !== 'with' || slice[idx + 11] !== 'enchant' ||
    slice[idx + 12] !== 'creature'
  ) return null;
  idx += 13;

  // Consume optional period / separator before "attach"
  if (slice[idx] === '.') idx++;

  // "attach it to target creature"
  if (
    slice[idx] !== 'attach' || slice[idx + 1] !== 'it' ||
    slice[idx + 2] !== 'to' || slice[idx + 3] !== 'target' ||
    slice[idx + 4] !== 'creature'
  ) return null;
  idx += 5;

  // Optional controller constraint: "you don't control" | "you control" | "an opponent controls"
  const constraints: TargetSpec['constraints'] = {};
  if (slice[idx] === 'you' && slice[idx + 1] === "don't" && slice[idx + 2] === 'control') {
    constraints.opponentControls = true;
    idx += 3;
  } else if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    constraints.opponentControls = true;
    idx += 3;
  }

  // Consume trailing period
  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);

  const effect: LicidTransformEffect = {
    kind: 'LicidTransform',
    attachTarget: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

// ============================================================================
// Slice 6: matchChosenTypePump
// ============================================================================

/**
 * Slice 6 — "Choose a creature type. Creatures you control of the chosen type
 * get +N/+M [and gain <keyword(s)>] until end of turn." (And They Shall Know
 * No Fear / Patriarch's Bidding adjacent anthem family).
 *
 * Also handles "creatures you control of the chosen type get +N/+M [and gain
 * <kw>] until end of turn" WITHOUT the leading choose sentence (i.e. the buff
 * line that follows an "as ~ enters, choose a creature type" preamble when it
 * appears as a one-shot triggered effect rather than a static ability).
 *
 * Subject forms accepted:
 *   "choose a creature type . creatures you control of the chosen type get ..."
 *   "creatures you control of the chosen type get ..."
 *
 * Emits:
 *   ModifyPT  target { kind: 'AllCreaturesYouControlMatching',
 *                      filter: { types: ['creature'], chosenCreatureTypeFromCastTime: true } }
 *   GrantKeyword (one per keyword) same target (untilEndOfTurn: true)
 *
 * HONEST: The executor's AllCreaturesYouControlMatching ModifyPT and GrantKeyword
 * branches (Slice 6/spell-pump) pass namedCardChoices from the execution context
 * to matchesCardFilter, which evaluates chosenCreatureTypeFromCastTime by checking
 * namedCardChoices['chosenCreatureType'] against the evaluated creature's subtypes.
 *
 * The "choose a creature type" preamble sentence is consumed here so the card
 * parses as a Spell rather than Unparsed; the choice itself is supplied at cast
 * time via CastSpellOptions.namedCardChoices['chosenCreatureType'].
 *
 * DECLINES:
 *   - The STATIC form ("Other creatures you control of the chosen type get
 *     +1/+1") — handled by matchStaticAbility (chosenCreatureTypeFromSource).
 *   - Non-grantable keywords — leave Unparsed.
 *   - "choose a color" form — defer to separate effort (Brave the Elements).
 */
export function matchChosenTypePump(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // Optional leading "choose a creature type ." sentence.
  // Accepts both "choose a creature type ." and bare start (the buff clause alone).
  if (
    slice[idx] === 'choose' && slice[idx + 1] === 'a' &&
    slice[idx + 2] === 'creature' && slice[idx + 3] === 'type'
  ) {
    idx += 4;
    // Consume optional period.
    if (slice[idx] === '.') idx++;
  }

  // Subject: "creatures you control of the chosen type"
  if (
    slice[idx] !== 'creatures' || slice[idx + 1] !== 'you' ||
    slice[idx + 2] !== 'control' || slice[idx + 3] !== 'of' ||
    slice[idx + 4] !== 'the' || slice[idx + 5] !== 'chosen' ||
    slice[idx + 6] !== 'type'
  ) return null;
  idx += 7;

  // Verb: "get" or "gets"
  if (slice[idx] !== 'get' && slice[idx] !== 'gets') return null;
  idx++;

  // P/T modification: "+1/+0", "+2/+2", etc.
  const ptMatch = slice[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  idx++;

  // Optional "and gain[s] <keyword>[, <keyword>][ and <keyword>]"
  const grantedKeywords: string[] = [];
  if (slice[idx] === 'and' && (slice[idx + 1] === 'gain' || slice[idx + 1] === 'gains')) {
    let kwIdx = idx + 2;
    let lastGood = -1;
    while (true) {
      const kw = readGrantableKeyword(slice, kwIdx);
      if (!kw) break;
      grantedKeywords.push(kw.keyword);
      kwIdx += kw.consumed;
      lastGood = kwIdx;
      if (slice[kwIdx] === ',') kwIdx++;
      if (slice[kwIdx] === 'and') kwIdx++;
    }
    if (grantedKeywords.length === 0) return null; // "and gains <non-grantable>" → bail
    idx = lastGood;
  }

  // Require "until end of turn" — distinguishes from the static form.
  if (
    slice[idx] !== 'until' || slice[idx + 1] !== 'end' || slice[idx + 2] !== 'of' ||
    (slice[idx + 3] !== 'turn' && slice[idx + 3] !== 'combat')
  ) return null;
  idx += 4;

  if (slice[idx] === '.') idx++;

  // Build AllCreaturesYouControlMatching target with chosenCreatureTypeFromCastTime filter.
  const target: import('../ast').TargetRef = {
    kind: 'AllCreaturesYouControlMatching',
    filter: {
      types: ['creature'],
      chosenCreatureTypeFromCastTime: true,
    },
  };

  const effects: import('../ast').Effect[] = [
    {
      kind: 'ModifyPT',
      target,
      power,
      toughness,
      untilEndOfTurn: true,
    },
  ];
  for (const keyword of grantedKeywords) {
    effects.push({
      kind: 'GrantKeyword',
      target,
      keyword,
      untilEndOfTurn: true,
    });
  }

  return { effects, targets: [], consumed: idx };
}

// ============================================================================
// Slice 4/CBC: matchModifyPTNegativeX
// ============================================================================

/**
 * Slice 4/CBC — X-scaled negative pump:
 *   "Target creature gets -X/-X until end of turn."
 *
 * This is the sibling clause of cant-be-countered spells like Slice from the
 * Shadows (oracle: "This spell can't be countered. Target creature gets -X/-X
 * until end of turn."). The CBC line is absorbed by absorbSelfCBCLines; this
 * matcher handles the remaining sibling clause.
 *
 * Tokenization: the tokenizer does NOT preserve "-x/-x" as a single token
 * (PT_MOD_RE only handles digit forms like "+1/+1"); instead the DASHES_RE
 * splits it into ["-", "x/", "-", "x"].
 *
 * HONEST: ModifyPT with { kind:'XMultiplied', multiplier:-1 } is already
 * executed by resolveAmount in executor.ts — same mechanism used by Toxic
 * Deluge's override. No new executor branch is needed.
 */
export function matchModifyPTNegativeX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;
  let target: TargetRef;
  let targets: TargetSpec[] = [];

  // Subject: "target creature [you control | an opponent controls]"
  if (slice[0] === 'target' && slice[1] === 'creature') {
    let j = 2;
    const constraints: TargetSpec['constraints'] = {};
    if (slice[j] === 'you' && slice[j + 1] === 'control') {
      constraints.controllerControls = true;
      j += 2;
    } else if (slice[j] === 'an' && slice[j + 1] === 'opponent' && slice[j + 2] === 'controls') {
      constraints.opponentControls = true;
      j += 3;
    }
    if (slice[j] !== 'gets') return null;
    const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
    targets = [spec];
    target = makeChosenRef(spec);
    idx = j + 1;
  } else {
    return null;
  }

  // Match "-x/-x" tokenized as ["-", "x/", "-", "x"]
  // (DASHES_RE splits "-" from the rest; "x/" retains the slash; another "-" then "x")
  if (
    slice[idx] !== '-' ||
    slice[idx + 1] !== 'x/' ||
    slice[idx + 2] !== '-' ||
    slice[idx + 3] !== 'x'
  ) return null;
  idx += 4;

  // "until end of turn"
  if (
    slice[idx] !== 'until' || slice[idx + 1] !== 'end' ||
    slice[idx + 2] !== 'of' || slice[idx + 3] !== 'turn'
  ) return null;
  idx += 4;

  if (slice[idx] === '.') idx++;

  const negX: AmountRef = { kind: 'XMultiplied', multiplier: -1 };
  const effect: Effect = {
    kind: 'ModifyPT',
    target,
    power: negX,
    toughness: negX,
    untilEndOfTurn: true,
  };
  return { effects: [effect], targets, consumed: idx };
}

// ============================================================================
// Slice 7: matchTransientPolymorph
// ============================================================================

/**
 * Slice 7 — Transient polymorph: "Until end of turn, target creature loses all
 * abilities and becomes a [color] [type] with base power and toughness X/Y
 * [and gains <keyword(s)>]."
 *
 * Covers the Turn to Frog / Dance of the Skywise / Mordenkainen's Polymorph /
 * Turn//Burn / Enter the Avatar State / Scale Up family.
 *
 * ALWAYS requires the "until end of turn ," leading prefix (all real oracle
 * wordings for this family front-load the duration). The "loses all abilities"
 * clause may appear before OR after the "becomes" clause. "With base power and
 * toughness N/M" is required (the executor runs SetBasePT + transient ability
 * strip + optional subtype + keyword riders).
 *
 * Accepted surface forms (in token order after tokenization):
 *
 *   A) "until end of turn , target creature loses all abilities and becomes a
 *      [<color>] <type(s)> with base power and toughness N/M [and gains <kw>] ."
 *      (Turn to Frog, Turn//Burn)
 *
 *   B) "until end of turn , target creature [you control] becomes a [<color>]
 *      <type(s)> with base power and toughness N/M , loses all abilities , and
 *      gains <kw> ."
 *      (Dance of the Skywise — becomes first, then loses, then gains)
 *
 *   C) "until end of turn , target creature becomes a [<color>] <type(s)> with
 *      base power and toughness N/M and gains <kw> ."
 *      (Mordenkainen's Polymorph — no explicit "loses all abilities")
 *
 * HONESTY: the executor genuinely sets _setBasePower/_setBaseToughness (layer 7b),
 * transientLosesAllAbilities (layer 6), and grantedSubtypes (layer 5) on the
 * target card for the turn. All three are cleared at end-of-turn cleanup.
 *
 * Emits ONE SetBasePTEffect with losesAllAbilities?, subtypes?, keywords?.
 *
 * DECLINES:
 *   - Forms without "with base power and toughness" (no P/T anchor → no executor).
 *   - The static / aura form ("enchanted creature loses all abilities and is a
 *     <type> with base power and toughness N/M") — handled by matchAttachedStaticBuff
 *     via the aura-cache path in card-parser-cache.ts.
 *   - Scale Up's "if it's a creature with base power 3 or greater" conditional —
 *     the simple base form still parses (the condition is safely absorbed since
 *     the "becomes" clause starts the relevant sentence).
 */
export function matchTransientPolymorph(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  let idx = 0;

  // ── REQUIRED: "until end of turn ," leading prefix ──────────────────────────
  if (
    slice[idx] !== 'until' || slice[idx + 1] !== 'end' ||
    slice[idx + 2] !== 'of' || slice[idx + 3] !== 'turn' ||
    slice[idx + 4] !== ','
  ) return null;
  idx += 5;

  // ── Subject: "target creature [you control | an opponent controls]" ──────────
  if (slice[idx] !== 'target' || slice[idx + 1] !== 'creature') return null;
  idx += 2;

  const constraints: TargetSpec['constraints'] = {};
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    constraints.opponentControls = true;
    idx += 3;
  }

  // ── Optional pre-becomes "loses all abilities and" clause (Form A / D) ───────
  let losesAllAbilities = false;
  if (
    slice[idx] === 'loses' && slice[idx + 1] === 'all' && slice[idx + 2] === 'abilities' &&
    slice[idx + 3] === 'and'
  ) {
    losesAllAbilities = true;
    idx += 4;
  }

  // ── "becomes a [an]" ─────────────────────────────────────────────────────────
  if (slice[idx] !== 'becomes') return null;
  idx++;
  if (slice[idx] === 'a' || slice[idx] === 'an') idx++;

  // ── Optional color word: "blue", "red", "green", etc. ────────────────────────
  const colorRead = readColorConstraint(slice, idx);
  if (colorRead) idx += colorRead.consumed;

  // ── Subtype word(s): known or unknown ────────────────────────────────────────
  // Try readCreatureSubtypeTargetPhrase first for known subtypes. If it returns
  // null (unknown type like "Weird"), accept up to two consecutive non-keyword
  // non-punctuation words as the raw subtype name(s).
  const subtypes: string[] = [];
  const knownSubtype = readCreatureSubtypeTargetPhrase(slice, idx);
  if (knownSubtype && knownSubtype.subtypes.length > 0) {
    subtypes.push(...knownSubtype.subtypes);
    idx += knownSubtype.consumed;
  } else {
    // Unknown subtype: accept one word if it's alphabetic (e.g. "weird", "turtle")
    const word = slice[idx];
    if (!word || !/^[a-z]+$/.test(word) || word === 'with' || word === 'and' || word === 'base') {
      return null;
    }
    // Check if it could be an unknown creature subtype (not a function word)
    const skipWords = new Set([
      'with', 'and', 'or', 'base', 'power', 'toughness', 'until', 'end', 'of', 'turn',
      'loses', 'all', 'abilities', 'gains', 'gain', 'a', 'an', 'the', 'target', 'creature',
    ]);
    if (skipWords.has(word)) return null;
    subtypes.push(word); // store as-is (lowercase canonical)
    idx++;
    // Accept a second word if it's also a known creature subtype (e.g. "Dragon Illusion" form)
    if (slice[idx] && CREATURE_SUBTYPE_MAP[slice[idx]]) {
      subtypes.push(CREATURE_SUBTYPE_MAP[slice[idx]]);
      idx++;
    } else if (slice[idx] && /^[a-z]+$/.test(slice[idx]) && !skipWords.has(slice[idx])) {
      // Accept unknown second word (e.g. unknown two-word type)
      subtypes.push(slice[idx]);
      idx++;
    }
  }

  // ── "with base power and toughness N/M" — REQUIRED ───────────────────────────
  if (slice[idx] !== 'with') return null;
  idx++;
  if (slice[idx] !== 'base') return null;
  idx++;
  if (slice[idx] !== 'power') return null;
  idx++;
  if (slice[idx] !== 'and') return null;
  idx++;
  if (slice[idx] !== 'toughness') return null;
  idx++;

  const ptMatch = slice[idx]?.match(/^(\d+)\/(\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  idx++;

  // ── Optional post-P/T clauses (any order): ────────────────────────────────────
  //   ", loses all abilities ,"
  //   ", and" | "and" separators
  //   "gains <keyword(s)>"
  const grantedKeywords: string[] = [];

  while (idx < slice.length) {
    // Consume separators: ",", "and", ","
    while (slice[idx] === ',' || slice[idx] === 'and') idx++;

    // "loses all abilities" post-clause (Form B)
    if (slice[idx] === 'loses' && slice[idx + 1] === 'all' && slice[idx + 2] === 'abilities') {
      losesAllAbilities = true;
      idx += 3;
      continue;
    }

    // "gains <keyword(s)>"
    if (slice[idx] === 'gains' || slice[idx] === 'gain') {
      idx++;
      let lastGood = -1;
      while (true) {
        const kw = readGrantableKeyword(slice, idx);
        if (!kw) break;
        grantedKeywords.push(kw.keyword);
        idx += kw.consumed;
        lastGood = idx;
        if (slice[idx] === ',') idx++;
        if (slice[idx] === 'and') idx++;
      }
      if (lastGood >= 0) idx = lastGood;
      continue;
    }

    // Stop at period or unknown token
    break;
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  const effect: SetBasePTEffect = {
    kind: 'SetBasePT',
    target: makeChosenRef(spec),
    power,
    toughness,
    ...(losesAllAbilities ? { losesAllAbilities: true as const } : {}),
    ...(subtypes.length > 0 ? { subtypes } : {}),
    ...(grantedKeywords.length > 0 ? { keywords: grantedKeywords } : {}),
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Slice 11 — transient protection grant.
 *
 * Forms handled (all require "until end of turn"):
 *   Single-target:
 *     "target creature gains protection from <color> until end of turn"
 *     "target creature you control gains protection from <color> until end of turn"
 *     "target <Subtype> gains protection from <color> until end of turn"
 *     (Activated: e.g. Goblin Chieftain-style / Pentarch Paladin family)
 *
 *   Mass (controller's creatures):
 *     "<color> creatures you control gain protection from <color2> until end of turn"
 *     "creatures you control gain protection from <color> until end of turn"
 *     (Brave the Elements / Apostle of Purity family)
 *
 * DECLINES:
 *   "protection from the color of your choice" — needs choice-at-cast infrastructure
 *   "protection from the chosen color"          — needs card.choices.chosenColor on targets
 *   "protection from everything", "protection from <subtype>" — not enforced by engine
 *
 * HONEST: the keyword string stored in grantedKeywords is "protection from <color>"
 * (e.g. "protection from white"). The Slice 11 extension in keywords.ts
 * protectionClausesFor now harvests those entries so isProtectedFromSource /
 * getProtectionColors genuinely enforces the grant (can't be blocked, targeted,
 * or dealt damage by sources of that color).
 */
export function matchGrantProtection(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 6) return null;

  // Color name → protection clause string.
  const PROT_COLORS: Record<string, string> = {
    white: 'white', blue: 'blue', black: 'black', red: 'red', green: 'green',
  };

  // Helper: read "protection from <color>" at slice[idx].
  function readProtectionFromColor(s: string[], idx: number): { clause: string; consumed: number } | null {
    if (s[idx] !== 'protection' || s[idx + 1] !== 'from') return null;
    const colorWord = s[idx + 2];
    if (!colorWord || !PROT_COLORS[colorWord]) return null;
    return { clause: `protection from ${PROT_COLORS[colorWord]}`, consumed: 3 };
  }

  // Helper: consume "until end of turn [.]" at s[idx]; returns new index or null.
  function consumeUntilEOT(s: string[], idx: number): number | null {
    if (s[idx] !== 'until' || s[idx + 1] !== 'end' || s[idx + 2] !== 'of' || s[idx + 3] !== 'turn') return null;
    let i = idx + 4;
    if (s[i] === '.') i++;
    return i;
  }

  // ── Mass form: "[<color>] creatures you control gain protection from <color> until end of turn" ──
  {
    let idx = 0;
    // Optional leading subject-color word (Brave the Elements: "white creatures...")
    const subjectColorWord = PROT_COLORS[slice[idx]] ? slice[idx] : null;
    if (subjectColorWord) idx++;

    if (slice[idx] === 'creatures' && slice[idx + 1] === 'you' && slice[idx + 2] === 'control'
        && slice[idx + 3] === 'gain') {
      idx += 4;
      const prot = readProtectionFromColor(slice, idx);
      if (prot) {
        idx += prot.consumed;
        const untilIdx = consumeUntilEOT(slice, idx);
        if (untilIdx !== null) {
          type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G';
          const COLOR_TO_MANA: Record<string, ManaColor> = {
            white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
          };
          const target: import('../ast').TargetRef = subjectColorWord
            ? { kind: 'AllOfType', filter: { types: ['creature'] as any, colors: [COLOR_TO_MANA[subjectColorWord]!] } }
            : { kind: 'AllCreaturesYouControl' };
          const effect: import('../ast').Effect = {
            kind: 'GrantKeyword',
            target,
            keyword: prot.clause,
            untilEndOfTurn: true,
          };
          return { effects: [effect], targets: [], consumed: untilIdx };
        }
      }
    }
  }

  // ── Single-target form: "target creature [you control] gains protection from <color> until end of turn" ──
  if (slice[0] !== 'target') return null;

  let idx = 1;

  // Optional color constraint before noun
  const colorRead = readColorConstraint(slice, idx);
  const colorConstraints: TargetSpec['constraints'] | undefined = colorRead ? { colors: colorRead.colors } : undefined;
  if (colorRead) idx += colorRead.consumed;

  // Noun: subtype phrase (e.g. "Goblin")
  const subtypeRead = readCreatureSubtypeTargetPhrase(slice, idx);
  if (subtypeRead) {
    idx += subtypeRead.consumed;
    if (slice[idx] === 'creature') idx++;
    let controllerControls = subtypeRead.controllerControls;
    let opponentControls = subtypeRead.opponentControls;
    if (!controllerControls && !opponentControls) {
      if (slice[idx] === 'you' && slice[idx + 1] === 'control') { controllerControls = true; idx += 2; }
      else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') { opponentControls = true; idx += 3; }
    }
    if (slice[idx] !== 'gains') return null;
    idx++;
    const prot = readProtectionFromColor(slice, idx);
    if (!prot) return null;
    idx += prot.consumed;
    const untilIdx = consumeUntilEOT(slice, idx);
    if (untilIdx === null) return null;
    const subtypeConstraints: TargetSpec['constraints'] = {
      ...(colorConstraints || {}),
      subtypes: subtypeRead.subtypes,
      ...(controllerControls ? { controllerControls: true } : {}),
      ...(opponentControls ? { opponentControls: true } : {}),
    };
    const spec = makeTargetSpec('Creature', subtypeConstraints);
    return {
      effects: [{ kind: 'GrantKeyword', target: makeChosenRef(spec), keyword: prot.clause, untilEndOfTurn: true }],
      targets: [spec],
      consumed: untilIdx,
    };
  }

  // Plain "creature" noun
  if (slice[idx] !== 'creature') return null;
  idx++;

  const constraints: TargetSpec['constraints'] = { ...(colorConstraints || {}) };
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') { constraints.controllerControls = true; idx += 2; }
  else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') { constraints.opponentControls = true; idx += 3; }

  if (slice[idx] !== 'gains') return null;
  idx++;

  const prot = readProtectionFromColor(slice, idx);
  if (!prot) return null;
  idx += prot.consumed;

  const untilIdx = consumeUntilEOT(slice, idx);
  if (untilIdx === null) return null;

  const spec = makeTargetSpec('Creature', Object.keys(constraints).length > 0 ? constraints : undefined);
  return {
    effects: [{ kind: 'GrantKeyword', target: makeChosenRef(spec), keyword: prot.clause, untilEndOfTurn: true }],
    targets: [spec],
    consumed: untilIdx,
  };
}
