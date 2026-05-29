# High-Power Edge-Case Candidates

Generated from local card data. This is a test backlog, not a support claim.

## Layers and Type-Changing

These cards stress type-changing, devotion, ability grants/removes, and timestamp/dependency ordering.

Suggested test file: `engine/src/__tests__/rules-maturity-1v1.test.ts`

Total local matches: 542

| Card | Set | Type | Matched Pattern Count |
| --- | --- | --- | --- |
| Opalescence | uds | Enchantment | 1 |
| Sakashima the Impostor | sok | Legendary Creature — Human Rogue | 1 |
| Mycosynth Lattice | bbd | Artifact | 1 |
| Roaming Throne | lci | Artifact Creature — Golem | 1 |
| Tezzeret the Seeker | mm2 | Legendary Planeswalker — Tezzeret | 1 |
| Thassa, Deep-Dwelling | thb | Legendary Enchantment Creature — God | 1 |
| Enchanted Evening | shm | Enchantment | 1 |
| Vaultborn Tyrant | big | Creature — Dinosaur | 1 |
| Phenax, God of Deception | bng | Legendary Enchantment Creature — God | 1 |
| Portal to Phyrexia | bro | Artifact | 1 |
| Purphoros, God of the Forge | cmm | Legendary Enchantment Creature — God | 1 |
| Athreos, God of Passage | jou | Legendary Enchantment Creature — God | 1 |

## Replacement and Prevention

Replacement effects are non-stack effects and are easy to order incorrectly with SBAs, damage, draw, and zone changes.

Suggested test file: `engine/src/__tests__/rules-maturity-1v1.test.ts`

Total local matches: 1374

| Card | Set | Type | Matched Pattern Count |
| --- | --- | --- | --- |
| Pyramids | arn | Artifact | 1 |
| Gemstone Caverns | tsr | Legendary Land | 1 |
| Toshiro Umezawa | bok | Legendary Creature — Human Samurai | 2 |
| Quicksilver Elemental | mrd | Creature — Elemental | 1 |
| Ravenous Tyrannosaurus | rex | Creature — Dinosaur | 1 |
| Anointed Procession | akh | Enchantment | 2 |
| Vorinclex, Monstrous Raider | khm | Legendary Creature — Phyrexian Praetor | 2 |
| Serra the Benevolent | mh1 | Legendary Planeswalker — Serra | 2 |
| Scorched Ruins | wth | Land | 2 |
| Blightsteel Colossus | 2xm | Artifact Creature — Phyrexian Golem | 2 |
| Force of Negation | 2x2 | Instant | 1 |
| Elspeth, Storm Slayer | tdm | Legendary Planeswalker — Elspeth | 2 |

## Stack, Priority, and Tax Triggers

High-power games frequently stack free spells, counterspells, Rhystic-style triggers, and multiple may-pay choices.

Suggested test file: `engine/src/high-power-interactions.test.ts`

Total local matches: 2027

| Card | Set | Type | Matched Pattern Count |
| --- | --- | --- | --- |
| Mindbreak Trap | zen | Instant — Trap | 1 |
| Mana Vault | 2x2 | Artifact | 1 |
| Mental Misstep | nph | Instant | 1 |
| Dromar, the Banisher | inv | Legendary Creature — Dragon | 1 |
| Counterbalance | csp | Enchantment | 1 |
| Force of Will | dmr | Instant | 2 |
| Submerge | nem | Instant | 1 |
| Decree of Silence | scg | Enchantment | 2 |
| Esper Sentinel | mh2 | Artifact Creature — Human Soldier | 2 |
| Deflecting Swat | cmm | Instant | 1 |
| The First Sliver | mh1 | Legendary Creature — Sliver | 1 |
| Rhystic Study | j22 | Enchantment | 2 |

## Hidden Information and Library Search

Tutors, naming, look effects, and top-library placement need scoped UI choices and deterministic engine state.

Suggested test file: `engine/src/playtesting-report-regressions.test.ts`

Total local matches: 2026

| Card | Set | Type | Matched Pattern Count |
| --- | --- | --- | --- |
| Academy Rector | uds | Creature — Human Cleric | 1 |
| Sliver Overlord | scg | Legendary Creature — Sliver Mutant | 1 |
| Captain Sisay | inv | Legendary Creature — Human Soldier | 1 |
| Imperial Seal | 2x2 | Sorcery | 1 |
| Defense of the Heart | ulg | Enchantment | 1 |
| Moggcatcher | nem | Creature — Human Mercenary | 1 |
| Wargate | arb | Sorcery | 1 |
| Submerge | nem | Instant | 1 |
| Natural Selection | 2ed | Instant | 1 |
| Scapeshift | m19 | Sorcery | 1 |
| Demonic Tutor | cmm | Sorcery | 1 |
| Vampiric Tutor | dmr | Instant | 1 |

## Tokens, Counters, and Randomization

Commander board states often hinge on token typing, counter replacement, dice rolls, and future token counting.

Suggested test file: `engine/src/__tests__/starter-decks-card-qa.test.ts`

Total local matches: 7191

| Card | Set | Type | Matched Pattern Count |
| --- | --- | --- | --- |
| Gaea's Cradle | usg | Legendary Land | 1 |
| Serra's Sanctum | usg | Legendary Land | 1 |
| Powder Keg | uds | Artifact | 1 |
| Jaws, Relentless Predator | sld | Legendary Creature — Shark | 2 |
| Umezawa's Jitte | bok | Legendary Artifact — Equipment | 1 |
| The One Ring | ltr | Legendary Artifact | 1 |
| Mycosynth Golem | 5dn | Artifact Creature — Golem | 1 |
| Ancient Copper Dragon | clb | Creature — Elder Dragon | 3 |
| Collective Restraint | inv | Enchantment | 1 |
| Tombstone Stairwell | mir | World Enchantment | 2 |
| The Great Henge | cmm | Legendary Artifact | 1 |
| Decree of Silence | scg | Enchantment | 1 |

## Silver-Bordered and Unusual Text

Un-cards and unusual physical/random instructions must either work generically or degrade without crashing.

Suggested test file: `engine/src/__tests__/rules-maturity-1v1.test.ts`

Total local matches: 176

| Card | Set | Type | Matched Pattern Count |
| --- | --- | --- | --- |
| Ancient Copper Dragon | clb | Creature — Elder Dragon | 1 |
| Ancient Silver Dragon | clb | Creature — Elder Dragon | 1 |
| Cunning Wish | jud | Instant | 1 |
| Crooked Scales | mmq | Artifact | 1 |
| Ancient Brass Dragon | clb | Creature — Elder Dragon | 1 |
| Ancient Gold Dragon | clb | Creature — Elder Dragon | 1 |
| Spawnsire of Ulamog | roe | Creature — Eldrazi | 1 |
| Ancient Bronze Dragon | clb | Creature — Elder Dragon | 1 |
| Ral, Monsoon Mage // Ral, Leyline Prodigy | mh3 | Legendary Creature — Human Wizard // Legendary Planeswalker — Ral | 1 |
| Krark's Thumb | mrd | Legendary Artifact | 1 |
| Goblin Bomb | wth | Enchantment | 1 |
| Vexing Puzzlebox | clb | Artifact | 1 |

