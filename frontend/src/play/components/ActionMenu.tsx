import type { LegalAction } from '../gameView.types';
import { CardImage } from '../../components/CardImage';
import { cn } from '../../lib/utils';

export interface ActionMenuProps {
  actions: LegalAction[];
  /**
   * Guided mode also surfaces actions the engine reports as currently illegal,
   * rendered muted + non-clickable with their `whyDisabled` reason so learners
   * can see *why* a line isn't available. Off → only enabled actions render.
   */
  guided: boolean;
  onPick(action: LegalAction): void;
}

function isEnabled(action: LegalAction): boolean {
  return !action.whyDisabled;
}

/**
 * ActionMenu — a small popover listing one row per legal action.
 *
 * PURE / PRESENTATIONAL: props in, `onPick` out. No engine access, no legality
 * logic — the view-model already decided which actions exist and which are
 * disabled (via `whyDisabled`). This is NOT a fixed-position overlay; it renders
 * inline where the caller anchors it (next to the tapped object) so it never
 * floats over the board's interactive layer.
 */
export function ActionMenu({ actions, guided, onPick }: ActionMenuProps) {
  // In non-guided mode, hide disabled actions entirely; in guided mode keep them
  // so the player learns why a line is unavailable right now.
  const rows = guided ? actions : actions.filter(isEnabled);

  if (rows.length === 0) {
    return (
      <div
        role="menu"
        aria-label="Actions"
        className="min-w-44 max-w-72 rounded-lg border border-stone-600/70 bg-neutral-950 p-2 text-center text-xs font-semibold text-stone-500 shadow-2xl shadow-black/50"
      >
        No actions available
      </div>
    );
  }

  return (
    <div
      role="menu"
      aria-label="Actions"
      className="min-w-44 max-w-72 overflow-hidden rounded-lg border border-amber-500/35 bg-neutral-950 p-1 shadow-2xl shadow-black/50"
    >
      {rows.map((action, idx) => {
        const enabled = isEnabled(action);
        const cardName = action.source.cardName;
        const costHint = action.source.paymentPreview;

        return (
          <button
            key={`${action.kind}-${action.source.cardInstanceId ?? action.label}-${idx}`}
            type="button"
            role="menuitem"
            // Disabled rows are inert (guided-mode teaching rows). React already
            // suppresses onClick on a disabled <button>; we double-guard anyway.
            disabled={!enabled}
            onClick={enabled ? () => onPick(action) : undefined}
            aria-disabled={!enabled}
            title={action.whyDisabled || action.label}
            className={cn(
              'group flex w-full min-h-10 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
              enabled
                ? 'cursor-pointer text-stone-100 hover:bg-stone-800 focus:bg-stone-800 focus:outline-none'
                : 'cursor-not-allowed text-stone-500',
            )}
          >
            {cardName && (
              <span className="h-9 w-7 shrink-0 overflow-hidden rounded-sm bg-stone-200">
                <CardImage
                  cardName={cardName}
                  size="small"
                  showHoverZoom={false}
                  className={cn('h-full w-full', enabled ? '' : 'opacity-40 grayscale')}
                />
              </span>
            )}

            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  'truncate text-sm font-bold leading-tight',
                  !enabled && 'opacity-70',
                )}
              >
                {action.label}
              </span>

              {enabled && costHint && (
                <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-amber-300/80">
                  {costHint}
                </span>
              )}

              {!enabled && action.whyDisabled && (
                <span className="truncate text-[10px] font-medium leading-tight text-stone-500">
                  {action.whyDisabled}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default ActionMenu;
