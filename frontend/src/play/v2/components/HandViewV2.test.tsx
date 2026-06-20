import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HandViewV2 } from './HandViewV2';
import type { HandCardView } from '../../gameView.types';

const hand: HandCardView[] = [{ id: 'h1', name: 'Cultivate', manaCost: '{2}{G}', legalActions: [] }];

describe('HandViewV2', () => {
  it('opens the viewer when a card has no primary action', () => {
    const onView = vi.fn();
    render(<HandViewV2 hand={hand} onAction={() => {}} onView={onView} />);
    fireEvent.click(screen.getByRole('button', { name: /cultivate/i }));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1', zone: 'hand' }));
  });
});
