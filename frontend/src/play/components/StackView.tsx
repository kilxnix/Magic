import type { StackItemView } from '../gameView.types';
import { CardImage } from '../../components/CardImage';

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
export function StackView({ stack, guided, onRespond, onLetResolve }: StackViewProps) {
  const isEmpty = stack.length === 0;

  return (
    <section
      aria-label="The stack"
      className="flex w-full flex-col gap-2 rounded-xl border border-stone-700/70 bg-stone-900/80 p-3 text-stone-100 shadow-lg"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-200/90">
          The Stack
        </h2>
        {!isEmpty && (
          <span className="text-[11px] tabular-nums text-stone-400">
            {stack.length} {stack.length === 1 ? 'item' : 'items'}
          </span>
        )}
      </header>

      {isEmpty ? (
        <p className="rounded-lg border border-dashed border-stone-700/60 bg-stone-950/40 px-3 py-6 text-center text-sm text-stone-400">
          The stack is empty.
        </p>
      ) : (
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
            {stack.map((item, index) => {
              const emphasised = item.resolvesNext;
              return (
                <li
                  key={item.id}
                  data-testid="stack-item"
                  className={[
                    'flex items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors',
                    emphasised
                      ? 'border-amber-400/70 bg-amber-950/30 ring-1 ring-amber-400/30'
                      : 'border-stone-700/60 bg-stone-950/40',
                  ].join(' ')}
                >
                  <div className="h-16 w-12 shrink-0 overflow-hidden rounded-md bg-stone-800">
                    <CardImage
                      cardName={item.title}
                      size="small"
                      showHoverZoom={false}
                      className="h-full w-full"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-stone-100">
                        {item.title}
                      </span>
                      {emphasised && (
                        <span className="shrink-0 rounded-full border border-amber-400/60 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                          Resolves next
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-stone-300">
                      {item.description}
                    </p>
                    <p className="mt-1 text-[11px] text-stone-400">
                      Controlled by{' '}
                      <span className="font-medium text-stone-300">
                        {item.controllerName}
                      </span>
                      {index === 0 ? ' · on top' : ''}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>

          <footer className="mt-1 flex gap-2 border-t border-stone-700/50 pt-2">
            <button
              type="button"
              onClick={onRespond}
              className="flex-1 rounded-lg border border-amber-500/40 bg-amber-600/20 px-3 py-2 text-sm font-medium text-amber-100 transition-colors hover:bg-amber-600/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            >
              Respond
            </button>
            <button
              type="button"
              onClick={onLetResolve}
              className="flex-1 rounded-lg border border-stone-600/60 bg-stone-800/70 px-3 py-2 text-sm font-medium text-stone-200 transition-colors hover:bg-stone-700/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/50"
            >
              Let it resolve
            </button>
          </footer>
        </>
      )}
    </section>
  );
}

export default StackView;
