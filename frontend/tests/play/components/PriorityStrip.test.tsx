// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PriorityStrip } from '../../../src/play/components/PriorityStrip';
import type { PriorityContext } from '../../../src/play/gameView.types';

afterEach(() => cleanup());

function makePriority(overrides: Partial<PriorityContext> = {}): PriorityContext {
  return {
    hasPriority: true,
    phaseLabel: 'Main Phase 1',
    hasMeaningfulResponse: false,
    canPass: true,
    canHold: false,
    ...overrides,
  };
}

describe('PriorityStrip', () => {
  it('calls onPass when the pass control is clicked', () => {
    const onPass = vi.fn();
    render(
      <PriorityStrip
        priority={makePriority({ canPass: true })}
        alwaysStop={false}
        onPass={onPass}
        onHold={() => {}}
        onToggleAlwaysStop={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('priority-pass'));
    expect(onPass).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleAlwaysStop when the always-stop toggle is changed', () => {
    const onToggleAlwaysStop = vi.fn();
    render(
      <PriorityStrip
        priority={makePriority()}
        alwaysStop={false}
        onPass={() => {}}
        onHold={() => {}}
        onToggleAlwaysStop={onToggleAlwaysStop}
      />,
    );
    fireEvent.click(screen.getByTestId('always-stop-checkbox'));
    expect(onToggleAlwaysStop).toHaveBeenCalledTimes(1);
  });
});
