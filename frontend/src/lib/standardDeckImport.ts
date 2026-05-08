import { validateConstructedSideboardConfiguration } from './sideboard';

export interface LocalStandardDeckImportResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  mainDeck: string[];
  sideboard: string[];
  total: number;
}

const SKIP_SECTION_HEADERS = new Set(['companion', 'considering', 'maybeboard', 'tokens']);
const MAIN_SECTION_HEADERS = new Set(['deck', 'main', 'mainboard']);

function stripSetCode(name: string): string {
  return name.replace(/\s*\([^)]+\)\s*.*$/, '').trim();
}

function parseDeckLine(line: string): { quantity: number; name: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const quantityMatch = trimmed.match(/^(\d+)\s*[xX]?\s+(.+)$/);
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
  let currentZone: 'main' | 'sideboard' = 'main';
  let skippingSection = false;

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    const lower = line.replace(/:$/, '').toLowerCase();
    if (lower === 'sideboard') {
      currentZone = 'sideboard';
      skippingSection = false;
      continue;
    }
    if (MAIN_SECTION_HEADERS.has(lower)) {
      currentZone = 'main';
      skippingSection = false;
      continue;
    }
    if (SKIP_SECTION_HEADERS.has(lower)) {
      skippingSection = true;
      continue;
    }
    if (skippingSection) continue;

    let explicitSideboard = false;
    if (/^SB:\s*/i.test(line)) {
      explicitSideboard = true;
      line = line.replace(/^SB:\s*/i, '').trim();
    }

    const parsed = parseDeckLine(line);
    if (!parsed || !parsed.name || parsed.quantity <= 0) continue;

    const target = explicitSideboard || currentZone === 'sideboard' ? sideboard : mainDeck;
    for (let i = 0; i < parsed.quantity; i += 1) {
      target.push(parsed.name);
    }
  }

  const validation = validateConstructedSideboardConfiguration(mainDeck, sideboard);

  return {
    valid: validation.valid,
    errors: validation.errors,
    warnings: [],
    mainDeck,
    sideboard,
    total: mainDeck.length,
  };
}
