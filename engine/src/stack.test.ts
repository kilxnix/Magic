import { describe, it, expect } from 'vitest';
import { canCastSpell, castSpell, resolveTopOfStack } from './stack';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition, StackItem } from './types';

function makeCreature(): CardDefinition {
  return {
    id: 'bear-1', name: 'Grizzly Bears', type_line: 'Creature — Bear',
    oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
    colors: ['G'], color_identity: ['G'], keywords: [],
    card_types: ['creature'], power: 2, toughness: 2,
  };
}

function makeInstant(): CardDefinition {
  return {
    id: 'opt-1', name: 'Opt', type_line: 'Instant',
    oracle_text: 'Scry 1, then draw a card.',  // unparseable, so no targets required
    mana_cost: '{R}', cmc: 1,
    colors: ['R'], color_identity: ['R'], keywords: [],
    card_types: ['instant'],
  };
}

function makeSorcery(): CardDefinition {
  return {
    id: 'divination-1', name: 'Divination', type_line: 'Sorcery',
    oracle_text: 'Draw two cards.', mana_cost: '{2}{U}', cmc: 3,
    colors: ['U'], color_identity: ['U'], keywords: [],
    card_types: ['sorcery'],
  };
}

function makeArtifact(): CardDefinition {
  return {
    id: 'sol-ring-1', name: 'Sol Ring', type_line: 'Artifact',
    oracle_text: '{T}: Add {C}{C}.', mana_cost: '{1}', cmc: 1,
    colors: [], color_identity: [], keywords: [],
    card_types: ['artifact'],
  };
}

function makeEnchantment(): CardDefinition {
  return {
    id: 'omen-1', name: 'Omen of the Sea', type_line: 'Enchantment',
    oracle_text: 'When Omen of the Sea enters the battlefield, scry 2, then draw a card.',
    mana_cost: '{1}{U}', cmc: 2,
    colors: ['U'], color_identity: ['U'], keywords: ['Flash'],
    card_types: ['enchantment'],
  };
}

function setupWithCardInHand(cardDef: CardDefinition, phase: string = 'precombat_main') {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: [cardDef], commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);
  const card = getCardsInZone(state, 'p1', 'library')[0];
  state.cards.set(card.instanceId, { ...card, zone: 'hand' });
  state = { ...state, phase: phase as any };
  state.players[0].manaPool = { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 };
  return { state, cardInstanceId: card.instanceId };
}

describe('Stack', () => {
  describe('canCastSpell', () => {
    it('allows creatures during main phase with empty stack', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
      expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(true);
    });

    it('allows instants during any phase', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeInstant(), 'combat');
      expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(true);
    });

    it('rejects sorceries during combat', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeSorcery(), 'combat');
      expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(false);
    });

    it('rejects creatures during combat', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeCreature(), 'combat');
      expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(false);
    });

    it('rejects if player cannot pay mana cost', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
      expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(false);
    });

    it('rejects if not the casters card', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
      expect(canCastSpell(state, 'p2', cardInstanceId)).toBe(false);
    });

    it('rejects if card not in hand', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
      const card = state.cards.get(cardInstanceId)!;
      state.cards.set(cardInstanceId, { ...card, zone: 'battlefield' });
      expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(false);
    });

    it('rejects sorceries when stack is not empty', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeSorcery());
      state.stack.push({ id: 'stack_1', cardInstanceId: 'other', casterId: 'p2', targets: [] });
      expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(false);
    });

    it('allows instants when stack is not empty (responding)', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeInstant());
      state.stack.push({ id: 'stack_1', cardInstanceId: 'other', casterId: 'p2', targets: [] });
      expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(true);
    });

    it('rejects lands (lands are not cast)', () => {
      const land: CardDefinition = {
        id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest',
        oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0,
        colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
      };
      const { state, cardInstanceId } = setupWithCardInHand(land);
      expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(false);
    });

    it('allows flash creatures during combat', () => {
      const flashCreature: CardDefinition = {
        id: 'ambusher-1', name: 'Bounding Krasis', type_line: 'Creature — Fish Lizard',
        oracle_text: 'Flash',
        mana_cost: '{1}{G}{U}', cmc: 3,
        colors: ['G', 'U'], color_identity: ['G', 'U'], keywords: ['Flash'],
        card_types: ['creature'], power: 3, toughness: 3,
      };
      const { state, cardInstanceId } = setupWithCardInHand(flashCreature, 'combat');
      expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(true);
    });

    it('allows flash creatures when stack is not empty', () => {
      const flashCreature: CardDefinition = {
        id: 'ambusher-1', name: 'Bounding Krasis', type_line: 'Creature — Fish Lizard',
        oracle_text: 'Flash',
        mana_cost: '{1}{G}{U}', cmc: 3,
        colors: ['G', 'U'], color_identity: ['G', 'U'], keywords: ['Flash'],
        card_types: ['creature'], power: 3, toughness: 3,
      };
      const { state, cardInstanceId } = setupWithCardInHand(flashCreature);
      state.stack.push({ id: 'stack_1', cardInstanceId: 'other', casterId: 'p2', targets: [] });
      expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(true);
    });

    it('allows non-active player to cast instants', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [makeInstant()], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p2', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state.players[1].manaPool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
      state = { ...state, phase: 'precombat_main' as any, priorityPlayerIndex: 1 };

      expect(canCastSpell(state, 'p2', card.instanceId)).toBe(true);
    });

    it('rejects non-active player casting sorceries', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [makeSorcery()], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p2', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state.players[1].manaPool = { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 };
      state = { ...state, phase: 'precombat_main' as any, priorityPlayerIndex: 1 };

      expect(canCastSpell(state, 'p2', card.instanceId)).toBe(false);
    });
  });

  describe('castSpell', () => {
    it('pays mana cost and moves card to stack zone', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 };
      const next = castSpell(state, 'p1', cardInstanceId);

      expect(next.cards.get(cardInstanceId)!.zone).toBe('stack');
      expect(next.players[0].manaPool.G).toBe(0);
      expect(next.stack).toHaveLength(1);
      expect(next.stack[0].cardInstanceId).toBe(cardInstanceId);
      expect(next.stack[0].casterId).toBe('p1');
    });

    it('resets priority passed after casting', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
      state.hasPriorityPassed[0] = true;
      state.hasPriorityPassed[1] = true;
      const next = castSpell(state, 'p1', cardInstanceId);
      expect(next.hasPriorityPassed.every(p => p === false)).toBe(true);
    });

    it('throws if cannot cast', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
      expect(() => castSpell(state, 'p1', cardInstanceId)).toThrow();
    });

    it('supports casting with targets', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeInstant());
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
      const next = castSpell(state, 'p1', cardInstanceId, ['target_1']);
      expect(next.stack[0].targets).toEqual(['target_1']);
    });

    it('multiple spells stack in LIFO order', () => {
      const bolt1: CardDefinition = { ...makeInstant(), id: 'bolt-1' };
      const bolt2: CardDefinition = { ...makeInstant(), id: 'bolt-2' };
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [bolt1, bolt2], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const cards = getCardsInZone(state, 'p1', 'library');
      state.cards.set(cards[0].instanceId, { ...cards[0], zone: 'hand' });
      state.cards.set(cards[1].instanceId, { ...cards[1], zone: 'hand' });
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 };
      state = { ...state, phase: 'precombat_main' as any };

      state = castSpell(state, 'p1', cards[0].instanceId);
      state = castSpell(state, 'p1', cards[1].instanceId);

      expect(state.stack).toHaveLength(2);
      expect(state.stack[1].cardInstanceId).toBe(cards[1].instanceId);
      expect(state.stack[0].cardInstanceId).toBe(cards[0].instanceId);
    });
  });

  describe('resolveTopOfStack', () => {
    it('creature resolves to battlefield with summoning sickness', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 };
      let next = castSpell(state, 'p1', cardInstanceId);
      next = resolveTopOfStack(next);

      expect(next.cards.get(cardInstanceId)!.zone).toBe('battlefield');
      expect(next.cards.get(cardInstanceId)!.summoningSick).toBe(true);
      expect(next.stack).toHaveLength(0);
    });

    it('artifact resolves to battlefield without summoning sickness', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeArtifact());
      state.players[0].manaPool = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 };
      let next = castSpell(state, 'p1', cardInstanceId);
      next = resolveTopOfStack(next);

      expect(next.cards.get(cardInstanceId)!.zone).toBe('battlefield');
      expect(next.cards.get(cardInstanceId)!.summoningSick).toBe(false);
    });

    it('enchantment resolves to battlefield', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeEnchantment(), 'combat');
      state.players[0].manaPool = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 };
      let next = castSpell(state, 'p1', cardInstanceId);
      next = resolveTopOfStack(next);

      expect(next.cards.get(cardInstanceId)!.zone).toBe('battlefield');
    });

    it('instant resolves to graveyard', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeInstant());
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
      let next = castSpell(state, 'p1', cardInstanceId);
      next = resolveTopOfStack(next);

      expect(next.cards.get(cardInstanceId)!.zone).toBe('graveyard');
      expect(next.stack).toHaveLength(0);
    });

    it('sorcery resolves to graveyard', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeSorcery());
      state.players[0].manaPool = { W: 0, U: 3, B: 0, R: 0, G: 0, C: 0 };
      let next = castSpell(state, 'p1', cardInstanceId);
      next = resolveTopOfStack(next);

      expect(next.cards.get(cardInstanceId)!.zone).toBe('graveyard');
    });

    it('resolves top item (LIFO) when multiple on stack', () => {
      const bolt1: CardDefinition = { ...makeInstant(), id: 'bolt-1' };
      const bolt2: CardDefinition = { ...makeInstant(), id: 'bolt-2' };
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [bolt1, bolt2], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const cards = getCardsInZone(state, 'p1', 'library');
      state.cards.set(cards[0].instanceId, { ...cards[0], zone: 'hand' });
      state.cards.set(cards[1].instanceId, { ...cards[1], zone: 'hand' });
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 };
      state = { ...state, phase: 'precombat_main' as any };

      state = castSpell(state, 'p1', cards[0].instanceId);
      state = castSpell(state, 'p1', cards[1].instanceId);

      state = resolveTopOfStack(state);
      expect(state.stack).toHaveLength(1);
      expect(state.cards.get(cards[1].instanceId)!.zone).toBe('graveyard');
      expect(state.stack[0].cardInstanceId).toBe(cards[0].instanceId);
    });

    it('throws if stack is empty', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ];
      const state = initGameState(decks);
      expect(() => resolveTopOfStack(state)).toThrow();
    });

    it('resets priority after resolution', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeInstant());
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
      let next = castSpell(state, 'p1', cardInstanceId);
      next.hasPriorityPassed[0] = true;
      next.hasPriorityPassed[1] = true;
      next = resolveTopOfStack(next);
      expect(next.hasPriorityPassed.every(p => p === false)).toBe(true);
    });
  });
});

describe('Modal spell resolution', () => {
  function makeModalInstant(): CardDefinition {
    return {
      id: 'modal-charm-1', name: 'Test Charm', type_line: 'Instant',
      oracle_text: 'Choose one — • ~ deals 3 damage to target creature. • Draw a card.',
      mana_cost: '{R}', cmc: 1,
      colors: ['R'], color_identity: ['R'], keywords: [],
      card_types: ['instant'],
    };
  }

  function makeTargetCreature(): CardDefinition {
    return {
      id: 'target-bear-1', name: 'Target Bear', type_line: 'Creature — Bear',
      oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
      colors: ['G'], color_identity: ['G'], keywords: [],
      card_types: ['creature'], power: 2, toughness: 4,
    };
  }

  it('resolves modal mode 0 (deal 3 damage to target creature)', () => {
    // Set up: player has modal instant in hand, opponent has a creature on battlefield
    const modalCard = makeModalInstant();
    const bearCard = makeTargetCreature();
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [modalCard], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [bearCard], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);

    // Move modal instant to p1's hand
    const charmInstance = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(charmInstance.instanceId, { ...charmInstance, zone: 'hand' });

    // Move bear to p2's battlefield
    const bearInstance = getCardsInZone(state, 'p2', 'library')[0];
    state.cards.set(bearInstance.instanceId, { ...bearInstance, zone: 'battlefield' });

    // Give p1 mana and set main phase
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 };
    state = { ...state, phase: 'precombat_main' as any };

    // Cast the modal spell targeting the bear
    state = castSpell(state, 'p1', charmInstance.instanceId, [bearInstance.instanceId]);

    // Set chosenModes on the stack item (mode 0 = deal 3 damage)
    const topIdx = state.stack.length - 1;
    const stackItem = state.stack[topIdx] as any;
    state = {
      ...state,
      stack: [
        ...state.stack.slice(0, topIdx),
        { ...stackItem, chosenModes: [0] },
      ],
    };

    // Resolve the spell
    state = resolveTopOfStack(state);

    // Verify: spell goes to graveyard
    expect(state.cards.get(charmInstance.instanceId)!.zone).toBe('graveyard');
    expect(state.stack).toHaveLength(0);

    // Verify: bear took 3 damage
    expect(state.cards.get(bearInstance.instanceId)!.damage).toBe(3);
  });

  it('resolves modal mode 1 (draw a card)', () => {
    const modalCard = makeModalInstant();
    // Add a filler card so p1 has something in library to draw
    const fillerCard: CardDefinition = {
      id: 'filler-1', name: 'Filler Card', type_line: 'Creature — Bear',
      oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
      colors: ['G'], color_identity: ['G'], keywords: [],
      card_types: ['creature'], power: 2, toughness: 2,
    };
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [modalCard, fillerCard], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);

    // Move modal instant to p1's hand (it's the first card in library)
    const p1Library = getCardsInZone(state, 'p1', 'library');
    const charmInstance = p1Library.find(c => {
      const def = state.cardDefinitions.get(c.definitionId);
      return def?.name === 'Test Charm';
    })!;
    state.cards.set(charmInstance.instanceId, { ...charmInstance, zone: 'hand' });

    // Give p1 mana and set main phase
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 };
    state = { ...state, phase: 'precombat_main' as any };

    // Count cards in p1's library before (should be 1: the filler card)
    const libraryBefore = getCardsInZone(state, 'p1', 'library').length;
    expect(libraryBefore).toBe(1);

    // Cast with no targets (draw mode has none)
    state = castSpell(state, 'p1', charmInstance.instanceId, []);

    // Set chosenModes on the stack item (mode 1 = draw a card)
    const topIdx = state.stack.length - 1;
    const stackItem = state.stack[topIdx] as any;
    state = {
      ...state,
      stack: [
        ...state.stack.slice(0, topIdx),
        { ...stackItem, chosenModes: [1] },
      ],
    };

    // Resolve the spell
    state = resolveTopOfStack(state);

    // Verify: spell goes to graveyard
    expect(state.cards.get(charmInstance.instanceId)!.zone).toBe('graveyard');
    expect(state.stack).toHaveLength(0);

    // Verify: p1 drew a card (one card moved from library to hand)
    const libraryAfter = getCardsInZone(state, 'p1', 'library').length;
    const handAfter = getCardsInZone(state, 'p1', 'hand').length;
    expect(libraryAfter).toBe(libraryBefore - 1);
    expect(handAfter).toBe(1); // drew 1 card (filler card)
  });

  it('falls through to unparsed when no chosenModes provided for modal spell', () => {
    const modalCard = makeModalInstant();
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [modalCard], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);

    // Move modal instant to p1's hand
    const charmInstance = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(charmInstance.instanceId, { ...charmInstance, zone: 'hand' });

    // Give p1 mana and set main phase
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 };
    state = { ...state, phase: 'precombat_main' as any };

    const libraryBefore = getCardsInZone(state, 'p1', 'library').length;

    // Cast without setting chosenModes
    state = castSpell(state, 'p1', charmInstance.instanceId, []);
    state = resolveTopOfStack(state);

    // Verify: spell goes to graveyard (standard behavior for unparsed)
    expect(state.cards.get(charmInstance.instanceId)!.zone).toBe('graveyard');
    expect(state.stack).toHaveLength(0);

    // Verify: no card drawn (no effects executed)
    const libraryAfter = getCardsInZone(state, 'p1', 'library').length;
    expect(libraryAfter).toBe(libraryBefore);
  });
});
