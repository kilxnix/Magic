// frontend/src/play/v2/shells/DesktopBattlefieldV2.test.tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DesktopBattlefieldV2 } from './DesktopBattlefieldV2';
import type { DesktopBattlefieldProps } from '../../shells/DesktopBattlefield';
import type { GameView } from '../../gameView.types';

function emptyView(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [], graveyardCount: 2, libraryCount: 99, handCount: 0,
      creatures: [], artifacts: [], enchantments: [], lands: [], other: [], hand: [],
      graveyard: [{ id: 'g1', name: 'Cultivate', legalActions: [] }], exile: [],
    },
    opponents: [], stack: [],
    priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'Main 1', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}
function props(): DesktopBattlefieldProps {
  const noop = () => {};
  return {
    view: emptyView(), alwaysStop: false, onAction: noop, onExamine: noop, onPass: noop, onHold: noop,
    onToggleAlwaysStop: noop, onExploreOpponent: noop, onRespond: noop, onLetResolve: noop,
    onToggleTarget: noop, onConfirmTarget: noop, onCancelTarget: noop, onAssignCombat: noop,
    onConfirmCombat: noop, onSkipCombat: noop, selectedDefenderId: null, onSelectDefender: noop,
  };
}

describe('DesktopBattlefieldV2', () => {
  it('opens the zone explorer from the HUD graveyard counter', () => {
    render(<DesktopBattlefieldV2 {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /graveyard 2/i }));
    // Explorer modal renders the contents
    expect(screen.getByRole('button', { name: /cultivate/i })).toBeTruthy();
  });
});
