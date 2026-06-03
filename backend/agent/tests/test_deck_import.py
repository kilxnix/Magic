"""Tests for deck_import: parse_decklist and validate_deck."""

import pytest

from backend.agent.deck_import import parse_decklist, repair_singleton_duplicates, validate_deck, BASIC_LAND_NAMES


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def _mock_card_db() -> dict:
    """Minimal card database for testing."""
    return {
        "Atraxa, Praetors' Voice": {
            "name": "Atraxa, Praetors' Voice",
            "type_line": "Legendary Creature — Phyrexian Angel Horror",
            "oracle_text": "Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate.",
            "color_identity": ["W", "U", "B", "G"],
        },
        "Sol Ring": {
            "name": "Sol Ring",
            "type_line": "Artifact",
            "oracle_text": "{T}: Add {C}{C}.",
            "color_identity": [],
        },
        "Arcane Signet": {
            "name": "Arcane Signet",
            "type_line": "Artifact",
            "oracle_text": "{T}: Add one mana of any color in your commander's color identity.",
            "color_identity": [],
        },
        "Command Tower": {
            "name": "Command Tower",
            "type_line": "Land",
            "oracle_text": "{T}: Add one mana of any color in your commander's color identity.",
            "color_identity": [],
        },
        "Lightning Bolt": {
            "name": "Lightning Bolt",
            "type_line": "Instant",
            "oracle_text": "Lightning Bolt deals 3 damage to any target.",
            "color_identity": ["R"],
        },
        "Mana Crypt": {
            "name": "Mana Crypt",
            "type_line": "Artifact",
            "oracle_text": "At the beginning of your upkeep, flip a coin. If you lose the flip, Mana Crypt deals 3 damage to you.\n{T}: Add {C}{C}.",
            "color_identity": [],
        },
        "Krenko, Mob Boss": {
            "name": "Krenko, Mob Boss",
            "type_line": "Legendary Creature — Goblin Warrior",
            "oracle_text": "{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.",
            "color_identity": ["R"],
        },
        "Rhystic Study": {
            "name": "Rhystic Study",
            "type_line": "Enchantment",
            "oracle_text": "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
            "color_identity": ["U"],
        },
        "Mystic Remora": {
            "name": "Mystic Remora",
            "type_line": "Enchantment",
            "oracle_text": "Cumulative upkeep {1}. Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.",
            "color_identity": ["U"],
        },
        "Aclazotz, Deepest Betrayal // Temple of the Dead": {
            "name": "Aclazotz, Deepest Betrayal // Temple of the Dead",
            "layout": "transform",
            "type_line": "Legendary Creature - Bat God // Land",
            "oracle_text": "",
            "color_identity": ["B"],
            "legalities": {"commander": "legal"},
            "card_faces": [
                {"name": "Aclazotz, Deepest Betrayal"},
                {"name": "Temple of the Dead"},
            ],
        },
        "Aclazotz, Deepest Betrayal // Aclazotz, Deepest Betrayal": {
            "name": "Aclazotz, Deepest Betrayal // Aclazotz, Deepest Betrayal",
            "layout": "art_series",
            "type_line": "Card // Card",
            "oracle_text": "",
            "color_identity": [],
            "legalities": {"commander": "not_legal"},
            "card_faces": [
                {"name": "Aclazotz, Deepest Betrayal"},
                {"name": "Aclazotz, Deepest Betrayal"},
            ],
        },
        "Temp of the Damned": {
            "name": "Temp of the Damned",
            "type_line": "Creature - Zombie",
            "oracle_text": "",
            "color_identity": ["B"],
            "legalities": {"commander": "not_legal"},
        },
        "Ravos, Soultender": {
            "name": "Ravos, Soultender",
            "type_line": "Legendary Creature - Human Cleric",
            "oracle_text": "Partner",
            "color_identity": ["W", "B"],
        },
        "Tana, the Bloodsower": {
            "name": "Tana, the Bloodsower",
            "type_line": "Legendary Creature - Elf Druid",
            "oracle_text": "Partner",
            "color_identity": ["R", "G"],
        },
        "The Fourteenth Doctor": {
            "name": "The Fourteenth Doctor",
            "type_line": "Legendary Creature - Time Lord Doctor",
            "oracle_text": "Doctor's companion",
            "color_identity": ["G", "R", "U", "W"],
        },
        "Clara Oswald": {
            "name": "Clara Oswald",
            "type_line": "Legendary Creature - Human Advisor",
            "oracle_text": (
                "Impossible Girl - If Clara Oswald is your commander, choose a color before the game begins. "
                "Clara Oswald is the chosen color.\nDoctor's companion"
            ),
            "color_identity": ["G"],
        },
        "Eerie Ultimatum": {
            "name": "Eerie Ultimatum",
            "type_line": "Sorcery",
            "oracle_text": "Return any number of permanent cards with different names from your graveyard to the battlefield.",
            "color_identity": ["W", "B", "G"],
        },
        "The World Tree": {
            "name": "The World Tree",
            "type_line": "Land",
            "oracle_text": "{T}: Add {G}.",
            "color_identity": ["W", "U", "B", "R", "G"],
        },
    }


# ---------------------------------------------------------------------------
# parse_decklist tests
# ---------------------------------------------------------------------------

class TestParseDecklist:

    def test_standard_moxfield_format(self):
        text = "1 Sol Ring\n1 Arcane Signet"
        result = parse_decklist(text)
        assert "Sol Ring" in result["cards"]
        assert "Arcane Signet" in result["cards"]
        assert result["commander"] is None
        assert result["total"] == 2
        assert result["errors"] == []

    def test_quantity_x_format(self):
        text = "1x Sol Ring\n2x Arcane Signet"
        result = parse_decklist(text)
        assert "Sol Ring" in result["cards"]
        # Non-basic with qty>1 stays in the raw import count but is invalid.
        assert result["cards"].count("Arcane Signet") == 2
        assert result["total"] == 3
        assert any("Arcane Signet" in e for e in result["errors"])

    def test_cmdr_marker(self):
        text = "1 Atraxa, Praetors' Voice *CMDR*\n1 Sol Ring"
        result = parse_decklist(text)
        assert result["commander"] == "Atraxa, Praetors' Voice"
        assert "Sol Ring" in result["cards"]
        assert result["total"] == 2  # commander + Sol Ring

    def test_commander_prefix(self):
        text = "Commander: Atraxa, Praetors' Voice\n1 Sol Ring"
        result = parse_decklist(text)
        assert result["commander"] == "Atraxa, Praetors' Voice"

    def test_commander_section_preserves_names_starting_with_x(self):
        text = "Commander\n1 Xenagos, God of Revels\nDeck\n1 Sol Ring"
        result = parse_decklist(text)
        assert result["commander"] == "Xenagos, God of Revels"
        assert "Sol Ring" in result["cards"]

    def test_just_card_names(self):
        text = "Sol Ring\nArcane Signet"
        result = parse_decklist(text)
        assert "Sol Ring" in result["cards"]
        assert "Arcane Signet" in result["cards"]
        assert result["total"] == 2

    def test_comments_ignored(self):
        text = "// sideboard\n# note\n1 Sol Ring"
        result = parse_decklist(text)
        assert result["cards"] == ["Sol Ring"]
        assert result["total"] == 1

    def test_blank_lines_ignored(self):
        text = "\n1 Sol Ring\n\n1 Arcane Signet\n"
        result = parse_decklist(text)
        assert len(result["cards"]) == 2

    def test_basic_land_duplicates_allowed(self):
        text = "10 Forest"
        result = parse_decklist(text)
        assert result["lands"].count("Forest") == 10
        assert result["total"] == 10
        assert result["errors"] == []

    def test_basic_land_wastes(self):
        text = "5 Wastes"
        result = parse_decklist(text)
        assert result["lands"].count("Wastes") == 5
        assert result["errors"] == []

    def test_snow_basic_land_duplicates_allowed(self):
        text = "14 Snow-Covered Forest"
        result = parse_decklist(text)
        assert result["lands"].count("Snow-Covered Forest") == 14
        assert result["total"] == 14
        assert result["errors"] == []

    def test_nonbasic_duplicate_flagged(self):
        text = "1 Sol Ring\n1 Sol Ring"
        result = parse_decklist(text)
        assert result["cards"].count("Sol Ring") == 2
        assert result["total"] == 2
        assert any("Duplicate" in e for e in result["errors"])

    def test_nonbasic_quantity_duplicate_preserves_raw_count(self):
        text = "2 Sol Ring"
        result = parse_decklist(text)
        assert result["cards"].count("Sol Ring") == 2
        assert result["total"] == 2
        assert any("quantity 2" in e for e in result["errors"])

    def test_sideboard_header_ignored(self):
        text = "1 Sol Ring\nSideboard\n1 Arcane Signet"
        result = parse_decklist(text)
        assert "Sol Ring" in result["cards"]
        assert "Arcane Signet" not in result["cards"]

    def test_double_blank_sideboard(self):
        text = "1 Sol Ring\n\n\n1 Arcane Signet"
        result = parse_decklist(text)
        assert "Sol Ring" in result["cards"]
        assert "Arcane Signet" not in result["cards"]

    def test_mixed_format(self):
        text = (
            "Commander: Atraxa, Praetors' Voice\n"
            "1 Sol Ring\n"
            "Arcane Signet\n"
            "10 Forest\n"
            "// This is a comment\n"
            "5 Island\n"
        )
        result = parse_decklist(text)
        assert result["commander"] == "Atraxa, Praetors' Voice"
        assert "Sol Ring" in result["cards"]
        assert "Arcane Signet" in result["cards"]
        assert result["lands"].count("Forest") == 10
        assert result["lands"].count("Island") == 5
        assert result["total"] == 1 + 2 + 15  # commander + 2 cards + 15 lands

    def test_category_header_ends_commander_section(self):
        text = (
            "Commander\n"
            "1 Atraxa, Praetors' Voice\n"
            "Artifacts (2)\n"
            "1 Sol Ring (C21) 267 *F* # ramp\n"
            "1 [C21:123] Arcane Signet\n"
            "Lands (2)\n"
            "2 Forest\n"
        )
        result = parse_decklist(text)
        assert result["commander"] == "Atraxa, Praetors' Voice"
        assert result["commanders"] == ["Atraxa, Praetors' Voice"]
        assert result["cards"] == ["Sol Ring", "Arcane Signet"]
        assert result["lands"] == ["Forest", "Forest"]

    def test_sideboard_prefixes_and_skip_sections(self):
        text = (
            "Deck\n"
            "1 Sol Ring\n"
            "SB 1 Arcane Signet\n"
            "Maybeboard (1)\n"
            "1 Rhystic Study\n"
            "Deck\n"
            "1 Forest\n"
        )
        result = parse_decklist(text, singleton=False)
        assert result["cards"] == ["Sol Ring"]
        assert result["sideboard"] == ["Arcane Signet"]
        assert result["lands"] == ["Forest"]
        assert "Rhystic Study" not in result["cards"]

    def test_rejects_unbounded_quantities(self):
        text = "999999 Forest"
        result = parse_decklist(text)
        assert result["lands"].count("Forest") == 250
        assert any("capped" in e for e in result["errors"])


# ---------------------------------------------------------------------------
# validate_deck tests
# ---------------------------------------------------------------------------

class TestValidateDeck:

    def test_valid_deck_basics(self):
        card_db = _mock_card_db()
        parsed = {
            "commander": "Atraxa, Praetors' Voice",
            "cards": ["Sol Ring", "Arcane Signet"],
            "lands": ["Command Tower"],
            "total": 4,
            "errors": [],
        }
        result = validate_deck(parsed, card_db)
        # Deck is short but should have no *errors* besides count
        assert result["color_identity"] == ["W", "U", "B", "G"]
        assert result["missing_slots"] == 96  # 100 - 4
        assert any("96 slots" in w for w in result["warnings"])

    def test_commander_not_legendary(self):
        card_db = _mock_card_db()
        card_db["Not Legendary"] = {
            "name": "Not Legendary",
            "type_line": "Creature — Human",
            "oracle_text": "",
            "color_identity": ["W"],
        }
        parsed = {
            "commander": "Not Legendary",
            "cards": [],
            "lands": [],
            "total": 1,
            "errors": [],
        }
        result = validate_deck(parsed, card_db)
        assert not result["valid"]
        assert any("not legendary" in e for e in result["errors"])

    def test_color_identity_violation(self):
        card_db = _mock_card_db()
        # Krenko is R, Atraxa is WUBG — Lightning Bolt is R, outside Atraxa? No, wait.
        # Let's use Krenko as commander (R only), then add Rhystic Study (U)
        parsed = {
            "commander": "Krenko, Mob Boss",
            "cards": ["Rhystic Study"],
            "lands": [],
            "total": 2,
            "errors": [],
        }
        result = validate_deck(parsed, card_db)
        assert not result["valid"]
        assert any("color identity" in e.lower() for e in result["errors"])

    def test_banned_card_error(self):
        card_db = _mock_card_db()
        parsed = {
            "commander": "Atraxa, Praetors' Voice",
            "cards": ["Mana Crypt"],
            "lands": [],
            "total": 2,
            "errors": [],
        }
        result = validate_deck(parsed, card_db)
        assert not result["valid"]
        assert any("banned" in e.lower() for e in result["errors"])

    def test_card_not_in_db(self):
        card_db = _mock_card_db()
        parsed = {
            "commander": "Atraxa, Praetors' Voice",
            "cards": ["Nonexistent Card XYZ"],
            "lands": [],
            "total": 2,
            "errors": [],
        }
        result = validate_deck(parsed, card_db)
        assert not result["valid"]
        assert any("not found" in e for e in result["errors"])

    def test_no_commander_error(self):
        card_db = _mock_card_db()
        parsed = {
            "commander": None,
            "cards": ["Sol Ring"],
            "lands": [],
            "total": 1,
            "errors": [],
        }
        result = validate_deck(parsed, card_db)
        assert not result["valid"]
        assert any("No commander" in e for e in result["errors"])

    def test_basic_lands_always_valid(self):
        card_db = _mock_card_db()
        parsed = {
            "commander": "Atraxa, Praetors' Voice",
            "cards": [],
            "lands": ["Forest"] * 30 + ["Plains"] * 20 + ["Island"] * 20 + ["Swamp"] * 28,
            "total": 99,
            "errors": [],
        }
        result = validate_deck(parsed, card_db)
        # Only warning should be about count (99 not 100... actually 1 cmd + 98 lands = 99)
        color_errors = [e for e in result["errors"] if "color identity" in e.lower()]
        assert color_errors == []

    def test_snow_basic_lands_always_valid(self):
        card_db = _mock_card_db()
        parsed = {
            "commander": "Krenko, Mob Boss",
            "cards": [],
            "lands": ["Snow-Covered Mountain"] * 99,
            "total": 100,
            "errors": [],
        }
        result = validate_deck(parsed, card_db)
        assert result["valid"]
        assert parsed["lands"].count("Snow-Covered Mountain") == 99

    def test_reclassify_nonbasic_land(self):
        """Cards with 'Land' in type_line should move to the lands list."""
        card_db = _mock_card_db()
        parsed = {
            "commander": "Atraxa, Praetors' Voice",
            "cards": ["Command Tower", "Sol Ring"],
            "lands": [],
            "total": 3,
            "errors": [],
        }
        result = validate_deck(parsed, card_db)
        # Command Tower should have been moved to lands
        assert "Command Tower" in parsed["lands"]
        assert "Command Tower" not in parsed["cards"]

    def test_too_many_cards_error(self):
        card_db = _mock_card_db()
        parsed = {
            "commander": "Atraxa, Praetors' Voice",
            "cards": ["Sol Ring"],
            "lands": ["Forest"] * 100,
            "total": 102,
            "errors": [],
        }
        result = validate_deck(parsed, card_db)
        assert not result["valid"]
        assert any("maximum is 100" in e for e in result["errors"])

    def test_parse_errors_propagate(self):
        """Errors from parsing should carry through to validation."""
        card_db = _mock_card_db()
        parsed = {
            "commander": "Atraxa, Praetors' Voice",
            "cards": ["Sol Ring"],
            "lands": [],
            "total": 2,
            "errors": ["Parse error from earlier"],
        }
        result = validate_deck(parsed, card_db)
        assert "Parse error from earlier" in result["errors"]

    def test_double_faced_commander_imported_as_full_name(self):
        card_db = _mock_card_db()
        text = (
            "Commander\n"
            "1 Aclazotz, Deepest Betrayal // Temple of the Dead\n"
            "Deck\n"
            "99 Swamp\n"
        )
        parsed = parse_decklist(text)
        result = validate_deck(parsed, card_db)

        assert result["valid"]
        assert parsed["commander"] == "Aclazotz, Deepest Betrayal // Temple of the Dead"
        assert parsed["commanders"] == ["Aclazotz, Deepest Betrayal // Temple of the Dead"]
        assert parsed["total"] == 100
        assert not any("Temp of the Damned" in item for item in result["errors"] + result["warnings"])

    def test_double_faced_commander_recombined_when_url_import_splits_faces(self):
        card_db = _mock_card_db()
        text = (
            "Commander\n"
            "1 Aclazotz, Deepest Betrayal\n"
            "1 Temple of the Dead\n"
            "Deck\n"
            "99 Swamp\n"
        )
        parsed = parse_decklist(text)
        assert parsed["total"] == 101

        result = validate_deck(parsed, card_db)

        assert result["valid"]
        assert parsed["commander"] == "Aclazotz, Deepest Betrayal // Temple of the Dead"
        assert parsed["commanders"] == ["Aclazotz, Deepest Betrayal // Temple of the Dead"]
        assert parsed["total"] == 100
        assert not any("Temp of the Damned" in item for item in result["errors"] + result["warnings"])

    def test_front_face_commander_resolves_to_playable_double_faced_card(self):
        card_db = _mock_card_db()
        parsed = {
            "commander": "Aclazotz, Deepest Betrayal",
            "cards": [],
            "lands": ["Swamp"] * 99,
            "total": 100,
            "errors": [],
        }

        result = validate_deck(parsed, card_db)

        assert result["valid"]
        assert parsed["commander"] == "Aclazotz, Deepest Betrayal // Temple of the Dead"
        assert not result["warnings"]

    def test_partner_commanders_still_split_when_no_full_card_exists(self):
        card_db = _mock_card_db()
        parsed = {
            "commander": "Ravos, Soultender // Tana, the Bloodsower",
            "cards": [],
            "lands": ["Swamp"] * 98,
            "total": 100,
            "errors": [],
        }

        result = validate_deck(parsed, card_db)

        assert result["valid"]
        assert parsed["commanders"] == ["Ravos, Soultender", "Tana, the Bloodsower"]
        assert parsed["total"] == 100

    def test_partner_commanders_duplicated_in_main_deck_are_not_counted_twice(self):
        card_db = _mock_card_db()
        parsed = {
            "commander": "Ravos, Soultender // Tana, the Bloodsower",
            "cards": ["Ravos, Soultender", "Tana, the Bloodsower"],
            "lands": ["Swamp"] * 98,
            "total": 102,
            "errors": [],
        }

        result = validate_deck(parsed, card_db)

        assert result["valid"]
        assert parsed["commanders"] == ["Ravos, Soultender", "Tana, the Bloodsower"]
        assert parsed["total"] == 100
        assert "Ravos, Soultender" not in parsed["cards"]
        assert "Tana, the Bloodsower" not in parsed["cards"]
        assert not any("maximum is 100" in error for error in result["errors"])

    def test_partner_deck_duplicate_nonbasic_does_not_create_missing_slot(self):
        card_db = _mock_card_db()
        text = "\n".join([
            "Commander",
            "1 Ravos, Soultender",
            "1 Tana, the Bloodsower",
            "Deck",
            "1 Sol Ring",
            "1 Sol Ring",
            "96 Swamp",
        ])
        parsed = parse_decklist(text)

        result = validate_deck(parsed, card_db)

        assert not result["valid"]
        assert parsed["commanders"] == ["Ravos, Soultender", "Tana, the Bloodsower"]
        assert parsed["total"] == 100
        assert result["missing_slots"] == 0
        assert any("Duplicate non-basic card: 'Sol Ring'" in error for error in result["errors"])
        assert not any("Deck has only" in warning for warning in result["warnings"])

    def test_repair_singleton_duplicate_removes_extra_copy(self):
        card_db = _mock_card_db()
        text = "\n".join([
            "Commander",
            "1 Ravos, Soultender",
            "1 Tana, the Bloodsower",
            "Deck",
            "1 Sol Ring",
            "1 Sol Ring",
            "96 Swamp",
        ])
        parsed = parse_decklist(text)

        removed = repair_singleton_duplicates(parsed)
        result = validate_deck(parsed, card_db)

        assert removed == ["Sol Ring"]
        assert parsed["cards"].count("Sol Ring") == 1
        assert parsed["total"] == 99
        assert result["missing_slots"] == 1
        assert not any("Duplicate non-basic" in error for error in result["errors"])

    def test_clara_oswald_commander_choice_allows_any_color(self):
        card_db = _mock_card_db()
        parsed = {
            "commander": "The Fourteenth Doctor // Clara Oswald",
            "cards": ["Eerie Ultimatum"],
            "lands": ["The World Tree"] + ["Forest"] * 96,
            "total": 100,
            "errors": [],
        }

        result = validate_deck(parsed, card_db)

        assert result["valid"]
        assert set(result["color_identity"]) == {"W", "U", "B", "R", "G"}
        assert parsed["commanders"] == ["The Fourteenth Doctor", "Clara Oswald"]
        color_errors = [e for e in result["errors"] if "color identity" in e.lower()]
        assert color_errors == []
