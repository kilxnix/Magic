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
  // Normalize the supertypes/types <-> subtypes separator to ` -- `.
  //
  // The separator can appear as an em-dash (\u2014, U+2014), an en-dash
  // (\u2013, U+2013), a mojibake'd em-dash, or a plain ASCII hyphen (-).  Real
  // type lines render the ASCII separator with surrounding whitespace
  // ("Creature - Bear"), so we only treat a *whitespace-surrounded* hyphen as
  // the separator.
  //
  // Intra-word ASCII hyphens are deliberately left alone: they are part of
  // multi-word subtype names like "Assembly-Worker", "Half-Elf",
  // "Will-o'-the-Wisp", etc.  Because those hyphens have no surrounding
  // whitespace, the ` - ` rule never touches them.
  //
  // Slice 12: fixed pre-existing bug where `-` in hyphens-in-subtype-names
  // (e.g. "Creature \u2014 Assembly-Worker") was converted to ` -- `, causing
  // typeLineSectionTerms to split "Assembly-Worker" into two separate terms
  // and typeLineHasSubtype to fail for those cards.
  return typeLine
    .replace(/\u2013|\u2014/g, ' -- ')
    .replace(/\u00e2\u20ac[\u201c\u201d]/g, ' -- ')
    .replace(/\s+-\s+/g, ' -- ');
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
