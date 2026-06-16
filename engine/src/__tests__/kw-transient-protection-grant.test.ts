/**
 * Slice 11: transient protection grant — parse + execute + enforce tests.
 *
 * Verifies:
 *   (1) Parser: "target creature gains protection from <color> until end of turn"
 *       and mass forms parse as Spell/GrantKeyword (not Unparsed).
 *   (2) Executor: executeEffects writes the protection clause into grantedKeywords.
 *   (3) Enforcement: protectionClausesFor (keywords.ts) now harvests grantedKeywords,
 *       so isProtectedFromSource / canBlock / getProtectionColors are genuinely
 *       enforced for transiently granted protection — the honesty bar.
 *   (4) Honesty: "protection from the color of your choice" and "protection from
 *       the chosen color" remain Unparsed (no choice-at-cast infrastructure).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { isProtectedFromSource, canBlock, getProtectionColors } from '../keywords';
import type { Effect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDef(
  id: string,
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G'>,
  oracle = '',
  card_types: string[] = ['creature'],
): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Test',
    oracle_text: oracle,
    mana_cost: '{1}',
    cmc: 1,
    colors,
    color_identity: colors,
    keywords: [],
    card_types,
    power: 2,
    toughness: 2,
  } as CardDefinition;
}

function makeCard(instanceId: string, definitionId: string, ownerId: string): CardInstance {
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

  // p1 controls a white creature (the protected one) + a red creature (the attacker).
  // p2 controls a red creature (the would-be blocker/source).
  cardDefinitions.set('def-white-creature', makeDef('def-white-creature', ['W']));
  cardDefinitions.set('def-red-attacker', makeDef('def-red-attacker', ['R']));
  cardDefinitions.set('def-red-source', makeDef('def-red-source', ['R']));
  cardDefinitions.set('def-green-source', makeDef('def-green-source', ['G']));

  cards.set('white-1', makeCard('white-1', 'def-white-creature', 'p1'));
  cards.set('red-atk', makeCard('red-atk', 'def-red-attacker', 'p1'));
  cards.set('red-src', makeCard('red-src', 'def-red-source', 'p2'));
  cards.set('green-src', makeCard('green-src', 'def-green-source', 'p2'));

  const players = [
    { id: 'p1', name: 'Alice', life: 40, poisonCounters: 0, commanderDamage: {}, commanderTax: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, hasPlayedLand: false, hasPriority: true, hasLost: false },
    { id: 'p2', name: 'Bob', life: 40, poisonCounters: 0, commanderDamage: {}, commanderTax: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, hasPlayedLand: false, hasPriority: false, hasLost: false },
  ];

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

// ── Section 1: Parser recognition ──────────────────────────────────────────

describe('Slice 11 — transient protection grant: parser', () => {
  it('parses "target creature gains protection from white until end of turn" as Spell', () => {
    const result = parseOracleText('Target creature gains protection from white until end of turn.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].kind).toBe('GrantKeyword');
    if (result.effects[0].kind !== 'GrantKeyword') return;
    expect(result.effects[0].keyword).toBe('protection from white');
    expect(result.effects[0].untilEndOfTurn).toBe(true);
    expect(result.targets).toHaveLength(1);
  });

  it('parses "target creature gains protection from red until end of turn" as Spell', () => {
    // Goblin Chieftain-style activated body
    const result = parseOracleText('Target creature gains protection from red until end of turn.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects[0].kind).toBe('GrantKeyword');
    if (result.effects[0].kind !== 'GrantKeyword') return;
    expect(result.effects[0].keyword).toBe('protection from red');
  });

  it('parses "target creature you control gains protection from blue until end of turn"', () => {
    const result = parseOracleText(
      'Target creature you control gains protection from blue until end of turn.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects[0].kind).toBe('GrantKeyword');
    if (result.effects[0].kind !== 'GrantKeyword') return;
    expect(result.effects[0].keyword).toBe('protection from blue');
    // Controller constraint present
    expect(result.targets[0]?.constraints?.controllerControls).toBe(true);
  });

  it('parses "white creatures you control gain protection from black until end of turn" (Brave the Elements style)', () => {
    const result = parseOracleText(
      'White creatures you control gain protection from black until end of turn.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects[0].kind).toBe('GrantKeyword');
    if (result.effects[0].kind !== 'GrantKeyword') return;
    expect(result.effects[0].keyword).toBe('protection from black');
    // Mass target, no per-spell target choices
    expect(result.targets).toHaveLength(0);
  });

  it('parses "creatures you control gain protection from green until end of turn" (mass form)', () => {
    const result = parseOracleText(
      'Creatures you control gain protection from green until end of turn.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects[0].kind).toBe('GrantKeyword');
  });

  it('parses inside a triggered body (ETB / activated)', () => {
    // Pentarch Paladin-style activated ability body parsed as an activated sub-clause
    const result = parseOracleText(
      'When this creature enters, target creature you control gains protection from red until end of turn.',
    );
    expect(result.kind).toBe('ETB');
  });

  // HONESTY: declined forms
  it.each([
    'Target creature gains protection from the color of your choice until end of turn.',
    'Target creature gains protection from the chosen color until end of turn.',
    'Target creature gains protection from everything until end of turn.',
    'Target creature gains protection from Dragons until end of turn.',
  ])('does NOT parse unenforced form: %s', (text) => {
    const result = parseOracleText(text);
    // Must NOT be a clean Spell with a GrantKeyword effect for protection.
    // It may parse as something else (e.g. Unparsed) but must not claim protection enforcement.
    if (result.kind === 'Spell') {
      // If it somehow parsed, verify it is NOT emitting a protection-from-X keyword.
      for (const eff of result.effects) {
        if (eff.kind === 'GrantKeyword') {
          expect(eff.keyword).not.toMatch(/^protection from/);
        }
      }
    }
  });
});

// ── Section 2: Executor ─────────────────────────────────────────────────────

describe('Slice 11 — transient protection grant: executor', () => {
  it('stores "protection from red" in grantedKeywords of the chosen target creature', () => {
    const state = makeState();
    // Use parseOracleText to get a proper spec/effect pair, then execute with a chosen target.
    const parsed = parseOracleText('Target creature gains protection from red until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const specId = parsed.targets[0].id;

    const result = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['white-1'],
      [{ id: specId }],
    );
    const granted = result.cards.get('white-1')?.grantedKeywords ?? [];
    expect(granted).toContain('protection from red');
  });

  it('stores mass protection for AllCreaturesYouControl', () => {
    const state = makeState();
    const effects: Effect[] = [
      {
        kind: 'GrantKeyword',
        target: { kind: 'AllCreaturesYouControl' },
        keyword: 'protection from red',
        untilEndOfTurn: true,
      },
    ];
    const result = executeEffects(state, effects, 'p1', [], []);
    // p1's creatures get the keyword
    expect(result.cards.get('white-1')?.grantedKeywords ?? []).toContain('protection from red');
    expect(result.cards.get('red-atk')?.grantedKeywords ?? []).toContain('protection from red');
    // p2's creatures do NOT
    expect(result.cards.get('red-src')?.grantedKeywords ?? []).not.toContain('protection from red');
  });
});

// ── Section 3: Enforcement (the honesty bar) ───────────────────────────────

describe('Slice 11 — transient protection grant: enforcement via grantedKeywords', () => {
  it('isProtectedFromSource returns true for a creature with transient protection from red', () => {
    const state = makeState();
    // Manually set grantedKeywords on white-1 to simulate the executor result.
    const updatedCards = new Map(state.cards);
    updatedCards.set('white-1', {
      ...state.cards.get('white-1')!,
      grantedKeywords: ['protection from red'],
    });
    const testState = { ...state, cards: updatedCards };

    // white-1 has protection from red; red-src is red.
    expect(isProtectedFromSource(testState, 'white-1', 'red-src')).toBe(true);
    // green-src is green, not red — no protection triggers.
    expect(isProtectedFromSource(testState, 'white-1', 'green-src')).toBe(false);
  });

  it('canBlock is false when attacker has transient protection from red (red blocker)', () => {
    // Attacker = white-1 with granted protection from red
    // Blocker  = red-src
    const state = makeState();
    const updatedCards = new Map(state.cards);
    updatedCards.set('white-1', {
      ...state.cards.get('white-1')!,
      grantedKeywords: ['protection from red'],
    });
    const testState: GameState = {
      ...state,
      cards: updatedCards,
      phase: 'combat',
      step: 'declare_attackers',
      combat: {
        attackers: [{ cardInstanceId: 'white-1', defendingPlayerId: 'p2' }],
        blockers: [],
        damageMap: {},
        luredCreatureIds: [],
      },
    };
    // red-src (red blocker) cannot block white-1 (protected from red).
    expect(canBlock(testState, 'red-src', 'white-1')).toBe(false);
    // green-src (green blocker) can still block.
    expect(canBlock(testState, 'green-src', 'white-1')).toBe(true);
  });

  it('getProtectionColors returns the granted color', () => {
    const state = makeState();
    const updatedCards = new Map(state.cards);
    updatedCards.set('white-1', {
      ...state.cards.get('white-1')!,
      grantedKeywords: ['protection from green'],
    });
    const testState = { ...state, cards: updatedCards };

    const colors = getProtectionColors(testState, 'white-1');
    expect(colors.has('G')).toBe(true);
    expect(colors.has('R')).toBe(false);
  });

  it('parse + execute + enforce: full end-to-end for "target creature gains protection from red"', () => {
    const state = makeState();
    const parsed = parseOracleText('Target creature gains protection from red until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // Execute with white-1 as the chosen target.
    const specId = parsed.targets[0].id;
    const result = executeEffects(
      state,
      parsed.effects,
      'p1',
      ['white-1'],
      [{ id: specId }],
    );

    // Verify grantedKeywords was set.
    expect(result.cards.get('white-1')?.grantedKeywords ?? []).toContain('protection from red');

    // Verify enforcement: red source cannot target/block white-1.
    expect(isProtectedFromSource(result, 'white-1', 'red-src')).toBe(true);
    expect(isProtectedFromSource(result, 'white-1', 'green-src')).toBe(false);
  });
});
