/**
 * Slice 11: Flash-window cleanup-sacrifice (Mirage enchantment family).
 *
 * Oracle text (identical on all 8 faces: Spider Climb, Armor of Thorns,
 * Lightning Reflexes, Ward of Lights, …):
 *   "You may cast this spell as though it had flash. If you cast it any time
 *    a sorcery couldn't have been cast, the controller of the permanent it
 *    becomes sacrifices it at the beginning of the next cleanup step."
 *
 * Tests cover:
 *  1. Parser recognition — SHAPE 4 parses as StaticAbility(AsThoughFlash)
 *     with sacrificeAtCleanupIfFlashCast: true.
 *  2. canCastSpell permits casting at instant speed (flash grant honored).
 *  3. Sorcery-speed cast does NOT set sacrificeAtCleanup on the permanent.
 *  4. Instant-speed cast DOES set sacrificeAtCleanup on the permanent.
 *  5. advanceStep(cleanup) sacrifices the flagged permanent (moves to graveyard).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { canCastSpell, castSpell, resolveTopOfStack } from '../stack';
import { advanceStep } from '../turn-manager';
import { initGameState, getCardsInZone } from '../game-state';
import type { CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Exact two-sentence oracle text shared by all 8 Mirage flash-window enchantments.
// (Real Scryfall text; the "Enchant creature" header and buff line are separate.)
// We use just this two-sentence block as the entire oracle text for the engine card
// so the face parses as StaticAbility(AsThoughFlash) — no "Enchant creature" means
// it enters as a non-Aura enchantment with no target requirement.
// ---------------------------------------------------------------------------

const FLASH_CLEANUP_ORACLE =
  "You may cast this spell as though it had flash. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.";

// The same text for named cards (identical wording verified on all 8 faces).
const SPIDER_CLIMB_ORACLE = FLASH_CLEANUP_ORACLE;
const ARMOR_OF_THORNS_ORACLE = FLASH_CLEANUP_ORACLE;
const LIGHTNING_REFLEXES_ORACLE = FLASH_CLEANUP_ORACLE;
const WARD_OF_LIGHTS_ORACLE = FLASH_CLEANUP_ORACLE;

// ---------------------------------------------------------------------------
// Card definition factory
// ---------------------------------------------------------------------------

function makeCard(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Enchantment',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{G}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? ['G'],
    color_identity: opts.color_identity ?? ['G'],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['enchantment'],
    power: opts.power,
    toughness: opts.toughness,
  };
}

/**
 * Build a minimal two-player game. p1 is always the active player.
 * The enchantment card is put into p1's hand. Sufficient mana is provided.
 * No Aura target needed — we use plain Enchantment type.
 */
function setup(enchantDef: CardDefinition) {
  const decks = [
    {
      playerId: 'p1',
      name: 'Alice',
      cards: [enchantDef],
      commanderId: 'cmd1',
    },
    {
      playerId: 'p2',
      name: 'Bob',
      cards: [
        makeCard('dummy', {
          type_line: 'Creature — Dummy',
          card_types: ['creature'],
          oracle_text: '',
          power: 1,
          toughness: 1,
        }),
      ],
      commanderId: 'cmd2',
    },
  ];

  let state = initGameState(decks);

  // Move enchantment to p1's hand.
  const enchantInst = getCardsInZone(state, 'p1', 'library').find(
    c => state.cards.get(c.instanceId)!.definitionId === enchantDef.id,
  )!;

  state.cards.set(enchantInst.instanceId, { ...enchantInst, zone: 'hand' });

  // Give p1 plenty of mana.
  state = {
    ...state,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    players: state.players.map(p =>
      p.id === 'p1'
        ? { ...p, manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 } }
        : p,
    ),
  };

  return { state, enchantId: enchantInst.instanceId };
}

// ---------------------------------------------------------------------------
// 1. Parser recognition
// ---------------------------------------------------------------------------

describe('SHAPE 4 flash-cleanup-sacrifice — parser recognition', () => {
  it('Spider Climb oracle parses as StaticAbility(AsThoughFlash) with sacrificeAtCleanupIfFlashCast', () => {
    const r = parseOracleText(SPIDER_CLIMB_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('AsThoughFlash');
    const mod = r.ability.modifier as { kind: 'AsThoughFlash'; surcharge: number; sacrificeAtCleanupIfFlashCast?: boolean };
    expect(mod.sacrificeAtCleanupIfFlashCast).toBe(true);
    expect(mod.surcharge).toBe(0);
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toBeUndefined();
  });

  it('Armor of Thorns oracle parses identically', () => {
    const r = parseOracleText(ARMOR_OF_THORNS_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('AsThoughFlash');
    const mod = r.ability.modifier as { kind: 'AsThoughFlash'; sacrificeAtCleanupIfFlashCast?: boolean };
    expect(mod.sacrificeAtCleanupIfFlashCast).toBe(true);
  });

  it('Lightning Reflexes oracle parses identically', () => {
    const r = parseOracleText(LIGHTNING_REFLEXES_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('AsThoughFlash');
    const mod = r.ability.modifier as { kind: 'AsThoughFlash'; sacrificeAtCleanupIfFlashCast?: boolean };
    expect(mod.sacrificeAtCleanupIfFlashCast).toBe(true);
  });

  it('Ward of Lights oracle parses identically', () => {
    const r = parseOracleText(WARD_OF_LIGHTS_ORACLE);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('AsThoughFlash');
    const mod = r.ability.modifier as { kind: 'AsThoughFlash'; sacrificeAtCleanupIfFlashCast?: boolean };
    expect(mod.sacrificeAtCleanupIfFlashCast).toBe(true);
  });

  it('bare flash grant (no sacrifice rider) does NOT set sacrificeAtCleanupIfFlashCast', () => {
    const r = parseOracleText('You may cast this spell as though it had flash.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('AsThoughFlash');
    const mod = r.ability.modifier as { kind: 'AsThoughFlash'; sacrificeAtCleanupIfFlashCast?: boolean };
    expect(mod.sacrificeAtCleanupIfFlashCast).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. canCastSpell grants instant-speed casting
// ---------------------------------------------------------------------------

describe('SHAPE 4 — canCastSpell at instant speed', () => {
  const enchantDef = makeCard('spider_climb', {
    name: 'Spider Climb',
    oracle_text: SPIDER_CLIMB_ORACLE,
    mana_cost: '{G}',
    card_types: ['enchantment'],
    type_line: 'Enchantment',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
  });

  it('cannot cast during opponent\'s turn without flash (plain enchantment)', () => {
    const { state, enchantId } = setup(makeCard('plain_enchant_nf', {
      oracle_text: '',
      card_types: ['enchantment'],
      type_line: 'Enchantment',
    }));
    // Simulate opponent's turn (p2 is active)
    const opponentState = {
      ...state,
      activePlayerIndex: 1,
      priorityPlayerIndex: 1,
      phase: 'precombat_main' as const,
    };
    expect(canCastSpell(opponentState, 'p1', enchantId)).toBe(false);
  });

  it('can cast the Spider Climb enchantment at instant speed (outside sorcery window)', () => {
    const { state, enchantId } = setup(enchantDef);
    // Simulate opponent's turn: not a main phase for p1.
    const opponentState = {
      ...state,
      activePlayerIndex: 1,
      priorityPlayerIndex: 1,
      phase: 'precombat_main' as const,
      step: 'precombat_main' as any,
    };
    expect(canCastSpell(opponentState, 'p1', enchantId)).toBe(true);
  });

  it('can also cast at sorcery speed (own main phase, empty stack)', () => {
    const { state, enchantId } = setup(enchantDef);
    const sorceryState = {
      ...state,
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main' as const,
      step: 'precombat_main' as any,
      stack: [],
    };
    expect(canCastSpell(sorceryState, 'p1', enchantId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Sorcery-speed cast does NOT set sacrificeAtCleanup
// ---------------------------------------------------------------------------

describe('SHAPE 4 — sorcery-speed cast: no cleanup flag', () => {
  const enchantDef = makeCard('spider_climb_sorcery', {
    name: 'Spider Climb',
    oracle_text: SPIDER_CLIMB_ORACLE,
    mana_cost: '{G}',
    card_types: ['enchantment'],
    type_line: 'Enchantment',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
  });

  it('permanent does NOT get sacrificeAtCleanup when cast at sorcery speed', () => {
    const { state, enchantId } = setup(enchantDef);
    // p1 is active player, main phase, empty stack => sorcery window
    const sorceryState = {
      ...state,
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main' as const,
      step: 'precombat_main' as any,
      stack: [] as typeof state.stack,
    };

    let afterCast = castSpell(sorceryState, 'p1', enchantId, []);
    let afterResolve = resolveTopOfStack(afterCast);

    const entering = afterResolve.cards.get(enchantId);
    expect(entering).toBeDefined();
    expect(entering!.zone).toBe('battlefield');
    expect(entering!.sacrificeAtCleanup).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// 4. Instant-speed cast DOES set sacrificeAtCleanup
// ---------------------------------------------------------------------------

describe('SHAPE 4 — instant-speed cast: cleanup flag set', () => {
  const enchantDef = makeCard('spider_climb_instant', {
    name: 'Spider Climb',
    oracle_text: SPIDER_CLIMB_ORACLE,
    mana_cost: '{G}',
    card_types: ['enchantment'],
    type_line: 'Enchantment',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
  });

  it('permanent DOES get sacrificeAtCleanup when cast outside the sorcery window', () => {
    const { state, enchantId } = setup(enchantDef);
    // Simulate opponent's turn: p2 is active player (p1 is using the flash grant)
    const instantState = {
      ...state,
      activePlayerIndex: 1,
      priorityPlayerIndex: 1,
      phase: 'precombat_main' as const,
      step: 'precombat_main' as any,
      stack: [] as typeof state.stack,
    };

    let afterCast = castSpell(instantState, 'p1', enchantId, []);
    let afterResolve = resolveTopOfStack(afterCast);

    const entering = afterResolve.cards.get(enchantId);
    expect(entering).toBeDefined();
    expect(entering!.zone).toBe('battlefield');
    expect(entering!.sacrificeAtCleanup).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. advanceStep(cleanup) sacrifices the flagged permanent
// ---------------------------------------------------------------------------

describe('SHAPE 4 — cleanup step sacrifice', () => {
  const enchantDef = makeCard('spider_climb_cleanup', {
    name: 'Spider Climb',
    oracle_text: SPIDER_CLIMB_ORACLE,
    mana_cost: '{G}',
    card_types: ['enchantment'],
    type_line: 'Enchantment',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
  });

  it('advancing to cleanup step sacrifices the flagged permanent', () => {
    const { state, enchantId } = setup(enchantDef);
    // Simulate opponent's turn (instant-speed cast).
    const instantState = {
      ...state,
      activePlayerIndex: 1,
      priorityPlayerIndex: 1,
      phase: 'precombat_main' as const,
      step: 'precombat_main' as any,
      stack: [] as typeof state.stack,
    };

    let afterCast = castSpell(instantState, 'p1', enchantId, []);
    let afterResolve = resolveTopOfStack(afterCast);

    // Verify it's on the battlefield with the flag.
    expect(afterResolve.cards.get(enchantId)?.zone).toBe('battlefield');
    expect(afterResolve.cards.get(enchantId)?.sacrificeAtCleanup).toBe(true);

    // Advance to the cleanup step.
    const preCleanup = {
      ...afterResolve,
      step: 'end' as const,
      phase: 'ending' as const,
    };
    const afterCleanup = advanceStep(preCleanup);

    // The enchantment should now be in the graveyard.
    const sacrificed = afterCleanup.cards.get(enchantId);
    expect(sacrificed).toBeDefined();
    expect(sacrificed!.zone).toBe('graveyard');
    expect(sacrificed!.sacrificeAtCleanup).toBeFalsy();
  });

  it('a plain enchantment without the flag is NOT sacrificed at cleanup', () => {
    const plainEnchant = makeCard('plain_enchant_cleanup', {
      name: 'Wild Growth',
      oracle_text: '',
      card_types: ['enchantment'],
      type_line: 'Enchantment',
      mana_cost: '{G}',
      cmc: 1,
      colors: ['G'],
      color_identity: ['G'],
    });
    const { state, enchantId: plainId } = setup(plainEnchant);

    // Cast at sorcery speed (no flag set).
    const sorceryState = {
      ...state,
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main' as const,
      step: 'precombat_main' as any,
      stack: [] as typeof state.stack,
    };
    let afterCast = castSpell(sorceryState, 'p1', plainId, []);
    let afterResolve = resolveTopOfStack(afterCast);

    const preCleanup = {
      ...afterResolve,
      step: 'end' as const,
      phase: 'ending' as const,
    };
    const afterCleanup = advanceStep(preCleanup);

    // Should still be on the battlefield.
    expect(afterCleanup.cards.get(plainId)?.zone).toBe('battlefield');
  });
});
