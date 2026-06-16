import { describe, it, expect } from 'vitest';
import { executeEffects } from '../effects/executor';
import { parseOracleText } from '../effects/parser';
import { cleanupDamage } from '../state-based';
import type { Effect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

/**
 * Slice 7 — Heroic Intervention / mass permanent grants.
 *
 * "Permanents you control gain hexproof and indestructible until end of turn."
 *
 * Tests cover:
 *   1. Parser recognises the oracle wording and emits correct AST (AllOfType,
 *      controllerControls: true, both keywords).
 *   2. Executor applies both keywords ONLY to the caster's permanents — not to
 *      opponent permanents and not only to creatures (lands/artifacts too).
 *   3. A targeted destroy/damage cannot kill protected permanents that turn:
 *      Indestructible skips executeDestroy; Hexproof rejects targeted effects.
 *   4. UEOT cleanup (cleanupDamage) clears both keywords next turn.
 *   5. "each permanent you control gains ..." (alternate wording) also parses.
 */

// ── helpers ──────────────────────────────────────────────────────────────────

function makeDef(
  id: string,
  name: string,
  type_line: string,
  card_types: string[],
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = [],
): CardDefinition {
  return {
    id,
    name,
    type_line,
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors,
    color_identity: colors,
    keywords: [],
    card_types,
  } as CardDefinition;
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: 'battlefield' | 'hand' | 'graveyard' = 'battlefield',
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
  } as CardInstance;
}

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  // Player-1 permanents: a creature, an artifact, a land, an enchantment
  cardDefinitions.set('def-creature', makeDef('def-creature', 'Grizzly Bears', 'Creature — Bear', ['creature'], ['G']));
  cardDefinitions.set('def-artifact', makeDef('def-artifact', 'Sol Ring', 'Artifact', ['artifact'], []));
  cardDefinitions.set('def-land', makeDef('def-land', 'Forest', 'Basic Land — Forest', ['land'], ['G']));
  cardDefinitions.set('def-enchantment', makeDef('def-enchantment', 'Utopia Sprawl', 'Enchantment — Aura', ['enchantment'], ['G']));

  // Player-2 permanents: a creature and a land
  cardDefinitions.set('def-opp-creature', makeDef('def-opp-creature', 'Goblin Raider', 'Creature — Goblin', ['creature'], ['R']));
  cardDefinitions.set('def-opp-land', makeDef('def-opp-land', 'Mountain', 'Basic Land — Mountain', ['land'], ['R']));

  cards.set('p1-creature', makeCard('p1-creature', 'def-creature', 'player-1'));
  cards.set('p1-artifact', makeCard('p1-artifact', 'def-artifact', 'player-1'));
  cards.set('p1-land', makeCard('p1-land', 'def-land', 'player-1'));
  cards.set('p1-enchantment', makeCard('p1-enchantment', 'def-enchantment', 'player-1'));

  cards.set('p2-creature', makeCard('p2-creature', 'def-opp-creature', 'player-2'));
  cards.set('p2-land', makeCard('p2-land', 'def-opp-land', 'player-2'));

  const playerIds = ['player-1', 'player-2'];
  const players = playerIds.map((id, idx) => ({
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

function grantedKeywords(state: GameState, id: string): string[] {
  return state.cards.get(id)?.grantedKeywords ?? [];
}

// ── parse tests ───────────────────────────────────────────────────────────────

describe('heroic-intervention: parse', () => {
  it('parses the Heroic Intervention oracle wording into two GrantKeyword effects', () => {
    const result = parseOracleText(
      'Permanents you control gain hexproof and indestructible until end of turn.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    // Should produce exactly two effects (one per keyword)
    expect(result.effects).toHaveLength(2);

    for (const eff of result.effects) {
      expect(eff.kind).toBe('GrantKeyword');
      if (eff.kind !== 'GrantKeyword') continue;
      expect(eff.target.kind).toBe('AllOfType');
      if (eff.target.kind !== 'AllOfType') continue;
      expect(eff.target.controllerControls).toBe(true);
      // Empty filter = any permanent type
      expect(eff.target.filter.types).toBeUndefined();
      expect(eff.untilEndOfTurn).toBe(true);
    }

    const keywords = result.effects
      .filter(e => e.kind === 'GrantKeyword')
      .map(e => (e as { keyword: string }).keyword);
    expect(keywords).toContain('Hexproof');
    expect(keywords).toContain('Indestructible');
    expect(result.targets).toHaveLength(0);
  });

  it('parses the single-keyword variant: "permanents you control gain hexproof until end of turn"', () => {
    const result = parseOracleText(
      'Permanents you control gain hexproof until end of turn.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0];
    expect(eff.kind).toBe('GrantKeyword');
    if (eff.kind !== 'GrantKeyword') return;
    expect(eff.target.kind).toBe('AllOfType');
    if (eff.target.kind !== 'AllOfType') return;
    expect(eff.target.controllerControls).toBe(true);
    expect(eff.keyword).toBe('Hexproof');
  });

  it('parses the "each permanent you control gains ..." alternate wording', () => {
    const result = parseOracleText(
      'Each permanent you control gains hexproof and indestructible until end of turn.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(2);
    for (const eff of result.effects) {
      expect(eff.kind).toBe('GrantKeyword');
      if (eff.kind !== 'GrantKeyword') continue;
      expect(eff.target.kind).toBe('AllOfType');
      if (eff.target.kind !== 'AllOfType') continue;
      expect(eff.target.controllerControls).toBe(true);
    }
  });
});

// ── execution tests ───────────────────────────────────────────────────────────

describe('heroic-intervention: execution', () => {
  it('grants hexproof and indestructible to ALL of the caster\'s permanents (creature, artifact, land, enchantment)', () => {
    const state = makeState();
    const effects: Effect[] = [
      { kind: 'GrantKeyword', target: { kind: 'AllOfType', filter: {}, controllerControls: true }, keyword: 'Hexproof', untilEndOfTurn: true },
      { kind: 'GrantKeyword', target: { kind: 'AllOfType', filter: {}, controllerControls: true }, keyword: 'Indestructible', untilEndOfTurn: true },
    ];
    const result = executeEffects(state, effects, 'player-1', [], []);

    // All player-1 permanents gain both keywords
    for (const id of ['p1-creature', 'p1-artifact', 'p1-land', 'p1-enchantment']) {
      expect(grantedKeywords(result, id)).toContain('Hexproof');
      expect(grantedKeywords(result, id)).toContain('Indestructible');
    }
  });

  it('does NOT grant the keyword to opponent permanents', () => {
    const state = makeState();
    const effects: Effect[] = [
      { kind: 'GrantKeyword', target: { kind: 'AllOfType', filter: {}, controllerControls: true }, keyword: 'Indestructible', untilEndOfTurn: true },
    ];
    const result = executeEffects(state, effects, 'player-1', [], []);

    expect(grantedKeywords(result, 'p2-creature')).not.toContain('Indestructible');
    expect(grantedKeywords(result, 'p2-land')).not.toContain('Indestructible');
  });

  it('indestructible protects permanents from targeted destroy effect', () => {
    const state = makeState();
    // First grant indestructible to player-1's permanents
    const grantEffects: Effect[] = [
      { kind: 'GrantKeyword', target: { kind: 'AllOfType', filter: {}, controllerControls: true }, keyword: 'Indestructible', untilEndOfTurn: true },
    ];
    const granted0 = executeEffects(state, grantEffects, 'player-1', [], []);

    // Now attempt destroy on p1-creature — it should survive (still on battlefield).
    // executeEffects signature: (state, effects, casterId, chosenTargetIds, targetSpecs)
    const destroyEffects: Effect[] = [
      { kind: 'Destroy', target: { kind: 'Chosen', targetId: 'spec-destroy-1' } },
    ];
    const afterDestroy = executeEffects(
      granted0,
      destroyEffects,
      'player-2',
      ['p1-creature'],
      [{ id: 'spec-destroy-1', count: 1 }],
    );
    expect(afterDestroy.cards.get('p1-creature')?.zone).toBe('battlefield');

    // But opponent's creature (not protected) should die normally
    const destroyOpp: Effect[] = [
      { kind: 'Destroy', target: { kind: 'Chosen', targetId: 'spec-destroy-2' } },
    ];
    const afterDestroyOpp = executeEffects(
      granted0,
      destroyOpp,
      'player-1',
      ['p2-creature'],
      [{ id: 'spec-destroy-2', count: 1 }],
    );
    // p2-creature is not indestructible — it moves to graveyard
    expect(afterDestroyOpp.cards.get('p2-creature')?.zone).not.toBe('battlefield');
  });

  it('UEOT cleanup removes both keywords next turn', () => {
    const state = makeState();
    const effects: Effect[] = [
      { kind: 'GrantKeyword', target: { kind: 'AllOfType', filter: {}, controllerControls: true }, keyword: 'Hexproof', untilEndOfTurn: true },
      { kind: 'GrantKeyword', target: { kind: 'AllOfType', filter: {}, controllerControls: true }, keyword: 'Indestructible', untilEndOfTurn: true },
    ];
    const granted0 = executeEffects(state, effects, 'player-1', [], []);

    // Verify keywords are present before cleanup
    expect(grantedKeywords(granted0, 'p1-creature')).toContain('Hexproof');
    expect(grantedKeywords(granted0, 'p1-creature')).toContain('Indestructible');
    expect(grantedKeywords(granted0, 'p1-land')).toContain('Hexproof');
    expect(grantedKeywords(granted0, 'p1-land')).toContain('Indestructible');

    // End-of-turn cleanup should clear all grantedKeywords
    const cleaned = cleanupDamage(granted0);
    expect(grantedKeywords(cleaned, 'p1-creature')).not.toContain('Hexproof');
    expect(grantedKeywords(cleaned, 'p1-creature')).not.toContain('Indestructible');
    expect(grantedKeywords(cleaned, 'p1-land')).not.toContain('Hexproof');
    expect(grantedKeywords(cleaned, 'p1-land')).not.toContain('Indestructible');
    expect(grantedKeywords(cleaned, 'p1-artifact')).not.toContain('Hexproof');
    expect(grantedKeywords(cleaned, 'p1-enchantment')).not.toContain('Indestructible');
  });

  it('parse + execute round-trip: Heroic Intervention oracle text', () => {
    const state = makeState();
    const parsed = parseOracleText(
      'Permanents you control gain hexproof and indestructible until end of turn.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const result = executeEffects(state, parsed.effects, 'player-1', [], []);

    // Player-1 permanents get both keywords
    for (const id of ['p1-creature', 'p1-artifact', 'p1-land', 'p1-enchantment']) {
      expect(grantedKeywords(result, id)).toContain('Hexproof');
      expect(grantedKeywords(result, id)).toContain('Indestructible');
    }
    // Opponent's permanents are untouched
    expect(grantedKeywords(result, 'p2-creature')).not.toContain('Hexproof');
    expect(grantedKeywords(result, 'p2-creature')).not.toContain('Indestructible');
    expect(grantedKeywords(result, 'p2-land')).not.toContain('Hexproof');
    expect(grantedKeywords(result, 'p2-land')).not.toContain('Indestructible');
  });
});
