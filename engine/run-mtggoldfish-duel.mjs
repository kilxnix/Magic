import { runGoldfishDuel } from './dist/tools/mtggoldfish_duel.js';

const { halfTurnsPlayed, log } = runGoldfishDuel();

console.log(`[mtggoldfish_duel] Half-turns played: ${halfTurnsPlayed}`);
console.log('[mtggoldfish_duel] Log (first 40 lines):');
for (const line of log.slice(0, 40)) console.log(line);

if (halfTurnsPlayed < 20) {
  console.error('[mtggoldfish_duel] ERROR: did not reach 20 half-turns');
  process.exit(1);
}

