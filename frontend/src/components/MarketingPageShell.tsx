import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Swords } from 'lucide-react';
import { SafeAdBand } from './SafeAdBand';

interface MarketingPageShellProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  showAdBand?: boolean;
}

const footerLinks = [
  { to: '/how-training-works', label: 'How Practice Works' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
  { to: '/contact', label: 'Contact/About' },
];

export function MarketingPageShell({
  eyebrow,
  title,
  description,
  children,
  showAdBand = true,
}: MarketingPageShellProps) {
  return (
    <div className="min-h-screen bg-[#f7f3ea] text-stone-950">
      <header className="border-b border-stone-200 bg-[#14110f] text-stone-50">
        <nav className="mx-auto flex min-h-16 max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Link to="/" className="flex items-center gap-3" aria-label="Magic Brains home">
            <span className="grid h-9 w-9 place-items-center rounded-lg border border-amber-300/40 bg-amber-300/10">
              <Brain className="h-5 w-5 text-amber-200" />
            </span>
            <span className="font-serif text-lg font-bold">Magic Brains</span>
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {footerLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/10"
              >
                {link.label}
              </Link>
            ))}
            <Link
              to="/play"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-amber-300 px-4 text-sm font-bold text-stone-950 transition hover:bg-amber-200"
            >
              <Swords className="h-4 w-4" />
              Practice
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="border-b border-stone-200 bg-white px-4 py-12 sm:px-6">
          <div className="mx-auto max-w-4xl">
            <div className="text-sm font-black uppercase tracking-[0.18em] text-red-700">
              {eyebrow}
            </div>
            <h1 className="mt-3 font-serif text-4xl font-bold text-stone-950 sm:text-5xl">
              {title}
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-stone-600">
              {description}
            </p>
          </div>
        </section>

        <section className="px-4 py-12 sm:px-6">
          <div className="mx-auto max-w-4xl space-y-8 text-sm leading-7 text-stone-700">
            {children}
          </div>
        </section>

        {showAdBand && <SafeAdBand />}
      </main>

      <footer className="border-t border-stone-200 bg-white px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-stone-500 md:flex-row md:items-center md:justify-between">
          <div>
            <span className="font-semibold text-stone-800">Magic Brains</span> is an independent Commander practice tool.
          </div>
          <div className="flex flex-wrap gap-4">
            {footerLinks.map((link) => (
              <Link key={link.to} to={link.to} className="font-semibold text-stone-600 hover:text-stone-950">
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
