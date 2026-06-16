import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

/**
 * Family: loot-draw-discard.
 *
 * "Draw N cards, then discard N cards." / "Draw a card, then discard a card." /
 * "Draw two cards. Discard a card." (loot/cycling-style) is two existing effects
 * — Draw then a controller Discard — parsed as a sequence by parseMultipleEffects.
 *
 * "Draw N cards. Discard your hand." is the same Draw + a new matchDiscardSelf
 * branch that discards the controller's ENTIRE hand (count 999 sentinel, clamped
 * by executeDiscard to the real hand size).
 *
 * These tests EXECUTE the parsed effects against a real GameState and assert the
 * exact zone transitions: N cards leave the library for the hand, then N cards
 * leave the hand for the graveyard.
 */

const beast: CardDefinition = {
  id: 'd', name: 'Beast', type_line: 'Creature — Beast', oracle_text: '',
  mana_cost: '{2}', cmc: 2, colors: [], color_identity: [], keywords: [],
  card_types: ['creature'], power: 2, toughness: 2,
};

function inst(id: string, zone: CardInstance['zone']): [string, CardInstance] {
  return [id, {
    instanceId: id, definitionId: 'd', ownerId: 'p0', zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  }];
}

/** Build a state for p0 with `handN` cards in hand and `libN` cards in library. */
function makeState(handN: number, libN: number): GameState {
  const entries: [string, CardInstance][] = [];
  for (let i = 0; i < handN; i++) entries.push(inst(`h${i}`, 'hand'));
  for (let i = 0; i < libN; i++) entries.push(inst(`l${i}`, 'library'));
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(entries),
    cardDefinitions: new Map([['d', beast]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main',
    step: 'begin_combat', turnNumber: 2, hasPriorityPassed: [false, false],
    stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zonesOf(state: GameState): { hand: number; library: number; graveyard: number } {
  let hand = 0, library = 0, graveyard = 0;
  for (const [, c] of state.cards) {
    if (c.ownerId !== 'p0') continue;
    if (c.zone === 'hand') hand++;
    else if (c.zone === 'library') library++;
    else if (c.zone === 'graveyard') graveyard++;
  }
  return { hand, library, graveyard };
}

function runSpell(text: string, state: GameState): GameState {
  const p = parseOracleText(text);
  expect(p.kind, `expected Spell for "${text}"`).toBe('Spell');
  if (p.kind !== 'Spell') throw new Error('not a spell');
  return executeEffects(state, p.effects, 'p0', [], [], 0, {});
}

describe('loot-draw-discard: parse shape', () => {
  it('"Draw a card, then discard a card." parses to Draw + controller Discard', () => {
    const p = parseOracleText('Draw a card, then discard a card.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects.map(e => e.kind)).toEqual(['Draw', 'Discard']);
    const [draw, disc] = p.effects;
    expect(draw.kind === 'Draw' && draw.count).toBe(1);
    expect(draw.kind === 'Draw' && draw.player).toEqual({ kind: 'Controller' });
    expect(disc.kind === 'Discard' && disc.count).toBe(1);
    expect(disc.kind === 'Discard' && disc.player).toEqual({ kind: 'Controller' });
  });

  it('"Draw two cards. Discard a card." parses to Draw(2) + Discard(1)', () => {
    const p = parseOracleText('Draw two cards. Discard a card.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects.map(e => e.kind)).toEqual(['Draw', 'Discard']);
    expect(p.effects[0].kind === 'Draw' && p.effects[0].count).toBe(2);
    expect(p.effects[1].kind === 'Discard' && p.effects[1].count).toBe(1);
  });

  it('"Draw three cards, then discard two cards." parses to Draw(3) + Discard(2)', () => {
    const p = parseOracleText('Draw three cards, then discard two cards.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects[0].kind === 'Draw' && p.effects[0].count).toBe(3);
    expect(p.effects[1].kind === 'Discard' && p.effects[1].count).toBe(2);
  });

  it('"Draw two cards. Discard your hand." parses to Draw(2) + full-hand Discard', () => {
    const p = parseOracleText('Draw two cards. Discard your hand.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects.map(e => e.kind)).toEqual(['Draw', 'Discard']);
    expect(p.effects[0].kind === 'Draw' && p.effects[0].count).toBe(2);
    expect(p.effects[1].kind === 'Discard' && p.effects[1].count).toBe(999);
    expect(p.effects[1].kind === 'Discard' && p.effects[1].player).toEqual({ kind: 'Controller' });
  });
});

describe('loot-draw-discard: executes real zone transitions', () => {
  it('"Draw a card, then discard a card." moves 1 lib->hand then 1 hand->gy', () => {
    // Start: 2 in hand, 3 in library.
    const before = makeState(2, 3);
    const after = runSpell('Draw a card, then discard a card.', before);
    const z = zonesOf(after);
    // Drew 1 (hand 2->3, lib 3->2), then discarded 1 (hand 3->2, gy 0->1).
    expect(z.library).toBe(2);
    expect(z.hand).toBe(2);
    expect(z.graveyard).toBe(1);
  });

  it('"Draw three cards, then discard two cards." nets +1 hand, 2 in gy', () => {
    const before = makeState(1, 5); // hand 1, lib 5
    const after = runSpell('Draw three cards, then discard two cards.', before);
    const z = zonesOf(after);
    // Draw 3: lib 5->2, hand 1->4. Discard 2: hand 4->2, gy 0->2.
    expect(z.library).toBe(2);
    expect(z.hand).toBe(2);
    expect(z.graveyard).toBe(2);
  });

  it('"Draw two cards. Discard your hand." draws first then dumps the whole hand', () => {
    const before = makeState(3, 4); // hand 3, lib 4
    const after = runSpell('Draw two cards. Discard your hand.', before);
    const z = zonesOf(after);
    // Draw 2: lib 4->2, hand 3->5. Discard your hand: hand 5->0, gy 0->5.
    expect(z.library).toBe(2);
    expect(z.hand).toBe(0);
    expect(z.graveyard).toBe(5);
  });

  it('"Draw a card, then discard a card." with an empty hand still draws then discards the drawn card', () => {
    const before = makeState(0, 3); // empty hand, 3 lib
    const after = runSpell('Draw a card, then discard a card.', before);
    const z = zonesOf(after);
    // Draw 1: lib 3->2, hand 0->1. Discard 1: hand 1->0, gy 0->1.
    expect(z.library).toBe(2);
    expect(z.hand).toBe(0);
    expect(z.graveyard).toBe(1);
  });
});
