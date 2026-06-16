import type { SimpleCard, SimplePlayer, OpponentGlance, OpponentFlag } from '../gameView.types';

/**
 * Table-threat heuristic: a board whose creatures sum to this much power (or more)
 * is flagged as a threat for the "can they kill someone?" read.
 */
export const TABLE_THREAT_POWER = 10;

function isCreature(card: SimpleCard): boolean {
  return card.cardTypes.includes('creature');
}

function isLand(card: SimpleCard): boolean {
  return card.cardTypes.includes('land');
}

/**
 * Detects a permanent that can produce mana by activating a tap ability.
 * We only have the SimpleCard (no engine manaProduction), so we read the oracle
 * text for a tap-based "Add {…}" ability — the shape every mana rock/dork/land uses.
 */
function isManaSource(card: SimpleCard): boolean {
  if (isLand(card)) return true;
  const text = (card.oracleText || '').toLowerCase();
  if (!text.includes('add ')) return false;
  // Require a tap symbol so static "add" wording in unrelated text doesn't match.
  return text.includes('{t}');
}

/**
 * Counts mana an opponent could produce right now: untapped lands + untapped
 * non-land mana sources. This is the single most important opponent read
 * ("can they respond?"), so it is genuinely-new, thoroughly-tested math.
 */
export function openManaForBattlefield(battlefield: SimpleCard[]): number {
  return battlefield.filter(card => !card.tapped && isManaSource(card)).length;
}

export interface OpponentGlanceInput {
  player: SimplePlayer;
  battlefield: SimpleCard[];
  /**
   * The human's commanderDamage map (keyed by the opponent's commander INSTANCE
   * id, per Player.commanderDamage). Optional — when absent, damage reads 0.
   */
  humanCommanderDamage?: Record<string, number>;
  /** Optional contextual note (e.g. "2 untapped blockers") surfaced during your attack. */
  contextNote?: string;
}

export function opponentGlance(input: OpponentGlanceInput): OpponentGlance {
  const { player, battlefield, humanCommanderDamage, contextNote } = input;

  const creatures = battlefield.filter(isCreature);
  const creatureCount = creatures.length;
  const totalPower = creatures.reduce((sum, card) => sum + (card.power ?? 0), 0);
  const openMana = openManaForBattlefield(battlefield);

  const commanderInstanceIds = new Set(
    battlefield.filter(card => card.isCommander).map(card => card.instanceId),
  );
  const commanderOut = commanderInstanceIds.size > 0;

  // Commander damage this opponent has dealt to the human, summed over the
  // opponent's commander instances currently identifiable on the battlefield.
  let commanderDamageToYou = 0;
  if (humanCommanderDamage) {
    for (const instanceId of commanderInstanceIds) {
      commanderDamageToYou += humanCommanderDamage[instanceId] ?? 0;
    }
  }

  const flags: OpponentFlag[] = [];
  if (commanderOut) flags.push('commander-out');
  if (totalPower >= TABLE_THREAT_POWER) flags.push('table-threat');

  return {
    playerId: player.id,
    name: player.name,
    life: player.life,
    commanderDamageToYou,
    handCount: player.handCount,
    openMana,
    creatureCount,
    totalPower,
    flags,
    contextNote,
  };
}
