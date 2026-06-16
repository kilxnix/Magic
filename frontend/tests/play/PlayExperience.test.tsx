// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlayExperience } from '../../src/play/PlayExperience';
import type {
  SimpleGameState,
  SimpleLegalAction,
} from '../../src/hooks/useShelectorGame';
import {
  makeState,
  makePlayer,
  makeCreature,
  makeLand,
  makeLegalAction,
} from './fixtures/simpleState';

// CardImage resolves art by NAME via a fetch() in an effect — jsdom has no
// network. Stub it (same pattern the shell component tests use) so the shells
// render deterministically and side-effect free.
vi.mock('../../src/components/CardImage', () => ({
  CardImage: ({ cardName }: { cardName: string }) => (
    <img alt={cardName} data-testid="card-art" />
  ),
}));

// jsdom has no matchMedia; PlayExperience's useIsDesktop then falls back to the
// window.innerWidth + 'resize' path, which we drive directly below.
function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
}

/** A small but realistic human-turn fixture: a creature, two lands, one hand card. */
function fixtureGame(): SimpleGameState {
  return makeState({
    humanPlayer: makePlayer({ id: 'human', name: 'You', life: 40 }),
    humanBattlefield: [
      makeCreature({ instanceId: 'you-c1', name: 'Llanowar Elves', power: 1, toughness: 1 }),
      makeLand({ instanceId: 'you-l1' }),
      makeLand({ instanceId: 'you-l2' }),
    ],
    humanHand: [
      makeCreature({ instanceId: 'h1', name: 'Grizzly Bears', zone: 'hand', manaCost: '{1}{G}' }),
    ],
    aiPlayers: [makePlayer({ id: 'ai1', name: 'Atraxa', life: 38 })],
    aiBattlefields: { ai1: [makeCreature({ instanceId: 'ai-c1', name: 'Bear', ownerId: 'ai1' })] },
    aiGraveyards: { ai1: [] },
    aiCommandZones: { ai1: [] },
    aiCommanderNames: { ai1: 'Atraxa' },
  });
}

/** A cast action attached to the hand card, plus the always-present pass. */
function fixtureLegalActions(): SimpleLegalAction[] {
  const castBears = makeLegalAction({
    kind: 'CastSpell',
    cardInstanceId: 'h1',
    cardName: 'Grizzly Bears',
    label: 'Cast Grizzly Bears',
    _engineAction: ({
      kind: 'CastSpell',
      cardInstanceId: 'h1',
      targets: [],
    } as unknown) as SimpleLegalAction['_engineAction'],
  });
  const pass = makeLegalAction({ kind: 'PassPriority', label: 'Pass' });
  return [castBears, pass];
}

function renderExperience(onAction = vi.fn()) {
  const utils = render(
    <PlayExperience
      gameState={fixtureGame()}
      legalActions={fixtureLegalActions()}
      isHumanTurn
      winner={null}
      onAction={onAction}
      targetingPrompt={null}
      currentPrompt={null}
    />,
  );
  return { ...utils, onAction };
}

beforeEach(() => {
  // Default to desktop; individual tests override before rendering.
  setViewport(1280);
});

afterEach(cleanup);

describe('PlayExperience', () => {
  it('renders the desktop shell at >=1024px', () => {
    setViewport(1280);
    renderExperience();
    expect(screen.getByTestId('desktop-battlefield')).toBeTruthy();
    expect(screen.queryByTestId('mobile-table')).toBeNull();
  });

  it('renders the mobile shell below 1024px', () => {
    setViewport(800);
    renderExperience();
    expect(screen.getByTestId('mobile-table')).toBeTruthy();
    expect(screen.queryByTestId('desktop-battlefield')).toBeNull();
  });

  it('live-switches shells when the viewport crosses the breakpoint', () => {
    setViewport(1280);
    renderExperience();
    expect(screen.getByTestId('desktop-battlefield')).toBeTruthy();

    act(() => {
      setViewport(700);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('mobile-table')).toBeTruthy();
    expect(screen.queryByTestId('desktop-battlefield')).toBeNull();
  });

  it('routes a hand-card action callback to onAction(action.source) exactly once', () => {
    setViewport(1280);
    const { onAction } = renderExperience();

    // One-gesture grammar: tap the hand card → its inline ActionMenu opens →
    // pick the cast action. That picks the LegalAction whose `.source` is the
    // CastSpell SimpleLegalAction; the shell routes it to onAction(action.source).
    fireEvent.click(screen.getByLabelText('Actions for Grizzly Bears'));
    const castMenuItem = screen.getByRole('menuitem', { name: /cast grizzly bears/i });
    fireEvent.click(castMenuItem);

    expect(onAction).toHaveBeenCalledTimes(1);
    // It must be called with the underlying SimpleLegalAction (action.source),
    // i.e. the CastSpell action for the hand card.
    const submitted = onAction.mock.calls[0][0] as SimpleLegalAction;
    expect(submitted.kind).toBe('CastSpell');
    expect(submitted.cardInstanceId).toBe('h1');
  });

  it('routes pass to the PassPriority legal action', () => {
    setViewport(1280);
    const { onAction } = renderExperience();

    const passButton = screen.getByTestId('priority-pass');
    fireEvent.click(passButton);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect((onAction.mock.calls[0][0] as SimpleLegalAction).kind).toBe('PassPriority');
  });
});
