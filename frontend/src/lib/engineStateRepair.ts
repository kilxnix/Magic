import { registerBattlefieldAbilities, type GameState } from 'commander-engine';

export function restoreMissingBattlefieldAbilities<T extends GameState>(state: T): T {
  let battlefieldAbilities = new Map(state.battlefieldAbilities || new Map());

  for (const card of state.cards.values()) {
    if (card.zone !== 'battlefield') continue;
    const previous = battlefieldAbilities.get(card.instanceId) || [];
    const withoutCurrent = new Map(battlefieldAbilities);
    withoutCurrent.delete(card.instanceId);
    const registeredState = registerBattlefieldAbilities(
      { ...state, battlefieldAbilities: withoutCurrent },
      card.instanceId,
    );
    const registered = registeredState.battlefieldAbilities.get(card.instanceId) || [];
    if (registered.length > 0) {
      battlefieldAbilities = new Map(registeredState.battlefieldAbilities);
    } else if (previous.length > 0) {
      battlefieldAbilities.set(card.instanceId, previous);
    } else {
      battlefieldAbilities.delete(card.instanceId);
    }
  }

  return { ...state, battlefieldAbilities } as T;
}
