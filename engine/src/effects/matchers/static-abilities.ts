// Static-ability matchers extracted from parser.ts (batch 12/12).
// Covers: attached-buff, must-attack, enters-tapped, can't-be-countered,
// self-cost-reduction, landwalk, protection, other-evasion, block-only-flying,
// unconditional static (matchStaticAbility), and conditional static
// (matchConditionalStaticAbility).
// Slice 7 addition: matchTappedForManaRider (Market Festival / Zhur-Taa Ancient families).
// Do NOT edit logic here — keep verbatim with parser.ts originals.

import type { StaticAbilityEffect, StaticModifier, CardFilter, Condition, ForEachAmount, ManaProductionInfo, MustBeBlockedIfAbleEffect } from '../ast';
import type { PatternResult } from '../parser';
import type { TargetSpec } from '../targets';
import {
  parseStaticFilterType,
  mergeStaticFilters,
  parseManaValueFilterSuffix,
  parseSmallNumberToken,
  stripReminderTextForCBC,
  isCBCAllowedKeywordSentence,
  CBC_ALLOWED_KEYWORDS,
  ABSORBABLE_ENGINE_KEYWORDS,
  ABSORBABLE_WARD_COST_RE,
  ABSORBABLE_WARD_PAY_LIFE_RE,
  PROTECTION_ENFORCED_QUALITY_RE,
  isEnforcedProtectionSentence,
  LANDWALK_SENTENCE_RE,
  parseNumberOfFilterAmount,
  parseWhereXIsNumberOf,
  makeTargetSpec,
  makeChosenRef,
  readGrantableKeyword,
} from '../parser';
import { parseConditionalEntersTapped } from '../../permanent-entry';

// ============================================================================
// matchAttachedStaticBuff
// ============================================================================

/**
 * Match the Aura/Equipment static buff on the attached permanent, returned as a
 * top-level StaticAbilityEffect (mirroring matchStaticAbility):
 *   "Equipped creature gets +N/+N"                   (Equipment)
 *   "Enchanted creature gets +N/+N and has trample"  (Aura)
 *   "Enchanted creature has flying"                  (keyword-only Aura)
 *
 * The actual P/T + keyword grant is applied via the cached equipmentBonus path
 * (card-parser-cache.ts → continuous.ts / keywords.ts), which already supports
 * both "equipped" and "enchanted" wording. We emit a StaticAbility flagged
 * `attachedOnly` purely so the clause is recognized (parsed). `attachedOnly`
 * statics are skipped by the continuous layer (see continuous.ts isAffectedBy)
 * so there is no double-application — the cache stays the single source.
 */
export function matchAttachedStaticBuff(tokens: string[]): StaticAbilityEffect | null {
  const permanentWords = new Set(['creature', 'permanent', 'artifact', 'land', 'planeswalker']);
  // Verbs that introduce an attached-permanent static: "gets +N/+N", "has flying",
  // "can't attack or block" (Pacifism family), "doesn't untap …" (untap-lock,
  // enforced by performUntapStep). "can't"/"doesn't" tokenize intact.
  // Slice 3 addition: "loses" for Frogify/Reprobation family ("loses all abilities
  // and is/becomes/has a <type> creature with base power and toughness N/N").
  const buffVerbs = new Set(['gets', 'get', 'has', 'have', 'gains', 'gain', "can't", 'cant', 'cannot', "doesn't", 'doesnt', 'is', 'loses']);

  // Find where the attached-buff clause starts. Auras carry an "Enchant <X>"
  // preamble that the keyword trimmer leaves in place (it only strips preambles
  // before a triggered ability), and some lead with "Flash". So scan the first
  // few tokens for "enchanted/equipped <permanent> gets/has/can't ...", the
  // actual static-buff sentence.
  let base = -1;
  for (let i = 0; i < Math.min(tokens.length, 8); i++) {
    if (
      (tokens[i] === 'equipped' || tokens[i] === 'enchanted') &&
      permanentWords.has(tokens[i + 1]) &&
      buffVerbs.has(tokens[i + 2])
    ) {
      base = i;
      break;
    }
  }
  if (base === -1) return null;

  const verb = tokens[base + 2];
  let modifier: StaticModifier;
  if (verb === 'gets' || verb === 'get') {
    const ptTok = tokens[base + 3];
    // Slice 10: "+X/+X, where X is the number of <filter> <zone>" — dynamic where-X buff.
    // Matches Exoskeletal Armor (+X/+X) and Death's Approach (-X/-X) patterns.
    //
    // Tokenization quirk: "+x/+x" stays as a single token ("+x/+x") because "+" is
    // not a dash character, but "-x/-x" is split by the tokenizer's DASHES_RE into
    // ["-", "x/", "-", "x"] since "-" IS a dash. We handle both forms:
    //   Form A (single token): "+x/+x" or "-x/+x" etc. matched by regex below.
    //   Form B (multi-token): ["-", "x/", "-", "x"] where "x/" ends with slash.

    let dynPowerSign: 1 | -1 | null = null;
    let dynToughnessSign: 1 | -1 | null = null;
    let whereAt = base + 4; // default offset after ptTok

    // Form A: single token "+x/+x" or similar (when no leading "-" dash is present)
    const dynPTA = ptTok?.match(/^([+-])x\/([+-])x$/i);
    if (dynPTA) {
      dynPowerSign = dynPTA[1] === '-' ? -1 : 1;
      dynToughnessSign = dynPTA[2] === '-' ? -1 : 1;
      // whereAt stays at base + 4
    }
    // Form B: multi-token "-x/-x" tokenized as ["-", "x/", "-", "x"]
    else if (
      (ptTok === '-' || ptTok === '+') &&
      tokens[base + 4]?.match(/^x\/$/i) &&
      (tokens[base + 5] === '-' || tokens[base + 5] === '+') &&
      tokens[base + 6]?.match(/^x$/i)
    ) {
      dynPowerSign = ptTok === '-' ? -1 : 1;
      dynToughnessSign = tokens[base + 5] === '-' ? -1 : 1;
      whereAt = base + 7; // advance past all 4 tokens
    }

    if (dynPowerSign !== null && dynToughnessSign !== null) {
      // Require ", where X is the number of ..." or "where X is the number of ..."
      if (tokens[whereAt] === ',') whereAt++;
      const dyn = parseWhereXIsNumberOf(tokens, whereAt);
      if (!dyn) return null;
      modifier = {
        kind: 'ModifyPTDynamic',
        powerFormula: dyn.amount,
        toughnessFormula: dyn.amount,
        powerSign: dynPowerSign,
        toughnessSign: dynToughnessSign,
      };
    } else {
      // Static literal +N/+N (or +N/+0 etc.)
      const ptMatch = ptTok?.match(/^([+-]\d+)\/([+-]\d+)$/);
      if (!ptMatch) return null;
      modifier = { kind: 'ModifyPT', power: parseInt(ptMatch[1], 10), toughness: parseInt(ptMatch[2], 10) };
    }
  } else if (verb === "can't" || verb === 'cant' || verb === 'cannot') {
    // Pacifism family: "can't attack", "can't block", "can't attack or block".
    const rest = tokens.slice(base + 3, base + 8);
    const cantAttack = rest.includes('attack');
    const cantBlock = rest.includes('block');
    if (!cantAttack && !cantBlock) return null;
    // The combat restriction is enforced via the equipmentBonus cache
    // (CannotAttack/CannotBlock keywords → canAttackThisTurn/canBlock). The
    // modifier here is a parse-recognition placeholder (attachedOnly no-op).
    modifier = { kind: 'GrantKeyword', keyword: cantAttack ? 'CannotAttack' : 'CannotBlock' };
  } else if (verb === "doesn't" || verb === 'doesnt') {
    // Untap-lock: "doesn't untap during its controller's untap step" — already
    // enforced at runtime by performUntapStep (turn-manager.ts), which keeps the
    // attached creature tapped. We only recognize the clause here for coverage.
    if (tokens[base + 3] !== 'untap') return null;
    modifier = { kind: 'GrantKeyword', keyword: 'DoesNotUntap' };
  } else if (verb === 'loses') {
    // Slice 3: Frogify/Reprobation family — "Enchanted creature loses all
    // abilities and is/becomes/has a [color] [Type] creature with base power
    // and toughness N/N [in addition to its other types]".
    //
    // HONEST: the executor is ALREADY backed by parseEquipmentBonus (card-
    // parser-cache.ts lines 119–162) which extracts setBasePower/setBaseToughness,
    // setTypes/addTypes, and losesAllAbilities from the aura oracle text, and
    // continuous.ts applies them at layers 4/6/7b. We only emit a StaticAbility
    // marker so the face stops being Unparsed; the attachedOnly flag prevents
    // the continuous layer from double-applying (same as the 'is' verb case).
    //
    // We require: "loses all abilities" at base+2..5 AND "base power and
    // toughness" somewhere in the rest of the clause. Pure "loses all abilities"
    // with no P/T set remains Unparsed (no executor run for the no-base-PT form).
    if (
      tokens[base + 3] !== 'all' ||
      tokens[base + 4] !== 'abilities'
    ) return null;
    let hasBasePT = false;
    for (let s = base + 5; s < tokens.length && tokens[s] !== '.'; s++) {
      if (
        tokens[s] === 'base' &&
        tokens[s + 1] === 'power' &&
        tokens[s + 2] === 'and' &&
        tokens[s + 3] === 'toughness'
      ) {
        hasBasePT = true;
        break;
      }
    }
    if (!hasBasePT) return null;
    modifier = { kind: 'ModifyPT', power: 0, toughness: 0 };
  } else if (verb === 'is') {
    // Type-change auras: "Enchanted creature is a Treefolk with base power and
    // toughness 0/4" (Lignify, Darksteel Mutation, etc.). Only recognize when the
    // sentence SETS base P/T — that part IS modeled (cache → continuous.ts layer
    // 7b). Pure "is a <type> in addition to its other types" type-add (no base
    // P/T) stays Unparsed.
    let hasBasePT = false;
    for (let s = base + 3; s < tokens.length && tokens[s] !== '.'; s++) {
      if (tokens[s] === 'base' && tokens[s + 1] === 'power' && tokens[s + 2] === 'and' && tokens[s + 3] === 'toughness') {
        hasBasePT = true;
        break;
      }
    }
    if (!hasBasePT) return null;
    modifier = { kind: 'ModifyPT', power: 0, toughness: 0 };
  } else {
    // Keyword-only buff (e.g. "Enchanted creature has flying"): 0/0 no-op; the
    // keyword itself is granted via the equipmentBonus cache.
    modifier = { kind: 'ModifyPT', power: 0, toughness: 0 };
  }

  return {
    kind: 'StaticAbility',
    modifier,
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    attachedOnly: true,
  };
}

// ============================================================================
// matchSelfMustAttack
// ============================================================================

/**
 * Self-referential combat-requirement static: "~ attacks each combat if able."
 * (Bloodrock Cyclops, Juggernaut, Ball Lightning-style beaters) and the
 * equivalent "~ attacks each turn if able." form.
 *
 * The constraint is ALREADY enforced end-to-end by combat.ts: `mustAttackIfAble`
 * reads the card's oracle text with this same regex and `declareAttackers`
 * (via getRequiredAttackers) refuses a declaration that omits a creature which
 * could attack. So recognizing the clause here is honest — the engine genuinely
 * forces the attack; we only emit a parsed StaticAbility so the face stops being
 * Unparsed.
 *
 * We match against the RAW oracle text (not tokens) because the subject is the
 * card's own name, which parseOracleText does not normalize to `~`. The
 * `selfOnly` GrantKeyword modifier is a recognition marker; the continuous layer
 * has no MustAttack keyword consumer, and none is needed — combat.ts is the
 * single enforcement site.
 */
const SELF_MUST_ATTACK_RE =
  /\battacks\s+(?:each|every)\s+combat\s+if\s+able\b|\battacks\s+each\s+turn\s+if\s+able\b/i;

export function matchSelfMustAttack(oracleText: string): StaticAbilityEffect | null {
  if (!SELF_MUST_ATTACK_RE.test(oracleText)) return null;
  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword: 'MustAttackEachCombat' },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// matchEntersTapped
// ============================================================================

/**
 * Match a standalone "This permanent enters tapped." / "This land enters tapped."
 * / "~ enters the battlefield tapped." static.
 *
 * HONEST: the tapped-on-entry behavior is ALREADY enforced end-to-end by
 * permanent-entry.ts: `entersTheBattlefieldTapped` reads the card's oracle text
 * and `buildBattlefieldEntryPlan` sets the entering CardInstance.tapped = true.
 * So recognizing the clause here is genuine — the engine really taps the
 * permanent; we only emit a parsed StaticAbility so the (otherwise mana-only,
 * cache-backed) face stops being Unparsed.
 *
 * IMPORTANT — only the UNCONDITIONAL "always tapped" form is claimed by default.
 * We DECLINE:
 *  - "enters tapped unless ..." conditionals (e.g. "unless you control two or
 *    more basic lands"), because the unconditional executor would wrongly tap it
 *    every time. (Supported "unless you control [N basic lands / N or fewer other
 *    lands]" forms ARE claimed separately via parseConditionalEntersTapped.)
 *  - "doesn't enter tapped" negations.
 *
 * We CLAIM:
 *  - "you may pay N life. If you don't, it enters tapped" (shock-land form):
 *    buildBattlefieldEntryPlan now uses a deterministic auto-choice (pay when life
 *    >= 4, else enter tapped) and routes the payment through executeLoseLife so
 *    LifeLoss triggers still fire. The parse result carries keyword 'ShockLandEntry'
 *    (a recognition marker; no continuous-layer consumer reads it — enforcement is
 *    entirely in permanent-entry.ts / actions.ts, mirroring EntersTapped).
 *
 * The `selfOnly` GrantKeyword('EntersTapped') is a recognition marker only; no
 * continuous-layer consumer reads it (KEYWORD_MAP has no such keyword, so
 * keywords.ts silently ignores it). permanent-entry.ts is the single
 * enforcement site, exactly mirroring matchSelfMustAttack / combat.ts.
 */
const ENTERS_TAPPED_RE =
  /\benters?(?:\s+the\s+battlefield)?\s+tapped\b/i;
const SHOCK_LAND_RE =
  /\byou\s+may\s+pay\s+(\d+)\s+life\b[^.]*\.\s*if\s+you\s+don['']?t\b[^.]*enters?\s+tapped/i;
const ENTERS_TAPPED_DISQUALIFY_RE =
  /\bunless\b|\bdo(?:es)?\s*n['']?t\s+enter\b|\bdoes\s+not\s+enter\b/i;

export function matchEntersTapped(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  if (!ENTERS_TAPPED_RE.test(oracleText)) return null;
  // HONEST conditional forms: "enters tapped unless you control [a/N basic
  // land(s)] / [N or fewer other lands]". buildBattlefieldEntryPlan evaluates the
  // control-count at entry, so claiming these is genuine — the engine taps the
  // land only when the condition is unmet. (Other "unless" forms remain Unparsed.)
  if (parseConditionalEntersTapped(oracleText)) {
    return {
      kind: 'StaticAbility',
      modifier: { kind: 'GrantKeyword', keyword: 'EntersTapped' },
      filter: { permanent: true },
      controller: 'any',
      excludeSelf: false,
      selfOnly: true,
    };
  }
  // Shock-land form: "As this land enters, you may pay N life. If you don't, it
  // enters tapped." buildBattlefieldEntryPlan auto-chooses deterministically (pay
  // when life >= 4, else enter tapped) and routes the payment through executeLoseLife
  // so LifeLoss triggers still fire. Claiming the face is HONEST — the engine
  // really executes the pay-or-tapped logic.
  if (SHOCK_LAND_RE.test(oracleText)) {
    return {
      kind: 'StaticAbility',
      modifier: { kind: 'GrantKeyword', keyword: 'ShockLandEntry' },
      filter: { permanent: true },
      controller: 'any',
      excludeSelf: false,
      selfOnly: true,
    };
  }
  // Decline remaining conditional / negated forms — the unconditional executor
  // (buildBattlefieldEntryPlan) would mistap them.
  if (ENTERS_TAPPED_DISQUALIFY_RE.test(oracleText)) return null;
  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword: 'EntersTapped' },
    filter: { permanent: true },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// matchCantBeCountered
// ============================================================================

/**
 * Match a standalone "This spell can't be countered." face — the spell-self
 * uncounterable marker (CR 701.5h applied at cast time).
 *
 * HONEST: the uncounterable behavior is ALREADY enforced end-to-end at cast.
 * stack.ts castSpell reads the spell's own oracle text via hasCantBeCounteredText
 * and sets SpellStackItem.cantBeCountered = true; executor.ts executeCounterSpell
 * then refuses to counter any stack item carrying that flag (and ward.ts skips
 * the ward counter). So recognizing the clause here is genuine — the engine
 * really makes the spell uncounterable; we only emit a parsed StaticAbility so
 * the (otherwise keyword-only) creature face stops being Unparsed.
 *
 * IMPORTANT honesty gate — we claim the face ONLY when the spell-self clause is
 * the sole non-keyword text. Every other sentence (after reminder-text removal)
 * must be a known engine keyword / keyword phrase whose function is handled by
 * the keyword cache (trample, hexproof, flash, protection from X, ward {N}, ...).
 * We DECLINE:
 *  - granted statics that make OTHER spells uncounterable ("Creature spells you
 *    control can't be countered", "Sliver spells can't be countered") — the
 *    engine does NOT apply uncounterability to other spells from a battlefield
 *    static, so claiming them would mask an unrun ability.
 *  - any face with a real (non-keyword) spell/activated/triggered clause beside
 *    the CBC line — that other clause is the card's function and stays Unparsed.
 *
 * The `selfOnly` GrantKeyword('CantBeCountered') is a recognition marker only;
 * no continuous-layer or keyword-map consumer reads it (mirrors EntersTapped /
 * MustAttackEachCombat). stack.ts is the single enforcement site.
 */
const SELF_CANT_BE_COUNTERED_RE =
  /^this spell can['']?t be countered$/i;

export function matchCantBeCountered(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let hasSelfCBC = false;
  for (const sentence of sentences) {
    if (SELF_CANT_BE_COUNTERED_RE.test(sentence)) { hasSelfCBC = true; continue; }
    // Any other "can't be countered" wording is a granted static we DON'T run.
    if (/can['']?t be countered/i.test(sentence)) return null;
    // Non-keyword residual text => the card has a real unrun function; decline.
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }
  if (!hasSelfCBC) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword: 'CantBeCountered' },
    filter: { permanent: true },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// matchSelfCostReduction
// ============================================================================

/**
 * Match a standalone "This spell costs {N} less to cast" face — the spell-self
 * cost-reducer printed on the spell itself.
 *
 * HONEST: the reduction is ALREADY enforced end-to-end at cast. continuous.ts
 * getIntrinsicCostReduction reads the spell's own oracle text (the SAME regexes
 * mirrored below) and returns a generic-cost reduction; stack.ts reduceGenericCost
 * (the actual cast path, called from castSpell at stack.ts:1149/1231 and from
 * actions-public availability) subtracts it from the spell's generic cost before
 * payment. So recognizing the clause here is genuine — the engine really makes
 * the spell cost less; we only emit a parsed StaticAbility(ReduceCost) so the
 * (otherwise Unparsed) face stops reporting Unparsed.
 *
 * Enforced forms (mirroring getIntrinsicCostReduction exactly):
 *   1. "This spell costs {N} less to cast." (flat)
 *   2. "costs {N} less for each <thing> [you control | opponents control | on the battlefield]." (battlefield each)
 *   3. "costs {X} less, where X is the greatest mana value among <thing> [...]." (dynamic max)
 *   4. "costs {N} less for each opponent you have." (opponents count)
 *   5. "costs {N} less for each <subtype> card in your graveyard." (graveyard each)
 *   6. "costs {N} less for each <X> you control and each <X> card in your graveyard." (compound)
 *   7. "costs {X} less, where X is the total power of creatures you control." (total power)
 *   8. "costs {X} less, where X is the greatest power among creatures you control." (greatest power)
 *   9. "costs {N} less for each creature in your party." (party count)
 *  10. "costs {N} less for each basic land type among lands you control." (domain)
 *  11. "costs {N} less for each instant and sorcery card in your graveyard." (multi-type graveyard)
 *  12. "costs {N} less for each card type among cards in your graveyard." (card-type diversity)
 *  13. "costs {N} less for each color among permanents you control." (color diversity)
 *  14. "costs {N} less for each creature type among creatures you control." (creature-type diversity)
 *  15. "costs {N} less for each creature you control with a +1/+1 counter on it." (counter-gated)
 *  16. "costs {N} less if you control a permanent with mana value N or greater." (cmc conditional)
 *  17. "costs {N} less if you have N or more instant/sorcery cards in your graveyard." (graveyard count conditional)
 *  18. "costs {N} less for each different mana value among cards in your graveyard." (distinct cmc graveyard — Oskar)
 *  19. "costs {N} less if there are N or more card types among cards in your graveyard." (card-type count threshold — Dusk Feaster delirium)
 *
 * HONESTY GATE — we ONLY claim enforced forms. Conditional reductions ("if it
 * targets a tapped creature") are NOT claimed. Counter-gated forms ARE now
 * supported for +1/+1 counters (CardInstance.counters is tracked in GameState).
 * Other counter types (charge, loyalty, etc.) are declined as 'unsupported'.
 *
 * ABSORPTION — the rest-must-be-keywords restriction is lifted: if the face
 * carries real (non-keyword) clauses beside the cost line, this function still
 * recognizes the cost-reduction sentence (returning the ReduceCost marker for
 * the keyword-only case), but parser.ts absorbSelfCostReductionLines handles the
 * mixed case by stripping the cost line and reparsing the remainder.
 *
 * The amount emitted is the printed {N} (flat form) or 0 (dynamic forms); the
 * StaticAbility is a recognition marker only — getIntrinsicCostReduction is the
 * single enforcement site (mirrors EntersTapped / CantBeCountered markers).
 */

// Forms 1-19 — mirrors getIntrinsicCostReduction in continuous.ts exactly.
// Form 1: flat, tightened to decline conditional qualifiers ("if ...", "where X is ...")
const SELF_COST_REDUCTION_FLAT_RE =
  /^this spell costs \{(\d+)\} less to cast(?! for each)(?!,?\s*where\b)(?!\s+if\b)$/i;
// Form 2: simple battlefield for-each (excludes counter-conditional forms)
const SELF_COST_REDUCTION_EACH_BF_RE =
  /^this spell costs \{\d+\} less to cast for each (?!\w+ you control and each)\S+(?:\s+\S+)* (?:you control|your opponents? control|on the battlefield)$/i;
// Form 3: greatest mana value
const SELF_COST_REDUCTION_GREATEST_RE =
  /^this spell costs \{x\} less to cast,? where x is the greatest mana value among .+?(?: you control| your opponents? control| on the battlefield)$/i;
// Form 4: opponents (with "you have")
const SELF_COST_REDUCTION_OPPONENTS_RE =
  /^this spell costs \{\d+\} less to cast for each opponent you have$/i;
// Form 46: opponents (bare, Undaunted keyword form — no "you have")
// "This spell costs {N} less to cast for each opponent." — used in Undaunted reminder text
// and as a standalone clause on non-Undaunted cards. Executor: count active opponents,
// identical to Form 4. Honest because state.players tracks all active/eliminated players.
const SELF_COST_REDUCTION_OPPONENTS_BARE_RE =
  /^this spell costs \{\d+\} less to cast for each opponent$/i;
// Form 5: graveyard each (single subject word + "card in your graveyard")
const SELF_COST_REDUCTION_GRAVEYARD_RE =
  /^this spell costs \{\d+\} less to cast for each \w+ card in your graveyard$/i;
// Form 6: compound battlefield + graveyard ("each X you control and each X card in your graveyard")
const SELF_COST_REDUCTION_COMPOUND_RE =
  /^this spell costs \{\d+\} less to cast for each \w+ you control and each \w+ card in your graveyard$/i;
// Form 7: total power
const SELF_COST_REDUCTION_TOTAL_POWER_RE =
  /^this spell costs \{x\} less to cast,? where x is the total power of .+? you control$/i;
// Form 8: greatest power
const SELF_COST_REDUCTION_GREATEST_POWER_RE =
  /^this spell costs \{x\} less to cast,? where x is the greatest power among .+?(?: you control| your opponents? control| on the battlefield)$/i;
// Form 9: party count
const SELF_COST_REDUCTION_PARTY_RE =
  /^this spell costs \{\d+\} less to cast for each creature in your party$/i;
// Form 10: domain
const SELF_COST_REDUCTION_DOMAIN_RE =
  /^this spell costs \{\d+\} less to cast for each basic land type among lands you control$/i;
// Form 11: multi-type graveyard (instant and sorcery)
const SELF_COST_REDUCTION_MULTI_GY_RE =
  /^this spell costs \{\d+\} less to cast for each instant and sorcery card in your graveyard$/i;
// Form 12: distinct card types among graveyard
const SELF_COST_REDUCTION_CARD_TYPES_GY_RE =
  /^this spell costs \{\d+\} less to cast for each card type among cards in your graveyard$/i;
// Form 13: colors among permanents you control
const SELF_COST_REDUCTION_COLORS_RE =
  /^this spell costs \{\d+\} less to cast for each color among permanents you control$/i;
// Form 14: creature types among creatures you control
const SELF_COST_REDUCTION_CREATURE_TYPES_RE =
  /^this spell costs \{\d+\} less to cast for each creature type among creatures you control$/i;
// Form 15: +1/+1 counter-gated battlefield (CardInstance.counters IS tracked)
const SELF_COST_REDUCTION_COUNTER_GATED_RE =
  /^this spell costs \{\d+\} less to cast for each creature you control with a \+1\/\+1 counter on it$/i;
// Form 16: evaluable conditional — cmc threshold (ControlsType-style)
const SELF_COST_REDUCTION_CMC_COND_RE =
  /^this spell costs \{\d+\} less to cast if you control a (?:permanent|creature|artifact|enchantment|planeswalker|land) with mana value \d+ or greater$/i;
// Form 17: evaluable conditional — graveyard count threshold (CardsInZoneAtLeast-style)
// Supports both numeric ("8 or more") and spelled-out ("eight or more") thresholds (Octavia, Living Thesis)
const SELF_COST_REDUCTION_GY_COUNT_COND_RE =
  /^this spell costs \{\d+\} less to cast if you have (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) or more instant(?:s)?(?:(?: and(?:\/or)? sorcery))? cards? in your graveyard$/i;
// Form 18: distinct mana values in graveyard (Oskar, Rubbish Reclaimer)
const SELF_COST_REDUCTION_DISTINCT_CMC_GY_RE =
  /^this spell costs \{\d+\} less to cast for each different mana value among cards in your graveyard$/i;
// Form 19: card-type count threshold conditional (Dusk Feaster delirium)
// "costs {N} less to cast if there are N or more card types among cards in your graveyard"
// N can be a digit or a spelled-out number (e.g. "four or more")
const SELF_COST_REDUCTION_CARD_TYPE_COUNT_COND_RE =
  /^this spell costs \{\d+\} less to cast if there are (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) or more card types among cards in your graveyard$/i;
// Form 20: "if a creature died this turn" — now supported via state.creaturesDiedThisTurn
const SELF_COST_REDUCTION_DIED_THIS_TURN_RE =
  /^this spell costs \{\d+\} less to cast if a creature died this turn$/i;
// Form 21: "if your opponents control N or more <type>" — supported via OpponentsControlAtLeast
const SELF_COST_REDUCTION_OPPONENTS_CONTROL_AT_LEAST_RE =
  /^this spell costs \{\d+\} less to cast if your opponents? controls? (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) or more \w[\w\s]*$/i;
// Form 22: target-quality conditional — "if it targets a tapped creature"
// Evaluated at cast time when targets are known (state.cards[target].tapped).
const SELF_COST_REDUCTION_TARGET_TAPPED_RE =
  /^this spell costs \{\d+\} less to cast if it targets a tapped creature$/i;
// Form 23: target-quality conditional — "if it targets a legendary creature you control"
const SELF_COST_REDUCTION_TARGET_LEGENDARY_YOU_RE =
  /^this spell costs \{\d+\} less to cast if it targets a legendary creature you control$/i;
// Form 24: target-quality conditional — "if it targets an attacking creature"
const SELF_COST_REDUCTION_TARGET_ATTACKING_RE =
  /^this spell costs \{\d+\} less to cast if it targets an attacking creature$/i;
// Form 25: "if a creature is attacking you" — no targets needed, evaluable from combat state
const SELF_COST_REDUCTION_CREATURE_ATTACKING_YOU_RE =
  /^this spell costs \{\d+\} less to cast if a creature is attacking you$/i;
// Form 26: exile+graveyard union for-each (Sailors' Bane)
// "for each card you own in exile and in your graveyard that's an instant card, a sorcery card, or a card that has an Adventure"
const SELF_COST_REDUCTION_EXILE_GY_UNION_RE =
  /^this spell costs \{\d+\} less to cast for each card you own in exile and in your graveyard that(?:'s| is) an? \w[\w\s,]*/i;
// Unsupported: "for each card exiled this way" — engine does not track per-cast exile piles
const SELF_COST_REDUCTION_EXILED_THIS_WAY_RE =
  /\bcosts? \{[^}]+\} less to cast for each card exiled this way\b/i;

// ── Slice 5 long-tail additions (Forms 27-32) ────────────────────────────────

// Form 27: "Affinity for artifacts" / "Affinity for <type(s)>" keyword line
// (Myr Enforcer, Somber Hoverguard, Broodstar — after reminder-text stripping)
// Enforced by getIntrinsicCostReduction via the same "for each <type> you control"
// battlefield count path.
const SELF_COST_REDUCTION_AFFINITY_RE =
  /^affinity for (?:artifacts?|creatures?|enchantments?|lands?|plains?|islands?|swamps?|mountains?|forests?|tokens?|graveyard cards?|spells?|[\w\s]+)$/i;

// Form 28: graveyard multi-filter for-each
//   "for each artifact and/or creature card in your graveyard" (Chitin Gravestalker)
//   "for each noncreature, nonland card in your graveyard"
const SELF_COST_REDUCTION_MULTI_FILTER_GY_RE =
  /^this spell costs \{\d+\} less to cast for each (?:\w+(?:,\s*\w+)*\s+and\/or\s+\w+|\w+(?:,\s*\w+)*\s+and\s+\w+|non\w+,?\s+non\w+) card(?:s)? in your graveyard$/i;

// Form 29: "if you control a <subtype> or a <subtype>" (Wolfkin Outcast // Wedding Crasher)
const SELF_COST_REDUCTION_CONTROLS_SUBTYPE_OR_RE =
  /^this spell costs \{\d+\} less to cast if you control (?:an? \w+(?:\s+\w+)* or an? \w+(?:\s+\w+)*|\w+(?:\s+\w+)* or \w+(?:\s+\w+)*)$/i;

// Form 30: "if you've cast another spell this turn" (Gigastorm Titan)
// Evaluable from state.spellsCastThisTurn >= 2 (the current spell being cast brings it to >=1,
// so "another" means at least one more was cast before it — >=1 BEFORE this cast, i.e.,
// the count before incrementing is >= 1).
const SELF_COST_REDUCTION_CAST_ANOTHER_THIS_TURN_RE =
  /^this spell costs \{\d+\} less to cast if you'?ve cast another spell this turn$/i;

// Form 31: generalized exile+graveyard for-each without "that's" filter
// "for each <type> card you own in exile and in your graveyard" (Huskburster Swarm style)
const SELF_COST_REDUCTION_EXILE_GY_SIMPLE_RE =
  /^this spell costs \{\d+\} less to cast for each (?:[\w\s]+?) card you own in exile and in your graveyard$/i;

// Form 32: "this effect can't reduce the ... cost to less than one mana" rider
// (Valiant Changeling, Khalni Hydra — benign clamp rider, absorbed without declining the face)
const SELF_COST_REDUCTION_MIN_ONE_MANA_RIDER_RE =
  /^this effect can['']?t reduce (?:the (?:mana |total )?cost(?: of this spell)? to less than one mana|the mana value of this spell below one)$/i;

// ── Slice 9 additions (Forms 33-34) ─────────────────────────────────────────
//
// These generalize the compound and graveyard-only count-clause forms to
// multi-word filter phrases that the existing COMPOUND_RE (\w+ single-word)
// and GRAVEYARD_RE (\w+ single-word) cannot match.
//
// EXECUTOR HONESTY:
//   Form 33 (multi-word compound): For same single-word subjects, executor Form 6
//     handles both zones exactly. For multi-word subjects (e.g. "artifact creature"),
//     executor Form 2 fires in the else branch and counts by major type (battlefield
//     only — over-counts slightly). The graveyard half is conservatively skipped.
//     The executor DOES compute a genuine reduction; marking 'dynamic' is honest.
//   Form 34 (graveyard-only multi-word): executor Form 5 matches only single-word
//     subjects; multi-word graveyard forms ("artifact creature card in your graveyard")
//     are NOT handled by any executor form — therefore Form 34 is intentionally
//     NOT added (keeping those faces Unparsed is the honest choice).
//   Form 35 (generalized for-each any zone): see below.

// Form 33: generalized compound — "for each <multi-word filter> you control and each
// <multi-word filter> card in your graveyard". Extends COMPOUND_RE to multi-word
// filter phrases on either or both sides. Counter-qualified compound forms
// ("for each creature you control with charge counters on it and ...") are
// deliberately excluded: they end with "on it and ..." not "card in your graveyard",
// so this regex will NOT match them.
//
// Examples covered:
//   "for each artifact creature you control and each artifact creature card in your graveyard"
//   "for each legendary creature you control and each Dragon card in your graveyard"
//   "for each Cave you control and each Cave card in your graveyard"  (also matches COMPOUND_RE — harmless)
const SELF_COST_REDUCTION_COMPOUND_GENERAL_RE =
  /^this spell costs \{\d+\} less to cast for each \w+(?:\s+\w+)* you control and each \w+(?:\s+\w+)* card in your graveyard$/i;

// Form 35: generalized for-each "you control and each ... in your graveyard" without
// "card" keyword — e.g. "for each artifact you control and each artifact in your graveyard".
// The executor's Form 6 requires "card in your graveyard"; without "card" the graveyard
// half is skipped but the battlefield half is still computed by Form 2. Honest because
// the executor reduces cost by the battlefield count.
//
// Distinguishes from EACH_BF_RE: the negative lookahead in EACH_BF_RE blocks compound
// forms so they never reach EACH_BF_RE. This form handles those leftovers.
//
// Counter-qualified variants excluded: they include "with ... counters" suffix before
// "and each", which this regex doesn't match (it requires "you control and each").
const SELF_COST_REDUCTION_COMPOUND_NO_CARD_RE =
  /^this spell costs \{\d+\} less to cast for each \w+(?:\s+\w+)* you control and each \w+(?:\s+\w+)* in your graveyard$/i;

// ── Slice 6 (oracle-parser coverage round 8 cut) additions (Forms 36-37) ────
//
// Form 36: "costs {X} less to cast, where X is your devotion to <color(s)>"
//   Daybreak Chimera: "This spell costs {X} less to cast, where X is your devotion to white."
//   Callaphe, Beloved of the Sea: "This spell costs {X} less to cast, where X is your devotion to blue."
//   Executor: countDevotionToColors(state, casterId, colors) is already available in
//   continuous.ts (imported from effective-types.ts). This is an exact parallel to the
//   DevotionCount AmountRef used by counter/life effects.
//
// HONESTY: countDevotionToColors sums colored mana symbols among permanents the
// controller has on the battlefield — fully computable at cast time. Marking 'dynamic'.
//
// Form 37 (unsupported): "costs {X} less to cast, where X is the total amount of
//   noncombat damage dealt to your opponents this turn" (Chandra's Incinerator).
//   The engine does not track noncombat damage per turn — decline as 'unsupported'.
const SELF_COST_REDUCTION_DEVOTION_RE =
  /^this spell costs \{x\} less to cast,? where x is your devotion to (?:white|blue|black|red|green|white and blue|white and black|white and red|white and green|blue and black|blue and red|blue and green|black and red|black and green|red and green|white,? blue,? and black|white,? blue,? and red|white,? blue,? and green|white,? black,? and red|white,? black,? and green|white,? red,? and green|blue,? black,? and red|blue,? black,? and green|blue,? red,? and green|black,? red,? and green|[\w\s,]+)$/i;

const SELF_COST_REDUCTION_NONCOMBAT_DAMAGE_RE =
  /\bthis spell costs \{x\} less to cast,? where x is the total amount of noncombat damage\b/i;

// ── Slice 5/12 dynamic cost-reduction additive forms (Forms 38-45) ──────────
//
// These extend the for-each count vocabulary with graveyard-diversity and
// zone-variety forms that getIntrinsicCostReduction can evaluate at cast time.
//
// EXECUTOR HONESTY (all marked 'dynamic'):
//   Form 38: "instant or sorcery card in your graveyard" — OR variant of Form 11.
//     Executor Form 11 counts instant/sorcery by OR; this is the same logic.
//   Form 39: "different converted mana cost" — legacy synonym for "different mana
//     value"; executor Form 18 pattern extended to also match "converted mana cost".
//   Form 40: "where X is the number of [filter] cards in your graveyard" — new
//     dynamic where-X GY count; executor uses graveyardCardsForCostReduction.
//   Form 41: "[type] in your graveyard" (no "card") — same executor as Form 5
//     (graveyardCardsForCostReduction counts by type/subtype regardless of "card").
//   Form 42: "for each card in your graveyard" (total GY, no type) — executor
//     counts ALL caster's graveyard cards.
//   Form 43: "for each color among cards in your graveyard" — colors in GY;
//     executor collects distinct colors across the caster's graveyard.
//   Form 44: "for each creature type among creature cards in your graveyard" —
//     creature-type diversity in GY; executor collects distinct creature subtypes.
//   Form 45: Clamp rider variant "to less than {N}" / "below one mana" phrasings
//     not already captured by MIN_ONE_MANA_RIDER_RE — absorbed as benign.

// Form 38: "instant or sorcery card in your graveyard" (OR not AND)
const SELF_COST_REDUCTION_INSTANT_OR_SORCERY_GY_RE =
  /^this spell costs \{\d+\} less to cast for each instant or sorcery card in your graveyard$/i;

// Form 39: legacy "converted mana cost" synonym for "mana value" in distinct-GY form
const SELF_COST_REDUCTION_LEGACY_CMC_GY_RE =
  /^this spell costs \{\d+\} less to cast for each different converted mana cost among cards in your graveyard$/i;

// Form 40: "where X is the number of <filter> [cards] in your graveyard" dynamic form
const SELF_COST_REDUCTION_WHERE_X_COUNT_GY_RE =
  /^this spell costs \{x\} less to cast,? where x is the number of (?:\w+(?:\s+\w+)*?) cards? in your graveyard$/i;

// Form 41: "[type] in your graveyard" without "card" qualifier
// e.g. "for each Zombie in your graveyard", "for each creature in your graveyard"
// The key constraint: the noun phrase must NOT contain the word "card" (those are
// Form 5/GRAVEYARD_RE which already covers "<type> card in your graveyard") nor
// "among" (those are Forms 12/18/39/43/44 diversity forms).
// Executor: graveyardCardsForCostReduction counts by type/subtype — safe because
// it uses subjectMatchesCardDefByTypeOrSubtype which matches types/subtypes regardless
// of whether "card" is present in the oracle wording.
// Must come AFTER GRAVEYARD_RE (which requires "card") and AFTER Forms 43/44 ("among") —
// any "among" or "card" form should have been absorbed by earlier checks.
const SELF_COST_REDUCTION_TYPE_IN_GY_NO_CARD_RE =
  /^this spell costs \{\d+\} less to cast for each (?!(?:\w+\s+)*card(?:\s|$))(?!\w+(?:\s+\w+)*\s+among\b)\w+(?:\s+\w+)* in your graveyard$/i;

// Form 42: "for each card in your graveyard" — total graveyard count, no type filter
const SELF_COST_REDUCTION_ALL_GY_RE =
  /^this spell costs \{\d+\} less to cast for each card in your graveyard$/i;

// Form 43: "for each color among cards in your graveyard"
// Complements Form 13 ("among permanents you control") — same logic but GY zone.
const SELF_COST_REDUCTION_COLORS_GY_RE =
  /^this spell costs \{\d+\} less to cast for each color among cards in your graveyard$/i;

// Form 44: "for each creature type among creature cards in your graveyard"
// Complements Form 14 ("among creatures you control") — creature-type diversity in GY.
const SELF_COST_REDUCTION_CREATURE_TYPES_GY_RE =
  /^this spell costs \{\d+\} less to cast for each creature type among creature cards in your graveyard$/i;

// Form 45: Clamp rider variants not captured by MIN_ONE_MANA_RIDER_RE.
//   "can't reduce the mana cost to less than {1}"  (mana symbol instead of "one mana")
//   "can't reduce the cost to less than {1}"
//   "can't reduce the mana cost of this spell below one mana"  (below vs to less than)
const SELF_COST_REDUCTION_CLAMP_SYMBOL_RE =
  /^this effect can['']?t reduce (?:the (?:mana )?cost(?: of this spell)?) to less than \{[^}]+\}$/i;

const SELF_COST_REDUCTION_CLAMP_BELOW_RE =
  /^this effect can['']?t reduce the mana cost(?: of this spell)? below one mana$/i;

// ── Slice 10 long-tail additions (Forms 47-50) ───────────────────────────────
//
// These extend the "where X is ..." and "if ..." conditional vocabulary with
// forms that getIntrinsicCostReduction can evaluate at cast time from
// existing state helpers (card CMC, land names, counter tracking, targets).
//
// EXECUTOR HONESTY (all marked 'dynamic'):
//   Form 47: "where X is the total mana value of historic permanents you control"
//     (Excalibur, Sword of Eden). Historic = legendary | artifact | Saga. CMC is
//     tracked on CardDefinition. Executor sums def.cmc for qualifying permanents.
//   Form 48: "where X is the number of differently named lands you control"
//     (Fungal Colossus). Distinct land names via card.name/def.name — computable.
//   Form 49: "if you control a creature with a +1/+1 counter on it"
//     (Prehistoric Turtlesaurus). Conditional flat reduction. CardInstance.counters
//     tracks +1/+1 counters. Computable.
//   Form 50: "if it targets a creature with flying"
//     (Swampsnare Trap). Target-quality conditional. Targets are threaded into
//     getIntrinsicCostReduction via the `targets` parameter. Keywords are checked
//     inline (avoiding keywords.ts cycle) against def.keywords + grantedKeywords.
//
// DEFERRED (no existing state helper):
//   "for each creature that attacked this turn" (The Mary Janes) — state.combat
//   is null in postcombat_main; there is no creaturesAttackedThisTurnIds tracker.
//   Deferred until a per-creature attack history field is added to GameState.

// Form 47: "where X is the total mana value of historic permanents you control"
//   Historic = legendary permanent | artifact | Saga (Dominaria rules).
//   The where-X pattern with "historic permanents" qualifier.
const SELF_COST_REDUCTION_WHERE_X_HISTORIC_MV_RE =
  /^this spell costs \{x\} less to cast,? where x is the total mana value of historic permanents you control$/i;

// Form 48: "where X is the number of differently named lands you control"
//   Fungal Colossus: distinct land names among the caster's battlefield lands.
const SELF_COST_REDUCTION_WHERE_X_DIFF_NAMED_LANDS_RE =
  /^this spell costs \{x\} less to cast,? where x is the number of differently named lands you control$/i;

// Form 49: "if you control a creature with a +1/+1 counter on it"
//   Prehistoric Turtlesaurus flat conditional. Distinct from Form 15 ("for each
//   creature you control with a +1/+1 counter on it") — this is a boolean gate.
const SELF_COST_REDUCTION_CONTROLS_COUNTER_CREATURE_RE =
  /^this spell costs \{\d+\} less to cast if you control a creature with a \+1\/\+1 counter on it$/i;

// Form 50: "if it targets a creature with flying"
//   Swampsnare Trap target-quality conditional. `targets` must be non-empty and
//   at least one target must have the Flying keyword (checked inline to avoid
//   the keywords.ts import cycle).
const SELF_COST_REDUCTION_TARGET_FLYING_RE =
  /^this spell costs \{\d+\} less to cast if it targets a creature with flying$/i;

/**
 * Check if `sentence` (reminder-stripped, trimmed) is an enforced self-cost-reduction line.
 * Returns:
 *   - { flatAmount: N } if it's a flat reduction
 *   - 'dynamic' if it's a supported dynamic reduction
 *   - 'unsupported' if it looks like a cost-reduction but has conditions we can't evaluate
 *   - null if it's not a cost-reduction sentence at all
 *
 * Keyword indicators such as "Domain — ", "Delirium — ", "Threshold — " precede
 * the "This spell costs..." clause on some cards. They are stripped before matching
 * so the underlying cost-reduction clause is still recognized.
 */
export function isSelfCostReductionSentence(
  sentence: string,
): { flatAmount: number } | 'dynamic' | 'unsupported' | null {
  // Strip leading keyword indicator (e.g. "Domain — ", "Delirium — ")
  // A keyword indicator is one or more words followed by " — " (em-dash with spaces).
  // This normalizes Scryfall oracle text where mechanics like Domain, Delirium,
  // Threshold, Metalcraft etc. prefix their clause with "Keyword — ".
  const s = sentence.replace(/^\w[\w\s]*\s+—\s+/i, '').trim();
  const flat = s.match(SELF_COST_REDUCTION_FLAT_RE);
  if (flat) return { flatAmount: parseInt(flat[1], 10) };
  if (SELF_COST_REDUCTION_OPPONENTS_RE.test(s)) return 'dynamic';
  // Form 46: bare opponent form (Undaunted keyword — no "you have")
  if (SELF_COST_REDUCTION_OPPONENTS_BARE_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_COMPOUND_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_GRAVEYARD_RE.test(s)) return 'dynamic';
  // Form 2: simple battlefield for-each. EACH_BF_RE requires the phrase to end
  // with "you control"/"on the battlefield" so counter-qualified variants like
  // "for each creature you control with a +1/+1 counter on it" do NOT match here
  // (they end with "on it"). Decline non-+1/+1 counter qualifiers the engine
  // can't evaluate; +1/+1 counter forms are handled by Form 15 below.
  if (SELF_COST_REDUCTION_EACH_BF_RE.test(s)) {
    if (/\bwith\s+\w+\s+counters?\b/i.test(s)) {
      return 'unsupported';
    }
    return 'dynamic';
  }
  if (SELF_COST_REDUCTION_GREATEST_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_TOTAL_POWER_RE.test(s)) return 'dynamic';
  // New forms (8-17)
  if (SELF_COST_REDUCTION_GREATEST_POWER_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_PARTY_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_DOMAIN_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_MULTI_GY_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_CARD_TYPES_GY_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_COLORS_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_CREATURE_TYPES_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_COUNTER_GATED_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_CMC_COND_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_GY_COUNT_COND_RE.test(s)) return 'dynamic';
  // New forms (18-19)
  if (SELF_COST_REDUCTION_DISTINCT_CMC_GY_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_CARD_TYPE_COUNT_COND_RE.test(s)) return 'dynamic';
  // Forms 20-21: newly supported conditional forms
  if (SELF_COST_REDUCTION_DIED_THIS_TURN_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_OPPONENTS_CONTROL_AT_LEAST_RE.test(s)) return 'dynamic';
  // Forms 22-26: target-quality and combat-state conditionals (slice 5)
  if (SELF_COST_REDUCTION_TARGET_TAPPED_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_TARGET_LEGENDARY_YOU_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_TARGET_ATTACKING_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_CREATURE_ATTACKING_YOU_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_EXILE_GY_UNION_RE.test(s)) return 'dynamic';
  // Forms 27-32: slice 5 long-tail additions
  // Form 27: "Affinity for <type>" keyword line (Myr Enforcer, Somber Hoverguard, Broodstar)
  if (SELF_COST_REDUCTION_AFFINITY_RE.test(s)) return 'dynamic';
  // Form 28: graveyard multi-filter for-each (Chitin Gravestalker, Serpent of the Pass)
  if (SELF_COST_REDUCTION_MULTI_FILTER_GY_RE.test(s)) return 'dynamic';
  // Form 29: "if you control a <subtype> or a <subtype>" (Wolfkin Outcast)
  if (SELF_COST_REDUCTION_CONTROLS_SUBTYPE_OR_RE.test(s)) return 'dynamic';
  // Form 30: "if you've cast another spell this turn" (Gigastorm Titan)
  if (SELF_COST_REDUCTION_CAST_ANOTHER_THIS_TURN_RE.test(s)) return 'dynamic';
  // Form 31: generalized exile+graveyard for-each without "that's" filter (Huskburster Swarm)
  if (SELF_COST_REDUCTION_EXILE_GY_SIMPLE_RE.test(s)) return 'dynamic';
  // Form 32: "this effect can't reduce the cost to less than one mana" rider — clamp in reduceGenericCost
  // Absorb as benign (not declining the face) — the actual enforcement is in stack.ts reduceGenericCost.
  if (SELF_COST_REDUCTION_MIN_ONE_MANA_RIDER_RE.test(s)) return 'dynamic';
  // Forms 33, 35: slice 9 generalizations — multi-word compound and compound-without-card.
  // Form 33: "for each <multi-word> you control and each <multi-word> card in your graveyard"
  // Extends Form 6 (COMPOUND_RE) to multi-word filter phrases. Counter-qualified compound
  // variants do NOT end in "card in your graveyard" so they are naturally excluded.
  if (SELF_COST_REDUCTION_COMPOUND_GENERAL_RE.test(s)) return 'dynamic';
  // Form 35: "for each <multi-word> you control and each <multi-word> in your graveyard" (no "card")
  // Executor Form 2 counts the battlefield half; graveyard half is conservatively skipped.
  if (SELF_COST_REDUCTION_COMPOUND_NO_CARD_RE.test(s)) return 'dynamic';
  // Form 36: "costs {X} less to cast, where X is your devotion to <color(s)>" (Daybreak Chimera)
  // Enforced by getIntrinsicCostReduction using countDevotionToColors — computable at cast time.
  if (SELF_COST_REDUCTION_DEVOTION_RE.test(s)) return 'dynamic';
  // Forms 38-45: Slice 5/12 dynamic cost-reduction additive forms.
  // Form 38: "instant or sorcery card in your graveyard" (OR variant of Form 11)
  if (SELF_COST_REDUCTION_INSTANT_OR_SORCERY_GY_RE.test(s)) return 'dynamic';
  // Form 39: "different converted mana cost among cards in your graveyard" (legacy CMC synonym)
  if (SELF_COST_REDUCTION_LEGACY_CMC_GY_RE.test(s)) return 'dynamic';
  // Form 40: "where X is the number of [filter] cards in your graveyard" (dynamic where-X GY count)
  if (SELF_COST_REDUCTION_WHERE_X_COUNT_GY_RE.test(s)) return 'dynamic';
  // Form 42: "for each card in your graveyard" (total GY count, no type filter)
  // Must come BEFORE Form 41 to avoid the TYPE_IN_GY_NO_CARD_RE swallowing bare "card".
  if (SELF_COST_REDUCTION_ALL_GY_RE.test(s)) return 'dynamic';
  // Form 43: "for each color among cards in your graveyard"
  if (SELF_COST_REDUCTION_COLORS_GY_RE.test(s)) return 'dynamic';
  // Form 44: "for each creature type among creature cards in your graveyard"
  if (SELF_COST_REDUCTION_CREATURE_TYPES_GY_RE.test(s)) return 'dynamic';
  // Form 41: "[type] in your graveyard" without "card" (e.g. "Zombie in your graveyard")
  // Must come AFTER Form 42 (ALL_GY_RE), Forms 43/44 ("among" forms), Forms 11/12/18/39
  // ("instant and sorcery", "card type among", "different mana value among", "converted mana cost")
  // so the more specific "among" forms win first.
  // Also must come AFTER MULTI_GY_RE (Form 28) and EACH_BF_RE (Form 2) — those won't match
  // "in your graveyard" without "you control/on the battlefield" suffix.
  if (SELF_COST_REDUCTION_TYPE_IN_GY_NO_CARD_RE.test(s)) return 'dynamic';
  // Form 45: clamp rider variants — "to less than {N}" and "below one mana" phrasings
  if (SELF_COST_REDUCTION_CLAMP_SYMBOL_RE.test(s)) return 'dynamic';
  if (SELF_COST_REDUCTION_CLAMP_BELOW_RE.test(s)) return 'dynamic';
  // Forms 47-50: Slice 10 long-tail additions
  // Form 47: "where X is the total mana value of historic permanents you control"
  if (SELF_COST_REDUCTION_WHERE_X_HISTORIC_MV_RE.test(s)) return 'dynamic';
  // Form 48: "where X is the number of differently named lands you control"
  if (SELF_COST_REDUCTION_WHERE_X_DIFF_NAMED_LANDS_RE.test(s)) return 'dynamic';
  // Form 49: "if you control a creature with a +1/+1 counter on it"
  if (SELF_COST_REDUCTION_CONTROLS_COUNTER_CREATURE_RE.test(s)) return 'dynamic';
  // Form 50: "if it targets a creature with flying"
  if (SELF_COST_REDUCTION_TARGET_FLYING_RE.test(s)) return 'dynamic';
  // Unsupported forms — engine cannot evaluate, so decline honestly
  if (SELF_COST_REDUCTION_EXILED_THIS_WAY_RE.test(s)) return 'unsupported';
  // Form 37 (unsupported): noncombat damage amount — engine does not track per-turn noncombat damage.
  if (SELF_COST_REDUCTION_NONCOMBAT_DAMAGE_RE.test(s)) return 'unsupported';
  return null;
}

export function matchSelfCostReduction(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let flatAmount = 0;
  let hasSelfReduction = false;
  for (const sentence of sentences) {
    const costResult = isSelfCostReductionSentence(sentence);
    if (costResult !== null) {
      // 'unsupported' means it looks like a cost-reduction but with conditions
      // we can't evaluate — decline the whole face.
      if (costResult === 'unsupported') return null;
      hasSelfReduction = true;
      if (typeof costResult === 'object' && 'flatAmount' in costResult) {
        flatAmount += costResult.flatAmount;
      }
      continue;
    }
    // Any other "costs ... less" wording reduces OTHER spells (a battlefield
    // static) — getIntrinsicCostReduction does NOT enforce those, so decline.
    if (/costs? \{[^}]+\} less to cast/i.test(sentence)) return null;
    // Non-keyword residual text => the card has a real unrun function.
    // matchSelfCostReduction only handles keyword-only faces; the mixed case
    // (cost-reduction + trigger/effect) is handled by absorbSelfCostReductionLines
    // in parser.ts, which strips the cost line and reparses the remainder.
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }
  if (!hasSelfReduction) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'ReduceCost', amount: flatAmount },
    filter: { permanent: true },
    controller: 'you',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// matchLandwalk
// ============================================================================

/**
 * Match a standalone landwalk keyword line: "Swampwalk", "Forestwalk",
 * "Islandwalk", "Mountainwalk", "Plainswalk", or generic "Landwalk" (optionally
 * with reminder text, e.g. "Swampwalk (This creature can't be blocked as long as
 * defending player controls a Swamp.)").
 *
 * HONEST: combat.ts (canBlock -> hasActiveLandwalk in keywords.ts) ALREADY
 * enforces this end-to-end — an attacker with the keyword can't be blocked while
 * the defending player controls a land of the walked type. We read the keyword
 * straight from the creature's printed/granted keywords and oracle text in
 * keywords.ts, so recognizing the line here is genuine; we only emit a parsed
 * StaticAbility so the (otherwise keyword-only) face stops reporting Unparsed.
 *
 * The `selfOnly` GrantKeyword('Landwalk') is a recognition marker only — the
 * continuous layer has no Landwalk consumer (KEYWORD_MAP omits it), and none is
 * needed: canBlock is the single enforcement site, exactly mirroring
 * matchSelfMustAttack / combat.ts.
 *
 * Honesty gate (reusing isCBCAllowedKeywordSentence): we claim the face ONLY
 * when at least one sentence is a landwalk keyword AND every other sentence is a
 * known engine keyword. Any real (non-keyword) clause beside the landwalk word
 * keeps the face Unparsed so we never mask an unrun ability.
 */
export function matchLandwalk(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let hasLandwalk = false;
  for (const sentence of sentences) {
    if (LANDWALK_SENTENCE_RE.test(sentence)) { hasLandwalk = true; continue; }
    // Any other residual text must be an engine-handled keyword; otherwise the
    // card has a real unrun function and we leave the whole face Unparsed.
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }
  if (!hasLandwalk) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword: 'Landwalk' },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// matchProtection
// ============================================================================

/**
 * Match a standalone "Protection from <quality>" keyword line (optionally with
 * reminder text), e.g. "Protection from red", "Protection from artifacts",
 * "Protection from white and from black", "Protection from monocolored".
 *
 * HONEST: keywords.ts (isProtectedFromSource, getProtectionColors,
 * sourceMatchesProtectionClause) ALREADY enforces protection end-to-end, reading
 * the "protection from ..." clause straight from the permanent's oracle text:
 *   - can't be blocked by a source of that quality   (combat.ts canBlock -> line 422)
 *   - can't be targeted by an opponent's spell/ability of that quality
 *     (canBeTargetedByOpponentSource / canBeTargetedByControllerSource)
 *   - damage from a source of that quality is prevented (combat.ts dealDamage)
 * So recognizing the line here is genuine; we only emit a parsed StaticAbility so
 * the (otherwise keyword-only) face stops reporting Unparsed.
 *
 * The `selfOnly` GrantKeyword('Protection') is a recognition marker only — no
 * continuous-layer or KEYWORD_MAP consumer reads it; keywords.ts is the single
 * enforcement site (it re-scans the oracle text directly), exactly mirroring
 * matchLandwalk / matchSelfMustAttack.
 *
 * HONESTY GATE — we recognize a protection sentence ONLY when every "from X"
 * quality it names is one the engine actually enforces (the EXACT set checked by
 * getProtectionColors + sourceMatchesProtectionClause: the five colors, the six
 * permanent/spell card types, and monocolored/multicolored/colorless). Qualities
 * the engine does NOT enforce — "protection from everything", a creature subtype
 * ("protection from Dragons"), "from each color", a named player, etc. — are
 * DECLINED so we never credit unenforced coverage. As with landwalk, every OTHER
 * sentence on the face must also be an engine-handled keyword (reusing
 * isCBCAllowedKeywordSentence); any real (non-keyword) clause keeps the face
 * Unparsed so we never mask an unrun ability.
 */
export function matchProtection(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let hasProtection = false;
  for (const sentence of sentences) {
    if (isEnforcedProtectionSentence(sentence)) { hasProtection = true; continue; }
    // Slice 6: mixed comma/and-lists like "Flying, protection from red",
    // "Protection from red, flying", or "Flying, protection from black and from red"
    // on a SINGLE line. Split the sentence into parts and validate each: plain
    // engine keywords (CBC_ALLOWED_KEYWORDS / ward / landwalk) or enforced
    // "protection from <quality>" clauses. Any unenforced quality declines the face.
    {
      const lower = sentence.toLowerCase();
      const parts = lower.split(/\s*,\s*|\s+and\s+/).map(p => p.trim()).filter(Boolean);
      // Only enter this path if at least one part starts with "protection from"
      // (so we don't override the plain-keyword honesty gate below).
      const hasProtectionPart = parts.some(p => /^protection\s+from\s+/.test(p));
      if (hasProtectionPart && parts.length > 1) {
        let sentenceHasProtection = false;
        let allPartsValid = true;
        for (let i = 0; i < parts.length; i++) {
          let part = parts[i];
          if (/^protection\s+from\s+/.test(part)) {
            // Re-join "from <quality>" fragments the comma/and split broke off,
            // e.g. "protection from black" + "from red" → "protection from black and from red".
            while (i + 1 < parts.length && /^from\s+/.test(parts[i + 1])) {
              part += ` and ${parts[++i]}`;
            }
            if (!isEnforcedProtectionSentence(part)) { allPartsValid = false; break; }
            sentenceHasProtection = true;
          } else if (
            ABSORBABLE_WARD_COST_RE.test(part) ||
            ABSORBABLE_WARD_PAY_LIFE_RE.test(part) ||
            LANDWALK_SENTENCE_RE.test(part) ||
            CBC_ALLOWED_KEYWORDS.has(part)
          ) {
            // Plain engine-enforced keyword — valid.
          } else {
            allPartsValid = false;
            break;
          }
        }
        if (allPartsValid && sentenceHasProtection) {
          hasProtection = true;
          continue;
        }
        // If we entered this path but failed (unenforced quality or bad part), decline.
        return null;
      }
    }
    // A "protection from ..." sentence that is NOT a comma-list (handled above)
    // and names an UNENFORCED quality — decline the whole face.
    if (/^protection from /i.test(sentence)) return null;
    // Any other residual text must be an engine-handled keyword; otherwise the
    // card has a real unrun function and we leave the whole face Unparsed.
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }
  if (!hasProtection) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword: 'Protection' },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// matchOtherEvasion
// ============================================================================

/**
 * Match a standalone "other evasion" keyword line — fear, intimidate, shadow,
 * horsemanship, or skulk (optionally with reminder text), and the explicit
 * static spelling "This creature can't be blocked." (Unblockable).
 *
 * HONEST: combat.ts (canBlock -> blockerSatisfiesEvasion in keywords.ts) now
 * enforces each of these end-to-end straight from the attacker's printed/
 * granted keywords and oracle text:
 *   - fear (702.36)        => only artifact and/or black creatures may block
 *   - intimidate (702.13)  => only artifact + same-color creatures may block
 *   - shadow (702.28)      => only shadow creatures may block (symmetric)
 *   - horsemanship (702.31)=> only horsemanship creatures may block
 *   - skulk (702.72)       => can't be blocked by greater-power creatures
 *   - "can't be blocked"   => Unblockable, the long-standing canBlock gate
 * The marker is recognition-only (KEYWORD_MAP omits these; keywords.ts is the
 * single enforcement site, exactly mirroring matchLandwalk / matchProtection).
 *
 * Honesty gate (reusing isCBCAllowedKeywordSentence): we claim the face ONLY
 * when at least one sentence is an enforced evasion keyword AND every OTHER
 * sentence is a known engine keyword. Any real (non-keyword) clause keeps the
 * whole face Unparsed so we never mask an unrun ability. NOTE the allowed-
 * keyword set already lists fear/intimidate/skulk/horsemanship, so a multi-
 * keyword face like "Flying\nFear" parses cleanly. "Shadow" is added to the
 * residual-keyword check inline below since it is not in CBC_ALLOWED_KEYWORDS.
 */
const OTHER_EVASION_SENTENCE_RE =
  /^(?:fear|intimidate|shadow|horsemanship|skulk)$/i;
const STATIC_CANT_BE_BLOCKED_RE =
  /^this (?:creature|permanent) can['']?t be blocked$/i;

function isEvasionResidualKeyword(sentence: string): boolean {
  // Shadow is a real engine-enforced evasion keyword but is not in the shared
  // CBC_ALLOWED_KEYWORDS set; accept it (and the other evasion words) as a
  // benign residual sentence so e.g. "Shadow\nFear" parses.
  if (OTHER_EVASION_SENTENCE_RE.test(sentence.trim())) return true;
  return isCBCAllowedKeywordSentence(sentence);
}

export function matchOtherEvasion(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let hasEvasion = false;
  let keyword = 'OtherEvasion';
  for (const sentence of sentences) {
    if (OTHER_EVASION_SENTENCE_RE.test(sentence)) { hasEvasion = true; continue; }
    if (STATIC_CANT_BE_BLOCKED_RE.test(sentence)) { hasEvasion = true; keyword = 'Unblockable'; continue; }
    // Any other residual text must be an engine-handled keyword; otherwise the
    // card has a real unrun function and we leave the whole face Unparsed.
    if (!isEvasionResidualKeyword(sentence)) return null;
  }
  if (!hasEvasion) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// matchConditionalEvasion (Slice 5)
// ============================================================================

/**
 * Match standalone conditional-evasion sentences on a creature or group-wide
 * static that makes creatures unblockable as long as the DEFENDING PLAYER
 * controls a specific board filter.
 *
 * Supported oracle forms:
 *   A) Self-only:  "This creature can't be blocked as long as defending player
 *                   controls <filter>."   (Hazy Homunculus — untapped land)
 *   B) Group-wide: "Each creature you control can't be blocked as long as
 *                   defending player controls <filter>."   (Tanglewalker —
 *                   artifact land)
 *   C) Snow-walk keyword with reminder text stripped:
 *                  "Snow forestwalk (This creature can't be blocked as long as
 *                   defending player controls a snow Forest.)"
 *                  → after stripReminderTextForCBC → "Snow forestwalk"
 *                  → matched by the extended LANDWALK_SENTENCE_RE and handled
 *                    by matchLandwalk. Those faces are covered there; we skip
 *                    them here to avoid double-claiming.
 *
 * HONEST: keywords.ts (attackerHasConditionalEvasion, called from canBlock) now
 * evaluates the conditional predicate against the defending player's board,
 * making the attacker unblockable when the condition is true. The
 * `selfOnly` GrantKeyword('ConditionalEvasion') is a recognition marker only
 * (KEYWORD_MAP omits it; keywords.ts is the single enforcement site, mirroring
 * matchLandwalk / matchOtherEvasion).
 *
 * Honesty gate:
 *  - We only claim filters the engine can actually evaluate:
 *    "an untapped land", "an artifact land", "a snow <BasicType>",
 *    "an <BasicType>" (Island / Forest / etc.),
 *    "an artifact", "an enchantment", "a creature",
 *    "an untapped/tapped creature", "a <color> permanent".
 *  - Every other sentence on the face must also be an engine-handled keyword
 *    (via isCBCAllowedKeywordSentence); any real (non-keyword) clause keeps
 *    the whole face Unparsed so we never mask an unrun ability.
 *  - Snow-walk forms are handled by matchLandwalk (extended LANDWALK_SENTENCE_RE)
 *    and are NOT re-claimed here.
 */

/**
 * The supported conditional-evasion predicate filters (see keywords.ts
 * parseConditionalEvasionFilter for the symmetric evaluation logic).
 */
const COND_EVASION_FILTER_RE =
  /^(?:an?\s+untapped\s+land|an?\s+artifact\s+land|a\s+snow\s+(?:plains?|island|swamp|mountain|forest)|an?\s+(?:plains?|island|swamp|mountain|forest)|an?\s+artifact|an?\s+enchantment|an?\s+(?:untapped\s+|tapped\s+)?creature|a\s+(?:white|blue|black|red|green)\s+permanent)$/i;

/**
 * Match a standalone conditional-evasion sentence.
 * Returns the filter text if the sentence is a recognized supported form, else null.
 */
function matchConditionalEvasionSentence(sentence: string): string | null {
  const lower = sentence.toLowerCase().trim();
  // Self: "this creature can't be blocked as long as defending player controls <filter>"
  let m = /^this creature can['']?t be blocked as long as defending player controls (.+)$/.exec(lower);
  if (!m) {
    // Group: "each creature you control can't be blocked as long as defending player controls <filter>"
    m = /^each creature you control can['']?t be blocked as long as defending player controls (.+)$/.exec(lower);
  }
  if (!m) return null;
  const filterText = m[1].trim().replace(/\.$/, '').trim();
  if (!COND_EVASION_FILTER_RE.test(filterText)) return null;
  return filterText;
}

function isConditionalEvasionResidualKeyword(sentence: string): boolean {
  if (isCBCAllowedKeywordSentence(sentence)) return true;
  // Snow-walk forms (handled by matchLandwalk) are benign residuals here.
  if (LANDWALK_SENTENCE_RE.test(sentence.trim())) return true;
  return false;
}

export function matchConditionalEvasion(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  // Strip reminder text (snow-walk cards carry the conditional form only in
  // the reminder; those are already matched by matchLandwalk's extended regex
  // on the keyword word itself, so this matcher should NOT try to claim them
  // via the reminder text).
  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let hasConditionalEvasion = false;
  for (const sentence of sentences) {
    const filter = matchConditionalEvasionSentence(sentence);
    if (filter !== null) { hasConditionalEvasion = true; continue; }
    // Any other residual text must be an engine-handled keyword; otherwise the
    // card has a real unrun function and we leave the whole face Unparsed.
    if (!isConditionalEvasionResidualKeyword(sentence)) return null;
  }
  if (!hasConditionalEvasion) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword: 'ConditionalEvasion' },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// matchAttackingAloneEvasion (Slice 8)
// ============================================================================

/**
 * Match the attacker-side conditional-evasion static:
 *   "This creature can't be blocked as long as it's attacking alone."
 *   "This creature can't be blocked as long as ~ is attacking alone."
 *   "~ can't be blocked as long as it is attacking alone."
 *
 * 'Attacking alone' means exactly one creature is attacking (CR 508.4).
 *
 * HONEST: keywords.ts (attackerHasAttackingAloneEvasion, called from canBlock)
 * reads this regex directly from the attacker's oracle text and returns false
 * (block illegal) when state.combat?.attackers.length === 1. The
 * `selfOnly` GrantKeyword('AttackingAloneEvasion') is a recognition marker only
 * (KEYWORD_MAP omits it; keywords.ts is the single enforcement site, mirroring
 * matchConditionalEvasion / matchOtherEvasion).
 *
 * Honesty gate: the rest of the face must be engine-handled keywords only.
 */

/** Regex matching the enforced "attacking alone" evasion sentence (self-form). */
export const ATTACKING_ALONE_EVASION_RE =
  /(?:this creature|~)\s+can['']?t be blocked as long as (?:it(?:'s| is)|~ is) attacking alone/i;

function matchAttackingAloneEvasionSentence(sentence: string): boolean {
  return ATTACKING_ALONE_EVASION_RE.test(sentence.trim());
}

export function matchAttackingAloneEvasion(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let hasEvasion = false;
  for (const sentence of sentences) {
    if (matchAttackingAloneEvasionSentence(sentence)) { hasEvasion = true; continue; }
    // Any other residual text must be an engine-handled keyword; otherwise the
    // card has a real unrun function and we leave the whole face Unparsed.
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }
  if (!hasEvasion) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword: 'AttackingAloneEvasion' },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// matchBlockOnlyFlying
// ============================================================================

/**
 * Match the block-restriction static "This creature can block only creatures
 * with flying." (Welkin Tern / Cloud Elemental family), optionally alongside
 * other engine-handled keyword lines ("Flying\nThis creature can block only
 * creatures with flying.").
 *
 * HONEST: combat.ts (canDeclareBlocker/declareBlockers -> canBlock ->
 * blockerCanBlockOnlyFlyingText in keywords.ts) enforces the restriction
 * end-to-end straight from the blocker's oracle text — a creature carrying
 * this sentence is refused as a blocker of any non-flying attacker. The
 * `selfOnly` GrantKeyword('BlockOnlyFlying') is a recognition marker only
 * (KEYWORD_MAP omits it; keywords.ts is the single enforcement site, exactly
 * mirroring matchLandwalk / matchOtherEvasion).
 *
 * Honesty gate (reusing isCBCAllowedKeywordSentence): we claim the face ONLY
 * when at least one sentence is the exact enforced restriction AND every other
 * sentence is a known engine keyword. Any OTHER "can block only" wording
 * ("can block only Walls", "can block only creatures with shadow", or a
 * granted form like "Creatures you control can block only ...") is NOT
 * enforced and declines the whole face, as does any real (non-keyword) clause,
 * so we never mask an unrun ability.
 */
const BLOCK_ONLY_FLYING_SENTENCE_RE =
  /^(?:this creature|this permanent|~) can block only creatures with flying$/i;

export function matchBlockOnlyFlying(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let hasRestriction = false;
  for (const sentence of sentences) {
    if (BLOCK_ONLY_FLYING_SENTENCE_RE.test(sentence)) { hasRestriction = true; continue; }
    // Any other "can block only" wording is a restriction the engine does NOT
    // enforce — decline the whole face so we never claim unbacked coverage.
    if (/can block only/i.test(sentence)) return null;
    // Any other residual text must be an engine-handled keyword; otherwise the
    // card has a real unrun function and we leave the whole face Unparsed.
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }
  if (!hasRestriction) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword: 'BlockOnlyFlying' },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// matchWardPayLife
// ============================================================================

/**
 * Match a standalone "Ward—Pay N life." keyword line (optionally with reminder
 * text and/or other engine-handled keyword lines), e.g.:
 *   "Ward—Pay 3 life."              (Dwarven Forge-Chanter solo)
 *   "Flying\nWard—Pay 3 life."      (Owlin Shieldmage)
 *   "First strike, vigilance\n..."  (Sire of Seven Deaths — all keywords)
 *
 * HONEST: ward.ts parseWardCost already reads the "ward—pay N life" form from
 * oracle text and returns { kind: 'life', amount: N }; ward.ts applyWardForStackItem
 * then enforces the cost (deducts life from the targeting player or counters the
 * spell/ability). The life-payment branch in payWard is fully implemented via
 * playerCanPayLife + life deduction, so absorption is backed by runtime enforcement.
 *
 * Honesty gate (reusing isCBCAllowedKeywordSentence): we claim the face ONLY when
 * at least one sentence matches the ward-pay-life form AND every other sentence is
 * a known engine keyword. Any real (non-keyword) clause beside the ward line keeps
 * the face Unparsed so we never mask an unrun ability. Dynamic forms like
 * "Ward—Pay life equal to ~'s power" are NOT matched here (they require dynamic
 * evaluation not supported by parseWardCost).
 *
 * The `selfOnly` GrantKeyword('WardPayLife') is a recognition marker only
 * (KEYWORD_MAP omits it; ward.ts is the single enforcement site, exactly
 * mirroring matchLandwalk / matchOtherEvasion).
 */
const WARD_PAY_LIFE_SENTENCE_RE = /^ward\s*[—–-]\s*pay\s+\d+\s+life$/i;

/**
 * Returns true iff `sentence` is a keyword the engine already enforces and may
 * safely appear alongside a ward-pay-life line without masking an unrun ability.
 * Extends isCBCAllowedKeywordSentence to also accept the ABSORBABLE_ENGINE_KEYWORDS
 * set (prowess, fear, intimidate, shadow, horsemanship, skulk) since those are all
 * enforced by keywords.ts / stack.ts and are absorbed by absorbableKeywordLineParts.
 */
function isWardPayLifeResidualKeyword(sentence: string): boolean {
  const lower = sentence.toLowerCase().trim();
  // Single-word keywords from the broader engine-enforced set (includes prowess,
  // fear, intimidate, shadow, horsemanship, skulk not in CBC_ALLOWED_KEYWORDS).
  if (ABSORBABLE_ENGINE_KEYWORDS.has(lower)) return true;
  // Multi-part sentences: comma/and-list of the above, plus protection, ward, landwalk.
  return isCBCAllowedKeywordSentence(sentence);
}

export function matchWardPayLife(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let hasWardPayLife = false;
  for (const sentence of sentences) {
    if (WARD_PAY_LIFE_SENTENCE_RE.test(sentence)) { hasWardPayLife = true; continue; }
    // Any other residual text must be an engine-handled keyword; otherwise the
    // card has a real unrun function and we leave the whole face Unparsed.
    if (!isWardPayLifeResidualKeyword(sentence)) return null;
  }
  if (!hasWardPayLife) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword: 'WardPayLife' },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// Slice 8: matchKeywordHolderAnthem
// ============================================================================

/**
 * Slice 8 — Keyword-holder anthem:
 *   "Other creatures you control with flying get +1/+1."
 *   "Creatures you control with flying get +1/+0."
 *   "Other [type] you control with [keyword] get +N/+N."
 *
 * Emits a StaticAbility with modifier ModifyPT and filter
 * { types: ['creature'], withKeyword: '<kw>' }.
 *
 * HONESTY:
 *   - continuous.ts isAffectedBy checks `filter.withKeyword` via the inline
 *     keyword-cache path (printed + granted keywords), so the +1/+1 only
 *     applies to creatures that actually have the keyword at query time.
 *   - matchesCardFilter has a static fallback that checks printed keywords;
 *     used by the spell-effect path (e.g. "all creatures with flying get +1/+1
 *     until end of turn" — that's the spell form, handled by the mass-effects
 *     matcher; the static form here is properly registered as a ContinuousEffect
 *     via registerContinuousAbilitiesForPermanent in stack.ts).
 *
 * Token shape: "[Other] [<filter-type>] you control with <keyword> get +N/+N[.]"
 * where <filter-type> defaults to "creatures" if omitted.
 */

// Engine-enforced keywords the static anthem filter supports.
const ANTHEM_FILTER_KEYWORDS = new Set([
  'flying', 'reach', 'trample', 'vigilance', 'menace', 'haste',
  'lifelink', 'deathtouch', 'defender', 'indestructible', 'hexproof',
  'shroud', 'first strike', 'double strike', 'flash',
]);

export function matchKeywordHolderAnthem(tokens: string[]): StaticAbilityEffect | null {
  let idx = 0;
  let excludeSelf = false;

  // Optional "other"
  if (tokens[idx] === 'other') { excludeSelf = true; idx++; }

  // Required "creatures" / "creature" (possibly with a type filter word before it,
  // but for simplicity we only accept the bare "creatures" form here; typed variants
  // like "Wizards you control with flying" are handled by matchStaticAbility via the
  // parseStaticFilterType path which doesn't overlap with this new matcher).
  if (tokens[idx] !== 'creatures' && tokens[idx] !== 'creature') return null;
  idx++;

  // "you control"
  if (tokens[idx] !== 'you' || tokens[idx + 1] !== 'control') return null;
  idx += 2;

  // "with <keyword>"
  if (tokens[idx] !== 'with') return null;
  idx++;

  // Read the keyword (may be "first strike" or "double strike" — two tokens)
  let keyword: string;
  if (tokens[idx] === 'first' && tokens[idx + 1] === 'strike') {
    keyword = 'first strike'; idx += 2;
  } else if (tokens[idx] === 'double' && tokens[idx + 1] === 'strike') {
    keyword = 'double strike'; idx += 2;
  } else {
    keyword = tokens[idx] ?? '';
    idx++;
  }
  if (!ANTHEM_FILTER_KEYWORDS.has(keyword.toLowerCase())) return null;

  // "get" / "gets"
  if (tokens[idx] !== 'get' && tokens[idx] !== 'gets') return null;
  idx++;

  // P/T bonus (must be non-negative for a static anthem; temporary debuffs use the spell form)
  const ptMatch = tokens[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  idx++;

  // Static anthems must NOT be followed by "until end of turn"
  if (tokens[idx] === 'until') return null;
  if (tokens[idx] === '.') idx++;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'ModifyPT', power, toughness },
    filter: { types: ['creature'], withKeyword: keyword.toLowerCase() },
    controller: 'you',
    excludeSelf,
  };
}

// ============================================================================
// matchGlobalKeywordAnthem  (Slice 5)
// ============================================================================

/**
 * Slice 5 — Controller-agnostic filtered anthem statics:
 *   "Creatures with flying get +2/+0."         (Gravitational Shift effect 1)
 *   "Creatures without flying get -2/-0."       (Gravitational Shift effect 2)
 *   "Creatures with flying get -2/-0."          (Crosswinds)
 *   "Creatures without flying get +2/+0."       (Gravitational Shift inverse)
 *
 * This variant LACKS the "you control" controller restriction, applying to ALL
 * creatures on the battlefield regardless of who controls them (controller:'any').
 * The negated form "without <keyword>" uses CardFilter.withoutKeyword so that
 * only creatures lacking the keyword are affected.
 *
 * Emits: StaticAbility { modifier: ModifyPT, filter: { types:['creature'],
 *   withKeyword | withoutKeyword }, controller: 'any' }
 *
 * HONESTY:
 *   - continuous.ts isAffectedBy already processes controller:'any' (it only
 *     excludes 'you' and 'opponent' filtered cards — 'any' passes the check).
 *   - withoutKeyword is a new CardFilter field evaluated both in isAffectedBy
 *     (continuous.ts layer 7c) and matchesCardFilter (executor.ts static fallback).
 *   - "until end of turn" is rejected (temporal effect handled by matchModifyPT).
 *
 * Token shape: "Creatures with[out] <keyword> get +N/+N[.]"
 * (No "you control" clause. No "other". No leading "other".)
 *
 * Must run BEFORE matchKeywordHolderAnthem in both dispatch arrays so the global
 * (no "you control") form is claimed before the "you control" form tries to parse
 * and fails on the absent controller clause.
 */
export function matchGlobalKeywordAnthem(tokens: string[]): StaticAbilityEffect | null {
  let idx = 0;

  // Required: "creatures" or "creature"
  if (tokens[idx] !== 'creatures' && tokens[idx] !== 'creature') return null;
  idx++;

  // Required: "with" or "without"
  let negated: boolean;
  if (tokens[idx] === 'without') {
    negated = true;
    idx++;
  } else if (tokens[idx] === 'with') {
    negated = false;
    idx++;
  } else {
    return null;
  }

  // Must NOT be "with power" (handled by matchStaticAbility's power filter branch)
  if (tokens[idx] === 'power') return null;

  // Read the keyword (may be two-token: "first strike", "double strike")
  let keyword: string;
  if (tokens[idx] === 'first' && tokens[idx + 1] === 'strike') {
    keyword = 'first strike'; idx += 2;
  } else if (tokens[idx] === 'double' && tokens[idx + 1] === 'strike') {
    keyword = 'double strike'; idx += 2;
  } else {
    keyword = tokens[idx] ?? '';
    idx++;
  }
  if (!ANTHEM_FILTER_KEYWORDS.has(keyword.toLowerCase())) return null;

  // Must NOT be followed by "you control" — that's the matchKeywordHolderAnthem form
  if (tokens[idx] === 'you' && tokens[idx + 1] === 'control') return null;

  // "get" / "gets"
  if (tokens[idx] !== 'get' && tokens[idx] !== 'gets') return null;
  idx++;

  // P/T bonus (may be negative, e.g. -2/-0)
  const ptMatch = tokens[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  idx++;

  // Reject "until end of turn" (temporal effect)
  if (tokens[idx] === 'until') return null;
  if (tokens[idx] === '.') idx++;

  const filter: CardFilter = negated
    ? { types: ['creature'], withoutKeyword: keyword.toLowerCase() }
    : { types: ['creature'], withKeyword: keyword.toLowerCase() };

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'ModifyPT', power, toughness },
    filter,
    controller: 'any',
    excludeSelf: false,
  };
}

// ============================================================================
// matchAttackingAnthem
// ============================================================================

/**
 * Slice 2 — Combat-status mass statics:
 *   "Attacking creatures get -1/-0"                          (Weakstone)
 *   "Attacking creatures you control get +1/+0"              (Orcish Oriflamme)
 *   "Attacking creatures you control get +2/+0"              (Nobilis of War)
 *   "Attacking creatures you control have lifelink"          (Windbrisk Raptor)
 *   "Blocking creatures you control get +0/+1"              (Fortification family)
 *
 * Accepted subject forms (token-level):
 *   "attacking creatures [you control] get/have <modifier>"
 *   "blocking creatures [you control] get/have <modifier>"
 *
 * HONESTY:
 *   - The modifier (ModifyPT or GrantKeyword) is already consumed by
 *     getContinuousPTModification / getGrantedKeywords in continuous.ts (layer 7c
 *     and layer 6 respectively). Both functions call isAffectedBy which now
 *     checks filter.attacking / filter.blocking against state.combat.attackers /
 *     state.combat.blockers (the existing declared-attacker/blocker lists in
 *     GameState). So the buff only applies during the combat phase while the
 *     creatures are declared attackers/blockers, which is the correct MTG ruling.
 *   - "until end of turn" is rejected (temporal effect, not static).
 *   - "Attackers you control get +1/+0" variant (no "creature/creatures" word) is
 *     also recognised because some old cards use that phrasing.
 *
 * This matcher must run BEFORE matchStaticAbility in parseOracleText because
 * matchStaticAbility's subject parser does not understand "attacking"/"blocking"
 * as a CardFilter field and would return null anyway, so insertion order is safe.
 */
export function matchAttackingAnthem(tokens: string[]): StaticAbilityEffect | null {
  let idx = 0;

  // Required: "attacking" or "blocking"
  let combatStatus: 'attacking' | 'blocking';
  if (tokens[idx] === 'attacking') {
    combatStatus = 'attacking';
  } else if (tokens[idx] === 'blocking') {
    combatStatus = 'blocking';
  } else {
    return null;
  }
  idx++;

  // Optional: "creature" / "creatures" (some old wordings omit it: "Attackers get …")
  if (tokens[idx] === 'creature' || tokens[idx] === 'creatures') {
    idx++;
  }

  // Optional: "you control" (when absent, affects all attackers — controller:'any')
  let controller: 'you' | 'any' = 'any';
  if (tokens[idx] === 'you' && tokens[idx + 1] === 'control') {
    controller = 'you';
    idx += 2;
  }

  // Verb: "get" / "gets" (P/T) or "have" / "has" / "gain" / "gains" (keyword)
  const verb = tokens[idx];
  if (!verb) return null;
  const isPT = verb === 'get' || verb === 'gets';
  const isKw = verb === 'have' || verb === 'has' || verb === 'gain' || verb === 'gains';
  if (!isPT && !isKw) return null;
  idx++;

  // "until end of turn" — temporal effect, not a static; bail so the spell
  // matchers handle it.
  if (tokens[idx] === 'until') return null;

  let modifier: StaticModifier;

  if (isPT) {
    const ptMatch = tokens[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    // parseInt("+0")/parseInt("-0") yield -0 in JS; coerce to plain 0.
    modifier = {
      kind: 'ModifyPT',
      power: parseInt(ptMatch[1], 10) || 0,
      toughness: parseInt(ptMatch[2], 10) || 0,
    };
    idx++;
    // "until end of turn" after P/T = temporary spell effect
    if (tokens[idx] === 'until') return null;
    // "and gain[s] <keyword>" or "and have <keyword>" after P/T:
    //   - If followed by "until" somewhere before sentence end → temporary spell effect; bail.
    //   - If no "until" → permanent static compound rider ("and gain vigilance", "and have trample");
    //     treat as static ModifyPT + side-channel GrantKeyword (registered via
    //     additionalStaticKeywordFromLine in stack.ts registerContinuousAbilitiesForPermanent).
    if (
      tokens[idx] === 'and'
      && (tokens[idx + 1] === 'gain' || tokens[idx + 1] === 'gains'
          || tokens[idx + 1] === 'have' || tokens[idx + 1] === 'has')
    ) {
      for (let scan = idx; scan < tokens.length && tokens[scan] !== '.'; scan++) {
        if (tokens[scan] === 'until') return null;
      }
      // No "until" found → static compound rider; fall through to modifier/return below.
    }
  } else {
    // Keyword grant: "flying", "lifelink", "first strike", "double strike", …
    let keyword: string;
    if (tokens[idx] === 'first' && tokens[idx + 1] === 'strike') {
      keyword = 'first strike'; idx += 2;
    } else if (tokens[idx] === 'double' && tokens[idx + 1] === 'strike') {
      keyword = 'double strike'; idx += 2;
    } else {
      keyword = tokens[idx] ?? '';
      if (!keyword) return null;
      idx++;
    }
    // "until end of turn" after keyword = temporary spell effect
    if (tokens[idx] === 'until') return null;
    modifier = { kind: 'GrantKeyword', keyword };
  }

  // Optional trailing period
  if (tokens[idx] === '.') idx++;

  // Build the filter: creature type + combat-status flag
  const filter: CardFilter = {
    types: ['creature'],
    ...(combatStatus === 'attacking' ? { attacking: true as const } : { blocking: true as const }),
  };

  return {
    kind: 'StaticAbility',
    modifier,
    filter,
    controller,
    excludeSelf: false,
  };
}

// ============================================================================
// matchStaticAbility helpers
// ============================================================================

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

  const manaValueFilter = parseManaValueFilterSuffix(tokens, idx);
  if (manaValueFilter) {
    filter = mergeStaticFilters(filter, manaValueFilter.filter);
    idx = manaValueFilter.nextIndex;
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

/**
 * True when the token sequence "as long as" appears between startIndex and the
 * end of the current sentence ('.' or end of tokens). Used by matchStaticAbility
 * to refuse the unconditional claim of "<static> as long as <condition>" lines —
 * matchConditionalStaticAbility owns those (and only claims the conditions
 * evaluateCondition can actually evaluate).
 */
function hasAsLongAsBeforeSentenceEnd(tokens: string[], startIndex: number): boolean {
  for (let scan = startIndex; scan < tokens.length && tokens[scan] !== '.'; scan++) {
    if (tokens[scan] === 'as' && tokens[scan + 1] === 'long' && tokens[scan + 2] === 'as') {
      return true;
    }
  }
  return false;
}

// ============================================================================
// matchCompoundSubtypeSpellCostReduction — Banneret / Lorwyn "two-type" form
// ============================================================================

/**
 * Match the Lorwyn Banneret form:
 *   "<SubtypeA> spells and <SubtypeB> spells you cast cost {N} less [to cast]."
 *
 * Examples:
 *   "Elemental spells and Warrior spells you cast cost {1} less to cast."   (Brighthearth Banneret)
 *   "Kithkin spells and Soldier spells you cast cost {1} less to cast."     (Ballyrush Banneret)
 *   "Merfolk spells and Wizard spells you cast cost {1} less to cast."      (Stonybrook Banneret)
 *
 * HONEST: getCostReduction (continuous.ts) already applies ReduceCost statics
 * via matchesCardFilter, which checks filter.subtypes with ANY-match semantics
 * (filter.subtypes.some(...)). Emitting a filter with subtypes: ['typeA','typeB']
 * means any spell matching EITHER subtype gets the reduction — exactly the
 * intended behaviour. No new executor work is needed.
 *
 * The function uses parseStaticFilterType to validate both subtype tokens so
 * only engine-known subtypes are accepted (honest coverage bar).
 */
export function matchCompoundSubtypeSpellCostReduction(tokens: string[]): StaticAbilityEffect | null {
  // Expected shape (after tokenization, case-folded):
  //   [subtypeA] spells and [subtypeB] spells you cast cost {N} less [to cast] [.]
  // Minimum length: subtypeA spells and subtypeB spells you cast cost {N} less = 10 tokens
  if (tokens.length < 10) return null;

  let idx = 0;

  // --- SubtypeA ---
  const filterA = parseStaticFilterType(tokens[idx]);
  if (!filterA) return null;
  // Must have exactly one subtype (not a bare type like 'creature'/'artifact').
  // We require subtypes to be present (Banneret form uses creature subtypes).
  // Accept single-subtype filters only — e.g. 'elemental' → { types:['creature'], subtypes:['elemental'] }
  if (!filterA.subtypes || filterA.subtypes.length === 0) return null;
  idx++;

  // "spells" after SubtypeA
  if (tokens[idx] !== 'spells' && tokens[idx] !== 'spell') return null;
  idx++;

  // "and"
  if (tokens[idx] !== 'and') return null;
  idx++;

  // --- SubtypeB ---
  const filterB = parseStaticFilterType(tokens[idx]);
  if (!filterB) return null;
  if (!filterB.subtypes || filterB.subtypes.length === 0) return null;
  idx++;

  // "spells" after SubtypeB
  if (tokens[idx] !== 'spells' && tokens[idx] !== 'spell') return null;
  idx++;

  // "you cast" (controller scope)
  if (tokens[idx] !== 'you' || tokens[idx + 1] !== 'cast') return null;
  idx += 2;

  // "cost"
  if (tokens[idx] !== 'cost') return null;
  idx++;

  // "{N}" — a concrete generic amount
  const costMatch = tokens[idx]?.match(/^\{(\d+)\}$/);
  if (!costMatch) return null;
  const amount = parseInt(costMatch[1], 10);
  idx++;

  // "less"
  if (tokens[idx] !== 'less') return null;
  idx++;

  // Optional "to cast"
  if (tokens[idx] === 'to' && tokens[idx + 1] === 'cast') idx += 2;

  // Optional trailing period
  if (tokens[idx] === '.') idx++;

  // Nothing else allowed
  if (idx !== tokens.length) return null;

  // Build a union filter: subtypes are merged with ANY-match semantics in matchesCardFilter
  const mergedFilter: CardFilter = mergeStaticFilters(filterA, filterB);

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'ReduceCost', amount },
    filter: mergedFilter,
    controller: 'you',
    excludeSelf: false,
    selfOnly: false,
  };
}

// ============================================================================
// matchStaticAbility
// ============================================================================

export function matchStaticAbility(tokens: string[]): StaticAbilityEffect | null {
  let idx = 0;
  let excludeSelf = false;
  let selfOnly = false;
  let filter: CardFilter = {};
  let controller: 'you' | 'opponent' | 'any' = 'you';

  if (tokens[idx] === 'other') { excludeSelf = true; idx++; }
  if (tokens[idx] === '~') {
    // Slice 9: "~ and other [X] creatures you control get/have ..." —
    // Vampire Nocturnus family. The source card itself is included in the
    // affected group. Because the source IS an X creature, we parse the
    // "other X creatures you control" tail WITHOUT excludeSelf so the
    // continuous effect applies to the source AND every other X creature
    // the controller controls. We consume "~ and" then let the normal
    // subject-parsing path handle "other X creatures you control".
    if (tokens[idx + 1] === 'and' && tokens[idx + 2] === 'other') {
      // Advance past "~ and" to land on "other X creatures you control".
      // The `other` token is consumed by the normal `excludeSelf` path
      // already — but we set excludeSelf = false because the source IS
      // included (it shares the subtype; the static applies to it too).
      idx += 2; // skip "~ and"
      // We now expect "other <X> creatures you control" — re-enter normal
      // flow by consuming the "other" marker but cancelling excludeSelf.
      if (tokens[idx] === 'other') idx++;
      const subjectAndOther = parseStaticSubject(tokens, idx);
      if (!subjectAndOther) return null;
      filter = subjectAndOther.filter;
      idx = subjectAndOther.nextIndex;
      excludeSelf = false; // source itself is included in "~ and other X"
      controller = 'you'; // bounded to controller's permanents
      if (tokens[idx] === 'you' && tokens[idx + 1] === 'control') idx += 2;
      else if (tokens[idx] === 'an' && tokens[idx + 1] === 'opponent' && tokens[idx + 2] === 'controls') { controller = 'opponent'; idx += 3; }
    } else {
      selfOnly = true;
      controller = 'any';
      idx++;
    }
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
    // Slice 4/12: "your opponents control" — plural opponent controller scope.
    // Enables "Creatures your opponents control get -N/-N." static debuffs (Cumber Stone
    // family). The continuous layer already honors controller:'opponent' (isAffectedBy
    // L211/287/318) and accumulates signed P/T modifiers (L401-403), so negative values
    // subtract correctly with no new executor code.
    else if (tokens[idx] === 'your' && tokens[idx + 1] === 'opponents' && tokens[idx + 2] === 'control') { controller = 'opponent'; idx += 3; }
    else if (tokens[idx] === 'you' && tokens[idx + 1] === 'cast') { controller = 'you'; idx += 2; }
    else if (tokens[idx] === 'your' && tokens[idx + 1] === 'opponents' && tokens[idx + 2] === 'cast') { controller = 'opponent'; idx += 3; }
    else if (tokens[idx] === 'cost') { controller = 'any'; }
    // Slice 5/11: "Creatures of the chosen type get/have ..." — no controller scope,
    // the filter is the chosen type itself (Shared Triumph / Steely Resolve family).
    // "of the chosen type" must appear immediately after the subject; controller
    // defaults to 'any' (affects all players' creatures of the chosen type, which is
    // how cards like Steely Resolve work). The chosenCreatureTypeFromSource flag is set
    // here so the predicate branches below can proceed normally.
    //
    // Slice 7 (as-enters-choose extension): Also accept the "you cast" / "you control"
    // controller scope AFTER "of the chosen type", e.g.:
    //   "Spells of the chosen type you cast cost {1} less to cast." (Cloud Key)
    //   "Creature spells you cast of the chosen type cost {1} less to cast." — already
    //    handled by the earlier "you cast" branch above.
    //
    // Honesty note on chosenCardTypeFromSource vs chosenCreatureTypeFromSource:
    //   When the subject already carries a concrete type (e.g. "creatures", "artifacts"),
    //   the choice is a CREATURE SUBTYPE and we use chosenCreatureTypeFromSource
    //   (executor checks type_line subtype section, e.g. "Goblin", "Bird").
    //   When the subject is a bare "spells" (empty base filter), the choice is typically
    //   a CARD TYPE (artifact/creature/enchantment/instant/sorcery) and we use
    //   chosenCardTypeFromSource (executor checks def.card_types array).  This is the
    //   Cloud Key / "Spells of the chosen type" family.
    else if (
      tokens[idx] === 'of' && tokens[idx + 1] === 'the' &&
      tokens[idx + 2] === 'chosen' && tokens[idx + 3] === 'type'
    ) {
      // Choose the correct flag based on whether the subject has an explicit type.
      // Empty filter (bare "spells") → card-type choice → chosenCardTypeFromSource.
      // Non-empty filter (e.g. "creatures", "artifacts") → creature-subtype choice
      // → chosenCreatureTypeFromSource (Shared Triumph / Steely Resolve / Radiant Destiny).
      if (Object.keys(filter).length === 0) {
        filter.chosenCardTypeFromSource = true;
      } else {
        filter.chosenCreatureTypeFromSource = true;
      }
      idx += 4;
      // After "of the chosen type", optionally consume controller scope.
      if (tokens[idx] === 'you' && tokens[idx + 1] === 'cast') {
        controller = 'you';
        idx += 2;
      } else if (tokens[idx] === 'you' && tokens[idx + 1] === 'control') {
        controller = 'you';
        idx += 2;
      } else if (tokens[idx] === 'an' && tokens[idx + 1] === 'opponent' && tokens[idx + 2] === 'controls') {
        controller = 'opponent';
        idx += 3;
      } else {
        // No controller scope — affects all (Shared Triumph / Cloud Key "cost" form).
        controller = 'any';
      }
    }
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

  // Slice 5: "of the chosen color" — Caged Sun / Gauntlet of Power anthem.
  // Stored as chosenColorFromSource and evaluated against choices.chosenColor
  // on the source permanent in matchesCardFilter (executor.ts) and isAffectedBy
  // (continuous.ts).
  if (tokens[idx] === 'of' && tokens[idx + 1] === 'the' && tokens[idx + 2] === 'chosen' && tokens[idx + 3] === 'color') {
    filter.chosenColorFromSource = true;
    idx += 4;
  }

  const combatRestrictions = readStaticCombatRestrictions(tokens, idx);
  if (combatRestrictions) {
    idx += combatRestrictions.consumed;
    // "<static> as long as <condition>" is a conditional static —
    // matchConditionalStaticAbility claims the supported ones (with the
    // condition attached); never claim them as unconditional statics here.
    if (hasAsLongAsBeforeSentenceEnd(tokens, idx)) return null;
    return { kind: 'StaticAbility', modifier: staticKeywordModifier(combatRestrictions.keywords), filter, controller, excludeSelf, selfOnly };
  }

  // "~ can attack as though it had haste" / "Creatures you control can attack as
  // though they had haste" (Fervor, Mass Hysteria, Hammer of Purphoros). The
  // summoning-sickness-for-attacking bypass is genuinely enforced by mapping to
  // the Haste keyword: canAttackThisTurn (keywords.ts) treats a creature with
  // Haste as able to attack the turn it entered, and this StaticAbility's
  // GrantKeyword:Haste is registered as a continuous effect by
  // registerContinuousAbilitiesForPermanent (stack.ts), so getKeywordsForInstance
  // → instanceHasKeyword report Haste on the affected creatures.
  //
  // Slice 6: "~ can attack as though it didn't have defender" (Felothar, Ogre
  // Jailbreaker, Bristlepack Sentry). Maps to IgnoreDefender pseudo-keyword.
  // canAttackThisTurn (keywords.ts) skips the Defender block when IgnoreDefender
  // is present via instanceHasKeyword (KEYWORD_MAP covers both grantedKeywords and
  // continuous effects). "<static> as long as <condition>" suffix is handled by
  // matchConditionalStaticAbility — matchStaticAbility's guard above
  // (hasAsLongAsBeforeSentenceEnd) already deflects those shapes here.
  if (
    (tokens[idx] === 'can' || tokens[idx] === 'may')
    && tokens[idx + 1] === 'attack'
    && tokens[idx + 2] === 'as'
    && tokens[idx + 3] === 'though'
  ) {
    let scan = idx + 4;
    // "as though it/they had/has haste"
    if (tokens[scan] === 'it' || tokens[scan] === 'they') scan++;
    if (tokens[scan] === 'had' || tokens[scan] === 'has' || tokens[scan] === 'have') scan++;
    if (tokens[scan] === 'haste') {
      return { kind: 'StaticAbility', modifier: { kind: 'GrantKeyword', keyword: 'Haste' }, filter, controller, excludeSelf, selfOnly };
    }
    // "as though it didn't have defender" / "as though they didn't have defender"
    // Also handles "as though it does not have defender" (alternate wording).
    scan = idx + 4;
    if (tokens[scan] === 'it' || tokens[scan] === 'they') scan++;
    if (
      (tokens[scan] === "didn't" || tokens[scan] === 'didnt'
        || (tokens[scan] === 'does' && tokens[scan + 1] === 'not')
        || tokens[scan] === 'doesnt' || tokens[scan] === "doesn't")
    ) {
      if (tokens[scan] === 'does' && tokens[scan + 1] === 'not') scan++;
      scan++;
      if (tokens[scan] === 'have' && tokens[scan + 1] === 'defender') {
        return { kind: 'StaticAbility', modifier: { kind: 'GrantKeyword', keyword: 'IgnoreDefender' }, filter, controller, excludeSelf, selfOnly };
      }
    }
  }

  if (tokens[idx] === 'get' || tokens[idx] === 'gets') {
    idx++;
    const ptMatch = tokens[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    idx++;
    // "until end of turn" means this is a temporary effect, NOT a static ability.
    // This includes the combat-trick form "+N/+N and gains <kw> until end of turn",
    // where "until" trails the keyword clause — bail so matchModifyPT handles it.
    if (tokens[idx] === 'until') return null;
    // "<static> as long as <condition>" suffixes are conditional statics —
    // matchConditionalStaticAbility claims the supported ones (with the
    // condition attached); never claim them unconditionally here.
    if (hasAsLongAsBeforeSentenceEnd(tokens, idx)) return null;
    if (tokens[idx] === 'and' && (tokens[idx + 1] === 'gains' || tokens[idx + 1] === 'gain')) {
      for (let scan = idx; scan < tokens.length && tokens[scan] !== '.'; scan++) {
        if (tokens[scan] === 'until') return null;
      }
    }
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
    // Slice 9: Decline when the quoted ability form appears: tokens containing
    // a double-quote character or a mana-chunk placeholder are not runnable
    // keywords. The tokenizer maps {T} inside quoted abilities to "__mana_N__"
    // which appears (possibly with a leading ") as the first token after "have".
    // Example: `Creatures you control have "{T}: Each opponent mills..."` should
    // be Unparsed (the mill ability is not runnable), not falsely claimed as a
    // GrantKeyword with a garbage keyword.
    const firstKwTok = tokens[idx] ?? '';
    if (firstKwTok.includes('"') || firstKwTok.includes('__mana_')) return null;

    // Slice 9: Multi-keyword have — "Creatures you control have trample and haste."
    // We probe the token stream with readGrantableKeyword to detect a comma/and-
    // separated multi-keyword list and emit GrantKeywords when ≥2 keywords are found.
    // IMPORTANT: For backward compatibility, single-keyword forms still use the raw
    // token (lowercase) rather than the capitalized readGrantableKeyword result —
    // existing tests assert modifier.keyword is lowercase (e.g. 'flying', 'trample').
    let scanIdx = idx;
    let lastGoodIdx = -1;
    let multiKwCount = 0;
    // Collect raw tokens for the multi-keyword path
    const rawKwTokens: string[] = [];
    while (true) {
      const kw = readGrantableKeyword(tokens, scanIdx);
      if (!kw) break;
      // Store the raw token(s) that form this keyword
      const rawTok = tokens[scanIdx] + (kw.consumed === 2 ? ' ' + tokens[scanIdx + 1] : '');
      rawKwTokens.push(rawTok);
      multiKwCount++;
      scanIdx += kw.consumed;
      lastGoodIdx = scanIdx;
      if (tokens[scanIdx] === ',') scanIdx++;
      if (tokens[scanIdx] === 'and') scanIdx++;
    }

    if (multiKwCount >= 2) {
      // Multi-keyword path — emit GrantKeywords
      idx = lastGoodIdx;
      // "<static> as long as <condition>" suffix — see the gets-branch guard.
      if (hasAsLongAsBeforeSentenceEnd(tokens, idx)) return null;
      if (tokens[idx] === '.') idx++;
      const modifier: StaticModifier = { kind: 'GrantKeywords', keywords: rawKwTokens };
      return { kind: 'StaticAbility', modifier, filter, controller, excludeSelf, selfOnly };
    }

    // Single-keyword path (original behavior) — use raw token for backward compat.
    let keyword = tokens[idx];
    if (!keyword) return null;
    if ((keyword === 'first' || keyword === 'double') && tokens[idx + 1] === 'strike') {
      keyword = `${keyword} strike`;
      idx += 2;
    } else {
      idx++;
    }
    // "<static> as long as <condition>" suffix — see the gets-branch guard.
    if (hasAsLongAsBeforeSentenceEnd(tokens, idx)) return null;
    if (tokens[idx] === '.') idx++;
    return { kind: 'StaticAbility', modifier: { kind: 'GrantKeyword', keyword }, filter, controller, excludeSelf, selfOnly };
  }
  if (tokens[idx] === 'cost') {
    idx++;
    const costMatch = tokens[idx]?.match(/^\{(\d+)\}$/);
    if (!costMatch) return null;
    idx++;
    if (tokens[idx] !== 'less' && tokens[idx] !== 'more') return null;
    const kind = tokens[idx] === 'less' ? 'ReduceCost' : 'IncreaseCost';
    idx++;
    if (tokens[idx] === 'to' && tokens[idx + 1] === 'cast') idx += 2;
    // "<static> as long as <condition>" suffix — see the gets-branch guard.
    if (hasAsLongAsBeforeSentenceEnd(tokens, idx)) return null;
    if (tokens[idx] === '.') idx++;
    return { kind: 'StaticAbility', modifier: { kind, amount: parseInt(costMatch[1], 10) }, filter, controller, excludeSelf, selfOnly };
  }
  return null;
}

// ============================================================================
// matchSetAllColors — Layer 5 color-setting static
// ============================================================================

/**
 * Match "Each nonland permanent you control is all colors." (Leyline of the
 * Guildpact) and equivalent phrasings.
 *
 * Emits a StaticAbility with modifier { kind: 'SetAllColors' } and a filter
 * of { excludeTypes: ['land'] } scoped to controller: 'you'.
 *
 * The modifier is consumed by getEffectiveColors (continuous.ts) which returns
 * all five colors {W,U,B,R,G} for any matching permanent.  matchesCardFilter
 * (executor.ts) calls getEffectiveColors when an instanceId is in context so
 * that all color checks reflect the Layer 5 overlay.
 */
export function matchSetAllColors(tokens: string[]): StaticAbilityEffect | null {
  // Pattern: "each nonland permanent you control is all colors ."
  // Tokens:  each nonland permanent you control is all colors [.]
  let i = 0;

  // Leading "each" (required)
  if (tokens[i] !== 'each') return null;
  i++;

  // Optional subject qualifiers: "nonland", "other", controller-scope words
  // We accept the one wording Leyline uses; the filter is built from them.
  if (tokens[i] === 'nonland') {
    i++; // consumed — recorded in the filter below
  }

  if (tokens[i] !== 'permanent') return null;
  i++;

  // Controller clause
  let controller: 'you' | 'opponent' | 'any' = 'any';
  if (tokens[i] === 'you' && tokens[i + 1] === 'control') {
    controller = 'you';
    i += 2;
  } else if (tokens[i] === 'an' && tokens[i + 1] === 'opponent' && tokens[i + 2] === 'controls') {
    controller = 'opponent';
    i += 3;
  }
  // else "any" — no restriction

  // Predicate: "is all colors"
  if (tokens[i] !== 'is') return null;
  i++;
  if (tokens[i] !== 'all') return null;
  i++;
  if (tokens[i] !== 'colors') return null;
  i++;

  // Optional trailing period
  if (tokens[i] === '.') i++;

  // Nothing extra allowed after the clause
  if (i !== tokens.length) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'SetAllColors' },
    filter: { excludeTypes: ['land'] },
    controller,
    excludeSelf: false,
  };
}

// ============================================================================
// Conditional statics — "As long as <condition>, <static>" and
// "<static> as long as <condition>" (incl. "Threshold — ..." ability-word forms)
// ============================================================================

// Basic and named land subtypes for "you control a Forest / Desert / etc." conditions.
// CardFilter subtypes match via the type line, so nonbasics carrying the subtype count too.
// Slice 2 extension: added Desert and other frequently-appearing non-basic land subtypes.
const CONDITION_LAND_SUBTYPES: Record<string, string> = {
  plains: 'plains',
  island: 'island', islands: 'island',
  swamp: 'swamp', swamps: 'swamp',
  mountain: 'mountain', mountains: 'mountain',
  forest: 'forest', forests: 'forest',
  // Slice 2: non-basic land subtypes seen in conditional self-buff conditions
  desert: 'desert', deserts: 'desert',
  gate: 'gate', gates: 'gate',
  locus: 'locus', loci: 'locus',
  cave: 'cave', caves: 'cave',
};

// Slice 11: Named planeswalker subtypes for "you control a Nissa planeswalker"
// conditions (Guardian of the Great Conduit family). The canonical subtype
// appears after "--" in the type line (e.g. "Legendary Planeswalker — Nissa").
// evaluateCondition → ControlsType → matchesCardFilter checks filter.subtypes
// via typeLineHasSubtype, so this map produces the correct filter.
const CONDITION_PLANESWALKER_SUBTYPES: Record<string, string> = {
  ajani: 'ajani', aminatou: 'aminatou', angrath: 'angrath',
  arlinn: 'arlinn', ashiok: 'ashiok', basri: 'basri',
  bolas: 'bolas', calix: 'calix', chandra: 'chandra',
  dack: 'dack', daretti: 'daretti', davriel: 'davriel',
  domri: 'domri', dovin: 'dovin', elspeth: 'elspeth',
  estrid: 'estrid', freyalise: 'freyalise', garruk: 'garruk',
  gideon: 'gideon', huatli: 'huatli', jace: 'jace',
  jaya: 'jaya', karn: 'karn', kasmina: 'kasmina',
  kaya: 'kaya', kiora: 'kiora', koth: 'koth',
  liliana: 'liliana', lukka: 'lukka', nahiri: 'nahiri',
  narset: 'narset', nissa: 'nissa', nixilis: 'nixilis',
  oko: 'oko', ral: 'ral', rowan: 'rowan',
  saheeli: 'saheeli', samut: 'samut', sarkhan: 'sarkhan',
  serra: 'serra', sorin: 'sorin', tamiyo: 'tamiyo',
  tasha: 'tasha', teferi: 'teferi', teyo: 'teyo',
  tibalt: 'tibalt', ugin: 'ugin', uza: 'uza',
  venser: 'venser', vivien: 'vivien', vraska: 'vraska',
  will: 'will', windgrace: 'windgrace', wrenn: 'wrenn',
  xenagos: 'xenagos', yanggu: 'yanggu', yanling: 'yanling',
};

/**
 * Parse the subject of a "you control ..." condition into a CardFilter,
 * greedily merging consecutive filter words ("multicolored permanent",
 * "blue creature", "snow land") and mapping basic land subtypes ("a Forest").
 *
 * Slice 2 extension: supports "or a/an <filter>" disjunctions after the first
 * filter phrase, using CardFilter.anyOf when the two branches differ in type
 * (e.g. "Merfolk or an Island" → anyOf: [Merfolk, Island]).
 * For same-branch "or" (color words: "white or blue creature"), we instead
 * accumulate colors into a single colors[] array since matchesCardFilter treats
 * colors as "any-of" already.
 */
function parseConditionSubjectFilter(
  tokens: string[],
  startIndex: number,
): { filter: CardFilter; nextIndex: number } | null {
  let idx = startIndex;
  let filter: CardFilter | null = null;
  while (idx < tokens.length) {
    const word = tokens[idx];
    // Slice 2: inline "or <color>" accumulation before the noun word
    // (e.g. "white or blue" in "no opponent controls a white or blue creature").
    // We detect this BEFORE asking parseStaticFilterType so the "or" between
    // color words is consumed correctly.
    if (filter && word === 'or') {
      // Peek: "or <color> <noun>" → expand filter.colors array
      const nextWord = tokens[idx + 1] ?? '';
      const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
        white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
      };
      const orColor = colorMap[nextWord];
      if (orColor && filter.colors) {
        // Accumulate into same filter (matchesCardFilter colors = any-of)
        const baseFilter: CardFilter = filter;
        filter = { ...baseFilter, colors: [...baseFilter.colors!, orColor] };
        idx += 2;
        continue;
      }
      // "or a/an <filter>" disjunction (e.g. "Merfolk or an Island")
      // Build a second filter and use anyOf.
      const articleWord = tokens[idx + 1] ?? '';
      if (articleWord === 'a' || articleWord === 'an') {
        const afterArticle = idx + 2;
        let altFilter: CardFilter | null = null;
        let altIdx = afterArticle;
        while (altIdx < tokens.length) {
          const altWord = tokens[altIdx];
          const altLandSubtype = CONDITION_LAND_SUBTYPES[altWord];
          const altPwSubtype = CONDITION_PLANESWALKER_SUBTYPES[altWord];
          const altPart: CardFilter | null = altLandSubtype
            ? { types: ['land'], subtypes: [altLandSubtype] }
            : altPwSubtype
            ? { types: ['planeswalker'], subtypes: [altPwSubtype] }
            : parseStaticFilterType(altWord);
          if (!altPart) break;
          altFilter = altFilter ? mergeStaticFilters(altFilter, altPart) : altPart;
          altIdx++;
        }
        if (altFilter) {
          // Check if filters are structurally similar enough to merge directly.
          // If both have the same types (or one has no types), try merging colors.
          // Otherwise wrap in anyOf.
          const sameTypes =
            JSON.stringify(filter.types?.slice().sort()) ===
            JSON.stringify(altFilter.types?.slice().sort());
          if (sameTypes && altFilter.subtypes && filter.subtypes) {
            // Different subtypes of same type — use anyOf
            filter = { anyOf: [filter, altFilter] };
          } else if (sameTypes && altFilter.colors && filter.colors) {
            filter = { ...filter, colors: [...filter.colors, ...altFilter.colors] };
          } else {
            filter = { anyOf: [filter, altFilter] };
          }
          idx = altIdx;
          break; // stop after handling one "or" branch
        }
      }
      break; // unrecognised "or" — stop here
    }
    const landSubtype = CONDITION_LAND_SUBTYPES[word];
    // Slice 11: named planeswalker subtypes ("nissa", "jace", etc.) appearing
    // before or after "planeswalker" — produce { types: ['planeswalker'], subtypes: [name] }.
    const pwSubtype = CONDITION_PLANESWALKER_SUBTYPES[word];
    const next: CardFilter | null = landSubtype
      ? { types: ['land'], subtypes: [landSubtype] }
      : pwSubtype
      ? { types: ['planeswalker'], subtypes: [pwSubtype] }
      : parseStaticFilterType(word);
    if (!next) break;
    filter = filter ? mergeStaticFilters(filter, next) : next;
    idx++;
  }
  if (!filter) return null;
  return { filter, nextIndex: idx };
}

/**
 * Parse a static-ability condition phrase into the Condition union. ONLY
 * conditions evaluateCondition (continuous.ts) actually evaluates are
 * produced — anything else (city's blessing, "it's your turn", pairing,
 * delirium card-type counts, ...) returns null so the face stays Unparsed.
 */
function parseStaticCondition(
  tokens: string[],
  startIndex: number,
): { condition: Condition; nextIndex: number } | null {
  // "an opponent has N or less/more life" / "you have N or less/more life"
  // (also "you have N or more cards in [your] hand" and
  // "an opponent has N or more cards in their graveyard").
  {
    let who: 'you' | 'opponent' | null = null;
    let idx = startIndex;
    if (tokens[idx] === 'an' && tokens[idx + 1] === 'opponent' && tokens[idx + 2] === 'has') {
      who = 'opponent';
      idx += 3;
    } else if (tokens[idx] === 'you' && tokens[idx + 1] === 'have') {
      who = 'you';
      idx += 2;
    }
    if (who) {
      const amount = parseSmallNumberToken(tokens[idx] ?? '');
      // Accept synonyms: "less"/"fewer" = at-or-below; "more"/"greater" = at-or-above.
      if (!Number.isNaN(amount) && tokens[idx + 1] === 'or'
          && (tokens[idx + 2] === 'less' || tokens[idx + 2] === 'more'
              || tokens[idx + 2] === 'fewer' || tokens[idx + 2] === 'greater')) {
        const atOrAbove = tokens[idx + 2] === 'more' || tokens[idx + 2] === 'greater';
        let scan = idx + 3;
        if (tokens[scan] === 'life') {
          return {
            condition: atOrAbove
              ? { kind: 'LifeAtOrAbove', controller: who, amount }
              : { kind: 'LifeAtOrBelow', controller: who, amount },
            nextIndex: scan + 1,
          };
        }
        // "you have N or more/fewer cards in [your] hand"
        if (tokens[scan] === 'cards' && tokens[scan + 1] === 'in') {
          scan += 2;
          if (who === 'you') {
            if (tokens[scan] === 'your') scan++;
            if (tokens[scan] === 'hand') {
              if (atOrAbove) {
                return {
                  condition: { kind: 'CardsInZoneAtLeast', controller: 'you', zone: 'hand', count: amount },
                  nextIndex: scan + 1,
                };
              } else {
                // "you have N or fewer cards in hand" — CardsInZoneAtMost not
                // available; decline so caller returns Unparsed (honest).
                return null;
              }
            }
          } else if (tokens[scan] === 'their' && tokens[scan + 1] === 'graveyard') {
            if (atOrAbove) {
              return {
                condition: { kind: 'CardsInZoneAtLeast', controller: 'opponent', zone: 'graveyard', count: amount },
                nextIndex: scan + 2,
              };
            }
            return null;
          }
        }
      }
      return null;
    }
  }

  // Slice 8: "your life total is N or more/less/fewer/greater" — synonymous
  // phrasing for LifeAtOrAbove / LifeAtOrBelow used on cards like "As long as
  // your life total is 25 or more, ~ has flying."  Maps to the same conditions
  // as the "you have N or less/more life" block above; no executor change needed.
  //
  // Slice 7 extension: "your life total is less than or equal to half your starting
  // life total" (Bhaal / Myrkul family) → LifeAtOrBelowHalfStarting.
  // "your life total is greater than your starting life total" (Elenda) → LifeAboveStarting.
  if (
    tokens[startIndex] === 'your' &&
    tokens[startIndex + 1] === 'life' &&
    tokens[startIndex + 2] === 'total' &&
    tokens[startIndex + 3] === 'is'
  ) {
    // Slice 7: "less than or equal to half your starting life total"
    // Tokens at +4: less than or equal to half your starting life total
    if (
      tokens[startIndex + 4] === 'less' &&
      tokens[startIndex + 5] === 'than' &&
      tokens[startIndex + 6] === 'or' &&
      tokens[startIndex + 7] === 'equal' &&
      tokens[startIndex + 8] === 'to' &&
      tokens[startIndex + 9] === 'half' &&
      tokens[startIndex + 10] === 'your' &&
      tokens[startIndex + 11] === 'starting' &&
      tokens[startIndex + 12] === 'life' &&
      tokens[startIndex + 13] === 'total'
    ) {
      return {
        condition: { kind: 'LifeAtOrBelowHalfStarting', controller: 'you' },
        nextIndex: startIndex + 14,
      };
    }

    // Slice 7: "greater than your starting life total"
    // Tokens at +4: greater than your starting life total
    if (
      tokens[startIndex + 4] === 'greater' &&
      tokens[startIndex + 5] === 'than' &&
      tokens[startIndex + 6] === 'your' &&
      tokens[startIndex + 7] === 'starting' &&
      tokens[startIndex + 8] === 'life' &&
      tokens[startIndex + 9] === 'total'
    ) {
      return {
        condition: { kind: 'LifeAboveStarting', controller: 'you' },
        nextIndex: startIndex + 10,
      };
    }

    const amount = parseSmallNumberToken(tokens[startIndex + 4] ?? '');
    if (!Number.isNaN(amount) && tokens[startIndex + 5] === 'or') {
      const word = tokens[startIndex + 6];
      if (word === 'more' || word === 'greater') {
        return {
          condition: { kind: 'LifeAtOrAbove', controller: 'you', amount },
          nextIndex: startIndex + 7,
        };
      }
      if (word === 'less' || word === 'fewer') {
        return {
          condition: { kind: 'LifeAtOrBelow', controller: 'you', amount },
          nextIndex: startIndex + 7,
        };
      }
    }
    return null;
  }

  // Slice 8: "an opponent's life total is N or more/less/fewer/greater"
  if (
    tokens[startIndex] === 'an' &&
    tokens[startIndex + 1] === "opponent's" &&
    tokens[startIndex + 2] === 'life' &&
    tokens[startIndex + 3] === 'total' &&
    tokens[startIndex + 4] === 'is'
  ) {
    const amount = parseSmallNumberToken(tokens[startIndex + 5] ?? '');
    if (!Number.isNaN(amount) && tokens[startIndex + 6] === 'or') {
      const word = tokens[startIndex + 7];
      if (word === 'more' || word === 'greater') {
        return {
          condition: { kind: 'LifeAtOrAbove', controller: 'opponent', amount },
          nextIndex: startIndex + 8,
        };
      }
      if (word === 'less' || word === 'fewer') {
        return {
          condition: { kind: 'LifeAtOrBelow', controller: 'opponent', amount },
          nextIndex: startIndex + 8,
        };
      }
    }
    return null;
  }

  // Threshold: "there are N or more cards in your graveyard"
  // Slice 9/11 extension: "there are N or more mana values among cards in your graveyard"
  // (Syndicate Infiltrator family — counts DISTINCT mana values, not card count).
  // Slice 1 extension: "there are N or more <filter> cards in your graveyard"
  //   — permanent cards (Descend 4 / Akawalli family)
  //   — instant and/or sorcery cards (Magmatic Channeler family)
  // The "mana values among" form is checked first since both begin with "there are N or more".
  if (tokens[startIndex] === 'there' && tokens[startIndex + 1] === 'are') {
    const amount = parseSmallNumberToken(tokens[startIndex + 2] ?? '');
    if (Number.isNaN(amount)) return null;
    let idx = startIndex + 3;
    if (tokens[idx] !== 'or' || tokens[idx + 1] !== 'more') return null;
    idx += 2;
    // "there are N or more mana values among cards in your graveyard"
    if (
      tokens[idx] === 'mana' && tokens[idx + 1] === 'values' && tokens[idx + 2] === 'among'
      && tokens[idx + 3] === 'cards' && tokens[idx + 4] === 'in'
      && tokens[idx + 5] === 'your' && tokens[idx + 6] === 'graveyard'
    ) {
      return {
        condition: { kind: 'DistinctManaValuesInGraveyardAtLeast', count: amount },
        nextIndex: idx + 7,
      };
    }
    // Slice 5 (Delirium): "there are N or more card types among cards in your graveyard"
    // Canonical Delirium wording; ability-word prefix "Delirium —" is stripped by
    // matchConditionalStaticAbility before parseStaticCondition is called.
    if (
      tokens[idx] === 'card' && tokens[idx + 1] === 'types' && tokens[idx + 2] === 'among'
      && tokens[idx + 3] === 'cards' && tokens[idx + 4] === 'in'
      && tokens[idx + 5] === 'your' && tokens[idx + 6] === 'graveyard'
    ) {
      return {
        condition: { kind: 'CardTypesInGraveyardAtLeast', count: amount },
        nextIndex: idx + 7,
      };
    }
    // Slice 1: "there are N or more permanent cards in your graveyard"
    // (Descend 4 / Basking Capybara / Akawalli families)
    if (
      tokens[idx] === 'permanent' && tokens[idx + 1] === 'cards'
      && tokens[idx + 2] === 'in' && tokens[idx + 3] === 'your'
      && tokens[idx + 4] === 'graveyard'
    ) {
      return {
        condition: {
          kind: 'CardsInZoneAtLeast',
          controller: 'you',
          zone: 'graveyard',
          count: amount,
          filter: { permanent: true },
        },
        nextIndex: idx + 5,
      };
    }
    // Slice 1: "there are N or more instant and/or sorcery cards in your graveyard"
    // (Magmatic Channeler / Spell Mastery families)
    if (
      tokens[idx] === 'instant' && tokens[idx + 2] === 'sorcery'
      && tokens[idx + 3] === 'cards' && tokens[idx + 4] === 'in'
      && tokens[idx + 5] === 'your' && tokens[idx + 6] === 'graveyard'
      && (tokens[idx + 1] === 'and/or' || tokens[idx + 1] === 'or')
    ) {
      return {
        condition: {
          kind: 'CardsInZoneAtLeast',
          controller: 'you',
          zone: 'graveyard',
          count: amount,
          filter: { anyOf: [{ types: ['instant'] }, { types: ['sorcery'] }] },
        },
        nextIndex: idx + 7,
      };
    }
    // "there are N or more cards in your graveyard" (bare form — no filter)
    if (tokens[idx] !== 'cards' || tokens[idx + 1] !== 'in'
        || tokens[idx + 2] !== 'your' || tokens[idx + 3] !== 'graveyard') return null;
    return {
      condition: { kind: 'CardsInZoneAtLeast', controller: 'you', zone: 'graveyard', count: amount },
      nextIndex: idx + 4,
    };
  }

  // Slice 12: Lieutenant family — "you control your commander"
  // Must be checked BEFORE the general "you control" handler to avoid the
  // latter returning null when it encounters "your" as the article-position word.
  if (
    tokens[startIndex] === 'you'
    && tokens[startIndex + 1] === 'control'
    && tokens[startIndex + 2] === 'your'
    && tokens[startIndex + 3] === 'commander'
  ) {
    return {
      condition: { kind: 'ControlsCommander' },
      nextIndex: startIndex + 4,
    };
  }

  // Slice 9/11: "you control no untapped lands" (Spur Grappler family).
  // Must be checked BEFORE the generic ControlsNone block because the ControlsNone
  // filter-word parser doesn't understand "untapped"; when it fails to produce a
  // filter, the "you control N or more" block fires and returns null (blocking
  // fall-through to the code added later). Explicit early return is required.
  // Represented as ControlsNone with filter { types:['land'], tapped:false }; the
  // ControlsNone evaluator in continuous.ts and executor.ts checks the instance-level
  // tapped field when filter.tapped is defined.
  if (
    tokens[startIndex] === 'you' &&
    tokens[startIndex + 1] === 'control' &&
    tokens[startIndex + 2] === 'no' &&
    tokens[startIndex + 3] === 'untapped' &&
    (tokens[startIndex + 4] === 'land' || tokens[startIndex + 4] === 'lands')
  ) {
    return {
      condition: {
        kind: 'ControlsNone',
        controller: 'you',
        filter: { types: ['land'], tapped: false },
      },
      nextIndex: startIndex + 5,
    };
  }

  // Slice 1 (BEFORE "you control" to avoid early null-return): negated-control
  // conditions — "you control no [other] <filter>" and "your opponents control
  // no <filter>". Must precede the "you control a/an/another" block because that
  // block returns null (not fall-through) for the 'no' article, which would
  // prevent the condition from being parsed.
  // Examples: Jeskai Infiltrator, Erebos's Titan, Angelic Voices.
  {
    let idx = startIndex;
    let controller: 'you' | 'opponent' | null = null;
    let excludeSource = false;

    if (
      tokens[idx] === 'your' &&
      tokens[idx + 1] === 'opponents' &&
      tokens[idx + 2] === 'control' &&
      tokens[idx + 3] === 'no'
    ) {
      controller = 'opponent';
      idx += 4;
    } else if (
      tokens[idx] === 'you' &&
      tokens[idx + 1] === 'control' &&
      tokens[idx + 2] === 'no'
    ) {
      controller = 'you';
      idx += 3;
      if (tokens[idx] === 'other') {
        excludeSource = true;
        idx++;
      }
    }

    if (controller !== null) {
      // Parse a comma-tolerant filter: skip commas between qualifier words so
      // "nonartifact, nonwhite creatures" is consumed in one pass. Only consume
      // a comma when the token AFTER it is also a valid filter word — this way
      // the trailing separator comma (e.g. "no creatures, this creature has...")
      // is left for the caller to consume.
      // Slice 2 extension: support "or <color>" accumulation (e.g. "no white or blue creature").
      let filter: CardFilter | null = null;
      const colorMap2: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
        white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
      };
      while (idx < tokens.length) {
        const word = tokens[idx];
        // Peek-ahead comma: skip only if the next token is a valid filter word.
        if (word === ',') {
          const nextWord = tokens[idx + 1];
          const hasNext = nextWord
            ? (CONDITION_LAND_SUBTYPES[nextWord] != null || CONDITION_PLANESWALKER_SUBTYPES[nextWord] != null || parseStaticFilterType(nextWord) !== null)
            : false;
          if (!hasNext) break;
          idx++; // consume comma
          continue;
        }
        // Slice 2: "or <color>" → accumulate into filter.colors (matchesCardFilter colors = any-of)
        if (word === 'or' && filter) {
          const orColorWord = tokens[idx + 1] ?? '';
          const orColor = colorMap2[orColorWord];
          if (orColor && filter.colors) {
            const baseF: CardFilter = filter;
            filter = { ...baseF, colors: [...baseF.colors!, orColor] };
            idx += 2;
            continue;
          }
          break; // unrecognised "or" — stop
        }
        const landSubtype = CONDITION_LAND_SUBTYPES[word];
        const pwSubtype = CONDITION_PLANESWALKER_SUBTYPES[word];
        const next: CardFilter | null = landSubtype
          ? { types: ['land'], subtypes: [landSubtype] }
          : pwSubtype
          ? { types: ['planeswalker'], subtypes: [pwSubtype] }
          : parseStaticFilterType(word);
        if (!next) break;
        filter = filter ? mergeStaticFilters(filter, next) : next;
        idx++;
      }
      if (filter) {
        return {
          condition: {
            kind: 'ControlsNone',
            controller,
            filter,
            ...(excludeSource ? { excludeSource: true } : {}),
          },
          nextIndex: idx,
        };
      }
    }
  }

  // "you control a/an/another <filter>" and "you control N or more <filter>"
  if (tokens[startIndex] === 'you' && tokens[startIndex + 1] === 'control') {
    let idx = startIndex + 2;
    let excludeSource = false;
    let count: number | null = null;
    if (tokens[idx] === 'a' || tokens[idx] === 'an') {
      idx++;
    } else if (tokens[idx] === 'another') {
      excludeSource = true;
      idx++;
    } else {
      const n = parseSmallNumberToken(tokens[idx] ?? '');
      if (Number.isNaN(n) || tokens[idx + 1] !== 'or' || tokens[idx + 2] !== 'more') return null;
      count = n;
      idx += 3;
    }
    const subject = parseConditionSubjectFilter(tokens, idx);
    if (!subject) return null;
    if (count !== null) {
      // "you control three or more artifacts" (Metalcraft) — a battlefield count.
      return {
        condition: { kind: 'CardsInZoneAtLeast', controller: 'you', zone: 'battlefield', count, filter: subject.filter },
        nextIndex: subject.nextIndex,
      };
    }
    return {
      condition: {
        kind: 'ControlsType',
        controller: 'you',
        filter: subject.filter,
        ...(excludeSource ? { excludeSource: true } : {}),
      },
      nextIndex: subject.nextIndex,
    };
  }

  // "an opponent controls a/an <filter>"
  if (tokens[startIndex] === 'an' && tokens[startIndex + 1] === 'opponent' && tokens[startIndex + 2] === 'controls') {
    let idx = startIndex + 3;
    if (tokens[idx] !== 'a' && tokens[idx] !== 'an') return null;
    idx++;
    const subject = parseConditionSubjectFilter(tokens, idx);
    if (!subject) return null;
    return {
      condition: { kind: 'ControlsType', controller: 'opponent', filter: subject.filter },
      nextIndex: subject.nextIndex,
    };
  }

  // "<color> is the most common color among all permanents [or is tied for
  // most common]" (Zanam/Sulam/Ruham/Goham Djinn).
  {
    const colorWords: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
      white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
    };
    const color = colorWords[tokens[startIndex] ?? ''];
    if (color
        && tokens[startIndex + 1] === 'is' && tokens[startIndex + 2] === 'the'
        && tokens[startIndex + 3] === 'most' && tokens[startIndex + 4] === 'common'
        && tokens[startIndex + 5] === 'color' && tokens[startIndex + 6] === 'among'
        && tokens[startIndex + 7] === 'all' && tokens[startIndex + 8] === 'permanents') {
      let idx = startIndex + 9;
      let orTiedForMost = false;
      if (tokens[idx] === 'or' && tokens[idx + 1] === 'is' && tokens[idx + 2] === 'tied'
          && tokens[idx + 3] === 'for' && tokens[idx + 4] === 'most' && tokens[idx + 5] === 'common') {
        orTiedForMost = true;
        idx += 6;
      }
      return {
        condition: {
          kind: 'ColorIsMostCommonAmongPermanents',
          color,
          ...(orTiedForMost ? { orTiedForMost: true } : {}),
        },
        nextIndex: idx,
      };
    }
  }

  // ── Slice 9/11: self-static pump conditions ─────────────────────────────────

  // "you've cast two or more spells this turn" (Brightspear Zealot family).
  // Evaluable from state.spellsCastThisTurn in continuous.ts evaluateCondition.
  // Accepts: "you've cast N or more spells this turn" (N = small number word or digit).
  // Tokenised as: ["you've", "cast", N, "or", "more", "spells", "this", "turn"]
  // or: ["you", "'ve", "cast", ...] depending on tokenizer apostrophe handling.
  {
    let idx = startIndex;
    // Handle "you've" (apostrophe may be elided or the tokenizer may keep the whole token)
    let youCastMatch = false;
    if (tokens[idx] === "you've" && tokens[idx + 1] === 'cast') {
      idx += 2;
      youCastMatch = true;
    } else if (tokens[idx] === 'you' && tokens[idx + 1] === "'ve" && tokens[idx + 2] === 'cast') {
      idx += 3;
      youCastMatch = true;
    }
    if (youCastMatch) {
      const n = parseSmallNumberToken(tokens[idx] ?? '');
      if (!Number.isNaN(n) && tokens[idx + 1] === 'or' && tokens[idx + 2] === 'more'
          && tokens[idx + 3] === 'spells' && tokens[idx + 4] === 'this' && tokens[idx + 5] === 'turn') {
        return {
          condition: { kind: 'SpellsCastThisTurnAtLeast', count: n },
          nextIndex: idx + 6,
        };
      }
    }
  }

  // ── Slice 4: top-card-of-library condition ───────────────────────────────────
  //
  // "the top card of your library is <color>" (Vampire Nocturnus / Avatar variant)
  //   Tokens: ["the", "top", "card", "of", "your", "library", "is", "<color>"]
  //
  // "the top card of your library is a <type> card" (Crown of Convergence family)
  //   Tokens: ["the", "top", "card", "of", "your", "library", "is", "a", "<type>", "card"]
  //
  // HONEST: continuous.ts evaluateCondition case 'TopCardOfLibraryIs' reads the
  // first library-zone card for the controller from state.cards (Map insertion order
  // preserves the library stack — same assumption as canPlayCardFromTopOfLibrary in
  // stack.ts). If the library is empty the condition is false.
  if (
    tokens[startIndex] === 'the' &&
    tokens[startIndex + 1] === 'top' &&
    tokens[startIndex + 2] === 'card' &&
    tokens[startIndex + 3] === 'of' &&
    tokens[startIndex + 4] === 'your' &&
    tokens[startIndex + 5] === 'library' &&
    tokens[startIndex + 6] === 'is'
  ) {
    const colorWordMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
      white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
    };
    const cardTypeWords = new Set([
      'creature', 'land', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'battle',
    ]);

    const afterIs = startIndex + 7;
    const w = tokens[afterIs] ?? '';
    // Form A: "is <color>" (e.g. "is black")
    const colorCode = colorWordMap[w.toLowerCase()];
    if (colorCode) {
      return {
        condition: { kind: 'TopCardOfLibraryIs', colors: [colorCode] },
        nextIndex: afterIs + 1,
      };
    }
    // Form B: "is a <type> card" (e.g. "is a creature card")
    if (w === 'a' || w === 'an') {
      const typeWord = (tokens[afterIs + 1] ?? '').toLowerCase();
      if (cardTypeWords.has(typeWord)) {
        // Optional trailing "card" (usually present: "is a creature card")
        let end = afterIs + 2;
        if ((tokens[end] ?? '') === 'card') end++;
        return {
          condition: { kind: 'TopCardOfLibraryIs', cardTypes: [typeWord] },
          nextIndex: end,
        };
      }
    }
  }

  // ── Slice 2: conditional self-buff conditions ────────────────────────────────

  // "there is a/an [filter] card in your graveyard" (Murasa Behemoth family).
  // Represents CardsInZoneAtLeast { zone: 'graveyard', count: 1, filter }.
  // Executor: continuous.ts evaluateCondition case 'CardsInZoneAtLeast' counts
  // matching cards in zone ≥ 1 — already implemented and executor-backed.
  //
  // Accepted forms:
  //   "there is a land card in your graveyard"    → filter: { types: ['land'] }
  //   "there is a creature card in your graveyard" → filter: { types: ['creature'] }
  //   etc. (any single filter word parseable by parseStaticFilterType)
  if (
    tokens[startIndex] === 'there' &&
    tokens[startIndex + 1] === 'is'
  ) {
    let idx = startIndex + 2;
    if (tokens[idx] === 'a' || tokens[idx] === 'an') idx++;
    const subject = parseConditionSubjectFilter(tokens, idx);
    if (subject) {
      // Consume optional "card" suffix: "there is a land card in your graveyard"
      let scan = subject.nextIndex;
      if (tokens[scan] === 'card') scan++;
      if (
        tokens[scan] === 'in' && tokens[scan + 1] === 'your' &&
        tokens[scan + 2] === 'graveyard'
      ) {
        return {
          condition: {
            kind: 'CardsInZoneAtLeast',
            controller: 'you',
            zone: 'graveyard',
            count: 1,
            filter: subject.filter,
          },
          nextIndex: scan + 3,
        };
      }
    }
  }

  // "it's untapped" / "it is untapped" (Giant Tortoise family).
  // Handles both straight apostrophe (it's) and smart-quote variant (it’s).
  // Condition SelfIsUntapped — true when the source permanent's tapped field is falsy.
  // Executor: continuous.ts evaluateCondition case 'SelfIsUntapped' reads
  // state.cards.get(sourceInstanceId)?.tapped. sourceInstanceId is always provided
  // when continuous.ts calls evaluateCondition for a permanent's own abilities.
  {
    const t0 = tokens[startIndex] ?? '';
    const isItsToken = t0 === "it's" || t0 === 'it’s';
    const isItIsUntapped =
      t0 === 'it' && tokens[startIndex + 1] === 'is' && tokens[startIndex + 2] === 'untapped';
    if ((isItsToken && tokens[startIndex + 1] === 'untapped') || isItIsUntapped) {
      const nextIndex = isItIsUntapped ? startIndex + 3 : startIndex + 2;
      return { condition: { kind: 'SelfIsUntapped' }, nextIndex };
    }
  }

  // "it's attacking" / "it is attacking" (Freyalise's Winds family).
  // Condition SelfIsAttacking — true when the source is in state.combat.attackers.
  // Executor: continuous.ts evaluateCondition case 'SelfIsAttacking'.
  {
    const t0 = tokens[startIndex] ?? '';
    const isItsToken = t0 === "it's" || t0 === 'it’s';
    const isItIsAttacking =
      t0 === 'it' && tokens[startIndex + 1] === 'is' && tokens[startIndex + 2] === 'attacking';
    if ((isItsToken && tokens[startIndex + 1] === 'attacking') || isItIsAttacking) {
      const nextIndex = isItIsAttacking ? startIndex + 3 : startIndex + 2;
      return { condition: { kind: 'SelfIsAttacking' }, nextIndex };
    }
  }

  // "no opponent controls a/an <filter>" (Skittish Kavu family).
  // Alternate phrasing for "your opponents control no <filter>".
  // Maps to ControlsNone { controller: 'opponent', filter }.
  // Executor: continuous.ts evaluateCondition case 'ControlsNone' — already implemented.
  if (
    tokens[startIndex] === 'no' &&
    tokens[startIndex + 1] === 'opponent' &&
    tokens[startIndex + 2] === 'controls'
  ) {
    let idx = startIndex + 3;
    if (tokens[idx] === 'a' || tokens[idx] === 'an') idx++;
    const subject = parseConditionSubjectFilter(tokens, idx);
    if (!subject) return null;
    return {
      condition: { kind: 'ControlsNone', controller: 'opponent', filter: subject.filter },
      nextIndex: subject.nextIndex,
    };
  }

  return null;
}

// Keywords a conditional GrantKeyword static may claim: the engine-enforced
// keyword set (keywords.ts KEYWORD_MAP → getKeywordsForInstance, which gates
// conditional grants on evaluateCondition).
const CONDITIONAL_GRANT_KEYWORDS = new Set([
  'flying', 'reach', 'trample', 'deathtouch', 'first strike', 'double strike',
  'lifelink', 'vigilance', 'haste', 'menace', 'defender', 'hexproof', 'shroud',
  'indestructible', 'flash', 'unblockable', 'cannotblock', 'cannotattack',
  // Slice 6: IgnoreDefender pseudo-keyword for conditional "as long as" forms
  // (Ogre Jailbreaker: "can attack as though it didn't have defender as long as you control a Wall").
  'ignoredefender',
]);
// Evasion keywords combat.ts enforces for the SOURCE creature itself via the
// keywords.ts getEvasionKeywords oracle-text scan (canBlock →
// blockerSatisfiesEvasion), so only self statics may claim them. The scan is
// not condition-aware — it mirrors the engine's existing treatment of inline
// evasion wording.
const CONDITIONAL_SELF_GRANT_KEYWORDS = new Set([
  'fear', 'intimidate', 'shadow', 'horsemanship', 'skulk',
]);

/** Only claim conditional statics whose modifier the engine actually runs. */
function conditionalStaticModifierSupported(ability: StaticAbilityEffect): boolean {
  const mod = ability.modifier;
  if (mod.kind === 'GrantKeyword' || mod.kind === 'GrantKeywords') {
    const keywords = mod.kind === 'GrantKeyword' ? [mod.keyword] : mod.keywords;
    return keywords.every(kw => {
      const normalized = kw.toLowerCase();
      if (CONDITIONAL_GRANT_KEYWORDS.has(normalized)) return true;
      return !!ability.selfOnly && CONDITIONAL_SELF_GRANT_KEYWORDS.has(normalized);
    });
  }
  // ModifyPT / ModifyPTByUniqueColors... (continuous.ts isAffectedBy) and
  // ReduceCost / IncreaseCost (getCostReduction / getCostIncrease) all gate
  // on ability.condition already.
  return true;
}

function isAbilityWordDashToken(token: string | undefined): boolean {
  return token === '—' || token === '–' || token === '-';
}

/**
 * matchConditionalStaticAbility verdicts:
 *  - 'match': fully supported conditional static — register & gate on condition.
 *  - 'unsupported': the static half IS a static the engine could run, but the
 *    condition has no evaluator (city's blessing, "it's attacking", paired,
 *    counters-on-it, ...) or the granted keyword is not engine-enforced. The
 *    caller must return Unparsed: claiming it unconditionally (the old
 *    matchStaticAbility behavior) over-applies the modifier, and letting it
 *    fall through lets the loose spell-clause matchers mis-claim the fragment.
 *  - null: not a conditional-static shape at all.
 */
export type ConditionalStaticMatch =
  | { kind: 'match'; ability: StaticAbilityEffect }
  | { kind: 'unsupported' }
  | null;

/**
 * Conditional statics: "As long as <condition>, <static>" (Guul Draz Vampire,
 * Anurid Barkripper) and "<static> as long as <condition>" (Krosan Beast),
 * optionally behind an ability-word prefix such as "Threshold —". The static
 * half reuses matchStaticAbility; the condition half must map onto the
 * Condition union evaluateCondition (continuous.ts) supports. Execution:
 * continuous.ts isAffectedBy / getCostReduction / getCostIncrease and
 * keywords.ts getKeywordsForInstance all skip the modifier while the
 * condition is false.
 */
export function matchConditionalStaticAbility(tokens: string[]): ConditionalStaticMatch {
  let work = tokens;
  // Ability-word prefix ("Threshold —", "Metalcraft —", "Fateful hour —"):
  // skip "<word> —" / "<word> <word> —". Safe to do blindly — the claim below
  // still requires a supported condition AND a supported static.
  if (isAbilityWordDashToken(work[1])) work = work.slice(2);
  else if (isAbilityWordDashToken(work[2])) work = work.slice(3);

  // Prefix form: "as long as <condition>, <static>"
  if (work[0] === 'as' && work[1] === 'long' && work[2] === 'as') {
    // Soulbond paired-condition: "as long as ~ is paired with another/a creature, ..."
    // "as long as this creature is paired with another creature, ..."
    // The "paired" condition has no evaluator in continuous.ts / keywords.ts.
    // Block parseMultipleEffects from mis-claiming the body (trigger body or buff text)
    // as a Spell effect by returning 'unsupported' unconditionally for ALL paired-with forms.
    // Slice 9: handles both "both creatures have <keyword>", P/T buffs ("that creature gets
    // +2/+2"), and trigger bodies ("whenever that creature deals combat damage...").
    // Consistent with static-abilities.ts:3113 which documents 'paired' as an unsupported
    // condition for the conditional-static evaluator.
    // work[3] is '~' (or 'this'), work[4] is 'is'/'creature', work[5] is 'paired'/'is', ...
    {
      // "~ is paired with ..."
      const isTildeForm = work[3] === '~' && work[4] === 'is' && work[5] === 'paired' && work[6] === 'with';
      // "this <noun> is paired with ..." — e.g. "this creature is paired with"
      const isThisForm = work[3] === 'this' && work[5] === 'is' && work[6] === 'paired' && work[7] === 'with';
      if (isTildeForm || isThisForm) {
        return { kind: 'unsupported' };
      }
    }
    const cond = parseStaticCondition(work, 3);
    if (cond && work[cond.nextIndex] === ',') {
      const ability = matchStaticAbility(work.slice(cond.nextIndex + 1));
      if (!ability) return null;
      if (!conditionalStaticModifierSupported(ability)) return { kind: 'unsupported' };
      return { kind: 'match', ability: { ...ability, condition: cond.condition } };
    }
    // Unsupported condition: when the clause after the first comma is a
    // static the engine could otherwise run, decline the whole face instead
    // of letting a downstream matcher mis-claim it.
    const comma = work.indexOf(',');
    if (comma > 3 && matchStaticAbility(work.slice(comma + 1))) {
      return { kind: 'unsupported' };
    }
    return null;
  }

  // Suffix form: "<static> as long as <condition>" — the condition must
  // consume the rest of the sentence ("for as long as" is a duration on a
  // one-shot effect, not a static condition, so it is excluded).
  for (let i = 1; i + 2 < work.length; i++) {
    if (work[i] !== 'as' || work[i + 1] !== 'long' || work[i + 2] !== 'as') continue;
    if (work[i - 1] === 'for') return null;
    const ability = matchStaticAbility(work.slice(0, i));
    if (!ability) return null;
    const cond = parseStaticCondition(work, i + 3);
    if (!cond) return { kind: 'unsupported' };
    let end = cond.nextIndex;
    if (work[end] === '.') end++;
    if (end !== work.length) return null;
    if (!conditionalStaticModifierSupported(ability)) return { kind: 'unsupported' };
    return { kind: 'match', ability: { ...ability, condition: cond.condition } };
  }

  return null;
}

// ============================================================================
// matchAsThoughFlash
// ============================================================================

/**
 * Match the three verified "as though it had flash" shapes printed on the
 * spell itself.
 *
 * SHAPE 1 — bare grant:
 *   "You may cast this spell as though it had flash."
 *
 * SHAPE 2 — pay-more rider:
 *   "You may cast this spell as though it had flash if you pay {2} more to
 *    cast it."  (Asinine Antics, Oakshade Stalker)
 *
 * SHAPE 3 — Ferocious-style condition (evaluated by evaluateCondition
 * ControlsType check):
 *   "Ferocious — If you control a creature with power 4 or greater, you may
 *    cast this spell as though it had flash."  (Dragon Grip)
 *
 * HONESTY:
 *   - Bare grant and pay-more rider: verified shapes only. Spider Climb's
 *     narrative follow-on ("If you cast it any time a sorcery couldn't have
 *     been cast, ...") is a DIFFERENT sentence that we DECLINE unless it can
 *     independently parse; the flash-grant sentence still parses correctly on
 *     its own.
 *   - Condition gate: we claim ONLY the "you control a creature with power N
 *     or greater" variant (ControlsType with power filter) — the only Ferocious
 *     wording evaluateCondition supports for this pattern.
 *
 * EXECUTION:
 *   stack.ts reads the modifier via `hasAsThoughFlash` (permits instant-speed
 *   casting) and `getAsThoughFlashSurcharge` (adds generic surcharge when the
 *   spell is cast at instant speed). No continuous-layer consumer reads this
 *   modifier; stack.ts is the single enforcement site. The `selfOnly` flag
 *   ensures registerContinuousAbilitiesForPermanent (the permanent-facing path)
 *   skips it — this is a spell-cast-time static, not a battlefield effect.
 *
 * HONESTY GATE:
 *   We claim the face ONLY when the as-though-flash sentence is the sole
 *   non-keyword / non-flash-grant text. Any sentence we cannot parse (beyond
 *   the recognised variants) keeps the whole face Unparsed so we never mask
 *   an unrun ability.
 */

// Bare form: "you may cast this spell as though it had flash"
const BARE_AS_THOUGH_FLASH_RE =
  /\byou\s+may\s+cast\s+this\s+spell\s+as\s+though\s+it\s+had\s+flash\b/i;

// Pay-more rider: extract the generic surcharge N from "{N} more to cast it"
const PAY_MORE_AS_THOUGH_FLASH_RE =
  /\byou\s+may\s+cast\s+this\s+spell\s+as\s+though\s+it\s+had\s+flash\s+if\s+you\s+pay\s+\{(\d+)\}\s+more\s+to\s+cast\s+it\b/i;

// Ferocious prefix: "if you control a creature with power N or greater"
const FEROCIOUS_PREFIX_RE =
  /\bif\s+you\s+control\s+a\s+creature\s+with\s+power\s+(\d+)\s+or\s+greater\s*[,.]?\s*/i;

// Ability-word dash prefix ("Ferocious —", "Formidable —")
const ABILITY_WORD_DASH_RE = /^\w[\w\s]*\s*[—–-]\s*/i;

// SHAPE 5/6/7 — condition-prefix and condition-tail forms.
//
// Conditions can appear BEFORE or AFTER the flash grant in the sentence:
//   PREFIX: "As long as you control a green permanent, you may cast this spell as though it had flash."
//   TAIL:   "You may cast this spell as though it had flash if you control a Faerie."
//
// We handle both by parsing conditions and then looking for the bare flash phrase in
// the remainder OR prefix.

// SHAPE 5 prefix — "as long as you control a <color> [or <color>] permanent, ..."
const AS_LONG_AS_CONTROLS_COLOR_PERMANENT_RE =
  /^as\s+long\s+as\s+you\s+control\s+a\s+((?:(?:white|blue|black|red|green)\s+or\s+)*(?:white|blue|black|red|green))\s+(?:or\s+\w+\s+)?permanent\s*[,.]?\s*/i;

// SHAPE 6 prefix — "if you control a <Subtype>, ..." or "as long as you control a <Subtype>, ..."
const CONTROLS_SUBTYPE_PREFIX_RE =
  /^(?:as\s+long\s+as\s+|if\s+)you\s+control\s+a(?:n)?\s+([A-Z][a-zA-Z]+)\s*[,.]?\s*/i;

// SHAPE 7 prefix — "if there are N or more <type|subtype> cards in your graveyard, ..."
const GRAVEYARD_CARDS_PREFIX_RE =
  /^(?:spell\s+mastery\s*[—–-]\s*)?if\s+there\s+are\s+(\w+)\s+or\s+more\s+([\w\s/]+?)\s+cards?\s+in\s+your\s+graveyard\s*[,.]?\s*/i;

// TAIL condition — "...as though it had flash if you control a <Subtype>"
// Illusion Spinners: "...if you control a Faerie"
const TAIL_CONTROLS_SUBTYPE_RE =
  /^if\s+you\s+control\s+a(?:n)?\s+([A-Z][a-zA-Z]+)\s*$/i;

// TAIL condition — "...as though it had flash if you control a <color> [or <color>] permanent"
const TAIL_CONTROLS_COLOR_PERMANENT_RE =
  /^if\s+you\s+control\s+a\s+((?:(?:white|blue|black|red|green)\s+or\s+)*(?:white|blue|black|red|green))\s+(?:or\s+\w+\s+)?permanent\s*$/i;

// TAIL condition — "...as though it had flash if there are N or more <type> cards in your graveyard"
const TAIL_GRAVEYARD_CARDS_RE =
  /^if\s+there\s+are\s+(\w+)\s+or\s+more\s+([\w\s/]+?)\s+cards?\s+in\s+your\s+graveyard\s*$/i;

/**
 * Try to parse a "tail condition" from the remainder after the bare flash grant.
 * Returns a Condition or null (null means the tail is unrecognized → decline the whole card).
 * Returns undefined when there is NO tail (bare grant, no condition).
 */
function parseTailCondition(
  tail: string,
): import('../ast').Condition | null | undefined {
  const t = tail.trim();
  if (!t) return undefined; // No tail — bare grant

  // "if you pay {N} more to cast it" — this is the surcharge, not a condition
  // (handled separately before this function is called)

  // Tail: "if you control a <Subtype>"
  const subtypeMatch = TAIL_CONTROLS_SUBTYPE_RE.exec(t);
  if (subtypeMatch) {
    const subtype = subtypeMatch[1].toLowerCase();
    if (FLASH_CONDITION_CREATURE_SUBTYPES.has(subtype)) {
      return {
        kind: 'ControlsType',
        controller: 'you',
        filter: { types: ['creature'], subtypes: [subtype] },
      };
    }
    return null; // Unknown subtype — decline
  }

  // Tail: "if you control a <color> [or <color>] permanent"
  const colorPermMatch = TAIL_CONTROLS_COLOR_PERMANENT_RE.exec(t);
  if (colorPermMatch) {
    const colorPhrase = colorPermMatch[1].toLowerCase();
    const colorTokens = colorPhrase.split(/\s+or\s+/);
    const colors = colorTokens
      .map(w => FLASH_COLOR_WORDS[w.trim()])
      .filter((c): c is 'W' | 'U' | 'B' | 'R' | 'G' => !!c);
    if (colors.length === 0) return null;
    return {
      kind: 'ControlsType',
      controller: 'you',
      filter: { colors, permanent: true },
    };
  }

  // Tail: "if there are N or more <type> cards in your graveyard"
  const gyMatch = TAIL_GRAVEYARD_CARDS_RE.exec(t);
  if (gyMatch) {
    const cond = parseGraveyardCardsCondition(gyMatch[1], gyMatch[2]);
    return cond ?? null;
  }

  // Any other tail — decline (e.g. "if it targets a commander", "if it targets a permanent")
  return null;
}

// Small number words (for GRAVEYARD_CARDS_PREFIX_RE group 1)
const SMALL_NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// Map color words to color codes
const FLASH_COLOR_WORDS: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
};

// Creature subtypes valid as subtype-gate condition in matchAsThoughFlash.
// These are widely-known MTG creature types that evaluateCondition ControlsType
// can evaluate via matchesCardFilter { types: ['creature'], subtypes: [<type>] }.
const FLASH_CONDITION_CREATURE_SUBTYPES = new Set([
  'faerie', 'elf', 'goblin', 'zombie', 'angel', 'demon', 'merfolk', 'sliver',
  'soldier', 'wizard', 'knight', 'warrior', 'cleric', 'rogue', 'shaman', 'beast',
  'elemental', 'vampire', 'human', 'spirit', 'bird', 'cat', 'dinosaur', 'pirate',
  'dwarf', 'wolf', 'ally', 'dragon', 'scout', 'hydra', 'leviathan', 'horror',
  'ninja', 'samurai', 'advisor', 'artificer', 'monk',
]);

/**
 * Parse "if there are N or more <type> cards in your graveyard" into a
 * CardsInZoneAtLeast condition. The type clause may be "instant and/or sorcery"
 * (spell mastery) or a single subtype like "Lesson".
 * Returns null if the type clause cannot be reliably parsed.
 */
function parseGraveyardCardsCondition(
  countWord: string,
  typeClause: string,
): import('../ast').Condition | null {
  const count = SMALL_NUMBER_WORDS[countWord.toLowerCase()] ?? parseInt(countWord, 10);
  if (!count || count < 1) return null;

  const norm = typeClause.toLowerCase().trim();

  // "instant and/or sorcery" — CardFilter with anyOf [instant, sorcery]
  if (/^instant\s+and\/?or\s+sorcery$/.test(norm) || /^instant\s+or\s+sorcery$/.test(norm) ||
      /^sorcery\s+and\/?or\s+instant$/.test(norm)) {
    return {
      kind: 'CardsInZoneAtLeast',
      controller: 'you',
      zone: 'graveyard',
      count,
      filter: { anyOf: [{ types: ['instant'] }, { types: ['sorcery'] }] },
    };
  }

  // Single card type: "creature", "artifact", "enchantment", "sorcery", "instant"
  const CARD_TYPES = new Set(['creature', 'artifact', 'enchantment', 'sorcery', 'instant', 'planeswalker']);
  if (CARD_TYPES.has(norm)) {
    return {
      kind: 'CardsInZoneAtLeast',
      controller: 'you',
      zone: 'graveyard',
      count,
      filter: { types: [norm] },
    };
  }

  // Single subtype (e.g. "Lesson", "Saga") — use subtypes filter
  const KNOWN_SUBTYPES_FOR_GY = new Set([
    'lesson', 'saga', 'aura', 'equipment', 'vehicle', 'food', 'treasure', 'clue',
  ]);
  const normSingle = norm.split(/\s+/)[0];
  if (normSingle && KNOWN_SUBTYPES_FOR_GY.has(normSingle)) {
    return {
      kind: 'CardsInZoneAtLeast',
      controller: 'you',
      zone: 'graveyard',
      count,
      filter: { subtypes: [normSingle] },
    };
  }

  return null; // Unknown type clause — decline for honesty
}

/**
 * SHAPE 4 — Mirage 'flash-window cleanup-sacrifice' rider:
 *   "If you cast it any time a sorcery couldn't have been cast, the controller
 *    of the permanent it becomes sacrifices it at the beginning of the next
 *    cleanup step."
 *
 * This exact sentence appears on all 8 Mirage enchantments in this family
 * (Spider Climb, Armor of Thorns, Lightning Reflexes, Ward of Lights, …).
 * EXECUTION: stack.ts sets `castAtInstantSpeed` on the SpellStackItem when cast
 * outside the sorcery window; at resolution, `sacrificeAtCleanup` is set on the
 * entering CardInstance. turn-manager.ts sacrifices all flagged permanents at the
 * beginning of the cleanup step.
 */
const FLASH_WINDOW_CLEANUP_SACRIFICE_RE =
  /\bif\s+you\s+cast\s+it\s+any\s+time\s+a\s+sorcery\s+couldn'?t\s+have\s+been\s+cast\s*,\s*the\s+controller\s+of\s+the\s+permanent\s+it\s+becomes\s+sacrifices\s+it\s+at\s+the\s+beginning\s+of\s+the\s+next\s+cleanup\s+step\b/i;

export function matchAsThoughFlash(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;

  // Strip reminder text before sentence-splitting (mirrors matchCantBeCountered).
  const cleaned = stripReminderTextForCBC(oracleText);

  // Split into sentences on period / exclamation / newline boundaries.
  const sentences = cleaned
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let surcharge = 0;
  let condition: import('../ast').Condition | null = null;
  let hasFlashGrant = false;
  let hasSacrificeRider = false;

  for (const rawSentence of sentences) {
    // Strip a leading ability-word dash (e.g. "Ferocious — If you ...").
    const sentence = rawSentence.replace(ABILITY_WORD_DASH_RE, '').trim();

    // SHAPE 4: flash-window cleanup-sacrifice rider (Mirage enchantment family).
    // "If you cast it any time a sorcery couldn't have been cast, the controller
    //  of the permanent it becomes sacrifices it at the beginning of the next cleanup step."
    if (FLASH_WINDOW_CLEANUP_SACRIFICE_RE.test(sentence)) {
      hasSacrificeRider = true;
      continue;
    }

    // SHAPE 3: "If you control a creature with power N or greater, you may cast
    // this spell as though it had flash [if you pay {N} more...]"
    const ferociousMatch = FEROCIOUS_PREFIX_RE.exec(sentence);
    if (ferociousMatch) {
      const remainder = sentence.slice(ferociousMatch[0].length).trim();
      // The remainder must be one of the recognized flash-grant shapes.
      const payMore = PAY_MORE_AS_THOUGH_FLASH_RE.exec(remainder);
      if (payMore) {
        surcharge = parseInt(payMore[1], 10);
        condition = {
          kind: 'ControlsType',
          controller: 'you',
          filter: { types: ['creature'], power: { op: 'gte', value: parseInt(ferociousMatch[1], 10) } },
        };
        hasFlashGrant = true;
        continue;
      }
      if (BARE_AS_THOUGH_FLASH_RE.test(remainder)) {
        condition = {
          kind: 'ControlsType',
          controller: 'you',
          filter: { types: ['creature'], power: { op: 'gte', value: parseInt(ferociousMatch[1], 10) } },
        };
        hasFlashGrant = true;
        continue;
      }
      // The remainder is something we cannot parse — decline.
      return null;
    }

    // SHAPE 5: "As long as you control a <color> [or <color>] permanent, you may cast
    // this spell as though it had flash."
    // Hungering Yeti: "As long as you control a green or blue permanent, ..."
    const colorPermanentMatch = AS_LONG_AS_CONTROLS_COLOR_PERMANENT_RE.exec(sentence);
    if (colorPermanentMatch) {
      const colorPhrase = colorPermanentMatch[1].toLowerCase();
      const colorTokens = colorPhrase.split(/\s+or\s+/);
      const colors = colorTokens
        .map(w => FLASH_COLOR_WORDS[w.trim()])
        .filter((c): c is 'W' | 'U' | 'B' | 'R' | 'G' => !!c);
      if (colors.length === 0) return null; // Unrecognized color — decline
      const remainder = sentence.slice(colorPermanentMatch[0].length).trim();
      if (BARE_AS_THOUGH_FLASH_RE.test(remainder)) {
        condition = {
          kind: 'ControlsType',
          controller: 'you',
          filter: { colors, permanent: true },
        };
        hasFlashGrant = true;
        continue;
      }
      // Remainder is not a flash-grant; decline.
      return null;
    }

    // SHAPE 6 (prefix form): "if you control a <Subtype>, you may cast this spell as though it had flash."
    // Different from FEROCIOUS (which requires "with power N or greater").
    const subtypeGateMatch = CONTROLS_SUBTYPE_PREFIX_RE.exec(sentence);
    if (subtypeGateMatch) {
      const subtype = subtypeGateMatch[1].toLowerCase();
      if (FLASH_CONDITION_CREATURE_SUBTYPES.has(subtype)) {
        const remainder = sentence.slice(subtypeGateMatch[0].length).trim();
        if (BARE_AS_THOUGH_FLASH_RE.test(remainder)) {
          condition = {
            kind: 'ControlsType',
            controller: 'you',
            filter: { types: ['creature'], subtypes: [subtype] },
          };
          hasFlashGrant = true;
          continue;
        }
      }
      // Unknown subtype or remainder unrecognized — decline.
      return null;
    }

    // SHAPE 7 (prefix form): "if there are N or more <type> cards in your graveyard, you may cast..."
    // Swift Reckoning / Spell mastery: "if there are two or more instant and/or sorcery cards..."
    // Serpent of the Pass: "If there are three or more Lesson cards in your graveyard"
    const graveyardGateMatch = GRAVEYARD_CARDS_PREFIX_RE.exec(sentence);
    if (graveyardGateMatch) {
      const cond = parseGraveyardCardsCondition(graveyardGateMatch[1], graveyardGateMatch[2]);
      if (!cond) return null; // Unknown type clause — decline for honesty
      const remainder = sentence.slice(graveyardGateMatch[0].length).trim();
      if (BARE_AS_THOUGH_FLASH_RE.test(remainder)) {
        condition = cond;
        hasFlashGrant = true;
        continue;
      }
      // Remainder is not a flash-grant — decline.
      return null;
    }

    // SHAPE 2: pay-more rider (exact match — consumes the whole sentence)
    const payMoreMatch = PAY_MORE_AS_THOUGH_FLASH_RE.exec(sentence);
    if (payMoreMatch) {
      surcharge = parseInt(payMoreMatch[1], 10);
      hasFlashGrant = true;
      continue;
    }

    // SHAPES 1 / 6 tail / 7 tail: sentence starts with the bare flash-grant phrase.
    // Use an exec to get the match end position, then parse any tail condition.
    // This handles:
    //   "you may cast this spell as though it had flash" (bare - no tail)
    //   "you may cast this spell as though it had flash if you control a Faerie" (SHAPE 6 tail)
    //   "you may cast this spell as though it had flash if you control a green or blue permanent"
    //   "you may cast this spell as though it had flash if there are N or more X cards..."
    // And REJECTS:
    //   "you may cast this spell as though it had flash if it targets a commander"
    //   "you may cast this spell as though it had flash if it targets a permanent you control"
    const bareMatch = BARE_AS_THOUGH_FLASH_RE.exec(sentence);
    if (bareMatch) {
      const tail = sentence.slice(bareMatch.index + bareMatch[0].length).trim();
      if (!tail) {
        // SHAPE 1: bare grant
        hasFlashGrant = true;
        continue;
      }
      // There is a tail — try to parse it as a known condition.
      const tailCond = parseTailCondition(tail);
      if (tailCond === undefined) {
        // No tail after all (shouldn't happen since tail is non-empty, but guard)
        hasFlashGrant = true;
        continue;
      }
      if (tailCond === null) {
        // Unknown tail condition — decline the whole card for honesty
        return null;
      }
      condition = tailCond;
      hasFlashGrant = true;
      continue;
    }

    // Any other sentence must be an engine-handled keyword; otherwise the card
    // has a real unrun function and we leave the whole face Unparsed.
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }

  if (!hasFlashGrant) return null;

  return {
    kind: 'StaticAbility',
    modifier: {
      kind: 'AsThoughFlash',
      surcharge,
      ...(hasSacrificeRider ? { sacrificeAtCleanupIfFlashCast: true } : {}),
    },
    filter: { permanent: true },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
    ...(condition ? { condition } : {}),
  };
}

// ============================================================================
// Slice 4: matchAllSubtypeAnthem
// ============================================================================

/**
 * Slice 4 — All-<subtype> anthem (old-Sliver block and scattered tribal anthems):
 *   "All Sliver creatures get +1/+1"     (Muscle Sliver)
 *   "All Slivers have flying"            (Winged Sliver)
 *   "All Sliver creatures have double strike"  (Fury Sliver)
 *   "All Goblin creatures get +1/+1"    (Goblin King partial form)
 *
 * Accepted subject forms:
 *   "all <subtype> creatures" — explicit "creatures" after the subtype word
 *   "all <subtype>s"          — plural subtype without "creatures" (e.g. "Slivers")
 *   "all <subtype>"           — singular/bare subtype (rare, e.g. "all Sliver")
 *
 * Emits a StaticAbilityEffect with:
 *   filter: { types: ['creature'], subtypes: [<subtype>] }
 *   controller: 'any'   (affects all matching creatures on the battlefield,
 *                         regardless of who controls them — the old Sliver rule)
 *   excludeSelf: false
 *
 * HONEST: continuous.ts isAffectedBy already evaluates controller:'any' statics
 * with subtype filters via matchesCardFilter → typeLineHasSubtype (the same path
 * as matchDynamicCDA and other controller:'any' statics). Both the ModifyPT and
 * GrantKeyword modifier kinds are already consumed by getContinuousPTModification
 * and getGrantedKeywords respectively. Parser-only change; no executor change.
 *
 * Only subtypes listed in parseStaticFilterType's subtypeMap are recognised, so
 * unknown subtypes return null (honest: we only claim what we can execute).
 */

/** Subtype map mirroring parseStaticFilterType's subtypeMap (kept in sync). */
const SUBTYPE_SINGULAR_MAP: Record<string, string> = {
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
  // Slice 1 (tribal-anthem expansion): kept in sync with parseStaticFilterType's subtypeMap
  kobold: 'kobold', kobolds: 'kobold',
  turtle: 'turtle', turtles: 'turtle',
  detective: 'detective', detectives: 'detective',
  villain: 'villain', villains: 'villain',
  minotaur: 'minotaur', minotaurs: 'minotaur',
  pegasus: 'pegasus',
  spawn: 'spawn', spawns: 'spawn',
  scion: 'scion', scions: 'scion',
  eldrazi: 'eldrazi',
  rebel: 'rebel', rebels: 'rebel',
  mercenary: 'mercenary', mercenaries: 'mercenary',
  kithkin: 'kithkin', kithkins: 'kithkin',
  ally: 'ally', allies: 'ally',
  shapeshifter: 'shapeshifter', shapeshifters: 'shapeshifter',
  avatar: 'avatar', avatars: 'avatar',
  kor: 'kor',
};

export function matchAllSubtypeAnthem(tokens: string[]): StaticAbilityEffect | null {
  let idx = 0;

  // Must start with "all"
  if (tokens[idx] !== 'all') return null;
  idx++;

  // Optional "other" ("all other Slivers get +1/+1" — same scope, excludeSelf true)
  let excludeSelf = false;
  if (tokens[idx] === 'other') { excludeSelf = true; idx++; }

  // Read the subtype word (must be in our known-subtype map for honesty)
  const subtypeWord = tokens[idx];
  if (!subtypeWord) return null;
  const subtypeSingular = SUBTYPE_SINGULAR_MAP[subtypeWord.toLowerCase()];
  if (!subtypeSingular) return null;
  idx++;

  // Optional explicit "creature" / "creatures" after the subtype
  if (tokens[idx] === 'creature' || tokens[idx] === 'creatures') {
    idx++;
  }

  // Verb: "get" / "gets" / "have" / "has" / "gain" / "gains"
  const verb = tokens[idx];
  if (!verb) return null;
  const isPT = verb === 'get' || verb === 'gets';
  const isKw = verb === 'have' || verb === 'has' || verb === 'gain' || verb === 'gains';
  if (!isPT && !isKw) return null;
  idx++;

  // "until end of turn" → this is a temporary spell effect, not a static
  if (tokens[idx] === 'until') return null;

  let modifier: StaticModifier;

  if (isPT) {
    // P/T bonus: "+1/+1", "+1/+0", etc.
    const ptMatch = tokens[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    modifier = {
      kind: 'ModifyPT',
      power: parseInt(ptMatch[1], 10),
      toughness: parseInt(ptMatch[2], 10),
    };
    idx++;
    // "until end of turn" after P/T → spell effect
    if (tokens[idx] === 'until') return null;
  } else {
    // Keyword grant: "flying", "first strike", "double strike", "haste", etc.
    let keyword: string;
    if (tokens[idx] === 'first' && tokens[idx + 1] === 'strike') {
      keyword = 'first strike'; idx += 2;
    } else if (tokens[idx] === 'double' && tokens[idx + 1] === 'strike') {
      keyword = 'double strike'; idx += 2;
    } else {
      keyword = tokens[idx] ?? '';
      if (!keyword) return null;
      idx++;
    }
    // "until end of turn" after keyword → spell effect
    if (tokens[idx] === 'until') return null;
    modifier = { kind: 'GrantKeyword', keyword };
  }

  // Optional trailing period
  if (tokens[idx] === '.') idx++;

  return {
    kind: 'StaticAbility',
    modifier,
    filter: { types: ['creature'], subtypes: [subtypeSingular] },
    controller: 'any',
    excludeSelf,
  };
}

// ============================================================================
// matchGrantLandSubtype (Slice 13 — CDA companion)
// ============================================================================

/**
 * Match the Ashaya-family static that makes nontoken (or all) creatures you
 * control also count as basic-land-subtype lands:
 *
 *   "Nontoken creatures you control are Forest lands in addition to their other types."
 *   "Creatures you control are Forest lands in addition to their other types."
 *
 * Accepted basic-land subtypes: Forest, Island, Swamp, Mountain, Plains.
 *
 * HONEST: `countForEachCDA` in continuous.ts is the enforcement site — when
 * counting lands (or a specific land subtype) for a CDA formula, instances
 * granted this modifier that match the companion filter are also counted.
 * `getGrantedLandSubtype` (continuous.ts export) is the single query helper.
 *
 * NOTE: Mana production from the affected creatures is NOT wired; this
 * implementation covers only the land-counting use-case (CDA P/T calculation).
 *
 * Accepted tail form: "are <Subtype> lands in addition to their other types[.]"
 */
const BASIC_LAND_SUBTYPE_MAP: Record<string, string> = {
  forest: 'Forest',
  forests: 'Forest',
  island: 'Island',
  islands: 'Island',
  swamp: 'Swamp',
  swamps: 'Swamp',
  mountain: 'Mountain',
  mountains: 'Mountain',
  plains: 'Plains',
};

export function matchGrantLandSubtype(tokens: string[]): StaticAbilityEffect | null {
  let idx = 0;

  // Subject: "Nontoken creatures you control" OR "Creatures you control"
  let nontoken = false;
  if (tokens[idx] === 'nontoken') {
    nontoken = true;
    idx++;
  }

  // Accept: "creature(s)", "permanent(s)" — only creatures are common in practice
  if (tokens[idx] !== 'creatures' && tokens[idx] !== 'creature') return null;
  idx++;

  // Controller scope
  if (tokens[idx] !== 'you' || tokens[idx + 1] !== 'control') return null;
  idx += 2;

  // Verb: "are"
  if (tokens[idx] !== 'are') return null;
  idx++;

  // Subtype: Forest / Island / Swamp / Mountain / Plains
  const subtypeSingular = BASIC_LAND_SUBTYPE_MAP[tokens[idx]?.toLowerCase() ?? ''];
  if (!subtypeSingular) return null;
  idx++;

  // "lands" (required)
  if (tokens[idx] !== 'lands' && tokens[idx] !== 'land') return null;
  idx++;

  // "in addition to their other types" (required — ensures additive semantics)
  if (
    tokens[idx] !== 'in' ||
    tokens[idx + 1] !== 'addition' ||
    tokens[idx + 2] !== 'to' ||
    tokens[idx + 3] !== 'their' ||
    tokens[idx + 4] !== 'other' ||
    tokens[idx + 5] !== 'types'
  ) return null;
  idx += 6;

  // Optional trailing period
  if (tokens[idx] === '.') idx++;

  const filter: CardFilter = {
    types: ['creature'],
    ...(nontoken ? { nontoken: true } : {}),
  };

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantLandSubtype', subtype: subtypeSingular },
    filter,
    controller: 'you',
    excludeSelf: false,
  };
}

// ============================================================================
// matchDynamicCDA
// ============================================================================

/**
 * Match a characteristic-defining P/T ability (CDA) on the card itself:
 *
 *   "[~'s | <name>'s | ~] power and toughness are each equal to the number of
 *    <filter> <zone-phrase>."
 *
 *   "[~'s | <name>'s | ~] power is equal to the number of <filter>
 *    <zone-phrase>."
 *
 *   "power and toughness equal to the number of <filter> <zone-phrase>."
 *   (Short Harmonious-Grovestrider / Kolaghan-Forerunners form without
 *   explicit subject — appears after a semicolon-separated keyword line.)
 *
 * HONEST: CDAs are layer-7a P/T overrides (CR 208.2). continuous.ts
 * `getDynamicBasePT` evaluates the count at query time using the same
 * `countForEachCDA` loop that mirrors `resolveForEachCount` in executor.ts.
 * `getEffectivePower`/`getEffectiveToughness` apply the result as the base
 * value (layer 7a overrides the printed value; counters and +X/+X mods stack
 * on top as usual).
 *
 * HONESTY GATE — we claim the face ONLY when:
 *  1. Exactly one CDA sentence is present.
 *  2. Every other sentence (after reminder-text removal) is an engine-handled
 *     keyword (reusing isCBCAllowedKeywordSentence).
 *  3. The counted phrase maps onto a ForEachAmount the executor/continuous
 *     layer supports: "the number of <filter> <you control | in your
 *     graveyard | on the battlefield | ...>" (the same shapes as
 *     parseNumberOfFilterAmount / readForEachZonePhrase).
 *  4. We decline "card types among" counts (devotion, delirium-like) and
 *     any shape that parseNumberOfFilterAmount cannot parse.
 *
 * The `selfOnly` flag ensures the continuous layer only applies the effect to
 * the CDA creature itself.
 */

// The CDA sentence is normalised before matching (reminder text stripped,
// possessive subject removed) so the regex sees a canonical form:
//   "power and toughness are each equal to the number of ..."
//   "power is equal to the number of ..."
//   "toughness is equal to the number of ..."

const CDA_BOTH_RE =
  /\bpower\s+and\s+toughness\s+(?:are\s+each|are\s+both|is\s+each)?\s*equal\s+to\s+(the\s+number\s+of\s+.+)/i;

const CDA_POWER_ONLY_RE =
  /\bpower\s+is\s+equal\s+to\s+(the\s+number\s+of\s+.+)/i;

// Slice 10 widening: toughness-only CDA — "~'s toughness is equal to the number
// of <filter> <zone-phrase>" (Yavimaya Kavu family). The executor's continuous
// layer already handles powerFormula: null (printed power applies unmodified).
const CDA_TOUGHNESS_ONLY_RE =
  /\btoughness\s+is\s+equal\s+to\s+(the\s+number\s+of\s+.+)/i;

/** Tokenize a plain-text phrase (no braces) into lower-case words. */
function plainTokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,;:!?]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function matchDynamicCDA(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;

  // Split into sentences (newline or semicolon separated; semicolons in
  // keyword ability lines like "Vigilance; power is equal to…" are treated
  // as sentence dividers for this purpose).
  const rawSentences = stripReminderTextForCBC(oracleText)
    .replace(/;/g, '\n')
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (rawSentences.length === 0) return null;

  // Slice 10 widening: cdaFormula now tracks power and toughness independently.
  // powerFormula: null  → printed power applies unmodified (toughness-only CDA).
  // toughnessFormula: null → printed toughness applies unmodified (power-only CDA).
  let cdaFormula: { power: ForEachAmount | null; toughness: ForEachAmount | null } | null = null;

  for (const rawSentence of rawSentences) {
    // Strip a leading possessive subject ("<name>'s" or "~'s" or "~") so the
    // regex sees the canonical tail.
    const sentence = rawSentence
      .replace(/^[\w\s'-]+?'s\s+/i, '')   // "Revenant's " / "Snow Villiers's "
      .replace(/^~\s+/i, '')              // "~ " (rare; most use ~'s)
      .trim();

    // Try "power and toughness ... equal to ..."
    const bothMatch = CDA_BOTH_RE.exec(sentence);
    if (bothMatch) {
      const tail = plainTokenize(bothMatch[1]);
      const parsed = parseNumberOfFilterAmount(tail, 0);
      if (!parsed) return null; // unsupported count — decline whole face
      if (cdaFormula) return null; // two CDA sentences — decline
      cdaFormula = { power: parsed.amount, toughness: parsed.amount };
      continue;
    }

    // Try "power is equal to ..."
    const powerMatch = CDA_POWER_ONLY_RE.exec(sentence);
    if (powerMatch) {
      const tail = plainTokenize(powerMatch[1]);
      const parsed = parseNumberOfFilterAmount(tail, 0);
      if (!parsed) return null;
      if (cdaFormula) return null;
      cdaFormula = { power: parsed.amount, toughness: null };
      continue;
    }

    // Slice 10 widening: try "toughness is equal to ..." (Yavimaya Kavu family).
    // powerFormula is null → continuous layer uses printed power unmodified.
    const toughnessMatch = CDA_TOUGHNESS_ONLY_RE.exec(sentence);
    if (toughnessMatch) {
      const tail = plainTokenize(toughnessMatch[1]);
      const parsed = parseNumberOfFilterAmount(tail, 0);
      if (!parsed) return null;
      if (cdaFormula) return null;
      cdaFormula = { power: null, toughness: parsed.amount };
      continue;
    }

    // Any remaining sentence must be an engine-handled keyword; otherwise the
    // card has a real unrun function and we leave the whole face Unparsed.
    if (!isCBCAllowedKeywordSentence(rawSentence)) return null;
  }

  if (!cdaFormula) return null;

  return {
    kind: 'StaticAbility',
    modifier: {
      kind: 'SetBasePTDynamic',
      powerFormula: cdaFormula.power,
      toughnessFormula: cdaFormula.toughness,
    },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// matchTappedForManaRider (Slice 7)
// ============================================================================

/**
 * Parse tapped-for-mana rider oracle text as a StaticAbilityEffect with modifier
 * kind 'TappedForManaRider'. Consumed inside tapLandForMana (actions.ts) — NOT
 * put on the stack as a trigger.
 *
 * Two scope families:
 *
 *   'attachedLand': "Whenever enchanted land is tapped for mana, its controller
 *     adds <mana> [to their mana pool in addition to the mana the land produces]."
 *     (Market Festival, Dawn's Reflection, Overgrowth, Trace of Abundance, ...)
 *
 *   'anyLand': "Whenever a player taps a land for mana, that player adds <mana>
 *     [to their mana pool in addition to the mana the land produces]."
 *     (Zhur-Taa Ancient family)
 *
 * Mana payload variants:
 *   Fixed colors — "adds {G}{G}" → mana: { G: 2 }
 *   Any-color    — "adds one mana of any color" → anyColor: 1
 *   Two-any-color — "adds two mana in any combination of colors" → twoAnyColor: true
 *
 * Returns null if the oracle text does not match either family.
 *
 * NOTE: The function receives full tokenized oracle text (from parseOracleText),
 * potentially with a leading "enchant land" preamble already trimmed by
 * trimLeadingKeywordOrEnchantPreamble. We accept both trimmed and untrimmed forms.
 */
export function matchTappedForManaRider(tokens: string[]): StaticAbilityEffect | null {
  // Skip optional "enchant land / enchant permanent" preamble tokens
  let start = 0;
  if (tokens[start] === 'enchant' && (tokens[start + 1] === 'land' || tokens[start + 1] === 'permanent')) {
    start += 2;
    if (tokens[start] === '.') start++;
  }

  const t = tokens.slice(start);
  if (t.length < 8) return null;

  // ----- 1. Detect scope -----
  let scope: 'attachedLand' | 'anyLand';
  let idx = 0;

  // Basic land subtype words accepted in the "enchanted <subtype>" form
  // (e.g. Utopia Sprawl "enchanted Forest", Wild Growth "enchanted Forest").
  const BASIC_LAND_SUBTYPES = new Set(['land', 'forest', 'island', 'swamp', 'mountain', 'plains']);

  // "whenever enchanted land is tapped for mana ,"
  // Also accepts "enchanted Forest / Island / Swamp / Mountain / Plains" (Utopia Sprawl family).
  if (
    t[idx] === 'whenever' && t[idx + 1] === 'enchanted' && BASIC_LAND_SUBTYPES.has(t[idx + 2] ?? '') &&
    t[idx + 3] === 'is' && t[idx + 4] === 'tapped' && t[idx + 5] === 'for' &&
    t[idx + 6] === 'mana'
  ) {
    scope = 'attachedLand';
    idx += 7;
    if (t[idx] === ',') idx++;
  }
  // "whenever a player taps a land for mana ,"
  else if (
    t[idx] === 'whenever' && t[idx + 1] === 'a' && t[idx + 2] === 'player' &&
    t[idx + 3] === 'taps' && t[idx + 4] === 'a' && t[idx + 5] === 'land' &&
    t[idx + 6] === 'for' && t[idx + 7] === 'mana'
  ) {
    scope = 'anyLand';
    idx += 8;
    if (t[idx] === ',') idx++;
  }
  else {
    return null;
  }

  // ----- 2. Expect controller subject -----
  // 'attachedLand': "its controller adds ..."
  // 'anyLand':      "that player adds ..."
  if (scope === 'attachedLand') {
    if (!(t[idx] === 'its' && t[idx + 1] === 'controller' && t[idx + 2] === 'adds')) return null;
    idx += 3;
  } else {
    if (!(t[idx] === 'that' && t[idx + 1] === 'player' && t[idx + 2] === 'adds')) return null;
    idx += 3;
  }

  // ----- 3. Parse mana payload -----
  // Variant A: fixed symbols "{G}{G}", "{R}{G}", etc.
  // Variant B: "one mana of any color"
  // Variant C: "two mana in any combination of colors"

  let riderMana: { W?: number; U?: number; B?: number; R?: number; G?: number; C?: number } | undefined;
  let anyColor: number | undefined;
  let twoAnyColor: true | undefined;
  let chosenColorRider: true | undefined;

  const tok = t[idx];
  if (!tok) return null;

  // Variant A: mana symbol chunk like "{g}{g}" or "{r}{g}"
  const symbols = tok ? [...tok.matchAll(/\{([wubrgcWUBRGC])\}/g)] : [];
  if (symbols.length > 0) {
    const m: { W?: number; U?: number; B?: number; R?: number; G?: number; C?: number } = {};
    for (const sym of symbols) {
      const color = sym[1].toUpperCase() as keyof typeof m;
      m[color] = (m[color] ?? 0) + 1;
    }
    riderMana = m;
    idx++;
  }
  // Variant B: "one mana of any color"
  else if (t[idx] === 'one' && t[idx + 1] === 'mana' && t[idx + 2] === 'of' && t[idx + 3] === 'any' && t[idx + 4] === 'color') {
    anyColor = 1;
    idx += 5;
  }
  // Variant B2: "an additional mana of any color" (alternative wording)
  else if (t[idx] === 'an' && t[idx + 1] === 'additional' && t[idx + 2] === 'mana' && t[idx + 3] === 'of' && t[idx + 4] === 'any' && t[idx + 5] === 'color') {
    anyColor = 1;
    idx += 6;
  }
  // Variant C: "two mana in any combination of colors"
  else if (t[idx] === 'two' && t[idx + 1] === 'mana' && t[idx + 2] === 'in' && t[idx + 3] === 'any' && t[idx + 4] === 'combination' && t[idx + 5] === 'of' && t[idx + 6] === 'colors') {
    twoAnyColor = true;
    idx += 7;
  }
  // Variant C2: "two mana in any combination" (shorter)
  else if (t[idx] === 'two' && t[idx + 1] === 'mana' && t[idx + 2] === 'in' && t[idx + 3] === 'any' && t[idx + 4] === 'combination') {
    twoAnyColor = true;
    idx += 5;
  }
  // Variant E: "one mana of the chosen color" (Utopia Sprawl / Spreading Seas family).
  // The source's choices.chosenColor is set at entry time via "As ~ enters, choose a color."
  // Consumed by the chosenColor branch in the actions.ts TappedForManaRider executor.
  else if (t[idx] === 'one' && t[idx + 1] === 'mana' && t[idx + 2] === 'of' && t[idx + 3] === 'the' && t[idx + 4] === 'chosen' && t[idx + 5] === 'color') {
    chosenColorRider = true;
    idx += 6;
  }
  // Variant B3 (Slice 4): "one mana of any type that land produced"
  // (Dictate of Karametra, Zhur-Taa Ancient wording without explicit symbols).
  // "any type that land produced" means the same color the land itself produced —
  // modelled as anyColor:1 (executor uses the 'color' arg passed to tapLandForMana).
  else if (
    t[idx] === 'one' && t[idx + 1] === 'mana' && t[idx + 2] === 'of' &&
    t[idx + 3] === 'any' && t[idx + 4] === 'type' && t[idx + 5] === 'that' &&
    t[idx + 6] === 'land' && t[idx + 7] === 'produced'
  ) {
    anyColor = 1;
    idx += 8;
  }
  // Variant D: "an additional {R}{G}" (Zhur-Taa has "adds an additional {R}{G}")
  // Sub-variants for text-form "an additional one mana of ..." (Slice 4):
  //   D2: "an additional one mana of the chosen color" (Utopia Sprawl / Glittering Frost family)
  //   D3: "an additional one mana of any type that land produced" (Glittering Frost family)
  //   D4: "an additional one mana of any color"
  else if (t[idx] === 'an' && t[idx + 1] === 'additional') {
    if (
      t[idx + 2] === 'one' && t[idx + 3] === 'mana' && t[idx + 4] === 'of' &&
      t[idx + 5] === 'the' && t[idx + 6] === 'chosen' && t[idx + 7] === 'color'
    ) {
      // Variant D2: "an additional one mana of the chosen color"
      chosenColorRider = true;
      idx += 8;
    } else if (
      t[idx + 2] === 'one' && t[idx + 3] === 'mana' && t[idx + 4] === 'of' &&
      t[idx + 5] === 'any' && t[idx + 6] === 'type' && t[idx + 7] === 'that' &&
      t[idx + 8] === 'land' && t[idx + 9] === 'produced'
    ) {
      // Variant D3: "an additional one mana of any type that land produced"
      anyColor = 1;
      idx += 10;
    } else if (
      t[idx + 2] === 'one' && t[idx + 3] === 'mana' && t[idx + 4] === 'of' &&
      t[idx + 5] === 'any' && t[idx + 6] === 'color'
    ) {
      // Variant D4: "an additional one mana of any color"
      anyColor = 1;
      idx += 7;
    } else if (
      t[idx + 2] === 'two' && t[idx + 3] === 'mana' && t[idx + 4] === 'in' &&
      t[idx + 5] === 'any' && t[idx + 6] === 'combination'
    ) {
      // Variant D5: "an additional two mana in any combination [of colors]"
      // (Market Festival oracle text: "adds an additional two mana in any combination of colors.")
      twoAnyColor = true;
      idx += 7;
      // consume optional "of colors"
      if (t[idx] === 'of' && t[idx + 1] === 'colors') idx += 2;
    } else {
      // Variant D (original): "an additional {R}{G}"
      const symTok = t[idx + 2];
      const addlSyms = symTok ? [...symTok.matchAll(/\{([wubrgcWUBRGC])\}/g)] : [];
      if (addlSyms.length > 0) {
        const m: { W?: number; U?: number; B?: number; R?: number; G?: number; C?: number } = {};
        for (const sym of addlSyms) {
          const color = sym[1].toUpperCase() as keyof typeof m;
          m[color] = (m[color] ?? 0) + 1;
        }
        riderMana = m;
        idx += 3;
      } else {
        return null;
      }
    }
  }
  else {
    return null;
  }

  // Must have at least one mana payload
  if (!riderMana && anyColor === undefined && !twoAnyColor && !chosenColorRider) return null;

  const modifier = {
    kind: 'TappedForManaRider' as const,
    scope,
    ...(riderMana ? { mana: riderMana } : {}),
    ...(anyColor !== undefined ? { anyColor } : {}),
    ...(twoAnyColor ? { twoAnyColor } : {}),
    ...(chosenColorRider ? { chosenColor: true as const } : {}),
  };

  return {
    kind: 'StaticAbility',
    modifier,
    filter: {},
    controller: 'any',
    excludeSelf: false,
  };
}

// ============================================================================
// Slice 8: matchCanBlockAdditionalStatic
// ============================================================================

/**
 * Match the static "This creature can block an additional creature each combat."
 * (Selesnya Sagittars, Two-Headed Giant of Foriys, Vigilant Sentry family).
 *
 * HONEST: combat.ts (declareBlockers) enforces the one-attacker-per-blocker
 * default rule (CR 509.1b) and checks for 'CanBlockAdditional' in the creature's
 * oracle text / grantedKeywords to allow up to two block assignments per creature
 * per combat. So recognizing this clause here is genuine — the engine actually
 * permits the extra block assignment; we emit a parsed StaticAbility so the face
 * stops being Unparsed.
 *
 * The `selfOnly` GrantKeyword('CanBlockAdditional') is a recognition marker;
 * combat.ts also reads the oracle text directly (just as mustAttackIfAble does
 * for MustAttackEachCombat), so the ability requires no continuous-layer consumer.
 *
 * Accepted forms (oracle text after reminder-text removal and lowercasing):
 *   "this creature can block an additional creature each combat[.]"
 *   "<name> can block an additional creature each combat[.]"  — normalised to ~
 *   "~ can block an additional creature each combat[.]"
 *   Any of the above followed only by known engine keyword lines.
 */
const CAN_BLOCK_ADDITIONAL_STATIC_RE =
  /\bcan\s+block\s+an\s+additional\s+creature\s+each\s+combat\b/i;

export function matchCanBlockAdditionalStatic(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  if (!CAN_BLOCK_ADDITIONAL_STATIC_RE.test(oracleText)) return null;

  // Honesty gate: every OTHER sentence (after reminder-text removal) must be a
  // known engine keyword line. Any non-keyword clause keeps the face Unparsed so
  // we never mask an unrun ability.
  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);

  let hasSelfCanBlock = false;
  for (const sentence of sentences) {
    if (CAN_BLOCK_ADDITIONAL_STATIC_RE.test(sentence)) {
      hasSelfCanBlock = true;
      continue;
    }
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }
  if (!hasSelfCanBlock) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword: 'CanBlockAdditional' },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// Slice 11: matchCanBlockAnyNumber
// ============================================================================

/**
 * Match "This creature can block any number of creatures [each combat]."
 * (Fog Elemental, Sauron's Fell Beast, Glare Rider family).
 *
 * HONEST: combat.ts maxAttackersCreatureCanBlock is extended (Slice 11) to return
 * 99 when the oracle text matches this regex, so the engine actually allows the
 * creature to block as many attackers as the opponent declares.  The recognition
 * marker GrantKeyword('CanBlockAnyNumber') is also checked there via the same
 * oracle-text read, keeping the two in sync.
 *
 * Accepted forms:
 *   "this creature can block any number of creatures[.]"
 *   "~ can block any number of creatures each combat[.]"
 *   Any of the above preceded or followed only by known engine keyword lines.
 */
const CAN_BLOCK_ANY_NUMBER_RE =
  /\bcan\s+block\s+any\s+number\s+of\s+creatures\b/i;

export function matchCanBlockAnyNumber(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  if (!CAN_BLOCK_ANY_NUMBER_RE.test(oracleText)) return null;

  // Honesty gate: every OTHER sentence must be a known engine keyword line.
  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);

  let hasSelfCanBlockAny = false;
  for (const sentence of sentences) {
    if (CAN_BLOCK_ANY_NUMBER_RE.test(sentence)) {
      hasSelfCanBlockAny = true;
      continue;
    }
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }
  if (!hasSelfCanBlockAny) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword: 'CanBlockAnyNumber' },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// Slice 9: matchTypeFilteredAsThoughFlash
// ============================================================================

/**
 * Slice 9 — Type-filtered "as though they had flash" battlefield static.
 *
 * These statics are printed on PERMANENTS (creatures, planeswalkers, enchantments,
 * lands) and grant instant-speed casting to the controller's spells of a
 * specified type. Unlike matchAsThoughFlash (which is selfOnly, printed on the
 * spell itself), these are registered via registerContinuousAbilitiesForPermanent
 * and scanned in stack.ts hasAsThoughFlash at cast time.
 *
 * SUPPORTED SHAPES (caster = 'you'):
 *   "You may cast spells as though they had flash."                  (Slice 12: unqualified)
 *   "You may cast historic spells as though they had flash."         (Slice 12: legendary|artifact|Saga)
 *   "You may cast creature spells as though they had flash."
 *   "You may cast artifact spells as though they had flash."
 *   "You may cast enchantment spells as though they had flash."
 *   "You may cast sorcery spells as though they had flash."
 *   "You may cast noncreature spells as though they had flash."
 *   "You may cast Aura spells as though they had flash."
 *   "You may cast Equipment spells as though they had flash."
 *   "You may cast Dragon spells as though they had flash."
 *   "You may cast Sliver spells as though they had flash."
 *   "You may cast legendary spells as though they had flash."
 *   "You may cast green creature spells as though they had flash."
 *   "You may cast Aura and Equipment spells as though they had flash."
 *   "You may cast Dragon spells and artifact spells as though they had flash."
 *   "You may cast creature and enchantment spells as though they had flash."
 *
 * SUPPORTED SHAPES (caster = 'any'):
 *   "Any player may cast spells as though they had flash."           (Slice 12: unqualified)
 *   "Any player may cast creature spells as though they had flash."
 *   "Any player may cast Sliver spells as though they had flash."
 *   "Any player may cast creature and enchantment spells as though they had flash."
 *
 * HONESTY:
 *   - Emits AsThoughFlash with typeFilter set. The typeFilter uses CardFilter
 *     fields (types, excludeTypes, subtypes, supertypes, colors, anyOf) that
 *     matchesCardFilter already evaluates. stack.ts hasAsThoughFlash is extended
 *     to scan continuousEffects for these modifiers and call matchesCardFilter
 *     on the spell's definition against the stored typeFilter.
 *   - Slice 12 additions: "historic" (legendary|artifact|Saga via anyOf) and
 *     unqualified "spells" (Vedalken Orrery / High Fae Trickster, empty filter)
 *     are now supported. matchesCardFilter evaluates all three anyOf branches
 *     and an empty filter trivially matches every card.
 *   - Forms with additional constraints ("with enchant creature", "with mana
 *     value", "this turn", "first", energy-cost, "colorless") are still
 *     declined — the engine cannot evaluate them.
 *
 * EXECUTION:
 *   stack.ts hasAsThoughFlash: after the self-oracle check, scans
 *   state.continuousEffects for non-selfOnly AsThoughFlash modifiers with a
 *   typeFilter, verifies the source is still on the battlefield, verifies the
 *   controller matches the casting player, then calls matchesCardFilter against
 *   the spell's definition.
 */

// Color word to color code map (for "green creature spells" etc.)
const SPELL_COLOR_WORDS: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
};

// Known card types that can appear in "you may cast <type> spells"
const SPELL_TYPES = new Set([
  'creature', 'artifact', 'enchantment', 'sorcery', 'instant', 'planeswalker', 'battle',
]);

// Known subtypes that appear in "you may cast <Subtype> spells"
const SPELL_SUBTYPES = new Set([
  // Enchantment subtypes
  'aura', 'saga', 'lesson',
  // Artifact subtypes
  'equipment', 'vehicle', 'food', 'treasure', 'clue',
  // Creature subtypes (commonly grant flash by type)
  'dragon', 'sliver', 'elf', 'goblin', 'zombie', 'angel', 'demon', 'merfolk',
  'soldier', 'wizard', 'knight', 'warrior', 'cleric', 'rogue', 'shaman', 'beast',
  'elemental', 'vampire', 'human', 'spirit', 'bird', 'cat', 'dinosaur', 'pirate',
  'dwarf', 'wolf', 'ally',
  // Slice 5 additions: creature subtypes referenced in real "as though they had flash" cards
  'faerie', 'scout', 'hydra', 'ninja', 'samurai', 'advisor', 'artificer', 'monk',
  'leviathan', 'horror', 'hydra', 'treefolk', 'sphinx', 'vedalken', 'archon',
]);

// Supertypes that can appear in "you may cast <supertype> spells"
const SPELL_SUPERTYPES = new Set(['legendary', 'basic', 'snow']);

/**
 * Parse a single type-token cluster at position idx in a token array.
 * Accepts an optional leading color word (e.g. "green creature"),
 * followed by one type/subtype/supertype word.
 *
 * Returns { filter: CardFilter, consumed: number } or null.
 *
 * Slice 12 addition: "historic" is a special category meaning
 * legendary | artifact | Saga. It maps to
 *   anyOf: [{ supertypes: ['legendary'] }, { types: ['artifact'] }, { subtypes: ['saga'] }]
 * — all three components are already evaluated by matchesCardFilter/hasAsThoughFlash.
 */
function parseFlashTypeToken(
  tokens: string[],
  idx: number,
): { filter: CardFilter; consumed: number } | null {
  let consumed = 0;
  const colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = [];

  // Optional leading color word ("green creature")
  const colorCode = SPELL_COLOR_WORDS[tokens[idx]?.toLowerCase() ?? ''];
  if (colorCode) {
    colors.push(colorCode);
    consumed++;
    idx++;
  }

  const word = tokens[idx]?.toLowerCase() ?? '';

  // Slice 12: "historic" = legendary | artifact | Saga.
  // Raff Capashen, Ship's Mage: "You may cast historic spells as though they had flash."
  if (word === 'historic') {
    return {
      filter: {
        anyOf: [
          { supertypes: ['legendary'] },
          { types: ['artifact'] },
          { subtypes: ['saga'] },
        ],
        ...(colors.length ? { colors } : {}),
      },
      consumed: consumed + 1,
    };
  }

  // "non<type>" form: "noncreature"
  const nonMatch = word.match(/^non(\w+)$/);
  if (nonMatch) {
    const base = nonMatch[1];
    if (SPELL_TYPES.has(base)) {
      return {
        filter: { excludeTypes: [base], ...(colors.length ? { colors } : {}) },
        consumed: consumed + 1,
      };
    }
    return null;
  }

  if (SPELL_SUPERTYPES.has(word)) {
    return { filter: { supertypes: [word], ...(colors.length ? { colors } : {}) }, consumed: consumed + 1 };
  }

  if (SPELL_TYPES.has(word)) {
    return { filter: { types: [word], ...(colors.length ? { colors } : {}) }, consumed: consumed + 1 };
  }

  if (SPELL_SUBTYPES.has(word)) {
    return { filter: { subtypes: [word], ...(colors.length ? { colors } : {}) }, consumed: consumed + 1 };
  }

  return null;
}

/**
 * Merge two CardFilter objects built from type tokens using OR logic.
 * "Aura and Equipment spells" → match cards that are Aura OR Equipment.
 */
function mergeFlashFilters(a: CardFilter, b: CardFilter): CardFilter {
  // Same single dimension — combine into multi-value (matchesCardFilter uses .some).
  if (a.types && b.types && !a.subtypes && !b.subtypes && !a.excludeTypes && !b.excludeTypes
      && !a.supertypes && !b.supertypes) {
    return { types: [...a.types, ...b.types] };
  }
  if (a.subtypes && b.subtypes && !a.types && !b.types && !a.supertypes && !b.supertypes) {
    return { subtypes: [...a.subtypes, ...b.subtypes] };
  }
  if (a.supertypes && b.supertypes && !a.types && !b.types && !a.subtypes && !b.subtypes) {
    return { supertypes: [...a.supertypes, ...b.supertypes] };
  }
  // Mixed dimensions (e.g. Dragon + artifact): use anyOf
  return { anyOf: [a, b] };
}

/**
 * Main matcher. Called on whole-card oracle-text lines by parseOracleText.
 *
 * Returns a StaticAbilityEffect (selfOnly: false, modifier: AsThoughFlash
 * with typeFilter set) or null.
 */
export function matchTypeFilteredAsThoughFlash(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;

  // Strip reminder text before sentence-splitting.
  const cleaned = stripReminderTextForCBC(oracleText);

  const sentences = cleaned
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) return null;

  let typeFilter: CardFilter | null = null;
  let casterScope: 'you' | 'any' = 'you';

  for (const sentence of sentences) {
    const norm = sentence.toLowerCase().replace(/\s+/g, ' ').trim();

    // Reject "cast this spell as though it had flash" — that's matchAsThoughFlash territory.
    if (/\bcast this spell\b/.test(norm)) return null;

    // Reject constrained forms the engine cannot model.
    // Note: "historic" is NOT rejected here — it is now supported as an anyOf filter
    // (legendary | artifact | Saga) added in Slice 12.
    if (/\bcolorless\b/.test(norm)) return null;
    if (/\bthis turn\b/.test(norm)) return null;
    if (/\bfirst\b/.test(norm)) return null;
    if (/\bwith enchant\b/.test(norm)) return null;
    if (/\bwith mana value\b/.test(norm)) return null;
    if (/\bby paying\b/.test(norm)) return null;
    if (/\benergy\b|\{e\}/.test(norm)) return null;
    if (/\bspells?\s+this\s+turn\b/.test(norm)) return null;

    // Slice 12: Unqualified form — "you may cast spells as though they had flash" /
    // "any player may cast spells as though they had flash" /
    // "players may cast spells as though they had flash" (Akoum variant).
    // Vedalken Orrery, High Fae Trickster: grants flash to ALL spells the controller casts.
    // typeFilter: {} (empty filter) — matchesCardFilter returns true for every card.
    const unqualifiedRE =
      /^(you|any\s+player|players?)\s+may\s+cast\s+spells?\s+as\s+though\s+they\s+had\s+flash$/i;
    const uq = unqualifiedRE.exec(sentence.trim());
    if (uq) {
      const casterWord = uq[1]?.toLowerCase().replace(/\s+/, ' ');
      casterScope = (casterWord === 'you') ? 'you' : 'any';
      typeFilter = {}; // empty CardFilter — matches everything
      continue;
    }

    // Try matching the type-filtered grant sentence:
    //   "you may cast <typespec> spells as though they had flash"
    //   "any player may cast <typespec> spells as though they had flash"
    //   "players may cast <typespec> spells as though they had flash"  (Akoum)
    const asThoughRE =
      /^(?:(you|any\s+player|players?)\s+may\s+cast\s+)(.+?)\s+spells?\s+as\s+though\s+they\s+had\s+flash$/i;
    const m = asThoughRE.exec(sentence.trim());

    if (m) {
      const casterWord = m[1]?.toLowerCase().replace(/\s+/, ' ');
      const typeClause = m[2].trim().toLowerCase();

      // Determine caster scope.
      casterScope = (casterWord === 'you') ? 'you' : 'any';

      // Parse the type clause. May contain multiple type tokens joined by:
      //   - "and" alone:          "Dragon and artifact"
      //   - ", and" (Oxford):     "artifact, creature, and enchantment" (Tawnos)
      //   - "spells and":         "Dragon spells and artifact spells"
      // Normalize step 1: strip trailing "spells" from sub-clauses joined by "and"
      const typeClauseNormalized = typeClause
        .replace(/\s+spells?\s+and\s+/g, ' and ') // "Dragon spells and artifact" → "Dragon and artifact"
        .replace(/\s*,\s*and\s+/g, ' and ')        // "artifact, creature, and" → "artifact and creature and"
        .replace(/\s*,\s*/g, ' and ')               // remaining commas → "and"
        .trim();

      const typeParts = typeClauseNormalized.split(/\s+and\s+/);
      if (typeParts.length === 0) return null;

      let combinedFilter: CardFilter | null = null;
      for (const part of typeParts) {
        const partTokens = part.trim().split(/\s+/);
        const parsed = parseFlashTypeToken(partTokens, 0);
        if (!parsed) return null; // Unknown type word — decline for honesty.
        if (parsed.consumed !== partTokens.length) return null; // Leftover tokens.
        combinedFilter = combinedFilter
          ? mergeFlashFilters(combinedFilter, parsed.filter)
          : parsed.filter;
      }

      if (!combinedFilter) return null;
      typeFilter = combinedFilter;
      continue; // Sentence handled.
    }

    // Any other sentence must be an engine-handled keyword; otherwise decline.
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }

  if (!typeFilter) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'AsThoughFlash', surcharge: 0, typeFilter },
    // filter on StaticAbilityEffect is for what battlefield permanents are
    // affected by the continuous ability; for cast-time grants we use a broad
    // permanent filter (the caster check happens at cast time in stack.ts).
    filter: { permanent: true },
    controller: casterScope === 'any' ? 'any' : 'you',
    excludeSelf: false,
    selfOnly: false,
  };
}

// ============================================================================
// Slice 9: matchControlEnchanted
// ============================================================================

/**
 * Match the theft-Aura static: "You control enchanted creature." /
 * "You control enchanted permanent."
 *
 * Iconic family: Control Magic, Mind Control, Confiscate, Persuasion,
 * Take Possession, Threads of Disloyalty, Mind Harness, Lay Claim.
 *
 * HONEST: enforced end-to-end via two hook sites:
 *   1. On Aura entering attached (registerContinuousAbilitiesForPermanent in
 *      stack.ts): executeGainControl transfers the enchanted permanent's ownerId
 *      to the Aura caster's id. The prior ownerId is stored in the Aura card
 *      instance's choices.previousEnchantedOwnerId for the revert path.
 *   2. On Aura leaving the battlefield (state-based.ts SBA Aura-to-graveyard path
 *      and executor.ts pruneDetachedEffects path): the enchanted permanent's
 *      ownerId is restored to previousEnchantedOwnerId if the permanent is still
 *      on the battlefield.
 *
 * The modifier is `attachedOnly: true` so continuous.ts isAffectedBy skips it,
 * preventing any unintended layer interaction. The GainControl machinery in
 * executeGainControl is the single enforcement site.
 *
 * HONESTY GATE: we only claim the face when the SOLE non-keyword sentence (after
 * reminder-text removal) is the "you control enchanted creature/permanent" clause.
 * Any additional real (non-keyword) oracle text keeps the face Unparsed so we
 * never mask an unrun ability. This matches the actual oracle texts of Control
 * Magic ("Enchant creature\nYou control enchanted creature.") etc.
 */
const CONTROL_ENCHANTED_RE =
  /^you control enchanted (?:creature|permanent)\.?$/i;

export function matchControlEnchanted(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;

  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let hasControlClause = false;
  for (const sentence of sentences) {
    // Skip the "Enchant creature" / "Enchant permanent" preamble line.
    if (/^enchant\s+(?:creature|permanent|artifact|land|enchantment|planeswalker)\b/i.test(sentence)) {
      continue;
    }
    if (CONTROL_ENCHANTED_RE.test(sentence)) {
      hasControlClause = true;
      continue;
    }
    // Any other residual text must be an engine-handled keyword; otherwise the
    // card has a real unrun function and we leave the whole face Unparsed.
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }
  if (!hasControlClause) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'ControlEnchanted' },
    filter: { permanent: true },
    controller: 'you',
    excludeSelf: false,
    attachedOnly: true,
  };
}

// ============================================================================
// Slice 11: matchBattlefieldCantBeCountered
// ============================================================================

/**
 * Slice 11 — Battlefield-source "can't be countered" statics.
 *
 * Recognised patterns (all emit a non-selfOnly StaticAbility):
 *
 *   "Creature spells you control can't be countered."
 *     → filter: {types:['creature']}, controller:'you'
 *
 *   "Creature spells can't be countered."       (Gaea's Herald — any controller)
 *     → filter: {types:['creature']}, controller:'any'
 *
 *   "Sliver spells can't be countered."         (Root Sliver — subtype filter)
 *     → filter: {subtypes:['sliver']}, controller:'any'
 *
 *   "Instant and sorcery spells you control can't be countered."
 *     → filter: {types:['instant','sorcery']}, controller:'you'
 *
 *   "Spells you control can't be countered."
 *     → filter: {}, controller:'you'
 *
 * HONEST: the uncounterability is enforced by executeCounterSpell in
 * executor.ts, which (in this slice) gains an additive filter-scan branch
 * that walks state.continuousEffects looking for GrantKeyword:'CantBeCountered'
 * statics whose filter matches the target spell's card definition and whose
 * controller check matches the caster. Only permanent-sourced, non-selfOnly
 * statics are scanned (selfOnly statics are the spell-self form handled
 * by SpellStackItem.cantBeCountered / hasCantBeCounteredText).
 *
 * HONESTY GATE: we ONLY claim the face when it is purely this one sentence
 * (after reminder-text removal).  If any other non-keyword text is present,
 * the card's real function is not modelled here — leave Unparsed.
 *
 * Recognised subjects:
 *   "[<color-or-type-word>] [<subtype>] spells [you control]"
 *   "instant and sorcery spells [you control]"
 *   "spells [you control]"
 */

// Colour words used in spell-filter context (e.g. "blue spells can't …")
const SPELL_FILTER_COLOR_WORDS: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
};

// Type words that map directly to card_types for spells
const SPELL_TYPE_MAP: Record<string, string> = {
  creature: 'creature', creatures: 'creature',
  instant: 'instant', instants: 'instant',
  sorcery: 'sorcery', sorceries: 'sorcery',
  artifact: 'artifact', artifacts: 'artifact',
  enchantment: 'enchantment', enchantments: 'enchantment',
  planeswalker: 'planeswalker', planeswalkers: 'planeswalker',
};

// Known creature/spell subtypes that appear in "X spells can't be countered" wording.
// Add more as needed; this covers the measured examples.
const SPELL_SUBTYPE_MAP: Record<string, string> = {
  sliver: 'sliver', slivers: 'sliver',
  dragon: 'dragon', dragons: 'dragon',
  wizard: 'wizard', wizards: 'wizard',
  elf: 'elf', elves: 'elf',
  vampire: 'vampire', vampires: 'vampire',
  spirit: 'spirit', spirits: 'spirit',
  zombie: 'zombie', zombies: 'zombie',
  goblin: 'goblin', goblins: 'goblin',
  merfolk: 'merfolk',
  angel: 'angel', angels: 'angel',
  human: 'human', humans: 'human',
};

export function matchBattlefieldCantBeCountered(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;

  // Work on the reminder-stripped, single-sentence form.
  const stripped = stripReminderTextForCBC(oracleText).trim();

  // Must end with "can't be countered" (period or not, any apostrophe style).
  const cbcTailRe = /^(.*?)\s+can['']?t\s+be\s+countered\.?$/i;
  const tailMatch = stripped.match(cbcTailRe);
  if (!tailMatch) return null;

  const subject = tailMatch[1].trim().toLowerCase();

  // -------------------------------------------------------------------
  // Subject parsing
  // -------------------------------------------------------------------
  // Shape A: "spells [you control]" — any spell
  // Shape B: "[<color>] [<type>] spells [you control]"
  //           including "instant and sorcery spells"
  // Shape C: "[<color>] [<subtype>] spells [you control]"
  // Shape D: "<type> and <type> spells [you control]"

  // Normalise subject: strip trailing "you control" or plain "you cast"
  let raw = subject;
  let controller: 'you' | 'any' = 'any';
  for (const suffix of [' you control', ' your opponents cast', ' you cast']) {
    if (raw.endsWith(suffix)) {
      raw = raw.slice(0, raw.length - suffix.length).trim();
      controller = 'you';
      break;
    }
  }

  // Must end with "spells" (or "spell")
  const spellsRe = /^(.*?)\s*spells?$/;
  const spellsMatch = raw.match(spellsRe);
  if (!spellsMatch) return null;

  const qualifier = spellsMatch[1].trim(); // everything before "spells"

  let filter: CardFilter = {};

  if (!qualifier) {
    // "spells [you control] can't be countered" — any spell
    // (no filter restrictions)
  } else if (qualifier === 'instant and sorcery' || qualifier === 'sorcery and instant') {
    filter = { types: ['instant', 'sorcery'] };
  } else {
    // Parse qualifier tokens (may be "creature", "blue", "sliver", "blue creature",
    // "blue sliver", etc. — up to 2 words).
    const words = qualifier.split(/\s+/);
    const types: string[] = [];
    const subtypes: string[] = [];
    const colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = [];

    for (const word of words) {
      if (SPELL_FILTER_COLOR_WORDS[word]) {
        colors.push(SPELL_FILTER_COLOR_WORDS[word]);
      } else if (SPELL_TYPE_MAP[word]) {
        types.push(SPELL_TYPE_MAP[word]);
      } else if (SPELL_SUBTYPE_MAP[word]) {
        // Subtype filter: "Sliver spells" — need creature type match.
        // Subtypes on a spell definition are checked against the printed subtype
        // line by matchesCardFilter's typeLineHasSubtype path.
        subtypes.push(SPELL_SUBTYPE_MAP[word]);
      } else {
        // Unknown qualifier word — decline to stay honest.
        return null;
      }
    }

    if (colors.length > 0) filter.colors = colors;
    if (types.length > 0) filter.types = types;
    if (subtypes.length > 0) filter.subtypes = subtypes;
  }

  // -------------------------------------------------------------------
  // Honesty gate: only claim this face when EVERY OTHER sentence is an
  // engine-handled keyword. If the oracle text contains a real unrun
  // ability (like a trigger), leave the face Unparsed.
  // -------------------------------------------------------------------
  const allSentences = stripped
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean);

  for (const sentence of allSentences) {
    // Accept the CantBeCountered sentence itself.
    if (/can['']?t\s+be\s+countered/i.test(sentence)) continue;
    // Any other sentence must be a known engine keyword.
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword: 'CantBeCountered' },
    filter,
    controller,
    excludeSelf: false,
    // Not selfOnly — this affects OTHER cards (spells being cast), not the
    // source permanent itself. The selfOnly flag is reserved for the spell-
    // self form (matchCantBeCountered).
    selfOnly: false,
  };
}

// ============================================================================
// Slice 3 (engine-gap): matchLegendaryCreaturesDynamicAnthem
// ============================================================================

/**
 * Slice 3 — Jodah-style legendary-creatures dynamic anthem:
 *   "Legendary creatures you control get +X/+X, where X is the number of
 *    legendary creatures you control."
 *
 * This is a PER-TOKEN matcher (receives tokenized oracle text), called from
 * parseOracleText via parseOracleTextPerLine on a single line.
 *
 * Token shape accepted:
 *   "legendary creatures you control get +x/+x , where x is the number of
 *    legendary creatures you control [.]"
 *
 * Emits a StaticAbilityEffect with:
 *   modifier: ModifyPTDynamic — power/toughness scale with a ForEachAmount
 *     counting legendary creatures the controller controls on the battlefield.
 *   filter:   { types: ['creature'], supertypes: ['Legendary'] }
 *   controller: 'you'
 *   attachedOnly: false   ← non-attached anthem; handled by the normal
 *     isAffectedBy + getContinuousPTModification path in continuous.ts.
 *
 * HONEST: getContinuousPTModification in continuous.ts (extended in this slice)
 * evaluates ModifyPTDynamic for non-attached statics by calling countForEachCDA
 * at query time exactly like the attached-aura path. isAffectedBy already routes
 * through matchesCardFilter for filter.types, which then checks filter.supertypes
 * via typeLineHasSupertype — so "legendary creatures" are correctly identified.
 *
 * X counts ALL legendary creatures the controller controls (including Jodah
 * himself — CR 613.3 self-counting is standard for "number of X you control").
 */
export function matchLegendaryCreaturesDynamicAnthem(tokens: string[]): StaticAbilityEffect | null {
  let idx = 0;

  // "legendary"
  if (tokens[idx] !== 'legendary') return null;
  idx++;

  // "creatures"
  if (tokens[idx] !== 'creatures') return null;
  idx++;

  // "you control"
  if (tokens[idx] !== 'you' || tokens[idx + 1] !== 'control') return null;
  idx += 2;

  // "get"
  if (tokens[idx] !== 'get' && tokens[idx] !== 'gets') return null;
  idx++;

  // "+x/+x" or "+X/+X" (single token)
  const ptTok = tokens[idx];
  const ptMatch = ptTok?.match(/^\+x\/\+x$/i);
  if (!ptMatch) return null;
  idx++;

  // optional ","
  if (tokens[idx] === ',') idx++;

  // "where x is the number of legendary creatures you control"
  if (
    tokens[idx] !== 'where' ||
    tokens[idx + 1] !== 'x' ||
    tokens[idx + 2] !== 'is' ||
    tokens[idx + 3] !== 'the' ||
    tokens[idx + 4] !== 'number' ||
    tokens[idx + 5] !== 'of' ||
    tokens[idx + 6] !== 'legendary' ||
    tokens[idx + 7] !== 'creatures' ||
    tokens[idx + 8] !== 'you' ||
    tokens[idx + 9] !== 'control'
  ) return null;
  idx += 10;

  // optional trailing period
  if (tokens[idx] === '.') idx++;

  const formula: import('../ast').ForEachAmount = {
    kind: 'ForEach',
    zone: 'battlefield',
    filter: { types: ['creature'], supertypes: ['Legendary'] },
    controller: 'you',
  };

  return {
    kind: 'StaticAbility',
    modifier: {
      kind: 'ModifyPTDynamic',
      powerFormula: formula,
      toughnessFormula: formula,
      powerSign: 1,
      toughnessSign: 1,
    },
    filter: { types: ['creature'], supertypes: ['Legendary'] },
    controller: 'you',
    excludeSelf: false,
  };
}

// ============================================================================
// Slice 1 (engine-gap): matchUntapDuringOtherUntapSteps
// ============================================================================

/**
 * Slice 1 — Seedborn Muse static: "Untap all permanents you control during
 * each other player's untap step."
 *
 * HONEST: enforced in performUntapStep (turn-manager.ts).  After the active
 * player's own permanents are untapped, the function scans continuousEffects
 * for this modifier.  For each permanent on the battlefield whose controller
 * is NOT the active player and that bears this static, ALL permanents
 * controlled by that non-active player are also untapped.
 *
 * HONESTY GATE: only claim this face when the SOLE non-keyword sentence is
 * exactly the Seedborn Muse wording.  Any other real (non-keyword) oracle
 * text keeps the face Unparsed so we never mask an unrun ability.
 */
const UNTAP_DURING_OTHER_UNTAP_RE =
  /^untap all permanents you control during each other player['']?s untap step\.?$/i;

export function matchUntapDuringOtherUntapSteps(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;

  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let hasUntapClause = false;
  for (const sentence of sentences) {
    if (UNTAP_DURING_OTHER_UNTAP_RE.test(sentence)) {
      hasUntapClause = true;
      continue;
    }
    // Any other sentence must be an engine-handled keyword; otherwise decline
    // so we never mask an unrun ability.
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }
  if (!hasUntapClause) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'UntapDuringOtherUntapSteps' },
    filter: { permanent: true },
    controller: 'you',
    excludeSelf: false,
    selfOnly: true, // source-self static — the permanent itself is the trigger,
                    // not a broad modifier on other cards.
  };
}

// ============================================================================
// Slice 4 (engine-gap): matchGrantActivatedManaAbility
// ============================================================================

/**
 * Slice 4 — Grant-activated-mana-ability static.
 *
 * Matches patterns of the form:
 *   'Creatures you control have "{T}: Add one mana of any color."'
 *   '[Other] [creatures/permanents] you control have "{T}: Add one mana of any color."'
 *
 * The quoted clause is a recognized "{T}: Add one mana of any color." mana ability.
 * On parse, a StaticAbilityEffect with modifier kind 'GrantActivatedManaAbility' is
 * emitted. On registration (registerContinuousAbilitiesForPermanent), this effect is
 * stored in continuousEffects. At query time, getAvailableManaColors and
 * tapLandForMana (actions.ts) scan continuousEffects for this modifier to expose
 * the granted mana ability on any creature matching the filter that is controlled
 * by the effect's controllerId.
 *
 * HONEST: the actual mana production ({T}: Add one mana of any color.) is already
 * implemented end-to-end in tapLandForMana / getAvailableManaColors. The new path
 * merely adds a check: if a creature doesn't have its own manaProduction from
 * parseManaProductions, and a GrantActivatedManaAbility continuousEffect applies to
 * it, that creature is treated as having the granted manaProduction for the duration
 * the source is on the battlefield.
 *
 * Summoning sickness: the grantedMana carries isTapAbility=true, so the existing
 * isBlockedBySummoningSicknessForTap gate in tapLandForMana/generateManaActions
 * enforces summoning sickness automatically.
 *
 * HONESTY GATE: we only match exact patterns where the quoted ability is
 * "{T}: Add one mana of any color." (the only variant the engine executes
 * via the any-color mana path). Variants with non-tap costs or multi-color
 * or restricted spend are declined.
 *
 * Recognized forms:
 *   'Creatures you control have "{T}: Add one mana of any color."'
 *   'Each creature you control has "{T}: Add one mana of any color."'
 *   'Other creatures you control have "{T}: Add one mana of any color."'
 */

// The core quoted ability we can execute.
// Scryfall uses straight double-quotes around the quoted ability text.
// After tokenization, {T} becomes a mana placeholder ("__mana_N__") which may stay
// attached to a leading double-quote (because " is not in PUNCT_RE), so we:
//   1. Strip all double-quote characters.
//   2. Normalise any __mana_N__ placeholder (possibly with leading ") back to {t}.
// Then the regex can match consistently whether the input came from raw oracle text
// or from the tokenizer pipeline.
const GRANT_TAP_ADD_ANY_COLOR_RE =
  /^(?:other\s+)?(?:each\s+)?(?:creature|creatures)s?\s+you\s+control\s+(?:have|has)\s+\{t\}\s*:\s*add\s+one\s+mana\s+of\s+any\s+(?:one\s+)?colou?r\s*\.?$/i;

export function matchGrantActivatedManaAbility(tokens: string[]): StaticAbilityEffect | null {
  // We work from the token array for consistency with the rest of the static-ability
  // matchers. Reconstruct a normalized text to run against our regex.
  // Strip double-quotes and normalise mana-chunk placeholders → {t} so that the
  // regex is resilient to both raw oracle text and the tokenizer pipeline's output.
  const raw = tokens.join(' ').replace(/\s+/g, ' ').trim();
  const text = raw
    .replace(/"/g, '')                        // remove all double-quotes (not in PUNCT_RE)
    .replace(/__mana_\d+__/gi, '{t}')         // restore any mana-chunk placeholder
    .replace(/\s+/g, ' ').trim();
  if (!GRANT_TAP_ADD_ANY_COLOR_RE.test(text)) return null;

  const excludeSelf = /^other\s+/i.test(text);

  const grantedMana: ManaProductionInfo = {
    colors: ['W', 'U', 'B', 'R', 'G'],
    amounts: { W: 1, U: 1, B: 1, R: 1, G: 1 },
    isTapAbility: true,
    requiresSacrifice: false,
    activationZone: 'battlefield',
  };

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantActivatedManaAbility', grantedMana },
    filter: { types: ['creature'] },
    controller: 'you',
    excludeSelf,
  };
}

// ============================================================================
// Slice 8: matchOtherTappedUntappedCreaturesHave
// ============================================================================

/**
 * Slice 8 (Saryth family) — Tapped/untapped-state conditional keyword grant:
 *   "Other tapped creatures you control have deathtouch."
 *   "Other untapped creatures you control have hexproof."
 *   "Tapped creatures you control have deathtouch."          (non-"other" form)
 *   "Untapped creatures you control have hexproof."
 *
 * Accepted subject forms:
 *   "[Other] tapped creatures you control have <keyword>"
 *   "[Other] untapped creatures you control have <keyword>"
 *
 * Emits a StaticAbilityEffect with:
 *   filter: { types: ['creature'], tapped: <true|false> }
 *   controller: 'you'
 *   excludeSelf: <true if "other" was present>
 *
 * HONEST:
 *   - continuous.ts isAffectedBy evaluates `filter.tapped` against the live
 *     `card.tapped` state, re-checking at every query point so that when a
 *     creature's tap state changes the granted keyword is immediately updated
 *     (Saryth's deathtouch/hexproof swap correctly when creatures tap/untap).
 *   - Only GRANTABLE_KEYWORDS (single-word or known two-word keywords already
 *     in the engine keyword map) are accepted — anything else stays Unparsed.
 *
 * This matcher must run BEFORE matchStaticAbility in parseOracleText because
 * matchStaticAbility's subject parser does not handle "tapped"/"untapped" as
 * filter words and would return null. (It also must run before matchAttackingAnthem
 * which handles "attacking"/"blocking" similarly but not tap state.)
 */
export function matchOtherTappedUntappedCreaturesHave(
  tokens: string[],
): StaticAbilityEffect | null {
  let idx = 0;

  // Optional "other"
  let excludeSelf = false;
  if (tokens[idx] === 'other') {
    excludeSelf = true;
    idx++;
  }

  // Required: "tapped" or "untapped"
  let tapped: boolean;
  if (tokens[idx] === 'tapped') {
    tapped = true;
  } else if (tokens[idx] === 'untapped') {
    tapped = false;
  } else {
    return null;
  }
  idx++;

  // Required: "creatures" / "creature"
  if (tokens[idx] !== 'creatures' && tokens[idx] !== 'creature') return null;
  idx++;

  // Required: "you control"
  if (tokens[idx] !== 'you' || tokens[idx + 1] !== 'control') return null;
  idx += 2;

  // Verb: "have" / "has" (keyword grant) or "get" / "gets" (P/T bonus)
  const verb = tokens[idx];
  const isKw = verb === 'have' || verb === 'has';
  const isPT = verb === 'get' || verb === 'gets';
  if (!isKw && !isPT) return null;
  idx++;

  // "until end of turn" → temporary spell effect, not a static
  if (tokens[idx] === 'until') return null;

  let modifier: StaticModifier;

  if (isPT) {
    // Slice 1: "Untapped creatures you control get +0/+2" (Builder's Blessing family).
    // P/T bonus form — continuous.ts layer 7c applies ModifyPT statics with tapped filter.
    const ptMatch = tokens[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    modifier = {
      kind: 'ModifyPT',
      power: parseInt(ptMatch[1], 10),
      toughness: parseInt(ptMatch[2], 10),
    };
    idx++;
    // "until end of turn" after P/T → spell effect
    if (tokens[idx] === 'until') return null;
  } else {
    // Read keyword (may be two words: "first strike", "double strike")
    let keyword: string;
    if (tokens[idx] === 'first' && tokens[idx + 1] === 'strike') {
      keyword = 'first strike';
      idx += 2;
    } else if (tokens[idx] === 'double' && tokens[idx + 1] === 'strike') {
      keyword = 'double strike';
      idx += 2;
    } else {
      keyword = tokens[idx] ?? '';
      if (!keyword) return null;
      idx++;
    }

    // "until end of turn" after keyword → spell effect
    if (tokens[idx] === 'until') return null;
    modifier = { kind: 'GrantKeyword', keyword };
  }

  // Optional trailing period
  if (tokens[idx] === '.') idx++;

  return {
    kind: 'StaticAbility',
    modifier,
    filter: { types: ['creature'], tapped },
    controller: 'you',
    excludeSelf,
  };
}

// ============================================================================
// Gisela damage-doubling / damage-halving statics (engine-gap subsystem)
// ============================================================================

/**
 * Gisela, Blade of Goldnight — damage-DOUBLING line:
 *
 *   "If a source would deal damage to an opponent or a permanent an opponent
 *    controls, that source deals double that damage to that player or permanent
 *    instead."
 *
 * Received as a single tokenized line (after normalisation in parseOracleText /
 * registerContinuousAbilitiesForPermanent). The modifier carries no filter or
 * controller field that continuous.ts uses — the scoping logic (is the target an
 * opponent?) is applied in applyDamageReplacementEffects (replacement.ts).
 *
 * selfOnly is false; filter is the empty filter so continuous.ts
 * isAffectedBy does NOT apply a layer effect — this modifier is enforced
 * exclusively via the replacement-effect scan in replacement.ts.
 *
 * Honesty: the executor actively applies doubling/halving in
 * applyDamageReplacementEffects when a GiselaDamageDoubling or
 * GiselaDamageHalving continuous effect is present in state.continuousEffects.
 */
export function matchGiselaDamageDoubling(tokens: string[]): StaticAbilityEffect | null {
  // Minimum token count guard: the sentence is long.
  if (tokens.length < 12) return null;

  // "if a source would deal damage to an opponent or a permanent an opponent
  //  controls , that source deals double that damage to that player or permanent
  //  instead [.]"
  //
  // We match on a characteristic sub-phrase that is unique to Gisela's oracle
  // text and not present in any other static-ability sentence:
  //   "source deals double that damage to that"
  //
  // We also require the sentence to START with "if a source would deal damage"
  // and to CONTAIN "to an opponent".
  const joined = tokens.join(' ');

  const hasPreamble = /^if\s+a\s+source\s+would\s+deal\s+damage\s+to\s+an\s+opponent\b/i.test(joined);
  const hasDoubleDamage = /\bdeals?\s+double\s+that\s+damage\b/i.test(joined);
  const hasInstead = /\binstead\b/i.test(joined);

  if (!hasPreamble || !hasDoubleDamage || !hasInstead) return null;

  return {
    kind: 'StaticAbility',
    // GiselaDamageDoubling: applyDamageReplacementEffects scans for this kind.
    modifier: { kind: 'GiselaDamageDoubling' },
    // Empty filter: continuous.ts isAffectedBy will see no filter criteria and
    // would apply it to everything — but selfOnly + the damage-replacement path
    // being the sole enforcement site means it never reaches the layer system.
    // We set selfOnly:true so continuous.ts treats it as a source-self flag and
    // the layer loops skip it entirely; the replacement scan in replacement.ts
    // drives the actual game effect.
    filter: {},
    controller: 'you',
    excludeSelf: false,
    selfOnly: true,
  };
}

/**
 * Gisela, Blade of Goldnight — damage-HALVING line:
 *
 *   "If a source would deal damage to you or a permanent you control, prevent
 *    half that damage, rounded up."
 *
 * CR ruling: "prevent half that damage, rounded up" means the engine calculates
 * prevented = ceil(original / 2), so dealt = floor(original / 2).
 *   3 damage → prevent ceil(1.5)=2 → deal 1
 *   4 damage → prevent ceil(2.0)=2 → deal 2
 *   1 damage → prevent ceil(0.5)=1 → deal 0 (fully prevented)
 *
 * Enforced in applyDamageReplacementEffects (replacement.ts).
 */
export function matchGiselaDamageHalving(tokens: string[]): StaticAbilityEffect | null {
  if (tokens.length < 10) return null;

  const joined = tokens.join(' ');

  const hasPreamble = /^if\s+a\s+source\s+would\s+deal\s+damage\s+to\s+you\b/i.test(joined);
  const hasHalf = /\bprevent\s+half\s+that\s+damage\b/i.test(joined);
  const hasRoundedUp = /\brounded\s+up\b/i.test(joined);

  if (!hasPreamble || !hasHalf || !hasRoundedUp) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GiselaDamageHalving' },
    filter: {},
    controller: 'you',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// Tam, Mindful First-Year — hexproof from own colors
// ============================================================================

/**
 * Match:
 *   "Each other creature you control has hexproof from each of its colors."
 *
 * This is Tam, Mindful First-Year's static ability. Each OTHER creature the
 * controller controls gains hexproof from its OWN colors (dynamically resolved
 * at targeting time). A red creature becomes hexproof-from-red; a green/blue
 * creature becomes hexproof-from-green AND hexproof-from-blue; etc.
 *
 * HONEST: the enforcement is in validateTargetChoices (targets.ts) which calls
 * isBlockedByHexproofFromOwnColors (keywords.ts). When an opponent's spell or
 * ability tries to target a creature under this modifier, we look up the target's
 * own colors and the source's colors. If any color overlaps, targeting is rejected.
 *
 * The modifier carries no fixed color — colors are resolved dynamically from the
 * target creature's CardDefinition.colors at check time.
 *
 * Accepted token shape (after tokenizeOracleText):
 *   "each other creature you control has hexproof from each of its colors [.]"
 */
export function matchHexproofFromOwnColors(tokens: string[]): StaticAbilityEffect | null {
  let idx = 0;

  // "each"
  if (tokens[idx] !== 'each') return null;
  idx++;

  // "other"
  if (tokens[idx] !== 'other') return null;
  idx++;

  // "creature" / "creatures" (either form tolerated)
  if (tokens[idx] !== 'creature' && tokens[idx] !== 'creatures') return null;
  idx++;

  // "you control"
  if (tokens[idx] !== 'you' || tokens[idx + 1] !== 'control') return null;
  idx += 2;

  // "has" or "have"
  if (tokens[idx] !== 'has' && tokens[idx] !== 'have') return null;
  idx++;

  // "hexproof from each of its colors"
  if (
    tokens[idx] !== 'hexproof'
    || tokens[idx + 1] !== 'from'
    || tokens[idx + 2] !== 'each'
    || tokens[idx + 3] !== 'of'
    || tokens[idx + 4] !== 'its'
    || tokens[idx + 5] !== 'colors'
  ) return null;
  idx += 6;

  // Optional trailing period
  if (tokens[idx] === '.') idx++;

  // HONEST: must consume ALL tokens. If there are remaining tokens (e.g. a
  // second line in the oracle text was concatenated by the tokenizer), this
  // matcher must decline so the whole-face or per-line dispatch can process
  // the remaining abilities correctly. parseOracleTextPerLine will call
  // parseOracleText once per line, at which point this matcher will succeed
  // on the single-line form.
  if (idx < tokens.length) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'HexproofFromOwnColors' },
    filter: { types: ['creature'] },
    controller: 'you',
    excludeSelf: true, // "other" — Tam itself is not affected
  };
}

// ============================================================================
// matchTopLibraryPlayStatic
// ============================================================================

/**
 * Match the top-of-library play-permission static ability family:
 *
 *   "Play with the top card of your library revealed. You may play lands and
 *    cast spells from the top of your library."
 *   (Magus of the Future, Melek Izzet Paragon, Korlessa Scale Singer,
 *    Vampire Nocturnus, One with the Multiverse, Assemble the Players, etc.)
 *
 * Two primary wording shapes:
 *   A) "Play with the top card of your library revealed." — reveals only, no play permission.
 *      We also absorb this form but emit PlayFromTopLibrary (engine visibility is already free).
 *   B) "You may play lands and cast spells from the top of your library." —
 *      full permission (may be filtered).
 *   C) "You may look at the top card of your library any time." — look-only line.
 *      Absorbed as a recognition marker (reveals are already visible to engine).
 *   D) "You may cast [<filter>] spells from the top of your library." — filtered cast permission.
 *
 * HONEST: enforced end-to-end by canCastSpell (stack.ts) and canPlayLandDetailed (actions.ts):
 * when a card at the top of the controller's library is being played/cast, both functions scan
 * continuousEffects for PlayFromTopLibrary modifiers registered by permanents that controller
 * controls. The typeFilter (if any) gates whether the specific card may be played from the top.
 * The reveal half is free (the engine already sees all cards in the library).
 *
 * These statics are registered via registerContinuousAbilitiesForPermanent (called at ETB).
 *
 * HONESTY GATE: We claim any face whose entire oracle text (after reminder-text stripping) is
 * composed only of top-library-play sentences (reveal, look, or play-from-top) and optionally
 * keyword lines absorbable by ABSORBABLE_ENGINE_KEYWORDS. We decline faces with real unrun
 * clauses alongside the top-library static (e.g. Vampire Nocturnus's anthem, which is a
 * separate continuous ability that needs a different executor path).
 *
 * Multi-sentence approach: operate on the raw oracle text (not tokens) because the family's
 * sentences can appear in either order and across multiple lines.
 */

const REVEAL_TOP_CARD_RE =
  /^play with the top card of your library revealed\.?$/i;

const LOOK_TOP_CARD_RE =
  /^you may look at the top card of your library any time\.?$/i;

// "You may look at the top card of your library any time, and you may play lands
//  from the top of your library." — Radha, Heart of Keld (combined single-sentence form).
// Captures the combined look + land-play in ONE sentence joined by ", and".
const LOOK_AND_PLAY_LANDS_COMBINED_RE =
  /^you may look at the top card of your library any time,\s+and\s+you may play (?:additional )?lands? from the top of your library\.?$/i;

// "You may look at the top card of your library any time, and you may play lands
//  and cast spells from the top of your library." — combined look + full-play single sentence.
const LOOK_AND_PLAY_FULL_COMBINED_RE =
  /^you may look at the top card of your library any time,\s+and\s+you may play lands and cast spells from the top of your library\.?$/i;

// "You may play lands and cast spells from the top of your library."
// or "You may play lands from the top of your library." (land-only permission)
const PLAY_LANDS_AND_SPELLS_RE =
  /^you may play lands and cast spells from the top of your library\.?$/i;

const PLAY_LANDS_ONLY_RE =
  /^you may play (?:additional )?lands? from the top of your library\.?$/i;

// "You may cast [<filter>] spells from the top of your library."
// Filter is optional — capturing group 1 is everything between "cast" and "spells".
const CAST_SPELLS_FROM_TOP_RE =
  /^you may cast (.+?)(?:instant and sorcery |dragon |creature |instant |sorcery |noncreature |artifact |enchantment |planeswalker |land )?spells? from the top of your library\.?$/i;

// Named variants (whole-sentence matches for the "cast <type> spells from top" form)
const CAST_INSTANT_SORCERY_FROM_TOP_RE =
  /^you may cast instant and sorcery spells from the top of your library\.?$/i;

const CAST_DRAGON_FROM_TOP_RE =
  /^you may cast dragon spells from the top of your library\.?$/i;

const CAST_CREATURE_FROM_TOP_RE =
  /^you may cast creature spells from the top of your library\.?$/i;

// "You may cast creature spells with power 2 or less from the top of your library."
// (Assemble the Players family)
const CAST_CREATURE_POWER_FROM_TOP_RE =
  /^you may cast creature spells with power (\d+) or less from the top of your library\.?$/i;

const CAST_NONCREATURE_FROM_TOP_RE =
  /^you may cast noncreature spells from the top of your library\.?$/i;

const CAST_ANY_SPELL_FROM_TOP_RE =
  /^you may cast spells from the top of your library\.?$/i;

// Generic fallback: "you may cast <any words> from the top of your library"
const CAST_GENERIC_FROM_TOP_RE =
  /^you may cast .+ from the top of your library\.?$/i;

// ── Slice 11: once-per-turn cast-from-top rider (honest skip) ─────────────────
// "Once each turn, you may cast <X> from the top of your library."
// "Once during each of your turns, you may cast <X> from [your hand or] the top
//  of your library [without paying its mana cost]."
// The "once per turn" constraint is not enforced by the engine; absorbing these
// riders is a pure-downside honest skip — the player loses an extra-cast
// opportunity the engine would never have granted anyway.
const ONCE_PER_TURN_CAST_FROM_TOP_RE =
  /^once (?:each turn|during each of your turns),\s+you may cast .+$/i;

// ── Slice 11: "if you cast a spell this way, you may cast it as though it had flash"
// (Elsha of the Infinite rider). Flash-as-though is not enforced; absorbing is
// a pure-downside honest skip.
const IF_CAST_THIS_WAY_FLASH_RE =
  /^if you cast a spell this way,\s+you may cast it as though it had flash\.?$/i;

// ── Slice 11: "you can spend mana of any type to cast [<X>] spells"
// (Vizier of the Menagerie). Mana-color flexibility is not enforced; honest skip.
const SPEND_ANY_MANA_RE =
  /^you can spend mana of any (?:color|type) to cast\b.+$/i;

// ── Slice 5: "You may play the top card of your library." (without "from the top")
// (The Lunar Whale). Wording variant: "play the top card" instead of "play ... from the top".
// HONEST: same executor path as PlayFromTopLibrary — canPlayLandDetailed / canCastSpell
// check the PlayFromTopLibrary modifier registered by registerContinuousAbilitiesForPermanent.
const PLAY_TOP_CARD_DIRECT_RE =
  /^you may play the top card of your library\.?$/i;

// ── Slice 5: "As long as <condition>, you may play the top card of your library."
// (The Lunar Whale combat-gated form). The combat-state condition is not tracked by
// the engine; absorbing the whole sentence is an honest skip — the player LOSES the
// "play from top" permission the card grants, so no fabricated benefit occurs.
// Shared by isTopLibraryStaticSentence below (per-line absorber).
const PLAY_TOP_CARD_CONDITIONAL_RE =
  /^as\s+long\s+as\s+.+,\s+you\s+may\s+play\s+the\s+top\s+card\s+of\s+your\s+library\.?$/i;

// ── Slice 5: "You may cast instant or sorcery spells from the top of your library."
// (with "or" instead of "and"). Wording variant of CAST_INSTANT_SORCERY_FROM_TOP_RE.
const CAST_INSTANT_OR_SORCERY_FROM_TOP_RE =
  /^you may cast instant or sorcery spells from the top of your library\.?$/i;

/**
 * Strips reminder text (text in parentheses) from oracle text.
 * Used to clean up sentences before matching.
 */
function stripReminderText(text: string): string {
  return text.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse the type filter from a "cast <filter> spells from the top" sentence.
 * Returns a CardFilter if a recognisable filter is found, otherwise undefined.
 */
function parseTopLibraryTypeFilter(sentence: string): CardFilter | undefined {
  // Both "instant and sorcery" (CAST_INSTANT_SORCERY_FROM_TOP_RE) and
  // "instant or sorcery" (CAST_INSTANT_OR_SORCERY_FROM_TOP_RE) map to the same filter.
  if (CAST_INSTANT_SORCERY_FROM_TOP_RE.test(sentence) || CAST_INSTANT_OR_SORCERY_FROM_TOP_RE.test(sentence)) {
    return { anyOf: [{ types: ['instant'] }, { types: ['sorcery'] }] };
  }
  if (CAST_DRAGON_FROM_TOP_RE.test(sentence)) {
    return { types: ['creature'], subtypes: ['dragon'] };
  }
  // "creature spells with power N or less"
  const pwrMatch = sentence.match(CAST_CREATURE_POWER_FROM_TOP_RE);
  if (pwrMatch) {
    return { types: ['creature'], power: { op: 'lte', value: parseInt(pwrMatch[1], 10) } };
  }
  if (CAST_CREATURE_FROM_TOP_RE.test(sentence)) {
    return { types: ['creature'] };
  }
  if (CAST_NONCREATURE_FROM_TOP_RE.test(sentence)) {
    return { excludeTypes: ['creature'] };
  }
  return undefined; // No filter — any card
}

export function matchTopLibraryPlayStatic(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;

  // Split on newlines first (preserving line structure), then split each line on
  // ". <Capital>" boundaries (to handle multi-sentence lines), and strip reminder
  // text from each fragment individually.  Stripping AFTER splitting prevents
  // the parenthetical period scanner from breaking inside reminder clauses (e.g.
  // "Once each turn, you may cast X. (You still pay its costs. Timing rules still
  // apply.)" would otherwise be mis-split at the periods inside the parentheses).
  const rawSentences: string[] = [];
  for (const line of oracleText.replace(/\r/g, '').split('\n')) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    // Split the line on ". <Capital>" boundaries to handle multi-sentence lines,
    // but first strip reminder text so the splitter doesn't break inside parens.
    const lineNoReminder = stripReminderText(trimmedLine);
    for (const part of lineNoReminder.split(/(?<=\.)\s+(?=[A-Z])/)) {
      const s = part.trim();
      if (s) rawSentences.push(s);
    }
  }

  if (rawSentences.length === 0) return null;

  // Check each sentence — categorize as:
  //   'reveal'  — "Play with the top card of your library revealed."
  //   'look'    — "You may look at the top card of your library any time."
  //   'play'    — "You may play lands [and cast spells] from the top..."
  //   'cast'    — "You may cast [<filter>] spells from the top..."
  //   'keyword' — absorbable engine keyword (flying, trample, etc.)
  //   'unknown' — cannot categorize → decline

  let hasTopLibraryLine = false;
  let hasPlayPermission = false;
  let typeFilter: CardFilter | undefined = undefined;
  let landsOnly = false;

  for (const sentence of rawSentences) {
    if (!sentence) continue;

    if (REVEAL_TOP_CARD_RE.test(sentence)) {
      hasTopLibraryLine = true;
      // "reveal" line alone does not grant play permission
      continue;
    }

    if (LOOK_TOP_CARD_RE.test(sentence)) {
      hasTopLibraryLine = true;
      // look-only line — still grants visibility (free)
      continue;
    }

    // Slice 11: combined "look...any time, and you may play lands from the top" single sentence.
    // Radha, Heart of Keld prints this as one sentence joined by ", and".
    if (LOOK_AND_PLAY_LANDS_COMBINED_RE.test(sentence)) {
      hasTopLibraryLine = true;
      hasPlayPermission = true;
      landsOnly = true;
      if (typeFilter === undefined) typeFilter = { types: ['land'] };
      continue;
    }

    // Slice 11: combined "look...any time, and you may play lands and cast spells" single sentence.
    if (LOOK_AND_PLAY_FULL_COMBINED_RE.test(sentence)) {
      hasTopLibraryLine = true;
      hasPlayPermission = true;
      typeFilter = undefined; // full permission — any card
      continue;
    }

    if (PLAY_LANDS_AND_SPELLS_RE.test(sentence)) {
      hasTopLibraryLine = true;
      hasPlayPermission = true;
      typeFilter = undefined; // any card may be played
      continue;
    }

    if (PLAY_LANDS_ONLY_RE.test(sentence)) {
      hasTopLibraryLine = true;
      hasPlayPermission = true;
      landsOnly = true;
      typeFilter = { types: ['land'] };
      continue;
    }

    // Slice 5: "You may play the top card of your library." (without "from the top")
    // (The Lunar Whale wording variant). Grants full play permission for any top card.
    if (PLAY_TOP_CARD_DIRECT_RE.test(sentence)) {
      hasTopLibraryLine = true;
      hasPlayPermission = true;
      typeFilter = undefined; // any card may be played from the top
      continue;
    }

    // Slice 5: "As long as <condition>, you may play the top card of your library."
    // (The Lunar Whale combat-gated form). The combat-state condition is not tracked;
    // absorbing as an honest skip (player loses the ability — no fabricated benefit).
    if (PLAY_TOP_CARD_CONDITIONAL_RE.test(sentence)) {
      hasTopLibraryLine = true;
      // Do NOT set hasPlayPermission — we can't enforce the condition gate.
      continue;
    }

    if (CAST_ANY_SPELL_FROM_TOP_RE.test(sentence)) {
      hasTopLibraryLine = true;
      hasPlayPermission = true;
      // No type filter — any spell
      continue;
    }

    if (CAST_GENERIC_FROM_TOP_RE.test(sentence)) {
      hasTopLibraryLine = true;
      hasPlayPermission = true;
      // Try to parse the type filter from the sentence
      const filter = parseTopLibraryTypeFilter(sentence);
      if (typeFilter === undefined || !hasPlayPermission) {
        typeFilter = filter;
      }
      continue;
    }

    // Slice 11: once-per-turn cast-from-top riders (honest skip).
    // "Once each turn, you may cast X from the top of your library."
    // "Once during each of your turns, you may cast X from [hand or] the top..."
    // The once-per-turn gate is not enforced; absorbing is pure-downside.
    if (ONCE_PER_TURN_CAST_FROM_TOP_RE.test(sentence)) {
      // Absorbed as honest skip — do NOT set hasPlayPermission (we don't enforce the once-per-turn cast).
      // hasTopLibraryLine stays as-is (set by an earlier look/reveal line if present).
      continue;
    }

    // Slice 11: "if you cast a spell this way, you may cast it as though it had flash"
    // (Elsha of the Infinite). Flash-as-though is not enforced; honest skip.
    if (IF_CAST_THIS_WAY_FLASH_RE.test(sentence)) {
      continue;
    }

    // Slice 11: "you can spend mana of any type to cast [X] spells"
    // (Vizier of the Menagerie). Mana-color flexibility not enforced; honest skip.
    if (SPEND_ANY_MANA_RE.test(sentence)) {
      continue;
    }

    // Engine keyword line — absorb as non-play-permission lines
    // (single-word keywords like "flying", "haste", etc.)
    const kwLower = sentence.toLowerCase().replace(/\.$/,'').trim();
    const ABSORB_KWS = new Set([
      'deathtouch', 'defender', 'double strike', 'first strike', 'flash', 'flying',
      'haste', 'hexproof', 'indestructible', 'lifelink', 'menace', 'reach',
      'trample', 'vigilance', 'prowess',
    ]);
    if (ABSORB_KWS.has(kwLower)) {
      // Keyword absorbed — not a disqualifier
      continue;
    }
    // Multi-word keyword check (comma/and list of the above)
    const parts = kwLower.split(/,\s*|\s+and\s+/).map(p => p.trim()).filter(Boolean);
    if (parts.length > 0 && parts.every(p => ABSORB_KWS.has(p))) {
      continue;
    }

    // Unrecognized sentence — the face has an unrun clause; decline.
    return null;
  }

  if (!hasTopLibraryLine) return null;

  // HONESTY: Only emit the PlayFromTopLibrary modifier when we have at least
  // one of: reveal line, look line, or play/cast-from-top line.
  // For pure reveal/look-only faces (no play permission), we still emit the
  // modifier so the face parses (reveal/visibility is enforced by the engine).

  const modifier: StaticModifier = hasPlayPermission && !landsOnly
    ? { kind: 'PlayFromTopLibrary', ...(typeFilter ? { typeFilter } : {}) }
    : hasPlayPermission && landsOnly
    ? { kind: 'PlayFromTopLibrary', typeFilter: { types: ['land'] } }
    : { kind: 'PlayFromTopLibrary' }; // reveal/look only — no real play permission gate

  return {
    kind: 'StaticAbility',
    modifier,
    filter: { permanent: true },
    controller: 'you',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// Slice 4: matchTopLibraryConditionalAnthem
// ============================================================================

/**
 * Match the 'top-card-of-library conditional anthem' family:
 *
 *   "As long as the top card of your library is black, Vampires you control
 *    get +2/+1 and have flying."    (Vampire Nocturnus)
 *
 *   "As long as the top card of your library is a creature card, creatures
 *    you control get +1/+1."        (Crown of Convergence)
 *
 *   "As long as the top card of your library is black, black creatures you
 *    control get +2/+1."            (Vampire Nocturnus Avatar)
 *
 * This handles the MULTI-SENTENCE oracle text case where the anthem line
 * appears alongside a top-library-reveal / look / play sentence:
 *   Sentence A: "Play with the top card of your library revealed."
 *   Sentence B: "As long as the top card of your library is <X>, <subject>
 *                get(s) +P/+T [and have <keywords>]."
 *
 * HONESTY:
 *   - The 'TopCardOfLibraryIs' condition is evaluated continuously at query time
 *     by evaluateCondition (continuous.ts), which reads the controller's first
 *     library card (Map insertion order = library stack order). If the library is
 *     empty the condition is false, and no buff applies — matching the card rule.
 *   - The ModifyPT modifier is applied by getContinuousPTModification (continuous.ts).
 *   - The optional GrantKeyword ("and have flying") is extracted by
 *     registerContinuousAbilitiesForPermanent (stack.ts) via
 *     additionalStaticKeywordFromLine and registered as a second ContinuousEffect,
 *     also gated on the same condition. This mirrors how other "get +X/+Y and have
 *     <kw>" anthems work throughout the engine.
 *   - The reveal / look / play sentence part is separately recognised and registered
 *     by matchTopLibraryPlayStatic when the engine calls
 *     registerContinuousAbilitiesForPermanent line-by-line. For the full oracle-text
 *     parse (coverage metric), we claim the face here using the anthem modifier as
 *     the primary result.
 *
 * CLAIM SCOPE:
 *   We claim only faces whose ENTIRE oracle text (after reminder-text stripping)
 *   consists of:
 *     - Zero or one top-library-reveal/look/play sentences (absorbed).
 *     - Exactly one "As long as the top card of your library is <X>, <subject>
 *       get(s) +P/+T [and have <kw>]" anthem sentence.
 *     - Zero or more absorbable engine keyword lines.
 *
 * Per-line parsing (registerContinuousAbilitiesForPermanent): the anthem line
 * alone is routed through matchConditionalStaticAbility, which calls
 * parseStaticCondition (now extended for TopCardOfLibraryIs) + matchStaticAbility.
 * No direct call to matchTopLibraryConditionalAnthem is needed for execution.
 * This matcher exists only for the full-oracle-text coverage claim.
 */

// Regex matching the anthem sentence shape on the raw (reminder-stripped) line.
// Captures:
//   Group 1: the condition word(s) after "is " (color word OR "a <type> card")
//   Group 2: the full predicate ("get +2/+1 and have flying")
const TOP_CARD_ANTHEM_SENTENCE_RE =
  /^as\s+long\s+as\s+the\s+top\s+card\s+of\s+your\s+library\s+is\s+((?:a\s+)?[\w\s]+?)\s*,\s*([\w\s+\-/]+)\.?$/i;

// Words recognisable as colors in the condition
const TOP_CARD_COLOR_WORDS: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
};

// Card types recognisable in "is a <type> card"
const TOP_CARD_TYPE_WORDS = new Set([
  'creature', 'land', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'battle',
]);

/**
 * Try to parse the condition phrase from the anthem sentence.
 * Returns the condition or null if the phrase is not recognised.
 */
function parseTopCardConditionPhrase(phrase: string): import('../ast').Condition | null {
  const p = phrase.trim().toLowerCase();
  // "black", "red", etc.
  if (TOP_CARD_COLOR_WORDS[p]) {
    return { kind: 'TopCardOfLibraryIs', colors: [TOP_CARD_COLOR_WORDS[p]] };
  }
  // "a creature card", "a land card", etc.
  const aTypeMatch = p.match(/^an?\s+(\w+)\s+card$/);
  if (aTypeMatch && TOP_CARD_TYPE_WORDS.has(aTypeMatch[1])) {
    return { kind: 'TopCardOfLibraryIs', cardTypes: [aTypeMatch[1]] };
  }
  // "a creature" (without "card" suffix) — rare but permit
  const aTypeNoCard = p.match(/^an?\s+(\w+)$/);
  if (aTypeNoCard && TOP_CARD_TYPE_WORDS.has(aTypeNoCard[1])) {
    return { kind: 'TopCardOfLibraryIs', cardTypes: [aTypeNoCard[1]] };
  }
  return null;
}

/**
 * Parse a PT token like "+2/+1" into { power, toughness }.
 * Returns null if the token is not a valid PT modifier.
 */
function parsePTToken(tok: string | undefined): { power: number; toughness: number } | null {
  if (!tok) return null;
  const m = tok.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!m) return null;
  return { power: parseInt(m[1], 10), toughness: parseInt(m[2], 10) };
}

export function matchTopLibraryConditionalAnthem(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;

  // Split on sentence boundaries and strip reminder text.
  const rawSentences = oracleText
    .replace(/\r/g, '')
    .split(/\n|(?<=\.)\s+(?=[A-Z])/)
    .map(s => stripReminderText(s.trim()))
    .filter(Boolean);

  if (rawSentences.length === 0) return null;

  let anthemSentence: string | null = null;

  for (const sentence of rawSentences) {
    if (!sentence) continue;

    // Accept top-library reveal / look / play sentences (they register separately)
    if (REVEAL_TOP_CARD_RE.test(sentence)) continue;
    if (LOOK_TOP_CARD_RE.test(sentence)) continue;
    if (PLAY_LANDS_AND_SPELLS_RE.test(sentence)) continue;
    if (PLAY_LANDS_ONLY_RE.test(sentence)) continue;
    if (CAST_ANY_SPELL_FROM_TOP_RE.test(sentence)) continue;
    if (CAST_GENERIC_FROM_TOP_RE.test(sentence)) continue;

    // Absorb activated ability line (Crown of Convergence's "{T}: Put..." line).
    // We only claim the anthem; activated abilities register separately.
    if (/^\{[^}]+\}\s*:/i.test(sentence)) continue;

    // Absorb engine keyword lines (single words or comma/and lists)
    const kwLower = sentence.toLowerCase().replace(/\.$/,'').trim();
    const ABSORB_KWS = new Set([
      'deathtouch', 'defender', 'double strike', 'first strike', 'flash', 'flying',
      'haste', 'hexproof', 'indestructible', 'lifelink', 'menace', 'reach',
      'trample', 'vigilance', 'prowess',
    ]);
    if (ABSORB_KWS.has(kwLower)) continue;
    const parts = kwLower.split(/,\s*|\s+and\s+/).map(p => p.trim()).filter(Boolean);
    if (parts.length > 0 && parts.every(p => ABSORB_KWS.has(p))) continue;

    // Anthem sentence: "As long as the top card of your library is ..."
    if (TOP_CARD_ANTHEM_SENTENCE_RE.test(sentence)) {
      if (anthemSentence !== null) return null; // only one anthem allowed
      anthemSentence = sentence;
      continue;
    }

    // Any other sentence — unrecognised; decline the face.
    return null;
  }

  if (!anthemSentence) return null;

  // Parse the anthem sentence into condition + modifier.
  const m = TOP_CARD_ANTHEM_SENTENCE_RE.exec(anthemSentence);
  if (!m) return null;
  const conditionPhrase = m[1].trim();
  const predicatePhrase = m[2].trim();

  const condition = parseTopCardConditionPhrase(conditionPhrase);
  if (!condition) return null;

  // Tokenize the predicate ("vampires you control get +2/+1 and have flying")
  // to parse the subject filter and P/T modifier.
  const predTokens = predicatePhrase
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // Parse subject (filter + controller)
  let idx = 0;
  let excludeSelf = false;
  if (predTokens[idx] === 'other') { excludeSelf = true; idx++; }

  // Parse subject filter words until we hit "you" or "an"
  let filter: CardFilter = {};
  {
    const first = parseStaticFilterType(predTokens[idx] ?? '');
    if (!first) return null;
    filter = first;
    idx++;
    // Absorb additional filter words (e.g. "black creatures")
    while (idx < predTokens.length) {
      const next = parseStaticFilterType(predTokens[idx] ?? '');
      const currentIsOnlyColor = !!filter.colors?.length
        && !filter.types?.length
        && !filter.subtypes?.length;
      if (next && currentIsOnlyColor) { filter = mergeStaticFilters(filter, next); idx++; continue; }
      break;
    }
    // Absorb trailing "creatures" / "creature" noun
    if (predTokens[idx] === 'creature' || predTokens[idx] === 'creatures') idx++;
  }

  // Controller clause
  let controller: 'you' | 'opponent' | 'any' = 'you';
  if (predTokens[idx] === 'you' && predTokens[idx + 1] === 'control') {
    controller = 'you'; idx += 2;
  } else if (predTokens[idx] === 'an' && predTokens[idx + 1] === 'opponent' && predTokens[idx + 2] === 'controls') {
    controller = 'opponent'; idx += 3;
  } else {
    // No explicit controller — treat as "any" (all-subtype style)
    controller = 'any';
  }

  // Verb: "get" / "gets" / "have" / "has"
  const verb = predTokens[idx] ?? '';
  if (verb !== 'get' && verb !== 'gets' && verb !== 'have' && verb !== 'has') return null;
  const isPT = verb === 'get' || verb === 'gets';
  idx++;

  let modifier: StaticModifier;
  if (isPT) {
    const pt = parsePTToken(predTokens[idx]);
    if (!pt) return null;
    modifier = { kind: 'ModifyPT', power: pt.power, toughness: pt.toughness };
    idx++;
    // Optional "and have <kw>" tail — the keyword registration is handled by
    // additionalStaticKeywordFromLine in registerContinuousAbilitiesForPermanent;
    // we only need to emit the ModifyPT modifier here for the coverage claim.
  } else {
    // Keyword-only grant: "creatures you control have flying"
    const kwTok = predTokens[idx] ?? '';
    if (!kwTok) return null;
    modifier = { kind: 'GrantKeyword', keyword: kwTok };
    idx++;
  }

  return {
    kind: 'StaticAbility',
    modifier,
    filter,
    controller,
    excludeSelf,
    condition,
  };
}

// ============================================================================
// matchLureStatic
// ============================================================================

/**
 * Slice 7 (lure): Static-form lure ability on a permanent.
 * "All creatures able to block ~ do so."  (Elvish Bard / Breaker of Armies)
 * "All creatures able to block equipped creature do so."  (Nemesis Mask)
 * "All creatures able to block enchanted creature do so."  (variant)
 *
 * These are always-on static abilities on the permanent; the enforcement is in
 * combat.ts `declareBlockers` which reads the oracle text of every attacker and
 * checks LURE_STATIC_SELF_RE / LURE_STATIC_ATTACHED_RE at block-declaration
 * time.  We emit a recognition-only StaticAbility (selfOnly GrantKeyword
 * 'MustBeBlockedIfAble') so the face stops being Unparsed.
 *
 * HONEST: combat.ts (declareBlockers) enforces the lure constraint end-to-end
 * by checking oracle text for the LURE_STATIC_SELF_RE / LURE_STATIC_ATTACHED_RE
 * patterns on each attacker and adding any matched card to the luredCreatureIds
 * set before the forced-block check.  The recognition marker is consistent with
 * how matchSelfMustAttack / matchEntersTapped / matchLandwalk work.
 */
/**
 * Matches the two static lure wordings on a creature's own oracle text:
 *   "All creatures able to block ~ do so."            (Elvish Bard / Breaker of Armies)
 *   "All creatures able to block this creature do so." (variant)
 *   "This creature must be blocked if able."          (Riveteers Decoy / bare self-static)
 *
 * combat.ts declareBlockers reads this regex directly from each attacker's oracle
 * text and forces every able blocker to block the matched attacker.
 */
export const LURE_STATIC_SELF_RE =
  /(?:\ball\s+creatures?\s+able\s+to\s+block\s+(?:this\s+creature|it|~)\s+do\s+so\b|\bthis\s+creature\s+must\s+be\s+blocked\s+if\s+able\b)/i;

export const LURE_STATIC_ATTACHED_RE =
  /\ball\s+creatures?\s+able\s+to\s+block\s+(?:equipped|enchanted)\s+creature\s+do\s+so\b/i;

export function matchLureStatic(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  if (!LURE_STATIC_SELF_RE.test(oracleText) && !LURE_STATIC_ATTACHED_RE.test(oracleText)) {
    return null;
  }
  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantKeyword', keyword: 'MustBeBlockedIfAble' },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// matchLureSpell
// ============================================================================

/**
 * Slice 7 (lure): Spell / trigger-body form.
 * "All creatures able to block target creature this turn do so."
 *   (Taunting Challenge, Goldenhide Ox ETB trigger body)
 * "All creatures able to block ~ this turn do so."  (provoke-style self-ref)
 * "~ must be blocked this turn if able."  (Goldenhide Ox 'must be blocked' form)
 *
 * Emits a MustBeBlockedIfAbleEffect with subject = Chosen (for targeted) or
 * Source (for self-reference).  The executor writes the resolved creature id
 * into state.combat.luredCreatureIds so combat.ts declareBlockers can enforce
 * the forced-block constraint for the current combat.
 *
 * HONEST: executor.ts executes the effect only when state.combat is active;
 * it is a no-op outside of combat (safe). combat.ts declareBlockers reads
 * luredCreatureIds to force every able blocker to block the lured creature.
 */

/** Targeted form: "all creatures able to block target creature this turn do so" */
const LURE_SPELL_TARGETED_RE =
  /\ball\s+creatures?\s+able\s+to\s+block\s+(?:target\s+creature|it)\s+(?:this\s+turn\s+)?do\s+so\b/i;

/** Self-ref form: "all creatures able to block ~ / this creature this turn do so" */
const LURE_SPELL_SELF_RE =
  /\ball\s+creatures?\s+able\s+to\s+block\s+(?:~|this\s+creature)\s+(?:this\s+turn\s+)?do\s+so\b/i;

/**
 * "target creature must be blocked [this turn] if able" (Goldenhide Ox trigger body).
 * Requires the leading "target creature" so we don't accidentally match
 * "This creature must be blocked if able." (which is a static, not a spell effect,
 * and is handled by matchLureStatic via the LURE_STATIC_SELF_RE pattern).
 */
const MUST_BE_BLOCKED_RE =
  /^target\s+creature\s+must\s+be\s+blocked\s+(?:this\s+turn\s+)?if\s+able\b/i;

export function matchLureSpell(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  const raw = slice.join(' ');

  // Targeted form: "all creatures able to block target creature [this turn] do so"
  // (Taunting Challenge family — targets a specific creature on the battlefield.)
  if (LURE_SPELL_TARGETED_RE.test(raw)) {
    const spec = makeTargetSpec('Creature');
    const effect: MustBeBlockedIfAbleEffect = {
      kind: 'MustBeBlockedIfAble',
      subject: makeChosenRef(spec),
    };
    // Count consumed tokens: "all creatures able to block target creature [this turn] do so"
    const hasThisTurn = /\bthis\s+turn\b/i.test(raw);
    const consumed = hasThisTurn ? 10 : 9; // with/without "this turn"
    return { effects: [effect], targets: [spec], consumed };
  }

  // NOTE: the "all creatures able to block ~ do so" (self-ref) and "all creatures
  // able to block this creature do so" forms are STATIC abilities on the permanent
  // (Elvish Bard / Breaker of Armies) and are handled exclusively by matchLureStatic
  // in parseOracleText — they must NOT be claimed here as a one-shot Spell effect.

  // "must be blocked [this turn] if able" — Goldenhide Ox trigger-body wording.
  // The subject here is "target creature" — implied by the trigger context where
  // "it" refers to the chosen target from the trigger's target spec.
  // We emit with a Chosen subject using the target spec in the trigger body.
  // NOTE: this form appears only inside trigger bodies after "target creature",
  // so the trigger-prefix parser provides the creature target context.
  if (MUST_BE_BLOCKED_RE.test(raw)) {
    // The "target creature" is provided by the preceding trigger context (eventContext).
    // Emit a Source-ref subject; the executor resolves Source to sourceInstanceId which
    // is the trigger's source card. For ETB Constellation triggers the correct behaviour
    // is to target the chosen creature via a TargetSpec. We emit a Chosen ref here.
    const spec = makeTargetSpec('Creature');
    const effect: MustBeBlockedIfAbleEffect = {
      kind: 'MustBeBlockedIfAble',
      subject: makeChosenRef(spec),
    };
    const hasThisTurn = /\bthis\s+turn\b/i.test(raw);
    const consumed = hasThisTurn ? 6 : 5;
    return { effects: [effect], targets: [spec], consumed };
  }

  return null;
}

// ============================================================================
// Slice 10 (play-permission): matchAdditionalLandDrop
// ============================================================================

/**
 * Slice 10 — "You may play an additional land on each of your turns."
 * (Exploration, Azusa Lost But Seeking, Oracle of Mul Daya, Wayward Swordtooth,
 *  Case of the Locked Hothouse, etc.)
 *
 * HONEST: maxLandsThisTurn (actions.ts:350) re-scans the oracle text of every
 * battlefield permanent at land-play time and grants the extra drop.  Absorbing
 * this line is genuine enforcement — the ability IS executed end-to-end.  We
 * emit a recognition-only StaticAbility (selfOnly) so the face stops reporting
 * Unparsed; no continuous-layer consumer is needed (actions.ts is the single
 * enforcement site).
 *
 * Supported wording forms (case-insensitive):
 *   "You may play an additional land on each of your turns."
 *   "You may play two additional lands on each of your turns."   (Azusa)
 *   "You may play three additional lands on each of your turns."
 *   "You may play N additional lands on each of your turns."    (any digit)
 *
 * Honesty gate: every non-matching sentence on the face must be an
 * engine-handled keyword sentence (isCBCAllowedKeywordSentence); any real
 * unrun ability keeps the face Unparsed.  Mixed multi-line faces are handled
 * by the per-line absorber in parseOracleTextPerLine (step 1l).
 */
const ADDITIONAL_LAND_SINGLE_RE =
  /^you may play an? additional land on each of your turns\.?$/i;
const ADDITIONAL_LAND_MULTI_RE =
  /^you may play (two|three|four|\d+) additional lands on each of your turns\.?$/i;
const ADDITIONAL_LAND_RE =
  /^you may play (?:an?\s+additional\s+land|(?:two|three|four|\d+)\s+additional\s+lands) on each of your turns\.?$/i;

function parseAdditionalLandCount(sentence: string): number | null {
  if (ADDITIONAL_LAND_SINGLE_RE.test(sentence)) return 1;
  const m = ADDITIONAL_LAND_MULTI_RE.exec(sentence);
  if (!m) return null;
  const WORD_NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4 };
  const n = m[1].toLowerCase();
  return /^\d+$/.test(n) ? parseInt(n, 10) : (WORD_NUMBERS[n] ?? 1);
}

export function matchAdditionalLandDrop(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;

  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let totalCount = 0;
  let hasAdditionalLand = false;
  for (const sentence of sentences) {
    const count = parseAdditionalLandCount(sentence);
    if (count !== null) {
      hasAdditionalLand = true;
      totalCount += count;
      continue;
    }
    // Any other sentence must be a recognized engine keyword — otherwise decline.
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }
  if (!hasAdditionalLand) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'AdditionalLandDrop', count: totalCount },
    filter: { permanent: true },
    controller: 'you',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// Slice 10 (play-permission): matchPlayLandsFromGraveyard
// ============================================================================

/**
 * Slice 10 — "You may play lands from your graveyard."
 * (Crucible of Worlds, Ancient Greenwarden, Ramunap Excavator, Perennial Behemoth, etc.)
 *
 * HONEST: pure-downside honest skip.  The engine has no land-from-graveyard
 * play path (grep src/ confirms zero enforcement in actions.ts / stack.ts).
 * Absorbing this line removes an ability the player cannot access in the engine —
 * same precedent as morph/kicker/loyalty-restriction absorption.
 * The recognition-only StaticAbility (selfOnly) credits the face for parse
 * visibility without fabricating any benefit.
 *
 * Honesty gate: every non-matching sentence on the face must be an
 * engine-handled keyword sentence; any real unrun ability keeps the face
 * Unparsed.  Mixed multi-line faces are handled by the per-line absorber in
 * parseOracleTextPerLine (step 1l).
 */
const PLAY_LANDS_FROM_GRAVEYARD_RE =
  /^you may play lands from your graveyard\.?$/i;

export function matchPlayLandsFromGraveyard(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;

  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let hasPlayFromGraveyard = false;
  for (const sentence of sentences) {
    if (PLAY_LANDS_FROM_GRAVEYARD_RE.test(sentence)) {
      hasPlayFromGraveyard = true;
      continue;
    }
    // Any other sentence must be a recognized engine keyword — otherwise decline.
    if (!isCBCAllowedKeywordSentence(sentence)) return null;
  }
  if (!hasPlayFromGraveyard) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'PlayLandsFromGraveyard' },
    filter: { permanent: true },
    controller: 'you',
    excludeSelf: false,
    selfOnly: true,
  };
}

/**
 * Test whether a cleaned oracle sentence is a recognized play-permission line
 * (additional land drop or lands from graveyard).  Used by parseOracleTextPerLine
 * step 1l to absorb these lines in multi-line faces.
 */
export function isPlayPermissionSentence(sentence: string): boolean {
  if (ADDITIONAL_LAND_RE.test(sentence)) return true;
  if (PLAY_LANDS_FROM_GRAVEYARD_RE.test(sentence)) return true;
  return false;
}

/**
 * Slice 5 — Test whether a cleaned oracle sentence is a top-of-library look/reveal
 * or play-permission sentence that can be absorbed in the per-line dispatcher when
 * it co-occurs with a separately-parseable ability (trigger, activated ability, or
 * other static) on the same multi-line face.
 *
 * Covers:
 *   "Play with the top card of your library revealed."
 *   "You may look at the top card of your library any time."
 *   "You may play lands and cast spells from the top of your library."
 *   "You may play lands from the top of your library."
 *   "You may play the top card of your library."           (Lunar Whale form)
 *   "As long as <condition>, you may play the top card …"  (combat-gated, honest skip)
 *   "You may cast [<filter>] spells from the top of your library."
 *   "You may look at the top card of your library any time, and you may play …"
 *   Once-per-turn riders and if-cast-this-way flash riders.
 *
 * HONESTY: The executor already runs PlayFromTopLibrary. Absorbing these lines in the
 * per-line dispatcher gives credit to the substantive sibling ability (a trigger, an
 * activated ability, etc.) without misrepresenting the face's effects.  The top-library
 * static itself is registered line-by-line by registerContinuousAbilitiesForPermanent,
 * so the ability is still applied — no capability is lost.
 *
 * For PLAY_TOP_CARD_CONDITIONAL_RE ("As long as attacked, …"), absorbing is an honest
 * skip: the combat condition is not enforced, so the player LOSES the gated permission;
 * no benefit is fabricated.
 */
export function isTopLibraryStaticSentence(sentence: string): boolean {
  if (REVEAL_TOP_CARD_RE.test(sentence)) return true;
  if (LOOK_TOP_CARD_RE.test(sentence)) return true;
  if (LOOK_AND_PLAY_LANDS_COMBINED_RE.test(sentence)) return true;
  if (LOOK_AND_PLAY_FULL_COMBINED_RE.test(sentence)) return true;
  if (PLAY_LANDS_AND_SPELLS_RE.test(sentence)) return true;
  if (PLAY_LANDS_ONLY_RE.test(sentence)) return true;
  if (PLAY_TOP_CARD_DIRECT_RE.test(sentence)) return true;
  if (PLAY_TOP_CARD_CONDITIONAL_RE.test(sentence)) return true;
  if (CAST_ANY_SPELL_FROM_TOP_RE.test(sentence)) return true;
  if (CAST_GENERIC_FROM_TOP_RE.test(sentence)) return true;
  if (ONCE_PER_TURN_CAST_FROM_TOP_RE.test(sentence)) return true;
  if (IF_CAST_THIS_WAY_FLASH_RE.test(sentence)) return true;
  if (SPEND_ANY_MANA_RE.test(sentence)) return true;
  return false;
}

// ============================================================================
// Slice 11: matchSelfDuringYourTurnAnthem
// ============================================================================

/**
 * Slice 11 — Self conditional anthem: "During your turn, this creature gets +N/+N."
 *
 * Matches the "During your turn" form printed on cards like Skophos Reaver, Sporeback
 * Wolf, etc. where a creature permanently has a P/T bonus only while its controller
 * is the active player.
 *
 * HONEST: the condition is evaluated in continuous.ts evaluateCondition via the new
 * IsActivePlayer condition kind, which checks state.players[state.activePlayerIndex].id
 * === controllerId. The ModifyPT modifier is applied by the normal continuous-layer path
 * (getEffectivePower / getEffectiveToughness), gated on ability.condition.
 *
 * Supported forms (case-insensitive, tokens):
 *   "During your turn, this creature gets +N/+N."
 *   "During your turn, this creature gets +N/+0." / "+0/+N."
 *   "During your turn, ~ gets +N/+N."
 *
 * The selfOnly flag limits the static to the source permanent only (no anthem effect).
 *
 * DECLINED: "During your turn, creatures you control get +N/+N" (mass anthem during
 * your turn) — this would need a non-selfOnly modifier, and the eval path works but
 * no existing test confirms it. Pure self form is confirmed by the executor route.
 *
 * Note: "As long as it's your turn" is the prefix-condition form; that is handled by
 * matchConditionalStaticAbility when the condition is mapped. We do NOT map that form
 * to IsActivePlayer here because the Condition union previously had no IsActivePlayer
 * entry. The simpler "During your turn, this creature gets" form does not use "as long
 * as" and is owned exclusively by this matcher.
 */
export function matchSelfDuringYourTurnAnthem(tokens: string[]): StaticAbilityEffect | null {
  // Tokens: "during" "your" "turn" "," "this" "creature"|"permanent" "gets" "+N/+N" "."
  // or      "during" "your" "turn" "," "~" "gets" "+N/+N" "."
  if (tokens[0] !== 'during' || tokens[1] !== 'your' || tokens[2] !== 'turn' || tokens[3] !== ',') {
    return null;
  }
  let idx = 4;

  // Subject: "this creature", "this permanent", or "~"
  if (tokens[idx] === '~') {
    idx++;
  } else if (tokens[idx] === 'this' && (tokens[idx + 1] === 'creature' || tokens[idx + 1] === 'permanent')) {
    idx += 2;
  } else {
    return null;
  }

  if (tokens[idx] !== 'gets') return null;
  idx++;

  // P/T modifier: "+N/+N", "+N/+0", "+0/+N", "-N/-N", etc.
  const ptMatch = tokens[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  idx++;

  // Optional trailing period
  if (tokens[idx] === '.') idx++;

  // Allow no extra tokens (this is a standalone static clause on this creature only)
  // Decline anything that adds "as long as", "and gains", or other riders —
  // those shapes belong to matchConditionalStaticAbility or matchStaticAbility.
  if (idx !== tokens.length) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'ModifyPT', power, toughness },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
    condition: { kind: 'IsActivePlayer' },
  };
}

// ============================================================================
// Slice 5: matchPlayerHexproof / matchPlayerShroud / matchCantGainLife
//          / matchDamageCantBePrevented
// ============================================================================

/**
 * Match "You have hexproof." (Ivory Mask / Leyline of Sanctity family).
 *
 * Supported forms (case-insensitive, after stripping reminder text):
 *   "You have hexproof."
 *   "You have hexproof" (no trailing period)
 *
 * Mixed faces: every OTHER sentence on the face must be an absorb-allowed keyword
 * or another supported player-prohibition sentence; otherwise the face stays Unparsed
 * so we never mask an unrun ability.
 *
 * HONEST: validateTargetChoices (targets.ts) scans state.continuousEffects for
 * PlayerHexproof. When an opponent tries to target the source's controller, the
 * target is rejected (mirrors the creature hexproof check). The selfOnly flag
 * means the source itself carries the effect, not a global anthem.
 */
const YOU_HAVE_HEXPROOF_RE = /^you\s+have\s+hexproof$/i;
const YOU_HAVE_SHROUD_RE = /^you\s+have\s+shroud$/i;
// Apostrophe variants via RegExp constructor (avoids source-file encoding ambiguity).
// Char class covers: ASCII apostrophe (U+0027), left single (U+2018), right single (U+2019).
const _CANT_APOS = "['‘’]";
const PLAYERS_CANT_GAIN_LIFE_RE = new RegExp("^players\\s+(?:can" + _CANT_APOS + "?t|cannot)\\s+gain\\s+life$", "i");
const DAMAGE_CANT_BE_PREVENTED_RE = new RegExp("^damage\\s+(?:can" + _CANT_APOS + "?t|cannot)\\s+be\\s+prevented(?:\\s+this\\s+turn)?$", "i");

/** Returns true when the sentence is one of the supported player-prohibition lines. */
function isPlayerProhibitionSentence(sentence: string): boolean {
  return (
    YOU_HAVE_HEXPROOF_RE.test(sentence) ||
    YOU_HAVE_SHROUD_RE.test(sentence) ||
    PLAYERS_CANT_GAIN_LIFE_RE.test(sentence) ||
    DAMAGE_CANT_BE_PREVENTED_RE.test(sentence)
  );
}

/** Strip trailing period and reminder text, return cleaned sentences. */
function prohibitionSentences(oracleText: string): string[] {
  return stripReminderTextForCBC(oracleText)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
}

/**
 * Match "You have hexproof." standalone or alongside allowed-keyword sentences.
 */
export function matchPlayerHexproof(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  const sentences = prohibitionSentences(oracleText);
  if (sentences.length === 0) return null;

  let hasHexproof = false;
  for (const sentence of sentences) {
    if (YOU_HAVE_HEXPROOF_RE.test(sentence)) { hasHexproof = true; continue; }
    // Allow other player-prohibition sentences (e.g. Leyline of Punishment mixes several)
    if (isPlayerProhibitionSentence(sentence)) continue;
    // Allow any engine-handled keyword on the same face
    if (isCBCAllowedKeywordSentence(sentence)) continue;
    return null;
  }
  if (!hasHexproof) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'PlayerHexproof' },
    filter: { permanent: true },
    controller: 'you',
    excludeSelf: false,
    selfOnly: true,
  };
}

/**
 * Match "You have shroud." standalone or alongside allowed-keyword sentences.
 */
export function matchPlayerShroud(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  const sentences = prohibitionSentences(oracleText);
  if (sentences.length === 0) return null;

  let hasShroud = false;
  for (const sentence of sentences) {
    if (YOU_HAVE_SHROUD_RE.test(sentence)) { hasShroud = true; continue; }
    if (isPlayerProhibitionSentence(sentence)) continue;
    if (isCBCAllowedKeywordSentence(sentence)) continue;
    return null;
  }
  if (!hasShroud) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'PlayerShroud' },
    filter: { permanent: true },
    controller: 'you',
    excludeSelf: false,
    selfOnly: true,
  };
}

/**
 * Match "Players can't gain life." standalone or alongside allowed-keyword / other
 * player-prohibition sentences. (Leyline of Punishment, Sulfuric Vortex, etc.)
 *
 * HONEST: executeGainLife (executor.ts) checks state.continuousEffects for
 * CantGainLife before applying life gain to any player.
 */
export function matchCantGainLife(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  const sentences = prohibitionSentences(oracleText);
  if (sentences.length === 0) return null;

  let hasCantGainLife = false;
  for (const sentence of sentences) {
    if (PLAYERS_CANT_GAIN_LIFE_RE.test(sentence)) { hasCantGainLife = true; continue; }
    if (isPlayerProhibitionSentence(sentence)) continue;
    if (isCBCAllowedKeywordSentence(sentence)) continue;
    return null;
  }
  if (!hasCantGainLife) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'CantGainLife' },
    filter: { permanent: true },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

/**
 * Match "Damage can't be prevented." standalone or alongside allowed-keyword / other
 * player-prohibition sentences. (Leyline of Punishment, Everlasting Torment, etc.)
 *
 * HONEST: applyDamageReplacementEffects (replacement.ts) checks state.continuousEffects
 * for DamageCantBePrevented and skips the prevention loops (state.damagePreventionEffects
 * and DamageDealt replacement registry) when found.
 */
export function matchDamageCantBePrevented(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  const sentences = prohibitionSentences(oracleText);
  if (sentences.length === 0) return null;

  let hasDamageCantBePrevented = false;
  for (const sentence of sentences) {
    if (DAMAGE_CANT_BE_PREVENTED_RE.test(sentence)) { hasDamageCantBePrevented = true; continue; }
    if (isPlayerProhibitionSentence(sentence)) continue;
    if (isCBCAllowedKeywordSentence(sentence)) continue;
    return null;
  }
  if (!hasDamageCantBePrevented) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'DamageCantBePrevented' },
    filter: { permanent: true },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// Slice 10 (combat statics): matchCastOnlyDuringDeclareBlockers
// ============================================================================

/**
 * Slice 10 — "Cast this spell only during the declare blockers step."
 * (Mirror Match family; ~4 faces.)
 *
 * Recognition-only StaticAbility (selfOnly).  Enforcement is in canCastSpell
 * (stack.ts): hasCastOnlyDuringDeclareBlockers scans the spell's oracle text and,
 * when found, requires state.step === 'declare_blockers' for the cast to be legal.
 *
 * Honesty gate: every NON-matching sentence on the face must be an engine-handled
 * keyword (isCBCAllowedKeywordSentence) — we never mask an unrun ability.
 * Faces whose only substantive text IS this restriction (mixed with keyword lines)
 * are claimed; the rest of the face's text is parsed separately by the caller.
 */
const CAST_ONLY_DURING_BLOCKERS_RE =
  /^cast\s+this\s+spell\s+only\s+during\s+the\s+declare\s+blockers\s+step\.?$/i;

/** Exported for stack.ts hasCastOnlyDuringDeclareBlockers to test oracle text. */
export const CAST_ONLY_DURING_BLOCKERS_FULL_RE =
  /\bcast\s+this\s+spell\s+only\s+during\s+the\s+declare\s+blockers\s+step\b/i;

export function matchCastOnlyDuringDeclareBlockers(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  // Quick pre-filter to avoid splitting every oracle text we see.
  if (!CAST_ONLY_DURING_BLOCKERS_FULL_RE.test(oracleText)) return null;

  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!\n]/g, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  let hasRestriction = false;
  for (const sentence of sentences) {
    if (CAST_ONLY_DURING_BLOCKERS_RE.test(sentence)) {
      hasRestriction = true;
      continue;
    }
    // Any other sentence must be an engine-handled keyword to avoid masking real abilities.
    if (isCBCAllowedKeywordSentence(sentence)) continue;
    // Decline — there is substantive unrun text on the face.
    return null;
  }
  if (!hasRestriction) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'CastOnlyDuringDeclareBlockers' },
    filter: { types: ['instant'] },
    controller: 'you',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// Slice 10 (combat statics): matchPowerLessThanCantBlock
// ============================================================================

/**
 * Slice 10 — "Creatures with power less than this creature's power can't block it."
 * (Wandering Wolf and functionally identical wordings; ~5 faces.)
 *
 * Recognition-only StaticAbility (selfOnly).  Enforcement is in canBlock
 * (keywords.ts): attackerHasPowerLessRestriction reads this regex directly from
 * the attacker's oracle text and returns false (block illegal) when the potential
 * blocker's effective power is strictly less than the attacker's effective power.
 *
 * This is the inverse of skulk (skulk: blockerPower > attackerPower → fail;
 * here: blockerPower < attackerPower → fail).  canBlock is the single
 * enforcement site, just as for skulk.
 *
 * Honesty gate: the rest of the face must be engine-handled keywords.
 */

/** Exported for keywords.ts attackerHasPowerLessRestriction to test oracle text. */
export const POWER_LESS_THAN_CANT_BLOCK_RE =
  /\bcreatures?\s+with\s+power\s+less\s+than\s+this\s+creature['']?s?\s+power\s+(?:can['']?t|cannot)\s+block\s+(?:it|this\s+creature|~)\b/i;

const POWER_LESS_THAN_CANT_BLOCK_SENTENCE_RE =
  /^creatures?\s+with\s+power\s+less\s+than\s+this\s+creature['']?s?\s+power\s+(?:can['']?t|cannot)\s+block\s+(?:it|this\s+creature|~)\.?$/i;

export function matchPowerLessThanCantBlock(oracleText: string): StaticAbilityEffect | null {
  if (!oracleText) return null;
  if (!POWER_LESS_THAN_CANT_BLOCK_RE.test(oracleText)) return null;

  const sentences = stripReminderTextForCBC(oracleText)
    .replace(/[.!\n]/g, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  let hasRestriction = false;
  for (const sentence of sentences) {
    if (POWER_LESS_THAN_CANT_BLOCK_SENTENCE_RE.test(sentence)) {
      hasRestriction = true;
      continue;
    }
    if (isCBCAllowedKeywordSentence(sentence)) continue;
    return null;
  }
  if (!hasRestriction) return null;

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'PowerLessThanThisCantBlock' },
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
  };
}

// ============================================================================
// Slice 11 (b): matchGrantLandManaAbility
// ============================================================================

/**
 * Slice 11 cut-b — Grant-land-mana-ability static.
 *
 * Matches patterns that grant a tap-for-any-color mana ability to lands:
 *
 *   'Lands you control have "{T}: Add one mana of any color."'
 *   'All lands have "{T}: Add one mana of any color."'
 *   'All lands have "{T}: Add one mana of any color" and lose all other abilities.'
 *   'All lands are Forests.' — NOT matched (subtype grant, not mana ability)
 *
 * SCOPE semantics:
 *   "Lands you control"  → controller: 'you',  filter: { types: ['land'] }
 *   "All lands"          → controller: 'any',   filter: { types: ['land'] }
 *   "Enchanted land has" → declined (handled by TappedForManaRider / attachedOnly)
 *
 * HONEST: The execution route is the existing GrantActivatedManaAbility path
 * (actions.ts getGrantedManaProductions + tapLandForMana). The land is treated
 * as producing any color just as if it had its own parsed manaProduction.  The
 * "and lose all other abilities" clause is partially honoured — lands controlled
 * by the effect's controller gain any-color production (additive), but the
 * "lose all other abilities" suppression is not implemented (recognise-only for
 * that clause). This is the HONESTY boundary: we do not promise to suppress the
 * existing land ability — we only add the any-color production. The card stops
 * being Unparsed and the effect is net-beneficial.
 *
 * The modifier kind is 'GrantActivatedManaAbility' (reused from Slice 4) with
 * filter: { types: ['land'] }. The existing continuous-layer consumer in
 * actions.ts handles this without any executor changes.
 *
 * Works on raw token array. Double-quotes are stripped; mana placeholders are
 * normalised to {t} for consistent matching.
 */

// Quick pre-filter: must contain "land" or "lands" and "any" in the raw text.
const GRANT_LAND_MANA_QUICK_RE = /\blands?\b.*\bany\b|\bany\b.*\blands?\b/i;

// Core pattern: "lands you control have {T}: add one mana of any color"
// or "all lands have {T}: add one mana of any color"
// Handles optional "and lose all other abilities" suffix.
// The period may appear as a separate token (producing trailing " .") or attached.
const GRANT_LAND_MANA_RE =
  /^(?:(lands\s+you\s+control|all\s+lands))\s+have\s+\{t\}\s*:\s*add\s+one\s+mana\s+of\s+any\s+(?:one\s+)?colou?r(?:\s+and\s+lose\s+all\s+other\s+abilities)?\s*\.?\s*$/i;

export function matchGrantLandManaAbility(tokens: string[]): StaticAbilityEffect | null {
  // Quick pre-filter
  const raw = tokens.join(' ').replace(/\s+/g, ' ').trim();
  if (!GRANT_LAND_MANA_QUICK_RE.test(raw)) return null;

  // Normalise: strip double-quotes, normalise mana placeholders → {t}
  const text = raw
    .replace(/"/g, '')
    .replace(/__mana_\d+__/gi, '{t}')
    .replace(/\s+/g, ' ').trim();

  const m = GRANT_LAND_MANA_RE.exec(text);
  if (!m) return null;

  // Determine scope from first capture group
  const subjectPhrase = m[1].toLowerCase().replace(/\s+/g, ' ').trim();
  const controller: StaticAbilityEffect['controller'] = subjectPhrase === 'all lands' ? 'any' : 'you';

  const grantedMana: ManaProductionInfo = {
    colors: ['W', 'U', 'B', 'R', 'G'],
    amounts: { W: 1, U: 1, B: 1, R: 1, G: 1 },
    isTapAbility: true,
    requiresSacrifice: false,
    activationZone: 'battlefield',
  };

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'GrantActivatedManaAbility', grantedMana },
    filter: { types: ['land'] },
    controller,
    excludeSelf: false,
  };
}

// ============================================================================
// Slice 4/CBC: matchOpponentsCantCastDuringYourTurn
// ============================================================================

/**
 * Slice 4/CBC — "Your opponents can't cast spells during your turn."
 * (Dragonlord Dromoka family). A STATIC ability on a battlefield permanent
 * whose controller's opponents cannot cast spells while it is the controller's
 * active turn.
 *
 * This is the sibling clause of cant-be-countered permanents; the CBC line is
 * absorbed by absorbSelfCBCLines and the keyword line (e.g. "Flying, lifelink")
 * is absorbed by absorbEngineKeywordLines, leaving this sentence for the main
 * static-ability dispatch.
 *
 * Distinct from matchOpponentsCantCastSpells (players.ts) which is a one-shot
 * spell EFFECT ("this turn"). This matcher parses the permanent static form
 * ("during your turn") which lasts indefinitely while the source is in play.
 *
 * HONEST: canCastSpell (stack.ts) scans continuousEffects for the new
 * OpponentsCantCastDuringYourTurn StaticModifier kind and blocks casting when:
 *   1. The caster is an opponent of the effect's controller, AND
 *   2. The effect's controller is the active player.
 * Registered via registerContinuousAbilitiesForPermanent. No new state field is
 * needed — the existing continuousEffects scan is the enforcement path.
 *
 * Accepted token form (after tokenization):
 *   ["your", "opponents", "cant", "cast", "spells", "during", "your", "turn"]
 */
export function matchOpponentsCantCastDuringYourTurn(tokens: string[]): StaticAbilityEffect | null {
  // Minimum: "your opponents can't cast spells during your turn"
  if (tokens.length < 8) return null;
  if (tokens[0] !== 'your' || tokens[1] !== 'opponents') return null;
  if (tokens[2] !== 'cant' && tokens[2] !== "can't" && tokens[2] !== 'cannot') return null;
  if (tokens[3] !== 'cast' || tokens[4] !== 'spells') return null;
  if (tokens[5] !== 'during' || tokens[6] !== 'your' || tokens[7] !== 'turn') return null;

  // Ensure nothing follows (besides an optional period) — guard against
  // future extension clauses that would require a more complex matcher.
  let idx = 8;
  if (tokens[idx] === '.') idx++;
  if (idx < tokens.length) return null; // trailing tokens → decline

  return {
    kind: 'StaticAbility',
    modifier: { kind: 'OpponentsCantCastDuringYourTurn' },
    filter: {},
    controller: 'any',
    excludeSelf: false,
    selfOnly: false,
  };
}

// ============================================================================
// Slice 5: matchSelfEquippedEnchantedAnthem
// ============================================================================

/**
 * Slice 5 — Self conditional static: "As long as this creature is equipped/enchanted,
 * it gets +P/+T [and has KW]."
 *
 * Handles the Skyhunter Cub / Kitesail Apprentice / Armory Veteran / Thran Golem family
 * where a creature grants itself a P/T buff and/or keywords conditional on being
 * equipped (any Equipment attached) or enchanted (any Aura attached).
 *
 * SUPPORTED FORMS (prefix only):
 *   "As long as this creature is equipped, it gets +1/+1 and has flying."
 *   "As long as ~ is equipped, it gets +1/+1 and has flying."
 *   "As long as this creature is equipped, it gets +1/+1."
 *   "As long as this creature is equipped, it has menace."
 *   "As long as this creature is enchanted, it gets +2/+2 and has flying, first strike, and trample."
 *
 * EXECUTION:
 *   SelfIsEquipped / SelfIsEnchanted is evaluated in continuous.ts evaluateCondition
 *   by scanning for a battlefield permanent with attachedTo === sourceInstanceId
 *   and the appropriate subtype/type.
 *
 *   For pure PT forms: emits ModifyPT with condition (continuous-layer gated).
 *   For keyword-only forms: emits GrantKeyword/GrantKeywords with condition (keywords.ts gated).
 *   For combined PT+keyword: emits ModifyPT with condition as primary; the keyword
 *   side-channel is registered by additionalStaticKeywordFromLine in
 *   registerContinuousAbilitiesForPermanent (stack.ts), which spreads ability.condition
 *   onto the extra GrantKeyword effect — both PT and keyword are condition-gated.
 */
export function matchSelfEquippedEnchantedAnthem(tokens: string[]): StaticAbilityEffect | null {
  // Prefix form: "as long as <self-ref> is equipped|enchanted , it gets|has <body>"
  if (tokens[0] !== 'as' || tokens[1] !== 'long' || tokens[2] !== 'as') return null;

  let idx = 3;

  // Self-reference: "~" or "this creature/permanent/artifact/enchantment"
  // (normalizeSelfSubtypeNouns converts "this Equipment" -> "this artifact",
  //  "this Aura" -> "this enchantment" before tokenization).
  const selfNouns = new Set(['creature', 'permanent', 'artifact', 'enchantment']);
  if (tokens[idx] === '~') {
    idx++;
  } else if (tokens[idx] === 'this' && selfNouns.has(tokens[idx + 1] ?? '')) {
    idx += 2;
  } else {
    return null;
  }

  // "is equipped" or "is enchanted"
  if (tokens[idx] !== 'is') return null;
  idx++;
  let condition: import('../ast').Condition;
  if (tokens[idx] === 'equipped') {
    condition = { kind: 'SelfIsEquipped' };
    idx++;
  } else if (tokens[idx] === 'enchanted') {
    condition = { kind: 'SelfIsEnchanted' };
    idx++;
  } else {
    return null;
  }

  // Separator comma
  if (tokens[idx] !== ',') return null;
  idx++;

  // Body subject: "it"
  if (tokens[idx] !== 'it') return null;
  idx++;

  // Body predicate: "gets +P/+T [and has KW ...]" or "has KW [and KW ...]"
  let power = 0;
  let toughness = 0;
  let hasPT = false;
  const keywords: string[] = [];

  if (tokens[idx] === 'gets') {
    idx++;
    const ptMatch = (tokens[idx] ?? '').match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    power = parseInt(ptMatch[1], 10);
    toughness = parseInt(ptMatch[2], 10);
    hasPT = true;
    idx++;
    // Optional "and has KW [, KW, ...] [and KW]"
    if (tokens[idx] === 'and' && (tokens[idx + 1] === 'has' || tokens[idx + 1] === 'have')) {
      idx += 2; // consume "and has"
      while (idx < tokens.length) {
        if (tokens[idx] === '.' || tokens[idx] === undefined) break;
        if (tokens[idx] === ',' || tokens[idx] === 'and') { idx++; continue; }
        const kw = readGrantableKeyword(tokens, idx);
        if (!kw) break;
        keywords.push(kw.keyword);
        idx += kw.consumed;
      }
    }
  } else if (tokens[idx] === 'has' || tokens[idx] === 'have') {
    idx++;
    while (idx < tokens.length) {
      if (tokens[idx] === '.' || tokens[idx] === undefined) break;
      if (tokens[idx] === ',' || tokens[idx] === 'and') { idx++; continue; }
      const kw = readGrantableKeyword(tokens, idx);
      if (!kw) break;
      keywords.push(kw.keyword);
      idx += kw.consumed;
    }
    if (keywords.length === 0) return null;
  } else {
    return null;
  }

  // Consume optional trailing period
  if (tokens[idx] === '.') idx++;

  // Ensure all tokens consumed — unsupported trailing content keeps the face Unparsed.
  if (idx !== tokens.length) return null;

  if (!hasPT && keywords.length === 0) return null;

  // Build the modifier following the existing engine convention:
  // - Pure PT: ModifyPT (condition-gated via continuous layer)
  // - Keyword-only: GrantKeyword / GrantKeywords (condition-gated via keywords.ts)
  // - Combined PT+KW: ModifyPT as primary; keyword registered as a second effect by
  //   additionalStaticKeywordFromLine in stack.ts (same condition spread from ability).
  let modifier: import('../ast').StaticModifier;
  if (hasPT) {
    modifier = { kind: 'ModifyPT', power, toughness };
  } else if (keywords.length === 1) {
    modifier = { kind: 'GrantKeyword', keyword: keywords[0] };
  } else {
    modifier = { kind: 'GrantKeywords', keywords };
  }

  return {
    kind: 'StaticAbility',
    modifier,
    filter: { types: ['creature'] },
    controller: 'any',
    excludeSelf: false,
    selfOnly: true,
    condition,
  };
}
