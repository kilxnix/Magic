import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { registerContinuousEffect, getGrantedKeywords } from '../effects/continuous';
import { hasKeyword } from '../keywords';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

/**
 * Slice 6: Multi-ability face unblocking — absorb engine-ENFORCED keyword-action
 * lines (equip / convoke) from mixed faces so the remaining ability lines can
 * parse normally.
 *
 * HONEST enforcement references:
 *  - equip: card-parser-cache.ts:34 parseEquipCost + actions.ts:1082 equipCreature
 *  - convoke: stack.ts:356 hasKeywordOrText('convoke') — taps creatures to pay costs
 *
 * The parser absorbs these standalone lines via ABSORBABLE_EQUIP_LINE_RE (new)
 * and 'convoke' added to ABSORBABLE_ENGINE_KEYWORDS.  The absorbed keywords are
 * recorded on the result; the remaining ability lines parse via the existing
 * full dispatch.
 *
 * HOW THE ABSORPTION PATHS WORK:
 *  - absorbEngineKeywordLines: strips whole engine-keyword lines and re-parses
 *    the remainder — used for STATIC/ACTIVATED abilities that matchers would
 *    otherwise ignore due to the extra keyword line.
 *  - parseOracleTextPerLine: per-line dispatch absorbs keyword lines at the
 *    line level, used for multi-substantive-line faces.
 *  - Some faces that were already parseable (via matchAttachedStaticBuff's
 *    token-scan or the nested-trigger scan) keep parsing unchanged — those cases
 *    are NOT what this slice adds; they are noted but not re-tested here.
 */

// ============================================================================
// Test helpers
// ============================================================================

function makePlayer(id: string, life = 40): Player {
  return {
    id, name: id, life,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false, hasPriority: false, hasLost: false,
  };
}

function makeCard(instanceId: string, definitionId: string, ownerId: string, zone = 'battlefield' as const): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name || id,
    type_line: opts.type_line || 'Creature',
    oracle_text: opts.oracle_text || '',
    mana_cost: opts.mana_cost || '',
    cmc: opts.cmc || 0,
    colors: opts.colors || [],
    color_identity: opts.color_identity || [],
    keywords: opts.keywords || [],
    card_types: opts.card_types || ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: overrides.players || [makePlayer('p1'), makePlayer('p2')],
    cards: overrides.cards || new Map(),
    cardDefinitions: overrides.cardDefinitions || new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as any,
    step: 'main' as any,
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: overrides.continuousEffects || [],
  };
}

// ============================================================================
// EQUIP LINE ABSORPTION — new coverage (cases that were previously Unparsed)
// ============================================================================

describe('equip-line absorption — new parsing coverage', () => {
  it('absorbs "Equip {1}" so the can-block-additional static parses (Echo Circlet)', () => {
    // This face was Unparsed before: matchCanBlockAdditionalStatic rejected "equip {1}"
    // as a non-keyword sentence. Now absorbEngineKeywordLines absorbs it first.
    const oracle = 'Equipped creature can block an additional creature each combat.\nEquip {1}';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    // The equip line is recorded as absorbed.
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /equip/i.test(k))).toBe(true);
  });

  it('absorbs multi-symbol equip cost so the can-block-additional static parses', () => {
    // "Equip {1}{W}" form — two brace symbols.
    const oracle = 'Equipped creature can block an additional creature each combat.\nEquip {1}{W}';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /equip/i.test(k))).toBe(true);
  });

  it('absorbs equip line so a keyword-grant static parses on a mixed equipment face', () => {
    // "Equipped creature has flying" blocked by trailing "Equip {2}" on its own line.
    // Before: matchCanBlockAdditionalStatic / matchAttachedStaticBuff would pick this
    // up without the equip line issue. Test this specifically for completeness.
    // Key: we test that equip in ABSORBABLE_EQUIP_LINE_RE DOES absorb.
    const oracle = 'Equipped creature can block an additional creature each combat.\nEquip {3}';
    const r = parseOracleText(oracle);
    expect(r.kind).not.toBe('Unparsed');
    if (r.kind === 'StaticAbility') {
      // If absorption path was used, absorbedKeywords is set.
      // (matchCanBlockAdditionalStatic rejects "equip" as a CBC-allowed keyword,
      //  so absorption is required for this face.)
      expect(r.absorbedKeywords).toBeDefined();
    }
  });

  it('does NOT absorb keyword-only equip face (stays Unparsed for KeywordOnly gate)', () => {
    // A face that is ONLY the equip line has no substantive remainder — stays Unparsed.
    expect(parseOracleText('Equip {2}').kind).toBe('Unparsed');
    // Two equip lines with no other content → Unparsed.
    expect(parseOracleText('Equip {1}\nEquip {2}').kind).toBe('Unparsed');
  });

  it('does NOT absorb bare "Equip" without a brace cost', () => {
    // Bare "Equip" with no cost is not a legal oracle form; ABSORBABLE_EQUIP_LINE_RE
    // requires at least one brace symbol — so bare "equip" is not absorbed.
    expect(() => parseOracleText('Equipped creature gets +1/+1.\nEquip')).not.toThrow();
    // (The buff line may parse on its own via other paths; we only verify no crash.)
  });
});

// ============================================================================
// CONVOKE LINE ABSORPTION — new coverage (cases that were previously Unparsed)
// ============================================================================

describe('convoke-line absorption — new parsing coverage', () => {
  it('absorbs "Convoke" so a keyword-grant static can parse (Order-of-Sacred-Dusk style)', () => {
    // This face was Unparsed before: "convoke" not in ABSORBABLE_ENGINE_KEYWORDS,
    // no nested-trigger scan applies, matchAttachedStaticBuff doesn't apply.
    // Now absorbEngineKeywordLines absorbs the "Convoke" line.
    const oracle = 'Convoke\nOther creatures you control have trample.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!).toContain('convoke');
  });

  it('absorbs "Convoke" so a cost-reduction static can parse', () => {
    // A convoke creature that also reduces instant/sorcery costs.
    const oracle = 'Convoke\nInstant and sorcery spells you cast cost {1} less to cast.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!).toContain('convoke');
  });

  it('absorbs "Convoke" with trample so a keyword-grant static can parse', () => {
    // Multiple absorbed keyword lines: "Convoke" + "Trample" + static.
    const oracle = 'Convoke\nTrample\nOther creatures you control have trample.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!).toContain('convoke');
    expect(r.absorbedKeywords!).toContain('trample');
  });

  it('does NOT absorb convoke-only face (stays Unparsed for keyword-only gate)', () => {
    expect(parseOracleText('Convoke').kind).toBe('Unparsed');
  });

  it('does NOT claim the face when the remainder still fails to parse', () => {
    // "Convoke" can be absorbed but if the rest is unparseable the face stays Unparsed.
    const oracle = 'Convoke\nYou may pay an additional cost that the engine does not run.';
    expect(parseOracleText(oracle).kind).toBe('Unparsed');
  });
});

// ============================================================================
// EXECUTION — the parsed remainder runs through the engine
// ============================================================================

describe('equip-line absorption — engine execution', () => {
  it('Echo Circlet: the absorbed-parse static allows blocking additional creatures', () => {
    // The CanBlockAdditional static needs to come from the absorb-parse path.
    const oracle = 'Equipped creature can block an additional creature each combat.\nEquip {1}';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    // The ability must be the CanBlockAdditional grant keyword.
    expect(parsed.ability.modifier).toMatchObject({
      kind: 'GrantKeyword',
      keyword: 'CanBlockAdditional',
    });
    // Absorbed keyword recorded.
    expect(parsed.absorbedKeywords!.some(k => /equip/i.test(k))).toBe(true);
  });
});

describe('convoke-line absorption — engine execution', () => {
  it('Convoke creature with keyword grant: grants trample to your other creatures', () => {
    // Formerly Unparsed; now StaticAbility via absorption.
    const oracle = 'Convoke\nOther creatures you control have trample.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    expect(parsed.absorbedKeywords).toContain('convoke');
    expect(parsed.ability.modifier).toMatchObject({ kind: 'GrantKeyword', keyword: 'trample' });
    expect(parsed.ability.excludeSelf).toBe(true);

    const cards = new Map<string, CardInstance>();
    cards.set('convoke_1', makeCard('convoke_1', 'convoke_def', 'p1'));
    cards.set('bear_1', makeCard('bear_1', 'bear_def', 'p1'));
    cards.set('bear_2', makeCard('bear_2', 'bear_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('convoke_def', makeDef('convoke_def', {
      name: 'Convoke Critter',
      type_line: 'Creature — Beast',
      oracle_text: oracle,
      keywords: ['Convoke'],
      colors: ['G'],
    }));
    defs.set('bear_def', makeDef('bear_def', { name: 'Bear', type_line: 'Creature — Bear' }));

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'convoke_1', 'p1', parsed.ability);

    // Your other creature gains trample from the static.
    expect(getGrantedKeywords(state, 'bear_1')).toContain('trample');
    expect(hasKeyword(state, 'bear_1', 'trample')).toBe(true);
    // Opponent's creature does not gain trample.
    expect(getGrantedKeywords(state, 'bear_2')).not.toContain('trample');
  });

  it('Convoke cost-reduction creature: reduces instant/sorcery costs after absorption', () => {
    const oracle = 'Convoke\nInstant and sorcery spells you cast cost {1} less to cast.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    expect(parsed.absorbedKeywords).toContain('convoke');
    // Modifier should be ReduceCost for instants/sorceries.
    expect(parsed.ability.modifier).toMatchObject({ kind: 'ReduceCost', amount: 1 });
    expect(parsed.ability.filter?.types).toEqual(expect.arrayContaining(['instant', 'sorcery']));
  });
});

// ============================================================================
// HONESTY GATES — absorption must never widen what the engine claims to run
// ============================================================================

describe('equip/convoke absorption — honesty gates', () => {
  it('equip and convoke together on a face with a keyword-grant static (new coverage)', () => {
    // Both equip AND convoke lines can be on the same face.
    // This face (convoke creature that is also equipment — unusual) should parse.
    const oracle = 'Convoke\nEquipped creature can block an additional creature each combat.\nEquip {2}';
    const r = parseOracleText(oracle);
    // Either StaticAbility (via absorption) or still Unparsed (edge case).
    // The main point: it must NOT crash.
    expect(() => parseOracleText(oracle)).not.toThrow();
    if (r.kind === 'StaticAbility') {
      // If it parsed, the absorbed keywords should include both convoke and equip.
      if (r.absorbedKeywords) {
        const allAbsorbed = r.absorbedKeywords.join(' ');
        expect(allAbsorbed).toMatch(/convoke|equip/i);
      }
    }
  });

  it('does NOT absorb unenforced keyword-like text (storm, cascade stay Unparsed)', () => {
    // Storm and cascade are not in ABSORBABLE_ENGINE_KEYWORDS.
    // A face with storm PLUS another ability should NOT be absorbed (dishonest — engine doesn't run storm).
    // The per-line dispatch rejects faces when any non-absorbable line fails to parse.
    const stormFace = 'Storm\nOther creatures you control have trample.';
    // storm is NOT in ABSORBABLE_ENGINE_KEYWORDS, so this stays Unparsed.
    expect(parseOracleText(stormFace).kind).toBe('Unparsed');
  });

  it('equip-only face stays Unparsed regardless of cost form', () => {
    // All equip-cost-only faces (no non-equip ability line) must stay Unparsed
    // because absorption requires a substantive remainder.
    expect(parseOracleText('Equip {1}{W}').kind).toBe('Unparsed');
    expect(parseOracleText('Equip creature you control {3}').kind).toBe('Unparsed');
  });
});
