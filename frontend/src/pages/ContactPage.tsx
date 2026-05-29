import { Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { MarketingPageShell } from '../components/MarketingPageShell';
import { siteConfig } from '../lib/siteConfig';

const focusAreas = [
  {
    icon: Sparkles,
    title: 'Deck Practice',
    body: 'Practice with imported lists, generated lists, or platform-supplied Commander decks.',
  },
  {
    icon: ShieldCheck,
    title: 'Rules Coverage',
    body: 'Improve the game engine, selector speed, and turn review so reviews become more useful for real games over time.',
  },
  {
    icon: Mail,
    title: 'Launch Feedback',
    body: 'Bug reports, rules mistakes, card parser misses, and confusing grades are the most valuable reports.',
  },
];

export function ContactPage() {
  return (
    <MarketingPageShell
      eyebrow="Contact"
      title="Contact And About"
      description="Magic Brains is a Commander practice tool for getting beta reps with your decks and learning from the game afterward."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {focusAreas.map((area) => {
          const Icon = area.icon;
          return (
            <article key={area.title} className="rounded-lg border border-stone-200 bg-[#fbfaf7] p-5">
              <div className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-stone-950 text-amber-200">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="text-base font-black text-stone-950">{area.title}</h2>
              <p className="mt-3 text-sm leading-6 text-stone-600">{area.body}</p>
            </article>
          );
        })}
      </div>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">Contact</h2>
        <p className="mt-3">
          For launch feedback, rules bugs, privacy questions, or partnership questions, email <a className="font-bold text-red-700 hover:text-red-900" href={`mailto:${siteConfig.supportEmail}`}>{siteConfig.supportEmail}</a>.
        </p>
      </section>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">What To Send</h2>
        <p className="mt-3">
          Helpful reports include a deck URL or list, a short description of what happened, the turn where it happened, and what you expected the practice tool or review system to do instead.
        </p>
      </section>
    </MarketingPageShell>
  );
}
