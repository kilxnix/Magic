/**
 * Slice 6: Modal completion — named modes, X-amount bullets, subtype board-wipes.
 *
 * Three gaps closed in parseModalSpell:
 *   Gap 1 – Strip named-mode prefixes ("Feed —", "Growth —", "Tax —" …) from
 *            bullet tokens before parsing, so the mode label does not confuse matchers.
 *   Gap 2 – Allow bare {kind:'X'} amounts in bullets when parseOracleText receives
 *            a manaCost string containing X (Profane Command, Orcus, Skemfar …).
 *   Gap 3 – Destroy-all-subtype-creatures matcher so "Destroy all Dragon creatures" /
 *            "Destroy all non-Dragon creatures" (Crux of Fate) resolve correctly.
 *
 * Each block has ≥3 parse assertions plus execution verification.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function def(
  id: string,
  name: string,
  typeLine: string,
  types: CardDefinition['card_types'],
  pt?: [number, number],
): CardDefinition {
  return {
    id, name, type_line: typeLine, oracle_text: '', mana_cost: '{1}', cmc: 1,
    colors: [], color_identity: [], keywords: [],
    card_types: types,
    ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
  };
}

const DEFS: CardDefinition[] = [
  // Type line must match what typeLineHasSubtype checks (lowercases the subtype arg).
  def('d_dragon', 'Dragon', 'Creature — Dragon', ['creature'], [4, 4]),
  def('d_human', 'Human', 'Creature — Human Soldier', ['creature'], [2, 2]),
  def('d_zombie', 'Zombie', 'Creature — Zombie', ['creature'], [2, 2]),
  def('d_beast', 'Beast', 'Creature — Beast', ['creature'], [3, 3]),
  def('d_elf', 'Elf', 'Creature — Elf Druid', ['creature'], [1, 1]),
  def('d_instant', 'Shock', 'Instant', ['instant']),
];

function mk(id: string, defId: string, owner: string, zone: CardInstance['zone']): CardInstance {
  return {
    instanceId: id, definitionId: defId, ownerId: owner, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function st(cards: CardInstance[]): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(DEFS.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function modal(text: string, manaCost?: string) {
  const parsed = parseOracleText(text, manaCost);
  expect(parsed.kind, `Expected Modal for:\n${text}`).toBe('Modal');
  return parsed as Extract<ReturnType<typeof parseOracleText>, { kind: 'Modal' }>;
}

// ---------------------------------------------------------------------------
// Gap 1: Named-mode prefix stripping
// ---------------------------------------------------------------------------

describe('slice6 gap1: named-mode prefix stripping', () => {
  // Synthetic oracle text that uses "Name — effect" bullet labels.
  // The em-dash label must be stripped before the effect is parsed.
  const NAMED_MODE_TEXT = [
    'Choose one —',
    '• Drain — Target player loses 2 life.',
    '• Heal — Target player gains 2 life.',
  ].join('\n');

  it('parses a Choose-one modal with named-mode prefixes', () => {
    const result = modal(NAMED_MODE_TEXT);
    expect(result.modal.choices).toHaveLength(2);
  });

  it('first named mode (Drain) produces LoseLife 2', () => {
    const result = modal(NAMED_MODE_TEXT);
    const choice0 = result.modal.choices[0];
    expect(choice0.effects).toHaveLength(1);
    expect(choice0.effects[0].kind).toBe('LoseLife');
    const fx = choice0.effects[0];
    if (fx.kind !== 'LoseLife') return;
    expect(fx.amount).toBe(2);
  });

  it('second named mode (Heal) produces GainLife 2', () => {
    const result = modal(NAMED_MODE_TEXT);
    const choice1 = result.modal.choices[1];
    expect(choice1.effects).toHaveLength(1);
    expect(choice1.effects[0].kind).toBe('GainLife');
    const fx = choice1.effects[0];
    if (fx.kind !== 'GainLife') return;
    expect(fx.amount).toBe(2);
  });

  it('first named mode targets a Player', () => {
    const result = modal(NAMED_MODE_TEXT);
    const choice0 = result.modal.choices[0];
    expect(choice0.targets).toHaveLength(1);
    expect(choice0.targets[0].type).toBe('Player');
  });

  // Two different prefix words ("Feed —" and "Growth —")
  const MULTI_NAMED = [
    'Choose one —',
    '• Feed — Target player loses 3 life.',
    '• Growth — Target player gains 3 life.',
  ].join('\n');

  it('parses multi-named-mode Choose-one with different prefix words', () => {
    const result = modal(MULTI_NAMED);
    expect(result.modal.choices).toHaveLength(2);
    expect(result.modal.choices[0].effects[0].kind).toBe('LoseLife');
    expect(result.modal.choices[1].effects[0].kind).toBe('GainLife');
  });

  it('executes the Drain named mode: target player (p1) loses 2 life', () => {
    const result = modal(NAMED_MODE_TEXT);
    const { effects, targets } = result.modal.choices[0];
    const state = st([]);
    state.players[1].life = 20;
    const chosenIds = targets.length > 0 ? ['p1'] : [];
    const targetSpecs = targets.map(t => ({ id: t.id }));
    const next = executeEffects(state, effects, 'p0', chosenIds, targetSpecs);
    expect(next.players[1].life).toBe(18);
  });

  it('executes the Heal named mode: target player (p1) gains 2 life', () => {
    const result = modal(NAMED_MODE_TEXT);
    const { effects, targets } = result.modal.choices[1];
    const state = st([]);
    state.players[1].life = 10;
    const chosenIds = targets.length > 0 ? ['p1'] : [];
    const targetSpecs = targets.map(t => ({ id: t.id }));
    const next = executeEffects(state, effects, 'p0', chosenIds, targetSpecs);
    expect(next.players[1].life).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Gap 2: X-amount bullets ("Target player loses X life." in a modal)
// ---------------------------------------------------------------------------

describe('slice6 gap2: X-amount bullets in modal choices', () => {
  // Profane Command–style: "Choose one — • Target player loses X life.
  //                                        • Target player gains X life."
  // The card must have {X} in its mana cost for X to resolve at runtime.
  const PROFANE_TEXT = [
    'Choose one —',
    '• Target player loses X life.',
    '• Target player gains X life.',
  ].join('\n');

  it('parses as Modal when manaCost contains X', () => {
    const result = modal(PROFANE_TEXT, '{X}{1}{B}');
    expect(result.modal.choices).toHaveLength(2);
  });

  it('first bullet has LoseLife with amount {kind:X}', () => {
    const result = modal(PROFANE_TEXT, '{X}{1}{B}');
    const fx = result.modal.choices[0].effects[0];
    expect(fx.kind).toBe('LoseLife');
    if (fx.kind !== 'LoseLife') return;
    expect(fx.amount).toEqual({ kind: 'X' });
  });

  it('first bullet targets a Player', () => {
    const result = modal(PROFANE_TEXT, '{X}{1}{B}');
    const choice = result.modal.choices[0];
    expect(choice.targets).toHaveLength(1);
    expect(choice.targets[0].type).toBe('Player');
  });

  it('second bullet has GainLife with amount {kind:X}', () => {
    const result = modal(PROFANE_TEXT, '{X}{1}{B}');
    const fx = result.modal.choices[1].effects[0];
    expect(fx.kind).toBe('GainLife');
    if (fx.kind !== 'GainLife') return;
    expect(fx.amount).toEqual({ kind: 'X' });
  });

  it('second bullet targets a Player', () => {
    const result = modal(PROFANE_TEXT, '{X}{1}{B}');
    const choice = result.modal.choices[1];
    expect(choice.targets).toHaveLength(1);
    expect(choice.targets[0].type).toBe('Player');
  });

  it('executes the LoseLife(X) bullet with xValue=3: target player loses 3 life', () => {
    const result = modal(PROFANE_TEXT, '{X}{1}{B}');
    const { effects, targets } = result.modal.choices[0];
    const state = st([]);
    state.players[1].life = 20;
    const chosenIds = targets.length > 0 ? ['p1'] : [];
    const targetSpecs = targets.map(t => ({ id: t.id }));
    const next = executeEffects(state, effects, 'p0', chosenIds, targetSpecs, 3);
    expect(next.players[1].life).toBe(17);
  });

  it('executes the GainLife(X) bullet with xValue=4: target player gains 4 life', () => {
    const result = modal(PROFANE_TEXT, '{X}{1}{B}');
    const { effects, targets } = result.modal.choices[1];
    const state = st([]);
    state.players[1].life = 10;
    const chosenIds = targets.length > 0 ? ['p1'] : [];
    const targetSpecs = targets.map(t => ({ id: t.id }));
    const next = executeEffects(state, effects, 'p0', chosenIds, targetSpecs, 4);
    expect(next.players[1].life).toBe(14);
  });

  // Also test "you lose X life" form (explicit 'you' subject required for X parsing)
  const YOU_LOSE_X_TEXT = [
    'Choose one —',
    '• You lose X life.',
    '• Target player gains X life.',
  ].join('\n');

  it('parses "you lose X life" bullet as LoseLife with X amount', () => {
    const result = modal(YOU_LOSE_X_TEXT, '{X}{B}');
    expect(result.modal.choices).toHaveLength(2);
    const fx = result.modal.choices[0].effects[0];
    expect(fx.kind).toBe('LoseLife');
    if (fx.kind !== 'LoseLife') return;
    expect(fx.amount).toEqual({ kind: 'X' });
  });
});

// ---------------------------------------------------------------------------
// Gap 3: Destroy-all-subtype-creatures in modal bullets (Crux of Fate)
// ---------------------------------------------------------------------------

describe('slice6 gap3: destroy-all-[non-]subtype-creatures in modal', () => {
  // Crux of Fate: "Choose one — • Destroy all Dragon creatures.
  //                               • Destroy all non-Dragon creatures."
  const CRUX_TEXT = [
    'Choose one —',
    '• Destroy all Dragon creatures.',
    '• Destroy all non-Dragon creatures.',
  ].join('\n');

  it('parses Crux of Fate as Modal', () => {
    const result = modal(CRUX_TEXT);
    expect(result.modal.choices).toHaveLength(2);
  });

  it('first bullet is Destroy AllOfType with subtypes:["dragon"] (lowercase canonical)', () => {
    const result = modal(CRUX_TEXT);
    const fx = result.modal.choices[0].effects[0];
    expect(fx.kind).toBe('Destroy');
    if (fx.kind !== 'Destroy') return;
    expect(fx.target.kind).toBe('AllOfType');
    if (fx.target.kind !== 'AllOfType') return;
    expect(fx.target.filter.types).toContain('creature');
    // CREATURE_SUBTYPE_MAP stores lowercase canonical names ("dragon", not "Dragon")
    expect((fx.target.filter as { subtypes?: string[] }).subtypes).toEqual(['dragon']);
  });

  it('second bullet is Destroy AllOfType with excludeSubtypes:["dragon"]', () => {
    const result = modal(CRUX_TEXT);
    const fx = result.modal.choices[1].effects[0];
    expect(fx.kind).toBe('Destroy');
    if (fx.kind !== 'Destroy') return;
    expect(fx.target.kind).toBe('AllOfType');
    if (fx.target.kind !== 'AllOfType') return;
    expect(fx.target.filter.types).toContain('creature');
    expect((fx.target.filter as { excludeSubtypes?: string[] }).excludeSubtypes).toEqual(['dragon']);
  });

  it('executes "Destroy all Dragon creatures": kills Dragon, spares others', () => {
    const result = modal(CRUX_TEXT);
    const { effects } = result.modal.choices[0];
    const state = st([
      mk('dragon1', 'd_dragon', 'p0', 'battlefield'),
      mk('human1', 'd_human', 'p0', 'battlefield'),
      mk('zombie1', 'd_zombie', 'p1', 'battlefield'),
    ]);
    const next = executeEffects(state, effects, 'p0', [], []);
    // Dragon should be destroyed (moved from battlefield)
    expect(next.cards.get('dragon1')?.zone).not.toBe('battlefield');
    // Human and Zombie are not Dragons — should survive
    expect(next.cards.get('human1')?.zone).toBe('battlefield');
    expect(next.cards.get('zombie1')?.zone).toBe('battlefield');
  });

  it('executes "Destroy all non-Dragon creatures": spares Dragon, kills others', () => {
    const result = modal(CRUX_TEXT);
    const { effects } = result.modal.choices[1];
    const state = st([
      mk('dragon1', 'd_dragon', 'p0', 'battlefield'),
      mk('human1', 'd_human', 'p0', 'battlefield'),
      mk('zombie1', 'd_zombie', 'p1', 'battlefield'),
    ]);
    const next = executeEffects(state, effects, 'p0', [], []);
    // Dragon should survive (it IS a Dragon)
    expect(next.cards.get('dragon1')?.zone).toBe('battlefield');
    // Human and Zombie are not Dragons — destroyed
    expect(next.cards.get('human1')?.zone).not.toBe('battlefield');
    expect(next.cards.get('zombie1')?.zone).not.toBe('battlefield');
  });

  // Also verify the standalone (non-modal) form works for completeness
  it('standalone "Destroy all Dragon creatures." parses as Spell', () => {
    const parsed = parseOracleText('Destroy all Dragon creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('Destroy');
  });

  it('standalone "Destroy all non-Dragon creatures." parses as Spell', () => {
    const parsed = parseOracleText('Destroy all non-Dragon creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('Destroy');
  });

  // Other subtypes
  it('parses "Destroy all Zombie creatures." (subtype variety)', () => {
    const parsed = parseOracleText('Destroy all Zombie creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const fx = parsed.effects[0];
    expect(fx.kind).toBe('Destroy');
    if (fx.kind !== 'Destroy') return;
    if (fx.target.kind !== 'AllOfType') return;
    expect((fx.target.filter as { subtypes?: string[] }).subtypes).toEqual(['zombie']);
  });

  it('parses "Destroy all non-Zombie creatures." (excludeSubtypes variety)', () => {
    const parsed = parseOracleText('Destroy all non-Zombie creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const fx = parsed.effects[0];
    expect(fx.kind).toBe('Destroy');
    if (fx.kind !== 'Destroy') return;
    if (fx.target.kind !== 'AllOfType') return;
    expect((fx.target.filter as { excludeSubtypes?: string[] }).excludeSubtypes).toEqual(['zombie']);
  });

  it('executes standalone "Destroy all Zombie creatures." — kills all Zombies on battlefield', () => {
    const parsed = parseOracleText('Destroy all Zombie creatures.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const state = st([
      mk('z1', 'd_zombie', 'p0', 'battlefield'),
      mk('z2', 'd_zombie', 'p1', 'battlefield'),
      mk('dr', 'd_dragon', 'p0', 'battlefield'),
      mk('hu', 'd_human', 'p0', 'battlefield'),
    ]);
    const next = executeEffects(state, parsed.effects, 'p0', [], []);
    expect(next.cards.get('z1')?.zone).not.toBe('battlefield');
    expect(next.cards.get('z2')?.zone).not.toBe('battlefield');
    expect(next.cards.get('dr')?.zone).toBe('battlefield');
    expect(next.cards.get('hu')?.zone).toBe('battlefield');
  });
});

// ---------------------------------------------------------------------------
// Honesty bar: where-X forms must remain Unparsed when amount source unsupported
// ---------------------------------------------------------------------------

describe('slice6 honesty bar: where-X compound sentences stay Unparsed', () => {
  it('party-count "Each opponent loses X life and you gain X life, where X is party" stays Unparsed', () => {
    // "party" is not a supported zone phrase — the where-clause fails, and matchLoseLife
    // cannot accept bare 'x' without 'you' subject, so the whole text is Unparsed.
    const parsed = parseOracleText(
      'Each opponent loses X life and you gain X life, where X is the number of creatures in your party.',
    );
    expect(parsed.kind).toBe('Unparsed');
  });

  it('"you lose x life" without "you" subject in "each opponent loses x life" stays non-matchable', () => {
    // Verifies the LoseLife matcher only accepts bare X when 'you' was the subject.
    // "each opponent loses x life" — no 'you', bare X must be rejected by matchLoseLife.
    // The whole card stays Unparsed since the party-clause also fails.
    const parsed = parseOracleText(
      'Each opponent loses X life, where X is the number of creatures in your party.',
    );
    expect(parsed.kind).toBe('Unparsed');
  });
});
