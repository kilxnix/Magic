import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SeatHudOverlay } from './SeatHudOverlay';
import type { CameraPose } from './projection';
import type { GameView, OpponentBoard } from '../gameView.types';

const pose: CameraPose = { position: [0, 14, 14], target: [0, 0, -0.5], fov: 50 };

function opp(name: string, over: Partial<OpponentBoard['glance']> = {}): OpponentBoard {
  return {
    glance: { playerId: name, name, life: 40, commanderDamageToYou: 0, handCount: 7, openMana: 0, creatureCount: 0, totalPower: 0, flags: [], ...over },
    creatures: [], lands: [], other: [], graveyardCount: 0, exileCount: 0, commandZone: [], graveyard: [], exile: [],
  };
}

function view(opponents: OpponentBoard[]): GameView {
  return {
    you: {
      life: 36, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [], graveyardCount: 0, libraryCount: 0, handCount: 5,
      creatures: [], artifacts: [], enchantments: [], lands: [], other: [], hand: [], graveyard: [], exile: [],
    },
    opponents,
    stack: [], priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'Main', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}

afterEach(() => cleanup());

describe('SeatHudOverlay', () => {
  it('renders a badge per seat with name + life', () => {
    render(<SeatHudOverlay view={view([opp('Ana', { life: 21 })])} pose={pose} width={800} height={600} />);
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('36')).toBeTruthy(); // your life
    expect(screen.getByText('21')).toBeTruthy(); // Ana's life
  });

  it('shows a commander-damage warning when an opponent has dealt you damage', () => {
    render(<SeatHudOverlay view={view([opp('Ana', { commanderDamageToYou: 13 })])} pose={pose} width={800} height={600} />);
    expect(screen.getByText(/CMDR 13\/21/)).toBeTruthy();
  });

  it('calls onFocus with the seat index when an opponent badge is clicked', () => {
    const onFocus = vi.fn();
    render(<SeatHudOverlay view={view([opp('Ana')])} pose={pose} width={800} height={600} onFocus={onFocus} />);
    fireEvent.click(screen.getByText('Ana'));
    expect(onFocus).toHaveBeenCalledWith(1);
  });

  it('does not invoke focus from your own badge', () => {
    const onFocus = vi.fn();
    render(<SeatHudOverlay view={view([opp('Ana')])} pose={pose} width={800} height={600} onFocus={onFocus} />);
    fireEvent.click(screen.getByText('You'));
    expect(onFocus).not.toHaveBeenCalled();
  });

  it('renders nothing until the canvas is measured', () => {
    const { container } = render(<SeatHudOverlay view={view([opp('Ana')])} pose={pose} width={0} height={0} />);
    expect(container.firstChild).toBeNull();
  });
});
