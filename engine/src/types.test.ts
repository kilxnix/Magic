import { describe, it, expect } from 'vitest';
import { ManaColor, Zone, Phase, Step, CardType } from './types';

describe('Core Types', () => {
  it('defines all five mana colors plus colorless', () => {
    const colors: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];
    expect(colors).toHaveLength(6);
  });

  it('defines all seven zones', () => {
    const zones: Zone[] = [
      'library', 'hand', 'battlefield', 'graveyard',
      'exile', 'stack', 'command'
    ];
    expect(zones).toHaveLength(7);
  });

  it('defines all phases', () => {
    const phases: Phase[] = [
      'beginning', 'precombat_main', 'combat',
      'postcombat_main', 'ending'
    ];
    expect(phases).toHaveLength(5);
  });

  it('defines all steps', () => {
    const steps: Step[] = [
      'untap', 'upkeep', 'draw',
      'begin_combat', 'declare_attackers', 'declare_blockers',
      'first_strike_damage', 'combat_damage', 'end_of_combat',
      'end', 'cleanup'
    ];
    expect(steps).toHaveLength(11);
  });

  it('defines card types', () => {
    const types: CardType[] = [
      'creature', 'instant', 'sorcery', 'artifact',
      'enchantment', 'planeswalker', 'land', 'battle'
    ];
    expect(types).toHaveLength(8);
  });
});
