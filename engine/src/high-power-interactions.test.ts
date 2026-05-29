import { describe, expect, it } from 'vitest';
import type { CardDefinition, CardInstance, GameState, ManaPool, Zone } from './types';
import { createPlayer, emptyManaPool } from './types';
import { initGameState, getCardsInZone } from './game-state';
import { canCastSpell, castSpell, putTriggersOnStack, registerBattlefieldAbilities } from './stack';
import { tryCastSpell } from './actions-public';
import { executeEffects } from './effects/executor';
import { parseOracleText } from './effects/parser';
import { getOverride } from './effects/overrides';

function card(
  id: string,
  name: string,
  typeLine: string,
  manaCost: string,
  cardTypes: CardDefinition['card_types'],
  oracleText = '',
): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: oracleText,
    mana_cost: manaCost,
    cmc: (manaCost.match(/\{[^}]+\}/g) || []).length,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: cardTypes,
    power: cardTypes.includes('creature') ? 2 : undefined,
    toughness: cardTypes.includes('creature') ? 2 : undefined,
  };
}

function commander(id: string, name: string, manaCost = '{1}{W}{B}'): CardDefinition {
  return {
    ...card(id, name, 'Legendary Creature - Human Cleric', manaCost, ['creature']),
    colors: ['W', 'B'],
    color_identity: ['W', 'B'],
    power: 2,
    toughness: 2,
  };
}

function drannith(): CardDefinition {
  return {
    ...card(
      'drannith-magistrate',
      'Drannith Magistrate',
      'Creature - Human Wizard',
      '{1}{W}',
      ['creature'],
      "Your opponents can't cast spells from anywhere other than their hands.",
    ),
    colors: ['W'],
    color_identity: ['W'],
    power: 1,
    toughness: 3,
  };
}

function setPlayerMana(state: GameState, playerId: string, mana: Partial<ManaPool>): GameState {
  return {
    ...state,
    players: state.players.map(player =>
      player.id === playerId
        ? { ...player, manaPool: { ...emptyManaPool(), ...mana } }
        : player,
    ),
  };
}

function setTurn(state: GameState, playerId: string): GameState {
  const index = state.players.findIndex(player => player.id === playerId);
  return {
    ...state,
    activePlayerIndex: index,
    priorityPlayerIndex: index,
    phase: 'precombat_main',
    step: 'upkeep',
    hasPriorityPassed: state.players.map(() => false),
  };
}

function moveFirstCardNamed(state: GameState, name: string, zone: Zone): GameState {
  const entry = [...state.cards.entries()].find(([, instance]) => {
    const def = state.cardDefinitions.get(instance.definitionId);
    return def?.name === name;
  });
  if (!entry) throw new Error(`Could not find ${name}`);
  const [id, instance] = entry;
  const cards = new Map(state.cards);
  cards.set(id, {
    ...instance,
    zone,
    summoningSick: zone === 'battlefield',
  });
  return { ...state, cards };
}

function registerNamedPermanent(state: GameState, name: string): GameState {
  const instance = [...state.cards.values()].find(cardInstance =>
    state.cardDefinitions.get(cardInstance.definitionId)?.name === name &&
    cardInstance.zone === 'battlefield'
  );
  if (!instance) throw new Error(`Could not find battlefield ${name}`);
  return registerBattlefieldAbilities(state, instance.instanceId);
}

function makePermanentInstance(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: Zone = 'battlefield',
  isToken = false,
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
    isToken,
  };
}

function addDefinitionAndPermanent(
  state: GameState,
  def: CardDefinition,
  ownerId: string,
  instanceId: string,
  isToken = false,
): GameState {
  const defs = new Map(state.cardDefinitions);
  defs.set(def.id, def);
  const cards = new Map(state.cards);
  cards.set(instanceId, makePermanentInstance(instanceId, def.id, ownerId, 'battlefield', isToken));
  return { ...state, cardDefinitions: defs, cards };
}

describe('high-power commander legality', () => {
  it('Drannith Magistrate blocks an opponent casting a commander from the command zone without charging tax', () => {
    let state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [commander('tymna', 'Tymna the Weaver')], commanderId: 'tymna' },
      { playerId: 'p2', name: 'Bob', cards: [commander('kraum', "Kraum, Ludevic's Opus"), drannith()], commanderId: 'kraum' },
    ]);
    state = moveFirstCardNamed(state, 'Drannith Magistrate', 'battlefield');
    state = setTurn(state, 'p1');
    state = setPlayerMana(state, 'p1', { W: 1, B: 1, C: 5 });

    const tymna = getCardsInZone(state, 'p1', 'command')[0];
    state = {
      ...state,
      players: state.players.map(player =>
        player.id === 'p1'
          ? {
              ...player,
              commanderCastCount: 1,
              commanderCastCounts: { [tymna.instanceId]: 1 },
            }
          : player,
      ),
    };

    expect(canCastSpell(state, 'p1', tymna.instanceId)).toBe(false);

    const result = tryCastSpell(
      state,
      'p1',
      tymna.instanceId,
      [],
      { ...emptyManaPool(), generic: 3, W: 1, B: 1 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('cast_restricted');
    expect(state.cards.get(tymna.instanceId)?.zone).toBe('command');
    expect(state.players[0].commanderCastCounts?.[tymna.instanceId]).toBe(1);
  });

  it('Drannith Magistrate does not restrict its controller from casting their own commander', () => {
    let state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [commander('tymna', 'Tymna the Weaver')], commanderId: 'tymna' },
      { playerId: 'p2', name: 'Bob', cards: [commander('kraum', "Kraum, Ludevic's Opus"), drannith()], commanderId: 'kraum' },
    ]);
    state = moveFirstCardNamed(state, 'Drannith Magistrate', 'battlefield');
    state = setTurn(state, 'p2');
    state = setPlayerMana(state, 'p2', { W: 1, B: 1, C: 3 });

    const kraum = getCardsInZone(state, 'p2', 'command')[0];

    expect(canCastSpell(state, 'p2', kraum.instanceId)).toBe(true);
  });

  it('commander tax is checked before a public cast returns success', () => {
    let state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [commander('tymna', 'Tymna the Weaver')], commanderId: 'tymna' },
      { playerId: 'p2', name: 'Bob', cards: [commander('kraum', "Kraum, Ludevic's Opus")], commanderId: 'kraum' },
    ]);
    state = setTurn(state, 'p1');
    const tymna = getCardsInZone(state, 'p1', 'command')[0];
    state = {
      ...setPlayerMana(state, 'p1', { W: 1, B: 1, C: 1 }),
      players: state.players.map(player =>
        player.id === 'p1'
          ? {
              ...player,
              manaPool: { ...emptyManaPool(), W: 1, B: 1, C: 1 },
              commanderCastCounts: { [tymna.instanceId]: 1 },
            }
          : player,
      ),
    };

    const result = tryCastSpell(
      state,
      'p1',
      tymna.instanceId,
      [],
      { ...emptyManaPool(), generic: 1, W: 1, B: 1 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('insufficient_mana');
    expect(state.players[0].commanderCastCounts?.[tymna.instanceId]).toBe(1);
  });
});

describe('artifact token and Dockside-style counting', () => {
  it('parses Treasure/Clue/Food/Blood/Map as artifact tokens with subtypes', () => {
    const parsed = parseOracleText('Create a Treasure token.');

    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects[0].kind).toBe('CreateToken');
    if (parsed.effects[0].kind !== 'CreateToken') return;
    expect(parsed.effects[0].token.types).toEqual(['artifact']);
    expect(parsed.effects[0].token.subtypes).toEqual(['Treasure']);
  });

  it('Dockside override counts opponent artifact tokens as artifacts and creates the right number of Treasures', () => {
    const override = getOverride('dockside-extortionist', 'Dockside Extortionist');
    expect(override?.kind).toBe('ETB');
    if (!override || override.kind !== 'ETB') return;

    let state: GameState = {
      players: [createPlayer('human', 'Human'), createPlayer('opponent', 'Opponent')],
      cards: new Map(),
      cardDefinitions: new Map(),
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: 'precombat_main',
      step: 'upkeep',
      turnNumber: 1,
      hasPriorityPassed: [false, false],
      stack: [],
      combat: null,
      battlefieldAbilities: new Map(),
      pendingTriggers: [],
    };

    const rock = card('mana-rock', 'Mana Rock', 'Artifact', '{2}', ['artifact']);
    const clue = card('clue-token', 'Clue', 'Token Artifact - Clue', '', ['artifact']);
    const food = card('food-token', 'Food', 'Token Artifact - Food', '', ['artifact']);
    const map = card('map-token', 'Map', 'Token Artifact - Map', '', ['artifact']);

    for (let i = 0; i < 4; i++) {
      state = addDefinitionAndPermanent(state, rock, 'opponent', `rock-${i}`);
    }
    for (let i = 0; i < 3; i++) {
      state = addDefinitionAndPermanent(state, clue, 'opponent', `clue-${i}`, true);
    }
    for (let i = 0; i < 2; i++) {
      state = addDefinitionAndPermanent(state, food, 'opponent', `food-${i}`, true);
    }
    state = addDefinitionAndPermanent(state, map, 'opponent', 'map-0', true);

    const next = executeEffects(state, override.ability.effects, 'human', [], []);
    const treasures = [...next.cards.values()].filter(instance => {
      const def = next.cardDefinitions.get(instance.definitionId);
      return instance.ownerId === 'human' && instance.zone === 'battlefield' && def?.name === 'Treasure';
    });

    expect(treasures).toHaveLength(10);
    for (const treasure of treasures) {
      const def = next.cardDefinitions.get(treasure.definitionId)!;
      expect(def.card_types).toContain('artifact');
      expect(def.type_line.toLowerCase()).toContain('treasure');
    }
  });
});

describe('Rhystic-style trigger ordering', () => {
  it('keeps priority with the active player after APNAP trigger placement', () => {
    const rhystic = card(
      'rhystic',
      'Rhystic Study',
      'Enchantment',
      '{2}{U}',
      ['enchantment'],
      'Whenever an opponent casts a spell, draw a card.',
    );
    const remora = card(
      'remora',
      'Mystic Remora',
      'Enchantment',
      '{U}',
      ['enchantment'],
      'Whenever an opponent casts a spell, draw a card.',
    );
    const bear = card('bear', 'Grizzly Bears', 'Creature - Bear', '{1}{G}', ['creature']);

    let state = initGameState([
      { playerId: 'p1', name: 'Alice', cards: [commander('cmd1', 'Alice Commander'), rhystic], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [commander('cmd2', 'Bob Commander'), bear], commanderId: 'cmd2' },
      { playerId: 'p3', name: 'Carol', cards: [commander('cmd3', 'Carol Commander'), remora], commanderId: 'cmd3' },
    ]);
    state = moveFirstCardNamed(state, 'Rhystic Study', 'battlefield');
    state = registerNamedPermanent(state, 'Rhystic Study');
    state = moveFirstCardNamed(state, 'Mystic Remora', 'battlefield');
    state = registerNamedPermanent(state, 'Mystic Remora');
    state = setTurn(state, 'p2');
    state = setPlayerMana(state, 'p2', { G: 1, C: 1 });
    const bearInstance = [...state.cards.values()].find(instance =>
      state.cardDefinitions.get(instance.definitionId)?.name === 'Grizzly Bears'
    )!;
    state = {
      ...state,
      cards: new Map(state.cards).set(bearInstance.instanceId, { ...bearInstance, zone: 'hand' }),
    };

    state = castSpell(state, 'p2', bearInstance.instanceId);
    expect(state.pendingTriggers).toHaveLength(2);

    state = putTriggersOnStack(state);

    expect(state.priorityPlayerIndex).toBe(1);
    expect(state.players[state.priorityPlayerIndex].id).toBe('p2');
    expect(state.stack.map(item => item.kind === 'TriggeredAbility' ? item.controllerId : 'spell')).toEqual([
      'spell',
      'p3',
      'p1',
    ]);
  });
});
