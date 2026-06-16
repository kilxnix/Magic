// Phase 4 (parser-first): oracle_text tokenizer (v0)

/** Tokenizer output (v0): normalized string tokens. */
export type OracleToken = string;

// Matches one-or-more consecutive mana symbols like "{1}{R}" as a single chunk.
const MANA_CHUNK_RE = /\{[^}]+\}(?:\{[^}]+\})*/g;

// Punctuation we want as standalone tokens.
const PUNCT_RE = /([(),.:;])/g;

// Includes Unicode em dash / en dash.
const DASHES_RE = /([—–-])/g;

// P/T modification patterns like +1/+1, -3/-3, +2/+0 — preserve as single tokens
const PT_MOD_RE = /([+-]\d+\/[+-]\d+)/g;

/**
 * Strip parenthetical reminder text (CR 207.2 — reminder text has no rules
 * meaning). Depth-aware so nested parens are handled. Removing it lets matchers
 * see a card's real abilities instead of the rules restatement (e.g. Bestow
 * auras, keyword reminder text), and is always game-behavior-preserving.
 */
function stripReminderText(text: string): string {
  let result = '';
  let depth = 0;
  for (const char of text) {
    if (char === '(') { depth += 1; continue; }
    if (char === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) result += char;
  }
  // Collapse whitespace left behind by removed spans.
  return result.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

export function tokenizeOracleText(oracleText: string): OracleToken[] {
  // Lowercase normalization (preserve numbers and braces).
  let s = stripReminderText(oracleText).toLowerCase();

  // Preserve mana chunks by temporary placeholders.
  const manaChunks: string[] = [];
  s = s.replace(MANA_CHUNK_RE, (m) => {
    const idx = manaChunks.push(m) - 1;
    return `__mana_${idx}__`;
  });

  // Preserve P/T modification patterns before dash splitting.
  const ptChunks: string[] = [];
  s = s.replace(PT_MOD_RE, (m) => {
    const idx = ptChunks.push(m) - 1;
    return `__pt_${idx}__`;
  });

  // Split punctuation and parentheses.
  s = s.replace(PUNCT_RE, ' $1 ');

  // Split dashes (including em dash) as standalone tokens.
  s = s.replace(DASHES_RE, ' $1 ');

  // Collapse whitespace.
  const raw = s.split(/\s+/).filter(Boolean);

  // Restore mana chunks and P/T chunks.
  return raw.map(tok => {
    const manaMatch = tok.match(/^__mana_(\d+)__$/);
    if (manaMatch) {
      const idx = Number(manaMatch[1]);
      return manaChunks[idx] ?? tok;
    }
    const ptMatch = tok.match(/^__pt_(\d+)__$/);
    if (ptMatch) {
      const idx = Number(ptMatch[1]);
      return ptChunks[idx] ?? tok;
    }
    return tok;
  });
}
