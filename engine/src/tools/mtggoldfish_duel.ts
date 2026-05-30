/**
 * Headless Shelector-vs-Shelector duel runner for MTGGoldfish deck downloads.
 *
 * Designed for CI/sandbox environments where:
 * - The full `mtg_data/cards_min.jsonl` card database isn't present
 * - Vitest may not be runnable due to filesystem permission restrictions
 *
 * This runner uses stub card definitions (vanilla creatures + simple mana lands)
 * so we can still exercise the turn loop, priority passing, stack resolution,
 * and AI decision plumbing.
 */

import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { getCardsInZone, getCardDefinition } from '../game-state';
import { advanceStep, performUntapStep } from '../turn-manager';
import { drawCards } from '../actions';
import { passPriority } from '../priority';
import { runAITurn } from '../ai/agent';
import { resolveTopOfStack } from '../stack';
import { resolveCombatDamage } from '../combat';
import { checkStateBasedActions } from '../state-based';
import type { ScryfallCard } from '../cards/deck-loader';
import type { AIPlayerConfig } from '../ai/types';

// ---------------------------------------------------------------------------
// MTGGoldfish deck download fixtures (single-line exports)
// ---------------------------------------------------------------------------

const GOLDFISH_7120027 = `1 Arcane Signet 1 Austere Command 1 Bartolome del Presidio 1 Blade of the Bloodchief 1 Blood Artist 1 Bloodghast 1 Bloodline Necromancer 1 Bloodtracker 1 Bojuka Bog 1 Butcher of Malakir 1 Carmen, Cruel Skymarcher 1 Champion of Dusk 1 Charismatic Conqueror 1 Clavileno, First of the Blessed 1 Command Tower 1 Commander's Sphere 1 Cordial Vampire 1 Crossway Troublemakers 1 Cruel Celebrant 1 Damn 1 Drana, Liberator of Malakir 1 Dusk Legion Sergeant 1 Dusk Legion Zealot 1 Elenda's Hierophant 1 Elenda, the Dusk Rose 1 Etchings of the Chosen 1 Exquisite Blood 1 Falkenrath Noble 1 Glass-Cast Heart 1 Heirloom Blade 1 Indulgent Aristocrat 1 Isolated Chapel 1 Kindred Boon 1 Legion Lieutenant 1 March of the Canonized 1 Martyr of Dusk 1 Master of Dark Rites 1 Mavren Fein, Dusk Apostle 1 Mind Stone 1 Myriad Landscape 1 New Blood 1 Nighthawk Scavenger 1 Oathsworn Vampire 1 Olivia's Wrath 1 Order of Sacred Dusk 1 Orzhov Basilica 1 Orzhov Signet 1 Pact of the Serpent 1 Path of Ancestry 1 Patron of the Vein 8 Plains 1 Promise of Aclazotz 1 Radiant Destiny 1 Redemption Choir 1 Return to Dust 1 Rogue's Passage 1 Sanctum Seeker 1 Secluded Courtyard 1 Shineshadow Snarl 1 Sol Ring 1 Sorin, Lord of Innistrad 13 Swamp 1 Swiftfoot Boots 1 Swords to Plowshares 1 Tainted Field 1 Talisman of Hierarchy 1 Temple of Silence 1 Temple of the False God 1 Timothar, Baron of Bats 1 Twilight Prophet 1 Unclaimed Territory 1 Utter End 1 Vault of the Archangel 1 Village Rites 1 Viscera Seer 1 Voldaren Estate 1 Vona, Butcher of Magan 1 Wayfarer's Bauble 1 Welcoming Vampire 1 Windbrisk Heights 1 Yahenni, Undying Partisan`;

const GOLDFISH_3485397 = `1 Abundance 1 Abzan Falconer 1 Acidic Slime 1 Admonition Angel 1 Arcane Signet 1 Armorcraft Judge 1 Banishing Light 1 Beanstalk Giant 1 Blighted Woodland 1 Boros Garrison 1 Boros Guildgate 1 Circuitous Route 1 Command Tower 1 Condemn 1 Crush Contraband 1 Cryptic Caves 1 Elite Scaleguard 1 Elvish Rejuvenator 1 Embodiment of Insight 1 Emeria Angel 1 Emeria Shepherd 1 Evolution Sage 1 Evolving Wilds 1 Far Wanderings 1 Fertilid 10 Forest 1 Geode Rager 1 Ground Assault 1 Gruul Guildgate 1 Gruul Turf 1 Harmonize 1 Harrow 1 Hour of Revelation 1 Inspiring Call 1 Jungle Shrine 1 Keeper of Fables 1 Khalni Heart Expedition 1 Kodama's Reach 1 Kor Cartographer 1 Krosan Verge 1 Living Twister 1 Mina and Denn, Wildborn 4 Mountain 1 Multani, Yavimaya's Avatar 1 Murasa Rootgrazer 1 Myriad Landscape 1 Naya Charm 1 Naya Panorama 1 Needle Spires 1 Nissa's Renewal 1 Obuun, Mul Daya Ancestor 1 Omnath, Locus of Rage 7 Plains 1 Planar Outburst 1 Rampaging Baloths 1 Retreat to Emeria 1 Retreat to Kazandu 1 Return of the Wildspeaker 1 Rites of Flourishing 1 Roiling Regrowth 1 Sandstone Oracle 1 Satyr Wayfinder 1 Scaretiller 1 Seer's Sundial 1 Selesnya Guildgate 1 Selesnya Sanctuary 1 Sol Ring 1 Sporemound 1 Springbloom Druid 1 Struggle/Survive 1 Sun Titan 1 Sylvan Advocate 1 Sylvan Reclamation 1 Terramorphic Expanse 1 The Mending of Dominaria 1 Together Forever 1 Treacherous Terrain 1 Trove Warden 1 Tuskguard Captain 1 Waker of the Wilds 1 Yavimaya Elder 1 Zendikar's Roil`;

function parseGoldfishFlatList(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const entries: string[] = [];

  const re = /(?:^|\s)(\d+)\s+(.+?)(?=(?:\s\d+\s)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const qty = parseInt(m[1] || '0', 10);
    const name = (m[2] || '').trim();
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    for (let i = 0; i < qty; i++) entries.push(name);
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Stub card database helpers
// ---------------------------------------------------------------------------

const BASIC_LANDS = new Map<string, { type_line: string; oracle_text: string; color_identity: string[] }>([
  ['Plains', { type_line: 'Basic Land — Plains', oracle_text: '{T}: Add {W}.', color_identity: ['W'] }],
  ['Island', { type_line: 'Basic Land — Island', oracle_text: '{T}: Add {U}.', color_identity: ['U'] }],
  ['Swamp', { type_line: 'Basic Land — Swamp', oracle_text: '{T}: Add {B}.', color_identity: ['B'] }],
  ['Mountain', { type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.', color_identity: ['R'] }],
  ['Forest', { type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', color_identity: ['G'] }],
]);

function makeStubLand(id: string, name: string, isBasic: boolean): ScryfallCard {
  if (isBasic) {
    const basic = BASIC_LANDS.get(name);
    return {
      id,
      name,
      type_line: basic?.type_line || 'Basic Land',
      oracle_text: basic?.oracle_text || '{T}: Add {C}.',
      mana_cost: '',
      cmc: 0,
      colors: [],
      color_identity: basic?.color_identity || [],
      keywords: [],
    };
  }
  return {
    id,
    name,
    type_line: 'Land',
    oracle_text: '{T}: Add {C}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
  };
}

function makeStubCreature(id: string, name: string): ScryfallCard {
  return {
    id,
    name,
    type_line: 'Creature — Shapeshifter',
    oracle_text: '',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    keywords: [],
    power: '2',
    toughness: '2',
  };
}

function buildStubCardDatabase(deckA: { commander: string; cards: string[]; lands: Set<string> }, deckB: { commander: string; cards: string[]; lands: Set<string> }): ScryfallCard[] {
  const allNames = new Set<string>();
  allNames.add(deckA.commander);
  allNames.add(deckB.commander);
  for (const n of deckA.cards) allNames.add(n);
  for (const n of deckB.cards) allNames.add(n);

  const cards: ScryfallCard[] = [];
  let idx = 0;
  for (const name of allNames) {
    const isLand = BASIC_LANDS.has(name) || deckA.lands.has(name) || deckB.lands.has(name);
    const isBasic = BASIC_LANDS.has(name);
    const id = `stub-${idx++}`;
    cards.push(isLand ? makeStubLand(id, name, isBasic) : makeStubCreature(id, name));
  }
  return cards;
}

/** Play lands/cast spells, then resolve the stack. */
function doMainPhaseActions(
  // Keep this tool buildable with `tsc` even though many core engine helpers
  // are typed against the base `GameState` (and `initGameFromDecks` returns
  // `GameStateWithAI`). Runtime behavior preserves the extra fields.
  state: any,
  config: AIPlayerConfig,
  log: string[],
): any {
  let s: any = state;

  const { finalState, decisions } = runAITurn(s, config, 60);
  s = finalState;

  for (const d of decisions) {
    if (d.action.kind === 'PlayLand') {
      const inst = s.cards.get(d.action.cardInstanceId);
      const def = inst ? getCardDefinition(s, inst) : undefined;
      log.push(`    [LAND] ${config.playerId} played ${def?.name || 'a land'}`);
    } else if (d.action.kind === 'CastSpell') {
      const inst = s.cards.get(d.action.cardInstanceId);
      const def = inst ? getCardDefinition(s, inst) : undefined;
      log.push(`    [CAST] ${config.playerId} cast ${def?.name || 'a spell'}`);
    }
  }

  let resolveAttempts = 0;
  while (s.stack.length > 0 && resolveAttempts < 30) {
    s = passPriority(s);
    s = passPriority(s);
    if (s.stack.length > 0) s = resolveTopOfStack(s);
    resolveAttempts++;
  }

  return checkStateBasedActions(s);
}

export function runGoldfishDuel(): { halfTurnsPlayed: number; log: string[] } {
  resetInstanceCounter();

  const deckACommander = 'Clavileno, First of the Blessed';
  const deckBCommander = 'Obuun, Mul Daya Ancestor';

  const deckAAll = parseGoldfishFlatList(GOLDFISH_7120027);
  const deckBAll = parseGoldfishFlatList(GOLDFISH_3485397);

  if (deckAAll.length !== 100 || deckBAll.length !== 100) {
    throw new Error(`Parsed deck sizes unexpected: A=${deckAAll.length}, B=${deckBAll.length}`);
  }
  if (!deckAAll.includes(deckACommander) || !deckBAll.includes(deckBCommander)) {
    throw new Error('Commander names not found in parsed lists');
  }

  const deckALibrary = [...deckAAll];
  deckALibrary.splice(deckALibrary.indexOf(deckACommander), 1);
  const deckBLibrary = [...deckBAll];
  deckBLibrary.splice(deckBLibrary.indexOf(deckBCommander), 1);

  const deckALands = new Set<string>([
    'Bojuka Bog',
    'Command Tower',
    'Isolated Chapel',
    'Myriad Landscape',
    'Orzhov Basilica',
    'Path of Ancestry',
    "Rogue's Passage",
    'Secluded Courtyard',
    'Shineshadow Snarl',
    'Tainted Field',
    'Temple of Silence',
    'Temple of the False God',
    'Unclaimed Territory',
    'Vault of the Archangel',
    'Voldaren Estate',
    'Windbrisk Heights',
  ]);

  const deckBLands = new Set<string>([
    'Blighted Woodland',
    'Boros Garrison',
    'Boros Guildgate',
    'Command Tower',
    'Cryptic Caves',
    'Evolving Wilds',
    'Gruul Guildgate',
    'Gruul Turf',
    'Jungle Shrine',
    'Krosan Verge',
    'Myriad Landscape',
    'Naya Panorama',
    'Needle Spires',
    'Selesnya Guildgate',
    'Selesnya Sanctuary',
    'Terramorphic Expanse',
  ]);

  const allCards = buildStubCardDatabase(
    { commander: deckACommander, cards: deckALibrary, lands: deckALands },
    { commander: deckBCommander, cards: deckBLibrary, lands: deckBLands },
  );
  const lookup = createCardLookup(allCards);

  let state: any = initGameFromDecks({
    humanDeck: {
      id: 'deck-a',
      commander: deckACommander,
      list: deckALibrary,
      colors: ['W', 'B'],
      bracket: 2,
      theme: 'MTGGoldfish 7120027',
    },
    aiDecks: [{
      id: 'deck-b',
      commander: deckBCommander,
      list: deckBLibrary,
      colors: ['R', 'G', 'W'],
      bracket: 2,
      theme: 'MTGGoldfish 3485397',
    }],
    aiDifficulty: 3,
    aiPersonalities: ['Balanced'],
    cardLookup: lookup,
    humanGoesFirst: true,
    startingLife: 40,
    startingHandSize: 7,
  });

  const p1Id = 'human';
  const p2Id = 'ai1';
  const p1Config: AIPlayerConfig = { playerId: p1Id, difficulty: 3, personality: 'Aggressive' };
  const p2Config: AIPlayerConfig = { playerId: p2Id, difficulty: 3, personality: 'Balanced' };

  const log: string[] = [];
  const maxHalfTurns = 60;
  let halfTurnsPlayed = 0;

  for (let halfTurn = 0; halfTurn < maxHalfTurns; halfTurn++) {
    halfTurnsPlayed = halfTurn + 1;

    const activePlayer = state.players[state.activePlayerIndex];
    const activeId = activePlayer.id;
    const config = activeId === p1Id ? p1Config : p2Config;

    log.push(`--- Turn ${state.turnNumber} (${activeId}) ---`);

    if (state.step === 'untap') {
      state = performUntapStep(state);
      state = advanceStep(state); // upkeep
    }

    // upkeep
    state = passPriority(state);
    state = passPriority(state);
    state = advanceStep(state); // draw

    // draw
    const skipDraw = state.turnNumber === 1 && activeId === p1Id;
    if (!skipDraw) {
      state = drawCards(state, activeId, 1);
      const handNow = getCardsInZone(state, activeId, 'hand');
      const drawn = handNow[handNow.length - 1];
      if (drawn) log.push(`    [DRAW] ${activeId} drew ${getCardDefinition(state, drawn).name}`);
    }
    state = passPriority(state);
    state = passPriority(state);
    state = advanceStep(state); // precombat main

    // precombat main
    state = doMainPhaseActions(state, config, log);
    state = passPriority(state);
    state = passPriority(state);
    state = advanceStep(state); // declare attackers

    // attackers
    const atk = runAITurn(state, config, 20);
    state = atk.finalState;
    state = passPriority(state);
    state = passPriority(state);
    state = advanceStep(state); // declare blockers

    // blockers
    const defenderId = activeId === p1Id ? p2Id : p1Id;
    const defConfig = defenderId === p1Id ? p1Config : p2Config;
    const blk = runAITurn(state, defConfig, 20);
    state = blk.finalState;
    state = passPriority(state);
    state = passPriority(state);
    state = advanceStep(state); // first_strike_damage

    // first strike
    state = passPriority(state);
    state = passPriority(state);
    state = advanceStep(state); // combat_damage

    // combat damage
    if (state.combat && state.combat.attackers.length > 0) {
      state = resolveCombatDamage(state);
      state = checkStateBasedActions(state);
    } else if (state.combat && state.combat.attackers.length === 0) {
      state = { ...state, combat: null };
    }
    state = passPriority(state);
    state = passPriority(state);
    state = advanceStep(state); // end_of_combat

    // end of combat
    state = passPriority(state);
    state = passPriority(state);
    state = advanceStep(state); // end (postcombat_main)

    // postcombat main
    state = doMainPhaseActions(state, config, log);
    state = passPriority(state);
    state = passPriority(state);
    state = advanceStep(state); // cleanup

    // cleanup -> next turn
    state = advanceStep(state);

    const p1Lost = state.players.find((p: any) => p.id === p1Id)!.hasLost;
    const p2Lost = state.players.find((p: any) => p.id === p2Id)!.hasLost;
    if (p1Lost || p2Lost) break;
  }

  return { halfTurnsPlayed, log };
}
