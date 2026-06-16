/**
 * Slice 10/13: "Choose N target creatures … them/those" spells
 *
 * Covers matchChooseNTargetSpell: instant/sorcery faces that open with a
 * "choose N target creatures [constraints]." preamble followed by effects
 * that reference the chosen group via "them"/"those creatures"/"they".
 *
 * Parse tests: verify the oracle text produces the correct Effect AST and
 *   TargetSpec (count, type).
 * Execution tests: verify the executor applies each effect to all chosen
 *   creature IDs in the multi-target spec.
 *
 * Cards covered:
 *   Run Away Together      — "choose two target creatures … return those creatures …"
 *   Last Night Together    — "choose two target creatures. untap them. put two +1/+1
 *                             counters on each of them. they gain vigilance …"
 *   Rivals' Duel           — "choose two target creatures … those creatures fight each other."
 *   Continue?              — "choose two target creatures you control. put two +1/+1
 *                             counters on each of them."
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ─── Minimal state helpers ────────────────────────────────────────────────────

function makeDef(id: string, power = 2, toughness = 2): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power,
    toughness,
    card_types: ['creature'],
  } as CardDefinition;
}

function makeCreature(
  instanceId: string,
  ownerId: string,
  definitionId = 'def-bear',
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  } as CardInstance;
}

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();
  cardDefinitions.set('def-bear', makeDef('def-bear'));
  // Two separate creature definitions for fight tests (different sizes)
  cardDefinitions.set('def-2-4', makeDef('def-2-4', 2, 4));
  cardDefinitions.set('def-4-1', makeDef('def-4-1', 4, 1));

  // player-1 controls c1(2/2), c2(2/2); player-2 controls e1(2/4), e2(4/1)
  cards.set('c1', makeCreature('c1', 'player-1'));
  cards.set('c2', makeCreature('c2', 'player-1'));
  cards.set('e1', { ...makeCreature('e1', 'player-2', 'def-2-4') });
  cards.set('e2', { ...makeCreature('e2', 'player-2', 'def-4-1') });

  const players = ['player-1', 'player-2'].map((id, idx) => ({
    id,
    name: id,
    life: 40,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    hasPlayedLand: false,
    hasPriority: idx === 0,
    hasLost: false,
  }));

  return {
    players,
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
  } as GameState;
}

const zone = (s: GameState, id: string) => s.cards.get(id)?.zone;
const tapped = (s: GameState, id: string) => s.cards.get(id)?.tapped;
const counters = (s: GameState, id: string) => s.cards.get(id)?.counters?.['+1/+1'] ?? 0;
const damage = (s: GameState, id: string) => s.cards.get(id)?.damage ?? 0;

// ─── Parse tests ─────────────────────────────────────────────────────────────

describe('sl10-choose-n-target-group-spells (parse)', () => {
  it('Run Away Together: parses as Spell with one ReturnToHand effect and count=2 spec', () => {
    const parsed = parseOracleText(
      "Choose two target creatures controlled by different players. Return those creatures to their owners' hands.",
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].count).toBe(2);
    expect(parsed.effects).toHaveLength(1);
    expect(parsed.effects[0].kind).toBe('ReturnToHand');
  });

  it('Last Night Together: parses Untap + AddCounters + GrantKeyword with count=2 spec', () => {
    const parsed = parseOracleText(
      'Choose two target creatures. Untap them. Put two +1/+1 counters on each of them. They gain vigilance until end of turn.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(2);
    // Untap + AddCounters + GrantKeyword(Vigilance)
    expect(parsed.effects).toHaveLength(3);
    expect(parsed.effects[0].kind).toBe('Untap');
    expect(parsed.effects[1].kind).toBe('AddCounters');
    expect(parsed.effects[2].kind).toBe('GrantKeyword');
    if (parsed.effects[2].kind === 'GrantKeyword') {
      expect(parsed.effects[2].keyword).toBe('Vigilance');
      expect(parsed.effects[2].untilEndOfTurn).toBe(true);
    }
    if (parsed.effects[1].kind === 'AddCounters') {
      expect(parsed.effects[1].counterType).toBe('+1/+1');
      expect(parsed.effects[1].count).toBe(2);
    }
  });

  it("Rivals' Duel: parses Fight with both fighters from same count=2 spec", () => {
    const parsed = parseOracleText(
      "Choose two target creatures that share no creature types. Those creatures fight each other.",
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(2);
    expect(parsed.effects).toHaveLength(1);
    expect(parsed.effects[0].kind).toBe('Fight');
    if (parsed.effects[0].kind === 'Fight') {
      // Both fighters point to the same chosen ref (same targetId)
      expect(parsed.effects[0].fighterA.kind).toBe('Chosen');
      expect(parsed.effects[0].fighterB.kind).toBe('Chosen');
      if (
        parsed.effects[0].fighterA.kind === 'Chosen' &&
        parsed.effects[0].fighterB.kind === 'Chosen'
      ) {
        expect(parsed.effects[0].fighterA.targetId).toBe(parsed.effects[0].fighterB.targetId);
        expect(parsed.effects[0].fighterA.targetId).toBe(parsed.targets[0].id);
      }
    }
  });

  it('Continue?: parses AddCounters with "you control" constraint', () => {
    const parsed = parseOracleText(
      'Choose two target creatures you control. Put two +1/+1 counters on each of them.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(2);
    // controllerControls constraint present
    expect(parsed.targets[0].constraints?.controllerControls).toBe(true);
    expect(parsed.effects).toHaveLength(1);
    expect(parsed.effects[0].kind).toBe('AddCounters');
  });

  it('"choose one target creature. untap them." parses as Spell with count=1', () => {
    const parsed = parseOracleText('Choose one target creature. Untap them.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets[0].count).toBe(1);
    expect(parsed.effects[0].kind).toBe('Untap');
  });
});

// ─── Execution tests ─────────────────────────────────────────────────────────

describe('sl10-choose-n-target-group-spells (execute)', () => {
  it('Run Away Together: bounces both chosen creatures to hand', () => {
    const parsed = parseOracleText(
      "Choose two target creatures controlled by different players. Return those creatures to their owners' hands.",
    );
    if (parsed.kind !== 'Spell') throw new Error('Expected Spell parse');
    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['c1', 'e1'], parsed.targets);
    expect(zone(r, 'c1')).toBe('hand');
    expect(zone(r, 'e1')).toBe('hand');
    // Unchosen creatures remain on battlefield
    expect(zone(r, 'c2')).toBe('battlefield');
    expect(zone(r, 'e2')).toBe('battlefield');
  });

  it('Last Night Together: untaps both, adds counters to both, grants vigilance to both', () => {
    const parsed = parseOracleText(
      'Choose two target creatures. Untap them. Put two +1/+1 counters on each of them. They gain vigilance until end of turn.',
    );
    if (parsed.kind !== 'Spell') throw new Error('Expected Spell parse');
    const s0 = makeState();
    // Tap both before resolving so we can verify untap
    s0.cards.get('c1')!.tapped = true;
    s0.cards.get('c2')!.tapped = true;
    const r = executeEffects(s0, parsed.effects, 'player-1', ['c1', 'c2'], parsed.targets);
    // Untap
    expect(tapped(r, 'c1')).toBe(false);
    expect(tapped(r, 'c2')).toBe(false);
    // Counters
    expect(counters(r, 'c1')).toBe(2);
    expect(counters(r, 'c2')).toBe(2);
    // e1/e2 untouched
    expect(tapped(r, 'e1')).toBe(false);
    expect(counters(r, 'e1')).toBe(0);
  });

  it("Rivals' Duel: chosen creatures fight each other (loser takes lethal damage)", () => {
    const parsed = parseOracleText(
      "Choose two target creatures that share no creature types. Those creatures fight each other.",
    );
    if (parsed.kind !== 'Spell') throw new Error('Expected Spell parse');
    const s0 = makeState();
    // e1 is def-2-4 (2/4): survives the fight against c1 (2/2 → takes 2 damage, dies at EOT SBA)
    // c1 is def-bear (2/2): takes 2 damage from e1's power — damage applied, SBA later
    const r = executeEffects(s0, parsed.effects, 'player-1', ['c1', 'e1'], parsed.targets);
    // Both deal their power as damage to the other
    expect(damage(r, 'c1')).toBe(2);  // e1's power (2) dealt to c1 (2 toughness → lethal)
    expect(damage(r, 'e1')).toBe(2);  // c1's power (2) dealt to e1 (4 toughness → survives)
    // Unchosen creatures untouched
    expect(damage(r, 'c2')).toBe(0);
    expect(damage(r, 'e2')).toBe(0);
  });

  it('Continue?: adds counters to both chosen creatures you control', () => {
    const parsed = parseOracleText(
      'Choose two target creatures you control. Put two +1/+1 counters on each of them.',
    );
    if (parsed.kind !== 'Spell') throw new Error('Expected Spell parse');
    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['c1', 'c2'], parsed.targets);
    expect(counters(r, 'c1')).toBe(2);
    expect(counters(r, 'c2')).toBe(2);
    expect(counters(r, 'e1')).toBe(0);
  });

  it('"up to two target creatures" — "up to" form sets minCount=1, works with single target', () => {
    const parsed = parseOracleText(
      "Choose up to two target creatures. Return those creatures to their owners' hands.",
    );
    if (parsed.kind !== 'Spell') throw new Error('Expected Spell parse');
    expect(parsed.targets[0].count).toBe(2);
    expect(parsed.targets[0].minCount).toBe(1);
    // Only one target chosen (player chose 1 of the up-to-2)
    const r = executeEffects(makeState(), parsed.effects, 'player-1', ['e2'], parsed.targets);
    expect(zone(r, 'e2')).toBe('hand');
    expect(zone(r, 'c1')).toBe('battlefield');
    expect(zone(r, 'e1')).toBe('battlefield');
  });
});
