export function cleanDeckListCardName(raw: string): string {
  let name = raw
    .replace(/\s+#.*$/, '')
    .replace(/^[*-]\s*/, '')
    .trim();

  const quantityMatch = name.match(/^(\d+)\s*[xX]?\s*(?:\[[^\]]+\]\s*)?(.+)$/);
  if (quantityMatch) name = quantityMatch[2].trim();

  while (true) {
    const cleaned = name.replace(/\s+\*[^*]+\*\s*$/g, '').trim();
    if (cleaned === name) break;
    name = cleaned;
  }

  return name
    .replace(/\s+\[[^\]]+\](?:\s+\S+)?$/, '')
    .replace(/\s+\([^)]+\).*$/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function quantityForDeckLine(line: string): number {
  const match = line.trim().match(/^(\d+)\s*[xX]?\s+/);
  return match ? Number(match[1]) : 1;
}

function commanderNameSet(commanderName: string): Set<string> {
  return new Set(
    commanderName
      .split(/\s*(?:\/|;|\n|\r|\+|&)\s*/)
      .map(name => cleanDeckListCardName(name).toLowerCase())
      .filter(Boolean),
  );
}

export function parseRoomDeckList(value: string, commanderName: string): string[] {
  const cards: string[] = [];
  const commanderNames = commanderNameSet(commanderName);
  let section: 'main' | 'commander' | 'ignore' = 'main';

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine
      .replace(/\s+#.*$/, '')
      .replace(/^[*-]\s*/, '')
      .trim();
    if (!line) continue;

    const header = line.replace(/:$/, '').toLowerCase();
    if (['commander', 'commanders', 'command zone'].includes(header)) {
      section = 'commander';
      continue;
    }
    if (['deck', 'main', 'main deck'].includes(header)) {
      section = 'main';
      continue;
    }
    if (['sideboard', 'maybeboard', 'considering', 'companion'].includes(header)) {
      section = 'ignore';
      continue;
    }

    if (section === 'ignore') continue;
    if (section === 'commander' || /\*CMDR\*/i.test(line)) continue;

    const quantity = quantityForDeckLine(line);
    const name = cleanDeckListCardName(line);
    if (!name || commanderNames.has(name.toLowerCase())) continue;
    for (let i = 0; i < Math.min(quantity, 120); i += 1) {
      cards.push(name);
    }
  }
  return cards.slice(0, 120);
}
