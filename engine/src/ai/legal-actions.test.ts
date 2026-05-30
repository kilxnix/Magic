import { describe, it, expect, beforeEach } from 'vitest';
import {
  getLegalActions,
  hasPriority,
  getSpellTargetSpecs,
  getLegalTargets,
} from './legal-actions';
import { GameState, CardDefinition, emptyManaPool, createPlayer, Phase, Step } from '../types';
import { populateParsedCache } from '../cards/card-parser-cache';
import { registerContinuousAbilitiesForPermanent } from '../stack';

// Helper to create minimal game state
function createTestState(overrides: Partial<GameState> = {}): GameState {
  const players = [
    { ...createPlayer('p1', 'Player 1'), hasPriority: true },
    { ...createPlayer('p2', 'Player 2'), hasPriority: false },
  ];

  return {
    players,
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as Phase,
    step: 'upkeep' as Step,
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    ...overrides,
  };
}

// Helper to add a card to the game state
function addCard(
  state: GameState,
  instanceId: string,
  ownerId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard' | 'command',
  def: Partial<CardDefinition>,
): void {
  const baseDef: CardDefinition = {
    id: def.id ?? instanceId,
    name: def.name ?? 'Test Card',
    type_line: def.type_line ?? 'Creature',
    oracle_text: def.oracle_text ?? '',
    mana_cost: def.mana_cost ?? '',
    cmc: def.cmc ?? 0,
    colors: def.colors ?? [],
    color_identity: def.color_identity ?? [],
    keywords: def.keywords ?? [],
    card_types: def.card_types ?? ['creature'],
    power: def.power,
    toughness: def.toughness,
    isEquipment: def.isEquipment,
    equipCost: def.equipCost,
    equipmentBonus: def.equipmentBonus,
  };

  const fullDef = populateParsedCache(baseDef);
  state.cardDefinitions.set(fullDef.id, fullDef);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: fullDef.id,
    ownerId,
    zone,
    tapped: false,
    summoningSick: zone === 'battlefield',
    counters: {},
    damage: 0,
    isCommander: false,
  });
}

describe('hasPriority', () => {
  it('returns true when player has priority', () => {
    const state = createTestState({ priorityPlayerIndex: 0 });
    expect(hasPriority(state, 'p1')).toBe(true);
    expect(hasPriority(state, 'p2')).toBe(false);
  });

  it('returns false when player does not have priority', () => {
    const state = createTestState({ priorityPlayerIndex: 1 });
    expect(hasPriority(state, 'p1')).toBe(false);
    expect(hasPriority(state, 'p2')).toBe(true);
  });
});

describe('getLegalActions', () => {
  it('returns empty array when player has no priority', () => {
    const state = createTestState({ priorityPlayerIndex: 1 });
    const actions = getLegalActions(state, 'p1');
    expect(actions).toEqual([]);
  });

  it('always includes PassPriority when player has priority', () => {
    const state = createTestState({ priorityPlayerIndex: 0 });
    const actions = getLegalActions(state, 'p1');
    expect(actions.some(a => a.kind === 'PassPriority')).toBe(true);
  });

  it('generates equip actions for payable equipment and controlled creatures', () => {
    const state = createTestState({
      priorityPlayerIndex: 0,
      activePlayerIndex: 0,
      phase: 'precombat_main',
    });
    state.players[0] = {
      ...state.players[0],
      manaPool: { ...emptyManaPool(), C: 1 },
    };

    addCard(state, 'morningstar', 'p1', 'battlefield', {
      name: 'Goblin Morningstar',
      type_line: 'Artifact - Equipment',
      oracle_text: 'Equipped creature gets +1/+0 and has trample. Equip {1}.',
      card_types: ['artifact'],
      isEquipment: true,
      equipCost: { ...emptyManaPool(), generic: 1 },
      equipmentBonus: { power: 1, toughness: 0, keywords: ['Trample'] },
    });
    addCard(state, 'goblin', 'p1', 'battlefield', {
      name: 'Goblin Token',
      type_line: 'Creature - Goblin',
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    });

    const equipActions = getLegalActions(state, 'p1').filter(action => action.kind === 'Equip');

    expect(equipActions).toEqual([
      {
        kind: 'Equip',
        equipmentInstanceId: 'morningstar',
        targetCreatureId: 'goblin',
      },
    ]);
  });

  it('does not offer equip actions when the stack is occupied', () => {
    const state = createTestState({
      priorityPlayerIndex: 0,
      activePlayerIndex: 0,
      phase: 'precombat_main',
      stack: [{
        id: 'spell-1',
        controllerId: 'p1',
        cardInstanceId: 'spell-card',
        effects: [],
        targets: [],
      }],
    });
    state.players[0] = {
      ...state.players[0],
      manaPool: { ...emptyManaPool(), C: 1 },
    };

    addCard(state, 'morningstar', 'p1', 'battlefield', {
      name: 'Goblin Morningstar',
      type_line: 'Artifact - Equipment',
      card_types: ['artifact'],
      isEquipment: true,
      equipCost: { ...emptyManaPool(), generic: 1 },
    });
    addCard(state, 'goblin', 'p1', 'battlefield', {
      name: 'Goblin Token',
      type_line: 'Creature - Goblin',
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    });

    expect(getLegalActions(state, 'p1').some(action => action.kind === 'Equip')).toBe(false);
  });

  describe('PlayLand actions', () => {
    it('generates PlayLand action for lands in hand during main phase', () => {
      const state = createTestState({
        priorityPlayerIndex: 0,
        activePlayerIndex: 0,
        phase: 'precombat_main',
      });

      addCard(state, 'forest1', 'p1', 'hand', {
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        card_types: ['land'],
      });

      const actions = getLegalActions(state, 'p1');
      const playLandActions = actions.filter(a => a.kind === 'PlayLand');

      expect(playLandActions).toHaveLength(1);
      expect(playLandActions[0]).toEqual({
        kind: 'PlayLand',
        cardInstanceId: 'forest1',
      });
    });

    it('does not generate PlayLand action outside main phase', () => {
      const state = createTestState({
        priorityPlayerIndex: 0,
        activePlayerIndex: 0,
        phase: 'combat',
      });

      addCard(state, 'forest1', 'p1', 'hand', {
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        card_types: ['land'],
      });

      const actions = getLegalActions(state, 'p1');
      const playLandActions = actions.filter(a => a.kind === 'PlayLand');

      expect(playLandActions).toHaveLength(0);
    });
  });

  describe('CastSpell actions', () => {
    it('generates CastSpell action for spells that can be cast', () => {
      const state = createTestState({
        priorityPlayerIndex: 0,
        activePlayerIndex: 0,
        phase: 'precombat_main',
      });

      // Give player mana
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 };

      addCard(state, 'bear1', 'p1', 'hand', {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        mana_cost: '{1}{G}',
        cmc: 2,
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      });

      const actions = getLegalActions(state, 'p1');
      const castActions = actions.filter(a => a.kind === 'CastSpell');

      expect(castActions).toHaveLength(1);
      expect(castActions[0]).toEqual({
        kind: 'CastSpell',
        cardInstanceId: 'bear1',
        targets: [],
      });
    });

    it('generates affordable X choices for X spells', () => {
      const state = createTestState({
        priorityPlayerIndex: 0,
        activePlayerIndex: 0,
        phase: 'precombat_main',
      });
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 3 };

      addCard(state, 'xbolt1', 'p1', 'hand', {
        name: 'X Bolt',
        type_line: 'Sorcery',
        oracle_text: 'X Bolt deals X damage to any target.',
        mana_cost: '{X}{R}',
        cmc: 1,
        colors: ['R'],
        color_identity: ['R'],
        card_types: ['sorcery'],
      });

      const actions = getLegalActions(state, 'p1')
        .filter((a): a is import('./types').CastSpellAction => a.kind === 'CastSpell' && a.cardInstanceId === 'xbolt1');

      expect([...new Set(actions.map(action => action.xValue))]).toEqual([0, 1, 2, 3]);
    });

    it('does not generate CastSpell when player cannot afford spell', () => {
      const state = createTestState({
        priorityPlayerIndex: 0,
        activePlayerIndex: 0,
        phase: 'precombat_main',
      });

      // Player has no mana
      state.players[0].manaPool = emptyManaPool();

      addCard(state, 'bear1', 'p1', 'hand', {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        mana_cost: '{1}{G}',
        cmc: 2,
        card_types: ['creature'],
      });

      const actions = getLegalActions(state, 'p1');
      const castActions = actions.filter(a => a.kind === 'CastSpell');

      expect(castActions).toHaveLength(0);
    });

    it('uses registered cost reducers when generating cast actions', () => {
      let state = createTestState({
        priorityPlayerIndex: 0,
        activePlayerIndex: 0,
        phase: 'precombat_main',
      });
      state.players[0].manaPool = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 };

      addCard(state, 'mentor1', 'p1', 'battlefield', {
        name: 'Stormcatch Mentor',
        type_line: 'Creature - Otter Wizard',
        oracle_text: 'Instant and sorcery spells you cast cost {1} less to cast.',
        mana_cost: '{U}{R}',
        cmc: 2,
        colors: ['U', 'R'],
        card_types: ['creature'],
        power: 1,
        toughness: 1,
      });
      addCard(state, 'draw1', 'p1', 'hand', {
        name: 'Impulse',
        type_line: 'Instant',
        oracle_text: 'Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library.',
        mana_cost: '{1}{U}',
        cmc: 2,
        colors: ['U'],
        card_types: ['instant'],
      });

      expect(getLegalActions(state, 'p1').some(a => a.kind === 'CastSpell' && a.cardInstanceId === 'draw1')).toBe(false);

      state = registerContinuousAbilitiesForPermanent(state, 'mentor1');

      expect(getLegalActions(state, 'p1').some(a => a.kind === 'CastSpell' && a.cardInstanceId === 'draw1')).toBe(true);
    });

    it('uses registered cost increasers when generating cast actions', () => {
      let state = createTestState({
        priorityPlayerIndex: 0,
        activePlayerIndex: 0,
        phase: 'precombat_main',
      });
      state.players[0].manaPool = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 1 };

      addCard(state, 'tax1', 'p1', 'battlefield', {
        name: 'Tax Bear',
        type_line: 'Creature - Human Soldier',
        oracle_text: 'Noncreature spells cost {1} more to cast.',
        mana_cost: '{1}{W}',
        cmc: 2,
        colors: ['W'],
        card_types: ['creature'],
        power: 2,
        toughness: 1,
      });
      addCard(state, 'draw1', 'p1', 'hand', {
        name: 'Impulse',
        type_line: 'Instant',
        oracle_text: 'Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library.',
        mana_cost: '{1}{U}',
        cmc: 2,
        colors: ['U'],
        card_types: ['instant'],
      });

      expect(getLegalActions(state, 'p1').some(a => a.kind === 'CastSpell' && a.cardInstanceId === 'draw1')).toBe(true);

      state = registerContinuousAbilitiesForPermanent(state, 'tax1');

      expect(getLegalActions(state, 'p1').some(a => a.kind === 'CastSpell' && a.cardInstanceId === 'draw1')).toBe(false);
    });

    it('generates counterspell actions targeting spells on the stack', () => {
      const state = createTestState({
        priorityPlayerIndex: 0,
        activePlayerIndex: 1,
        phase: 'combat',
        stack: [{
          kind: 'Spell',
          id: 'stack_1',
          cardInstanceId: 'spell1',
          casterId: 'p2',
          targets: [],
        }],
      });
      state.players[0].manaPool = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 };

      addCard(state, 'spell1', 'p2', 'hand', {
        name: 'Lightning Bolt',
        type_line: 'Instant',
        card_types: ['instant'],
      });
      addCard(state, 'counter1', 'p1', 'hand', {
        name: 'Counterspell',
        type_line: 'Instant',
        oracle_text: 'Counter target spell.',
        mana_cost: '{U}{U}',
        cmc: 2,
        card_types: ['instant'],
      });

      const actions = getLegalActions(state, 'p1');
      const castActions = actions.filter(a => a.kind === 'CastSpell' && a.cardInstanceId === 'counter1');

      expect(castActions).toContainEqual({
        kind: 'CastSpell',
        cardInstanceId: 'counter1',
        targets: ['spell1'],
      });
    });

    it('does not generate Essence Scatter with no creature spell on the stack', () => {
      const state = createTestState({
        priorityPlayerIndex: 0,
        activePlayerIndex: 0,
        phase: 'precombat_main',
      });
      state.players[0].manaPool = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 };

      addCard(state, 'scatter1', 'p1', 'hand', {
        name: 'Essence Scatter',
        type_line: 'Instant',
        oracle_text: 'Counter target creature spell.',
        mana_cost: '{1}{U}',
        cmc: 2,
        card_types: ['instant'],
      });

      const actions = getLegalActions(state, 'p1');
      expect(actions.some(a => a.kind === 'CastSpell' && a.cardInstanceId === 'scatter1')).toBe(false);
    });

    it('generates Essence Scatter only for creature spells on the stack', () => {
      const state = createTestState({
        priorityPlayerIndex: 0,
        activePlayerIndex: 1,
        phase: 'combat',
      });
      state.players[0].manaPool = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 };

      addCard(state, 'bear-spell', 'p2', 'hand', {
        name: 'Grizzly Bears',
        type_line: 'Creature - Bear',
        card_types: ['creature'],
      });
      addCard(state, 'bolt-spell', 'p2', 'hand', {
        name: 'Lightning Bolt',
        type_line: 'Instant',
        card_types: ['instant'],
      });
      addCard(state, 'scatter1', 'p1', 'hand', {
        name: 'Essence Scatter',
        type_line: 'Instant',
        oracle_text: 'Counter target creature spell.',
        mana_cost: '{1}{U}',
        cmc: 2,
        card_types: ['instant'],
      });
      state.stack = [
        { kind: 'Spell', id: 'stack_creature', cardInstanceId: 'bear-spell', casterId: 'p2', targets: [] },
        { kind: 'Spell', id: 'stack_instant', cardInstanceId: 'bolt-spell', casterId: 'p2', targets: [] },
      ];

      const actions = getLegalActions(state, 'p1');
      const scatterActions = actions.filter(a => a.kind === 'CastSpell' && a.cardInstanceId === 'scatter1');

      expect(scatterActions).toEqual([{
        kind: 'CastSpell',
        cardInstanceId: 'scatter1',
        targets: ['bear-spell'],
      }]);
    });
  });

  describe('ActivateManaAbility actions', () => {
    it('generates mana actions for untapped lands', () => {
      const state = createTestState({ priorityPlayerIndex: 0 });

      addCard(state, 'forest1', 'p1', 'battlefield', {
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        card_types: ['land'],
      });
      // Untap the land
      state.cards.get('forest1')!.tapped = false;

      const actions = getLegalActions(state, 'p1');
      const manaActions = actions.filter(a => a.kind === 'ActivateManaAbility');

      expect(manaActions).toHaveLength(1);
      expect(manaActions[0]).toEqual({
        kind: 'ActivateManaAbility',
        cardInstanceId: 'forest1',
        color: 'G',
      });
    });

    it('does not generate mana actions for tapped lands', () => {
      const state = createTestState({ priorityPlayerIndex: 0 });

      addCard(state, 'forest1', 'p1', 'battlefield', {
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        card_types: ['land'],
      });
      state.cards.get('forest1')!.tapped = true;

      const actions = getLegalActions(state, 'p1');
      const manaActions = actions.filter(a => a.kind === 'ActivateManaAbility');

      expect(manaActions).toHaveLength(0);
    });

    it('generates correct colors for basic lands', () => {
      const state = createTestState({ priorityPlayerIndex: 0 });

      addCard(state, 'plains1', 'p1', 'battlefield', {
        name: 'Plains',
        type_line: 'Basic Land — Plains',
        card_types: ['land'],
      });
      addCard(state, 'island1', 'p1', 'battlefield', {
        name: 'Island',
        type_line: 'Basic Land — Island',
        card_types: ['land'],
      });

      const actions = getLegalActions(state, 'p1');
      const manaActions = actions.filter(a => a.kind === 'ActivateManaAbility');

      expect(manaActions).toHaveLength(2);
      expect(manaActions.find(a => a.kind === 'ActivateManaAbility' && a.color === 'W')).toBeDefined();
      expect(manaActions.find(a => a.kind === 'ActivateManaAbility' && a.color === 'U')).toBeDefined();
    });

    it('does not generate Temple of the False God mana before five lands', () => {
      const state = createTestState({ priorityPlayerIndex: 0 });

      addCard(state, 'temple1', 'p1', 'battlefield', {
        name: 'Temple of the False God',
        type_line: 'Land',
        oracle_text: '{T}: Add {C}{C}. Activate only if you control five or more lands.',
        card_types: ['land'],
      });

      const actions = getLegalActions(state, 'p1');
      const manaActions = actions.filter(a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === 'temple1');

      expect(manaActions).toHaveLength(0);
    });

    it('generates Temple of the False God mana at five lands', () => {
      const state = createTestState({ priorityPlayerIndex: 0 });

      addCard(state, 'temple1', 'p1', 'battlefield', {
        name: 'Temple of the False God',
        type_line: 'Land',
        oracle_text: '{T}: Add {C}{C}. Activate only if you control five or more lands.',
        card_types: ['land'],
      });
      for (let i = 0; i < 4; i++) {
        addCard(state, `land${i}`, 'p1', 'battlefield', {
          name: `Island ${i}`,
          type_line: 'Basic Land - Island',
          card_types: ['land'],
        });
      }

      const actions = getLegalActions(state, 'p1');
      const manaActions = actions.filter(a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === 'temple1');

      expect(manaActions).toEqual([{
        kind: 'ActivateManaAbility',
        cardInstanceId: 'temple1',
        color: 'C',
      }]);
    });

    it('generates mana actions for creature mana abilities', () => {
      const state = createTestState({ priorityPlayerIndex: 0 });

      addCard(state, 'sage1', 'p1', 'battlefield', {
        name: 'Somberwald Sage',
        type_line: 'Creature — Human Druid',
        oracle_text: '{T}: Add three mana of any one color. Spend this mana only to cast creature spells.',
        card_types: ['creature'],
      });
      state.cards.get('sage1')!.summoningSick = false;

      const actions = getLegalActions(state, 'p1');
      const manaActions = actions.filter(a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === 'sage1');

      expect(manaActions).toHaveLength(5);
      expect(manaActions.map(a => a.kind === 'ActivateManaAbility' ? a.color : null).sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    });

    it('does not generate tap mana actions for summoning-sick creatures', () => {
      const state = createTestState({ priorityPlayerIndex: 0 });

      addCard(state, 'sage1', 'p1', 'battlefield', {
        name: 'Somberwald Sage',
        type_line: 'Creature - Human Druid',
        oracle_text: '{T}: Add three mana of any one color. Spend this mana only to cast creature spells.',
        card_types: ['creature'],
      });

      const actions = getLegalActions(state, 'p1');
      const manaActions = actions.filter(a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === 'sage1');

      expect(manaActions).toHaveLength(0);
    });

    it('allows tap mana actions for summoning-sick creatures with haste', () => {
      const state = createTestState({ priorityPlayerIndex: 0 });

      addCard(state, 'druid1', 'p1', 'battlefield', {
        name: 'Hasty Mana Druid',
        type_line: 'Creature - Elf Druid',
        oracle_text: 'Haste\n{T}: Add {G}.',
        keywords: ['Haste'],
        card_types: ['creature'],
      });

      const actions = getLegalActions(state, 'p1');
      const manaActions = actions.filter(a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === 'druid1');

      expect(manaActions).toEqual([{
        kind: 'ActivateManaAbility',
        cardInstanceId: 'druid1',
        color: 'G',
      }]);
    });

    it('generates hand-exile mana actions for Elvish Spirit Guide', () => {
      const state = createTestState({ priorityPlayerIndex: 0 });

      addCard(state, 'guide1', 'p1', 'hand', {
        name: 'Elvish Spirit Guide',
        type_line: 'Creature - Elf Spirit',
        oracle_text: 'Exile Elvish Spirit Guide from your hand: Add {G}.',
        mana_cost: '{2}{G}',
        cmc: 3,
        colors: ['G'],
        color_identity: ['G'],
        card_types: ['creature'],
      });

      const actions = getLegalActions(state, 'p1');
      const manaActions = actions.filter(a => a.kind === 'ActivateManaAbility' && a.cardInstanceId === 'guide1');

      expect(manaActions).toEqual([{
        kind: 'ActivateManaAbility',
        cardInstanceId: 'guide1',
        color: 'G',
      }]);
    });
  });

  describe('DeclareAttackers actions', () => {
    it('generates attacker actions during declare attackers step', () => {
      const state = createTestState({
        activePlayerIndex: 0,
        priorityPlayerIndex: 0,
        phase: 'combat',
        step: 'declare_attackers',
      });

      addCard(state, 'creature1', 'p1', 'battlefield', {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        card_types: ['creature'],
        keywords: [],
        power: 2,
        toughness: 2,
      });
      // Remove summoning sickness
      state.cards.get('creature1')!.summoningSick = false;

      const actions = getLegalActions(state, 'p1');

      // Should have: no attack, attack p2 with creature1
      expect(actions.some(a => a.kind === 'DeclareAttackers' && a.attacks.length === 0)).toBe(true);
      expect(actions.some(a =>
        a.kind === 'DeclareAttackers' &&
        a.attacks.length === 1 &&
        a.attacks[0].cardInstanceId === 'creature1' &&
        a.attacks[0].defendingPlayerId === 'p2'
      )).toBe(true);
    });

    it('does not include tapped creatures as attackers', () => {
      const state = createTestState({
        activePlayerIndex: 0,
        priorityPlayerIndex: 0,
        phase: 'combat',
        step: 'declare_attackers',
      });

      addCard(state, 'creature1', 'p1', 'battlefield', {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      });
      state.cards.get('creature1')!.summoningSick = false;
      state.cards.get('creature1')!.tapped = true;

      const actions = getLegalActions(state, 'p1');

      // Should only have "attack with nothing"
      const attackActions = actions.filter(a => a.kind === 'DeclareAttackers');
      expect(attackActions).toHaveLength(1);
      expect(attackActions[0]).toEqual({ kind: 'DeclareAttackers', attacks: [] });
    });

    it('does not offer no-attack or optional-only attacks when a creature must attack if able', () => {
      const state = createTestState({
        activePlayerIndex: 0,
        priorityPlayerIndex: 0,
        phase: 'combat',
        step: 'declare_attackers',
      });

      addCard(state, 'required1', 'p1', 'battlefield', {
        name: 'Reckless Raider',
        type_line: 'Creature - Goblin Warrior',
        oracle_text: 'Reckless Raider attacks each combat if able.',
        card_types: ['creature'],
        power: 2,
        toughness: 1,
      });
      addCard(state, 'optional1', 'p1', 'battlefield', {
        name: 'Grizzly Bears',
        type_line: 'Creature - Bear',
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      });
      state.cards.get('required1')!.summoningSick = false;
      state.cards.get('optional1')!.summoningSick = false;

      const attackActions = getLegalActions(state, 'p1').filter(a => a.kind === 'DeclareAttackers');

      expect(attackActions.some(action => action.attacks.length === 0)).toBe(false);
      expect(attackActions.some(action =>
        action.attacks.length === 1 && action.attacks[0].cardInstanceId === 'optional1'
      )).toBe(false);
      expect(attackActions.some(action =>
        action.attacks.some(attack => attack.cardInstanceId === 'required1')
      )).toBe(true);
    });

    it('only offers attacks the player can pay through Propaganda-style taxes', () => {
      const state = createTestState({
        activePlayerIndex: 0,
        priorityPlayerIndex: 0,
        phase: 'combat',
        step: 'declare_attackers',
      });

      addCard(state, 'creature1', 'p1', 'battlefield', {
        name: 'Grizzly Bears',
        type_line: 'Creature - Bear',
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      });
      addCard(state, 'creature2', 'p1', 'battlefield', {
        name: 'Runeclaw Bear',
        type_line: 'Creature - Bear',
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      });
      addCard(state, 'propaganda', 'p2', 'battlefield', {
        name: 'Propaganda',
        type_line: 'Enchantment',
        oracle_text: "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.",
        card_types: ['enchantment'],
      });
      state.cards.get('creature1')!.summoningSick = false;
      state.cards.get('creature2')!.summoningSick = false;
      state.players[0].manaPool = { ...emptyManaPool, C: 2 };

      const attackActions = getLegalActions(state, 'p1').filter(a => a.kind === 'DeclareAttackers');

      expect(attackActions.some(action => action.attacks.length === 0)).toBe(true);
      expect(attackActions.some(action => action.attacks.length === 1)).toBe(true);
      expect(attackActions.some(action => action.attacks.length === 2)).toBe(false);
    });
  });

  describe('DeclareBlockers actions', () => {
    it('generates blocker actions during declare blockers step', () => {
      const state = createTestState({
        activePlayerIndex: 0,
        priorityPlayerIndex: 1,
        phase: 'combat',
        step: 'declare_blockers',
        combat: {
          attackers: [{ cardInstanceId: 'attacker1', defendingPlayerId: 'p2' }],
          blockers: [],
          damageAssignment: new Map(),
        },
      });

      // Add attacker (owned by p1)
      addCard(state, 'attacker1', 'p1', 'battlefield', {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        card_types: ['creature'],
        keywords: [],
        power: 2,
        toughness: 2,
      });

      // Add potential blocker (owned by p2)
      addCard(state, 'blocker1', 'p2', 'battlefield', {
        name: 'Wall of Stone',
        type_line: 'Creature — Wall',
        card_types: ['creature'],
        keywords: [],
        power: 0,
        toughness: 4,
      });
      state.cards.get('blocker1')!.tapped = false;

      const actions = getLegalActions(state, 'p2');

      // Should have: no blocks, block attacker with blocker
      expect(actions.some(a => a.kind === 'DeclareBlockers' && a.blocks.length === 0)).toBe(true);
      expect(actions.some(a =>
        a.kind === 'DeclareBlockers' &&
        a.blocks.length === 1 &&
        a.blocks[0].cardInstanceId === 'blocker1' &&
        a.blocks[0].blockingAttackerId === 'attacker1'
      )).toBe(true);
    });
  });
  });

  describe('ActivateAbility actions', () => {
    it('generates bounded target combinations for activated abilities with multiple targets', () => {
      const state = createTestState({
        priorityPlayerIndex: 0,
        activePlayerIndex: 0,
        phase: 'precombat_main',
      });

      addCard(state, 'fight_device', 'p1', 'battlefield', {
        name: 'Fight Device',
        type_line: 'Artifact',
        oracle_text: "{T}: Target creature you control fights target creature you don't control.",
        card_types: ['artifact'],
      });
      addCard(state, 'friendly_bear', 'p1', 'battlefield', {
        name: 'Friendly Bear',
        type_line: 'Creature - Bear',
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      });
      addCard(state, 'enemy_bear', 'p2', 'battlefield', {
        name: 'Enemy Bear',
        type_line: 'Creature - Bear',
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      });

      const actions = getLegalActions(state, 'p1')
        .filter((action): action is import('./types').ActivateAbilityAction =>
          action.kind === 'ActivateAbility' && action.cardInstanceId === 'fight_device',
        );

      expect(actions).toContainEqual({
        kind: 'ActivateAbility',
        cardInstanceId: 'fight_device',
        abilityIndex: 0,
        targets: ['friendly_bear', 'enemy_bear'],
      });
      expect(actions).not.toContainEqual({
        kind: 'ActivateAbility',
        cardInstanceId: 'fight_device',
        abilityIndex: 0,
        targets: ['enemy_bear', 'friendly_bear'],
      });
    });
  });

  describe('getSpellTargetSpecs', () => {
  it('returns empty array for spells without targets', () => {
    const state = createTestState();

    addCard(state, 'card1', 'p1', 'hand', {
      name: 'Grizzly Bears',
      oracle_text: '',
      card_types: ['creature'],
    });

    const card = state.cards.get('card1')!;
    const specs = getSpellTargetSpecs(state, card);

    expect(specs).toEqual([]);
  });
});

describe('getLegalTargets', () => {
  it('returns players for Player target type', () => {
    const state = createTestState();

    const targets = getLegalTargets(state, 'p1', {
      id: 'target1',
      type: 'Player',
      count: 1,
    });

    expect(targets).toContain('p1');
    expect(targets).toContain('p2');
  });

  it('returns creatures for Creature target type', () => {
    const state = createTestState();

    addCard(state, 'creature1', 'p1', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
    });
    addCard(state, 'creature2', 'p2', 'battlefield', {
      name: 'Lion',
      card_types: ['creature'],
    });

    const targets = getLegalTargets(state, 'p1', {
      id: 'target1',
      type: 'Creature',
      count: 1,
    });

    expect(targets).toContain('creature1');
    expect(targets).toContain('creature2');
  });

  it('filters by opponentControls constraint', () => {
    const state = createTestState();

    addCard(state, 'creature1', 'p1', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
    });
    addCard(state, 'creature2', 'p2', 'battlefield', {
      name: 'Lion',
      card_types: ['creature'],
    });

    const targets = getLegalTargets(state, 'p1', {
      id: 'target1',
      type: 'Creature',
      count: 1,
      constraints: { opponentControls: true },
    });

    expect(targets).not.toContain('creature1');
    expect(targets).toContain('creature2');
  });

  it('excludes creatures not on battlefield', () => {
    const state = createTestState();

    addCard(state, 'creature1', 'p1', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
    });
    addCard(state, 'creature2', 'p1', 'graveyard', {
      name: 'Dead Bear',
      card_types: ['creature'],
    });

    const targets = getLegalTargets(state, 'p1', {
      id: 'target1',
      type: 'Creature',
      count: 1,
    });

    expect(targets).toContain('creature1');
    expect(targets).not.toContain('creature2');
  });

  it('returns only lands on the battlefield for Land target type', () => {
    const state = createTestState();

    addCard(state, 'forest', 'p1', 'battlefield', {
      name: 'Forest',
      type_line: 'Basic Land - Forest',
      card_types: ['land'],
    });
    addCard(state, 'sol-ring', 'p1', 'battlefield', {
      name: 'Sol Ring',
      type_line: 'Artifact',
      card_types: ['artifact'],
    });
    addCard(state, 'land-in-hand', 'p1', 'hand', {
      name: 'Island',
      type_line: 'Basic Land - Island',
      card_types: ['land'],
    });

    const targets = getLegalTargets(state, 'p1', {
      id: 'target1',
      type: 'Land',
      count: 1,
    });

    expect(targets).toEqual(['forest']);
  });

  it('returns any card from an opponent graveyard for graveyard-card target type', () => {
    const state = createTestState();

    addCard(state, 'own-dead', 'p1', 'graveyard', {
      name: 'Own Dead Bear',
      card_types: ['creature'],
    });
    addCard(state, 'opponent-dead-artifact', 'p2', 'graveyard', {
      name: 'Dead Relic',
      type_line: 'Artifact',
      card_types: ['artifact'],
    });

    const targets = getLegalTargets(state, 'p1', {
      id: 'target1',
      type: 'CardInGraveyard',
      count: 1,
      constraints: { opponentControls: true },
    });

    expect(targets).toEqual(['opponent-dead-artifact']);
  });

  it('returns creature or enchantment cards from graveyards for recursion target type', () => {
    const state = createTestState();

    addCard(state, 'dead-creature', 'p1', 'graveyard', {
      name: 'Dead Bear',
      card_types: ['creature'],
    });
    addCard(state, 'dead-enchantment', 'p1', 'graveyard', {
      name: 'Dead Aura',
      type_line: 'Enchantment',
      card_types: ['enchantment'],
    });
    addCard(state, 'dead-artifact', 'p1', 'graveyard', {
      name: 'Dead Relic',
      type_line: 'Artifact',
      card_types: ['artifact'],
    });

    const targets = getLegalTargets(state, 'p1', {
      id: 'target1',
      type: 'CreatureOrEnchantmentCardInGraveyard',
      count: 1,
    });

    expect(targets).toContain('dead-creature');
    expect(targets).toContain('dead-enchantment');
    expect(targets).not.toContain('dead-artifact');
  });

  it('returns spells on the stack for Spell target type', () => {
    const state = createTestState();

    addCard(state, 'spell1', 'p2', 'hand', {
      name: 'Lightning Bolt',
      type_line: 'Instant',
      card_types: ['instant'],
    });
    state.stack = [{
      kind: 'Spell',
      id: 'stack_1',
      cardInstanceId: 'spell1',
      casterId: 'p2',
      targets: [],
    }];

    const targets = getLegalTargets(state, 'p1', {
      id: 'target1',
      type: 'Spell',
      count: 1,
    });

    expect(targets).toEqual(['spell1']);
  });

  it('returns only creature spells for CreatureSpell target type', () => {
    const state = createTestState();

    addCard(state, 'creature-spell', 'p2', 'hand', {
      name: 'Grizzly Bears',
      type_line: 'Creature - Bear',
      card_types: ['creature'],
    });
    addCard(state, 'instant-spell', 'p2', 'hand', {
      name: 'Lightning Bolt',
      type_line: 'Instant',
      card_types: ['instant'],
    });
    state.stack = [
      { kind: 'Spell', id: 'stack_creature', cardInstanceId: 'creature-spell', casterId: 'p2', targets: [] },
      { kind: 'Spell', id: 'stack_instant', cardInstanceId: 'instant-spell', casterId: 'p2', targets: [] },
    ];

    const targets = getLegalTargets(state, 'p1', {
      id: 'target1',
      type: 'CreatureSpell',
      count: 1,
    });

    expect(targets).toEqual(['creature-spell']);
  });

  it('excludes creatures with blocked colors from legal targets', () => {
    const state = createTestState();

    addCard(state, 'black-creature', 'p2', 'battlefield', {
      name: 'Black Creature',
      type_line: 'Creature - Zombie',
      card_types: ['creature'],
      colors: ['B'],
    });
    addCard(state, 'green-creature', 'p2', 'battlefield', {
      name: 'Green Creature',
      type_line: 'Creature - Bear',
      card_types: ['creature'],
      colors: ['G'],
    });

    const targets = getLegalTargets(state, 'p1', {
      id: 'target1',
      type: 'Creature',
      count: 1,
      constraints: { notColors: ['B'] },
    });

    expect(targets).toEqual(['green-creature']);
  });

  it('excludes protection-matching targets when a source is provided', () => {
    const state = createTestState();

    addCard(state, 'red-spell', 'p1', 'hand', {
      name: 'Red Removal',
      type_line: 'Instant',
      oracle_text: 'Destroy target creature.',
      card_types: ['instant'],
      colors: ['R'],
    });
    addCard(state, 'protected-creature', 'p2', 'battlefield', {
      name: 'Silver Knight',
      type_line: 'Creature - Human Knight',
      oracle_text: 'Protection from red',
      card_types: ['creature'],
      colors: ['W'],
      power: 2,
      toughness: 2,
    });
    addCard(state, 'normal-creature', 'p2', 'battlefield', {
      name: 'Bear',
      type_line: 'Creature - Bear',
      card_types: ['creature'],
      colors: ['G'],
      power: 2,
      toughness: 2,
    });

    const targets = getLegalTargets(state, 'p1', {
      id: 'target1',
      type: 'Creature',
      count: 1,
    }, 'red-spell');

    expect(targets).toEqual(['normal-creature']);
  });
});

describe('Modal spell actions', () => {
  it('generates separate CastSpell actions with chosenModes for targetless modal spell', () => {
    const state = createTestState({
      priorityPlayerIndex: 0,
      activePlayerIndex: 0,
      phase: 'precombat_main',
    });

    // Give player enough mana
    state.players[0].manaPool = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 };

    addCard(state, 'modal1', 'p1', 'hand', {
      name: 'Modal Charm',
      type_line: 'Instant',
      oracle_text: 'Choose one — • Draw a card. • Gain 3 life.',
      mana_cost: '{1}{U}',
      cmc: 2,
      card_types: ['instant'],
    });

    const actions = getLegalActions(state, 'p1');
    const castActions = actions.filter(
      (a): a is import('./types').CastSpellAction => a.kind === 'CastSpell'
    );

    // Should have two CastSpell actions, one per mode
    expect(castActions).toHaveLength(2);

    // Mode 0: Draw a card
    const mode0 = castActions.find(a => a.chosenModes?.[0] === 0);
    expect(mode0).toBeDefined();
    expect(mode0!.cardInstanceId).toBe('modal1');
    expect(mode0!.targets).toEqual([]);
    expect(mode0!.chosenModes).toEqual([0]);

    // Mode 1: Gain 3 life
    const mode1 = castActions.find(a => a.chosenModes?.[0] === 1);
    expect(mode1).toBeDefined();
    expect(mode1!.cardInstanceId).toBe('modal1');
    expect(mode1!.targets).toEqual([]);
    expect(mode1!.chosenModes).toEqual([1]);
  });

  it('generates CastSpell actions with targets AND chosenModes for targeted modal spell', () => {
    const state = createTestState({
      priorityPlayerIndex: 0,
      activePlayerIndex: 0,
      phase: 'precombat_main',
    });

    // Give player enough mana
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 2, G: 0, C: 0 };

    addCard(state, 'modal2', 'p1', 'hand', {
      name: 'Targeted Charm',
      type_line: 'Instant',
      oracle_text: 'Choose one — • Destroy target creature. • Draw a card.',
      mana_cost: '{1}{R}',
      cmc: 2,
      card_types: ['instant'],
    });

    // Add an opponent's creature as a valid target
    addCard(state, 'opp-creature1', 'p2', 'battlefield', {
      name: 'Enemy Bear',
      type_line: 'Creature — Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    // Also add own creature so there's more than one target
    addCard(state, 'own-creature1', 'p1', 'battlefield', {
      name: 'Friendly Bear',
      type_line: 'Creature — Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    const actions = getLegalActions(state, 'p1');
    const castActions = actions.filter(
      (a): a is import('./types').CastSpellAction => a.kind === 'CastSpell'
    );

    // Mode 0 (Destroy target creature): one action per legal target
    const mode0Actions = castActions.filter(a => a.chosenModes?.[0] === 0);
    expect(mode0Actions.length).toBeGreaterThanOrEqual(1);
    // Each mode 0 action should have exactly one target
    for (const action of mode0Actions) {
      expect(action.targets).toHaveLength(1);
      expect(action.chosenModes).toEqual([0]);
    }
    // Should include opponent creature as a target
    expect(mode0Actions.some(a => a.targets[0] === 'opp-creature1')).toBe(true);

    // Mode 1 (Draw a card): one targetless action
    const mode1Actions = castActions.filter(a => a.chosenModes?.[0] === 1);
    expect(mode1Actions).toHaveLength(1);
    expect(mode1Actions[0].targets).toEqual([]);
    expect(mode1Actions[0].chosenModes).toEqual([1]);
  });

  it('does not add chosenModes to non-modal spells', () => {
    const state = createTestState({
      priorityPlayerIndex: 0,
      activePlayerIndex: 0,
      phase: 'precombat_main',
    });

    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 };

    addCard(state, 'bear1', 'p1', 'hand', {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      mana_cost: '{1}{G}',
      cmc: 2,
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    const actions = getLegalActions(state, 'p1');
    const castActions = actions.filter(
      (a): a is import('./types').CastSpellAction => a.kind === 'CastSpell'
    );

    expect(castActions).toHaveLength(1);
    expect(castActions[0].cardInstanceId).toBe('bear1');
    expect(castActions[0].chosenModes).toBeUndefined();
  });

  it('generates CastSpell actions with chosenModes for modal spell in command zone', () => {
    const state = createTestState({
      priorityPlayerIndex: 0,
      activePlayerIndex: 0,
      phase: 'precombat_main',
    });

    state.players[0].manaPool = { W: 0, U: 3, B: 0, R: 0, G: 0, C: 0 };

    addCard(state, 'commander1', 'p1', 'command', {
      name: 'Modal Commander',
      type_line: 'Legendary Creature — Wizard',
      oracle_text: 'Choose one — • Draw a card. • Gain 3 life.',
      mana_cost: '{2}{U}',
      cmc: 3,
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });
    // Mark as commander
    state.cards.get('commander1')!.isCommander = true;
    state.players[0].commanderInstanceId = 'commander1';

    const actions = getLegalActions(state, 'p1');
    const castActions = actions.filter(
      (a): a is import('./types').CastSpellAction => a.kind === 'CastSpell'
    );

    expect(castActions).toHaveLength(2);
    expect(castActions.some(a => a.chosenModes?.length === 1 && a.chosenModes[0] === 0)).toBe(true);
    expect(castActions.some(a => a.chosenModes?.length === 1 && a.chosenModes[0] === 1)).toBe(true);
  });

  it('generates paired modes for "Choose two" spells', () => {
    const state = createTestState({
      priorityPlayerIndex: 0,
      activePlayerIndex: 0,
      phase: 'precombat_main',
    });

    state.players[0].manaPool = { W: 0, U: 3, B: 0, R: 0, G: 0, C: 0 };

    addCard(state, 'modal3', 'p1', 'hand', {
      name: 'Choose Two Charm',
      type_line: 'Instant',
      oracle_text: 'Choose two — • Draw a card. • Gain 3 life. • Scry 2.',
      mana_cost: '{2}{U}',
      cmc: 3,
      card_types: ['instant'],
    });

    const actions = getLegalActions(state, 'p1');
    const castActions = actions.filter(
      (a): a is import('./types').CastSpellAction => a.kind === 'CastSpell'
    );

    // With 3 targetless choices, should have C(3,2) = 3 combinations
    expect(castActions).toHaveLength(3);

    // Each action should have exactly 2 chosen modes
    for (const action of castActions) {
      expect(action.chosenModes).toHaveLength(2);
    }

    // Verify the combinations are [0,1], [0,2], [1,2]
    const modeSets = castActions.map(a => a.chosenModes!).sort((a, b) => {
      if (a[0] !== b[0]) return a[0] - b[0];
      return a[1] - b[1];
    });
    expect(modeSets).toEqual([[0, 1], [0, 2], [1, 2]]);
  });

  it('generates every non-empty mode set for "Choose one or more" spells', () => {
    const state = createTestState({
      priorityPlayerIndex: 0,
      activePlayerIndex: 0,
      phase: 'precombat_main',
    });

    state.players[0].manaPool = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 4 };

    addCard(state, 'farewell', 'p1', 'hand', {
      name: 'Farewell',
      type_line: 'Sorcery',
      oracle_text: 'Choose one or more - \u2022 Exile all artifacts. \u2022 Exile all creatures. \u2022 Exile all enchantments. \u2022 Exile all graveyards.',
      mana_cost: '{4}{W}{W}',
      cmc: 6,
      colors: ['W'],
      color_identity: ['W'],
      card_types: ['sorcery'],
    });

    const castActions = getLegalActions(state, 'p1')
      .filter((action): action is import('./types').CastSpellAction =>
        action.kind === 'CastSpell' && action.cardInstanceId === 'farewell',
      );

    expect(castActions).toHaveLength(15);
    expect(castActions.some(action => JSON.stringify(action.chosenModes) === JSON.stringify([0]))).toBe(true);
    expect(castActions.some(action => JSON.stringify(action.chosenModes) === JSON.stringify([0, 1, 2, 3]))).toBe(true);
  });

  it('generates paired modes for "Choose two" spells when one selected mode needs a target', () => {
    const state = createTestState({
      priorityPlayerIndex: 0,
      activePlayerIndex: 0,
      phase: 'precombat_main',
    });

    state.players[0].manaPool = { W: 0, U: 1, B: 0, R: 1, G: 0, C: 1 };

    addCard(state, 'targeted_modal', 'p1', 'hand', {
      name: 'Targeted Command',
      type_line: 'Instant',
      oracle_text: 'Choose two - • Targeted Command deals 2 damage to any target. • Draw two cards. • Create a Treasure token.',
      mana_cost: '{1}{U}{R}',
      cmc: 3,
      colors: ['U', 'R'],
      color_identity: ['U', 'R'],
      card_types: ['instant'],
    });
    addCard(state, 'enemy_bear', 'p2', 'battlefield', {
      name: 'Enemy Bear',
      type_line: 'Creature - Bear',
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    });

    const castActions = getLegalActions(state, 'p1')
      .filter((action): action is import('./types').CastSpellAction =>
        action.kind === 'CastSpell' && action.cardInstanceId === 'targeted_modal',
      );

    expect(castActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        chosenModes: [0, 1],
        targets: ['enemy_bear'],
      }),
      expect.objectContaining({
        chosenModes: [0, 2],
        targets: ['enemy_bear'],
      }),
      expect.objectContaining({
        chosenModes: [1, 2],
        targets: [],
      }),
    ]));
  });

  it('returns modal target specs for the exact selected modes', () => {
    const state = createTestState();
    addCard(state, 'targeted_modal', 'p1', 'hand', {
      name: 'Targeted Command',
      type_line: 'Instant',
      oracle_text: 'Choose two - \u2022 Counter target spell. \u2022 Draw two cards. \u2022 You gain 3 life.',
      mana_cost: '{1}{U}{R}',
      cmc: 3,
      colors: ['U', 'R'],
      color_identity: ['U', 'R'],
      card_types: ['instant'],
    });

    const card = state.cards.get('targeted_modal')!;
    expect(getSpellTargetSpecs(state, card, { chosenModes: [0, 1] })).toEqual([
      expect.objectContaining({ type: 'Spell', count: 1 }),
    ]);
    expect(getSpellTargetSpecs(state, card, { chosenModes: [1, 2] })).toEqual([]);
    expect(getSpellTargetSpecs(state, card)).toEqual([]);
  });
});
