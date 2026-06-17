// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CombatFlow } from '../../../src/play/components/CombatFlow';
import type { CombatContext } from '../../../src/play/gameView.types';

afterEach(() => cleanup());

function makeCombat(overrides: Partial<CombatContext> = {}): CombatContext {
  return {
    step: 'declare-attackers',
    eligibleIds: ['c-1', 'c-2'],
    eligible: [
      { id: 'c-1', name: 'Llanowar Elves', power: 1, toughness: 1 },
      { id: 'c-2', name: 'Grizzly Bears', power: 2, toughness: 2 },
    ],
    assignments: {},
    ...overrides,
  };
}

describe('CombatFlow', () => {
  it('shows the declare-attackers step label and confirm calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <CombatFlow
        combat={makeCombat({ step: 'declare-attackers' })}
        onAssign={() => {}}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByTestId('combat-step-label').textContent).toBe('Declare attackers');

    fireEvent.click(screen.getByTestId('combat-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders combatant NAMES (not raw ids) and skips with onSkip', () => {
    const onSkip = vi.fn();
    render(
      <CombatFlow combat={makeCombat()} onAssign={() => {}} onConfirm={() => {}} onSkip={onSkip} />,
    );

    // Names, not instance ids.
    expect(screen.getByText('Llanowar Elves')).toBeTruthy();
    expect(screen.getByText('Grizzly Bears')).toBeTruthy();

    // The explicit "No attacks" skip path (the gap that froze the playtest).
    fireEvent.click(screen.getByTestId('combat-skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the step is none', () => {
    const { container } = render(
      <CombatFlow
        combat={makeCombat({ step: 'none' })}
        onAssign={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('combat-flow')).toBeNull();
  });
});
