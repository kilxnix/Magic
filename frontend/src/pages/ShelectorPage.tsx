import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Send, Trash2, ArrowLeft, Loader2 } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SESSION_KEY = 'shelector_session_id';

function getSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function ShelectorPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setError(null);
    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch('http://localhost:8100/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          session_id: getSessionId(),
          user_id: 'default',
        }),
      });

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }

      const data = await res.json();
      const assistantMsg: Message = { role: 'assistant', content: data.response };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      setError(err.message || 'Failed to reach the Shelector');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleClear = async () => {
    const sid = getSessionId();
    try {
      await fetch(`http://localhost:8100/session/${sid}/clear`, { method: 'POST' });
    } catch { /* ignore */ }
    setMessages([]);
    clearSession();
    setError(null);
  };

  return (
    <div className="flex flex-col h-screen bg-stone-50 text-stone-900">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-stone-200 bg-white shrink-0">
        <Link
          to="/"
          className="p-1.5 rounded-md text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-serif text-lg font-semibold text-stone-800 truncate">
            The Shelector
          </h1>
          <p className="text-xs text-stone-500 truncate">
            MTG knowledge agent — ask about cards, rules, deckbuilding
          </p>
        </div>
        <button
          onClick={handleClear}
          className="p-2 rounded-md text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          title="Clear conversation"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 sm:py-6 space-y-3 sm:space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-stone-400 mt-12 sm:mt-20 space-y-3">
            <div className="text-4xl">&#9878;</div>
            <p className="font-serif text-lg text-stone-500">The Shelector awaits</p>
            <div className="max-w-md mx-auto space-y-1.5 sm:space-y-1 text-sm px-2">
              <p>Try asking:</p>
              <button
                onClick={() => setInput('What is "Rhystic Study" and why is it controversial?')}
                className="block w-full text-left px-3 py-2.5 sm:py-1.5 rounded-md bg-stone-100 hover:bg-stone-200 transition-colors min-h-[44px]"
              >
                "What is Rhystic Study and why is it controversial?"
              </button>
              <button
                onClick={() => setInput('Find me cards that counter graveyard strategies')}
                className="block w-full text-left px-3 py-2.5 sm:py-1.5 rounded-md bg-stone-100 hover:bg-stone-200 transition-colors min-h-[44px]"
              >
                "Find me cards that counter graveyard strategies"
              </button>
              <button
                onClick={() => setInput('Is "Cyclonic Rift" allowed in bracket 2?')}
                className="block w-full text-left px-3 py-2.5 sm:py-1.5 rounded-md bg-stone-100 hover:bg-stone-200 transition-colors min-h-[44px]"
              >
                "Is Cyclonic Rift allowed in bracket 2?"
              </button>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] sm:max-w-[80%] rounded-xl px-3 sm:px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                msg.role === 'user'
                  ? 'bg-stone-800 text-stone-50'
                  : 'bg-white border border-stone-200 text-stone-800'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-stone-200 rounded-xl px-4 py-2.5 text-sm text-stone-400 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Thinking...
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">
              {error}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input -- fixed at bottom, safe area aware */}
      <div className="border-t border-stone-200 bg-white p-3 sm:p-4 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="max-w-3xl mx-auto flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the Shelector anything about MTG..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-stone-300 px-3 sm:px-4 py-2.5 text-sm
                       focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent
                       placeholder:text-stone-400 bg-stone-50"
            style={{ maxHeight: '120px' }}
            onInput={e => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="p-2.5 rounded-xl bg-stone-800 text-white hover:bg-stone-700
                       disabled:opacity-40 disabled:cursor-not-allowed transition-colors
                       min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
