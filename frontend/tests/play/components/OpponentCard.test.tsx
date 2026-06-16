// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { OpponentCard } from '../../../src/play/components/OpponentCard';
import type { OpponentGlance } from '../../../src/play/gameView.types';

// CardImage fetches the card art on mount; stub fetch so the component renders
// inertly in the test DOM (the art pipeline is not what we're asserting here).
vi.stubGlobal(
  'fetch',
  vi.fn(() =>
    Promise.resolve({
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({}),
    }),
  ),
);

afterEach(() => cleanup());

function makeGlance(overrides: Partial<OpponentGlance> = {}): OpponentGlance {
  return {
    playerId: 'ai1',
    name: 'Atraxa, Praetors’ Voice',
    life: 33,
    commanderDamageToYou: 0,
    handCount: 4,
    openMana: 0,
    creatureCount: 2,
    totalPower: 7,
    flags: [],
    ...overrides,
  };
}

describe('OpponentCard', () => {
  it('emphasizes open mana (amber) when > 0 and mutes it when 0', () => {
    const { rerender } = render(
      <OpponentCard glance={makeGlance({ openMana: 3 })} onExplore={() => {}} />,
    );
    const openStat = screen.getByTestId('open-mana-stat');
    // open mana > 0 -> amber/info emphasis, NOT the muted treatment
    expect(openStat.className).toContain('text-amber-100');
    expect(openStat.className).not.toContain('text-stone-500');

    rerender(<OpponentCard glance={makeGlance({ openMana: 0 })} onExplore={() => {}} />);
    const mutedStat = screen.getByTestId('open-mana-stat');
    // open mana 0 -> muted, NOT amber
    expect(mutedStat.className).toContain('text-stone-500');
    expect(mutedStat.className).not.toContain('text-amber-100');
  });

  it('calls onExplore when the card is clicked', () => {
    const onExplore = vi.fn();
    render(<OpponentCard glance={makeGlance()} onExplore={onExplore} />);
    fireEvent.click(screen.getByTestId('opponent-card'));
    expect(onExplore).toHaveBeenCalledTimes(1);
  });
});
