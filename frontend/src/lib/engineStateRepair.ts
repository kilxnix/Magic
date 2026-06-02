import { registerBattlefieldAbilities, type GameState } from 'commander-engine';

export function restoreMissingBattlefieldAbilities<T extends GameState>(state: T): T {
  let next: GameState = state;

  for (const card of state.cards.values()) {
    if (card.zone !== 'battlefield') continue;
    if (next.battlefieldAbilities?.has(card.instanceId)) continue;
    next = registerBattlefieldAbilities(next, card.instanceId);
  }

  return next as T;
}
