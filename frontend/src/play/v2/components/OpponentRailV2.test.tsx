import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OpponentRailV2 } from './OpponentRailV2';
import type { OpponentBoard } from '../../gameView.types';

const opp: OpponentBoard = {
  glance: {
    playerId: 'p2', name: 'Nezuko', life: 33, commanderDamageToYou: 0, handCount: 4,
    openMana: 2, creatureCount: 3, totalPower: 9, flags: [],
  },
  creatures: [], lands: [], other: [], graveyardCount: 5, exileCount: 0, commandZone: [],
  graveyard: [], exile: [],
};

describe('OpponentRailV2', () => {
  it('renders an opponent chip and explores on click', () => {
    const onExplore = vi.fn();
    render(<OpponentRailV2 opponents={[opp]} onExplore={onExplore} />);
    expect(screen.getByText('Nezuko')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /explore nezuko/i }));
    expect(onExplore).toHaveBeenCalledWith('p2');
  });
});
