import { describe, expect, it } from 'vitest';
import { narration } from '../../../src/play/selectors/narration';
import type { ChatMessage } from '../../../src/hooks/useShelectorGame';

function msg(text: string, role: ChatMessage['role'] = 'shelector', timestamp = 0): ChatMessage {
  return { role, text, timestamp };
}

describe('narration', () => {
  it('returns an empty array for no messages', () => {
    expect(narration([])).toEqual([]);
    expect(narration(undefined)).toEqual([]);
  });

  it('turns chat messages into narration entries with text preserved', () => {
    const entries = narration([msg('You cast Lightning Bolt.'), msg('It resolves.')]);
    expect(entries).toHaveLength(2);
    expect(entries[0].text).toBe('You cast Lightning Bolt.');
    expect(entries[1].text).toBe('It resolves.');
  });

  it('gives every entry a stable, unique id', () => {
    const entries = narration([msg('a', 'shelector', 1), msg('b', 'system', 2)]);
    const ids = entries.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('classifies trigger / resolve / phase / action wording', () => {
    const entries = narration([
      msg('Soul Warden triggers.'),
      msg('Lightning Bolt resolves.'),
      msg('Entering Main Phase 2.'),
      msg('You cast Doom Blade.'),
    ]);
    expect(entries[0].kind).toBe('trigger');
    expect(entries[1].kind).toBe('resolve');
    expect(entries[2].kind).toBe('phase');
    expect(entries[3].kind).toBe('action');
  });

  it('skips empty/whitespace-only messages', () => {
    const entries = narration([msg('   '), msg('Real line.')]);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('Real line.');
  });
});
