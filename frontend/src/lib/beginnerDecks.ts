export interface BeginnerDeck {
  id: string;
  name: string;
  commander: string;
  colors: string[];
  bracket: number;
  plan: string;
  decklist: string;
}

const BASIC_LANDS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);

function copies(count: number, name: string): string[] {
  return Array.from({ length: count }, () => `1 ${name}`);
}

function decklist(commander: string, cards: string[]): string {
  return ['Commander', `1 ${commander}`, 'Deck', ...cards].join('\n');
}

function oneOf(names: string[]): string[] {
  return names.map(name => `1 ${name}`);
}

export const CERTIFIED_GREEN_FILLER = [
  'Balduvian Bears',
  'Barbary Apes',
  'Bear Cub',
  'Brushstrider',
  'Canopy Spider',
  'Cylian Elf',
  'Elvish Archers',
  'Elvish Warrior',
  'Forest Bear',
  'Grappler Spider',
  'Greenwood Sentinel',
  'Grizzly Bears',
  'Kalonian Tusker',
  'Moon Sprite',
  'Runeclaw Bear',
  'Swordwise Centaur',
  'Terrain Elemental',
  'Underdark Basilisk',
  'Alpine Grizzly',
  'Centaur Courser',
  'Colossodon Yearling',
  'Elvish Ranger',
  'Gnarled Mass',
  'Gnottvold Recluse',
  'Goliath Beetle',
  'Gorilla Warrior',
  'Harrier Naga',
  'Hitchclaw Recluse',
  'Kraul Stinger',
  'Leatherback Baloth',
  'Mosscoat Goriak',
  'Nessian Courser',
  'Orazca Frillback',
  'Rib Cage Spider',
  'Spined Karok',
  'Sporecap Spider',
  'Tajuru Snarecaster',
  'Trained Armodon',
  'Axebane Beast',
  'Broodhunter Wurm',
  'Cloudcrown Oak',
] as const;

export const CERTIFIED_RED_FILLER = [
  'Crimson Kobolds',
  'Crookshank Kobolds',
  'Kobolds of Kher Keep',
  'Dwarven Trader',
  "Mons's Goblin Raiders",
  'Mountain Bandit',
  'Warship Scout',
  'Capital Guard',
  'Defiant Khenra',
  'Deranged Whelp',
  'Falkenrath Reaver',
  'Feral Maaka',
  'Goblin Assailant',
  'Goblin Bully',
  'Goblin Piker',
  'Goblin Striker',
  'Goblin Trailblazer',
  'Independent Troops',
  'Leopard-Spotted Jiao',
  'Nest Robber',
  'Roc Hunter',
  'Satyr Rambler',
  'Swab Goblin',
  'Balduvian Barbarians',
  'Bird Maiden',
  'Boggart Brute',
  'Breakneck Berserker',
  'Fearless Halberdier',
  'Frenzied Raptor',
  'Goblin Cavaliers',
  'Goblin Hero',
  'Goblin Roughrider',
  'Goblin Sky Raider',
  'Gore Swine',
  'Gray Ogre',
  'Hulking Bugbear',
  'Hurloon Minotaur',
  'Minotaur Warrior',
  'Nimble Birdsticker',
  'Onakke Ogre',
  'Pensive Minotaur',
  'Raging Bull',
  'Regathan Firecat',
] as const;

export const CERTIFIED_BLUE_FILLER = [
  'Aegis Turtle',
  'Aven Envoy',
  'Flying Men',
  'Fugitive Wizard',
  'Kraken Hatchling',
  'Merfolk of the Pearl Trident',
  'Mist-Cloaked Herald',
  'Shorecomber Crab',
  'Slither Blade',
  'Triton Shorestalker',
  'Triton Shorethief',
  'Wandering Ones',
  'Zephyr Sprite',
  'Bay Falcon',
  'Coral Eel',
  'Coral Merfolk',
  'Curio Vendor',
  'Flying Dolphin-Fish',
  'Jhessian Lookout',
  'Lumengrid Warden',
  'Maritime Guard',
  'Metathran Soldier',
  'Plated Seastrider',
  'Sea Eagle',
  'Seacoast Drake',
  'Seagraf Skaab',
  'Storm Crow',
  'Sworn Guardian',
  'Talas Merchant',
  'Talas Scout',
  'Vodalian Soldiers',
  'Wetland Sambar',
  'Winged Sliver',
  'Ancient Crab',
  'Armored Whirl Turtle',
  'Blind Phantasm',
  'Coral Commando',
  'Horned Turtle',
  'Naga Eternal',
  "Oko's Accomplices",
  'Phantom Warrior',
] as const;

export const CERTIFIED_BLUE_SPELLS = [
  'Divination',
  'Counsel of the Soratami',
  'Concentrate',
  'Quick Study',
  'Inspiration',
  'Think Twice',
  'Hieroglyphic Illumination',
  'Sleight of Hand',
  'Serum Visions',
  'Anticipate',
  'Curate',
  'Strategic Planning',
  'See Beyond',
  'Compulsive Research',
  'Frantic Search',
  'Peek',
  'Disperse',
  'Blink of an Eye',
  'Aetherize',
  "Jace's Ingenuity",
] as const;

export const BEGINNER_DECKS: BeginnerDeck[] = [
  {
    id: 'beginner-goreclaw-stompy',
    name: 'Green Big Creatures',
    commander: 'Goreclaw, Terror of Qal Sisma',
    colors: ['G'],
    bracket: 2,
    plan: 'Ramp, cast one large creature at a time, and attack.',
    decklist: decklist('Goreclaw, Terror of Qal Sisma', [
      ...copies(38, 'Forest'),
      ...copies(4, 'Forest'),
      '1 Sol Ring',
      '1 Arcane Signet',
      '1 Llanowar Elves',
      '1 Elvish Mystic',
      '1 Fyndhorn Elves',
      '1 Rampant Growth',
      "1 Kodama's Reach",
      '1 Cultivate',
      "1 Garruk's Uprising",
      '1 Rancor',
      '1 Return of the Wildspeaker',
      '1 Beast Within',
      '1 Reclamation Sage',
      '1 Acidic Slime',
      '1 Colossal Dreadmaw',
      '1 Terra Stomper',
      ...oneOf([...CERTIFIED_GREEN_FILLER]),
    ]),
  },
  {
    id: 'beginner-krenko-goblins',
    name: 'Red Goblin Swarm',
    commander: 'Krenko, Mob Boss',
    colors: ['R'],
    bracket: 2,
    plan: 'Make goblins, tap Krenko, and turn a wide board sideways.',
    decklist: decklist('Krenko, Mob Boss', [
      ...copies(38, 'Mountain'),
      ...copies(4, 'Mountain'),
      '1 Sol Ring',
      '1 Arcane Signet',
      '1 Lightning Bolt',
      '1 Abrade',
      '1 Chaos Warp',
      '1 Goblin Instigator',
      '1 Dragon Fodder',
      "1 Krenko's Command",
      '1 Hordeling Outburst',
      '1 Goblin Matron',
      '1 Goblin Warchief',
      '1 Goblin Chieftain',
      '1 Skirk Prospector',
      '1 Impact Tremors',
      ...oneOf([...CERTIFIED_RED_FILLER]),
    ]),
  },
  {
    id: 'beginner-talrand-spells',
    name: 'Blue Spell Practice',
    commander: 'Talrand, Sky Summoner',
    colors: ['U'],
    bracket: 2,
    plan: 'Cast small spells, make Drake tokens, and practice responding.',
    decklist: decklist('Talrand, Sky Summoner', [
      ...copies(38, 'Island'),
      ...copies(4, 'Island'),
      '1 Sol Ring',
      '1 Arcane Signet',
      '1 Sky Diamond',
      '1 Mind Stone',
      '1 Ponder',
      '1 Preordain',
      '1 Opt',
      '1 Brainstorm',
      '1 Consider',
      '1 Impulse',
      '1 Chart a Course',
      "1 Talrand's Invocation",
      '1 Counterspell',
      '1 Negate',
      '1 Unsummon',
      '1 Into the Roil',
      ...oneOf([...CERTIFIED_BLUE_SPELLS]),
      ...oneOf([...CERTIFIED_BLUE_FILLER].slice(0, 21)),
    ]),
  },
];

export function decklistCardNames(deck: BeginnerDeck): string[] {
  return deck.decklist
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^\d+\s+/.test(line))
    .map(line => line.replace(/^\d+\s+/, ''));
}

export function hasOnlyLegalBeginnerDuplicates(deck: BeginnerDeck): boolean {
  const seen = new Set<string>();
  for (const name of decklistCardNames(deck)) {
    if (BASIC_LANDS.has(name)) continue;
    if (seen.has(name)) return false;
    seen.add(name);
  }
  return true;
}
