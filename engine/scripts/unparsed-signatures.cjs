#!/usr/bin/env node
// Cluster unparsed oracle faces by a structural signature to surface the
// highest-leverage concrete patterns to implement next.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, moduleResolution: ts.ModuleResolutionKind.Node10 },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const repoRoot = path.resolve(__dirname, '..', '..');
const { parseOracleText } = require('../src/effects/parser.ts');

function stripReminder(text) {
  let out = '', depth = 0;
  for (const c of text) { if (c === '(') depth++; else if (c === ')') depth = Math.max(0, depth - 1); else if (depth === 0) out += c; }
  return out;
}
function normalizeSelf(oracle, names) {
  let t = oracle;
  for (const name of names) {
    if (!name) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(esc, 'gi'), '~');
    const short = name.split(',')[0]?.trim();
    if (short && short.length >= 3 && short !== name) t = t.replace(new RegExp(`\\b${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '~');
  }
  return t;
}
function faces(card) {
  if (Array.isArray(card.card_faces) && card.card_faces.length) {
    return card.card_faces.filter(f => f && typeof f.oracle_text === 'string' && f.oracle_text.trim())
      .map(f => ({ name: f.name ? `${card.name} // ${f.name}` : card.name, selfNames: [card.name, f.name].filter(Boolean), oracleText: f.oracle_text }));
  }
  return [{ name: card.name, selfNames: [card.name].filter(Boolean), oracleText: card.oracle_text }];
}

// Build a signature: take the first sentence, lowercase, strip reminder, and
// abstract away specifics (numbers, mana, card names, counter types) so the same
// structural pattern collapses to one bucket.
function signature(text) {
  let s = stripReminder(text).split(/(?<=[.])\s/)[0] || text; // first sentence
  s = s.toLowerCase().trim();
  s = s.replace(/\{[^}]+\}/g, '{M}');
  s = s.replace(/[+-]\d+\/[+-]\d+/g, 'P/T');
  s = s.replace(/\b\d+\b/g, 'N');
  s = s.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|a|an|x)\b/g, 'N');
  s = s.replace(/~/g, 'SELF');
  s = s.replace(/\s+/g, ' ').trim();
  // Keep first ~10 words so long unique tails collapse.
  return s.split(' ').slice(0, 9).join(' ');
}

const content = fs.readFileSync(path.join(repoRoot, 'mtg_data', 'cards_min.jsonl'), 'utf8');
const cards = content.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
const sigCount = new Map();
const sigSample = new Map();
let unparsed = 0;
for (const card of cards) {
  if (card.legalities?.commander !== 'legal') continue;
  for (const face of faces(card)) {
    if (!face.oracleText) continue;
    const parsed = parseOracleText(normalizeSelf(face.oracleText, face.selfNames));
    if (parsed.kind !== 'Unparsed') continue;
    unparsed++;
    const sig = signature(face.oracleText);
    sigCount.set(sig, (sigCount.get(sig) || 0) + 1);
    if (!sigSample.has(sig)) sigSample.set(sig, `${face.name}: ${face.oracleText.replace(/\s+/g, ' ').slice(0, 150)}`);
  }
}
const sorted = [...sigCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
console.log(`Total unparsed faces: ${unparsed}\nTop ${sorted.length} structural signatures:\n`);
for (const [sig, n] of sorted) {
  console.log(`${String(n).padStart(4)}  ${sig}`);
  console.log(`      e.g. ${sigSample.get(sig)}`);
}
