import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getLegalActions } from '../ai/legal-actions';
import { createCardLookup, type GeneratedDeck, type ScryfallCard } from '../cards/deck-loader';
import { initGameFromDecks } from '../game-init';
import { getCardsInZone } from '../game-state';
import { tryActivateAbility, tryCastSpell, tryEquip, tryPlayLand, tryTapLandForMana } from '../actions-public';
import { canCastSpell, resolveTopOfStack } from '../stack';
import type { CardInstance, GameState, ManaColor, Zone } from '../types';

interface ImportedDeckPayload {
  imported: {
    commander: string;
    commander_data?: CardData;
    cards: string[];
    lands: string[];
    sideboard?: string[];
    card_data: Record<string, CardData>;
  };
}

interface CardData {
  name?: string;
  type_line?: string;
  oracle_text?: string;
  mana_cost?: string;
  cmc?: number;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  power?: string | null;
  toughness?: string | null;
}

const DEFAULT_RUN_PATH = fileURLToPath(new URL('./fixtures/archidekt-league-of-legendaries-import.json', import.meta.url));
const RUN_PATH = process.env.ARCHIDEKT_IMPORT_JSON || DEFAULT_RUN_PATH;

function cardDataToScryfall(name: string, data: CardData): ScryfallCard {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: data.name || name,
    type_line: data.type_line || '',
    oracle_text: data.oracle_text || '',
    mana_cost: data.mana_cost || '',
    cmc: Number(data.cmc || 0),
    colors: data.colors || [],
    color_identity: data.color_identity || [],
    keywords: data.keywords || [],
    power: data.power ?? null,
    toughness: data.toughness ?? null,
    legalities: { commander: 'legal' },
  };
}

function importedToGeneratedDeck(imported: ImportedDeckPayload['imported']): GeneratedDeck {
  return {
    commander: imported.commander,
    list: [...(imported.cards || []), ...(imported.lands || [])],
    colors: imported.commander_data?.color_identity || [],
    sideboard: imported.sideboard || [],
  };
}

function hugeMana() {
  return { W: 20, U: 20, B: 20, R: 20, G: 20, C: 20 };
}

function forceMainPriority(state: GameState): GameState {
  state.activePlayerIndex = 0;
  state.priorityPlayerIndex = 0;
  state.phase = 'precombat_main';
  state.step = 'main';
  state.stack = [];
  state.hasPriorityPassed = state.players.map(() => false);
  state.players[0].manaPool = hugeMana();
  state.players[0].hasPlayedLand = false;
  state.players[0].landsPlayedThisTurn = 0;
  return state;
}

function moveCard(state: GameState, card: CardInstance, zone: Zone): CardInstance {
  const next = {
    ...card,
    zone,
    tapped: false,
    summoningSick: false,
    damage: 0,
  };
  state.cards.set(card.instanceId, next);
  return next;
}

function cardsByName(state: GameState, playerId: string, name: string): CardInstance[] {
  return [...state.cards.values()].filter(card => {
    if (card.ownerId !== playerId) return false;
    return state.cardDefinitions.get(card.definitionId)?.name === name;
  });
}

function seedBattlefieldTargets(state: GameState, skipName: string): void {
  for (const playerId of ['human', 'ai1']) {
    const wanted = new Set(['creature', 'artifact', 'enchantment', 'planeswalker', 'land']);
    for (const card of [...state.cards.values()]) {
      if (card.ownerId !== playerId || card.zone !== 'library') continue;
      const def = state.cardDefinitions.get(card.definitionId);
      if (!def || def.name === skipName) continue;
      const match = def.card_types.find(type => wanted.has(type));
      if (!match) continue;
      moveCard(state, card, 'battlefield');
      wanted.delete(match);
      if (wanted.size === 0) break;
    }
  }
}

function seedGraveyardTargets(state: GameState, skipName: string): void {
  const existingCreature = [...state.cards.values()].some(card => {
    if (card.ownerId !== 'human' || card.zone !== 'graveyard') return false;
    const def = state.cardDefinitions.get(card.definitionId);
    return Boolean(def?.card_types.includes('creature'));
  });
  if (existingCreature) return;

  const candidate = [...state.cards.values()].find(card => {
    if (card.ownerId !== 'human' || card.zone !== 'library') return false;
    const def = state.cardDefinitions.get(card.definitionId);
    return Boolean(def && def.name !== skipName && def.card_types.includes('creature'));
  });
  if (candidate) {
    moveCard(state, candidate, 'graveyard');
  }
}

function seedStackSpellTarget(state: GameState, oracleText: string): void {
  if (!/target[\s\S]{0,80}\bspell\b/i.test(oracleText)) return;

  const wantsInstantOrSorcery = /target[\s\S]{0,40}(instant|sorcery)[\s\S]{0,40}spell/i.test(oracleText);
  const wantsNoncreature = /target\s+noncreature\s+spell/i.test(oracleText);
  const candidate = [...state.cards.values()].find(card => {
    if (card.ownerId !== 'ai1' || card.zone !== 'library') return false;
    const def = state.cardDefinitions.get(card.definitionId);
    if (!def) return false;
    if (wantsInstantOrSorcery) {
      return def.card_types.includes('instant') || def.card_types.includes('sorcery');
    }
    if (wantsNoncreature) {
      return !def.card_types.includes('creature');
    }
    return true;
  });
  if (!candidate) return;

  const stackCard = moveCard(state, candidate, 'stack');
  state.stack = [{
    kind: 'Spell',
    id: `cert-stack-${stackCard.instanceId}`,
    cardInstanceId: stackCard.instanceId,
    casterId: 'ai1',
    targets: [],
  }];
  state.priorityPlayerIndex = 0;
  state.hasPriorityPassed = state.players.map(() => false);
}

function tryAnyManaTap(state: GameState, cardId: string): string | null {
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
    const result = tryTapLandForMana(state, 'human', cardId, color);
    if (result.ok) return color;
  }
  return null;
}

function resolveStack(state: GameState): { state: GameState; resolved: string[] } {
  let current = state;
  const resolved: string[] = [];
  let guard = 12;
  while (current.stack.length > 0 && guard-- > 0) {
    const top = current.stack[current.stack.length - 1];
    resolved.push(top.kind);
    current = resolveTopOfStack(current);
  }
  return { state: current, resolved };
}

describe('Archidekt deck certification', () => {
  it('casts, resolves, and exposes basic actions for each imported card', () => {
    const raw = readFileSync(RUN_PATH, 'utf8');
    const payload = JSON.parse(raw) as ImportedDeckPayload;
    const imported = payload.imported;
    const allCards = Object.entries(imported.card_data).map(([name, data]) => cardDataToScryfall(name, data));
    const lookup = createCardLookup(allCards);
    const deck = importedToGeneratedDeck(imported);
    const uniqueNames = [...new Set([imported.commander, ...deck.list].filter(Boolean))];
    const failures: Array<{ name: string; stage: string; error: string }> = [];
    const passes: Array<Record<string, unknown>> = [];

    for (const name of uniqueNames) {
      let state: GameState;
      try {
        state = initGameFromDecks({
          humanDeck: deck,
          aiDecks: [deck],
          aiDifficulty: 3,
          cardLookup: lookup,
          humanGoesFirst: true,
        });
        forceMainPriority(state);
        seedBattlefieldTargets(state, name);
        seedGraveyardTargets(state, name);
      } catch (error) {
        failures.push({ name, stage: 'init', error: (error as Error).message });
        continue;
      }

      const data = imported.card_data[name];
      const typeLine = data?.type_line || '';
      const isLand = /\bland\b/i.test(typeLine);
      const commanderNames = String(imported.commander || '').split(' // ').map(part => part.trim());
      const isCommander = commanderNames.includes(name);
      const candidate = isCommander
        ? cardsByName(state, 'human', name).find(card => card.zone === 'command')
        : cardsByName(state, 'human', name)[0];

      if (!candidate) {
        failures.push({ name, stage: 'lookup', error: 'No initialized card instance found' });
        continue;
      }

      try {
        if (isLand && !isCommander) {
          moveCard(state, candidate, 'hand');
          const played = tryPlayLand(state, 'human', candidate.instanceId, {
            chosenCreatureType: 'Bird',
            payLifeToEnterUntapped: true,
          });
          if (!played.ok) {
            failures.push({ name, stage: 'play_land', error: played.message || played.reason });
            continue;
          }
          const manaTap = tryAnyManaTap(played.state, candidate.instanceId);
          passes.push({ name, stage: 'land', manaTap });
          continue;
        }

        moveCard(state, candidate, isCommander ? 'command' : 'hand');
        forceMainPriority(state);
        if (/\binstant\b/i.test(typeLine)) {
          seedStackSpellTarget(state, data?.oracle_text || '');
        }
        const castActions = getLegalActions(state, 'human')
          .filter(action => action.kind === 'CastSpell' && action.cardInstanceId === candidate.instanceId);
        if (castActions.length === 0) {
          failures.push({
            name,
            stage: 'legal_cast',
            error: `No legal cast action generated; canCast=${canCastSpell(state, 'human', candidate.instanceId)} stack=${state.stack.length} zone=${state.cards.get(candidate.instanceId)?.zone}`,
          });
          continue;
        }

        const action = castActions[0];
        const cast = tryCastSpell(
          state,
          'human',
          candidate.instanceId,
          action.targets || [],
          { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 },
          {
            chosenModes: action.chosenModes,
            namedCardChoices: action.namedCardChoices,
            cardChoices: action.cardChoices,
          },
        );
        if (!cast.ok) {
          failures.push({ name, stage: 'cast', error: cast.message || cast.reason });
          continue;
        }

        let resolved = cast.state;
        let resolutionKinds: string[] = [];
        try {
          const result = resolveStack(resolved);
          resolved = result.state;
          resolutionKinds = result.resolved;
        } catch (error) {
          failures.push({ name, stage: 'resolve', error: (error as Error).message });
          continue;
        }

        const permanent = resolved.cards.get(candidate.instanceId);
        const actionResults: Array<Record<string, unknown>> = [];
        if (permanent?.zone === 'battlefield') {
          moveCard(resolved, permanent, 'battlefield');
          forceMainPriority(resolved);
          const actions = getLegalActions(resolved, 'human')
            .filter(possible =>
              (possible.kind === 'ActivateAbility' && possible.cardInstanceId === permanent.instanceId)
              || (possible.kind === 'Equip' && possible.equipmentInstanceId === permanent.instanceId),
            );
          for (const possible of actions.slice(0, 2)) {
            if (possible.kind === 'ActivateAbility') {
              const activated = tryActivateAbility(
                resolved,
                'human',
                permanent.instanceId,
                possible.abilityIndex,
                possible.targets || [],
              );
              actionResults.push({
                kind: 'activate',
                ok: activated.ok,
                error: activated.ok ? undefined : activated.message || activated.reason,
              });
            } else if (possible.kind === 'Equip') {
              const equipped = tryEquip(resolved, 'human', possible.equipmentInstanceId, possible.targetCreatureId);
              actionResults.push({
                kind: 'equip',
                ok: equipped.ok,
                error: equipped.ok ? undefined : equipped.message || equipped.reason,
              });
            }
          }
        }

        passes.push({
          name,
          stage: isCommander ? 'commander' : 'spell',
          finalZone: resolved.cards.get(candidate.instanceId)?.zone,
          resolutionKinds,
          actionResults,
        });
      } catch (error) {
        failures.push({ name, stage: 'exception', error: (error as Error).message });
      }
    }

    const report = {
      commander: imported.commander,
      totalUniqueCards: uniqueNames.length,
      passed: passes.length,
      failures,
      passes,
    };
    if (process.env.ARCHIDEKT_ENGINE_REPORT_JSON) {
      writeFileSync(process.env.ARCHIDEKT_ENGINE_REPORT_JSON, JSON.stringify(report, null, 2));
    }

    expect(failures).toEqual([]);
  }, 120_000);
});
