import { describe, it, expect } from 'vitest';
import { executeEffects } from '../effects/executor';
import { parseOracleText } from '../effects/parser';
import { cleanupDamage } from '../state-based';
import type { Effect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

/**
 * Capability: grant-keyword-mass
 * GrantKeyword now executes on AllCreatures (every battlefield creature, any
 * controller) and AllOfType (battlefield permanents matching the filter, which
 * the parser always scopes to creatures), applying the keyword to every matching
 * creature. The parser recognizes "all creatures gain <kw> until end of turn" and
 * "all <color|subtype> creatures gain <kw> until end of turn" (GRANTABLE_KEYWORDS
 * only). UEOT cleanup (cleanupDamage clears grantedKeywords) wears the grant off.
 */

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

  // Definitions: a red Goblin, a white Knight, a green Beast, and a noncreature artifact.
  cardDefinitions.set('def-goblin', makeDef('def-goblin', 'Goblin Raider', 'Creature — Goblin', ['creature'], ['R']));
  cardDefinitions.set('def-knight', makeDef('def-knight', 'White Knight', 'Creature — Human Knight', ['creature'], ['W']));
  cardDefinitions.set('def-beast', makeDef('def-beast', 'Green Beast', 'Creature — Beast', ['creature'], ['G']));
  cardDefinitions.set('def-rock', makeDef('def-rock', 'Mana Rock', 'Artifact', ['artifact'], []));

  // player-1 controls goblin + knight; player-2 controls beast + rock.
  cards.set('goblin-1', makeCard('goblin-1', 'def-goblin', 'player-1'));
  cards.set('knight-1', makeCard('knight-1', 'def-knight', 'player-1'));
  cards.set('beast-2', makeCard('beast-2', 'def-beast', 'player-2'));
  cards.set('rock-2', makeCard('rock-2', 'def-rock', 'player-2'));

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

function granted(state: GameState, id: string): string[] {
  return state.cards.get(id)?.grantedKeywords ?? [];
}

describe('cap-grant-keyword-mass', () => {
  it('AllCreatures grants the keyword to every battlefield creature (both controllers), not noncreatures', () => {
    const state = makeState();
    const effects: Effect[] = [
      { kind: 'GrantKeyword', target: { kind: 'AllCreatures' }, keyword: 'Trample', untilEndOfTurn: true },
    ];
    const result = executeEffects(state, effects, 'player-1', [], []);

    expect(granted(result, 'goblin-1')).toContain('Trample');
    expect(granted(result, 'knight-1')).toContain('Trample');
    expect(granted(result, 'beast-2')).toContain('Trample'); // opponent's creature too
    expect(granted(result, 'rock-2')).not.toContain('Trample'); // artifact untouched
  });

  it('AllOfType (color filter) grants only to creatures of that color', () => {
    const state = makeState();
    const effects: Effect[] = [
      {
        kind: 'GrantKeyword',
        target: { kind: 'AllOfType', filter: { types: ['creature'], colors: ['R'] } },
        keyword: 'Haste',
        untilEndOfTurn: true,
      },
    ];
    const result = executeEffects(state, effects, 'player-1', [], []);

    expect(granted(result, 'goblin-1')).toContain('Haste'); // red
    expect(granted(result, 'knight-1')).not.toContain('Haste'); // white
    expect(granted(result, 'beast-2')).not.toContain('Haste'); // green
    expect(granted(result, 'rock-2')).not.toContain('Haste');
  });

  it('AllOfType (subtype filter) grants only to creatures of that subtype', () => {
    const state = makeState();
    const effects: Effect[] = [
      {
        kind: 'GrantKeyword',
        target: { kind: 'AllOfType', filter: { types: ['creature'], subtypes: ['goblin'] } },
        keyword: 'Menace',
        untilEndOfTurn: true,
      },
    ];
    const result = executeEffects(state, effects, 'player-1', [], []);

    expect(granted(result, 'goblin-1')).toContain('Menace');
    expect(granted(result, 'knight-1')).not.toContain('Menace');
    expect(granted(result, 'beast-2')).not.toContain('Menace');
  });

  it('end-of-turn cleanup removes the granted keyword', () => {
    const state = makeState();
    const effects: Effect[] = [
      { kind: 'GrantKeyword', target: { kind: 'AllCreatures' }, keyword: 'Flying', untilEndOfTurn: true },
    ];
    const granted0 = executeEffects(state, effects, 'player-1', [], []);
    expect(granted(granted0, 'goblin-1')).toContain('Flying');

    const cleaned = cleanupDamage(granted0);
    expect(granted(cleaned, 'goblin-1')).not.toContain('Flying');
    expect(granted(cleaned, 'beast-2')).not.toContain('Flying');
  });

  it('parser: "all creatures gain trample until end of turn" -> AllCreatures GrantKeyword, executes for all', () => {
    const parsed = parseOracleText('All creatures gain trample until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('GrantKeyword');
    if (eff.kind !== 'GrantKeyword') return;
    expect(eff.target).toEqual({ kind: 'AllCreatures' });
    expect(eff.keyword).toBe('Trample');
    expect(eff.untilEndOfTurn).toBe(true);

    const result = executeEffects(makeState(), parsed.effects, 'player-1', [], []);
    expect(granted(result, 'goblin-1')).toContain('Trample');
    expect(granted(result, 'knight-1')).toContain('Trample');
    expect(granted(result, 'beast-2')).toContain('Trample');
    expect(granted(result, 'rock-2')).not.toContain('Trample');
  });

  it('parser: "all goblin creatures gain haste until end of turn" -> AllOfType subtype filter, executes correctly', () => {
    const parsed = parseOracleText('All goblin creatures gain haste until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('GrantKeyword');
    if (eff.kind !== 'GrantKeyword') return;
    expect(eff.target.kind).toBe('AllOfType');
    if (eff.target.kind !== 'AllOfType') return;
    expect(eff.target.filter.subtypes).toEqual(['goblin']);
    expect(eff.target.filter.types).toEqual(['creature']);
    expect(eff.keyword).toBe('Haste');

    const result = executeEffects(makeState(), parsed.effects, 'player-1', [], []);
    expect(granted(result, 'goblin-1')).toContain('Haste');
    expect(granted(result, 'knight-1')).not.toContain('Haste');
    expect(granted(result, 'beast-2')).not.toContain('Haste');
  });

  it('parser: "all red creatures gain first strike until end of turn" -> AllOfType color filter', () => {
    const parsed = parseOracleText('All red creatures gain first strike until end of turn.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('GrantKeyword');
    if (eff.kind !== 'GrantKeyword') return;
    expect(eff.target.kind).toBe('AllOfType');
    if (eff.target.kind !== 'AllOfType') return;
    expect(eff.target.filter.colors).toEqual(['R']);
    expect(eff.keyword).toBe('First Strike');

    const result = executeEffects(makeState(), parsed.effects, 'player-1', [], []);
    expect(granted(result, 'goblin-1')).toContain('First Strike');
    expect(granted(result, 'knight-1')).not.toContain('First Strike');
  });
});
