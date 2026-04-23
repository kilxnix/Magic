import type { GameState, CardDefinition, CardInstance, Phase, Step, ManaPool } from '../types';
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
  handInstant?: string;
  handSorcery?: string;
  manaPool?: Partial<ManaPool>;
  battlefieldCreatureWithAbility?: boolean;
  summoningSick?: boolean;
  tapCreatures?: boolean;
  battlefieldCreature?: boolean;
  handEquipment?: boolean;
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

  if (opts.manaPool) {
    humanPlayer.manaPool = { ...emptyManaPool(), ...opts.manaPool };
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

  // Instant card in hand
  if (opts.handInstant !== undefined) {
    const instantDefId = 'def_test_instant';
    const instantDef: CardDefinition = {
      id: instantDefId,
      name: 'Test Instant',
      type_line: 'Instant',
      oracle_text: '',
      mana_cost: opts.handInstant,
      cmc: (opts.handInstant.match(/\{[^}]+\}/g) || []).length,
      colors: [],
      color_identity: [],
      keywords: [],
      card_types: ['instant'],
    };
    cardDefinitions.set(instantDefId, instantDef);
    const instanceId = 'instant_0';
    cards.set(instanceId, {
      instanceId,
      definitionId: instantDefId,
      ownerId: 'human',
      zone: 'hand',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
  }

  // Sorcery card in hand
  if (opts.handSorcery !== undefined) {
    const sorceryDefId = 'def_test_sorcery';
    const sorceryDef: CardDefinition = {
      id: sorceryDefId,
      name: 'Test Sorcery',
      type_line: 'Sorcery',
      oracle_text: '',
      mana_cost: opts.handSorcery,
      cmc: (opts.handSorcery.match(/\{[^}]+\}/g) || []).length,
      colors: [],
      color_identity: [],
      keywords: [],
      card_types: ['sorcery'],
    };
    cardDefinitions.set(sorceryDefId, sorceryDef);
    const instanceId = 'sorcery_0';
    cards.set(instanceId, {
      instanceId,
      definitionId: sorceryDefId,
      ownerId: 'human',
      zone: 'hand',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
  }

  // Creature with activated ability on battlefield
  if (opts.battlefieldCreatureWithAbility) {
    const creatureDefId = 'def_test_creature';
    const creatureDef: CardDefinition = {
      id: creatureDefId,
      name: 'Test Creature',
      type_line: 'Creature — Test',
      oracle_text: '{T}: ~ deals 1 damage to any target.',
      mana_cost: '{1}',
      cmc: 1,
      colors: [],
      color_identity: [],
      keywords: [],
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    };
    cardDefinitions.set(creatureDefId, creatureDef);
    const instanceId = 'creature_0';
    cards.set(instanceId, {
      instanceId,
      definitionId: creatureDefId,
      ownerId: 'human',
      zone: 'battlefield',
      tapped: opts.tapCreatures ?? false,
      summoningSick: opts.summoningSick ?? false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
  }

  // Generic 2/2 vanilla creature on battlefield
  if (opts.battlefieldCreature) {
    const vanillaDefId = 'def_vanilla_creature';
    if (!cardDefinitions.has(vanillaDefId)) {
      const vanillaDef: CardDefinition = {
        id: vanillaDefId,
        name: 'Vanilla Creature',
        type_line: 'Creature — Test',
        oracle_text: '',
        mana_cost: '{1}{G}',
        cmc: 2,
        colors: ['G'],
        color_identity: ['G'],
        keywords: [],
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      };
      cardDefinitions.set(vanillaDefId, vanillaDef);
    }
    const instanceId = 'vanilla_creature_0';
    cards.set(instanceId, {
      instanceId,
      definitionId: vanillaDefId,
      ownerId: 'human',
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
  }

  // Equipment card in hand
  if (opts.handEquipment) {
    const equipDefId = 'def_test_equipment';
    const equipDef: CardDefinition = {
      id: equipDefId,
      name: 'Test Equipment',
      type_line: 'Artifact — Equipment',
      oracle_text: 'Equipped creature gets +1/+1. Equip {1}.',
      mana_cost: '{1}',
      cmc: 1,
      colors: [],
      color_identity: [],
      keywords: [],
      card_types: ['artifact'],
    };
    cardDefinitions.set(equipDefId, equipDef);
    const instanceId = 'equipment_0';
    cards.set(instanceId, {
      instanceId,
      definitionId: equipDefId,
      ownerId: 'human',
      zone: 'hand',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
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
