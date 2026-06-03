import {
  advanceStep,
  allPlayersPassed,
  getPlayerView,
  getCardDefinition,
  initRoomGame,
  performUntapStep,
  resolveCombatDamage,
  resolveTopOfStack,
  createCardLookup,
  tryPassPriority,
  tryPlayLand,
  tryTapLandForMana,
  tryCastSpell,
  tryDeclareAttackers,
  tryDeclareBlockers,
  tryAdjustCounters,
  deserializeGameState,
  type GameState,
  type ManaCost,
  type ScryfallCard,
} from 'commander-engine';
import type { PendingRealGameAction, StartRealGamePayload } from './multiplayer';

interface CardDataFromApi {
  name: string;
  type_line: string;
  oracle_text: string;
  mana_cost: string;
  cmc: number;
  colors: string[];
  color_identity: string[];
  keywords: string[];
  power?: string | null;
  toughness?: string | null;
  layout?: string | null;
  card_faces?: Array<{
    name: string;
    type_line?: string | null;
    oracle_text?: string | null;
    mana_cost?: string | null;
    colors?: string[] | null;
    power?: string | null;
    toughness?: string | null;
  }> | null;
}

const BASIC_LANDS: Record<string, ScryfallCard> = {
  Plains: {
    id: 'basic-plains',
    name: 'Plains',
    type_line: 'Basic Land - Plains',
    oracle_text: '({T}: Add {W}.)',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['W'],
    keywords: [],
  },
  Island: {
    id: 'basic-island',
    name: 'Island',
    type_line: 'Basic Land - Island',
    oracle_text: '({T}: Add {U}.)',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['U'],
    keywords: [],
  },
  Swamp: {
    id: 'basic-swamp',
    name: 'Swamp',
    type_line: 'Basic Land - Swamp',
    oracle_text: '({T}: Add {B}.)',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['B'],
    keywords: [],
  },
  Mountain: {
    id: 'basic-mountain',
    name: 'Mountain',
    type_line: 'Basic Land - Mountain',
    oracle_text: '({T}: Add {R}.)',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['R'],
    keywords: [],
  },
  Forest: {
    id: 'basic-forest',
    name: 'Forest',
    type_line: 'Basic Land - Forest',
    oracle_text: '({T}: Add {G}.)',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
  },
};

function apiCardToScryfall(card: CardDataFromApi): ScryfallCard {
  return {
    id: `api-${card.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: card.colors,
    color_identity: card.color_identity,
    keywords: card.keywords,
    power: card.power ?? undefined,
    toughness: card.toughness ?? undefined,
    layout: card.layout ?? undefined,
    card_faces: card.card_faces?.map(face => ({
      name: face.name,
      type_line: face.type_line || undefined,
      oracle_text: face.oracle_text ?? undefined,
      mana_cost: face.mana_cost ?? undefined,
      colors: face.colors ?? undefined,
      power: face.power ?? undefined,
      toughness: face.toughness ?? undefined,
    })) ?? undefined,
  };
}

async function fetchCardLookup(names: string[]) {
  const uniqueNames = Array.from(new Set(names.filter(Boolean)));
  const cards: CardDataFromApi[] = [];
  for (let index = 0; index < uniqueNames.length; index += 200) {
    const response = await fetch('/api/cards-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: uniqueNames.slice(index, index + 200) }),
    });
    if (!response.ok) {
      throw new Error(`Card lookup failed with ${response.status}`);
    }
    cards.push(...((await response.json()) as CardDataFromApi[]));
  }
  return createCardLookup([
    ...Object.values(BASIC_LANDS),
    ...cards.map(apiCardToScryfall),
  ]);
}

function roomCommanderLookupNames(commander: string | undefined): string[] {
  const raw = (commander || '').trim();
  if (!raw) return [];
  if (!raw.includes(' // ')) return [raw];
  const parts = raw.split(' // ').map(name => name.trim()).filter(Boolean);
  return Array.from(new Set([raw, ...parts]));
}

export async function createRoomEngineState(payload: StartRealGamePayload): Promise<GameState> {
  if (payload.engineState) {
    return deserializeGameState(payload.engineState as Parameters<typeof deserializeGameState>[0]);
  }
  const names = payload.players.flatMap(player => [
    ...roomCommanderLookupNames(player.deck.commander),
    ...player.deck.list,
  ]);
  const cardLookup = await fetchCardLookup(names);
  return initRoomGame({
    players: payload.players.map(player => ({
      id: player.id,
      name: player.name,
      deck: {
        id: `${payload.roomId}-${player.id}`,
        commander: player.deck.commander,
        list: player.deck.list,
        colors: player.deck.colors || [],
        bracket: 2,
        theme: 'room',
      },
    })),
    cardLookup,
    firstPlayerId: payload.firstPlayerId || undefined,
    startingLife: payload.startingLife || 40,
  });
}

export function createRoomScopedViews(state: GameState): Record<string, unknown> {
  return Object.fromEntries(state.players.map(player => [player.id, getPlayerView(state, player.id)]));
}

const ZERO_MANA_COST: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };

function cardName(state: GameState, cardInstanceId: string) {
  const card = state.cards.get(cardInstanceId);
  const definition = card ? getCardDefinition(state, card) : undefined;
  return definition?.name || 'card';
}

export function applyPendingRoomAction(
  state: GameState,
  pending: PendingRealGameAction,
): { state: GameState; ok: true; event: string } | { state: GameState; ok: false; error: string } {
  if (pending.action.kind === 'pass_priority') {
    const result = tryPassPriority(state, pending.player_id);
    if (!result.ok) return { state, ok: false, error: result.message };
    let nextState = result.state;
    let event = `${pending.player_name} passed priority.`;
    if (allPlayersPassed(nextState)) {
      if (nextState.stack.length > 0) {
        nextState = resolveTopOfStack(nextState);
        event += ' All players passed; the top stack item resolved.';
      } else {
        if (nextState.step === 'combat_damage') {
          if (nextState.combat) {
            nextState = resolveCombatDamage(nextState);
            event += ' Combat damage resolved.';
          } else {
            event += ' No combat damage to resolve.';
          }
        }
        nextState = nextState.step === 'untap'
          ? advanceStep(performUntapStep(nextState))
          : advanceStep(nextState);
        event += ` All players passed; advanced to ${nextState.phase} / ${nextState.step}.`;
      }
    }
    return {
      state: nextState,
      ok: true,
      event,
    };
  }

  if (pending.action.kind === 'play_land') {
    const result = tryPlayLand(state, pending.player_id, pending.action.payload.card_instance_id);
    if (!result.ok) return { state, ok: false, error: result.message };
    return {
      state: result.state,
      ok: true,
      event: `${pending.player_name} played a land.`,
    };
  }

  if (pending.action.kind === 'tap_mana') {
    const result = tryTapLandForMana(
      state,
      pending.player_id,
      pending.action.payload.card_instance_id,
      pending.action.payload.color,
    );
    if (!result.ok) return { state, ok: false, error: result.message };
    return {
      state: result.state,
      ok: true,
      event: `${pending.player_name} tapped ${cardName(state, pending.action.payload.card_instance_id)} for ${pending.action.payload.color}.`,
    };
  }

  if (pending.action.kind === 'cast_spell') {
    const result = tryCastSpell(
      state,
      pending.player_id,
      pending.action.payload.card_instance_id,
      pending.action.payload.targets || [],
      ZERO_MANA_COST,
      {
        faceName: pending.action.payload.face_name,
        xValue: pending.action.payload.x_value,
      },
    );
    if (!result.ok) return { state, ok: false, error: result.message };
    return {
      state: result.state,
      ok: true,
      event: `${pending.player_name} cast ${cardName(state, pending.action.payload.card_instance_id)}.`,
    };
  }

  if (pending.action.kind === 'declare_attackers') {
    const result = tryDeclareAttackers(state, pending.player_id, pending.action.payload.attackers);
    if (!result.ok) return { state, ok: false, error: result.message };
    return {
      state: result.state,
      ok: true,
      event: pending.action.payload.attackers.length
        ? `${pending.player_name} declared ${pending.action.payload.attackers.length} attacker(s).`
        : `${pending.player_name} declared no attackers.`,
    };
  }

  if (pending.action.kind === 'declare_blockers') {
    const result = tryDeclareBlockers(state, pending.player_id, pending.action.payload.blockers);
    if (!result.ok) return { state, ok: false, error: result.message };
    return {
      state: result.state,
      ok: true,
      event: pending.action.payload.blockers.length
        ? `${pending.player_name} declared ${pending.action.payload.blockers.length} blocker(s).`
        : `${pending.player_name} declared no blockers.`,
    };
  }

  if (pending.action.kind === 'adjust_counters') {
    const result = tryAdjustCounters(
      state,
      pending.player_id,
      pending.action.payload.card_instance_id,
      pending.action.payload.counter_type,
      pending.action.payload.delta,
    );
    if (!result.ok) return { state, ok: false, error: result.message };
    return {
      state: result.state,
      ok: true,
      event: `${pending.player_name} adjusted ${pending.action.payload.counter_type} counters on ${cardName(state, pending.action.payload.card_instance_id)}.`,
    };
  }

  return { state, ok: false, error: 'Unsupported action' };
}
