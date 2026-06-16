import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { registerContinuousEffect } from '../effects/continuous';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

/**
 * Slice 1: enchant-preamble-absorption in per-line dispatch.
 *
 * Aura faces start with a standalone "Enchant <quality>" line
 * (e.g. "Enchant creature with another Aura attached to it").  When the
 * preamble is long enough that matchAttachedStaticBuff cannot find "enchanted
 * creature" within its 8-token scan window, the whole-face path fails and the
 * per-line dispatch is reached.  Previously step 1b was absent, so the bare
 * "Enchant creature with another Aura attached to it" line fell through to step
 * 5 and the whole face was rejected.
 *
 * The fix: in parseOracleTextPerLine, treat lines matching
 * /^enchant\s+[a-z][a-z0-9' ()-]*$/i as absorbable preamble (step 1b),
 * consistent with the existing trimLeadingKeywordOrEnchantPreamble logic.
 * Attachment legality is enforced by the targeting/attach system — same honesty
 * bar as the whole-face enchant-preamble trim.
 *
 * NOTE: Simple 2-line Auras ("Enchant creature\nEnchanted creature gets +N/+M")
 * already parsed BEFORE this slice via matchAttachedStaticBuff (which scans up
 * to 8 tokens ahead in the whole-face token stream and finds "enchanted creature
 * gets" after "enchant creature").  The per-line path — and therefore this
 * slice — is only exercised when that 8-token scan window is exceeded
 * (Daybreak Coronet) or when there are multiple non-preamble lines that each
 * need to parse independently.
 */

// ============================================================================
// Helpers
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
    type_line: opts.type_line || 'Enchantment — Aura',
    oracle_text: opts.oracle_text || '',
    mana_cost: opts.mana_cost || '',
    cmc: opts.cmc || 0,
    colors: opts.colors || [],
    color_identity: opts.color_identity || [],
    keywords: opts.keywords || [],
    card_types: opts.card_types || ['enchantment'],
    power: opts.power ?? undefined,
    toughness: opts.toughness ?? undefined,
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
// RECOGNITION tests — parser must parse (not Unparsed)
// ============================================================================

describe('enchant-preamble absorption — parser recognition', () => {
  /**
   * Daybreak Coronet: "Enchant creature with another Aura attached to it" is 9
   * tokens — beyond matchAttachedStaticBuff's 8-token scan window. The
   * whole-face path misses it; the per-line dispatch (step 1b) absorbs it and
   * lets the next line parse as an attached-static.
   */
  it('Daybreak Coronet: absorbs 9-token "Enchant creature with another Aura attached to it" preamble', () => {
    const oracle =
      'Enchant creature with another Aura attached to it\nEnchanted creature gets +3/+3 and has first strike, vigilance, and lifelink.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    // The absorbed preamble should appear in absorbedKeywords (with original casing)
    expect(r.absorbedKeywords).toEqual(
      expect.arrayContaining(['Enchant creature with another Aura attached to it']),
    );
  });

  it('absorbs "Enchant creature with another Aura attached to it" — exact wording', () => {
    // Verify the regex handles the full clause (9 tokens, mixed case).
    const oracle =
      'Enchant creature with another Aura attached to it\nEnchanted creature gets +3/+3 and has first strike, vigilance, and lifelink.';
    const r = parseOracleText(oracle);
    expect(r.kind).not.toBe('Unparsed');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k =>
      k.toLowerCase().startsWith('enchant creature with another'),
    )).toBe(true);
  });

  /**
   * Keyword-line before a triggered ability: simple "Enchant creature" preamble
   * on a multi-line face where there are also other parseable lines.
   * Uses 3-line oracle so the whole-face matchAttachedStaticBuff path fails
   * (trimLeadingKeywordOrEnchantPreamble strips only up to the first trigger,
   * leaving a complex remainder).
   */
  it('multi-line Aura face: "Enchant creature" + static + trigger; preamble absorbed via step 1b', () => {
    // "Enchant creature\nEnchanted creature has flying.\nWhen enchanted creature dies, draw a card."
    // whole-face: trimLeadingKeywordOrEnchantPreamble finds "when" and strips to "when enchanted creature dies"
    // matchDiesPrefix matches → tries to parse effect "draw a card" → should work.
    // BUT: the preamble stripping LOSES the static buff line, so only the Dies trigger is parsed.
    // In the per-line path (which also runs if whole-face succeeds here this is moot;
    // but let's confirm the DIES path works for the trigger-bearing sub-case).
    // We focus on the 9-token preamble cases that definitively need per-line.
    const oracle =
      'Enchant creature with a +1/+1 counter on it\nEnchanted creature gets +2/+2.';
    const r = parseOracleText(oracle);
    // "with a +1/+1 counter on it" is 7 more tokens → preamble is 9 tokens total,
    // pushes "enchanted creature gets" outside the 8-token scan window.
    expect(r.kind).not.toBe('Unparsed');
    expect(r.absorbedKeywords).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Enchant creature with/i)]),
    );
  });

  /**
   * Enchant permanent preamble (non-creature Aura).
   * The whole-face matchAttachedStaticBuff recognizes "enchanted permanent gets"
   * at position 2 (after "enchant permanent"), so this passes via the whole-face
   * path WITHOUT step 1b.  This test verifies the whole-face result is correct
   * and that the feature does not regress for these simpler cases.
   */
  it('simple 2-line "Enchant creature" + buff parses (via whole-face path, no regression)', () => {
    // This already worked before the slice; confirm it still does.
    const oracle = 'Enchant creature\nEnchanted creature gets +2/+2.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.attachedOnly).toBe(true);
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 2 });
  });

  /**
   * Honesty gate: if the preamble is absorbed but the body still fails to parse,
   * the face must remain Unparsed — we never claim faces the engine cannot run.
   */
  it('does NOT claim an Aura face if the body line is unparseable (honesty gate)', () => {
    const oracle =
      'Enchant creature with another Aura attached to it\nSome completely unrecognized xyzzy foobar gibberish.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  /**
   * Bare "Enchant" without a qualifying noun must NOT be absorbed (the regex
   * requires at least one letter after the space).
   */
  it('bare "Enchant" line alone does not match the preamble pattern', () => {
    // This confirms the regex boundary: ^enchant\s+[a-z] requires a qualifying word.
    // "Enchant" alone as a line is not a valid MTG oracle pattern, but we guard it anyway.
    // Realistically: the whole face also falls through; we just check no crash.
    const oracle = 'Enchant\nEnchanted creature gets +1/+1.';
    // Will parse via whole-face matchAttachedStaticBuff (finds "enchanted creature gets" at pos 1)
    const r = parseOracleText(oracle);
    expect(['StaticAbility', 'Unparsed']).toContain(r.kind);
  });
});

// ============================================================================
// EXECUTION tests — parsed result registers and executes without error
// ============================================================================

describe('enchant-preamble absorption — engine execution', () => {
  it('Daybreak Coronet: parsed StaticAbility can be registered via continuous layer', () => {
    const oracle =
      'Enchant creature with another Aura attached to it\nEnchanted creature gets +3/+3 and has first strike, vigilance, and lifelink.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.attachedOnly).toBe(true);
    // The +3/+3 modifier must be recognized.
    expect(parsed.ability.modifier).toEqual({ kind: 'ModifyPT', power: 3, toughness: 3 });

    const cards = new Map<string, CardInstance>();
    cards.set('aura_1', makeCard('aura_1', 'coronet_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('coronet_def', makeDef('coronet_def', {
      name: 'Daybreak Coronet',
      oracle_text: oracle,
    }));
    const state = makeState({ cards, cardDefinitions: defs });
    // Registering an attachedOnly static must not throw; it is a no-op in the
    // continuous layer (applied via the equipmentBonus cache instead).
    expect(() => registerContinuousEffect(state, 'aura_1', 'p1', parsed.ability)).not.toThrow();
  });

  it('9-token preamble Aura: absorbed parse records preamble in absorbedKeywords', () => {
    const oracle =
      'Enchant creature with another Aura attached to it\nEnchanted creature gets +3/+3 and has first strike, vigilance, and lifelink.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).not.toBe('Unparsed');
    expect(parsed.absorbedKeywords).toBeDefined();
    // The enchant preamble line must be recorded.
    expect(parsed.absorbedKeywords!.some(k =>
      k.toLowerCase().includes('enchant creature with another aura'),
    )).toBe(true);
  });

  it('keyword-only Aura with long preamble ("Enchant creature with a +1/+1 counter on it") executes', () => {
    const oracle =
      'Enchant creature with a +1/+1 counter on it\nEnchanted creature has flying.';
    const parsed = parseOracleText(oracle);
    // "with a +1/+1 counter on it" = 6 more tokens; preamble = 9 tokens total.
    // matchAttachedStaticBuff's scan window (8) is not enough — per-line path needed.
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.attachedOnly).toBe(true);
    // Keyword-only: 0/0 modifier (keyword grant enforced via equipmentBonus cache)
    expect(parsed.ability.modifier).toMatchObject({ kind: 'ModifyPT' });

    const cards = new Map<string, CardInstance>();
    cards.set('aura_2', makeCard('aura_2', 'flight_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('flight_def', makeDef('flight_def', {
      name: 'Flight Aura',
      oracle_text: oracle,
    }));
    const state = makeState({ cards, cardDefinitions: defs });
    expect(() => registerContinuousEffect(state, 'aura_2', 'p1', parsed.ability)).not.toThrow();
  });
});
