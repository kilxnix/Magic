# Plan: Implement Official Commander Brackets (Oct 2025 Update)

The goal is to align the deck generator with the new official "Commander Brackets" (1-4) as defined by Wizards of the Coast.

## 1. Define New Rules (`backend/rules.py`)

We need to replace the existing 5-tier system with the new 4-tier system + cEDH (effectively 5 tiers still, but renamed and redefined).

**New Brackets:**
1.  **Exhibition (Bracket 1):** Theme > Function. No fast wins (9+ turns). Flexible legality (Un-sets allowed? - *For now, we'll stick to Commander legal cards but deprioritize efficiency*).
    *   *Constraint:* No "Game Changers". Very high average CMC?
2.  **Core (Bracket 2):** Standard casual. Creativity/Entertainment. Low pressure.
    *   *Constraint:* No "Game Changers". Wins turn 8+.
3.  **Upgraded (Bracket 3):** High synergy, effective disruption.
    *   *Constraint:* Limited "Game Changers" (maybe 1-2?). Wins turn 6+.
4.  **Optimized (Bracket 4):** Lethal, consistent, fast.
    *   *Constraint:* No restrictions on Game Changers. Wins turn 4+.
    *   *Note:* Distinct from cEDH (Bracket 5?) - The article mentions cEDH is "reserved for Bracket 5" conceptually or just "Tournament". We will keep a "Bracket 5 (cEDH)" for maximum power, but the official system focuses on 1-4. We will map Bracket 4 to "Optimized" and keep 5 as "Competitive/Maximum".

**"Game Changers" List:**
We must define the specific list of cards flagged in the article as "Game Changers".
*   **Creatures:** Drannith Magistrate, Consecrated Sphinx, Thassa's Oracle, etc.
*   **Enchantments:** Rhystic Study, Smothering Tithe, etc.
*   **Artifacts:** Mana Crypt, The One Ring, etc.
*   **Instants/Sorceries:** Tutors, Free Spells (Force of Will, etc).
*   **Lands:** Gaea's Cradle, Ancient Tomb, etc.

## 2. Update Deck Generation Logic (`backend/deck_generator.py`)

The generator needs to enforce these constraints.

*   **Bracket 1 & 2:** HARD BAN on "Game Changers".
*   **Bracket 3:** Soft limit on "Game Changers" (e.g., max 2).
*   **Bracket 4:** No limit.
*   **Mana Curve / Speed:**
    *   Bracket 1/2: Slower curve (higher avg CMC is okay/encouraged).
    *   Bracket 4: Faster curve (lower avg CMC).

## 3. Frontend Updates

*   Update the "Power Level" selector to show the new Brackets (1-4) and descriptions.
*   Display the "Expected Turns" info.

## 4. Execution Steps

1.  **Modify `backend/rules.py`**:
    *   Define `GAME_CHANGERS` list (set of card names).
    *   Update `COMMANDER_BRACKETS` dictionary with new definitions.
    *   Update `is_card_allowed_in_bracket` logic.
2.  **Modify `backend/deck_generator.py`**:
    *   Ensure `_get_cmc` fixes from previous turn are preserved.
    *   Update logic to respect the new bracket constraints.
3.  **Frontend**:
    *   Check `types.ts` (shared types).
    *   The frontend likely fetches brackets from `/api/brackets`. If so, backend changes might auto-propagate to UI text.

## 5. Verification

*   Generate a Bracket 2 deck: Ensure no *Sol Ring*, *Mana Crypt*, *Rhystic Study*, etc.
*   Generate a Bracket 4 deck: Ensure these cards *can* appear.
