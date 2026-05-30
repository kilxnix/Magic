import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  convertCard,
  convertGeneratedDeck,
  createCardLookup,
  parseCardsJsonl,
  type CardLookup,
  type GeneratedDeck,
} from '../cards/deck-loader';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { getCardsInZone } from '../game-state';
import { putTriggersOnStack, registerBattlefieldAbilities, resolveTopOfStack } from '../stack';
import { tryCastSpell, tryDeclareAttackers } from '../actions-public';
import { resolveCombatDamage } from '../combat';
import { createPlayer, emptyManaPool, type CardDefinition, type CardInstance, type GameState, type ManaCost, type Zone } from '../types';

const RAW_QUANDRIX_DECK = `
Commander
1 Quandrix, the Proof

Deck
1 Shark Typhoon
1 Talrand, Sky Summoner
1 Deekah, Fractal Theorist
1 Jadzi, Oracle of Arcavios
1 Murmuring Mystic
1 Forgotten Ancient
1 Sin, Unending Cataclysm
1 Forced Fruition
1 Ghostly Flicker
1 Swarm Intelligence
1 Quandrix Charm
1 Beast Within
1 Negate
1 Naturalize
1 Counterspell
1 Return to Nature
1 Fog
1 Pongify
1 Rapid Hybridization
1 Mystic Confluence
1 Sublime Epiphany
1 Reality Shift
1 Wash Away
1 Aetherize
1 Wash Out
1 Wisdom of Ages
1 Embrace the Paradox
1 Archmage Emeritus
1 Treasure Cruise
1 Dig Through Time
1 Rishkar's Expertise
1 Imoti, Celebrant of Bounty
1 Ancestral Vision
1 Frantic Search
1 Growth Spiral
1 Eureka Moment
1 Tatyova, Benthic Druid
1 Rashmi, Eternities Crafter
1 Quandrix Apprentice
1 Eternal Witness
1 Minds Aglow
1 Dictate of Kruphix
1 Well of Ideas
1 Teferi's Ageless Insight
1 Llanowar Elves
1 Elvish Mystic
1 Fyndhorn Elves
1 Studious First-Year
1 Tempt with Discovery
1 Rites of Flourishing
1 Heartbeat of Spring
1 Dictate of Karametra
1 Wilderness Reclamation
1 Sol Ring
1 Three Visits
1 Rampant Growth
1 Cultivate
1 Kodama's Reach
1 Skyshroud Claim
1 Command Tower
1 Exotic Orchard
1 Hinterland Harbor
1 Rimewood Falls
1 Tangled Islet
1 Sodden Verdure
1 Rain-Slicked Copse
1 Willowrush Verge
1 Overflowing Basin
1 Flooded Grove
1 Yavimaya Coast
1 Barkchannel Pathway
1 Vineglimmer Snarl
1 Temple of Mystery
1 Tanglepool Bridge
1 Simic Guildgate
1 Simic Growth Chamber
1 Quandrix Campus
1 Thornwood Falls
1 Scavenger Grounds
1 Myriad Landscape
1 Evolving Wilds
1 Terramorphic Expanse
9 Forest
6 Island
1 Jace, Wielder of Mysteries
1 Laboratory Maniac
`;

const NO_PAYMENT: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };

let lookup: CardLookup;
let nextInstance = 0;

function parseQuandrixDeck(): GeneratedDeck {
  const list: string[] = [];
  let commander = '';
  let section: 'commander' | 'deck' = 'deck';

  for (const rawLine of RAW_QUANDRIX_DECK.trim().split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^commander$/i.test(line)) {
      section = 'commander';
      continue;
    }
    if (/^deck$/i.test(line)) {
      section = 'deck';
      continue;
    }

    const match = line.match(/^(\d+)x?\s+(.+)$/);
    if (!match) continue;
    const count = Number(match[1]);
    const name = match[2].trim();
    if (section === 'commander') {
      commander = name;
    } else {
      for (let i = 0; i < count; i++) list.push(name);
    }
  }

  return {
    id: 'submitted-quandrix-proof',
    commander,
    list,
    colors: ['G', 'U'],
    bracket: 3,
    theme: 'Simic cascade spells tournament playtest',
  };
}

function getDef(name: string): CardDefinition {
  const raw = lookup(name);
  if (!raw) throw new Error(`Missing Quandrix QA card fixture: ${name}`);
  return convertCard(raw);
}

function makeState(): { state: GameState; ids: Record<string, string> } {
  nextInstance = 0;
  const state: GameState = {
    players: [
      createPlayer('p1', 'Quandrix pilot'),
      createPlayer('p2', 'Opponent A'),
      createPlayer('p3', 'Opponent B'),
      createPlayer('p4', 'Opponent C'),
    ],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'draw',
    turnNumber: 1,
    hasPriorityPassed: [false, false, false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    delayedTriggers: [],
  };
  const ids: Record<string, string> = {};

  const add = (
    label: string,
    name: string,
    zone: Zone,
    ownerId = 'p1',
    options: Partial<CardInstance> = {},
  ): string => {
    const def = getDef(name);
    state.cardDefinitions.set(def.id, def);
    const instanceId = `${label}-${++nextInstance}`;
    state.cards.set(instanceId, {
      instanceId,
      definitionId: def.id,
      ownerId,
      zone,
      tapped: options.tapped ?? false,
      summoningSick: options.summoningSick ?? false,
      counters: options.counters ?? {},
      damage: options.damage ?? 0,
      isCommander: options.isCommander ?? false,
      isToken: options.isToken,
    });
    ids[label] = instanceId;
    if (options.isCommander) {
      const playerIndex = state.players.findIndex(player => player.id === ownerId);
      state.players[playerIndex] = {
        ...state.players[playerIndex],
        commanderInstanceId: instanceId,
        commanderInstanceIds: [instanceId],
        commanderCastCounts: { [instanceId]: 0 },
      };
    }
    return instanceId;
  };

  add('quandrix-command', 'Quandrix, the Proof', 'command', 'p1', { isCommander: true });
  add('quandrix-board', 'Quandrix, the Proof', 'battlefield');
  add('growth-spiral', 'Growth Spiral', 'hand');
  add('embrace', 'Embrace the Paradox', 'hand');
  add('frantic-search', 'Frantic Search', 'hand');
  add('fog', 'Fog', 'library');
  add('forest-one', 'Forest', 'library');
  add('forest-hand', 'Forest', 'hand');
  add('sol-ring-library', 'Sol Ring', 'library');
  add('talrand', 'Talrand, Sky Summoner', 'battlefield');
  add('murmuring', 'Murmuring Mystic', 'battlefield');
  add('deekah', 'Deekah, Fractal Theorist', 'battlefield');
  add('shark-typhoon', 'Shark Typhoon', 'battlefield');
  add('archmage', 'Archmage Emeritus', 'battlefield');
  add('swarm', 'Swarm Intelligence', 'battlefield');
  add('forced-fruition', 'Forced Fruition', 'battlefield');
  add('lab-maniac', 'Laboratory Maniac', 'battlefield');
  add('jace', 'Jace, Wielder of Mysteries', 'battlefield');
  add('opponent-elf', 'Llanowar Elves', 'hand', 'p2');
  for (let i = 0; i < 16; i++) {
    add(`p2-library-${i}`, 'Island', 'library', 'p2');
  }
  for (let i = 0; i < 12; i++) {
    add(`draw-card-${i}`, 'Island', 'library');
  }

  return { state, ids };
}

function giveMana(state: GameState, playerId = 'p1'): GameState {
  return {
    ...state,
    players: state.players.map(player => player.id === playerId
      ? { ...player, manaPool: { ...emptyManaPool(), U: 20, G: 20, C: 20 } }
      : player),
  };
}

function resolveAll(state: GameState): GameState {
  let next = state;
  let guard = 0;
  while ((next.pendingTriggers.length > 0 || next.stack.length > 0) && guard < 200) {
    if (next.pendingTriggers.length > 0) {
      next = putTriggersOnStack(next);
    }
    if (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    guard++;
  }
  expect(guard).toBeLessThan(200);
  return next;
}

function registerAbilities(state: GameState, ids: Record<string, string>, labels: string[]): GameState {
  let next = state;
  for (const label of labels) {
    next = registerBattlefieldAbilities(next, ids[label]);
  }
  return next;
}

function cardNamesOnStack(state: GameState): string[] {
  return state.stack
    .filter(item => item.kind === 'Spell')
    .map(item => state.cardDefinitions.get(state.cards.get(item.cardInstanceId)!.definitionId)!.name);
}

function tokenByName(state: GameState, name: string): CardInstance | undefined {
  return [...state.cards.values()].find(card =>
    card.ownerId === 'p1' &&
    card.zone === 'battlefield' &&
    card.isToken &&
    state.cardDefinitions.get(card.definitionId)?.name === name
  );
}

describe('submitted Quandrix tournament playtest', () => {
  beforeAll(() => {
    const cardsPath = new URL('../../../mtg_data/cards_min.jsonl', import.meta.url);
    lookup = createCardLookup(parseCardsJsonl(readFileSync(cardsPath, 'utf8')));
  });

  it('imports the exact submitted Quandrix list from the current card data without filler', () => {
    const deck = parseQuandrixDeck();
    const names = [deck.commander, ...new Set(deck.list)];
    const missing = names.filter(name => !lookup(name));

    expect(deck.commander).toBe('Quandrix, the Proof');
    expect(deck.list).toHaveLength(99);
    expect(deck.list).toContain('Sin, Unending Cataclysm');
    expect(deck.list).toContain('Overflowing Basin');
    expect(missing).toEqual([]);

    const converted = convertGeneratedDeck(deck, lookup);
    expect(converted.commander?.name).toBe('Quandrix, the Proof');
    expect(converted.library).toHaveLength(99);
    expect(converted.commander?.oracle_text).toContain('Instant and sorcery spells you cast from your hand have cascade.');
  });

  it('initializes a four-player pod with Quandrix in the command zone', () => {
    resetInstanceCounter();
    const deck = parseQuandrixDeck();
    const state = initGameFromDecks({
      humanDeck: deck,
      aiDecks: [deck, deck, deck],
      aiDifficulty: 3,
      aiPersonalities: ['Balanced', 'Aggressive', 'Greedy'],
      cardLookup: lookup,
      startingHandSize: 7,
    });

    expect(state.players).toHaveLength(4);
    expect(state.players[0].commanderInstanceIds?.length).toBe(1);
    expect(getCardsInZone(state, state.players[0].id, 'command')).toHaveLength(1);
  });

  it('casts the commander and resolves printed cascade into a legal lower-value spell', () => {
    let { state, ids } = makeState();
    state.cards.set(ids.fog, { ...state.cards.get(ids.fog)!, zone: 'graveyard' });
    state.cards.set(ids['forest-one'], { ...state.cards.get(ids['forest-one'])!, zone: 'graveyard' });
    state = giveMana(state);

    const cast = tryCastSpell(state, 'p1', ids['quandrix-command'], [], NO_PAYMENT);
    expect(cast.ok, cast.ok ? undefined : cast.message).toBe(true);
    expect(cardNamesOnStack(cast.state)).toContain('Sol Ring');
    expect(cardNamesOnStack(cast.state)).toContain('Quandrix, the Proof');
  });

  it('grants cascade only to instant and sorcery spells cast from hand', () => {
    let { state, ids } = makeState();
    state.cards.set(ids['sol-ring-library'], { ...state.cards.get(ids['sol-ring-library'])!, zone: 'graveyard' });
    state = giveMana(state);

    const cast = tryCastSpell(state, 'p1', ids['growth-spiral'], [], NO_PAYMENT);
    expect(cast.ok, cast.ok ? undefined : cast.message).toBe(true);
    expect(cardNamesOnStack(cast.state)).toEqual(['Growth Spiral', 'Fog']);
    expect(cast.state.cards.get(ids.fog)?.zone).toBe('stack');
    expect(cast.state.cards.get(ids['forest-one'])?.zone).toBe('library');
  });

  it('resolves Fog as a turn-scoped shield that prevents combat damage only', () => {
    let { state, ids } = makeState();
    state.cards.set(ids.fog, { ...state.cards.get(ids.fog)!, zone: 'hand' });
    state.cards.set(ids['opponent-elf'], {
      ...state.cards.get(ids['opponent-elf'])!,
      zone: 'battlefield',
      summoningSick: false,
    });
    state = {
      ...giveMana(state, 'p1'),
      activePlayerIndex: 1,
      priorityPlayerIndex: 0,
      phase: 'combat',
      step: 'declare_attackers',
      hasPriorityPassed: [false, false, false, false],
    };

    const cast = tryCastSpell(state, 'p1', ids.fog, [], NO_PAYMENT);
    expect(cast.ok, cast.ok ? undefined : cast.message).toBe(true);
    state = resolveAll(cast.state);
    expect(state.damagePreventionEffects?.some(effect => effect.combatOnly && effect.amount === 'all')).toBe(true);

    state = {
      ...state,
      priorityPlayerIndex: 1,
      hasPriorityPassed: [false, false, false, false],
    };
    const attack = tryDeclareAttackers(state, 'p2', [{
      cardInstanceId: ids['opponent-elf'],
      defendingPlayerId: 'p1',
    }]);
    expect(attack.ok, attack.ok ? undefined : attack.message).toBe(true);
    const afterCombat = resolveCombatDamage(attack.state);

    expect(afterCombat.players.find(player => player.id === 'p1')?.life).toBe(40);
    expect(afterCombat.damagePreventionEffects?.length).toBeGreaterThan(0);
  });

  it('builds correctly sized spell-value tokens from Shark Typhoon and Deekah', () => {
    let { state, ids } = makeState();
    state.cards.set(ids['quandrix-board'], { ...state.cards.get(ids['quandrix-board'])!, zone: 'graveyard' });
    state = registerAbilities(state, ids, ['talrand', 'murmuring', 'deekah', 'shark-typhoon', 'archmage']);
    state = giveMana(state);

    const libraryBefore = getCardsInZone(state, 'p1', 'library').length;
    const cast = tryCastSpell(state, 'p1', ids['growth-spiral'], [], NO_PAYMENT);
    expect(cast.ok, cast.ok ? undefined : cast.message).toBe(true);
    state = resolveAll(cast.state);

    const shark = tokenByName(state, 'Shark');
    const fractal = tokenByName(state, 'Fractal');
    expect(tokenByName(state, 'Drake')).toBeDefined();
    expect(tokenByName(state, 'Bird Illusion')).toBeDefined();
    expect(shark).toBeDefined();
    expect(fractal).toBeDefined();
    expect(state.cardDefinitions.get(shark!.definitionId)?.power).toBe(2);
    expect(state.cardDefinitions.get(shark!.definitionId)?.keywords).toContain('Flying');
    expect(fractal!.counters['+1/+1']).toBe(2);
    expect(getCardsInZone(state, 'p1', 'library').length).toBeLessThan(libraryBefore);
  });

  it('copies the triggering spell with Swarm Intelligence and fires copy-sensitive magecraft', () => {
    let { state, ids } = makeState();
    state.cards.set(ids.fog, { ...state.cards.get(ids.fog)!, zone: 'graveyard' });
    state = registerAbilities(state, ids, ['swarm', 'deekah', 'archmage']);
    state = giveMana(state);

    const libraryBefore = getCardsInZone(state, 'p1', 'library').length;
    const cast = tryCastSpell(state, 'p1', ids['growth-spiral'], [], NO_PAYMENT);
    expect(cast.ok, cast.ok ? undefined : cast.message).toBe(true);
    state = resolveAll(cast.state);

    const fractals = [...state.cards.values()].filter(card =>
      card.ownerId === 'p1' &&
      card.zone === 'battlefield' &&
      card.isToken &&
      state.cardDefinitions.get(card.definitionId)?.name === 'Fractal'
    );
    expect(fractals.length).toBeGreaterThanOrEqual(2);
    expect(getCardsInZone(state, 'p1', 'library').length).toBeLessThanOrEqual(libraryBefore - 2);
  });

  it('makes Forced Fruition draw seven for the opponent that cast the spell', () => {
    let { state, ids } = makeState();
    state = registerAbilities(state, ids, ['forced-fruition']);
    state = {
      ...giveMana(state, 'p2'),
      activePlayerIndex: 1,
      priorityPlayerIndex: 1,
      hasPriorityPassed: [false, false, false, false],
    };

    const before = getCardsInZone(state, 'p2', 'library').length;
    const cast = tryCastSpell(state, 'p2', ids['opponent-elf'], [], NO_PAYMENT);
    expect(cast.ok, cast.ok ? undefined : cast.message).toBe(true);
    expect(cast.state.pendingTriggers.some(trigger => trigger.ability.trigger.kind === 'OpponentCastSpell')).toBe(true);
    state = putTriggersOnStack(cast.state);
    state = resolveTopOfStack(state);
    expect(getCardsInZone(state, 'p2', 'library')).toHaveLength(before - 7);
    expect(getCardsInZone(state, 'p2', 'hand')).toHaveLength(7);
  });

  it('wins instead of losing when Lab Maniac or Jace replaces an empty-library draw', () => {
    let { state, ids } = makeState();
    for (const card of [...state.cards.values()]) {
      if (card.ownerId === 'p1' && card.zone === 'library') {
        state.cards.set(card.instanceId, { ...card, zone: 'graveyard' });
      }
    }
    state = giveMana(state);

    const cast = tryCastSpell(state, 'p1', ids['frantic-search'], [], NO_PAYMENT);
    expect(cast.ok, cast.ok ? undefined : cast.message).toBe(true);
    state = resolveAll(cast.state);

    expect(state.players.find(player => player.id === 'p1')?.hasLost).not.toBe(true);
    expect(state.players.filter(player => player.id !== 'p1').every(player => player.hasLost)).toBe(true);
  });

  it('lets Embrace the Paradox put a land from hand onto the battlefield tapped', () => {
    let { state, ids } = makeState();
    state.cards.set(ids['quandrix-board'], { ...state.cards.get(ids['quandrix-board'])!, zone: 'graveyard' });
    state = giveMana(state);
    const cast = tryCastSpell(state, 'p1', ids.embrace, [], NO_PAYMENT, {
      namedCardChoices: { putLandCardId: ids['forest-hand'] },
    });
    expect(cast.ok, cast.ok ? undefined : cast.message).toBe(true);
    state = resolveAll(cast.state);

    expect(state.cards.get(ids['forest-hand'])?.zone).toBe('battlefield');
    expect(state.cards.get(ids['forest-hand'])?.tapped).toBe(true);
  });
});
