import { describe, expect, it } from 'vitest';
import { initRoomGame } from '../room-game';
import { tryPassPriority } from '../actions-public';
import { serializeGameState, deserializeGameState } from '../persistence/serialize';
import { getCardsInZone } from '../game-state';
import { nextRandom, randomInt, hashSeed, shuffled, type RngHost } from '../rng';
import type { GameState } from '../types';
import type { ScryfallCard } from '../cards/deck-loader';

const cards: Record<string, ScryfallCard> = {
  Forest: { id: 'forest', name: 'Forest', type_line: 'Basic Land - Forest', oracle_text: '({T}: Add {G}.)', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [] },
  Island: { id: 'island', name: 'Island', type_line: 'Basic Land - Island', oracle_text: '({T}: Add {U}.)', mana_cost: '', cmc: 0, colors: [], color_identity: ['U'], keywords: [] },
  'Leatherback Baloth': { id: 'leatherback-baloth', name: 'Leatherback Baloth', type_line: 'Creature - Beast', oracle_text: '', mana_cost: '{G}{G}{G}', cmc: 3, colors: ['G'], color_identity: ['G'], keywords: [], power: '4', toughness: '5' },
  'Goreclaw, Terror of Qal Sisma': { id: 'goreclaw', name: 'Goreclaw, Terror of Qal Sisma', type_line: 'Legendary Creature - Bear', oracle_text: '', mana_cost: '{3}{G}', cmc: 4, colors: ['G'], color_identity: ['G'], keywords: [], power: '4', toughness: '3' },
  'Talrand, Sky Summoner': { id: 'talrand', name: 'Talrand, Sky Summoner', type_line: 'Legendary Creature - Merfolk Wizard', oracle_text: '', mana_cost: '{2}{U}{U}', cmc: 4, colors: ['U'], color_identity: ['U'], keywords: [], power: '2', toughness: '2' },
};

function lookup(name: string) {
  return cards[name];
}

// A deck large enough that the shuffle order is meaningful.
function bigList(...names: string[]): string[] {
  const list: string[] = [];
  for (let i = 0; i < 6; i++) list.push(...names);
  return list;
}

function roomGame(seed: number | string | undefined) {
  return initRoomGame({
    players: [
      { id: 'p1', name: 'Ari', deck: { id: 'p1-deck', commander: 'Goreclaw, Terror of Qal Sisma', list: bigList('Leatherback Baloth', 'Forest', 'Forest', 'Forest'), colors: ['G'], bracket: 2, theme: 'stompy' } },
      { id: 'p2', name: 'Bea', deck: { id: 'p2-deck', commander: 'Talrand, Sky Summoner', list: bigList('Island', 'Island', 'Island'), colors: ['U'], bracket: 2, theme: 'spells' } },
    ],
    cardLookup: lookup,
    firstPlayerId: 'p1',
    seed,
  });
}

/** Library order (definition ids) — the observable result of the shuffle. */
function libraryOrder(state: GameState, playerId: string): string[] {
  return getCardsInZone(state, playerId, 'library').map(card => card.definitionId);
}

/** Engine-internal-agnostic projection: what an observer/verifier compares. */
function projection(state: GameState) {
  return {
    turnNumber: state.turnNumber,
    phase: state.phase,
    step: state.step,
    activePlayerIndex: state.activePlayerIndex,
    priorityPlayerIndex: state.priorityPlayerIndex,
    players: state.players.map(p => ({
      id: p.id,
      life: p.life,
      hand: getCardsInZone(state, p.id, 'hand').map(c => c.definitionId),
      libraryCount: getCardsInZone(state, p.id, 'library').length,
      battlefield: getCardsInZone(state, p.id, 'battlefield').map(c => c.definitionId),
      graveyardCount: getCardsInZone(state, p.id, 'graveyard').length,
    })),
  };
}

function replay(state: GameState, passes: number): GameState {
  let next = state;
  for (let i = 0; i < passes; i++) {
    const active = next.players[next.priorityPlayerIndex];
    const result = tryPassPriority(next, active.id);
    if (result.ok) next = result.state;
  }
  return next;
}

describe('seeded PRNG primitives', () => {
  it('produces the same stream for the same seed', () => {
    const a: RngHost = { rngState: hashSeed('game-42') };
    const b: RngHost = { rngState: hashSeed('game-42') };
    const seqA = Array.from({ length: 12 }, () => nextRandom(a));
    const seqB = Array.from({ length: 12 }, () => nextRandom(b));
    expect(seqA).toEqual(seqB);
  });

  it('produces a different stream for different seeds', () => {
    const a: RngHost = { rngState: hashSeed('seed-a') };
    const b: RngHost = { rngState: hashSeed('seed-b') };
    const seqA = Array.from({ length: 12 }, () => nextRandom(a));
    const seqB = Array.from({ length: 12 }, () => nextRandom(b));
    expect(seqA).not.toEqual(seqB);
  });

  it('stays within bounds and advances state', () => {
    const host: RngHost = { rngState: 1 };
    for (let i = 0; i < 100; i++) {
      const v = randomInt(host, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });

  it('shuffles a copy without touching the original', () => {
    const host: RngHost = { rngState: 7 };
    const original = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffled(host, original);
    expect(out).toHaveLength(original.length);
    expect([...out].sort()).toEqual(original);
    expect(original).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('seeded game determinism', () => {
  it('produces an identical initial shuffle for the same seed', () => {
    const a = roomGame('table-7');
    const b = roomGame('table-7');
    expect(libraryOrder(a, 'p1')).toEqual(libraryOrder(b, 'p1'));
    expect(libraryOrder(a, 'p2')).toEqual(libraryOrder(b, 'p2'));
    // Whole serialized state matches (room ids are deterministic too).
    expect(serializeGameState(a)).toEqual(serializeGameState(b));
  });

  it('produces a different shuffle for a different seed', () => {
    const a = roomGame('table-7');
    const b = roomGame('table-8');
    expect(libraryOrder(a, 'p1')).not.toEqual(libraryOrder(b, 'p1'));
  });

  it('replays an action sequence to an identical projection', () => {
    const a = replay(roomGame('replay-seed'), 20);
    const b = replay(roomGame('replay-seed'), 20);
    expect(projection(a)).toEqual(projection(b));
  });

  it('diverges in projection under a different seed (so the test has teeth)', () => {
    const a = replay(roomGame('replay-seed-a'), 20);
    const b = replay(roomGame('replay-seed-b'), 20);
    expect(projection(a)).not.toEqual(projection(b));
  });

  it('preserves the PRNG cursor across serialize/deserialize', () => {
    const original = roomGame('persist-seed');
    const restored = deserializeGameState(serializeGameState(original));
    expect(restored.rngState).toBe(original.rngState);
    // Continuing from each yields identical draws.
    expect(projection(replay(original, 16))).toEqual(projection(replay(restored, 16)));
  });
});
