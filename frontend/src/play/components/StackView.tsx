import type { StackItemView } from '../gameView.types';
import { CardImage } from '../../components/CardImage';
import { useCardHoverPreview } from './CardHoverPreview';

/** One stack entry. Its card thumbnail pops a large hover-preview (desktop) so you
 * can read the spell/ability that's resolving without leaving the stack. */
function StackItemRow({ item, onTop }: { item: StackItemView; onTop: boolean }) {
  const emphasised = item.resolvesNext;
  const hoverPreview = useCardHoverPreview(item.title);
  return (
    <li
      data-testid="stack-item"
      className={[
        'flex animate-fade-in items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors',
        emphasised
          ? 'border-amber-400/70 bg-amber-950/30 ring-1 ring-amber-400/30'
          : 'border-stone-700/60 bg-stone-950/40',
      ].join(' ')}
    >
      {hoverPreview.node}
      <div
        {...hoverPreview.bind}
        className="h-16 w-12 shrink-0 cursor-zoom-in overflow-hidden rounded-md bg-stone-800"
      >
        <CardImage cardName={item.title} size="small" showHoverZoom={false} className="h-full w-full" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-stone-100">{item.title}</span>
          {emphasised && (
            <span className="shrink-0 rounded-full border border-amber-400/60 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
              Resolves next
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-snug text-stone-300">{item.description}</p>
        <p className="mt-1 text-[11px] text-stone-400">
          Controlled by <span className="font-medium text-stone-300">{item.controllerName}</span>
          {onTop ? ' · on top' : ''}
        </p>
      </div>
    </li>
  );
}

export interface StackViewProps {
  stack: StackItemView[];
  guided: boolean;
  onRespond: () => void;
  onLetResolve: () => void;
}

/**
 * Learning-grade view of the spell/ability stack.
 *
 * Pure / presentational: it renders exactly what the view-model hands it and
 * dispatches the two priority decisions back out as callbacks. No engine, hook,
 * or game-logic access.
 *
 * Layout note (this is the bug class the redesign fixes): this renders as a
 * normal in-flow panel meant to live in a side rail / center column. It uses NO
 * position:fixed and never floats over the board's interactive layer.
 */
export function StackView({ stack, guided, onLetResolve }: StackViewProps) {
  const isEmpty = stack.length === 0;

  // Idle: the stack is "always visible" per the spec, but as a low-profile chip
  // — not a screen-dominating empty box. It expands to the full panel only when
  // something is actually on the stack.
  if (isEmpty) {
    return (
      <div
        aria-label="The stack"
        className="flex w-full items-center gap-2 rounded-lg border border-stone-700/40 bg-stone-900/60 px-3 py-1.5 ring-1 ring-stone-700/40"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Stack</span>
        <span className="text-[11px] text-stone-400">empty</span>
      </div>
    );
  }

  return (
    <section
      aria-label="The stack"
      className="flex w-full flex-col gap-2 rounded-xl border border-amber-500/40 bg-gradient-to-b from-stone-900/90 to-neutral-950/90 p-3 text-stone-100 shadow-lg shadow-black/40 ring-1 ring-amber-500/10"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="font-serif text-sm font-bold tracking-tight text-amber-200/90">
          The Stack
        </h2>
        <span className="text-[11px] tabular-nums text-stone-400">
          {stack.length} {stack.length === 1 ? 'item' : 'items'}
        </span>
      </header>

      <>
          {guided && (
            <p className="rounded-md border border-amber-500/25 bg-amber-950/30 px-2.5 py-1.5 text-[11px] leading-snug text-amber-100/90">
              Last in, first out: the item on top resolves first, before anything
              beneath it.
            </p>
          )}

          {/* Top-first list. The view-model orders the array so index 0 is the
              top of the stack (resolves next). */}
          <ol className="flex flex-col gap-2" aria-label="Stack items, top first">
            {stack.map((item, index) => (
              <StackItemRow key={item.id} item={item} onTop={index === 0} />
            ))}
          </ol>

          {/* Respond is not a one-click action — you respond by casting an instant
              or activating an ability (from your hand / board). So instead of an
              inert "Respond" button, teach the path and offer the one real action:
              let the top of the stack resolve (passes priority). */}
          <footer className="mt-1 flex items-center gap-3 border-t border-stone-700/50 pt-2">
            <p className="flex-1 text-[11px] leading-snug text-stone-400">
              To respond, cast an instant or activate an ability from your hand or
              board. Otherwise let the top of the stack resolve.
            </p>
            <button
              type="button"
              onClick={onLetResolve}
              className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-600/20 px-3 py-2 text-sm font-medium text-amber-100 transition-colors hover:bg-amber-600/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            >
              Let it resolve
            </button>
          </footer>
        </>
    </section>
  );
}

export default StackView;
