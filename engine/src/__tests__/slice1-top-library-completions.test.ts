/**
 * Slice 1 — Own-library "look/reveal the top N" completions.
 *
 * New matchers added to search-dig.ts:
 *   matchLookAtTopDynamicCountReorderBack — "look at top X where X is <ForEach|TargetPower>, put them back"
 *   matchRevealTopUpToMFilter             — "you may reveal up to M <filter> cards from among them and put them into your hand"
 *   matchLookAtTopPutNToGraveyard         — "put N of them into your graveyard. put the rest on top."
 *   matchLookAtTopOneOnTopRestBottom      — "put one of them on top, rest on the bottom" (Gutless Plunderer)
 *
 * Small additive executor changes:
 *   - ChooseFromTopOfLibraryEffect.destination now accepts 'top' (ast.ts + executor.ts)
 *   - ChooseFromTopOfLibrary executor case passes sourceInstanceId to resolveAmount
 *     so TargetPower{Source} counts resolve correctly.
 *
 * Real oracle wordings tested:
 *   Descendant of Soramaro — "Look at the top X cards of your library, where X is the number of
 *                             cards in your hand. Put them back in any order."
 *   For the Ancestors      — "Look at the top five cards of your library. You may reveal up to two
 *                             creature cards from among them and put them into your hand. Put the
 *                             rest on the bottom of your library in any order."
 *   Celestus Sanctifier    — "Look at the top four cards of your library. You may put one of them
 *                             into your graveyard. Put the rest on top of your library in any order."
 *   Gutless Plunderer      — "Look at the top three cards of your library. Put one of them back on
 *                             top of your library and the rest on the bottom of your library in any order."
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { ChooseFromTopOfLibraryEffect } from '../effects/ast';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeDef(
  id: string,
  overrides: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: overrides.name ?? id,
    type_line: overrides.type_line ?? 'Creature',
    oracle_text: overrides.oracle_text ?? '',
    mana_cost: overrides.mana_cost ?? '{2}{G}',
    cmc: overrides.cmc ?? 2,
    colors: overrides.colors ?? ['G'],
    color_identity: overrides.color_identity ?? ['G'],
    keywords: overrides.keywords ?? [],
    card_types: overrides.card_types ?? ['creature'],
    power: overrides.power ?? 2,
    toughness: overrides.toughness ?? 2,
  } as CardDefinition;
}

function makeCard(
  instanceId: string,
  ownerId: string,
  definitionId: string,
  zone: CardInstance['zone'] = 'battlefield',
  overrides: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    ...overrides,
  } as CardInstance;
}

function makeState(defs: CardDefinition[], cards: CardInstance[]): GameState {
  return {
    players: [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(defs.map(d => [d.id, d])),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'main',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: [],
  };
}

function ctflEffect(oracle: string): ChooseFromTopOfLibraryEffect {
  const parsed = parseOracleText(oracle);
  if (parsed.kind !== 'Spell' && parsed.kind !== 'ETB' && parsed.kind !== 'Triggered') {
    throw new Error(`Unexpected parse kind: ${parsed.kind}`);
  }
  const effects = parsed.kind === 'Spell' ? parsed.effects : parsed.ability.effects;
  const e = effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary');
  if (!e) throw new Error(`No ChooseFromTopOfLibrary in: ${oracle}`);
  return e as ChooseFromTopOfLibraryEffect;
}

// ── 1. matchLookAtTopDynamicCountReorderBack ───────────────────────────────────

describe('matchLookAtTopDynamicCountReorderBack', () => {
  it('Descendant of Soramaro — where X is the number of cards in your hand', () => {
    const oracle = 'Look at the top X cards of your library, where X is the number of cards in your hand. Put them back in any order.';
    const e = ctflEffect(oracle);
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    expect(e.maxSelections).toBe(0);
    expect(e.restDestination).toBe('top');
    expect(typeof e.count).toBe('object');
    const cnt = e.count as { kind: string; zone?: string; controller?: string };
    expect(cnt.kind).toBe('ForEach');
    expect(cnt.zone).toBe('hand');
    expect(cnt.controller).toBe('you');
  });

  it('creature-power variant — where X is its power', () => {
    const oracle = 'Look at the top X cards of your library, where X is its power. Put them back in any order.';
    const e = ctflEffect(oracle);
    expect(e.maxSelections).toBe(0);
    expect(e.restDestination).toBe('top');
    const cnt = e.count as { kind: string; target?: { kind: string } };
    expect(cnt.kind).toBe('TargetPower');
    expect(cnt.target?.kind).toBe('Source');
  });

  it("this creature's power variant", () => {
    const oracle = "Look at the top X cards of your library, where X is this creature's power. Put them back in any order.";
    const e = ctflEffect(oracle);
    expect(e.maxSelections).toBe(0);
    expect(e.restDestination).toBe('top');
    const cnt = e.count as { kind: string; target?: { kind: string } };
    expect(cnt.kind).toBe('TargetPower');
    expect(cnt.target?.kind).toBe('Source');
  });

  it('execution: hand-count dynamic reorder — all library cards stay in library', () => {
    // 2 cards in hand, 3 in library → look at top 2, put them back
    const defs = [
      makeDef('land1', { card_types: ['land'], type_line: 'Land', mana_cost: '' }),
      makeDef('crea1', { card_types: ['creature'], type_line: 'Creature' }),
      makeDef('crea2', { card_types: ['creature'], type_line: 'Creature' }),
      makeDef('hand1', { card_types: ['instant'], type_line: 'Instant' }),
      makeDef('hand2', { card_types: ['sorcery'], type_line: 'Sorcery' }),
    ];
    const libraryCards = [
      makeCard('lib-l1', 'p1', 'land1', 'library'),
      makeCard('lib-c1', 'p1', 'crea1', 'library'),
      makeCard('lib-c2', 'p1', 'crea2', 'library'),
    ];
    const handCards = [
      makeCard('hand-h1', 'p1', 'hand1', 'hand'),
      makeCard('hand-h2', 'p1', 'hand2', 'hand'),
    ];
    const state = makeState(defs, [...libraryCards, ...handCards]);

    const parsed = parseOracleText(
      'Look at the top X cards of your library, where X is the number of cards in your hand. Put them back in any order.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const newState = executeEffects(state, parsed.effects, 'p1', [], [], 0);
    // All 3 library cards should still be in library (top 2 revealed and put back)
    const libCards = [...newState.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'library');
    expect(libCards).toHaveLength(3);
    // Hand cards remain in hand
    const hcards = [...newState.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'hand');
    expect(hcards).toHaveLength(2);
  });
});

// ── 2. matchRevealTopUpToMFilter ───────────────────────────────────────────────

describe('matchRevealTopUpToMFilter', () => {
  it('For the Ancestors — up to two creature cards, rest on bottom', () => {
    const oracle =
      'Look at the top five cards of your library. You may reveal up to two creature cards from among them and put them into your hand. Put the rest on the bottom of your library in any order.';
    const e = ctflEffect(oracle);
    expect(e.count).toBe(5);
    expect(e.maxSelections).toBe(2);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.filter?.types).toContain('creature');
  });

  it('Nessian Wanderer variant — up to two land cards, rest on bottom (random order)', () => {
    const oracle =
      'Look at the top five cards of your library. You may reveal up to two land cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order.';
    const e = ctflEffect(oracle);
    expect(e.maxSelections).toBe(2);
    expect(e.filter?.types).toContain('land');
    expect(e.restDestination).toBe('bottom');
  });

  it('up to two artifact cards, rest into graveyard', () => {
    const oracle =
      'Look at the top four cards of your library. You may reveal up to two artifact cards from among them and put them into your hand. Put the rest into your graveyard.';
    const e = ctflEffect(oracle);
    expect(e.maxSelections).toBe(2);
    expect(e.filter?.types).toContain('artifact');
    expect(e.restDestination).toBe('graveyard');
  });

  it('up to one enchantment card — maxSelections=1', () => {
    const oracle =
      'Look at the top three cards of your library. You may reveal up to one enchantment card from among them and put it into your hand. Put the rest on the bottom of your library in any order.';
    const e = ctflEffect(oracle);
    expect(e.maxSelections).toBe(1);
    expect(e.filter?.types).toContain('enchantment');
  });

  it('execution: auto-selects up to 2 matching creature cards into hand, rest on bottom', () => {
    const defs = [
      makeDef('crea1', { card_types: ['creature'], type_line: 'Creature' }),
      makeDef('crea2', { card_types: ['creature'], type_line: 'Creature' }),
      makeDef('land1', { card_types: ['land'], type_line: 'Land', mana_cost: '' }),
      makeDef('land2', { card_types: ['land'], type_line: 'Land', mana_cost: '' }),
      makeDef('land3', { card_types: ['land'], type_line: 'Land', mana_cost: '' }),
    ];
    // library order: crea1, crea2, land1, land2, land3
    const libCards = [
      makeCard('c1', 'p1', 'crea1', 'library'),
      makeCard('c2', 'p1', 'crea2', 'library'),
      makeCard('l1', 'p1', 'land1', 'library'),
      makeCard('l2', 'p1', 'land2', 'library'),
      makeCard('l3', 'p1', 'land3', 'library'),
    ];
    const state = makeState(defs, libCards);

    const parsed = parseOracleText(
      'Look at the top five cards of your library. You may reveal up to two creature cards from among them and put them into your hand. Put the rest on the bottom of your library in any order.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const newState = executeEffects(state, parsed.effects, 'p1', [], [], 0);
    const handCards = [...newState.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'hand');
    const libAfter = [...newState.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'library');

    // Auto-selects up to 2 matching (creature) cards
    expect(handCards).toHaveLength(2);
    expect(handCards.map(c => c.definitionId).sort()).toEqual(['crea1', 'crea2'].sort());
    // Rest (3 lands) on the bottom of the library
    expect(libAfter).toHaveLength(3);
  });
});

// ── 3. matchLookAtTopPutNToGraveyard ──────────────────────────────────────────

describe('matchLookAtTopPutNToGraveyard', () => {
  it('Celestus Sanctifier — put one into graveyard, rest on top', () => {
    const oracle =
      'Look at the top four cards of your library. You may put one of them into your graveyard. Put the rest on top of your library in any order.';
    const e = ctflEffect(oracle);
    expect(e.count).toBe(4);
    expect(e.destination).toBe('graveyard');
    expect(e.restDestination).toBe('top');
    expect(e.maxSelections).toBe(1);
  });

  it('put two of them into your graveyard, rest on top', () => {
    const oracle =
      'Look at the top five cards of your library. You may put two of them into your graveyard. Put the rest on top of your library in any order.';
    const e = ctflEffect(oracle);
    expect(e.destination).toBe('graveyard');
    expect(e.maxSelections).toBe(2);
    expect(e.restDestination).toBe('top');
  });

  it('execution: selected card goes to graveyard; rest stay on top of library', () => {
    const defs = [
      makeDef('crea1'), makeDef('crea2'), makeDef('crea3'), makeDef('crea4'),
    ];
    const libCards = [
      makeCard('c1', 'p1', 'crea1', 'library'),
      makeCard('c2', 'p1', 'crea2', 'library'),
      makeCard('c3', 'p1', 'crea3', 'library'),
      makeCard('c4', 'p1', 'crea4', 'library'),
    ];
    const state = makeState(defs, libCards);

    const parsed = parseOracleText(
      'Look at the top four cards of your library. You may put one of them into your graveyard. Put the rest on top of your library in any order.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // Submit c1 as the card to put into graveyard
    const newState = executeEffects(state, parsed.effects, 'p1', [], [], 0, {
      namedCardChoices: { lookTopPutNGraveyardIds: 'c1' },
    });

    const gravCards = [...newState.cards.values()].filter(c => c.zone === 'graveyard');
    const libAfter = [...newState.cards.values()].filter(c => c.zone === 'library');

    expect(gravCards).toHaveLength(1);
    expect(gravCards[0].instanceId).toBe('c1');
    expect(libAfter).toHaveLength(3);
  });
});

// ── 4. matchLookAtTopOneOnTopRestBottom ───────────────────────────────────────

describe('matchLookAtTopOneOnTopRestBottom', () => {
  it('Gutless Plunderer — put one back on top, rest on bottom', () => {
    const oracle =
      'Look at the top three cards of your library. Put one of them back on top of your library and the rest on the bottom of your library in any order.';
    const e = ctflEffect(oracle);
    expect(e.count).toBe(3);
    expect(e.destination).toBe('top');
    expect(e.restDestination).toBe('bottom');
    expect(e.maxSelections).toBe(1);
  });

  it('execution: selected card goes to top, rest on bottom', () => {
    const defs = [makeDef('a1'), makeDef('a2'), makeDef('a3')];
    const libCards = [
      makeCard('c1', 'p1', 'a1', 'library'),
      makeCard('c2', 'p1', 'a2', 'library'),
      makeCard('c3', 'p1', 'a3', 'library'),
    ];
    const state = makeState(defs, libCards);

    const parsed = parseOracleText(
      'Look at the top three cards of your library. Put one of them back on top of your library and the rest on the bottom of your library in any order.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // Select c2 to go on top
    const newState = executeEffects(state, parsed.effects, 'p1', [], [], 0, {
      namedCardChoices: { lookTopOneOnTopIds: 'c2' },
    });

    const libAfter = [...newState.cards.values()].filter(c => c.zone === 'library');
    expect(libAfter).toHaveLength(3);

    // c2 should be first (top of library = first in iteration order)
    const libIds = libAfter.map(c => c.instanceId);
    expect(libIds[0]).toBe('c2');
    // c1 and c3 should be at the bottom (after c2)
    expect(libIds.slice(1).sort()).toEqual(['c1', 'c3'].sort());
  });

  it('execution: fallback (no selection) — first card stays on top, rest go to bottom', () => {
    const defs = [makeDef('a1'), makeDef('a2'), makeDef('a3')];
    const libCards = [
      makeCard('c1', 'p1', 'a1', 'library'),
      makeCard('c2', 'p1', 'a2', 'library'),
      makeCard('c3', 'p1', 'a3', 'library'),
    ];
    const state = makeState(defs, libCards);

    const parsed = parseOracleText(
      'Look at the top three cards of your library. Put one of them back on top of your library and the rest on the bottom of your library in any order.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // No explicit choice — fallbackSelectionCount=1 picks first card
    const newState = executeEffects(state, parsed.effects, 'p1', [], [], 0);

    const libAfter = [...newState.cards.values()].filter(c => c.zone === 'library');
    expect(libAfter).toHaveLength(3);
    // c1 (first revealed) should be on top
    expect(libAfter[0].instanceId).toBe('c1');
  });
});
