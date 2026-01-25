"""Commander deck building rules - brackets, banned list, and constraints."""

from typing import Dict, List, Set

# Commander banned list (as of 2024 + Reddit 2026 Community Patch)
COMMANDER_BANNED_CARDS: Set[str] = {
    "Ancestral Recall", "Balance", "Black Lotus", "Braids, Cabal Minion",
    "Channel", "Chaos Orb", "Coalition Victory", "Dockside Extortionist",
    "Emrakul, the Aeons Torn", "Erayo, Soratami Ascendant", "Falling Star",
    "Fastbond", "Flash", "Griselbrand",
    "Hullbreacher", "Iona, Shield of Emeria", "Karakas",
    "Leovold, Emissary of Trest", "Library of Alexandria", "Limited Resources",
    "Lutri, the Spellchaser", "Mana Crypt", "Mox Emerald", "Mox Jet", "Mox Pearl",
    "Mox Ruby", "Mox Sapphire", "Nadu, Winged Wisdom",
    "Paradox Engine", "Prophet of Kruphix",
    "Shahrazad", "Sundering Titan", "Sway of the Stars",
    "Sylvan Primordial", "Time Vault", "Time Walk", "Tinker", "Tolarian Academy",
    "Trade Secrets", "Upheaval"
}

# Basic lands by color
BASIC_LANDS: Dict[str, str] = {
    'W': 'Plains',
    'U': 'Island',
    'B': 'Swamp',
    'R': 'Mountain',
    'G': 'Forest'
}

# Commander bracket system (Updated Oct 2025)
COMMANDER_BRACKETS: Dict[int, Dict] = {
    1: {
        'name': 'Exhibition',
        'description': 'Themed decks where winning is secondary. Unique concepts, "jank", or flexible legality (rule 0).',
        'power_level': (1, 3),
        'expected_turns': 9,
        'max_game_changers': 0,
        'max_tutors': None, # Restriction removed (covered by Game Changers)
        'max_extra_turns': None, # Restriction removed
        'allow_combos': False,
        'allow_mld': False,
    },
    2: {
        'name': 'Core',
        'description': 'Standard casual play. Creativity and entertainment. Low pressure, social gameplay.',
        'power_level': (3, 6),
        'expected_turns': 8,
        'max_game_changers': 0,
        'max_tutors': None,
        'max_extra_turns': None,
        'allow_combos': False,
        'allow_mld': False,
    },
    3: {
        'name': 'Upgraded',
        'description': 'High synergy and power. Effective disruption. Can win explosively from hand.',
        'power_level': (6, 8),
        'expected_turns': 6,
        'max_game_changers': 2, # Limited game changers allowed
        'max_tutors': None,
        'max_extra_turns': None,
        'allow_combos': False, # Still restrict easy 2-card combos to keep it "casual-competitive"
        'allow_mld': False,
    },
    4: {
        'name': 'Optimized',
        'description': 'Lethal, consistent, and fast. No holds barred except cEDH meta. Explosive and powerful.',
        'power_level': (8, 9),
        'expected_turns': 4,
        'max_game_changers': None,  # Unlimited
        'max_tutors': None,
        'max_extra_turns': None,
        'allow_combos': True,
        'allow_mld': True,
    },
    5: {
        'name': 'cEDH',
        'description': 'Tournament Competitive EDH. The absolute maximum power possible.',
        'power_level': (9, 10),
        'expected_turns': 3,
        'max_game_changers': None,
        'max_tutors': None,
        'max_extra_turns': None,
        'allow_combos': True,
        'allow_mld': True,
    }
}

# Game-changing cards restricted in lower brackets (Official Oct 2025 + Reddit Community Patch)
# These cards "easily and dramatically warp Commander games" or allow resource runaways.
GAME_CHANGER_CARDS: Set[str] = {
    # === Creatures ===
    "Drannith Magistrate", "Consecrated Sphinx", "Thassa's Oracle", 
    "Braids, Cabal Minion", "Opposition Agent", "Orcish Bowmasters", 
    "Tergrid, God of Fright", "Seedborn Muse", "Grand Arbiter Augustin IV", 
    "Notion Thief", "Kinnan, Bonder Prodigy", "Urza, Lord High Artificer",
    "Winota, Joiner of Forces", "Yuriko, the Tiger's Shadow",
    "Primeval Titan", "Golos, Tireless Pilgrim", "Rofellos, Llanowar Emissary",

    # === Enchantments ===
    "Humility", "Smothering Tithe", "Rhystic Study", "Necropotence", 
    "Underworld Breach", "Survival of the Fittest", "Aura Shards",
    "Recurring Nightmare", "Yawgmoth's Bargain",

    # === Lands ===
    "Serra's Sanctum", "Gaea's Cradle", "Ancient Tomb", 
    "Glacial Chasm", "Mishra's Workshop", "The Tabernacle at Pendrell Vale",
    # "Field of the Dead" - Removed per community feedback

    # === Instants ===
    "Enlightened Tutor", "Teferi's Protection", "Cyclonic Rift", 
    "Fierce Guardianship", "Intuition", "Mystical Tutor", 
    "Ad Nauseam", "Vampiric Tutor", "Worldly Tutor", "Gifts Ungiven",
    # "Force of Will", "Crop Rotation" - Removed per community feedback

    # === Planeswalkers ===
    "Narset, Parter of Veils",

    # === Artifacts ===
    "Bolas's Citadel", "Chrome Mox", "Grim Monolith", "Lion's Eye Diamond", 
    "Mana Vault", "Mox Diamond", "The One Ring", "Jeweled Lotus", "Panoptic Mirror",

    # === Sorceries ===
    "Demonic Tutor", "Imperial Seal", "Gamble", "Jeska's Will", 
    "Coalition Victory", "Biorhythm",
    # "Natural Order" - Removed per community feedback

    # === Legacy High-Impact (Kept for safety in lower brackets) ===
    "Elesh Norn, Grand Cenobite", "Vorinclex, Voice of Hunger", "Expropriate",
    "Craterhoof Behemoth", "Torment of Hailfire", "Mana Crypt"
}

# Mass land destruction cards
MASS_LAND_DENIAL: Set[str] = {
    "Armageddon", "Ravages of War", "Catastrophe", "Wildfire", "Burning of Xinye",
    "Ruination", "Death Cloud", "Jokulhaups", "Obliterate", "Decree of Annihilation",
    "Fall of the Thran", "Impending Disaster", "Natural Balance", "Winter Orb",
    "Static Orb", "Rising Waters", "Stasis", "Blood Moon", "Magus of the Moon"
}

# Extra turn spells
EXTRA_TURN_SPELLS: Set[str] = {
    "Time Warp", "Temporal Manipulation", "Capture of Jingzhou", "Time Stretch",
    "Nexus of Fate", "Temporal Mastery", "Walk the Aeons", "Karn's Temporal Sundering",
    "Part the Waterveil", "Temporal Trespass", "Alrund's Epiphany", "Expropriate"
}

# Tutor cards
TUTOR_CARDS: Set[str] = {
    "Demonic Tutor", "Vampiric Tutor", "Worldly Tutor", "Mystical Tutor", "Enlightened Tutor",
    "Imperial Seal", "Diabolic Tutor", "Grim Tutor", "Personal Tutor", "Sylvan Tutor",
    "Demonic Consultation", "Tainted Pact", "Scheming Symmetry", "Cruel Tutor",
    "Diabolic Intent", "Gamble", "Chord of Calling", "Green Sun's Zenith", "Tooth and Nail",
    "Eladamri's Call", "Idyllic Tutor", "Beseech the Queen", "Final Parting"
}

# Known 2-card combo pieces (expanded list for comprehensive detection)
COMBO_CARDS: Dict[str, List[str]] = {
    # Thoracle / Lab Man combos (self-mill wins)
    "Thassa's Oracle": ["Demonic Consultation", "Tainted Pact", "Doomsday", "Leveler", "Mirror of Fate"],
    "Laboratory Maniac": ["Demonic Consultation", "Tainted Pact", "Doomsday", "Leveler"],
    "Jace, Wielder of Mysteries": ["Demonic Consultation", "Tainted Pact", "Doomsday", "Leveler"],
    "Demonic Consultation": ["Thassa's Oracle", "Laboratory Maniac", "Jace, Wielder of Mysteries"],
    "Tainted Pact": ["Thassa's Oracle", "Laboratory Maniac", "Jace, Wielder of Mysteries"],
    "Doomsday": ["Thassa's Oracle", "Laboratory Maniac"],

    # Dramatic Scepter (infinite mana)
    "Isochron Scepter": ["Dramatic Reversal"],
    "Dramatic Reversal": ["Isochron Scepter"],

    # Splinter Twin / Kiki combos (infinite creatures)
    "Splinter Twin": ["Deceiver Exarch", "Pestermite", "Zealous Conscripts", "Village Bell-Ringer", "Corridor Monitor"],
    "Kiki-Jiki, Mirror Breaker": ["Deceiver Exarch", "Pestermite", "Zealous Conscripts", "Village Bell-Ringer", "Corridor Monitor", "Felidar Guardian", "Restoration Angel"],
    "Deceiver Exarch": ["Splinter Twin", "Kiki-Jiki, Mirror Breaker"],
    "Pestermite": ["Splinter Twin", "Kiki-Jiki, Mirror Breaker"],
    "Zealous Conscripts": ["Splinter Twin", "Kiki-Jiki, Mirror Breaker"],
    "Village Bell-Ringer": ["Splinter Twin", "Kiki-Jiki, Mirror Breaker"],
    "Corridor Monitor": ["Splinter Twin", "Kiki-Jiki, Mirror Breaker"],
    "Felidar Guardian": ["Kiki-Jiki, Mirror Breaker", "Saheeli Rai"],
    "Restoration Angel": ["Kiki-Jiki, Mirror Breaker"],

    # Saheeli combo
    "Saheeli Rai": ["Felidar Guardian"],

    # Mike + Trike / Ballista
    "Mikaeus, the Unhallowed": ["Triskelion", "Walking Ballista"],
    "Triskelion": ["Mikaeus, the Unhallowed"],
    "Walking Ballista": ["Mikaeus, the Unhallowed", "Heliod, Sun-Crowned"],
    "Heliod, Sun-Crowned": ["Walking Ballista", "Spike Feeder"],
    "Spike Feeder": ["Heliod, Sun-Crowned"],

    # Life drain loops
    "Sanguine Bond": ["Exquisite Blood"],
    "Exquisite Blood": ["Sanguine Bond", "Vito, Thorn of the Dusk Rose"],
    "Vito, Thorn of the Dusk Rose": ["Exquisite Blood"],

    # Mill combos
    "Painter's Servant": ["Grindstone"],
    "Grindstone": ["Painter's Servant"],

    # Food Chain combos
    "Food Chain": ["Eternal Scourge", "Misthollow Griffin", "Squee, the Immortal"],
    "Eternal Scourge": ["Food Chain"],
    "Misthollow Griffin": ["Food Chain"],
    "Squee, the Immortal": ["Food Chain"],

    # Squirrel Nest
    "Earthcraft": ["Squirrel Nest"],
    "Squirrel Nest": ["Earthcraft"],

    # Persist / Undying combos
    "Melira, Sylvok Outcast": ["Kitchen Finks", "Murderous Redcap", "Lesser Masticore"],
    "Kitchen Finks": ["Melira, Sylvok Outcast", "Vizier of Remedies"],
    "Murderous Redcap": ["Melira, Sylvok Outcast", "Vizier of Remedies"],
    "Lesser Masticore": ["Melira, Sylvok Outcast", "Vizier of Remedies"],
    "Vizier of Remedies": ["Kitchen Finks", "Murderous Redcap", "Lesser Masticore", "Devoted Druid"],

    # Devoted Druid combos
    "Devoted Druid": ["Vizier of Remedies", "Swift Reconfiguration"],
    "Swift Reconfiguration": ["Devoted Druid"],

    # Altar combos (infinite mill/death triggers)
    "Altar of Dementia": ["Karmic Guide", "Reveillark"],
    "Karmic Guide": ["Reveillark", "Altar of Dementia", "Altar of the Brood"],
    "Reveillark": ["Karmic Guide", "Altar of Dementia", "Altar of the Brood"],
    "Altar of the Brood": ["Karmic Guide", "Reveillark"],

    # Protean Hulk lines
    "Protean Hulk": ["Flash"],
    "Flash": ["Protean Hulk"],

    # Worldgorger combo
    "Worldgorger Dragon": ["Animate Dead", "Dance of the Dead", "Necromancy"],
    "Animate Dead": ["Worldgorger Dragon"],
    "Dance of the Dead": ["Worldgorger Dragon"],
    "Necromancy": ["Worldgorger Dragon"],

    # Deadeye Navigator combos
    "Deadeye Navigator": ["Palinchron", "Peregrine Drake", "Great Whale", "Cloud of Faeries"],
    "Palinchron": ["Deadeye Navigator", "Phantasmal Image", "High Tide"],
    "Peregrine Drake": ["Deadeye Navigator", "Ghostly Flicker"],
    "Great Whale": ["Deadeye Navigator"],

    # Ghostly Flicker loops
    "Ghostly Flicker": ["Peregrine Drake", "Archaeomancer", "Naru Meha, Master Wizard"],
    "Archaeomancer": ["Ghostly Flicker"],
    "Naru Meha, Master Wizard": ["Ghostly Flicker"],

    # Time Sieve combo
    "Time Sieve": ["Thopter Assembly"],
    "Thopter Assembly": ["Time Sieve"],

    # Sword of the Meek combo
    "Sword of the Meek": ["Thopter Foundry"],
    "Thopter Foundry": ["Sword of the Meek"],

    # Basalt Monolith combos
    "Basalt Monolith": ["Rings of Brighthearth", "Power Artifact", "Kinnan, Bonder Prodigy"],
    "Rings of Brighthearth": ["Basalt Monolith"],
    "Power Artifact": ["Basalt Monolith", "Grim Monolith"],
    "Grim Monolith": ["Power Artifact"],
    "Kinnan, Bonder Prodigy": ["Basalt Monolith"],

    # Underworld Breach combos
    "Underworld Breach": ["Brain Freeze", "Lion's Eye Diamond", "Grinding Station"],
    "Brain Freeze": ["Underworld Breach"],
    "Lion's Eye Diamond": ["Underworld Breach", "Auriok Salvagers"],
    "Grinding Station": ["Underworld Breach"],
    "Auriok Salvagers": ["Lion's Eye Diamond"],

    # Najeela combo
    "Najeela, the Blade-Blossom": ["Derevi, Empyrial Tactician", "Nature's Will", "Sword of Feast and Famine"],
    "Derevi, Empyrial Tactician": ["Najeela, the Blade-Blossom"],
    "Nature's Will": ["Najeela, the Blade-Blossom", "Aggravated Assault"],
    "Sword of Feast and Famine": ["Najeela, the Blade-Blossom", "Aggravated Assault"],

    # Aggravated Assault combos
    "Aggravated Assault": ["Sword of Feast and Famine", "Nature's Will", "Bear Umbra", "Savage Ventmaw", "Grand Warlord Radha"],
    "Bear Umbra": ["Aggravated Assault"],
    "Savage Ventmaw": ["Aggravated Assault"],
    "Grand Warlord Radha": ["Aggravated Assault"],

    # Curiosity combos
    "Curiosity": ["Niv-Mizzet, Parun", "Niv-Mizzet, the Firemind", "Glint-Horn Buccaneer"],
    "Ophidian Eye": ["Niv-Mizzet, Parun", "Niv-Mizzet, the Firemind"],
    "Tandem Lookout": ["Niv-Mizzet, Parun", "Niv-Mizzet, the Firemind"],
    "Niv-Mizzet, Parun": ["Curiosity", "Ophidian Eye", "Tandem Lookout"],
    "Niv-Mizzet, the Firemind": ["Curiosity", "Ophidian Eye", "Tandem Lookout"],
    "Glint-Horn Buccaneer": ["Curiosity", "Malcolm, Keen-Eyed Navigator"],

    # Malcolm combos
    "Malcolm, Keen-Eyed Navigator": ["Glint-Horn Buccaneer"],
}

# Price tier thresholds (USD)
PRICE_TIERS: Dict[str, tuple] = {
    'budget': (0, 1),
    'affordable': (1, 5),
    'moderate': (5, 20),
    'premium': (20, 50),
    'high_end': (50, float('inf'))
}

# Command Zone deck building template (what every deck should have)
COMMAND_ZONE_TEMPLATE: Dict[str, Dict] = {
    'lands': {
        'max': 34,
        'min': 30,
        'description': 'No more than 34 lands - lower is often better with good ramp'
    },
    'ramp': {
        'min': 10,
        'max': 15,
        'description': 'Mana rocks and ramp spells to accelerate'
    },
    'card_draw': {
        'min': 10,
        'max': 15,
        'description': 'Card advantage to keep the hand full'
    },
    'removal': {
        'min': 8,
        'max': 12,
        'description': 'Single target and board wipes to interact'
    },
    'wincons': {
        'min': 2,
        'max': 5,
        'description': 'Ways to close out the game'
    }
}

# Common removal spells by color
REMOVAL_CARDS: Dict[str, List[str]] = {
    'W': [
        "Swords to Plowshares", "Path to Exile", "Generous Gift", "Wrath of God",
        "Day of Judgment", "Farewell", "Austere Command", "Winds of Abandon",
        "Cathar Commando", "Skyclave Apparition", "Oblivion Ring"
    ],
    'U': [
        "Counterspell", "Swan Song", "Arcane Denial", "Negate", "Cyclonic Rift",
        "Resculpt", "Reality Shift", "Pongify", "Rapid Hybridization", "Chain of Vapor"
    ],
    'B': [
        "Go for the Throat", "Infernal Grasp", "Deadly Rollick", "Toxic Deluge",
        "Damnation", "Feed the Swarm", "Heartless Act", "Murderous Rider",
        "Dismember", "Snuff Out", "Malicious Affliction"
    ],
    'R': [
        "Chaos Warp", "Blasphemous Act", "Vandalblast", "By Force", "Abrade",
        "Wild Magic Surge", "Lightning Bolt", "Red Elemental Blast", "Pyroblast"
    ],
    'G': [
        "Beast Within", "Nature's Claim", "Krosan Grip", "Force of Vigor",
        "Reclamation Sage", "Bane of Progress", "Acidic Slime", "Return to Nature"
    ],
    'colorless': [
        # Board wipes
        "All Is Dust", "Ugin, the Spirit Dragon", "Oblivion Stone", "Nevinyrral's Disk",
        "Perilous Vault", "Boompile",
        # Targeted removal
        "Meteor Golem", "Scour from Existence", "Spine of Ish Sah", "Unstable Obelisk",
        "Duplicant", "Steel Hellkite", "Karn Liberated",
        # Artifact/enchantment removal
        "Ratchet Bomb", "Engineered Explosives", "Lux Cannon", "Gate to Phyrexia",
        # Creature removal
        "Brittle Effigy", "Spatial Contortion", "Warping Wail", "Titan's Presence"
    ]
}

# Common ramp cards by color
RAMP_CARDS: Dict[str, List[str]] = {
    'colorless': [
        # Essential rocks
        "Sol Ring", "Arcane Signet", "Mind Stone", "Thought Vessel",
        "Fellwar Stone", "Commander's Sphere", "Worn Powerstone", "Thran Dynamo",
        "Gilded Lotus", "Chromatic Lantern", "Wayfarer's Bauble",
        # Additional colorless-friendly ramp
        "Hedron Archive", "Dreamstone Hedron", "Everflowing Chalice", "Astral Cornucopia",
        "Palladium Myr", "Plague Myr", "Burnished Hart", "Solemn Simulacrum",
        "Voltaic Key", "Manifold Key", "Forsaken Monument", "Nyx Lotus",
        # Urza lands (for colorless decks)
        "Urza's Tower", "Urza's Mine", "Urza's Power Plant",
        # Other colorless lands that ramp
        "Ancient Tomb", "Temple of the False God", "Shrine of the Forsaken Gods",
        "Eldrazi Temple", "Eye of Ugin"
    ],
    'W': ["Smothering Tithe", "Land Tax", "Knight of the White Orchid", "Keeper of the Accord"],
    'U': ["High Tide", "Sapphire Medallion"],
    'B': ["Dark Ritual", "Cabal Coffers", "Crypt Ghast", "Jet Medallion", "Black Market"],
    'R': ["Jeska's Will", "Mana Geyser", "Dockside Extortionist", "Ruby Medallion"],
    'G': [
        "Cultivate", "Kodama's Reach", "Rampant Growth", "Three Visits", "Nature's Lore",
        "Farseek", "Sakura-Tribe Elder", "Birds of Paradise", "Llanowar Elves",
        "Elvish Mystic", "Wood Elves", "Fyndhorn Elves"
    ]
}

# Common card draw by color
CARD_DRAW: Dict[str, List[str]] = {
    'colorless': [
        # Premium colorless draw
        "Mind's Eye", "The One Ring", "Tome of Legends", "Skullclamp",
        # Additional colorless draw options
        "Staff of Nin", "Loreseeker's Stone", "Endbringer", "Kozilek, the Great Distortion",
        "Ugin's Insight", "Seer's Sundial", "Endless Atlas", "War Room",
        "Rogue's Gloves", "Mask of Memory", "Sword of Fire and Ice",
        "Memory Jar", "Grafted Skullcap", "Tower of Fortunes",
        "Mystic Forge", "Sensei's Divining Top", "Scroll Rack"
    ],
    'W': ["Esper Sentinel", "Mentor of the Meek", "Welcoming Vampire", "Dawn of Hope"],
    'U': [
        "Rhystic Study", "Mystic Remora", "Brainstorm", "Ponder", "Preordain",
        "Blue Sun's Zenith", "Pull from Tomorrow", "Windfall", "Fact or Fiction"
    ],
    'B': [
        "Necropotence", "Phyrexian Arena", "Read the Bones", "Sign in Blood",
        "Night's Whisper", "Deadly Dispute", "Village Rites", "Stinging Study"
    ],
    'R': ["Wheel of Fortune", "Faithless Looting", "Cathartic Reunion", "Wheel of Misfortune"],
    'G': [
        "Beast Whisperer", "Guardian Project", "The Great Henge", "Sylvan Library",
        "Harmonize", "Rishkar's Expertise", "Return of the Wildspeaker"
    ]
}

# Common wincon cards (expanded list by archetype)
WINCON_CARDS: List[str] = [
    # === Combat damage multipliers / Overrun effects ===
    "Craterhoof Behemoth", "Triumph of the Hordes", "Overwhelming Stampede",
    "End-Raze Forerunners", "Pathbreaker Ibex", "Finale of Devastation",
    "Decimator of the Provinces", "Thunderfoot Baloth", "Coat of Arms",
    "Shared Animosity", "Beastmaster Ascension", "Akroma's Memorial",
    "Eldrazi Monument", "True Conviction",

    # === Self-mill / Library wins ===
    "Thassa's Oracle", "Laboratory Maniac", "Jace, Wielder of Mysteries",
    "Demonic Consultation", "Tainted Pact", "Doomsday", "Leveler",

    # === Storm / Spellslinger ===
    "Aetherflux Reservoir", "Grapeshot", "Tendrils of Agony",
    "Brain Freeze", "Empty the Warrens", "Thousand-Year Storm",
    "Aria of Flame", "Sentinel Tower",

    # === Big mana finishers ===
    "Torment of Hailfire", "Exsanguinate", "Debt to the Deathless",
    "Villainous Wealth", "Blue Sun's Zenith", "Finale of Revelation",
    "Comet Storm", "Jaya's Immolating Inferno",

    # === Reanimation bombs ===
    "Rise of the Dark Realms", "Living Death", "Twilight's Call",
    "Command the Dreadhorde", "Patriarch's Bidding",

    # === Theft / Control wins ===
    "Insurrection", "Expropriate", "Mob Rule", "Mass Manipulation",
    "Blatant Thievery",

    # === Alternative win conditions ===
    "Approach of the Second Sun", "Revel in Riches", "Mechanized Production",
    "Simic Ascendancy", "Helix Pinnacle", "Mayael's Aria",
    "Test of Endurance", "Felidar Sovereign", "Epic Struggle",
    "Mortal Combat", "Liliana's Contract", "Hellkite Tyrant",

    # === Extra combats / turns ===
    "Aggravated Assault", "Hellkite Charger", "Savage Beating",
    "Moraug, Fury of Akoum", "Aurelia, the Warleader",
    "Combat Celebrant", "Breath of Fury", "Scourge of the Throne",

    # === Infinite mana outlets ===
    "Walking Ballista", "Fireball", "Banefire", "Goblin Cannon",
    "Staff of Domination", "Helix Pinnacle",

    # === Aristocrats / Drain ===
    "Blood Artist", "Zulaport Cutthroat", "Cruel Celebrant",
    "Syr Konrad, the Grim", "Gray Merchant of Asphodel",
    "Kokusho, the Evening Star", "Vito, Thorn of the Dusk Rose",

    # === Voltron ===
    "Colossus Hammer", "Embercleave", "Blackblade Reforged",
    "Grafted Exoskeleton", "Hatred", "Tainted Strike",

    # === Combo enablers ===
    "Bolas's Citadel", "Sensei's Divining Top", "Isochron Scepter",
    "Dramatic Reversal", "Paradox Engine",
]


def is_card_banned(card_name: str) -> bool:
    """Check if a card is on the Commander banned list."""
    return card_name in COMMANDER_BANNED_CARDS


def get_bracket_restrictions(bracket: int) -> Dict:
    """Get the restrictions for a given bracket."""
    return COMMANDER_BRACKETS.get(bracket, COMMANDER_BRACKETS[2])


def is_card_allowed_in_bracket(card_name: str, bracket: int, current_counts: Dict[str, int] = None) -> bool:
    """
    Check if a card is allowed in a given bracket, considering current counts.

    Args:
        card_name: Name of the card to check
        bracket: Power level bracket (1-5)
        current_counts: Dict with counts of 'game_changers', 'tutors', 'extra_turns'
    """
    if is_card_banned(card_name):
        return False

    restrictions = get_bracket_restrictions(bracket)
    current_counts = current_counts or {'game_changers': 0, 'tutors': 0, 'extra_turns': 0}

    # Check combo cards (brackets 1-3 don't allow known combo pieces)
    if not restrictions['allow_combos'] and card_name in COMBO_CARDS:
        return False

    # Check MLD
    if not restrictions['allow_mld'] and card_name in MASS_LAND_DENIAL:
        return False

    # Check game changers
    max_gc = restrictions['max_game_changers']
    if max_gc is not None and card_name in GAME_CHANGER_CARDS:
        if current_counts.get('game_changers', 0) >= max_gc:
            return False

    # Check tutors
    max_tutors = restrictions['max_tutors']
    if max_tutors is not None and card_name in TUTOR_CARDS:
        if current_counts.get('tutors', 0) >= max_tutors:
            return False

    # Check extra turns
    max_et = restrictions['max_extra_turns']
    if max_et is not None and card_name in EXTRA_TURN_SPELLS:
        if current_counts.get('extra_turns', 0) >= max_et:
            return False

    return True


def get_card_price_tier(price_usd: float) -> str:
    """Get the price tier for a card based on USD price."""
    for tier, (low, high) in PRICE_TIERS.items():
        if low <= price_usd < high:
            return tier
    return 'budget'


# Lands that require specific colors to function (useless in colorless decks)
COLORED_REQUIREMENT_LANDS: Set[str] = {
    # Panoramas (fetch basics you might not have)
    "Bant Panorama", "Esper Panorama", "Grixis Panorama", "Jund Panorama", "Naya Panorama",
    # Fetch lands (fetch typed basics)
    "Flooded Strand", "Polluted Delta", "Bloodstained Mire", "Wooded Foothills",
    "Windswept Heath", "Marsh Flats", "Scalding Tarn", "Verdant Catacombs",
    "Arid Mesa", "Misty Rainforest", "Prismatic Vista", "Fabled Passage", "Terramorphic Expanse",
    "Evolving Wilds",
    # Slow fetches
    "Bad River", "Flood Plain", "Grasslands", "Mountain Valley", "Rocky Tar Pit",
    # Lands that only produce colored mana
    "Exotic Orchard", "Reflecting Pool", "Mana Confluence", "City of Brass",
    "Forbidden Orchard", "Spire of Industry",
    # Lands that require colored permanents/spells
    "Ancient Ziggurat", "Unclaimed Territory", "Cavern of Souls", "Secluded Courtyard",
    "Survivors' Encampment", "Holdout Settlement", "Interplanar Beacon",
    # Gate-matters (useless without gates)
    "Maze's End", "Gateway Plaza", "Guildmages' Forum",
    # Other colored-only lands
    "Pillar of the Paruns", "Hall of Oracles",
}


def is_land_useful_for_colors(land_name: str, oracle_text: str, color_identity: List[str]) -> bool:
    """
    Check if a land is useful for a deck with the given color identity.
    Colorless decks should avoid lands that only fetch/produce colored mana.
    """
    # If deck has colors, most lands are fine
    if color_identity:
        return True

    # For colorless decks, filter out problematic lands
    if land_name in COLORED_REQUIREMENT_LANDS:
        return False

    oracle_lower = oracle_text.lower() if oracle_text else ""

    # Avoid lands that search for basic land types (colorless can't use them)
    if "search your library for a basic" in oracle_lower:
        # Check if it can find Wastes (rare but exists)
        if "wastes" not in oracle_lower:
            return False

    # Avoid lands that only produce colored mana and reference colors
    color_words = ["white", "blue", "black", "red", "green", "plains", "island", "swamp", "mountain", "forest"]
    produces_only_colored = any(word in oracle_lower for word in color_words) and "colorless" not in oracle_lower

    # If the land mentions colors but not colorless, it's probably not useful
    if produces_only_colored and "add" in oracle_lower:
        # Exception: lands that can add any color (Command Tower, etc.) - those produce colorless for colorless commanders
        if "any color" in oracle_lower or "mana of any" in oracle_lower:
            return True
        return False

    return True


def get_removal_for_colors(color_identity: List[str]) -> List[str]:
    """Get available removal spells for given color identity, interleaved by color."""
    removal = []
    colorless = list(REMOVAL_CARDS.get('colorless', []))

    # Get removal by color separately
    by_color = {c: list(REMOVAL_CARDS.get(c, [])) for c in color_identity}
    indices = {c: 0 for c in color_identity}
    ci = 0

    # Round-robin through colors, then add colorless
    # This ensures we get variety across all colors
    colors_with_cards = [c for c in color_identity if by_color[c]]
    while colors_with_cards or ci < len(colorless):
        # Take one from each color
        for color in list(colors_with_cards):
            if indices[color] < len(by_color[color]):
                removal.append(by_color[color][indices[color]])
                indices[color] += 1
            else:
                colors_with_cards.remove(color)

        # Add one colorless every round
        if ci < len(colorless):
            removal.append(colorless[ci])
            ci += 1

    return removal


def get_ramp_for_colors(color_identity: List[str]) -> List[str]:
    """Get available ramp cards for given color identity, balanced between rocks and land ramp."""
    # Essential mana rocks that every deck wants
    essential_rocks = ["Sol Ring", "Arcane Signet"]

    # For multicolor decks, prioritize color-fixing and land ramp
    num_colors = len(color_identity)
    colored_ramp = []
    for color in color_identity:
        colored_ramp.extend(RAMP_CARDS.get(color, []))

    # Remaining colorless rocks
    colorless = [r for r in RAMP_CARDS.get('colorless', []) if r not in essential_rocks]

    # Build balanced list: essential rocks first, then interleave colored and colorless
    ramp = list(essential_rocks)

    # For 3+ color decks, prioritize land ramp (green) and color fixers
    if num_colors >= 3:
        # Add colored ramp first (land ramp helps with fixing)
        ramp.extend(colored_ramp)
        ramp.extend(colorless)
    else:
        # For 1-2 color decks, mana rocks are often better
        ci, cc = 0, 0
        while ci < len(colorless) or cc < len(colored_ramp):
            if ci < len(colorless):
                ramp.append(colorless[ci])
                ci += 1
            if cc < len(colored_ramp):
                ramp.append(colored_ramp[cc])
                cc += 1

    return ramp


def get_draw_for_colors(color_identity: List[str]) -> List[str]:
    """Get available card draw for given color identity, interleaved by color."""
    draw = []
    colorless = list(CARD_DRAW.get('colorless', []))

    # Get draw by color separately
    by_color = {c: list(CARD_DRAW.get(c, [])) for c in color_identity}
    indices = {c: 0 for c in color_identity}
    ci = 0

    # Round-robin through colors, then add colorless
    colors_with_cards = [c for c in color_identity if by_color[c]]
    while colors_with_cards or ci < len(colorless):
        # Take one from each color
        for color in list(colors_with_cards):
            if indices[color] < len(by_color[color]):
                draw.append(by_color[color][indices[color]])
                indices[color] += 1
            else:
                colors_with_cards.remove(color)

        # Add one colorless every round
        if ci < len(colorless):
            draw.append(colorless[ci])
            ci += 1

    return draw
