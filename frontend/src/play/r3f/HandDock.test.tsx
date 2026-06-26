import { describe, expect, it, vi } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { HandDock } from './HandDock';
import type { HandCardView } from '../gameView.types';

const hand: HandCardView[] = [
  { id: 'h1', name: 'Giant Growth', legalActions: [] },
  { id: 'h2', name: 'Llanowar Elves', legalActions: [] },
  { id: 'h3', name: 'Forest', legalActions: [] },
];

describe('HandDock', () => {
  it('renders one mesh per hand card', async () => {
    const r = await ReactThreeTestRenderer.create(<HandDock hand={hand} onSelect={() => {}} />);
    const ids = r.scene.findAll((n) => n.type === 'Mesh').map((m) => (m.instance.userData as { id?: string }).id).filter(Boolean);
    expect(new Set(ids)).toEqual(new Set(['h1', 'h2', 'h3']));
  });

  it('routes selection through onSelect', async () => {
    const onSelect = vi.fn();
    const r = await ReactThreeTestRenderer.create(<HandDock hand={hand} onSelect={onSelect} />);
    const mesh = r.scene.findAll((n) => n.type === 'Mesh').find((m) => (m.instance.userData as { id?: string }).id === 'h2')!;
    await r.fireEvent(mesh, 'click');
    expect(onSelect).toHaveBeenCalledWith('h2');
  });
});
