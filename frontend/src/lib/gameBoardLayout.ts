export const FLOATING_TABLE_LAYOUT = {
  shell: 'h-[100svh] max-h-[100svh] bg-stone-950 text-stone-100 flex flex-col overflow-hidden overscroll-none',
  board: 'isolate flex-1 min-h-0 min-w-0',
  reviewButton: 'fixed right-2 top-2 z-50 md:right-4 md:top-4',
  reviewRail: 'hidden',
  table: 'relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-neutral-900 pt-[3.95rem] pb-[calc(env(safe-area-inset-bottom)+12.75rem)] md:pt-[4.25rem] md:pb-36',
  opponentStrip: 'relative z-10 max-h-[29svh] shrink-0 overflow-y-auto overscroll-contain border-b border-neutral-800/70 bg-neutral-950/50 px-2 pb-1 pt-1 backdrop-blur-sm md:max-h-none md:px-4',
  // Dock max-heights carry viewport (svh) caps so high browser zoom (rem
  // inflation) cannot grow a dock past the screen and overlap its neighbors —
  // content scrolls within the capped dock instead.
  actionsDock: 'absolute inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+min(12.95rem,46svh))] z-40 max-h-[min(7.75rem,24svh)] overflow-y-auto overscroll-contain rounded-lg border border-amber-500/35 bg-neutral-950/95 px-2 py-2 shadow-2xl shadow-black/45 backdrop-blur md:left-auto md:right-3 md:bottom-[min(12.95rem,46svh)] md:w-[min(34rem,44vw)] md:max-h-[min(15rem,38svh)] md:px-3',
  phaseDock: 'absolute inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+min(9.05rem,32svh))] z-40 max-h-[min(3.35rem,12svh)] overflow-y-auto overscroll-contain rounded-lg border border-neutral-700/75 bg-neutral-950/95 px-2 py-1 shadow-xl shadow-black/35 backdrop-blur md:inset-x-3 md:bottom-[min(9.2rem,32svh)] md:max-h-[min(3.4rem,12svh)] md:px-3',
  handDock: 'absolute inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-50 max-h-[min(8.25rem,28svh)] overflow-hidden rounded-lg border border-neutral-700/70 bg-neutral-950/95 px-2 py-1.5 shadow-2xl shadow-black/40 backdrop-blur md:inset-x-3 md:bottom-3 md:max-h-[min(24rem,60svh)] md:px-3',
} as const;

export const CARD_TILE_LAYOUT = {
  compactSize: 'w-[4.25rem] h-[4.9rem] sm:w-[4.75rem] sm:h-20 md:w-[5.4rem] md:h-20',
  defaultSize: 'w-[4.25rem] h-[5.85rem] sm:w-[4.5rem] sm:h-[6.5rem] md:w-24 md:h-36',
  compactButton: 'p-1 text-[10px]',
  defaultButton: 'p-1.5 md:p-2 text-[10px] md:text-xs',
  compactTitle: 'font-semibold text-stone-100 leading-tight line-clamp-2 break-words text-[10px] md:text-[11px]',
  defaultTitle: 'font-semibold text-stone-100 leading-tight line-clamp-2 break-words text-[10px] md:text-xs',
  compactMeta: 'text-stone-400 text-[8px] md:text-[9px] mt-0.5 leading-tight line-clamp-1 break-words',
  defaultMeta: 'text-stone-400 text-[8px] md:text-[10px] mt-0.5 md:mt-1 truncate',
} as const;
