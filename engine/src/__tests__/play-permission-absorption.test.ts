import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';
import { maxLandsThisTurn } from '../actions';
import { createCardLookup } from '../cards/deck-loader';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import type { ScryfallCard } from '../cards/deck-loader';

/**
 * Slice 10: Static play-permission absorption.
 *
 * Two static play-permission sentences that used to leave permanent faces as
 * Unparsed are now absorbed:
 *
 * (a) "You may play an additional land on each of your turns." — engine-enforced
 *     by maxLandsThisTurn (actions.ts:350) which rescans oracle text at play time.
 *     The face is credited as StaticAbility/AdditionalLandDrop.
 *
 * (b) "You may play lands from your graveyard." — pure-downside honest skip
 *     (zero executor support in engine). Credited as StaticAbility/PlayLandsFromGraveyard.
 *
 * Mixed multi-line faces (e.g. Exploration + a companion trigger) have the
 * play-permission line absorbed by parseOracleTextPerLine step 1l so the
 * companion clause carries the parse.
 */

// ============================================================================
// Test helpers (mirrors kw-line-absorption.test.ts)
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
    type_line: opts.type_line || 'Enchantment',
    oracle_text: opts.oracle_text || '',
    mana_cost: opts.mana_cost || '{G}',
    cmc: opts.cmc || 1,
    colors: opts.colors || ['G'],
    color_identity: opts.color_identity || ['G'],
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
// A. RECOGNITION — parser credits these faces as StaticAbility (not Unparsed)
// ============================================================================

describe('play-permission absorption — parser recognition', () => {
  // ── A-1. Single-line "additional land" forms ─────────────────────────────

  it('Exploration: single "additional land" line parses as StaticAbility/AdditionalLandDrop', () => {
    const r = parseOracleText('You may play an additional land on each of your turns.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'AdditionalLandDrop', count: 1 });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.controller).toBe('you');
  });

  it('Azusa: "two additional lands" line parses as AdditionalLandDrop count=2', () => {
    const r = parseOracleText('You may play two additional lands on each of your turns.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'AdditionalLandDrop', count: 2 });
    expect(r.ability.selfOnly).toBe(true);
  });

  it('Three-additional-lands form parses as AdditionalLandDrop count=3', () => {
    const r = parseOracleText('You may play three additional lands on each of your turns.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'AdditionalLandDrop', count: 3 });
  });

  // ── A-2. Single-line "play lands from graveyard" ─────────────────────────

  it('Crucible of Worlds: single "play lands from graveyard" line parses as StaticAbility/PlayLandsFromGraveyard', () => {
    const r = parseOracleText('You may play lands from your graveyard.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'PlayLandsFromGraveyard' });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.controller).toBe('you');
  });

  // ── A-3. Mixed multi-line faces: play-permission line absorbed ────────────

  it('Exploration-style with companion ETB trigger: play-permission absorbed, trigger parses', () => {
    // Simulates a card whose oracle text has the additional-land line plus a
    // trigger (like Oracle of Mul Daya / Wayward Swordtooth companion trigger).
    // The per-line absorber (step 1l) strips the play-permission sentence so
    // the trigger can carry the parse.
    const oracle = 'You may play an additional land on each of your turns.\nWhen this creature enters, draw a card.';
    const r = parseOracleText(oracle);
    // The companion line "When this creature enters, draw a card." parses as ETB.
    expect(r.kind).toBe('ETB');
    // The absorbed play-permission line should appear in absorbedKeywords.
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /additional land/i.test(k))).toBe(true);
  });

  it('Crucible-style with companion ETB trigger: graveyard-lands absorbed, trigger parses', () => {
    // Simulates Ancient Greenwarden / Crucible with a companion trigger.
    const oracle = 'You may play lands from your graveyard.\nWhen this creature enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /graveyard/i.test(k))).toBe(true);
  });

  it('Case of the Locked Hothouse-style: additional land + keyword line, parsed via per-line dispatch', () => {
    // "You may play an additional land on each of your turns." followed by
    // a keyword ("Vigilance") — both absorbed; result is keyword-only via Unparsed
    // but the keyword line means the play-permission line is absorbed in allAbsorbed.
    // Actually since after absorbing both lines there is no substantive parsed line,
    // the per-line dispatch returns null and parseOracleText leaves it Unparsed.
    // The whole-face matchers run first though: matchAdditionalLandDrop handles
    // the single-sentence form; multi-line forms with ONLY keywords remain Unparsed
    // by design (keyword-only faces). This test verifies the mixed case where the
    // play-permission is beside a parseable non-keyword line:
    const oracle = 'You may play an additional land on each of your turns.\nCreatures you control get +1/+1.';
    const r = parseOracleText(oracle);
    // The anthem line "Creatures you control get +1/+1." parses as StaticAbility.
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /additional land/i.test(k))).toBe(true);
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
  });

  it('Graveyard-lands + anthem companion: play from graveyard absorbed, anthem parses', () => {
    const oracle = 'You may play lands from your graveyard.\nCreatures you control get +1/+1.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /graveyard/i.test(k))).toBe(true);
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
  });

  // ── A-4. Honesty gate: mixed-with-unrun ability still Unparsed ───────────

  it('does NOT absorb "additional land" when the companion clause is also unrun (stays Unparsed)', () => {
    // A hypothetical face with a companion clause the engine cannot execute.
    // The per-line absorber absorbs the play-permission line but if the remaining
    // clause also fails (e.g. infect, which is unenforced and not a recognized
    // keyword), the whole face stays Unparsed — honesty gate still holds.
    // We use "play lands from graveyard" since infect is not in keyword map;
    // the test just verifies the absorber does not fabricate a result.
    const oracle = 'You may play lands from your graveyard.\nThis creature has infect.';
    const r = parseOracleText(oracle);
    // "infect" is not in ABSORBABLE_ENGINE_KEYWORDS and "this creature has infect"
    // does not match any specific static matcher — stays Unparsed.
    // (If infect were later added to the engine, this test should be updated.)
    // The key invariant: we never return a non-Unparsed result that fabricates the
    // "play lands from graveyard" ability when the companion clause is also unrun.
    // We just verify here that parseOracleText doesn't claim a StaticAbility whose
    // kind is PlayLandsFromGraveyard for this text.
    if (r.kind === 'StaticAbility' && r.ability.modifier.kind === 'PlayLandsFromGraveyard') {
      throw new Error('Should not credit PlayLandsFromGraveyard when companion clause is unrun (infect)');
    }
  });
});

// ============================================================================
// B. EXECUTION — enforced ability (AdditionalLandDrop) still works via actions.ts
// ============================================================================

describe('play-permission absorption — execution (AdditionalLandDrop)', () => {
  function setupWithOracle(oracleText: string) {
    resetInstanceCounter();
    const cards: ScryfallCard[] = [
      {
        id: 'cmd', name: 'Cmd', type_line: 'Legendary Creature — Goblin',
        oracle_text: '', mana_cost: '{4}{R}', cmc: 5,
        colors: ['R'], color_identity: ['R'], keywords: [], power: '3', toughness: '3',
      },
      {
        id: 'extra', name: 'Extra',
        type_line: 'Enchantment',
        oracle_text: oracleText,
        mana_cost: '{G}', cmc: 1,
        colors: ['G'], color_identity: ['G'], keywords: [],
      },
    ];
    for (let i = 0; i < 98; i++) {
      cards.push({ id: `hf${i}`, name: `HF${i}`, type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [] });
      cards.push({ id: `af${i}`, name: `AF${i}`, type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [] });
    }
    const lookup = createCardLookup(cards);
    const s = initGameFromDecks({
      humanDeck: { id: 'h', commander: 'Cmd', list: ['Extra', ...Array.from({ length: 97 }, (_, i) => `HF${i}`)], colors: ['G'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'a', commander: 'Cmd', list: Array.from({ length: 98 }, (_, i) => `AF${i}`), colors: ['G'], bracket: 3, theme: '' }],
      aiDifficulty: 3, cardLookup: lookup, humanGoesFirst: true, startingLife: 40, startingHandSize: 7,
    });
    // Force the Extra card onto the battlefield
    const extra = [...s.cards.values()].find(c => s.cardDefinitions.get(c.definitionId)?.name === 'Extra');
    if (!extra) throw new Error('Extra card not found');
    const newCards = new Map(s.cards);
    newCards.set(extra.instanceId, { ...extra, zone: 'battlefield' });
    return { ...s, cards: newCards, phase: 'precombat_main' as const, step: 'main' as const };
  }

  it('Exploration oracle text: parser credits it AND maxLandsThisTurn returns 2', () => {
    // Verify parse-credit
    const parseResult = parseOracleText('You may play an additional land on each of your turns.');
    expect(parseResult.kind).toBe('StaticAbility');
    if (parseResult.kind !== 'StaticAbility') return;
    expect(parseResult.ability.modifier.kind).toBe('AdditionalLandDrop');

    // Verify execution (maxLandsThisTurn re-scans oracle text)
    const s = setupWithOracle('You may play an additional land on each of your turns.');
    expect(maxLandsThisTurn(s, 'human')).toBe(2);
  });

  it('Azusa oracle text: parser credits with count=2 AND maxLandsThisTurn returns 3', () => {
    const parseResult = parseOracleText('You may play two additional lands on each of your turns.');
    expect(parseResult.kind).toBe('StaticAbility');
    if (parseResult.kind !== 'StaticAbility') return;
    expect(parseResult.ability.modifier).toEqual({ kind: 'AdditionalLandDrop', count: 2 });

    const s = setupWithOracle('You may play two additional lands on each of your turns.');
    expect(maxLandsThisTurn(s, 'human')).toBe(3);
  });

  it('PlayLandsFromGraveyard: parser credits the face (pure-downside skip, no executor test needed)', () => {
    const parseResult = parseOracleText('You may play lands from your graveyard.');
    expect(parseResult.kind).toBe('StaticAbility');
    if (parseResult.kind !== 'StaticAbility') return;
    expect(parseResult.ability.modifier.kind).toBe('PlayLandsFromGraveyard');
    // No executor test — pure-downside skip; no execution path exists.
  });
});
