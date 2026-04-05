/**
 * GameChat -- scrolling chat panel for the Shelector game.
 *
 * Shows system messages, Shelector messages, and player actions.
 * Supports both desktop sidebar and mobile slide-up drawer modes.
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { ChatMessage } from '../hooks/useShelectorGame';

interface GameChatProps {
  messages: ChatMessage[];
  isGameOver: boolean;
  winner: string | null;
  /** Called when the close button is tapped (mobile drawer only). */
  onClose?: () => void;
  /** When true, renders in compact mobile drawer layout. */
  isMobileDrawer?: boolean;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function GameChat({ messages, isGameOver, winner, onClose, isMobileDrawer }: GameChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGameOver]);

  return (
    <div
      className={`flex flex-col bg-stone-900 ${
        isMobileDrawer
          ? 'h-full max-h-[calc(50vh-24px)]'
          : 'h-full border-l border-stone-700'
      }`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-stone-700 bg-stone-800 flex items-center justify-between shrink-0">
        <h2 className="text-sm font-semibold text-stone-200">Game Log</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-stone-400 hover:text-stone-200 hover:bg-stone-700 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close chat"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-stone-600 text-xs italic text-center mt-8">
            Game events will appear here...
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === 'system') {
            return (
              <div key={i} className="text-center">
                <span className="text-stone-500 text-xs italic">
                  {msg.text}
                </span>
              </div>
            );
          }

          if (msg.role === 'shelector') {
            return (
              <div key={i} className="flex flex-col items-start gap-0.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-amber-400 text-xs font-semibold">
                    Shelector:
                  </span>
                  <span className="text-stone-400 text-[10px]">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                <div className="text-stone-300 text-xs leading-relaxed pl-2 border-l-2 border-amber-600/30">
                  {msg.text}
                </div>
              </div>
            );
          }

          // Player messages
          return (
            <div key={i} className="flex flex-col items-end gap-0.5">
              <div className="flex items-baseline gap-1.5">
                <span className="text-stone-400 text-[10px]">
                  {formatTime(msg.timestamp)}
                </span>
                <span className="text-green-400 text-xs font-semibold">
                  You
                </span>
              </div>
              <div className="text-stone-300 text-xs leading-relaxed pr-2 border-r-2 border-green-600/30">
                {msg.text}
              </div>
            </div>
          );
        })}

        {/* Game Over message */}
        {isGameOver && (
          <div className="text-center mt-4 py-3 border-t border-stone-700">
            <div className="text-lg font-bold mb-1">
              {winner === 'human' ? (
                <span className="text-green-400">Victory!</span>
              ) : winner ? (
                <span className="text-red-400">Defeat</span>
              ) : (
                <span className="text-stone-400">Draw</span>
              )}
            </div>
            <div className="text-stone-500 text-xs">
              Game over.
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
