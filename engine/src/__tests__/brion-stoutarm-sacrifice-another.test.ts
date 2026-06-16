/**
 * Brion Stoutarm — sacrifice another creature fling subsystem.
 *
 * Tests parse AND execution:
 *   - cost parses as sacrifice='another-creature'
 *   - effect parses as DealDamage{amount: SacrificedCreaturePower}
 *   - optional "you gain life equal to that creature's power" life-gain clause
 *   - canActivateAbility returns false when no other creature is available
 *   - full activation + resolution: 4/4 sacrificed → 4 damage to target player + creature is gone
 *   - correct creature selection policy (highest power chosen first)
 */

import { describe, it, expect } from 'vitest';
import { parseActivatedAbilities } from '../effects/parser';
import { canActivateAbility, activateAbility } from '../actions';
import { resolveTopOfStack } from '../stack';
import type { GameState, CardDefinition, CardInstance } from '../types';

// ─── Brion oracle text (Scryfall form, with Lifelink keyword) ─────────────────
const BRION_ORACLE =
  'Lifelink\n{R}, {T}, Sacrifice another creature: Brion Stoutarm deals damage equal to the sacrificed creature\'s power to target player or planeswalker.';

// ─── Brion alternative oracle (explicit life-gain clause, unambiguous "sacrificed" wording) ──
const BRION_EXPLICIT_LIFEGAIN =
  '{R}, {T}, Sacrifice another creature: Brion Stoutarm deals damage equal to the sacrificed creature\'s power to target player or planeswalker. You gain life equal to the sacrificed creature\'s power.';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeDef(overrides: Partial<CardDefinition> & { id: string; name: string }): CardDefinition {
  return {
    type_line: 'Creature',
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['creature'],
    power: 1,
    toughness: 1,
    ...overrides,
  };
}

function makeInstance(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: string = 'battlefield',
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone: zone as CardInstance['zone'],
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
}

function makeState(params: {
  brionTapped?: boolean;
  brionSummoningSick?: boolean;
  extraCreaturePower?: number;
  extraCreatures?: Array<{ power: number; toughness: number }>;
  manaR?: number;
}): GameState {
  const {
    brionTapped = false,
    brionSummoningSick = false,
    extraCreaturePower = 4,
    extraCreatures,
    manaR = 1,
  } = params;

  const defs = new Map<string, CardDefinition>();
  const cards = new Map<string, CardInstance>();

  // Brion def
  const brionDef = makeDef({
    id: 'brion',
    name: 'Brion Stoutarm',
    type_line: 'Legendary Creature — Giant Warrior',
    oracle_text: BRION_ORACLE,
    mana_cost: '{2}{R}{W}',
    cmc: 4,
    colors: ['R', 'W'],
    power: 4,
    toughness: 4,
    keywords: ['lifelink'],
  });
  defs.set('brion', brionDef);
  const brionInst: CardInstance = {
    ...makeInstance('brion_inst', 'brion', 'p1'),
    tapped: brionTapped,
    summoningSick: brionSummoningSick,
  };
  cards.set('brion_inst', brionInst);

  // Extra creature(s)
  const toAdd = extraCreatures ?? [{ power: extraCreaturePower, toughness: extraCreaturePower }];
  toAdd.forEach((cr, idx) => {
    const id = `fodder_${idx}`;
    const instId = `fodder_inst_${idx}`;
    defs.set(id, makeDef({ id, name: `Fodder ${idx}`, power: cr.power, toughness: cr.toughness }));
    cards.set(instId, makeInstance(instId, id, 'p1'));
  });

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
        manaPool: { W: 0, U: 0, B: 0, R: manaR, G: 0, C: 0 },
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
    cardDefinitions: defs,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ─── Parser tests ─────────────────────────────────────────────────────────────

describe('Brion Stoutarm — parser', () => {
  it('parses cost: sacrifice=another-creature, tap=true, mana={r}', () => {
    const abilities = parseActivatedAbilities(BRION_ORACLE);
    // The first non-Lifelink line is the activated ability
    const ability = abilities.find(a => a.cost.sacrifice === 'another-creature');
    expect(ability).toBeDefined();
    expect(ability!.cost.tap).toBe(true);
    expect(ability!.cost.mana).toBe('{r}');
    expect(ability!.cost.sacrifice).toBe('another-creature');
  });

  it('parses effect: DealDamage with SacrificedCreaturePower amount', () => {
    const abilities = parseActivatedAbilities(BRION_ORACLE);
    const ability = abilities.find(a => a.cost.sacrifice === 'another-creature');
    expect(ability).toBeDefined();
    const dmg = ability!.effects.find((e: any) => e.kind === 'DealDamage');
    expect(dmg).toBeDefined();
    expect((dmg as any).amount).toMatchObject({ kind: 'SacrificedCreaturePower' });
  });

  it('parses target spec: one Player target', () => {
    const abilities = parseActivatedAbilities(BRION_ORACLE);
    const ability = abilities.find(a => a.cost.sacrifice === 'another-creature');
    expect(ability).toBeDefined();
    expect(ability!.targets).toHaveLength(1);
    expect((ability!.targets[0] as any).type).toBe('Player');
  });

  it('parses explicit life-gain clause: GainLife with SacrificedCreaturePower', () => {
    const abilities = parseActivatedAbilities(BRION_EXPLICIT_LIFEGAIN);
    const ability = abilities.find(a => a.cost.sacrifice === 'another-creature');
    expect(ability).toBeDefined();
    const gainLife = ability!.effects.find((e: any) => e.kind === 'GainLife');
    expect(gainLife).toBeDefined();
    expect((gainLife as any).amount).toMatchObject({ kind: 'SacrificedCreaturePower' });
  });

  it('parses "the sacrificed creature\'s power" wording in life-gain tail', () => {
    // Distinct from "that creature's power" (EventCreatureStat) — must parse as SacrificedCreaturePower
    const oracle = '{T}, Sacrifice another creature: You gain life equal to the sacrificed creature\'s power.';
    const abilities = parseActivatedAbilities(oracle);
    const ability = abilities.find(a => a.cost.sacrifice === 'another-creature');
    expect(ability).toBeDefined();
    const gainLife = ability!.effects.find((e: any) => e.kind === 'GainLife');
    expect(gainLife).toBeDefined();
    expect((gainLife as any).amount).toMatchObject({ kind: 'SacrificedCreaturePower' });
  });
});

// ─── Activation guard tests ────────────────────────────────────────────────────

describe('Brion Stoutarm — canActivateAbility', () => {
  it('returns true when another creature is present', () => {
    const s = makeState({ extraCreaturePower: 4 });
    expect(canActivateAbility(s, 'p1', 'brion_inst', 0)).toBe(true);
  });

  it('returns false when no other creature is present', () => {
    // Remove the fodder creature
    const s = makeState({ extraCreaturePower: 4 });
    s.cards.delete('fodder_inst_0');
    expect(canActivateAbility(s, 'p1', 'brion_inst', 0)).toBe(false);
  });

  it('returns false when Brion is already tapped', () => {
    const s = makeState({ brionTapped: true, extraCreaturePower: 4 });
    expect(canActivateAbility(s, 'p1', 'brion_inst', 0)).toBe(false);
  });

  it('returns false when Brion has summoning sickness', () => {
    const s = makeState({ brionSummoningSick: true, extraCreaturePower: 4 });
    expect(canActivateAbility(s, 'p1', 'brion_inst', 0)).toBe(false);
  });

  it('returns false when player lacks red mana', () => {
    const s = makeState({ manaR: 0, extraCreaturePower: 4 });
    expect(canActivateAbility(s, 'p1', 'brion_inst', 0)).toBe(false);
  });
});

// ─── Full execution tests ──────────────────────────────────────────────────────

describe('Brion Stoutarm — activation + resolution', () => {
  it('activates: sacrifices the 4/4 fodder, puts ability on stack', () => {
    const s = makeState({ extraCreaturePower: 4 });
    const after = activateAbility(s, 'p1', 'brion_inst', 0, ['p2']);
    // Fodder should be in graveyard after cost payment
    const fodder = after.cards.get('fodder_inst_0');
    expect(fodder?.zone).toBe('graveyard');
    // Ability should be on stack
    expect(after.stack).toHaveLength(1);
    expect(after.stack[0].kind).toBe('ActivatedAbility');
    // namedCardChoices should record the power
    const item = after.stack[0] as any;
    expect(item.namedCardChoices?.sacrificedCreaturePower).toBe('4');
  });

  it('resolves: deals 4 damage to target player when 4/4 sacrificed', () => {
    let s = makeState({ extraCreaturePower: 4 });
    s = activateAbility(s, 'p1', 'brion_inst', 0, ['p2']);
    // Both players pass priority (hasPriorityPassed both true) to trigger resolution
    s = { ...s, hasPriorityPassed: [true, true] };
    s = resolveTopOfStack(s);
    // p2 should have lost 4 life (40 → 36)
    const p2 = s.players.find(p => p.id === 'p2')!;
    expect(p2.life).toBe(36);
  });

  it('resolves explicit life-gain form: deals 4 damage + gain 4 life', () => {
    // Use explicit life-gain Brion oracle
    const s0 = makeState({ extraCreaturePower: 4 });
    // Replace Brion's oracle text with the explicit lifegain version
    const brionDef = s0.cardDefinitions.get('brion')!;
    s0.cardDefinitions.set('brion', { ...brionDef, oracle_text: BRION_EXPLICIT_LIFEGAIN });

    let s = activateAbility(s0, 'p1', 'brion_inst', 0, ['p2']);
    s = { ...s, hasPriorityPassed: [true, true] };
    s = resolveTopOfStack(s);

    const p1 = s.players.find(p => p.id === 'p1')!;
    const p2 = s.players.find(p => p.id === 'p2')!;
    expect(p2.life).toBe(36); // 40 - 4 damage
    expect(p1.life).toBe(44); // 40 + 4 life
  });

  it('selects highest-power creature when multiple fodder exist', () => {
    // Two creatures: 2/2 and 6/6; Brion should sacrifice the 6/6
    const s = makeState({
      extraCreatures: [
        { power: 2, toughness: 2 },
        { power: 6, toughness: 6 },
      ],
    });
    let after = activateAbility(s, 'p1', 'brion_inst', 0, ['p2']);
    after = { ...after, hasPriorityPassed: [true, true] };
    after = resolveTopOfStack(after);
    // p2 should have lost 6 life
    const p2 = after.players.find(p => p.id === 'p2')!;
    expect(p2.life).toBe(34); // 40 - 6
    // 6/6 (fodder_inst_1) should be in graveyard, 2/2 (fodder_inst_0) still on battlefield
    expect(after.cards.get('fodder_inst_1')?.zone).toBe('graveyard');
    expect(after.cards.get('fodder_inst_0')?.zone).toBe('battlefield');
  });

  it('Brion himself is tapped after activation', () => {
    const s = makeState({ extraCreaturePower: 3 });
    const after = activateAbility(s, 'p1', 'brion_inst', 0, ['p2']);
    expect(after.cards.get('brion_inst')?.tapped).toBe(true);
  });
});
