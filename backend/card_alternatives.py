"""Card alternatives finder using ensemble ranking.

Finds cheaper alternatives to MTG cards using:
- FAISS semantic search (text/effect similarity)
- GPT2 model scoring (MTG-specific quality fit)
- Qwen model scoring (Commander context relevance)
- Functional tag matching (category overlap)
"""

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from backend.deck_generator import get_generator
from backend.functional_tags import detect_tags, get_primary_function
from backend.price_service import get_cheapest_price, get_card_prices, get_price_category

logger = logging.getLogger(__name__)

# Ensemble weights
WEIGHT_FAISS = 0.30
WEIGHT_GPT2 = 0.25
WEIGHT_QWEN = 0.25
WEIGHT_CATEGORY = 0.20

# Tag boost when user requests specific category
EXPLICIT_CATEGORY_BOOST = 0.5


@dataclass
class CardAlternative:
    """A card alternative with scoring details."""
    name: str
    oracle_text: str
    type_line: str
    mana_cost: str
    cmc: int
    color_identity: List[str]
    price_usd: Optional[float]
    price_category: str
    functional_tags: List[str]

    # Scores
    faiss_score: float
    gpt2_score: float
    qwen_score: float
    category_score: float
    final_score: float

    # Comparison to source
    price_savings: float
    tradeoff_explanation: str

    # Purchase links
    purchase_links: Dict[str, str]


class CardAlternativeFinder:
    """Find cheaper alternatives to MTG cards using ensemble ranking."""

    def __init__(self, use_gpt2: bool = True, use_qwen: bool = True):
        """
        Initialize the finder.

        Args:
            use_gpt2: Whether to use GPT2 for scoring (slower but better)
            use_qwen: Whether to use Qwen for scoring and explanations
        """
        self.use_gpt2 = use_gpt2
        self.use_qwen = use_qwen
        self.generator = get_generator()
        self._gpt2_scorer = None
        self._qwen_scorer = None

    def _get_gpt2_scorer(self):
        """Lazy load GPT2 scorer."""
        if self._gpt2_scorer is None and self.use_gpt2:
            try:
                from backend.model_scorers import get_gpt2_scorer
                self._gpt2_scorer = get_gpt2_scorer()
            except Exception as e:
                logger.warning(f"Failed to load GPT2 scorer: {e}")
                self.use_gpt2 = False
        return self._gpt2_scorer

    def _get_qwen_scorer(self):
        """Lazy load Qwen scorer."""
        if self._qwen_scorer is None and self.use_qwen:
            try:
                from backend.model_scorers import get_qwen_scorer
                self._qwen_scorer = get_qwen_scorer()
            except Exception as e:
                logger.warning(f"Failed to load Qwen scorer: {e}")
                self.use_qwen = False
        return self._qwen_scorer

    def _get_card_data(self, card_name: str) -> Optional[Dict]:
        """Get card data by name."""
        return self.generator.card_by_name.get(card_name)

    def _calculate_category_score(
        self,
        source_tags: set,
        candidate_tags: set,
        explicit_category: Optional[str] = None
    ) -> float:
        """
        Calculate category match score.

        Args:
            source_tags: Functional tags of source card
            candidate_tags: Functional tags of candidate card
            explicit_category: User-requested category (e.g., "ramp")

        Returns:
            Score from 0 to 1 (can exceed 1 with explicit category boost)
        """
        if not source_tags and not candidate_tags:
            return 0.5  # Neutral score if no tags

        if not source_tags or not candidate_tags:
            return 0.3  # Low score if only one has tags

        # Jaccard similarity
        intersection = len(source_tags & candidate_tags)
        union = len(source_tags | candidate_tags)
        base_score = intersection / union if union > 0 else 0

        # Boost if candidate matches explicit category request
        if explicit_category and explicit_category in candidate_tags:
            base_score += EXPLICIT_CATEGORY_BOOST

        return min(base_score, 1.5)  # Cap at 1.5 to allow boost but not dominate

    def find_alternatives(
        self,
        card_name: str,
        max_price: Optional[float] = None,
        top_k: int = 5,
        candidate_pool_size: int = 20,
        explicit_category: Optional[str] = None,
        color_identity: Optional[List[str]] = None,
    ) -> List[CardAlternative]:
        """
        Find cheaper alternatives to a card.

        Args:
            card_name: Name of the card to find alternatives for
            max_price: Maximum price for alternatives (default: source price)
            top_k: Number of alternatives to return
            candidate_pool_size: Number of candidates from FAISS search
            explicit_category: Filter to specific category (e.g., "ramp", "removal")
            color_identity: Filter to color identity (for Commander decks)

        Returns:
            List of CardAlternative objects sorted by final_score
        """
        # Get source card data
        source_card = self._get_card_data(card_name)
        if not source_card:
            logger.error(f"Card not found: {card_name}")
            return []

        source_name = source_card.get('name') or card_name
        
        source_text = source_card.get('oracle_text')
        if not source_text and 'card_faces' in source_card:
            source_text = '\n//\n'.join(f.get('oracle_text', '') for f in source_card['card_faces'])
        source_text = source_text or ''

        source_type = source_card.get('type_line') or ''
        source_cmc = int(float(source_card.get('cmc') or 0))
        source_keywords = source_card.get('keywords') or []

        # Get source price
        source_price = get_cheapest_price(source_name)
        if source_price is None:
            source_price = 0.0

        # Set max price if not specified
        if max_price is None:
            max_price = source_price

        # Get source functional tags
        source_tags = detect_tags(source_text, source_type, source_keywords)

        # Build search query focused on WHAT THE CARD DOES, not its name
        # This finds cards with similar effects rather than similar names
        query_parts = []

        # Add type line (e.g., "Instant", "Creature - Elf")
        if source_type:
            query_parts.append(source_type)

        # Add oracle text (the actual effect)
        if source_text:
            query_parts.append(source_text[:300])

        # Add functional tags as keywords (e.g., "removal exile instant-speed")
        if source_tags:
            query_parts.append(' '.join(source_tags))

        # Add keywords (e.g., "flying deathtouch")
        if source_keywords:
            query_parts.append(' '.join(source_keywords))

        search_query = ' '.join(query_parts)

        # Get candidates from FAISS - get more candidates since we'll filter heavily
        candidates = self.generator.search_cards(search_query, k=candidate_pool_size * 2)

        # Filter candidates
        filtered = []
        for card in candidates:
            name = card.get('name', '')

            # Skip the source card itself
            if name.lower() == source_name.lower():
                continue

            # Filter by color identity if specified
            if color_identity:
                card_identity = set(card.get('color_identity', []) or [])
                if not card_identity.issubset(set(color_identity)):
                    continue

            # Get price
            card_price = get_cheapest_price(name)
            if card_price is None:
                card_price = 0.0

            # Filter by price (must be cheaper or equal to max)
            if card_price > max_price:
                continue

            # Filter reserved list cards (they are not good budget alternatives)
            if card.get('reserved'):
                continue

            # Filter by explicit category if specified
            if explicit_category:
                card_text = card.get('oracle_text', '')
                card_type = card.get('type_line', '')
                card_keywords = card.get('keywords', [])
                card_tags = detect_tags(card_text, card_type, card_keywords)
                if explicit_category not in card_tags:
                    continue

            filtered.append((card, card_price))

        if not filtered:
            logger.info(f"No alternatives found for {card_name} under ${max_price}")
            return []

        # Score candidates
        alternatives = []
        gpt2_scorer = self._get_gpt2_scorer()
        qwen_scorer = self._get_qwen_scorer()

        for card, card_price in filtered:
            name = card.get('name', '')
            
            # Handle MDFC cards (missing top-level oracle_text/mana_cost)
            text = card.get('oracle_text')
            if not text and 'card_faces' in card:
                text = '\n//\n'.join(f.get('oracle_text', '') for f in card['card_faces'])
            text = text or ''

            type_line = card.get('type_line', '')
            
            mana_cost = card.get('mana_cost')
            if not mana_cost and 'card_faces' in card:
                mana_cost = ' // '.join(f.get('mana_cost', '') for f in card['card_faces'])
            mana_cost = mana_cost or ''

            cmc = int(float(card.get('cmc', 0)))
            keywords = card.get('keywords', [])
            identity = card.get('color_identity', [])

            # FAISS score (already computed during search)
            faiss_score = card.get('score', 0.5)
            # Normalize FAISS score to 0-1 range
            faiss_score = min(max(faiss_score, 0), 1)

            # GPT2 score
            if gpt2_scorer and self.use_gpt2:
                try:
                    gpt2_score = gpt2_scorer.score_similarity(
                        source_name, name, source_text, text
                    )
                except Exception as e:
                    logger.warning(f"GPT2 scoring failed for {name}: {e}")
                    gpt2_score = 0.5
            else:
                gpt2_score = 0.5

            # Qwen score
            if qwen_scorer and self.use_qwen:
                try:
                    qwen_score = qwen_scorer.score_similarity(
                        source_name, name, source_text, text
                    )
                except Exception as e:
                    logger.warning(f"Qwen scoring failed for {name}: {e}")
                    qwen_score = 0.5
            else:
                qwen_score = 0.5

            # Category score
            card_tags = detect_tags(text, type_line, keywords)
            category_score = self._calculate_category_score(
                source_tags, card_tags, explicit_category
            )

            # Calculate final ensemble score
            final_score = (
                WEIGHT_FAISS * faiss_score +
                WEIGHT_GPT2 * gpt2_score +
                WEIGHT_QWEN * qwen_score +
                WEIGHT_CATEGORY * category_score
            )

            # Generate trade-off explanation
            if qwen_scorer and self.use_qwen:
                try:
                    tradeoff = qwen_scorer.generate_tradeoff_explanation(
                        source_name, name, source_text, text,
                        source_price, card_price, source_cmc, cmc
                    )
                except Exception as e:
                    logger.warning(f"Trade-off generation failed: {e}")
                    tradeoff = self._generate_simple_tradeoff(
                        source_name, name, source_price, card_price,
                        source_cmc, cmc, source_tags, card_tags
                    )
            else:
                tradeoff = self._generate_simple_tradeoff(
                    source_name, name, source_price, card_price,
                    source_cmc, cmc, source_tags, card_tags
                )

            # Get purchase links
            prices_data = get_card_prices(name)
            purchase_links = {
                vendor: data.get('url', '')
                for vendor, data in prices_data.items()
                if data.get('url')
            }

            alternative = CardAlternative(
                name=name,
                oracle_text=text,
                type_line=type_line,
                mana_cost=mana_cost,
                cmc=cmc,
                color_identity=identity,
                price_usd=card_price,
                price_category=get_price_category(card_price),
                functional_tags=list(card_tags),
                faiss_score=faiss_score,
                gpt2_score=gpt2_score,
                qwen_score=qwen_score,
                category_score=category_score,
                final_score=final_score,
                price_savings=source_price - card_price,
                tradeoff_explanation=tradeoff,
                purchase_links=purchase_links,
            )
            alternatives.append(alternative)

        # Sort by final score (highest first)
        alternatives.sort(key=lambda x: x.final_score, reverse=True)

        return alternatives[:top_k]

    def _generate_simple_tradeoff(
        self,
        source_name: str,
        candidate_name: str,
        source_price: float,
        candidate_price: float,
        source_cmc: int,
        candidate_cmc: int,
        source_tags: set,
        candidate_tags: set,
    ) -> str:
        """Generate a simple trade-off explanation without LLM."""
        parts = []

        # Price comparison
        savings = source_price - candidate_price
        if savings > 0:
            parts.append(f"${savings:.2f} cheaper")
        elif savings < 0:
            parts.append(f"${abs(savings):.2f} more expensive")

        # CMC comparison
        if candidate_cmc < source_cmc:
            parts.append(f"lower mana cost ({candidate_cmc} vs {source_cmc})")
        elif candidate_cmc > source_cmc:
            parts.append(f"higher mana cost ({candidate_cmc} vs {source_cmc})")

        # Tag differences
        missing_tags = source_tags - candidate_tags
        gained_tags = candidate_tags - source_tags

        if missing_tags:
            parts.append(f"lacks {', '.join(list(missing_tags)[:2])}")
        if gained_tags:
            parts.append(f"adds {', '.join(list(gained_tags)[:2])}")

        if not parts:
            return f"{candidate_name} is a similar option to {source_name}."

        return f"{candidate_name}: {'; '.join(parts)}."

    def optimize_deck(
        self,
        deck_cards: List[str],
        target_savings: Optional[float] = None,
        max_swaps: int = 10,
        color_identity: Optional[List[str]] = None,
    ) -> List[Tuple[str, CardAlternative, float]]:
        """
        Suggest card swaps to reduce deck cost.

        Args:
            deck_cards: List of card names in the deck
            target_savings: Target dollar amount to save (optional)
            max_swaps: Maximum number of swaps to suggest
            color_identity: Commander color identity for filtering

        Returns:
            List of (original_card, alternative, savings) tuples
        """
        # Calculate current prices and find expensive cards
        card_prices = []
        for name in deck_cards:
            price = get_cheapest_price(name)
            if price and price > 1.0:  # Only consider cards over $1
                card_prices.append((name, price))

        # Sort by price (most expensive first)
        card_prices.sort(key=lambda x: x[1], reverse=True)

        swaps = []
        total_savings = 0.0

        for card_name, current_price in card_prices:
            if len(swaps) >= max_swaps:
                break

            if target_savings and total_savings >= target_savings:
                break

            # Find alternatives
            alternatives = self.find_alternatives(
                card_name,
                max_price=current_price * 0.7,  # At least 30% savings
                top_k=1,
                color_identity=color_identity,
            )

            if alternatives:
                best = alternatives[0]
                savings = current_price - (best.price_usd or 0)
                if savings > 0.50:  # Only suggest if saving at least $0.50
                    swaps.append((card_name, best, savings))
                    total_savings += savings

        return swaps


# Singleton instance
_finder: Optional[CardAlternativeFinder] = None


def get_alternative_finder(use_gpt2: bool = True, use_qwen: bool = True) -> CardAlternativeFinder:
    """Get or create the singleton alternative finder."""
    global _finder
    if _finder is None:
        _finder = CardAlternativeFinder(use_gpt2=use_gpt2, use_qwen=use_qwen)
    return _finder
