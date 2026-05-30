import { beforeEach, describe, it, expect } from 'vitest';
import { checkStateBasedActions, cleanupDamage } from './state-based';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition } from './types';
import { makeTestState } from './__tests__/test-helpers';
import { clearReplacements, createExileInsteadOfDieEffect, registerReplacement } from './effects/replacement';

function makeBear(id: string = 'bear-1'): CardDefinition {
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

describe('State-Based Actions', () => {
  beforeEach(() => {
    clearReplacements();
  });

  it('creature with damage >= toughness moves to graveyard', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 2 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(card.instanceId)!.zone).toBe('graveyard');
  });

  it('applies dies-to-exile replacement to lethal damage state-based death', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 2 });
    registerReplacement(createExileInsteadOfDieEffect('rest-in-peace', 'p2'));

    const next = checkStateBasedActions(state);
    expect(next.cards.get(card.instanceId)!.zone).toBe('exile');
    expect(next.cards.get(card.instanceId)!.damage).toBe(0);
  });

  it('creature with damage > toughness also dies', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 5 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(card.instanceId)!.zone).toBe('graveyard');
  });

  it('creature with damage < toughness survives', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 1 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(card.instanceId)!.zone).toBe('battlefield');
  });

  it('dead creatures have damage reset when moved to graveyard', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 3 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(card.instanceId)!.damage).toBe(0);
  });

  it('player with life <= 0 is marked as lost', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    state.players[0].life = 0;

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('player with negative life is marked as lost', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    state.players[0].life = -5;

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('handles multiple creatures dying at once', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear('b1'), makeBear('b2')], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const cards = getCardsInZone(state, 'p1', 'library');
    state.cards.set(cards[0].instanceId, { ...cards[0], zone: 'battlefield', damage: 2 });
    state.cards.set(cards[1].instanceId, { ...cards[1], zone: 'battlefield', damage: 3 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(cards[0].instanceId)!.zone).toBe('graveyard');
    expect(next.cards.get(cards[1].instanceId)!.zone).toBe('graveyard');
  });

  it('moves illegal creature Auras to graveyard and detaches illegal Equipment', () => {
    const aura: CardDefinition = {
      id: 'creature_aura',
      name: 'Creature Aura',
      type_line: 'Enchantment - Aura',
      oracle_text: 'Enchant creature',
      mana_cost: '{W}',
      cmc: 1,
      colors: ['W'],
      color_identity: ['W'],
      keywords: [],
      card_types: ['enchantment'],
    };
    const equipment: CardDefinition = {
      id: 'test_equipment',
      name: 'Training Sword',
      type_line: 'Artifact - Equipment',
      oracle_text: 'Equipped creature gets +1/+0.',
      mana_cost: '{1}',
      cmc: 1,
      colors: [],
      color_identity: [],
      keywords: [],
      card_types: ['artifact'],
    };
    const land: CardDefinition = {
      id: 'forest',
      name: 'Forest',
      type_line: 'Basic Land - Forest',
      oracle_text: '',
      mana_cost: '',
      cmc: 0,
      colors: [],
      color_identity: ['G'],
      keywords: [],
      card_types: ['land'],
    };
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [aura, equipment, land], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    const auraCard = getCardsInZone(state, 'p1', 'library').find(card => card.definitionId === aura.id)!;
    const equipmentCard = getCardsInZone(state, 'p1', 'library').find(card => card.definitionId === equipment.id)!;
    const landCard = getCardsInZone(state, 'p1', 'library').find(card => card.definitionId === land.id)!;
    state.cards.set(landCard.instanceId, { ...landCard, zone: 'battlefield' });
    state.cards.set(auraCard.instanceId, { ...auraCard, zone: 'battlefield', attachedTo: landCard.instanceId });
    state.cards.set(equipmentCard.instanceId, { ...equipmentCard, zone: 'battlefield', attachedTo: landCard.instanceId });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(auraCard.instanceId)?.zone).toBe('graveyard');
    expect(next.cards.get(auraCard.instanceId)?.attachedTo).toBeUndefined();
    expect(next.cards.get(equipmentCard.instanceId)?.zone).toBe('battlefield');
    expect(next.cards.get(equipmentCard.instanceId)?.attachedTo).toBeUndefined();
  });

  it('moves Auras to graveyard when protection makes the attachment illegal', () => {
    const protectedBear: CardDefinition = {
      ...makeBear('protected-bear'),
      oracle_text: 'Protection from white',
      keywords: ['Protection from white'],
    };
    const whiteAura: CardDefinition = {
      id: 'white_aura',
      name: 'White Aura',
      type_line: 'Enchantment - Aura',
      oracle_text: 'Enchant creature',
      mana_cost: '{W}',
      cmc: 1,
      colors: ['W'],
      color_identity: ['W'],
      keywords: [],
      card_types: ['enchantment'],
    };
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [protectedBear, whiteAura], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    const bearCard = getCardsInZone(state, 'p1', 'library').find(card => card.definitionId === protectedBear.id)!;
    const auraCard = getCardsInZone(state, 'p1', 'library').find(card => card.definitionId === whiteAura.id)!;
    state.cards.set(bearCard.instanceId, { ...bearCard, zone: 'battlefield' });
    state.cards.set(auraCard.instanceId, { ...auraCard, zone: 'battlefield', attachedTo: bearCard.instanceId });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(auraCard.instanceId)?.zone).toBe('graveyard');
    expect(next.cards.get(auraCard.instanceId)?.attachedTo).toBeUndefined();
  });
});

describe('Commander Damage Loss', () => {
  it('player with 21 commander damage from one commander loses', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    state.players[0].commanderDamage = { 'inst_cmd': 21 };

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('player with more than 21 commander damage loses', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    state.players[0].commanderDamage = { 'inst_cmd': 25 };

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('player with less than 21 commander damage survives', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    state.players[0].commanderDamage = { 'inst_cmd': 20 };

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(false);
  });

  it('commander damage from different commanders does not stack for loss', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      { playerId: 'p3', name: 'Carol', cards: [], commanderId: 'cmd3' },
    ];
    const state = initGameState(decks);
    // 15 from one commander, 10 from another = 25 total, but neither is >= 21
    state.players[0].commanderDamage = {
      'inst_cmd_2': 15,
      'inst_cmd_3': 10,
    };

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(false);
  });

  it('player loses if any single commander dealt 21+ damage', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      { playerId: 'p3', name: 'Carol', cards: [], commanderId: 'cmd3' },
    ];
    const state = initGameState(decks);
    // One commander dealt 21, another dealt less
    state.players[0].commanderDamage = {
      'inst_cmd_2': 21,
      'inst_cmd_3': 5,
    };

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('already lost player is not checked for commander damage', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    state.players[0].hasLost = true;
    state.players[0].commanderDamage = { 'inst_cmd': 21 };

    // Should not throw or change anything
    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });
});

describe('cleanupDamage', () => {
  it('removes all damage from creatures on battlefield', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 1 });

    const next = cleanupDamage(state);
    expect(next.cards.get(card.instanceId)!.damage).toBe(0);
  });

  it('does not affect cards in other zones', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'graveyard', damage: 3 });

    const next = cleanupDamage(state);
    expect(next.cards.get(card.instanceId)!.damage).toBe(3);
  });
});

describe('Poison Counter Loss', () => {
  it('player with 10+ poison counters loses', () => {
    const state = makeTestState({});
    state.players[0] = { ...state.players[0], poisonCounters: 10 };
    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('player with 9 poison counters does not lose', () => {
    const state = makeTestState({});
    state.players[0] = { ...state.players[0], poisonCounters: 9 };
    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(false);
  });
});

describe('Planeswalker Loyalty SBA', () => {
  it('planeswalker with 0 loyalty goes to graveyard', () => {
    const state = makeTestState({ battlefieldPlaneswalker: { loyalty: 0 } });
    const next = checkStateBasedActions(state);
    const pw = [...next.cards.values()].find(c => c.instanceId === 'pw_0');
    expect(pw?.zone).toBe('graveyard');
  });

  it('planeswalker with positive loyalty stays on battlefield', () => {
    const state = makeTestState({ battlefieldPlaneswalker: { loyalty: 3 } });
    const next = checkStateBasedActions(state);
    const pw = [...next.cards.values()].find(c => c.instanceId === 'pw_0');
    expect(pw?.zone).toBe('battlefield');
  });
});

describe('Token cease-to-exist SBA (MTG rule 704.5d)', () => {
  it('token in graveyard ceases to exist', () => {
    const state = makeTestState({});
    // Inject a token instance directly into the cards map in the graveyard
    const tokenDef: CardDefinition = {
      id: 'token-insect',
      name: 'Insect',
      type_line: 'Token Creature — Insect',
      oracle_text: '',
      mana_cost: '',
      cmc: 0,
      colors: ['G'],
      color_identity: ['G'],
      keywords: [],
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    };
    state.cardDefinitions.set(tokenDef.id, tokenDef);
    state.cards.set('tok1', {
      instanceId: 'tok1',
      definitionId: tokenDef.id,
      ownerId: 'human',
      zone: 'graveyard',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
      isToken: true,
    });

    const next = checkStateBasedActions(state);
    expect(next.cards.get('tok1'), 'token in graveyard should be removed from the cards map').toBeUndefined();
  });

  it('token on battlefield stays', () => {
    const state = makeTestState({});
    const tokenDef: CardDefinition = {
      id: 'token-elemental',
      name: 'Elemental',
      type_line: 'Token Creature — Elemental',
      oracle_text: '',
      mana_cost: '',
      cmc: 0,
      colors: ['R', 'G'],
      color_identity: ['R', 'G'],
      keywords: [],
      card_types: ['creature'],
      power: 5,
      toughness: 5,
    };
    state.cardDefinitions.set(tokenDef.id, tokenDef);
    state.cards.set('tok2', {
      instanceId: 'tok2',
      definitionId: tokenDef.id,
      ownerId: 'human',
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
      isToken: true,
    });

    const next = checkStateBasedActions(state);
    expect(next.cards.get('tok2')?.zone).toBe('battlefield');
  });
});
