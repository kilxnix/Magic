import type { GameState } from './types';
import type { LoopCategory, LoopSignature } from './actions-public';

const FINGERPRINT_BUFFER_SIZE = 20;
const FINGERPRINT_REPEAT_THRESHOLD = 3;
const LIFE_SWING_THRESHOLD = 1000;

export class LoopDetector {
  private fingerprints: string[] = [];
  private prevLifeTotals: number[] = [];
  private triggerCounts = new Map<string, number>();
  private static TRIGGER_LOOP_THRESHOLD = 50;

  observe(state: GameState, _actionKind: string): LoopSignature | null {
    const fp = fingerprint(state);

    const lifeNow = state.players.reduce((s, p) => s + p.life, 0);
    if (this.prevLifeTotals.length > 0) {
      const prev = this.prevLifeTotals[this.prevLifeTotals.length - 1];
      if (Math.abs(lifeNow - prev) > LIFE_SWING_THRESHOLD) {
        return { category: 'unbounded_growth', sources: [], hash: fp };
      }
    }
    this.prevLifeTotals.push(lifeNow);
    if (this.prevLifeTotals.length > FINGERPRINT_BUFFER_SIZE) this.prevLifeTotals.shift();

    this.fingerprints.push(fp);
    if (this.fingerprints.length > FINGERPRINT_BUFFER_SIZE) this.fingerprints.shift();
    const count = this.fingerprints.filter(f => f === fp).length;
    if (count >= FINGERPRINT_REPEAT_THRESHOLD) {
      return { category: 'state_repeat', sources: [], hash: fp };
    }
    return null;
  }

  recordTrigger(sourceInstanceId: string): LoopSignature | null {
    const n = (this.triggerCounts.get(sourceInstanceId) ?? 0) + 1;
    this.triggerCounts.set(sourceInstanceId, n);
    if (n > LoopDetector.TRIGGER_LOOP_THRESHOLD) {
      return { category: 'trigger_self_loop', sources: [sourceInstanceId], hash: `trig:${sourceInstanceId}:${n}` };
    }
    return null;
  }

  resetTriggers(): void {
    this.triggerCounts.clear();
  }

  reset(): void {
    this.fingerprints = [];
    this.prevLifeTotals = [];
    this.triggerCounts.clear();
  }
}

export function fingerprint(state: GameState): string {
  const parts: string[] = [];
  for (const p of state.players) {
    parts.push(`p:${p.id}:${p.life}:${p.poisonCounters ?? 0}`);
    parts.push(`mp:${p.manaPool.W}.${p.manaPool.U}.${p.manaPool.B}.${p.manaPool.R}.${p.manaPool.G}.${p.manaPool.C}`);
  }
  const zoneCounts = new Map<string, number>();
  for (const [, card] of state.cards) {
    const key = `${card.ownerId}:${card.zone}`;
    zoneCounts.set(key, (zoneCounts.get(key) ?? 0) + 1);
  }
  const sortedZones = [...zoneCounts.entries()].sort().map(([k, v]) => `${k}=${v}`);
  parts.push(...sortedZones);
  parts.push(`phase:${state.phase}:${state.step}`);
  parts.push(`stack:${state.stack.length}`);
  parts.push(`active:${state.activePlayerIndex}`);
  return parts.join('|');
}
