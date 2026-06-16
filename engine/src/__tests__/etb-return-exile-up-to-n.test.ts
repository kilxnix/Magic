import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { validateTargetChoices } from '../effects/targets';

/**
 * Coverage slice 9/12: ETB "return/exile up to N [other] target <type>
 * [you control]" patterns.
 *
 * New matcher: matchReturnUpToOneOtherTargetYouControlToHand
 *   Handles: "return up to one [other] target <permanent-type> [you control]
 *             to its owner's hand"
 *   Example cards: Winter Eladrin, Stickytongue Sentinel, Flock Impostor,
 *                  Rimekin Recluse, Exosuit Savior, Mischievous Pup.
 *
 * Extended: matchExile
 *   Handles: "exile up to N target cards from a single graveyard"
 *   Example cards: Gravegouger, Griffnaut Tracker.
 *
 * Also covers: Scholar of the Ages — "return up to two target instant and/or
 *   sorcery cards from your graveyard to your hand" (existing
 *   matchReturnFromGraveyard handles this correctly with count=2; verified
 *   here for regression).
 */

// ── shared state builders ──────────────────────────────────────────────────

const defs: Record<string, CardDefinition> = {
  bear: {
    id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear',
    oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
    keywords: [], card_types: ['creature'], power: 2, toughness: 2,
  },
  wolf: {
    id: 'wolf', name: 'Timber Wolves', type_line: 'Creature — Wolf',
    oracle_text: '', mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'],
    keywords: [], card_types: ['creature'], power: 1, toughness: 1,
  },
  artifact: {
    id: 'artifact', name: 'Mox Pearl', type_line: 'Artifact',
    oracle_text: '', mana_cost: '{0}', cmc: 0, colors: [], color_identity: [],
    keywords: [], card_types: ['artifact'],
  },
  enchantment: {
    id: 'enchantment', name: 'Glorious Anthem', type_line: 'Enchantment',
    oracle_text: '', mana_cost: '{1}{W}{W}', cmc: 3, colors: ['W'], color_identity: ['W'],
    keywords: [], card_types: ['enchantment'],
  },
  land: {
    id: 'land', name: 'Forest', type_line: 'Basic Land — Forest',
    oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
    keywords: [], card_types: ['land'],
  },
  bolt: {
    id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant',
    oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'],
    keywords: [], card_types: ['instant'],
  },
  divination: {
    id: 'divination', name: 'Divination', type_line: 'Sorcery',
    oracle_text: '', mana_cost: '{2}{U}', cmc: 3, colors: ['U'], color_identity: ['U'],
    keywords: [], card_types: ['sorcery'],
  },
  source: {
    id: 'source', name: 'Winter Eladrin', type_line: 'Creature — Elf',
    oracle_text: 'When this creature enters, return up to one other target creature you control to its owner\'s hand.',
    mana_cost: '{3}{U}', cmc: 4, colors: ['U'], color_identity: ['U'],
    keywords: [], card_types: ['creature'], power: 3, toughness: 3,
  },
};

function mkBattlefield(ownerId = 'p0'): GameState {
  const mk = (id: string, defId: string, owner = ownerId, zone: CardInstance['zone'] = 'battlefield'): CardInstance => ({
    instanceId: id, definitionId: defId, ownerId: owner, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  });
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([
      ['bear1', mk('bear1', 'bear', 'p0')],
      ['wolf1', mk('wolf1', 'wolf', 'p0')],
      ['art1', mk('art1', 'artifact', 'p0')],
      ['ench1', mk('ench1', 'enchantment', 'p0')],
      ['land1', mk('land1', 'land', 'p0')],
      ['bear2', mk('bear2', 'bear', 'p1')],   // opponent's creature
      ['src1', mk('src1', 'source', 'p0')],   // source creature (the entering card)
    ]),
    cardDefinitions: new Map(Object.entries(defs)),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'upkeep', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function mkGraveyard(ownerId = 'p0'): GameState {
  const mk = (id: string, defId: string, owner = ownerId): CardInstance => ({
    instanceId: id, definitionId: defId, ownerId: owner, zone: 'graveyard',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  });
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([
      ['bear1', mk('bear1', 'bear', 'p0')],
      ['bolt1', mk('bolt1', 'bolt', 'p0')],
      ['bolt2', mk('bolt2', 'bolt', 'p0')],
      ['div1', mk('div1', 'divination', 'p0')],
      ['bear_opp', mk('bear_opp', 'bear', 'p1')],
    ]),
    cardDefinitions: new Map(Object.entries(defs)),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'upkeep', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

const zone = (s: GameState, id: string) => s.cards.get(id)?.zone;

// ── parse tests ───────────────────────────────────────────────────────────

describe('etb-return-exile-up-to-n — parse', () => {
  it('Winter Eladrin ETB: "when this creature enters, return up to one other target creature you control to its owner\'s hand" — parses as ETB with controllerControls + notSource', () => {
    const p = parseOracleText(
      "When this creature enters, return up to one other target creature you control to its owner's hand.",
    );
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    expect(p.ability.effects[0]).toMatchObject({ kind: 'ReturnToHand' });
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Creature');
    expect(p.targets[0].constraints?.controllerControls).toBe(true);
    expect(p.targets[0].constraints?.notSource).toBe(true);
    expect(p.targets[0].count).toBe(1); // default count=1
  });

  it('Stickytongue Sentinel / Flock Impostor style: "return up to one target creature you control to its owner\'s hand" (no "other") — controllerControls only, no notSource', () => {
    const p = parseOracleText(
      "When this creature enters, return up to one target creature you control to its owner's hand.",
    );
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    expect(p.ability.effects[0]).toMatchObject({ kind: 'ReturnToHand' });
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('Creature');
    expect(p.targets[0].constraints?.controllerControls).toBe(true);
    expect(p.targets[0].constraints?.notSource).toBeUndefined();
  });

  it('"return up to one other target permanent you control to its owner\'s hand" — permanent type', () => {
    const p = parseOracleText(
      "When this creature enters, return up to one other target permanent you control to its owner's hand.",
    );
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    expect(p.targets[0].type).toBe('Permanent');
    expect(p.targets[0].constraints?.controllerControls).toBe(true);
    expect(p.targets[0].constraints?.notSource).toBe(true);
  });

  it('"return up to one other target nonland permanent you control to its owner\'s hand" — nonland permanent type', () => {
    const p = parseOracleText(
      "When this creature enters, return up to one other target nonland permanent you control to its owner's hand.",
    );
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    expect(p.targets[0].type).toBe('NonlandPermanent');
    expect(p.targets[0].constraints?.controllerControls).toBe(true);
    expect(p.targets[0].constraints?.notSource).toBe(true);
  });

  it('Mischievous Pup style (bare "return up to one target creature to its owner\'s hand" without you-control) — still parses via existing matchReturnToHand', () => {
    const p = parseOracleText(
      "When this creature enters, return up to one target creature to its owner's hand.",
    );
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    expect(p.ability.effects[0]).toMatchObject({ kind: 'ReturnToHand' });
    expect(p.targets[0].type).toBe('Creature');
    // No controllerControls or notSource — plain bounce
    expect(p.targets[0].constraints?.controllerControls).toBeUndefined();
  });

  it('Gravegouger / Griffnaut Tracker: "exile up to two target cards from a single graveyard" — parses as Exile with count=2', () => {
    const p = parseOracleText(
      'When this creature enters, exile up to two target cards from a single graveyard.',
    );
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    expect(p.ability.effects[0]).toMatchObject({ kind: 'Exile' });
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].type).toBe('CardInGraveyard');
    expect(p.targets[0].count).toBe(2);
  });

  it('"exile up to two target cards from a single graveyard" as spell (not ETB) — also parses', () => {
    const p = parseOracleText('Exile up to two target cards from a single graveyard.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects[0]).toMatchObject({ kind: 'Exile' });
    expect(p.targets[0].type).toBe('CardInGraveyard');
    expect(p.targets[0].count).toBe(2);
  });

  it('Scholar of the Ages regression: "return up to two target instant and/or sorcery cards from your graveyard to your hand" — parses with count=2', () => {
    const p = parseOracleText(
      "When this creature enters, return up to two target instant and/or sorcery cards from your graveyard to your hand.",
    );
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    expect(p.ability.effects[0]).toMatchObject({ kind: 'ReturnFromGraveyard', destination: 'hand' });
    expect(p.targets[0].type).toBe('CardInGraveyard');
    expect(p.targets[0].count).toBe(2);
  });
});

// ── execution tests ───────────────────────────────────────────────────────

describe('etb-return-exile-up-to-n — execute', () => {
  it('Winter Eladrin: target own creature — bounces it to hand; controllerControls enforced (opponent\'s creature rejected)', () => {
    const p = parseOracleText(
      "When this creature enters, return up to one other target creature you control to its owner's hand.",
    );
    if (p.kind !== 'ETB') throw new Error('expected ETB');
    const state = mkBattlefield();

    // Own creature bounces successfully.
    const r = executeEffects(state, p.ability.effects, 'p0', ['bear1'], p.targets);
    expect(zone(r, 'bear1')).toBe('hand');
    // Source creature and opponent's creature untouched.
    expect(zone(r, 'src1')).toBe('battlefield');
    expect(zone(r, 'bear2')).toBe('battlefield');

    // Validation: own creature valid; opponent's creature must fail controllerControls.
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['bear1'])).not.toThrow();
    expect(() => validateTargetChoices(state, 'p0', p.targets, ['bear2'])).toThrow(/controlled by you/i);
  });

  it('Winter Eladrin: notSource enforced — source creature itself cannot be chosen', () => {
    const p = parseOracleText(
      "When this creature enters, return up to one other target creature you control to its owner's hand.",
    );
    if (p.kind !== 'ETB') throw new Error('expected ETB');
    const state = mkBattlefield();

    // 'src1' is the source permanent — notSource should reject it.
    // The 5th argument to validateTargetChoices is the sourceInstanceId.
    expect(() =>
      validateTargetChoices(state, 'p0', p.targets, ['src1'], 'src1'),
    ).toThrow(/another object/i);
  });

  it('Gravegouger: exile up to two graveyard cards — both exiled when two chosen', () => {
    const p = parseOracleText(
      'When this creature enters, exile up to two target cards from a single graveyard.',
    );
    if (p.kind !== 'ETB') throw new Error('expected ETB');
    const state = mkGraveyard();

    const r = executeEffects(state, p.ability.effects, 'p0', ['bolt1', 'bolt2'], p.targets);
    expect(zone(r, 'bolt1')).toBe('exile');
    expect(zone(r, 'bolt2')).toBe('exile');
    // Unchosen graveyard card untouched.
    expect(zone(r, 'bear1')).toBe('graveyard');
  });

  it('Gravegouger: exile up to two — only one chosen → only that card exiled', () => {
    const p = parseOracleText(
      'When this creature enters, exile up to two target cards from a single graveyard.',
    );
    if (p.kind !== 'ETB') throw new Error('expected ETB');
    const state = mkGraveyard();

    const r = executeEffects(state, p.ability.effects, 'p0', ['div1'], p.targets);
    expect(zone(r, 'div1')).toBe('exile');
    expect(zone(r, 'bolt1')).toBe('graveyard');
  });

  it('Scholar of the Ages: return up to two instant/sorcery cards — both hand-returned', () => {
    const p = parseOracleText(
      "When this creature enters, return up to two target instant and/or sorcery cards from your graveyard to your hand.",
    );
    if (p.kind !== 'ETB') throw new Error('expected ETB');
    const state = mkGraveyard();

    // bolt1 = instant, div1 = sorcery — both qualify.
    const r = executeEffects(state, p.ability.effects, 'p0', ['bolt1', 'div1'], p.targets);
    expect(zone(r, 'bolt1')).toBe('hand');
    expect(zone(r, 'div1')).toBe('hand');
    // Creature card in graveyard untouched.
    expect(zone(r, 'bear1')).toBe('graveyard');
  });

  it('"return up to one target creature you control" — own permanent-type creature bounces correctly', () => {
    const p = parseOracleText(
      "When this creature enters, return up to one other target permanent you control to its owner's hand.",
    );
    if (p.kind !== 'ETB') throw new Error('expected ETB');
    const state = mkBattlefield();

    // Artifact is a permanent controlled by p0.
    const r = executeEffects(state, p.ability.effects, 'p0', ['art1'], p.targets);
    expect(zone(r, 'art1')).toBe('hand');
    expect(zone(r, 'ench1')).toBe('battlefield');
  });
});
