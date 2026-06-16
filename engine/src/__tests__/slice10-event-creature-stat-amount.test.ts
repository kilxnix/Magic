/**
 * slice10-event-creature-stat-amount.test.ts
 *
 * Slice 10/12 — EventCreatureStat AmountRef: "equal to that creature's toughness/power"
 *
 * Covers parsing and execution of effects whose amount references the live P/T
 * of the creature involved in the triggering event.
 *
 * Cards / oracle patterns covered:
 *   - Archon of Redemption — "Whenever a creature with flying enters the battlefield
 *       under your control, you gain life equal to that creature's toughness."
 *   - Abattoir Ghoul — "Whenever a creature an opponent controls dies, you gain life
 *       equal to that creature's toughness."
 *   - Verdant Sun's Avatar — "Whenever this creature or another Dinosaur you control
 *       enters, you gain life equal to that creature's toughness."
 *   - Creature Bond style — "~ deals damage to that creature equal to that
 *       creature's toughness."
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import type { GainLifeEffect, DealDamageEffect, TriggeredAbility } from '../effects/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCreatureDef(
  id: string,
  power: number,
  toughness: number,
  oracle = '',
  subtypes: string[] = [],
): CardDefinition {
  const subtypeStr = subtypes.length ? ` — ${subtypes.join(' ')}` : '';
  return {
    id,
    name: id,
    type_line: `Creature${subtypeStr}`,
    oracle_text: oracle,
    mana_cost: '{3}{W}',
    cmc: 4,
    colors: ['W'],
    color_identity: ['W'],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
  };
}

function baseState(defs: CardDefinition[]): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map<string, CardInstance>(),
    cardDefinitions: new Map(defs.map(d => [d.id, d])),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

function addCard(
  s: GameState,
  instanceId: string,
  definitionId: string,
  zone: CardInstance['zone'] = 'battlefield',
  ownerId = 'p0',
): void {
  s.cards.set(instanceId, {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
}

// ---------------------------------------------------------------------------
// Parse tests
// ---------------------------------------------------------------------------

describe('Slice 10 — parse: GainLife with EventCreatureStat (toughness)', () => {
  it('parses Archon of Redemption / Verdant Sun\'s Avatar style — GainLife with EventCreatureStat{toughness}', () => {
    // "Whenever a creature enters the battlefield under your control" is a recognized prefix.
    const result = parseOracleText(
      'Whenever a creature enters the battlefield under your control, you gain life equal to that creature\'s toughness.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as GainLifeEffect;
    expect(eff.kind).toBe('GainLife');
    expect(eff.player.kind).toBe('Controller');
    expect(typeof eff.amount).toBe('object');
    if (typeof eff.amount === 'object') {
      expect((eff.amount as { kind: string }).kind).toBe('EventCreatureStat');
      expect((eff.amount as { kind: string; stat: string }).stat).toBe('toughness');
    }
  });

  it('parses Abattoir Ghoul style — "you gain life equal to that creature\'s toughness"', () => {
    // "Whenever a creature an opponent controls dies" is a recognized prefix (matchOtherCreatureDiesPrefix).
    const result = parseOracleText(
      'Whenever a creature an opponent controls dies, you gain life equal to that creature\'s toughness.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as GainLifeEffect;
    expect(eff.kind).toBe('GainLife');
    expect(eff.player.kind).toBe('Controller');
    if (typeof eff.amount === 'object') {
      expect((eff.amount as { kind: string }).kind).toBe('EventCreatureStat');
      expect((eff.amount as { kind: string; stat: string }).stat).toBe('toughness');
    }
  });

  it('parses "you gain life equal to that creature\'s power" (stat=power variant)', () => {
    // Uses the same recognized "creature you control enters" prefix.
    const result = parseOracleText(
      'Whenever a creature enters the battlefield under your control, you gain life equal to that creature\'s power.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as GainLifeEffect;
    expect(eff.kind).toBe('GainLife');
    if (typeof eff.amount === 'object') {
      expect((eff.amount as { kind: string }).kind).toBe('EventCreatureStat');
      expect((eff.amount as { kind: string; stat: string }).stat).toBe('power');
    }
  });
});

describe('Slice 10 — parse: DealDamage with EventCreatureStat (Creature Bond style)', () => {
  it('parses "~ deals damage to that creature equal to that creature\'s toughness" as DealDamage/EventCreature/EventCreatureStat', () => {
    // "Whenever another creature dies" is a recognized prefix (matchOtherCreatureDiesPrefix).
    // The body "~ deals damage to that creature equal to that creature's toughness" uses
    // matchDealDamageEqualTo with EventCreature target and EventCreatureStat amount.
    const result = parseOracleText(
      '~ deals damage to that creature equal to that creature\'s toughness.',
    );
    // This is a bare effect clause (spell effect), not a trigger; verify parse succeeds.
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0] as DealDamageEffect;
    expect(eff.kind).toBe('DealDamage');
    expect(eff.target.kind).toBe('EventCreature');
    if (typeof eff.amount === 'object') {
      expect((eff.amount as { kind: string }).kind).toBe('EventCreatureStat');
      expect((eff.amount as { kind: string; stat: string }).stat).toBe('toughness');
    }
  });

  it('parses "~ deals damage to that creature equal to that creature\'s power" (power variant)', () => {
    const result = parseOracleText(
      '~ deals damage to that creature equal to that creature\'s power.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0] as DealDamageEffect;
    expect(eff.kind).toBe('DealDamage');
    expect(eff.target.kind).toBe('EventCreature');
    if (typeof eff.amount === 'object') {
      expect((eff.amount as { kind: string }).kind).toBe('EventCreatureStat');
      expect((eff.amount as { kind: string; stat: string }).stat).toBe('power');
    }
  });
});

// ---------------------------------------------------------------------------
// Execution tests
// ---------------------------------------------------------------------------

describe('Slice 10 — execute: GainLife with EventCreatureStat reads event creature P/T', () => {
  it('controller gains life equal to the triggering creature\'s printed toughness (Archon of Redemption style)', () => {
    // EventCreatureStat resolves via eventContext.cardInstanceId → getEffectiveToughness.
    const archonDef = makeCreatureDef('archon', 3, 4);
    const angelDef = makeCreatureDef('angel', 2, 3); // toughness = 3

    const state = baseState([archonDef, angelDef]);
    addCard(state, 'archon_1', 'archon');
    addCard(state, 'angel_1', 'angel');

    const gainLifeEffect = {
      kind: 'GainLife' as const,
      player: { kind: 'Controller' as const },
      amount: { kind: 'EventCreatureStat' as const, stat: 'toughness' as const },
    };

    // eventContext.cardInstanceId points to the entering creature (angel_1, toughness=3)
    const nextState = executeEffects(
      state,
      [gainLifeEffect],
      'p0',
      [],
      [],
      0,
      {
        eventContext: { cardInstanceId: 'angel_1' },
      },
    );

    const p0 = nextState.players.find(p => p.id === 'p0')!;
    // Starting at 40; gains 3 (angel's toughness).
    expect(p0.life).toBe(43);
  });

  it('controller gains life equal to power when stat=power', () => {
    const creatureDef = makeCreatureDef('brute', 5, 2); // power = 5

    const state = baseState([creatureDef]);
    addCard(state, 'brute_1', 'brute');

    const gainLifeEffect = {
      kind: 'GainLife' as const,
      player: { kind: 'Controller' as const },
      amount: { kind: 'EventCreatureStat' as const, stat: 'power' as const },
    };

    const nextState = executeEffects(
      state,
      [gainLifeEffect],
      'p0',
      [],
      [],
      0,
      {
        eventContext: { cardInstanceId: 'brute_1' },
      },
    );

    const p0 = nextState.players.find(p => p.id === 'p0')!;
    expect(p0.life).toBe(45); // 40 + 5 (power)
  });

  it('falls back to 0 when there is no event context (no-op)', () => {
    const creatureDef = makeCreatureDef('beast', 4, 6);
    const state = baseState([creatureDef]);

    const gainLifeEffect = {
      kind: 'GainLife' as const,
      player: { kind: 'Controller' as const },
      amount: { kind: 'EventCreatureStat' as const, stat: 'toughness' as const },
    };

    // No eventContext passed — should resolve to 0 and not crash.
    const nextState = executeEffects(
      state,
      [gainLifeEffect],
      'p0',
      [],
      [],
      0,
      {},
    );

    const p0 = nextState.players.find(p => p.id === 'p0')!;
    expect(p0.life).toBe(40); // unchanged
  });
});

describe('Slice 10 — execute: DealDamage with EventCreatureStat reads event creature P/T', () => {
  it('deals damage to EventCreature equal to its toughness (Creature Bond style)', () => {
    const sourceDef = makeCreatureDef('source', 1, 1);
    const targetDef = makeCreatureDef('target-creature', 3, 5); // toughness = 5

    const state = baseState([sourceDef, targetDef]);
    addCard(state, 'source_1', 'source');
    addCard(state, 'target_1', 'target-creature', 'battlefield', 'p1');

    const dealDamageEffect = {
      kind: 'DealDamage' as const,
      target: { kind: 'EventCreature' as const },
      amount: { kind: 'EventCreatureStat' as const, stat: 'toughness' as const },
    };

    // eventContext.cardInstanceId = target_1 (the triggering creature, toughness=5)
    const nextState = executeEffects(
      state,
      [dealDamageEffect],
      'p0',
      [],
      [],
      0,
      {
        eventContext: { cardInstanceId: 'target_1' },
      },
    );

    // The creature (5/5 base) should have taken 5 damage.
    const targetCard = nextState.cards.get('target_1')!;
    expect(targetCard.damage).toBe(5);
  });
});
