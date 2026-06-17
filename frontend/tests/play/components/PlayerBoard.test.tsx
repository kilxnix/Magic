// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { PlayerBoard } from '../../../src/play/components/PlayerBoard';
import type { LegalAction, PermanentView, YouView } from '../../../src/play/gameView.types';

// CardImage fetches art in an effect (no fetch in jsdom) and is irrelevant to
// PlayerBoard's layout behavior — stub it to a marker, matching sibling tests.
vi.mock('../../../src/components/CardImage', () => ({
  CardImage: ({ cardName }: { cardName: string }) => (
    <img alt={cardName} data-testid="card-art" />
  ),
}));

afterEach(cleanup);

function makeAction(over: Partial<LegalAction> = {}): LegalAction {
  return {
    kind: 'activate',
    label: 'Tap',
    source: {
      kind: 'activate',
      label: 'Tap',
      cardInstanceId: 'inst',
      cardName: 'X',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _engineAction: {} as any,
    },
    ...over,
  };
}

function land(id: string): PermanentView {
  return {
    id,
    name: `Land ${id}`,
    tapped: false,
    isLand: true,
    isCreature: false,
    legalActions: [makeAction()],
  };
}

function creature(id: string): PermanentView {
  return {
    id,
    name: `Creature ${id}`,
    tapped: false,
    power: 2,
    toughness: 2,
    isLand: false,
    isCreature: true,
    legalActions: [makeAction({ kind: 'attack', label: 'Attack' })],
  };
}

function makeYou(over: Partial<YouView> = {}): YouView {
  return {
    life: 40,
    poison: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    commandZone: [],
    graveyardCount: 0,
    libraryCount: 0,
    handCount: 0,
    lands: [land('l1'), land('l2'), land('l3')],
    creatures: [creature('c1'), creature('c2')],
    artifacts: [],
    enchantments: [],
    other: [],
    hand: [],
    ...over,
  };
}

describe('PlayerBoard', () => {
  it('renders the correct number of tiles in the lands and creatures rows', () => {
    render(
      <PlayerBoard you={makeYou()} onAction={() => {}} onExamine={() => {}} />,
    );

    const landsRow = screen.getByTestId('lands-row');
    const creaturesRow = screen.getByTestId('creatures-row');

    // 3 lands, 2 creatures — each tile renders a PermanentTile (data-testid).
    expect(within(landsRow).getAllByTestId('permanent-tile')).toHaveLength(3);
    expect(within(creaturesRow).getAllByTestId('permanent-tile')).toHaveLength(2);

    // Rows are scoped: a land tile is not counted under the creatures row.
    expect(within(creaturesRow).queryByText('Land l1')).toBeNull();
  });
});
