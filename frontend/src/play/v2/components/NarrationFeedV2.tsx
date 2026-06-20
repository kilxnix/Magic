import { Panel } from '../primitives';
import { cn } from '../../../lib/utils';
import type { NarrationEntry } from '../../gameView.types';

const TONE = { trigger: 'text-gold-label', resolve: 'text-gold-bright', phase: 'text-gold-muted', action: 'text-gold-bright' };

export function NarrationFeedV2({ narration }: { narration: NarrationEntry[] }) {
  return (
    <Panel className="flex h-full min-h-0 flex-col p-2">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain text-[12px]">
        {narration.map(e => <div key={e.id} className={cn('leading-snug', TONE[e.kind])}>{e.text}</div>)}
      </div>
    </Panel>
  );
}
