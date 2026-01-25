import { useState, useRef, useEffect } from 'react';
import { CardImage } from './CardImage';

interface CardPileProps {
  cards: string[];
  category: string;
  setPreference?: string;
  onCardClick?: (cardName: string) => void;
}

export function CardPile({ cards, category, setPreference, onCardClick }: CardPileProps) {
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
      // Tighter overlap on mobile
      if (cards.length <= 5) return 50;
      if (cards.length <= 10) return 40;
      return 35;
    }
    // Desktop overlap
    if (cards.length <= 5) return 60;
    if (cards.length <= 10) return 45;
    if (cards.length <= 15) return 35;
    return 30;
  };

  const overlap = getOverlap();
  const cardWidth = isMobile ? 100 : 130; // Smaller cards on mobile
  const cardHeight = isMobile ? 140 : 182;

  // Total width needed for the pile
  const pileWidth = cardWidth + (cards.length - 1) * overlap;

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
            height: cardHeight + 30, // Extra space for hover lift and tooltip
            minWidth: 'min-content',
          }}
        >
          {cards.map((card, index) => {
            const isExpanded = expandedIndex === index;
            const cleanName = card.replace(/^\d+x\s+/, '').replace(/\s+\*CMDR\*$/, '');

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
                <CardImage
                  cardName={cleanName}
                  setCode={setPreference}
                  className="w-full h-full"
                  showHoverZoom={false}
                  size="small"
                  onClick={() => onCardClick?.(cleanName)}
                />

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
