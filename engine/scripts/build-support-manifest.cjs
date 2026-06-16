#!/usr/bin/env node

/**
 * build-support-manifest.cjs
 *
 * Per-card engine-support manifest for the MTG rules engine. This is a
 * LICENSING deliverable: bot integrators ask "is card X fully supported, and if
 * not, which clauses aren't?" and the answer must be backed by the EXACT same
 * honesty logic the coverage audit uses (engine/scripts/audit-parser-coverage.cjs).
 *
 * A card FACE counts as supported when:
 *   parseOracleText(normalizeOracleForParser(face.oracleText, face.selfNames)).kind !== 'Unparsed'
 *   OR it is cache-backed via isKeywordOnlyOracle / isEntryCounterOracle / isCacheBackedManaLand.
 * A CARD is supported iff EVERY non-empty face is supported. This crediting is
 * copied verbatim from the audit so the manifest's percentages agree with it.
 *
 * Reads  : ../mtg_data/cards_min.jsonl
 * Writes : ../mtg_data/card_support.json
 *
 * Output shape (a JSON object):
 *   {
 *     "_meta": {
 *       "generatedAt": <--generated-at arg, or "unset" placeholder; never Date.now()
 *                       so reruns are deterministic unless the arg changes>,
 *       "engineCoveragePercent": <parsedPercent from coverage/oracle-parser-coverage.json, or null>,
 *       "totalCards": N,
 *       "supportedCards": M,
 *       "source": "mtg_data/cards_min.jsonl"
 *     },
 *     "<card name>": {
 *       "supported": boolean,        // true iff every non-empty face is supported
 *       "viaOverride": boolean,      // getOverrideMetadata returned something
 *       "faces": [ { name, kind, supported, unsupportedText? } ],
 *       "knownManual": string|null   // set for Chaos Orb / Falling Star / Shahrazad
 *     }
 *   }
 *
 * The "_meta" key lives alongside the per-card map. Card names never collide
 * with "_meta" (no real Magic card is named "_meta").
 *
 * Usage:
 *   node scripts/build-support-manifest.cjs [--cards <path>] [--out <path>]
 *                                           [--coverage <path>] [--generated-at <iso>]
 *                                           [--all-cards] [--stdout]
 */

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const repoRoot = path.resolve(__dirname, '..', '..');
const { parseOracleText } = require('../src/effects/parser.ts');
const { getOverrideMetadata } = require('../src/effects/overrides.ts');
const { populateParsedCache } = require('../src/cards/card-parser-cache.ts');

// --- Crediting helpers, copied VERBATIM from audit-parser-coverage.cjs ---------
// (Do not "improve" these — they must match the audit so the percentages agree.)

/**
 * A mana LAND whose mana is produced by the authoritative cache path is
 * functionally complete even when parseOracleText doesn't recognize the worded
 * form. Restricted to lands so we never over-count creatures with incidental
 * mana plus other unparsed abilities.
 */
function isCacheBackedManaLand(card, face) {
  if (!/\bland\b/i.test(card.type_line || '')) return false;
  try {
    const def = populateParsedCache({
      id: card.id || card.name, name: card.name,
      oracle_text: face.oracleText, type_line: card.type_line || '',
      mana_cost: face.manaCost || '', cmc: card.cmc || 0,
      colors: card.colors || [], color_identity: card.color_identity || [],
      keywords: card.keywords || [], card_types: [],
    });
    return Boolean((def.manaProductions && def.manaProductions.length) || def.manaProduction);
  } catch {
    return false;
  }
}

const KNOWN_ENGINE_KEYWORDS = new Set([
  'deathtouch',
  'defender',
  'double strike',
  'first strike',
  'flash',
  'flying',
  'haste',
  'hexproof',
  'indestructible',
  'lifelink',
  'menace',
  'protection',
  'reach',
  'trample',
  'vigilance',
  'ward',
  'prowess',
]);

function stripReminderText(text) {
  let result = '';
  let depth = 0;
  for (const char of text) {
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) result += char;
  }
  return result;
}

function isKeywordOnlyOracle(text, cardKeywords = []) {
  const keywordSet = new Set([
    ...KNOWN_ENGINE_KEYWORDS,
    ...cardKeywords.map(keyword => String(keyword).toLowerCase()),
  ]);
  const cleaned = stripReminderText(text)
    .replace(/[.!]/g, '\n')
    .split(/\n+/)
    .map(line => line.trim().toLowerCase())
    .filter(Boolean);

  if (cleaned.length === 0) return false;
  return cleaned.every(line => {
    const parts = line
      .split(/\s*,\s*|\s+and\s+/)
      .map(part => part.trim())
      .filter(Boolean);
    return parts.length > 0 && parts.every(part => {
      const normalized = part.replace(/\s*\{[^}]+\}\s*$/, '').trim();
      return keywordSet.has(normalized);
    });
  });
}

function isEntryCounterOracle(text, manaCost) {
  if (/\benters(?: the battlefield)? with (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?: additional)? (?:[+\-]\d+\/[+\-]\d+|[a-z]+(?: [a-z]+)?) counters?\b/i.test(text)) {
    return true;
  }
  if (manaCost && /\{X\}/i.test(manaCost) &&
      /\benters(?: the battlefield)? with x(?: additional)? (?:[+\-]\d+\/[+\-]\d+|[a-z]+(?: [a-z]+)?) counters?\b/i.test(text)) {
    return true;
  }
  return false;
}

function cardFaces(card) {
  if (Array.isArray(card.card_faces) && card.card_faces.length > 0) {
    return card.card_faces
      .filter(face => face && typeof face.oracle_text === 'string' && face.oracle_text.trim())
      .map((face, index) => ({
        id: `${card.id || card.name}-face-${index}`,
        name: face.name ? `${card.name} // ${face.name}` : card.name,
        selfNames: [card.name, face.name].filter(Boolean),
        oracleText: face.oracle_text,
        manaCost: face.mana_cost ?? card.mana_cost,
      }));
  }
  return [{
    id: card.id || card.name,
    name: card.name,
    selfNames: [card.name].filter(Boolean),
    oracleText: card.oracle_text,
    manaCost: card.mana_cost,
  }];
}

function normalizeOracleForParser(oracleText, selfNames = []) {
  let text = oracleText;
  for (const name of selfNames) {
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, 'gi'), '~');
    const shortName = name.split(',')[0]?.trim();
    if (shortName && shortName.length >= 3 && shortName !== name) {
      const escapedShort = shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`\\b${escapedShort}\\b`, 'gi'), '~');
    }
  }
  return text;
}

// --- Manual-only cards -------------------------------------------------------
// Cards the engine deliberately does not automate (manual dexterity / subgames).
// These mirror frontend/src/lib/enginePreflight.ts ENGINE_UNSUPPORTED_CARD_REASONS;
// the manifest message is the single shared phrasing requested for the deliverable.
const KNOWN_MANUAL_CARDS = new Map([
  ['Chaos Orb', 'Manual dexterity / subgame not automated'],
  ['Falling Star', 'Manual dexterity / subgame not automated'],
  ['Shahrazad', 'Manual dexterity / subgame not automated'],
]);

// --- Argument parsing --------------------------------------------------------

function parseArgs(argv) {
  const args = {
    cards: path.join(repoRoot, 'mtg_data', 'cards_min.jsonl'),
    out: path.join(repoRoot, 'mtg_data', 'card_support.json'),
    coverage: path.join(repoRoot, 'engine', 'coverage', 'oracle-parser-coverage.json'),
    generatedAt: 'unset',
    commanderLegalOnly: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cards') args.cards = path.resolve(argv[++index]);
    else if (arg === '--out') args.out = path.resolve(argv[++index]);
    else if (arg === '--coverage') args.coverage = path.resolve(argv[++index]);
    else if (arg === '--generated-at') args.generatedAt = String(argv[++index]);
    else if (arg === '--commander-legal-only') args.commanderLegalOnly = true;
    else if (arg === '--all-cards') args.commanderLegalOnly = false;
    else if (arg === '--stdout') args.out = null;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node engine/scripts/build-support-manifest.cjs [options]

Options:
  --cards <path>          JSONL card source. Defaults to mtg_data/cards_min.jsonl.
  --out <path>            Output JSON path. Defaults to mtg_data/card_support.json.
  --coverage <path>       Coverage report to read parsedPercent from.
                          Defaults to engine/coverage/oracle-parser-coverage.json.
  --generated-at <str>    Value for _meta.generatedAt (deterministic; not Date.now()).
  --commander-legal-only  Only include Commander-legal cards (default: all cards).
  --all-cards             Include every card (default).
  --stdout                Print JSON instead of writing a file.
`);
}

function readJsonLines(cardsPath) {
  const content = fs.readFileSync(cardsPath, 'utf8');
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${cardsPath}:${index + 1}: ${error.message}`);
      }
    });
}

function readEngineCoveragePercent(coveragePath) {
  try {
    const raw = fs.readFileSync(coveragePath, 'utf8');
    const data = JSON.parse(raw);
    return typeof data.parsedPercent === 'number' ? data.parsedPercent : null;
  } catch {
    return null;
  }
}

// --- Core face classification (mirrors audit analyze loop) -------------------

function classifyFace(card, face) {
  const parsed = parseOracleText(normalizeOracleForParser(face.oracleText, face.selfNames));
  const isKeywordOnly = parsed.kind === 'Unparsed' && isKeywordOnlyOracle(face.oracleText, card.keywords || []);
  const isEntryCounters = parsed.kind === 'Unparsed' && isEntryCounterOracle(face.oracleText, face.manaCost);
  const isManaLand = parsed.kind === 'Unparsed' && !isKeywordOnly && !isEntryCounters
    && isCacheBackedManaLand(card, face);
  // Slice 2/12 (gap a): faces where ALL oracle lines were absorbed as unenforced
  // skips (e.g. "This creature enters prepared." + engine keywords) carry
  // absorbedKeywords on an Unparsed result. Credit these as AbsorbedOnly —
  // consistent with KeywordOnly: no fabricated benefits, pure honest skip.
  const isAbsorbedOnly = parsed.kind === 'Unparsed'
    && !isKeywordOnly && !isEntryCounters && !isManaLand
    && Array.isArray(parsed.absorbedKeywords) && parsed.absorbedKeywords.length > 0;
  const kind = isKeywordOnly ? 'KeywordOnly'
    : isEntryCounters ? 'EntryCounters'
    : isManaLand ? 'ManaAbility'
    : isAbsorbedOnly ? 'AbsorbedOnly'
    : parsed.kind;
  return { kind, supported: kind !== 'Unparsed' };
}

function normalizeLine(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function buildEntry(card) {
  // The audit only counts faces with non-empty oracle text. cardFaces() already
  // drops empty card_faces for multi-face cards; the only remaining empty case
  // is a single-face card with no oracle text (a vanilla permanent). Such a card
  // has nothing the engine must run, so it is trivially supported.
  const faces = [];
  let meaningfulCount = 0;
  let allMeaningfulSupported = true;

  for (const face of cardFaces(card)) {
    const hasText = Boolean((face.oracleText || '').trim());
    const { kind, supported } = classifyFace(card, face);
    const entry = { name: face.name, kind, supported };
    if (!supported) {
      entry.unsupportedText = normalizeLine(face.oracleText).slice(0, 200);
    }
    faces.push(entry);
    if (hasText) {
      meaningfulCount += 1;
      if (!supported) allMeaningfulSupported = false;
    }
  }

  // Supported iff EVERY non-empty face is supported (vacuously true with none).
  const supported = meaningfulCount === 0 ? true : allMeaningfulSupported;

  const override = getOverrideMetadata(card.id || '', card.name || '');
  const knownManual = KNOWN_MANUAL_CARDS.get(card.name) || null;

  return {
    // `supported` = the engine parses/runs every ability (parse-level honesty).
    // `playable` = the single safe boolean a bot integrator should gate on:
    // supported AND not a known-manual card (dexterity / sub-game). A card can
    // parse yet be un-botplayable (Chaos Orb), so `playable` is the conservative
    // answer; `supported` + `knownManual` give the breakdown.
    supported,
    playable: supported && !knownManual,
    viaOverride: Boolean(override),
    faces,
    knownManual,
  };
}

function build(args) {
  const cards = readJsonLines(args.cards);
  const manifest = {};
  let totalCards = 0;
  let supportedCards = 0;
  let playableCards = 0;

  for (const card of cards) {
    if (!card.name) continue;
    if (args.commanderLegalOnly && card.legalities?.commander !== 'legal') continue;
    // Keep the first printing for a given exact name (matches audit's per-card
    // pass; later duplicate printings would otherwise overwrite with identical
    // crediting anyway since support depends only on oracle text + type).
    if (Object.prototype.hasOwnProperty.call(manifest, card.name)) continue;

    const entry = buildEntry(card);
    manifest[card.name] = entry;
    totalCards += 1;
    if (entry.supported) supportedCards += 1;
    if (entry.playable) playableCards += 1;
  }

  const meta = {
    generatedAt: args.generatedAt,
    engineCoveragePercent: readEngineCoveragePercent(args.coverage),
    totalCards,
    supportedCards,
    playableCards,
    source: path.relative(repoRoot, args.cards).replaceAll(path.sep, '/'),
  };

  return { _meta: meta, ...manifest };
}

try {
  const args = parseArgs(process.argv);
  const manifest = build(args);
  const json = `${JSON.stringify(manifest, null, 0)}\n`;
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    const meta = manifest._meta;
    const pct = meta.totalCards ? ((meta.supportedCards / meta.totalCards) * 100).toFixed(2) : '0.00';
    console.log(`Wrote ${path.relative(repoRoot, args.out)}`);
    console.log(`  cards: ${meta.totalCards}, supported: ${meta.supportedCards} (${pct}%), engineCoveragePercent: ${meta.engineCoveragePercent}`);
  } else {
    process.stdout.write(json);
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
}
