export interface Deck {
  id: string;
  commander: string;
  colors: string[];
  archetype: string;
  timestamp: string;
  legal_status: string;
  card_count: number;
  estimated_price: string;
  list: string[];
  bracket: number;
  bracket_name: string;
  theme: string;
  categories: Record<string, string[]>;
}

export interface DeckEvent {
  type: 'deck_created' | 'deck_selected';
  payload: Deck;
}

export interface Commander {
  name: string;
  colors: string[];
  type_line: string;
  mana_cost?: string;
  oracle_text?: string;
}

export interface Bracket {
  id: number;
  name: string;
  description: string;
  power_level: [number, number];
  expected_turns?: number;
}

export interface DeckRequest {
  commander: string;
  bracket: number;
  theme?: string;
  budget_tier?: string;
}

export interface DeckSummary {
  id: string;
  commander: string;
  colors: string[];
  bracket: number;
  theme: string;
  created_at: string;
}

export interface CardAlternative {
  name: string;
  oracle_text: string;
  type_line: string;
  mana_cost: string;
  cmc: number;
  color_identity: string[];
  price_usd: number | null;
  price_category: string;
  functional_tags: string[];
  faiss_score: number;
  gpt2_score: number;
  qwen_score: number;
  category_score: number;
  final_score: number;
  price_savings: number;
  tradeoff_explanation: string;
  purchase_links: Record<string, string>;
}

export interface AlternativesResponse {
  source_card: string;
  source_price: number | null;
  alternatives: CardAlternative[];
}

export interface SwapSuggestion {
  original_card: string;
  original_price: number;
  alternative: CardAlternative;
  savings: number;
}

export interface DeckOptimizeResponse {
  total_savings: number;
  swap_count: number;
  suggestions: SwapSuggestion[];
}

export interface CardPriceInfo {
  name: string;
  cheapest_usd: number | null;
  price_category: string;
  vendors: Record<string, { usd: number | null; url: string | null }>;
}

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
