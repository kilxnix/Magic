import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NarrationFeedV2 } from './NarrationFeedV2';
import type { NarrationEntry } from '../../gameView.types';

describe('NarrationFeedV2', () => {
  it('renders log entries', () => {
    const entries: NarrationEntry[] = [{ id: 'n1', kind: 'resolve', text: 'Cultivate resolves' }];
    render(<NarrationFeedV2 narration={entries} />);
    expect(screen.getByText('Cultivate resolves')).toBeTruthy();
  });
});
