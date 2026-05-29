import { useEffect, useState } from 'react';

export function isInteractiveGamePath(pathname: string) {
  const path = pathname.toLowerCase();
  return (
    path === '/play'
    || path.startsWith('/play/')
    || path === '/shelector'
    || path.startsWith('/shelector/')
    || path === '/multiplayer'
    || path.startsWith('/multiplayer/')
    || path === '/game'
    || path.startsWith('/game/')
    || path === '/rooms'
    || path.startsWith('/rooms/')
  );
}

export function useCurrentPathname() {
  const [pathname, setPathname] = useState(() => (
    typeof window === 'undefined' ? '/' : window.location.pathname
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const update = () => setPathname(window.location.pathname);
    const updateAfterNavigation = () => window.setTimeout(update, 0);

    window.addEventListener('popstate', update);
    window.addEventListener('click', updateAfterNavigation, true);

    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('click', updateAfterNavigation, true);
    };
  }, []);

  return pathname;
}
