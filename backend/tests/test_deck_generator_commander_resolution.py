from backend.deck_generator import DeckGenerator


def _legendary(name: str, card_id: str) -> dict:
    return {
        "id": card_id,
        "name": name,
        "type_line": "Legendary Creature - Test",
        "oracle_text": "",
        "color_identity": ["G"],
        "legalities": {"commander": "legal"},
    }


def _generator_with(cards: list[dict]) -> DeckGenerator:
    generator = DeckGenerator()
    generator.cards = cards
    generator.card_by_name = {card["name"]: card for card in cards}
    generator._loaded = True
    return generator


def test_double_faced_commander_name_does_not_duplicate_as_partners():
    dennick = _legendary(
        "Dennick, Pious Apprentice // Dennick, Pious Apparition",
        "dennick",
    )
    generator = _generator_with([dennick])

    commanders = generator.find_partner_commanders(
        "Dennick, Pious Apprentice // Dennick, Pious Apparition"
    )

    assert commanders == [dennick]


def test_double_faced_face_lookup_dedupes_to_one_commander_card():
    dennick = _legendary(
        "Dennick, Pious Apprentice // Dennick, Pious Apparition",
        "dennick",
    )
    generator = _generator_with([dennick])

    commanders = generator.find_partner_commanders(
        "Dennick, Pious Apprentice // Dennick, Pious Apparition // "
        "Dennick, Pious Apprentice // Dennick, Pious Apparition"
    )

    assert commanders == [dennick]


def test_partner_commanders_still_resolve_as_two_cards():
    ravos = _legendary("Ravos, Soultender", "ravos")
    tana = _legendary("Tana, the Bloodsower", "tana")
    generator = _generator_with([ravos, tana])

    commanders = generator.find_partner_commanders(
        "Ravos, Soultender // Tana, the Bloodsower"
    )

    assert commanders == [ravos, tana]
