import { describe, expect, it, vi } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { CardMesh, CARD_TILT, OPPONENT_SCALE } from './CardMesh';
import type { Placement } from './placements';

function p(over: Partial<Placement> = {}): Placement {
  return { id: 'c1', name: 'Bear', seatIndex: 0, row: 'creatures', position: [1, 0, 2], tapped: false, typeKind: 'other', isOwn: true, ...over };
}

describe('CardMesh', () => {
  it('renders a mesh carrying the card id in userData', async () => {
    const r = await ReactThreeTestRenderer.create(<CardMesh placement={p()} onSelect={() => {}} />);
    const meshes = r.scene.findAll((n) => n.type === 'Mesh');
    expect(meshes.length).toBeGreaterThanOrEqual(1);
    expect(meshes.some((m) => (m.instance.userData as { id?: string }).id === 'c1')).toBe(true);
  });

  it('positions the card at its placement coordinates', async () => {
    const r = await ReactThreeTestRenderer.create(<CardMesh placement={p({ position: [1, 0, 2] })} onSelect={() => {}} />);
    const group = r.scene.children[0];
    expect(group.instance.position.x).toBeCloseTo(1);
    expect(group.instance.position.z).toBeCloseTo(2);
  });

  it('rotates a tapped card about Y', async () => {
    const r = await ReactThreeTestRenderer.create(<CardMesh placement={p({ tapped: true })} onSelect={() => {}} />);
    const group = r.scene.children[0];
    expect(Math.abs(group.instance.rotation.y)).toBeCloseTo(Math.PI / 2);
  });

  it('tilts every card up toward the camera for readability', async () => {
    const r = await ReactThreeTestRenderer.create(<CardMesh placement={p()} onSelect={() => {}} />);
    const group = r.scene.children[0];
    expect(group.instance.rotation.x).toBeCloseTo(CARD_TILT);
  });

  it('renders own cards at unit scale', async () => {
    const r = await ReactThreeTestRenderer.create(<CardMesh placement={p({ isOwn: true })} onSelect={() => {}} />);
    const group = r.scene.children[0];
    expect(group.instance.scale.x).toBeCloseTo(1);
  });

  it('scales opponent cards up to stay readable at distance', async () => {
    const r = await ReactThreeTestRenderer.create(<CardMesh placement={p({ isOwn: false })} onSelect={() => {}} />);
    const group = r.scene.children[0];
    expect(group.instance.scale.x).toBeCloseTo(OPPONENT_SCALE);
  });

  it('fires onSelect with the id when clicked', async () => {
    const onSelect = vi.fn();
    const r = await ReactThreeTestRenderer.create(<CardMesh placement={p()} onSelect={onSelect} />);
    const mesh = r.scene.findAll((n) => n.type === 'Mesh').find((m) => (m.instance.userData as { id?: string }).id === 'c1')!;
    await r.fireEvent(mesh, 'click');
    expect(onSelect).toHaveBeenCalledWith('c1');
  });
});
