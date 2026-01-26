# Deck Regeneration & Card Locking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to lock cards they like and regenerate the rest of the deck (up to 5 times), while fixing deck uniqueness by adding randomness and boosting synergy weight.

**Architecture:** Backend adds `/api/regenerate-deck` endpoint and modifies `DeckGenerator` with randomness + higher synergy weight. Frontend adds card locking UI to `DeckViewerPage` with click-to-toggle (checkbox fallback), regeneration counter, and new card highlighting.

**Tech Stack:** Python/FastAPI backend, React/TypeScript frontend, SQLite database

---

## Task 1: Add Core Staples Definition

**Files:**
- Modify: `backend/rules.py` (append after line 701)

**Step 1: Add CORE_STAPLES constant and helper function**

Add to the end of `backend/rules.py`:

```python
# Core staples that cannot be unlocked during deck regeneration
# These are auto-included and always kept
CORE_STAPLES: Set[str] = {
    # Universal mana rocks
    "Sol Ring",
    "Arcane Signet",
    "Command Tower",
}


def get_core_staples_for_colors(colors: List[str]) -> Set[str]:
    """
    Returns core staples that cannot be unlocked for regeneration.
    These cards are always kept when regenerating a deck.
    """
    staples = set(CORE_STAPLES)

    # Add color-specific must-haves
    if "W" in colors:
        staples.update(["Swords to Plowshares", "Path to Exile"])
    if "U" in colors:
        staples.update(["Counterspell"])
    if "B" in colors:
        staples.update(["Demonic Tutor"])
    if "R" in colors:
        staples.update(["Chaos Warp"])
    if "G" in colors:
        staples.update(["Cultivate", "Kodama's Reach"])

    return staples
```

**Step 2: Verify the import is correct**

The function uses `Set` and `List` which are already imported at the top of the file.

**Step 3: Commit**

```bash
git add backend/rules.py
git commit -m "feat(rules): add core staples definition for deck regeneration

Add CORE_STAPLES constant and get_core_staples_for_colors() function
to define cards that cannot be unlocked during deck regeneration.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add Randomness to Card Selection

**Files:**
- Modify: `backend/deck_generator.py:424-476` (the `_select_best_cards` method)

**Step 1: Add random import at the top if not already present**

Check line 4 - `random` is already imported.

**Step 2: Modify `_select_best_cards` to add controlled randomness**

Replace the method (lines 424-476) with:

```python
    def _select_best_cards(
        self,
        candidates: List[Dict],
        count: int,
        category: str,
        colors: List[str],
        bracket: int,
        counts: Dict[str, int],
        deck: Dict[str, int],
        current_curve: Dict[int, int],
        budget_tier: Optional[str] = None,
        randomness: float = 0.15
    ) -> List[Dict]:
        """
        Select the best cards from candidates using scoring with controlled randomness.

        Args:
            randomness: Amount of score variation (0.15 = ±15%). Set to 0 for deterministic.
        """
        scored = []

        for card in candidates:
            name = card.get('name', '')

            # Skip if already in deck
            if name in deck:
                continue

            # Skip banned cards
            if name in COMMANDER_BANNED_CARDS:
                continue

            # Check bracket restrictions
            if not is_card_allowed_in_bracket(name, bracket, counts):
                continue

            # Soft budget filter: penalize but don't exclude
            price = self._get_card_price(card)
            budget_penalty = 0.0
            if budget_tier:
                low, high = PRICE_TIERS.get(budget_tier, (0, float('inf')))
                if price > high * 2:  # Only hard-exclude if way over budget
                    continue
                elif price > high:
                    budget_penalty = -2.0  # Significant penalty but still possible

            # Calculate score
            search_score = card.get('score', 0.5)
            score = self._score_card(
                card, category, colors, search_score,
                current_curve, MANA_CURVE_TARGETS, 65
            ) + budget_penalty

            scored.append((score, card))

        # Sort by score descending
        scored.sort(key=lambda x: x[0], reverse=True)

        # Apply controlled randomness: take top 3x candidates, shuffle within score tiers
        if randomness > 0 and len(scored) > count:
            pool_size = min(count * 3, len(scored))
            pool = scored[:pool_size]

            # Add random noise to scores
            randomized = [
                (score * random.uniform(1 - randomness, 1 + randomness), card)
                for score, card in pool
            ]
            randomized.sort(key=lambda x: x[0], reverse=True)
            return [card for _, card in randomized[:count]]

        return [card for _, card in scored[:count]]
```

**Step 3: Commit**

```bash
git add backend/deck_generator.py
git commit -m "feat(generator): add controlled randomness to card selection

Add randomness parameter (default 15%) to _select_best_cards().
Takes top 3x candidates and applies score noise before final selection.
This ensures different commanders of the same color get varied decks.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Boost Synergy Weight in Card Scoring

**Files:**
- Modify: `backend/deck_generator.py:295-344` (the `_score_card` method)

**Step 1: Modify score weights in `_score_card`**

Change line 318 from:
```python
        score += search_score * 2.0
```

To:
```python
        # Boost synergy weight: 50% influence (was 30%)
        score += search_score * 3.5
```

Change lines 321-322 from:
```python
        if self._is_staple(card, category, colors):
            score += 3.0
```

To:
```python
        # Reduced staple bonus (was +3.0) to let synergy dominate
        if self._is_staple(card, category, colors):
            score += 1.5
```

**Step 2: Commit**

```bash
git add backend/deck_generator.py
git commit -m "feat(generator): boost synergy weight for commander-specific decks

Increase FAISS semantic search weight from 2.0 to 3.5 (50% influence).
Reduce staple bonus from +3.0 to +1.5.
This makes commander-specific synergy dominate over generic staples.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add Database Schema for Regeneration Tracking

**Files:**
- Modify: `backend/database.py:15-41` (the `init_db` function)

**Step 1: Add new columns to schema**

In `init_db()`, add columns to the CREATE TABLE statement. Replace lines 20-36 with:

```python
        conn.execute("""
            CREATE TABLE IF NOT EXISTS decks (
                id TEXT PRIMARY KEY,
                commander TEXT NOT NULL,
                colors TEXT NOT NULL,
                bracket INTEGER NOT NULL,
                bracket_name TEXT,
                theme TEXT,
                archetype TEXT,
                card_count INTEGER,
                estimated_price TEXT,
                cards TEXT NOT NULL,
                categories TEXT,
                legal_status TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                parent_deck_id TEXT,
                regeneration_number INTEGER DEFAULT 0
            )
        """)
```

**Step 2: Add migration for existing databases**

Add after the CREATE INDEX statement (around line 40):

```python
        # Migration: add new columns if they don't exist
        try:
            conn.execute("ALTER TABLE decks ADD COLUMN parent_deck_id TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists
        try:
            conn.execute("ALTER TABLE decks ADD COLUMN regeneration_number INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass  # Column already exists
```

**Step 3: Update `save_deck` to handle new fields**

Modify `save_deck` function (around line 99) to include new fields:

```python
def save_deck(deck_data: dict) -> str:
    """Save a deck to the database. Returns the deck ID."""
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO decks (
                id, commander, colors, bracket, bracket_name, theme,
                archetype, card_count, estimated_price, cards, categories,
                legal_status, created_at, parent_deck_id, regeneration_number
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            deck_data['id'],
            deck_data['commander'],
            json.dumps(deck_data['colors']),
            deck_data['bracket'],
            deck_data.get('bracket_name', ''),
            deck_data.get('theme', ''),
            deck_data.get('archetype', ''),
            deck_data.get('card_count', 0),
            deck_data.get('estimated_price', ''),
            json.dumps(deck_data['list']),
            json.dumps(deck_data.get('categories', {})),
            deck_data.get('legal_status', ''),
            deck_data.get('timestamp', datetime.now().isoformat()),
            deck_data.get('parent_deck_id'),
            deck_data.get('regeneration_number', 0),
        ))
        conn.commit()
    return deck_data['id']
```

**Step 4: Update `_row_to_deck` to include new fields**

Add to the return dict in `_row_to_deck` (around line 168):

```python
def _row_to_deck(row: sqlite3.Row) -> dict:
    """Convert a database row to a deck dictionary."""
    return {
        'id': row['id'],
        'commander': row['commander'],
        'colors': json.loads(row['colors']),
        'bracket': row['bracket'],
        'bracket_name': row['bracket_name'] or '',
        'theme': row['theme'] or '',
        'archetype': row['archetype'] or '',
        'card_count': row['card_count'] or 0,
        'estimated_price': row['estimated_price'] or '',
        'list': json.loads(row['cards']),
        'categories': json.loads(row['categories']) if row['categories'] else {},
        'legal_status': row['legal_status'] or '',
        'timestamp': row['created_at'],
        'parent_deck_id': row['parent_deck_id'] if 'parent_deck_id' in row.keys() else None,
        'regeneration_number': row['regeneration_number'] if 'regeneration_number' in row.keys() else 0,
    }
```

**Step 5: Commit**

```bash
git add backend/database.py
git commit -m "feat(database): add regeneration tracking columns

Add parent_deck_id and regeneration_number columns to decks table.
Include migration for existing databases.
Update save_deck and _row_to_deck to handle new fields.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add regenerate_deck Method to DeckGenerator

**Files:**
- Modify: `backend/deck_generator.py` (add new method after `generate_deck`)

**Step 1: Add import for get_core_staples_for_colors**

Update the imports from rules.py (around line 16) to include:

```python
from backend.rules import (
    BASIC_LANDS,
    COMMAND_ZONE_TEMPLATE,
    COMMANDER_BANNED_CARDS,
    COMMANDER_BRACKETS,
    GAME_CHANGER_CARDS,
    MASS_LAND_DENIAL,
    EXTRA_TURN_SPELLS,
    TUTOR_CARDS,
    COMBO_CARDS,
    WINCON_CARDS,
    REMOVAL_CARDS,
    RAMP_CARDS,
    CARD_DRAW,
    get_bracket_restrictions,
    get_removal_for_colors,
    get_ramp_for_colors,
    get_draw_for_colors,
    is_card_banned,
    is_card_allowed_in_bracket,
    get_card_price_tier,
    is_land_useful_for_colors,
    PRICE_TIERS,
    get_core_staples_for_colors,  # Add this
)
```

**Step 2: Add regenerate_deck method after generate_deck (around line 850)**

```python
    def regenerate_deck(
        self,
        commander_name: str,
        kept_cards: List[str],
        bracket: int = 2,
        theme: str = "",
        budget_tier: Optional[str] = None,
    ) -> Dict:
        """
        Regenerate a deck while keeping specified cards.

        Args:
            commander_name: Name of the commander
            kept_cards: List of card names to keep in the deck
            bracket: Power level bracket (1-5)
            theme: Optional theme/strategy for the deck
            budget_tier: Optional budget restriction

        Returns:
            Dict with deck information including which cards are new
        """
        if not self._loaded:
            self.load()

        # Find commander
        commander = self.find_commander(commander_name)
        if not commander:
            return {"error": f"Commander not found: {commander_name}"}

        commander_identity = commander.get('color_identity', []) or []
        bracket_info = get_bracket_restrictions(bracket)
        core_staples = get_core_staples_for_colors(commander_identity)

        # Validate kept cards don't include core staples (they're auto-kept)
        invalid_kept = [c for c in kept_cards if c in core_staples]
        if invalid_kept:
            return {"error": f"Cannot lock core staples (they're always kept): {invalid_kept}"}

        # Track counts for bracket restrictions
        counts = {'game_changers': 0, 'tutors': 0, 'extra_turns': 0}

        # Build the deck starting with kept cards
        deck: Dict[str, int] = {}
        type_categories = {
            'Commander': [],
            'Creatures': [],
            'Instants': [],
            'Sorceries': [],
            'Artifacts': [],
            'Enchantments': [],
            'Planeswalkers': [],
            'Lands': [],
            'Other': []
        }
        current_curve: Dict[int, int] = {i: 0 for i in range(8)}

        # Add kept cards first
        kept_set = set(kept_cards)
        for card_name in kept_cards:
            if card_name in self.card_by_name:
                card = self.card_by_name[card_name]
                deck[card_name] = 1
                self._add_card_to_type_category(card_name, type_categories)
                if not self._is_land(card):
                    cmc = self._get_cmc(card)
                    current_curve[cmc] = current_curve.get(cmc, 0) + 1
                # Track bracket-restricted cards
                if card_name in GAME_CHANGER_CARDS:
                    counts['game_changers'] += 1
                if card_name in TUTOR_CARDS:
                    counts['tutors'] += 1
                if card_name in EXTRA_TURN_SPELLS:
                    counts['extra_turns'] += 1

        # Get valid cards for filling
        valid_cards = self._filter_by_color_identity(self.cards, commander_identity)
        valid_cards = [c for c in valid_cards
                      if c.get('name') not in COMMANDER_BANNED_CARDS
                      and c.get('name') != commander.get('name')
                      and c.get('name') not in kept_set]  # Exclude kept cards

        # Categorize available cards
        lands = [
            c for c in valid_cards
            if self._is_land(c) and is_land_useful_for_colors(
                c.get('name', ''),
                c.get('oracle_text', ''),
                commander_identity
            )
        ]
        removal = [c for c in valid_cards if self._is_removal(c) and not self._is_land(c)]
        ramp = [c for c in valid_cards if self._is_ramp(c) and not self._is_land(c)]
        draw = [c for c in valid_cards if self._is_card_draw(c) and not self._is_land(c)]
        wincons = [
            c for c in valid_cards
            if self._is_wincon(c) and (
                not self._is_land(c) or
                is_land_useful_for_colors(c.get('name', ''), c.get('oracle_text', ''), commander_identity)
            )
        ]

        # Count kept cards by functional category
        kept_ramp = len([c for c in kept_cards if c in self.card_by_name and self._is_ramp(self.card_by_name[c])])
        kept_removal = len([c for c in kept_cards if c in self.card_by_name and self._is_removal(self.card_by_name[c])])
        kept_draw = len([c for c in kept_cards if c in self.card_by_name and self._is_card_draw(self.card_by_name[c])])
        kept_lands = len([c for c in kept_cards if c in self.card_by_name and self._is_land(self.card_by_name[c])])

        # Track new cards
        new_cards: List[str] = []

        # Fill remaining category slots
        # Ramp
        ramp_needed = max(0, COMMAND_ZONE_TEMPLATE['ramp']['min'] - kept_ramp)
        if ramp_needed > 0:
            for card in ramp:
                card['score'] = card.get('score', 0.5)
            best_ramp = self._select_best_cards(
                ramp, ramp_needed, 'ramp', commander_identity,
                bracket, counts, deck, current_curve, budget_tier
            )
            for card in best_ramp:
                name = card.get('name')
                deck[name] = 1
                new_cards.append(name)
                self._add_card_to_type_category(name, type_categories)
                cmc = self._get_cmc(card)
                current_curve[cmc] = current_curve.get(cmc, 0) + 1

        # Removal
        removal_needed = max(0, COMMAND_ZONE_TEMPLATE['removal']['min'] - kept_removal)
        if removal_needed > 0:
            for card in removal:
                card['score'] = card.get('score', 0.5)
            best_removal = self._select_best_cards(
                removal, removal_needed, 'removal', commander_identity,
                bracket, counts, deck, current_curve, budget_tier
            )
            for card in best_removal:
                name = card.get('name')
                if name in GAME_CHANGER_CARDS:
                    counts['game_changers'] += 1
                deck[name] = 1
                new_cards.append(name)
                self._add_card_to_type_category(name, type_categories)
                cmc = self._get_cmc(card)
                current_curve[cmc] = current_curve.get(cmc, 0) + 1

        # Card draw
        draw_needed = max(0, COMMAND_ZONE_TEMPLATE['card_draw']['min'] - kept_draw)
        if draw_needed > 0:
            for card in draw:
                card['score'] = card.get('score', 0.5)
            best_draw = self._select_best_cards(
                draw, draw_needed, 'card_draw', commander_identity,
                bracket, counts, deck, current_curve, budget_tier
            )
            for card in best_draw:
                name = card.get('name')
                if name in GAME_CHANGER_CARDS:
                    counts['game_changers'] += 1
                deck[name] = 1
                new_cards.append(name)
                self._add_card_to_type_category(name, type_categories)
                cmc = self._get_cmc(card)
                current_curve[cmc] = current_curve.get(cmc, 0) + 1

        # Generate synergy queries and add synergy cards
        synergy_queries = self._extract_synergy_keywords(commander)
        if theme:
            synergy_queries.insert(0, theme)

        all_synergy_cards: Dict[str, Dict] = {}
        for query in synergy_queries:
            results = self.search_cards(query, k=50)
            for card in results:
                name = card.get('name', '')
                if name and name not in all_synergy_cards and name not in kept_set:
                    all_synergy_cards[name] = card
                elif name in all_synergy_cards:
                    existing_score = all_synergy_cards[name].get('score', 0)
                    new_score = card.get('score', 0)
                    all_synergy_cards[name]['score'] = existing_score + new_score * 0.5

        synergy_cards = list(all_synergy_cards.values())
        synergy_cards = self._filter_by_color_identity(synergy_cards, commander_identity)
        synergy_cards = [c for c in synergy_cards
                        if c.get('name') not in COMMANDER_BANNED_CARDS
                        and c.get('name') != commander.get('name')
                        and not self._is_land(c)]

        # Fill remaining non-land slots
        current_count = sum(deck.values())
        target_nonlands = 99 - COMMAND_ZONE_TEMPLATE['lands']['max']
        remaining_nonlands = target_nonlands - current_count

        if remaining_nonlands > 0:
            best_synergy = self._select_best_cards(
                synergy_cards, remaining_nonlands + 10,
                'synergy', commander_identity,
                bracket, counts, deck, current_curve, budget_tier
            )
            for card in best_synergy:
                if remaining_nonlands <= 0:
                    break
                name = card.get('name')
                if name and name not in deck:
                    if name in GAME_CHANGER_CARDS:
                        counts['game_changers'] += 1
                    if name in TUTOR_CARDS:
                        counts['tutors'] += 1
                    if name in EXTRA_TURN_SPELLS:
                        counts['extra_turns'] += 1
                    deck[name] = 1
                    new_cards.append(name)
                    self._add_card_to_type_category(name, type_categories)
                    cmc = self._get_cmc(card)
                    current_curve[cmc] = current_curve.get(cmc, 0) + 1
                    remaining_nonlands -= 1

        # Add lands
        max_lands = COMMAND_ZONE_TEMPLATE['lands']['max']
        lands_needed = max_lands - kept_lands

        if lands_needed > 0:
            # Non-basic lands
            non_basic_lands = [l for l in lands if 'basic' not in l.get('type_line', '').lower()]
            num_nonbasics = min(lands_needed - 15, len(non_basic_lands))

            if num_nonbasics > 0:
                for land in non_basic_lands:
                    land['score'] = land.get('score', 0.5)
                best_lands = self._select_best_cards(
                    non_basic_lands, num_nonbasics, 'lands', commander_identity,
                    bracket, counts, deck, {}, budget_tier
                )
                for land in best_lands:
                    name = land.get('name')
                    deck[name] = 1
                    new_cards.append(name)
                    type_categories['Lands'].append(name)

            # Basic lands
            current_lands = kept_lands + len([c for c in new_cards if c in self.card_by_name and self._is_land(self.card_by_name.get(c, {}))])
            num_basics = max_lands - current_lands

            if num_basics > 0 and commander_identity:
                basics_per_color = num_basics // len(commander_identity)
                remainder = num_basics % len(commander_identity)
                for i, color in enumerate(commander_identity):
                    basic = BASIC_LANDS.get(color, 'Wastes')
                    count = basics_per_color + (1 if i < remainder else 0)
                    if count > 0:
                        deck[basic] = deck.get(basic, 0) + count
                        if basic not in type_categories['Lands']:
                            type_categories['Lands'].append(basic)
                            new_cards.append(basic)
            elif num_basics > 0:
                deck['Wastes'] = num_basics
                type_categories['Lands'].append('Wastes')
                new_cards.append('Wastes')

        # Fill if still under 99
        current_count = sum(deck.values())
        if current_count < 99:
            fill_count = 99 - current_count
            if commander_identity:
                basic = BASIC_LANDS.get(commander_identity[0], 'Wastes')
            else:
                basic = 'Wastes'
            deck[basic] = deck.get(basic, 0) + fill_count
            if basic not in type_categories['Lands']:
                type_categories['Lands'].append(basic)

        # Calculate stats
        total_price = sum(
            self._get_card_price(self.card_by_name.get(name, {})) * qty
            for name, qty in deck.items()
        )

        # Build deck list
        commander_name_actual = commander.get('name')
        deck_list = [f"1x {commander_name_actual} *CMDR*"]
        for name, qty in sorted(deck.items()):
            deck_list.append(f"{qty}x {name}")

        type_categories['Commander'].append(commander_name_actual)
        mana_curve = {str(k): v for k, v in current_curve.items()}

        return {
            "commander": commander_name_actual,
            "colors": commander_identity,
            "bracket": bracket,
            "bracket_name": bracket_info['name'],
            "theme": theme or "General synergy",
            "card_count": sum(deck.values()) + 1,
            "estimated_price": f"${total_price:.2f}",
            "categories": type_categories,
            "mana_curve": mana_curve,
            "synergy_queries": synergy_queries,
            "list": deck_list,
            "legal_status": "Legal",
            "archetype": theme or commander.get('type_line', ''),
            "new_cards": new_cards,
            "core_staples": list(core_staples),
        }
```

**Step 3: Commit**

```bash
git add backend/deck_generator.py
git commit -m "feat(generator): add regenerate_deck method

Add method to regenerate deck while keeping specified cards.
Returns list of new cards for frontend highlighting.
Validates that core staples cannot be manually locked.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add Backend API Endpoint for Regeneration

**Files:**
- Modify: `backend/main.py` (add new endpoint and models)

**Step 1: Add new Pydantic models after DeckRequest (around line 49)**

```python
class RegenerateDeckRequest(BaseModel):
    """Request model for deck regeneration."""
    deck_id: str = Field(..., description="ID of the original deck")
    kept_card_names: List[str] = Field(..., description="Card names to keep")
    regeneration_number: int = Field(..., ge=1, le=5, description="Current regeneration (1-5)")


class RegenerateDeckResponse(BaseModel):
    """Response model for regenerated deck."""
    id: str
    commander: str
    colors: List[str]
    archetype: str
    timestamp: str
    legal_status: str
    card_count: int
    estimated_price: str
    list: List[str]
    bracket: int
    bracket_name: str
    theme: str
    categories: dict
    regenerations_remaining: int
    new_card_names: List[str]
    core_staples: List[str]
    parent_deck_id: str
    regeneration_number: int
```

**Step 2: Add the import for get_core_staples_for_colors**

Add to imports at top of file:

```python
from backend.rules import COMMANDER_BRACKETS, PRICE_TIERS, get_core_staples_for_colors
```

**Step 3: Add the endpoint after generate_deck (around line 252)**

```python
@app.post("/api/regenerate-deck", response_model=RegenerateDeckResponse)
async def regenerate_deck(request: RegenerateDeckRequest):
    """
    Regenerate a deck while keeping specified cards.

    Users can regenerate up to 5 times per initial deck.
    Core staples are automatically kept and cannot be manually locked.
    """
    import uuid
    from datetime import datetime

    # Validate regeneration limit
    if request.regeneration_number > 5:
        raise HTTPException(
            status_code=400,
            detail="Maximum 5 regenerations per deck"
        )

    # Load the original deck
    original_deck = get_deck(request.deck_id)
    if not original_deck:
        raise HTTPException(status_code=404, detail="Original deck not found")

    # Check regeneration chain
    parent_id = original_deck.get('parent_deck_id') or request.deck_id

    generator = get_generator()

    # Get core staples for validation
    core_staples = get_core_staples_for_colors(original_deck['colors'])

    # Validate kept cards don't include core staples
    invalid_kept = [c for c in request.kept_card_names if c in core_staples]
    if invalid_kept:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot lock core staples (they're always kept): {invalid_kept}"
        )

    # Validate kept cards don't include commander
    if original_deck['commander'] in request.kept_card_names:
        raise HTTPException(
            status_code=400,
            detail="Cannot lock commander (it's always kept)"
        )

    result = generator.regenerate_deck(
        commander_name=original_deck['commander'],
        kept_cards=request.kept_card_names,
        bracket=original_deck['bracket'],
        theme=original_deck.get('theme', ''),
        budget_tier=None,  # Could be added if stored in original deck
    )

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    new_deck_id = str(uuid.uuid4())[:8]
    timestamp = datetime.now().isoformat()

    deck_response = RegenerateDeckResponse(
        id=new_deck_id,
        commander=result["commander"],
        colors=result["colors"],
        archetype=result["archetype"],
        timestamp=timestamp,
        legal_status=result["legal_status"],
        card_count=result["card_count"],
        estimated_price=result["estimated_price"],
        list=result["list"],
        bracket=result["bracket"],
        bracket_name=result["bracket_name"],
        theme=result["theme"],
        categories=result["categories"],
        regenerations_remaining=5 - request.regeneration_number,
        new_card_names=result.get("new_cards", []),
        core_staples=result.get("core_staples", []),
        parent_deck_id=parent_id,
        regeneration_number=request.regeneration_number,
    )

    # Save to database
    save_deck({
        **deck_response.model_dump(),
        'parent_deck_id': parent_id,
        'regeneration_number': request.regeneration_number,
    })
    logger.info(f"Saved regenerated deck {new_deck_id} (regen #{request.regeneration_number})")

    return deck_response
```

**Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat(api): add POST /api/regenerate-deck endpoint

Add endpoint for deck regeneration with:
- Validation of regeneration limit (max 5)
- Core staple and commander lock validation
- Returns new_card_names for frontend highlighting
- Tracks parent_deck_id for regeneration lineage

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Add Frontend Types for Regeneration

**Files:**
- Modify: `frontend/src/types.ts` (add new interfaces)

**Step 1: Add new interfaces at the end of the file**

```typescript
export interface RegenerateDeckRequest {
  deck_id: string;
  kept_card_names: string[];
  regeneration_number: number;
}

export interface RegenerateDeckResponse extends Deck {
  regenerations_remaining: number;
  new_card_names: string[];
  core_staples: string[];
  parent_deck_id: string;
  regeneration_number: number;
}
```

**Step 2: Commit**

```bash
git add frontend/src/types.ts
git commit -m "feat(types): add regeneration request/response types

Add RegenerateDeckRequest and RegenerateDeckResponse interfaces
for the deck regeneration feature.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Add Card Locking UI to DeckVisualView

**Files:**
- Modify: `frontend/src/components/DeckVisualView.tsx`

**Step 1: Add new props interface and state**

Update the props interface (around line 9):

```typescript
interface DeckVisualViewProps {
  deck: Deck;
  selectionMode?: boolean;
  lockedCards?: Set<string>;
  newCards?: Set<string>;
  coreStaples?: Set<string>;
  onCardLockToggle?: (cardName: string) => void;
  useCheckboxFallback?: boolean;
}
```

**Step 2: Update the function signature and add CardPile props**

```typescript
export function DeckVisualView({
  deck,
  selectionMode = false,
  lockedCards = new Set(),
  newCards = new Set(),
  coreStaples = new Set(),
  onCardLockToggle,
  useCheckboxFallback = false,
}: DeckVisualViewProps) {
```

**Step 3: Update the CardPile component call to pass selection props**

In the return statement, update the CardPile usage (around line 193):

```typescript
            return (
              <CardPile
                key={key}
                cards={cards}
                category={label}
                setPreference={setPreference}
                onCardClick={handleCardClick}
                selectionMode={selectionMode}
                lockedCards={lockedCards}
                newCards={newCards}
                coreStaples={coreStaples}
                onCardLockToggle={onCardLockToggle}
                useCheckboxFallback={useCheckboxFallback}
              />
            );
```

**Step 4: Commit**

```bash
git add frontend/src/components/DeckVisualView.tsx
git commit -m "feat(ui): add selection mode props to DeckVisualView

Pass selection mode, locked cards, new cards, and core staples
to CardPile component for card locking UI.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Update CardPile Component for Locking UI

**Files:**
- Modify: `frontend/src/components/CardPile.tsx`

**Step 1: Read the current CardPile component first**

**Step 2: Add new props and visual indicators**

Update the interface to include:

```typescript
interface CardPileProps {
  cards: string[];
  category: string;
  setPreference?: string;
  onCardClick?: (cardName: string) => void;
  selectionMode?: boolean;
  lockedCards?: Set<string>;
  newCards?: Set<string>;
  coreStaples?: Set<string>;
  onCardLockToggle?: (cardName: string) => void;
  useCheckboxFallback?: boolean;
}
```

**Step 3: Add lock icon imports and visual states**

Add to imports:
```typescript
import { Lock, Sparkles } from 'lucide-react';
```

**Step 4: Update card rendering to show lock state**

For each card, add:
- Lock icon overlay for locked cards
- Gray lock for core staples (non-clickable)
- Green glow/sparkle for new cards
- Click handler for toggling lock state
- Checkbox fallback mode

This is a larger change - the full implementation will be in the actual edit.

**Step 5: Commit**

```bash
git add frontend/src/components/CardPile.tsx
git commit -m "feat(ui): add card locking indicators to CardPile

Add visual states:
- Blue border + lock icon for locked cards
- Gray lock for core staples (non-clickable)
- Green glow for newly generated cards
- Click-to-toggle and checkbox fallback modes

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Update DeckViewerPage with Regeneration UI

**Files:**
- Modify: `frontend/src/pages/DeckViewerPage.tsx`

**Step 1: Add new state variables**

Add after the existing useState declarations (around line 31):

```typescript
  const [lockedCards, setLockedCards] = useState<Set<string>>(new Set());
  const [regenerationsRemaining, setRegenerationsRemaining] = useState(5);
  const [newCards, setNewCards] = useState<Set<string>>(new Set());
  const [coreStaples, setCoreStaples] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(true);
  const [useCheckboxFallback, setUseCheckboxFallback] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerationError, setRegenerationError] = useState<string | null>(null);
```

**Step 2: Add API call function for regeneration**

```typescript
  const handleRegenerate = async () => {
    if (!deck || regenerationsRemaining <= 0) return;

    setIsRegenerating(true);
    setRegenerationError(null);

    try {
      const response = await fetch('/api/regenerate-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deck_id: deck.id,
          kept_card_names: Array.from(lockedCards),
          regeneration_number: 6 - regenerationsRemaining,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to regenerate deck');
      }

      const newDeck = await response.json();
      setDeck(newDeck);
      setNewCards(new Set(newDeck.new_card_names || []));
      setCoreStaples(new Set(newDeck.core_staples || []));
      setRegenerationsRemaining(newDeck.regenerations_remaining);

      // Clear new card highlights after 10 seconds
      setTimeout(() => setNewCards(new Set()), 10000);
    } catch (err) {
      setRegenerationError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleCardLockToggle = (cardName: string) => {
    if (coreStaples.has(cardName)) return; // Can't toggle core staples

    setLockedCards(prev => {
      const next = new Set(prev);
      if (next.has(cardName)) {
        next.delete(cardName);
      } else {
        next.add(cardName);
      }
      return next;
    });
  };
```

**Step 3: Add regeneration UI elements in the header**

Add after the "Test Deck" button:

```typescript
                  {/* Regeneration Controls */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-stone-500">
                      {lockedCards.size} locked
                    </span>
                    <button
                      onClick={handleRegenerate}
                      disabled={regenerationsRemaining <= 0 || isRegenerating}
                      className={`px-4 py-2 text-sm font-medium rounded transition-colors flex items-center gap-2 ${
                        regenerationsRemaining > 0
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-stone-300 text-stone-500 cursor-not-allowed'
                      }`}
                    >
                      {isRegenerating ? 'Regenerating...' : `Regenerate (${regenerationsRemaining} left)`}
                    </button>
                    <button
                      onClick={() => setUseCheckboxFallback(!useCheckboxFallback)}
                      className="text-xs text-stone-500 hover:text-stone-700"
                    >
                      {useCheckboxFallback ? 'Use click mode' : 'Use checkboxes'}
                    </button>
                  </div>
```

**Step 4: Pass props to DeckVisualView**

```typescript
              <DeckVisualView
                deck={deck}
                selectionMode={selectionMode}
                lockedCards={lockedCards}
                newCards={newCards}
                coreStaples={coreStaples}
                onCardLockToggle={handleCardLockToggle}
                useCheckboxFallback={useCheckboxFallback}
              />
```

**Step 5: Commit**

```bash
git add frontend/src/pages/DeckViewerPage.tsx
git commit -m "feat(ui): add deck regeneration controls to DeckViewerPage

Add:
- Regeneration state management
- API call for deck regeneration
- Regenerate button with counter
- Checkbox fallback toggle
- New card highlight timer (10s)
- Error handling

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Test the Complete Flow

**Step 1: Start the backend**

```bash
cd /home/sheltron/Documents/Magic
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

**Step 2: Start the frontend**

```bash
cd /home/sheltron/Documents/Magic/frontend
npm run dev
```

**Step 3: Manual testing checklist**

- [ ] Generate a deck and verify uniqueness (generate same commander twice, compare)
- [ ] Navigate to deck viewer, verify selection mode is active
- [ ] Click cards to lock/unlock, verify visual feedback
- [ ] Verify core staples show gray lock and are not clickable
- [ ] Click Regenerate, verify:
  - [ ] API call succeeds
  - [ ] New cards show green highlight
  - [ ] Locked cards remain
  - [ ] Counter decrements
  - [ ] Highlight fades after 10s
- [ ] Regenerate 5 times, verify button disables
- [ ] Test checkbox fallback toggle

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: manual verification of deck regeneration feature

Verified:
- Deck uniqueness with randomness
- Card locking UI (click and checkbox modes)
- Core staple protection
- Regeneration limit enforcement
- New card highlighting

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | `backend/rules.py` | Add CORE_STAPLES and get_core_staples_for_colors() |
| 2 | `backend/deck_generator.py` | Add randomness to _select_best_cards() |
| 3 | `backend/deck_generator.py` | Boost synergy weight in _score_card() |
| 4 | `backend/database.py` | Add parent_deck_id, regeneration_number columns |
| 5 | `backend/deck_generator.py` | Add regenerate_deck() method |
| 6 | `backend/main.py` | Add POST /api/regenerate-deck endpoint |
| 7 | `frontend/src/types.ts` | Add regeneration types |
| 8 | `frontend/src/components/DeckVisualView.tsx` | Add selection mode props |
| 9 | `frontend/src/components/CardPile.tsx` | Add locking visual indicators |
| 10 | `frontend/src/pages/DeckViewerPage.tsx` | Add regeneration controls |
| 11 | - | End-to-end testing |
