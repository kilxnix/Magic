import { Link } from 'react-router-dom';
import { MarketingPageShell } from '../components/MarketingPageShell';

export function TermsPage() {
  return (
    <MarketingPageShell
      eyebrow="Terms"
      title="Terms Of Use"
      description="These terms set expectations for using Magic Brains as a public Commander practice tool."
    >
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">
        Last updated May 24, 2026
      </div>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">Using Magic Brains</h2>
        <p className="mt-3">
          Magic Brains provides deck sourcing, private room tools, shared table tracking, and experimental AI practice for beta practice purposes. You are responsible for the decklists, notes, names, and other content you submit.
        </p>
      </section>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">No Guarantee Of Perfect Rules Or Grades</h2>
        <p className="mt-3">
          The game engine, card parsing, AI selector, and turn review can make mistakes. Move ratings and coaching notes are practice aids, not official tournament rulings or guarantees of optimal play.
        </p>
      </section>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">Acceptable Use</h2>
        <p className="mt-3">
          Do not abuse the service, attack the infrastructure, submit unlawful content, bypass limits, scrape at high volume, interfere with ads, or use generated outputs to mislead others about official rulings or endorsements.
        </p>
      </section>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">Ads And Free Access</h2>
        <p className="mt-3">
          Magic Brains may show ads so the public practice tool can remain free. Ad placements should stay separated from gameplay controls, card-click areas, deck editing actions, and other interactive surfaces that could cause accidental clicks.
        </p>
      </section>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">Independence</h2>
        <p className="mt-3">
          Magic Brains is an independent Commander practice tool and is not affiliated with, endorsed by, sponsored by, or approved by Wizards of the Coast, Hasbro, or any marketplace or deck-hosting service.
        </p>
      </section>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">Contact</h2>
        <p className="mt-3">
          Questions about these terms can be sent through the <Link to="/contact" className="font-bold text-red-700 hover:text-red-900">Contact/About page</Link>.
        </p>
      </section>
    </MarketingPageShell>
  );
}
