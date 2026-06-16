import type { LegalAction, PermanentView, YouView } from '../gameView.types';
import { PermanentTile } from './PermanentTile';

export interface PlayerBoardProps {
  you: YouView;
  /** Committing a legal action on one of your permanents (deliberate). */
  onAction(action: LegalAction): void;
  /** Look-only: examine a permanent by id (free + reversible, never commits). */
  onExamine(id: string): void;
}

interface BoardRowProps {
  testid: string;
  label: string;
  permanents: PermanentView[];
  onAction(action: LegalAction): void;
  onExamine(id: string): void;
}

/**
 * One labeled battlefield row (lands / creatures / other).
 *
 * The tiles live in a horizontally-scrollable, wrapping strip: on desktop they
 * wrap onto multiple lines (flex-wrap) so the whole board is visible; on mobile
 * the row stays a single thumb-swipe scroll strip (overflow-x-auto). Either way
 * the row is a normal in-flow block — it never floats over the interactive
 * layer, which is the dock-collision bug class this rebuild is killing.
 */
function BoardRow({ testid, label, permanents, onAction, onExamine }: BoardRowProps) {
  return (
    <section
      data-testid={testid}
      aria-label={label}
      className="min-w-0"
    >
      <div className="mb-1 flex items-baseline gap-2 px-1">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
          {label}
        </h3>
        <span
          data-testid={`${testid}-count`}
          className="text-[10px] font-semibold tabular-nums text-stone-500"
        >
          {permanents.length}
        </span>
      </div>

      {permanents.length === 0 ? (
        <div className="flex h-24 items-center rounded-lg border border-dashed border-stone-700/60 px-3 text-[11px] font-medium uppercase tracking-wide text-stone-600 md:h-28">
          None
        </div>
      ) : (
        <div
          // wrap on wide screens, single-line swipe strip on narrow ones.
          className="flex gap-2 overflow-x-auto overflow-y-visible pb-1 md:flex-wrap md:overflow-x-visible"
        >
          {permanents.map((permanent) => (
            <PermanentTile
              key={permanent.id}
              permanent={permanent}
              onAction={onAction}
              onExamine={() => onExamine(permanent.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * PlayerBoard — your half of the battlefield.
 *
 * PURE / PRESENTATIONAL: props in (`you`), callbacks out (`onAction`,
 * `onExamine`). No engine/hook access, no legality or zone logic — `you`
 * already carries the partitioned `lands` / `creatures` / `other` arrays and
 * each permanent its own `legalActions` from the view-model.
 *
 * Layout: three labeled rows (lands, creatures, other permanents), each a
 * responsive strip of `PermanentTile`s. Nothing here is position:fixed; the
 * whole board is in normal flow so feeds/docks (rendered by the layout shell as
 * side rails) never sit over the interactive tiles.
 */
export function PlayerBoard({ you, onAction, onExamine }: PlayerBoardProps) {
  return (
    <div
      data-testid="player-board"
      aria-label="Your battlefield"
      className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-stone-700/60 bg-stone-900/40 p-2 md:p-3"
    >
      <BoardRow
        testid="lands-row"
        label="Lands"
        permanents={you.lands}
        onAction={onAction}
        onExamine={onExamine}
      />
      <BoardRow
        testid="creatures-row"
        label="Creatures"
        permanents={you.creatures}
        onAction={onAction}
        onExamine={onExamine}
      />
      <BoardRow
        testid="other-row"
        label="Other Permanents"
        permanents={you.other}
        onAction={onAction}
        onExamine={onExamine}
      />
    </div>
  );
}

export default PlayerBoard;
