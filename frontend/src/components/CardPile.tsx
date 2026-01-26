import { useState, useRef, useEffect } from 'react';
import { CardImage } from './CardImage';
import { Lock, Sparkles } from 'lucide-react';

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

export function CardPile({
  cards,
  category,
  setPreference,
  onCardClick,
  selectionMode = false,
  lockedCards = new Set(),
  newCards = new Set(),
  coreStaples = new Set(),
  onCardLockToggle,
  useCheckboxFallback = false,
}: CardPileProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (cards.length === 0) return null;

  // Calculate overlap - more overlap on mobile to fit more cards
  const getOverlap = () => {
    if (isMobile) {
      if (cards.length <= 5) return 50;
      if (cards.length <= 10) return 40;
      return 35;
    }
    if (cards.length <= 5) return 60;
    if (cards.length <= 10) return 45;
    if (cards.length <= 15) return 35;
    return 30;
  };

  const overlap = getOverlap();
  const cardWidth = isMobile ? 100 : 130;
  const cardHeight = isMobile ? 140 : 182;
  const pileWidth = cardWidth + (cards.length - 1) * overlap;

  const handleCardInteraction = (cleanName: string, e: React.MouseEvent) => {
    if (selectionMode && onCardLockToggle && !coreStaples.has(cleanName)) {
      e.stopPropagation();
      onCardLockToggle(cleanName);
    } else {
      onCardClick?.(cleanName);
    }
  };

  return (
    <div className="mb-6">
      {/* Category Header */}
      <h3 className="text-sm font-semibold text-stone-700 uppercase tracking-wider mb-3 flex items-center gap-2 px-2 md:px-0">
        <span>{category}</span>
        <span className="text-stone-400 font-normal">({cards.length})</span>
      </h3>

      {/* Card Pile - Scrollable container */}
      <div
        ref={scrollRef}
        className="overflow-x-auto pb-4 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-thin scrollbar-thumb-stone-300 scrollbar-track-transparent"
      >
        <div
          className="relative"
          style={{
            width: pileWidth,
            height: cardHeight + 30,
            minWidth: 'min-content',
          }}
        >
          {cards.map((card, index) => {
            const isExpanded = expandedIndex === index;
            const cleanName = card.replace(/^\d+x\s+/, '').replace(/\s+\*CMDR\*$/, '');

            const isLocked = lockedCards.has(cleanName);
            const isNew = newCards.has(cleanName);
            const isCoreStaple = coreStaples.has(cleanName);
            const isCommander = card.includes('*CMDR*');
            const isFixed = isCoreStaple || isCommander;

            return (
              <div
                key={`${card}-${index}`}
                className={`absolute transition-all duration-200 ease-out ${
                  isExpanded ? 'z-50' : ''
                }`}
                style={{
                  left: index * overlap,
                  top: isExpanded ? -10 : 0,
                  width: cardWidth,
                  height: cardHeight,
                  zIndex: isExpanded ? 50 : index,
                }}
                onMouseEnter={() => !isMobile && setExpandedIndex(index)}
                onMouseLeave={() => !isMobile && setExpandedIndex(null)}
                onTouchStart={() => isMobile && onCardClick?.(cleanName)}
              >
                {/* Card wrapper with selection visuals */}
                <div
                  className={`relative w-full h-full rounded-lg overflow-hidden ${
                    selectionMode && !isFixed ? 'cursor-pointer' : ''
                  } ${
                    isFixed ? 'cursor-not-allowed' : ''
                  }`}
                  onClick={(e) => handleCardInteraction(cleanName, e)}
                >
                  {/* Card image */}
                  <CardImage
                    cardName={cleanName}
                    setCode={setPreference}
                    className="w-full h-full"
                    showHoverZoom={false}
                    size="small"
                    onClick={!selectionMode ? () => onCardClick?.(cleanName) : undefined}
                  />

                  {/* Lock overlay for locked cards */}
                  {selectionMode && isLocked && !isFixed && (
                    <div className="absolute inset-0 border-2 border-blue-500 rounded-lg pointer-events-none">
                      <div className="absolute top-1 right-1 bg-blue-500 rounded-full p-0.5">
                        <Lock className="w-3 h-3 text-white" />
                      </div>
                    </div>
                  )}

                  {/* Fixed indicator for core staples and commander */}
                  {selectionMode && isFixed && (
                    <div className="absolute inset-0 border-2 border-stone-400 rounded-lg pointer-events-none">
                      <div className="absolute top-1 right-1 bg-stone-400 rounded-full p-0.5">
                        <Lock className="w-3 h-3 text-white" />
                      </div>
                    </div>
                  )}

                  {/* New card glow */}
                  {isNew && (
                    <div className="absolute inset-0 border-2 border-green-400 rounded-lg pointer-events-none animate-pulse">
                      <div className="absolute top-1 left-1 bg-green-500 rounded-full p-0.5">
                        <Sparkles className="w-3 h-3 text-white" />
                      </div>
                    </div>
                  )}

                  {/* Checkbox fallback */}
                  {selectionMode && useCheckboxFallback && !isFixed && (
                    <div className="absolute top-1 left-1">
                      <input
                        type="checkbox"
                        checked={isLocked}
                        onChange={(e) => {
                          e.stopPropagation();
                          onCardLockToggle?.(cleanName);
                        }}
                        className="w-4 h-4 rounded border-stone-300 text-blue-600 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </div>

                {/* Card name tooltip on hover (desktop only) */}
                {isExpanded && !isMobile && (
                  <div className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 bg-stone-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-50 max-w-[200px] truncate">
                    {cleanName}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile hint */}
      {isMobile && cards.length > 3 && (
        <div className="text-xs text-stone-400 text-center mt-1">
          Swipe to see more cards
        </div>
      )}
    </div>
  );
}
