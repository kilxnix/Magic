import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { validateTargetChoices } from '../effects/targets';

/**
 * Coverage slice: filtered graveyard returns.
 *
 * "Return target <noun> card(s) from your graveyard to your hand / the
 * battlefield" now parses subtype filters (Goblin), AND-typed nouns (artifact
 * creature), OR-typed nouns (instant or sorcery), permanent cards, "up to N
 * target ... cards", and mana-value-bounded battlefield reanimation. Filters
 * land on TargetSpec.constraints (types / subtypes / cmc), enforced by
 * validateTargetChoices; the existing ReturnFromGraveyard executor honors
 * hand/battlefield destinations and (new) multi-target "up to N" specs.
 *
 * Real oracle wordings: Boggart Birth Rite, Sanguine Indulgence, Skeleton
 * Shard, Extraction Specialist, Kishla Trawlers.
 */

const defs: Record<string, CardDefinition> = {
  goblin: { id: 'goblin', name: 'Mons\'s Goblin Raiders', type_line: 'Creature — Goblin', oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'], keywords: [], card_types: ['creature'], power: 1, toughness: 1 },
  bear: { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'], power: 2, toughness: 2 },
  beast: { id: 'beast', name: 'Spined Wurm', type_line: 'Creature — Wurm', oracle_text: '', mana_cost: '{4}{G}', cmc: 5, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'], power: 5, toughness: 4 },
  construct: { id: 'construct', name: 'Bottle Gnomes', type_line: 'Artifact Creature — Gnome', oracle_text: '', mana_cost: '{3}', cmc: 3, colors: [], color_identity: [], keywords: [], card_types: ['artifact', 'creature'], power: 1, toughness: 3 },
  relic: { id: 'relic', name: 'Mind Stone', type_line: 'Artifact', oracle_text: '', mana_cost: '{2}', cmc: 2, colors: [], color_identity: [], keywords: [], card_types: ['artifact'] },
  bolt: { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'], keywords: [], card_types: ['instant'] },
  divination: { id: 'divination', name: 'Divination', type_line: 'Sorcery', oracle_text: '', mana_cost: '{2}{U}', cmc: 3, colors: ['U'], color_identity: ['U'], keywords: [], card_types: ['sorcery'] },
  glory: { id: 'glory', name: 'Glorious Anthem', type_line: 'Enchantment', oracle_text: '', mana_cost: '{1}{W}{W}', cmc: 3, colors: ['W'], color_identity: ['W'], keywords: [], card_types: ['enchantment'] },
};

function gyState(): GameState {
  const mk = (id: string, defId: string, owner = 'p0'): CardInstance => ({
    instanceId: id, definitionId: defId, ownerId: owner, zone: 'graveyard',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  });
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([
      ['gob1', mk('gob1', 'goblin')],
      ['bear1', mk('bear1', 'bear')],
      ['beast1', mk('beast1', 'beast')],
      ['con1', mk('con1', 'construct')],
      ['rel1', mk('rel1', 'relic')],
      ['bolt1', mk('bolt1', 'bolt')],
      ['div1', mk('div1', 'divination')],
      ['ench1', mk('ench1', 'glory')],
    ]),
    cardDefinitions: new Map(Object.entries(defs)),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'upkeep', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

const zone = (s: GameState, id: string) => s.cards.get(id)?.zone;

describe('cov-graveyard-filtered-returns', () => {
  it('Boggart Birth Rite: "Return target Goblin card from your graveyard to your hand." — subtype filter, parses and executes', () => {
    const p = parseOracleText('Return target Goblin card from your graveyard to your hand.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects[0]).toMatchObject({ kind: 'ReturnFromGraveyard', destination: 'hand' });
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('CardInGraveyard');
    expect(p.targets[0].constraints).toEqual({ subtypes: ['goblin'] });

    // Legality: the Goblin qualifies, a non-Goblin creature does not.
    const state = gyState();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['gob1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['bear1'])).toThrow(/goblin/i);

    const r = executeEffects(state, p.effects, 'p0', ['gob1'], p.targets);
    expect(zone(r, 'gob1')).toBe('hand');
    expect(zone(r, 'bear1')).toBe('graveyard');
  });

  it('Sanguine Indulgence: "Return up to two target creature cards from your graveyard to your hand." — count 2, both chosen cards return', () => {
    const p = parseOracleText('Return up to two target creature cards from your graveyard to your hand.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects[0]).toMatchObject({ kind: 'ReturnFromGraveyard', destination: 'hand' });
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('CreatureCardInGraveyard');
    expect(p.targets[0].count).toBe(2);

    const r = executeEffects(gyState(), p.effects, 'p0', ['bear1', 'beast1'], p.targets);
    expect(zone(r, 'bear1')).toBe('hand');
    expect(zone(r, 'beast1')).toBe('hand');
    // Unchosen cards untouched.
    expect(zone(r, 'gob1')).toBe('graveyard');
    expect(zone(r, 'rel1')).toBe('graveyard');
  });

  it('"up to two" with only one chosen card returns just that card', () => {
    const p = parseOracleText('Return up to two target creature cards from your graveyard to your hand.');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const r = executeEffects(gyState(), p.effects, 'p0', ['beast1'], p.targets);
    expect(zone(r, 'beast1')).toBe('hand');
    expect(zone(r, 'bear1')).toBe('graveyard');
  });

  it('Skeleton Shard ability text: "Return target artifact creature card from your graveyard to your hand." — AND of two types', () => {
    const p = parseOracleText('Return target artifact creature card from your graveyard to your hand.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets[0].type).toBe('CreatureCardInGraveyard');
    expect(p.targets[0].constraints).toEqual({ types: ['artifact'] });

    const state = gyState();
    // Artifact creature qualifies; a plain creature and a plain artifact do not.
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['con1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['bear1'])).toThrow(/artifact/i);
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['rel1'])).toThrow(/creature/i);

    const r = executeEffects(state, p.effects, 'p0', ['con1'], p.targets);
    expect(zone(r, 'con1')).toBe('hand');
  });

  it('Extraction Specialist: ETB mana-value-bounded reanimation parses and puts the card onto the battlefield', () => {
    const p = parseOracleText('When this creature enters, return target creature card with mana value 2 or less from your graveyard to the battlefield.');
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    expect(p.ability.effects[0]).toMatchObject({ kind: 'ReturnFromGraveyard', destination: 'battlefield' });
    expect(p.targets[0].type).toBe('CreatureCardInGraveyard');
    expect(p.targets[0].constraints).toEqual({ cmc: { op: 'lte', value: 2 } });

    const state = gyState();
    // Mana value 2 qualifies, mana value 5 does not.
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['bear1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['beast1'])).toThrow(/mana value/i);

    const r = executeEffects(state, p.ability.effects, 'p0', ['bear1'], p.targets);
    expect(zone(r, 'bear1')).toBe('battlefield');
  });

  it('Kishla Trawlers body: "Return target instant or sorcery card from your graveyard to your hand." — OR-typed filter', () => {
    const p = parseOracleText('Return target instant or sorcery card from your graveyard to your hand.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets[0].type).toBe('CardInGraveyard');
    expect(p.targets[0].constraints).toEqual({ types: ['instant', 'sorcery'] });

    const state = gyState();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['bolt1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['div1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['bear1'])).toThrow(/instant or sorcery/i);

    const r = executeEffects(state, p.effects, 'p0', ['bolt1'], p.targets);
    expect(zone(r, 'bolt1')).toBe('hand');
  });

  it('"Return target permanent card from your graveyard to your hand." — permanent card types only', () => {
    const p = parseOracleText('Return target permanent card from your graveyard to your hand.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets[0].type).toBe('CardInGraveyard');
    expect(p.targets[0].constraints?.types).toEqual(
      expect.arrayContaining(['artifact', 'creature', 'enchantment', 'land', 'planeswalker']),
    );

    const state = gyState();
    // Enchantment and artifact qualify; instant and sorcery do not.
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['ench1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['rel1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['bolt1'])).toThrow();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['div1'])).toThrow();

    const r = executeEffects(state, p.effects, 'p0', ['ench1'], p.targets);
    expect(zone(r, 'ench1')).toBe('hand');
  });

  it('regression: plain "Return target creature card from your graveyard to your hand." is unchanged (count 1, no constraints)', () => {
    const p = parseOracleText('Return target creature card from your graveyard to your hand.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets[0].type).toBe('CreatureCardInGraveyard');
    expect(p.targets[0].count).toBe(1);
    expect(p.targets[0].constraints).toBeUndefined();
  });

  it('regression: "Return target creature or enchantment card from your graveyard to your hand." keeps its dedicated target type', () => {
    const p = parseOracleText('Return target creature or enchantment card from your graveyard to your hand.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.targets[0].type).toBe('CreatureOrEnchantmentCardInGraveyard');
    expect(p.targets[0].constraints).toBeUndefined();
  });

  it('stays honest: supertype-qualified nouns ("legendary creature card") do not parse', () => {
    const p = parseOracleText('Return target legendary creature card from your graveyard to your hand.');
    expect(p.kind).toBe('Unparsed');
  });
});
