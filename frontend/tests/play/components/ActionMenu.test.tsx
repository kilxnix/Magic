// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ActionMenu } from '../../../src/play/components/ActionMenu';
import type { LegalAction } from '../../../src/play/gameView.types';

// CardImage fires a `fetch` in an effect to resolve art (no fetch in jsdom), and
// its internals are irrelevant to ActionMenu's behavior — stub it to a marker.
vi.mock('../../../src/components/CardImage', () => ({
  CardImage: ({ cardName }: { cardName: string }) => (
    <img alt={cardName} data-testid="card-art" />
  ),
}));

afterEach(cleanup);

function makeAction(over: Partial<LegalAction> = {}): LegalAction {
  return {
    kind: 'cast',
    label: 'Cast Lightning Bolt',
    source: {
      kind: 'cast',
      label: 'Cast Lightning Bolt',
      cardInstanceId: 'inst-1',
      cardName: 'Lightning Bolt',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _engineAction: {} as any,
    },
    ...over,
  };
}

describe('ActionMenu', () => {
  it('renders one row per action and calls onPick with the clicked action', () => {
    const bolt = makeAction({ label: 'Cast Lightning Bolt' });
    const land = makeAction({
      kind: 'play-land',
      label: 'Play Mountain',
      source: {
        kind: 'play-land',
        label: 'Play Mountain',
        cardInstanceId: 'inst-2',
        cardName: 'Mountain',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _engineAction: {} as any,
      },
    });
    const pass = makeAction({
      kind: 'pass',
      label: 'Pass priority',
      source: {
        kind: 'pass',
        label: 'Pass priority',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _engineAction: {} as any,
      },
    });

    const onPick = vi.fn();
    render(<ActionMenu actions={[bolt, land, pass]} guided={false} onPick={onPick} />);

    // One row per action.
    const rows = screen.getAllByRole('menuitem');
    expect(rows).toHaveLength(3);

    // Clicking a row calls onPick with exactly that action.
    fireEvent.click(screen.getByText('Play Mountain'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(land);
  });

  it('hides disabled actions when not guided, shows them muted + inert when guided', () => {
    const enabled = makeAction({ label: 'Cast Lightning Bolt' });
    const disabled = makeAction({
      kind: 'cast',
      label: 'Cast Counterspell',
      whyDisabled: 'Not enough mana',
      source: {
        kind: 'cast',
        label: 'Cast Counterspell',
        cardInstanceId: 'inst-3',
        cardName: 'Counterspell',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _engineAction: {} as any,
      },
    });
    const onPick = vi.fn();

    // Non-guided: the disabled action is omitted entirely.
    const unguided = render(
      <ActionMenu actions={[enabled, disabled]} guided={false} onPick={onPick} />,
    );
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(screen.queryByText('Cast Counterspell')).toBeNull();
    unguided.unmount();

    // Guided: the disabled action appears with its reason and is not clickable.
    render(<ActionMenu actions={[enabled, disabled]} guided onPick={onPick} />);
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    expect(screen.getByText('Not enough mana')).toBeTruthy();

    fireEvent.click(screen.getByText('Cast Counterspell'));
    expect(onPick).not.toHaveBeenCalled();
  });
});
