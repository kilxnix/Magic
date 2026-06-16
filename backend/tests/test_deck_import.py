"""Tests for Commander deck import parsing/validation helpers."""

from backend.agent.deck_import import parse_decklist, validate_deck


def test_parse_decklist_accepts_flat_single_line_exports():
    # MTGGoldfish exports are frequently a single line.
    text = "Commander 1 Test Commander Deck 1 Sol Ring 98 Forest"
    parsed = parse_decklist(text)

    assert parsed["commander"] == "Test Commander"
    assert parsed["cards"] == ["Sol Ring"]
    assert len(parsed["lands"]) == 98
    assert parsed["total"] == 100


def test_parse_decklist_does_not_consume_card_names_starting_with_x():
    text = "Commander\n1 Xenagos, God of Revels\nDeck\n1 Sol Ring\n98 Forest"
    parsed = parse_decklist(text)

    assert parsed["commander"] == "Xenagos, God of Revels"
    assert "Sol Ring" in parsed["cards"]
    assert len(parsed["lands"]) == 98


def test_validate_deck_minimal_mode_without_card_db():
    text = "Commander 1 Test Commander Deck 1 Sol Ring 98 Forest"
    parsed = parse_decklist(text)
    result = validate_deck(parsed, card_db={})

    assert result["valid"] is True
    assert result["missing_slots"] == 0
    assert any("Card database unavailable" in w for w in result["warnings"])


def _card(name, type_line, oracle_text="", color_identity=None):
    return {
        "name": name,
        "type_line": type_line,
        "oracle_text": oracle_text,
        "color_identity": color_identity or [],
        "colors": color_identity or [],
        "cmc": 0,
        "mana_cost": "",
    }


def test_validate_deck_accepts_non_creature_vehicle_commander():
    # Shorikai is a legal precon FACE commander but a Legendary Artifact — Vehicle
    # with no "can be your commander" text; it must be accepted (with a warning),
    # not hard-rejected.
    card_db = {
        "Shorikai, Genesis Engine": _card(
            "Shorikai, Genesis Engine", "Legendary Artifact — Vehicle",
            "{1}, {T}: Draw two cards, then discard a card. Crew 8", ["U"]),
        "Island": _card("Island", "Basic Land — Island", "{T}: Add {U}.", ["U"]),
    }
    parsed = parse_decklist("Commander\n1 Shorikai, Genesis Engine\nDeck\n99 Island")
    result = validate_deck(parsed, card_db=card_db)

    assert not any("is not a creature" in e for e in result["errors"]), result["errors"]
    assert any("non-creature legendary permanent" in w for w in result["warnings"])


def test_validate_deck_auto_detects_partner_commanders_without_header():
    # Headerless Moxfield-style paste with two generic Partners listed first —
    # both must be detected, color identity unioned, no color-identity errors.
    card_db = {
        "Dargo, the Shipwrecker": _card("Dargo, the Shipwrecker", "Legendary Creature — Giant Pirate",
                                          "Partner (You can have two commanders if both have partner.) Trample", ["R"]),
        "Tymna the Weaver": _card("Tymna the Weaver", "Legendary Creature — Human Cleric",
                                   "Partner (You can have two commanders if both have partner.) Lifelink", ["W", "B"]),
        "Sol Ring": _card("Sol Ring", "Artifact", "{T}: Add {C}{C}.", []),
        "Yawgmoth's Will": _card("Yawgmoth's Will", "Legendary Sorcery", "Some effect.", ["B"]),
        "Swords to Plowshares": _card("Swords to Plowshares", "Instant", "Exile target creature.", ["W"]),
        "Mountain": _card("Mountain", "Basic Land — Mountain", "{T}: Add {R}.", ["R"]),
        "Swamp": _card("Swamp", "Basic Land — Swamp", "{T}: Add {B}.", ["B"]),
        "Plains": _card("Plains", "Basic Land — Plains", "{T}: Add {W}.", ["W"]),
    }
    # also set keywords so _is_plain_partner detects via keyword too
    card_db["Dargo, the Shipwrecker"]["keywords"] = ["Partner", "Trample"]
    card_db["Tymna the Weaver"]["keywords"] = ["Partner", "Lifelink"]
    text = ("1 Dargo, the Shipwrecker (CMR) 172\n1 Tymna the Weaver (C16) 48 *F*\n"
            "1 Sol Ring (SOC) 128\n1 Yawgmoth's Will (USG) 171\n1 Swords to Plowshares (LTC) 178\n"
            "30 Mountain (SCD) 345\n30 Swamp (WAR) 256\n35 Plains (BFZ) 252a")
    parsed = parse_decklist(text)
    result = validate_deck(parsed, card_db=card_db)

    assert parsed["commanders"] == ["Dargo, the Shipwrecker", "Tymna the Weaver"]
    assert sorted(result["color_identity"]) == ["B", "R", "W"]
    assert not any("color identity" in e for e in result["errors"]), result["errors"]
    assert "Tymna the Weaver" not in parsed["cards"]


def _any_number_card_db():
    return {
        "Y'shtola, Night's Blessed": _card(
            "Y'shtola, Night's Blessed", "Legendary Creature — Human Wizard",
            "Some effect.", ["W", "B"]),
        "Cid, Timeless Artificer": _card(
            "Cid, Timeless Artificer", "Legendary Creature — Human Artificer",
            "A deck can have any number of cards named Cid, Timeless Artificer.", ["W"]),
        "Seven Dwarves": _card(
            "Seven Dwarves", "Creature — Dwarf",
            "A deck can have up to seven cards named Seven Dwarves.", ["W"]),
        "Thrumming Stone": _card(
            "Thrumming Stone", "Legendary Artifact",
            "Spells you cast have ripple 4.", []),
        "Sol Ring": _card("Sol Ring", "Artifact", "{T}: Add {C}{C}.", []),
        "Swamp": _card("Swamp", "Basic Land — Swamp", "{T}: Add {B}.", ["B"]),
    }


def test_validate_deck_allows_any_number_copies_cards():
    # Thrumming Stone decks run many copies of cards like Cid, Timeless
    # Artificer whose own text allows it — the singleton rule must not reject
    # them (set-code/art lines like "(FIN) 542" included).
    parsed = parse_decklist(
        "Commander\n1 Y'shtola, Night's Blessed\nDeck\n"
        "1 Thrumming Stone (FIN) 542\n25 Cid, Timeless Artificer (FIN) 244\n"
        "1 Sol Ring\n72 Swamp"
    )
    result = validate_deck(parsed, card_db=_any_number_card_db())

    assert result["errors"] == [], result["errors"]
    assert any("any number of copies" in w for w in result["warnings"])
    assert parsed["total"] == 100


def test_validate_deck_enforces_up_to_seven_cap():
    db = _any_number_card_db()
    ok = parse_decklist("Commander\n1 Y'shtola, Night's Blessed\nDeck\n7 Seven Dwarves\n92 Swamp")
    too_many = parse_decklist("Commander\n1 Y'shtola, Night's Blessed\nDeck\n8 Seven Dwarves\n91 Swamp")

    assert not any("only 1 allowed" in e for e in validate_deck(ok, card_db=db)["errors"])
    assert any("only 1 allowed" in e for e in validate_deck(too_many, card_db=db)["errors"])


def test_validate_deck_still_rejects_normal_duplicates():
    parsed = parse_decklist("Commander\n1 Y'shtola, Night's Blessed\nDeck\n2 Sol Ring\n97 Swamp")
    result = validate_deck(parsed, card_db=_any_number_card_db())
    assert any("Sol Ring" in e and "only 1 allowed" in e for e in result["errors"])


def test_repair_singleton_duplicates_keeps_exempt_copies():
    from backend.agent.deck_import import repair_singleton_duplicates

    parsed = parse_decklist(
        "Commander\n1 Y'shtola, Night's Blessed\nDeck\n"
        "25 Cid, Timeless Artificer\n2 Sol Ring\n72 Swamp"
    )
    removed = repair_singleton_duplicates(parsed, _any_number_card_db())

    assert removed == ["Sol Ring"]
    assert sum(1 for c in parsed["cards"] if c == "Cid, Timeless Artificer") == 25


def test_resolve_card_name_uses_local_flavor_map(monkeypatch):
    # Themed reprints (Secret Lair, FF: Through the Ages) print existing cards
    # under flavor names; mtg_data/flavor_names.json maps them to canonical
    # names so they resolve locally with no network.
    from backend.agent import deck_import

    db = {"Serra Ascendant": _card("Serra Ascendant", "Creature — Angel", "...", ["W"])}
    monkeypatch.setattr(deck_import, "_load_flavor_names",
                        lambda: {"aang, ascendant airbender": "Serra Ascendant"})
    monkeypatch.setattr(deck_import, "_scryfall_lookup",
                        lambda name: (_ for _ in ()).throw(AssertionError("network used")))

    resolved, warning = deck_import._resolve_card_name("Aang, Ascendant Airbender", db)
    assert resolved == "Serra Ascendant"
    assert "alternate printing name" in (warning or "")


def test_resolve_card_name_uses_scryfall_for_flavor_names(monkeypatch):
    # FINAL FANTASY: Through the Ages prints existing cards under FLAVOR names
    # (e.g. "Thrum of the Vestige" = Lightning Bolt). The local DB only knows
    # canonical names, so resolution must fall back to Scryfall BEFORE the
    # low-confidence difflib guess (which used to substitute a wrong card and
    # trip color-identity errors).
    from backend.agent import deck_import

    db = {
        "Lightning Bolt": _card("Lightning Bolt", "Instant",
                                 "Lightning Bolt deals 3 damage to any target.", ["R"]),
        # A tempting-but-wrong low-confidence guess target:
        "Triumph of the Hordes": _card("Triumph of the Hordes", "Sorcery", "...", ["G"]),
    }
    monkeypatch.setattr(deck_import, "_load_flavor_names", lambda: {})
    monkeypatch.setattr(
        deck_import, "_scryfall_lookup",
        lambda name: {"name": "Lightning Bolt", "type_line": "Instant",
                      "oracle_text": "Lightning Bolt deals 3 damage to any target.",
                      "color_identity": ["R"], "colors": ["R"], "cmc": 1,
                      "mana_cost": "{R}"} if name == "Thrum of the Vestige" else None,
    )

    resolved, warning = deck_import._resolve_card_name("Thrum of the Vestige", db)
    assert resolved == "Lightning Bolt"
    assert "Scryfall" in (warning or "")


def test_resolve_card_name_synthesizes_new_card_from_scryfall(monkeypatch):
    # A card newer than the local DB resolves via Scryfall and gets injected
    # into the card_db so validation and card-data building can use it.
    from backend.agent import deck_import

    db = {"Swamp": _card("Swamp", "Basic Land — Swamp", "", ["B"])}
    payload = {"name": "Brand New Card", "type_line": "Creature — Test",
               "oracle_text": "Test.", "color_identity": ["B"], "colors": ["B"],
               "cmc": 2, "mana_cost": "{1}{B}", "keywords": []}
    monkeypatch.setattr(deck_import, "_scryfall_lookup", lambda name: payload)

    resolved, warning = deck_import._resolve_card_name("Brand New Card", db)
    assert resolved == "Brand New Card"
    assert "Brand New Card" in db
    assert db["Brand New Card"]["color_identity"] == ["B"]


def test_resolve_card_name_falls_back_to_guess_when_scryfall_unavailable(monkeypatch):
    # Offline / Scryfall down: behavior degrades to the old low-confidence
    # guess rather than failing outright.
    from backend.agent import deck_import

    db = {"Triumph of the Hordes": _card("Triumph of the Hordes", "Sorcery", "...", ["G"])}
    monkeypatch.setattr(deck_import, "_scryfall_lookup", lambda name: None)

    resolved, warning = deck_import._resolve_card_name("Triumph of the Horde", db)
    assert resolved == "Triumph of the Hordes"


def test_validate_deck_rejects_legendary_instant_commander():
    # A legendary instant genuinely can't be a commander (it can't stay as a
    # permanent in the command zone) — still rejected.
    card_db = {
        "Sudden Spoiling": _card("Sudden Spoiling", "Legendary Instant", "Some effect.", ["B"]),
        "Swamp": _card("Swamp", "Basic Land — Swamp", "{T}: Add {B}.", ["B"]),
    }
    parsed = parse_decklist("Commander\n1 Sudden Spoiling\nDeck\n99 Swamp")
    result = validate_deck(parsed, card_db=card_db)

    assert any("is not a creature" in e for e in result["errors"]), result["errors"]

