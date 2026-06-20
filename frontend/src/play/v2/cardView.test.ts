import { describe, expect, it } from 'vitest';
import { cardViewFromPermanent, cardViewFromZone } from './cardView';
import type { PermanentView, ZoneCardView } from '../gameView.types';

describe('cardView adapters', () => {
  it('builds a CardView from a battlefield permanent with live state + status chips', () => {
    const perm: PermanentView = {
      id: 'i1', name: 'Avenger of Zendikar', tapped: false, power: 5, toughness: 5,
      counters: { '+1/+1': 2 }, isLand: false, isCreature: true, isAttacking: true, legalActions: [],
    };
    const cv = cardViewFromPermanent(perm, 'battlefield');
    expect(cv).toMatchObject({ id: 'i1', name: 'Avenger of Zendikar', zone: 'battlefield', power: 5, isAttacking: true });
    expect(cv.statuses).toContain('Attacking');
  });
  it('builds a CardView from a graveyard ZoneCardView', () => {
    const z: ZoneCardView = { id: 'g1', name: 'Eternal Witness', legalActions: [] };
    const cv = cardViewFromZone(z, 'graveyard');
    expect(cv).toMatchObject({ id: 'g1', name: 'Eternal Witness', zone: 'graveyard' });
    expect(cv.statuses).toEqual([]);
  });
});
