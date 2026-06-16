import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { canBlock, instanceHasKeyword } from '../keywords';
import { getCardsInZone, initGameState } from '../game-state';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import type { CardDefinition, GameState } from '../types';

function creature(
  id: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature — Test',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{1}',
    cmc: opts.cmc ?? 1,
    colors: opts.colors ?? [],
    color_identity: opts.color_identity ?? [],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

/**
 * Both players' cards land on the battlefield (unless listed in `zones`) and
 * continuous statics are registered exactly the way the real ETB pipeline does
 * (registerContinuousAbilitiesForPermanent → parseOracleText per line).
 */
function setup(
  p1Defs: CardDefinition[],
  p2Defs: CardDefinition[] = [creature('dummy')],
  zones: Record<string, 'graveyard' | 'library'> = {},
) {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: p1Defs, commanderId: 'none1' },
    { playerId: 'p2', name: 'Bob', cards: p2Defs, commanderId: 'none2' },
  ];
  let state = initGameState(decks);
  for (const [id, card] of state.cards) {
    const zone = zones[card.definitionId] ?? 'battlefield';
    state.cards.set(id, { ...card, zone, summoningSick: false });
  }
  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') {
      state = registerContinuousAbilitiesForPermanent(state, card.instanceId);
    }
  }
  const idFor = (defId: string) =>
    [...state.cards.values()].find(c => c.definitionId === defId)!.instanceId;
  return { state, idFor };
}

function setLife(state: GameState, playerId: string, life: number): GameState {
  return {
    ...state,
    players: state.players.map(p => (p.id === playerId ? { ...p, life } : p)),
  };
}

// ============================================================================
// Parse level — real oracle wordings
// ============================================================================

describe('conditional self statics — parser recognition', () => {
  it('Guul Draz Vampire: "As long as an opponent has 10 or less life, this creature gets +2/+1 and has intimidate."', () => {
    const r = parseOracleText(
      'As long as an opponent has 10 or less life, this creature gets +2/+1 and has intimidate.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 1 });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toEqual({ kind: 'LifeAtOrBelow', controller: 'opponent', amount: 10 });
  });

  it('Krosan Beast: Threshold suffix form ("gets +7/+7 as long as there are seven or more cards in your graveyard")', () => {
    const r = parseOracleText(
      'Threshold — This creature gets +7/+7 as long as there are seven or more cards in your graveyard.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 7, toughness: 7 });
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.condition).toEqual({
      kind: 'CardsInZoneAtLeast', controller: 'you', zone: 'graveyard', count: 7,
    });
  });

  it('Anurid Barkripper: Threshold prefix form ("As long as there are seven or more cards in your graveyard, ...")', () => {
    const r = parseOracleText(
      'Threshold — As long as there are seven or more cards in your graveyard, this creature gets +2/+2.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 2 });
    expect(r.ability.condition).toEqual({
      kind: 'CardsInZoneAtLeast', controller: 'you', zone: 'graveyard', count: 7,
    });
  });

  it('Esper Stormblade: "As long as you control another multicolored permanent, this creature gets +1/+1 and has flying."', () => {
    const r = parseOracleText(
      'As long as you control another multicolored permanent, this creature gets +1/+1 and has flying.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.condition).toEqual(expect.objectContaining({
      kind: 'ControlsType',
      controller: 'you',
      excludeSource: true,
      filter: expect.objectContaining({ multicolored: true, permanent: true }),
    }));
  });

  it('mass form: "As long as you control a Forest, creatures you control have trample."', () => {
    const r = parseOracleText('As long as you control a Forest, creatures you control have trample.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'trample' });
    expect(r.ability.controller).toBe('you');
    expect(r.ability.filter).toEqual({ types: ['creature'] });
    expect(r.ability.condition).toEqual({
      kind: 'ControlsType',
      controller: 'you',
      filter: { types: ['land'], subtypes: ['forest'] },
    });
  });

  it('Metalcraft count form: "have shroud as long as you control three or more artifacts"', () => {
    const r = parseOracleText(
      'Metalcraft — Artifacts you control have shroud as long as you control three or more artifacts.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'shroud' });
    expect(r.ability.condition).toEqual({
      kind: 'CardsInZoneAtLeast', controller: 'you', zone: 'battlefield', count: 3,
      filter: { types: ['artifact'] },
    });
  });

  it('life-threshold form: "As long as you have 7 or more life, ..." → LifeAtOrAbove', () => {
    const r = parseOracleText('As long as you have 7 or more life, this creature gets +2/+2.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.condition).toEqual({ kind: 'LifeAtOrAbove', controller: 'you', amount: 7 });
  });

  it('Zanam Djinn: color-census condition ("as long as blue is the most common color among all permanents or is tied for most common")', () => {
    const r = parseOracleText(
      'Flying\nThis creature gets -2/-2 as long as blue is the most common color among all permanents or is tied for most common.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: -2, toughness: -2 });
    expect(r.ability.condition).toEqual({
      kind: 'ColorIsMostCommonAmongPermanents', color: 'U', orTiedForMost: true,
    });
  });

  it('conditions with NO evaluator are honestly Unparsed (never claimed unconditionally)', () => {
    // Suffix forms previously swallowed unconditionally by matchStaticAbility.
    expect(parseOracleText("~ gets +2/+2 as long as you have the city's blessing.").kind).toBe('Unparsed');
    // NOTE: "as long as it's attacking" gained SelfIsAttacking evaluator in slice 2 —
    // removed from this list; it now correctly parses as StaticAbility.
    expect(parseOracleText('~ has indestructible as long as it has a divinity counter on it.').kind).toBe('Unparsed');
    // Prefix forms.
    expect(parseOracleText("As long as it's your turn, this creature has first strike.").kind).toBe('Unparsed');
    expect(parseOracleText('As long as this creature is paired with another creature, both creatures have vigilance.').kind).toBe('Unparsed');
    // Hellbent ("no cards in hand") has no at-most evaluator.
    expect(parseOracleText('Hellbent — This creature gets +2/+2 as long as you have no cards in hand.').kind).toBe('Unparsed');
  });

  it('slice 2: SelfIsAttacking evaluator added — "has first strike as long as it\'s attacking" parses', () => {
    // Slice 2 (cond-self-buff) added SelfIsAttacking to the Condition AST and evaluator,
    // so this conditional keyword grant now passes the honesty bar.
    const r = parseOracleText("This creature has first strike as long as it's attacking.");
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'first strike' });
    expect(r.ability.condition).toEqual({ kind: 'SelfIsAttacking' });
    expect(r.ability.selfOnly).toBe(true);
  });
});

// ============================================================================
// Execution level — the registered static is genuinely gated on the condition
// ============================================================================

describe('conditional self statics — engine EXECUTES the condition gate', () => {
  it('Guul Draz Vampire: +2/+1 only while an opponent is at 10 or less life', () => {
    const guulDraz = creature('guul', {
      name: 'Guul Draz Vampire',
      oracle_text: 'As long as an opponent has 10 or less life, this creature gets +2/+1 and has intimidate.',
      colors: ['B'],
      power: 1,
      toughness: 1,
    });
    const { state, idFor } = setup([guulDraz]);
    const id = idFor('guul');

    // Opponent at 40 life: condition false, base 1/1.
    expect(getEffectivePower(state, id)).toBe(1);
    expect(getEffectiveToughness(state, id)).toBe(1);

    // Opponent drops to 10: condition true, 3/2. No re-registration needed —
    // the gate is evaluated at query time.
    const low = setLife(state, 'p2', 10);
    expect(getEffectivePower(low, id)).toBe(3);
    expect(getEffectiveToughness(low, id)).toBe(2);

    // Back above 10: condition false again.
    const high = setLife(state, 'p2', 11);
    expect(getEffectivePower(high, id)).toBe(1);
  });

  it('Guul Draz Vampire: intimidate is enforced in combat (combat.ts canBlock)', () => {
    const guulDraz = creature('guul', {
      name: 'Guul Draz Vampire',
      oracle_text: 'As long as an opponent has 10 or less life, this creature gets +2/+1 and has intimidate.',
      colors: ['B'],
      power: 1,
      toughness: 1,
    });
    const whiteBlocker = creature('wblock', { colors: ['W'] });
    const blackBlocker = creature('bblock', { colors: ['B'] });
    let { state, idFor } = setup([guulDraz], [whiteBlocker, blackBlocker]);
    state = setLife(state, 'p2', 10);

    // Intimidate: only artifact creatures / creatures sharing a color may block.
    expect(canBlock(state, idFor('wblock'), idFor('guul'))).toBe(false);
    expect(canBlock(state, idFor('bblock'), idFor('guul'))).toBe(true);
  });

  it('Krosan Beast (Threshold suffix): +7/+7 only with seven or more cards in your graveyard', () => {
    const krosan = creature('krosan', {
      name: 'Krosan Beast',
      oracle_text: 'Threshold — This creature gets +7/+7 as long as there are seven or more cards in your graveyard.',
      colors: ['G'],
      power: 1,
      toughness: 1,
    });
    const fillers = Array.from({ length: 7 }, (_, i) => creature(`fill${i}`));
    const zones: Record<string, 'graveyard' | 'library'> = { fill6: 'library' };
    for (let i = 0; i < 6; i++) zones[`fill${i}`] = 'graveyard';

    // Six cards in graveyard: condition false → 1/1.
    const six = setup([krosan, ...fillers], undefined, zones);
    expect(getEffectivePower(six.state, six.idFor('krosan'))).toBe(1);
    expect(getEffectiveToughness(six.state, six.idFor('krosan'))).toBe(1);

    // Seventh card hits the graveyard: 8/8.
    const sevenZones = { ...zones, fill6: 'graveyard' as const };
    const seven = setup([krosan, ...fillers], undefined, sevenZones);
    expect(getEffectivePower(seven.state, seven.idFor('krosan'))).toBe(8);
    expect(getEffectiveToughness(seven.state, seven.idFor('krosan'))).toBe(8);
  });

  it('Anurid Barkripper (Threshold prefix): +2/+2 only at threshold', () => {
    const anurid = creature('anurid', {
      name: 'Anurid Barkripper',
      oracle_text: 'Threshold — As long as there are seven or more cards in your graveyard, this creature gets +2/+2.',
      colors: ['G'],
      power: 2,
      toughness: 2,
    });
    const fillers = Array.from({ length: 7 }, (_, i) => creature(`fill${i}`));
    const zones: Record<string, 'graveyard' | 'library'> = {};
    for (let i = 0; i < 7; i++) zones[`fill${i}`] = 'graveyard';

    const { state, idFor } = setup([anurid, ...fillers], undefined, zones);
    expect(getEffectivePower(state, idFor('anurid'))).toBe(4);
    expect(getEffectiveToughness(state, idFor('anurid'))).toBe(4);
  });

  it('Esper Stormblade: +1/+1 AND flying only while you control ANOTHER multicolored permanent', () => {
    const stormblade = creature('stormblade', {
      name: 'Esper Stormblade',
      oracle_text: 'As long as you control another multicolored permanent, this creature gets +1/+1 and has flying.',
      colors: ['W', 'U', 'B'],
      power: 2,
      toughness: 1,
    });

    // Alone: the Stormblade itself is multicolored but "another" excludes it.
    const alone = setup([stormblade]);
    const aloneId = alone.idFor('stormblade');
    expect(getEffectivePower(alone.state, aloneId)).toBe(2);
    expect(getEffectiveToughness(alone.state, aloneId)).toBe(1);
    expect(instanceHasKeyword(alone.state, aloneId, 'Flying')).toBe(false);

    // With another multicolored permanent: 3/2 with flying.
    const friend = creature('friend', { colors: ['W', 'U'] });
    const together = setup([stormblade, friend]);
    const id = together.idFor('stormblade');
    expect(getEffectivePower(together.state, id)).toBe(3);
    expect(getEffectiveToughness(together.state, id)).toBe(2);
    expect(instanceHasKeyword(together.state, id, 'Flying')).toBe(true);

    // A monocolored friend does NOT satisfy the condition.
    const monoFriend = creature('mono', { colors: ['G'] });
    const mono = setup([stormblade, monoFriend]);
    const monoId = mono.idFor('stormblade');
    expect(getEffectivePower(mono.state, monoId)).toBe(2);
    expect(instanceHasKeyword(mono.state, monoId, 'Flying')).toBe(false);
  });

  it('Sulam Djinn: -2/-2 only while green is the most common color (or tied) among ALL permanents', () => {
    const sulam = creature('sulam', {
      name: 'Sulam Djinn',
      oracle_text: 'Trample\nThis creature gets -2/-2 as long as green is the most common color among all permanents or is tied for most common.',
      colors: ['G'],
      power: 6,
      toughness: 6,
    });

    // Alone on the board the Djinn itself makes green the most common color.
    const alone = setup([sulam]);
    expect(getEffectivePower(alone.state, alone.idFor('sulam'))).toBe(4);
    expect(getEffectiveToughness(alone.state, alone.idFor('sulam'))).toBe(4);

    // Two white permanents (incl. the opponent's) outnumber green: full 6/6.
    const w1 = creature('w1', { colors: ['W'] });
    const w2 = creature('w2', { colors: ['W'] });
    const outnumbered = setup([sulam, w1], [w2]);
    expect(getEffectivePower(outnumbered.state, outnumbered.idFor('sulam'))).toBe(6);
    expect(getEffectiveToughness(outnumbered.state, outnumbered.idFor('sulam'))).toBe(6);

    // One white permanent ties green 1-1: "tied for most common" → -2/-2.
    const tied = setup([sulam], [w2]);
    expect(getEffectivePower(tied.state, tied.idFor('sulam'))).toBe(4);
  });

  it('mass conditional grant: creatures you control have trample only while you control a Forest', () => {
    const lord = creature('lord', {
      oracle_text: 'As long as you control a Forest, creatures you control have trample.',
    });
    const grizzly = creature('grizzly');
    const enemy = creature('enemy');
    const forest: CardDefinition = {
      id: 'forest',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '',
      mana_cost: '',
      cmc: 0,
      colors: [],
      color_identity: ['G'],
      keywords: [],
      card_types: ['land'],
    };

    // No Forest: nobody has trample.
    const dry = setup([lord, grizzly], [enemy]);
    expect(instanceHasKeyword(dry.state, dry.idFor('grizzly'), 'Trample')).toBe(false);
    expect(instanceHasKeyword(dry.state, dry.idFor('lord'), 'Trample')).toBe(false);

    // With a Forest: your creatures have trample, the opponent's do not.
    const wet = setup([lord, grizzly, forest], [enemy]);
    expect(instanceHasKeyword(wet.state, wet.idFor('grizzly'), 'Trample')).toBe(true);
    expect(instanceHasKeyword(wet.state, wet.idFor('lord'), 'Trample')).toBe(true);
    expect(instanceHasKeyword(wet.state, wet.idFor('enemy'), 'Trample')).toBe(false);
  });
});
