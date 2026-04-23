import type { GameState, CardDefinition, CardInstance, Phase, Step } from '../types';
import { createPlayer, emptyManaPool } from '../types';

export interface MakeTestStateOpts {
  handLands?: number;
  landAlreadyPlayed?: boolean;
  phase?: Phase;
  step?: Step;
  activePlayerIndex?: number;
  priorityPlayerIndex?: number;
  battlefieldLands?: number;
  tapLands?: boolean;
}

function stepForPhase(phase: Phase): Step {
  switch (phase) {
    case 'beginning': return 'untap';
    case 'precombat_main': return 'begin_combat';
    case 'combat': return 'declare_attackers';
    case 'postcombat_main': return 'end_of_combat';
    case 'ending': return 'end';
    default: return 'begin_combat';
  }
}

export function makeTestState(opts: MakeTestStateOpts): GameState {
  const phase = opts.phase ?? 'precombat_main';
  const step = opts.step ?? stepForPhase(phase);
  const activePlayerIndex = opts.activePlayerIndex ?? 0;
  const priorityPlayerIndex = opts.priorityPlayerIndex ?? 0;
  const handLands = opts.handLands ?? 0;

  const humanPlayer = createPlayer('human', 'Human');
  const ai1Player = createPlayer('ai1', 'AI 1');

  if (opts.landAlreadyPlayed) {
    humanPlayer.hasPlayedLand = true;
  }

  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  // Forest definition
  const forestDefId = 'def_forest';
  const needForestDef = (handLands > 0) || ((opts.battlefieldLands ?? 0) > 0);
  if (needForestDef) {
    const forestDef: CardDefinition = {
      id: forestDefId,
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
      mana_cost: '',
      cmc: 0,
      colors: [],
      color_identity: ['G'],
      keywords: [],
      card_types: ['land'],
    };
    cardDefinitions.set(forestDefId, forestDef);

    for (let i = 0; i < handLands; i++) {
      const instanceId = `land_${i}`;
      const instance: CardInstance = {
        instanceId,
        definitionId: forestDefId,
        ownerId: 'human',
        zone: 'hand',
        tapped: false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      };
      cards.set(instanceId, instance);
    }

    const battlefieldLands = opts.battlefieldLands ?? 0;
    for (let i = 0; i < battlefieldLands; i++) {
      const instanceId = `bf_land_${i}`;
      const instance: CardInstance = {
        instanceId,
        definitionId: forestDefId,
        ownerId: 'human',
        zone: 'battlefield',
        tapped: opts.tapLands ?? false,
        summoningSick: false,
        counters: {},
        damage: 0,
        isCommander: false,
      };
      cards.set(instanceId, instance);
    }
  }

  const players = [humanPlayer, ai1Player];

  return {
    players,
    cards,
    cardDefinitions,
    activePlayerIndex,
    priorityPlayerIndex,
    phase,
    step,
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}
