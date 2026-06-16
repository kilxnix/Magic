import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, OptionalPayEffect } from '../effects/ast';

// Slice: optional-pay trigger bodies — "you may pay {COST}. If you do, EFFECT."
// Covers the colored-cost extension (manaCost as a mana STRING like '{2}{R}',
// paid only by lands that produce the required colors), the {E} energy-cost
// fix (paid from energy counters, never lands), and back-compat for generic
// numeric costs. All wordings below are real oracle texts (runtime-normalized
// self-names use '~' / "this creature", as the engine does before parsing).

function landDef(id: string, name: string, color: string): CardDefinition {
  return {
    id, name, type_line: `Basic Land — ${name}`, oracle_text: `{T}: Add {${color}}.`,
    mana_cost: '', cmc: 0, colors: [], color_identity: [color], keywords: [], card_types: ['land'],
  };
}

const defs: CardDefinition[] = [
  landDef('forest', 'Forest', 'G'),
  landDef('island', 'Island', 'U'),
  landDef('plains', 'Plains', 'W'),
  landDef('mountain', 'Mountain', 'R'),
  {
    id: 'bear', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '',
    mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
    power: 2, toughness: 2,
  },
];

function baseState(): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map<string, CardInstance>(),
    cardDefinitions: new Map(defs.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function addCard(s: GameState, instanceId: string, definitionId: string, zone: CardInstance['zone'] = 'battlefield'): void {
  s.cards.set(instanceId, {
    instanceId, definitionId, ownerId: 'p0', zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  });
}

function handSize(s: GameState, owner: string): number {
  return [...s.cards.values()].filter(c => c.ownerId === owner && c.zone === 'hand').length;
}

function tappedLands(s: GameState): string[] {
  return [...s.cards.values()].filter(c => c.zone === 'battlefield' && c.tapped).map(c => c.instanceId);
}

function firstOptionalPay(effects: Effect[]): OptionalPayEffect {
  const op = effects.find(e => e.kind === 'OptionalPay') as OptionalPayEffect | undefined;
  if (!op) throw new Error('expected an OptionalPay effect');
  return op;
}

describe('optional-pay trigger bodies — colored mana strings', () => {
  // Merfolk Seer (real oracle text)
  it('Merfolk Seer: "When this creature dies, you may pay {1}{U}. If you do, draw a card." parses and pays color-aware', () => {
    const p = parseOracleText('When this creature dies, you may pay {1}{U}. If you do, draw a card.');
    if (p.kind !== 'Dies') throw new Error(`expected Dies, got ${p.kind}`);
    const op = firstOptionalPay(p.ability.effects);
    expect(op.manaCost).toBe('{1}{U}'); // colored cost kept as a mana string
    expect(op.effects[0].kind).toBe('Draw');

    // Affordable: Island (U) + Forest (generic) → pays and draws.
    let s = baseState();
    addCard(s, 'isl', 'island');
    addCard(s, 'for', 'forest');
    addCard(s, 'lib', 'forest', 'library');
    s = executeEffects(s, p.ability.effects, 'p0', [], []);
    expect(tappedLands(s).sort()).toEqual(['for', 'isl']);
    expect(handSize(s, 'p0')).toBe(1);
  });

  it('Merfolk Seer: declines when no land produces {U} (two Forests)', () => {
    const p = parseOracleText('When this creature dies, you may pay {1}{U}. If you do, draw a card.');
    if (p.kind !== 'Dies') throw new Error('x');
    let s = baseState();
    addCard(s, 'f0', 'forest');
    addCard(s, 'f1', 'forest');
    addCard(s, 'lib', 'forest', 'library');
    s = executeEffects(s, p.ability.effects, 'p0', [], []);
    expect(tappedLands(s)).toEqual([]); // no partial payment
    expect(handSize(s, 'p0')).toBe(0); // no free draw
  });

  // Order of the Golden Cricket (real oracle text)
  it('Order of the Golden Cricket: "Whenever this creature attacks, you may pay {W}. If you do, it gains flying until end of turn."', () => {
    const p = parseOracleText('Whenever this creature attacks, you may pay {W}. If you do, it gains flying until end of turn.');
    if (p.kind !== 'Triggered') throw new Error(`expected Triggered, got ${p.kind}`);
    expect(p.ability.trigger.kind).toBe('Attacks');
    expect(p.ability.optional).toBe(true);
    const op = firstOptionalPay(p.ability.effects);
    expect(op.manaCost).toBe('{W}');

    // Pays with a Plains and grants flying to the source.
    let s = baseState();
    addCard(s, 'src', 'bear');
    addCard(s, 'pla', 'plains');
    s = executeEffects(s, p.ability.effects, 'p0', [], [], 0, { sourceInstanceId: 'src' });
    expect(s.cards.get('pla')!.tapped).toBe(true);
    expect(s.cards.get('src')!.grantedKeywords ?? []).toContain('Flying');

    // Declines with only a Forest (G can't pay {W}).
    let s2 = baseState();
    addCard(s2, 'src', 'bear');
    addCard(s2, 'for', 'forest');
    s2 = executeEffects(s2, p.ability.effects, 'p0', [], [], 0, { sourceInstanceId: 'src' });
    expect(s2.cards.get('for')!.tapped).toBe(false);
    expect(s2.cards.get('src')!.grantedKeywords ?? []).not.toContain('Flying');
  });

  // Aphelia, Viper Whisperer (real oracle text; self-name runtime-normalized to '~')
  it('Aphelia: hybrid "{1}{B/G}" pip is payable by either color (Forest covers the B/G pip)', () => {
    const p = parseOracleText('Whenever ~ attacks, you may pay {1}{B/G}. If you do, create a 1/1 black Snake creature token with deathtouch.');
    if (p.kind !== 'Triggered') throw new Error(`expected Triggered, got ${p.kind}`);
    const op = firstOptionalPay(p.ability.effects);
    expect(op.manaCost).toBe('{1}{B/G}');
    expect(op.effects[0].kind).toBe('CreateToken');

    // Two Forests: one covers the hybrid pip via its G side, one covers {1}.
    let s = baseState();
    addCard(s, 'f0', 'forest');
    addCard(s, 'f1', 'forest');
    s = executeEffects(s, p.ability.effects, 'p0', [], []);
    expect(tappedLands(s).length).toBe(2);
    expect([...s.cards.values()].some(c => c.isToken && c.zone === 'battlefield')).toBe(true);

    // Two Plains: W satisfies neither side of {B/G} → decline, no token.
    let s2 = baseState();
    addCard(s2, 'p0c', 'plains');
    addCard(s2, 'p1c', 'plains');
    s2 = executeEffects(s2, p.ability.effects, 'p0', [], []);
    expect(tappedLands(s2)).toEqual([]);
    expect([...s2.cards.values()].some(c => c.isToken)).toBe(false);
  });

  it('"{2}{R}" (Numot-style cost): refuses three Forests, pays with Mountain + two Forests', () => {
    const p = parseOracleText('You may pay {2}{R}. If you do, draw a card.');
    if (p.kind !== 'Spell') throw new Error('x');
    expect(firstOptionalPay(p.effects).manaCost).toBe('{2}{R}');

    // No red source → decline even though three lands are available.
    let s = baseState();
    addCard(s, 'f0', 'forest');
    addCard(s, 'f1', 'forest');
    addCard(s, 'f2', 'forest');
    addCard(s, 'lib', 'forest', 'library');
    s = executeEffects(s, p.effects, 'p0', [], []);
    expect(tappedLands(s)).toEqual([]);
    expect(handSize(s, 'p0')).toBe(0);

    // Mountain present → pays {2}{R} by tapping all three and draws.
    let s2 = baseState();
    addCard(s2, 'f0', 'forest');
    addCard(s2, 'f1', 'forest');
    addCard(s2, 'mtn', 'mountain');
    addCard(s2, 'lib', 'forest', 'library');
    s2 = executeEffects(s2, p.effects, 'p0', [], []);
    expect(tappedLands(s2).sort()).toEqual(['f0', 'f1', 'mtn']);
    expect(handSize(s2, 'p0')).toBe(1);
  });
});

describe('optional-pay trigger bodies — generic back-compat + energy', () => {
  // Slice example wording (Unassuming Sage-style ETB)
  it('"When this creature enters, you may pay {2}. If you do, draw a card." stays a numeric generic cost', () => {
    const p = parseOracleText('When this creature enters, you may pay {2}. If you do, draw a card.');
    if (p.kind !== 'ETB') throw new Error(`expected ETB, got ${p.kind}`);
    expect(p.ability.optional).toBe(true);
    const op = firstOptionalPay(p.ability.effects);
    expect(op.manaCost).toBe(2); // generic-only costs stay numbers (any two lands)

    let s = baseState();
    addCard(s, 'f0', 'forest');
    addCard(s, 'f1', 'forest');
    addCard(s, 'f2', 'forest');
    addCard(s, 'lib', 'forest', 'library');
    s = executeEffects(s, p.ability.effects, 'p0', [], []);
    expect(tappedLands(s).length).toBe(2);
    expect(handSize(s, 'p0')).toBe(1);
  });

  // Thriving Rats attack trigger (real oracle text)
  it('Thriving Rats: "Whenever this creature attacks, you may pay {E}{E}. If you do, put a +1/+1 counter on it." pays energy, not lands', () => {
    const p = parseOracleText('Whenever this creature attacks, you may pay {E}{E}. If you do, put a +1/+1 counter on it.');
    if (p.kind !== 'Triggered') throw new Error(`expected Triggered, got ${p.kind}`);
    const op = firstOptionalPay(p.ability.effects);
    expect(op.energyCost).toBe(2);
    expect(op.manaCost).toBeUndefined();

    // 3 energy → pays 2, adds the counter, and does NOT tap the (unrelated) land.
    let s = baseState();
    s.players[0] = { ...s.players[0], playerCounters: { energy: 3 } };
    addCard(s, 'src', 'bear');
    addCard(s, 'for', 'forest');
    s = executeEffects(s, p.ability.effects, 'p0', [], [], 0, { sourceInstanceId: 'src' });
    expect(s.players[0].playerCounters?.['energy']).toBe(1);
    expect(s.cards.get('src')!.counters['+1/+1']).toBe(1);
    expect(s.cards.get('for')!.tapped).toBe(false);

    // 1 energy → declines: no counter, energy unchanged.
    let s2 = baseState();
    s2.players[0] = { ...s2.players[0], playerCounters: { energy: 1 } };
    addCard(s2, 'src', 'bear');
    s2 = executeEffects(s2, p.ability.effects, 'p0', [], [], 0, { sourceInstanceId: 'src' });
    expect(s2.players[0].playerCounters?.['energy']).toBe(1);
    expect(s2.cards.get('src')!.counters['+1/+1']).toBeUndefined();
  });
});
