import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PermanentTileV2 } from './PermanentTileV2';
import type { PermanentView } from '../../gameView.types';

const tile: PermanentView = {
  id: 'i1', name: 'Avenger of Zendikar', tapped: false, power: 5, toughness: 5,
  isLand: false, isCreature: true, isAttacking: true, legalActions: [], counters: { '+1/+1': 1 },
};

describe('PermanentTileV2', () => {
  it('renders P/T and opens the viewer on examine', () => {
    const onView = vi.fn();
    render(<PermanentTileV2 permanent={tile} onAction={() => {}} onView={onView} />);
    expect(screen.getByText('5/5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /examine avenger/i }));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1', zone: 'battlefield' }));
  });
});
