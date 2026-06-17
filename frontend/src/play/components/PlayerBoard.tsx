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

      {/* Felt table surface — a lit green table so empty space reads as a board,
          not a void: warm center light, vignetted edges, a faint top edge. */}
      <div className="relative flex min-h-[10rem] w-full min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-[1.25rem] border border-emerald-950/70 bg-[radial-gradient(120%_80%_at_50%_-5%,#214b3a_0%,#143025_48%,#0a1812_100%)] p-4 shadow-[inset_0_3px_30px_rgba(0,0,0,0.55),inset_0_0_70px_rgba(0,0,0,0.4),0_1px_0_rgba(125,205,165,0.08)] ring-1 ring-inset ring-emerald-300/[0.05]">
        {boardEmpty ? (
          <div
            data-testid="board-empty"
            className="flex flex-1 flex-col items-center justify-center gap-1 text-center"
          >
            <span aria-hidden className="text-2xl opacity-30">🜨</span>
            <span className="text-xs font-medium text-emerald-200/40">
              Your battlefield is empty — play a land to begin.
            </span>
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
