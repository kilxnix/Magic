const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;

/** Split a mana cost like "{2}{G}{G}" into ordered pip tokens ["2","G","G"]. */
export function parseManaPips(manaCost: string): string[] {
  if (!manaCost) return [];
  const out: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(manaCost)) !== null) out.push(m[1]);
  return out;
}

/** Distinct colored mana symbols (WUBRG) present in the cost, in WUBRG order. */
export function colorIdentityFromManaCost(manaCost: string): string[] {
  const present = new Set<string>();
  for (const pip of parseManaPips(manaCost)) {
    for (const c of WUBRG) if (pip.includes(c)) present.add(c);
  }
  return WUBRG.filter((c) => present.has(c));
}
