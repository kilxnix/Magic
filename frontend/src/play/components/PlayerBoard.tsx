import type { LegalAction, PermanentView, YouView } from '../gameView.types';
import { PermanentTile } from './PermanentTile';
import { YouHud } from './YouHud';

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
 * One labeled battlefield row. Renders ONLY when it has permanents — empty
 * categories vanish entirely (no header, no placeholder box), matching the
 * original board. The tiles live in a wrapping strip on desktop / a thumb-swipe
 * scroll strip on mobile; always a normal in-flow block (never floats over the
 * interactive layer).
 */
function BoardRow({ testid, label, permanents, onAction, onExamine }: BoardRowProps) {
  if (permanents.length === 0) return null;
  return (
    <section data-testid={testid} aria-label={label} className="min-w-0">
      <div className="mb-1 flex items-baseline gap-2 px-1">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</h3>
        <span
          data-testid={`${testid}-count`}
          className="text-[10px] font-semibold tabular-nums text-stone-500"
        >
          {permanents.length}
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto overflow-y-visible pb-1 md:flex-wrap md:overflow-x-visible">
        {permanents.map((permanent) => (
          <PermanentTile
            key={permanent.id}
            permanent={permanent}
            onAction={onAction}
            onExamine={() => onExamine(permanent.id)}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * PlayerBoard — your half of the battlefield.
 *
 * PURE / PRESENTATIONAL: props in (`you`), callbacks out. No engine/hook access.
 *
 * Layout: a vitals HUD (life / mana / commander / graveyard / library) above a
 * felt table surface holding your permanent rows. Empty rows are hidden; an empty
 * board shows one quiet line, not three dashed "NONE" boxes. Nothing is
 * position:fixed — the whole board is in normal flow.
 */
export function PlayerBoard({ you, onAction, onExamine }: PlayerBoardProps) {
  const rows = [
    { testid: 'creatures-row', label: 'Creatures', permanents: you.creatures },
    { testid: 'artifacts-row', label: 'Artifacts', permanents: you.artifacts },
    { testid: 'enchantments-row', label: 'Enchantments', permanents: you.enchantments },
    { testid: 'lands-row', label: 'Lands', permanents: you.lands },
    { testid: 'other-row', label: 'Other Permanents', permanents: you.other },
  ];
  const boardEmpty = rows.every((r) => r.permanents.length === 0);

  return (
    <div
      data-testid="player-board"
      aria-label="Your battlefield"
      className="flex h-full w-full min-w-0 flex-col gap-3"
    >
      <YouHud you={you} onAction={onAction} onExamine={onExamine} />

      {/* Felt table surface — your permanents sit on it. */}
      <div className="flex min-h-[8rem] w-full min-w-0 flex-1 flex-col gap-3 rounded-2xl border border-emerald-900/40 bg-[radial-gradient(ellipse_at_top,_rgba(16,52,40,0.55),_rgba(8,12,10,0.85))] p-3 shadow-inner shadow-black/40">
        {boardEmpty ? (
          <div
            data-testid="board-empty"
            className="flex flex-1 items-center justify-center text-center text-xs font-medium text-stone-500"
          >
            Your battlefield is empty — play a land to begin.
          </div>
        ) : (
          rows.map((row) => (
            <BoardRow
              key={row.testid}
              testid={row.testid}
              label={row.label}
              permanents={row.permanents}
              onAction={onAction}
              onExamine={onExamine}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default PlayerBoard;
