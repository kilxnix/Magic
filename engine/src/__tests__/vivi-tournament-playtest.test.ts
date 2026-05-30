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
import { tryCastSpell, tryTapLandForMana } from '../actions-public';
import { getLegalActions } from '../ai/legal-actions';
import { createPlayer, emptyManaPool, type CardDefinition, type CardInstance, type GameState, type ManaCost, type Zone } from '../types';

const RAW_VIVI_DECK = `
Commander
1 Vivi Ornitier

Deck
1 Abrade
1 Arcane Signet
1 Archmage Emeritus
1 Backdraft Hellkite
1 Big Score
1 Blasphemous Act
1 Brudiclad, Telchor Engineer
1 Burst Lightning
1 Cascade Bluffs
1 Chain Reaction
1 Chaos Warp
1 Coastal Peak
1 Command Tower
1 Coruscation Mage
1 Creative Technique
1 Curiosity
1 Dance with Calamity
1 Dictate of Kruphix
1 Dirgur Focusmage
1 Electrodominance
1 Emeritus of Conflict
1 Essence Scatter
1 Expansion // Explosion
1 Expressive Iteration
1 Faerie Mastermind
1 Ferrous Lake
1 Fiery Inscription
1 Frantic Search
1 Frostboil Snarl
1 Galazeth Prismari
1 Goldspan Dragon
1 Grapeshot
1 Guttersnipe
1 Hall of Oracles
1 Harmonic Prodigy
1 High Fae Trickster
8 Island
1 Izzet Guildgate
1 Lier, Disciple of the Drowned
1 Lightning Bolt
1 Lightning Greaves
1 Magma Opus
1 Mana Sculpt
1 Mocking Sprite
1 Molten Tributary
7 Mountain
1 Mystic Sanctuary
1 Negate
1 Niv-Mizzet, Parun
1 Niv-Mizzet, Visionary
1 Opt
1 Path of Ancestry
1 Ponder
1 Preordain
1 Prismari Campus
1 Prismari Charm
1 Prismari Command
1 Pyromancer's Goggles
1 Quicken
1 Refute
1 Reliquary Tower
1 Renegade Bull
1 Resculpt
1 Restless Spire
1 Rite of Replication
1 River's Rebuke
1 Rootha, Mercurial Artist
1 Scorched Geyser
1 Shivan Reef
1 Shore Up
1 Sol Ring
1 Spectacle Summit
1 Storm-Kiln Artist
1 Stormcatch Mentor
1 Study Hall
1 Sulfur Falls
1 Surge to Victory
1 Swiftwater Cliffs
1 Talisman of Creativity
1 Temple of Epiphany
1 Temple of the False God
1 Thrill of Possibility
1 Thunderclap Drake
1 Twinflame
1 Unsummon
1 Veyran, Voice of Duality
`;

const NO_PAYMENT: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };

let lookup: CardLookup;
let nextInstance = 0;

function parseViviDeck(): GeneratedDeck {
  const list: string[] = [];
  let commander = '';
  let section: 'commander' | 'deck' = 'deck';

  for (const rawLine of RAW_VIVI_DECK.trim().split('\n')) {
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
    id: 'submitted-vivi-spells',
    commander,
    list,
    colors: ['U', 'R'],
    bracket: 3,
    theme: 'Izzet spells tournament playtest',
  };
}

function getDef(name: string): CardDefinition {
  const raw = lookup(name);
  if (!raw) throw new Error(`Missing Vivi QA card fixture: ${name}`);
  return convertCard(raw);
}

function makeState(): { state: GameState; ids: Record<string, string> } {
  nextInstance = 0;
  const state: GameState = {
    players: [
      createPlayer('p1', 'Vivi pilot'),
      createPlayer('p2', 'Opponent A'),
      createPlayer('p3', 'Opponent B'),
    ],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'draw',
    turnNumber: 1,
    hasPriorityPassed: [false, false, false],
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
    });
    ids[label] = instanceId;
    if (options.isCommander) {
      state.players[0] = {
        ...state.players[0],
        commanderInstanceId: instanceId,
        commanderInstanceIds: [instanceId],
        commanderCastCounts: { [instanceId]: 0 },
      };
    }
    return instanceId;
  };

  add('vivi', 'Vivi Ornitier', 'command', 'p1', { isCommander: true });
  add('opt', 'Opt', 'hand');
  add('shore-up', 'Shore Up', 'hand');
  add('essence-scatter', 'Essence Scatter', 'hand');
  add('lightning-bolt', 'Lightning Bolt', 'hand');
  add('grapeshot', 'Grapeshot', 'hand');
  add('expansion', 'Expansion // Explosion', 'hand');
  add('archmage', 'Archmage Emeritus', 'battlefield');
  add('veyran-support', 'Veyran, Voice of Duality', 'battlefield');
  add('storm-kiln-permanent', 'Storm-Kiln Artist', 'battlefield');
  add('goggles', "Pyromancer's Goggles", 'battlefield');
  add('storm-kiln', 'Storm-Kiln Artist', 'stack', 'p2');
  add('temple', 'Temple of the False God', 'battlefield');
  add('island-one', 'Island', 'battlefield');
  add('island-two', 'Island', 'battlefield');
  add('mountain-one', 'Mountain', 'battlefield');
  add('mountain-two', 'Mountain', 'battlefield');
  for (let i = 0; i < 12; i++) {
    add(`draw-card-${i}`, 'Island', 'library');
  }

  return { state, ids };
}

function giveMana(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map(player => player.id === 'p1'
      ? { ...player, manaPool: { ...emptyManaPool(), U: 10, R: 10, C: 10 } }
      : player),
  };
}

function resolveAll(state: GameState): GameState {
  let next = state;
  let guard = 0;
  while ((next.pendingTriggers.length > 0 || next.stack.length > 0) && guard < 100) {
    if (next.pendingTriggers.length > 0) {
      next = putTriggersOnStack(next);
    }
    if (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    guard++;
  }
  expect(guard).toBeLessThan(100);
  return next;
}

function registerAbilities(state: GameState, ids: Record<string, string>, labels: string[]): GameState {
  let next = state;
  for (const label of labels) {
    next = registerBattlefieldAbilities(next, ids[label]);
  }
  return next;
}

function countTokensByName(state: GameState, playerId: string, name: string): number {
  let count = 0;
  for (const card of state.cards.values()) {
    if (card.ownerId !== playerId || card.zone !== 'battlefield' || !card.isToken) continue;
    const def = state.cardDefinitions.get(card.definitionId);
    if (def?.name === name) count++;
  }
  return count;
}

describe('submitted Vivi tournament playtest', () => {
  beforeAll(() => {
    const cardsPath = new URL('../../../mtg_data/cards_min.jsonl', import.meta.url);
    lookup = createCardLookup(parseCardsJsonl(readFileSync(cardsPath, 'utf8')));
  });

  it('imports the exact submitted Vivi list without filler or missing card names', () => {
    const deck = parseViviDeck();
    const names = [deck.commander, ...new Set(deck.list)];
    const missing = names.filter(name => !lookup(name));

    expect(deck.commander).toBe('Vivi Ornitier');
    expect(deck.list).toHaveLength(99);
    expect(deck.list).toContain('Stormcatch Mentor');
    expect(missing).toEqual([]);

    const converted = convertGeneratedDeck(deck, lookup);
    expect(converted.commander?.name).toBe('Vivi Ornitier');
    expect(converted.library).toHaveLength(99);
    const expansion = converted.library.find(card => card.name === 'Expansion // Explosion');
    expect(expansion?.card_types).toContain('instant');
    expect(expansion?.oracle_text).toContain('Copy target instant or sorcery spell');
    expect(expansion?.faces?.map(face => face.name)).toEqual(['Expansion', 'Explosion']);
    expect(expansion?.faces?.[1].mana_cost).toBe('{X}{U}{U}{R}{R}');
  });

  it('initializes a four-player pod with Vivi in the command zone', () => {
    resetInstanceCounter();
    const deck = parseViviDeck();
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

  it('casts Vivi, fires the noncreature trigger, and keeps creature counterspells creature-only', () => {
    let { state, ids } = makeState();
    state = giveMana(state);

    const castVivi = tryCastSpell(state, 'p1', ids.vivi, [], NO_PAYMENT);
    expect(castVivi.ok, castVivi.ok ? undefined : castVivi.message).toBe(true);
    state = resolveTopOfStack(castVivi.state);
    state = registerBattlefieldAbilities(state, ids.vivi);
    expect(state.cards.get(ids.vivi)?.zone).toBe('battlefield');

    const opponentALife = state.players[1].life;
    const opponentBLife = state.players[2].life;
    const castOpt = tryCastSpell(giveMana(state), 'p1', ids.opt, [], NO_PAYMENT);
    expect(castOpt.ok, castOpt.ok ? undefined : castOpt.message).toBe(true);
    state = castOpt.state;
    expect(state.pendingTriggers.some(trigger => trigger.ability.trigger.kind === 'CastNoncreatureSpell')).toBe(true);

    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(state.cards.get(ids.vivi)?.counters['+1/+1']).toBe(1);
    expect(state.players[1].life).toBe(opponentALife - 1);
    expect(state.players[2].life).toBe(opponentBLife - 1);
    state = resolveAll(state);
    expect(state.cards.get(ids.opt)?.zone).toBe('graveyard');

    state = {
      ...giveMana(state),
      stack: [{ kind: 'Spell', id: 'storm-kiln-spell', cardInstanceId: ids['storm-kiln'], casterId: 'p2', targets: [] }],
      priorityPlayerIndex: 0,
    };
    const scatter = tryCastSpell(state, 'p1', ids['essence-scatter'], [ids['storm-kiln']], NO_PAYMENT);
    expect(scatter.ok, scatter.ok ? undefined : scatter.message).toBe(true);
    state = resolveTopOfStack(scatter.state);
    expect(state.cards.get(ids['storm-kiln'])?.zone).toBe('graveyard');
  });

  it('keeps Temple of the False God disabled until the fifth land in this deck', () => {
    let { state, ids } = makeState();
    state.cards.set(ids['mountain-two'], { ...state.cards.get(ids['mountain-two'])!, zone: 'hand' });
    const tooSoon = tryTapLandForMana(state, 'p1', ids.temple, 'C');
    expect(tooSoon.ok).toBe(false);

    const fifthLand = getDef('Island');
    state.cardDefinitions.set(fifthLand.id, fifthLand);
    state.cards.set('fifth-land', {
      instanceId: 'fifth-land',
      definitionId: fifthLand.id,
      ownerId: 'p1',
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
    });

    const online = tryTapLandForMana(state, 'p1', ids.temple, 'C');
    expect(online.ok, online.ok ? undefined : online.message).toBe(true);
    expect(online.state.players[0].manaPool.C).toBe(2);
  });

  it('handles Vivi deck magecraft: cast-or-copy triggers, Veyran doubling, Storm-Kiln Treasures, and Archmage draws', () => {
    let { state, ids } = makeState();
    state = registerAbilities(state, ids, ['archmage', 'veyran-support', 'storm-kiln-permanent']);
    state = giveMana(state);

    const libraryBefore = getCardsInZone(state, 'p1', 'library').length;
    const castOpt = tryCastSpell(state, 'p1', ids.opt, [], NO_PAYMENT);
    expect(castOpt.ok, castOpt.ok ? undefined : castOpt.message).toBe(true);
    state = resolveAll(castOpt.state);

    expect(countTokensByName(state, 'p1', 'Treasure')).toBe(2);
    expect(getCardsInZone(state, 'p1', 'library')).toHaveLength(libraryBefore - 3);
    expect(state.cards.get(ids['veyran-support'])?.counters._powerMod).toBe(2);
    expect(state.cards.get(ids['veyran-support'])?.counters._toughnessMod).toBe(2);
    expect(state.cards.get(ids.opt)?.zone).toBe('graveyard');
  });

  it('copies Grapeshot through storm for each spell cast before it this turn', () => {
    let { state, ids } = makeState();
    state = {
      ...giveMana(state),
      spellsCastThisTurn: 2,
    };

    const opponentLife = state.players[1].life;
    const castGrapeshot = tryCastSpell(state, 'p1', ids.grapeshot, ['p2'], NO_PAYMENT);
    expect(castGrapeshot.ok, castGrapeshot.ok ? undefined : castGrapeshot.message).toBe(true);
    expect(castGrapeshot.state.stack.filter(item => item.kind === 'Spell')).toHaveLength(3);

    state = resolveAll(castGrapeshot.state);
    expect(state.players[1].life).toBe(opponentLife - 3);
    expect(state.cards.get(ids.grapeshot)?.zone).toBe('graveyard');
  });

  it('lets Expansion copy an instant spell on the stack without consuming the original', () => {
    let { state, ids } = makeState();
    state = giveMana(state);

    const opponentLife = state.players[1].life;
    const castBolt = tryCastSpell(state, 'p1', ids['lightning-bolt'], ['p2'], NO_PAYMENT);
    expect(castBolt.ok, castBolt.ok ? undefined : castBolt.message).toBe(true);

    const castExpansion = tryCastSpell(castBolt.state, 'p1', ids.expansion, [ids['lightning-bolt']], NO_PAYMENT);
    expect(castExpansion.ok, castExpansion.ok ? undefined : castExpansion.message).toBe(true);

    state = resolveTopOfStack(castExpansion.state);
    expect(state.stack.filter(item => item.kind === 'Spell')).toHaveLength(2);

    state = resolveAll(state);
    expect(state.players[1].life).toBe(opponentLife - 6);
    expect(state.cards.get(ids.expansion)?.zone).toBe('graveyard');
    expect(state.cards.get(ids['lightning-bolt'])?.zone).toBe('graveyard');
  });

  it('lets the Explosion face be chosen, paid with X, targeted, and resolved from the shared split card', () => {
    let { state, ids } = makeState();
    state = giveMana(state);

    const actions = getLegalActions(state, 'p1')
      .filter((action): action is Extract<ReturnType<typeof getLegalActions>[number], { kind: 'CastSpell' }> =>
        action.kind === 'CastSpell'
        && action.cardInstanceId === ids.expansion
        && action.faceName === 'Explosion'
      );
    expect(actions.some(action => action.xValue === 3 && action.targets[0] === 'p2' && action.targets[1] === 'p1')).toBe(true);

    const opponentLife = state.players[1].life;
    const libraryBefore = getCardsInZone(state, 'p1', 'library').length;
    const castExplosion = tryCastSpell(state, 'p1', ids.expansion, ['p2', 'p1'], NO_PAYMENT, {
      faceName: 'Explosion',
      xValue: 3,
    });
    expect(castExplosion.ok, castExplosion.ok ? undefined : castExplosion.message).toBe(true);
    expect(castExplosion.state.stack.at(-1)).toMatchObject({ faceName: 'Explosion', xValue: 3 });

    state = resolveTopOfStack(castExplosion.state);
    expect(state.players[1].life).toBe(opponentLife - 3);
    expect(getCardsInZone(state, 'p1', 'library')).toHaveLength(libraryBefore - 3);
    expect(state.cards.get(ids.expansion)?.zone).toBe('graveyard');
  });

  it("copies red instant and sorcery spells cast with Pyromancer's Goggles mana", () => {
    let { state, ids } = makeState();
    const tapped = tryTapLandForMana(state, 'p1', ids.goggles, 'R');
    expect(tapped.ok, tapped.ok ? undefined : tapped.message).toBe(true);
    state = tapped.state;
    expect(state.players[0].conditionalMana?.[0]?.effect).toBe('copyRedInstantOrSorcery');

    const opponentLife = state.players[1].life;
    const castBolt = tryCastSpell(state, 'p1', ids['lightning-bolt'], ['p2'], NO_PAYMENT);
    expect(castBolt.ok, castBolt.ok ? undefined : castBolt.message).toBe(true);
    expect(castBolt.state.stack.filter(item => item.kind === 'Spell')).toHaveLength(2);

    state = resolveAll(castBolt.state);
    expect(state.players[1].life).toBe(opponentLife - 6);
    expect(state.cards.get(ids['lightning-bolt'])?.zone).toBe('graveyard');
  });
});
