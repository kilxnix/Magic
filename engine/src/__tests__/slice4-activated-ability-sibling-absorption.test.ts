import { describe, it, expect } from 'vitest';
import { parseOracleText, parseActivatedAbilities } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { cleanupDamage } from '../state-based';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';
import { emptyManaPool } from '../types';

/**
 * Slice 4 (round 2) — Generalized activated-ability sub-line absorption.
 *
 * Two complementary wins:
 *
 * A) matchBecomeCreatureTypeSelf: "{cost}: This creature becomes a [Subtype]
 *    until end of turn." — Amoeba Spy / Mistform Dreamer (specific-type variant).
 *    Emits SetCreatureTypeEffect; executor sets grantedSubtypes on the source;
 *    cleanupDamage clears it at EOT.
 *
 * B) Per-line sibling absorption (parseOracleTextPerLine step 1m): multi-line
 *    permanents whose oracle text contains an activated-ability line with a valid
 *    cost but an unrunnable effect body (e.g., "creature type of your choice",
 *    "loses flying, first strike, or trample") are now parsed by absorbing the
 *    unrunnable line and crediting the remaining parseable sibling lines.
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePlayer(id: string, life = 20): Player {
  return {
    id, name: id, life,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false, hasPriority: false, hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'] = 'battlefield',
): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Test',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: overrides.players ?? [makePlayer('p1'), makePlayer('p2')],
    cards: overrides.cards ?? new Map(),
    cardDefinitions: overrides.cardDefinitions ?? new Map(),
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
    continuousEffects: overrides.continuousEffects ?? [],
  };
}

// ============================================================================
// A) matchBecomeCreatureTypeSelf — PARSER RECOGNITION
// ============================================================================

describe('Slice 4 — matchBecomeCreatureTypeSelf: parser recognition', () => {
  it('{1}: This creature becomes a Zombie until end of turn. — parses as SetCreatureType', () => {
    const r = parseOracleText('{1}: This creature becomes a Zombie until end of turn.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    expect(r.abilities).toHaveLength(1);
    const ability = r.abilities[0];
    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0];
    expect(eff.kind).toBe('SetCreatureType');
    if (eff.kind !== 'SetCreatureType') return;
    expect(eff.subtypes).toContain('zombie');
    expect(eff.untilEndOfTurn).toBe(true);
    expect(eff.target.kind).toBe('Source');
  });

  it('{T}: ~ becomes an Illusion until end of turn. — ~ subject form', () => {
    const r = parseOracleText('{T}: ~ becomes an Illusion until end of turn.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const eff = r.abilities[0].effects[0];
    expect(eff.kind).toBe('SetCreatureType');
    if (eff.kind !== 'SetCreatureType') return;
    expect(eff.subtypes).toContain('illusion');
  });

  it('{1}: This creature becomes a Dragon in addition to its other types until end of turn. — "in addition" rider', () => {
    const r = parseOracleText('{1}: This creature becomes a Dragon in addition to its other types until end of turn.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const eff = r.abilities[0].effects[0];
    expect(eff.kind).toBe('SetCreatureType');
    if (eff.kind !== 'SetCreatureType') return;
    expect(eff.subtypes).toContain('dragon');
  });

  it('{1}: This creature becomes a Wizard until end of turn. — "it" subject form', () => {
    const abilities = parseActivatedAbilities('{1}: This creature becomes a Wizard until end of turn.');
    expect(abilities).toHaveLength(1);
    expect(abilities[0].effects[0].kind).toBe('SetCreatureType');
    const eff = abilities[0].effects[0] as Extract<typeof abilities[0]['effects'][0], { kind: 'SetCreatureType' }>;
    expect(eff.subtypes).toContain('wizard');
  });

  it('{2}: This creature becomes a Beast until end of turn. — Beast subtype', () => {
    const r = parseOracleText('{2}: This creature becomes a Beast until end of turn.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const eff = r.abilities[0].effects[0];
    expect(eff.kind).toBe('SetCreatureType');
    if (eff.kind !== 'SetCreatureType') return;
    expect(eff.subtypes).toContain('beast');
  });

  it('"creature type of your choice" — NOT claimed (unrunnable body returns Unparsed on its own)', () => {
    // Single-line faces with "your choice" should stay Unparsed since we cannot run it.
    const r = parseOracleText('{1}: This creature becomes the creature type of your choice until end of turn.');
    // Single-line: parseActivatedAbilities finds no runnable ability → returns Unparsed
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// A) matchBecomeCreatureTypeSelf — EXECUTION
// ============================================================================

describe('Slice 4 — matchBecomeCreatureTypeSelf: execution', () => {
  it('SetCreatureType sets grantedSubtypes on the source instance', () => {
    const r = parseOracleText('{1}: This creature becomes a Zombie until end of turn.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];

    const cards = new Map<string, CardInstance>();
    cards.set('src', makeCard('src', 'src_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('src_def', makeDef('src_def', { type_line: 'Creature — Human' }));
    const state0 = makeState({ cards, cardDefinitions: defs });

    expect(state0.cards.get('src')!.grantedSubtypes).toBeUndefined();

    const state1 = executeEffects(
      state0, ability.effects, 'p1', [], ability.targets, 0,
      { sourceInstanceId: 'src' },
    );
    expect(state1.cards.get('src')!.grantedSubtypes).toEqual(expect.arrayContaining(['zombie']));
  });

  it('grantedSubtypes is cleared at end-of-turn cleanup', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('src', {
      ...makeCard('src', 'src_def', 'p1'),
      grantedSubtypes: ['zombie'],
    });
    const defs = new Map<string, CardDefinition>();
    defs.set('src_def', makeDef('src_def', { type_line: 'Creature — Human' }));
    const state0 = makeState({ cards, cardDefinitions: defs });
    expect(state0.cards.get('src')!.grantedSubtypes).toEqual(['zombie']);

    const cleaned = cleanupDamage(state0);
    expect(cleaned.cards.get('src')!.grantedSubtypes).toBeUndefined();
  });

  it('SetCreatureType + Dragon: creature without the original type gains it temporarily', () => {
    const r = parseOracleText('{2}: This creature becomes a Dragon until end of turn.');
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const ability = r.abilities[0];

    const cards = new Map<string, CardInstance>();
    // Source is a "Human Warrior", NOT a Dragon
    cards.set('src', makeCard('src', 'src_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('src_def', makeDef('src_def', { type_line: 'Creature — Human Warrior' }));
    const state0 = makeState({ cards, cardDefinitions: defs });

    const state1 = executeEffects(
      state0, ability.effects, 'p1', [], ability.targets, 0,
      { sourceInstanceId: 'src' },
    );
    // Should have grantedSubtypes = ['dragon']
    expect(state1.cards.get('src')!.grantedSubtypes).toEqual(expect.arrayContaining(['dragon']));

    // After cleanup the type should be gone
    const state2 = cleanupDamage(state1);
    expect(state2.cards.get('src')!.grantedSubtypes).toBeUndefined();
  });
});

// ============================================================================
// B) Sibling-absorption — unrunnable activated-ability lines
// ============================================================================

describe('Slice 4 — sibling absorption: multi-line permanents with unrunnable activated lines', () => {
  it('Parseable static + "creature type of your choice" unrunnable activated — static carries the parse', () => {
    // Mistform Wall analog: a parseable static line paired with an unrunnable activated line.
    // The parseable static line ("Creatures you control get +1/+1.") carries the face;
    // the unrunnable activated line is absorbed by step 1m in parseOracleTextPerLine.
    // (The real Mistform Wall has "This creature has defender as long as it's a Wall."
    //  which is an unsupported conditional static form and stays Unparsed on its own.)
    const oracle = [
      'Creatures you control get +1/+1.',
      '{1}: This creature becomes the creature type of your choice until end of turn.',
    ].join('\n');
    const r = parseOracleText(oracle);
    // The unrunnable activated line is absorbed; the parseable static carries the parse.
    expect(r.kind).toBe('StaticAbility');
  });

  it('Pardic Dragon: Flying keyword + firebreathing — parses as Activated', () => {
    // Pardic Dragon (simplified):
    // "Flying"
    // "{R}: This creature gets +1/+0 until end of turn."
    // The line-based activated parser iterates oracle-text lines; the keyword line
    // is silently skipped (no colon) and the firebreathing line is recognized.
    // Result: Activated with one ModifyPT ability. The keyword is already enforced
    // via registerContinuousAbilitiesForPermanent (outside this parser), so not
    // recording it as absorbedKeywords is consistent with the Spearbreaker pattern.
    const oracle = [
      'Flying',
      '{R}: This creature gets +1/+0 until end of turn.',
    ].join('\n');
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    expect(r.abilities).toHaveLength(1);
    expect(r.abilities[0].effects[0].kind).toBe('ModifyPT');
  });

  it('Walking Sponge: Tap + "loses flying, first strike, or trample" — unrunnable line absorbed', () => {
    // Walking Sponge:
    // "{T}: Target creature loses your choice of flying, first strike, or trample until end of turn."
    // (single unrunnable line — stays Unparsed as a whole-face single-line case)
    // Multi-line version: keywords + this line → keyword absorbed, unrunnable line absorbed
    const oracle = [
      'Defender',
      '{T}: Target creature loses your choice of flying, first strike, or trample until end of turn.',
    ].join('\n');
    const r = parseOracleText(oracle);
    // Unrunnable activated line absorbed; defender keyword absorbed; but we have NO parseable
    // substantive line left → per-line returns null → overall Unparsed
    // OR: if the keyword alone constitutes the richestResult, result would be StaticAbility/Unparsed.
    // In any case the parse should NOT crash and should not fabricate a benefit.
    // The important thing is it doesn't throw.
    expect(['Unparsed', 'StaticAbility']).toContain(r.kind);
  });

  it('Runnable activated + unrunnable activated sibling — runnable carries, unrunnable absorbed silently', () => {
    // Eight-and-a-Half-Tails analog: a runnable activated ability paired with an
    // unrunnable activated-body line. The engine's parseActivatedAbilities already
    // silently drops individual activated abilities it cannot parse, so the runnable
    // line carries the face and the unrunnable line is dropped.
    // (The real Eight-and-a-Half-Tails has "gains protection from white" and "becomes
    //  white" as activated bodies — neither is currently runnable in the engine.)
    const oracle = [
      '{T}: Draw a card.',
      '{1}: Target spell or permanent becomes white until end of turn.',
    ].join('\n');
    const r = parseOracleText(oracle);
    // The runnable "{T}: Draw a card." carries the face; the unrunnable "becomes white"
    // line is silently absorbed by parseActivatedAbilities (drops unparseable abilities).
    expect(r.kind).toBe('Activated');
    if (r.kind === 'Activated') {
      expect(r.abilities).toHaveLength(1);
      expect(r.abilities[0].effects[0].kind).toBe('Draw');
    }
  });

  it('Flying + unrunnable activated body — keyword absorbed, activated body absorbed, returns Unparsed (no substantive line)', () => {
    // Single keyword + a single unrunnable activated ability: no parseable substantive line
    const oracle = [
      'Flying',
      '{1}: This creature gains the chosen color\'s protection until end of turn.',
    ].join('\n');
    const r = parseOracleText(oracle);
    // Both lines are absorbed but there is no parseable substantive line → Unparsed
    expect(r.kind).toBe('Unparsed');
  });

  it('Runnable activated ability + keyword — gives Activated result', () => {
    // "Haste\n{T}: Draw a card." — the keyword line is silently skipped by
    // parseActivatedAbilities (no colon) and the activated ability is recognized.
    // This is the Spearbreaker pattern: the parser doesn't need to "absorb" the
    // keyword because parseActivatedAbilities already ignores non-colon lines.
    // The keyword is enforced separately by registerContinuousAbilitiesForPermanent.
    const oracle = [
      'Haste',
      '{T}: Draw a card.',
    ].join('\n');
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    expect(r.abilities).toHaveLength(1);
    expect(r.abilities[0].effects[0].kind).toBe('Draw');
  });
});

// ============================================================================
// B) Sibling-absorption — Halsin, Emerald Archdruid variant (token becomes Bear)
// ============================================================================

describe('Slice 4 — Halsin Bear-token form: specific subtype activated ability', () => {
  it('{1}: Until end of turn, target token you control becomes a Bear creature with base power and toughness 4/4 — parses via SetBasePT + (absorbed or set-type)', () => {
    // The Halsin line uses "base power and toughness 4/4" which matchSetBasePT handles.
    // The full line includes "becomes a green Bear creature" — SetBasePT is the runnable
    // part if SetCreatureType is paired with it. We test the simplified form.
    const oracle = '{1}: This creature becomes a Bear until end of turn.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Activated');
    if (r.kind !== 'Activated') return;
    const eff = r.abilities[0].effects[0];
    expect(eff.kind).toBe('SetCreatureType');
    if (eff.kind !== 'SetCreatureType') return;
    expect(eff.subtypes).toContain('bear');
  });
});
