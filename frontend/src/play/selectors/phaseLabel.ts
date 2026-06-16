// Phase/step display names, mirroring GameBoard.tsx (PHASE_DISPLAY / STEP_DISPLAY /
// displayStepForPhase) so the new view-model labels match the existing board.

const PHASE_DISPLAY: Record<string, string> = {
  beginning: 'Upkeep',
  precombat_main: 'Main Phase 1',
  combat: 'Combat',
  postcombat_main: 'Main Phase 2',
  ending: 'End / Discard',
};

const STEP_DISPLAY: Record<string, string> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  main: 'Main Phase',
  begin_combat: 'Begin Combat',
  declare_attackers: 'Declare Attackers',
  declare_blockers: 'Declare Blockers',
  first_strike_damage: 'First Strike Damage',
  combat_damage: 'Combat Damage',
  end_of_combat: 'End of Combat',
  end: 'End Step',
  cleanup: 'Cleanup / Discard',
};

export function phaseLabel(phase: string | undefined, step: string | undefined): string {
  if (phase === 'precombat_main' && (!step || step === 'main' || step === 'begin_combat')) {
    return 'Main Phase 1';
  }
  if (phase === 'postcombat_main' && (!step || step === 'main' || step === 'end_of_combat' || step === 'end')) {
    return 'Main Phase 2';
  }
  if (step) return STEP_DISPLAY[step] || PHASE_DISPLAY[phase || ''] || step;
  return PHASE_DISPLAY[phase || ''] || phase || 'Phase';
}
