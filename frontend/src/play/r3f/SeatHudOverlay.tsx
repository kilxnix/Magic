import { useMemo } from 'react';
import type { GameView } from '../gameView.types';
import { seatHuds, type SeatHud } from './seatHud';
import { makeProjector, type CameraPose } from './projection';

/** Compact floating badge: name, life, hand size, threat, open mana, commander-damage warning. */
function HudBadge({ hud, onFocus }: { hud: SeatHud; onFocus?: (seatIndex: number) => void }) {
  const threatened = hud.flags.includes('table-threat');
  const ring = hud.isOwn
    ? 'border-emerald-400/70'
    : threatened
      ? 'border-rose-500/80'
      : 'border-amber-300/45';
  const clickable = !hud.isOwn && Boolean(onFocus);
  return (
    <div
      onClick={clickable ? () => onFocus!(hud.seatIndex) : undefined}
      className={`rounded-lg border ${ring} bg-black/75 px-2.5 py-1 text-center shadow-lg backdrop-blur-sm ${
        clickable ? 'pointer-events-auto cursor-pointer transition-colors hover:bg-black/90 hover:border-amber-200/80' : ''
      }`}
      style={{ width: 112 }}
    >
      <div className="truncate text-[11px] font-semibold tracking-wide text-amber-100/90">{hud.name}</div>
      <div className="flex items-baseline justify-center gap-1 leading-none">
        <span className="text-lg font-bold text-rose-200">{hud.life}</span>
        <span className="text-[9px] uppercase text-rose-300/60">life</span>
      </div>
      <div className="mt-0.5 flex items-center justify-center gap-2.5 text-[10px] text-slate-300">
        <span title="Cards in hand">✋&nbsp;{hud.handCount}</span>
        <span title="Total creature power" className={hud.threat > 0 ? 'text-amber-200' : ''}>
          ⚔&nbsp;{hud.threat}
        </span>
        {hud.openMana > 0 ? <span title="Open mana" className="text-sky-300">◆&nbsp;{hud.openMana}</span> : null}
      </div>
      {hud.commanderDamageToYou > 0 ? (
        <div className="mt-0.5 text-[10px] font-semibold text-orange-300">CMDR {hud.commanderDamageToYou}/21</div>
      ) : null}
    </div>
  );
}

/**
 * Floats a per-seat life/info badge over each player's board. Lives in the DOM
 * overlay (not WebGL) and positions each badge by projecting its seat's world
 * anchor through the SAME camera pose the <Canvas> renders with, so badges track
 * their boards. `onFocus` makes opponent badges the tap-to-focus entry point.
 */
export function SeatHudOverlay({
  view,
  pose,
  width,
  height,
  onFocus,
}: {
  view: GameView;
  pose: CameraPose;
  width: number;
  height: number;
  onFocus?: (seatIndex: number) => void;
}) {
  const huds = useMemo(() => seatHuds(view), [view]);
  const project = useMemo(() => makeProjector(pose, width, height), [pose, width, height]);
  if (width <= 0 || height <= 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {huds.map((h) => {
        const p = project(h.position);
        if (p.behind) return null;
        return (
          <div
            key={h.seatIndex}
            className="absolute"
            style={{ left: p.x, top: p.y, transform: 'translate(-50%, -60%)' }}
          >
            <HudBadge hud={h} onFocus={onFocus} />
          </div>
        );
      })}
    </div>
  );
}

export default SeatHudOverlay;
