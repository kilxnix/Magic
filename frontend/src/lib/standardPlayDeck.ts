import type { CardDataFromAPI, ImportedCards } from '../hooks/useShelectorGame';

const BASIC_LAND_DATA: Record<string, CardDataFromAPI> = {
  Plains: card('Plains', 'Basic Land - Plains', '', 0, [], ['W'], null, null, '({T}: Add {W}.)'),
  Island: card('Island', 'Basic Land - Island', '', 0, [], ['U'], null, null, '({T}: Add {U}.)'),
  Swamp: card('Swamp', 'Basic Land - Swamp', '', 0, [], ['B'], null, null, '({T}: Add {B}.)'),
  Mountain: card('Mountain', 'Basic Land - Mountain', '', 0, [], ['R'], null, null, '({T}: Add {R}.)'),
  Forest: card('Forest', 'Basic Land - Forest', '', 0, [], ['G'], null, null, '({T}: Add {G}.)'),
  'Snow-Covered Plains': card('Snow-Covered Plains', 'Basic Snow Land - Plains', '', 0, [], ['W'], null, null, '({T}: Add {W}.)'),
  'Snow-Covered Island': card('Snow-Covered Island', 'Basic Snow Land - Island', '', 0, [], ['U'], null, null, '({T}: Add {U}.)'),
  'Snow-Covered Swamp': card('Snow-Covered Swamp', 'Basic Snow Land - Swamp', '', 0, [], ['B'], null, null, '({T}: Add {B}.)'),
  'Snow-Covered Mountain': card('Snow-Covered Mountain', 'Basic Snow Land - Mountain', '', 0, [], ['R'], null, null, '({T}: Add {R}.)'),
  'Snow-Covered Forest': card('Snow-Covered Forest', 'Basic Snow Land - Forest', '', 0, [], ['G'], null, null, '({T}: Add {G}.)'),
};

const STANDARD_CARD_DATA: Record<string, CardDataFromAPI> = {
  ...BASIC_LAND_DATA,
  "Archdruid's Charm": card("Archdruid's Charm", 'Instant', '{G}{G}{G}', 3, ['G'], ['G']),
  'Ba Sing Se': card('Ba Sing Se', 'Land', '', 0, [], ['G'], null, null, '{T}: Add {G}.'),
  'Badgermole Cub': card('Badgermole Cub', 'Creature - Badger Mole', '{1}{G}', 2, ['G'], ['G'], '2', '2'),
  'Earthbender Ascension': card('Earthbender Ascension', 'Enchantment', '{2}{G}', 3, ['G'], ['G']),
  'Escape Tunnel': card('Escape Tunnel', 'Land', '', 0, [], [], null, null, '{T}, Sacrifice this land: Search your library for a basic land card.'),
  'Esper Origins': card('Esper Origins', 'Sorcery', '{1}{G}', 2, ['G'], ['G']),
  'Fabled Passage': card('Fabled Passage', 'Land', '', 0, [], [], null, null, '{T}, Sacrifice this land: Search your library for a basic land card.'),
  'Icetill Explorer': card('Icetill Explorer', 'Creature - Insect Scout', '{2}{G}{G}', 4, ['G'], ['G'], '2', '4'),
  'Llanowar Elves': card('Llanowar Elves', 'Creature - Elf Druid', '{G}', 1, ['G'], ['G'], '1', '1', '{T}: Add {G}.'),
  "Meltstrider's Resolve": card("Meltstrider's Resolve", 'Enchantment - Aura', '{G}', 1, ['G'], ['G']),
  'Mightform Harmonizer': card('Mightform Harmonizer', 'Creature - Insect Druid', '{2}{G}{G}', 4, ['G'], ['G'], '4', '4'),
  'Mossborn Hydra': card('Mossborn Hydra', 'Creature - Elemental Hydra', '{2}{G}', 3, ['G'], ['G'], '3', '3', 'Trample.'),
  'Promising Vein': card('Promising Vein', 'Land - Cave', '', 0, [], [], null, null, '{T}: Add {C}.'),
  'Royal Treatment': card('Royal Treatment', 'Instant', '{G}', 1, ['G'], ['G']),
  "Sazh's Chocobo": card("Sazh's Chocobo", 'Creature - Bird', '{G}', 1, ['G'], ['G'], '0', '1'),
  'Pawpatch Formation': card('Pawpatch Formation', 'Instant', '{1}{G}', 2, ['G'], ['G']),
  'Sapling Nursery': card('Sapling Nursery', 'Enchantment', '{6}{G}{G}', 8, ['G'], ['G']),
  'Soul-Guide Lantern': card('Soul-Guide Lantern', 'Artifact', '{1}', 1, [], []),
  'Surrak, Elusive Hunter': card('Surrak, Elusive Hunter', 'Legendary Creature - Human Warrior', '{2}{G}', 3, ['G'], ['G'], '4', '3', 'Trample.'),

  'Monastery Swiftspear': card('Monastery Swiftspear', 'Creature - Human Monk', '{R}', 1, ['R'], ['R'], '1', '2', 'Haste. Prowess.'),
  'Lightning Strike': card('Lightning Strike', 'Instant', '{1}{R}', 2, ['R'], ['R']),
  'Play with Fire': card('Play with Fire', 'Instant', '{R}', 1, ['R'], ['R']),
  'Phoenix Chick': card('Phoenix Chick', 'Creature - Phoenix', '{R}', 1, ['R'], ['R'], '1', '1', 'Flying. Haste.'),
  'Bloodthirsty Adversary': card('Bloodthirsty Adversary', 'Creature - Vampire', '{1}{R}', 2, ['R'], ['R'], '2', '2', 'Haste.'),
  'Feldon, Ronom Excavator': card('Feldon, Ronom Excavator', 'Legendary Creature - Human Artificer', '{1}{R}', 2, ['R'], ['R'], '2', '2', 'Haste.'),
  'Kumano Faces Kakkazan': card('Kumano Faces Kakkazan', 'Enchantment - Saga', '{R}', 1, ['R'], ['R']),
  'Stoke the Flames': card('Stoke the Flames', 'Instant', '{2}{R}{R}', 4, ['R'], ['R']),
  'Squee, Dubious Monarch': card('Squee, Dubious Monarch', 'Legendary Creature - Goblin Noble', '{2}{R}', 3, ['R'], ['R'], '2', '2', 'Haste.'),
  "Mishra's Foundry": card("Mishra's Foundry", 'Land', '', 0, [], [], null, null, '{T}: Add {C}.'),
  'Lithomantic Barrage': card('Lithomantic Barrage', 'Sorcery', '{R}', 1, ['R'], ['R']),
  'Witchstalker Frenzy': card('Witchstalker Frenzy', 'Instant', '{3}{R}', 4, ['R'], ['R']),
  'Furnace Reins': card('Furnace Reins', 'Sorcery', '{2}{R}', 3, ['R'], ['R']),
  "Urabrask's Forge": card("Urabrask's Forge", 'Artifact', '{2}{R}', 3, ['R'], ['R']),
  'Torch the Tower': card('Torch the Tower', 'Instant', '{R}', 1, ['R'], ['R']),
};

const DEFAULT_STANDARD_MAIN = [
  ...copies(4, 'Monastery Swiftspear'),
  ...copies(4, 'Lightning Strike'),
  ...copies(4, 'Play with Fire'),
  ...copies(4, 'Phoenix Chick'),
  ...copies(4, 'Bloodthirsty Adversary'),
  ...copies(4, 'Feldon, Ronom Excavator'),
  ...copies(4, 'Kumano Faces Kakkazan'),
  ...copies(4, 'Stoke the Flames'),
  ...copies(4, 'Squee, Dubious Monarch'),
  ...copies(4, "Mishra's Foundry"),
  ...copies(20, 'Mountain'),
];

const DEFAULT_STANDARD_SIDEBOARD = [
  ...copies(3, 'Lithomantic Barrage'),
  ...copies(3, 'Witchstalker Frenzy'),
  ...copies(3, 'Furnace Reins'),
  ...copies(3, "Urabrask's Forge"),
  ...copies(3, 'Torch the Tower'),
];

function card(
  name: string,
  typeLine: string,
  manaCost: string,
  cmc: number,
  colors: string[],
  colorIdentity: string[],
  power: string | null = null,
  toughness: string | null = null,
  oracleText = '',
  keywords: string[] = [],
): CardDataFromAPI {
  return {
    name,
    type_line: typeLine,
    mana_cost: manaCost,
    cmc,
    oracle_text: oracleText,
    power,
    toughness,
    colors,
    color_identity: colorIdentity,
    keywords,
  };
}

function copies(count: number, name: string): string[] {
  return Array.from({ length: count }, () => name);
}

function genericCardData(name: string): CardDataFromAPI {
  return card(name, 'Creature', '{2}{G}', 3, ['G'], ['G'], '2', '2');
}

function cardDataFor(name: string): CardDataFromAPI {
  return STANDARD_CARD_DATA[name] || genericCardData(name);
}

function isLand(name: string, data: CardDataFromAPI): boolean {
  return data.type_line.toLowerCase().includes('land')
    || BASIC_LAND_DATA[name] != null;
}

function collectCardData(names: string[]): Record<string, CardDataFromAPI> {
  const cardData: Record<string, CardDataFromAPI> = {};
  for (const name of new Set(names)) {
    cardData[name] = cardDataFor(name);
  }
  return cardData;
}

export function buildStandardMatchDeck(
  playerName: string,
  mainDeck: string[],
  sideboard: string[] = [],
): ImportedCards {
  const cardData = collectCardData([...mainDeck, ...sideboard]);
  const cards: string[] = [];
  const lands: string[] = [];

  for (const name of mainDeck) {
    if (isLand(name, cardData[name])) {
      lands.push(name);
    } else {
      cards.push(name);
    }
  }

  return {
    commander: playerName,
    cards,
    lands,
    sideboard,
    cardData,
  };
}

export function buildDefaultStandardOpponentDeck(): ImportedCards {
  return buildStandardMatchDeck(
    'Standard Opponent',
    DEFAULT_STANDARD_MAIN,
    DEFAULT_STANDARD_SIDEBOARD,
  );
}
