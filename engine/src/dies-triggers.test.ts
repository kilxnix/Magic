import { describe, it, expect } from 'vitest';
import { parseOracleText } from './effects/parser';
import { checkStateBasedActions } from './state-based';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition, TriggeredAbilityRef } from './types';

// ============================================================================
// Parser tests
// ============================================================================

describe('Dies trigger parsing', () => {
  it('parses "When ~ dies, draw a card."', () => {
    const result = parseOracleText('When ~ dies, draw a card.');

    expect(result.kind).toBe('Dies');
    if (result.kind !== 'Dies') return;

    expect(result.ability.kind).toBe('TriggeredAbility');
    expect(result.ability.trigger.kind).toBe('Dies');
    expect(result.ability.trigger.who).toBe('self');

    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('Draw');
    const draw = result.ability.effects[0];
    if (draw.kind !== 'Draw') return;
    expect(draw.count).toBe(1);
    expect(draw.player.kind).toBe('Controller');

    expect(result.targets).toHaveLength(0);
  });

  it('parses "Whenever ~ dies, gain 3 life."', () => {
    const result = parseOracleText('Whenever ~ dies, gain 3 life.');

    expect(result.kind).toBe('Dies');
    if (result.kind !== 'Dies') return;

    expect(result.ability.kind).toBe('TriggeredAbility');
    expect(result.ability.trigger.kind).toBe('Dies');
    expect(result.ability.trigger.who).toBe('self');

    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('GainLife');
    const gain = result.ability.effects[0];
    if (gain.kind !== 'GainLife') return;
    expect(gain.amount).toBe(3);
    expect(gain.player.kind).toBe('Controller');

    expect(result.targets).toHaveLength(0);
  });

  it('parses "When ~ dies, destroy target creature."', () => {
    const result = parseOracleText('When ~ dies, destroy target creature.');

    expect(result.kind).toBe('Dies');
    if (result.kind !== 'Dies') return;

    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('Destroy');

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Creature');
  });

  it('returns Unparsed for unparseable dies clause', () => {
    const result = parseOracleText('When ~ dies, do something weird.');

    expect(result.kind).toBe('Unparsed');
    if (result.kind !== 'Unparsed') return;
    expect(result.reason).toBe('Could not parse dies effect clause');
  });
});

// ============================================================================
// SBA integration tests
// ============================================================================

function makeDiesDrawCreature(id: string = 'dies-draw-1'): CardDefinition {
  return {
    id,
    name: 'Elvish Visionary (dies)',
    type_line: 'Creature — Elf Shaman',
    oracle_text: 'When ~ dies, draw a card.',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 1,
    toughness: 1,
  };
}

function makeVanillaCreature(id: string = 'vanilla-1'): CardDefinition {
  return {
    id,
    name: 'Grizzly Bears',
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
}

describe('Dies triggers in SBAs', () => {
  it('creature with dies ability takes lethal damage -> creature in graveyard AND pending trigger created', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeDiesDrawCreature()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];

    // Move creature to battlefield
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });

    // Register dies ability (simulating what registerETBAbilities does when the creature enters)
    const diesAbility: TriggeredAbilityRef = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'Dies', who: 'self' },
      effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: 1 }],
    };
    const newAbilities = new Map(state.battlefieldAbilities);
    newAbilities.set(card.instanceId, [diesAbility]);
    state = { ...state, battlefieldAbilities: newAbilities };

    // Deal lethal damage (toughness is 1, so 1 damage is lethal)
    state.cards.set(card.instanceId, { ...state.cards.get(card.instanceId)!, damage: 1 });

    // Run SBAs
    const next = checkStateBasedActions(state);

    // Creature should be in graveyard
    expect(next.cards.get(card.instanceId)!.zone).toBe('graveyard');

    // Should have a pending trigger
    expect(next.pendingTriggers).toHaveLength(1);
    expect(next.pendingTriggers[0].sourceInstanceId).toBe(card.instanceId);
    expect(next.pendingTriggers[0].controllerId).toBe('p1');
    expect(next.pendingTriggers[0].ability.trigger.kind).toBe('Dies');
  });

  it('normal creature dies -> no pending triggers', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeVanillaCreature()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];

    // Move creature to battlefield and deal lethal damage
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 2 });

    // Run SBAs
    const next = checkStateBasedActions(state);

    // Creature should be in graveyard
    expect(next.cards.get(card.instanceId)!.zone).toBe('graveyard');

    // No pending triggers
    expect(next.pendingTriggers).toHaveLength(0);
  });

  it('creature with 0 toughness dies and creates pending trigger', () => {
    const def: CardDefinition = {
      id: 'zero-t',
      name: 'Zero Toughness Dies',
      type_line: 'Creature — Spirit',
      oracle_text: 'When ~ dies, gain 3 life.',
      mana_cost: '{1}{W}',
      cmc: 2,
      colors: ['W'],
      color_identity: ['W'],
      keywords: [],
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    };

    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [def], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];

    // Put on battlefield with -1/-1 counter (makes toughness 0)
    state.cards.set(card.instanceId, {
      ...card,
      zone: 'battlefield',
      counters: { '-1/-1': 1 },
    });

    // Register dies ability
    const diesAbility: TriggeredAbilityRef = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'Dies', who: 'self' },
      effects: [{ kind: 'GainLife', player: { kind: 'Controller' }, amount: 3 }],
    };
    state.battlefieldAbilities.set(card.instanceId, [diesAbility]);

    const next = checkStateBasedActions(state);

    // Creature dies from 0 toughness
    expect(next.cards.get(card.instanceId)!.zone).toBe('graveyard');

    // Pending trigger created
    expect(next.pendingTriggers).toHaveLength(1);
    expect(next.pendingTriggers[0].ability.trigger.kind).toBe('Dies');
  });

  it('battlefieldAbilities are cleaned up after creature dies', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeDiesDrawCreature()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];

    // Move creature to battlefield
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 1 });

    // Register dies ability
    const diesAbility: TriggeredAbilityRef = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'Dies', who: 'self' },
      effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: 1 }],
    };
    state.battlefieldAbilities.set(card.instanceId, [diesAbility]);

    const next = checkStateBasedActions(state);

    // battlefieldAbilities should no longer have the dead creature
    expect(next.battlefieldAbilities.has(card.instanceId)).toBe(false);
  });
});
