import { describe, it, expect } from 'vitest';
import { canCastSpell, castSpell, putTriggersOnStack, resolveTopOfStack } from './stack';
import { tryTapLandForMana } from './actions-public';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition, StackItem } from './types';
import { performUntapStep } from './turn-manager';

function makeCreature(): CardDefinition {
  return {
    id: 'bear-1', name: 'Grizzly Bears', type_line: 'Creature — Bear',
    oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
    colors: ['G'], color_identity: ['G'], keywords: [],
    card_types: ['creature'], power: 2, toughness: 2,
  };
}

function makeCreatureEnteringWithCounters(): CardDefinition {
  return {
    id: 'yorvo-like-1',
    name: 'Yorvo Like',
    type_line: 'Legendary Creature - Giant Noble',
    oracle_text: 'Yorvo Like enters with four +1/+1 counters on it.',
    mana_cost: '{G}{G}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 0,
    toughness: 0,
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

function makeScrySpell(): CardDefinition {
  return {
    id: 'scry-test-1', name: 'Choice Scry', type_line: 'Instant',
    oracle_text: 'Scry 2.', mana_cost: '{U}', cmc: 1,
    colors: ['U'], color_identity: ['U'], keywords: [],
    card_types: ['instant'],
  };
}

function makeVanillaCard(id: string, name: string, typeLine = 'Creature - Test'): CardDefinition {
  return {
    id, name, type_line: typeLine,
    oracle_text: '', mana_cost: '{1}', cmc: 1,
    colors: [], color_identity: [], keywords: [],
    card_types: typeLine.toLowerCase().includes('land') ? ['land'] : ['creature'],
    power: typeLine.toLowerCase().includes('land') ? undefined : 1,
    toughness: typeLine.toLowerCase().includes('land') ? undefined : 1,
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

function makeCounterspell(): CardDefinition {
  return {
    id: 'counterspell-1',
    name: 'Counterspell',
    type_line: 'Instant',
    oracle_text: 'Counter target spell.',
    mana_cost: '{U}{U}',
    cmc: 2,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['instant'],
  };
}

function makeDestroyCreatureSpell(): CardDefinition {
  return {
    id: 'destroy-creature-1',
    name: 'Clean Kill',
    type_line: 'Instant',
    oracle_text: 'Destroy target creature.',
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['instant'],
  };
}

function makePinger(): CardDefinition {
  return {
    id: 'pinger-1',
    name: 'Prodigal Pyromancer',
    type_line: 'Creature - Human Wizard',
    oracle_text: '{T}: Prodigal Pyromancer deals 1 damage to any target.',
    mana_cost: '{2}{R}',
    cmc: 3,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    card_types: ['creature'],
    power: 1,
    toughness: 1,
  };
}

function setupTargetedAbilityState() {
  const sourceDef = makePinger();
  const targetDef = makeCreature();
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: [sourceDef], commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [targetDef], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);
  const source = getCardsInZone(state, 'p1', 'library')[0];
  const target = getCardsInZone(state, 'p2', 'library')[0];
  state.cards.set(source.instanceId, { ...source, zone: 'battlefield' });
  state.cards.set(target.instanceId, { ...target, zone: 'battlefield' });
  return { state, sourceId: source.instanceId, targetId: target.instanceId };
}

function makeChromeMox(): CardDefinition {
  return {
    id: 'chrome-mox-1',
    name: 'Chrome Mox',
    type_line: 'Artifact',
    oracle_text: 'Imprint - When Chrome Mox enters the battlefield, you may exile a nonartifact, nonland card from your hand.\n{T}: Add one mana of any of the exiled card\'s colors.',
    mana_cost: '{0}',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact'],
  };
}

function makeMoxDiamond(): CardDefinition {
  return {
    id: 'mox-diamond-1',
    name: 'Mox Diamond',
    type_line: 'Artifact',
    oracle_text: 'If Mox Diamond would enter the battlefield, you may discard a land card instead. If you don\'t, put it into its owner\'s graveyard.\n{T}: Add one mana of any color.',
    mana_cost: '{0}',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact'],
  };
}

function makeGreenSpell(): CardDefinition {
  return {
    id: 'green-spell-1',
    name: 'Elvish Test Spell',
    type_line: 'Creature - Elf',
    oracle_text: '',
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 1,
    toughness: 1,
  };
}

function makeTestLand(): CardDefinition {
  return {
    id: 'test-land-1',
    name: 'Test Forest',
    type_line: 'Basic Land - Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeCavernOfSouls(): CardDefinition {
  return {
    id: 'cavern-of-souls-1',
    name: 'Cavern of Souls',
    type_line: 'Land',
    oracle_text: 'As Cavern of Souls enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can\'t be countered.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['land'],
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

function makeWaterknotAura(): CardDefinition {
  return {
    id: 'waterknot-1',
    name: 'Waterknot',
    type_line: 'Enchantment - Aura',
    oracle_text: "Enchant creature\nWhen this Aura enters, tap enchanted creature.\nEnchanted creature doesn't untap during its controller's untap step.",
    mana_cost: '{1}{U}',
    cmc: 2,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
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

    it('uses delve cards from graveyard to pay generic spell costs', () => {
      const delveSpell: CardDefinition = {
        id: 'treasure-cruise-1',
        name: 'Treasure Cruise',
        type_line: 'Sorcery',
        oracle_text: 'Delve\nDraw three cards.',
        mana_cost: '{7}{U}',
        cmc: 8,
        colors: ['U'],
        color_identity: ['U'],
        keywords: ['Delve'],
        card_types: ['sorcery'],
      };
      const fillers = Array.from({ length: 7 }, (_, index) => makeVanillaCard(`grave-${index}`, `Grave ${index}`));
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [delveSpell, ...fillers], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const spell = getCardsInZone(state, 'p1', 'library').find(card => card.definitionId === delveSpell.id)!;
      state.cards.set(spell.instanceId, { ...spell, zone: 'hand' });
      for (const card of getCardsInZone(state, 'p1', 'library').filter(card => card.instanceId !== spell.instanceId)) {
        state.cards.set(card.instanceId, { ...card, zone: 'graveyard' });
      }
      state.players[0].manaPool = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 };
      state = { ...state, phase: 'precombat_main' };

      expect(canCastSpell(state, 'p1', spell.instanceId)).toBe(true);
      const next = castSpell(state, 'p1', spell.instanceId);
      expect(next.cards.get(spell.instanceId)?.zone).toBe('stack');
      expect([...next.cards.values()].filter(card => card.zone === 'exile')).toHaveLength(7);
      expect(next.players[0].manaPool.U).toBe(0);
    });

    it('uses convoke creatures to pay spell costs and taps them', () => {
      const convokeSpell: CardDefinition = {
        id: 'conclave-convoke-1',
        name: 'Conclave Test',
        type_line: 'Sorcery',
        oracle_text: 'Convoke\nCreate a token.',
        mana_cost: '{3}{G}',
        cmc: 4,
        colors: ['G'],
        color_identity: ['G'],
        keywords: ['Convoke'],
        card_types: ['sorcery'],
      };
      const creatures = [makeVanillaCard('c1', 'Helper One'), makeVanillaCard('c2', 'Helper Two'), makeVanillaCard('c3', 'Helper Three')];
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [convokeSpell, ...creatures], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const spell = getCardsInZone(state, 'p1', 'library').find(card => card.definitionId === convokeSpell.id)!;
      state.cards.set(spell.instanceId, { ...spell, zone: 'hand' });
      const helpers = getCardsInZone(state, 'p1', 'library').filter(card => card.instanceId !== spell.instanceId);
      for (const card of helpers) state.cards.set(card.instanceId, { ...card, zone: 'battlefield', tapped: false });
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 };
      state = { ...state, phase: 'precombat_main' };

      expect(canCastSpell(state, 'p1', spell.instanceId)).toBe(true);
      const next = castSpell(state, 'p1', spell.instanceId);
      expect(helpers.every(card => next.cards.get(card.instanceId)?.tapped)).toBe(true);
      expect(next.cards.get(spell.instanceId)?.zone).toBe('stack');
    });

    it('uses improvise artifacts to pay generic spell costs and taps them', () => {
      const improviseSpell: CardDefinition = {
        id: 'improvise-test-1',
        name: 'Improvise Test',
        type_line: 'Sorcery',
        oracle_text: 'Improvise\nDraw a card.',
        mana_cost: '{3}{U}',
        cmc: 4,
        colors: ['U'],
        color_identity: ['U'],
        keywords: ['Improvise'],
        card_types: ['sorcery'],
      };
      const artifacts = [
        { ...makeArtifact(), id: 'artifact-a', name: 'Artifact A' },
        { ...makeArtifact(), id: 'artifact-b', name: 'Artifact B' },
        { ...makeArtifact(), id: 'artifact-c', name: 'Artifact C' },
      ];
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [improviseSpell, ...artifacts], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const spell = getCardsInZone(state, 'p1', 'library').find(card => card.definitionId === improviseSpell.id)!;
      state.cards.set(spell.instanceId, { ...spell, zone: 'hand' });
      const helpers = getCardsInZone(state, 'p1', 'library').filter(card => card.instanceId !== spell.instanceId);
      for (const card of helpers) state.cards.set(card.instanceId, { ...card, zone: 'battlefield', tapped: false });
      state.players[0].manaPool = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 };
      state = { ...state, phase: 'precombat_main' };

      expect(canCastSpell(state, 'p1', spell.instanceId)).toBe(true);
      const next = castSpell(state, 'p1', spell.instanceId);
      expect(helpers.every(card => next.cards.get(card.instanceId)?.tapped)).toBe(true);
      expect(next.cards.get(spell.instanceId)?.zone).toBe('stack');
    });

    it('counters targeted spells with unpaid Ward costs', () => {
      const killSpell = makeDestroyCreatureSpell();
      const wardCreature: CardDefinition = {
        ...makeCreature(),
        id: 'ward-bear',
        name: 'Ward Bear',
        oracle_text: 'Ward {2}',
        keywords: ['Ward'],
      };
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [killSpell], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [wardCreature], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const spell = getCardsInZone(state, 'p1', 'library')[0];
      const target = getCardsInZone(state, 'p2', 'library')[0];
      state.cards.set(spell.instanceId, { ...spell, zone: 'hand' });
      state.cards.set(target.instanceId, { ...target, zone: 'battlefield' });
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 };
      state = { ...state, phase: 'precombat_main' as any };

      const next = castSpell(state, 'p1', spell.instanceId, [target.instanceId]);
      expect(next.stack).toHaveLength(0);
      expect(next.cards.get(spell.instanceId)?.zone).toBe('graveyard');
      expect(next.cards.get(target.instanceId)?.zone).toBe('battlefield');
    });

    it('auto-pays simple Ward costs when mana is available', () => {
      const killSpell = makeDestroyCreatureSpell();
      const wardCreature: CardDefinition = {
        ...makeCreature(),
        id: 'ward-bear-paid',
        name: 'Ward Bear Paid',
        oracle_text: 'Ward {2}',
        keywords: ['Ward'],
      };
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [killSpell], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [wardCreature], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const spell = getCardsInZone(state, 'p1', 'library')[0];
      const target = getCardsInZone(state, 'p2', 'library')[0];
      state.cards.set(spell.instanceId, { ...spell, zone: 'hand' });
      state.cards.set(target.instanceId, { ...target, zone: 'battlefield' });
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 2 };
      state = { ...state, phase: 'precombat_main' as any };

      const next = castSpell(state, 'p1', spell.instanceId, [target.instanceId]);
      expect(next.stack).toHaveLength(1);
      expect(next.cards.get(spell.instanceId)?.zone).toBe('stack');
      expect(next.players[0].manaPool.C).toBe(0);
    });

    it('charges and resolves selected X values for X spells', () => {
      const xSpell: CardDefinition = {
        id: 'x-bolt-1',
        name: 'X Bolt',
        type_line: 'Sorcery',
        oracle_text: 'X Bolt deals X damage to any target.',
        mana_cost: '{X}{R}',
        cmc: 1,
        colors: ['R'],
        color_identity: ['R'],
        keywords: [],
        card_types: ['sorcery'],
      };
      const { state, cardInstanceId } = setupWithCardInHand(xSpell);
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 3 };

      const cast = castSpell(state, 'p1', cardInstanceId, ['p2'], { xValue: 3 });
      expect(cast.players[0].manaPool).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
      expect((cast.stack[0] as any).xValue).toBe(3);

      const resolved = resolveTopOfStack(cast);
      expect(resolved.players[1].life).toBe(37);
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
      const { state, cardInstanceId } = setupWithCardInHand({
        ...makeInstant(),
        name: 'Lightning Bolt',
        oracle_text: '~ deals 3 damage to any target.',
      });
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
      const next = castSpell(state, 'p1', cardInstanceId, ['p2']);
      expect(next.stack[0].targets).toEqual(['p2']);
    });

    it('uses a selected creature for cast-trigger sacrifice-to-counter spells', () => {
      const brainGorgers: CardDefinition = {
        id: 'brain-gorgers-1',
        name: 'Brain Gorgers',
        type_line: 'Creature - Zombie',
        oracle_text: 'When you cast this spell, any player may sacrifice a creature. If a player does, counter Brain Gorgers.',
        mana_cost: '{3}{B}',
        cmc: 4,
        colors: ['B'],
        color_identity: ['B'],
        keywords: [],
        card_types: ['creature'],
        power: 4,
        toughness: 2,
      };
      const victimDef: CardDefinition = {
        ...makeCreature(),
        id: 'victim-1',
        name: 'Sacrifice Creature',
      };
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [brainGorgers], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [victimDef], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const brain = getCardsInZone(state, 'p1', 'library')[0];
      const victim = getCardsInZone(state, 'p2', 'library')[0];
      state.cards.set(brain.instanceId, { ...brain, zone: 'hand' });
      state.cards.set(victim.instanceId, { ...victim, zone: 'battlefield' });
      state = { ...state, phase: 'precombat_main' as any };
      state.players[0].manaPool = { W: 0, U: 0, B: 4, R: 0, G: 0, C: 0 };

      const next = castSpell(state, 'p1', brain.instanceId, [], {
        namedCardChoices: { sacrificeCardId: victim.instanceId },
      });

      expect(next.cards.get(victim.instanceId)?.zone).toBe('graveyard');
      expect(next.cards.get(brain.instanceId)?.zone).toBe('graveyard');
      expect(next.stack.some(item => item.cardInstanceId === brain.instanceId)).toBe(false);
    });

    it('resolves sacrifice-this-unless-target-opponent-sacrifices ETB triggers', () => {
      const brainGorgers: CardDefinition = {
        id: 'brain-gorgers-etb',
        name: 'Brain Gorgers',
        type_line: 'Creature - Zombie',
        oracle_text: 'When Brain Gorgers enters the battlefield, sacrifice it unless target opponent sacrifices a creature.',
        mana_cost: '{3}{B}',
        cmc: 4,
        colors: ['B'],
        color_identity: ['B'],
        keywords: [],
        card_types: ['creature'],
        power: 4,
        toughness: 2,
      };
      const victimDef: CardDefinition = {
        ...makeCreature(),
        id: 'victim-etb',
        name: 'Opponent Creature',
      };
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [brainGorgers], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [victimDef], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const brain = getCardsInZone(state, 'p1', 'library')[0];
      const victim = getCardsInZone(state, 'p2', 'library')[0];
      state.cards.set(brain.instanceId, { ...brain, zone: 'hand' });
      state.cards.set(victim.instanceId, { ...victim, zone: 'battlefield' });
      state = { ...state, phase: 'precombat_main' as any };
      state.players[0].manaPool = { W: 0, U: 0, B: 4, R: 0, G: 0, C: 0 };

      state = castSpell(state, 'p1', brain.instanceId);
      state = resolveTopOfStack(state);
      expect(state.cards.get(brain.instanceId)?.zone).toBe('battlefield');
      expect(state.pendingTriggers).toHaveLength(1);
      expect(state.pendingTriggers[0].ability.effects[0]).toMatchObject({
        kind: 'SacrificeSelfUnlessPlayerSacrifices',
      });

      state = putTriggersOnStack(state);
      expect(state.stack[0].ability.effects[0]).toMatchObject({
        kind: 'SacrificeSelfUnlessPlayerSacrifices',
      });
      expect((state.stack[0].targetSpecs?.[0] as { id?: string }).id)
        .toBe(((state.stack[0].ability.effects[0] as { player?: { targetId?: string } }).player)?.targetId);
      expect(state.stack[0].targets).toEqual(['p2']);
      state = resolveTopOfStack(state);
      expect(state.cards.get(victim.instanceId)?.zone).toBe('graveyard');
      expect(state.cards.get(brain.instanceId)?.zone).toBe('battlefield');
    });

    it('sacrifices the source when the target opponent cannot sacrifice for the ETB unless trigger', () => {
      const brainGorgers: CardDefinition = {
        id: 'brain-gorgers-etb-no-victim',
        name: 'Brain Gorgers',
        type_line: 'Creature - Zombie',
        oracle_text: 'When Brain Gorgers enters the battlefield, sacrifice it unless target opponent sacrifices a creature.',
        mana_cost: '{3}{B}',
        cmc: 4,
        colors: ['B'],
        color_identity: ['B'],
        keywords: [],
        card_types: ['creature'],
        power: 4,
        toughness: 2,
      };
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [brainGorgers], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const brain = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(brain.instanceId, { ...brain, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' as any };
      state.players[0].manaPool = { W: 0, U: 0, B: 4, R: 0, G: 0, C: 0 };

      state = castSpell(state, 'p1', brain.instanceId);
      state = resolveTopOfStack(state);
      state = putTriggersOnStack(state);
      state = resolveTopOfStack(state);
      expect(state.cards.get(brain.instanceId)?.zone).toBe('graveyard');
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

    it('marks matching Cavern of Souls creature spells as unable to be countered', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [makeCavernOfSouls(), makeGreenSpell()], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [makeCounterspell()], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const cavern = getCardsInZone(state, 'p1', 'library')
        .find(card => state.cardDefinitions.get(card.definitionId)?.name === 'Cavern of Souls')!;
      const elf = getCardsInZone(state, 'p1', 'library')
        .find(card => state.cardDefinitions.get(card.definitionId)?.name === 'Elvish Test Spell')!;
      const counter = getCardsInZone(state, 'p2', 'library')[0];

      state.cards.set(cavern.instanceId, {
        ...cavern,
        zone: 'battlefield',
        tapped: false,
        choices: { chosenCreatureType: 'Elf' },
      });
      state.cards.set(elf.instanceId, { ...elf, zone: 'hand' });
      state.cards.set(counter.instanceId, { ...counter, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' as any };

      const manaResult = tryTapLandForMana(state, 'p1', cavern.instanceId, 'G');
      expect(manaResult.ok).toBe(true);
      if (!manaResult.ok) return;
      state = manaResult.state;
      state = castSpell(state, 'p1', elf.instanceId);

      expect(state.stack[0].cardInstanceId).toBe(elf.instanceId);
      expect((state.stack[0] as any).cantBeCountered).toBe(true);

      state = {
        ...state,
        priorityPlayerIndex: 1,
        players: state.players.map(player =>
          player.id === 'p2'
            ? { ...player, manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 } }
            : player,
        ),
      };
      state = castSpell(state, 'p2', counter.instanceId, [elf.instanceId]);
      state = resolveTopOfStack(state);

      expect(state.cards.get(counter.instanceId)?.zone).toBe('graveyard');
      expect(state.cards.get(elf.instanceId)?.zone).toBe('stack');
      expect(state.stack).toHaveLength(1);
      expect(state.stack[0].cardInstanceId).toBe(elf.instanceId);

      state = resolveTopOfStack(state);

      expect(state.cards.get(elf.instanceId)?.zone).toBe('battlefield');
    });
  });

  describe('resolveTopOfStack', () => {
    it('fizzles activated abilities when their target gains hexproof before resolution', () => {
      const { state, sourceId, targetId } = setupTargetedAbilityState();
      state.stack.push({
        kind: 'ActivatedAbility',
        id: 'activated_ping',
        sourceInstanceId: sourceId,
        controllerId: 'p1',
        ability: {
          effects: [{ kind: 'DealDamage', target: { kind: 'Chosen', targetId: 'target' }, amount: 3 }],
          targets: [{ id: 'target', type: 'Creature' }],
        },
        targets: [targetId],
      });

      const target = state.cards.get(targetId)!;
      state.cards.set(targetId, { ...target, grantedKeywords: ['Hexproof'] });

      const next = resolveTopOfStack(state);
      expect(next.stack).toHaveLength(0);
      expect(next.cards.get(targetId)?.damage).toBe(0);
      expect(next.cards.get(targetId)?.zone).toBe('battlefield');
    });

    it('fizzles activated abilities when their target gains protection from the source color before resolution', () => {
      const { state, sourceId, targetId } = setupTargetedAbilityState();
      state.stack.push({
        kind: 'ActivatedAbility',
        id: 'activated_protected_ping',
        sourceInstanceId: sourceId,
        controllerId: 'p1',
        ability: {
          effects: [{ kind: 'DealDamage', target: { kind: 'Chosen', targetId: 'target' }, amount: 3 }],
          targets: [{ id: 'target', type: 'Creature' }],
        },
        targets: [targetId],
      });

      const target = state.cards.get(targetId)!;
      const targetDef = state.cardDefinitions.get(target.definitionId)!;
      state.cardDefinitions.set(target.definitionId, { ...targetDef, oracle_text: 'Protection from red' });

      const next = resolveTopOfStack(state);
      expect(next.stack).toHaveLength(0);
      expect(next.cards.get(targetId)?.damage).toBe(0);
      expect(next.cards.get(targetId)?.zone).toBe('battlefield');
    });

    it('fizzles triggered abilities when their target gains hexproof before resolution', () => {
      const { state, sourceId, targetId } = setupTargetedAbilityState();
      state.stack.push({
        kind: 'TriggeredAbility',
        id: 'trigger_ping',
        sourceInstanceId: sourceId,
        controllerId: 'p1',
        ability: {
          kind: 'TriggeredAbility',
          trigger: { kind: 'ETB', who: 'self' },
          effects: [{ kind: 'DealDamage', target: { kind: 'Chosen', targetId: 'target' }, amount: 3 }],
        },
        targetSpecs: [{ id: 'target', type: 'Creature', count: 1 }],
        targets: [targetId],
      });

      const target = state.cards.get(targetId)!;
      state.cards.set(targetId, { ...target, grantedKeywords: ['Hexproof'] });

      const next = resolveTopOfStack(state);
      expect(next.stack).toHaveLength(0);
      expect(next.cards.get(targetId)?.damage).toBe(0);
      expect(next.cards.get(targetId)?.zone).toBe('battlefield');
    });

    it('still resolves legal targets when another target becomes illegal before resolution', () => {
      const { state, sourceId, targetId } = setupTargetedAbilityState();
      state.stack.push({
        kind: 'ActivatedAbility',
        id: 'activated_double_ping',
        sourceInstanceId: sourceId,
        controllerId: 'p1',
        ability: {
          effects: [
            { kind: 'DealDamage', target: { kind: 'Chosen', targetId: 'first' }, amount: 3 },
            { kind: 'DealDamage', target: { kind: 'Chosen', targetId: 'second' }, amount: 3 },
          ],
          targets: [
            { id: 'first', type: 'Creature' },
            { id: 'second', type: 'Creature' },
          ],
        },
        targets: [targetId, sourceId],
      });

      const first = state.cards.get(targetId)!;
      state.cards.set(targetId, { ...first, grantedKeywords: ['Hexproof'] });

      const next = resolveTopOfStack(state);
      expect(next.stack).toHaveLength(0);
      expect(next.cards.get(targetId)?.damage).toBe(0);
      expect(next.cards.get(sourceId)?.zone).toBe('graveyard');
    });

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

    it('passes explicit scry choices from the stack item into spell resolution', () => {
      const decks = [
        {
          playerId: 'p1',
          name: 'Alice',
          cards: [
            makeScrySpell(),
            makeVanillaCard('top-a', 'Top A'),
            makeVanillaCard('top-b', 'Top B'),
            makeVanillaCard('rest-c', 'Rest C'),
          ],
          commanderId: 'cmd1',
        },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const spell = getCardsInZone(state, 'p1', 'library')
        .find(card => state.cardDefinitions.get(card.definitionId)?.name === 'Choice Scry')!;
      const [first, second] = getCardsInZone(state, 'p1', 'library')
        .filter(card => card.instanceId !== spell.instanceId)
        .slice(0, 2);

      state.cards.set(spell.instanceId, { ...spell, zone: 'stack' });
      state.stack.push({
        kind: 'Spell',
        id: 'choice-scry-stack',
        cardInstanceId: spell.instanceId,
        casterId: 'p1',
        targets: [],
        namedCardChoices: {
          scryTopIds: second.instanceId,
          scryBottomIds: first.instanceId,
        },
      });

      const next = resolveTopOfStack(state);
      const libraryOrder = getCardsInZone(next, 'p1', 'library').map(card => card.instanceId);

      expect(libraryOrder[0]).toBe(second.instanceId);
      expect(libraryOrder[libraryOrder.length - 1]).toBe(first.instanceId);
      expect(next.cards.get(spell.instanceId)?.zone).toBe('graveyard');
    });

    it('resolves Chrome Mox with an imprinted nonartifact nonland card choice', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [makeChromeMox(), makeGreenSpell()], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const chrome = getCardsInZone(state, 'p1', 'library')
        .find(card => state.cardDefinitions.get(card.definitionId)?.name === 'Chrome Mox')!;
      const imprint = getCardsInZone(state, 'p1', 'library')
        .find(card => state.cardDefinitions.get(card.definitionId)?.name === 'Elvish Test Spell')!;
      state.cards.set(chrome.instanceId, { ...chrome, zone: 'hand' });
      state.cards.set(imprint.instanceId, { ...imprint, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' as any };

      state = castSpell(state, 'p1', chrome.instanceId, [], {
        cardChoices: { imprintedCardIds: [imprint.instanceId] },
      });
      state = resolveTopOfStack(state);

      expect(state.cards.get(chrome.instanceId)?.zone).toBe('battlefield');
      expect(state.cards.get(chrome.instanceId)?.choices?.imprintedCardIds).toEqual([imprint.instanceId]);
      expect(state.cards.get(imprint.instanceId)?.zone).toBe('exile');

      const redMana = tryTapLandForMana(state, 'p1', chrome.instanceId, 'R');
      expect(redMana.ok).toBe(false);
      if (!redMana.ok) expect(redMana.reason).toBe('illegal_target');

      const greenMana = tryTapLandForMana(state, 'p1', chrome.instanceId, 'G');
      expect(greenMana.ok).toBe(true);
      if (greenMana.ok) expect(greenMana.state.players[0].manaPool.G).toBe(1);
    });

    it('leaves Chrome Mox unable to make mana when no card is imprinted', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeChromeMox());
      let next = castSpell(state, 'p1', cardInstanceId);
      next = resolveTopOfStack(next);

      const result = tryTapLandForMana(next, 'p1', cardInstanceId, 'G');

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('illegal_target');
    });

    it('resolves Mox Diamond with a discarded land choice', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [makeMoxDiamond(), makeTestLand()], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const mox = getCardsInZone(state, 'p1', 'library')
        .find(card => state.cardDefinitions.get(card.definitionId)?.name === 'Mox Diamond')!;
      const land = getCardsInZone(state, 'p1', 'library')
        .find(card => state.cardDefinitions.get(card.definitionId)?.name === 'Test Forest')!;
      state.cards.set(mox.instanceId, { ...mox, zone: 'hand' });
      state.cards.set(land.instanceId, { ...land, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' as any };

      state = castSpell(state, 'p1', mox.instanceId, [], {
        cardChoices: { discardedCardIds: [land.instanceId] },
      });
      state = resolveTopOfStack(state);

      expect(state.cards.get(mox.instanceId)?.zone).toBe('battlefield');
      expect(state.cards.get(mox.instanceId)?.choices?.discardedCardIds).toEqual([land.instanceId]);
      expect(state.cards.get(land.instanceId)?.zone).toBe('graveyard');

      const mana = tryTapLandForMana(state, 'p1', mox.instanceId, 'U');
      expect(mana.ok).toBe(true);
      if (mana.ok) expect(mana.state.players[0].manaPool.U).toBe(1);
    });

    it('puts Mox Diamond into the graveyard when no land is discarded', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeMoxDiamond());
      let next = castSpell(state, 'p1', cardInstanceId);
      next = resolveTopOfStack(next);

      expect(next.cards.get(cardInstanceId)?.zone).toBe('graveyard');
    });

    it('enchantment resolves to battlefield', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeEnchantment(), 'combat');
      state.players[0].manaPool = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 };
      let next = castSpell(state, 'p1', cardInstanceId);
      next = resolveTopOfStack(next);

      expect(next.cards.get(cardInstanceId)!.zone).toBe('battlefield');
    });

    it('aura ETB can tap enchanted creature and prevent untap', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [makeWaterknotAura(), makeCreature()], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const [aura, creature] = getCardsInZone(state, 'p1', 'library');
      state.cards.set(aura.instanceId, { ...aura, zone: 'hand' });
      state.cards.set(creature.instanceId, { ...creature, zone: 'battlefield', tapped: false, summoningSick: false });
      state = { ...state, phase: 'precombat_main' as any, step: 'untap' };
      state.players[0].manaPool = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 };

      state = castSpell(state, 'p1', aura.instanceId, [creature.instanceId]);
      state = resolveTopOfStack(state);

      expect(state.cards.get(aura.instanceId)?.attachedTo).toBe(creature.instanceId);
      expect(state.cards.get(creature.instanceId)?.tapped).toBe(true);

      state = performUntapStep(state);
      expect(state.cards.get(creature.instanceId)?.tapped).toBe(true);
    });

    it('applies enters-with counters before the permanent can be checked as a creature', () => {
      const { state, cardInstanceId } = setupWithCardInHand(makeCreatureEnteringWithCounters());
      let next = castSpell(state, 'p1', cardInstanceId);
      next = resolveTopOfStack(next);

      expect(next.cards.get(cardInstanceId)?.zone).toBe('battlefield');
      expect(next.cards.get(cardInstanceId)?.counters['+1/+1']).toBe(4);
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

    it('lets a counterspell fizzle if its target has already left the stack', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [makeCreature()], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [makeCounterspell()], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const creature = getCardsInZone(state, 'p1', 'library')[0];
      const counter = getCardsInZone(state, 'p2', 'library')[0];

      state.cards.set(creature.instanceId, { ...creature, zone: 'hand' });
      state.cards.set(counter.instanceId, { ...counter, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' as any };
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 1 };
      state.players[1].manaPool = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 };

      state = castSpell(state, 'p1', creature.instanceId);
      state = castSpell(state, 'p2', counter.instanceId, [creature.instanceId]);

      state.cards.set(creature.instanceId, { ...state.cards.get(creature.instanceId)!, zone: 'battlefield' });
      state = {
        ...state,
        stack: state.stack.filter(item => (item as StackItem).cardInstanceId !== creature.instanceId),
      };

      state = resolveTopOfStack(state);

      expect(state.cards.get(counter.instanceId)?.zone).toBe('graveyard');
      expect(state.cards.get(creature.instanceId)?.zone).toBe('battlefield');
      expect(state.stack).toHaveLength(0);
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
