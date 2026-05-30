import type { CardType } from './types';

export type TypeLineSection = 'supertypes' | 'types' | 'subtypes';

const KNOWN_TYPES = new Set<CardType>([
  'artifact',
  'battle',
  'creature',
  'enchantment',
  'instant',
  'land',
  'planeswalker',
  'sorcery',
]);
const CARD_TYPE_ORDER: CardType[] = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'];

function normalizeTypeLineDashes(typeLine: string): string {
  return typeLine
    .replace(/\u2013|\u2014|-/g, ' -- ')
    .replace(/\u00e2\u20ac[\u201c\u201d]/g, ' -- ');
}

function normalizeTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function typeLineSectionTerms(typeLine: string, section: TypeLineSection): string[] {
  const [leftRaw, rightRaw = ''] = normalizeTypeLineDashes(typeLine).split(/\s+--\s+/);
  const left = leftRaw || '';
  const right = rightRaw || '';

  if (section === 'subtypes') {
    return right
      .split(/\s+/)
      .map(normalizeTerm)
      .filter(Boolean);
  }

  const terms = left
    .split(/\s+/)
    .map(normalizeTerm)
    .filter(Boolean);

  return section === 'types'
    ? terms.filter(term => KNOWN_TYPES.has(term as CardType))
    : terms.filter(term => !KNOWN_TYPES.has(term as CardType));
}

export function parseCardTypesFromTypeLine(typeLine: string): CardType[] {
  const terms = new Set(typeLineSectionTerms(typeLine, 'types') as CardType[]);
  return CARD_TYPE_ORDER.filter(type => terms.has(type));
}

export function typeLineHasType(typeLine: string, type: string): boolean {
  return typeLineSectionTerms(typeLine, 'types').includes(normalizeTerm(type));
}

export function typeLineHasSupertype(typeLine: string, supertype: string): boolean {
  return typeLineSectionTerms(typeLine, 'supertypes').includes(normalizeTerm(supertype));
}

export function typeLineHasSubtype(typeLine: string, subtype: string): boolean {
  const terms = typeLineSectionTerms(typeLine, 'subtypes');
  const wanted = normalizeTerm(subtype);
  if (terms.includes(wanted)) return true;
  return new RegExp(`(^|\\s)${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(terms.join(' '));
}
