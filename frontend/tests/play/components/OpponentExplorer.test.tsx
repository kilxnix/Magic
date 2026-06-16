// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { OpponentExplorer } from '../../../src/play/components/OpponentExplorer';
import type { OpponentBoard, PermanentView } from '../../../src/play/gameView.types';

// PermanentTile (rendered for every permanent) fires a `fetch` via CardImage to
// resolve art (no fetch in jsdom). Stub CardImage to a marker — the art pipeline
// is irrelevant to the explorer's zone/close behavior under test.
vi.mock('../../../src/components/CardImage', () => ({
  CardImage: ({ cardName }: { cardName: string }) => (
    <img alt={cardName} data-testid="card-art" />
  ),
}));

afterEach(cleanup);

function makePermanent(over: Partial<PermanentView> = {}): PermanentView {
  return {
    id: `perm-${Math.random().toString(36).slice(2)}`,
    name: 'Grizzly Bears',
    tapped: false,
    power: 2,
    toughness: 2,
    isLand: false,
    isCreature: true,
    legalActions: [],
    ...over,
  };
}

function makeBoard(over: Partial<OpponentBoard> = {}): OpponentBoard {
  return {
    glance: {
      playerId: 'ai1',
      name: 'Atraxa, Praetors’ Voice',
      life: 33,
      commanderDamageToYou: 0,
      handCount: 4,
      openMana: 0,
      creatureCount: 1,
      totalPower: 2,
      flags: [],
    },
    creatures: [makePermanent({ name: 'Grizzly Bears' })],
    lands: [
      makePermanent({ name: 'Forest', isLand: true, isCreature: false, tapped: false }),
      makePermanent({ name: 'Island', isLand: true, isCreature: false, tapped: true }),
    ],
    other: [makePermanent({ name: 'Sol Ring', isLand: false, isCreature: false })],
    graveyardCount: 5,
    exileCount: 2,
    commandZone: [makePermanent({ name: 'Atraxa, Praetors’ Voice' })],
    ...over,
  };
}

describe('OpponentExplorer', () => {
  it('renders every zone (creatures, lands w/ untapped count, other, command) and the graveyard/exile/command chips', () => {
    render(<OpponentExplorer board={makeBoard()} onClose={() => {}} />);

    // Battlefield zones all present.
    expect(screen.getByTestId('zone-creatures')).toBeTruthy();
    expect(screen.getByTestId('zone-lands')).toBeTruthy();
    expect(screen.getByTestId('zone-other')).toBeTruthy();
    expect(screen.getByTestId('zone-command')).toBeTruthy();

    // Lands surface the untapped count (1 of the 2 lands is untapped).
    expect(screen.getByTestId('zone-lands-subtitle').textContent).toContain('1 untapped');

    // Hidden-zone chips render with their counts.
    expect(screen.getByTestId('chip-graveyard').textContent).toContain('5');
    expect(screen.getByTestId('chip-exile').textContent).toContain('2');
    expect(screen.getByTestId('chip-command').textContent).toContain('1');
  });

  it('does NOT use position:fixed (must not float over the board layer)', () => {
    render(<OpponentExplorer board={makeBoard()} onClose={() => {}} />);
    // The anti-bug invariant: the wrapper anchors absolutely to the board, never fixed.
    expect(screen.getByTestId('opponent-explorer').className).not.toContain('fixed');
  });

  it('calls onClose when the close control is clicked', () => {
    const onClose = vi.fn();
    render(<OpponentExplorer board={makeBoard()} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('explorer-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
