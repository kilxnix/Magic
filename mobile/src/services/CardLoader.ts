/**
 * CardLoader
 *
 * Creates sample decks for testing. In the final version, this will
 * load decks from the deck generator or saved games.
 */

import type { DeckInput, CardDefinition } from '@/types';

// Sample card definitions for testing
function createBasicLand(name: string, color: 'W' | 'U' | 'B' | 'R' | 'G'): CardDefinition {
  const typeMap = {
    W: 'Plains',
    U: 'Island',
    B: 'Swamp',
    R: 'Mountain',
    G: 'Forest',
  };

  return {
    id: name.toLowerCase().replace(/\s/g, '-'),
    name,
    type_line: `Basic Land — ${typeMap[color]}`,
    oracle_text: `{T}: Add {${color}}.`,
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [color],
    keywords: [],
    card_types: ['land'],
  };
}

function createVanillaCreature(
  name: string,
  cost: string,
  power: number,
  toughness: number,
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G'>
): CardDefinition {
  // Calculate CMC from cost
  let cmc = 0;
  const matches = cost.match(/\{(\w)\}/g) || [];
  for (const m of matches) {
    const symbol = m.replace(/[{}]/g, '');
    if (/^\d+$/.test(symbol)) {
      cmc += parseInt(symbol);
    } else {
      cmc += 1;
    }
  }

  return {
    id: name.toLowerCase().replace(/\s/g, '-'),
    name,
    type_line: 'Creature',
    oracle_text: '',
    mana_cost: cost,
    cmc,
    colors,
    color_identity: colors,
    keywords: [],
    power,
    toughness,
    card_types: ['creature'],
  };
}

function createCommander(
  name: string,
  cost: string,
  power: number,
  toughness: number,
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G'>,
  text: string
): CardDefinition {
  let cmc = 0;
  const matches = cost.match(/\{(\w)\}/g) || [];
  for (const m of matches) {
    const symbol = m.replace(/[{}]/g, '');
    if (/^\d+$/.test(symbol)) {
      cmc += parseInt(symbol);
    } else {
      cmc += 1;
    }
  }

  return {
    id: name.toLowerCase().replace(/\s/g, '-'),
    name,
    type_line: 'Legendary Creature',
    oracle_text: text,
    mana_cost: cost,
    cmc,
    colors,
    color_identity: colors,
    keywords: [],
    power,
    toughness,
    card_types: ['creature'],
  };
}

// Create a simple test deck
function createTestDeck(playerId: string, playerName: string, color: 'W' | 'U' | 'B' | 'R' | 'G'): DeckInput {
  const colorNames = {
    W: 'White',
    U: 'Blue',
    B: 'Black',
    R: 'Red',
    G: 'Green',
  };

  const commander = createCommander(
    `${playerName}'s Commander`,
    `{3}{${color}}{${color}}`,
    4,
    4,
    [color],
    'When this creature enters the battlefield, draw a card.'
  );

  const cards: CardDefinition[] = [commander];

  // Add basic lands (36)
  for (let i = 0; i < 36; i++) {
    cards.push(createBasicLand(`${colorNames[color]} Land ${i + 1}`, color));
  }

  // Add vanilla creatures at various costs
  const creatureNames = [
    'Eager Squire',
    'Patrol Knight',
    'Town Guard',
    'Veteran Soldier',
    'Elite Champion',
    'Ancient Protector',
  ];

  // 2-drops (8)
  for (let i = 0; i < 8; i++) {
    cards.push(createVanillaCreature(
      `${creatureNames[0]} ${i + 1}`,
      `{1}{${color}}`,
      2,
      2,
      [color]
    ));
  }

  // 3-drops (8)
  for (let i = 0; i < 8; i++) {
    cards.push(createVanillaCreature(
      `${creatureNames[1]} ${i + 1}`,
      `{2}{${color}}`,
      3,
      3,
      [color]
    ));
  }

  // 4-drops (6)
  for (let i = 0; i < 6; i++) {
    cards.push(createVanillaCreature(
      `${creatureNames[2]} ${i + 1}`,
      `{3}{${color}}`,
      4,
      3,
      [color]
    ));
  }

  // 5-drops (4)
  for (let i = 0; i < 4; i++) {
    cards.push(createVanillaCreature(
      `${creatureNames[3]} ${i + 1}`,
      `{4}{${color}}`,
      4,
      4,
      [color]
    ));
  }

  // 6-drops (2)
  for (let i = 0; i < 2; i++) {
    cards.push(createVanillaCreature(
      `${creatureNames[4]} ${i + 1}`,
      `{5}{${color}}`,
      5,
      5,
      [color]
    ));
  }

  return {
    playerId,
    name: `${playerName}'s ${colorNames[color]} Deck`,
    cards,
    commanderId: commander.id,
  };
}

export interface PlayerDeckConfig {
  playerId: string;
  playerName: string;
}

export function createSampleDecks(players: PlayerDeckConfig[]): DeckInput[] {
  const colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = ['W', 'U', 'B', 'R', 'G'];

  return players.map((player, index) => {
    const color = colors[index % colors.length];
    return createTestDeck(player.playerId, player.playerName, color);
  });
}
