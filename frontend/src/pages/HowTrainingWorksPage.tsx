import { Link } from 'react-router-dom';
import { MarketingPageShell } from '../components/MarketingPageShell';

const steps = [
  {
    title: 'Start With A Deck',
    body: 'Bring a decklist, paste a URL, or use a practice deck pulled from the platform deck source. Public Commander practice should support both imported decks and platform-supplied decks so a new player is never blocked by an empty clipboard.',
  },
  {
    title: 'Play Beta Reps',
    body: 'Choose a practice setup and run an early browser-based Commander session while experimental AI opponents handle basic sequencing as rules support expands.',
  },
  {
    title: 'Review The Game',
    body: 'After the game ends, the review timeline shows play-by-play entries, early move ratings, selected actions, possible alternatives, confidence, and coaching notes.',
  },
];

const gradingRequirements = [
  'Capture a board snapshot before each meaningful human decision.',
  'Record the selected action, available alternatives, elapsed decision time, and current engine confidence.',
  'Estimate the selected action against a likely stronger line with the current evaluator.',
  'Explain the grade in player-friendly language without hiding the raw score delta.',
  'Cover complex-turn cases so the review system can keep up during stacked turns.',
  'Test the review output with repeatable sessions before it is used for public practice.',
];

export function HowTrainingWorksPage() {
  return (
    <MarketingPageShell
      eyebrow="Practice"
      title="How Practice Works"
      description="Magic Brains is built around Commander reps: bring a deck, use beta practice tools, and review the game afterward."
      showAdBand={false}
    >
      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((step) => (
          <article key={step.title} className="rounded-lg border border-stone-200 bg-[#fbfaf7] p-5">
            <h2 className="text-base font-black text-stone-950">{step.title}</h2>
            <p className="mt-3 text-sm leading-6 text-stone-600">{step.body}</p>
          </article>
        ))}
      </div>

      <div>
        <h2 className="font-serif text-2xl font-bold text-stone-950">Deck Sources</h2>
        <p className="mt-3">
          Practice is not limited to imported lists. The public flow should keep the deck-generation and fill-missing paths available as deck sources, because they let the practice tool grab usable decks for players who do not have a full list ready.
        </p>
      </div>

      <div>
        <h2 className="font-serif text-2xl font-bold text-stone-950">Review Enhancement Requirements</h2>
        <ul className="mt-3 space-y-2">
          {gradingRequirements.map((requirement) => (
            <li key={requirement} className="rounded border border-stone-200 bg-stone-50 px-3 py-2">
              {requirement}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="text-base font-black text-emerald-950">Launch Rule For Ads</h2>
        <p className="mt-2 text-emerald-900">
          Ads belong on content pages and separated page bands, not inside the live play area, not next to card clicks, and not beside play buttons or game controls.
        </p>
      </div>

      <Link
        to="/play"
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-stone-950 px-5 text-sm font-black text-white transition hover:bg-stone-800"
      >
        Open Practice Tool
      </Link>
    </MarketingPageShell>
  );
}
