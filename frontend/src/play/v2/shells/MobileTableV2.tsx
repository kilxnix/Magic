// frontend/src/play/v2/shells/MobileTableV2.tsx
import { useState } from 'react';
import type { DesktopBattlefieldProps } from '../../shells/DesktopBattlefield';
import { MOBILE_TABLE_LAYOUT as L, shouldSurfaceDecisionSheet } from '../../playView.layout';
import type { CardView } from '../../gameView.types';
import { OpponentRailV2 } from '../components/OpponentRailV2';
import { PlayerBoardV2 } from '../components/PlayerBoardV2';
import { HandViewV2 } from '../components/HandViewV2';
import { StackViewV2 } from '../components/StackViewV2';
import { PriorityControlsV2 } from '../components/PriorityControlsV2';
import { CombatFlowV2 } from '../components/CombatFlowV2';
import { TargetingLayerV2 } from '../components/TargetingLayerV2';
import { CardViewerV2 } from '../components/CardViewerV2';
import { ZoneExplorerV2, type ExploreZone } from '../components/ZoneExplorerV2';

export function MobileTableV2(props: DesktopBattlefieldProps) {
  const { view } = props;
  const [viewer, setViewer] = useState<CardView | null>(null);
  const [explorer, setExplorer] = useState<{ playerId: string; zone: ExploreZone } | null>(null);
  const showSheet = shouldSurfaceDecisionSheet(view) || view.targeting.active || view.combat.step !== 'none';

  return (
    <div className={L.shell}>
      <div className={L.opponentsStrip}>
        <OpponentRailV2 opponents={view.opponents} onExplore={id => setExplorer({ playerId: id, zone: 'battlefield' })} />
      </div>

      <div className={L.boardArea}>
        <PlayerBoardV2 you={view.you} onAction={props.onAction} onView={setViewer}
          onOpenZone={zone => setExplorer({ playerId: 'you', zone })} />
        {explorer ? (
          <ZoneExplorerV2 view={view} target={explorer} onClose={() => setExplorer(null)}
            onView={cv => { setViewer(cv); setExplorer(null); }} />
        ) : null}
        {viewer ? <CardViewerV2 card={viewer} onClose={() => setViewer(null)}
          onAction={a => { props.onAction(a); setViewer(null); }} /> : null}
      </div>

      {showSheet ? (
        <div className={L.decisionSheet}>
          <StackViewV2 stack={view.stack} onView={setViewer} />
          <TargetingLayerV2 targeting={view.targeting} onToggleTarget={props.onToggleTarget}
            onConfirm={props.onConfirmTarget} onCancel={props.onCancelTarget} />
          <CombatFlowV2 combat={view.combat} selectedDefenderId={props.selectedDefenderId}
            onAssign={props.onAssignCombat} onConfirm={props.onConfirmCombat} onSkip={props.onSkipCombat}
            onSelectDefender={props.onSelectDefender} />
        </div>
      ) : null}

      <div className={L.prioritySlot}>
        <PriorityControlsV2 priority={view.priority} alwaysStop={props.alwaysStop}
          onPass={props.onPass} onHold={props.onHold} onToggleAlwaysStop={props.onToggleAlwaysStop} />
      </div>

      <details className={L.handPullup}>
        <summary className={L.handPullupSummary}>Hand ({view.you.hand.length})</summary>
        <div className={L.handPullupBody}>
          <HandViewV2 hand={view.you.hand} onAction={props.onAction} onView={setViewer} />
        </div>
      </details>
    </div>
  );
}
