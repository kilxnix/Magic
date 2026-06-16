// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { DesktopBattlefield } from '../../../src/play/shells/DesktopBattlefield';
import type {
  GameView,
  OpponentBoard,
  PermanentView,
} from '../../../src/play/gameView.types';

// CardImage resolves art by NAME via a fetch() in an effect. jsdom has no
// network; stub it to a stable marker (the same pattern the sibling component
// tests use) so the shell render is deterministic and side-effect free.
vi.mock('../../../src/components/CardImage', () => ({
  CardImage: ({ cardName }: { cardName: string }) => (
    <img alt={cardName} data-testid="card-art" />
  ),
}));

afterEach(cleanup);

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

function land(id: string): PermanentView {
  return { id, name: `Land ${id}`, tapped: false, isLand: true, isCreature: false, legalActions: [] };
}

function opponent(playerId: string, name: string): OpponentBoard {
  return {
    glance: {
      playerId,
      name,
      life: 38,
      commanderDamageToYou: 0,
      handCount: 5,
      openMana: 2,
      creatureCount: 1,
      totalPower: 2,
      flags: [],
    },
    creatures: [creature(`${playerId}-c1`)],
    lands: [land(`${playerId}-l1`)],
    other: [],
    graveyardCount: 0,
    exileCount: 0,
    commandZone: [],
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
      creatures: [creature('you-c1')],
      lands: [land('you-l1'), land('you-l2')],
      other: [],
      hand: [
        { id: 'h1', name: 'Lightning Bolt', manaCost: '{R}', legalActions: [] },
        { id: 'h2', name: 'Cultivate', manaCost: '{2}{G}', legalActions: [] },
      ],
    },
    opponents: [opponent('ai1', 'Atraxa'), opponent('ai2', 'Korvold')],
    stack: [
      {
        id: 's1',
        controllerName: 'You',
        title: 'Lightning Bolt',
        description: 'Deals 3 damage.',
        resolvesNext: true,
      },
    ],
    priority: {
      hasPriority: true,
      phaseLabel: 'Main Phase 1',
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
    narration: [
      { id: 'n1', kind: 'phase', text: 'Main phase begins.' },
      { id: 'n2', kind: 'action', text: 'You cast Lightning Bolt.' },
    ],
    guided: true,
    isYourTurn: true,
    winner: null,
    ...over,
  };
}

const noop = () => {};

function renderShell(over: Partial<GameView> = {}) {
  return render(
    <DesktopBattlefield
      view={makeView(over)}
      alwaysStop={false}
      onAction={noop}
      onExamine={noop}
      onPass={noop}
      onHold={noop}
      onToggleAlwaysStop={noop}
      onExploreOpponent={noop}
      onRespond={noop}
      onLetResolve={noop}
      onToggleTarget={noop}
      onConfirmTarget={noop}
      onCancelTarget={noop}
      onAssignCombat={noop}
      onConfirmCombat={noop}
    />,
  );
}

describe('DesktopBattlefield', () => {
  it('renders all key regions and the narration is NOT a fixed/absolute full-screen overlay', () => {
    renderShell();

    // ── All key regions of the desktop battlefield render ──────────────────
    // Priority (left rail).
    expect(screen.getByTestId('priority-strip')).toBeTruthy();
    // Opponents strip — one OpponentCard per opponent.
    const opponentsStrip = screen.getByTestId('opponents-strip');
    expect(within(opponentsStrip).getAllByTestId('opponent-card')).toHaveLength(2);
    // The stack pinned center.
    const stackSlot = screen.getByTestId('stack-slot');
    expect(within(stackSlot).getByText('The Stack')).toBeTruthy();
    // Your board (the main area).
    expect(screen.getByTestId('player-board')).toBeTruthy();
    // Your hand along the bottom.
    expect(screen.getByTestId('hand-view')).toBeTruthy();
    // Narration (right rail).
    const narration = screen.getByTestId('narration-feed');
    expect(narration).toBeTruthy();

    // ── Regression guard: the narration container must live in normal flow,
    //    never a fixed bar or an absolute full-screen overlay over the board.
    const cls = narration.className;
    expect(cls).not.toMatch(/\bfixed\b/);
    expect(cls).not.toMatch(/\babsolute\b/);
    expect(cls).not.toContain('inset-0');

    // And the persistent right rail that hosts it is also in-flow (no fixed).
    const rightRail = screen.getByTestId('right-rail');
    expect(rightRail.className).not.toMatch(/\bfixed\b/);
    expect(rightRail.className).not.toContain('inset-0');
  });
});
