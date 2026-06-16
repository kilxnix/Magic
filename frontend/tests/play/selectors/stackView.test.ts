import { describe, expect, it } from 'vitest';
import { stackView } from '../../../src/play/selectors/stackView';
import { makeStackItem } from '../fixtures/simpleState';

const NAMES = (id: string) => (id === 'human' ? 'You' : id === 'ai1' ? 'AI One' : id);

describe('stackView', () => {
  it('returns an empty array for an empty stack', () => {
    expect(stackView([], NAMES)).toEqual([]);
  });

  it('orders top-of-stack first (LIFO) and marks it resolvesNext', () => {
    // engine.stack: index 0 was cast FIRST, last element resolves FIRST.
    const simpleStack = [
      makeStackItem({ id: 's1', name: 'Cultivate', casterId: 'human' }),
      makeStackItem({ id: 's2', name: 'Counterspell', casterId: 'ai1' }),
    ];
    const view = stackView(simpleStack, NAMES);
    expect(view.map(item => item.id)).toEqual(['s2', 's1']);
    expect(view[0].resolvesNext).toBe(true);
    expect(view[1].resolvesNext).toBe(false);
  });

  it('resolves the controller id to a display name', () => {
    const view = stackView([makeStackItem({ casterId: 'ai1', name: 'Doom Blade' })], NAMES);
    expect(view[0].controllerName).toBe('AI One');
  });

  it('uses the item name as the title', () => {
    const view = stackView([makeStackItem({ name: 'Llanowar Elves ability' })], NAMES);
    expect(view[0].title).toBe('Llanowar Elves ability');
  });

  it('synthesizes a description with target names when present', () => {
    const view = stackView(
      [makeStackItem({ name: 'Lightning Bolt', targetNames: ['Grizzly Bears (You, Battlefield)'] })],
      NAMES,
    );
    expect(view[0].description).toContain('Lightning Bolt');
    expect(view[0].description.toLowerCase()).toContain('targeting');
    expect(view[0].description).toContain('Grizzly Bears (You, Battlefield)');
  });

  it('joins multiple target names', () => {
    const view = stackView(
      [makeStackItem({ name: 'Forked Bolt', targetNames: ['Bear', 'Elf'] })],
      NAMES,
    );
    expect(view[0].description).toContain('Bear');
    expect(view[0].description).toContain('Elf');
  });

  it('omits targeting wording when there are no targets', () => {
    const view = stackView([makeStackItem({ name: 'Cultivate', targetNames: [] })], NAMES);
    expect(view[0].description.toLowerCase()).not.toContain('targeting');
    expect(view[0].description).toContain('Cultivate');
  });
});
