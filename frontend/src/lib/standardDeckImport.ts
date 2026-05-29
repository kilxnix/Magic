import { validateConstructedSideboardConfiguration } from './sideboard';

export interface LocalStandardDeckImportResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  mainDeck: string[];
  sideboard: string[];
  total: number;
}

const MAX_CARD_LINE_QUANTITY = 250;
const MAX_IMPORTED_CARD_ENTRIES = 300;

const SKIP_SECTION_HEADERS = new Set([
  'companion',
  'companions',
  'considering',
  'maybeboard',
  'maybe board',
  'tokens',
  'token',
  'attractions',
  'stickers',
]);
const MAIN_SECTION_HEADERS = new Set(['deck', 'main', 'main deck', 'mainboard']);
const SIDEBOARD_SECTION_HEADERS = new Set(['sideboard', 'side board']);
const CATEGORY_SECTION_HEADERS = new Set([
  'artifacts',
  'battles',
  'creatures',
  'enchantments',
  'instants',
  'lands',
  'nonlands',
  'planeswalkers',
  'sorceries',
  'spells',
]);

function stripInlineComment(line: string): string {
  return line.replace(/\s+#.*$/, '').trim();
}

function normalizeSectionHeader(line: string): string {
  return stripInlineComment(line)
    .trim()
    .replace(/:$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+\d+\s*(cards?)?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isMetadataLine(line: string): boolean {
  const header = normalizeSectionHeader(line);
  if (!header) return true;
  if (['about', 'card', 'cards', 'decklist', 'export', 'overview'].includes(header)) return true;
  if (/^(name|format|author|owner|created|updated|last modified)\s*[:：]/i.test(line)) return true;
  if (/^name\s+\S+/i.test(line)) return true;
  return /^\d+\s+(cards?|mainboard|sideboard|maybeboard)\b/i.test(header);
}

function stripSetCode(name: string): string {
  let cleanName = stripInlineComment(name)
    .replace(/^[*-]\s*/, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .trim();

  while (/\s+\*[^*]+\*\s*$/.test(cleanName)) {
    cleanName = cleanName.replace(/\s+\*[^*]+\*\s*$/, '').trim();
  }

  cleanName = cleanName.replace(/\s+\[[A-Za-z0-9_.:-]+\](?:\s+\S+)?$/, '').trim();
  return cleanName.replace(/\s*\([^)]+\)\s*.*$/, '').trim();
}

function parseDeckLine(line: string): { quantity: number; name: string } | null {
  const trimmed = stripInlineComment(line).replace(/^[*-]\s*/, '').trim();
  if (!trimmed) return null;

  const quantityMatch = trimmed.match(/^(\d+)\s*[xX]?\s*(?:\[[^\]]+\]\s*)?(.+)$/);
  if (quantityMatch) {
    return {
      quantity: Number(quantityMatch[1]),
      name: stripSetCode(quantityMatch[2]),
    };
  }

  return { quantity: 1, name: stripSetCode(trimmed) };
}

export function importStandardDeckLocally(text: string): LocalStandardDeckImportResult {
  const mainDeck: string[] = [];
  const sideboard: string[] = [];
  const parseErrors: string[] = [];
  let currentZone: 'main' | 'sideboard' = 'main';
  let skippingSection = false;
  let truncatedEntries = false;

  function totalEntries(): number {
    return mainDeck.length + sideboard.length;
  }

  function appendCards(target: string[], quantity: number, name: string): void {
    if (quantity <= 0) return;

    let safeQuantity = quantity;
    if (quantity > MAX_CARD_LINE_QUANTITY) {
      parseErrors.push(`Quantity for '${name}' is ${quantity}; capped at ${MAX_CARD_LINE_QUANTITY}`);
      safeQuantity = MAX_CARD_LINE_QUANTITY;
    }

    const remaining = MAX_IMPORTED_CARD_ENTRIES - totalEntries();
    if (remaining <= 0) {
      if (!truncatedEntries) {
        parseErrors.push(`Decklist has more than ${MAX_IMPORTED_CARD_ENTRIES} card entries; extra lines were ignored`);
        truncatedEntries = true;
      }
      return;
    }

    if (safeQuantity > remaining) {
      if (!truncatedEntries) {
        parseErrors.push(`Decklist has more than ${MAX_IMPORTED_CARD_ENTRIES} card entries; extra lines were ignored`);
        truncatedEntries = true;
      }
      safeQuantity = remaining;
    }

    for (let i = 0; i < safeQuantity; i += 1) {
      target.push(name);
    }
  }

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim().replace(/^\uFEFF/, '');
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    line = stripInlineComment(line);
    if (!line) continue;

    const header = normalizeSectionHeader(line);
    if (SIDEBOARD_SECTION_HEADERS.has(header)) {
      currentZone = 'sideboard';
      skippingSection = false;
      continue;
    }
    if (MAIN_SECTION_HEADERS.has(header)) {
      currentZone = 'main';
      skippingSection = false;
      continue;
    }
    if (SKIP_SECTION_HEADERS.has(header)) {
      skippingSection = true;
      continue;
    }
    if (CATEGORY_SECTION_HEADERS.has(header) || isMetadataLine(line)) {
      continue;
    }
    if (skippingSection) continue;

    let explicitSideboard = false;
    if (/^(SB|Sideboard)\s*:?\s+/i.test(line)) {
      explicitSideboard = true;
      line = line.replace(/^(SB|Sideboard)\s*:?\s+/i, '').trim();
    }

    const parsed = parseDeckLine(line);
    if (!parsed || !parsed.name || parsed.quantity <= 0) continue;

    const target = explicitSideboard || currentZone === 'sideboard' ? sideboard : mainDeck;
    appendCards(target, parsed.quantity, parsed.name);
  }

  const validation = validateConstructedSideboardConfiguration(mainDeck, sideboard);
  const errors = [...parseErrors, ...validation.errors];

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    mainDeck,
    sideboard,
    total: mainDeck.length,
  };
}
