// Phase 4 (parser-first): oracle_text tokenizer (v0)

/** Tokenizer output (v0): normalized string tokens. */
export type OracleToken = string;

// Matches one-or-more consecutive mana symbols like "{1}{R}" as a single chunk.
const MANA_CHUNK_RE = /\{[^}]+\}(?:\{[^}]+\})*/g;

// Punctuation we want as standalone tokens.
const PUNCT_RE = /([(),.:;])/g;

// Includes Unicode em dash / en dash.
const DASHES_RE = /([—–-])/g;

export function tokenizeOracleText(oracleText: string): OracleToken[] {
  // Lowercase normalization (preserve numbers and braces).
  let s = oracleText.toLowerCase();

  // Preserve mana chunks by temporary placeholders.
  const manaChunks: string[] = [];
  s = s.replace(MANA_CHUNK_RE, (m) => {
    const idx = manaChunks.push(m) - 1;
    return `__mana_${idx}__`;
  });

  // Split punctuation and parentheses.
  s = s.replace(PUNCT_RE, ' $1 ');

  // Split dashes (including em dash) as standalone tokens.
  s = s.replace(DASHES_RE, ' $1 ');

  // Collapse whitespace.
  const raw = s.split(/\s+/).filter(Boolean);

  // Restore mana chunks.
  return raw.map(tok => {
    const match = tok.match(/^__mana_(\d+)__$/);
    if (!match) return tok;
    const idx = Number(match[1]);
    return manaChunks[idx] ?? tok;
  });
}
