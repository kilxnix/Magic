import { useCallback, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ACESFilmicToneMapping } from 'three';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import type { DesktopBattlefieldProps } from '../shells/DesktopBattlefield';
import type { CardView, GameView } from '../gameView.types';
import { BattlefieldScene } from './BattlefieldScene';
import { HandDock } from './HandDock';
import { buildObjectIndex, toCardView } from './interaction';
import { SEAT_R } from './layout';
import { PhaseTrackV2 } from '../v2/components/PhaseTrackV2';
import { PriorityControlsV2 } from '../v2/components/PriorityControlsV2';
import { TargetingLayerV2 } from '../v2/components/TargetingLayerV2';
import { CombatFlowV2 } from '../v2/components/CombatFlowV2';
import { NarrationFeedV2 } from '../v2/components/NarrationFeedV2';
import { CardViewerV2 } from '../v2/components/CardViewerV2';

/**
 * Selecting a 3D object opens the existing DOM action menu (CardViewerV2) for it.
 * Extracted as a hook so the selection→viewer wiring is unit-testable without a
 * real WebGL canvas (the 3D click path itself is covered by CardMesh's tests).
 */
export function useSelectionViewer(view: GameView): {
  viewer: CardView | null;
  select(id: string): void;
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
  const clear = useCallback(() => setViewer(null), []);
  return { viewer, select, clear };
}

export function ThreeBattlefield(props: DesktopBattlefieldProps) {
  const { view } = props;
  const { viewer, select: handleSelect, clear } = useSelectionViewer(view);

  // Frame the whole table: with more seats the pod is wider, so lift + pull the
  // angled-overhead camera back so every opponent's board stays in view and
  // readable (the flat cards read best looked-down-upon, not edge-on).
  const seats = 1 + view.opponents.length;
  const camY = 9.5 + seats * 1.4; // 2p ≈ 12.3, 3p ≈ 13.7, 4p ≈ 15.1
  const camZ = SEAT_R + 5.5 + seats; // 2p ≈ 13.5, 3p ≈ 14.5, 4p ≈ 15.5
  const camera = useMemo(
    () => ({ position: [0, camY, camZ] as [number, number, number], fov: 50 }),
    [camY, camZ],
  );

  return (
    <div data-testid="three-battlefield" className="relative h-full w-full bg-black">
      <Canvas
        shadows
        dpr={[1, 2]}
        frameloop="demand"
        camera={camera}
        gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
        onCreated={(state) => state.camera.lookAt(0, 0, -0.5)}
      >
        <BattlefieldScene view={view} onSelect={handleSelect} />
        <HandDock hand={view.you.hand} onSelect={handleSelect} />
        <EffectComposer>
          <Bloom intensity={0.6} luminanceThreshold={0.55} luminanceSmoothing={0.2} mipmapBlur />
        </EffectComposer>
      </Canvas>

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
