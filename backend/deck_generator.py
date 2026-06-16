"""Commander deck generator using FAISS semantic search and deck building rules."""

import json
import random
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

# Add parent directory for data module
sys.path.insert(0, str(Path(__file__).parent.parent))

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
    get_core_staples_for_colors,
    PRICE_TIERS,
)

CONSTRUCTED_BASIC_LANDS = {
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
    "Wastes",
    "Snow-Covered Plains",
    "Snow-Covered Island",
    "Snow-Covered Swamp",
    "Snow-Covered Mountain",
    "Snow-Covered Forest",
}

STANDARD_ARCHETYPE_QUERIES = {
    "aggro": "cheap aggressive creatures haste burn combat damage",
    "midrange": "efficient creatures removal card advantage value",
    "control": "counter target spell destroy exile sweeper draw cards",
    "tempo": "cheap threats counterspell bounce flash draw",
    "ramp": "search your library land add mana big creature",
    "tokens": "create tokens anthem go wide creature tokens",
    "graveyard": "graveyard return reanimate sacrifice dies",
    "artifacts": "artifact synergy create artifact tokens sacrifice artifact",
    "spells": "instant sorcery cast noncreature spell draw damage",
}

STANDARD_ARCHETYPE_PROFILES = {
    "aggro": {"lands": 22, "creatures": 24, "interaction": 10, "value": 2},
    "tempo": {"lands": 23, "creatures": 18, "interaction": 14, "value": 5},
    "control": {"lands": 26, "creatures": 8, "interaction": 18, "value": 8},
    "ramp": {"lands": 26, "creatures": 16, "interaction": 8, "value": 10},
    "tokens": {"lands": 24, "creatures": 20, "interaction": 8, "value": 8},
    "graveyard": {"lands": 24, "creatures": 20, "interaction": 8, "value": 8},
    "artifacts": {"lands": 24, "creatures": 16, "interaction": 8, "value": 12},
    "spells": {"lands": 23, "creatures": 10, "interaction": 16, "value": 11},
    "midrange": {"lands": 24, "creatures": 20, "interaction": 10, "value": 6},
}

# CMC distribution targets for a balanced mana curve
MANA_CURVE_TARGETS = {
    0: 0.02,   # 0 CMC: ~2% of nonland cards
    1: 0.08,   # 1 CMC: ~8%
    2: 0.20,   # 2 CMC: ~20%
    3: 0.22,   # 3 CMC: ~22%
    4: 0.18,   # 4 CMC: ~18%
    5: 0.12,   # 5 CMC: ~12%
    6: 0.10,   # 6 CMC: ~10%
    7: 0.08,   # 7+ CMC: ~8%
}

# Data paths
DATA_DIR = Path(__file__).parent.parent / "mtg_data"
CARDS_JSONL_PATH = DATA_DIR / "cards_min.jsonl"
EMBEDDINGS_PATH = DATA_DIR / "card_embeddings.npy"
EMBEDDINGS_META_PATH = DATA_DIR / "card_embeddings_meta.json"
FAISS_INDEX_PATH = DATA_DIR / "card_index.faiss"


class DeckGenerator:
    """Commander deck generator using semantic search and deck building rules."""

    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2"):
        self.model_name = model_name
        self.model: Optional[SentenceTransformer] = None
        self.index: Optional[faiss.Index] = None
        self.cards: List[Dict] = []
        self.card_by_name: Dict[str, Dict] = {}
        self.card_ids: List[str] = []
        self._model_fit_cache: Dict[str, float] = {}
        self._model_scoring_unavailable = False
        self._loaded = False

    def load(self) -> None:
        """Load all required data: cards, embeddings, FAISS index."""
        if self._loaded:
            return

        # Load cards
        if CARDS_JSONL_PATH.exists():
            with open(CARDS_JSONL_PATH, 'r', encoding='utf-8') as f:
                self.cards = [json.loads(line) for line in f]
            self.card_by_name = self._build_card_by_name(self.cards)
        else:
            raise FileNotFoundError(f"Cards file not found: {CARDS_JSONL_PATH}")

        # Load embeddings metadata
        if EMBEDDINGS_META_PATH.exists():
            with open(EMBEDDINGS_META_PATH, 'r', encoding='utf-8') as f:
                meta = json.load(f)
                self.card_ids = meta.get('ids', [])

        # Load FAISS index
        if FAISS_INDEX_PATH.exists():
            self.index = faiss.read_index(str(FAISS_INDEX_PATH))

        # Load sentence transformer model
        self.model = SentenceTransformer(self.model_name)
        self._loaded = True

    def search_cards(self, query: str, k: int = 50) -> List[Dict]:
        """Search for cards semantically matching the query.

        Token cards (type_line contains 'Token') are automatically excluded
        from results since they are not real cards that belong in decks.
        """
        if not self._loaded:
            self.load()

        if self.index is None or self.model is None:
            return []

        # Request extra results to compensate for filtered-out tokens
        query_vec = self.model.encode([query], normalize_embeddings=True).astype('float32')
        scores, indices = self.index.search(query_vec, k + 20)

        results = []
        for idx, score in zip(indices[0], scores[0]):
            if idx == -1 or idx >= len(self.cards):
                continue
            card = self.cards[idx]
            # Skip token cards — they are not real cards for decks
            if self._is_token_card(card):
                continue
            card_copy = card.copy()
            card_copy['score'] = float(score)
            results.append(card_copy)
            if len(results) >= k:
                break

        return results

    def get_commanders(self) -> List[Dict]:
        """Get all legendary creatures that can be commanders."""
        if not self._loaded:
            self.load()

        commanders = []
        for card in self.cards:
            type_line = (card.get('type_line') or '').lower()
            if 'legendary' in type_line and 'creature' in type_line:
                # Check commander legality
                legalities = card.get('legalities') or {}
                if legalities.get('commander') == 'legal':
                    commanders.append(card)
        return commanders

    @staticmethod
    def _is_commander_card(card: Dict) -> bool:
        type_line = (card.get('type_line') or '').lower()
        oracle_text = (card.get('oracle_text') or '').lower()
        return 'legendary' in type_line and ('creature' in type_line or 'can be your commander' in oracle_text)

    def _find_exact_commander(self, name: str) -> Optional[Dict]:
        wanted = name.strip().lower()
        if not wanted:
            return None
        for card in self.cards:
            if (card.get('name') or '').lower() == wanted and self._is_commander_card(card):
                return card
        return None

    def find_commander(self, name: str) -> Optional[Dict]:
        """Find a commander by name (case-insensitive partial match).

        For partner commanders joined with ' // ', looks up each partner
        individually and returns the first match.
        """
        if not self._loaded:
            self.load()

        names = [n.strip() for n in name.split(" // ")] if " // " in name else [name]

        # Prefer exact card names before partial matching. This keeps modal and
        # transforming commanders such as "Dennick // Dennick" as one card
        # instead of treating each face as a separate partner commander.
        exact = self._find_exact_commander(name)
        if exact:
            return exact
        for part in names:
            exact = self._find_exact_commander(part)
            if exact:
                return exact

        for part in names:
            part_lower = part.lower()
            for card in self.cards:
                if part_lower in (card.get('name') or '').lower():
                    if self._is_commander_card(card):
                        return card
        return None

    def find_partner_commanders(self, name: str) -> list[Dict]:
        """Find all partner commanders from a ' // '-joined name string.

        Returns a list of card dicts (1 for solo commander, 2 for partners).
        """
        if not self._loaded:
            self.load()

        exact = self._find_exact_commander(name)
        if exact:
            return [exact]

        names = [n.strip() for n in name.split(" // ")] if " // " in name else [name]
        results = []
        seen: set[str] = set()
        for part in names:
            card = self.find_commander(part)
            if card:
                key = card.get('id') or card.get('name') or part
                if key in seen:
                    continue
                seen.add(key)
                results.append(card)
        return results

    def _get_card_price(self, card: Dict) -> float:
        """Get USD price for a card, defaulting to 0."""
        prices = card.get('prices', {}) or {}
        usd = prices.get('usd')
        if usd:
            try:
                return float(usd)
            except (ValueError, TypeError):
                pass
        return 0.0

    def _filter_by_budget(self, cards: List[Dict], budget_tier: str) -> List[Dict]:
        """Filter cards by budget tier."""
        if budget_tier not in PRICE_TIERS:
            return cards

        low, high = PRICE_TIERS[budget_tier]
        return [c for c in cards if low <= self._get_card_price(c) < high]

    def _filter_by_color_identity(self, cards: List[Dict], commander_identity: List[str]) -> List[Dict]:
        """Filter cards to match commander's color identity."""
        commander_set = set(commander_identity)
        valid = []
        for card in cards:
            card_identity = set(card.get('color_identity', []) or [])
            if card_identity.issubset(commander_set):
                valid.append(card)
        return valid

    def _is_commander_legal(self, card: Dict) -> bool:
        legalities = card.get('legalities') or {}
        return legalities.get('commander') == 'legal' and self._is_constructed_playable(card)

    def _card_text(self, card: Dict) -> str:
        parts = [
            card.get('name') or '',
            card.get('mana_cost') or '',
            card.get('type_line') or '',
            card.get('oracle_text') or '',
            " ".join(card.get('keywords') or []),
        ]
        return "\n".join(part for part in parts if part)

    def _theme_query_expansions(self, theme: str) -> List[str]:
        """Turn user theme words into stronger search phrases."""
        text = (theme or "").lower()
        expansions = []
        theme_map = {
            "landfall": "landfall land enters battlefield play additional lands search library land",
            "lands": "lands matter landfall play additional lands land recursion",
            "graveyard": "graveyard recursion reanimate self mill sacrifice dies escape flashback",
            "reanimator": "graveyard reanimate return creature card from graveyard",
            "exile": "exile cards cast from exile impulse draw blink exile target",
            "blink": "exile return battlefield enters the battlefield flicker blink",
            "tokens": "create token populate go wide anthem creature tokens",
            "token": "create token populate go wide anthem creature tokens",
            "sacrifice": "sacrifice aristocrats dies death triggers blood artist",
            "aristocrats": "sacrifice creature dies each opponent loses life death triggers",
            "artifacts": "artifact synergy mana rock treasure sacrifice artifact affinity",
            "artifact": "artifact synergy mana rock treasure sacrifice artifact affinity",
            "enchantments": "enchantment aura constellation enchantress",
            "enchantment": "enchantment aura constellation enchantress",
            "lifegain": "gain life whenever you gain life lifelink life total",
            "life gain": "gain life whenever you gain life lifelink life total",
            "counters": "+1/+1 counters proliferate counter synergy",
            "+1/+1": "+1/+1 counters proliferate counter synergy",
            "spellslinger": "instant sorcery cast noncreature spell magecraft storm",
            "spells": "instant sorcery cast noncreature spell magecraft storm",
            "draw": "draw cards whenever you draw card advantage",
            "discard": "discard madness reanimator draw discard",
            "mill": "mill cards graveyard self mill opponent mills",
            "voltron": "equipment aura commander damage protection double strike",
            "dragons": "dragon tribal flying big creatures treasure",
            "zombies": "zombie tribal graveyard sacrifice death triggers",
            "goblins": "goblin tribal tokens sacrifice haste",
            "elves": "elf tribal mana dork +1/+1 counters",
        }
        for key, query in theme_map.items():
            if key in text:
                expansions.append(query)
        if theme:
            expansions.insert(0, theme)
        return list(dict.fromkeys(expansions))[:6]

    def _score_theme_rule_fit(self, card: Dict, theme: str) -> float:
        """Fast text/tag score for explicit theme terms."""
        if not theme:
            return 0.0
        haystack = " ".join([
            (card.get('name') or '').lower(),
            (card.get('type_line') or '').lower(),
            (card.get('oracle_text') or '').lower(),
            " ".join(card.get('keywords') or []).lower(),
        ])
        score = 0.0
        for query in self._theme_query_expansions(theme):
            terms = [t for t in query.lower().replace("+1/+1", "counter").split() if len(t) >= 4]
            if not terms:
                continue
            hits = sum(1 for term in set(terms) if term in haystack)
            score += min(1.0, hits / max(3, len(set(terms)))) * 0.8
        return min(score, 2.5)

    def _build_theme_queries(self, theme: str, commander: Optional[Dict] = None) -> List[str]:
        queries = self._theme_query_expansions(theme)
        if commander:
            queries.extend(self._extract_synergy_keywords(commander))
        return list(dict.fromkeys(q for q in queries if q))[:8]

    def _score_model_fit(self, card: Dict, model_context: Optional[Dict]) -> Optional[float]:
        """Use the trained local scorer for top candidate reranking when enabled."""
        if not model_context or self._model_scoring_unavailable:
            return None
        name = card.get('name') or ''
        if not name:
            return None
        cache_key = "|".join([
            model_context.get('source_card', ''),
            model_context.get('theme', ''),
            "".join(model_context.get('colors', []) or []),
            name,
        ]).lower()
        if cache_key in self._model_fit_cache:
            return self._model_fit_cache[cache_key]
        try:
            from backend.model_scorers import get_qwen35_scorer
            scorer = get_qwen35_scorer()
            score = scorer.score_similarity(
                source_card=model_context.get('source_card', 'Theme'),
                candidate_card=name,
                source_text=model_context.get('source_text', ''),
                candidate_text=self._card_text(card),
                commander_name=model_context.get('commander_name', ''),
                commander_colors="".join(model_context.get('colors', []) or []),
            )
            self._model_fit_cache[cache_key] = score
            return score
        except Exception:
            self._model_scoring_unavailable = True
            return None

    def _filter_by_bracket(
        self,
        cards: List[Dict],
        bracket: int,
        current_counts: Dict[str, int]
    ) -> List[Dict]:
        """Filter cards based on bracket restrictions."""
        valid = []
        for card in cards:
            name = card.get('name', '')
            if is_card_allowed_in_bracket(name, bracket, current_counts):
                valid.append(card)
        return valid

    @staticmethod
    def _is_token_card(card: Dict) -> bool:
        """Check if a card is a token (not a real card that belongs in a deck)."""
        type_line = (card.get('type_line') or '').lower()
        return 'token' in type_line or (card.get('layout') == 'token')

    @classmethod
    def _build_card_by_name(cls, cards: List[Dict]) -> Dict[str, Dict]:
        """Build the name -> card index, preferring real/playable printings.

        Some names collide with a token printing (e.g. "Llanowar Elves" exists
        as both the real ``{G}`` creature and a ``layout=token`` entry with an
        empty mana cost). A naive ``{c['name']: c}`` comprehension keeps the LAST
        row, so a trailing token printing would shadow the real card — it would
        then be served to the game engine via /api/cards-batch and load as a
        free-to-cast token, desyncing game state. Always let a non-token printing
        win over a token one regardless of file order.
        """
        index: Dict[str, Dict] = {}
        for card in cards:
            name = card.get('name')
            if not name:
                continue
            existing = index.get(name)
            if existing is None:
                index[name] = card
            elif cls._is_token_card(existing) and not cls._is_token_card(card):
                index[name] = card
        return index

    def _is_land(self, card: Dict) -> bool:
        """Check if a card is a land."""
        type_line = (card.get('type_line') or '').lower()
        return 'land' in type_line

    def _is_removal(self, card: Dict) -> bool:
        """Check if a card is removal."""
        oracle = (card.get('oracle_text') or '').lower()
        type_line = (card.get('type_line') or '').lower()

        removal_keywords = ['destroy target', 'exile target', 'destroy all', 'exile all',
                           'deals damage to', 'counter target', '-x/-x', 'sacrifice']
        return any(kw in oracle for kw in removal_keywords)

    def _is_ramp(self, card: Dict) -> bool:
        """Check if a card provides ramp."""
        oracle = (card.get('oracle_text') or '').lower()
        type_line = (card.get('type_line') or '').lower()

        # Mana rocks
        if 'artifact' in type_line and 'add' in oracle:
            return True

        # Land ramp
        ramp_keywords = ['search your library for a', 'land', 'add one mana',
                        'add {', 'mana of any color']
        return any(kw in oracle for kw in ramp_keywords)

    def _is_card_draw(self, card: Dict) -> bool:
        """Check if a card provides card draw."""
        oracle = (card.get('oracle_text') or '').lower()
        draw_keywords = ['draw a card', 'draw cards', 'draw two', 'draw three',
                        'draw x', 'whenever you draw']
        return any(kw in oracle for kw in draw_keywords)

    def _is_wincon(self, card: Dict) -> bool:
        """Check if a card is a wincon."""
        name = card.get('name') or ''
        oracle = (card.get('oracle_text') or '').lower()

        # Known wincons
        if name in WINCON_CARDS:
            return True

        # Text-based detection
        wincon_keywords = ['you win the game', 'opponent loses the game',
                          'infinite', 'each opponent loses', 'damage to each opponent']
        return any(kw in oracle for kw in wincon_keywords)

    def _get_cmc(self, card: Dict) -> int:
        """Get converted mana cost, capped at 7 for curve purposes."""
        cmc = card.get('cmc', 0)
        try:
            return min(int(float(cmc)), 7)
        except (ValueError, TypeError):
            return 0

    def _get_type_category(self, card: Dict) -> str:
        """Determine the display category based on card type_line."""
        type_line = (card.get('type_line') or '').lower()

        # Check type in priority order (some cards have multiple types)
        if 'planeswalker' in type_line:
            return 'Planeswalkers'
        elif 'creature' in type_line:
            return 'Creatures'
        elif 'instant' in type_line:
            return 'Instants'
        elif 'sorcery' in type_line:
            return 'Sorceries'
        elif 'artifact' in type_line and 'creature' not in type_line:
            return 'Artifacts'
        elif 'enchantment' in type_line and 'creature' not in type_line:
            return 'Enchantments'
        elif 'land' in type_line:
            return 'Lands'
        else:
            return 'Other'

    def _add_card_to_type_category(self, card_name: str, type_categories: Dict[str, List[str]]) -> None:
        """Add a card to the appropriate type category."""
        card = self.card_by_name.get(card_name)
        if card:
            category = self._get_type_category(card)
            if card_name not in type_categories[category]:
                type_categories[category].append(card_name)

    def _is_staple(self, card: Dict, category: str, colors: List[str]) -> bool:
        """Check if a card is a known staple for the given category and colors."""
        name = card.get('name', '')

        if category == 'removal':
            staples = get_removal_for_colors(colors)
        elif category == 'ramp':
            staples = get_ramp_for_colors(colors)
        elif category == 'card_draw':
            staples = get_draw_for_colors(colors)
        else:
            return False

        return name in staples

    def _score_card(
        self,
        card: Dict,
        category: str,
        colors: List[str],
        search_score: float = 0.0,
        theme_score: float = 0.0,
        model_score: Optional[float] = None,
        current_curve: Dict[int, int] = None,
        target_curve: Dict[int, float] = None,
        total_nonlands: int = 65
    ) -> float:
        """
        Score a card for selection priority. Higher = better.

        Factors:
        - Staple bonus: Known good cards get priority
        - Search score: Semantic relevance to theme/commander
        - Mana curve: Cards that fill gaps in the curve score higher
        - Price efficiency: Slightly prefer affordable cards (not strict filtering)
        """
        score = 0.0
        name = card.get('name', '')

        # Base score from semantic search (0-1 range typically)
        # Boost synergy weight: 50% influence (was 30%)
        score += search_score * 3.5
        score += theme_score * 2.0
        if model_score is not None:
            score += model_score * 3.0

        # Staple bonus: +3 for known staples
        # Reduced staple bonus (was +3.0) to let synergy dominate
        if self._is_staple(card, category, colors):
            score += 1.5

        # Mana curve bonus: reward filling gaps
        if current_curve and target_curve:
            cmc = self._get_cmc(card)
            current_count = current_curve.get(cmc, 0)
            target_count = target_curve.get(cmc, 0.1) * total_nonlands

            # If we're under target for this CMC, bonus
            if current_count < target_count:
                gap_ratio = (target_count - current_count) / max(target_count, 1)
                score += gap_ratio * 1.5

        # Slight preference for more affordable cards (soft budget consideration)
        price = self._get_card_price(card)
        if price < 1:
            score += 0.3
        elif price < 5:
            score += 0.2
        elif price > 50:
            score -= 0.2

        return score

    def _extract_synergy_keywords(self, commander: Dict) -> List[str]:
        """Extract keywords from commander to build synergy queries."""
        oracle = (commander.get('oracle_text') or '').lower()
        type_line = (commander.get('type_line') or '').lower()
        keywords_list = commander.get('keywords', []) or []

        queries = []

        # Add commander name for direct synergy
        name = commander.get('name', '')
        queries.append(f"{name} synergy")

        # Check for common synergy patterns in oracle text
        synergy_patterns = {
            'enters the battlefield': 'ETB triggers blink flicker',
            'whenever a creature dies': 'sacrifice aristocrats death triggers',
            'whenever you cast': 'spellslinger storm magecraft',
            'tokens': 'token generation populate',
            '+1/+1 counter': '+1/+1 counters proliferate',
            'graveyard': 'graveyard recursion reanimator',
            'draw a card': 'card draw wheels',
            'discard': 'discard madness reanimator',
            'land': 'landfall lands matter',
            'artifact': 'artifacts affinity metalcraft',
            'enchantment': 'enchantress enchantments constellation',
            'equipment': 'equipment voltron',
            'aura': 'auras voltron enchantress',
            'life': 'lifegain soul sisters',
            'combat damage': 'combat damage voltron extra combat',
            'attack': 'aggro attacks combat',
            'tap': 'tap untap combo',
            'mana': 'mana ramp big mana',
            'spell': 'spells instants sorceries',
            'creature spell': 'creature spells beast whisperer',
            'noncreature': 'noncreature spells',
            'exile': 'exile blink',
            'copy': 'copy clone',
            'counter': 'counters proliferate',
            'sacrifice': 'sacrifice aristocrats',
        }

        for pattern, query in synergy_patterns.items():
            if pattern in oracle:
                queries.append(query)

        # Add creature type synergies
        creature_types = ['elf', 'goblin', 'zombie', 'vampire', 'dragon', 'angel',
                         'demon', 'wizard', 'warrior', 'knight', 'soldier', 'spirit',
                         'elemental', 'beast', 'bird', 'cat', 'dinosaur', 'merfolk',
                         'pirate', 'rogue', 'cleric', 'druid', 'shaman', 'human']
        for ctype in creature_types:
            if ctype in type_line or ctype in oracle:
                queries.append(f"{ctype} tribal lord anthem")

        # Add keyword abilities
        keyword_synergies = {
            'flying': 'flying evasion',
            'trample': 'trample power boost',
            'deathtouch': 'deathtouch fight removal',
            'lifelink': 'lifelink lifegain',
            'haste': 'haste aggro',
            'vigilance': 'vigilance attack defense',
            'menace': 'menace evasion',
            'reach': 'reach defense',
            'double strike': 'double strike voltron',
            'first strike': 'first strike combat',
            'hexproof': 'hexproof protection',
            'indestructible': 'indestructible protection',
            'flash': 'flash instant speed',
        }

        for kw in keywords_list:
            kw_lower = kw.lower()
            if kw_lower in keyword_synergies:
                queries.append(keyword_synergies[kw_lower])

        return queries[:5]  # Limit to top 5 most relevant queries

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
        randomness: float = 0.15,
        theme: str = "",
        model_context: Optional[Dict] = None,
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

            # Skip token cards (not real cards for decks)
            if self._is_token_card(card):
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
            theme_score = self._score_theme_rule_fit(card, theme)
            score = self._score_card(
                card,
                category,
                colors,
                search_score=search_score,
                theme_score=theme_score,
                current_curve=current_curve,
                target_curve=MANA_CURVE_TARGETS,
                total_nonlands=65,
            ) + budget_penalty

            scored.append((score, card))

        # Sort by score descending
        scored.sort(key=lambda x: x[0], reverse=True)

        if model_context and count > 0 and scored:
            rerank_limit = min(len(scored), max(24, count * 4))
            reranked = []
            for score, card in scored[:rerank_limit]:
                model_score = self._score_model_fit(card, model_context)
                if model_score is not None:
                    score += model_score * 3.0
                    card['model_fit_score'] = model_score
                reranked.append((score, card))
            scored = sorted(reranked + scored[rerank_limit:], key=lambda x: x[0], reverse=True)

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

    def _is_constructed_playable(self, card: Dict) -> bool:
        """Return True for real cards that can be registered in a constructed deck."""
        layout = (card.get("layout") or "").lower()
        type_line = (card.get("type_line") or "").lower()
        if self._is_token_card(card):
            return False
        if layout == "art_series":
            return False
        if type_line in {"card", "card // card"}:
            return False
        return True

    def _is_standard_legal(self, card: Dict) -> bool:
        legalities = card.get("legalities") or {}
        return legalities.get("standard") == "legal" and self._is_constructed_playable(card)

    def _standard_card_pool(self, colors: List[str], budget_tier: Optional[str]) -> List[Dict]:
        color_set = set(colors)
        pool = []
        for card in self.cards:
            if not self._is_standard_legal(card):
                continue
            identity = set(card.get("color_identity") or [])
            if not identity.issubset(color_set):
                continue
            if budget_tier:
                _, high = PRICE_TIERS.get(budget_tier, (0, float("inf")))
                if self._get_card_price(card) > high * 2:
                    continue
            pool.append(card)
        return pool

    def _is_constructed_interaction(self, card: Dict) -> bool:
        oracle = (card.get("oracle_text") or "").lower()
        interaction_terms = [
            "destroy target", "exile target", "counter target", "deals damage to",
            "gets -", "sacrifice a creature", "return target", "destroy all",
            "exile all", "can't be blocked", "prevent",
        ]
        return any(term in oracle for term in interaction_terms)

    def _is_constructed_value(self, card: Dict) -> bool:
        oracle = (card.get("oracle_text") or "").lower()
        value_terms = [
            "draw a card", "draw two", "look at the top", "surveil", "scry",
            "return target card", "create a token", "whenever", "at the beginning",
            "search your library", "add one mana", "add {",
        ]
        return any(term in oracle for term in value_terms)

    def _is_sideboard_card(self, card: Dict) -> bool:
        oracle = (card.get("oracle_text") or "").lower()
        sideboard_terms = [
            "destroy target artifact", "destroy target enchantment", "exile target graveyard",
            "graveyard", "counter target", "can't be countered", "gain life",
            "damage to each", "destroy all creatures", "exile all creatures",
            "hexproof", "protection from",
        ]
        return any(term in oracle for term in sideboard_terms)

    def _score_standard_sideboard_card(self, card: Dict, query_scores: Dict[str, float]) -> float:
        """Score cards by how useful they are as post-board answers."""
        name = card.get("name") or ""
        oracle = (card.get("oracle_text") or "").lower()
        type_line = (card.get("type_line") or "").lower()
        cmc = self._get_cmc(card)
        score = query_scores.get(name, 0.0) * 0.5

        if "destroy target artifact" in oracle or "destroy target enchantment" in oracle:
            score += 3.0
        if "exile target card from a graveyard" in oracle or "exile each opponent's graveyard" in oracle:
            score += 3.0
        elif "graveyard" in oracle and any(term in oracle for term in ["exile", "shuffle", "bottom"]):
            score += 2.0
        if "counter target" in oracle:
            score += 2.6
        if any(term in oracle for term in ["destroy all creatures", "exile all creatures", "damage to each creature"]):
            score += 2.4
        if "can't be countered" in oracle:
            score += 1.4
        if "gain life" in oracle or "players can't gain life" in oracle:
            score += 1.2
        if any(term in oracle for term in ["deals damage to target creature", "deals 6 damage to target creature", "gets -"]):
            score += 1.1
        if "instant" in type_line:
            score += 0.4
        if cmc <= 3:
            score += 0.4
        elif cmc >= 6:
            score -= 0.6
        return score

    def _standard_archetype_key(self, archetype: str, theme: str) -> str:
        text = f"{archetype} {theme}".lower()
        for key in STANDARD_ARCHETYPE_PROFILES:
            if key in text:
                return key
        return "midrange"

    def _standard_search_scores(self, query: str, pool: List[Dict]) -> Dict[str, float]:
        if not query.strip():
            return {}
        allowed = {card.get("name") for card in pool}
        scores: Dict[str, float] = {}
        for result in self.search_cards(query, k=120):
            name = result.get("name")
            if name in allowed:
                scores[name] = max(scores.get(name, 0.0), float(result.get("score") or 0.0))
        return scores

    def _score_standard_card(
        self,
        card: Dict,
        archetype_key: str,
        query_scores: Dict[str, float],
        current_curve: Dict[int, int],
        theme: str = "",
    ) -> float:
        name = card.get("name") or ""
        oracle = (card.get("oracle_text") or "").lower()
        type_line = (card.get("type_line") or "").lower()
        cmc = self._get_cmc(card)
        score = query_scores.get(name, 0.0) * 4.0
        score += self._score_theme_rule_fit(card, theme) * 1.8

        # Standard decks care a lot about early plays.
        if cmc <= 2:
            score += 1.0
        elif cmc == 3:
            score += 0.5
        elif cmc >= 6:
            score -= 0.8

        if archetype_key == "aggro":
            if "creature" in type_line:
                score += 1.5
            if any(term in oracle for term in ["haste", "can't block", "damage to any target", "combat damage"]):
                score += 1.2
            if cmc > 4:
                score -= 1.0
        elif archetype_key == "control":
            if self._is_constructed_interaction(card):
                score += 1.6
            if any(term in oracle for term in ["draw", "counter target", "destroy all", "exile all"]):
                score += 1.2
        elif archetype_key == "ramp":
            if any(term in oracle for term in ["search your library for a basic land", "add one mana", "add {"]):
                score += 1.5
            if "creature" in type_line and cmc >= 5:
                score += 1.0
        elif archetype_key == "tokens":
            if "create" in oracle and "token" in oracle:
                score += 1.8
            if any(term in oracle for term in ["creatures you control get", "+1/+1"]):
                score += 1.0
        elif archetype_key == "graveyard":
            if "graveyard" in oracle or "dies" in oracle or "sacrifice" in oracle:
                score += 1.6
        elif archetype_key == "artifacts":
            if "artifact" in type_line or "artifact" in oracle:
                score += 1.7
        elif archetype_key == "spells":
            if "instant" in type_line or "sorcery" in type_line or "noncreature" in oracle:
                score += 1.5

        target_for_cmc = {0: 0, 1: 8, 2: 12, 3: 9, 4: 5, 5: 3, 6: 2, 7: 1}
        if current_curve.get(cmc, 0) < target_for_cmc.get(cmc, 1):
            score += 0.6

        price = self._get_card_price(card)
        if price < 1:
            score += 0.2
        elif price > 30:
            score -= 0.2

        return score

    def _add_standard_card(
        self,
        deck: Dict[str, int],
        card: Dict,
        qty: int,
        current_curve: Dict[int, int],
    ) -> int:
        name = card.get("name")
        if not name:
            return 0
        max_copies = 99 if name in CONSTRUCTED_BASIC_LANDS else 4
        current = deck.get(name, 0)
        add = max(0, min(qty, max_copies - current))
        if add <= 0:
            return 0
        deck[name] = current + add
        if not self._is_land(card):
            cmc = self._get_cmc(card)
            current_curve[cmc] = current_curve.get(cmc, 0) + add
        return add

    def generate_standard_deck(
        self,
        colors: Optional[List[str]] = None,
        archetype: str = "midrange",
        theme: str = "",
        budget_tier: Optional[str] = None,
        use_model_scoring: bool = False,
    ) -> Dict:
        """Generate a Standard-legal 60-card deck with a 15-card sideboard."""
        if not self._loaded:
            self.load()

        colors = [c for c in (colors or ["R"]) if c in BASIC_LANDS]
        if not colors:
            colors = ["R"]

        archetype_key = self._standard_archetype_key(archetype, theme)
        profile = STANDARD_ARCHETYPE_PROFILES[archetype_key]
        pool = self._standard_card_pool(colors, budget_tier)
        if not pool:
            return {"error": "No Standard-legal cards found for those colors"}

        theme_queries = self._build_theme_queries(theme or archetype_key)
        query = " ".join([
            STANDARD_ARCHETYPE_QUERIES.get(archetype_key, archetype_key),
            theme,
            " ".join(theme_queries),
            " ".join(colors),
        ]).strip()
        query_scores = self._standard_search_scores(query, pool)

        nonlands = [card for card in pool if not self._is_land(card)]
        creatures = [card for card in nonlands if "creature" in (card.get("type_line") or "").lower()]
        interaction = [card for card in nonlands if self._is_constructed_interaction(card)]
        value = [card for card in nonlands if self._is_constructed_value(card)]

        current_curve: Dict[int, int] = {i: 0 for i in range(8)}
        main: Dict[str, int] = {}
        model_context = None
        if use_model_scoring:
            model_context = {
                "source_card": f"Standard {archetype_key.title()} deck",
                "source_text": query,
                "theme": theme or archetype_key,
                "colors": colors,
                "commander_name": "",
            }

        def ranked(candidates: List[Dict]) -> List[Dict]:
            seen = {}
            for card in candidates:
                seen[card.get("name")] = card
            scored = sorted(
                (
                    (self._score_standard_card(card, archetype_key, query_scores, current_curve, theme or archetype_key), card)
                    for card in seen.values()
                ),
                key=lambda item: item[0],
                reverse=True,
            )
            if model_context and scored:
                rerank_limit = min(len(scored), 36)
                reranked = []
                for score, card in scored[:rerank_limit]:
                    model_score = self._score_model_fit(card, model_context)
                    if model_score is not None:
                        score += model_score * 3.0
                        card["model_fit_score"] = model_score
                    reranked.append((score, card))
                scored = sorted(reranked + scored[rerank_limit:], key=lambda item: item[0], reverse=True)
            return [card for _, card in scored]

        def fill_from(candidates: List[Dict], target_cards: int, preferred_qty: int) -> None:
            added = 0
            for card in ranked(candidates):
                remaining_slots = (60 - profile["lands"]) - sum(main.values())
                remaining_target = target_cards - added
                if remaining_slots <= 0 or remaining_target <= 0:
                    break
                qty = min(preferred_qty, remaining_slots, remaining_target)
                if self._get_cmc(card) >= 5:
                    qty = min(qty, 2)
                added += self._add_standard_card(main, card, qty, current_curve)

        fill_from(creatures, profile["creatures"], 4 if archetype_key in {"aggro", "tempo"} else 3)
        fill_from(interaction, profile["interaction"], 3)
        fill_from(value, profile["value"], 2)

        # Fill any remaining nonland slots with the best overall cards.
        nonland_target = 60 - profile["lands"]
        for card in ranked(nonlands):
            if sum(main.values()) >= nonland_target:
                break
            self._add_standard_card(main, card, min(2, nonland_target - sum(main.values())), current_curve)

        # Add lands. Prefer useful non-basics, then basics.
        lands_to_add = profile["lands"]
        nonbasic_lands = [
            card for card in pool
            if self._is_land(card)
            and card.get("name") not in CONSTRUCTED_BASIC_LANDS
            and is_land_useful_for_colors(card.get("name", ""), card.get("oracle_text", ""), colors)
        ]
        for land in ranked(nonbasic_lands):
            if lands_to_add <= max(12, len(colors) * 4):
                break
            lands_to_add -= self._add_standard_card(main, land, 2, current_curve)

        if colors:
            basics_per_color = lands_to_add // len(colors)
            remainder = lands_to_add % len(colors)
            for i, color in enumerate(colors):
                basic = BASIC_LANDS.get(color, "Wastes")
                count = basics_per_color + (1 if i < remainder else 0)
                if count > 0:
                    main[basic] = main.get(basic, 0) + count

        # Sideboard: targeted interaction and resilient/value cards.
        sideboard: Dict[str, int] = {}
        combined_counts = dict(main)
        sideboard_seen = {}
        for card in nonlands:
            if self._is_sideboard_card(card):
                sideboard_seen[card.get("name")] = card
        sideboard_candidates = sorted(
            sideboard_seen.values(),
            key=lambda card: self._score_standard_sideboard_card(card, query_scores),
            reverse=True,
        )
        for card in sideboard_candidates:
            if sum(sideboard.values()) >= 15:
                break
            name = card.get("name")
            if not name:
                continue
            max_add = 4 - combined_counts.get(name, 0)
            if max_add <= 0:
                continue
            qty = min(2, max_add, 15 - sum(sideboard.values()))
            sideboard[name] = sideboard.get(name, 0) + qty
            combined_counts[name] = combined_counts.get(name, 0) + qty

        # If sideboard is short, add best legal cards that fit the combined copy rule.
        for card in ranked(nonlands):
            if sum(sideboard.values()) >= 15:
                break
            name = card.get("name")
            if not name:
                continue
            max_add = 4 - combined_counts.get(name, 0)
            if max_add <= 0:
                continue
            qty = min(1, max_add, 15 - sum(sideboard.values()))
            sideboard[name] = sideboard.get(name, 0) + qty
            combined_counts[name] = combined_counts.get(name, 0) + qty

        type_categories = {
            "Creatures": [],
            "Instants": [],
            "Sorceries": [],
            "Artifacts": [],
            "Enchantments": [],
            "Planeswalkers": [],
            "Lands": [],
            "Other": [],
            "Sideboard": [],
        }

        def line(name: str, qty: int) -> str:
            return f"{qty}x {name}"

        for name, qty in sorted(main.items()):
            card = self.card_by_name.get(name)
            if card:
                category = self._get_type_category(card)
                type_categories[category].append(line(name, qty))
        for name, qty in sorted(sideboard.items()):
            type_categories["Sideboard"].append(line(name, qty))

        main_list = [line(name, qty) for name, qty in sorted(main.items())]
        sideboard_list = [line(name, qty) for name, qty in sorted(sideboard.items())]
        deck_list = [*main_list, "Sideboard", *sideboard_list]
        all_counts = {**main, **sideboard}
        total_price = sum(
            self._get_card_price(self.card_by_name.get(name, {})) * qty
            for name, qty in all_counts.items()
        )
        display_name = f"Standard {''.join(colors)} {archetype_key.title()}"

        return {
            "commander": display_name,
            "colors": colors,
            "bracket": 0,
            "bracket_name": "Standard",
            "theme": theme or archetype_key.title(),
            "card_count": sum(main.values()),
            "estimated_price": f"${total_price:.2f}",
            "categories": type_categories,
            "sideboard": sideboard_list,
            "list": deck_list,
            "legal_status": "Legal",
            "archetype": archetype_key.title(),
            "format": "standard",
            "generation_method": "faiss+theme+model" if use_model_scoring and not self._model_scoring_unavailable else "faiss+theme",
            "model_scoring": use_model_scoring and not self._model_scoring_unavailable,
            "mana_curve": {str(k): v for k, v in current_curve.items()},
        }

    def generate_deck(
        self,
        commander_name: str,
        bracket: int = 2,
        theme: str = "",
        budget_tier: Optional[str] = None,
        use_model_scoring: bool = False,
    ) -> Dict:
        """
        Generate a Commander deck following Command Zone rules.

        Args:
            commander_name: Name of the commander
            bracket: Power level bracket (1-5)
            theme: Optional theme/strategy for the deck
            budget_tier: Optional budget restriction (budget, affordable, moderate, premium, high_end)

        Returns:
            Dict with deck information including card list
        """
        if not self._loaded:
            self.load()

        # Find commander(s) — supports partner pairs like "Tymna // Dargo"
        is_partners = " // " in commander_name
        commanders = self.find_partner_commanders(commander_name) if is_partners else []
        if is_partners and len(commanders) < 2:
            commander = self.find_commander(commander_name)
            if not commander:
                return {"error": f"Commander not found: {commander_name}"}
            commanders = [commander]
            is_partners = False
        elif not is_partners:
            commander = self.find_commander(commander_name)
            if not commander:
                return {"error": f"Commander not found: {commander_name}"}
            commanders = [commander]

        # Primary commander (used for synergy extraction etc.)
        commander = commanders[0]
        # Union color identity across all partners
        commander_identity = list(dict.fromkeys(
            c for cmd in commanders for c in (cmd.get('color_identity', []) or [])
        ))
        commander_names = [cmd.get('name') for cmd in commanders]
        bracket_info = get_bracket_restrictions(bracket)

        # Track counts for bracket restrictions
        counts = {'game_changers': 0, 'tutors': 0, 'extra_turns': 0}

        # 100-card deck: commanders live in command zone, so non-commander target
        # is 99 for solo or 98 for partners
        non_cmdr_target = 100 - len(commanders)

        # Build the deck
        deck: Dict[str, int] = {}
        # Functional categories (for internal tracking)
        func_categories = {
            'lands': [],
            'ramp': [],
            'card_draw': [],
            'removal': [],
            'wincons': [],
            'synergy': []
        }
        # Type-based categories (for display)
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

        # Track mana curve for non-land cards
        current_curve: Dict[int, int] = {i: 0 for i in range(8)}

        # Get cards matching color identity
        valid_cards = self._filter_by_color_identity(self.cards, commander_identity)

        # Remove banned cards and the commander(s) (don't filter by bracket/budget yet - we'll score instead)
        commander_name_set = set(commander_names)
        valid_cards = [c for c in valid_cards
                      if c.get('name') not in COMMANDER_BANNED_CARDS
                      and c.get('name') not in commander_name_set
                      and self._is_commander_legal(c)]

        # Categorize available cards
        # Filter lands to only include those useful for our color identity
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
        # For wincons, filter out lands that aren't useful for our colors (e.g., Maze's End in colorless)
        wincons = [
            c for c in valid_cards
            if self._is_wincon(c) and (
                not self._is_land(c) or
                is_land_useful_for_colors(c.get('name', ''), c.get('oracle_text', ''), commander_identity)
            )
        ]

        # === STEP 1: Add staples first (known good cards) ===

        # Priority ramp staples
        ramp_staples = get_ramp_for_colors(commander_identity)
        for staple_name in ramp_staples:
            if staple_name in self.card_by_name and staple_name not in deck:
                card = self.card_by_name[staple_name]
                if is_card_allowed_in_bracket(staple_name, bracket, counts):
                    # Check soft budget
                    price = self._get_card_price(card)
                    if budget_tier:
                        _, high = PRICE_TIERS.get(budget_tier, (0, float('inf')))
                        if price > high * 2:
                            continue
                    deck[staple_name] = 1
                    func_categories['ramp'].append(staple_name)
                    self._add_card_to_type_category(staple_name, type_categories)
                    cmc = self._get_cmc(card)
                    current_curve[cmc] = current_curve.get(cmc, 0) + 1
                    if len(func_categories['ramp']) >= COMMAND_ZONE_TEMPLATE['ramp']['min']:
                        break

        # Priority removal staples
        removal_staples = get_removal_for_colors(commander_identity)
        for staple_name in removal_staples:
            if staple_name in self.card_by_name and staple_name not in deck:
                card = self.card_by_name[staple_name]
                if is_card_allowed_in_bracket(staple_name, bracket, counts):
                    price = self._get_card_price(card)
                    if budget_tier:
                        _, high = PRICE_TIERS.get(budget_tier, (0, float('inf')))
                        if price > high * 2:
                            continue
                    if staple_name in GAME_CHANGER_CARDS:
                        counts['game_changers'] += 1
                    deck[staple_name] = 1
                    func_categories['removal'].append(staple_name)
                    self._add_card_to_type_category(staple_name, type_categories)
                    cmc = self._get_cmc(card)
                    current_curve[cmc] = current_curve.get(cmc, 0) + 1
                    if len(func_categories['removal']) >= COMMAND_ZONE_TEMPLATE['removal']['min']:
                        break

        # Priority card draw staples
        draw_staples = get_draw_for_colors(commander_identity)
        for staple_name in draw_staples:
            if staple_name in self.card_by_name and staple_name not in deck:
                card = self.card_by_name[staple_name]
                if is_card_allowed_in_bracket(staple_name, bracket, counts):
                    price = self._get_card_price(card)
                    if budget_tier:
                        _, high = PRICE_TIERS.get(budget_tier, (0, float('inf')))
                        if price > high * 2:
                            continue
                    if staple_name in GAME_CHANGER_CARDS:
                        counts['game_changers'] += 1
                    deck[staple_name] = 1
                    func_categories['card_draw'].append(staple_name)
                    self._add_card_to_type_category(staple_name, type_categories)
                    cmc = self._get_cmc(card)
                    current_curve[cmc] = current_curve.get(cmc, 0) + 1
                    if len(func_categories['card_draw']) >= COMMAND_ZONE_TEMPLATE['card_draw']['min']:
                        break

        # === STEP 2: Generate synergy queries from commander ===

        synergy_queries = self._build_theme_queries(theme, commander)
        if not synergy_queries:
            synergy_queries = self._extract_synergy_keywords(commander)
        model_context = None
        if use_model_scoring:
            commander_text = "\n\n".join(self._card_text(cmd) for cmd in commanders)
            model_context = {
                "source_card": " // ".join(commander_names),
                "source_text": f"{commander_text}\n\nTheme: {theme or 'General synergy'}",
                "theme": theme or "General synergy",
                "colors": commander_identity,
                "commander_name": " // ".join(commander_names),
            }

        # Gather all synergy cards from multiple queries
        all_synergy_cards: Dict[str, Dict] = {}
        for query in synergy_queries:
            results = self.search_cards(query, k=50)
            for card in results:
                name = card.get('name', '')
                if name and name not in all_synergy_cards:
                    all_synergy_cards[name] = card
                elif name in all_synergy_cards:
                    # Boost score for cards matching multiple queries
                    existing_score = all_synergy_cards[name].get('score', 0)
                    new_score = card.get('score', 0)
                    all_synergy_cards[name]['score'] = existing_score + new_score * 0.5

        synergy_cards = list(all_synergy_cards.values())
        synergy_cards = self._filter_by_color_identity(synergy_cards, commander_identity)
        synergy_cards = [c for c in synergy_cards
                        if c.get('name') not in COMMANDER_BANNED_CARDS
                        and c.get('name') not in commander_name_set
                        and self._is_commander_legal(c)
                        and not self._is_land(c)]

        # === STEP 3: Add a theme package before generic template fill ===

        if theme:
            theme_package = self._select_best_cards(
                synergy_cards,
                16,
                'synergy',
                commander_identity,
                bracket,
                counts,
                deck,
                current_curve,
                budget_tier,
                randomness=0.05,
                theme=theme,
                model_context=model_context,
            )
            for card in theme_package:
                name = card.get('name')
                if not name or name in deck:
                    continue
                if name in GAME_CHANGER_CARDS:
                    counts['game_changers'] += 1
                if name in TUTOR_CARDS:
                    counts['tutors'] += 1
                if name in EXTRA_TURN_SPELLS:
                    counts['extra_turns'] += 1
                deck[name] = 1
                if self._is_ramp(card):
                    func_categories['ramp'].append(name)
                elif self._is_removal(card):
                    func_categories['removal'].append(name)
                elif self._is_card_draw(card):
                    func_categories['card_draw'].append(name)
                elif self._is_wincon(card):
                    func_categories['wincons'].append(name)
                else:
                    func_categories['synergy'].append(name)
                self._add_card_to_type_category(name, type_categories)
                cmc = self._get_cmc(card)
                current_curve[cmc] = current_curve.get(cmc, 0) + 1

        # === STEP 4: Fill remaining category slots with scored selection ===

        # Fill remaining ramp slots
        ramp_needed = COMMAND_ZONE_TEMPLATE['ramp']['min'] - len(func_categories['ramp'])
        if ramp_needed > 0:
            # Score ramp cards
            for card in ramp:
                card['score'] = card.get('score', 0.5)
            best_ramp = self._select_best_cards(
                ramp, ramp_needed, 'ramp', commander_identity,
                bracket, counts, deck, current_curve, budget_tier,
                theme=theme,
                model_context=model_context,
            )
            for card in best_ramp:
                name = card.get('name')
                deck[name] = 1
                func_categories['ramp'].append(name)
                self._add_card_to_type_category(name, type_categories)
                cmc = self._get_cmc(card)
                current_curve[cmc] = current_curve.get(cmc, 0) + 1

        # Fill remaining removal slots
        removal_needed = COMMAND_ZONE_TEMPLATE['removal']['min'] - len(func_categories['removal'])
        if removal_needed > 0:
            for card in removal:
                card['score'] = card.get('score', 0.5)
            best_removal = self._select_best_cards(
                removal, removal_needed, 'removal', commander_identity,
                bracket, counts, deck, current_curve, budget_tier,
                theme=theme,
                model_context=model_context,
            )
            for card in best_removal:
                name = card.get('name')
                if name in GAME_CHANGER_CARDS:
                    counts['game_changers'] += 1
                deck[name] = 1
                func_categories['removal'].append(name)
                self._add_card_to_type_category(name, type_categories)
                cmc = self._get_cmc(card)
                current_curve[cmc] = current_curve.get(cmc, 0) + 1

        # Fill remaining card draw slots
        draw_needed = COMMAND_ZONE_TEMPLATE['card_draw']['min'] - len(func_categories['card_draw'])
        if draw_needed > 0:
            for card in draw:
                card['score'] = card.get('score', 0.5)
            best_draw = self._select_best_cards(
                draw, draw_needed, 'card_draw', commander_identity,
                bracket, counts, deck, current_curve, budget_tier,
                theme=theme,
                model_context=model_context,
            )
            for card in best_draw:
                name = card.get('name')
                if name in GAME_CHANGER_CARDS:
                    counts['game_changers'] += 1
                deck[name] = 1
                func_categories['card_draw'].append(name)
                self._add_card_to_type_category(name, type_categories)
                cmc = self._get_cmc(card)
                current_curve[cmc] = current_curve.get(cmc, 0) + 1

        # Add wincons using scoring
        target_wincons = COMMAND_ZONE_TEMPLATE['wincons']['min']
        best_wincons = self._select_best_cards(
            wincons, target_wincons, 'wincons', commander_identity,
            bracket, counts, deck, current_curve, budget_tier,
            theme=theme,
            model_context=model_context,
        )
        for card in best_wincons:
            name = card.get('name')
            if name in GAME_CHANGER_CARDS:
                counts['game_changers'] += 1
            deck[name] = 1
            func_categories['wincons'].append(name)
            self._add_card_to_type_category(name, type_categories)
            cmc = self._get_cmc(card)
            current_curve[cmc] = current_curve.get(cmc, 0) + 1

        # === STEP 4: Add lands ===

        max_lands = COMMAND_ZONE_TEMPLATE['lands']['max']
        num_nonbasics = min(max_lands - 15, len([l for l in lands if 'basic' not in l.get('type_line', '').lower()]))

        # Score and select non-basic lands
        non_basic_lands = [l for l in lands if 'basic' not in l.get('type_line', '').lower()]
        for land in non_basic_lands:
            land['score'] = land.get('score', 0.5)
        best_lands = self._select_best_cards(
            non_basic_lands, num_nonbasics, 'lands', commander_identity,
            bracket, counts, deck, {}, budget_tier,
            theme=theme,
        )
        for land in best_lands:
            name = land.get('name')
            deck[name] = 1
            func_categories['lands'].append(name)
            type_categories['Lands'].append(name)

        # Calculate basics needed
        current_lands = len(func_categories['lands'])
        num_basics = max_lands - current_lands

        # Distribute basics by color
        if commander_identity:
            basics_per_color = num_basics // len(commander_identity)
            remainder = num_basics % len(commander_identity)
            for i, color in enumerate(commander_identity):
                basic = BASIC_LANDS.get(color, 'Wastes')
                count = basics_per_color + (1 if i < remainder else 0)
                if count > 0:
                    deck[basic] = deck.get(basic, 0) + count
                    if basic not in func_categories['lands']:
                        func_categories['lands'].append(basic)
                    if basic not in type_categories['Lands']:
                        type_categories['Lands'].append(basic)
        else:
            deck['Wastes'] = num_basics
            func_categories['lands'].append('Wastes')
            type_categories['Lands'].append('Wastes')

        # === STEP 5: Fill remaining with synergy cards ===

        current_count = sum(deck.values())
        remaining = non_cmdr_target - current_count

        # Select best synergy cards using scoring
        best_synergy = self._select_best_cards(
            synergy_cards, remaining + 10,  # Get extra in case some are filtered
            'synergy', commander_identity,
            bracket, counts, deck, current_curve, budget_tier,
            theme=theme,
            model_context=model_context,
        )

        for card in best_synergy:
            if remaining <= 0:
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
                func_categories['synergy'].append(name)
                self._add_card_to_type_category(name, type_categories)
                cmc = self._get_cmc(card)
                current_curve[cmc] = current_curve.get(cmc, 0) + 1
                remaining -= 1

        # If still not at target, add more basics
        current_count = sum(deck.values())
        if current_count < non_cmdr_target:
            fill_count = non_cmdr_target - current_count
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
        deck_list = [f"1x {cn} *CMDR*" for cn in commander_names]
        for name, qty in sorted(deck.items()):
            deck_list.append(f"{qty}x {name}")

        # Add commander(s) to type categories
        for cn in commander_names:
            type_categories['Commander'].append(cn)

        # Use " // "-joined name for partner commanders in the response
        display_commander_name = " // ".join(commander_names)

        # Format mana curve for response (CMC 7 represents 7+)
        mana_curve = {str(k): v for k, v in current_curve.items()}

        return {
            "commander": display_commander_name,
            "colors": commander_identity,
            "bracket": bracket,
            "bracket_name": bracket_info['name'],
            "theme": theme or "General synergy",
            "card_count": sum(deck.values()) + len(commanders),  # +N for commander(s)
            "estimated_price": f"${total_price:.2f}",
            "categories": type_categories,  # Now returns type-based categories
            "functional_categories": {k: len(v) for k, v in func_categories.items()},  # Optional: keep functional counts
            "mana_curve": mana_curve,
            "synergy_queries": synergy_queries,  # Show what synergies were searched
            "list": deck_list,
            "legal_status": "Legal",
            "archetype": theme or commander.get('type_line', ''),
            "generation_method": "faiss+theme+model" if use_model_scoring and not self._model_scoring_unavailable else "faiss+theme",
            "model_scoring": use_model_scoring and not self._model_scoring_unavailable,
        }

    def generate_deck_with_model(
        self,
        commander_name: str,
        bracket: int = 2,
        theme: str = "",
        budget_tier: Optional[str] = None,
    ) -> Dict:
        """
        Generate a Commander deck using a fine-tuned LLM composer, with FAISS backfill.

        Attempts to use the DeckComposer model to produce a full 99-card list.
        Falls back to the standard FAISS-based generate_deck() on any failure or
        if the model produces fewer than 90 valid cards.  If the model produces
        between 90 and 98 cards, remaining slots are filled by FAISS synergy search.

        Args:
            commander_name: Name of the commander
            bracket: Power level bracket (1-5)
            theme: Optional theme/strategy for the deck
            budget_tier: Optional budget restriction

        Returns:
            Dict matching the generate_deck() response format, with an additional
            'generation_method' key set to 'model' (or 'faiss' on fallback).
        """
        import logging
        logger = logging.getLogger(__name__)

        if not self._loaded:
            self.load()

        # ── Step 1: Find the commander(s) — supports partner pairs ───────────
        is_partners = " // " in commander_name
        commanders = self.find_partner_commanders(commander_name) if is_partners else []
        if is_partners and len(commanders) < 2:
            commander = self.find_commander(commander_name)
            if not commander:
                return {"error": f"Commander not found: {commander_name}"}
            commanders = [commander]
        elif not is_partners:
            commander = self.find_commander(commander_name)
            if not commander:
                return {"error": f"Commander not found: {commander_name}"}
            commanders = [commander]
        commander = commanders[0]
        commander_identity = list(dict.fromkeys(
            c for cmd in commanders for c in (cmd.get('color_identity', []) or [])
        ))
        commander_names_model = [cmd.get('name') for cmd in commanders]
        bracket_info = get_bracket_restrictions(bracket)

        try:
            # ── Step 2: Import and invoke the composer ────────────────────────
            from backend.model_composer import get_composer
            composer = get_composer()

            model_cards, model_lands = composer.compose_deck(
                commander_name=commander.get('name', commander_name),
                colors=commander_identity,
                bracket=bracket,
                theme=theme or "General synergy",
                card_db=self.card_by_name,
            )

            # ── Step 3: Build deck dict and type_categories ───────────────────
            deck: Dict[str, int] = {}
            type_categories: Dict[str, List] = {
                'Commander': [],
                'Creatures': [],
                'Instants': [],
                'Sorceries': [],
                'Artifacts': [],
                'Enchantments': [],
                'Planeswalkers': [],
                'Lands': [],
                'Other': [],
            }
            current_curve: Dict[int, int] = {i: 0 for i in range(8)}

            def _add_card(name: str) -> bool:
                """Validate and add a single card to the deck.  Returns True on success."""
                if name in deck:
                    return False
                # Skip banned cards
                if name in COMMANDER_BANNED_CARDS:
                    logger.debug(f"generate_deck_with_model: skipping banned card {name!r}")
                    return False
                # Must exist in card database
                card = self.card_by_name.get(name)
                if card is None:
                    logger.debug(f"generate_deck_with_model: card not in database {name!r}")
                    return False
                if not self._is_commander_legal(card):
                    logger.debug(f"generate_deck_with_model: card not Commander legal {name!r}")
                    return False
                deck[name] = 1
                self._add_card_to_type_category(name, type_categories)
                if not self._is_land(card):
                    cmc = self._get_cmc(card)
                    current_curve[cmc] = current_curve.get(cmc, 0) + 1
                return True

            # Add non-land cards from model output
            for name in model_cards:
                _add_card(name)

            # Add land cards from model output
            for name in model_lands:
                _add_card(name)

            total_model_cards = len(deck)

            # ── Step 4: Validate minimum threshold ───────────────────────────
            if total_model_cards < 90:
                logger.warning(
                    f"generate_deck_with_model: model produced only {total_model_cards} "
                    "valid cards (< 90). Falling back to FAISS generate_deck()."
                )
                result = self.generate_deck(commander_name, bracket, theme, budget_tier)
                result['generation_method'] = 'faiss'
                return result

            # ── Step 5: Backfill from FAISS if between 90 and 98 cards ───────
            if len(deck) < 99:
                remaining = 99 - len(deck)
                logger.info(
                    f"generate_deck_with_model: {len(deck)} cards from model, "
                    f"backfilling {remaining} slots via FAISS."
                )
                synergy_queries = self._build_theme_queries(theme, commander)
                backfill_candidates: Dict[str, Dict] = {}
                for query in synergy_queries:
                    for card in self.search_cards(query, k=60):
                        cname = card.get('name')
                        if cname and cname not in backfill_candidates:
                            backfill_candidates[cname] = card

                # Filter by color identity and not already in deck
                filtered = self._filter_by_color_identity(
                    list(backfill_candidates.values()), commander_identity
                )
                for card in filtered:
                    if remaining <= 0:
                        break
                    name = card.get('name')
                    if name and name not in set(commander_names_model) and name not in deck:
                        if _add_card(name):
                            remaining -= 1

            # ── Step 6: Fill remaining slots with basic lands ─────────────────
            if len(deck) < 99:
                fill_count = 99 - len(deck)
                if commander_identity:
                    basic = BASIC_LANDS.get(commander_identity[0], 'Wastes')
                else:
                    basic = 'Wastes'
                deck[basic] = deck.get(basic, 0) + fill_count
                if basic not in type_categories['Lands']:
                    type_categories['Lands'].append(basic)

            # ── Step 7: Build response matching generate_deck() format ────────
            total_price = sum(
                self._get_card_price(self.card_by_name.get(name, {})) * qty
                for name, qty in deck.items()
            )

            display_cmdr = " // ".join(commander_names_model)
            deck_list = [f"1x {cn} *CMDR*" for cn in commander_names_model]
            for name, qty in sorted(deck.items()):
                deck_list.append(f"{qty}x {name}")

            for cn in commander_names_model:
                type_categories['Commander'].append(cn)
            mana_curve = {str(k): v for k, v in current_curve.items()}

            return {
                "commander": display_cmdr,
                "colors": commander_identity,
                "bracket": bracket,
                "bracket_name": bracket_info['name'],
                "theme": theme or "General synergy",
                "card_count": sum(deck.values()) + len(commanders),
                "estimated_price": f"${total_price:.2f}",
                "categories": type_categories,
                "mana_curve": mana_curve,
                "list": deck_list,
                "legal_status": "Legal",
                "archetype": theme or commander.get('type_line', ''),
                "generation_method": "model",
            }

        except Exception as exc:
            logger.warning(
                f"generate_deck_with_model: model path failed ({exc!r}). "
                "Falling back to FAISS generate_deck()."
            )
            result = self.generate_deck(commander_name, bracket, theme, budget_tier)
            result['generation_method'] = 'faiss'
            return result

    def regenerate_deck(
        self,
        commander_name: str,
        kept_cards: List[str],
        bracket: int = 2,
        theme: str = "",
        budget_tier: Optional[str] = None,
        excluded_cards: Optional[List[str]] = None,
    ) -> Dict:
        """
        Regenerate a deck while keeping specified cards.

        Args:
            commander_name: Name of the commander
            kept_cards: List of card names to keep in the deck
            bracket: Power level bracket (1-5)
            theme: Optional theme/strategy for the deck
            budget_tier: Optional budget restriction
            excluded_cards: List of card names to exclude (previously rejected cards)

        Returns:
            Dict with deck information including which cards are new
        """
        if not self._loaded:
            self.load()

        # Find commander(s) — supports partner pairs
        is_partners = " // " in commander_name
        commanders = self.find_partner_commanders(commander_name) if is_partners else []
        if is_partners and len(commanders) < 2:
            commander = self.find_commander(commander_name)
            if not commander:
                return {"error": f"Commander not found: {commander_name}"}
            commanders = [commander]
        elif not is_partners:
            commander = self.find_commander(commander_name)
            if not commander:
                return {"error": f"Commander not found: {commander_name}"}
            commanders = [commander]
        commander = commanders[0]
        commander_identity = list(dict.fromkeys(
            c for cmd in commanders for c in (cmd.get('color_identity', []) or [])
        ))
        commander_names = [cmd.get('name') for cmd in commanders]
        commander_name_set = set(commander_names)
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
        excluded_set = set(excluded_cards) if excluded_cards else set()
        valid_cards = [c for c in valid_cards
                      if c.get('name') not in COMMANDER_BANNED_CARDS
                      and c.get('name') not in commander_name_set
                      and c.get('name') not in kept_set
                      and c.get('name') not in excluded_set
                      and self._is_commander_legal(c)]

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

        # Fill remaining category slots - Ramp
        ramp_needed = max(0, COMMAND_ZONE_TEMPLATE['ramp']['min'] - kept_ramp)
        if ramp_needed > 0:
            for card in ramp:
                card['score'] = card.get('score', 0.5)
            best_ramp = self._select_best_cards(
                ramp, ramp_needed, 'ramp', commander_identity,
                bracket, counts, deck, current_curve, budget_tier,
                theme=theme,
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
                bracket, counts, deck, current_curve, budget_tier,
                theme=theme,
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
                bracket, counts, deck, current_curve, budget_tier,
                theme=theme,
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
        synergy_queries = self._build_theme_queries(theme, commander)
        if not synergy_queries:
            synergy_queries = self._extract_synergy_keywords(commander)

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
                        and c.get('name') not in commander_name_set
                        and self._is_commander_legal(c)
                        and not self._is_land(c)]

        # Fill remaining non-land slots
        current_count = sum(deck.values())
        target_nonlands = 99 - COMMAND_ZONE_TEMPLATE['lands']['max']
        remaining_nonlands = target_nonlands - current_count

        if remaining_nonlands > 0:
            best_synergy = self._select_best_cards(
                synergy_cards, remaining_nonlands + 10,
                'synergy', commander_identity,
                bracket, counts, deck, current_curve, budget_tier,
                theme=theme,
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
            non_basic_lands = [l for l in lands if 'basic' not in l.get('type_line', '').lower()]
            num_nonbasics = min(lands_needed - 15, len(non_basic_lands))

            if num_nonbasics > 0:
                for land in non_basic_lands:
                    land['score'] = land.get('score', 0.5)
                best_lands = self._select_best_cards(
                    non_basic_lands, num_nonbasics, 'lands', commander_identity,
                    bracket, counts, deck, {}, budget_tier,
                    theme=theme,
                )
                for land in best_lands:
                    name = land.get('name')
                    deck[name] = 1
                    new_cards.append(name)
                    type_categories['Lands'].append(name)

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

        display_cmdr_regen = " // ".join(commander_names)
        deck_list = [f"1x {cn} *CMDR*" for cn in commander_names]
        for name, qty in sorted(deck.items()):
            deck_list.append(f"{qty}x {name}")

        for cn in commander_names:
            type_categories['Commander'].append(cn)
        mana_curve = {str(k): v for k, v in current_curve.items()}

        return {
            "commander": display_cmdr_regen,
            "colors": commander_identity,
            "bracket": bracket,
            "bracket_name": bracket_info['name'],
            "theme": theme or "General synergy",
            "card_count": sum(deck.values()) + len(commanders),
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


# Singleton instance
_generator: Optional[DeckGenerator] = None


def get_generator() -> DeckGenerator:
    """Get or create the singleton deck generator."""
    global _generator
    if _generator is None:
        _generator = DeckGenerator()
        _generator.load()
    return _generator


def reload_generator() -> DeckGenerator:
    """Reload card data, embeddings, and FAISS index after a data update."""
    global _generator
    _generator = DeckGenerator()
    _generator.load()
    return _generator
