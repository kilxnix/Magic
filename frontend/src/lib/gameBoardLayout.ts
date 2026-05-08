export const FLOATING_TABLE_LAYOUT = {
  shell: 'h-screen bg-stone-950 text-stone-100 flex flex-col overflow-hidden',
  board: 'flex-1 min-h-0 min-w-0',
  reviewButton: 'fixed right-4 top-4 z-40',
  reviewRail: 'hidden',
  table: 'relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-neutral-900 pt-12 pb-32',
  opponentStrip: 'relative z-10 shrink-0 border-b border-neutral-800/70 bg-neutral-950/40 px-3 pb-1 pt-1 backdrop-blur-sm md:px-4',
  actionsDock: 'absolute inset-x-3 bottom-[7.75rem] z-30 rounded-lg border border-stone-700/60 bg-neutral-950/90 px-2 py-1 shadow-xl shadow-black/35 backdrop-blur md:px-3',
  handDock: 'absolute inset-x-3 bottom-3 z-30 rounded-lg border border-neutral-700/70 bg-neutral-950/95 px-2 py-1.5 shadow-2xl shadow-black/45 backdrop-blur md:px-3',
} as const;

export const CARD_TILE_LAYOUT = {
  compactSize: 'w-[4.75rem] h-20 md:w-[5.4rem] md:h-20',
  defaultSize: 'w-[4.5rem] h-[6.5rem] md:w-24 md:h-36',
  compactButton: 'p-1 text-[10px]',
  defaultButton: 'p-1.5 md:p-2 text-[10px] md:text-xs',
  compactTitle: 'font-semibold text-stone-100 leading-tight line-clamp-2 break-words text-[10px] md:text-[11px]',
  defaultTitle: 'font-semibold text-stone-100 leading-tight line-clamp-2 break-words text-[10px] md:text-xs',
  compactMeta: 'text-stone-400 text-[8px] md:text-[9px] mt-0.5 leading-tight line-clamp-1 break-words',
  defaultMeta: 'text-stone-400 text-[8px] md:text-[10px] mt-0.5 md:mt-1 truncate',
} as const;
