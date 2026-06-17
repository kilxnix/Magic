// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MobileTable } from '../../../src/play/shells/MobileTable';
import type {
  GameView,
  HandCardView,
  OpponentBoard,
  PermanentView,
  StackItemView,
} from '../../../src/play/gameView.types';

// CardImage resolves art in an effect (no real network in jsdom) and is
// irrelevant to MobileTable's layout — stub it to a marker, matching sibling
// component tests.
vi.mock('../../../src/components/CardImage', () => ({
  CardImage: ({ cardName }: { cardName: string }) => (
    <img alt={cardName} data-testid="card-art" />
  ),
}));

afterEach(cleanup);

// ── Fixture builders ────────────────────────────────────────────────────────

function land(id: string): PermanentView {
  return {
    id,
    name: `Land ${id}`,
    tapped: false,
    isLand: true,
    isCreature: false,
    legalActions: [],
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
    legalActions: [],
  };
}

function handCard(id: string): HandCardView {
  return { id, name: `Hand ${id}`, manaCost: '{1}{G}', legalActions: [] };
}

function opponent(playerId: string): OpponentBoard {
  return {
    glance: {
      playerId,
      name: `Opponent ${playerId}`,
      life: 35,
      commanderDamageToYou: 0,
      handCount: 5,
      openMana: 2,
      creatureCount: 1,
      totalPower: 3,
      flags: [],
    },
    creatures: [],
    lands: [],
    other: [],
    graveyardCount: 0,
    exileCount: 0,
    commandZone: [],
  };
}

function stackItem(id: string): StackItemView {
  return {
    id,
    controllerName: 'You',
    title: 'Lightning Bolt',
    description: 'Deals 3 damage.',
    resolvesNext: true,
  };
}

function makeView(over: Partial<GameView> = {}): GameView {
  return {
    you: {
      life: 40,
      poison: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [],
      graveyardCount: 0,
      libraryCount: 0,
      handCount: 2,
      lands: [land('l1'), land('l2')],
      creatures: [creature('c1')],
      artifacts: [],
      enchantments: [],
      other: [],
      hand: [handCard('h1'), handCard('h2')],
    },
    opponents: [opponent('ai1'), opponent('ai2')],
    stack: [],
    priority: {
      hasPriority: true,
      phaseLabel: 'Main phase',
      hasMeaningfulResponse: false,
      canPass: true,
      canHold: false,
    },
    targeting: {
      active: false,
      prompt: '',
      minTargets: 0,
      maxTargets: 0,
      legalTargetIds: [],
      selectedTargetIds: [],
    },
    combat: { step: 'none', eligibleIds: [], assignments: {} },
    narration: [],
    guided: false,
    isYourTurn: true,
    winner: null,
    ...over,
  };
}

const noopCallbacks = {
  onAction: () => {},
  onExamine: () => {},
  onPass: () => {},
  onHold: () => {},
  onToggleAlwaysStop: () => {},
  onExploreOpponent: () => {},
  onRespond: () => {},
  onLetResolve: () => {},
  onToggleTarget: () => {},
  onConfirmTarget: () => {},
  onCancelTarget: () => {},
  onAssignCombat: () => {},
  onConfirmCombat: () => {},
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MobileTable', () => {
  it('renders board, hand, opponents strip, and the stack on a human priority decision; nothing uses position:fixed over the board', () => {
    // Human has priority AND there is a stack to decide about → the decision
    // sheet (stack) must surface as the bottom sheet.
    const view = makeView({
      stack: [stackItem('s1')],
      priority: {
        hasPriority: true,
        phaseLabel: 'Main phase',
        hasMeaningfulResponse: true,
        canPass: true,
        canHold: true,
      },
    });

    const { container } = render(
      <MobileTable view={view} alwaysStop={false} {...noopCallbacks} />,
    );

    // Board fills the screen — PlayerBoard is present with its rows + tiles.
    const boardArea = screen.getByTestId('board-area');
    expect(within(boardArea).getByTestId('player-board')).toBeTruthy();
    expect(within(boardArea).getAllByTestId('permanent-tile').length).toBe(3); // 2 lands + 1 creature

    // Opponents collapse to a top strip of glance cards (one per opponent).
    const strip = screen.getByTestId('opponents-strip');
    expect(within(strip).getAllByTestId('opponent-card')).toHaveLength(2);

    // Hand swipes up — the HandView is present with its cards.
    expect(screen.getByTestId('hand-pullup')).toBeTruthy();
    expect(screen.getByTestId('hand-view')).toBeTruthy();
    expect(screen.getAllByTestId('hand-card')).toHaveLength(2);

    // The stack surfaces in the bottom decision sheet (it IS the human's call).
    const sheet = screen.getByTestId('decision-sheet');
    expect(within(sheet).getByTestId('stack-item')).toBeTruthy();

    // REGRESSION GUARD: no element anywhere in the shell uses position:fixed
    // (Tailwind `fixed`) — the bug class this rebuild kills is feeds/docks
    // floating over the board's interactive layer.
    const fixedEls = container.querySelectorAll('.fixed');
    expect(fixedEls.length).toBe(0);
  });

  it('does not surface the stack decision sheet when it is not the human decision', () => {
    // Stack is non-empty but the human does NOT have priority → no bottom sheet
    // seizes the screen (spec: the sheet shows only when it's your decision).
    const view = makeView({
      stack: [stackItem('s1')],
      priority: {
        hasPriority: false,
        phaseLabel: "Opponent's main phase",
        hasMeaningfulResponse: false,
        canPass: false,
        canHold: false,
      },
    });

    render(<MobileTable view={view} alwaysStop={false} {...noopCallbacks} />);

    expect(screen.queryByTestId('decision-sheet')).toBeNull();
    // Board + opponents + hand still render regardless.
    expect(screen.getByTestId('player-board')).toBeTruthy();
  });
});
