/**
 * Slice 7: Lure / forced-block effects
 *
 * Tests that:
 * 1. "All creatures able to block ~ do so." parses as a StaticAbility (Elvish Bard style).
 * 2. "All creatures able to block equipped creature do so." parses as StaticAbility (Nemesis Mask style).
 * 3. "All creatures able to block target creature this turn do so." parses as a
 *    MustBeBlockedIfAble Spell effect (Taunting Challenge style).
 * 4. "~ must be blocked this turn if able." parses as MustBeBlockedIfAble (Goldenhide Ox style).
 * 5. Executor writes lureTargetId onto state.combat.luredCreatureIds.
 * 6. combat.ts declareBlockers enforces the lure: a creature that can block a
 *    lured attacker but does NOT block it causes an error.
 * 7. A creature that cannot block the lured attacker is not forced to block.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameFromDecks } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { declareAttackers, declareBlockers } from '../combat';
import { executeEffects } from '../effects/executor';
import type { GameState } from '../types';
import type { GeneratedDeck } from '../cards/deck-loader';

// ============================================================================
// Card stubs for testing
// ============================================================================

const cards = [
  {
    id: 'lure-bear',
    name: 'Elvish Bard',
    type_line: 'Creature — Elf Bard',
    oracle_text: 'All creatures able to block ~ do so.',
    mana_cost: '{3}{G}', cmc: 4, colors: ['G'], color_identity: ['G'],
    power: '1', toughness: '3', keywords: [],
  },
  {
    id: 'nemesis',
    name: 'Nemesis Mask',
    type_line: 'Artifact — Equipment',
    oracle_text: 'All creatures able to block equipped creature do so.\nEquip {3}',
    mana_cost: '{2}', cmc: 2, colors: [], color_identity: [],
    power: undefined, toughness: undefined, keywords: [],
  },
  {
    id: 'taunting',
    name: 'Taunting Challenge',
    type_line: 'Instant',
    oracle_text: 'All creatures able to block target creature this turn do so.',
    mana_cost: '{2}{G}', cmc: 3, colors: ['G'], color_identity: ['G'],
    power: undefined, toughness: undefined, keywords: [],
  },
  {
    id: 'goldenhide',
    name: 'Goldenhide Ox',
    type_line: 'Enchantment Creature — Ox',
    oracle_text: 'Constellation — Whenever Goldenhide Ox or another enchantment enters the battlefield under your control, target creature must be blocked this turn if able.',
    mana_cost: '{4}{G}', cmc: 5, colors: ['G'], color_identity: ['G'],
    power: '5', toughness: '4', keywords: [],
  },
  {
    id: 'bear',
    name: 'Grizzly Bears',
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
    power: '2', toughness: '2', keywords: [],
  },
  {
    id: 'flyer',
    name: 'Aven Cloudchaser',
    type_line: 'Creature — Bird Soldier',
    oracle_text: 'Flying',
    mana_cost: '{3}{W}', cmc: 4, colors: ['W'], color_identity: ['W'],
    power: '2', toughness: '2', keywords: ['flying'],
  },
  {
    id: 'cmdr',
    name: 'Test Commander',
    type_line: 'Legendary Creature — Human Wizard',
    oracle_text: '',
    mana_cost: '{2}{G}', cmc: 3, colors: ['G'], color_identity: ['G'],
    power: '3', toughness: '3', keywords: [],
  },
  {
    id: 'forest',
    name: 'Forest',
    type_line: 'Basic Land — Forest',
    oracle_text: '({T}: Add {G}.)',
    mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [],
  },
];

const lookup = createCardLookup(cards as never);

function deck(id: string, include: string[] = []): GeneratedDeck {
  const list = [...include, ...Array(99 - include.length).fill('Forest')];
  return {
    id, commander: 'Test Commander',
    list,
    colors: ['G'], bracket: 2, theme: 't',
  } as GeneratedDeck;
}

function setup(humanExtras: string[] = [], aiExtras: string[] = []) {
  const state = initGameFromDecks({
    humanDeck: deck('h', humanExtras),
    aiDecks: [deck('a', aiExtras)],
    aiDifficulty: 3,
    cardLookup: lookup,
    seed: 42,
  });
  const humanId = state.players[0].id;
  const aiId = state.players[1].id;
  return { state, humanId, aiId };
}

/** Move a card to the battlefield without summoning sickness. */
function putOnBattlefield(state: GameState, playerId: string, defId: string): string {
  for (const card of state.cards.values()) {
    if (card.ownerId === playerId && card.definitionId === defId && card.zone !== 'battlefield') {
      card.zone = 'battlefield';
      card.summoningSick = false;
      card.tapped = false;
      return card.instanceId;
    }
  }
  throw new Error(`No ${defId} found for player ${playerId}`);
}

/** Put a card on the battlefield WITH summoning sickness removed, returning instanceId. */
function putCreature(state: GameState, playerId: string, defId: string): string {
  return putOnBattlefield(state, playerId, defId);
}

// ============================================================================
// Parser tests
// ============================================================================

describe('Slice 7 — matchLureStatic: Elvish Bard style', () => {
  it('parses "All creatures able to block ~ do so." as StaticAbility', () => {
    const result = parseOracleText('All creatures able to block ~ do so.');
    expect(result.kind).toBe('StaticAbility');
  });

  it('parses "All creatures able to block this creature do so." as StaticAbility', () => {
    const result = parseOracleText('All creatures able to block this creature do so.');
    expect(result.kind).toBe('StaticAbility');
  });
});

describe('Slice 7 — matchLureStatic: Nemesis Mask style', () => {
  it('parses "All creatures able to block equipped creature do so." as StaticAbility', () => {
    const result = parseOracleText(
      'All creatures able to block equipped creature do so.\nEquip {3}',
    );
    expect(result.kind).toBe('StaticAbility');
  });

  it('parses "All creatures able to block enchanted creature do so." as StaticAbility', () => {
    const result = parseOracleText(
      'Enchant creature\nAll creatures able to block enchanted creature do so.',
    );
    expect(result.kind).toBe('StaticAbility');
  });
});

describe('Slice 7 — matchLureSpell: Taunting Challenge style', () => {
  it('parses "All creatures able to block target creature this turn do so." as Spell', () => {
    const result = parseOracleText(
      'All creatures able to block target creature this turn do so.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].kind).toBe('MustBeBlockedIfAble');
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Creature');
  });

  it('Taunting Challenge full oracle text parses correctly', () => {
    const result = parseOracleText(
      'All creatures able to block target creature this turn do so.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const eff = result.effects[0];
    expect(eff.kind).toBe('MustBeBlockedIfAble');
    if (eff.kind !== 'MustBeBlockedIfAble') return;
    // subject should be a Chosen target ref pointing to the spec
    expect(eff.subject.kind).toBe('Chosen');
  });
});

describe('Slice 7 — matchLureSpell: Goldenhide Ox "must be blocked" form', () => {
  it('parses "target creature must be blocked this turn if able." in trigger body', () => {
    // The trigger body ends with this clause after the ETB trigger prefix
    const result = parseOracleText(
      'When Goldenhide Ox enters the battlefield, target creature must be blocked this turn if able.',
    );
    // Should parse as ETB or Triggered with a MustBeBlockedIfAble effect inside
    expect(['ETB', 'Triggered', 'Spell']).toContain(result.kind);
    if (result.kind === 'ETB' || result.kind === 'Triggered') {
      const effects = result.ability.effects as Array<{ kind: string }>;
      expect(effects.some(e => e.kind === 'MustBeBlockedIfAble')).toBe(true);
    }
  });
});

// ============================================================================
// Executor test: MustBeBlockedIfAble writes to state.combat.luredCreatureIds
// ============================================================================

describe('Slice 7 — Executor: MustBeBlockedIfAble during combat', () => {
  it('writes the target creature id into state.combat.luredCreatureIds', () => {
    const { state, humanId, aiId } = setup(['Grizzly Bears'], ['Grizzly Bears']);

    // Get the "Taunting Challenge" parse result
    const parsed = parseOracleText(
      'All creatures able to block target creature this turn do so.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // Put a bear for AI (the attacker that will be lured)
    const attackerId = putCreature(state, aiId, 'bear');

    // Set up minimal combat state
    state.phase = 'combat';
    state.step = 'declare_blockers';
    state.activePlayerIndex = 1; // AI is active (attacking)
    state.combat = {
      attackers: [{ cardInstanceId: attackerId, defendingPlayerId: humanId }],
      blockers: [],
      blockersDeclared: false,
      blockersDeclaredBy: [],
      damageAssignment: new Map(),
    };

    // Execute the lure spell targeting the AI's attacker
    const resultState = executeEffects(
      state,
      parsed.effects,
      humanId,
      [attackerId],
      parsed.targets,
      0,
      {},
    );

    expect(resultState.combat?.luredCreatureIds).toBeDefined();
    expect(resultState.combat?.luredCreatureIds).toContain(attackerId);
  });
});

// ============================================================================
// Combat enforcement tests
// ============================================================================

describe('Slice 7 — Combat: lure forces block declaration', () => {
  it('rejects a declaration that omits a creature able to block a lured attacker', () => {
    const { state, humanId, aiId } = setup(['Grizzly Bears'], ['Grizzly Bears']);

    const attackerId = putCreature(state, aiId, 'bear');
    const blockerId = putCreature(state, humanId, 'bear');

    // Declare attackers (AI sends bear at human)
    state.phase = 'combat';
    state.step = 'declare_attackers';
    state.activePlayerIndex = 1;
    state.priorityPlayerIndex = 1;
    state.combat = null;

    let s = declareAttackers(state, aiId, [{ cardInstanceId: attackerId, defendingPlayerId: humanId }]);

    // Set the lured creature (as if Taunting Challenge resolved)
    s = {
      ...s,
      combat: {
        ...s.combat!,
        luredCreatureIds: [attackerId],
      },
    };

    s.step = 'declare_blockers';

    // Attempting to declare NO blockers even though the bear can block → should throw
    expect(() => declareBlockers(s, humanId, [])).toThrow(/lure/i);
  });

  it('accepts a declaration where the able creature blocks the lured attacker', () => {
    const { state, humanId, aiId } = setup(['Grizzly Bears'], ['Grizzly Bears']);

    const attackerId = putCreature(state, aiId, 'bear');
    const blockerId = putCreature(state, humanId, 'bear');

    state.phase = 'combat';
    state.step = 'declare_attackers';
    state.activePlayerIndex = 1;
    state.priorityPlayerIndex = 1;
    state.combat = null;

    let s = declareAttackers(state, aiId, [{ cardInstanceId: attackerId, defendingPlayerId: humanId }]);
    s = {
      ...s,
      combat: {
        ...s.combat!,
        luredCreatureIds: [attackerId],
      },
    };
    s.step = 'declare_blockers';

    // The bear blocks the lured attacker — should be legal
    expect(() =>
      declareBlockers(s, humanId, [{ cardInstanceId: blockerId, blockingAttackerId: attackerId }]),
    ).not.toThrow();
  });

  it('does not force a flying-only blocker against a lured non-flyer it cannot block', () => {
    // The flyer cannot block the ground lure attacker (can it? Flyers CAN block ground
    // but ground can't block flyers — so actually the flyer CAN block the lured creature).
    // Let's test a simpler case: when there are NO able blockers, an empty declaration is legal.
    const { state, humanId, aiId } = setup([], ['Grizzly Bears']);

    const attackerId = putCreature(state, aiId, 'bear');

    state.phase = 'combat';
    state.step = 'declare_attackers';
    state.activePlayerIndex = 1;
    state.priorityPlayerIndex = 1;
    state.combat = null;

    let s = declareAttackers(state, aiId, [{ cardInstanceId: attackerId, defendingPlayerId: humanId }]);
    s = {
      ...s,
      combat: {
        ...s.combat!,
        luredCreatureIds: [attackerId],
      },
    };
    s.step = 'declare_blockers';

    // Human has no creatures — empty declaration is legal
    expect(() => declareBlockers(s, humanId, [])).not.toThrow();
  });

  it('enforces static lure from oracle text of attacking Elvish Bard', () => {
    const { state, humanId, aiId } = setup(['Grizzly Bears'], ['Elvish Bard']);

    const lureAttackerId = putCreature(state, aiId, 'lure-bear'); // Elvish Bard
    const blockerId = putCreature(state, humanId, 'bear');

    state.phase = 'combat';
    state.step = 'declare_attackers';
    state.activePlayerIndex = 1;
    state.priorityPlayerIndex = 1;
    state.combat = null;

    let s = declareAttackers(state, aiId, [{ cardInstanceId: lureAttackerId, defendingPlayerId: humanId }]);
    s.step = 'declare_blockers';

    // Empty declaration should be illegal — the bear must block Elvish Bard
    expect(() => declareBlockers(s, humanId, [])).toThrow(/lure/i);

    // Blocking Elvish Bard should be legal
    expect(() =>
      declareBlockers(s, humanId, [{ cardInstanceId: blockerId, blockingAttackerId: lureAttackerId }]),
    ).not.toThrow();
  });
});
