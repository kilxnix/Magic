/**
 * Slice 6 — Activated ability: 'Target creature gains/loses <engine keyword> UEOT'
 *
 * Verifies that the existing matchGrantKeyword / matchTargetCreatureLosesKeyword
 * matchers (already in the parseEffectClause dispatch) correctly parse activated
 * abilities of the form "{cost}: Target creature gains/loses <keyword> until end
 * of turn." after shadow/fear/intimidate were added to GRANTABLE_KEYWORDS.
 *
 * Parser tests: real oracle wording for Dauthi Trapper (shadow), Errantry (fear),
 * and Canopy Claws (loses flying) — and activated-ability form wrapping each.
 *
 * Executor tests: GrantKeyword adds to grantedKeywords; shadow enforcement
 * through canBlock confirms the grant is meaningful.
 *
 * Negative / honesty tests: protection-from-color declined (not in GRANTABLE_KEYWORDS,
 * not stored in grantedKeywords checked by protection system), forestwalk declined.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText, parseActivatedAbilities } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { canBlock } from '../keywords';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Minimal test state helpers
// ---------------------------------------------------------------------------

function makeDef(
  over: Partial<CardDefinition> & { id: string; name: string; keywords?: string[] },
): CardDefinition {
  return {
    type_line: 'Creature — Test',
    oracle_text: '',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
    keywords: [],
    ...over,
  };
}

function makeState(
  creatures: Array<{ id: string; name: string; keywords?: string[]; ownerId?: string }>,
): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  for (const c of creatures) {
    const def = makeDef({ id: c.id, name: c.name, keywords: c.keywords ?? [] });
    cardDefinitions.set(c.id, def);
    cards.set(c.id, {
      instanceId: c.id,
      definitionId: c.id,
      ownerId: c.ownerId ?? 'p1',
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
  }

  return {
    players: [
      {
        id: 'p1',
        name: 'Player 1',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'p2',
        name: 'Player 2',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ---------------------------------------------------------------------------
// Parser tests — spell form (the effect clause matchers are shared)
// ---------------------------------------------------------------------------

describe('Slice 6 – target creature gains shadow/fear/intimidate UEOT (spell form)', () => {
  it('parses Dauthi Trapper effect: "Target creature gains shadow until end of turn."', () => {
    const result = parseOracleText('Target creature gains shadow until end of turn.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]).toMatchObject({
      kind: 'GrantKeyword',
      keyword: 'Shadow',
      untilEndOfTurn: true,
    });
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Creature');
  });

  it('parses fear grant: "Target creature gains fear until end of turn."', () => {
    const result = parseOracleText('Target creature gains fear until end of turn.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects[0]).toMatchObject({
      kind: 'GrantKeyword',
      keyword: 'Fear',
      untilEndOfTurn: true,
    });
  });

  it('parses intimidate grant: "Target creature gains intimidate until end of turn."', () => {
    const result = parseOracleText('Target creature gains intimidate until end of turn.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects[0]).toMatchObject({
      kind: 'GrantKeyword',
      keyword: 'Intimidate',
      untilEndOfTurn: true,
    });
  });

  it('parses loses-flying spell (Canopy Claws): "Target creature loses flying until end of turn."', () => {
    const result = parseOracleText('Target creature loses flying until end of turn.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects[0]).toMatchObject({
      kind: 'LoseKeyword',
      keyword: 'Flying',
      untilEndOfTurn: true,
    });
    expect(result.targets).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Parser tests — activated-ability form
// ---------------------------------------------------------------------------

describe('Slice 6 – activated ability form "{cost}: Target creature gains/loses <keyword> until end of turn"', () => {
  it('parses Dauthi Trapper activated: "{T}: Target creature gains shadow until end of turn."', () => {
    const result = parseOracleText('{T}: Target creature gains shadow until end of turn.');
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    expect(result.abilities).toHaveLength(1);
    const ab = result.abilities[0];
    expect(ab.cost.tap).toBe(true);
    expect(ab.effects).toHaveLength(1);
    expect(ab.effects[0]).toMatchObject({
      kind: 'GrantKeyword',
      keyword: 'Shadow',
      untilEndOfTurn: true,
    });
    expect(ab.targets).toHaveLength(1);
    expect(ab.targets[0].type).toBe('Creature');
  });

  it('parses fear activated: "{1}{B}: Target creature gains fear until end of turn."', () => {
    const result = parseOracleText('{1}{b}: Target creature gains fear until end of turn.');
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    const ab = result.abilities[0];
    expect(ab.effects[0]).toMatchObject({
      kind: 'GrantKeyword',
      keyword: 'Fear',
      untilEndOfTurn: true,
    });
  });

  it('parses loses-keyword activated: "{T}: Target creature loses flying until end of turn."', () => {
    const result = parseOracleText('{T}: Target creature loses flying until end of turn.');
    expect(result.kind).toBe('Activated');
    if (result.kind !== 'Activated') return;
    const ab = result.abilities[0];
    expect(ab.cost.tap).toBe(true);
    expect(ab.effects[0]).toMatchObject({
      kind: 'LoseKeyword',
      keyword: 'Flying',
      untilEndOfTurn: true,
    });
  });

  it('parses Crimson Acolyte activation via parseActivatedAbilities (keyword-line + activated body)', () => {
    // Crimson Acolyte: "Protection from red\n{W}: Target creature gains protection from red until end of turn."
    // Slice 11: matchGrantProtection now parses "Target creature gains protection from <color>
    // until end of turn" as a GrantKeyword effect that stores "protection from red" in
    // grantedKeywords. keywords.ts protectionClausesFor was extended (Slice 11) to harvest
    // those grantedKeywords entries so the grant is genuinely enforced — isProtectedFromSource,
    // getProtectionColors, and canBlock all see the transient protection. This is now HONEST.
    const abilities = parseActivatedAbilities(
      'Protection from red\n{w}: Target creature gains protection from red until end of turn.',
    );
    // The activated ability body now parses; a GrantKeyword with keyword "protection from red"
    // must be present in the parsed abilities.
    const protectionGrant = abilities.flatMap(ab => ab.effects)
      .find(e => e.kind === 'GrantKeyword' && (e as any).keyword?.toLowerCase().startsWith('protection'));
    expect(protectionGrant).toBeDefined();
    expect((protectionGrant as any).keyword).toBe('protection from red');
  });

  it('declines forestwalk grant (not in GRANTABLE_KEYWORDS — no canBlock enforcement path)', () => {
    // Weatherseed Elf: "{T}: Target creature gains forestwalk until end of turn."
    // Forestwalk IS enforced via hasActiveLandwalk but that checks def.keywords / grantedKeywords.
    // However forestwalk is NOT in GRANTABLE_KEYWORDS (it was never added to the grantable set),
    // so this ability declines to parse — the result is Unparsed or Activated-with-no-body.
    const result = parseOracleText('{T}: Target creature gains forestwalk until end of turn.');
    if (result.kind === 'Activated') {
      // The ability list may be empty if the body couldn't be parsed
      expect(result.abilities.length).toBe(0);
    } else {
      expect(result.kind).toBe('Unparsed');
    }
  });
});

// ---------------------------------------------------------------------------
// Executor tests — GrantKeyword (shadow) adds to grantedKeywords + canBlock enforces
// ---------------------------------------------------------------------------

describe('Slice 6 – executor: GrantKeyword shadow enforced by canBlock', () => {
  it('granting shadow to a creature makes it un-blockable by non-shadow creatures', () => {
    // att: shadow attacker (Shadow in keywords)
    // target: no shadow, will receive shadow via GrantKeyword
    // blocker: also no shadow
    const state = makeState([
      { id: 'att', name: 'Attacker', keywords: ['Shadow'], ownerId: 'p1' },
      { id: 'target', name: 'Target', keywords: [], ownerId: 'p1' },
      { id: 'blocker', name: 'Blocker', keywords: [], ownerId: 'p2' },
    ]);

    // Parse the activated effect body
    const parsed = parseOracleText('Target creature gains shadow until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // Execute: grant shadow to 'target'
    const newState = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['target'],
      parsed.targets.map(t => ({ id: t.id })),
    );

    // 'target' now has Shadow in grantedKeywords
    const targetCard = newState.cards.get('target')!;
    expect(targetCard.grantedKeywords).toContain('Shadow');

    // Shadow enforcement: 'blocker' (no shadow) cannot block 'target' (now shadow)
    // — because of the shadow symmetry rule, a non-shadow creature cannot block shadow.
    expect(canBlock(newState, 'blocker', 'target')).toBe(false);
  });

  it('granting shadow to a non-shadow creature lets it block shadow attackers', () => {
    const state = makeState([
      { id: 'att', name: 'Attacker', keywords: ['Shadow'], ownerId: 'p1' },
      { id: 'target', name: 'Target', keywords: [], ownerId: 'p2' },
    ]);

    const parsed = parseOracleText('Target creature gains shadow until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const newState = executeEffects(
      state,
      parsed.effects,
      'p2',
      ['target'],
      parsed.targets.map(t => ({ id: t.id })),
    );

    // After gaining shadow, target (now shadow) can block the shadow attacker
    expect(canBlock(newState, 'target', 'att')).toBe(true);
  });

  it('loses-keyword executor: LoseKeyword removes flying from grantedKeywords / lostKeywords path', () => {
    const state = makeState([
      { id: 'flier', name: 'Flier', keywords: ['Flying'], ownerId: 'p1' },
    ]);

    const parsed = parseOracleText('Target creature loses flying until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const newState = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['flier'],
      parsed.targets.map(t => ({ id: t.id })),
    );

    const flierCard = newState.cards.get('flier')!;
    expect(flierCard.lostKeywords).toContain('Flying');
  });
});
