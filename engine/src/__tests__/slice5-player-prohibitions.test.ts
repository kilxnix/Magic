/**
 * Slice 5 — Player-level static prohibitions:
 *   "You have hexproof."      (Ivory Mask / Leyline of Sanctity family)
 *   "You have shroud."        (Ivory Mask older printing / Spirit of the Labyrinth)
 *   "Players can't gain life." (Leyline of Punishment / Sulfuric Vortex family)
 *   "Damage can't be prevented." (Leyline of Punishment / Everlasting Torment family)
 *
 * PARSE tests: each oracle form parses as StaticAbility with the correct modifier.
 * REGISTRATION tests: per-line dispatch registers both modifiers for Leyline of Punishment.
 * EXECUTION tests: each form is enforced by the relevant engine hook.
 *
 * Honesty gates confirmed:
 *   PlayerHexproof  — validateTargetChoices (targets.ts) rejects opponent targeting.
 *   PlayerShroud    — validateTargetChoices (targets.ts) rejects all targeting.
 *   CantGainLife    — executeGainLife (executor.ts) skips life gain.
 *   DamageCantBePrevented — applyDamageReplacementEffects (replacement.ts) skips prevention.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { validateTargetChoices } from '../effects/targets';
import { initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { registerDamagePrevention } from '../effects/replacement';
import { executeEffects } from '../effects/executor';
import type { CardDefinition, CardInstance, GameState } from '../types';
import type { TargetSpec } from '../effects/targets';
import type { GainLifeEffect, DealDamageEffect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnchDef(id: string, oracle: string, extra: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: id.replace(/-/g, ' '),
    type_line: 'Enchantment',
    card_types: ['enchantment'],
    oracle_text: oracle,
    mana_cost: '{2}{W}',
    cmc: 3,
    colors: ['W'],
    color_identity: ['W'],
    keywords: [],
    ...extra,
  };
}

const DEFS: Record<string, CardDefinition> = {
  'ivory-mask': makeEnchDef('ivory-mask', 'You have hexproof.'),
  'ivory-mask-shroud': makeEnchDef('ivory-mask-shroud', 'You have shroud.'),
  'leyline-punishment': makeEnchDef(
    'leyline-punishment',
    "Players can't gain life.\nDamage can't be prevented.",
  ),
  'sulfuric-vortex': makeEnchDef('sulfuric-vortex', "Players can't gain life."),
  'everlasting-torment': makeEnchDef('everlasting-torment', "Damage can't be prevented."),
};

/** Dummy single-card deck so each player has at least one valid card. */
const DUMMY_DEF: CardDefinition = {
  id: 'dummy-plains',
  name: 'Plains',
  type_line: 'Basic Land — Plains',
  card_types: ['land'],
  oracle_text: '',
  mana_cost: '',
  cmc: 0,
  colors: [],
  color_identity: ['W'],
  keywords: [],
};

function buildState(): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player1', cards: [DUMMY_DEF], commanderId: 'dummy-plains' },
    { playerId: 'p2', name: 'Player2', cards: [DUMMY_DEF], commanderId: 'dummy-plains' },
  ]);
}

function placeOnBattlefield(state: GameState, defId: string, ownerId: string, instanceId: string): GameState {
  const newCards = new Map(state.cards);
  const card: CardInstance = {
    instanceId,
    definitionId: defId,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    damage: 0,
    counters: {},
    isCommander: false,
  };
  newCards.set(instanceId, card);
  // Also register the definition so registerContinuousAbilitiesForPermanent can look it up
  const newDefs = new Map(state.cardDefinitions);
  const defEntry = newDefs.get(defId);
  if (!defEntry) {
    // Insert the DEFS entry if not already present
    const found = Object.values(DEFS).find(d => d.id === defId);
    if (found) newDefs.set(defId, found);
  }
  return { ...state, cards: newCards, cardDefinitions: newDefs };
}

function withEnchantment(defId: string, ownerId: string, instanceId: string): GameState {
  let state = buildState();
  state = placeOnBattlefield(state, defId, ownerId, instanceId);
  state = registerContinuousAbilitiesForPermanent(state, instanceId);
  return state;
}

// ============================================================================
// A. Parse tests
// ============================================================================

describe('Slice 5 player-prohibition — parse', () => {
  // ── "You have hexproof." ──────────────────────────────────────────────────

  it('parses "You have hexproof." → StaticAbility(PlayerHexproof)', () => {
    const r = parseOracleText('You have hexproof.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('PlayerHexproof');
  });

  it('Leyline of Sanctity (opener + hexproof) parses with PlayerHexproof', () => {
    const oracle =
      'If this card is in your opening hand, you may begin the game with it on the battlefield.\n' +
      'You have hexproof.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('PlayerHexproof');
  });

  it('"Defender\\nYou have hexproof.\\nPrevent noncombat dmg" → Unparsed (unimplemented prevention)', () => {
    // Crystal Barricade has an unimplemented prevention clause; whole face stays Unparsed.
    const r = parseOracleText(
      'Defender\nYou have hexproof.\nPrevent all noncombat damage that would be dealt to other creatures you control.',
    );
    expect(r.kind).toBe('Unparsed');
  });

  // ── "You have shroud." ────────────────────────────────────────────────────

  it('parses "You have shroud." → StaticAbility(PlayerShroud)', () => {
    const r = parseOracleText('You have shroud.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('PlayerShroud');
  });

  // ── "Players can't gain life." ────────────────────────────────────────────

  it("parses \"Players can't gain life.\" → StaticAbility(CantGainLife)", () => {
    const r = parseOracleText("Players can't gain life.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('CantGainLife');
  });

  it('parses "Players cannot gain life." → StaticAbility(CantGainLife)', () => {
    const r = parseOracleText('Players cannot gain life.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('CantGainLife');
  });

  // ── "Damage can't be prevented." ─────────────────────────────────────────

  it("parses \"Damage can't be prevented.\" → StaticAbility(DamageCantBePrevented)", () => {
    const r = parseOracleText("Damage can't be prevented.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('DamageCantBePrevented');
  });

  it('parses "Damage cannot be prevented." → StaticAbility(DamageCantBePrevented)', () => {
    const r = parseOracleText('Damage cannot be prevented.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('DamageCantBePrevented');
  });

  // ── Leyline of Punishment mixed face ─────────────────────────────────────

  it("Leyline of Punishment face (can't gain life + can't be prevented) parses (not Unparsed)", () => {
    const r = parseOracleText("Players can't gain life.\nDamage can't be prevented.");
    expect(r.kind).toBe('StaticAbility');
  });
});

// ============================================================================
// B. Registration tests
// ============================================================================

describe('Slice 5 player-prohibition — continuous effect registration', () => {
  it('Ivory Mask registers PlayerHexproof continuous effect', () => {
    const state = withEnchantment('ivory-mask', 'p1', 'mask1');
    const has = (state.continuousEffects ?? []).some(
      ce => ce.ability.modifier.kind === 'PlayerHexproof' && ce.sourceInstanceId === 'mask1',
    );
    expect(has).toBe(true);
  });

  it('Ivory Mask shroud registers PlayerShroud continuous effect', () => {
    const state = withEnchantment('ivory-mask-shroud', 'p1', 'shroud1');
    const has = (state.continuousEffects ?? []).some(
      ce => ce.ability.modifier.kind === 'PlayerShroud' && ce.sourceInstanceId === 'shroud1',
    );
    expect(has).toBe(true);
  });

  it('Leyline of Punishment registers CantGainLife via per-line dispatch', () => {
    const state = withEnchantment('leyline-punishment', 'p1', 'leyline1');
    const has = (state.continuousEffects ?? []).some(
      ce => ce.ability.modifier.kind === 'CantGainLife' && ce.sourceInstanceId === 'leyline1',
    );
    expect(has).toBe(true);
  });

  it('Leyline of Punishment registers DamageCantBePrevented via per-line dispatch', () => {
    const state = withEnchantment('leyline-punishment', 'p1', 'leyline1');
    const has = (state.continuousEffects ?? []).some(
      ce => ce.ability.modifier.kind === 'DamageCantBePrevented' && ce.sourceInstanceId === 'leyline1',
    );
    expect(has).toBe(true);
  });
});

// ============================================================================
// C. Execution — PlayerHexproof / PlayerShroud: targeting enforcement
// ============================================================================

describe('Slice 5 player-prohibition — player hexproof/shroud targeting', () => {
  const playerSpec: TargetSpec = {
    id: 'target_player',
    type: 'Player',
    count: 1,
  };

  it('PlayerHexproof: opponent cannot target the protected player', () => {
    const state = withEnchantment('ivory-mask', 'p1', 'mask1');
    // p2 tries to target p1 who has hexproof — should throw.
    expect(() =>
      validateTargetChoices(state, 'p2', [playerSpec], ['p1']),
    ).toThrow(/hexproof/i);
  });

  it('PlayerHexproof: the protected player may target themselves', () => {
    const state = withEnchantment('ivory-mask', 'p1', 'mask1');
    // p1 targets themselves — hexproof only blocks opponents.
    expect(() =>
      validateTargetChoices(state, 'p1', [playerSpec], ['p1']),
    ).not.toThrow();
  });

  it('PlayerShroud: opponent cannot target the protected player', () => {
    const state = withEnchantment('ivory-mask-shroud', 'p1', 'shroud1');
    expect(() =>
      validateTargetChoices(state, 'p2', [playerSpec], ['p1']),
    ).toThrow(/shroud/i);
  });

  it('PlayerShroud: the protected player cannot target themselves either', () => {
    const state = withEnchantment('ivory-mask-shroud', 'p1', 'shroud1');
    // Shroud prevents self-targeting too.
    expect(() =>
      validateTargetChoices(state, 'p1', [playerSpec], ['p1']),
    ).toThrow(/shroud/i);
  });

  it('PlayerHexproof does NOT protect players who do not control the enchantment', () => {
    const state = withEnchantment('ivory-mask', 'p1', 'mask1');
    // p2 does NOT have hexproof — p1 can freely target p2.
    expect(() =>
      validateTargetChoices(state, 'p1', [playerSpec], ['p2']),
    ).not.toThrow();
  });

  it('No hexproof/shroud: players may freely be targeted', () => {
    const state = buildState();
    expect(() =>
      validateTargetChoices(state, 'p2', [playerSpec], ['p1']),
    ).not.toThrow();
  });
});

// ============================================================================
// D. Execution — CantGainLife: life gain prevention
// ============================================================================

describe('Slice 5 player-prohibition — CantGainLife execution', () => {
  function gainLifeEffect(targetRef: GainLifeEffect['player'], amount: number): GainLifeEffect {
    return { kind: 'GainLife', player: targetRef, amount };
  }

  it('CantGainLife prevents the protected player (self) from gaining life', () => {
    const state = withEnchantment('sulfuric-vortex', 'p1', 'vortex1');
    const p1Before = state.players.find(p => p.id === 'p1')!.life;

    // Gain 5 life targeting p1's controller slot (Controller = caster = p1).
    const result = executeEffects(
      state,
      [gainLifeEffect({ kind: 'Controller' }, 5)],
      'p1',
      [],
      [],
    );

    const p1After = result.players.find(p => p.id === 'p1')!.life;
    expect(p1After).toBe(p1Before); // no life gained
  });

  it('CantGainLife prevents ALL players from gaining life', () => {
    // Controller is p1 (who owns the vortex), but all players are affected.
    const state = withEnchantment('sulfuric-vortex', 'p1', 'vortex1');
    const p2Before = state.players.find(p => p.id === 'p2')!.life;

    const result = executeEffects(
      state,
      [gainLifeEffect({ kind: 'Player', playerId: 'p2' }, 3)],
      'p1',
      [],
      [],
    );

    const p2After = result.players.find(p => p.id === 'p2')!.life;
    expect(p2After).toBe(p2Before); // p2 also blocked
  });

  it('Without CantGainLife, life gain proceeds normally', () => {
    const state = buildState();
    const p1Before = state.players.find(p => p.id === 'p1')!.life;

    const result = executeEffects(
      state,
      [gainLifeEffect({ kind: 'Controller' }, 5)],
      'p1',
      [],
      [],
    );

    const p1After = result.players.find(p => p.id === 'p1')!.life;
    expect(p1After).toBe(p1Before + 5);
  });
});

// ============================================================================
// E. Execution — DamageCantBePrevented: prevention shield bypass
// ============================================================================

describe('Slice 5 player-prohibition — DamageCantBePrevented execution', () => {
  function dealDamageEffect(targetPlayerId: string, amount: number): DealDamageEffect {
    return {
      kind: 'DealDamage',
      target: { kind: 'Player', playerId: targetPlayerId },
      amount,
    };
  }

  it('DamageCantBePrevented bypasses a full-coverage state-scoped prevention shield', () => {
    let state = withEnchantment('everlasting-torment', 'p1', 'torment1');

    // Register a "prevent all" shield protecting p1.
    state = registerDamagePrevention(state, {
      id: 'fog_p1',
      controllerId: 'p1',
      protectedTargetId: 'p1',
      amount: 'all',
      combatOnly: false,
      expiresAtTurnNumber: state.turnNumber,
    });

    const p1Before = state.players.find(p => p.id === 'p1')!.life;

    // p2 deals 3 damage to p1. DamageCantBePrevented skips the fog shield.
    const result = executeEffects(
      state,
      [dealDamageEffect('p1', 3)],
      'p2',
      [],
      [],
      0,
      { sourceInstanceId: 'some_card' },
    );

    const p1After = result.players.find(p => p.id === 'p1')!.life;
    // Life should be reduced despite the shield.
    expect(p1After).toBe(p1Before - 3);
  });

  it('Without DamageCantBePrevented, a "prevent all" shield blocks all damage', () => {
    let state = buildState();

    state = registerDamagePrevention(state, {
      id: 'fog_p1',
      controllerId: 'p1',
      protectedTargetId: 'p1',
      amount: 'all',
      combatOnly: false,
      expiresAtTurnNumber: state.turnNumber,
    });

    const p1Before = state.players.find(p => p.id === 'p1')!.life;

    const result = executeEffects(
      state,
      [dealDamageEffect('p1', 3)],
      'p2',
      [],
      [],
      0,
      { sourceInstanceId: 'some_card' },
    );

    const p1After = result.players.find(p => p.id === 'p1')!.life;
    // Shield prevented all damage — life unchanged.
    expect(p1After).toBe(p1Before);
  });

  it('DamageCantBePrevented also blocks per-amount shields', () => {
    let state = withEnchantment('everlasting-torment', 'p1', 'torment1');

    // Register a 5-point shield protecting p1.
    state = registerDamagePrevention(state, {
      id: 'partial_shield_p1',
      controllerId: 'p1',
      protectedTargetId: 'p1',
      amount: 5,
      combatOnly: false,
      expiresAtTurnNumber: state.turnNumber,
    });

    const p1Before = state.players.find(p => p.id === 'p1')!.life;

    const result = executeEffects(
      state,
      [dealDamageEffect('p1', 4)],
      'p2',
      [],
      [],
      0,
      { sourceInstanceId: 'some_card' },
    );

    const p1After = result.players.find(p => p.id === 'p1')!.life;
    // Shield would normally absorb all 4, but DamageCantBePrevented bypasses it.
    expect(p1After).toBe(p1Before - 4);
  });
});
