import { ReactNode, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LiveRibbon } from '../components/LiveRibbon';
import { DeckHistory } from '../components/DeckHistory';
import { AdSlot } from '../components/AdSlot';
import { Deck } from '../types';
import { Menu, X } from 'lucide-react';

interface MainLayoutProps {
  children: ReactNode;
  history: Deck[];
  selectedDeckId: string | null;
  onSelectDeck: (deck: Deck) => void;
  showSideAd?: boolean;
  showBottomAd?: boolean;
}

export function MainLayout({
  children,
  history,
  selectedDeckId,
  onSelectDeck,
  showSideAd = false,
  showBottomAd = false,
}: MainLayoutProps) {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [selectedDeckId]);

  const handleViewDeck = (deckId: string) => {
    navigate(`/deck/${deckId}`);
  };

  return (
    <div className="flex flex-col min-h-screen bg-stone-50 text-stone-900 font-sans">
      {/* Marquee Ticker */}
      <LiveRibbon />

      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-3 border-b border-stone-200 bg-white">
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 text-stone-600 hover:text-stone-900"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <span className="font-serif text-stone-800">MTG Deck Generator</span>
        <div className="w-9" /> {/* Spacer for centering */}
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - History (Desktop) */}
        <aside className="hidden md:block w-64 flex-shrink-0 border-r border-stone-200 bg-stone-50 overflow-y-auto">
          <DeckHistory
            history={history}
            selectedId={selectedDeckId}
            onSelect={onSelectDeck}
            onViewFull={handleViewDeck}
          />
        </aside>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div
              className="fixed inset-0 bg-black/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <aside className="relative w-64 bg-white shadow-xl overflow-y-auto">
              <DeckHistory
                history={history}
                selectedId={selectedDeckId}
                onSelect={(deck) => {
                  onSelectDeck(deck);
                  setMobileMenuOpen(false);
                }}
                onViewFull={(id) => {
                  handleViewDeck(id);
                  setMobileMenuOpen(false);
                }}
              />
            </aside>
          </div>
        )}

        {/* Center Content */}
        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <div className="flex-1">
            {children}
          </div>

          {/* Bottom Ad (shown only when specified) */}
          {showBottomAd && (
            <div className="flex justify-center p-4 border-t border-stone-200 bg-stone-100">
              <AdSlot size="leaderboard" className="hidden md:flex" />
              <AdSlot size="mobileBanner" className="md:hidden" />
            </div>
          )}
        </main>

        {/* Right Sidebar - Ad (Desktop only) */}
        {showSideAd && (
          <aside className="hidden lg:flex flex-col items-center gap-4 p-4 w-[332px] flex-shrink-0 border-l border-stone-200 bg-stone-50">
            <AdSlot size="sidebar" />
            <div className="text-xs text-stone-400 text-center mt-2">
              Support the site by viewing ads
            </div>
          </aside>
        )}
      </div>

    </div>
  );
}
