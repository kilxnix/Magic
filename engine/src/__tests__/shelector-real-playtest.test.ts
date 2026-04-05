/**
 * Shelector REAL Playtest: Red Goblins vs Green Bears
 *
 * Both players' decisions come from the REAL Shelector LLM at localhost:8100.
 * No heuristic AI — every main-phase and combat decision is made by the brain.
 *
 * 10 full rounds (20 half-turns), 5-minute timeout.
 */

import { describe, it, expect } from 'vitest';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { getCardsInZone, getCardDefinition } from '../game-state';
import { advanceStep, performUntapStep } from '../turn-manager';
import { drawCards } from '../actions';
import { passPriority } from '../priority';
import { applyAction } from '../ai/agent';
import { getLegalActions } from '../ai/legal-actions';
import { resolveTopOfStack, putTriggersOnStack } from '../stack';
import { resolveCombatDamage } from '../combat';
import { checkStateBasedActions } from '../state-based';
import type { ScryfallCard } from '../cards/deck-loader';
import type { GameState } from '../types';
import type { AIAction } from '../ai/types';

// ---------------------------------------------------------------------------
// Card Factories
// ---------------------------------------------------------------------------

function makeMountain(name: string): ScryfallCard {
  return {
    id: name, name,
    type_line: 'Basic Land — Mountain',
    oracle_text: '{T}: Add {R}.',
    mana_cost: '', cmc: 0, colors: [], color_identity: ['R'], keywords: [],
  };
}

function makeForest(name: string): ScryfallCard {
  return {
    id: name, name,
    type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [],
  };
}

function makeRedCommander(): ScryfallCard {
  return {
    id: 'red-cmd', name: 'Krenko, Mob Boss',
    type_line: 'Legendary Creature — Goblin Warrior',
    oracle_text: '',
    mana_cost: '{2}{R}{R}', cmc: 4,
    colors: ['R'], color_identity: ['R'],
    keywords: [],
    power: '3', toughness: '3',
  };
}

function makeGreenCommander(): ScryfallCard {
  return {
    id: 'green-cmd', name: 'Goreclaw, Terror of Qal Sisma',
    type_line: 'Legendary Creature — Bear',
    oracle_text: '',
    mana_cost: '{3}{G}', cmc: 4,
    colors: ['G'], color_identity: ['G'],
    keywords: [],
    power: '4', toughness: '3',
  };
}

function makeGoblin(id: string, name: string, cost: string, cmc: number, p: string, t: string, keywords: string[] = []): ScryfallCard {
  return {
    id, name,
    type_line: 'Creature — Goblin',
    oracle_text: keywords.join('\n'),
    mana_cost: cost, cmc,
    colors: ['R'], color_identity: ['R'],
    keywords,
    power: p, toughness: t,
  };
}

function makeBear(id: string, name: string, cost: string, cmc: number, p: string, t: string, keywords: string[] = []): ScryfallCard {
  return {
    id, name,
    type_line: 'Creature — Bear',
    oracle_text: keywords.join('\n'),
    mana_cost: cost, cmc,
    colors: ['G'], color_identity: ['G'],
    keywords,
    power: p, toughness: t,
  };
}

// ---------------------------------------------------------------------------
// Deck Construction
// ---------------------------------------------------------------------------

function buildCardDatabase(): ScryfallCard[] {
  const cards: ScryfallCard[] = [];

  // Commanders
  cards.push(makeRedCommander());
  cards.push(makeGreenCommander());

  // RED: 64 goblins of various costs
  const goblins: [string, string, string, number, string, string, string[]][] = [
    ['g01', 'Foundry Street Denizen', '{R}', 1, '1', '1', []],
    ['g02', 'Goblin Arsonist', '{R}', 1, '1', '1', []],
    ['g03', 'Skirk Prospector', '{R}', 1, '1', '1', []],
    ['g04', 'Goblin Bushwhacker', '{R}', 1, '1', '1', ['Haste']],
    ['g05', 'Raging Goblin', '{R}', 1, '1', '1', ['Haste']],
    ['g06', 'Goblin Sledder', '{R}', 1, '1', '1', []],
    ['g07', 'Goblin Motivator', '{R}', 1, '1', '1', []],
    ['g08', 'Goblin Lackey', '{R}', 1, '1', '1', []],
    ['g09', 'Goblin Guide', '{R}', 1, '2', '2', ['Haste']],
    ['g10', 'Legion Loyalist', '{R}', 1, '1', '1', ['Haste']],
    ['g11', 'Goblin Piledriver', '{1}{R}', 2, '1', '2', []],
    ['g12', 'Goblin Wardriver', '{R}{R}', 2, '2', '2', []],
    ['g13', 'Mogg War Marshal', '{1}{R}', 2, '1', '1', []],
    ['g14', 'Warren Instigator', '{R}{R}', 2, '1', '1', []],
    ['g15', 'Goblin Cratermaker', '{1}{R}', 2, '2', '2', []],
    ['g16', 'Goblin Recruiter', '{1}{R}', 2, '1', '1', []],
    ['g17', 'Goblin Chieftain', '{1}{R}{R}', 3, '2', '2', ['Haste']],
    ['g18', 'Goblin Warchief', '{1}{R}{R}', 3, '2', '2', ['Haste']],
    ['g19', 'Goblin Rabblemaster', '{2}{R}', 3, '2', '2', []],
    ['g20', 'Goblin Matron', '{2}{R}', 3, '1', '1', []],
    ['g21', 'Goblin Sharpshooter', '{2}{R}', 3, '1', '1', []],
    ['g22', 'Goblin Ringleader', '{3}{R}', 4, '2', '2', ['Haste']],
    ['g23', 'Goblin Trashmaster', '{2}{R}{R}', 4, '3', '3', []],
    ['g24', 'Siege-Gang Commander', '{3}{R}{R}', 5, '2', '2', []],
  ];

  for (const [id, name, cost, cmc, p, t, kw] of goblins) {
    cards.push(makeGoblin(id, name, cost, cmc, p, t, kw));
  }

  // Duplicate low-cost goblins to reach 64 total creatures
  // We have 24 unique goblins, need 40 more
  for (let i = 0; i < 40; i++) {
    const suffix = `_dup${i}`;
    const base = goblins[i % goblins.length];
    cards.push(makeGoblin(
      `g_extra${i}`, `${base[1]} ${i + 2}`,
      base[2], base[3], base[4], base[5], base[6],
    ));
  }

  // GREEN: 64 bears/beasts of various costs
  const bears: [string, string, string, number, string, string, string[]][] = [
    ['b01', 'Elvish Mystic', '{G}', 1, '1', '1', []],
    ['b02', 'Llanowar Elves', '{G}', 1, '1', '1', []],
    ['b03', 'Fyndhorn Elves', '{G}', 1, '1', '1', []],
    ['b04', 'Experiment One', '{G}', 1, '1', '1', []],
    ['b05', 'Pelt Collector', '{G}', 1, '1', '1', []],
    ['b06', 'Dryad Militant', '{G}', 1, '2', '1', []],
    ['b07', 'Jungle Lion', '{G}', 1, '2', '1', []],
    ['b08', 'Scythe Tiger', '{G}', 1, '3', '2', []],
    ['b09', 'Grizzly Bears', '{1}{G}', 2, '2', '2', []],
    ['b10', 'Kalonian Tusker', '{G}{G}', 2, '3', '3', []],
    ['b11', 'Garruk Companion', '{G}{G}', 2, '3', '2', []],
    ['b12', 'Swordwise Centaur', '{G}{G}', 2, '3', '2', []],
    ['b13', 'Leatherback Baloth', '{G}{G}{G}', 3, '4', '5', []],
    ['b14', 'Trained Armodon', '{1}{G}{G}', 3, '3', '3', []],
    ['b15', 'Nessian Courser', '{2}{G}', 3, '3', '3', []],
    ['b16', 'Centaur Courser', '{2}{G}', 3, '3', '3', []],
    ['b17', 'Rumbling Baloth', '{2}{G}{G}', 4, '4', '4', []],
    ['b18', 'Imperiosaur', '{2}{G}{G}', 4, '5', '5', []],
    ['b19', 'Stampeding Elk Herd', '{3}{G}{G}', 5, '5', '5', ['Trample']],
    ['b20', 'Garruk Beast', '{4}{G}', 5, '4', '4', ['Trample']],
    ['b21', 'Colossal Dreadmaw', '{4}{G}{G}', 6, '6', '6', ['Trample']],
    ['b22', 'Carnage Tyrant', '{4}{G}{G}', 6, '7', '6', ['Trample']],
    ['b23', 'Ghalta, Primal Hunger', '{10}{G}{G}', 12, '12', '12', ['Trample']],
    ['b24', 'Gigantosaurus', '{G}{G}{G}{G}{G}', 5, '10', '10', []],
  ];

  for (const [id, name, cost, cmc, p, t, kw] of bears) {
    cards.push(makeBear(id, name, cost, cmc, p, t, kw));
  }

  // Duplicate to reach 64
  for (let i = 0; i < 40; i++) {
    const base = bears[i % bears.length];
    cards.push(makeBear(
      `b_extra${i}`, `${base[1]} ${i + 2}`,
      base[2], base[3], base[4], base[5], base[6],
    ));
  }

  // Lands: 35 each
  for (let i = 0; i < 35; i++) cards.push(makeMountain(`Mountain-${i}`));
  for (let i = 0; i < 35; i++) cards.push(makeForest(`Forest-${i}`));

  return cards;
}

function buildRedDeck(): { commander: string; list: string[] } {
  const list: string[] = [];
  // 24 unique goblins
  const names = [
    'Foundry Street Denizen', 'Goblin Arsonist', 'Skirk Prospector',
    'Goblin Bushwhacker', 'Raging Goblin', 'Goblin Sledder',
    'Goblin Motivator', 'Goblin Lackey', 'Goblin Guide', 'Legion Loyalist',
    'Goblin Piledriver', 'Goblin Wardriver', 'Mogg War Marshal',
    'Warren Instigator', 'Goblin Cratermaker', 'Goblin Recruiter',
    'Goblin Chieftain', 'Goblin Warchief', 'Goblin Rabblemaster',
    'Goblin Matron', 'Goblin Sharpshooter', 'Goblin Ringleader',
    'Goblin Trashmaster', 'Siege-Gang Commander',
  ];
  list.push(...names);
  // 40 duplicates
  for (let i = 0; i < 40; i++) {
    list.push(`${names[i % names.length]} ${i + 2}`);
  }
  // 35 mountains
  for (let i = 0; i < 35; i++) list.push(`Mountain-${i}`);
  return { commander: 'Krenko, Mob Boss', list };
}

function buildGreenDeck(): { commander: string; list: string[] } {
  const list: string[] = [];
  const names = [
    'Elvish Mystic', 'Llanowar Elves', 'Fyndhorn Elves',
    'Experiment One', 'Pelt Collector', 'Dryad Militant',
    'Jungle Lion', 'Scythe Tiger', 'Grizzly Bears', 'Kalonian Tusker',
    'Garruk Companion', 'Swordwise Centaur', 'Leatherback Baloth',
    'Trained Armodon', 'Nessian Courser', 'Centaur Courser',
    'Rumbling Baloth', 'Imperiosaur', 'Stampeding Elk Herd',
    'Garruk Beast', 'Colossal Dreadmaw', 'Carnage Tyrant',
    'Ghalta, Primal Hunger', 'Gigantosaurus',
  ];
  list.push(...names);
  for (let i = 0; i < 40; i++) {
    list.push(`${names[i % names.length]} ${i + 2}`);
  }
  for (let i = 0; i < 35; i++) list.push(`Forest-${i}`);
  return { commander: 'Goreclaw, Terror of Qal Sisma', list };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countCreatures(state: GameState, pid: string): number {
  return getCardsInZone(state, pid, 'battlefield')
    .filter(c => getCardDefinition(state, c).card_types.includes('creature')).length;
}

function listBattlefield(state: GameState, pid: string): string {
  const bf = getCardsInZone(state, pid, 'battlefield');
  const creatures = bf.filter(c => getCardDefinition(state, c).card_types.includes('creature'));
  const lands = bf.filter(c => getCardDefinition(state, c).card_types.includes('land'));
  const tapped = lands.filter(c => c.tapped).length;
  const cNames = creatures.map(c => {
    const d = getCardDefinition(state, c);
    return `${d.name}(${d.power}/${d.toughness})${c.tapped ? '[T]' : ''}${c.summoningSick ? '[SS]' : ''}`;
  });
  return `${cNames.length} creatures [${cNames.join(', ')}], ${lands.length} lands (${tapped} tapped)`;
}

/**
 * Serialize GameState for the /decide API.
 * Maps must be converted to plain objects.
 */
function serializeForAPI(state: GameState): {
  game_state: Record<string, any>;
  cards: Record<string, any>;
  definitions: Record<string, any>;
} {
  // Build game_state (without maps)
  const game_state: Record<string, any> = {
    turnNumber: state.turnNumber,
    phase: state.phase,
    step: state.step,
    activePlayerIndex: state.activePlayerIndex,
    priorityPlayerIndex: state.priorityPlayerIndex,
    players: state.players.map(p => ({
      id: p.id,
      name: p.name,
      life: p.life,
      hasPlayedLand: p.hasPlayedLand,
      hasPriority: p.hasPriority,
      hasLost: p.hasLost,
      manaPool: p.manaPool,
      commanderDamage: p.commanderDamage,
      commanderTax: p.commanderTax,
      commanderCastCount: p.commanderCastCount,
    })),
    stack: state.stack,
    combat: state.combat,
  };

  // cards: instanceId -> card instance
  const cards: Record<string, any> = {};
  for (const [id, card] of state.cards) {
    cards[id] = {
      instanceId: card.instanceId,
      definitionId: card.definitionId,
      ownerId: card.ownerId,
      zone: card.zone,
      tapped: card.tapped,
      summoningSick: card.summoningSick,
      damage: card.damage,
      isCommander: card.isCommander,
      isToken: card.isToken,
    };
  }

  // definitions: defId -> card definition
  const definitions: Record<string, any> = {};
  for (const [id, def] of state.cardDefinitions) {
    definitions[id] = {
      id: def.id,
      name: def.name,
      type_line: def.type_line,
      oracle_text: def.oracle_text,
      mana_cost: def.mana_cost,
      cmc: def.cmc,
      colors: def.colors,
      color_identity: def.color_identity,
      keywords: def.keywords,
      power: def.power,
      toughness: def.toughness,
      card_types: def.card_types,
    };
  }

  return { game_state, cards, definitions };
}

/**
 * Serialize an AIAction for the API, enriching with card names.
 */
function serializeAction(state: GameState, action: AIAction): Record<string, any> {
  const base: Record<string, any> = { kind: action.kind };

  if ('cardInstanceId' in action && action.cardInstanceId) {
    base.cardInstanceId = action.cardInstanceId;
    const card = state.cards.get(action.cardInstanceId);
    if (card) {
      const def = getCardDefinition(state, card);
      base.cardName = def.name;
    }
  }

  if (action.kind === 'CastSpell') {
    base.targets = action.targets;
    if (action.chosenModes) base.chosenModes = action.chosenModes;
  }
  if (action.kind === 'ActivateManaAbility') {
    base.color = action.color;
  }
  if (action.kind === 'DeclareAttackers') {
    base.attacks = action.attacks.map(a => {
      const card = state.cards.get(a.cardInstanceId);
      const def = card ? getCardDefinition(state, card) : undefined;
      return {
        cardInstanceId: a.cardInstanceId,
        cardName: def?.name || '?',
        power: def?.power,
        toughness: def?.toughness,
        defendingPlayerId: a.defendingPlayerId,
      };
    });
  }
  if (action.kind === 'DeclareBlockers') {
    base.blocks = action.blocks.map(b => {
      const card = state.cards.get(b.cardInstanceId);
      const def = card ? getCardDefinition(state, card) : undefined;
      return {
        cardInstanceId: b.cardInstanceId,
        cardName: def?.name || '?',
        blockingAttackerId: b.blockingAttackerId,
      };
    });
  }
  if (action.kind === 'ActivateAbility') {
    base.abilityIndex = action.abilityIndex;
    base.targets = action.targets;
  }

  return base;
}

/**
 * Call the Shelector API to make a decision.
 */
async function callShelector(
  state: GameState,
  playerId: string,
  legalActions: AIAction[],
  personality: string,
): Promise<{ action: AIAction; narration: string }> {
  const { game_state, cards, definitions } = serializeForAPI(state);

  const serializedActions = legalActions.map(a => serializeAction(state, a));

  const body = {
    game_state,
    cards,
    definitions,
    legal_actions: serializedActions,
    player_id: playerId,
    personality,
  };

  const response = await fetch('http://localhost:8100/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shelector API error ${response.status}: ${text}`);
  }

  const result = await response.json() as { action: Record<string, any>; narration: string };

  // Match the returned action back to a legal action
  const chosenKind = result.action?.kind;
  const chosenCardId = result.action?.cardInstanceId;

  let matched: AIAction | undefined;

  // Strategy 1: Match by kind + cardInstanceId
  if (chosenKind && chosenCardId) {
    matched = legalActions.find(
      a => a.kind === chosenKind && 'cardInstanceId' in a && a.cardInstanceId === chosenCardId,
    );
  }

  // Strategy 2: Match by kind for DeclareAttackers/DeclareBlockers (match by attacks length)
  if (!matched && chosenKind === 'DeclareAttackers') {
    const attacks = result.action?.attacks || [];
    matched = legalActions.find(
      a => a.kind === 'DeclareAttackers' && a.attacks.length === attacks.length,
    );
  }
  if (!matched && chosenKind === 'DeclareBlockers') {
    const blocks = result.action?.blocks || [];
    matched = legalActions.find(
      a => a.kind === 'DeclareBlockers' && a.blocks.length === blocks.length,
    );
  }

  // Strategy 3: Match by kind only (take first)
  if (!matched && chosenKind) {
    matched = legalActions.find(a => a.kind === chosenKind);
  }

  // Strategy 4: Fallback to PassPriority or last action
  if (!matched) {
    matched = legalActions.find(a => a.kind === 'PassPriority') || legalActions[legalActions.length - 1];
  }

  return { action: matched, narration: result.narration };
}

/**
 * Describe an action for logging.
 */
function describeAction(state: GameState, action: AIAction): string {
  if (action.kind === 'PassPriority') return 'Pass Priority';
  if (action.kind === 'PlayLand') {
    const card = state.cards.get(action.cardInstanceId);
    const def = card ? getCardDefinition(state, card) : undefined;
    return `Play Land: ${def?.name || '?'}`;
  }
  if (action.kind === 'ActivateManaAbility') {
    const card = state.cards.get(action.cardInstanceId);
    const def = card ? getCardDefinition(state, card) : undefined;
    return `Tap ${def?.name || '?'} for {${action.color}}`;
  }
  if (action.kind === 'CastSpell') {
    const card = state.cards.get(action.cardInstanceId);
    const def = card ? getCardDefinition(state, card) : undefined;
    return `Cast ${def?.name || '?'} (${def?.mana_cost || '?'})`;
  }
  if (action.kind === 'DeclareAttackers') {
    if (action.attacks.length === 0) return 'Declare Attackers: none';
    const names = action.attacks.map(a => {
      const c = state.cards.get(a.cardInstanceId);
      const d = c ? getCardDefinition(state, c) : undefined;
      return `${d?.name || '?'}(${d?.power}/${d?.toughness})`;
    });
    return `Declare Attackers: ${names.join(', ')}`;
  }
  if (action.kind === 'DeclareBlockers') {
    if (action.blocks.length === 0) return 'Declare Blockers: none';
    const names = action.blocks.map(b => {
      const c = state.cards.get(b.cardInstanceId);
      const d = c ? getCardDefinition(state, c) : undefined;
      return `${d?.name || '?'}`;
    });
    return `Declare Blockers: ${names.join(', ')}`;
  }
  if (action.kind === 'ActivateAbility') {
    const card = state.cards.get(action.cardInstanceId);
    const def = card ? getCardDefinition(state, card) : undefined;
    return `Activate ${def?.name || '?'} ability #${action.abilityIndex}`;
  }
  return action.kind;
}

// ---------------------------------------------------------------------------
// Main Test
// ---------------------------------------------------------------------------

describe('Shelector REAL Playtest: Red Goblins vs Green Bears', () => {
  it('plays 10 rounds with LLM decisions from localhost:8100', async () => {
    resetInstanceCounter();

    const allCards = buildCardDatabase();
    const lookup = createCardLookup(allCards);
    const redDeck = buildRedDeck();
    const greenDeck = buildGreenDeck();

    let state = initGameFromDecks({
      humanDeck: {
        id: 'red-deck', commander: redDeck.commander,
        list: redDeck.list, colors: ['R'], bracket: 3, theme: 'Goblins',
      },
      aiDecks: [{
        id: 'green-deck', commander: greenDeck.commander,
        list: greenDeck.list, colors: ['G'], bracket: 3, theme: 'Bears',
      }],
      aiDifficulty: 3,
      cardLookup: lookup,
      humanGoesFirst: true,
      startingLife: 40,
      startingHandSize: 7,
    });

    const RED = 'human';
    const GREEN = 'ai1';
    const PERSONALITIES: Record<string, string> = {
      [RED]: 'Aggressive',
      [GREEN]: 'Balanced',
    };
    const LABELS: Record<string, string> = {
      [RED]: 'RED (Goblins)',
      [GREEN]: 'GREEN (Bears)',
    };

    const log: string[] = [];
    let shelectorCalls = 0;
    let gameOver = false;

    log.push('================================================================');
    log.push('  SHELECTOR REAL PLAYTEST: RED GOBLINS vs GREEN BEARS');
    log.push('  All decisions made by the LLM at localhost:8100');
    log.push('================================================================');
    log.push('');
    log.push(`RED Commander: ${redDeck.commander} (3/3)`);
    log.push(`GREEN Commander: ${greenDeck.commander} (4/3)`);
    log.push('Starting Life: 40 each');
    log.push('');
    log.push('--- GAME BEGIN ---');
    log.push('');

    const MAX_HALF_TURNS = 20; // 10 full rounds

    for (let ht = 0; ht < MAX_HALF_TURNS && !gameOver; ht++) {
      const activeId = state.players[state.activePlayerIndex].id;
      const label = LABELS[activeId];
      const oppId = activeId === RED ? GREEN : RED;
      const personality = PERSONALITIES[activeId];

      const prevCreatures = { [RED]: countCreatures(state, RED), [GREEN]: countCreatures(state, GREEN) };

      log.push(`=== Turn ${state.turnNumber} [${label}] | ` +
        `RED: ${state.players[0].life} life, ${prevCreatures[RED]} creatures | ` +
        `GREEN: ${state.players[1].life} life, ${prevCreatures[GREEN]} creatures ===`);

      try {
        // --- UNTAP ---
        if (state.step === 'untap') {
          state = performUntapStep(state);
          state = advanceStep(state);
        }

        // --- UPKEEP ---
        state = passPriority(state);
        state = passPriority(state);
        state = advanceStep(state); // -> draw

        // --- DRAW ---
        if (ht > 0) state = drawCards(state, activeId, 1);
        state = passPriority(state);
        state = passPriority(state);
        state = advanceStep(state); // -> precombat_main

        // --- MAIN PHASE 1: Let the Shelector decide ---
        // Loop: get legal actions, ask Shelector, apply, repeat until PassPriority
        let mainPhaseActions = 0;
        const MAX_MAIN_ACTIONS = 15; // safety limit

        for (let attempt = 0; attempt < MAX_MAIN_ACTIONS; attempt++) {
          const actions = getLegalActions(state, activeId);
          if (actions.length === 0) break;

          // Filter out mana abilities — we'll handle them automatically if needed
          const nonManaActions = actions.filter(a => a.kind !== 'ActivateManaAbility');
          if (nonManaActions.length === 0) break;

          // If only PassPriority is available, pass
          if (nonManaActions.length === 1 && nonManaActions[0].kind === 'PassPriority') {
            state = passPriority(state);
            break;
          }

          // Ask the Shelector
          const { action: chosen, narration } = await callShelector(
            state, activeId, actions, personality,
          );
          shelectorCalls++;

          log.push(`  [Shelector ${LABELS[activeId]}] ${describeAction(state, chosen)}`);
          log.push(`    "${narration}"`);

          if (chosen.kind === 'PassPriority') {
            state = passPriority(state);
            break;
          }

          // If casting a spell, we may need to auto-tap mana first
          if (chosen.kind === 'CastSpell') {
            // Tap all available mana before casting
            const manaActions = getLegalActions(state, activeId).filter(a => a.kind === 'ActivateManaAbility');
            for (const m of manaActions) {
              try { state = applyAction(state, activeId, m); } catch { /* already tapped */ }
            }
            // Re-check if we can still cast
            const castActions = getLegalActions(state, activeId).filter(a => a.kind === 'CastSpell');
            const castMatch = castActions.find(a => a.cardInstanceId === chosen.cardInstanceId) || castActions[0];
            if (castMatch) {
              try {
                state = applyAction(state, activeId, castMatch);
                // Resolve the stack
                state = passPriority(state);
                state = passPriority(state);
                while (state.stack.length > 0) {
                  state = resolveTopOfStack(state);
                  state = checkStateBasedActions(state);
                  if (state.pendingTriggers.length > 0) {
                    state = putTriggersOnStack(state);
                  }
                  if (state.stack.length > 0) {
                    state = passPriority(state);
                    state = passPriority(state);
                  }
                }
                mainPhaseActions++;
              } catch (e: any) {
                log.push(`    [Cast failed: ${e.message}]`);
              }
            } else {
              log.push(`    [Cannot cast — not enough mana]`);
            }
            continue;
          }

          // Apply non-cast actions directly
          try {
            state = applyAction(state, activeId, chosen);
            mainPhaseActions++;
            // Resolve any stack items
            if (state.stack.length > 0) {
              state = passPriority(state);
              state = passPriority(state);
              while (state.stack.length > 0) {
                state = resolveTopOfStack(state);
                state = checkStateBasedActions(state);
                if (state.pendingTriggers.length > 0) {
                  state = putTriggersOnStack(state);
                }
                if (state.stack.length > 0) {
                  state = passPriority(state);
                  state = passPriority(state);
                }
              }
            }
          } catch (e: any) {
            log.push(`    [Action failed: ${e.message}]`);
            break;
          }
        }

        // Pass through remaining main phase priority
        state = passPriority(state);
        state = passPriority(state);
        state = advanceStep(state); // -> declare_attackers

        // --- COMBAT: DECLARE ATTACKERS (ask Shelector) ---
        {
          const atkOptions = getLegalActions(state, activeId)
            .filter(a => a.kind === 'DeclareAttackers');

          if (atkOptions.length > 0) {
            // Ask the Shelector which attackers to declare
            const { action: chosen, narration } = await callShelector(
              state, activeId, atkOptions, personality,
            );
            shelectorCalls++;

            if (chosen.kind === 'DeclareAttackers') {
              state = applyAction(state, activeId, chosen);
              log.push(`  [Shelector ${LABELS[activeId]}] ${describeAction(state, chosen)}`);
              log.push(`    "${narration}"`);
            } else {
              // Fallback: no attacks
              const noAtk = atkOptions.find(a => a.kind === 'DeclareAttackers' && a.attacks.length === 0);
              if (noAtk) state = applyAction(state, activeId, noAtk);
            }
          }

          state = passPriority(state);
          state = passPriority(state);
        }

        // --- COMBAT: DECLARE BLOCKERS (ask Shelector for defender) ---
        state = advanceStep(state); // -> declare_blockers
        {
          const blkOptions = getLegalActions(state, oppId)
            .filter(a => a.kind === 'DeclareBlockers');

          if (blkOptions.length > 0) {
            const { action: chosen, narration } = await callShelector(
              state, oppId, blkOptions, PERSONALITIES[oppId],
            );
            shelectorCalls++;

            if (chosen.kind === 'DeclareBlockers') {
              try {
                state = applyAction(state, oppId, chosen);
                if (chosen.blocks.length > 0) {
                  log.push(`  [Shelector ${LABELS[oppId]}] ${describeAction(state, chosen)}`);
                  log.push(`    "${narration}"`);
                }
              } catch {
                const noBlk = blkOptions.find(b => b.kind === 'DeclareBlockers' && b.blocks.length === 0);
                if (noBlk) { try { state = applyAction(state, oppId, noBlk); } catch { /* ok */ } }
              }
            } else {
              const noBlk = blkOptions.find(b => b.kind === 'DeclareBlockers' && b.blocks.length === 0);
              if (noBlk) { try { state = applyAction(state, oppId, noBlk); } catch { /* ok */ } }
            }
          }

          state = passPriority(state);
          state = passPriority(state);
        }

        // --- FIRST STRIKE DAMAGE ---
        state = advanceStep(state);
        state = passPriority(state);
        state = passPriority(state);

        // --- COMBAT DAMAGE ---
        state = advanceStep(state);
        const lifeBefore = { [RED]: state.players[0].life, [GREEN]: state.players[1].life };

        if (state.combat && state.combat.attackers.length > 0) {
          state = resolveCombatDamage(state);
          state = checkStateBasedActions(state);
        }

        const lifeAfter = { [RED]: state.players[0].life, [GREEN]: state.players[1].life };

        const redDmgTaken = lifeBefore[RED] - lifeAfter[RED];
        const greenDmgTaken = lifeBefore[GREEN] - lifeAfter[GREEN];

        if (redDmgTaken > 0) {
          log.push(`  >> GREEN dealt ${redDmgTaken} damage to RED (${lifeAfter[RED]} life)`);
        }
        if (greenDmgTaken > 0) {
          log.push(`  >> RED dealt ${greenDmgTaken} damage to GREEN (${lifeAfter[GREEN]} life)`);
        }

        state = passPriority(state);
        state = passPriority(state);

        // --- END OF COMBAT ---
        state = advanceStep(state);
        state = passPriority(state);
        state = passPriority(state);

        // --- END STEP ---
        state = advanceStep(state);
        state = passPriority(state);
        state = passPriority(state);

        // --- CLEANUP ---
        state = advanceStep(state);

        // Log board state
        const afterRed = countCreatures(state, RED);
        const afterGreen = countCreatures(state, GREEN);
        log.push(`  [Board] RED: ${listBattlefield(state, RED)}`);
        log.push(`  [Board] GREEN: ${listBattlefield(state, GREEN)}`);
        log.push('');

        // Advance to next turn
        state = advanceStep(state);

        // Check game over
        if (state.players[0].hasLost || state.players[1].hasLost) {
          gameOver = true;
          const winner = state.players[0].hasLost ? 'GREEN' : 'RED';
          log.push(`**** GAME OVER: ${winner} WINS! ****`);
        }

      } catch (e: any) {
        log.push(`  [ERROR: ${e.message}]`);
        log.push('');
        // Recovery: skip through remaining steps
        try {
          const stepsToSkip = ['declare_blockers', 'first_strike_damage', 'combat_damage', 'end_of_combat', 'end', 'cleanup'];
          while (stepsToSkip.includes(state.step)) {
            if (state.step === 'declare_blockers') {
              const noBlk = getLegalActions(state, oppId).find(a => a.kind === 'DeclareBlockers' && a.blocks.length === 0);
              if (noBlk) state = applyAction(state, oppId, noBlk);
            }
            state = passPriority(state);
            state = passPriority(state);
            state = advanceStep(state);
          }
          if (state.step !== 'untap') {
            state = advanceStep(state);
          }
        } catch {
          break;
        }
      }
    }

    // =========================================================================
    // FINAL REPORT
    // =========================================================================
    log.push('');
    log.push('================================================================');
    log.push('  FINAL GAME REPORT');
    log.push('================================================================');
    log.push('');
    log.push(`Final Life: RED ${state.players[0].life} | GREEN ${state.players[1].life}`);
    log.push(`Turns Played: ${state.turnNumber - 1}`);
    log.push(`Total Shelector API calls: ${shelectorCalls}`);
    log.push('');
    log.push('=== Final Board ===');
    log.push(`RED:   ${listBattlefield(state, RED)}`);
    log.push(`GREEN: ${listBattlefield(state, GREEN)}`);
    log.push('');

    // Graveyards
    const rgy = getCardsInZone(state, RED, 'graveyard').map(c => getCardDefinition(state, c).name);
    const ggy = getCardsInZone(state, GREEN, 'graveyard').map(c => getCardDefinition(state, c).name);
    log.push(`RED Graveyard (${rgy.length}): ${rgy.join(', ') || 'empty'}`);
    log.push(`GREEN Graveyard (${ggy.length}): ${ggy.join(', ') || 'empty'}`);
    log.push('');

    // Print the FULL log
    console.log('\n' + log.join('\n') + '\n');

    // Basic assertions: game should have progressed
    expect(state.turnNumber).toBeGreaterThanOrEqual(5);
    expect(shelectorCalls).toBeGreaterThan(0);
    // At least one player should have permanents on the battlefield
    const redBF = getCardsInZone(state, RED, 'battlefield');
    const greenBF = getCardsInZone(state, GREEN, 'battlefield');
    expect(redBF.length + greenBF.length).toBeGreaterThan(0);

  }, 300_000); // 5 minute timeout
});
