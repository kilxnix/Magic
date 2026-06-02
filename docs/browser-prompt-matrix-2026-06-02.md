# Browser Prompt Matrix - 2026-06-02

Scope: live `/play` browser-extension prompt certification on `https://deckreps.app`.

| Prompt class | Live route | Commit proof | Browser result |
| --- | --- | --- | --- |
| Battlefield-entry replacement choice | `/play?qa=land-entry-fetch` | `d445a3e` | Stomping Ground from hand opened the pay-life/tapped choice. Pay-life branch resolved 40 -> 38, put the land onto battlefield untapped, and exposed mana actions. |
| Fetch/search library subtype filtering | `/play?qa=land-entry-fetch` | `d445a3e` | Scalding Tarn search allowed Steam Vents and Island, blocked Arcane Signet as not a land, and blocked Forest as missing Island/Mountain subtype. Steam Vents opened its own replacement prompt and resolved pay-life branch to LP 35. |
| Legendary search predicate | `/play?qa=sisay-raw-lands` | `933c25c` | Sisay activation appeared after WUBRG was produced from real lands, opened a search, allowed Yoshimaru, blocked Jodah by MV/power rule, and resolved Yoshimaru to battlefield. |
| Modal choice | `/play?qa=modal-choice` | `933c25c` | Abrade damage mode targeted and destroyed Grizzly Bears; artifact mode targeted and destroyed Sol Ring while leaving Grizzly Bears. |
| Scry | `/play?qa=library-manipulation` | `7d3e83d` | Opt opened Scry 1; moving Lightning Bolt to bottom changed the next draw to Island. |
| Surveil | `/play?qa=library-manipulation` | `7d3e83d` | Consider opened Surveil 1; moving Mountain to graveyard made Consider draw Forest and left graveyard count at 3. |
| Spell target prompt | `/play?qa=storm-grapeshot` | `0d4dad0` | Grapeshot target selection resolved storm copies and changed opponent life 40 -> 37. |
| Stack object target prompt / copied spell | `/play?qa=spell-copy` | `0d4dad0` | Fork targeted Lightning Bolt on the stack, resolved the copy plus original, and changed opponent life 40 -> 34. |
| Trigger ordering | `/play?qa=magecraft-triggers` | `811c18a` | Casting Opt opened six ordered magecraft triggers from Archmage Emeritus, Storm-Kiln Artist, and Veyran doubling; confirming order produced stacked Treasures, doubled draws, and Veyran 4/4. |
| Combat damage ordering | `/play?qa=complex-combat` | `2daa595` | Combat damage assignment prompt displayed Bear Blocker and Wall Blocker with lethal amounts; confirming order resolved 4-player combat to expected life totals and graveyards. |

Open outside this matrix:

- Per-card certification for every card in the target decks remains separate in `BCL-001`.
- Real room engine mode remains separate in `BCL-005`.
