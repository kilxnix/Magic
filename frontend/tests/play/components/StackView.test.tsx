// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StackView } from '../../../src/play/components/StackView';
import type { StackItemView } from '../../../src/play/gameView.types';

// CardImage runs a fetch() in an effect to resolve art by name. In jsdom there
// is no real network; stub it so the render is stable and side-effect free.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noop = () => {};

function makeItem(overrides: Partial<StackItemView> = {}): StackItemView {
  return {
    id: 's1',
    controllerName: 'You',
    title: 'Lightning Bolt',
    description: 'Deals 3 damage, targeting Grizzly Bears.',
    resolvesNext: false,
    ...overrides,
  };
}

describe('StackView', () => {
  it('renders the resolves-next badge on the flagged item', () => {
    const stack: StackItemView[] = [
      makeItem({ id: 'top', title: 'Counterspell', resolvesNext: true }),
      makeItem({ id: 'under', title: 'Cultivate', resolvesNext: false }),
    ];

    render(<StackView stack={stack} guided={false} onRespond={noop} onLetResolve={noop} />);

    expect(screen.getByText(/resolves next/i)).toBeTruthy();
  });

  it('renders the empty message when the stack is empty', () => {
    render(<StackView stack={[]} guided={false} onRespond={noop} onLetResolve={noop} />);

    expect(screen.getByText(/the stack is empty/i)).toBeTruthy();
  });
});
