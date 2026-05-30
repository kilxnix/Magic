export type TypeLineSection = 'supertypes' | 'types' | 'subtypes';

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
  const knownTypes = new Set(['artifact', 'battle', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery']);

  return section === 'types'
    ? terms.filter(term => knownTypes.has(term))
    : terms.filter(term => !knownTypes.has(term));
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
