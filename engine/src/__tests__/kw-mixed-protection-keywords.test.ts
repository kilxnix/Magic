/**
 * Slice 6/12 — Mixed keyword lines containing 'protection from <quality>'.
 *
 * Cards like Voice of Law ("Flying, protection from red") and Coast Watcher
 * ("Flying, protection from green") print their evasion keyword and protection
 * clause as a single comma-separated line. Before this slice, matchProtection
 * rejected such lines because it could not find the "protection from" prefix at
 * the start of the sentence. After the fix, matchProtection splits the sentence
 * into parts and accepts lines where every part is either an engine-enforced
 * plain keyword or an enforced "protection from <quality>" clause.
 *
 * HONESTY: keywords.ts (isProtectedFromSource, canBlock) reads the oracle text
 * directly to enforce protection — the parse result is a recognition marker only.
 * Flying is enforced via the KEYWORD_MAP path (keyword cache from def.keywords).
 * No new executor logic is needed.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { canBlock, isProtectedFromSource } from '../keywords';
import { declareAttackers, declareBlockers, canDeclareBlocker } from '../combat';
import { getCardsInZone, initGameState } from '../game-state';
import type { CardDefinition } from '../types';

// ── Test helpers ────────────────────────────────────────────────────────────

function creature(
  id: string,
  colors: CardDefinition['colors'],
  oracle: string,
  cardTypes: CardDefinition['card_types'] = ['creature'],
): CardDefinition {
  return {
    id,
    name: id,
    type_line: cardTypes.includes('artifact') ? 'Artifact Creature — Golem' : 'Creature — Test',
    oracle_text: oracle,
    mana_cost: '{W}',
    cmc: 1,
    colors,
    color_identity: colors,
    keywords: [],
    card_types: cardTypes,
    power: 2,
    toughness: 2,
  };
}

function setup(attackerDef: CardDefinition, blockerDef: CardDefinition) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: [attackerDef], commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [blockerDef], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);
  for (const [id, card] of state.cards) {
    state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
  }
  state = { ...state, phase: 'combat', step: 'declare_attackers' };

  const attackerId = getCardsInZone(state, 'p1', 'battlefield')
    .find(c => state.cards.get(c.instanceId)!.definitionId === attackerDef.id)!.instanceId;
  const blockerId = getCardsInZone(state, 'p2', 'battlefield')
    .find(c => state.cards.get(c.instanceId)!.definitionId === blockerDef.id)!.instanceId;
  return { state, attackerId, blockerId };
}

// ── Parse recognition ────────────────────────────────────────────────────────

describe('Slice 6: mixed keyword + protection comma-list — parser recognition', () => {
  it.each([
    // Voice of Law
    'Flying, protection from red',
    // Coast Watcher
    'Flying, protection from green',
    // Melesse Spirit / Azorius First-Wing style
    'Flying, protection from black and from red',
    // Multiple plain keywords before protection
    'Flying, vigilance, protection from blue',
    // Protection first, keyword after
    'Protection from red, flying',
    // Trample with protection
    'Trample, protection from white',
    // Narwhal style (one keyword + one protection)
    'Flying, protection from artifacts',
    // Ward + protection
    'Ward {2}, protection from black',
  ])('parses %s as StaticAbility', (text) => {
    const result = parseOracleText(text);
    expect(result.kind).toBe('StaticAbility');
  });

  it('records a Protection GrantKeyword marker', () => {
    const result = parseOracleText('Flying, protection from red');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'Protection' });
    expect(result.ability.selfOnly).toBe(true);
  });

  // HONESTY: keyword-only faces (no protection) stay Unparsed so the audit
  // KeywordOnly gate classifies them separately from real parsed faces.
  it('does NOT claim a keyword-only comma-list without protection (stays Unparsed)', () => {
    expect(parseOracleText('Flying, vigilance').kind).toBe('Unparsed');
    expect(parseOracleText('Haste, trample').kind).toBe('Unparsed');
  });

  // HONESTY: unenforced protection qualities must still be declined.
  it.each([
    'Flying, protection from everything',
    'Flying, protection from Dragons',
    'Flying, protection from each color',
  ])('does NOT claim unenforced quality in comma-list: %s', (text) => {
    expect(parseOracleText(text).kind).toBe('Unparsed');
  });

  it('does NOT mask a real ability beside a mixed protection comma-list', () => {
    // The per-line dispatch (slice 4) already handles newline-separated faces;
    // a real ability on a second line wins via the richer parse path.
    const result = parseOracleText('Flying, protection from red\nWhenever this creature attacks, draw a card.');
    // The trigger wins over the pure-keyword/protection first line.
    expect(result.kind).toBe('Triggered');
  });
});

// ── Protection enforcement (execution) ──────────────────────────────────────

describe('Slice 6: mixed keyword + protection — enforcement via keywords.ts', () => {
  it('Voice of Law (Flying, protection from red): red creature cannot block it', () => {
    const { state, attackerId, blockerId } = setup(
      creature('voice-of-law', ['W'], 'Flying, protection from red'),
      creature('red-blocker', ['R'], ''),
    );
    expect(isProtectedFromSource(state, attackerId, blockerId)).toBe(true);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);

    const declared = declareAttackers(state, 'p1', [
      { cardInstanceId: attackerId, defendingPlayerId: 'p2' },
    ]);
    expect(canDeclareBlocker(declared, 'p2', blockerId, attackerId)).toBe(false);
    expect(() =>
      declareBlockers(declared, 'p2', [
        { cardInstanceId: blockerId, blockingAttackerId: attackerId },
      ]),
    ).toThrow();
  });

  it('Coast Watcher (Flying, protection from green): green creature cannot block it', () => {
    const { state, attackerId, blockerId } = setup(
      creature('coast-watcher', ['U'], 'Flying, protection from green'),
      creature('green-blocker', ['G'], ''),
    );
    expect(isProtectedFromSource(state, attackerId, blockerId)).toBe(true);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('Coast Watcher: a blue creature CAN block it (no false positive)', () => {
    const { state, attackerId, blockerId } = setup(
      creature('coast-watcher', ['U'], 'Flying, protection from green'),
      creature('blue-blocker', ['U'], ''),
    );
    expect(isProtectedFromSource(state, attackerId, blockerId)).toBe(false);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);
  });

  it('Flying, protection from black and from red: black creature cannot block it', () => {
    const { state, attackerId, blockerId } = setup(
      creature('protected', ['W', 'U'], 'Flying, protection from black and from red'),
      creature('black-blocker', ['B'], ''),
    );
    expect(isProtectedFromSource(state, attackerId, blockerId)).toBe(true);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('Flying, protection from black and from red: red creature cannot block it', () => {
    const { state, attackerId, blockerId } = setup(
      creature('protected', ['W', 'U'], 'Flying, protection from black and from red'),
      creature('red-blocker', ['R'], ''),
    );
    expect(isProtectedFromSource(state, attackerId, blockerId)).toBe(true);
    expect(canBlock(state, blockerId, attackerId)).toBe(false);
  });

  it('Flying, protection from black and from red: green creature CAN block it', () => {
    const { state, attackerId, blockerId } = setup(
      creature('protected', ['W', 'U'], 'Flying, protection from black and from red'),
      creature('green-blocker', ['G'], ''),
    );
    expect(isProtectedFromSource(state, attackerId, blockerId)).toBe(false);
    expect(canBlock(state, blockerId, attackerId)).toBe(true);
  });
});
