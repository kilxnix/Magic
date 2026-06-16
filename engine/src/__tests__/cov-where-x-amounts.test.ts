import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, ForEachAmount } from '../effects/ast';

// Coverage category: dynamic amount suffixes — "where X is the number of ..."
// and the generalized "equal to the number of <filter> <place>" shapes, all
// emitting the executor-backed ForEachAmount (resolveAmount counts matching
// cards in the zone at resolution time). Wordings come from real cards:
// Ghoul's Feast, Skred, Vile Deacon, Elder of Laurels, Armed Response, and the
// Malakir Blood-Priest drain template.

function def(id: string, name: string, typeLine: string, types: string[], pt?: [number, number]): CardDefinition {
  return {
    id, name, type_line: typeLine, oracle_text: '', mana_cost: '{1}', cmc: 1,
    colors: [], color_identity: [], keywords: [], card_types: types as CardDefinition['card_types'],
    ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
  };
}

const DEFS: CardDefinition[] = [
  def('d_beast', 'Beast', 'Creature — Beast', ['creature'], [2, 4]),
  def('d_cleric', 'Cleric', 'Creature — Human Cleric', ['creature'], [1, 1]),
  def('d_zombie', 'Zombie', 'Creature — Zombie', ['creature'], [2, 2]),
  def('d_elf', 'Elf', 'Creature — Elf Druid', ['creature'], [1, 1]),
  def('d_snowland', 'Snow-Covered Mountain', 'Snow Land — Mountain', ['land']),
  def('d_forest', 'Forest', 'Basic Land — Forest', ['land']),
  def('d_equip', 'Sword', 'Artifact — Equipment', ['artifact']),
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
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function expectForEach(amount: unknown): ForEachAmount {
  expect(amount && typeof amount === 'object').toBe(true);
  const a = amount as ForEachAmount;
  expect(a.kind).toBe('ForEach');
  return a;
}

describe('where-x: pump with "where X is the number of ..." (ModifyPT)', () => {
  it('parses and executes Ghoul\'s Feast (+X/+0, creature cards in your graveyard)', () => {
    const parsed = parseOracleText(
      "Target creature gets +X/+0 until end of turn, where X is the number of creature cards in your graveyard.",
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');

    const eff = parsed.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;
    expect(eff.untilEndOfTurn).toBe(true);
    expect(eff.toughness).toBe(0);
    const fe = expectForEach(eff.power);
    expect(fe.zone).toBe('graveyard');
    expect(fe.controller).toBe('you');
    expect(fe.filter).toEqual({ types: ['creature'] });

    // Execute: 3 creature cards + 1 instant in the graveyard → +3/+0.
    const state = st([
      mk('tgt', 'd_beast', 'p0', 'battlefield'),
      mk('gy1', 'd_zombie', 'p0', 'graveyard'),
      mk('gy2', 'd_zombie', 'p0', 'graveyard'),
      mk('gy3', 'd_elf', 'p0', 'graveyard'),
      mk('gy4', 'd_instant', 'p0', 'graveyard'),
    ]);
    const s = executeEffects(state, parsed.effects, 'p0', ['tgt'], [{ id: parsed.targets[0].id }]);
    expect(s.cards.get('tgt')!.counters['_powerMod']).toBe(3);
    expect(s.cards.get('tgt')!.counters['_toughnessMod'] ?? 0).toBe(0);
  });

  it('parses Elder of Laurels\' activated ability (+X/+X, creatures you control)', () => {
    const parsed = parseOracleText(
      '{3}{G}: Target creature gets +X/+X until end of turn, where X is the number of creatures you control.',
    );
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    const ability = parsed.abilities[0];
    const eff = ability.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;
    const power = expectForEach(eff.power);
    const toughness = expectForEach(eff.toughness);
    expect(power).toEqual({ kind: 'ForEach', zone: 'battlefield', controller: 'you', filter: { types: ['creature'] } });
    expect(toughness).toEqual(power);
    expect(ability.targets).toHaveLength(1);
    expect(ability.targets[0].type).toBe('Creature');
  });

  it('parses and executes Vile Deacon\'s attack trigger (it gets +X/+X, Clerics on the battlefield)', () => {
    const parsed = parseOracleText(
      'Whenever ~ attacks, it gets +X/+X until end of turn, where X is the number of Clerics on the battlefield.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('ModifyPT');
    if (eff.kind !== 'ModifyPT') return;
    expect(eff.target).toEqual({ kind: 'Source' });
    const fe = expectForEach(eff.power);
    expect(fe.zone).toBe('battlefield');
    expect(fe.controller).toBe('each');
    expect(fe.filter).toEqual({ types: ['creature'], subtypes: ['cleric'] });

    // Execute: source cleric (p0) + an opposing cleric (p1) + a non-cleric → X = 2.
    const state = st([
      mk('deacon', 'd_cleric', 'p0', 'battlefield'),
      mk('foecleric', 'd_cleric', 'p1', 'battlefield'),
      mk('beast', 'd_beast', 'p0', 'battlefield'),
    ]);
    const s = executeEffects(state, parsed.ability.effects, 'p0', [], [], 0, { sourceInstanceId: 'deacon' });
    expect(s.cards.get('deacon')!.counters['_powerMod']).toBe(2);
    expect(s.cards.get('deacon')!.counters['_toughnessMod']).toBe(2);
  });
});

describe('where-x: damage "equal to the number of <filter> <place>"', () => {
  it('parses and executes Skred (snow permanents you control)', () => {
    const parsed = parseOracleText(
      '~ deals damage to target creature equal to the number of snow permanents you control.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    const fe = expectForEach(eff.amount);
    expect(fe.zone).toBe('battlefield');
    expect(fe.controller).toBe('you');
    expect(fe.filter).toEqual({ supertypes: ['Snow'], permanent: true });

    // Execute: 2 snow lands + 1 ordinary forest → 2 damage to the chosen creature.
    const state = st([
      mk('foe', 'd_beast', 'p1', 'battlefield'),
      mk('s1', 'd_snowland', 'p0', 'battlefield'),
      mk('s2', 'd_snowland', 'p0', 'battlefield'),
      mk('f1', 'd_forest', 'p0', 'battlefield'),
    ]);
    const s = executeEffects(state, parsed.effects, 'p0', ['foe'], [{ id: parsed.targets[0].id }]);
    expect(s.cards.get('foe')!.damage).toBe(2);
  });

  it('parses Armed Response (target attacking creature, Equipment you control)', () => {
    const parsed = parseOracleText(
      '~ deals damage to target attacking creature equal to the number of Equipment you control.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].constraints?.combatStatus).toBe('attacking');
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    const fe = expectForEach(eff.amount);
    expect(fe).toEqual({ kind: 'ForEach', zone: 'battlefield', controller: 'you', filter: { subtypes: ['equipment'] } });
  });

  it('parses "deals X damage ... where X is" and keeps plain {X} damage intact', () => {
    const parsed = parseOracleText(
      '~ deals X damage to target player, where X is the number of Zombies you control.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    const fe = expectForEach(eff.amount);
    expect(fe.filter).toEqual({ types: ['creature'], subtypes: ['zombie'] });

    // Regression: cast-time {X} damage (no where-clause) still parses as X.
    const plain = parseOracleText('~ deals X damage to any target.');
    expect(plain.kind).toBe('Spell');
    if (plain.kind !== 'Spell') return;
    const plainEff = plain.effects[0];
    expect(plainEff.kind).toBe('DealDamage');
    if (plainEff.kind !== 'DealDamage') return;
    expect(plainEff.amount).toEqual({ kind: 'X' });
  });
});

describe('where-x: drain / life / draw / mill / counters', () => {
  it('parses and executes the Malakir Blood-Priest drain template', () => {
    const parsed = parseOracleText(
      'Each opponent loses X life and you gain X life, where X is the number of Zombies you control.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(2);
    const lose = parsed.effects[0];
    const gain = parsed.effects[1];
    expect(lose.kind).toBe('LoseLife');
    expect(gain.kind).toBe('GainLife');
    if (lose.kind !== 'LoseLife' || gain.kind !== 'GainLife') return;
    expect(lose.player).toEqual({ kind: 'EachOpponent' });
    expect(gain.player).toEqual({ kind: 'Controller' });
    expect(expectForEach(lose.amount)).toEqual(expectForEach(gain.amount));

    const state = st([
      mk('z1', 'd_zombie', 'p0', 'battlefield'),
      mk('z2', 'd_zombie', 'p0', 'battlefield'),
      mk('beast', 'd_beast', 'p1', 'battlefield'),
    ]);
    const s = executeEffects(state, parsed.effects, 'p0', [], []);
    expect(s.players.find(p => p.id === 'p1')!.life).toBe(38); // 40 - 2
    expect(s.players.find(p => p.id === 'p0')!.life).toBe(42); // 40 + 2
  });

  it('parses and executes "Draw X cards, where X is the number of Elves you control"', () => {
    const parsed = parseOracleText('Draw X cards, where X is the number of Elves you control.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Draw');
    if (eff.kind !== 'Draw') return;
    expect(eff.player).toEqual({ kind: 'Controller' });
    expect(expectForEach(eff.count).filter).toEqual({ types: ['creature'], subtypes: ['elf'] });

    const state = st([
      mk('e1', 'd_elf', 'p0', 'battlefield'),
      mk('e2', 'd_elf', 'p0', 'battlefield'),
      mk('l1', 'd_instant', 'p0', 'library'),
      mk('l2', 'd_instant', 'p0', 'library'),
      mk('l3', 'd_instant', 'p0', 'library'),
    ]);
    const s = executeEffects(state, parsed.effects, 'p0', [], []);
    const inHand = [...s.cards.values()].filter(c => c.zone === 'hand' && c.ownerId === 'p0');
    expect(inHand).toHaveLength(2);
  });

  it('parses "You mill X cards, where X is the number of artifacts you control"', () => {
    const parsed = parseOracleText('You mill X cards, where X is the number of artifacts you control.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Mill');
    if (eff.kind !== 'Mill') return;
    expect(expectForEach(eff.count).filter).toEqual({ types: ['artifact'] });
  });

  it('parses "You gain X life, where X is the number of cards in your hand" (zone count)', () => {
    const parsed = parseOracleText('You gain X life, where X is the number of cards in your hand.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('GainLife');
    if (eff.kind !== 'GainLife') return;
    const fe = expectForEach(eff.amount);
    expect(fe.zone).toBe('hand');
    expect(fe.controller).toBe('you');
    expect(fe.filter).toBeUndefined();
  });

  it('parses "You lose X life, where X is the number of creature cards in all graveyards"', () => {
    const parsed = parseOracleText('You lose X life, where X is the number of creature cards in all graveyards.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('LoseLife');
    if (eff.kind !== 'LoseLife') return;
    const fe = expectForEach(eff.amount);
    expect(fe.zone).toBe('graveyard');
    expect(fe.controller).toBe('each');
    expect(fe.filter).toEqual({ types: ['creature'] });
  });

  it('parses and executes "Put X +1/+1 counters on target creature, where X is the number of lands you control"', () => {
    const parsed = parseOracleText(
      'Put X +1/+1 counters on target creature, where X is the number of lands you control.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('AddCounters');
    if (eff.kind !== 'AddCounters') return;
    expect(eff.counterType).toBe('+1/+1');
    expect(expectForEach(eff.count).filter).toEqual({ types: ['land'] });

    const state = st([
      mk('tgt', 'd_beast', 'p0', 'battlefield'),
      mk('f1', 'd_forest', 'p0', 'battlefield'),
      mk('f2', 'd_forest', 'p0', 'battlefield'),
      mk('f3', 'd_forest', 'p0', 'battlefield'),
    ]);
    const s = executeEffects(state, parsed.effects, 'p0', ['tgt'], [{ id: parsed.targets[0].id }]);
    expect(s.cards.get('tgt')!.counters['+1/+1']).toBe(3);
  });
});

describe('where-x: honesty bar — unsupported amount sources stay Unparsed', () => {
  it('does not parse devotion-based X', () => {
    expect(parseOracleText(
      'Target creature gets +X/+X until end of turn, where X is your devotion to green.',
    ).kind).toBe('Unparsed');
  });

  it('does not parse party-count X (Malakir Blood-Priest actual filter)', () => {
    expect(parseOracleText(
      'Each opponent loses X life and you gain X life, where X is the number of creatures in your party.',
    ).kind).toBe('Unparsed');
  });

  it('does not parse "number of times" counts (mutate)', () => {
    expect(parseOracleText(
      'You gain X life, where X is the number of times this creature has mutated.',
    ).kind).toBe('Unparsed');
  });

  it('does not parse storm-count counters', () => {
    expect(parseOracleText(
      'Put X +1/+1 counters on target creature, where X is the storm count.',
    ).kind).toBe('Unparsed');
  });
});
