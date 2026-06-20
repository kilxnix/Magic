import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CardViewerV2 } from './CardViewerV2';
import type { CardView } from '../../gameView.types';

const card: CardView = {
  id: 'i1', name: 'Eternal Witness', zone: 'graveyard', power: 2, toughness: 1,
  statuses: ['In graveyard'], legalActions: [],
};

describe('CardViewerV2', () => {
  it('renders nothing when card is null', () => {
    const { container } = render(<CardViewerV2 card={null} onClose={() => {}} onAction={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
  it('shows the card name + status and closes', () => {
    const onClose = vi.fn();
    render(<CardViewerV2 card={card} onClose={onClose} onAction={() => {}} />);
    expect(screen.getAllByText('Eternal Witness').length).toBeGreaterThan(0);
    expect(screen.getByText('In graveyard')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
