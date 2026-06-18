import type { OpponentBoard, PermanentView } from '../gameView.types';
import { PermanentTile } from './PermanentTile';
import { cn } from '../../lib/utils';

export interface OpponentExplorerProps {
  board: OpponentBoard;
  /** Dismiss the explorer (look-only flow: closing is always free + reversible). */
  onClose(): void;
}

/**
 * OpponentExplorer — the full explorable opponent board (spec: tap-to-explore).
 *
 * Shows every permanent the opponent controls grouped into creatures / lands /
 * other, plus glanceable header reads (name, life, commander damage to you) and
 * chips for the hidden zones (graveyard / exile / command zone). Lands surface an
 * untapped count — the "can they respond / block?" read the spec emphasizes.
 *
 * PURE / PRESENTATIONAL: props in, a single `onClose` callback out. No engine/hook
 * access, no game logic. Exploring an opponent is look-only (free + reversible per
 * the look-vs-commit grammar), so the embedded PermanentTiles are inspect-only:
 * their action/examine callbacks are no-ops here — you can't commit actions on an
 * opponent's permanents from the explorer.
 *
 * NOT a fixed overlay. On desktop it renders as a faux-viewport panel: a normal
 * in-flow wrapper that fills its container (the board area) and an absolutely
 * positioned panel WITHIN that wrapper — anchored to the board, never `fixed`, so
 * it can never float over / collapse the board's interactive layer the way the old
 * docks did. On mobile it is simply full-width. The host decides where to mount it.
 */
export function OpponentExplorer({ board, onClose }: OpponentExplorerProps) {
  const { glance, creatures, lands, other, graveyardCount, exileCount, commandZone } = board;

  const untappedLands = lands.filter((land) => !land.tapped).length;

  return (
    // Faux-viewport wrapper: in normal flow, fills the board area. `absolute inset-0`
    // anchors to the nearest positioned ancestor (the board container) — NOT `fixed`.
    <div
      data-testid="opponent-explorer"
      className="absolute inset-0 z-30 flex min-h-[16rem] flex-col bg-stone-950/80 p-2 backdrop-blur-sm md:p-4"
    >
      {/* The panel itself — scrollable, capped on desktop, full-width on mobile. */}
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-stone-600 bg-stone-900 shadow-2xl shadow-black/60">
        {/* ── Header: name · life · commander dmg · close ───────────────────── */}
        <header className="flex shrink-0 items-center gap-3 border-b border-stone-700 bg-stone-800/80 px-3 py-2 md:px-4 md:py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-serif text-base font-bold leading-tight text-stone-100 md:text-lg">
              {glance.name}
            </div>
            {glance.commanderDamageToYou > 0 && (
              <div
                data-testid="explorer-commander-damage"
                className="mt-0.5 truncate text-[11px] font-bold uppercase tracking-wide text-rose-300"
              >
                {glance.commanderDamageToYou} commander damage to you
              </div>
            )}
          </div>

          <div className="shrink-0 text-right leading-none">
            <div
              data-testid="explorer-life"
              className="text-2xl font-black tabular-nums text-stone-50 md:text-3xl"
            >
              {glance.life}
            </div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-stone-400">
              life
            </div>
          </div>

          <button
            type="button"
            data-testid="explorer-close"
            aria-label={`Close ${glance.name}'s board`}
            title="Close"
            onClick={onClose}
            className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-stone-700 text-lg font-black leading-none text-stone-200 ring-1 ring-white/15 transition hover:bg-stone-600 hover:text-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80 md:h-9 md:w-9"
          >
            ×
          </button>
        </header>

        {/* ── Zone chips: command zone · graveyard · exile ──────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-stone-800 bg-stone-900/60 px-3 py-2 md:px-4">
          <ZoneChip
            testId="chip-command"
            label="Command"
            value={commandZone.length}
            accent="violet"
          />
          <ZoneChip
            testId="chip-graveyard"
            label="Graveyard"
            value={graveyardCount}
            accent="stone"
          />
          <ZoneChip testId="chip-exile" label="Exile" value={exileCount} accent="stone" />
        </div>

        {/* ── Battlefield zones ─────────────────────────────────────────────── */}
        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 md:px-4">
          <Zone
            testId="zone-command"
            title="Command zone"
            permanents={commandZone}
            empty="Command zone empty"
          />
          <Zone
            testId="zone-creatures"
            title="Creatures"
            count={creatures.length}
            permanents={creatures}
            empty="No creatures"
          />
          <Zone
            testId="zone-lands"
            title="Lands"
            // Untapped count is the key "open mana / can they respond?" read.
            subtitle={`${untappedLands} untapped`}
            count={lands.length}
            permanents={lands}
            empty="No lands"
          />
          <Zone
            testId="zone-other"
            title="Other"
            count={other.length}
            permanents={other}
            empty="No other permanents"
          />
        </div>
      </div>
    </div>
  );
}

interface ZoneProps {
  testId: string;
  title: string;
  subtitle?: string;
  count?: number;
  permanents: PermanentView[];
  empty: string;
}

function Zone({ testId, title, subtitle, count, permanents, empty }: ZoneProps) {
  return (
    <section data-testid={testId}>
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
          {title}
          {count !== undefined && (
            <span className="ml-1 tabular-nums text-stone-500">({count})</span>
          )}
        </h3>
        {subtitle && (
          <span
            data-testid={`${testId}-subtitle`}
            className="rounded bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200 ring-1 ring-amber-500/30"
          >
            {subtitle}
          </span>
        )}
      </div>

      {permanents.length === 0 ? (
        <div className="rounded-md border border-stone-700/40 bg-stone-950/40 px-2 py-2 text-[11px] italic text-stone-500">
          {empty}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {permanents.map((permanent) => (
            <PermanentTile
              key={permanent.id}
              permanent={permanent}
              // Look-only: exploring never commits an action on an opponent's board.
              onAction={() => {}}
              onExamine={() => {}}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface ZoneChipProps {
  testId: string;
  label: string;
  value: number;
  accent: 'violet' | 'stone';
}

function ZoneChip({ testId, label, value, accent }: ZoneChipProps) {
  return (
    <span
      data-testid={testId}
      className={cn(
        'flex items-baseline gap-1.5 rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider',
        accent === 'violet'
          ? 'border-violet-500/40 bg-violet-950/40 text-violet-100'
          : 'border-stone-700 bg-neutral-900/60 text-stone-300',
      )}
    >
      <span className="opacity-80">{label}</span>
      <span className="text-sm font-black tabular-nums leading-none">{value}</span>
    </span>
  );
}

export default OpponentExplorer;
