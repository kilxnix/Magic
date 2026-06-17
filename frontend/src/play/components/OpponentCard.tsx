import type { OpponentGlance, OpponentFlag } from '../gameView.types';
import { CardImage } from '../../components/CardImage';

interface OpponentCardProps {
  glance: OpponentGlance;
  /** Tapping/clicking anywhere on the card opens the full explorable board. */
  onExplore(): void;
}

const FLAG_META: Record<OpponentFlag, { label: string; className: string }> = {
  'commander-out': {
    label: 'Commander out',
    // Commander on the field — violet accent, matches the old board's commander tint.
    className: 'border-violet-500/40 bg-violet-950/40 text-violet-100',
  },
  'table-threat': {
    label: 'Table threat',
    // Danger read — rose/red so it pops against the stone palette.
    className: 'border-rose-500/40 bg-rose-950/40 text-rose-100',
  },
};

/**
 * Collapsed opponent "glance" card (spec: collapsed-by-default, tap-to-explore).
 *
 * Surfaces the decision-relevant reads — life (prominent), hand size, OPEN MANA
 * (the single most important "can they respond?" read, emphasized amber when > 0),
 * and board threat (creatureCount · totalPower) — plus any flags and a contextual
 * note. The whole card is one tap target → onExplore.
 *
 * Pure/presentational: props in, a single callback out. No engine/hook access.
 * It is a normal in-flow element (a <button>), never a fixed overlay, so it can
 * sit in the opponents strip without covering the board's interactive layer.
 */
export function OpponentCard({ glance, onExplore }: OpponentCardProps) {
  const {
    name,
    life,
    handCount,
    openMana,
    creatureCount,
    totalPower,
    commanderDamageToYou,
    flags,
    contextNote,
  } = glance;

  const hasOpenMana = openMana > 0;

  return (
    <button
      type="button"
      onClick={onExplore}
      aria-label={`Explore ${name}'s board`}
      data-testid="opponent-card"
      className="group flex w-full min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-rose-900/30 bg-gradient-to-b from-stone-800/85 to-neutral-950/80 px-3 py-2.5 text-left shadow-lg shadow-black/30 transition-all duration-200 will-change-transform hover:-translate-y-px hover:border-amber-400/60 hover:from-stone-700/85 hover:shadow-xl hover:shadow-black/40 active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
    >
      {/* Header: commander art + name + prominent life */}
      <div className="flex items-center gap-2">
        <CardImage
          cardName={name}
          size="small"
          showHoverZoom={false}
          className="h-12 w-9 shrink-0 overflow-hidden rounded border border-stone-600 bg-stone-900 [&_img]:object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-sm font-bold leading-tight text-stone-100">
            {name}
          </div>
          {commanderDamageToYou > 0 && (
            <div className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-rose-300">
              {commanderDamageToYou} cmd dmg to you
            </div>
          )}
        </div>
        <div className="shrink-0 text-right leading-none">
          <div className="text-2xl font-black tabular-nums text-stone-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
            {life}
          </div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-stone-400">life</div>
        </div>
      </div>

      {/* Reads row: hand · open mana (emphasized) · threat */}
      <div className="flex items-stretch gap-1.5">
        <Stat label="Hand" value={handCount} />
        <Stat
          label="Mana"
          value={openMana}
          emphasis={hasOpenMana ? 'open-mana' : 'muted'}
          testId="open-mana-stat"
          title="Open (untapped) mana — can they respond?"
        />
        <Stat
          label="Threat"
          value={`${creatureCount}·${totalPower}`}
          title={`${creatureCount} creatures · ${totalPower} total power`}
        />
      </div>

      {/* Flags */}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {flags.map((flag) => (
            <span
              key={flag}
              data-testid={`flag-${flag}`}
              className={`rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ${FLAG_META[flag].className}`}
            >
              {FLAG_META[flag].label}
            </span>
          ))}
        </div>
      )}

      {/* Contextual note (e.g. "2 untapped blockers") */}
      {contextNote && (
        <div className="truncate text-[11px] font-medium leading-snug text-stone-300">
          {contextNote}
        </div>
      )}
    </button>
  );
}

interface StatProps {
  label: string;
  value: string | number;
  /** 'open-mana' → amber/info emphasis; 'muted' → dimmed; undefined → neutral. */
  emphasis?: 'open-mana' | 'muted';
  title?: string;
  testId?: string;
}

function Stat({ label, value, emphasis, title, testId }: StatProps) {
  const emphasisClass =
    emphasis === 'open-mana'
      ? 'border-amber-500/45 bg-amber-950/40 text-amber-100'
      : emphasis === 'muted'
        ? 'border-stone-700 bg-neutral-900/60 text-stone-500'
        : 'border-stone-700 bg-neutral-900/60 text-stone-200';

  return (
    <span
      title={title}
      data-testid={testId}
      className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded border px-1.5 py-1 ${emphasisClass}`}
    >
      <span className="text-[9px] font-bold uppercase tracking-wider opacity-80">{label}</span>
      <span className="text-sm font-black tabular-nums leading-none">{value}</span>
    </span>
  );
}
