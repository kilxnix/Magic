import { Link } from 'react-router-dom';
import { MarketingPageShell } from '../components/MarketingPageShell';

export function PrivacyPage() {
  return (
    <MarketingPageShell
      eyebrow="Privacy"
      title="Privacy Policy"
      description="This page explains the data Magic Brains expects to handle for public Commander practice tools, deck sourcing, and post-game review."
    >
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">
        Last updated May 24, 2026
      </div>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">Information We Collect</h2>
        <p className="mt-3">
          Magic Brains may process decklists, commander choices, generated practice decks, game actions, turn review data, browser session data, device information, and basic server logs. If contact forms or accounts are added, we may also process the contact details you provide.
        </p>
      </section>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">How We Use Information</h2>
        <p className="mt-3">
          We use this information to load decks, fill missing cards, run practice sessions and shared table rooms, generate post-game play-by-play, improve turn review, prevent abuse, debug production issues, and keep the service available.
        </p>
      </section>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">Ads, Cookies, And Local Storage</h2>
        <p className="mt-3">
          Public launch may include ads to keep practice tools free. Advertising partners may use cookies or similar technologies to measure ads, limit fraud, and personalize or contextualize placements where allowed. When ad consent is required, Magic Brains stores your ad choice in local storage and does not request ad slots after a decline. Magic Brains may also use browser storage to remember local preferences, deck history, saved games, and review state.
        </p>
      </section>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">Third-Party Services</h2>
        <p className="mt-3">
          The platform may use card-data, price, image, analytics, hosting, and advertising providers. Those providers process data under their own policies. Before launch, connect this page to the final providers actually used in production.
        </p>
      </section>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">Your Choices</h2>
        <p className="mt-3">
          You can clear local browser storage, avoid submitting personal information in deck names or notes, and contact us about privacy questions. Some data may be retained when needed for security, legal compliance, or service reliability.
        </p>
      </section>

      <section>
        <h2 className="font-serif text-2xl font-bold text-stone-950">Contact</h2>
        <p className="mt-3">
          Privacy questions can be sent through the <Link to="/contact" className="font-bold text-red-700 hover:text-red-900">Contact/About page</Link>.
        </p>
      </section>
    </MarketingPageShell>
  );
}
