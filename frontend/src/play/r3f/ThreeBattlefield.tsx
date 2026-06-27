import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ACESFilmicToneMapping, type PerspectiveCamera as ThreePerspectiveCamera } from 'three';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import type { DesktopBattlefieldProps } from '../shells/DesktopBattlefield';
import type { CardView, GameView } from '../gameView.types';
import { BattlefieldScene } from './BattlefieldScene';
import { HandDock } from './HandDock';
import { SeatHudOverlay } from './SeatHudOverlay';
import { buildObjectIndex, toCardView } from './interaction';
import type { CameraPose } from './projection';
import { defaultPose, focusPose, lerpPose, easeInOut } from './cameraPoses';
import { PhaseTrackV2 } from '../v2/components/PhaseTrackV2';
import { PriorityControlsV2 } from '../v2/components/PriorityControlsV2';
import { TargetingLayerV2 } from '../v2/components/TargetingLayerV2';
import { CombatFlowV2 } from '../v2/components/CombatFlowV2';
import { NarrationFeedV2 } from '../v2/components/NarrationFeedV2';
import { CardViewerV2 } from '../v2/components/CardViewerV2';
import { ZoneExplorerV2 } from '../v2/components/ZoneExplorerV2';
import type { ZoneKind } from './zonePlacements';

/**
 * Selecting a 3D object opens the existing DOM action menu (CardViewerV2) for it.
 * Extracted as a hook so the selection→viewer wiring is unit-testable without a
 * real WebGL canvas (the 3D click path itself is covered by CardMesh's tests).
 */
export function useSelectionViewer(view: GameView): {
  viewer: CardView | null;
  select(id: string): void;
  inspect(card: CardView): void;
  clear(): void;
} {
  const [viewer, setViewer] = useState<CardView | null>(null);
  const index = useMemo(() => buildObjectIndex(view), [view]);
  const select = useCallback(
    (id: string) => {
      const entry = index.get(id);
      if (entry) setViewer(toCardView(entry));
    },
    [index],
  );
  // Open the viewer for a CardView we already hold (e.g. a graveyard/exile card
  // picked from the zone browser), bypassing the battlefield object index.
  const inspect = useCallback((card: CardView) => setViewer(card), []);
  const clear = useCallback(() => setViewer(null), []);
  return { viewer, select, inspect, clear };
}

/** Drives the live <Canvas> camera from a pose; invalidates so demand-mode repaints. */
function CameraRig({ pose }: { pose: CameraPose }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    const persp = camera as ThreePerspectiveCamera;
    if (persp.isPerspectiveCamera) {
      persp.fov = pose.fov;
      persp.updateProjectionMatrix();
    }
    invalidate();
  }, [camera, pose, invalidate]);
  return null;
}

/**
 * Owns the focused-seat state and the smooth swing between the table view and a
 * seat close-up. Returns the live (animated) pose plus focus controls. The pose
 * feeds BOTH the Canvas camera (via CameraRig) and the DOM HUD projection, so they
 * never drift apart during the animation.
 */
function useFocusCamera(seats: number): {
  pose: CameraPose;
  focusedSeat: number | null;
  focusSeat: (seatIndex: number) => void;
  resetView: () => void;
} {
  const base = useMemo(() => defaultPose(seats), [seats]);
  const [focusedSeat, setFocusedSeat] = useState<number | null>(null);
  const targetPose = useMemo(
    () => (focusedSeat != null && focusedSeat < seats ? focusPose(focusedSeat, seats) : base),
    [focusedSeat, base, seats],
  );
  const [pose, setPose] = useState<CameraPose>(base);
  const poseRef = useRef<CameraPose>(base);

  useEffect(() => {
    const from = poseRef.current;
    const start = typeof performance !== 'undefined' ? performance.now() : 0;
    const DURATION = 650;
    let raf = 0;
    const tick = (now: number) => {
      const t = DURATION <= 0 ? 1 : Math.min(1, (now - start) / DURATION);
      const next = lerpPose(from, targetPose, easeInOut(t));
      poseRef.current = next;
      setPose(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [targetPose]);

  const focusSeat = useCallback((seatIndex: number) => setFocusedSeat(seatIndex), []);
  const resetView = useCallback(() => setFocusedSeat(null), []);
  return { pose, focusedSeat, focusSeat, resetView };
}

/** Track a DOM element's pixel size (for projecting WebGL world points to overlay px). */
function useElementSize(): [React.RefObject<HTMLDivElement>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export function ThreeBattlefield(props: DesktopBattlefieldProps) {
  const { view } = props;
  const { viewer, select: handleSelect, inspect, clear } = useSelectionViewer(view);
  const [rootRef, size] = useElementSize();
  const [zoneTarget, setZoneTarget] = useState<{ playerId: string; zone: ZoneKind } | null>(null);
  const browseZone = useCallback(
    (playerId: string, zone: ZoneKind) => setZoneTarget({ playerId, zone }),
    [],
  );

  const seats = 1 + view.opponents.length;
  const { pose, focusedSeat, focusSeat, resetView } = useFocusCamera(seats);
  const initialPose = useMemo(() => defaultPose(seats), [seats]);

  // Escape returns from a seat close-up to the table view.
  useEffect(() => {
    if (focusedSeat == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resetView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedSeat, resetView]);

  return (
    <div ref={rootRef} data-testid="three-battlefield" className="relative h-full w-full bg-black">
      <Canvas
        shadows
        dpr={[1, 2]}
        frameloop="demand"
        camera={{ position: initialPose.position, fov: initialPose.fov }}
        gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
      >
        <CameraRig pose={pose} />
        <BattlefieldScene view={view} onSelect={handleSelect} onBrowseZone={browseZone} />
        <HandDock hand={view.you.hand} onSelect={handleSelect} />
        <EffectComposer>
          <Bloom intensity={0.6} luminanceThreshold={0.55} luminanceSmoothing={0.2} mipmapBlur />
        </EffectComposer>
      </Canvas>

      {/* Per-seat floating life/info badges; clicking an opponent's badge swings the
          camera to face their board. */}
      <SeatHudOverlay view={view} pose={pose} width={size.width} height={size.height} onFocus={focusSeat} />

      {/* Return-to-table control, shown only while focused on a seat. */}
      {focusedSeat != null ? (
        <div className="pointer-events-auto absolute left-1/2 top-3 -translate-x-1/2">
          <button
            type="button"
            onClick={resetView}
            className="rounded-full border border-amber-300/60 bg-black/80 px-4 py-1.5 text-sm font-semibold text-amber-100 shadow-lg transition-colors hover:bg-black/95 hover:border-amber-200"
          >
            ← Back to table
          </button>
        </div>
      ) : null}

      {/* DOM overlay — controls + readouts live here, not in WebGL. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute left-3 top-3">
          <PhaseTrackV2 priority={view.priority} />
          <PriorityControlsV2
            priority={view.priority}
            alwaysStop={props.alwaysStop}
            onPass={props.onPass}
            onHold={props.onHold}
            onToggleAlwaysStop={props.onToggleAlwaysStop}
          />
        </div>
        <div className="pointer-events-auto absolute right-3 top-3 max-w-xs max-h-[40vh] overflow-hidden">
          <NarrationFeedV2 narration={view.narration} />
        </div>
        <div className="pointer-events-auto absolute inset-x-0 bottom-3 flex flex-col items-center gap-2">
          <TargetingLayerV2
            targeting={view.targeting}
            onToggleTarget={props.onToggleTarget}
            onConfirm={props.onConfirmTarget}
            onCancel={props.onCancelTarget}
          />
          <CombatFlowV2
            combat={view.combat}
            selectedDefenderId={props.selectedDefenderId}
            onAssign={props.onAssignCombat}
            onConfirm={props.onConfirmCombat}
            onSkip={props.onSkipCombat}
            onSelectDefender={props.onSelectDefender}
          />
        </div>
      </div>

      {/* Tapping a graveyard/library/exile pile opens the DOM zone browser; picking
          a card there routes through inspect() into the same action viewer. */}
      {zoneTarget ? (
        <ZoneExplorerV2
          view={view}
          target={zoneTarget}
          onClose={() => setZoneTarget(null)}
          onView={(cv) => {
            setZoneTarget(null);
            inspect(cv);
          }}
        />
      ) : null}

      {viewer ? (
        <CardViewerV2
          card={viewer}
          onClose={clear}
          onAction={(a) => {
            props.onAction(a);
            clear();
          }}
        />
      ) : null}
    </div>
  );
}

export default ThreeBattlefield;
