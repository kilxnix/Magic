import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('./playUiMode', () => ({ getPlayUiMode: () => '3d' }));
const webglMock = vi.fn(() => true);
vi.mock('./webgl', () => ({ supportsWebGL: () => webglMock() }));
// Canvas placeholder (no 3D children) — see ThreeBattlefield.test.tsx for rationale.
vi.mock('@react-three/fiber', async () => {
  const actual = await vi.importActual<typeof import('@react-three/fiber')>('@react-three/fiber');
  return { ...actual, Canvas: () => <div data-testid="r3f-canvas" /> };
});

// Mock the view-model hook so the test needs NO full SimpleGameState fixture — the
// branch logic under test (uiMode + WebGL → which shell) does not depend on real
// engine state. Keep `nameForPlayer` real (PlayExperience imports it from here too).
vi.mock('../useGameView', async () => {
  const actual = await vi.importActual<typeof import('../useGameView')>('../useGameView');
  const view = {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [], graveyardCount: 0, libraryCount: 0, handCount: 0,
      creatures: [], artifacts: [], enchantments: [], lands: [], other: [],
      hand: [], graveyard: [], exile: [],
    },
    opponents: [],
    stack: [],
    priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'Main', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
  return { ...actual, useGameView: () => view };
});

import { PlayExperience, type PlayExperienceProps } from '../PlayExperience';

// PlayExperience reads only `gameState.humanPlayer.id` directly (the youWon check;
// winner is null here so it is never compared). useGameView is mocked, so no deeper
// gameState shape is needed — a minimal stub suffices.
function baseProps(): PlayExperienceProps {
  return {
    gameState: { humanPlayer: { id: 'you' } } as unknown as PlayExperienceProps['gameState'],
    legalActions: [],
    isHumanTurn: true,
    onAction: vi.fn(),
  };
}

beforeEach(() => webglMock.mockReturnValue(true));
afterEach(() => cleanup());

describe('PlayExperience with ?ui=3d', () => {
  // NOTE: this project has NO global jest-dom setup; presence is asserted with
  // `.toBeTruthy()` and absence with `.toBeNull()` (queryBy* returns null), matching
  // the existing v2 test convention. Do NOT use `toBeInTheDocument()`.
  it('renders the 3D shell when WebGL is available', () => {
    render(<PlayExperience {...baseProps()} />);
    expect(screen.getByTestId('three-battlefield')).toBeTruthy();
  });

  it('falls back to a 2D shell when WebGL is unavailable', () => {
    webglMock.mockReturnValue(false);
    render(<PlayExperience {...baseProps()} />);
    expect(screen.queryByTestId('three-battlefield')).toBeNull();
  });
});
