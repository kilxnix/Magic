/**
 * Shelector Game 3: WHITE Tokens vs BLACK Removal
 *
 * Player 1 (WHITE): Token strategy commander + token generators + anthems
 * Player 2 (BLACK): Removal strategy commander with deathtouch + destroy/exile spells
 *
 * 30 turns max, both difficulty 4, full game log + analysis.
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

// ---------------------------------------------------------------------------
// Card Factories
// ---------------------------------------------------------------------------

function makePlains(name: string): ScryfallCard {
  return {
    id: name, name,
    type_line: 'Basic Land — Plains',
    oracle_text: '{T}: Add {W}.',
    mana_cost: '', cmc: 0, colors: [], color_identity: ['W'], keywords: [],
  };
}

function makeSwamp(name: string): ScryfallCard {
  return {
    id: name, name,
    type_line: 'Basic Land — Swamp',
    oracle_text: '{T}: Add {B}.',
    mana_cost: '', cmc: 0, colors: [], color_identity: ['B'], keywords: [],
  };
}

// ---- WHITE cards ----

function makeWhiteCommander(): ScryfallCard {
  return {
    id: 'white-cmd', name: 'Brimaz, King of Oreskos',
    type_line: 'Legendary Creature — Cat Soldier',
    oracle_text: 'Vigilance',
    mana_cost: '{1}{W}{W}', cmc: 3,
    colors: ['W'], color_identity: ['W'],
    keywords: ['Vigilance'],
    power: '3', toughness: '4',
  };
}

function makeTokenSpell(id: string, name: string, cost: string, cmc: number, count: number, subtype: string): ScryfallCard {
  const plural = count > 1 ? 's' : '';
  const article = count === 1 ? 'a' : `${count}`;
  return {
    id, name,
    type_line: 'Sorcery',
    oracle_text: `Create ${article} 1/1 white ${subtype} creature token${plural}.`,
    mana_cost: cost, cmc,
    colors: ['W'], color_identity: ['W'], keywords: [],
  };
}

function makeInstantTokenSpell(id: string, name: string, cost: string, cmc: number, count: number, subtype: string): ScryfallCard {
  const plural = count > 1 ? 's' : '';
  const article = count === 1 ? 'a' : `${count}`;
  return {
    id, name,
    type_line: 'Instant',
    oracle_text: `Create ${article} 1/1 white ${subtype} creature token${plural}.`,
    mana_cost: cost, cmc,
    colors: ['W'], color_identity: ['W'], keywords: [],
  };
}

function makeETBTokenCreature(id: string, name: string, cost: string, cmc: number, p: string, t: string, subtype: string): ScryfallCard {
  return {
    id, name,
    type_line: 'Creature — Human Knight',
    oracle_text: `When ${name} enters the battlefield, create a 1/1 white ${subtype} creature token.`,
    mana_cost: cost, cmc,
    colors: ['W'], color_identity: ['W'], keywords: [],
    power: p, toughness: t,
  };
}

function makeAnthem(id: string, name: string, cost: string, cmc: number): ScryfallCard {
  return {
    id, name,
    type_line: 'Enchantment',
    oracle_text: 'Creatures you control get +1/+1.',
    mana_cost: cost, cmc,
    colors: ['W'], color_identity: ['W'], keywords: [],
  };
}

function makeVanillaCreature(id: string, name: string, cost: string, cmc: number, p: string, t: string, keywords: string[] = []): ScryfallCard {
  return {
    id, name,
    type_line: 'Creature — Human Soldier',
    oracle_text: keywords.join('\n'),
    mana_cost: cost, cmc,
    colors: ['W'], color_identity: ['W'],
    keywords,
    power: p, toughness: t,
  };
}

// ---- BLACK cards ----

function makeBlackCommander(): ScryfallCard {
  return {
    id: 'black-cmd', name: 'Massacre Girl',
    type_line: 'Legendary Creature — Human Assassin',
    oracle_text: 'Deathtouch',
    mana_cost: '{3}{B}{B}', cmc: 5,
    colors: ['B'], color_identity: ['B'],
    keywords: ['Deathtouch'],
    power: '4', toughness: '4',
  };
}

function makeDestroySpell(id: string, name: string, cost: string, cmc: number): ScryfallCard {
  return {
    id, name,
    type_line: 'Instant',
    oracle_text: 'Destroy target creature.',
    mana_cost: cost, cmc,
    colors: ['B'], color_identity: ['B'], keywords: [],
  };
}

function makeExileSpell(id: string, name: string, cost: string, cmc: number): ScryfallCard {
  return {
    id, name,
    type_line: 'Instant',
    oracle_text: 'Exile target creature.',
    mana_cost: cost, cmc,
    colors: ['B'], color_identity: ['B'], keywords: [],
  };
}

function makeDeathtouchCreature(id: string, name: string, cost: string, cmc: number, p: string, t: string, extraKw: string[] = []): ScryfallCard {
  const kw = ['Deathtouch', ...extraKw];
  return {
    id, name,
    type_line: 'Creature — Vampire',
    oracle_text: kw.join('\n'),
    mana_cost: cost, cmc,
    colors: ['B'], color_identity: ['B'],
    keywords: kw,
    power: p, toughness: t,
  };
}

function makeDrainSpell(): ScryfallCard {
  return {
    id: 'drain-1', name: 'Tendrils of Agony',
    type_line: 'Sorcery',
    oracle_text: 'Each opponent loses 2 life.',
    mana_cost: '{2}{B}{B}', cmc: 4,
    colors: ['B'], color_identity: ['B'], keywords: [],
  };
}

// ---------------------------------------------------------------------------
// Deck construction
// ---------------------------------------------------------------------------

function buildCardDatabase(): ScryfallCard[] {
  const cards: ScryfallCard[] = [];

  // Commanders
  cards.push(makeWhiteCommander());
  cards.push(makeBlackCommander());

  // WHITE: 8 token spells, 3 ETB token creatures, 3 anthems, 6 creatures = 20 non-land
  cards.push(makeInstantTokenSpell('w-tk1', 'Raise the Alarm', '{1}{W}', 2, 2, 'Soldier'));
  cards.push(makeTokenSpell('w-tk2', 'Spectral Procession', '{2}{W}', 3, 3, 'Spirit'));
  cards.push(makeTokenSpell('w-tk3', 'Captains Call', '{3}{W}', 4, 3, 'Soldier'));
  cards.push(makeTokenSpell('w-tk4', 'Sworn Companions', '{2}{W}', 3, 2, 'Soldier'));
  cards.push(makeTokenSpell('w-tk5', 'Triplicate Spirits', '{4}{W}', 5, 3, 'Spirit'));
  cards.push(makeInstantTokenSpell('w-tk6', 'Midnight Haunting', '{2}{W}', 3, 2, 'Spirit'));
  cards.push(makeTokenSpell('w-tk7', 'Battle Screech', '{2}{W}{W}', 4, 2, 'Bird'));
  cards.push(makeTokenSpell('w-tk8', 'Secure the Wastes', '{1}{W}', 2, 2, 'Warrior'));

  cards.push(makeETBTokenCreature('w-etb1', 'Attended Knight', '{2}{W}', 3, '2', '2', 'Soldier'));
  cards.push(makeETBTokenCreature('w-etb2', 'Blade Splicer', '{2}{W}', 3, '1', '1', 'Golem'));
  cards.push(makeETBTokenCreature('w-etb3', 'Seller of Songbirds', '{2}{W}', 3, '1', '2', 'Bird'));

  cards.push(makeAnthem('w-an1', 'Glorious Anthem', '{1}{W}{W}', 3));
  cards.push(makeAnthem('w-an2', 'Honor of the Pure', '{1}{W}', 2));
  cards.push(makeAnthem('w-an3', 'Spear of Heliod', '{1}{W}{W}', 3));

  cards.push(makeVanillaCreature('w-c1', 'Savannah Lions', '{W}', 1, '2', '1'));
  cards.push(makeVanillaCreature('w-c2', 'Elite Vanguard', '{W}', 1, '2', '1'));
  cards.push(makeVanillaCreature('w-c3', 'White Knight', '{W}{W}', 2, '2', '2', ['First Strike']));
  cards.push(makeVanillaCreature('w-c4', 'Leonin Skyhunter', '{W}{W}', 2, '2', '2', ['Flying']));
  cards.push(makeVanillaCreature('w-c5', 'Precinct Captain', '{W}{W}', 2, '2', '2'));
  cards.push(makeVanillaCreature('w-c6', 'Boros Elite', '{W}', 1, '1', '1'));

  // BLACK: 10 removal spells, 2 drain, 8 deathtouch creatures = 20 non-land
  cards.push(makeDestroySpell('b-rm1', 'Murder', '{1}{B}{B}', 3));
  cards.push(makeDestroySpell('b-rm2', 'Go for the Throat', '{1}{B}', 2));
  cards.push(makeDestroySpell('b-rm3', 'Doom Blade', '{1}{B}', 2));
  cards.push(makeDestroySpell('b-rm4', 'Victim of Night', '{B}{B}', 2));
  cards.push(makeExileSpell('b-rm5', 'Snuff Out', '{3}{B}', 4));
  cards.push(makeDestroySpell('b-rm6', 'Cast Down', '{1}{B}', 2));
  cards.push(makeDestroySpell('b-rm7', 'Infernal Grasp', '{1}{B}', 2));
  cards.push(makeDestroySpell('b-rm8', 'Power Word Kill', '{1}{B}', 2));
  cards.push(makeDestroySpell('b-rm9', 'Walk the Plank', '{B}{B}', 2));
  cards.push(makeExileSpell('b-rm10', 'Swords to Exile', '{2}{B}', 3));
  cards.push(makeDrainSpell());
  // Second drain spell
  cards.push({
    id: 'drain-2', name: 'Blood Tithe',
    type_line: 'Sorcery',
    oracle_text: 'Each opponent loses 3 life.',
    mana_cost: '{3}{B}', cmc: 4,
    colors: ['B'], color_identity: ['B'], keywords: [],
  });

  cards.push(makeDeathtouchCreature('b-dt1', 'Typhoid Rats', '{B}', 1, '1', '1'));
  cards.push(makeDeathtouchCreature('b-dt2', 'Vampire of the Dire Moon', '{B}', 1, '1', '1', ['Lifelink']));
  cards.push(makeDeathtouchCreature('b-dt3', 'Gifted Aetherborn', '{B}{B}', 2, '2', '3', ['Lifelink']));
  cards.push(makeDeathtouchCreature('b-dt4', 'Nighthawk Scavenger', '{1}{B}{B}', 3, '3', '3', ['Flying', 'Lifelink']));
  cards.push(makeDeathtouchCreature('b-dt5', 'Nirkana Assassin', '{2}{B}', 3, '2', '3'));
  cards.push(makeDeathtouchCreature('b-dt6', 'Hired Poisoner', '{B}', 1, '1', '1'));
  cards.push(makeDeathtouchCreature('b-dt7', 'Pharika Chosen', '{B}', 1, '1', '1'));
  cards.push(makeDeathtouchCreature('b-dt8', 'Mire Triton', '{1}{B}', 2, '2', '1'));

  // Lands (99 - 20 = 79 each)
  for (let i = 0; i < 79; i++) cards.push(makePlains(`Plains-${i}`));
  for (let i = 0; i < 79; i++) cards.push(makeSwamp(`Swamp-${i}`));

  return cards;
}

function buildWhiteDeck(): { commander: string; list: string[] } {
  // 20 non-land + 79 Plains = 99
  const list: string[] = [
    // 8 token spells
    'Raise the Alarm', 'Spectral Procession', 'Captains Call',
    'Sworn Companions', 'Triplicate Spirits', 'Midnight Haunting',
    'Battle Screech', 'Secure the Wastes',
    // 3 ETB token creatures
    'Attended Knight', 'Blade Splicer', 'Seller of Songbirds',
    // 3 anthems
    'Glorious Anthem', 'Honor of the Pure', 'Spear of Heliod',
    // 6 creatures
    'Savannah Lions', 'Elite Vanguard', 'White Knight',
    'Leonin Skyhunter', 'Precinct Captain', 'Boros Elite',
  ];
  for (let i = 0; i < 79; i++) list.push(`Plains-${i}`);
  return { commander: 'Brimaz, King of Oreskos', list };
}

function buildBlackDeck(): { commander: string; list: string[] } {
  // 20 non-land + 79 Swamps = 99
  const list: string[] = [
    // 10 removal spells
    'Murder', 'Go for the Throat', 'Doom Blade', 'Victim of Night', 'Snuff Out',
    'Cast Down', 'Infernal Grasp', 'Power Word Kill', 'Walk the Plank', 'Swords to Exile',
    // 2 drain spells
    'Tendrils of Agony', 'Blood Tithe',
    // 8 deathtouch creatures
    'Typhoid Rats', 'Vampire of the Dire Moon', 'Gifted Aetherborn',
    'Nighthawk Scavenger', 'Nirkana Assassin', 'Hired Poisoner',
    'Pharika Chosen', 'Mire Triton',
  ];
  for (let i = 0; i < 79; i++) list.push(`Swamp-${i}`);
  return { commander: 'Massacre Girl', list };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type GS = ReturnType<typeof initGameFromDecks>;

function countCreatures(state: GS, pid: string): number {
  return getCardsInZone(state, pid, 'battlefield')
    .filter(c => getCardDefinition(state, c).card_types.includes('creature')).length;
}

function countTokens(state: GS, pid: string): number {
  return getCardsInZone(state, pid, 'battlefield')
    .filter(c => {
      const def = getCardDefinition(state, c);
      return def.card_types.includes('creature') && (c.isToken || def.id.startsWith('token_'));
    }).length;
}

function totalCreaturesBF(state: GS): number {
  let n = 0;
  for (const c of state.cards.values()) {
    if (c.zone !== 'battlefield') continue;
    const def = state.cardDefinitions.get(c.definitionId);
    if (def?.card_types.includes('creature')) n++;
  }
  return n;
}

/** Spell priority heuristic for smart casting.
 *  isCommander flag helps deprioritize expensive commander recasts. */
function spellPriority(
  def: { oracle_text: string; card_types: string[]; name: string; cmc: number; keywords: string[] } | undefined,
  isCommander: boolean = false,
): number {
  if (!def) return 0;
  const text = def.oracle_text.toLowerCase();

  // Removal is highest (for BLACK)
  if (text.includes('destroy target') || text.includes('exile target')) return 200;

  // Token spells (for WHITE) -- more tokens = higher priority
  if (text.includes('create') && text.includes('token')) {
    const match = text.match(/create (\d+|a|an|two|three|four)/);
    let count = 1;
    if (match) {
      if (match[1] === 'two' || match[1] === '2') count = 2;
      else if (match[1] === 'three' || match[1] === '3') count = 3;
      else if (match[1] === 'four' || match[1] === '4') count = 4;
      else { const n = parseInt(match[1]); if (!isNaN(n)) count = n; }
    }
    return 150 + count * 10; // 3-token spell = 180, 2-token = 170
  }

  // ETB token creatures are great
  if (text.includes('enters the battlefield') && text.includes('token')) return 160;

  // Anthems
  if (text.includes('creatures you control get')) return 140;

  // Regular creatures -- prefer cheap creatures over expensive ones
  if (def.card_types.includes('creature')) {
    // Commander recast gets lower priority (save mana for token spells)
    if (isCommander) return 40;
    return 100 - def.cmc * 5; // cheaper = better, 1-drop=95, 3-drop=85
  }

  // Drain
  if (text.includes('loses') && text.includes('life')) return 80;

  return 50;
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------

describe('Shelector Game 3: WHITE Tokens vs BLACK Removal (30 turns)', () => {
  it('plays a full game and analyzes tokens vs removal', () => {
    resetInstanceCounter();

    const allCards = buildCardDatabase();
    const lookup = createCardLookup(allCards);
    const whiteDeck = buildWhiteDeck();
    const blackDeck = buildBlackDeck();

    let state = initGameFromDecks({
      humanDeck: {
        id: 'white-deck', commander: whiteDeck.commander,
        list: whiteDeck.list, colors: ['W'], bracket: 4, theme: 'Tokens',
      },
      aiDecks: [{
        id: 'black-deck', commander: blackDeck.commander,
        list: blackDeck.list, colors: ['B'], bracket: 4, theme: 'Removal',
      }],
      aiDifficulty: 4,
      cardLookup: lookup,
      humanGoesFirst: true,
      startingLife: 40,
      startingHandSize: 7,
    });

    const W = 'human';
    const B = 'ai1';
    const log: string[] = [];

    // Stats
    let tokensCreated = 0;
    let creaturesDied = 0;
    let removalCast = 0;
    let totalAttacks = 0;
    const dmgDealt: Record<string, number> = { [W]: 0, [B]: 0 };
    const boardHistory: { w: number; b: number }[] = [];

    log.push('========================================================');
    log.push('  SHELECTOR GAME 3: WHITE TOKENS vs BLACK REMOVAL');
    log.push('========================================================');
    log.push('');
    log.push(`WHITE Commander: ${whiteDeck.commander} (3/4, Vigilance)`);
    log.push(`BLACK Commander: ${blackDeck.commander} (4/4, Deathtouch)`);
    log.push('Both players: Difficulty 4 (Smart AI) | 40 life | 30-turn max');
    log.push('');
    log.push('WHITE strategy: Create tokens, anthems for +1/+1, swarm the board');
    log.push('BLACK strategy: Deathtouch creatures trade up, removal spells pick off threats');
    log.push('');
    log.push('--- GAME BEGIN ---');
    log.push('');

    const MAX_HALF_TURNS = 60;
    let gameOver = false;

    for (let ht = 0; ht < MAX_HALF_TURNS && !gameOver; ht++) {
      const activeId = state.players[state.activePlayerIndex].id;
      const isW = activeId === W;
      const label = isW ? 'WHITE' : 'BLACK';
      const oppId = isW ? B : W;
      const acts: string[] = [];

      const prevW = countCreatures(state, W);
      const prevB = countCreatures(state, B);

      log.push(`=== Turn ${state.turnNumber} [${label}] | W: ${state.players[0].life} hp, ${prevW} creatures | B: ${state.players[1].life} hp, ${prevB} creatures ===`);

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
        state = advanceStep(state); // -> begin_combat (precombat_main)

        // --- MAIN PHASE 1 ---
        // Show hand contents (non-land cards only)
        {
          const handCards = getCardsInZone(state, activeId, 'hand');
          const nonLandHand = handCards
            .filter(c => !getCardDefinition(state, c).card_types.includes('land'))
            .map(c => getCardDefinition(state, c).name);
          if (nonLandHand.length > 0) {
            acts.push(`Hand: [${nonLandHand.join(', ')}]`);
          }
        }

        // Play a land
        {
          const la = getLegalActions(state, activeId).find(a => a.kind === 'PlayLand');
          if (la) {
            state = applyAction(state, activeId, la);
            const ld = state.cards.get(la.cardInstanceId);
            acts.push(`Played ${ld ? getCardDefinition(state, ld).name : 'land'}`);
          }
        }

        // Smart casting: Tap all mana first, then cast highest-priority spells.
        // This ensures we always have max mana available when choosing what to cast.
        {
          // Step 1: Tap ALL available mana sources
          let manaActions = getLegalActions(state, activeId).filter(a => a.kind === 'ActivateManaAbility');
          for (const m of manaActions) {
            try { state = applyAction(state, activeId, m); } catch { /* already tapped */ }
          }

          // Step 2: Cast spells in priority order until out of mana
          for (let attempt = 0; attempt < 6; attempt++) {
            const actions = getLegalActions(state, activeId);
            const casts = actions.filter(a => a.kind === 'CastSpell');
            if (casts.length === 0) break;

            // Sort by priority -- removal > tokens > anthems > creatures > commander
            casts.sort((a, b) => {
              const ca = state.cards.get(a.cardInstanceId);
              const cb = state.cards.get(b.cardInstanceId);
              const da = ca ? getCardDefinition(state, ca) : undefined;
              const db = cb ? getCardDefinition(state, cb) : undefined;
              const pa = spellPriority(da, ca?.isCommander || false);
              const pb = spellPriority(db, cb?.isCommander || false);
              return pb - pa;
            });

            const spell = casts[0];
            const sc = state.cards.get(spell.cardInstanceId);
            const sd = sc ? getCardDefinition(state, sc) : undefined;
            const sname = sd?.name || 'a spell';
            const isRemoval = sd && (sd.oracle_text.toLowerCase().includes('destroy target')
                                  || sd.oracle_text.toLowerCase().includes('exile target'));
            const isTokenSpell = sd && sd.oracle_text.toLowerCase().includes('create')
                              && sd.oracle_text.toLowerCase().includes('token');

            try {
              const tokensBefore = countTokens(state, W) + countTokens(state, B);
              const creaturesBefore = countCreatures(state, W) + countCreatures(state, B);

              state = applyAction(state, activeId, spell);
              // Pass priority and resolve stack
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

              const tokensAfter = countTokens(state, W) + countTokens(state, B);
              const creaturesAfter = countCreatures(state, W) + countCreatures(state, B);
              const newTk = tokensAfter - tokensBefore;
              const creaturesLost = creaturesBefore - creaturesAfter;

              if (isRemoval) {
                removalCast++;
                // Try to identify target
                let targetName = 'a creature';
                if (creaturesLost > 0) {
                  targetName = `killed ${creaturesLost} creature(s)`;
                } else if (spell.targets?.[0]) {
                  const tc = state.cards.get(spell.targets[0]);
                  targetName = tc ? getCardDefinition(state, tc).name : spell.targets[0];
                }
                acts.push(`** REMOVAL: ${sname} -> ${targetName}`);
              } else if (newTk > 0) {
                tokensCreated += newTk;
                acts.push(`** TOKENS: ${sname} -> ${newTk} new token(s) created!`);
              } else if (isTokenSpell) {
                acts.push(`Cast ${sname} (token spell)`);
              } else {
                acts.push(`Cast ${sname}`);
              }
            } catch (e: any) {
              acts.push(`[CAST FAIL: ${sname} - ${e.message}]`);
              break;
            }
          }
        }

        // Pass through main phase
        state = passPriority(state);
        state = passPriority(state);
        state = advanceStep(state); // -> declare_attackers

        // --- COMBAT: DECLARE ATTACKERS ---
        {
          const atkOptions = getLegalActions(state, activeId)
            .filter(a => a.kind === 'DeclareAttackers');
          const realAtks = atkOptions.filter(a => a.attacks.length > 0);

          if (realAtks.length > 0) {
            // Pick the alpha strike (all creatures)
            const best = realAtks.reduce((b, c) => c.attacks.length > b.attacks.length ? c : b);
            state = applyAction(state, activeId, best);
            totalAttacks++;

            const names = best.attacks.map(a => {
              const c = state.cards.get(a.cardInstanceId);
              const d = c ? getCardDefinition(state, c) : undefined;
              const kw = d?.keywords.length ? ` [${d.keywords.join(',')}]` : '';
              return `${d?.name || '?'}(${d?.power}/${d?.toughness})${kw}`;
            });
            acts.push(`Attacked with ${best.attacks.length}: ${names.join(', ')}`);
          } else {
            const noAtk = atkOptions.find(a => a.attacks.length === 0);
            if (noAtk) state = applyAction(state, activeId, noAtk);
          }
          state = passPriority(state);
          state = passPriority(state);
        }

        // --- COMBAT: DECLARE BLOCKERS ---
        state = advanceStep(state);
        if (state.step === 'declare_blockers') {
          const defendId = isW ? B : W;
          const blkOptions = getLegalActions(state, defendId)
            .filter(a => a.kind === 'DeclareBlockers');

          if (blkOptions.length > 0) {
            // Prefer blocking strategies: deathtouch blockers are most valuable
            // Try each option, pick the one with highest "value"
            let bestIdx = 0;
            let bestScore = -1;
            for (let i = 0; i < blkOptions.length; i++) {
              let score = 0;
              for (const b of blkOptions[i].blocks) {
                const bc = state.cards.get(b.cardInstanceId);
                const bd = bc ? getCardDefinition(state, bc) : undefined;
                // Deathtouch blocker = guaranteed kill = high value
                if (bd?.keywords.includes('Deathtouch')) score += 20;
                else score += (bd?.power ?? 0) + (bd?.toughness ?? 0);
              }
              if (score > bestScore) { bestScore = score; bestIdx = i; }
            }

            const chosen = blkOptions[bestIdx];
            try {
              state = applyAction(state, defendId, chosen);
              if (chosen.blocks.length > 0) {
                const bnames = chosen.blocks.map(b => {
                  const c = state.cards.get(b.cardInstanceId);
                  const d = c ? getCardDefinition(state, c) : undefined;
                  const atk = state.cards.get(b.blockingAttackerId);
                  const ad = atk ? getCardDefinition(state, atk) : undefined;
                  return `${d?.name || '?'} blocks ${ad?.name || '?'}`;
                });
                acts.push(`Blocks: ${bnames.join('; ')}`);
              }
            } catch {
              // If blocking fails, declare no blocks
              const noBlk = blkOptions.find(b => b.blocks.length === 0);
              if (noBlk) {
                try { state = applyAction(state, defendId, noBlk); } catch { /* ok */ }
              }
            }
          }
          state = passPriority(state);
          state = passPriority(state);

          // --- FIRST STRIKE DAMAGE ---
          state = advanceStep(state);
          state = passPriority(state);
          state = passPriority(state);

          // --- COMBAT DAMAGE ---
          state = advanceStep(state);
          const wLifePre = state.players[0].life;
          const bLifePre = state.players[1].life;

          if (state.combat && state.combat.attackers.length > 0) {
            state = resolveCombatDamage(state);
            state = checkStateBasedActions(state);
          }

          const wLifePost = state.players[0].life;
          const bLifePost = state.players[1].life;

          // Track life changes (could be positive from lifelink)
          const bLifeChange = bLifePre - bLifePost; // positive = lost life
          const wLifeChange = wLifePre - wLifePost; // positive = lost life

          if (bLifeChange > 0) {
            dmgDealt[W] += bLifeChange;
            acts.push(`>> WHITE dealt ${bLifeChange} damage to BLACK (${bLifePost} life)`);
          } else if (bLifeChange < 0) {
            acts.push(`>> BLACK gained ${-bLifeChange} life from lifelink (${bLifePost} life)`);
          }
          if (wLifeChange > 0) {
            dmgDealt[B] += wLifeChange;
            acts.push(`>> BLACK dealt ${wLifeChange} damage to WHITE (${wLifePost} life)`);
          } else if (wLifeChange < 0) {
            acts.push(`>> WHITE gained ${-wLifeChange} life from lifelink (${wLifePost} life)`);
          }

          state = passPriority(state);
          state = passPriority(state);
        }

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

        // Track creatures lost
        const afterW = countCreatures(state, W);
        const afterB = countCreatures(state, B);
        const wLost = prevW - afterW;
        const bLost = prevB - afterB;
        // Creatures could have been added too, so only count positive losses
        if (wLost > 0) { creaturesDied += wLost; acts.push(`${wLost} WHITE creature(s) died`); }
        if (bLost > 0) { creaturesDied += bLost; acts.push(`${bLost} BLACK creature(s) died`); }

        const wTokens = countTokens(state, W);
        boardHistory.push({ w: afterW, b: afterB });

        // Log turn actions
        for (const a of acts) log.push(`  ${a}`);
        log.push(`  [Board] W: ${afterW} creatures (${wTokens} tokens) | B: ${afterB} creatures`);
        log.push('');

        // Advance to next turn if cleanup was the last step reached. Empty
        // combat can already put us at the next turn after the cleanup advance.
        if (state.step === 'cleanup') {
          state = advanceStep(state);
        }

        // Check game over
        if (state.players[0].hasLost || state.players[1].hasLost) {
          gameOver = true;
          const winner = state.players[0].hasLost ? 'BLACK' : 'WHITE';
          const loser = state.players[0].hasLost ? 'WHITE' : 'BLACK';
          log.push(`**** GAME OVER: ${winner} WINS! ${loser} eliminated (${state.players[0].hasLost ? state.players[0].life : state.players[1].life} life) ****`);
        }

      } catch (e: any) {
        acts.push(`[ERROR: ${e.message}]`);
        for (const a of acts) log.push(`  ${a}`);
        log.push('');
        // Recover: advance through remaining steps
        try {
          const stepsToSkip = ['declare_blockers','first_strike_damage','combat_damage','end_of_combat','end','cleanup'];
          while (stepsToSkip.includes(state.step)) {
            if (state.step === 'declare_blockers') {
              // Declare no blocks
              const defendId = isW ? B : W;
              const noBlk = getLegalActions(state, defendId).find(a => a.kind === 'DeclareBlockers' && a.blocks.length === 0);
              if (noBlk) state = applyAction(state, defendId, noBlk);
            }
            state = passPriority(state);
            state = passPriority(state);
            state = advanceStep(state);
          }
          if (state.step === 'untap') {
            // Already at next turn, good
          } else {
            state = advanceStep(state); // force next
          }
        } catch {
          break; // Give up
        }
        boardHistory.push({ w: countCreatures(state, W), b: countCreatures(state, B) });
      }
    }

    // =========================================================================
    // FINAL REPORT
    // =========================================================================
    log.push('');
    log.push('========================================================');
    log.push('  FINAL GAME ANALYSIS');
    log.push('========================================================');
    log.push('');

    const wLife = state.players[0].life;
    const bLife = state.players[1].life;

    log.push(`Final Life: WHITE ${wLife} | BLACK ${bLife}`);
    log.push(`Turns Played: ${state.turnNumber - 1}`);
    log.push('');

    const fwc = countCreatures(state, W);
    const fbc = countCreatures(state, B);
    const fwt = countTokens(state, W);
    const fwl = getCardsInZone(state, W, 'battlefield').filter(c => getCardDefinition(state, c).card_types.includes('land')).length;
    const fbl = getCardsInZone(state, B, 'battlefield').filter(c => getCardDefinition(state, c).card_types.includes('land')).length;

    log.push('=== Final Board ===');
    log.push(`WHITE: ${fwc} creatures (${fwt} tokens), ${fwl} lands`);
    log.push(`BLACK: ${fbc} creatures, ${fbl} lands`);

    // List creatures
    for (const pid of [W, B]) {
      const creatures = getCardsInZone(state, pid, 'battlefield')
        .filter(c => getCardDefinition(state, c).card_types.includes('creature'))
        .map(c => {
          const d = getCardDefinition(state, c);
          const kw = d.keywords.length > 0 ? ` [${d.keywords.join(', ')}]` : '';
          return `${d.name} (${d.power}/${d.toughness})${kw}`;
        });
      if (creatures.length > 0) {
        log.push(`  ${pid === W ? 'WHITE' : 'BLACK'}: ${creatures.join(', ')}`);
      }
    }
    log.push('');

    // Graveyards
    const wgy = getCardsInZone(state, W, 'graveyard');
    const bgy = getCardsInZone(state, B, 'graveyard');
    log.push('=== Graveyards ===');
    log.push(`WHITE GY (${wgy.length}): ${wgy.map(c => getCardDefinition(state, c).name).join(', ') || 'empty'}`);
    log.push(`BLACK GY (${bgy.length}): ${bgy.map(c => getCardDefinition(state, c).name).join(', ') || 'empty'}`);
    log.push('');

    // Stats
    log.push('=== Statistics ===');
    log.push(`Tokens Created by WHITE: ${tokensCreated}`);
    log.push(`Total Creatures Died: ${creaturesDied}`);
    log.push(`Removal Spells Cast by BLACK: ${removalCast}`);
    log.push(`Total Attack Phases: ${totalAttacks}`);
    log.push(`Combat Damage Dealt by WHITE: ${dmgDealt[W]}`);
    log.push(`Combat Damage Dealt by BLACK: ${dmgDealt[B]}`);
    log.push('');

    // Board timeline
    log.push('=== Board Presence Timeline ===');
    for (let i = 0; i < boardHistory.length; i++) {
      const wBar = '#'.repeat(Math.min(boardHistory[i].w, 20));
      const bBar = '#'.repeat(Math.min(boardHistory[i].b, 20));
      log.push(`  T${(i+1).toString().padStart(2,'0')}: W[${wBar.padEnd(20)}]${boardHistory[i].w.toString().padStart(3)} | B[${bBar.padEnd(20)}]${boardHistory[i].b.toString().padStart(3)}`);
    }
    log.push('');

    // Verdict
    log.push('=== VERDICT ===');
    const wLost = state.players[0].hasLost;
    const bLost = state.players[1].hasLost;

    if (wLost) {
      log.push('WINNER: BLACK (Removal/Deathtouch Strategy)');
      log.push('');
      log.push('Analysis: BLACK\'s removal suite and deathtouch creatures kept the');
      log.push('board clear. Deathtouch creates a "wall" that makes attacking unprofitable');
      log.push('for the token player -- any attacker that gets blocked dies regardless');
      log.push('of toughness. Combined with instant-speed removal picking off key threats,');
      log.push('BLACK prevented WHITE from ever reaching critical mass.');
    } else if (bLost) {
      log.push('WINNER: WHITE (Token Strategy)');
      log.push('');
      log.push('Analysis: Token generation overwhelmed BLACK\'s 1-for-1 removal. Each token');
      log.push('spell creates 2-3 creatures while each removal spell only answers one.');
      log.push('This card economy advantage means WHITE inevitably builds a board faster');
      log.push('than BLACK can answer it. Anthems made even 1/1 tokens into real threats.');
    } else if (wLife > bLife) {
      log.push(`ADVANTAGE: WHITE (${wLife} vs ${bLife} life)`);
      log.push('');
      if (fwc > fbc + 2) {
        log.push('Analysis: Tokens overwhelmed removal! The fundamental math problem for');
        log.push('BLACK is that 1-for-1 removal cannot keep up with spells that create');
        log.push(`2-3 tokens each. WHITE created ${tokensCreated} tokens while BLACK only`);
        log.push(`cast ${removalCast} removal spells. Even deathtouch blockers can only`);
        log.push('trade with one attacker per combat.');
      } else {
        log.push('Analysis: Close game. Both strategies had moments, but WHITE\'s token');
        log.push('swarm eventually pushed through enough damage. Anthems turned 1/1 tokens');
        log.push('into real threats that demanded answers BLACK didn\'t always have.');
      }
    } else if (bLife > wLife) {
      log.push(`ADVANTAGE: BLACK (${bLife} vs ${wLife} life)`);
      log.push('');
      log.push('Analysis: Removal and deathtouch created a defensive wall. BLACK\'s lifelink');
      log.push('vampires recovered life lost in combat while deathtouch made blocking');
      log.push('extremely efficient -- every 1/1 deathtouch creature trades with any attacker.');
      log.push(`BLACK cast ${removalCast} removal spells to handle the biggest threats.`);
    } else {
      log.push('RESULT: DRAW (equal life totals)');
      log.push('');
      log.push('Analysis: Perfect balance between token creation and removal. Neither');
      log.push('strategy gained a decisive edge. This is the classic tension in Magic:');
      log.push('go-wide vs removal -- and here they cancelled out.');
    }

    log.push('');
    log.push('KEY TAKEAWAY: In Commander, token strategies generate card advantage');
    log.push(`(${tokensCreated} tokens from fewer cards) while removal is inherently`);
    log.push('1-for-1. The question is whether removal + deathtouch blockers can');
    log.push('buy enough time to deal lethal through combat.');
    log.push('');
    log.push('========================================================');

    // Print full log
    console.log('\n' + log.join('\n'));

    // Assertions
    expect(state.turnNumber).toBeGreaterThan(5);
    expect(wLife + bLife).toBeLessThanOrEqual(80);
    expect(totalAttacks).toBeGreaterThan(0);
  });
});
