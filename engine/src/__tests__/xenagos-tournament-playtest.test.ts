import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  convertCard,
  convertGeneratedDeck,
  createCardLookup,
  parseCardsJsonl,
  type CardLookup,
  type GeneratedDeck,
} from '../cards/deck-loader';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { getCardDefinition } from '../game-state';
import { passPriority } from '../priority';
import { tryActivateAbility, tryCastSpell, tryTapLandForMana } from '../actions-public';
import { resolveTopOfStack } from '../stack';
import { runAITurn } from '../ai/agent';
import { createPlayer, emptyManaPool, type CardDefinition, type CardInstance, type GameState, type Zone } from '../types';

const RAW_SUBMITTED_DECK = `
1x Allosaurus Shepherd (2X2)
1x Ancient Bronze Dragon (CLB)
1x Ancient Copper Dragon (FCA)
1x Anzrag, the Quake-Mole (MKM)
1x Arcane Signet (PIP)
1x Arid Mesa
1x Backdraft Hellkite (2X2)
1x Balefire Dragon (INR)
1x Beast Within
1x Birds of Paradise
1x Blacker Lotus (UGL)
1x Blasphemous Act (CMM)
1x Bloodstained Mire
1x Cavern of Souls (LCI)
1x Cavern-Hoard Dragon (LTC)
1x Chandra's Ignition (M3C)
1x Chaos Warp (40K)
1x Chrome Mox (SLC)
1x Deflecting Swat (C20)
1x Delighted Halfling (LTR)
1x Disciple of Freyalise (MH3)
1x Dracogenesis (TDM)
1x Dragon Broodmother (MYS1)
1x Dragonhawk, Fate's Tempest (BLB)
1x Dream Pillager (SCD)
1x Elvish Mystic (TSR)
1x Elvish Spirit Guide (MB2)
1x Exploration (DMR)
10x Forest
1x Fork
1x Fyndhorn Elves (CMR)
1x Gaea's Cradle
1x Gemstone Caverns (LTC)
1x Ghalta, Stampede Tyrant (LCI)
1x Goldspan Dragon (M3C)
1x Green Sun's Zenith
1x Harrow
1x Hellkite Charger (CMM)
1x Hellkite Tyrant (RVR)
1x Heroic Intervention (CMM)
1x Jeska's Will (MKC)
1x Jeweled Lotus (CMM)
1x Knollspine Dragon (LTC)
1x Kodama of the East Tree (CMR)
1x Last March of the Ents (LTR)
1x Leyline Tyrant (ZNR)
1x Lotus Petal (MYS1)
1x Mana Vault (UMA)
1x Misty Rainforest
8x Mountain
1x Mox Diamond (TPR)
1x Natural Order
1x Nature's Lore (CLB)
1x Neheb, the Eternal (CMM)
1x Nykthos, Shrine to Nyx (THS)
1x Nyxbloom Ancient (THB)
1x Old Gnawbone (AFR)
1x Prismatic Vista
1x Reliquary Tower (LCC)
1x Return of the Wildspeaker (CLB)
1x Reverberate
1x Rishkar's Expertise (LCC)
1x Sakura-Tribe Elder
1x Savage Ventmaw (FDN)
1x Scalding Tarn
1x Seething Song (C21)
1x Selvala, Heart of the Wilds
1x Shaman of Forgotten Ways
1x Simian Spirit Guide (MB2)
1x Sol Ring
1x Somberwald Sage (AVR)
1x Steel Hellkite (FDN)
1x Stomping Ground
1x Taiga
1x Terror of the Peaks (OTJ)
1x Three Visits (CLB)
1x Tibalt's Trickery (KHM)
1x Tooth and Nail
1x Traverse the Outlands
1x Twinflame Tyrant (FDN)
1x Verdant Catacombs
1x Windswept Heath
1x Wooded Foothills
1x Xenagos, God of Revels (CMR) *f-etch* *CMDR*
`;

let lookup: CardLookup;

function parseSubmittedDeck(): GeneratedDeck {
  const list: string[] = [];
  let commander = '';

  for (const line of RAW_SUBMITTED_DECK.trim().split('\n')) {
    const match = line.trim().match(/^(\d+)x\s+(.+)$/);
    if (!match) continue;
    const count = Number(match[1]);
    const isCommander = /\*CMDR\*/i.test(match[2]);
    const name = match[2]
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\s*\*[^*]+\*/g, '')
      .trim();

    if (isCommander) {
      commander = name;
      continue;
    }
    for (let i = 0; i < count; i++) list.push(name);
  }

  return {
    id: 'submitted-xenagos-dragons',
    commander,
    list,
    colors: ['R', 'G'],
    bracket: 5,
    theme: 'Gruul dragons tournament playtest',
  };
}

function getDef(name: string): CardDefinition {
  const card = lookup(name);
  if (!card) throw new Error(`Missing card fixture: ${name}`);
  return convertCard(card);
}

function makeFocusedState(): { state: GameState; ids: Record<string, string> } {
  const p1 = createPlayer('p1', 'Xenagos pilot', 40);
  const p2 = createPlayer('p2', 'Tournament opponent', 40);
  const state: GameState = {
    players: [p1, p2],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'draw',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
  const ids: Record<string, string> = {};

  const add = (
    label: string,
    name: string,
    zone: Zone,
    options: Partial<CardInstance> = {},
  ): string => {
    const def = getDef(name);
    state.cardDefinitions.set(def.id, def);
    const instanceId = `${label}-${state.cards.size + 1}`;
    const instance: CardInstance = {
      instanceId,
      definitionId: def.id,
      ownerId: options.ownerId || 'p1',
      zone,
      tapped: options.tapped ?? false,
      summoningSick: options.summoningSick ?? false,
      counters: options.counters ?? {},
      damage: options.damage ?? 0,
      isCommander: options.isCommander ?? false,
    };
    state.cards.set(instanceId, instance);
    ids[label] = instanceId;

    if (instance.isCommander) {
      p1.commanderInstanceId = instanceId;
      p1.commanderInstanceIds = [instanceId];
      p1.commanderCastCounts = { [instanceId]: 0 };
    }
    return instanceId;
  };

  add('xenagos', 'Xenagos, God of Revels', 'command', { isCommander: true });
  add('cradle', "Gaea's Cradle", 'battlefield');
  add('birds', 'Birds of Paradise', 'battlefield');
  add('mystic', 'Elvish Mystic', 'battlefield');
  add('allosaurs', 'Allosaurus Shepherd', 'battlefield');
  add('somberwald', 'Somberwald Sage', 'battlefield', { summoningSick: true });
  add('elvish-spirit-guide', 'Elvish Spirit Guide', 'hand');
  add('simian-spirit-guide', 'Simian Spirit Guide', 'hand');
  add('blacker-lotus', 'Blacker Lotus', 'battlefield');
  add('arid-mesa', 'Arid Mesa', 'battlefield');
  add('mountain', 'Mountain', 'library');

  return { state, ids };
}

function giveCastingMana(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p, index) => index === state.activePlayerIndex
      ? { ...p, manaPool: { W: 0, U: 0, B: 0, R: 10, G: 10, C: 10 } }
      : p),
  };
}

function resolveStackFully(state: GameState): GameState {
  let next = state;
  let guard = 0;
  while (next.stack.length > 0 && guard < 25) {
    for (let i = 0; i < next.players.length; i++) {
      next = passPriority(next);
    }
    if (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    guard++;
  }
  return next;
}

describe('submitted Xenagos tournament playtest', () => {
  beforeAll(() => {
    const cardsPath = new URL('../../../mtg_data/cards_min.jsonl', import.meta.url);
    lookup = createCardLookup(parseCardsJsonl(readFileSync(cardsPath, 'utf8')));
  });

  it('imports every submitted card name, including MDFC face names', () => {
    const deck = parseSubmittedDeck();
    const names = [deck.commander, ...new Set(deck.list)];
    const missing = names.filter(name => !lookup(name));

    expect(deck.commander).toBe('Xenagos, God of Revels');
    expect(deck.list).toHaveLength(99);
    expect(missing).toEqual([]);

    const converted = convertGeneratedDeck(deck, lookup);
    expect(converted.commander?.name).toBe('Xenagos, God of Revels');
    expect(converted.library).toHaveLength(99);
    expect(converted.library.some(card => card.name === 'Disciple of Freyalise')).toBe(true);
  });

  it('initializes a four-player tournament pod with the submitted list', () => {
    resetInstanceCounter();
    const deck = parseSubmittedDeck();
    const state = initGameFromDecks({
      humanDeck: deck,
      aiDecks: [deck, deck, deck],
      aiDifficulty: 5,
      aiPersonalities: ['Balanced', 'Aggressive', 'Greedy'],
      cardLookup: lookup,
      startingHandSize: 7,
    });

    expect(state.players).toHaveLength(4);
    expect(state.players.every(player => player.commanderInstanceIds?.length === 1)).toBe(true);
    expect([...state.cardDefinitions.values()].some(def => def.name === 'Xenagos, God of Revels')).toBe(true);
  });

  it('handles the deck-specific mana and commander actions without phase skips', () => {
    let { state, ids } = makeFocusedState();

    const invalidCradle = tryTapLandForMana(state, 'p1', ids.cradle, 'R');
    expect(invalidCradle.ok).toBe(false);

    const cradle = tryTapLandForMana(state, 'p1', ids.cradle, 'G');
    expect(cradle.ok).toBe(true);
    state = cradle.state;
    expect(state.players[0].manaPool.G).toBe(4);
    expect(state.phase).toBe('precombat_main');

    const sickSomberwald = tryTapLandForMana(state, 'p1', ids.somberwald, 'G');
    expect(sickSomberwald.ok).toBe(false);
    if (!sickSomberwald.ok) expect(sickSomberwald.reason).toBe('summoning_sick');

    state = {
      ...state,
      cards: new Map(state.cards).set(ids.somberwald, {
        ...state.cards.get(ids.somberwald)!,
        summoningSick: false,
      }),
    };
    const activeSomberwald = tryTapLandForMana(state, 'p1', ids.somberwald, 'R');
    expect(activeSomberwald.ok).toBe(true);
    state = activeSomberwald.state;
    expect(state.players[0].manaPool.R).toBe(3);

    const elvishGuide = tryTapLandForMana(state, 'p1', ids['elvish-spirit-guide'], 'G');
    expect(elvishGuide.ok).toBe(true);
    state = elvishGuide.state;
    expect(state.cards.get(ids['elvish-spirit-guide'])?.zone).toBe('exile');

    const simianGuide = tryTapLandForMana(state, 'p1', ids['simian-spirit-guide'], 'R');
    expect(simianGuide.ok).toBe(true);
    state = simianGuide.state;
    expect(state.cards.get(ids['simian-spirit-guide'])?.zone).toBe('exile');

    const blackerLotus = tryTapLandForMana(state, 'p1', ids['blacker-lotus'], 'G');
    expect(blackerLotus.ok).toBe(true);
    state = blackerLotus.state;
    expect(state.players[0].manaPool.G).toBe(9);
    expect(state.cards.get(ids['blacker-lotus'])?.zone).toBe('exile');

    const fetchPhase = state.phase;
    const fetch = tryActivateAbility(state, 'p1', ids['arid-mesa'], 0, []);
    expect(fetch.ok).toBe(true);
    state = fetch.state;
    expect(state.phase).toBe(fetchPhase);
    expect(state.players[0].life).toBe(39);
    expect(state.stack).toHaveLength(1);
    expect((state.stack[0] as any).ability.effects[0].filter.subtypes).toEqual(['Mountain', 'Plains']);
    expect(state.cards.get(ids['arid-mesa'])?.zone).toBe('graveyard');
    state = resolveStackFully(state);
    expect(state.stack).toHaveLength(0);
    expect(state.cards.get(ids.mountain)?.zone).toBe('battlefield');
    expect(state.cards.get(ids.mountain)?.tapped).toBe(false);

    state = {
      ...state,
      players: state.players.map((p, i) => i === 0 ? { ...p, manaPool: { ...emptyManaPool(), R: 1, G: 1, C: 3 } } : p),
    };
    const commanderCast = tryCastSpell(state, 'p1', ids.xenagos, [], { ...emptyManaPool(), generic: 0 });
    expect(commanderCast.ok).toBe(true);
    state = commanderCast.state;
    expect(state.stack).toHaveLength(1);
    expect(state.players[0].commanderCastCounts?.[ids.xenagos]).toBe(1);
  });

  it('applies Nyxbloom Ancient to tapped permanents but not hand exile mana', () => {
    let { state, ids } = makeFocusedState();
    const nyxbloom = getDef('Nyxbloom Ancient');
    const forest = getDef('Forest');
    state.cardDefinitions.set(nyxbloom.id, nyxbloom);
    state.cardDefinitions.set(forest.id, forest);
    state.cards.set('nyxbloom-test', {
      instanceId: 'nyxbloom-test',
      definitionId: nyxbloom.id,
      ownerId: 'p1',
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
    state.cards.set('forest-test', {
      instanceId: 'forest-test',
      definitionId: forest.id,
      ownerId: 'p1',
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });

    const forestMana = tryTapLandForMana(state, 'p1', 'forest-test', 'G');
    expect(forestMana.ok).toBe(true);
    state = forestMana.state;
    expect(state.players[0].manaPool.G).toBe(3);

    const spiritGuide = tryTapLandForMana(state, 'p1', ids['elvish-spirit-guide'], 'G');
    expect(spiritGuide.ok).toBe(true);
    state = spiritGuide.state;
    expect(state.players[0].manaPool.G).toBe(4);
    expect(state.cards.get(ids['elvish-spirit-guide'])?.zone).toBe('exile');
  });

  it('runs a compact four-seat high-power pod smoke test without AI dispatch failures', () => {
    resetInstanceCounter();
    const deck = parseSubmittedDeck();
    let state = initGameFromDecks({
      humanDeck: deck,
      aiDecks: [deck, deck, deck],
      aiDifficulty: 5,
      aiPersonalities: ['Balanced', 'Aggressive', 'Political'],
      cardLookup: lookup,
      startingHandSize: 12,
    });

    const failureReasons: string[] = [];
    for (let seat = 0; seat < state.players.length; seat++) {
      state = {
        ...state,
        activePlayerIndex: seat,
        priorityPlayerIndex: seat,
        phase: 'precombat_main',
        step: 'draw',
        stack: [],
        hasPriorityPassed: new Array(state.players.length).fill(false),
      };
      state = giveCastingMana(state);

      const playerId = state.players[seat].id;
      const result = runAITurn(state, {
        playerId,
        difficulty: 5,
        personality: seat % 2 === 0 ? 'Balanced' : 'Aggressive',
      }, 30);
      state = resolveStackFully(result.finalState);

      for (const decision of result.decisions) {
        if (decision.reasoning?.startsWith('Fallback') || decision.reasoning?.includes('Retry budget')) {
          failureReasons.push(`${state.players[seat].name}: ${decision.reasoning}`);
        }
      }
    }

    expect(failureReasons).toEqual([]);
    expect(state.players.every(player => Number.isFinite(player.life))).toBe(true);
    expect(state.cards.size).toBeGreaterThan(300);
  });
});
