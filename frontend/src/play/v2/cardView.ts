import type {
  CardView, CardZone, PermanentView, HandCardView, ZoneCardView, StackItemView,
} from '../gameView.types';

function permStatuses(p: PermanentView): string[] {
  const s: string[] = [];
  if (p.tapped) s.push('Tapped');
  if (p.isAttacking) s.push('Attacking');
  if (p.isBlocking) s.push('Blocking');
  for (const [k, n] of Object.entries(p.counters ?? {})) if (n) s.push(`${n}× ${k}`);
  return s;
}

export function cardViewFromPermanent(p: PermanentView, zone: CardZone): CardView {
  return {
    id: p.id, name: p.name, zone, power: p.power, toughness: p.toughness,
    counters: p.counters, tapped: p.tapped, isAttacking: p.isAttacking, isBlocking: p.isBlocking,
    statuses: permStatuses(p), legalActions: p.legalActions,
  };
}

export function cardViewFromHand(h: HandCardView): CardView {
  return { id: h.id, name: h.name, zone: 'hand', statuses: [], legalActions: h.legalActions };
}

export function cardViewFromZone(z: ZoneCardView, zone: CardZone): CardView {
  return { id: z.id, name: z.name, zone, statuses: [], legalActions: z.legalActions };
}

export function cardViewFromStack(s: StackItemView): CardView {
  return { id: s.id, name: s.title, zone: 'stack', statuses: [s.description].filter(Boolean), legalActions: [] };
}
