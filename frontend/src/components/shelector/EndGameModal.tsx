export interface EndGameModalProps {
  open: boolean;
  kind: 'win' | 'loss' | 'loop';
  reason?: 'life' | 'commander_damage' | 'empty_library' | 'poison' | 'concede';
  loopSources?: string[];
  onPlayItOut: () => void;
  onDeclareDraw: () => void;
  onConcede: () => void;
  onNewGame: () => void;
  onReviewLog: () => void;
  onClose: () => void;
}

const REASON_LABEL: Record<NonNullable<EndGameModalProps['reason']>, string> = {
  life: 'your life total hit 0',
  commander_damage: 'you took 21+ commander damage',
  empty_library: 'you tried to draw from an empty library',
  poison: 'you have 10+ poison counters',
  concede: 'you conceded',
};

export function EndGameModal(props: EndGameModalProps) {
  if (!props.open) return null;

  const title =
    props.kind === 'win' ? 'You won!' :
    props.kind === 'loss' ? 'You lost' :
    'Possible infinite combo detected';

  const body =
    props.kind === 'loss' && props.reason
      ? `You lost because ${REASON_LABEL[props.reason]}.`
    : props.kind === 'win'
      ? 'All opponents have been eliminated.'
    : `The game state appears to be repeating${props.loopSources?.length ? ' (sources: ' + props.loopSources.join(', ') + ')' : ''}. How would you like to proceed?`;

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-game-modal-title"
    >
      <div className="bg-slate-900 text-white rounded-lg p-6 max-w-md w-full mx-4 space-y-4 shadow-xl">
        <h2 id="end-game-modal-title" className="text-xl font-semibold">{title}</h2>
        <p className="text-slate-300">{body}</p>
        <div className="flex flex-col gap-2">
          {props.kind === 'loop' && (
            <>
              <button
                className="bg-blue-600 hover:bg-blue-500 rounded px-3 py-2 text-left"
                onClick={props.onPlayItOut}
              >
                Play it out (one more round)
              </button>
              <button
                className="bg-slate-600 hover:bg-slate-500 rounded px-3 py-2 text-left"
                onClick={props.onDeclareDraw}
              >
                Declare as draw
              </button>
              <button
                className="bg-red-700 hover:bg-red-600 rounded px-3 py-2 text-left"
                onClick={props.onConcede}
              >
                Concede
              </button>
            </>
          )}
          <button
            className="bg-green-600 hover:bg-green-500 rounded px-3 py-2 text-left"
            onClick={props.onNewGame}
          >
            New game
          </button>
          <button
            className="bg-slate-700 hover:bg-slate-600 rounded px-3 py-2 text-left"
            onClick={props.onReviewLog}
          >
            Review game log
          </button>
          <button
            className="text-slate-400 hover:text-slate-200 mt-2 px-3 py-2 text-left"
            onClick={props.onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
