import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Deck } from '../types';
import { CardPile } from './CardPile';
import { SetSelector } from './SetSelector';
import { CardImage } from './CardImage';
import { X, Search, ExternalLink } from 'lucide-react';

interface DeckVisualViewProps {
  deck: Deck;
  selectionMode?: boolean;
  lockedCards?: Set<string>;
  newCards?: Set<string>;
  coreStaples?: Set<string>;
  onCardLockToggle?: (cardName: string) => void;
  useCheckboxFallback?: boolean;
}

// Category display order and labels
const CATEGORY_ORDER = [
  { key: 'commander', label: 'Commander' },
  { key: 'creatures', label: 'Creatures' },
  { key: 'instants', label: 'Instants' },
  { key: 'sorceries', label: 'Sorceries' },
  { key: 'artifacts', label: 'Artifacts' },
  { key: 'enchantments', label: 'Enchantments' },
  { key: 'planeswalkers', label: 'Planeswalkers' },
  { key: 'lands', label: 'Lands' },
  { key: 'other', label: 'Other' },
];

interface CardPrinting {
  set_code: string;
  set_name: string;
  image_uri: string;
}

export function DeckVisualView({
  deck,
  selectionMode = false,
  lockedCards = new Set(),
  newCards = new Set(),
  coreStaples = new Set(),
  onCardLockToggle,
  useCheckboxFallback = false,
}: DeckVisualViewProps) {
  const navigate = useNavigate();
  const [setPreference, setSetPreference] = useState<string | undefined>(undefined);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [cardPrintings, setCardPrintings] = useState<CardPrinting[]>([]);
  const [selectedPrinting, setSelectedPrinting] = useState<string>('');
  const [loadingPrintings, setLoadingPrintings] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [cardPriceData, setCardPriceData] = useState<{
    cheapest_usd: number | null;
    vendors: Record<string, { usd: number | null; url: string | null }>;
  } | null>(null);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Fetch printings and price when a card is selected
  useEffect(() => {
    if (!selectedCard) {
      setCardPrintings([]);
      setSelectedPrinting('');
      setCardPriceData(null);
      return;
    }

    setLoadingPrintings(true);

    // Fetch printings
    fetch(`/api/card-printings/${encodeURIComponent(selectedCard)}`)
      .then(res => res.json())
      .then(data => {
        if (data.printings) {
          setCardPrintings(data.printings);
          // Default to the set preference or first printing
          if (setPreference) {
            const matchingPrinting = data.printings.find((p: CardPrinting) => p.set_code === setPreference);
            setSelectedPrinting(matchingPrinting?.set_code || data.printings[0]?.set_code || '');
          } else {
            setSelectedPrinting(data.printings[0]?.set_code || '');
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoadingPrintings(false));

    // Fetch price
    fetch(`/api/card/${encodeURIComponent(selectedCard)}/prices`)
      .then(res => res.json())
      .then(data => {
        setCardPriceData(data);
      })
      .catch(console.error);
  }, [selectedCard, setPreference]);

  // Categorize cards from the deck list
  const categorizedCards = useMemo(() => {
    const categories: Record<string, string[]> = {
      commander: [],
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      other: [],
    };

    // If deck has categories from backend, use those
    if (deck.categories && typeof deck.categories === 'object') {
      // Map backend categories to our display categories (case-insensitive)
      const categoryMap: Record<string, string> = {
        'commander': 'commander',
        'creatures': 'creatures',
        'instants': 'instants',
        'sorceries': 'sorceries',
        'artifacts': 'artifacts',
        'enchantments': 'enchantments',
        'planeswalkers': 'planeswalkers',
        'lands': 'lands',
        'other': 'other',
      };

      for (const [backendCat, cards] of Object.entries(deck.categories)) {
        if (Array.isArray(cards)) {
          const targetCat = categoryMap[backendCat.toLowerCase()] || 'other';
          categories[targetCat].push(...cards);
        }
      }
    }

    // If categories are empty, categorize from the list based on card names
    // This is a fallback for legacy decks without proper categories
    const hasCategories = Object.values(categories).some(arr => arr.length > 0);
    if (!hasCategories && deck.list) {
      for (const card of deck.list) {
        if (card.includes('*CMDR*')) {
          categories.commander.push(card);
        } else if (card.toLowerCase().includes('land') ||
                   ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].some(l => card.includes(l))) {
          categories.lands.push(card);
        } else {
          // Default to other - proper categorization needs card type data
          categories.other.push(card);
        }
      }
    }

    return categories;
  }, [deck]);

  // Get unique sets from deck for selector
  const availableSets = useMemo(() => {
    // In a real implementation, this would fetch available sets for cards in the deck
    // For now, return some popular sets
    return [
      { code: '', name: 'Default Printing' },
      { code: 'one', name: 'Phyrexia: All Will Be One' },
      { code: 'mom', name: 'March of the Machine' },
      { code: 'lci', name: 'Lost Caverns of Ixalan' },
      { code: 'mkm', name: 'Murders at Karlov Manor' },
      { code: 'otj', name: 'Outlaws of Thunder Junction' },
      { code: 'blb', name: 'Bloomburrow' },
      { code: 'dsk', name: 'Duskmourn: House of Horror' },
      { code: '2xm', name: 'Double Masters' },
      { code: 'cmm', name: 'Commander Masters' },
    ];
  }, []);

  const handleCardClick = (cardName: string) => {
    setSelectedCard(cardName);
  };

  const closeModal = () => {
    setSelectedCard(null);
  };

  return (
    <div className="p-4">
      {/* Set Selector */}
      <div className="mb-6 flex items-center gap-3">
        <label className="text-sm text-stone-600">Prefer artwork from:</label>
        <SetSelector
          sets={availableSets}
          selectedSet={setPreference || ''}
          onSetChange={(set) => setSetPreference(set || undefined)}
        />
      </div>

      {/* Card Categories */}
      <div className="space-y-2">
        {CATEGORY_ORDER.map(({ key, label }) => {
          const cards = categorizedCards[key] || [];
          if (cards.length === 0) return null;

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
        })}
      </div>

      {/* Card Detail Modal - Enhanced for mobile */}
      {selectedCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={closeModal}
        >
          <div
            className={`relative flex flex-col items-center ${
              isMobile ? 'w-full max-w-[280px]' : 'w-64'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={closeModal}
              className="absolute -top-10 right-0 text-white hover:text-stone-300 z-10"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Card Image */}
            <div className="w-full">
              <CardImage
                cardName={selectedCard}
                setCode={selectedPrinting || setPreference}
                className="w-full rounded-lg shadow-2xl"
                showHoverZoom={false}
              />
            </div>

            {/* Card name and price */}
            <div className="mt-3 text-center">
              <div className="text-white font-medium text-sm">{selectedCard}</div>
              {cardPriceData?.cheapest_usd !== null && cardPriceData?.cheapest_usd !== undefined && (
                <div className="text-stone-400 text-xs">
                  ${cardPriceData.cheapest_usd.toFixed(2)}
                </div>
              )}
            </div>

            {/* Purchase Links */}
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {cardPriceData?.vendors && Object.entries(cardPriceData.vendors).map(([vendor, data]) => (
                data.url && (
                  <a
                    key={vendor}
                    href={data.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-stone-400 hover:text-white transition-colors"
                  >
                    {vendor === 'tcgplayer' ? 'TCGPlayer' : vendor === 'cardkingdom' ? 'CardKingdom' : vendor}
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )
              ))}
            </div>

            {/* Printing selector */}
            <div className="mt-3 w-full">
              {loadingPrintings ? (
                <div className="text-center text-stone-400 text-xs">
                  Loading printings...
                </div>
              ) : cardPrintings.length > 0 ? (
                <select
                  value={selectedPrinting}
                  onChange={(e) => setSelectedPrinting(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs bg-stone-800 text-white border border-stone-600 rounded focus:ring-stone-500 focus:border-stone-500"
                >
                  {cardPrintings.map((printing) => (
                    <option key={printing.set_code} value={printing.set_code}>
                      {printing.set_name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            {/* Action buttons */}
            <div className="mt-3 w-full flex gap-2">
              <button
                onClick={() => {
                  closeModal();
                  navigate(`/optimizer?card=${encodeURIComponent(selectedCard)}`);
                }}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs bg-stone-700 text-white rounded hover:bg-stone-600 transition-colors"
              >
                <Search className="w-3 h-3" />
                Alternatives
              </button>
              <a
                href={`https://scryfall.com/search?q=!"${encodeURIComponent(selectedCard)}"`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 px-2 py-1.5 text-xs bg-stone-700 text-white rounded hover:bg-stone-600 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Scryfall
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
