#!/usr/bin/env node

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

function parseArgs(argv) {
  const args = {
    cards: path.join(repoRoot, 'mtg_data', 'cards_min.jsonl'),
    out: path.join(repoRoot, 'engine', 'coverage', 'oracle-parser-coverage.json'),
    commanderLegalOnly: true,
    maxSamples: 12,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cards') args.cards = path.resolve(argv[++index]);
    else if (arg === '--out') args.out = path.resolve(argv[++index]);
    else if (arg === '--all-cards') args.commanderLegalOnly = false;
    else if (arg === '--max-samples') args.maxSamples = Number.parseInt(argv[++index], 10);
    else if (arg === '--stdout') args.out = null;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.maxSamples) || args.maxSamples < 1) {
    throw new Error('--max-samples must be a positive integer');
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node engine/scripts/audit-parser-coverage.cjs [options]

Options:
  --cards <path>       JSONL card source. Defaults to mtg_data/cards_min.jsonl.
  --out <path>         JSON report path. Defaults to engine/coverage/oracle-parser-coverage.json.
  --stdout             Print JSON report instead of writing a file.
  --all-cards          Include non-Commander-legal cards.
  --max-samples <n>    Sample count per unparsed cluster. Defaults to 12.
`);
}

function normalizeLine(raw) {
  const text = String(raw || '').trim();
  return text.replace(/\s+/g, ' ');
}

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

function cardFaces(card) {
  if (Array.isArray(card.card_faces) && card.card_faces.length > 0) {
    return card.card_faces
      .filter(face => face && typeof face.oracle_text === 'string' && face.oracle_text.trim())
      .map((face, index) => ({
        id: `${card.id || card.name}-face-${index}`,
        name: face.name ? `${card.name} // ${face.name}` : card.name,
        oracleText: face.oracle_text,
      }));
  }
  return [{
    id: card.id || card.name,
    name: card.name,
    oracleText: card.oracle_text,
  }];
}

function classifySyntax(text) {
  const normalized = text.toLowerCase();
  const clusters = [];
  const add = (id, reason) => clusters.push({ id, reason });

  if (/\b(conjure|perpetual|perpetually|seek|boon|spellbook)\b/.test(normalized)) {
    add('digital-only', 'Alchemy/digital-only wording needs an explicit unsupported or emulated mechanic.');
  }
  if (/\bchoose (one|two|three|a|an|target|a card name|a creature type|a color|left or right)\b|\bsecretly choose\b/.test(normalized)) {
    add('choice-modal', 'Choice/modal/naming text should be prompt-backed instead of deterministic.');
  }
  if (/\bsearch (your|their|target player's|each player's)? ?library\b|\blook at the top\b|\breveal cards from the top\b/.test(normalized)) {
    add('library-selection', 'Library search/look/reveal effects need legal choices, destinations, reveal policy, and ordering.');
  }
  if (/\bif .* would\b|\binstead\b|\bprevent\b|\bskip\b|\bas .* enters\b|\benters tapped\b/.test(normalized)) {
    add('replacement-prevention', 'Replacement/prevention effects require replacement-layer handling.');
  }
  if (/\brather than pay\b|\badditional cost\b|\bcosts? .* less\b|\bcosts? .* more\b|\bwithout paying\b|\balternative cost\b|\bkicker\b|\bbuyback\b|\bflashback\b|\boverload\b|\bescape\b|\bdelve\b|\bconvoke\b|\bimprovise\b/.test(normalized)) {
    add('cost-system', 'Alternative/additional/reduced costs need prompt-backed payment and legality.');
  }
  if (/\bwhenever\b|\bwhen\b|\bat the beginning\b|\bat the end\b|\bdelayed\b|\buntil your next\b/.test(normalized)) {
    add('trigger-timing', 'Triggered or delayed triggered abilities need event registration and APNAP ordering.');
  }
  if (/\btoken\b|\bcounter\b|\bproliferate\b|\bpopulate\b|\bfood\b|\bclue\b|\btreasure\b|\bblood\b|\bmap\b/.test(normalized)) {
    add('tokens-counters', 'Token/counter wording needs typed objects, counters, and downstream interactions.');
  }
  if (/\battack\b|\bblock\b|\bcombat damage\b|\bdefending player\b|\beach opponent\b|\bplaneswalker\b|\bbattle\b/.test(normalized)) {
    add('combat-multiplayer', 'Combat or multiplayer-defender text needs combat/defender-aware execution.');
  }
  if (/\bcopy\b|\bstorm\b|\bcascade\b|\bdemonstrate\b|\brebound\b|\bcast the copy\b/.test(normalized)) {
    add('copy-stack', 'Copy/stack mechanics need stack-object identity and trigger multiplication.');
  }
  if (/\bfrom your graveyard\b|\bfrom exile\b|\bfrom outside the game\b|\bfrom your command zone\b|\bput .* into your graveyard\b/.test(normalized)) {
    add('non-hand-zones', 'Non-hand zone casting/movement needs zone permission and visibility checks.');
  }
  if (/\bd20\b|\bdie\b|\bcoin\b|\bdungeon\b|\binitiative\b|\bmonarch\b|\bsticker\b|\battraction\b|\bventure\b/.test(normalized)) {
    add('special-mechanics', 'Special mechanics need dedicated state and UI presentation.');
  }
  if (/\bbecomes?\b|\bbase power and toughness\b|\bgets [+-]\d\/[+-]\d|\bloses all abilities\b|\bgains? (flying|trample|haste|indestructible|hexproof|vigilance|lifelink|deathtouch)\b/.test(normalized)) {
    add('continuous-layers', 'Continuous effects need layer/timestamp/dependency handling.');
  }

  if (clusters.length === 0) {
    add('unclassified', 'Unparsed text did not match a known syntax cluster; inspect manually.');
  }
  return clusters;
}

function addSample(bucket, sample, maxSamples) {
  if (bucket.samples.length < maxSamples) bucket.samples.push(sample);
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

function analyze(args) {
  const cards = readJsonLines(args.cards);
  const kindCounts = {};
  const reasonCounts = {};
  const clusterMap = new Map();
  const overrideCards = [];
  const parsedSamples = [];
  const unparsedCards = [];
  let totalFaces = 0;
  let includedCards = 0;

  for (const card of cards) {
    if (args.commanderLegalOnly && card.legalities?.commander !== 'legal') continue;
    includedCards += 1;
    for (const face of cardFaces(card)) {
      if (!face.oracleText) continue;
      totalFaces += 1;
      const parsed = parseOracleText(face.oracleText);
      const isKeywordOnly = parsed.kind === 'Unparsed' && isKeywordOnlyOracle(face.oracleText, card.keywords || []);
      const parsedKind = isKeywordOnly ? 'KeywordOnly' : parsed.kind;
      kindCounts[parsedKind] = (kindCounts[parsedKind] || 0) + 1;

      const override = getOverrideMetadata(card.id || '', card.name || face.name || '');
      if (override) {
        overrideCards.push({
          name: card.name,
          reason: override.reason,
          owner: override.owner,
          fixtureCards: override.fixtureCards,
        });
      }

      if (parsedKind !== 'Unparsed') {
        if (parsedSamples.length < args.maxSamples) {
          parsedSamples.push({
            name: face.name,
            kind: parsedKind,
            text: normalizeLine(face.oracleText).slice(0, 240),
          });
        }
        continue;
      }

      const reason = parsed.reason || 'unparsed';
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      const sample = {
        name: face.name,
        set: card.set,
        reason,
        text: normalizeLine(face.oracleText).slice(0, 360),
      };
      unparsedCards.push(sample);
      for (const cluster of classifySyntax(face.oracleText)) {
        if (!clusterMap.has(cluster.id)) {
          clusterMap.set(cluster.id, { id: cluster.id, reason: cluster.reason, count: 0, samples: [] });
        }
        const bucket = clusterMap.get(cluster.id);
        bucket.count += 1;
        addSample(bucket, sample, args.maxSamples);
      }
    }
  }

  const unparsedCount = kindCounts.Unparsed || 0;
  const parsedCount = totalFaces - unparsedCount;
  const sortedReasons = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  const syntaxClusters = [...clusterMap.values()]
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

  return {
    generatedAt: new Date().toISOString(),
    source: path.relative(repoRoot, args.cards).replaceAll(path.sep, '/'),
    commanderLegalOnly: args.commanderLegalOnly,
    includedCards,
    totalOracleFaces: totalFaces,
    parsedFaces: parsedCount,
    unparsedFaces: unparsedCount,
    parsedPercent: totalFaces ? Number(((parsedCount / totalFaces) * 100).toFixed(2)) : 0,
    parsedKindCounts: Object.fromEntries(Object.entries(kindCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    unparsedReasons: sortedReasons,
    syntaxClusters,
    overrideCoverage: {
      matchedCards: overrideCards.length,
      samples: overrideCards.slice(0, args.maxSamples),
    },
    parsedSamples,
    unparsedSamples: unparsedCards.slice(0, args.maxSamples),
  };
}

try {
  const args = parseArgs(process.argv);
  const report = analyze(args);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    console.log(`Wrote ${path.relative(repoRoot, args.out)}`);
  } else {
    process.stdout.write(json);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
