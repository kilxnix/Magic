import { describe, it, expect } from 'vitest';
import { playLand, canPlayLand, canPlayLandDetailed, tapLandForMana, drawCards } from './actions';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition } from './types';
import { populateParsedCache } from './cards/card-parser-cache';
import { getLegalActions } from './ai/legal-actions';

function makeForest(): CardDefinition {
  return {
    id: 'forest-1',
    name: 'Forest',
    type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeSnowCoveredForest(): CardDefinition {
  return {
    id: 'snow-forest-1',
    name: 'Snow-Covered Forest',
    type_line: 'Basic Snow Land â€” Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeIsland(): CardDefinition {
  return {
    id: 'island-1',
    name: 'Island',
    type_line: 'Basic Land — Island',
    oracle_text: '{T}: Add {U}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['U'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeStompingGround(): CardDefinition {
  return {
    id: 'stomping-ground-1',
    name: 'Stomping Ground',
    type_line: 'Land — Mountain Forest',
    oracle_text: 'As Stomping Ground enters, you may pay 2 life. If you don\'t, it enters tapped.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['R', 'G'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeRejuvenatingSprings(): CardDefinition {
  return {
    id: 'rejuvenating-springs-1',
    name: 'Rejuvenating Springs',
    type_line: 'Land',
    oracle_text: 'Rejuvenating Springs enters the battlefield tapped unless you have two or more opponents.\n{T}: Add {G} or {U}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G', 'U'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeCreature(): CardDefinition {
  return {
    id: 'bear-1',
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

describe('Land Actions', () => {
  describe('canPlayLand', () => {
    it('returns true during main phase with land in hand', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'precombat_main', step: 'begin_combat' };

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(true);
    });

    it('returns false if not active player', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      state = { ...state, activePlayerIndex: 1, phase: 'precombat_main' };
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
    });

    it('returns false if already played a land this turn', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      state.players[0].hasPlayedLand = true;
      state = { ...state, phase: 'precombat_main' };
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
    });

    it('returns false if not a main phase', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'combat' };

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
    });

    it('returns false with exact reason when the player lacks priority', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'precombat_main', priorityPlayerIndex: 1 };

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
      expect(canPlayLandDetailed(state, 'p1', card.instanceId)).toEqual({
        legal: false,
        code: 'priority_not_yours',
        reason: 'You do not have priority',
      });
    });

    it('returns false with exact reason while the stack is nonempty', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest(), makeCreature()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')
        .find(candidate => candidate.definitionId === 'forest-1')!;
      const spell = getCardsInZone(state, 'p1', 'library')
        .find(candidate => candidate.definitionId === 'bear-1')!;
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state.cards.set(spell.instanceId, { ...spell, zone: 'stack' });
      state = {
        ...state,
        phase: 'precombat_main',
        priorityPlayerIndex: 0,
        stack: [{
          kind: 'Spell',
          id: 'stack-spell',
          cardInstanceId: spell.instanceId,
          casterId: 'p1',
          targets: [],
        }],
      };

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
      expect(canPlayLandDetailed(state, 'p1', card.instanceId)).toEqual({
        legal: false,
        code: 'stack_not_empty',
        reason: 'The stack must be empty',
      });
      expect(getLegalActions(state, 'p1').some(action => action.kind === 'PlayLand')).toBe(false);
    });

    it('returns false if card is not a land', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeCreature()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' };

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
    });
  });

  describe('playLand', () => {
    it('moves land from hand to battlefield and marks land played', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' };

      const next = playLand(state, 'p1', card.instanceId);
      const played = next.cards.get(card.instanceId)!;
      expect(played.zone).toBe('battlefield');
      expect(next.players[0].hasPlayedLand).toBe(true);
    });

    it('supports generic shock-land pay-life entry choices', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeStompingGround()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' };

      const tappedDefault = playLand(state, 'p1', card.instanceId);
      expect(tappedDefault.cards.get(card.instanceId)?.tapped).toBe(true);
      expect(tappedDefault.players[0].life).toBe(40);

      state = initGameState(decks);
      const secondCard = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(secondCard.instanceId, { ...secondCard, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' };

      const paid = playLand(state, 'p1', secondCard.instanceId, { payLifeToEnterUntapped: true });
      expect(paid.cards.get(secondCard.instanceId)?.tapped).toBe(false);
      expect(paid.players[0].life).toBe(38);
    });

    it('evaluates two-or-more-opponents lands from the actual table size', () => {
      let state = initGameState([{
        playerId: 'p1', name: 'Alice',
        cards: [makeRejuvenatingSprings()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }]);
      const duelCard = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(duelCard.instanceId, { ...duelCard, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' };

      const duelEntry = playLand(state, 'p1', duelCard.instanceId);
      expect(duelEntry.cards.get(duelCard.instanceId)?.tapped).toBe(true);

      state = initGameState([{
        playerId: 'p1', name: 'Alice',
        cards: [makeRejuvenatingSprings()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }, {
        playerId: 'p3', name: 'Cara',
        cards: [], commanderId: 'cmd3',
      }, {
        playerId: 'p4', name: 'Drew',
        cards: [], commanderId: 'cmd4',
      }]);
      const podCard = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(podCard.instanceId, { ...podCard, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' };

      const podEntry = playLand(state, 'p1', podCard.instanceId);
      expect(podEntry.cards.get(podCard.instanceId)?.tapped).toBe(false);
    });
  });

  describe('tapLandForMana', () => {
    it('taps a land and adds mana to pool', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });

      const next = tapLandForMana(state, 'p1', card.instanceId, 'G');
      expect(next.cards.get(card.instanceId)!.tapped).toBe(true);
      expect(next.players[0].manaPool.G).toBe(1);
    });

    it('marks mana from snow permanents so it can pay snow costs', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeSnowCoveredForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });

      const next = tapLandForMana(state, 'p1', card.instanceId, 'G');
      expect(next.players[0].manaPool.G).toBe(1);
      expect(next.players[0].snowManaPool?.G).toBe(1);
    });

    it('throws if land is already tapped', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', tapped: true });

      expect(() => tapLandForMana(state, 'p1', card.instanceId, 'G')).toThrow();
    });

    it('throws if a creature tap-mana source is summoning sick', () => {
      const sageDef = populateParsedCache({
        id: 'somberwald-sage',
        name: 'Somberwald Sage',
        type_line: 'Creature - Human Druid',
        oracle_text: '{T}: Add three mana of any one color. Spend this mana only to cast creature spells.',
        mana_cost: '{2}{G}',
        cmc: 3,
        colors: ['G'],
        color_identity: ['G'],
        keywords: [],
        card_types: ['creature'],
        power: 0,
        toughness: 1,
      });
      let state = initGameState([
        { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ]);
      state.cardDefinitions.set(sageDef.id, sageDef);
      state.cards.set('sage-1', {
        instanceId: 'sage-1',
        definitionId: sageDef.id,
        ownerId: 'p1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: true,
        counters: {},
        damage: 0,
        isCommander: false,
      });

      expect(() => tapLandForMana(state, 'p1', 'sage-1', 'G')).toThrow('Summoning sick');
      expect(getLegalActions(state, 'p1').some(action =>
        action.kind === 'ActivateManaAbility' && action.cardInstanceId === 'sage-1'
      )).toBe(false);
    });

    it('adds all fixed bundled mana from a creature mana ability', () => {
      const elderDef = populateParsedCache({
        id: 'nantuko-elder',
        name: 'Nantuko Elder',
        type_line: 'Creature - Insect Druid',
        oracle_text: '{T}: Add {C}{G}.',
        mana_cost: '{2}{G}',
        cmc: 3,
        colors: ['G'],
        color_identity: ['G'],
        keywords: [],
        card_types: ['creature'],
        power: 1,
        toughness: 2,
      });
      let state = initGameState([
        { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ]);
      state.cardDefinitions.set(elderDef.id, elderDef);
      state.cards.set('elder-1', {
        instanceId: 'elder-1',
        definitionId: elderDef.id,
        ownerId: 'p1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });

      const next = tapLandForMana(state, 'p1', 'elder-1', 'C');

      expect(next.players[0].manaPool.C).toBe(1);
      expect(next.players[0].manaPool.G).toBe(1);
      expect(next.cards.get('elder-1')?.tapped).toBe(true);
    });

    it("adds G for each creature from Gaea's Cradle", () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeCreature(), makeCreature()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const cradleDef = populateParsedCache({
        id: 'gaeas-cradle',
        name: "Gaea's Cradle",
        type_line: 'Legendary Land',
        oracle_text: '{T}: Add {G} for each creature you control.',
        mana_cost: '',
        cmc: 0,
        colors: [],
        color_identity: ['G'],
        keywords: [],
        card_types: ['land'],
      });
      state.cardDefinitions.set(cradleDef.id, cradleDef);
      state.cards.set('cradle-1', {
        instanceId: 'cradle-1',
        definitionId: cradleDef.id,
        ownerId: 'p1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      const creatures = getCardsInZone(state, 'p1', 'library');
      for (const creature of creatures) {
        state.cards.set(creature.instanceId, { ...creature, zone: 'battlefield', summoningSick: false });
      }

      const next = tapLandForMana(state, 'p1', 'cradle-1', 'G');

      expect(next.players[0].manaPool.G).toBe(2);
      expect(next.cards.get('cradle-1')?.tapped).toBe(true);
    });

    it('exiles Elvish Spirit Guide from hand to add green mana', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const spiritGuideDef = populateParsedCache({
        id: 'elvish-spirit-guide',
        name: 'Elvish Spirit Guide',
        type_line: 'Creature — Elf Spirit',
        oracle_text: 'Exile Elvish Spirit Guide from your hand: Add {G}.',
        mana_cost: '{2}{G}',
        cmc: 3,
        colors: ['G'],
        color_identity: ['G'],
        keywords: [],
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      });
      state.cardDefinitions.set(spiritGuideDef.id, spiritGuideDef);
      state.cards.set('esg-1', {
        instanceId: 'esg-1',
        definitionId: spiritGuideDef.id,
        ownerId: 'p1',
        zone: 'hand',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });

      const next = tapLandForMana(state, 'p1', 'esg-1', 'G');

      expect(next.players[0].manaPool.G).toBe(1);
      expect(next.cards.get('esg-1')?.zone).toBe('exile');
    });

    it('does not let Skirk Prospector sacrifice itself for its filtered mana cost', () => {
      const skirkDef: CardDefinition = {
        id: 'skirk-prospector',
        name: 'Skirk Prospector',
        type_line: 'Creature - Goblin',
        oracle_text: 'Sacrifice a Goblin: Add {R}.',
        mana_cost: '{R}',
        cmc: 1,
        colors: ['R'],
        color_identity: ['R'],
        keywords: [],
        card_types: ['creature'],
        power: 1,
        toughness: 1,
        manaProduction: {
          colors: ['R'],
          amounts: { R: 1 },
          isTapAbility: false,
          requiresSacrifice: false,
          sacrificeFilter: { subtypes: ['Goblin'] },
        },
      };
      let state = initGameState([
        { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ]);
      state.cardDefinitions.set(skirkDef.id, skirkDef);
      state.cards.set('skirk-1', {
        instanceId: 'skirk-1',
        definitionId: skirkDef.id,
        ownerId: 'p1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });

      expect(() => tapLandForMana(state, 'p1', 'skirk-1', 'R')).toThrow('No sacrifice candidate');
      expect(getLegalActions(state, 'p1').some(action =>
        action.kind === 'ActivateManaAbility' && action.cardInstanceId === 'skirk-1'
      )).toBe(false);
      expect(state.cards.get('skirk-1')?.zone).toBe('battlefield');
    });

    it('uses another Goblin for Skirk Prospector and leaves the Prospector alive', () => {
      const skirkDef: CardDefinition = {
        id: 'skirk-prospector',
        name: 'Skirk Prospector',
        type_line: 'Creature - Goblin',
        oracle_text: 'Sacrifice a Goblin: Add {R}.',
        mana_cost: '{R}',
        cmc: 1,
        colors: ['R'],
        color_identity: ['R'],
        keywords: [],
        card_types: ['creature'],
        power: 1,
        toughness: 1,
        manaProduction: {
          colors: ['R'],
          amounts: { R: 1 },
          isTapAbility: false,
          requiresSacrifice: false,
          sacrificeFilter: { subtypes: ['Goblin'] },
        },
      };
      const goblinDef: CardDefinition = {
        id: 'goblin-token',
        name: 'Goblin Token',
        type_line: 'Token Creature - Goblin',
        oracle_text: '',
        mana_cost: '',
        cmc: 0,
        colors: ['R'],
        color_identity: ['R'],
        keywords: [],
        card_types: ['creature'],
        power: 1,
        toughness: 1,
      };
      let state = initGameState([
        { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ]);
      state.cardDefinitions.set(skirkDef.id, skirkDef);
      state.cardDefinitions.set(goblinDef.id, goblinDef);
      state.cards.set('skirk-1', {
        instanceId: 'skirk-1',
        definitionId: skirkDef.id,
        ownerId: 'p1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      state.cards.set('goblin-1', {
        instanceId: 'goblin-1',
        definitionId: goblinDef.id,
        ownerId: 'p1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });

      const next = tapLandForMana(state, 'p1', 'skirk-1', 'R');

      expect(next.players[0].manaPool.R).toBe(1);
      expect(next.cards.get('skirk-1')?.zone).toBe('battlefield');
      expect(next.cards.get('goblin-1')?.zone).toBe('graveyard');
    });

    it('uses expendable Goblin tokens before valuable Goblins for sacrifice mana', () => {
      const skirkDef: CardDefinition = {
        id: 'skirk-prospector',
        name: 'Skirk Prospector',
        type_line: 'Creature - Goblin',
        oracle_text: 'Sacrifice a Goblin: Add {R}.',
        mana_cost: '{R}',
        cmc: 1,
        colors: ['R'],
        color_identity: ['R'],
        keywords: [],
        card_types: ['creature'],
        power: 1,
        toughness: 1,
        manaProduction: {
          colors: ['R'],
          amounts: { R: 1 },
          isTapAbility: false,
          requiresSacrifice: false,
          sacrificeFilter: { subtypes: ['Goblin'] },
        },
      };
      const krenkoDef: CardDefinition = {
        id: 'krenko',
        name: 'Krenko, Mob Boss',
        type_line: 'Legendary Creature - Goblin Warrior',
        oracle_text: '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
        mana_cost: '{2}{R}{R}',
        cmc: 4,
        colors: ['R'],
        color_identity: ['R'],
        keywords: [],
        card_types: ['creature'],
        power: 3,
        toughness: 3,
      };
      const goblinTokenDef: CardDefinition = {
        id: 'goblin-token',
        name: 'Goblin Token',
        type_line: 'Token Creature - Goblin',
        oracle_text: '',
        mana_cost: '',
        cmc: 0,
        colors: ['R'],
        color_identity: ['R'],
        keywords: [],
        card_types: ['creature'],
        power: 1,
        toughness: 1,
      };
      let state = initGameState([
        { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ]);
      state.cardDefinitions.set(skirkDef.id, skirkDef);
      state.cardDefinitions.set(krenkoDef.id, krenkoDef);
      state.cardDefinitions.set(goblinTokenDef.id, goblinTokenDef);
      state.cards.set('skirk-1', {
        instanceId: 'skirk-1',
        definitionId: skirkDef.id,
        ownerId: 'p1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      state.cards.set('krenko-1', {
        instanceId: 'krenko-1',
        definitionId: krenkoDef.id,
        ownerId: 'p1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      });
      state.cards.set('token-1', {
        instanceId: 'token-1',
        definitionId: goblinTokenDef.id,
        ownerId: 'p1',
        zone: 'battlefield',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
        isToken: true,
      });

      const next = tapLandForMana(state, 'p1', 'skirk-1', 'R');

      expect(next.players[0].manaPool.R).toBe(1);
      expect(next.cards.get('skirk-1')?.zone).toBe('battlefield');
      expect(next.cards.get('krenko-1')?.zone).toBe('battlefield');
      expect(next.cards.get('token-1')?.zone).toBe('graveyard');
    });
  });

  describe('drawCards', () => {
    it('moves top card from library to hand', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      const state = initGameState(decks);

      const next = drawCards(state, 'p1', 1);
      const hand = getCardsInZone(next, 'p1', 'hand');
      const library = getCardsInZone(next, 'p1', 'library');
      expect(hand).toHaveLength(1);
      expect(library).toHaveLength(0);
    });

    it('draws multiple cards', () => {
      const cards = [makeForest(), makeIsland()];
      const decks = [{
        playerId: 'p1', name: 'Alice', cards, commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      const state = initGameState(decks);

      const next = drawCards(state, 'p1', 2);
      const hand = getCardsInZone(next, 'p1', 'hand');
      expect(hand).toHaveLength(2);
    });

    it('draws fewer if library is empty', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      const state = initGameState(decks);

      const next = drawCards(state, 'p1', 5);
      const hand = getCardsInZone(next, 'p1', 'hand');
      expect(hand).toHaveLength(1);
    });
  });
});
