// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { PermanentTile } from '../../../src/play/components/PermanentTile';
import type { LegalAction, PermanentView } from '../../../src/play/gameView.types';

// CardImage fires a `fetch` in an effect to resolve art (no fetch in jsdom), and
// its internals are irrelevant to PermanentTile's behavior — stub it to a marker.
vi.mock('../../../src/components/CardImage', () => ({
  CardImage: ({ cardName }: { cardName: string }) => (
    <img alt={cardName} data-testid="card-art" />
  ),
}));

afterEach(cleanup);

function makeAction(over: Partial<LegalAction> = {}): LegalAction {
  return {
    kind: 'activate',
    label: 'Tap: Add G',
    source: {
      kind: 'activate',
      label: 'Tap: Add G',
      cardInstanceId: 'inst-1',
      cardName: 'Llanowar Elves',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _engineAction: {} as any,
    },
    ...over,
  };
}

function makePermanent(over: Partial<PermanentView> = {}): PermanentView {
  return {
    id: 'perm-1',
    name: 'Llanowar Elves',
    tapped: false,
    power: 1,
    toughness: 1,
    isLand: false,
    isCreature: true,
    legalActions: [makeAction()],
    ...over,
  };
}

describe('PermanentTile', () => {
  it('tapping the tile surfaces its legal-action labels', () => {
    const attack = makeAction({ kind: 'attack', label: 'Attack' });
    const tap = makeAction({ kind: 'activate', label: 'Tap: Add G' });
    const permanent = makePermanent({ legalActions: [attack, tap] });

    render(<PermanentTile permanent={permanent} onAction={() => {}} onExamine={() => {}} />);

    // Menu is closed initially — the action labels are not yet shown.
    expect(screen.queryByText('Attack')).toBeNull();

    // Tap the tile → its legal actions surface.
    fireEvent.click(
      screen.getByRole('button', { name: /Llanowar Elves.*show actions/ }),
    );

    expect(screen.getByText('Attack')).toBeTruthy();
    expect(screen.getByText('Tap: Add G')).toBeTruthy();
  });

  it('picking a surfaced action commits it via onAction', () => {
    const attack = makeAction({ kind: 'attack', label: 'Attack' });
    const onAction = vi.fn();
    render(
      <PermanentTile
        permanent={makePermanent({ legalActions: [attack] })}
        onAction={onAction}
        onExamine={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /show actions/ }));
    fireEvent.click(screen.getByText('Attack'));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(attack);
  });

  it('the examine affordance calls onExamine and does NOT call onAction', () => {
    const onAction = vi.fn();
    const onExamine = vi.fn();
    render(
      <PermanentTile
        permanent={makePermanent()}
        onAction={onAction}
        onExamine={onExamine}
      />,
    );

    fireEvent.click(screen.getByTestId('examine-button'));

    expect(onExamine).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
    // Examining is look-only: it must not open the action menu either.
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
