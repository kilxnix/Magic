import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NarrationFeed } from '../../../src/play/components/NarrationFeed';
import type { NarrationEntry } from '../../../src/play/gameView.types';

// This project has no @testing-library/react / jsdom wired into vitest (the
// existing frontend tests are pure-logic). Rather than add a DOM environment
// and new deps (out of scope for this component), we render the pure
// presentational component to static HTML with React's built-in
// react-dom/server and assert on the markup — enough to lock the two
// load-bearing behaviors below.

const entries: NarrationEntry[] = [
  { id: 'n0', kind: 'phase', text: 'Combat begins.' },
  { id: 'n1', kind: 'trigger', text: 'Soul Warden triggers on Llanowar Elves.' },
  { id: 'n2', kind: 'resolve', text: 'Counterspell resolves.' },
  { id: 'n3', kind: 'action', text: 'You cast Doom Blade.' },
];

function render(props: Parameters<typeof NarrationFeed>[0]): string {
  return renderToStaticMarkup(createElement(NarrationFeed, props));
}

describe('NarrationFeed', () => {
  it('renders entries in order, newest last', () => {
    const html = render({ entries });

    // Every entry text is present...
    for (const entry of entries) {
      expect(html).toContain(entry.text);
    }

    // ...and they appear in feed order (the last-added line comes last in the
    // markup, which is the "newest last" calm-log ordering).
    const positions = entries.map((e) => html.indexOf(e.text));
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it('does NOT overlay the board: no position:fixed, no absolute full-screen overlay', () => {
    const html = render({ entries });

    // Regression guard for the feed-blocking bug. The feed must live in normal
    // flow as a bounded scrollable container — never a fixed/absolute overlay
    // sitting over the board's interactive layer.
    expect(html).not.toContain('fixed');

    // No absolutely-positioned full-screen overlay (e.g. `absolute inset-0`,
    // which would stretch over the whole board).
    expect(html).not.toMatch(/\babsolute\b/);
    expect(html).not.toContain('inset-0');

    // Positively: the scroll region exists and is bounded + in-flow.
    expect(html).toContain('data-testid="narration-log"');
    expect(html).toContain('overflow-y-auto');
    expect(html).toMatch(/max-h-\[40svh\]/);
  });

  it('renders an empty-state hint when there are no entries (no crash)', () => {
    const html = render({ entries: [] });
    expect(html).toContain('data-testid="narration-feed"');
    expect(html).toContain('The log will narrate');
    expect(html).not.toContain('fixed');
  });
});
