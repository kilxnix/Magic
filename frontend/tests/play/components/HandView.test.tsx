// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { HandView } from '../../../src/play/components/HandView';
import type { HandCardView, LegalAction } from '../../../src/play/gameView.types';

// CardImage resolves art via a `fetch` in an effect (no fetch in jsdom) and its
// internals are irrelevant here — stub it to a marker img. HandView uses the
// REAL ActionMenu so we exercise the tap-card -> pick-action flow end to end.
vi.mock('../../../src/components/CardImage', () => ({
  CardImage: ({ cardName }: { cardName: string }) => (
    <img alt={cardName} data-testid="card-art" />
  ),
}));

afterEach(cleanup);

function makeAction(label: string, cardName: string, instId: string): LegalAction {
  return {
    kind: 'cast',
    label,
    source: {
      kind: 'cast',
      label,
      cardInstanceId: instId,
      cardName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _engineAction: {} as any,
    },
  };
}

function makeCard(over: Partial<HandCardView> = {}): HandCardView {
  return {
    id: 'h1',
    name: 'Lightning Bolt',
    manaCost: '{R}',
    legalActions: [makeAction('Cast Lightning Bolt', 'Lightning Bolt', 'inst-1')],
    ...over,
  };
}

describe('HandView', () => {
  it('renders one card per hand entry, and picking an action calls onAction with that card + action', () => {
    const bolt = makeCard({ id: 'h1', name: 'Lightning Bolt' });
    const castBolt = bolt.legalActions[0];
    const island = makeCard({
      id: 'h2',
      name: 'Island',
      manaCost: undefined,
      legalActions: [makeAction('Play Island', 'Island', 'inst-2')],
    });

    const onAction = vi.fn();
    const onExamine = vi.fn();
    render(<HandView hand={[bolt, island]} onAction={onAction} onExamine={onExamine} />);

    // One card per hand entry.
    const cards = screen.getAllByTestId('hand-card');
    expect(cards).toHaveLength(2);

    // Tapping a card opens its inline ActionMenu (anchored to that card, in-flow).
    fireEvent.click(screen.getByLabelText('Actions for Lightning Bolt'));
    const menu = screen.getByTestId('hand-action-menu');

    // Pick the action from within the opened menu.
    fireEvent.click(within(menu).getByText('Cast Lightning Bolt'));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(bolt, castBolt);
  });
});
