import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';

interface DeckSummary {
  id: string;
  commander: string;
  colors: string[];
}

interface LiveRibbonProps {
  recentDecks?: DeckSummary[];
  onSelect?: (id: string) => void;
}

// Color styling for mana symbols
const colorStyles: Record<string, string> = {
  W: 'bg-amber-50 text-amber-700',
  U: 'bg-blue-100 text-blue-700',
  B: 'bg-gray-300 text-gray-800',
  R: 'bg-red-100 text-red-700',
  G: 'bg-green-100 text-green-700',
};

export function LiveRibbon({ recentDecks: localDecks, onSelect }: LiveRibbonProps) {
  const [siteDecks, setSiteDecks] = useState<DeckSummary[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch site-wide recent decks
  useEffect(() => {
    async function fetchRecentDecks() {
      try {
        const res = await fetch('/api/recent-decks?limit=20');
        if (res.ok) {
          const data = await res.json();
          setSiteDecks(data.map((d: any) => ({
            id: d.id,
            commander: d.commander,
            colors: d.colors,
          })));
        }
      } catch (e) {
        console.error('Failed to fetch recent decks:', e);
      }
    }

    fetchRecentDecks();
    // Refresh every 30 seconds
    const interval = setInterval(fetchRecentDecks, 30000);
    return () => clearInterval(interval);
  }, []);

  // Use site-wide decks, fallback to local decks
  const decks = siteDecks.length > 0 ? siteDecks : (localDecks || []);

  if (decks.length === 0) {
    return (
      <div className="sticky top-0 z-50 w-full bg-stone-800 text-stone-400 h-10 flex items-center justify-center text-sm">
        No decks generated yet. Be the first!
      </div>
    );
  }

  // Double the items for seamless loop
  const items = [...decks, ...decks];

  return (
    <div
      className="sticky top-0 z-50 w-full bg-stone-800 h-10 overflow-hidden"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div
        ref={containerRef}
        className={`flex items-center h-full whitespace-nowrap ${isPaused ? 'animate-pause' : 'animate-marquee'}`}
        style={{
          animationPlayState: isPaused ? 'paused' : 'running',
        }}
      >
        {items.map((deck, index) => (
          <Link
            key={`${deck.id}-${index}`}
            to={`/deck/${deck.id}`}
            onClick={(e) => {
              if (onSelect) {
                e.preventDefault();
                onSelect(deck.id);
              }
            }}
            className="inline-flex items-center gap-2 px-4 text-sm text-stone-300 hover:text-white transition-colors"
          >
            <span className="flex gap-0.5">
              {deck.colors.map((color, i) => (
                <span
                  key={`${color}-${i}`}
                  className={`w-4 h-4 rounded-full text-xs font-medium flex items-center justify-center ${colorStyles[color] || 'bg-gray-400'}`}
                >
                  {color}
                </span>
              ))}
            </span>
            <span className="font-serif italic">{deck.commander}</span>
            <span className="text-stone-500">just generated</span>
            <span className="text-stone-500 mx-2">|</span>
          </Link>
        ))}
      </div>

      <style>{`
        @keyframes marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .animate-marquee {
          animation: marquee 60s linear infinite;
        }
        .animate-pause {
          animation: marquee 60s linear infinite;
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
