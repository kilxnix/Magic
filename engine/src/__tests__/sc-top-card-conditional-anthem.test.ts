/**
 * Slice 4: top-card-conditional anthem (matchTopLibraryConditionalAnthem /
 * parseStaticCondition TopCardOfLibraryIs extension).
 *
 * Covers Vampire Nocturnus, Crown of Convergence, and Vampire Nocturnus Avatar
 * oracle-wording families.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import {
  evaluateCondition,
  getEffectivePower,
  getEffectiveToughness,
  getGrantedKeywords,
  registerContinuousEffect,
} from '../effects/continuous';
import { getKeywordsForInstance } from '../keywords';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition, GameState } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function creature(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Test',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{2}',
    cmc: opts.cmc ?? 2,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

/**
 * Build a minimal game state where:
 * - p1 has the source permanent on the battlefield.
 * - Optionally one or more other permanents on the battlefield.
 * - Optionally a card at the top of p1's library.
 * All continuous effects are registered for battlefield permanents.
 */
function setup(opts: {
  sourceOracle: string;
  sourceSubtypes?: string;
  sourceColors?: string[];
  sourceCardTypes?: string[];
  otherDefs?: CardDefinition[];
  topLibraryCard?: Partial<CardDefinition>;
}) {
  const sourceDef = creature('source', {
    name: 'Source Permanent',
    type_line: opts.sourceSubtypes
      ? `Creature — ${opts.sourceSubtypes}`
      : 'Creature',
    oracle_text: opts.sourceOracle,
    colors: (opts.sourceColors ?? []) as any,
    card_types: (opts.sourceCardTypes ?? ['creature']) as any,
  });

  const p1Defs = [sourceDef, ...(opts.otherDefs ?? [])];
  // Always provide p2 with a dummy card so initGameState is happy.
  const p2Defs = [creature('dummy_p2')];

  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];

  let state = initGameState(decks);

  // Move all p1 cards to battlefield (they start in library after initGameState).
  for (const [, card] of state.cards) {
    if (card.ownerId === 'p1') {
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });
    }
    if (card.ownerId === 'p2') {
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });
    }
  }

  // Optionally place a card at the top of p1's library.
  if (opts.topLibraryCard) {
    const topDef: CardDefinition = creature('top_lib', opts.topLibraryCard);
    const topInst = {
      instanceId: 'top_lib_inst',
      definitionId: 'top_lib',
      ownerId: 'p1',
      zone: 'library' as const,
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    };
    state.cardDefinitions.set('top_lib', topDef);
    // Insert at the FRONT of the Map so it is the first library card (top of library).
    const newCards = new Map<string, typeof topInst>();
    newCards.set('top_lib_inst', topInst);
    for (const [id, card] of state.cards) {
      newCards.set(id, card as any);
    }
    state = { ...state, cards: newCards as any };
  }

  // Register continuous abilities for all battlefield permanents.
  for (const [, card] of state.cards) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }

  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;

  return { state, idFor };
}

// ---------------------------------------------------------------------------
// SECTION 1: Parser-level recognition
// ---------------------------------------------------------------------------

describe('top-card-conditional anthem — parser recognition', () => {
  it('Vampire Nocturnus full oracle text parses as StaticAbility with TopCardOfLibraryIs condition', () => {
    const r = parseOracleText(
      'Play with the top card of your library revealed.\nAs long as the top card of your library is black, Vampires you control get +2/+1 and have flying.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ModifyPT');
    if (r.ability.modifier.kind !== 'ModifyPT') return;
    expect(r.ability.modifier.power).toBe(2);
    expect(r.ability.modifier.toughness).toBe(1);
    expect(r.ability.condition).toEqual({ kind: 'TopCardOfLibraryIs', colors: ['B'] });
    expect(r.ability.filter).toMatchObject({ subtypes: ['vampire'] });
    expect(r.ability.controller).toBe('you');
  });

  it('Crown of Convergence — creature-type anthem line alone (via matchConditionalStaticAbility)', () => {
    // The individual anthem line should also parse through the token-based path.
    const r = parseOracleText(
      'As long as the top card of your library is a creature card, creatures you control get +1/+1.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.condition).toEqual({ kind: 'TopCardOfLibraryIs', cardTypes: ['creature'] });
  });

  it('Vampire Nocturnus Avatar — "black creatures you control get +2/+1"', () => {
    const r = parseOracleText(
      'As long as the top card of your library is black, black creatures you control get +2/+1.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 1 });
    expect(r.ability.condition).toEqual({ kind: 'TopCardOfLibraryIs', colors: ['B'] });
    // filter must include both color (black) and type (creature)
    expect(r.ability.filter.colors).toContain('B');
    expect(r.ability.filter.types).toContain('creature');
  });

  it('Anthem with land-type condition parses', () => {
    const r = parseOracleText(
      'As long as the top card of your library is a land card, creatures you control get +1/+0.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'TopCardOfLibraryIs', cardTypes: ['land'] });
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 0 });
  });

  it('Anthem with red color condition parses', () => {
    const r = parseOracleText(
      'As long as the top card of your library is red, creatures you control get +1/+0.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'TopCardOfLibraryIs', colors: ['R'] });
  });

  it('Anthem with green color condition parses', () => {
    const r = parseOracleText(
      'As long as the top card of your library is green, creatures you control get +1/+1.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'TopCardOfLibraryIs', colors: ['G'] });
  });
});

// ---------------------------------------------------------------------------
// SECTION 2: Condition evaluation
// ---------------------------------------------------------------------------

describe('TopCardOfLibraryIs condition — evaluateCondition', () => {
  function makeState(topLibraryColors: string[], topLibraryTypes: string[]): GameState {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [creature('c1')], commanderId: 'none1' },
      { playerId: 'p2', name: 'Bob', cards: [creature('c2')], commanderId: 'none2' },
    ];
    let state = initGameState(decks);

    // Build a top-library card with the specified colors and types.
    const topDef: CardDefinition = {
      id: 'top_card',
      name: 'Top Card',
      type_line: 'Creature',
      oracle_text: '',
      mana_cost: '{1}',
      cmc: 1,
      colors: topLibraryColors as any,
      color_identity: topLibraryColors as any,
      keywords: [],
      card_types: topLibraryTypes as any,
      power: 1,
      toughness: 1,
    };
    state.cardDefinitions.set('top_card', topDef);

    const topInst = {
      instanceId: 'top_inst',
      definitionId: 'top_card',
      ownerId: 'p1',
      zone: 'library' as const,
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    };

    // Insert at front of the cards Map (top of library).
    const newCards = new Map<string, typeof topInst>();
    newCards.set('top_inst', topInst);
    for (const [id, card] of state.cards) {
      newCards.set(id, card as any);
    }
    return { ...state, cards: newCards as any };
  }

  it('returns true when top card is black and condition asks for black', () => {
    const state = makeState(['B'], ['creature']);
    const cond = { kind: 'TopCardOfLibraryIs' as const, colors: ['B' as const] };
    expect(evaluateCondition(state, cond, 'p1')).toBe(true);
  });

  it('returns false when top card is red and condition asks for black', () => {
    const state = makeState(['R'], ['creature']);
    const cond = { kind: 'TopCardOfLibraryIs' as const, colors: ['B' as const] };
    expect(evaluateCondition(state, cond, 'p1')).toBe(false);
  });

  it('returns true when top card is a creature and condition asks for creature card', () => {
    const state = makeState([], ['creature']);
    const cond = { kind: 'TopCardOfLibraryIs' as const, cardTypes: ['creature'] };
    expect(evaluateCondition(state, cond, 'p1')).toBe(true);
  });

  it('returns false when top card is a land and condition asks for creature card', () => {
    const state = makeState([], ['land']);
    const cond = { kind: 'TopCardOfLibraryIs' as const, cardTypes: ['creature'] };
    expect(evaluateCondition(state, cond, 'p1')).toBe(false);
  });

  it('returns false when library is empty (no top card)', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [creature('c1')], commanderId: 'none1' },
      { playerId: 'p2', name: 'Bob', cards: [creature('c2')], commanderId: 'none2' },
    ];
    let state = initGameState(decks);
    // Remove all library cards from p1.
    for (const [id, card] of state.cards) {
      if (card.ownerId === 'p1' && card.zone === 'library') {
        state.cards.set(id, { ...card, zone: 'graveyard' });
      }
    }
    const cond = { kind: 'TopCardOfLibraryIs' as const, colors: ['B' as const] };
    expect(evaluateCondition(state, cond, 'p1')).toBe(false);
  });

  it('condition only applies to the controller — p2 top library is unrelated', () => {
    const state = makeState(['B'], ['creature']); // p1's top is black
    const cond = { kind: 'TopCardOfLibraryIs' as const, colors: ['B' as const] };
    // Evaluating for p2 — p2's library is different (the inserted card belongs to p1)
    expect(evaluateCondition(state, cond, 'p2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SECTION 3: Execution — P/T buff gates on top card
// ---------------------------------------------------------------------------

describe('top-card-conditional anthem — execution (PT buff gated on top card)', () => {
  it('Vampire Nocturnus: Vampires get +2/+1 when top card is black', () => {
    const nocOracle = [
      'Play with the top card of your library revealed.',
      'As long as the top card of your library is black, Vampires you control get +2/+1 and have flying.',
    ].join('\n');

    const { state, idFor } = setup({
      sourceOracle: nocOracle,
      sourceSubtypes: 'Vampire',
      otherDefs: [
        creature('vampire1', {
          name: 'Bloodseeker',
          type_line: 'Creature — Vampire',
          card_types: ['creature'],
        }),
      ],
      topLibraryCard: {
        name: 'Black Card',
        colors: ['B'] as any,
        card_types: ['creature'] as any,
        type_line: 'Creature',
      },
    });

    const vamp1Id = idFor('vampire1');
    // Vampire should get +2/+1 from the Nocturnus effect (base 2/2 → 4/3).
    expect(getEffectivePower(state, vamp1Id)).toBe(4);
    expect(getEffectiveToughness(state, vamp1Id)).toBe(3);
  });

  it('Vampire Nocturnus: no buff when top card is NOT black', () => {
    const nocOracle = [
      'Play with the top card of your library revealed.',
      'As long as the top card of your library is black, Vampires you control get +2/+1 and have flying.',
    ].join('\n');

    const { state, idFor } = setup({
      sourceOracle: nocOracle,
      sourceSubtypes: 'Vampire',
      otherDefs: [
        creature('vampire1', {
          name: 'Bloodseeker',
          type_line: 'Creature — Vampire',
          card_types: ['creature'],
        }),
      ],
      topLibraryCard: {
        name: 'Green Card',
        colors: ['G'] as any,
        card_types: ['creature'] as any,
        type_line: 'Creature',
      },
    });

    const vamp1Id = idFor('vampire1');
    // No buff — condition false (top card is green, not black).
    expect(getEffectivePower(state, vamp1Id)).toBe(2);
    expect(getEffectiveToughness(state, vamp1Id)).toBe(2);
  });

  it('Vampire Nocturnus: no buff when library is empty', () => {
    const nocOracle = [
      'Play with the top card of your library revealed.',
      'As long as the top card of your library is black, Vampires you control get +2/+1 and have flying.',
    ].join('\n');

    const { state, idFor } = setup({
      sourceOracle: nocOracle,
      sourceSubtypes: 'Vampire',
      otherDefs: [
        creature('vampire1', {
          name: 'Bloodseeker',
          type_line: 'Creature — Vampire',
          card_types: ['creature'],
        }),
      ],
      // No topLibraryCard → empty library for p1
    });

    const vamp1Id = idFor('vampire1');
    expect(getEffectivePower(state, vamp1Id)).toBe(2);
    expect(getEffectiveToughness(state, vamp1Id)).toBe(2);
  });

  it('Crown of Convergence: creatures get +1/+1 when top card is a creature', () => {
    const crownOracle = [
      'Play with the top card of your library revealed.',
      '{T}: Put the top card of your library on the bottom of your library.',
      'As long as the top card of your library is a creature card, creatures you control get +1/+1.',
    ].join('\n');

    const { state, idFor } = setup({
      sourceOracle: crownOracle,
      sourceCardTypes: ['artifact'],
      sourceSubtypes: undefined,
      otherDefs: [
        creature('bear1', {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          card_types: ['creature'],
          power: 2,
          toughness: 2,
        }),
      ],
      topLibraryCard: {
        name: 'A Creature',
        colors: [],
        card_types: ['creature'] as any,
        type_line: 'Creature',
      },
    });

    const bear1Id = idFor('bear1');
    // bear should get +1/+1 (2/2 → 3/3)
    expect(getEffectivePower(state, bear1Id)).toBe(3);
    expect(getEffectiveToughness(state, bear1Id)).toBe(3);
  });

  it('Crown of Convergence: no buff when top card is a land', () => {
    const crownOracle = [
      'Play with the top card of your library revealed.',
      '{T}: Put the top card of your library on the bottom of your library.',
      'As long as the top card of your library is a creature card, creatures you control get +1/+1.',
    ].join('\n');

    const { state, idFor } = setup({
      sourceOracle: crownOracle,
      sourceCardTypes: ['artifact'],
      otherDefs: [
        creature('bear1', {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          card_types: ['creature'],
          power: 2,
          toughness: 2,
        }),
      ],
      topLibraryCard: {
        name: 'Forest',
        colors: [],
        card_types: ['land'] as any,
        type_line: 'Basic Land — Forest',
      },
    });

    const bear1Id = idFor('bear1');
    // No buff — top card is a land, not a creature.
    expect(getEffectivePower(state, bear1Id)).toBe(2);
    expect(getEffectiveToughness(state, bear1Id)).toBe(2);
  });

  it('Vampire Nocturnus Avatar: black creatures get +2/+1 when top card is black', () => {
    const avatarOracle =
      'As long as the top card of your library is black, black creatures you control get +2/+1.';

    const { state, idFor } = setup({
      sourceOracle: avatarOracle,
      sourceSubtypes: 'Vampire',
      otherDefs: [
        creature('blackvamp', {
          name: 'Black Vampire',
          type_line: 'Creature — Vampire',
          colors: ['B'] as any,
          card_types: ['creature'],
          power: 2,
          toughness: 2,
        }),
        creature('greencreature', {
          name: 'Green Elf',
          type_line: 'Creature — Elf',
          colors: ['G'] as any,
          card_types: ['creature'],
          power: 1,
          toughness: 1,
        }),
      ],
      topLibraryCard: {
        name: 'Black Card',
        colors: ['B'] as any,
        card_types: ['creature'] as any,
        type_line: 'Creature',
      },
    });

    const blackVampId = idFor('blackvamp');
    const greenElfId = idFor('greencreature');
    // Black creature gets +2/+1.
    expect(getEffectivePower(state, blackVampId)).toBe(4);
    expect(getEffectiveToughness(state, blackVampId)).toBe(3);
    // Green creature does NOT get the buff (wrong color).
    expect(getEffectivePower(state, greenElfId)).toBe(1);
    expect(getEffectiveToughness(state, greenElfId)).toBe(1);
  });
});
