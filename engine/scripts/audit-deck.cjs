// Audit a specific deck list against the parser: per-card parse status.
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => {
  const s = fs.readFileSync(f, 'utf8');
  m._compile(ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, moduleResolution: ts.ModuleResolutionKind.Node10 } }).outputText, f);
};
const { parseOracleText } = require('../src/effects/parser.ts');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const deck = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const names = [deck.commander, ...deck.cards].filter(Boolean);
const db = new Map();
for (const line of fs.readFileSync(path.join(__dirname, '../../mtg_data/cards_min.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  db.set(c.name, c);
}

const results = { parsed: [], unparsed: [], missing: [] };
for (const name of names) {
  const card = db.get(name);
  if (!card) { results.missing.push(name); continue; }
  const faces = card.card_faces && card.card_faces.length ? card.card_faces : [card];
  let worst = null;
  let kinds = [];
  for (const face of faces) {
    const text = (face.oracle_text || '').trim();
    if (!text) continue;
    let norm = text.replace(new RegExp(escapeRe(card.name), 'g'), '~');
    if (face.name && face.name !== card.name) {
      norm = norm.replace(new RegExp(escapeRe(face.name), 'g'), '~');
    }
    let parsed;
    try { parsed = parseOracleText(norm.toLowerCase(), face.mana_cost || card.mana_cost || ''); }
    catch (e) { parsed = { kind: 'Error:' + e.message }; }
    const kind = parsed && parsed.kind ? parsed.kind : 'null';
    kinds.push(kind);
    if (kind === 'Unparsed' || kind.startsWith('Error')) worst = { face: face.name || name, kind, text: text.slice(0, 110) };
  }
  const typeLine = card.type_line || '';
  if (worst) results.unparsed.push({ name, ...worst, type: typeLine });
  else results.parsed.push(name + ' [' + kinds.join(',') + ']');
}
console.log('PARSED:', results.parsed.length, '| UNPARSED:', results.unparsed.length, '| MISSING:', results.missing.length);
console.log('\n--- UNPARSED ---');
for (const u of results.unparsed) console.log(`[${u.type.slice(0, 45)}] ${u.name}\n    ${u.text.replace(/\n/g, ' / ')}`);
for (const m of results.missing) console.log('MISSING:', m);
if (process.argv[3] === '--parsed') {
  console.log('\n--- PARSED ---');
  for (const p of results.parsed) console.log(' ', p);
}
