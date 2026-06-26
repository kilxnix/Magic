import { describe, expect, it, vi } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';

// Mock <Canvas> to a placeholder that does NOT mount its 3D children: those use
// R3F hooks (useFrame) that require a real Canvas context, and the scene graph is
// already covered by the test-renderer tests (Tasks 8-10). The DOM overlay renders
// as a sibling of <Canvas>, so it is still present and assertable.
vi.mock('@react-three/fiber', async () => {
  const actual = await vi.importActual<typeof import('@react-three/fiber')>('@react-three/fiber');
  return { ...actual, Canvas: () => <div data-testid="r3f-canvas" /> };
});

import { ThreeBattlefield, useSelectionViewer } from './ThreeBattlefield';
import type { DesktopBattlefieldProps } from '../shells/DesktopBattlefield';
import type { GameView, PermanentView } from '../gameView.types';

function perm(id: string, name: string, extra: Partial<PermanentView> = {}): PermanentView {
  return { id, name, tapped: false, isLand: false, isCreature: false, legalActions: [], ...extra };
}
function view(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [], graveyardCount: 0, libraryCount: 0, handCount: 0,
      creatures: [perm('c1', 'Bear', { isCreature: true })], artifacts: [], enchantments: [],
      lands: [], other: [], hand: [], graveyard: [], exile: [],
    },
    opponents: [],
    stack: [], priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'Main', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}

function props(over: Partial<DesktopBattlefieldProps> = {}): DesktopBattlefieldProps {
  return {
    view: view(), alwaysStop: false,
    onAction: vi.fn(), onExamine: vi.fn(), onPass: vi.fn(), onHold: vi.fn(), onToggleAlwaysStop: vi.fn(),
    onExploreOpponent: vi.fn(), onRespond: vi.fn(), onLetResolve: vi.fn(),
    onToggleTarget: vi.fn(), onConfirmTarget: vi.fn(), onCancelTarget: vi.fn(),
    onAssignCombat: vi.fn(), onConfirmCombat: vi.fn(), onSkipCombat: vi.fn(),
    selectedDefenderId: null, onSelectDefender: vi.fn(),
    ...over,
  };
}

describe('ThreeBattlefield', () => {
  it('renders the canvas host and the DOM phase track', () => {
    render(<ThreeBattlefield {...props()} />);
    expect(screen.getByTestId('r3f-canvas')).toBeTruthy();
    expect(screen.getAllByText(/Main/).length).toBeGreaterThan(0);
  });

});

describe('useSelectionViewer', () => {
  it('opens a viewer for a selected object and clears it', () => {
    const v = view(); // your board has creature 'c1' (Bear)
    const { result } = renderHook(() => useSelectionViewer(v));
    expect(result.current.viewer).toBeNull();
    act(() => result.current.select('c1'));
    expect(result.current.viewer?.id).toBe('c1');
    expect(result.current.viewer?.name).toBe('Bear');
    act(() => result.current.clear());
    expect(result.current.viewer).toBeNull();
  });

  it('ignores selection of an unknown id', () => {
    const { result } = renderHook(() => useSelectionViewer(view()));
    act(() => result.current.select('does-not-exist'));
    expect(result.current.viewer).toBeNull();
  });
});
