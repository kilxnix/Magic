import { useState } from 'react';
import { CardImage } from './CardImage';
import { RefreshCw } from 'lucide-react';

// Import types from the commander engine hook
import type { CardDefinition, CardInstance, ManaColor, CardFaceData } from '../hooks/useCommanderEngine';

const MANA_COLORS: Record<string, string> = {
  W: 'bg-amber-100 text-amber-800',
  U: 'bg-blue-100 text-blue-800',
  B: 'bg-gray-300 text-gray-800',
  R: 'bg-red-100 text-red-800',
  G: 'bg-green-100 text-green-800',
  C: 'bg-gray-100 text-gray-600',
};

interface CardDetailModalProps {
  cardDef: CardDefinition;
  card: CardInstance;
  cardFaces?: CardFaceData[] | null;
  onClose: () => void;
}

function ManaCostBadges({ manaCost }: { manaCost: string }) {
  const symbols = manaCost.match(/\{([^}]+)\}/g) || [];
  if (symbols.length === 0) return null;
  return (
    <div className="flex gap-1 flex-wrap">
      {symbols.map((sym, i) => {
        const value = sym.slice(1, -1);
        const colorClass = MANA_COLORS[value as ManaColor] || 'bg-gray-200 text-gray-700';
        return (
          <span key={i} className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${colorClass}`}>
            {value}
          </span>
        );
      })}
    </div>
  );
}

export function CardDetailModal({ cardDef, card, cardFaces, onClose }: CardDetailModalProps) {
  const counters = Object.entries(card.counters).filter(([, v]) => v > 0);
  const [showingBack, setShowingBack] = useState(false);

  const isFlipCard = cardFaces && cardFaces.length > 1;
  const activeFace = isFlipCard && showingBack ? cardFaces[1] : null;

  // For the image: DFC card names are "Front // Back"
  // Scryfall needs the full name + &face=back for the back face
  const displayName = activeFace ? activeFace.name : cardDef.name;
  const displayTypeLine = activeFace ? activeFace.type_line : cardDef.type_line;
  const displayOracleText = activeFace ? activeFace.oracle_text : cardDef.oracle_text;
  const displayManaCost = activeFace ? activeFace.mana_cost : cardDef.mana_cost;
  const displayPower = activeFace ? (activeFace.power ?? undefined) : cardDef.power;
  const displayToughness = activeFace ? (activeFace.toughness ?? undefined) : cardDef.toughness;

  // For image: use the full card name (with //) so Scryfall can find it
  const imageCardName = cardDef.name;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-amber-600/50 rounded-xl shadow-2xl max-w-2xl w-full mx-4 flex overflow-hidden max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Card Image */}
        <div className="w-64 flex-shrink-0 bg-slate-900 p-4 flex flex-col items-center justify-center gap-3">
          <CardImage
            cardName={imageCardName}
            face={showingBack ? 'back' : undefined}
            className="w-full aspect-[5/7]"
            showHoverZoom={false}
          />
          {isFlipCard && (
            <button
              onClick={() => setShowingBack(!showingBack)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 hover:bg-amber-600 rounded text-xs font-medium text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {showingBack ? 'Show Front' : 'Flip Card'}
            </button>
          )}
        </div>

        {/* Right: Card Details */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          {/* Face indicator for DFCs */}
          {isFlipCard && (
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">
              {showingBack ? 'Back Face' : 'Front Face'}
            </div>
          )}

          {/* Name + Cost */}
          <div>
            <h2 className="text-xl font-bold text-amber-400">{displayName}</h2>
            {displayManaCost && (
              <div className="mt-1">
                <ManaCostBadges manaCost={displayManaCost} />
              </div>
            )}
          </div>

          {/* Type Line */}
          <div className="text-sm text-slate-300 border-b border-slate-700 pb-2">
            {displayTypeLine}
          </div>

          {/* Oracle Text */}
          {displayOracleText && (
            <div className="text-sm text-slate-200 whitespace-pre-line leading-relaxed">
              {displayOracleText}
            </div>
          )}

          {/* Power/Toughness */}
          {displayPower !== undefined && displayToughness !== undefined && (
            <div className="text-sm">
              <span className="text-slate-400">Power/Toughness: </span>
              <span className="font-bold text-amber-300">
                {(typeof displayPower === 'number' ? displayPower : parseInt(displayPower) || 0) + (card.counters['+1/+1'] || 0)}/
                {(typeof displayToughness === 'number' ? displayToughness : parseInt(displayToughness) || 0) + (card.counters['+1/+1'] || 0)}
              </span>
              {(card.counters['+1/+1'] || 0) > 0 && (
                <span className="text-green-400 text-xs ml-1">
                  (base {displayPower}/{displayToughness} + {card.counters['+1/+1']} counters)
                </span>
              )}
            </div>
          )}

          {/* Keywords (only on front face view) */}
          {!showingBack && cardDef.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {cardDef.keywords.map((kw) => (
                <span key={kw} className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded text-xs">
                  {kw}
                </span>
              ))}
            </div>
          )}

          {/* Current State (only on front face view) */}
          {!showingBack && (
            <div className="border-t border-slate-700 pt-3 space-y-1 text-xs">
              <div className="text-slate-500 uppercase tracking-wider font-semibold mb-1">State</div>
              <div className="text-slate-400">
                Zone: <span className="text-slate-200">{card.zone}</span>
              </div>
              {card.tapped && (
                <div className="text-orange-400">Tapped</div>
              )}
              {card.summoningSick && (
                <div className="text-yellow-400">Summoning Sick</div>
              )}
              {card.damage > 0 && (
                <div className="text-red-400">Damage: {card.damage}</div>
              )}
              {counters.length > 0 && (
                <div className="text-green-400">
                  Counters: {counters.map(([name, count]) => `${count} ${name}`).join(', ')}
                </div>
              )}
              {card.isCommander && (
                <div className="text-amber-400">Commander</div>
              )}
              {card.isAttacking && (
                <div className="text-red-400">Attacking</div>
              )}
              {card.isBlocking && (
                <div className="text-blue-400">Blocking</div>
              )}
            </div>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="w-full py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm text-slate-300 mt-2"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
