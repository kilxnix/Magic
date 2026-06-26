import type {
  GameView,
  CardView,
  PermanentView,
  HandCardView,
  LegalAction,
} from '../gameView.types';

export interface ObjectEntry {
  id: string;
  name: string;
  zone: CardView['zone'];
  legalActions: LegalAction[];
  power?: number;
  toughness?: number;
  counters?: Record<string, number>;
  tapped?: boolean;
}

function fromPermanent(p: PermanentView, zone: CardView['zone']): ObjectEntry {
  return {
    id: p.id,
    name: p.name,
    zone,
    legalActions: p.legalActions,
    power: p.power,
    toughness: p.toughness,
    counters: p.counters,
    tapped: p.tapped,
  };
}

function fromHand(c: HandCardView): ObjectEntry {
  return { id: c.id, name: c.name, zone: 'hand', legalActions: c.legalActions };
}

export function buildObjectIndex(view: GameView): Map<string, ObjectEntry> {
  const map = new Map<string, ObjectEntry>();
  const add = (e: ObjectEntry) => {
    if (!map.has(e.id)) map.set(e.id, e);
  };

  const y = view.you;
  [...y.creatures, ...y.artifacts, ...y.enchantments, ...y.lands, ...y.other].forEach((p) =>
    add(fromPermanent(p, 'battlefield')),
  );
  y.commandZone.forEach((p) => add(fromPermanent(p, 'command')));
  y.hand.forEach((c) => add(fromHand(c)));

  for (const opp of view.opponents) {
    [...opp.creatures, ...opp.lands, ...opp.other].forEach((p) => add(fromPermanent(p, 'battlefield')));
    opp.commandZone.forEach((p) => add(fromPermanent(p, 'command')));
  }

  return map;
}

export function toCardView(entry: ObjectEntry): CardView {
  const statuses: string[] = [];
  if (entry.tapped) statuses.push('Tapped');
  return {
    id: entry.id,
    name: entry.name,
    zone: entry.zone,
    power: entry.power,
    toughness: entry.toughness,
    counters: entry.counters,
    tapped: entry.tapped,
    statuses,
    legalActions: entry.legalActions,
  };
}
