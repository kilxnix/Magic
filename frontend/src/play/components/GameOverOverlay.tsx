import { createPortal } from 'react-dom';

export interface GameOverOverlayProps {
  /** Winner's display name; null → render nothing (game still in progress). */
  winnerName: string | null;
  /** True when the human is the winner (Victory) vs a loss (Defeat). */
  youWon: boolean;
  /** Dismiss the flourish to reveal the game-review modal underneath. */
  onReview(): void;
  /** Start a fresh game. */
  onPlayAgain(): void;
}

// ============================================================================
// GameOverOverlay — the Victory / Defeat flourish.
//
// A centered serif warm panel over a dim, blurred backdrop — the AAA game-end
// moment. PORTALED to document.body (above the shell and above the shared
// GameReview modal that PlayPage opens on game-over), so "Review game" simply
// dismisses this flourish to reveal that review underneath; "Play again" reloads.
//
// PURE / PRESENTATIONAL: props in, two callbacks out. It never touches the engine
// (the game is already over). Uses the established modal recipe (fade-in scrim +
// menu-in card, role="dialog" aria-modal). Reduced-motion degrades both animations
// via the global rule in index.css.
// ============================================================================
export function GameOverOverlay({ winnerName, youWon, onReview, onPlayAgain }: GameOverOverlayProps) {
  if (winnerName == null) return null;

  return createPortal(
    <div
      data-testid="play-game-over"
      role="dialog"
      aria-modal="true"
      aria-label={youWon ? 'Victory' : 'Defeat'}
      className="fixed inset-0 z-[120] flex animate-fade-in items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm animate-menu-in rounded-xl border border-amber-500/30 bg-gradient-to-b from-stone-900 to-neutral-950 p-7 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_60px_rgba(0,0,0,0.7)]">
        <h2
          className={`font-serif text-4xl font-black tracking-tight ${
            youWon
              ? 'text-emerald-400 drop-shadow-[0_0_18px_rgba(16,185,129,0.4)]'
              : 'text-rose-400 drop-shadow-[0_0_18px_rgba(244,63,94,0.35)]'
          }`}
        >
          {youWon ? 'Victory' : 'Defeat'}
        </h2>
        <p className="mt-2 text-sm text-stone-300">
          {youWon ? (
            <>You won the game.</>
          ) : (
            <>
              <span className="font-semibold text-stone-100">{winnerName}</span> won the game.
            </>
          )}
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            data-testid="game-over-play-again"
            onClick={onPlayAgain}
            className="min-h-11 rounded-lg border border-amber-400/70 bg-gradient-to-b from-amber-400 to-amber-500 px-4 py-2 text-sm font-black uppercase tracking-wide text-neutral-950 shadow-[0_4px_12px_rgba(251,191,36,0.25),inset_0_1px_0_rgba(255,255,255,0.4)] transition-all duration-150 hover:-translate-y-px hover:from-amber-300 hover:to-amber-400 active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80"
          >
            Play again
          </button>
          <button
            type="button"
            data-testid="game-over-review"
            onClick={onReview}
            className="min-h-10 rounded-lg border border-stone-600 bg-stone-800 px-4 py-2 text-sm font-bold text-stone-200 transition-colors hover:bg-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/50"
          >
            Review game
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default GameOverOverlay;
