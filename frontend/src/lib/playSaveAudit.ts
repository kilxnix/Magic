import {
  auditEngineEventLogReplay,
  deserializeGameState,
  type EngineEventLogRecord,
  type SerializedGameStateV1,
} from 'commander-engine';

export interface PlaySaveAuditSummary {
  ok: boolean;
  status: 'ok' | 'empty' | 'missing' | 'failed';
  recordCount: number;
  message: string;
}

interface AuditableSaveSnapshot {
  engineEventLog?: EngineEventLogRecord[];
  engineEventLogSeeds?: Record<number, SerializedGameStateV1>;
  engineEventLogInitialState?: SerializedGameStateV1 | null;
}

export function auditPlaySaveSnapshot(snapshot: unknown): PlaySaveAuditSummary {
  const auditable = snapshot as AuditableSaveSnapshot | null | undefined;
  const eventLog = auditable?.engineEventLog || [];
  const initialState = auditable?.engineEventLogInitialState;

  if (!initialState) {
    return {
      ok: false,
      status: 'missing',
      recordCount: eventLog.length,
      message: 'Audit seed missing',
    };
  }

  if (eventLog.length === 0) {
    return {
      ok: true,
      status: 'empty',
      recordCount: 0,
      message: 'Audit ready',
    };
  }

  try {
    const seeds = auditable?.engineEventLogSeeds || {};
    if (Object.keys(seeds).length > 0) {
      for (const record of eventLog) {
        const seed = seeds[record.sequence];
        if (!seed) {
          return {
            ok: false,
            status: 'failed',
            recordCount: eventLog.length,
            message: `Audit seed missing for event ${record.sequence}`,
          };
        }
        const single = auditEngineEventLogReplay(deserializeGameState(seed), [record]);
        if (!single.ok) {
          const failed = single.steps.find(step => !step.ok);
          return {
            ok: false,
            status: 'failed',
            recordCount: eventLog.length,
            message: failed?.message
              ? `Event ${record.sequence}: ${failed.message}`
              : `Audit failed at event ${record.sequence}`,
          };
        }
      }
      return {
        ok: true,
        status: 'ok',
        recordCount: eventLog.length,
        message: `Audit OK (${eventLog.length})`,
      };
    }

    const report = auditEngineEventLogReplay(deserializeGameState(initialState), eventLog);
    if (report.ok) {
      return {
        ok: true,
        status: 'ok',
        recordCount: eventLog.length,
        message: `Audit OK (${eventLog.length})`,
      };
    }

    const failed = report.steps.find(step => !step.ok);
    return {
      ok: false,
      status: 'failed',
      recordCount: eventLog.length,
      message: failed?.message || 'Audit failed',
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      recordCount: eventLog.length,
      message: error instanceof Error ? error.message : 'Audit failed',
    };
  }
}
