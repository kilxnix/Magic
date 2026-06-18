import { useRef, useState } from 'react';
import type { LegalAction, PermanentView, YouView } from '../gameView.types';
import { ActionMenu } from './ActionMenu';
import { AnchoredMenu } from './AnchoredMenu';
import { useValueFlash } from './useValueFlash';
import { cn } from '../../lib/utils';

export interface YouHudProps {
  you: YouView;
  /** Commit a legal action (e.g. cast your commander from the command zone). */
  onAction(action: LegalAction): void;
  /** Look-only: examine a command-zone card. */
  onExamine(id: string): void;
}

// Mana-pip palette by color symbol (WUBRG + colorless).
const PIP: Record<keyof YouView['manaPool'], { bg: string; text: string }> = {
  W: { bg: 'bg-amber-50', text: 'text-stone-900' },
  U: { bg: 'bg-sky-400', text: 'text-neutral-950' },
  B: { bg: 'bg-stone-700', text: 'text-stone-100' },
  R: { bg: 'bg-rose-500', text: 'text-neutral-950' },
  G: { bg: 'bg-emerald-500', text: 'text-neutral-950' },
  C: { bg: 'bg-stone-400', text: 'text-neutral-950' },
};
const PIP_ORDER: (keyof YouView['manaPool'])[] = ['W', 'U', 'B', 'R', 'G', 'C'];

/** One command-zone card: tap → menu of its legal actions (cast your commander). */
function CommanderChip({
  card,
  onAction,
  onExamine,
}: {
  card: PermanentView;
  onAction(action: LegalAction): void;
  onExamine(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const hasActions = card.legalActions.length > 0;

  return (
    <>
      <button
        ref={ref}
        type="button"
        data-testid="commander-chip"
        onClick={() => (hasActions ? setOpen((o) => !o) : onExamine(card.id))}
        aria-haspopup={hasActions ? 'menu' : undefined}
        aria-expanded={hasActions ? open : undefined}
        title={card.name}
        className={cn(
          'flex min-h-8 items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-all duration-200',
          hasActions
            ? 'border-amber-400/60 bg-amber-500/15 shadow-[0_0_14px_rgba(251,191,36,0.18)] hover:-translate-y-px hover:bg-amber-500/25 hover:shadow-[0_0_18px_rgba(251,191,36,0.3)]'
            : 'border-stone-600/70 bg-stone-800/70 hover:bg-stone-700/70',
        )}
      >
        <span aria-hidden className="text-[11px] leading-none text-amber-300">
          ♛
        </span>
        <span className="max-w-[8rem] truncate text-xs font-bold text-stone-100">{card.name}</span>
        {hasActions && (
          <span className="rounded bg-amber-400 px-1 text-[9px] font-black uppercase text-neutral-950">
            Cast
          </span>
        )}
      </button>

      <AnchoredMenu anchorRef={ref} open={open} onClose={() => setOpen(false)} placement="top">
        <ActionMenu
          actions={card.legalActions}
          guided={false}
          onPick={(action) => {
            onAction(action);
            setOpen(false);
          }}
        />
      </AnchoredMenu>
    </>
  );
}

/**
 * YouHud — your vitals bar: life, poison, floating mana, command zone
 * (your commander, castable), and graveyard/library counts. This is the
 * "surface the engine's power" read for your own side — none of it was rendered
 * before, which is a big part of why the board read as a wireframe.
 *
 * PURE / PRESENTATIONAL: derives nothing; renders the enriched YouView.
 */
export function YouHud({ you, onAction, onExamine }: YouHudProps) {
  const pips = PIP_ORDER.filter((c) => you.manaPool[c] > 0);
  const lifeFlash = useValueFlash(you.life);

  return (
    <div
      data-testid="you-hud"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-emerald-900/30 bg-gradient-to-b from-stone-900/70 to-neutral-950/75 px-3.5 py-2.5 shadow-lg shadow-black/30"
    >
      {/* Life + poison */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">You</span>
        <span
          data-testid="you-life"
          key={you.life}
          className={cn(
            'inline-block text-2xl font-black leading-none text-emerald-300 drop-shadow-[0_0_10px_rgba(16,185,129,0.45)]',
            lifeFlash === 'down' && 'text-rose-300',
            lifeFlash && 'animate-value-flash',
          )}
        >
          {you.life}
        </span>
        <span className="text-[10px] font-semibold uppercase text-stone-400">life</span>
        {you.poison > 0 && (
          <span className="ml-1 rounded bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200 ring-1 ring-emerald-400/40">
            ☠ {you.poison}
          </span>
        )}
        {you.maxCommanderDamageTaken > 0 && (
          <span
            title="Highest commander damage taken (lethal at 21)"
            className={cn(
              'ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
              you.maxCommanderDamageTaken >= 15
                ? 'animate-soft-pulse bg-rose-950/80 text-rose-200 ring-1 ring-rose-400/60'
                : 'bg-rose-950/60 text-rose-200/90 ring-1 ring-rose-400/30',
            )}
          >
            ⚔ {you.maxCommanderDamageTaken}/21
          </span>
        )}
      </div>

      {/* Floating mana pool */}
      <div className="flex items-center gap-1" aria-label="Mana pool">
        {pips.length === 0 ? (
          <span className="text-[10px] font-medium uppercase tracking-wide text-stone-400">
            no mana
          </span>
        ) : (
          pips.map((c) => (
            <span
              key={`${c}-${you.manaPool[c]}`}
              data-testid={`mana-${c}`}
              className={cn(
                'flex h-5 min-w-5 animate-tile-in items-center justify-center rounded-full px-1 text-[11px] font-black tabular-nums ring-1 ring-black/15 shadow-[inset_0_1px_1px_rgba(255,255,255,0.55),inset_0_-1px_1px_rgba(0,0,0,0.25),0_1px_2px_rgba(0,0,0,0.45)]',
                PIP[c].bg,
                PIP[c].text,
              )}
            >
              {you.manaPool[c]}
              {c === 'C' ? '◇' : c}
            </span>
          ))
        )}
      </div>

      {/* Command zone — your commander(s), castable */}
      {you.commandZone.length > 0 && (
        <div className="flex items-center gap-1.5" aria-label="Command zone">
          {you.commandZone.map((card) => (
            <CommanderChip key={card.id} card={card} onAction={onAction} onExamine={onExamine} />
          ))}
        </div>
      )}

      {/* Graveyard + library counts */}
      <div className="ml-auto flex items-center gap-3 text-[11px] font-semibold text-stone-400">
        <span data-testid="you-graveyard" title="Graveyard">
          <span className="text-stone-400">GY</span>{' '}
          <span key={you.graveyardCount} className="inline-block animate-tile-in tabular-nums">
            {you.graveyardCount}
          </span>
        </span>
        <span data-testid="you-library" title="Library">
          <span className="text-stone-400">Lib</span>{' '}
          <span key={you.libraryCount} className="inline-block animate-tile-in tabular-nums">
            {you.libraryCount}
          </span>
        </span>
      </div>
    </div>
  );
}

export default YouHud;
