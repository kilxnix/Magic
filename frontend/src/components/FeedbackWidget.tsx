import { FormEvent, useEffect, useState } from 'react';
import { Bug, Coffee, Heart, MessageSquare, Send, X } from 'lucide-react';
import { siteConfig } from '../lib/siteConfig';
import { isInteractiveGamePath, useCurrentPathname } from '../lib/pageSurfaces';

type FeedbackCategory = 'bug' | 'improvement' | 'rules' | 'room' | 'other';

const categories: { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'improvement', label: 'Idea' },
  { value: 'rules', label: 'Rules' },
  { value: 'room', label: 'Room' },
  { value: 'other', label: 'Other' },
];

export function FeedbackWidget() {
  const pathname = useCurrentPathname();
  const gameSurface = isInteractiveGamePath(pathname);
  const [activePlaySurface, setActivePlaySurface] = useState(() => (
    typeof document !== 'undefined' && document.body.dataset.deckrepsPlaySurface === 'active'
  ));
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>('improvement');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const update = () => setActivePlaySurface(document.body.dataset.deckrepsPlaySurface === 'active');
    update();
    window.addEventListener('deckreps-play-surface-change', update);
    return () => window.removeEventListener('deckreps-play-surface-change', update);
  }, [pathname]);

  async function submitFeedback(event: FormEvent) {
    event.preventDefault();
    setStatus('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          message,
          email: email || undefined,
          page: window.location.pathname,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.detail || 'Feedback could not be sent');
      }
      setMessage('');
      setEmail('');
      setStatus('Saved. Thank you.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Feedback could not be sent');
    } finally {
      setSubmitting(false);
    }
  }

  const useSideFeedbackTab = gameSurface && activePlaySurface;
  const containerPosition = open
    ? useSideFeedbackTab
      ? 'right-2 top-[calc(env(safe-area-inset-top)+4rem)] sm:right-4 sm:top-24'
      : 'bottom-16 right-3 sm:right-5'
    // Collapsed: a small, low-footprint icon cluster tucked into the corner so it
    // doesn't cover the board. On the play surface it sits in the BOTTOM-right
    // corner (over the low-priority narration bar) rather than vertically centered
    // on the right edge, where it used to overlap the priority / Hold-Pass panel.
    : useSideFeedbackTab
      ? 'bottom-2 right-2 sm:bottom-3 sm:right-3'
      : 'bottom-4 right-3 sm:bottom-5 sm:right-5';

  return (
    <div
      className={`fixed z-[70] flex max-w-[calc(100vw-1rem)] flex-col items-end gap-2 ${containerPosition}`}
    >
      {open ? (
        <form
          onSubmit={submitFeedback}
          className={`w-[min(24rem,calc(100vw-1rem))] rounded-lg border border-stone-300 bg-white p-4 shadow-2xl shadow-stone-950/15 ${
            gameSurface ? 'max-h-[calc(100svh-5rem)] overflow-y-auto' : ''
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-black text-stone-950">
                <MessageSquare size={16} />
                Feedback
              </div>
              <p className="mt-1 text-xs font-semibold text-stone-600">Links are blocked. Reports go straight to the site inbox.</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-stone-200 p-2 text-stone-700 hover:bg-stone-100"
              aria-label="Close feedback"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-5 gap-1 rounded-md bg-stone-100 p-1">
            {categories.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setCategory(item.value)}
                className={`rounded px-2 py-2 text-xs font-black ${
                  category === item.value ? 'bg-stone-950 text-white' : 'text-stone-700 hover:bg-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="mt-3 block text-xs font-black uppercase tracking-[0.12em] text-stone-500" htmlFor="feedback-message">
            Message
          </label>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            minLength={10}
            maxLength={1200}
            rows={5}
            required
            placeholder="What broke, felt confusing, or would make DeckReps better?"
            className="mt-1 w-full resize-none rounded-md border border-stone-300 bg-white p-3 text-sm text-stone-950 outline-none focus:border-amber-500"
          />

          <label className="mt-3 block text-xs font-black uppercase tracking-[0.12em] text-stone-500" htmlFor="feedback-email">
            Email optional
          </label>
          <input
            id="feedback-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={160}
            placeholder="Only if you want a reply"
            className="mt-1 w-full rounded-md border border-stone-300 bg-white p-3 text-sm text-stone-950 outline-none focus:border-amber-500"
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            {siteConfig.donationUrl ? (
              <a
                href={siteConfig.donationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-black text-stone-950 hover:bg-amber-200"
              >
                <Heart size={16} />
                Support
              </a>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm font-bold text-stone-500">
                <Heart size={16} />
                Support soon
              </span>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-md bg-stone-950 px-4 py-2 text-sm font-black text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send size={16} />
              {submitting ? 'Sending' : 'Send'}
            </button>
          </div>

          {status ? <p className="mt-3 text-sm font-bold text-stone-700">{status}</p> : null}
        </form>
      ) : (
        <div className="flex items-center gap-1.5">
          {siteConfig.donationUrl ? (
            <a
              href={siteConfig.donationUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Buy me a coffee (Ko-fi)"
              aria-label="Buy me a coffee on Ko-fi"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-amber-300 bg-amber-100 text-stone-950 shadow-lg shadow-stone-950/15 transition hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <Coffee size={16} />
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(true)}
            title="Send feedback"
            aria-label="Open feedback"
            aria-expanded={open}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-950 shadow-lg shadow-stone-950/15 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <Bug size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
