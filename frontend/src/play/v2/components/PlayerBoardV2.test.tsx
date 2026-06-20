import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlayerBoardV2 } from './PlayerBoardV2';
import type { YouView } from '../../gameView.types';

const you: YouView = {
  life: 38, poison: 0, maxCommanderDamageTaken: 0,
  manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
  commandZone: [], graveyardCount: 7, libraryCount: 71, handCount: 5,
  creatures: [{ id: 'c1', name: 'Llanowar Elves', tapped: false, power: 1, toughness: 1, isLand: false, isCreature: true, legalActions: [] }],
  artifacts: [], enchantments: [], lands: [], other: [], hand: [],
  graveyard: [], exile: [],
};

describe('PlayerBoardV2', () => {
  it('shows your life and opens a zone from the HUD', () => {
    const onOpenZone = vi.fn();
    render(<PlayerBoardV2 you={you} onAction={() => {}} onView={() => {}} onOpenZone={onOpenZone} />);
    expect(screen.getByText('38')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /graveyard 7/i }));
    expect(onOpenZone).toHaveBeenCalledWith('graveyard');
  });
});
